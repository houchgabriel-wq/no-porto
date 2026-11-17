// Novo embarque (SPEC.md, seção 3): um BL com um ou mais containers. Cada container tem a invoice
// (quantidade e preço) e a packing list (peças por caixa); os arquivos de todos os containers podem
// ser escolhidos de uma vez, e o app junta invoice e packing list de cada um. O arquivo do BL pode ser
// anexado. Antes de gravar, a prévia mostra de qual PO sai cada item: sempre da produção do mesmo
// fornecedor, a mais antiga primeiro, e os containers do mesmo fornecedor em sequência.

import { useEffect, useId, useMemo, useState, type FormEvent } from 'react';
import { allocateInvoices, guessSupplier, type LineAllocation } from '../core/allocation';
import { parseShipmentFile, type DocumentLine, type DocumentNote, type ShipmentFile } from '../core/documents';
import { NO_SUPPLIER } from '../core/items';
import { formatQuantity, formatUsd } from '../core/money';
import { formatDay } from '../core/shipments';
import { mergePackingList, pairShipmentFiles } from '../core/shipmentFiles';
import { api, ApiError, type ProductionData } from './api';
import { Dialog, FormError } from './components';
import { linesValue, Notes, readFile } from './Documents';
import { Icon } from './icons';
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

async function readShipmentFile(f: File): Promise<ShipmentFile> {
  const parsed = parseShipmentFile(await readFile(f), f.name);
  if ('error' in parsed) throw new Error(`${f.name}: ${parsed.error}`);
  return parsed;
}

function toBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ''));
    reader.onerror = () => reject(new Error('Não foi possível ler o arquivo do BL.'));
    reader.readAsDataURL(file);
  });
}

let nextKey = 0;

interface Props {
  open: boolean;
  data: ProductionData;
  production: Production;
  onClose: () => void;
  onDone: (msg: string) => void;
}

export function NewShipmentDialog({ open, data, production, onClose, onDone }: Props) {
  const ids = useId();
  const [bill, setBill] = useState('');
  const [eta, setEta] = useState('');
  const [blFile, setBlFile] = useState<File | null>(null);
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
    setContainers([]);
    setReadErrors([]);
    setError(null);
    setBusy(false);
  }, [open]);

  const openBills = useMemo(() => data.bills.filter((b) => !b.arrivedAt), [data.bills]);
  const knownBill = openBills.find((b) => b.number.toUpperCase() === bill.trim().toUpperCase());
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
        parsed.push(await readShipmentFile(f));
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
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    if (containers.length === 0) return setError('Escolha os arquivos de ao menos um container.');
    const missing = containers.findIndex((c, i) => !c.supplierId || !c.number.trim() || merged[i]!.lines.length === 0);
    if (missing >= 0) return setError(`Container ${missing + 1}: informe o fornecedor e o número da invoice.`);
    if (duplicates.some(Boolean)) return setError('Há invoice que já foi registrada (ou repetida). Confira os números.');
    setBusy(true);
    setError(null);
    try {
      const res = await production.write(async () => {
        const r = await api.receiveShipment({
          bill: bill.trim() || null,
          eta: knownBill ? null : eta || null,
          invoices: containers.map((c, i) => ({ supplierId: c.supplierId, number: c.number.trim(), ref: c.ref.trim(), container: c.container.trim(), lines: merged[i]!.lines })),
        });
        if (blFile && r.billId) {
          try {
            await api.putBillDocument(r.billId, { name: blFile.name, contentType: blFile.type, data: await toBase64(blFile) });
          } catch {
            return { ...r, blFailed: true };
          }
        }
        return { ...r, blFailed: false };
      });
      const n = containers.length;
      onDone(
        `${n === 1 ? '1 container embarcado' : `${n} containers embarcados`}: ${formatQuantity(res.taken)} ex. saíram da produção` +
          (res.extra ? `; ${formatQuantity(res.extra)} ex. não estavam na produção e entraram para conferir` : '') +
          (res.blFailed ? '. O arquivo do BL não foi anexado: anexe pela ficha do embarque.' : '.'),
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
                    <button type="button" className="btn-texto" onClick={() => setBlFile(null)}>
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
              warnings={merged[i]!.warnings}
              allocation={allocation?.[i] ?? null}
              duplicate={duplicates[i]!}
              busy={busy}
              onChange={(patch) => update(c.key, patch)}
              onFile={(slot, f) => void setSlot(c.key, slot, f)}
              onRemove={() => setContainers((cs) => cs.filter((x) => x.key !== c.key))}
            />
          ))}

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

function ContainerCard({
  index,
  c,
  data,
  names,
  lines,
  warnings,
  allocation,
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
  warnings: DocumentNote[];
  allocation: LineAllocation[] | null;
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
  return (
    <section className="conteiner" aria-labelledby={`${ids}-t`}>
      <div className="conteiner-topo">
        <h4 id={`${ids}-t`}>
          Container {index + 1}
          {c.container && <span className="mudo"> · {c.container}</span>}
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
        <div className="grupo">
          <label className="rotulo" htmlFor={`${ids}-ctr`}>
            Container
          </label>
          <input id={`${ids}-ctr`} className="campo" value={c.container} onChange={(e) => onChange({ container: e.target.value })} placeholder="Opcional" />
        </div>
        <div className="grupo">
          <label className="rotulo" htmlFor={`${ids}-ref`}>
            Ref. do embarque
          </label>
          <input id={`${ids}-ref`} className="campo" value={c.ref} onChange={(e) => onChange({ ref: e.target.value })} placeholder="Opcional" />
        </div>
      </fieldset>
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
          </summary>
          <AllocationTable lines={lines} allocation={allocation} data={data} />
        </details>
      ) : (
        !c.supplierId && <p className="dica">Não deu para saber o fornecedor pelos arquivos: escolha acima.</p>
      )}
      <Notes notes={warnings} />
    </section>
  );
}

function AllocationTable({ lines, allocation, data }: { lines: DocumentLine[]; allocation: LineAllocation[]; data: ProductionData }) {
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
                  {l.description}
                  <span className="t-isbn">
                    {l.isbn ?? 'Sem ISBN'}
                    {l.orderCode && ` · a invoice cita a ${l.orderCode}`}
                  </span>
                </td>
                <td className="num" data-rot="Quantidade">
                  {formatQuantity(l.quantity)}
                </td>
                <td className="num" data-rot="Por caixa">
                  {l.piecesPerCarton ?? '—'}
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
