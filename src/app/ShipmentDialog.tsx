// Ficha do embarque: o BL (ou a invoice sem BL) com a chegada prevista e a real, as invoices com os
// itens e os pagamentos de cada uma (data, valor em dólar e câmbio). O leitor só acompanha.

import { useEffect, useId, useState, type FormEvent } from 'react';
import { cartonsOf, formatWeight, matchUnits, unitSummary, type BillUnit } from '../core/billUnits';
import { NO_SUPPLIER, type Item } from '../core/items';
import { formatQuantity, formatUsd, parseExchangeRate, parseMoneyCents } from '../core/money';
import { can } from '../core/roles';
import {
  arrivalState,
  arrivalText,
  formatDay,
  invoiceTotal,
  PAYMENT_LABELS,
  paymentSummary,
  shipmentUnits,
  spDate,
  type Bill,
  type Invoice,
  type Payment,
} from '../core/shipments';
import { api, ApiError, type Me, type ProductionData } from './api';
import { Dialog, FormError } from './components';
import { Icon } from './icons';
import { billUnitsFromPdf } from './pdfText';
import type { Production } from './production';

interface Props {
  unitKey: string | null;
  me: Me;
  data: ProductionData;
  production: Production;
  onClose: () => void;
  onToast: (msg: string) => void;
  onOpenItem: (item: Item) => void;
}

/** "a, b e c". */
function listPt(parts: string[]): string {
  return parts.length <= 1 ? (parts[0] ?? '') : `${parts.slice(0, -1).join(', ')} e ${parts.at(-1)}`;
}

const reais = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

function message(e: unknown, fallback: string) {
  return e instanceof ApiError ? e.message : fallback;
}

