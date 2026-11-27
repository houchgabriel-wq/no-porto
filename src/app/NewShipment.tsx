// Novo embarque (SPEC.md, seção 3): um BL com um ou mais containers. Cada container tem a invoice
// (quantidade e preço) e a packing list (peças por caixa); os arquivos de todos os containers podem
// ser escolhidos de uma vez, e o app junta invoice e packing list de cada um. O arquivo do BL pode ser
// anexado. Antes de gravar, a prévia mostra de qual PO sai cada item: sempre da produção do mesmo
// fornecedor, a mais antiga primeiro, e os containers do mesmo fornecedor em sequência.
// Com o BL em PDF, as unidades (container, lacre, caixas, peso) são lidas dele e ligadas a cada
// container pelo número do container da packing list ou pelas caixas e pelo peso (25/11/2026). A data do
// BL preenche a chegada prevista: a data mais o prazo, de 35 dias por padrão, que o admin muda (26/11/2026).
// Os produtos com o ISBN na curva ABC ficam com o título dela, no lugar do nome da invoice (27/11/2026).
// Os arquivos da invoice e da packing list de cada container ficam guardados, para baixar depois (27/11/2026).

import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { allocateInvoices, guessSupplier, type LineAllocation } from '../core/allocation';
import { ARRIVAL_DAYS_DEFAULT, arrivalDaysProblem, arrivalFromBill, arrivalText, billDateProblem, billDateText, type BillDate } from '../core/billArrival';
import { formatWeight, matchUnits, packingTotals, unitDifference, unitSummary, type BillUnit, type UnitMatch } from '../core/billUnits';
import { parseShipmentFile, type DocumentLine, type DocumentNote, type ShipmentFile } from '../core/documents';
import { NO_SUPPLIER } from '../core/items';
import { formatQuantity, formatUsd } from '../core/money';
import { can } from '../core/roles';
import { formatDay, spDate } from '../core/shipments';
import { mergePackingList, pairShipmentFiles, piecesLabel } from '../core/shipmentFiles';
import { api, ApiError, type Me, type ProductionData } from './api';
import { Dialog, FormError } from './components';
import { linesValue, Notes, readFile } from './Documents';
import { MAX_FILE_BYTES, sheetContentType, toBase64 } from './fileUpload';
import { Icon } from './icons';
import { readBillPdf } from './pdfText';
import type { Production } from './production';

const SHEETS = '.xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel';
const BL_TYPES = 'application/pdf,image/png,image/jpeg';
const BL_MAX_BYTES = 5_000_000;

interface Container {
  key: string;
  invoice: ShipmentFile | null;
  packing: ShipmentFile | null;
  supplierId: string;
  number: string;
  container: string;
  ref: string;
}

/** As linhas do container: as da invoice com as peças por caixa da packing list. */
function containerLines(c: Container): { lines: DocumentLine[]; warnings: DocumentNote[] } {
  const inv = c.invoice ? (c.invoice.invoice ?? c.invoice.packing) : null;
  const pl = c.packing ? (c.packing.packing ?? c.packing.invoice) : null;
  const merged = mergePackingList(inv?.lines ?? null, pl?.lines ?? null);
  const parsed = [...(inv?.warnings ?? []), ...(pl && pl !== inv ? pl.warnings : [])];
  return { lines: merged.lines, warnings: [...parsed, ...merged.warnings] };
}

/** A packing list do container, para as caixas e o peso (pode estar no mesmo arquivo da invoice). */
function packingDoc(c: Container) {
  return (c.packing ? (c.packing.packing ?? c.packing.invoice) : null) ?? c.invoice?.packing ?? null;
}

async function readShipmentFile(f: File): Promise<ShipmentFile> {
  const parsed = parseShipmentFile(await readFile(f), f.name);
  if ('error' in parsed) throw new Error(`${f.name}: ${parsed.error}`);
  return parsed;
}

let nextKey = 0;

interface Props {
  open: boolean;
  me: Me;
  data: ProductionData;
  production: Production;
  onClose: () => void;
  onDone: (msg: string) => void;
}

