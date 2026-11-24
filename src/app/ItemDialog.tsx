// Ficha do item: cadastrar, alterar, ver (leitor, sem preço) e excluir (admin). Fornecedor e PO são
// digitados, com sugestão dos que já existem; os novos são criados ao salvar.

import { useEffect, useId, useMemo, useState, type FormEvent } from 'react';
import { isbnProblem } from '../core/isbn';
import { NO_PRELO } from '../core/noPrelo';
import { NO_ORDER, NO_SUPPLIER, normalizeOrderCode, orderOwners, STATUS_LABELS, type Item } from '../core/items';
import { addMonths, formatMonth, MAX_PARCELS, monthOptions, parcelPassed, plannedTotal, shipPlanProblem, type ShipPlan } from '../core/shipPlan';
import { formatQuantity, formatUsd, itemTotalCents, parseUnitPrice, unitPriceInput } from '../core/money';
import { arrivalOf, arrivalState, arrivalText, parseDate } from '../core/shipments';
import { can } from '../core/roles';
import { isReprintSpecification } from '../core/specification';
import { api, ApiError, type ItemInput, type Me, type ProductionData } from './api';
import { Dialog, FormError } from './components';
import { Icon } from './icons';
import type { Production } from './production';

export type ItemDialogState = { mode: 'new' } | { mode: 'edit'; item: Item } | null;

interface Props {
  state: ItemDialogState;
  me: Me;
  data: ProductionData;
  production: Production;
  onClose: () => void;
  onToast: (msg: string) => void;
  /** Abre a ficha do produto, com todas as compras. */
  onProduct?: (productId: string) => void;
}

interface Draft {
  description: string;
  isbn: string;
  supplier: string;
  orderCode: string;
  quantity: string;
  piecesPerCarton: string;
  unitPrice: string;
  notes: string;
  specification: string;
  /** Datas no formato do campo de data (AAAA-MM-DD), ou vazias. */
  fileApprovedAt: string;
}

/** Um embarque da programação de envio, como está no formulário. */
interface PlanRow {
  key: number;
  month: string;
  quantity: string;
}

let planKey = 1;
function rowsFrom(item: Item | null): PlanRow[] {
  return (item?.shipPlan ?? []).map((p) => ({ key: planKey++, month: p.month, quantity: String(p.quantity) }));
}

function draftFrom(item: Item | null, data: ProductionData): Draft {
  if (!item) return { description: '', isbn: '', supplier: '', orderCode: '', quantity: '', piecesPerCarton: '', unitPrice: '', notes: '', specification: '', fileApprovedAt: '' };
  return {
    description: item.description,
    isbn: item.isbn ?? '',
    supplier: data.suppliers.find((s) => s.id === item.supplierId)?.name ?? '',
    orderCode: data.orders.find((o) => o.id === item.purchaseOrderId)?.code ?? '',
    quantity: String(item.quantity),
    piecesPerCarton: item.piecesPerCarton === null ? '' : String(item.piecesPerCarton),
    unitPrice: unitPriceInput(item.unitPriceMicros ?? null),
    notes: item.notes,
    // Carregada ao abrir a ficha (as listas não trazem esse texto).
    specification: '',
    fileApprovedAt: item.fileApprovedAt ?? '',
  };
}

function count(text: string): number | null {
  const t = text.replace(/\./g, '').trim();
  return /^\d+$/.test(t) && Number(t) > 0 ? Number(t) : null;
}