export function ShipmentDialog({ unitKey, me, data, production, onClose, onToast, onOpenItem }: Props) {
  const unit = unitKey ? shipmentUnits(data.bills, data.invoices, data.today).find((u) => u.key === unitKey) : undefined;
  const canEdit = can(me.role, 'edit');
  const canDelete = can(me.role, 'delete');
  const ids = useId();
  const [confirming, setConfirming] = useState(false);
  const [number, setNumber] = useState('');
  const [eta, setEta] = useState('');
  const [arrivedAt, setArrivedAt] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // A chegada que se edita é a do BL; sem BL, a da própria invoice.
  const target = unit?.bill ?? unit?.invoices[0] ?? null;
  useEffect(() => {
    setNumber(unit?.bill?.number ?? '');
    setEta(target?.eta ?? '');
    setArrivedAt(target?.arrivedAt ?? '');
    setError(null);
    setBusy(false);
    setConfirming(false);
    // Ao abrir outro embarque, ou quando os dados salvos mudam.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unitKey, target?.eta, target?.arrivedAt, unit?.bill?.number]);

  if (!unit || !target) return <Dialog title="Embarque" open={false} onClose={onClose} />;
  const state = arrivalState(unit.eta, unit.arrivedAt, data.today);

  async function run(action: () => Promise<unknown>, done: string) {
    setBusy(true);
    setError(null);
    try {
      await production.write(action);
      onToast(done);
    } catch (e) {
      setError(message(e, 'Não foi possível salvar.'));
    } finally {
      setBusy(false);
    }
  }

  async function removeUnit() {
    setBusy(true);
    setError(null);
    try {
      await production.write<unknown>(() => (unit!.bill ? api.deleteBill(unit!.bill.id) : api.deleteInvoice(unit!.invoices[0]!.id)));
      onToast('Embarque excluído. O que tinha saído da produção voltou para ela.');
      onClose();
    } catch (e) {
      setError(message(e, 'Não foi possível excluir.'));
      setBusy(false);
      setConfirming(false);
    }
  }

  function saveArrival(e: FormEvent, arrived = arrivedAt) {
    e.preventDefault();
    const body = { eta: eta || null, arrivedAt: arrived || null, ...(unit!.bill && number.trim() !== unit!.bill.number ? { number: number.trim() } : {}) };
    void run(
      () => (unit!.bill ? api.updateBill(unit!.bill.id, body) : api.updateInvoice(target!.id, body)),
      arrived && !target!.arrivedAt ? 'Chegada registrada. Os itens foram para entregue.' : 'Embarque salvo.',
    );
  }

  const title = unit.bill ? `BL ${unit.bill.number}` : `Invoice ${unit.invoices[0]!.number}`;

  return (
    <Dialog title={title} open onClose={onClose} wide className="dlg-embarque">
      <div className="dlg-corpo">
        <p className={`pilula chegada ${state.kind} alinha-inicio`}>
          {state.kind === 'liberacao' && <Icon name="alerta" />}
          {arrivalText(state)}
        </p>
        <form className="emb-chegada" onSubmit={(e) => saveArrival(e)}>
          <fieldset disabled={!canEdit || busy} className="grade-campos">
            <legend className="so-leitor">Chegada</legend>
            {unit.bill && (
              <div className="grupo">
                <label className="rotulo" htmlFor={`${ids}-bl`}>
                  Número do BL
                </label>
                <input id={`${ids}-bl`} className="campo" value={number} onChange={(e) => setNumber(e.target.value)} />
              </div>
            )}
            <div className="grupo">
              <label className="rotulo" htmlFor={`${ids}-eta`}>
                Chegada prevista
              </label>
              <input id={`${ids}-eta`} className="campo" type="date" value={eta} onChange={(e) => setEta(e.target.value)} />
            </div>
            <div className="grupo">
              <label className="rotulo" htmlFor={`${ids}-arr`}>
                Chegou em
              </label>
              <input id={`${ids}-arr`} className="campo" type="date" value={arrivedAt} onChange={(e) => setArrivedAt(e.target.value)} />
            </div>
          </fieldset>
          {canEdit && (
            <div className="emb-chegada-acoes">
              {!target.arrivedAt && (
                <button
                  type="button"
                  className="btn"
                  disabled={busy}
                  onClick={(e) => {
                    const today = spDate(new Date());
                    setArrivedAt(today);
                    saveArrival(e, today);
                  }}
                >
                  <Icon name="check" />
                  Chegou hoje
                </button>
              )}
              <button type="submit" className="btn primario" disabled={busy}>
                Salvar
              </button>
            </div>
          )}
        </form>
        {unit.bill && <BillFile bill={unit.bill} canEdit={canEdit} canDownload={data.seeValues} busy={busy} run={run} onError={setError} />}
        {unit.bill && canEdit && unit.bill.document && /\.pdf$/i.test(unit.bill.document.name) && (
          <BillUnits key={unit.bill.id} billId={unit.bill.id} invoices={unit.invoices} data={data} busy={busy} run={run} />
        )}
        <FormError message={error} />
      </div>

      {unit.invoices.map((v) => (
        <InvoiceSection
          key={v.id}
          invoice={v}
          me={me}
          data={data}
          production={production}
          onToast={onToast}
          onOpenItem={onOpenItem}
          arrived={Boolean(unit.arrivedAt)}
          lastOfBill={Boolean(unit.bill) && unit.invoices.length === 1}
        />
      ))}
      {confirming && (
        <div className="dlg-corpo confirma-corpo">
          <ConfirmDelete
            title={unit.bill ? `Excluir o BL ${unit.bill.number} e ${unit.invoices.length === 1 ? 'a invoice' : `as ${unit.invoices.length} invoices`}?` : `Excluir a invoice ${unit.invoices[0]!.number}?`}
            text={`O que saiu da produção volta para a produção. ${listPt(['O que não estava na produção', ...(data.seeValues ? ['os pagamentos'] : []), ...(unit.bill?.document ? ['o arquivo do BL'] : [])])} são apagados.`}
            busy={busy}
            onCancel={() => setConfirming(false)}
            onConfirm={() => void removeUnit()}
          />
        </div>
      )}
      <div className="dlg-pe">
        {canDelete && !unit.arrivedAt && !confirming && (
          <button type="button" className="btn perigo alinha-esquerda" onClick={() => setConfirming(true)} disabled={busy}>
            <Icon name="lixeira" />
            Excluir embarque
          </button>
        )}
        <button type="button" className="btn" onClick={onClose}>
          Fechar
        </button>
      </div>
    </Dialog>
  );
}

/**
 * As unidades do BL, lidas do PDF anexado (25/11/2026): para os embarques já cadastrados. Cada invoice
 * fica com a unidade do mesmo container ou, sem o número, com a de mesmas caixas (pelas peças por caixa
 * dos itens); a pessoa confere e grava.
 */
function BillUnits({
  billId,
  invoices,
  data,
  busy,
  run,
}: {
  billId: string;
  invoices: Invoice[];
  data: ProductionData;
  busy: boolean;
  run: (action: () => Promise<unknown>, done: string) => Promise<void>;
}) {
  const ids = useId();
  const [units, setUnits] = useState<BillUnit[] | null>(null);
  const [choice, setChoice] = useState<Record<string, string>>({});
  const [reading, setReading] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  async function read() {
    setReading(true);
    setNote(null);
    try {
      const res = await fetch(`/api/bills/${encodeURIComponent(billId)}/document`, { credentials: 'same-origin' });
      if (!res.ok) throw new Error();
      const found = await billUnitsFromPdf(await res.arrayBuffer());
      if (found.length === 0) {
        setNote('Não achei as unidades (container, lacre, caixas e peso) no PDF do BL.');
        return;
      }
      const matches = matchUnits(
        invoices.map((v) => ({
          key: v.id,
          container: v.unit?.container ?? null,
          cartons: v.unit?.cartons ?? cartonsOf(data.items.filter((i) => i.invoiceId === v.id)),
          weightGrams: v.unit?.weightGrams ?? null,
        })),
        found,
      );
      setChoice(Object.fromEntries(invoices.map((v) => [v.id, matches.get(v.id)?.unit.container ?? ''])));
      setUnits(found);
    } catch {
      setNote('Não foi possível ler o PDF do BL.');
    } finally {
      setReading(false);
    }
  }

  function save() {
    const picked = Object.values(choice).filter(Boolean);
    if (new Set(picked).size !== picked.length) return setNote('A mesma unidade está em duas invoices. Confira.');
    void run(async () => {
      await api.saveBillUnits(
        billId,
        invoices.map((v) => ({ invoiceId: v.id, unit: units!.find((u) => u.container === choice[v.id]) ?? null })),
      );
      setUnits(null);
    }, 'Unidades gravadas.');
  }

  if (!units) {
    return (
      <div className="bl-unidades">
        <button type="button" className="btn" onClick={() => void read()} disabled={reading || busy}>
          <Icon name="container" />
          {reading ? 'Lendo o BL…' : invoices.some((v) => v.unit) ? 'Ler as unidades do BL de novo' : 'Ler as unidades do BL'}
        </button>
        {note && (
          <p className="aviso alerta">
            <Icon name="alerta" />
            <span>{note}</span>
          </p>
        )}
      </div>
    );
  }
  return (
    <section className="bl-unidades bloco-leve" aria-labelledby={`${ids}-t`}>
      <h3 id={`${ids}-t`}>Unidades do BL</h3>
      <p className="dica">
        {units.length === 1 ? '1 unidade' : `${units.length} unidades`} no BL. Confira de qual invoice é cada uma (as que deu para ligar já vêm escolhidas, pelo número do
        container ou pelas caixas) e grave.
      </p>
      <ul className="bl-unidades-lista">
        {invoices.map((v) => {
          const taken = new Set(invoices.filter((o) => o.id !== v.id).map((o) => choice[o.id]).filter(Boolean));
          const chosen = units.find((u) => u.container === choice[v.id]);
          return (
            <li key={v.id}>
              <label className="rotulo" htmlFor={`${ids}-${v.id}`}>
                Invoice {v.number}
              </label>
              <select id={`${ids}-${v.id}`} className="campo" value={choice[v.id] ?? ''} onChange={(e) => setChoice((m) => ({ ...m, [v.id]: e.target.value }))}>
                <option value="">Nenhuma</option>
                {units.map((u) => (
                  <option key={u.container} value={u.container} disabled={taken.has(u.container)}>
                    {u.container}
                    {u.cartons !== null ? ` · ${u.cartons.toLocaleString('pt-BR')} caixas` : ''}
                    {u.weightGrams !== null ? ` · ${formatWeight(u.weightGrams)}` : ''}
                  </option>
                ))}
              </select>
              {chosen && <span className="dica">{unitSummary(chosen)}</span>}
            </li>
          );
        })}
      </ul>
      {note && (
        <p className="aviso alerta">
          <Icon name="alerta" />
          <span>{note}</span>
        </p>
      )}
      <div className="bl-unidades-acoes">
        <button type="button" className="btn" onClick={() => setUnits(null)} disabled={busy}>
          Cancelar
        </button>
        <button type="button" className="btn primario" onClick={save} disabled={busy}>
          Gravar as unidades
        </button>
      </div>
    </section>
  );
}

function InvoiceSection({
  invoice,
  me,
  data,
  production,
  onToast,
  onOpenItem,
  arrived,
  lastOfBill,
}: {
  invoice: Invoice;
  me: Me;
  data: ProductionData;
  production: Production;
  onToast: (msg: string) => void;
  onOpenItem: (item: Item) => void;
  arrived: boolean;
  /** Única invoice do BL: excluí-la leva o BL junto. */
  lastOfBill: boolean;
}) {
  const canEdit = can(me.role, 'edit');
  const canDelete = can(me.role, 'delete');
  const items = data.items.filter((i) => i.invoiceId === invoice.id);
  const payments = data.payments.filter((p) => p.invoiceId === invoice.id);
  const total = invoiceTotal(items);
  const pay = data.seeValues ? paymentSummary(total, payments) : null;
  const supplier = data.suppliers.find((s) => s.id === invoice.supplierId)?.name ?? NO_SUPPLIER;
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const invoiceArrived = arrived || Boolean(invoice.arrivedAt);

  async function act(action: () => Promise<unknown>, done: string) {
    setError(null);
    try {
      await production.write(action);
      onToast(done);
      return true;
    } catch (e) {
      setError(message(e, 'Não foi possível salvar.'));
      return false;
    }
  }

  return (
    <section className="emb-invoice" aria-label={`Invoice ${invoice.number}`}>
      <div className="emb-invoice-topo">
        <h3>
          Invoice {invoice.number}
          {invoice.ref && invoice.ref !== invoice.number && <span className="mudo"> · ref. {invoice.ref}</span>}
        </h3>
        {data.seeSuppliers && <span className="mudo">{supplier}</span>}
        {pay && <span className={`pilula pag ${pay.status}`}>{PAYMENT_LABELS[pay.status]}</span>}
        {canEdit && !editing && (
          <button type="button" className="btn-texto" onClick={() => setEditing(true)}>
            Alterar
          </button>
        )}
        {canDelete && !invoiceArrived && !confirming && (
          <button type="button" className="btn-texto perigo" onClick={() => setConfirming(true)}>
            Excluir
            <span className="so-leitor"> a invoice {invoice.number}</span>
          </button>
        )}
      </div>
      {confirming && (
        <ConfirmDelete
          title={`Excluir a invoice ${invoice.number}?`}
          text={`O que saiu da produção volta para a produção. O que não estava na produção${pay ? ' e os pagamentos desta invoice' : ''} são apagados.${lastOfBill ? ' É a única invoice do BL: o BL sai junto.' : ''}`}
          busy={false}
          onCancel={() => setConfirming(false)}
          onConfirm={() => void act(() => api.deleteInvoice(invoice.id), 'Invoice excluída. O que tinha saído da produção voltou para ela.').then(() => setConfirming(false))}
        />
      )}
      {editing && <InvoiceForm invoice={invoice} data={data} onCancel={() => setEditing(false)} onSave={async (body) => (await act(() => api.updateInvoice(invoice.id, body), 'Invoice salva.')) && setEditing(false)} />}
      {invoice.unit && (
        <p className="emb-unidade">
          <Icon name="container" />
          <span>
            Unidade <b>{invoice.unit.container}</b>
            {unitSummary(invoice.unit).slice(invoice.unit.container.length)}
          </span>
        </p>
      )}

      <ul className="emb-itens">
        {items.map((item) => (
          <li key={item.id}>
            <button type="button" className="abrir-item" onClick={() => onOpenItem(item)}>
              {item.description}
            </button>
            <span className="num mudo">
              {formatQuantity(item.quantity)} ex.{item.piecesPerCarton ? ` · ${formatQuantity(item.piecesPerCarton)} por caixa` : ''}
            </span>
            {data.seeValues && <span className="num">{item.totalCents == null ? 'Sem preço' : formatUsd(item.totalCents)}</span>}
            {canEdit && !arrived && (
              <button type="button" className="btn-texto" onClick={() => void act(() => api.unship(item.id), 'O item voltou para a produção.')}>
                Voltar para produção
              </button>
            )}
          </li>
        ))}
        {items.length === 0 && <li className="mudo">Nenhum item nesta invoice.</li>}
      </ul>

      {pay && (
        <div className="emb-pagamentos">
          <div className="emb-pag-resumo">
            <span>
              Total <b>{formatUsd(total)}</b>
            </span>
            <span>
              Pago <b>{pay.status === 'pago' && pay.paidCents === 0 ? 'quitado' : formatUsd(pay.paidCents)}</b>
            </span>
            {pay.dueCents > 0 && (
              <span className="falta">
                Falta <b>{formatUsd(pay.dueCents)}</b>
              </span>
            )}
            {pay.paidReaisCents > 0 && <span className="mudo">{reais.format(pay.paidReaisCents / 100)} pagos em reais</span>}
          </div>
          {payments.length > 0 && (
            <ul className="emb-pag-lista">
              {payments.map((p) => (
                <PaymentRow key={p.id} payment={p} canDelete={canDelete} onDelete={() => void act(() => api.deletePayment(p.id), 'Pagamento excluído.')} />
              ))}
            </ul>
          )}
          {canEdit && pay.status !== 'pago' && <PaymentForm due={pay.dueCents} onSave={(body) => act(() => api.addPayment(invoice.id, body), 'Pagamento registrado.')} />}
        </div>
      )}
      <FormError message={error} />
    </section>
  );
}

function PaymentRow({ payment: p, canDelete, onDelete }: { payment: Payment; canDelete: boolean; onDelete: () => void }) {
  const [confirm, setConfirm] = useState(false);
  return (
    <li>
      <span>{p.paidAt ? formatDay(p.paidAt, true) : 'Sem data'}</span>
      <b>{p.amountCents === null ? 'Pago (planilha)' : formatUsd(p.amountCents)}</b>
      {p.exchangeRateE4 !== null && <span className="mudo">câmbio {(p.exchangeRateE4 / 10_000).toLocaleString('pt-BR', { minimumFractionDigits: 4 })}</span>}
      {p.notes && <span className="mudo">{p.notes}</span>}
      {canDelete &&
        (confirm ? (
          <span className="pag-confirma">
            <button type="button" className="btn-texto perigo" onClick={onDelete}>
              Excluir
            </button>
            <button type="button" className="btn-texto" onClick={() => setConfirm(false)}>
              Não
            </button>
          </span>
        ) : (
          <button type="button" className="btn-texto" onClick={() => setConfirm(true)} aria-label="Excluir pagamento">
            <Icon name="lixeira" />
          </button>
        ))}
    </li>
  );
}

function PaymentForm({ due, onSave }: { due: number; onSave: (body: { paidAt: string | null; amountCents: number; exchangeRateE4: number | null; notes: string }) => Promise<boolean> }) {
  const ids = useId();
  const [paidAt, setPaidAt] = useState(() => spDate(new Date()));
  const [amount, setAmount] = useState('');
  const [rate, setRate] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const cents = parseMoneyCents(amount);
    if (!cents) return setError('Informe o valor pago em dólar, como 1.234,56.');
    const r = rate.trim() ? parseExchangeRate(rate) : null;
    if (rate.trim() && r === null) return setError('Câmbio inválido. Use até quatro casas, como 5,4321.');
    setBusy(true);
    setError(null);
    if (await onSave({ paidAt: paidAt || null, amountCents: cents, exchangeRateE4: r, notes })) {
      setAmount('');
      setRate('');
      setNotes('');
    }
    setBusy(false);
  }

  return (
    <form className="emb-pag-form" onSubmit={submit} noValidate>
      <fieldset className="grade-campos quatro" disabled={busy}>
        <legend className="rotulo">Registrar pagamento</legend>
        <div className="grupo">
          <label className="rotulo" htmlFor={`${ids}-d`}>
            Data
          </label>
          <input id={`${ids}-d`} className="campo" type="date" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} />
        </div>
        <div className="grupo">
          <label className="rotulo" htmlFor={`${ids}-v`}>
            Valor (US$)
          </label>
          <input id={`${ids}-v`} className="campo num" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={due ? formatUsd(due).replace('US$ ', '') : ''} />
        </div>
        <div className="grupo">
          <label className="rotulo" htmlFor={`${ids}-c`}>
            Câmbio (R$ por US$)
          </label>
          <input id={`${ids}-c`} className="campo num" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="5,4321" />
        </div>
        <div className="grupo">
          <label className="rotulo" htmlFor={`${ids}-o`}>
            Observação
          </label>
          <input id={`${ids}-o`} className="campo" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
      </fieldset>
      <div className="emb-pag-acoes">
        <FormError message={error} />
        <button type="submit" className="btn" disabled={busy}>
          {busy ? 'Registrando…' : 'Registrar pagamento'}
        </button>
      </div>
    </form>
  );
}

