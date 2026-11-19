// Documentos dos fornecedores (SPEC.md, seção 3): Novo pedido (a PO em Excel entra na produção) e
// Registrar chegada (as invoices que chegaram vão para o histórico). O Novo embarque fica em
// NewShipment.tsx. Antes de gravar, a
// pessoa confere o que foi lido e o que vai acontecer.

import { useEffect, useId, useMemo, useState, type FormEvent } from 'react';
import { parseOrderDocument, type DocumentLine, type DocumentNote, type OrderDocument } from '../core/documents';
import { NO_SUPPLIER, normalizeOrderCode, searchKey } from '../core/items';
import { formatQuantity, formatUnitPrice, formatUsd, itemTotalCents } from '../core/money';
import { arrivalOf, formatDay, shipmentUnits } from '../core/shipments';
import { formatMonth, type ShipPlan } from '../core/shipPlan';
import { api, ApiError, type ProductionData } from './api';
import { Dialog, FormError } from './components';
import { Icon } from './icons';
import type { Production } from './production';

const XLSX = '.xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel';

export async function readFile(file: File) {
  const { readWorkbook } = await import('./spreadsheet');
  return readWorkbook(await file.arrayBuffer());
}

export function linesValue(lines: readonly DocumentLine[]): number {
  return lines.reduce((s, l) => s + (l.unitPriceMicros === null ? 0 : itemTotalCents(l.quantity, l.unitPriceMicros)), 0);
}

export function FilePicker({ busy, label, onFile }: { busy: boolean; label: string; onFile: (f: File) => void }) {
  return (
    <label className="btn primario arquivo">
      <Icon name="arquivo" />
      {busy ? 'Lendo o arquivo…' : label}
      <input
        type="file"
        accept={XLSX}
        disabled={busy}
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) onFile(f);
        }}
      />
    </label>
  );
}

export function Notes({ notes }: { notes: DocumentNote[] }) {
  if (!notes.length) return null;
  return (
    <details className="conferir">
      <summary>
        {notes.length} {notes.length === 1 ? 'aviso' : 'avisos'} da leitura
      </summary>
      <ul>
        {notes.map((w, i) => (
          <li key={i}>
            <span className="mudo">Linha {w.row}:</span> {w.message}
          </li>
        ))}
      </ul>
    </details>
  );
}

// ---------- Novo pedido ----------

