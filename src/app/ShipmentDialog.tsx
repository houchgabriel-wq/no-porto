// Ficha do embarque: o BL (ou a invoice sem BL) com a chegada prevista e a real, as invoices com os
// itens e os pagamentos de cada uma (data, valor em dólar e câmbio). O leitor só acompanha.

import { useEffect, useId, useState, type FormEvent } from 'react';
import { NO_SUPPLIER, type Item } from '../core/items';
import { formatQuantity, formatUsd, parseCents, parseExchangeRate } from '../core/money';
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
  type Invoice,
  type Payment,
} from '../core/shipments';
import { api, ApiError, type Me, type ProductionData } from './api';
import { Dialog, FormError } from './components';
import { Icon } from './icons';
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

const reais = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

function message(e: unknown, fallback: string) {
  return e instanceof ApiError ? e.message : fallback;
}

export function ShipmentDialog({ unitKey, me, data, production, onClose, onToast, onOpenItem }: Props) {
  const unit = unitKey ? shipmentUnits(data.bills, data.invoices, data.today).find((u) => u.key === unitKey) : undefined;
  const canEdit = can(me.role, 'edit');
  const ids = useId();
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
          {state.kind === 'atrasado' && <Icon name="alerta" />}
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
        <FormError message={error} />
      </div>

      {unit.invoices.map((v) => (
        <InvoiceSection key={v.id} invoice={v} me={me} data={data} production={production} onToast={onToast} onOpenItem={onOpenItem} arrived={Boolean(unit.arrivedAt)} />
      ))}
      <div className="dlg-pe">
        <button type="button" className="btn" onClick={onClose}>
          Fechar
        </button>
      </div>
    </Dialog>
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
}: {
  invoice: Invoice;
  me: Me;
  data: ProductionData;
  production: Production;
  onToast: (msg: string) => void;
  onOpenItem: (item: Item) => void;
  arrived: boolean;
}) {
  const canEdit = can(me.role, 'edit');
  const canDelete = can(me.role, 'delete');
  const items = data.items.filter((i) => i.invoiceId === invoice.id);
  const payments = data.payments.filter((p) => p.invoiceId === invoice.id);
  const total = invoiceTotal(items);
  const pay = data.seeValues ? paymentSummary(total, payments) : null;
  const supplier = data.suppliers.find((s) => s.id === invoice.supplierId)?.name ?? NO_SUPPLIER;
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
        <span className="mudo">{supplier}</span>
        {pay && <span className={`pilula pag ${pay.status}`}>{PAYMENT_LABELS[pay.status]}</span>}
        {canEdit && !editing && (
          <button type="button" className="btn-texto" onClick={() => setEditing(true)}>
            Alterar
          </button>
        )}
      </div>
      {editing && <InvoiceForm invoice={invoice} data={data} onCancel={() => setEditing(false)} onSave={async (body) => (await act(() => api.updateInvoice(invoice.id, body), 'Invoice salva.')) && setEditing(false)} />}

      <ul className="emb-itens">
        {items.map((item) => (
          <li key={item.id}>
            <button type="button" className="abrir-item" onClick={() => onOpenItem(item)}>
              {item.description}
            </button>
            <span className="num mudo">{formatQuantity(item.quantity)} ex.</span>
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
    const cents = parseCents(amount);
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