function InvoiceForm({
  invoice,
  data,
  onCancel,
  onSave,
}: {
  invoice: Invoice;
  data: ProductionData;
  onCancel: () => void;
  onSave: (body: { number: string; ref: string; bill: string | null }) => void;
}) {
  const ids = useId();
  const [number, setNumber] = useState(invoice.number);
  const [ref, setRef] = useState(invoice.ref);
  const [bill, setBill] = useState(data.bills.find((b) => b.id === invoice.billId)?.number ?? '');
  return (
    <form
      className="emb-inv-form"
      onSubmit={(e) => {
        e.preventDefault();
        onSave({ number: number.trim(), ref: ref.trim(), bill: bill.trim() || null });
      }}
    >
      <div className="grade-campos">
        <div className="grupo">
          <label className="rotulo" htmlFor={`${ids}-n`}>
            Número
          </label>
          <input id={`${ids}-n`} className="campo" value={number} onChange={(e) => setNumber(e.target.value)} />
        </div>
        <div className="grupo">
          <label className="rotulo" htmlFor={`${ids}-r`}>
            Ref. do embarque
          </label>
          <input id={`${ids}-r`} className="campo" value={ref} onChange={(e) => setRef(e.target.value)} />
        </div>
        <div className="grupo">
          <label className="rotulo" htmlFor={`${ids}-b`}>
            BL
          </label>
          <input id={`${ids}-b`} className="campo" list={`${ids}-bls`} value={bill} onChange={(e) => setBill(e.target.value)} placeholder="Sem BL" />
          <datalist id={`${ids}-bls`}>
            {data.bills
              .filter((b) => !b.arrivedAt)
              .map((b) => (
                <option key={b.id} value={b.number} />
              ))}
          </datalist>
        </div>
      </div>
      <div className="emb-chegada-acoes">
        <button type="button" className="btn" onClick={onCancel}>
          Cancelar
        </button>
        <button type="submit" className="btn primario">
          Salvar invoice
        </button>
      </div>
    </form>
  );
}

