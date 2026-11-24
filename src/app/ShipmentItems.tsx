// Embarques por item (SPEC.md, seção 5): os itens no mar numa tabela, como na Produção, com o total
// por fornecedor em destaque, busca, filtros por fornecedor e por embarque, ordenação e o agrupamento
// por embarque. Quem não vê valores (o leitor) vê exemplares; o servidor já não manda preço para ele.

import { useEffect, useMemo, useState } from 'react';
import { NO_ORDER, NO_SUPPLIER, totals, totalsBySupplier, type Item } from '../core/items';
import { formatQuantity, formatUnitPrice, formatUsd } from '../core/money';
import { arrivalText, formatDay, PAYMENT_LABELS, type PaymentSummary } from '../core/shipments';
import {
  EMPTY_SHIPPED_FILTERS,
  filterShipped,
  groupShipped,
  invoicePayments,
  shippedRows,
  sortShipped,
  type ShippedFilters,
  type ShippedGroup,
  type ShippedRow,
  type ShippedSort,
  type ShippedSortKey,
} from '../core/shippedItems';
import type { ProductionData } from './api';
import { hueStyle, supplierHue } from './components';
import { Icon } from './icons';
import { headline, itemsCount } from './Production';

const NARROW = '(max-width: 720px)';

function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(() => window.matchMedia(NARROW).matches);
  useEffect(() => {
    const mq = window.matchMedia(NARROW);
    const on = () => setNarrow(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return narrow;
}

interface Props {
  data: ProductionData;
  onOpen: (item: Item) => void;
  actions: React.ReactNode;
}

export function ShipmentItemsView({ data, onOpen, actions }: Props) {
  const narrow = useNarrow();
  // O perfil Embarques, que o marketing usa, não vê os fornecedores (24/11/2026): sem o resumo do topo,
  // a coluna, o filtro e o fornecedor nos grupos e nos cartões.
  const { seeValues, seeSuppliers } = data;
  const [filters, setFilters] = useState<ShippedFilters>(EMPTY_SHIPPED_FILTERS);
  const [sort, setSort] = useState<ShippedSort>({ key: 'arrival', dir: 1 });
  const [grouped, setGrouped] = useState(true);

  const rows = useMemo(() => shippedRows(data.items, data.invoices, data.bills, data.today), [data.items, data.invoices, data.bills, data.today]);
  const all = useMemo(() => totals(rows.map((r) => r.item), seeValues), [rows, seeValues]);
  const bySupplier = useMemo(() => totalsBySupplier(rows.map((r) => r.item), data.suppliers, seeValues), [rows, data.suppliers, seeValues]);
  const payments = useMemo(() => invoicePayments(data.invoices, data.items, data.payments, seeValues), [data.invoices, data.items, data.payments, seeValues]);
  const shown = useMemo(() => filterShipped(rows, filters, data.orders, data.suppliers, payments), [rows, filters, data.orders, data.suppliers, payments]);
  const sorted = useMemo(() => sortShipped(shown, sort, data.suppliers), [shown, sort, data.suppliers]);
  const groups = useMemo(
    () => (grouped ? groupShipped(shown, data.bills, data.invoices, data.suppliers, data.today, seeValues) : null),
    [grouped, shown, data.bills, data.invoices, data.suppliers, data.today, seeValues],
  );
  // Embarques com itens no mar, na ordem da chegada (para o filtro).
  const unitOptions = useMemo(() => groupShipped(rows, data.bills, data.invoices, data.suppliers, data.today, false), [rows, data.bills, data.invoices, data.suppliers, data.today]);
  const shownTotals = useMemo(() => totals(shown.map((r) => r.item), seeValues), [shown, seeValues]);
  const codes = useMemo(() => new Map(data.orders.map((o) => [o.id, o.code])), [data.orders]);
  const names = useMemo(() => new Map(data.suppliers.map((s) => [s.id, s.name])), [data.suppliers]);
  const filtered = filters.query.trim() !== '' || filters.supplierId !== '' || filters.unitKey !== '' || filters.payment !== '';
  const ctx: Ctx = { seeValues, seeSuppliers, codes, names, onOpen, payments };

  return (
    <>
      {seeSuppliers && (
        <section className="forn-faixa" aria-label="No mar por fornecedor">
          <div className="forn-total">
            <span className="forn-rot">No mar</span>
            <b>{headline(all)}</b>
            <span className="forn-sub">
              {itemsCount(all.items)}
              {seeValues && ` · ${formatQuantity(all.quantity)} ex.`}
              {all.unpriced > 0 && ` · ${all.unpriced} sem preço`}
            </span>
          </div>
          <ul className="forn-lista">
            {bySupplier.map((s) => {
              const id = s.supplierId ?? '';
              const active = filters.supplierId !== '' && filters.supplierId === id;
              const share = seeValues ? (all.valueCents ? (s.valueCents ?? 0) / all.valueCents : 0) : s.quantity / Math.max(1, all.quantity);
              return (
                <li key={id || 'sem'}>
                  <button
                    type="button"
                    className="forn h"
                    style={hueStyle(s.supplierId ? supplierHue(s.supplierId) : 0)}
                    aria-pressed={active}
                    onClick={() => setFilters({ ...filters, supplierId: active ? '' : id })}
                  >
                    <span className="forn-nome">{s.name}</span>
                    <b>{headline(s)}</b>
                    <span className="barra" aria-hidden="true">
                      <span style={{ width: `${Math.max(2, share * 100)}%` }} />
                    </span>
                    <span className="forn-sub">
                      {itemsCount(s.items)}
                      {seeValues && ` · ${formatQuantity(s.quantity)} ex.`}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <div className="filtros">
        <label className="busca">
          <Icon name="busca" />
          <span className="so-leitor">Buscar</span>
          <input
            className="campo"
            type="search"
            placeholder={seeSuppliers ? 'Buscar produto, ISBN, invoice, BL, fornecedor' : 'Buscar produto, ISBN, invoice, BL'}
            value={filters.query}
            onChange={(e) => setFilters({ ...filters, query: e.target.value })}
          />
        </label>
        {seeSuppliers && (
          <>
            <label className="so-leitor" htmlFor="embi-forn">
              Fornecedor
            </label>
            <select id="embi-forn" className="campo filtro-sel" value={filters.supplierId} onChange={(e) => setFilters({ ...filters, supplierId: e.target.value })}>
              <option value="">Fornecedor: todos</option>
              {bySupplier
                .filter((s) => s.supplierId)
                .map((s) => (
                  <option key={s.supplierId} value={s.supplierId!}>
                    {s.name}
                  </option>
                ))}
            </select>
          </>
        )}
        <label className="so-leitor" htmlFor="embi-unid">
          Embarque
        </label>
        <select id="embi-unid" className="campo filtro-sel" value={filters.unitKey} onChange={(e) => setFilters({ ...filters, unitKey: e.target.value })}>
          <option value="">Embarque: todos</option>
          {unitOptions.map((u) => (
            <option key={u.unitKey} value={u.unitKey}>
              {u.label}
              {u.eta ? ` · ${formatDay(u.eta)}` : ''}
            </option>
          ))}
        </select>
        {seeValues && (
          <>
            <label className="so-leitor" htmlFor="embi-pag">
              Pagamento
            </label>
            <select id="embi-pag" className="campo filtro-sel" value={filters.payment} onChange={(e) => setFilters({ ...filters, payment: e.target.value as ShippedFilters['payment'] })}>
              <option value="">Pagamento: todos</option>
              <option value="a_pagar">A pagar</option>
              <option value="parcial">Pago em parte</option>
              <option value="pago">Pago</option>
            </select>
          </>
        )}
        <label className="marcar agrupar">
          <input type="checkbox" checked={grouped} onChange={(e) => setGrouped(e.target.checked)} />
          Agrupar por embarque
        </label>
        <div className="filtros-acoes">{actions}</div>
      </div>

      <p className="contagem-linha" role="status">
        {filtered ? (
          <>
            {shown.length} de {itemsCount(rows.length)} · {headline(shownTotals, true)}
            {seeValues && ` · ${formatQuantity(shownTotals.quantity)} ex.`}{' '}
            <button type="button" className="btn-texto" onClick={() => setFilters(EMPTY_SHIPPED_FILTERS)}>
              Limpar filtros
            </button>
          </>
        ) : (
          <>{itemsCount(rows.length)} no mar</>
        )}
      </p>

      {rows.length === 0 ? (
        <div className="bloco tabela-vazia">Nenhum item no mar.</div>
      ) : shown.length === 0 ? (
        <div className="bloco tabela-vazia">Nenhum item com estes filtros.</div>
      ) : narrow ? (
        <Cards rows={sorted} groups={groups} ctx={ctx} />
      ) : (
        <Table rows={sorted} groups={groups} ctx={ctx} sort={sort} onSort={setSort} />
      )}
    </>
  );
}

interface Ctx {
  seeValues: boolean;
  seeSuppliers: boolean;
  codes: Map<string, string>;
  names: Map<string, string>;
  onOpen: (item: Item) => void;
  /** Situação de pagamento por invoice (vazio para quem não vê valores). */
  payments: ReadonlyMap<string, PaymentSummary>;
}

function PaymentPill({ invoiceId, ctx }: { invoiceId: string | undefined; ctx: Ctx }) {
  const pay = invoiceId ? ctx.payments.get(invoiceId) : undefined;
  if (!pay) return null;
  return <span className={`pilula pag ${pay.status}`}>{PAYMENT_LABELS[pay.status]}</span>;
}

/** Invoices do grupo com a situação de pagamento de cada uma. */
function GroupPayments({ group, ctx }: { group: ShippedGroup; ctx: Ctx }) {
  if (!ctx.seeValues) return null;
  return (
    <span className="grupo-pag">
      {group.invoices.map((v) => (
        <span key={v.id} className="grupo-pag-inv">
          {group.invoices.length > 1 && <span className="mudo">{v.number}</span>}
          <PaymentPill invoiceId={v.id} ctx={ctx} />
        </span>
      ))}
    </span>
  );
}

const COLUMNS: { key: ShippedSortKey; label: string; num?: boolean; values?: boolean; supplier?: boolean }[] = [
  { key: 'description', label: 'Produto' },
  { key: 'shipment', label: 'Embarque' },
  { key: 'supplier', label: 'Fornecedor', supplier: true },
  { key: 'arrival', label: 'Chegada' },
  { key: 'quantity', label: 'Quantidade', num: true },
  { key: 'price', label: 'Preço unitário', num: true, values: true },
  { key: 'total', label: 'Total', num: true, values: true },
];

function groupInfo(g: ShippedGroup, seeValues: boolean, seeSuppliers: boolean): string {
  const parts = seeSuppliers ? [g.suppliers.join(', ')] : [];
  if (g.invoices.length > 1 || !g.label.startsWith('Invoice')) parts.push(g.invoices.length === 1 ? `invoice ${g.invoices[0]!.number}` : `${g.invoices.length} invoices`);
  parts.push(itemsCount(g.items));
  if (seeValues) parts.push(`${formatQuantity(g.quantity)} ex.`);
  parts.push(arrivalText(g.state));
  return parts.join(' · ');
}

function byGroup(rows: readonly ShippedRow[], groups: readonly ShippedGroup[]) {
  return groups.map((g) => ({ group: g, rows: rows.filter((r) => r.unitKey === g.unitKey) }));
}

function Table({ rows, groups, ctx, sort, onSort }: { rows: ShippedRow[]; groups: ShippedGroup[] | null; ctx: Ctx; sort: ShippedSort; onSort: (s: ShippedSort) => void }) {
  const columns = COLUMNS.filter((c) => (ctx.seeValues || !c.values) && (ctx.seeSuppliers || !c.supplier));
  const toggle = (key: ShippedSortKey) => onSort(sort.key === key ? { key, dir: sort.dir === 1 ? -1 : 1 } : { key, dir: key === 'quantity' || key === 'total' || key === 'price' ? -1 : 1 });
  return (
    <div className="tabela-caixa">
      <table className="tabela-itens tabela-embarcados">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} className={c.num ? 'num' : undefined} aria-sort={sort.key === c.key ? (sort.dir === 1 ? 'ascending' : 'descending') : undefined}>
                <button type="button" onClick={() => toggle(c.key)}>
                  {c.label}
                  {sort.key === c.key && <Icon name={sort.dir === 1 ? 'cima' : 'baixo'} />}
                </button>
              </th>
            ))}
            <th className="num">Peças/caixa</th>
            {ctx.seeValues && <th>Pagamento</th>}
          </tr>
        </thead>
        {groups ? (
          byGroup(rows, groups).map(({ group, rows: list }) => (
            <tbody key={group.unitKey}>
              <tr className="grupo-linha">
                <th scope="rowgroup" colSpan={columns.length + (ctx.seeValues ? 2 : 1)}>
                  <span className="grupo-po">{group.label}</span>
                  <span className="grupo-info">{groupInfo(group, ctx.seeValues, ctx.seeSuppliers)}</span>
                  <GroupPayments group={group} ctx={ctx} />
                  <b className="grupo-valor">{headline(group, true)}</b>
                </th>
              </tr>
              {list.map((r) => (
                <Row key={r.item.id} row={r} ctx={ctx} />
              ))}
            </tbody>
          ))
        ) : (
          <tbody>
            {rows.map((r) => (
              <Row key={r.item.id} row={r} ctx={ctx} />
            ))}
          </tbody>
        )}
      </table>
    </div>
  );
}

function Row({ row, ctx }: { row: ShippedRow; ctx: Ctx }) {
  const { item } = row;
  const supplier = item.supplierId ? (ctx.names.get(item.supplierId) ?? NO_SUPPLIER) : NO_SUPPLIER;
  return (
    <tr>
      <td className="t-produto">
        <button type="button" className="abrir-item" onClick={() => ctx.onOpen(item)}>
          {item.description}
        </button>
        <span className="t-isbn">
          {item.isbn ?? 'Sem ISBN'} · {item.purchaseOrderId ? ctx.codes.get(item.purchaseOrderId) : NO_ORDER}
        </span>
      </td>
      <td className="nowrap">
        {row.unitLabel}
        {row.bill && row.invoice && <span className="t-isbn">Invoice {row.invoice.number}</span>}
      </td>
      {ctx.seeSuppliers && (
        <td className="nowrap">
          <span className="forn-ponto h" style={hueStyle(item.supplierId ? supplierHue(item.supplierId) : 0)} aria-hidden="true" />
          {supplier}
        </td>
      )}
      <td className="nowrap">
        <span className={`pilula chegada ${row.state.kind}`}>
          {row.state.kind === 'liberacao' && <Icon name="alerta" />}
          {row.eta ? formatDay(row.eta, true) : 'Sem previsão'}
        </span>
      </td>
      <td className="num">{formatQuantity(item.quantity)}</td>
      {ctx.seeValues && (
        <>
          <td className="num">{item.unitPriceMicros == null ? <span className="mudo">Sem preço</span> : formatUnitPrice(item.unitPriceMicros)}</td>
          <td className="num forte">{item.totalCents == null ? <span className="mudo">—</span> : formatUsd(item.totalCents)}</td>
        </>
      )}
      <td className="num mudo">{item.piecesPerCarton ?? '—'}</td>
      {ctx.seeValues && (
        <td>
          <PaymentPill invoiceId={row.invoice?.id} ctx={ctx} />
        </td>
      )}
    </tr>
  );
}

function Cards({ rows, groups, ctx }: { rows: ShippedRow[]; groups: ShippedGroup[] | null; ctx: Ctx }) {
  if (!groups) {
    return (
      <ul className="itens-cartoes">
        {rows.map((r) => (
          <Card key={r.item.id} row={r} ctx={ctx} />
        ))}
      </ul>
    );
  }
  return (
    <div className="itens-grupos">
      {byGroup(rows, groups).map(({ group, rows: list }) => (
        <section key={group.unitKey} aria-label={group.label}>
          <h3 className="grupo-cab">
            <span className="grupo-po">{group.label}</span>
            <b className="grupo-valor">{headline(group, true)}</b>
            <span className="grupo-info">{groupInfo(group, ctx.seeValues, ctx.seeSuppliers)}</span>
            <GroupPayments group={group} ctx={ctx} />
          </h3>
          <ul className="itens-cartoes">
            {list.map((r) => (
              <Card key={r.item.id} row={r} ctx={ctx} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function Card({ row, ctx }: { row: ShippedRow; ctx: Ctx }) {
  const { item } = row;
  const supplier = item.supplierId ? (ctx.names.get(item.supplierId) ?? NO_SUPPLIER) : NO_SUPPLIER;
  return (
    <li>
      <button type="button" className="item-cartao" onClick={() => ctx.onOpen(item)}>
        <span className="item-cartao-titulo">{item.description}</span>
        <span className="item-cartao-meta">
          {ctx.seeSuppliers && (
            <>
              <span className="forn-ponto h" style={hueStyle(item.supplierId ? supplierHue(item.supplierId) : 0)} aria-hidden="true" />
              {supplier} ·{' '}
            </>
          )}
          {row.unitLabel} · {row.eta ? `chega ${formatDay(row.eta)}` : 'sem previsão'}
        </span>
        <span className="item-cartao-num">
          <span>
            {formatQuantity(item.quantity)} ex.{item.piecesPerCarton ? ` · ${formatQuantity(item.piecesPerCarton)} por caixa` : ''}
          </span>
          {ctx.seeValues && <b>{item.totalCents == null ? 'Sem preço' : formatUsd(item.totalCents)}</b>}
        </span>
        {ctx.seeValues && row.invoice && (
          <span className="item-cartao-pag">
            <PaymentPill invoiceId={row.invoice.id} ctx={ctx} />
          </span>
        )}
      </button>
    </li>
  );
}
