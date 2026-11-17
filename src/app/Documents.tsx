// Documentos dos fornecedores (SPEC.md, seção 3): Novo pedido (a PO em Excel entra na produção), Novo
// embarque (a invoice ou packing list tira os itens da produção do mesmo fornecedor, a mais antiga
// primeiro) e Registrar chegada (as invoices que chegaram vão para o histórico). Antes de gravar, a
// pessoa confere o que foi lido e o que vai acontecer.

import { useEffect, useId, useMemo, useState, type FormEvent } from 'react';
import { allocateShipment, guessSupplier, type LineAllocation } from '../core/allocation';
import { parseInvoiceDocument, parseOrderDocument, type DocumentLine, type DocumentNote, type InvoiceDocument, type OrderDocument } from '../core/documents';
import { NO_SUPPLIER, normalizeOrderCode, searchKey } from '../core/items';
import { formatQuantity, formatUnitPrice, formatUsd, itemTotalCents } from '../core/money';
import { arrivalOf, formatDay, shipmentUnits } from '../core/shipments';
import { api, ApiError, type ProductionData } from './api';
import { Dialog, FormError } from './components';
import { Icon } from './icons';
import type { Production } from './production';

const XLSX = '.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

async function readFile(file: File) {
  const { readWorkbook } = await import('./spreadsheet');
  return readWorkbook(await file.arrayBuffer());
}

function linesValue(lines: readonly DocumentLine[]): number {
  return lines.reduce((s, l) => s + (l.unitPriceMicros === null ? 0 : itemTotalCents(l.quantity, l.unitPriceMicros)), 0);
}

function FilePicker({ busy, label, onFile }: { busy: boolean; label: string; onFile: (f: File) => void }) {
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

function Notes({ notes }: { notes: DocumentNote[] }) {
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
                </span>
              </p>
            )}
            {newSupplier && <p className="dica">{supplier.trim()} ainda não está cadastrado: será criado ao gravar.</p>}
            <div className="tabela-caixa resumo-caixa" tabIndex={0} role="region" aria-label="Itens da PO">
              <table className="tabela-resumo tabela-empilha">
                <thead>
                  <tr>
                    <th>Produto</th>
                    <th className="num">Quantidade</th>
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
                      </td>
                      <td className="num" data-rot="Quantidade">{formatQuantity(l.quantity)}</td>
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
            <button type="submit" className="btn primario" disabled={busy || existingItems > 0}>
              {busy ? 'Gravando…' : `Pôr ${doc.lines.length === 1 ? 'o item' : `os ${doc.lines.length} itens`} em produção`}
            </button>
          </div>
        </form>
      )}
    </Dialog>
  );
}

// ---------- Novo embarque ----------