const BL_TYPES = ['application/pdf', 'image/png', 'image/jpeg'];

/** Arquivo do BL: baixar (quem vê valores), anexar, trocar ou tirar (editor e admin). */
function BillFile({
  bill,
  canEdit,
  canDownload,
  busy,
  run,
  onError,
}: {
  bill: Bill;
  canEdit: boolean;
  canDownload: boolean;
  busy: boolean;
  run: (action: () => Promise<unknown>, done: string) => Promise<void>;
  onError: (msg: string | null) => void;
}) {
  const doc = bill.document ?? null;
  if (!doc && !canEdit) return null;

  function attach(f: File | undefined) {
    if (!f) return;
    if (!BL_TYPES.includes(f.type)) return onError('Envie o BL em PDF, PNG ou JPG.');
    if (f.size > 5_000_000) return onError('O arquivo do BL pode ter no máximo 5 MB.');
    void run(async () => {
      const data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ''));
        reader.onerror = () => reject(new Error('Não foi possível ler o arquivo.'));
        reader.readAsDataURL(f);
      });
      await api.putBillDocument(bill.id, { name: f.name, contentType: f.type, data });
    }, doc ? 'Arquivo do BL trocado.' : 'Arquivo do BL anexado.');
  }

  return (
    <div className="bl-arquivo">
      <span className="rotulo">Arquivo do BL</span>
      {doc ? (
        <span className="arquivo-nome">
          <Icon name="arquivo" />
          {canDownload ? (
            <a href={`/api/bills/${encodeURIComponent(bill.id)}/document`} download={doc.name}>
              {doc.name}
            </a>
          ) : (
            doc.name
          )}
          <span className="mudo">{Math.max(1, Math.round(doc.size / 1024))} KB</span>
        </span>
      ) : (
        <span className="mudo">Nenhum arquivo anexado.</span>
      )}
      {canEdit && (
        <>
          <label className="btn-texto arquivo">
            {doc ? 'Trocar' : 'Anexar'}
            <span className="so-leitor"> o arquivo do BL</span>
            <input
              type="file"
              accept={BL_TYPES.join(',')}
              disabled={busy}
              onChange={(e) => {
                attach(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
          </label>
          {doc && (
            <button type="button" className="btn-texto" disabled={busy} onClick={() => void run(() => api.deleteBillDocument(bill.id), 'Arquivo do BL tirado.')}>
              Tirar
            </button>
          )}
        </>
      )}
    </div>
  );
}

/** Confirmação de exclusão, dentro da ficha, com o que vai acontecer. */
function ConfirmDelete({ title, text, busy, onCancel, onConfirm }: { title: string; text: string; busy: boolean; onCancel: () => void; onConfirm: () => void }) {
  return (
    <div className="confirma-exclusao" role="alertdialog" aria-label={title}>
      <p>
        <b>{title}</b> {text}
      </p>
      <div className="confirma-acoes">
        <button type="button" className="btn" onClick={onCancel} disabled={busy} autoFocus>
          Cancelar
        </button>
        <button type="button" className="btn perigo" onClick={onConfirm} disabled={busy}>
          <Icon name="lixeira" />
          {busy ? 'Excluindo…' : 'Excluir'}
        </button>
      </div>
    </div>
  );
}