/** Confere o formulário. Devolve os campos prontos ou a mensagem do primeiro problema. */
function validate(d: Draft, seeValues: boolean, rows: readonly PlanRow[]): { input: ItemInput } | { error: string; field: string } {
  if (!d.description.trim()) return { error: 'Informe o produto.', field: 'description' };
  const isbn = isbnProblem(d.isbn);
  if (isbn) return { error: isbn, field: 'isbn' };
  if (d.orderCode.trim() && !normalizeOrderCode(d.orderCode)) return { error: 'Código de PO inválido. Use o formato PO-063.', field: 'orderCode' };
  const quantity = count(d.quantity);
  if (quantity === null) return { error: 'Informe a quantidade, um número inteiro maior que zero.', field: 'quantity' };
  const pieces = d.piecesPerCarton.trim() ? count(d.piecesPerCarton) : null;
  if (d.piecesPerCarton.trim() && pieces === null) return { error: 'Peças por caixa é um número inteiro maior que zero.', field: 'piecesPerCarton' };
  let price: number | null = null;
  if (seeValues && d.unitPrice.trim()) {
    price = parseUnitPrice(d.unitPrice);
    if (price === null) return { error: 'Preço unitário inválido. Use até três casas decimais, como 0,575.', field: 'unitPrice' };
  }
  if (d.fileApprovedAt && parseDate(d.fileApprovedAt) !== d.fileApprovedAt) return { error: 'Data de aprovação do arquivo inválida.', field: 'fileApprovedAt' };
  const shipPlan: ShipPlan = [];
  for (const [i, r] of rows.entries()) {
    const n = count(r.quantity);
    if (n === null) return { error: `Informe a quantidade do embarque ${i + 1}, um número inteiro maior que zero.`, field: `plan-${i}-quantity` };
    shipPlan.push({ month: r.month, quantity: n });
  }
  const planProblem = shipPlanProblem(shipPlan, quantity);
  if (planProblem) return { error: planProblem, field: rows.length ? `plan-${rows.length - 1}-quantity` : 'quantity' };
  return {
    input: {
      description: d.description,
      isbn: d.isbn.trim() || null,
      supplier: d.supplier.trim() || null,
      orderCode: d.orderCode.trim() ? normalizeOrderCode(d.orderCode) : null,
      quantity,
      piecesPerCarton: pieces,
      unitPriceMicros: price,
      notes: d.notes,
      specification: d.specification,
      fileApprovedAt: d.fileApprovedAt || null,
      shipPlan,
    },
  };
}

/**
 * Programação de envio na ficha: até três embarques, cada um com o mês e a quantidade. Mostra quanto do
 * item já está programado e avisa do embarque que já devia ter saído.
 */