export function NewShipmentDialog({ open, me, data, production, onClose, onDone }: Props) {
  const ids = useId();
  const [bill, setBill] = useState('');
  const [eta, setEta] = useState('');
  const [blFile, setBlFile] = useState<File | null>(null);
  // As unidades lidas do PDF do BL; null quando não há BL lido.
  const [units, setUnits] = useState<BillUnit[] | null>(null);
  const [unitsNote, setUnitsNote] = useState<string | null>(null);
  // A unidade que a pessoa escolheu para um container ('' é nenhuma); sem escolha, vale a ligação automática.
  const [unitChoice, setUnitChoice] = useState<Record<string, string>>({});
  // A data do BL e o prazo até a chegada prevista; a chegada que o app preencheu (para não trocar a digitada).
  const [arrivalDays, setArrivalDays] = useState(ARRIVAL_DAYS_DEFAULT);
  const [billDate, setBillDate] = useState<BillDate | null>(null);
  const [dateNote, setDateNote] = useState<string | null>(null);
  const autoEta = useRef<string | null>(null);
  // O arquivo de onde veio cada invoice e packing list lida, para guardar depois de gravar.
  const rawFiles = useRef(new WeakMap<ShipmentFile, File>());
  const [containers, setContainers] = useState<Container[]>([]);
  const [reading, setReading] = useState(false);
  const [readErrors, setReadErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setBill('');
    setEta('');
    setBlFile(null);
    setUnits(null);
    setUnitsNote(null);
    setUnitChoice({});
    setBillDate(null);
    setDateNote(null);
    autoEta.current = null;
    setContainers([]);
    setReadErrors([]);
    setError(null);
    setBusy(false);
    // O prazo pode ter mudado desde a última vez; sem resposta, vale o padrão.
    api
      .settings()
      .then((s) => setArrivalDays(s.arrivalDays))
      .catch(() => setArrivalDays(ARRIVAL_DAYS_DEFAULT));
  }, [open]);

  const openBills = useMemo(() => data.bills.filter((b) => !b.arrivedAt), [data.bills]);
  const knownBill = openBills.find((b) => b.number.toUpperCase() === bill.trim().toUpperCase());

  // Com a data do BL, a chegada prevista vem preenchida, se ainda está vazia ou com a que o app pôs; a
  // data que a pessoa digitou fica. Volta a valer quando o BL ou o prazo mudam.
  const suggestedEta = billDate ? arrivalFromBill(billDate.date, arrivalDays) : null;
  useEffect(() => {
    if (!suggestedEta || knownBill) return;
    if (eta === '' || eta === autoEta.current) {
      setEta(suggestedEta);
      autoEta.current = suggestedEta;
    }
    // Só quando a sugestão muda, ou quando o número deixa de ser o de um BL já cadastrado.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suggestedEta, Boolean(knownBill)]);
  const names = useMemo(() => new Map(data.suppliers.map((s) => [s.id, s.name])), [data.suppliers]);

  /** Container novo a partir dos arquivos, com fornecedor, número e container sugeridos. */
  function makeContainer(files: { invoice: ShipmentFile | null; packing: ShipmentFile | null }, fallbackSupplier: string): Container {
    const base: Container = { key: `c${nextKey++}`, ...files, supplierId: '', number: '', container: '', ref: '' };
    const { lines } = containerLines(base);
    const header = `${files.invoice?.headerText ?? ''} ${files.packing?.headerText ?? ''}`;
    return {
      ...base,
      supplierId: guessSupplier(lines, header, data.items, data.suppliers) ?? fallbackSupplier,
      number: files.invoice?.number ?? files.packing?.number ?? '',
      container: files.invoice?.container ?? files.packing?.container ?? '',
    };
  }

  /** Arquivos escolhidos de uma vez: juntam-se aos containers que ainda estão sem invoice ou sem packing list. */
  async function addFiles(list: FileList) {
    setReading(true);
    setError(null);
    const errors: string[] = [];
    const parsed: ShipmentFile[] = [];
    for (const f of Array.from(list)) {
      try {
        const sf = await readShipmentFile(f);
        rawFiles.current.set(sf, f);
        parsed.push(sf);
      } catch (e) {
        errors.push(e instanceof Error ? e.message : `${f.name}: não foi possível ler.`);
      }
    }
    setReadErrors(errors);
    setContainers((current) => {
      const complete = current.filter((c) => (c.invoice && c.packing) || (!c.invoice && !c.packing));
      const loose = current.filter((c) => !complete.includes(c));
      const pool = [...loose.flatMap((c) => [c.invoice, c.packing].filter((f): f is ShipmentFile => f !== null)), ...parsed];
      let last = current.at(-1)?.supplierId ?? '';
      const made = pairShipmentFiles(pool).map((files) => {
        // Quem já estava na tela mantém o que a pessoa preencheu.
        const kept = loose.find((c) => (files.invoice && c.invoice === files.invoice) || (files.packing && c.packing === files.packing));
        const c = kept ? { ...kept, ...files } : makeContainer(files, last);
        last = c.supplierId || last;
        return c;
      });
      return [...complete, ...made];
    });
    setReading(false);
  }

  /** Troca a invoice ou a packing list de um container. */
  async function setSlot(key: string, slot: 'invoice' | 'packing', f: File) {
    setError(null);
    try {
      const file = await readShipmentFile(f);
      rawFiles.current.set(file, f);
      setContainers((cs) =>
        cs.map((c) => {
          if (c.key !== key) return c;
          const next = { ...c, [slot]: file };
          return {
            ...next,
            number: next.number || file.number || '',
            container: next.container || file.container || '',
          };
        }),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível ler o arquivo.');
    }
  }

  const update = (key: string, patch: Partial<Container>) => setContainers((cs) => cs.map((c) => (c.key === key ? { ...c, ...patch } : c)));

  const merged = useMemo(() => containers.map(containerLines), [containers]);
  // Os títulos da curva ABC para os ISBNs dos arquivos: a prévia mostra o nome que vai ficar (o servidor
  // grava o mesmo, pela mesma curva).
  const isbnList = useMemo(() => [...new Set(merged.flatMap((m) => m.lines.map((l) => l.isbn).filter((x): x is string => Boolean(x))))].sort().join(','), [merged]);
  const [curve, setCurve] = useState<{ stockDate: string | null; titles: Record<string, string> } | null>(null);
  useEffect(() => {
    if (!isbnList) return setCurve(null);
    let alive = true;
    api.curveTitles(isbnList.split(',')).then(
      (r) => alive && setCurve(r),
      () => alive && setCurve(null),
    );
    return () => {
      alive = false;
    };
  }, [isbnList]);
  const curveTitles = curve?.titles ?? {};
  const renamed = merged.flatMap((m) => m.lines).filter((l) => l.isbn && curveTitles[l.isbn] && curveTitles[l.isbn] !== l.description).length;
  const ready = containers.every((c, i) => c.supplierId && merged[i]!.lines.length > 0);
  const allocation = useMemo(
    () => (containers.length && ready ? allocateInvoices(containers.map((c, i) => ({ supplierId: c.supplierId, lines: merged[i]!.lines })), data.items, data.orders) : null),
    [containers, merged, ready, data.items, data.orders],
  );
  const duplicates = containers.map((c, i) => {
    const n = c.number.trim().toUpperCase();
    if (!n || !c.supplierId) return false;
    return data.invoices.some((v) => v.supplierId === c.supplierId && v.number.toUpperCase() === n) || containers.some((o, j) => j < i && o.supplierId === c.supplierId && o.number.trim().toUpperCase() === n);
  });
  // As caixas e o peso de cada container, pela packing list, e a unidade do BL ligada a ele.
  const totals = useMemo(() => containers.map((c) => { const pl = packingDoc(c); return pl ? packingTotals(pl.lines) : { cartons: null, weightGrams: null }; }), [containers]);
  const matches = useMemo(
    () => (units ? matchUnits(containers.map((c, i) => ({ key: c.key, container: c.container.trim() || null, ...totals[i]! })), units) : new Map<string, UnitMatch>()),
    [units, containers, totals],
  );
  const unitOf = (c: Container): BillUnit | null => {
    if (!units) return null;
    const chosen = unitChoice[c.key];
    if (chosen !== undefined) return units.find((u) => u.container === chosen) ?? null;
    return matches.get(c.key)?.unit ?? null;
  };
  const chosenUnits = containers.map(unitOf);
  const loose = units ? units.filter((u) => !chosenUnits.some((x) => x?.container === u.container)) : [];
  const totalQty = merged.reduce((s, m) => s + m.lines.reduce((t, l) => t + l.quantity, 0), 0);
  const totalValue = merged.reduce((s, m) => s + linesValue(m.lines), 0);
  const taken = allocation ? allocation.flat().reduce((s, a) => s + a.takes.reduce((t, k) => t + k.quantity, 0), 0) : 0;
  const extra = allocation ? allocation.flat().reduce((s, a) => s + a.extra, 0) : 0;

  function chooseBl(f: File | undefined) {
    setError(null);
    if (!f) return;
    if (!['application/pdf', 'image/png', 'image/jpeg'].includes(f.type)) return setError('Envie o BL em PDF, PNG ou JPG.');
    if (f.size > BL_MAX_BYTES) return setError('O arquivo do BL pode ter no máximo 5 MB.');
    setBlFile(f);
    void readBl(f);
  }

  /** A data e as unidades do BL: só do PDF com texto (imagem e PDF escaneado não dão para ler). */
  async function readBl(f: File) {
    setUnits(null);
    setUnitChoice({});
    setUnitsNote(null);
    setBillDate(null);
    setDateNote(null);
    if (f.type !== 'application/pdf') return setUnitsNote('O BL é uma imagem: a data e as unidades não são lidas. Informe a chegada prevista e, se quiser, o container de cada um.');
    try {
      const read = await readBillPdf(await f.arrayBuffer());
      if (read.units.length === 0 && !read.date) {
        return setUnitsNote('Não achei a data nem as unidades no PDF do BL (o BL escaneado não tem texto). Informe a chegada prevista e, se quiser, o container de cada um.');
      }
      if (read.units.length > 0) setUnits(read.units);
      else setUnitsNote('Não achei as unidades (container, lacre, caixas e peso) no PDF do BL. Informe o container de cada um, se quiser.');
      const problem = read.date ? billDateProblem(read.date.date, spDate(new Date())) : 'Não achei a data do BL no PDF: informe a chegada prevista.';
      if (problem) setDateNote(problem);
      else setBillDate(read.date);
    } catch {
      setUnitsNote('Não foi possível ler o PDF do BL. Informe a chegada prevista e, se quiser, o container de cada um.');
    }
  }

  function dropBl() {
    setBlFile(null);
    setUnits(null);
    setUnitsNote(null);
    setUnitChoice({});
    setBillDate(null);
    setDateNote(null);
    // A chegada que veio do BL sai junto; a digitada fica.
    if (eta === autoEta.current) setEta('');
    autoEta.current = null;
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    if (containers.length === 0) return setError('Escolha os arquivos de ao menos um container.');
    const missing = containers.findIndex((c, i) => !c.supplierId || !c.number.trim() || merged[i]!.lines.length === 0);
    if (missing >= 0) return setError(`Container ${missing + 1}: informe o fornecedor e o número da invoice.`);
    if (duplicates.some(Boolean)) return setError('Há invoice que já foi registrada (ou repetida). Confira os números.');
    const picked = chosenUnits.filter((u): u is BillUnit => u !== null).map((u) => u.container);
    if (new Set(picked).size !== picked.length) return setError('A mesma unidade do BL está em dois containers. Confira.');
    setBusy(true);
    setError(null);
    try {
      const res = await production.write(async () => {
        const r = await api.receiveShipment({
          bill: bill.trim() || null,
          eta: knownBill ? null : eta || null,
          invoices: containers.map((c, i) => ({
            supplierId: c.supplierId,
            number: c.number.trim(),
            ref: c.ref.trim(),
            container: (chosenUnits[i]?.container ?? c.container).trim(),
            unit: chosenUnits[i] ?? null,
            // O arquivo da packing list fica anotado no container (26/11/2026): o dela, ou o da invoice que traz as duas abas.
            packingList: c.packing ? c.packing.fileName : c.invoice?.packing ? c.invoice.fileName : '',
            lines: merged[i]!.lines,
          })),
        });
        let blFailed = false;
        if (blFile && r.billId) {
          try {
            await api.putBillDocument(r.billId, { name: blFile.name, contentType: blFile.type, data: await toBase64(blFile) });
          } catch {
            blFailed = true;
          }
        }
        // A invoice e a packing list de cada container ficam guardadas; o arquivo com as duas abas vale para as duas.
        let filesFailed = 0;
        for (const [i, c] of containers.entries()) {
          const invoiceId = r.invoiceIds[i];
          if (!invoiceId) continue;
          const packingSource = c.packing ?? (c.invoice?.packing ? c.invoice : null);
          for (const [kind, source] of [
            ['invoice', c.invoice],
            ['packing', packingSource],
          ] as const) {
            const f = source ? rawFiles.current.get(source) : undefined;
            const contentType = f ? sheetContentType(f.name) : null;
            if (!f || !contentType) continue;
            if (f.size > MAX_FILE_BYTES) {
              filesFailed++;
              continue;
            }
            try {
              await api.putInvoiceDocument(invoiceId, kind, { name: f.name, contentType, data: await toBase64(f) });
            } catch {
              filesFailed++;
            }
          }
        }
        return { ...r, blFailed, filesFailed };
      });
      const n = containers.length;
      const lost = [
        res.blFailed ? 'o arquivo do BL' : null,
        res.filesFailed ? (res.filesFailed === 1 ? '1 arquivo de container' : `${res.filesFailed} arquivos de containers`) : null,
      ].filter(Boolean);
      onDone(
        `${n === 1 ? '1 container embarcado' : `${n} containers embarcados`}: ${formatQuantity(res.taken)} ex. saíram da produção` +
          (res.extra ? `; ${formatQuantity(res.extra)} ex. não estavam na produção e entraram para conferir` : '') +
          (lost.length ? `. Não foi possível guardar ${lost.join(' e ')}: anexe pela ficha do embarque.` : '.'),
      );
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível gravar.');
      setBusy(false);
    }
  }

  return (
    <Dialog title="Novo embarque" open={open} onClose={onClose} wide>
      <form onSubmit={save} noValidate>
        <div className="dlg-corpo">
          <fieldset className="grade-campos tres" disabled={busy}>
            <legend className="rotulo">BL</legend>
            <div className="grupo">
              <label className="rotulo" htmlFor={`${ids}-bl`}>
                Número do BL
              </label>
              <input id={`${ids}-bl`} className="campo" list={`${ids}-bls`} value={bill} onChange={(e) => setBill(e.target.value)} placeholder="Sem BL por enquanto" />
              <datalist id={`${ids}-bls`}>
                {openBills.map((b) => (
                  <option key={b.id} value={b.number} label={b.eta ? `chega ${formatDay(b.eta)}` : undefined} />
                ))}
              </datalist>
            </div>
            <div className="grupo">
              <label className="rotulo" htmlFor={`${ids}-eta`}>
                Chegada prevista
              </label>
              {knownBill ? (
                <p className="campo-fixo" id={`${ids}-eta`}>
                  {knownBill.eta ? `${formatDay(knownBill.eta, true)} (a do BL)` : 'O BL ainda não tem previsão'}
                </p>
              ) : (
                <input id={`${ids}-eta`} className="campo" type="date" value={eta} onChange={(e) => setEta(e.target.value)} />
              )}
            </div>
            <div className="grupo">
              <span className="rotulo" id={`${ids}-blarq`}>
                Arquivo do BL
              </span>
              <div className="arquivo-linha">
                <label className="btn arquivo" aria-describedby={`${ids}-blarq`}>
                  <Icon name="arquivo" />
                  {blFile ? 'Trocar' : 'Anexar'}
                  <input
                    type="file"
                    accept={BL_TYPES}
                    onChange={(e) => {
                      chooseBl(e.target.files?.[0]);
                      e.target.value = '';
                    }}
                  />
                </label>
                {blFile ? (
                  <span className="arquivo-nome">
                    {blFile.name}
                    <button type="button" className="btn-texto" onClick={dropBl}>
                      Tirar
                    </button>
                  </span>
                ) : (
                  <span className="mudo">PDF ou imagem, opcional</span>
                )}
              </div>
            </div>
          </fieldset>
          {blFile && !bill.trim() && <p className="dica">Para anexar o arquivo, informe o número do BL.</p>}
          <ArrivalHint
            billDate={billDate}
            note={dateNote}
            days={arrivalDays}
            eta={eta}
            knownBill={Boolean(knownBill)}
            canChange={can(me.role, 'settings')}
            disabled={busy}
            onUse={(next) => {
              setEta(next);
              autoEta.current = next;
            }}
            onDays={setArrivalDays}
          />
          {unitsNote && (
            <p className="aviso alerta">
              <Icon name="alerta" />
              <span>{unitsNote}</span>
            </p>
          )}
          {units && (
            <div className={`aviso ${containers.length && loose.length ? 'alerta' : 'ok'} unidades-bl`} role="status">
              <Icon name="container" />
              <span>
                <b>{units.length === 1 ? '1 unidade no BL' : `${units.length} unidades no BL`}:</b>{' '}
                {units.map((u) => `${u.container} (${[u.cartons !== null ? `${formatQuantity(u.cartons)} caixas` : null, u.weightGrams !== null ? formatWeight(u.weightGrams) : null].filter(Boolean).join(', ')})`).join(' · ')}
                {containers.length > 0 &&
                  (loose.length
                    ? `. ${loose.length === 1 ? 'Falta ligar' : 'Faltam ligar'} ${loose.map((u) => u.container).join(' e ')}: escolha em cada container.`
                    : '. Todas ligadas aos containers.')}
              </span>
            </div>
          )}

          <div className="conteineres-topo">
            <h3 className="rotulo">Containers</h3>
            <label className={`btn ${containers.length ? '' : 'primario'} arquivo`}>
              <Icon name="mais" />
              {reading ? 'Lendo…' : containers.length ? 'Adicionar arquivos' : 'Escolher invoices e packing lists'}
              <input
                type="file"
                multiple
                accept={SHEETS}
                disabled={reading || busy}
                onChange={(e) => {
                  if (e.target.files?.length) void addFiles(e.target.files);
                  e.target.value = '';
                }}
              />
            </label>
          </div>
          {containers.length === 0 && (
            <p className="dica-texto">
              Escolha de uma vez a invoice e a packing list de cada container (.xlsx ou .xls). O app junta os arquivos de cada container (pelo número do container, pelas linhas e
              pelo nome do arquivo); a quantidade e o preço vêm da invoice, e as peças por caixa, da packing list.
            </p>
          )}
          {readErrors.length > 0 && (
            <div className="aviso alerta" role="alert">
              <Icon name="alerta" />
              <ul className="lista-simples">
                {readErrors.map((m, i) => (
                  <li key={i}>{m}</li>
                ))}
              </ul>
            </div>
          )}

          {containers.map((c, i) => (
            <ContainerCard
              key={c.key}
              index={i}
              c={c}
              data={data}
              names={names}
              lines={merged[i]!.lines}
              curveTitles={curveTitles}
              warnings={merged[i]!.warnings}
              allocation={allocation?.[i] ?? null}
              units={units}
              unit={chosenUnits[i] ?? null}
              by={unitChoice[c.key] !== undefined ? 'escolha' : (matches.get(c.key)?.by ?? null)}
              taken={new Set(chosenUnits.filter((u, j): u is BillUnit => u !== null && j !== i).map((u) => u.container))}
              totals={totals[i]!}
              onUnit={(container) => setUnitChoice((m) => ({ ...m, [c.key]: container }))}
              duplicate={duplicates[i]!}
              busy={busy}
              onChange={(patch) => update(c.key, patch)}
              onFile={(slot, f) => void setSlot(c.key, slot, f)}
              onRemove={() => setContainers((cs) => cs.filter((x) => x.key !== c.key))}
            />
          ))}

          {containers.length > 0 && curve && (
            <p className="dica nomes-curva">
              <Icon name="livro" />
              <span>
                {curve.stockDate === null
                  ? 'Sem curva ABC carregada: os produtos ficam com o nome da invoice.'
                  : renamed > 0
                    ? `${renamed === 1 ? '1 produto fica' : `${renamed} produtos ficam`} com o nome da curva ABC (estoque de ${formatDay(curve.stockDate, true)}), no lugar do nome da invoice. Confira em "De onde sai cada item".`
                    : `Nenhum nome muda pela curva ABC (estoque de ${formatDay(curve.stockDate, true)}).`}
              </span>
            </p>
          )}
          {containers.length > 0 && (
            <p className={`aviso ${extra ? 'alerta' : 'ok'}`}>
              <Icon name={extra ? 'alerta' : 'check'} />
              <span>
                {containers.length === 1 ? '1 container' : `${containers.length} containers`}, {formatQuantity(totalQty)} ex.
                {data.seeValues && totalValue > 0 && ` · ${formatUsd(totalValue)}`}.{' '}
                {allocation
                  ? `${formatQuantity(taken)} ex. saem da produção${extra ? `; ${formatQuantity(extra)} ex. não estão na produção e entram embarcados, sem PO, para conferir` : ''}.`
                  : 'Escolha o fornecedor de cada container para ver o que sai da produção.'}
              </span>
            </p>
          )}
          <FormError message={error} />
        </div>
        <div className="dlg-pe">
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <button type="submit" className="btn primario" disabled={busy || containers.length === 0 || !ready || duplicates.some(Boolean)}>
            {busy ? 'Gravando…' : containers.length > 1 ? `Embarcar ${containers.length} containers` : 'Embarcar'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

/**
 * A chegada prevista pelo BL (26/11/2026): de onde veio a data do BL e o prazo, com "Usar essa data"
 * quando a pessoa mudou a chegada, e "Mudar o prazo" para o admin (vale para todos, nos próximos BLs).
 */
function ArrivalHint({
  billDate,
  note,
  days,
  eta,
  knownBill,
  canChange,
  disabled,
  onUse,
  onDays,
}: {
  billDate: BillDate | null;
  note: string | null;
  days: number;
  eta: string;
  knownBill: boolean;
  canChange: boolean;
  disabled: boolean;
  onUse: (eta: string) => void;
  onDays: (days: number) => void;
}) {
  const ids = useId();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<number | null>(null);

  async function saveDays() {
    const n = draft.trim() === '' ? Number.NaN : Number(draft.trim().replace(',', '.'));
    const problem = arrivalDaysProblem(n);
    if (problem) return setError(problem);
    setSaving(true);
    setError(null);
    try {
      const s = await api.saveSettings({ arrivalDays: n });
      onDays(s.arrivalDays);
      setSaved(s.arrivalDays);
      setEditing(false);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Não foi possível gravar o prazo.');
    } finally {
      setSaving(false);
    }
  }

  if (knownBill) return billDate ? <p className="dica">{billDateText(billDate)} Este BL já está cadastrado: vale a chegada prevista dele.</p> : null;
  if (note) {
    return (
      <p className="aviso alerta">
        <Icon name="alerta" />
        <span>{note}</span>
      </p>
    );
  }
  const suggested = billDate ? arrivalFromBill(billDate.date, days) : null;
  const daysText = days === 1 ? '1 dia' : `${days} dias`;
  return (
    <div className="chegada-bl">
      <p className="dica chegada-bl-texto">
        <Icon name="navio" />
        <span>
          {billDate && suggested
            ? suggested === eta
              ? `${billDateText(billDate)} Chegada prevista: ${arrivalText(billDate.date, days)}.`
              : `${billDateText(billDate)} Pela regra, a chegada prevista seria ${formatDay(suggested, true)} (${daysText} depois).`
            : `Com o BL em PDF, a chegada prevista vem preenchida: ${daysText} depois da data do BL.`}
          {saved !== null && ` Prazo de ${saved === 1 ? '1 dia' : `${saved} dias`} gravado, para todos.`}
        </span>
        {suggested && suggested !== eta && (
          <button type="button" className="btn-texto" onClick={() => onUse(suggested)} disabled={disabled}>
            Usar essa data
          </button>
        )}
        {canChange && !editing && (
          <button
            type="button"
            className="btn-texto"
            disabled={disabled}
            onClick={() => {
              setDraft(String(days));
              setError(null);
              setSaved(null);
              setEditing(true);
            }}
          >
            Mudar o prazo
          </button>
        )}
      </p>
      {editing && (
        <div className="prazo-bl">
          <label className="rotulo" htmlFor={`${ids}-dias`}>
            Dias da data do BL até a chegada prevista
          </label>
          <div className="prazo-bl-linha">
            <input
              id={`${ids}-dias`}
              className="campo"
              type="number"
              inputMode="numeric"
              min={1}
              max={120}
              step={1}
              value={draft}
              aria-describedby={`${ids}-dias-dica`}
              onChange={(e) => {
                setDraft(e.target.value);
                setError(null);
              }}
              onKeyDown={(e) => {
                // O Enter grava o prazo, e não o embarque.
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void saveDays();
                }
              }}
            />
            <span className="prazo-bl-botoes">
              <button type="button" className="btn primario" onClick={() => void saveDays()} disabled={saving}>
                {saving ? 'Gravando…' : 'Gravar o prazo'}
              </button>
              <button type="button" className="btn" onClick={() => setEditing(false)} disabled={saving}>
                Cancelar
              </button>
            </span>
          </div>
          <p className="dica" id={`${ids}-dias-dica`}>
            Vale para todos, nos próximos BLs lidos. A chegada prevista de cada embarque continua podendo ser mudada.
          </p>
          <FormError message={error} />
        </div>
      )}
    </div>
  );
}

function ContainerCard({
  index,
  c,
  data,
  names,
  lines,
  curveTitles,
  warnings,
  allocation,
  units,
  unit,
  by,
  taken,
  totals,
  onUnit,
  duplicate,
  busy,
  onChange,
  onFile,
  onRemove,
}: {
  index: number;
  c: Container;
  data: ProductionData;
  names: Map<string, string>;
  lines: DocumentLine[];
  /** Os títulos da curva ABC pelos ISBNs (27/11/2026). */
  curveTitles: Record<string, string>;
  warnings: DocumentNote[];
  allocation: LineAllocation[] | null;
  /** As unidades lidas do BL (null sem BL em PDF). */
  units: BillUnit[] | null;
  unit: BillUnit | null;
  by: UnitMatch['by'] | 'escolha' | null;
  /** As unidades que já estão em outros containers. */
  taken: Set<string>;
  totals: { cartons: number | null; weightGrams: number | null };
  onUnit: (container: string) => void;
  duplicate: boolean;
  busy: boolean;
  onChange: (patch: Partial<Container>) => void;
  onFile: (slot: 'invoice' | 'packing', f: File) => void;
  onRemove: () => void;
}) {
  const ids = useId();
  const supplierName = names.get(c.supplierId) ?? NO_SUPPLIER;
  const qty = lines.reduce((s, l) => s + l.quantity, 0);
  const withPieces = lines.filter((l) => l.piecesPerCarton !== null).length;
  const extra = allocation ? allocation.reduce((s, a) => s + a.extra, 0) : 0;
  const renamedHere = lines.filter((l) => l.isbn && curveTitles[l.isbn] && curveTitles[l.isbn] !== l.description).length;
  return (
    <section className="conteiner" aria-labelledby={`${ids}-t`}>
      <div className="conteiner-topo">
        <h4 id={`${ids}-t`}>
          Container {index + 1}
          {(unit?.container ?? c.container) && <span className="mudo"> · {unit?.container ?? c.container}</span>}
        </h4>
        <span className="mudo">
          {lines.length} {lines.length === 1 ? 'linha' : 'linhas'} · {formatQuantity(qty)} ex.
          {data.seeValues && linesValue(lines) > 0 && ` · ${formatUsd(linesValue(lines))}`}
        </span>
        <button type="button" className="btn-texto" onClick={onRemove} disabled={busy}>
          Tirar
        </button>
      </div>
      <div className="conteiner-arquivos">
        {(['invoice', 'packing'] as const).map((slot) => {
          const f = c[slot];
          return (
            <div key={slot} className="conteiner-arquivo">
              <span className="rotulo">{slot === 'invoice' ? 'Invoice' : 'Packing list'}</span>
              {f ? <span className="arquivo-nome">{f.fileName}</span> : <span className="mudo">{slot === 'invoice' ? 'Sem invoice: valem as quantidades da packing list' : 'Sem packing list: sem peças por caixa'}</span>}
              <label className="btn-texto arquivo">
                {f ? 'Trocar' : 'Escolher'}
                <span className="so-leitor"> {slot === 'invoice' ? 'a invoice' : 'a packing list'} do container {index + 1}</span>
                <input
                  type="file"
                  accept={SHEETS}
                  disabled={busy}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = '';
                    if (file) onFile(slot, file);
                  }}
                />
              </label>
            </div>
          );
        })}
      </div>
      <fieldset className="grade-campos quatro" disabled={busy}>
        <legend className="so-leitor">Dados do container {index + 1}</legend>
        <div className="grupo">
          <label className="rotulo" htmlFor={`${ids}-forn`}>
            Fornecedor
          </label>
          <select id={`${ids}-forn`} className="campo" value={c.supplierId} onChange={(e) => onChange({ supplierId: e.target.value })}>
            <option value="">Escolha…</option>
            {data.suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <div className="grupo">
          <label className="rotulo" htmlFor={`${ids}-num`}>
            Número da invoice
          </label>
          <input id={`${ids}-num`} className="campo" value={c.number} onChange={(e) => onChange({ number: e.target.value })} aria-invalid={duplicate} />
        </div>
        {units?.length ? (
          <div className="grupo">
            <label className="rotulo" htmlFor={`${ids}-ctr`}>
              Unidade do BL
            </label>
            <select id={`${ids}-ctr`} className="campo" value={unit?.container ?? ''} onChange={(e) => onUnit(e.target.value)} aria-describedby={`${ids}-uni`}>
              <option value="">Nenhuma</option>
              {units.map((u) => (
                <option key={u.container} value={u.container} disabled={taken.has(u.container)}>
                  {u.container}
                  {u.cartons !== null ? ` · ${formatQuantity(u.cartons)} caixas` : ''}
                  {u.weightGrams !== null ? ` · ${formatWeight(u.weightGrams)}` : ''}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <div className="grupo">
            <label className="rotulo" htmlFor={`${ids}-ctr`}>
              Container
            </label>
            <input id={`${ids}-ctr`} className="campo" value={c.container} onChange={(e) => onChange({ container: e.target.value })} placeholder="Opcional" />
          </div>
        )}
        <div className="grupo">
          <label className="rotulo" htmlFor={`${ids}-ref`}>
            Ref. do embarque
          </label>
          <input id={`${ids}-ref`} className="campo" value={c.ref} onChange={(e) => onChange({ ref: e.target.value })} placeholder="Opcional" />
        </div>
      </fieldset>
      {units?.length ? (
        <p className="dica conteiner-unidade" id={`${ids}-uni`}>
          {unit
            ? `${unitSummary(unit)}${by === 'container' ? '. Ligada pelo número do container da packing list.' : by === 'medidas' ? '. Ligada pelas caixas e pelo peso da packing list.' : '.'}`
            : `Escolha a unidade do BL deste container${totals.cartons !== null || totals.weightGrams !== null ? ` (a packing list tem ${[totals.cartons !== null ? `${formatQuantity(totals.cartons)} caixas` : null, totals.weightGrams !== null ? formatWeight(totals.weightGrams) : null].filter(Boolean).join(' e ')})` : ''}.`}
        </p>
      ) : null}
      {unit && unitDifference(totals, unit) && (
        <p className="aviso alerta">
          <Icon name="alerta" />
          <span>{unitDifference(totals, unit)}</span>
        </p>
      )}
      {duplicate && (
        <p className="aviso alerta">
          <Icon name="alerta" />
          <span>
            A invoice {c.number.trim()} da {supplierName} já foi registrada (ou está repetida aqui).
          </span>
        </p>
      )}
      {c.packing && withPieces < lines.length && <p className="dica">{lines.length - withPieces} de {lines.length} linhas ficaram sem peças por caixa.</p>}
      {allocation ? (
        <details className="conferir" open={extra > 0}>
          <summary>
            De onde sai cada item
            {extra > 0 && <span className="alerta-texto"> · {formatQuantity(extra)} ex. fora da produção</span>}
            {renamedHere > 0 && <span className="mudo"> · {renamedHere === 1 ? '1 nome da curva ABC' : `${renamedHere} nomes da curva ABC`}</span>}
          </summary>
          <AllocationTable lines={lines} allocation={allocation} data={data} curveTitles={curveTitles} />
        </details>
      ) : (
        !c.supplierId && <p className="dica">Não deu para saber o fornecedor pelos arquivos: escolha acima.</p>
      )}
      <Notes notes={warnings} />
    </section>
  );
}

function AllocationTable({ lines, allocation, data, curveTitles }: { lines: DocumentLine[]; allocation: LineAllocation[]; data: ProductionData; curveTitles: Record<string, string> }) {
  const items = useMemo(() => new Map(data.items.map((i) => [i.id, i])), [data.items]);
  const codes = useMemo(() => new Map(data.orders.map((o) => [o.id, o.code])), [data.orders]);
  return (
    <div className="tabela-caixa resumo-caixa" tabIndex={0} role="region" aria-label="De onde sai cada item">
      <table className="tabela-resumo tabela-alocacao tabela-empilha">
        <thead>
          <tr>
            <th>Produto</th>
            <th className="num">Quantidade</th>
            <th className="num">Por caixa</th>
            <th>Sai da produção</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l, index) => {
            const a = allocation[index]!;
            return (
              <tr key={`${l.row}-${index}`}>
                <td>
                  {(l.isbn && curveTitles[l.isbn]) || l.description}
                  {l.isbn && curveTitles[l.isbn] && curveTitles[l.isbn] !== l.description && <span className="t-isbn">na invoice: {l.description}</span>}
                  <span className="t-isbn">
                    {l.isbn ?? 'Sem ISBN'}
                    {l.orderCode && ` · a invoice cita a ${l.orderCode}`}
                  </span>
                </td>
                <td className="num" data-rot="Quantidade">
                  {formatQuantity(l.quantity)}
                </td>
                <td className="num" data-rot="Por caixa">
                  {piecesLabel(l)}
                </td>
                <td data-rot="Sai da produção">
                  <ul className="alocacao">
                    {a.takes.map((t) => {
                      const item = items.get(t.itemId)!;
                      const code = item.purchaseOrderId ? (codes.get(item.purchaseOrderId) ?? 'Sem PO') : 'Sem PO';
                      return (
                        <li key={t.itemId}>
                          <b>{code}</b> {formatQuantity(t.quantity)}
                          <span className="mudo">{t.whole ? ' (tudo)' : ` de ${formatQuantity(item.quantity)}`}</span>
                        </li>
                      );
                    })}
                    {a.extra > 0 && (
                      <li className="alerta-texto">
                        <Icon name="alerta" /> {formatQuantity(a.extra)} fora da produção
                      </li>
                    )}
                  </ul>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
