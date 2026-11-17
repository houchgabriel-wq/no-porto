// Embarcar os itens marcados na Produção (SPEC.md, seção 3): numa invoice que já existe (do mesmo
// fornecedor e ainda a caminho) ou numa nova, com o BL e a chegada prevista. A quantidade de cada
// item pode ser menor que a em produção: o item se divide e o saldo continua em produção.

import { useEffect, useId, useMemo, useState, type FormEvent } from 'react';
import { type Item } from '../core/items';
import { formatQuantity } from '../core/money';
import { arrivalOf, arrivalState, formatDay, shipProblem } from '../core/shipments';
import { api, ApiError, type ProductionData } from './api';
import { Dialog, FormError } from './components';
import type { Production } from './production';

interface Props {
  items: Item[] | null;
  data: ProductionData;
  production: Production;
  onClose: () => void;
  onDone: (msg: string) => void;
}

function count(text: string): number | null {
  const t = text.replace(/\./g, '').trim();
  return /^\d+$/.test(t) ? Number(t) : null;
}

export function ShipDialog({ items, data, production, onClose, onDone }: Props) {
  const ids = useId();
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [mode, setMode] = useState<'nova' | 'existente'>('nova');
  const [invoiceId, setInvoiceId] = useState('');
  const [number, setNumber] = useState('');
  const [ref, setRef] = useState('');
  const [bill, setBill] = useState('');
  const [eta, setEta] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const supplierId = items?.[0]?.supplierId ?? null;
  const billsById = useMemo(() => new Map(data.bills.map((b) => [b.id, b])), [data.bills]);
  // Invoices do mesmo fornecedor que ainda não chegaram.
  const openInvoices = useMemo(
    () => data.invoices.filter((v) => v.supplierId === supplierId && !arrivalOf(v, billsById).arrivedAt),
    [data.invoices, supplierId, billsById],
  );
  const openBills = useMemo(() => data.bills.filter((b) => !b.arrivedAt), [data.bills]);
  const knownBill = openBills.find((b) => b.number.toUpperCase() === bill.trim().toUpperCase());

  useEffect(() => {
    if (!items) return;
    setQuantities(Object.fromEntries(items.map((i) => [i.id, String(i.quantity)])));
    setMode(openInvoices.length ? 'existente' : 'nova');
    setInvoiceId(openInvoices[0]?.id ?? '');
    setNumber('');
    setRef('');
    setBill('');
    setEta('');
    setError(null);
    setBusy(false);
    // Só ao abrir com outros itens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  if (!items) return <Dialog title="Embarcar" open={false} onClose={onClose} />;
  const supplier = data.suppliers.find((s) => s.id === supplierId)?.name ?? 'Sem fornecedor';

  async function submit(e: FormEvent) {
    e.preventDefault();
    const lines = items!.map((item) => ({ item, quantity: count(quantities[item.id] ?? '') ?? 0 }));
    const problem = shipProblem(lines, mode === 'existente' ? supplierId : null);
    if (problem) return setError(problem);
    if (mode === 'existente' && !invoiceId) return setError('Escolha a invoice.');
    if (mode === 'nova' && !number.trim()) return setError('Informe o número da invoice.');
    setBusy(true);
    setError(null);
    try {
      const body = {
        lines: lines.map((l) => ({ itemId: l.item.id, quantity: l.quantity })),
        ...(mode === 'existente'
          ? { invoiceId }
          : { newInvoice: { number: number.trim(), ref: ref.trim(), bill: bill.trim() || null, eta: knownBill ? null : eta || null } }),
      };
      await production.write(() => api.ship(body));
      const partial = lines.filter((l) => l.quantity < l.item.quantity).length;
      onDone(`${lines.length === 1 ? '1 item embarcado' : `${lines.length} itens embarcados`}${partial ? `; ${partial} em parte (o saldo continua em produção)` : ''}.`);
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível embarcar.');
      setBusy(false);
    }
  }

  return (
    <Dialog title={`Embarcar ${items.length === 1 ? '1 item' : `${items.length} itens`} · ${supplier}`} open onClose={onClose} wide>
      <form onSubmit={submit} noValidate>
        <div className="dlg-corpo">
          <fieldset className="embarque-modo" disabled={busy}>
            <legend className="rotulo">Invoice</legend>
            <div className="dlg-abas sem-margem" role="group" aria-label="Invoice">
              <button type="button" className="aba" aria-pressed={mode === 'existente'} disabled={!openInvoices.length} onClick={() => setMode('existente')}>
                Invoice a caminho
              </button>
              <button type="button" className="aba" aria-pressed={mode === 'nova'} onClick={() => setMode('nova')}>
                Nova invoice
              </button>
            </div>
            {mode === 'existente' ? (
              <div className="grupo">
                <label className="rotulo" htmlFor={`${ids}-inv`}>
                  Invoice de {supplier}
                </label>
                <select id={`${ids}-inv`} className="campo" value={invoiceId} onChange={(e) => setInvoiceId(e.target.value)}>
                  {openInvoices.map((v) => {
                    const a = arrivalOf(v, billsById);
                    const b = v.billId ? billsById.get(v.billId) : undefined;
                    return (
                      <option key={v.id} value={v.id}>
                        {v.number}
                        {v.ref && ` (${v.ref})`}
                        {b ? ` · BL ${b.number}` : ' · sem BL'}
                        {a.eta ? ` · chega ${formatDay(a.eta)}` : ''}
                      </option>
                    );
                  })}
                </select>
              </div>
            ) : (
              <div className="grade-campos">
                <div className="grupo">
                  <label className="rotulo" htmlFor={`${ids}-num`}>
                    Número da invoice
                  </label>
                  <input id={`${ids}-num`} className="campo" value={number} onChange={(e) => setNumber(e.target.value)} autoFocus />
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
              </div>
            )}
          </fieldset>

          <div className="tabela-caixa resumo-caixa" tabIndex={0} role="region" aria-label="Itens a embarcar">
            <table className="tabela-embarcar">
              <thead>
                <tr>
                  <th>Produto</th>
                  <th className="num">Em produção</th>
                  <th className="num">Embarcar</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => {
                  const q = count(quantities[item.id] ?? '');
                  const partial = q !== null && q > 0 && q < item.quantity;
                  return (
                    <tr key={item.id}>
                      <td>
                        {item.description}
                        {partial && <span className="t-isbn">Fica {formatQuantity(item.quantity - q)} em produção</span>}
                      </td>
                      <td className="num">{formatQuantity(item.quantity)}</td>
                      <td className="num">
                        <label className="so-leitor" htmlFor={`${ids}-q-${item.id}`}>
                          Quantidade a embarcar de {item.description}
                        </label>
                        <input
                          id={`${ids}-q-${item.id}`}
                          className="campo num campo-qtd"
                          inputMode="numeric"
                          value={quantities[item.id] ?? ''}
                          onChange={(e) => setQuantities((qs) => ({ ...qs, [item.id]: e.target.value }))}
                          disabled={busy}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {mode === 'existente' && invoiceId && (() => {
            const v = data.invoices.find((x) => x.id === invoiceId);
            const a = v ? arrivalOf(v, billsById) : null;
            const state = a ? arrivalState(a.eta, a.arrivedAt, data.today) : null;
            return state?.kind === 'liberacao' ? <p className="dica">A previsão de chegada desta invoice já passou (em liberação).</p> : null;
          })()}
          <FormError message={error} />
        </div>
        <div className="dlg-pe">
          <button type="button" className="btn" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" className="btn primario" disabled={busy}>
            {busy ? 'Embarcando…' : 'Embarcar'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