function PlanEditor({
  rows,
  onRows,
  itemQuantity,
  inProduction,
  today,
  ids,
  errorField,
  canEdit,
}: {
  rows: PlanRow[];
  onRows: (rows: PlanRow[]) => void;
  itemQuantity: number | null;
  inProduction: boolean;
  today: string;
  ids: string;
  errorField?: string;
  canEdit: boolean;
}) {
  const thisMonth = today.slice(0, 7);
  const options = monthOptions(thisMonth, 12, 30, rows.map((r) => r.month));
  const amounts = rows.map((r) => count(r.quantity) ?? 0);
  const planned = plannedTotal(rows.map((r, i) => ({ month: r.month, quantity: amounts[i]! })));
  const update = (key: number, change: Partial<PlanRow>) => onRows(rows.map((r) => (r.key === key ? { ...r, ...change } : r)));
  function add() {
    const last = rows.at(-1);
    const rest = itemQuantity === null ? 0 : itemQuantity - planned;
    onRows([...rows, { key: planKey++, month: last ? addMonths(last.month, 2) : addMonths(thisMonth, 1), quantity: rest > 0 ? String(rest) : '' }]);
  }
  const late = inProduction ? rows.find((r) => parcelPassed(r.month, today)) : undefined;
  return (
    <fieldset className="grupo largo envio-plano">
      <legend className="rotulo">Programação de envio</legend>
      {rows.length === 0 && <span className="dica">{canEdit ? 'Sem programação. Um título grande pode sair em até três embarques.' : 'Sem programação.'}</span>}
      {rows.map((r, i) => (
        <div key={r.key} className="envio-linha" role="group" aria-label={`Embarque ${i + 1}`}>
          <span className="envio-n" aria-hidden="true">
            {i + 1}º
          </span>
          <select
            className="campo"
            id={`${ids}-plan-${i}-month`}
            aria-label={`Mês do embarque ${i + 1}`}
            value={r.month}
            onChange={(e) => update(r.key, { month: e.target.value })}
            aria-invalid={errorField === `plan-${i}-month` || undefined}
          >
            {options.map((m) => (
              <option key={m} value={m}>
                {formatMonth(m)}
              </option>
            ))}
          </select>
          <input
            className="campo num"
            id={`${ids}-plan-${i}-quantity`}
            aria-label={`Quantidade do embarque ${i + 1}`}
            inputMode="numeric"
            placeholder="Exemplares"
            value={r.quantity}
            onChange={(e) => update(r.key, { quantity: e.target.value })}
            aria-invalid={errorField === `plan-${i}-quantity` || undefined}
          />
          <button type="button" className="btn envio-tirar" onClick={() => onRows(rows.filter((o) => o.key !== r.key))} aria-label={`Tirar o embarque ${i + 1}`}>
            <Icon name="lixeira" />
          </button>
        </div>
      ))}
      {canEdit && rows.length < MAX_PARCELS && (
        <button type="button" className="btn alinha-inicio" onClick={add}>
          <Icon name="mais" />
          {rows.length ? 'Outro embarque' : 'Programar envio'}
        </button>
      )}
      {rows.length > 0 && itemQuantity !== null && (
        <span className={`dica${planned > itemQuantity ? ' critico-texto' : ''}`} aria-live="polite">
          Programado: {formatQuantity(planned)} de {formatQuantity(itemQuantity)} exemplares
          {planned < itemQuantity ? ` (faltam ${formatQuantity(itemQuantity - planned)} sem programação)` : planned > itemQuantity ? ' (passa da quantidade do item)' : ''}.
        </span>
      )}
      {late && <span className="dica alerta-texto">O embarque de {formatMonth(late.month)} já devia ter saído e o item continua em produção.</span>}
    </fieldset>
  );
}

/** Mostra a última especificação do produto quando a deste item está vazia ou é só "reprint". */
function showLatest(current: string, latest: { specification: string } | null): boolean {
  return latest !== null && (current.trim() === '' || isReprintSpecification(current)) && latest.specification !== current;
}