export function OrderUploadDialog({
  open,
  data,
  production,
  onClose,
  onDone,
}: {
  open: boolean;
  data: ProductionData;
  production: Production;
  onClose: () => void;
  onDone: (msg: string, orderId: string) => void;
}) {
  const ids = useId();
  const [doc, setDoc] = useState<OrderDocument | null>(null);
  const [file, setFile] = useState('');
  const [code, setCode] = useState('');
  const [supplier, setSupplier] = useState('');
  const [orderedAt, setOrderedAt] = useState('');
  const [reading, setReading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setDoc(null);
    setError(null);
    setBusy(false);
    setReading(false);
  }, [open]);

  async function read(f: File) {
    setReading(true);
    setError(null);
    try {
      const parsed = parseOrderDocument(await readFile(f), f.name);
      if ('error' in parsed) throw new Error(parsed.error);
      // "SARA" no documento é a Sara já cadastrada.
      const known = parsed.supplier ? data.suppliers.find((s) => searchKey(s.name) === searchKey(parsed.supplier!)) : undefined;
      setDoc(parsed);
      setFile(f.name);
      setCode(parsed.code ?? '');
      setSupplier(known?.name ?? parsed.supplier ?? '');
      setOrderedAt(parsed.orderedAt ?? '');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível ler o arquivo.');
    } finally {
      setReading(false);
    }
  }

  const normalized = normalizeOrderCode(code);
  const existing = normalized ? data.orders.find((o) => o.code.toUpperCase() === normalized) : undefined;
  const existingItems = existing ? data.items.filter((i) => i.purchaseOrderId === existing.id).length : 0;
  const newSupplier = supplier.trim() !== '' && !data.suppliers.some((s) => searchKey(s.name) === searchKey(supplier));

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!doc) return;
    if (!normalized) return setError('Informe o número da PO (como PO-065).');
    if (!supplier.trim()) return setError('Informe o fornecedor.');
    setBusy(true);
    setError(null);
    try {
      const items = doc.lines.map(({ orderCode: _ignored, ...l }) => l);
      const res = await production.write(() => api.createOrder({ code: normalized, supplier: supplier.trim(), orderedAt: orderedAt || null, items }));
      onDone(`${normalized} cadastrada: ${res.inserted} ${res.inserted === 1 ? 'item' : 'itens'} em produção.`, res.orderId);
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível gravar.');
      setBusy(false);
    }
  }

  /**
   * PO já cadastrada: guarda a especificação e a programação de envio do arquivo nos itens dela (a
   * programação, só nos itens em produção que ainda não têm).
   */
  async function saveDetails() {
    if (!doc || !normalized) return;
    setBusy(true);
    setError(null);
    try {
      const items = doc.lines
        .filter((l) => l.specification || l.shipPlan?.length)
        .map((l) => ({ description: l.description, isbn: l.isbn, quantity: l.quantity, specification: l.specification, shipPlan: l.shipPlan ?? [] }));
      const res = await production.write(() => api.saveOrderDetails(normalized, items));
      const itens = (n: number) => `${n} ${n === 1 ? 'item' : 'itens'}`;
      const parts: string[] = [];
      if (withSpecs > 0) parts.push(`especificação guardada em ${res.updated} de ${itens(res.items)}`);
      if (withPlans > 0) {
        let plans = `programação de envio guardada em ${itens(res.planned)}`;
        if (res.kept > 0) plans += ` (${itens(res.kept)} já ${res.kept === 1 ? 'tinha' : 'tinham'} e ${res.kept === 1 ? 'ficou como estava' : 'ficaram como estavam'})`;
        if (res.notFit > 0) plans += `; em ${itens(res.notFit)}, parte já embarcou e a programação do arquivo não cabe mais`;
        parts.push(plans);
      }
      onDone(`${normalized}: ${parts.join('; ')}.`, existing!.id);
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível gravar.');
      setBusy(false);
    }
  }

  const withSpecs = doc ? doc.lines.filter((l) => l.specification).length : 0;
  const withPlans = doc ? doc.lines.filter((l) => l.shipPlan?.length).length : 0;
  const detailsLabel = withSpecs > 0 && withPlans > 0 ? 'Guardar especificações e programação de envio' : withSpecs > 0 ? 'Guardar só as especificações' : 'Guardar só a programação de envio';
  const total = doc ? doc.lines.reduce((s, l) => s + l.quantity, 0) : 0;
  return (
    <Dialog title="Novo pedido" open={open} onClose={onClose} wide>
      {!doc ? (
        <div className="dlg-corpo">
          <p className="dica-texto">
            Envie a PO em .xlsx, no modelo que vai para o fornecedor (no Google Planilhas: Arquivo → Fazer download → Microsoft Excel). O fornecedor vem do campo <b>To:</b>, e o
            número da PO do campo <b>Order No.</b> ou do nome do arquivo. Antes de gravar, você confere os itens.
          </p>
          <FilePicker busy={reading} label="Escolher a PO" onFile={(f) => void read(f)} />
          <FormError message={error} />
        </div>
      ) : (
        <form onSubmit={save} noValidate>
          <div className="dlg-corpo">
            <p className="dica-texto">
              <b>{file}</b>: {doc.lines.length} {doc.lines.length === 1 ? 'item' : 'itens'}, {formatQuantity(total)} ex.
              {data.seeValues && ` · ${formatUsd(linesValue(doc.lines))}`}
              {withPlans > 0 && ` · ${withPlans === doc.lines.length ? (withPlans === 1 ? 'com data de envio' : 'todos com data de envio') : `${withPlans} com data de envio`}`}
            </p>
            <fieldset className="grade-campos tres" disabled={busy}>
              <legend className="so-leitor">Dados da PO</legend>
              <div className="grupo">
                <label className="rotulo" htmlFor={`${ids}-po`}>
                  PO
                </label>
                <input id={`${ids}-po`} className="campo" value={code} onChange={(e) => setCode(e.target.value)} placeholder="PO-065" aria-invalid={code !== '' && !normalized} />
              </div>
              <div className="grupo">
                <label className="rotulo" htmlFor={`${ids}-forn`}>
                  Fornecedor
                </label>
                <input id={`${ids}-forn`} className="campo" list={`${ids}-forns`} value={supplier} onChange={(e) => setSupplier(e.target.value)} />
                <datalist id={`${ids}-forns`}>
                  {data.suppliers.map((s) => (
                    <option key={s.id} value={s.name} />
                  ))}
                </datalist>
              </div>
              <div className="grupo">
                <label className="rotulo" htmlFor={`${ids}-data`}>
                  Data do pedido
                </label>
                <input id={`${ids}-data`} className="campo" type="date" value={orderedAt} onChange={(e) => setOrderedAt(e.target.value)} />
              </div>
            </fieldset>
            {existingItems > 0 && (
              <p className="aviso alerta">
                <Icon name="alerta" />
                <span>
                  A {normalized} já está cadastrada, com {existingItems} {existingItems === 1 ? 'item' : 'itens'}. Confira o número.
                  {withSpecs > 0 && withPlans > 0
                    ? ' Se for ela mesma, dá para guardar a especificação e a programação de envio deste arquivo nos itens que já estão no app (a programação, só nos que ainda não têm).'
                    : withSpecs > 0
                      ? ' Se for ela mesma, dá para guardar só as especificações deste arquivo nos itens que já estão no app.'
                      : withPlans > 0 && ' Se for ela mesma, dá para guardar a programação de envio deste arquivo nos itens que já estão no app e ainda não têm.'}
                </span>
              </p>
            )}
            {newSupplier && <p className="dica">{supplier.trim()} ainda não está cadastrado: será criado ao gravar.</p>}
            <div className="tabela-caixa resumo-caixa" tabIndex={0} role="region" aria-label="Itens da PO">
              <table className="tabela-resumo tabela-empilha po-itens">
                <thead>
                  <tr>
                    <th>Produto</th>
                    <th className="num">Quantidade</th>
                    {withPlans > 0 && <th>Envio</th>}
                    {data.seeValues && (
                      <>
                        <th className="num">Preço</th>
                        <th className="num">Total</th>
                      </>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {doc.lines.map((l) => (
                    <tr key={l.row}>
                      <td>
                        {l.description}
                        <span className="t-isbn">{l.isbn ?? 'Sem ISBN'}</span>
                        {l.specification && <span className="t-isbn espec-po">{l.specification}</span>}
                      </td>
                      <td className="num" data-rot="Quantidade">{formatQuantity(l.quantity)}</td>
                      {withPlans > 0 && (
                        <td className="po-envio" data-rot="Envio">
                          <PlanText plan={l.shipPlan ?? []} quantity={l.quantity} />
                        </td>
                      )}
                      {data.seeValues && (
                        <>
                          <td className="num" data-rot="Preço">{l.unitPriceMicros === null ? <span className="mudo">Sem preço</span> : formatUnitPrice(l.unitPriceMicros)}</td>
                          <td className="num" data-rot="Total">{l.unitPriceMicros === null ? '—' : formatUsd(itemTotalCents(l.quantity, l.unitPriceMicros))}</td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Notes notes={doc.warnings} />
            <FormError message={error} />
          </div>
          <div className="dlg-pe">
            <button type="button" className="btn" onClick={() => setDoc(null)} disabled={busy}>
              Outro arquivo
            </button>
            {existingItems > 0 && (withSpecs > 0 || withPlans > 0) ? (
              <button type="button" className="btn primario" disabled={busy} onClick={() => void saveDetails()}>
                {busy ? 'Gravando…' : detailsLabel}
              </button>
            ) : (
              <button type="submit" className="btn primario" disabled={busy || existingItems > 0}>
                {busy ? 'Gravando…' : `Pôr ${doc.lines.length === 1 ? 'o item' : `os ${doc.lines.length} itens`} em produção`}
              </button>
            )}
          </div>
        </form>
      )}
    </Dialog>
  );
}

/** A programação de envio de uma linha da PO: só o mês, quando um embarque leva o item inteiro. */
function PlanText({ plan, quantity }: { plan: ShipPlan; quantity: number }) {
  if (plan.length === 0) return <span className="mudo">—</span>;
  if (plan.length === 1 && plan[0]!.quantity === quantity) return <>{formatMonth(plan[0]!.month)}</>;
  return (
    <>
      {plan.map((p) => (
        <span key={p.month} className="envio-parcela">
          {formatMonth(p.month)} · {formatQuantity(p.quantity)}
        </span>
      ))}
    </>
  );
}

// ---------- Container entregue ----------

export function ArrivalDialog({
  open,
  data,
  production,
  initial,
  onClose,
  onDone,
}: {
  open: boolean;
  data: ProductionData;
  production: Production;
  /** Invoices já marcadas ao abrir (as do embarque de onde a pessoa veio). */
  initial?: string[];
  onClose: () => void;
  onDone: (msg: string) => void;
}) {
  const ids = useId();
  const [checked, setChecked] = useState<Set<string>>(() => new Set());
  const [day, setDay] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const billsById = useMemo(() => new Map(data.bills.map((b) => [b.id, b])), [data.bills]);
  const units = useMemo(
    () =>
      shipmentUnits(data.bills, data.invoices, data.today)
        .map((u) => ({ ...u, invoices: u.invoices.filter((v) => !arrivalOf(v, billsById).arrivedAt) }))
        .filter((u) => u.invoices.length > 0),
    [data.bills, data.invoices, data.today, billsById],
  );
  const names = useMemo(() => new Map(data.suppliers.map((s) => [s.id, s.name])), [data.suppliers]);
  const quantity = (invoiceId: string) => data.items.filter((i) => i.invoiceId === invoiceId).reduce((s, i) => s + i.quantity, 0);

  useEffect(() => {
    if (!open) return;
    setChecked(new Set(initial ?? []));
    setDay(data.today);
    setBusy(false);
    setError(null);
    // Só ao abrir.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function toggle(id: string, on: boolean) {
    setChecked((s) => {
      const next = new Set(s);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    if (checked.size === 0) return setError('Marque as invoices que chegaram.');
    if (!day) return setError('Informe o dia da chegada.');
    setBusy(true);
    setError(null);
    try {
      await production.write(() => api.registerArrival([...checked], day));
      onDone(`${checked.size === 1 ? '1 invoice chegou' : `${checked.size} invoices chegaram`} em ${formatDay(day, true)}. Os itens estão no Histórico.`);
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível gravar.');
      setBusy(false);
    }
  }

  return (
    <Dialog title="Registrar chegada" open={open} onClose={onClose} wide>
      <form onSubmit={save} noValidate>
        <div className="dlg-corpo">
          {units.length === 0 ? (
            <p className="dica-texto">Nenhuma invoice a caminho.</p>
          ) : (
            <>
              <p className="dica-texto">Marque as invoices que chegaram e o dia. Os itens delas saem dos embarques a caminho e entram no Histórico.</p>
              <div className="grupo estreito">
                <label className="rotulo" htmlFor={`${ids}-dia`}>
                  Dia da chegada
                </label>
                <input id={`${ids}-dia`} className="campo" type="date" value={day} max={data.today} onChange={(e) => setDay(e.target.value)} disabled={busy} />
              </div>
              <fieldset className="lista-chegada" disabled={busy}>
                <legend className="so-leitor">Invoices a caminho</legend>
                {units.map((u) => (
                  <div key={u.key} className="chegada-unidade">
                    <p className="chegada-unidade-topo">
                      <b>{u.bill ? `BL ${u.bill.number}` : 'Sem BL'}</b>
                      <span className="mudo">{u.eta ? ` · previsão ${formatDay(u.eta, true)}` : ' · sem previsão'}</span>
                    </p>
                    {u.invoices.map((v) => (
                      <label key={v.id} className="chegada-invoice">
                        <input type="checkbox" checked={checked.has(v.id)} onChange={(e) => toggle(v.id, e.target.checked)} />
                        <span>
                          Invoice <b>{v.number}</b>
                          <span className="mudo">
                            {' '}
                            · {v.supplierId ? (names.get(v.supplierId) ?? NO_SUPPLIER) : NO_SUPPLIER} · {formatQuantity(quantity(v.id))} ex.
                          </span>
                        </span>
                      </label>
                    ))}
                  </div>
                ))}
              </fieldset>
            </>
          )}
          <FormError message={error} />
        </div>
        <div className="dlg-pe">
          <button type="button" className="btn" onClick={onClose}>
            Cancelar
          </button>
          {units.length > 0 && (
            <button type="submit" className="btn primario" disabled={busy}>
              {busy ? 'Gravando…' : checked.size > 1 ? `Registrar ${checked.size} chegadas` : 'Registrar chegada'}
            </button>
          )}
        </div>
      </form>
    </Dialog>
  );
}