export function ShipmentUploadDialog({
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
  onDone: (msg: string) => void;
}) {
  const ids = useId();
  const [doc, setDoc] = useState<InvoiceDocument | null>(null);
  const [file, setFile] = useState('');
  const [supplierId, setSupplierId] = useState('');
  const [number, setNumber] = useState('');
  const [ref, setRef] = useState('');
  const [bill, setBill] = useState('');
  const [eta, setEta] = useState('');
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
      const parsed = parseInvoiceDocument(await readFile(f), f.name);
      if ('error' in parsed) throw new Error(parsed.error);
      setDoc(parsed);
      setFile(f.name);
      setSupplierId(guessSupplier(parsed.lines, parsed.headerText, data.items, data.suppliers) ?? '');
      setNumber(parsed.number ?? '');
      setRef('');
      setBill('');
      setEta('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível ler o arquivo.');
    } finally {
      setReading(false);
    }
  }

  const openBills = useMemo(() => data.bills.filter((b) => !b.arrivedAt), [data.bills]);
  const knownBill = openBills.find((b) => b.number.toUpperCase() === bill.trim().toUpperCase());
  const allocation = useMemo(() => (doc && supplierId ? allocateShipment(doc.lines, data.items, data.orders, supplierId) : null), [doc, supplierId, data.items, data.orders]);
  const supplierName = data.suppliers.find((s) => s.id === supplierId)?.name ?? NO_SUPPLIER;
  const duplicate = data.invoices.find((v) => v.supplierId === supplierId && v.number.toUpperCase() === number.trim().toUpperCase());

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!doc) return;
    if (!supplierId) return setError('Escolha o fornecedor que mandou a invoice.');
    if (!number.trim()) return setError('Informe o número da invoice.');
    setBusy(true);
    setError(null);
    try {
      const res = await production.write(() =>
        api.receiveShipment({ supplierId, invoice: { number: number.trim(), ref: ref.trim(), bill: bill.trim() || null, eta: knownBill ? null : eta || null }, lines: doc.lines }),
      );
      onDone(
        `Invoice ${number.trim()} embarcada: ${formatQuantity(res.taken)} ex. saíram da produção${res.extra ? `; ${formatQuantity(res.extra)} ex. não estavam na produção e entraram para conferir` : ''}.`,
      );
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível gravar.');
      setBusy(false);
    }
  }

  return (
    <Dialog title="Novo embarque" open={open} onClose={onClose} wide>
      {!doc ? (
        <div className="dlg-corpo">
          <p className="dica-texto">
            Envie a invoice ou a packing list do fornecedor em .xlsx. O que ela traz sai da produção <b>do mesmo fornecedor</b>, a produção mais antiga primeiro, e vai para os
            embarques. Antes de gravar, você confere de qual PO sai cada item.
          </p>
          <FilePicker busy={reading} label="Escolher a invoice" onFile={(f) => void read(f)} />
          <FormError message={error} />
        </div>
      ) : (
        <form onSubmit={save} noValidate>
          <div className="dlg-corpo">
            <p className="dica-texto">
              <b>{file}</b>: {doc.lines.length} {doc.lines.length === 1 ? 'linha' : 'linhas'}, {formatQuantity(doc.lines.reduce((s, l) => s + l.quantity, 0))} ex.
              {data.seeValues && linesValue(doc.lines) > 0 && ` · ${formatUsd(linesValue(doc.lines))}`}
            </p>
            <fieldset className="grade-campos tres" disabled={busy}>
              <legend className="so-leitor">Dados do embarque</legend>
              <div className="grupo">
                <label className="rotulo" htmlFor={`${ids}-forn`}>
                  Fornecedor
                </label>
                <select id={`${ids}-forn`} className="campo" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
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
                <input id={`${ids}-num`} className="campo" value={number} onChange={(e) => setNumber(e.target.value)} />
              </div>
              <div className="grupo">
                <label className="rotulo" htmlFor={`${ids}-ref`}>
                  Ref. do embarque
                </label>
                <input id={`${ids}-ref`} className="campo" value={ref} onChange={(e) => setRef(e.target.value)} placeholder="Opcional" />
              </div>
              <div className="grupo">
                <label className="rotulo" htmlFor={`${ids}-bl`}>
                  BL
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
            </fieldset>
            {duplicate && (
              <p className="aviso alerta">
                <Icon name="alerta" />
                <span>
                  A invoice {duplicate.number} da {supplierName} já foi registrada.
                </span>
              </p>
            )}
            {!supplierId ? (
              <p className="dica">Não deu para saber o fornecedor pelo arquivo. Escolha acima para ver o que sai da produção.</p>
            ) : (
              allocation && <AllocationTable doc={doc} allocation={allocation} data={data} supplierName={supplierName} />
            )}
            <Notes notes={doc.warnings} />
            <FormError message={error} />
          </div>
          <div className="dlg-pe">
            <button type="button" className="btn" onClick={() => setDoc(null)} disabled={busy}>
              Outro arquivo
            </button>
            <button type="submit" className="btn primario" disabled={busy || !supplierId || Boolean(duplicate)}>
              {busy ? 'Gravando…' : 'Embarcar'}
            </button>
          </div>
        </form>
      )}
    </Dialog>
  );
}

function AllocationTable({ doc, allocation, data, supplierName }: { doc: InvoiceDocument; allocation: LineAllocation[]; data: ProductionData; supplierName: string }) {
  const items = useMemo(() => new Map(data.items.map((i) => [i.id, i])), [data.items]);
  const codes = useMemo(() => new Map(data.orders.map((o) => [o.id, o.code])), [data.orders]);
  const taken = allocation.reduce((s, a) => s + a.takes.reduce((t, k) => t + k.quantity, 0), 0);
  const extra = allocation.reduce((s, a) => s + a.extra, 0);
  const extraLines = allocation.filter((a) => a.extra > 0).length;
  return (
    <>
      <p className={`aviso ${extra ? 'alerta' : 'ok'}`}>
        <Icon name={extra ? 'alerta' : 'check'} />
        <span>
          {formatQuantity(taken)} ex. saem da produção da {supplierName}.
          {extra > 0 &&
            ` ${formatQuantity(extra)} ex. (${extraLines} ${extraLines === 1 ? 'linha' : 'linhas'}) não estão na produção da ${supplierName}: entram embarcados, sem PO, com uma observação para conferir.`}
        </span>
      </p>
      <div className="tabela-caixa resumo-caixa" tabIndex={0} role="region" aria-label="O que sai da produção">
        <table className="tabela-resumo tabela-alocacao tabela-empilha">
          <thead>
            <tr>
              <th>Produto</th>
              <th className="num">Na invoice</th>
              <th>Sai da produção</th>
            </tr>
          </thead>
          <tbody>
            {doc.lines.map((l, index) => {
              const a = allocation[index]!;
              return (
                <tr key={l.row}>
                  <td>
                    {l.description}
                    <span className="t-isbn">
                      {l.isbn ?? 'Sem ISBN'}
                      {l.orderCode && ` · a invoice cita a ${l.orderCode}`}
                    </span>
                  </td>
                  <td className="num" data-rot="Na invoice">{formatQuantity(l.quantity)}</td>
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