export function ItemDialog({ state, me, data, production, onClose, onToast, onProduct }: Props) {
  const item = state?.mode === 'edit' ? state.item : null;
  const canEdit = can(me.role, 'edit');
  const canDelete = can(me.role, 'delete') && item !== null;
  const seeValues = data.seeValues;
  const [draft, setDraft] = useState<Draft>(() => draftFrom(item, data));
  const [error, setError] = useState<{ message: string; field?: string } | null>(null);
  const [planRows, setPlanRows] = useState<PlanRow[]>(() => rowsFrom(item));
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // Especificação do item e a última do produto, carregadas ao abrir a ficha.
  const [spec, setSpec] = useState<{ loaded: boolean; latest: { specification: string; orderCode: string | null } | null }>({ loaded: false, latest: null });
  const ids = useId();
  // De quem é cada PO, para a sugestão mostrar ("PO-063 · Sara") e evitar misturar fornecedores.
  const owners = useMemo(() => {
    const byId = orderOwners(data.items.map((i) => ({ order: i.purchaseOrderId, supplier: i.supplierId })));
    const names = new Map(data.suppliers.map((s) => [s.id, s.name]));
    return new Map([...byId].map(([orderId, supplierId]) => [orderId, names.get(supplierId) ?? '']));
  }, [data.items, data.suppliers]);

  useEffect(() => {
    setDraft(draftFrom(item, data));
    setPlanRows(rowsFrom(item));
    setError(null);
    setBusy(false);
    setConfirmDelete(false);
    setSpec({ loaded: !item, latest: null });
    if (item) {
      let alive = true;
      api
        .itemSpecification(item.id)
        .then((r) => {
          if (!alive) return;
          setDraft((d) => ({ ...d, specification: d.specification || r.specification }));
          setSpec({ loaded: true, latest: r.latest });
        })
        .catch(() => alive && setSpec({ loaded: false, latest: null }));
      return () => {
        alive = false;
      };
    }
    // Só ao abrir outra ficha; a recarga periódica não apaga o que a pessoa está digitando.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  if (!state) return <Dialog title="Item" open={false} onClose={onClose} />;

  // Onde o item embarcado está: invoice, BL e a chegada.
  const invoice = item?.invoiceId ? data.invoices.find((v) => v.id === item.invoiceId) : undefined;
  const shipment = invoice
    ? (() => {
        const bills = new Map(data.bills.map((b) => [b.id, b]));
        const a = arrivalOf(invoice, bills);
        return { invoice, bill: invoice.billId ? bills.get(invoice.billId) : undefined, state: arrivalState(a.eta, a.arrivedAt, data.today) };
      })()
    : null;

  const set = (field: keyof Draft) => (value: string) => setDraft((d) => ({ ...d, [field]: value }));
  const quantity = count(draft.quantity);
  const price = draft.unitPrice.trim() ? parseUnitPrice(draft.unitPrice) : null;

  async function save(e: FormEvent) {
    e.preventDefault();
    const checked = validate(draft, seeValues, planRows);
    if ('error' in checked) {
      setError({ message: checked.error, field: checked.field });
      document.getElementById(`${ids}-${checked.field}`)?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // Quem não vê valores não manda preço (nem apaga o que existe).
      // Sem a especificação carregada, ela não vai (para não apagar a que existe).
      const { unitPriceMicros, specification, ...rest } = checked.input;
      const body = { ...rest, ...(seeValues ? { unitPriceMicros } : {}), ...(spec.loaded ? { specification } : {}) };
      const res = await production.write(() => (item ? api.updateItem(item.id, body) : api.createItem(body as ItemInput)));
      production.putItem(res.item);
      onToast(item ? 'Item salvo.' : 'Item cadastrado.');
      onClose();
    } catch (err) {
      setError({ message: err instanceof ApiError ? err.message : 'Não foi possível salvar.' });
      setBusy(false);
    }
  }

  async function unship() {
    if (!item) return;
    setBusy(true);
    setError(null);
    try {
      await production.write(() => api.unship(item.id));
      onToast('O item voltou para a produção.');
      onClose();
    } catch (err) {
      setError({ message: err instanceof ApiError ? err.message : 'Não foi possível desfazer o embarque.' });
      setBusy(false);
    }
  }

  async function remove() {
    if (!item) return;
    setBusy(true);
    try {
      await production.write(() => api.deleteItem(item.id));
      production.removeItem(item.id);
      onToast('Item excluído.');
      onClose();
    } catch (err) {
      setError({ message: err instanceof ApiError ? err.message : 'Não foi possível excluir.' });
      setBusy(false);
    }
  }

  const title = !item ? 'Novo item em produção' : canEdit ? 'Item' : 'Item (só leitura)';
  const field = (name: keyof Draft) => ({ id: `${ids}-${name}`, 'aria-invalid': error?.field === name || undefined });
  // A aprovação que veio do No Prelo só muda lá (decidido em 19/11/2026).
  const fromNoPrelo = item?.fileApprovedFrom === NO_PRELO;

  return (
    <Dialog title={title} open onClose={onClose} wide>
      <form onSubmit={save} noValidate>
        {item && (
          <div className="dlg-texto item-situacao">
            <span className="pilula">{STATUS_LABELS[item.status]}</span>
            {shipment && (
              <span className="item-embarque">
                Invoice <b>{shipment.invoice.number}</b>
                {shipment.bill ? (
                  <>
                    {' '}
                    · BL <b>{shipment.bill.number}</b>
                  </>
                ) : (
                  ' · sem BL'
                )}{' '}
                · {arrivalText(shipment.state)}
              </span>
            )}
            {onProduct && (
              <button type="button" className="btn-texto" onClick={() => onProduct(item.productId)}>
                Todas as compras deste produto
              </button>
            )}
            {canEdit && item.status === 'embarcado' && (
              <button type="button" className="btn-texto" onClick={() => void unship()} disabled={busy}>
                Voltar para produção
              </button>
            )}
          </div>
        )}
        <fieldset className="dlg-corpo grade" disabled={!canEdit || busy}>
          <legend className="so-leitor">Dados do item</legend>
          <div className="grupo largo">
            <label className="rotulo" htmlFor={`${ids}-description`}>
              Produto
            </label>
            <input className="campo" {...field('description')} value={draft.description} onChange={(e) => set('description')(e.target.value)} autoFocus={!item} required />
          </div>
          <div className="grupo">
            <label className="rotulo" htmlFor={`${ids}-isbn`}>
              ISBN
            </label>
            <input className="campo" {...field('isbn')} inputMode="numeric" value={draft.isbn} onChange={(e) => set('isbn')(e.target.value)} placeholder="Sem ISBN" />
          </div>
          <div className="grupo">
            <label className="rotulo" htmlFor={`${ids}-orderCode`}>
              PO
            </label>
            <input className="campo" {...field('orderCode')} list={`${ids}-pos`} value={draft.orderCode} onChange={(e) => set('orderCode')(e.target.value)} placeholder={NO_ORDER} />
            <datalist id={`${ids}-pos`}>
              {data.orders.map((o) => (
                <option key={o.id} value={o.code} label={owners.get(o.id) ? `${o.code} · ${owners.get(o.id)}` : o.code} />
              ))}
            </datalist>
          </div>
          {/* O perfil Embarques, que o marketing usa, não vê o fornecedor (24/11/2026). */}
          {data.seeSuppliers && (
            <div className="grupo">
              <label className="rotulo" htmlFor={`${ids}-supplier`}>
                Fornecedor
              </label>
              <input
                className="campo"
                {...field('supplier')}
                list={`${ids}-forn`}
                value={draft.supplier}
                onChange={(e) => set('supplier')(e.target.value)}
                placeholder={NO_SUPPLIER}
                readOnly={Boolean(item?.invoiceId)}
                aria-describedby={item?.invoiceId ? `${ids}-forn-dica` : undefined}
              />
              {item?.invoiceId && (
                <span className="dica" id={`${ids}-forn-dica`}>
                  O fornecedor é o da invoice.
                </span>
              )}
              <datalist id={`${ids}-forn`}>
                {data.suppliers.map((s) => (
                  <option key={s.id} value={s.name} />
                ))}
              </datalist>
            </div>
          )}
          <div className="grupo">
            <label className="rotulo" htmlFor={`${ids}-quantity`}>
              Quantidade
            </label>
            <input className="campo num" {...field('quantity')} inputMode="numeric" value={draft.quantity} onChange={(e) => set('quantity')(e.target.value)} required />
          </div>
          <div className="grupo">
            <label className="rotulo" htmlFor={`${ids}-piecesPerCarton`}>
              Peças por caixa
            </label>
            <input className="campo num" {...field('piecesPerCarton')} inputMode="numeric" value={draft.piecesPerCarton} onChange={(e) => set('piecesPerCarton')(e.target.value)} />
          </div>
          {seeValues && (
            <div className="grupo">
              <label className="rotulo" htmlFor={`${ids}-unitPrice`}>
                Preço unitário (US$)
              </label>
              <input
                className="campo num"
                {...field('unitPrice')}
                inputMode="decimal"
                value={draft.unitPrice}
                onChange={(e) => set('unitPrice')(e.target.value)}
                placeholder="Sem preço"
                aria-describedby={`${ids}-total`}
              />
              <span className="dica" id={`${ids}-total`}>
                {quantity !== null && price !== null ? `Total: ${formatUsd(itemTotalCents(quantity, price))}` : quantity !== null ? `${formatQuantity(quantity)} exemplares` : ' '}
              </span>
            </div>
          )}
          <div className="grupo">
            <label className="rotulo" htmlFor={`${ids}-fileApprovedAt`}>
              Aprovação do arquivo
            </label>
            <input
              className="campo"
              type="date"
              {...field('fileApprovedAt')}
              value={draft.fileApprovedAt}
              onChange={(e) => set('fileApprovedAt')(e.target.value)}
              readOnly={fromNoPrelo}
              aria-describedby={fromNoPrelo ? `${ids}-aprov-dica` : undefined}
            />
            {fromNoPrelo && (
              <span className="dica" id={`${ids}-aprov-dica`}>
                Vem do No Prelo (a data de aprovação da gráfica). Para mudar, altere lá.
              </span>
            )}
          </div>
          <PlanEditor
            rows={planRows}
            onRows={setPlanRows}
            itemQuantity={quantity}
            inProduction={!item || item.status === 'producao'}
            today={data.today}
            ids={ids}
            errorField={error?.field}
            canEdit={canEdit}
          />
          {/* Para o perfil Embarques o servidor não manda as observações (podem citar o fornecedor). */}
          {data.seeSuppliers && (
            <div className="grupo largo">
              <label className="rotulo" htmlFor={`${ids}-notes`}>
                Observações
              </label>
              <textarea className="campo" {...field('notes')} rows={3} value={draft.notes} onChange={(e) => set('notes')(e.target.value)} />
            </div>
          )}
          <div className="grupo largo">
            <label className="rotulo" htmlFor={`${ids}-specification`}>
              Especificação
            </label>
            <textarea
              className="campo campo-espec"
              {...field('specification')}
              rows={5}
              value={draft.specification}
              onChange={(e) => set('specification')(e.target.value)}
              placeholder={item && !spec.loaded ? 'Carregando…' : 'Formato, papel, acabamento (vem da PO)'}
              aria-describedby={showLatest(draft.specification, spec.latest) ? `${ids}-espec-ultima` : undefined}
            />
            {showLatest(draft.specification, spec.latest) && (
              <div className="espec-ultima" id={`${ids}-espec-ultima`}>
                <span className="rotulo">Última especificação registrada{spec.latest!.orderCode ? ` (${spec.latest!.orderCode})` : ''}</span>
                <p>{spec.latest!.specification}</p>
              </div>
            )}
          </div>
        </fieldset>
        <div className="dlg-corpo sem-topo">
          <FormError message={error?.message ?? null} />
        </div>
        <div className="dlg-pe">
          {canDelete && (
            <div className="esq">
              {confirmDelete ? (
                <>
                  <span>Excluir este item?</span>
                  <button type="button" className="btn perigo" onClick={() => void remove()} disabled={busy}>
                    Excluir
                  </button>
                  <button type="button" className="btn" onClick={() => setConfirmDelete(false)} disabled={busy}>
                    Não
                  </button>
                </>
              ) : (
                <button type="button" className="btn perigo" onClick={() => setConfirmDelete(true)} disabled={busy}>
                  Excluir
                </button>
              )}
            </div>
          )}
          <button type="button" className="btn" onClick={onClose}>
            {canEdit ? 'Cancelar' : 'Fechar'}
          </button>
          {canEdit && (
            <button type="submit" className="btn primario" disabled={busy}>
              {busy ? 'Salvando…' : item ? 'Salvar' : 'Cadastrar'}
            </button>
          )}
        </div>
      </form>
    </Dialog>
  );
}
