// Tela Produção (SPEC.md, seção 5): os itens em produção, com os totais por fornecedor em destaque,
// busca, filtros, agrupamento por PO e a tabela (cartões no celular). Quem não vê valores (o leitor)
// vê exemplares no lugar dos valores; o servidor já não manda preço nem total para ele.

import { useEffect, useMemo, useState } from 'react';
import {
  filterItems,
  NO_ORDER,
  NO_SUPPLIER,
  shipPlanPassed,
  sortItems,
  totals,
  totalsByOrder,
  totalsBySupplier,
  type Item,
  type ItemFilters,
  type ItemSort,
  type SortKey,
  type Totals,
} from '../core/items';
import { formatQuantity, formatUnitPrice, formatUsd, formatUsdWhole } from '../core/money';
import { formatDay } from '../core/shipments';
import type { ProductionData } from './api';
import { supplierHue, hueStyle } from './components';
import { Icon } from './icons';

/** Largura em que a tabela vira lista de cartões. */
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

/**
 * Valor em destaque: dólares para quem vê valores; exemplares para o leitor. `cents` mostra os
 * centavos (nos embarques, onde o valor é o que se paga).
 */
export function headline(t: Totals, cents = false): string {
  if (t.valueCents === undefined) return `${formatQuantity(t.quantity)} ex.`;
  // Nenhum item com preço: "US$ 0" daria a impressão de que não custa nada.
  if (t.valueCents === 0 && t.items > 0 && t.unpriced === t.items) return 'Sem preço';
  return cents ? formatUsd(t.valueCents) : formatUsdWhole(t.valueCents);
}

export function itemsCount(n: number): string {
  return `${formatQuantity(n)} ${n === 1 ? 'item' : 'itens'}`;
}

function totalsLine(t: Totals): string {
  const parts = [itemsCount(t.items)];
  if (t.valueCents !== undefined) parts.push(`${formatQuantity(t.quantity)} ex.`);
  if (t.unpriced) parts.push(`${t.unpriced} sem preço`);
  return parts.join(' · ');
}

interface Props {
  data: ProductionData;
  filters: ItemFilters;
  onFilters: (f: ItemFilters) => void;
  sort: ItemSort;
  onSort: (s: ItemSort) => void;
  grouped: boolean;
  onGrouped: (g: boolean) => void;
  onOpen: (item: Item) => void;
  /** Ações da barra (novo item, carga, baixar), conforme o perfil. */
  actions: React.ReactNode;
  /** Itens marcados para embarcar; ausente para quem não embarca (o leitor). */
  selection?: { ids: ReadonlySet<string>; onChange: (ids: Set<string>) => void; onShip: () => void };
}

export function ProductionView({ data, filters, onFilters, sort, onSort, grouped, onGrouped, onOpen, actions, selection }: Props) {
  const narrow = useNarrow();
  const { seeValues } = data;
  const all = useMemo(() => totals(data.items, seeValues), [data.items, seeValues]);
  const bySupplier = useMemo(() => totalsBySupplier(data.items, data.suppliers, seeValues), [data.items, data.suppliers, seeValues]);
  const shown = useMemo(() => filterItems(data.items, filters, data.orders, data.suppliers), [data, filters]);
  const sorted = useMemo(() => sortItems(shown, sort, data.orders, data.suppliers), [shown, sort, data.orders, data.suppliers]);
  const groups = useMemo(
    () => (grouped ? totalsByOrder(shown, data.orders, data.suppliers, seeValues) : null),
    [grouped, shown, data.orders, data.suppliers, seeValues],
  );
  const codes = useMemo(() => new Map(data.orders.map((o) => [o.id, o.code])), [data.orders]);
  const names = useMemo(() => new Map(data.suppliers.map((s) => [s.id, s.name])), [data.suppliers]);
  const orderOptions = useMemo(
    () => [...data.orders].filter((o) => data.items.some((i) => i.purchaseOrderId === o.id)).sort((a, b) => b.code.localeCompare(a.code, 'pt-BR', { numeric: true })),
    [data.orders, data.items],
  );
  const filtered = filters.query.trim() !== '' || filters.supplierId !== '' || filters.orderId !== '';
  const shownTotals = useMemo(() => totals(shown, seeValues), [shown, seeValues]);

  const toggle = selection
    ? (id: string) => {
        const next = new Set(selection.ids);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        selection.onChange(next);
      }
    : undefined;
  const ctx: Ctx = { seeValues, today: data.today, codes, names, onOpen, selected: selection?.ids, toggle };
  const chosen = selection ? data.items.filter((i) => selection.ids.has(i.id)) : [];
  const chosenSuppliers = new Set(chosen.map((i) => i.supplierId));

  return (
    <>
      <section className="forn-faixa" aria-label="Totais em produção por fornecedor">
        <div className="forn-total">
          <span className="forn-rot">Em produção</span>
          <b>{headline(all)}</b>
          <span className="forn-sub">{totalsLine(all)}</span>
        </div>
        <ul className="forn-lista">
          {bySupplier.map((s) => {
            const id = s.supplierId ?? 'sem';
            const active = filters.supplierId === id;
            const share = seeValues ? (all.valueCents ? (s.valueCents ?? 0) / all.valueCents : 0) : s.quantity / Math.max(1, all.quantity);
            return (
              <li key={id}>
                <button
                  type="button"
                  className="forn h"
                  style={hueStyle(s.supplierId ? supplierHue(s.supplierId) : 0)}
                  aria-pressed={active}
                  onClick={() => onFilters({ ...filters, supplierId: active ? '' : id })}
                >
                  <span className="forn-nome">{s.name}</span>
                  <b>{headline(s)}</b>
                  <span className="barra" aria-hidden="true">
                    <span style={{ width: `${Math.max(2, share * 100)}%` }} />
                  </span>
                  <span className="forn-sub">{totalsLine(s)}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      <div className="filtros">
        <label className="busca">
          <Icon name="busca" />
          <span className="so-leitor">Buscar</span>
          <input
            className="campo"
            type="search"
            placeholder="Buscar produto, ISBN, PO, fornecedor"
            value={filters.query}
            onChange={(e) => onFilters({ ...filters, query: e.target.value })}
          />
        </label>
        <label className="so-leitor" htmlFor="filtro-forn">
          Fornecedor
        </label>
        <select id="filtro-forn" className="campo filtro-sel" value={filters.supplierId} onChange={(e) => onFilters({ ...filters, supplierId: e.target.value })}>
          <option value="">Fornecedor: todos</option>
          {data.suppliers.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
          {data.items.some((i) => i.supplierId === null) && <option value="sem">{NO_SUPPLIER}</option>}
        </select>
        <label className="so-leitor" htmlFor="filtro-po">
          PO
        </label>
        <select id="filtro-po" className="campo filtro-sel" value={filters.orderId} onChange={(e) => onFilters({ ...filters, orderId: e.target.value })}>
          <option value="">PO: todas</option>
          {orderOptions.map((o) => (
            <option key={o.id} value={o.id}>
              {o.code}
            </option>
          ))}
          {data.items.some((i) => i.purchaseOrderId === null) && <option value="sem">{NO_ORDER}</option>}
        </select>
        <label className="marcar agrupar">
          <input type="checkbox" checked={grouped} onChange={(e) => onGrouped(e.target.checked)} />
          Agrupar por PO
        </label>
        <div className="filtros-acoes">{actions}</div>
      </div>

      <p className="contagem-linha" role="status">
        {filtered ? (
          <>
            {shown.length} de {itemsCount(data.items.length)} · {headline(shownTotals)}
            {seeValues && ` · ${formatQuantity(shownTotals.quantity)} ex.`}{' '}
            <button type="button" className="btn-texto" onClick={() => onFilters({ query: '', supplierId: '', orderId: '' })}>
              Limpar filtros
            </button>
          </>
        ) : (
          <>{itemsCount(data.items.length)} em produção</>
        )}
      </p>

      {selection && chosen.length > 0 && (
        <div className="lote" role="region" aria-label="Itens marcados">
          <span>
            <b>{itemsCount(chosen.length)}</b> {chosen.length === 1 ? 'marcado' : 'marcados'}
            {chosenSuppliers.size > 1 && <span className="lote-aviso"> · de fornecedores diferentes: embarque cada fornecedor separadamente</span>}
          </span>
          <button type="button" className="btn" onClick={() => selection.onChange(new Set())}>
            Desmarcar
          </button>
          <button type="button" className="btn primario" onClick={selection.onShip} disabled={chosenSuppliers.size > 1}>
            <Icon name="navio" />
            Embarcar
          </button>
        </div>
      )}

      {shown.length === 0 ? (
        <div className="bloco tabela-vazia">Nenhum item com estes filtros.</div>
      ) : narrow ? (
        <ItemCards items={sorted} groups={groups} ctx={ctx} />
      ) : (
        <ItemTable items={sorted} groups={groups} ctx={ctx} sort={sort} onSort={onSort} />
      )}
    </>
  );
}

interface Ctx {
  seeValues: boolean;
  /** Hoje (AAAA-MM-DD), para destacar a programação de envio que já passou. */
  today: string;
  codes: Map<string, string>;
  names: Map<string, string>;
  onOpen: (item: Item) => void;
  selected?: ReadonlySet<string>;
  toggle?: (id: string) => void;
}

function Mark({ item, ctx }: { item: Item; ctx: Ctx }) {
  if (!ctx.toggle) return null;
  return (
    <input
      type="checkbox"
      className="marca-item"
      checked={ctx.selected?.has(item.id) ?? false}
      onChange={() => ctx.toggle!(item.id)}
      aria-label={`Marcar ${item.description} para embarcar`}
    />
  );
}

type Groups = ReturnType<typeof totalsByOrder> | null;

/** Itens de cada grupo, na ordem da tabela. */
function byGroup(items: readonly Item[], groups: NonNullable<Groups>) {
  return groups.map((g) => ({ group: g, items: items.filter((i) => i.purchaseOrderId === g.orderId) }));
}

const COLUMNS: { key: SortKey; label: string; num?: boolean; values?: boolean; date?: boolean }[] = [
  { key: 'description', label: 'Produto' },
  { key: 'order', label: 'PO' },
  { key: 'supplier', label: 'Fornecedor' },
  { key: 'fileApproved', label: 'Aprovação do arquivo', date: true },
  { key: 'shipPlanned', label: 'Programação de envio', date: true },
  { key: 'quantity', label: 'Quantidade', num: true },
  { key: 'price', label: 'Preço unitário', num: true, values: true },
  { key: 'total', label: 'Total', num: true, values: true },
];

function ItemTable({ items, groups, ctx, sort, onSort }: { items: Item[]; groups: Groups; ctx: Ctx; sort: ItemSort; onSort: (s: ItemSort) => void }) {
  const columns = COLUMNS.filter((c) => ctx.seeValues || !c.values);
  const toggle = (key: SortKey) => onSort(sort.key === key ? { key, dir: sort.dir === 1 ? -1 : 1 } : { key, dir: key === 'quantity' || key === 'total' || key === 'price' ? -1 : 1 });
  return (
    <div className="tabela-caixa">
      <table className="tabela-itens tabela-producao">
        <thead>
          <tr>
            {ctx.toggle && (
              <th className="col-marca">
                <span className="so-leitor">Marcar</span>
              </th>
            )}
            {columns.map((c) => (
              <th key={c.key} className={c.num ? 'num' : c.date ? 'th-data' : undefined} aria-sort={sort.key === c.key ? (sort.dir === 1 ? 'ascending' : 'descending') : undefined}>
                <button type="button" onClick={() => toggle(c.key)}>
                  {c.label}
                  {sort.key === c.key && <Icon name={sort.dir === 1 ? 'cima' : 'baixo'} />}
                </button>
              </th>
            ))}
            <th className="num">Peças/caixa</th>
          </tr>
        </thead>
        {groups ? (
          byGroup(items, groups).map(({ group, items: rows }) => (
            <tbody key={group.orderId ?? 'sem'}>
              <tr className="grupo-linha">
                <th scope="rowgroup" colSpan={columns.length + 1 + (ctx.toggle ? 1 : 0)}>
                  <span className="grupo-po">{group.code}</span>
                  <span className="grupo-info">
                    {group.suppliers.join(', ')} · {totalsLine(group)}
                  </span>
                  <b className="grupo-valor">{headline(group)}</b>
                </th>
              </tr>
              {rows.map((item) => (
                <ItemRow key={item.id} item={item} ctx={ctx} />
              ))}
            </tbody>
          ))
        ) : (
          <tbody>
            {items.map((item) => (
              <ItemRow key={item.id} item={item} ctx={ctx} />
            ))}
          </tbody>
        )}
      </table>
    </div>
  );
}

function ItemRow({ item, ctx }: { item: Item; ctx: Ctx }) {
  const supplier = item.supplierId ? (ctx.names.get(item.supplierId) ?? NO_SUPPLIER) : NO_SUPPLIER;
  return (
    <tr className={ctx.selected?.has(item.id) ? 'marcado' : undefined}>
      {ctx.toggle && (
        <td className="col-marca">
          <Mark item={item} ctx={ctx} />
        </td>
      )}
      <td className="t-produto">
        <button type="button" className="abrir-item" onClick={() => ctx.onOpen(item)}>
          {item.description}
        </button>
        <span className="t-isbn">{item.isbn ?? 'Sem ISBN'}</span>
      </td>
      <td className={item.purchaseOrderId ? 'nowrap' : 'nowrap mudo'}>{item.purchaseOrderId ? ctx.codes.get(item.purchaseOrderId) : NO_ORDER}</td>
      <td className={item.supplierId ? 'nowrap' : 'nowrap mudo'}>
        <span className="forn-ponto h" style={hueStyle(item.supplierId ? supplierHue(item.supplierId) : 0)} aria-hidden="true" />
        {supplier}
      </td>
      <td className="nowrap">{item.fileApprovedAt ? formatDay(item.fileApprovedAt, true) : <span className="mudo">—</span>}</td>
      <td className="nowrap">
        <ShipPlan item={item} today={ctx.today} />
      </td>
      <td className="num">{formatQuantity(item.quantity)}</td>
      {ctx.seeValues && (
        <>
          <td className="num">{item.unitPriceMicros == null ? <span className="mudo">Sem preço</span> : formatUnitPrice(item.unitPriceMicros)}</td>
          <td className="num forte">{item.totalCents == null ? <span className="mudo">—</span> : formatUsd(item.totalCents)}</td>
        </>
      )}
      <td className="num mudo">{item.piecesPerCarton ?? '—'}</td>
    </tr>
  );
}

/** Programação de envio; a que já passou, com o item ainda em produção, em destaque. */
function ShipPlan({ item, today }: { item: Item; today: string }) {
  if (!item.shipPlannedAt) return <span className="mudo">—</span>;
  if (!shipPlanPassed(item, today)) return <>{formatDay(item.shipPlannedAt, true)}</>;
  return (
    <span className="alerta-texto envio-passou">
      <Icon name="alerta" />
      {formatDay(item.shipPlannedAt, true)}
      <span className="so-leitor"> (já passou)</span>
    </span>
  );
}

function ItemCards({ items, groups, ctx }: { items: Item[]; groups: Groups; ctx: Ctx }) {
  if (!groups) {
    return (
      <ul className="itens-cartoes">
        {items.map((item) => (
          <ItemCard key={item.id} item={item} ctx={ctx} />
        ))}
      </ul>
    );
  }
  return (
    <div className="itens-grupos">
      {byGroup(items, groups).map(({ group, items: rows }) => (
        <section key={group.orderId ?? 'sem'} aria-label={group.code}>
          <h3 className="grupo-cab">
            <span className="grupo-po">{group.code}</span>
            <b className="grupo-valor">{headline(group)}</b>
            <span className="grupo-info">
              {group.suppliers.join(', ')} · {totalsLine(group)}
            </span>
          </h3>
          <ul className="itens-cartoes">
            {rows.map((item) => (
              <ItemCard key={item.id} item={item} ctx={ctx} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function ItemCard({ item, ctx }: { item: Item; ctx: Ctx }) {
  const supplier = item.supplierId ? (ctx.names.get(item.supplierId) ?? NO_SUPPLIER) : NO_SUPPLIER;
  return (
    <li className={ctx.toggle ? 'com-marca' : undefined}>
      <Mark item={item} ctx={ctx} />
      <button type="button" className="item-cartao" onClick={() => ctx.onOpen(item)}>
        <span className="item-cartao-titulo">{item.description}</span>
        <span className="item-cartao-meta">
          <span className="forn-ponto h" style={hueStyle(item.supplierId ? supplierHue(item.supplierId) : 0)} aria-hidden="true" />
          {supplier} · {item.purchaseOrderId ? ctx.codes.get(item.purchaseOrderId) : NO_ORDER}
        </span>
        {(item.fileApprovedAt || item.shipPlannedAt) && (
          <span className="item-cartao-datas">
            {item.fileApprovedAt && <span>Aprovação do arquivo: {formatDay(item.fileApprovedAt, true)}</span>}
            {item.shipPlannedAt && (
              <span>
                Programação de envio: <ShipPlan item={item} today={ctx.today} />
              </span>
            )}
          </span>
        )}
        <span className="item-cartao-num">
          <span>{formatQuantity(item.quantity)} ex.</span>
          {ctx.seeValues && <b>{item.totalCents == null ? 'Sem preço' : formatUsd(item.totalCents)}</b>}
        </span>
      </button>
    </li>
  );
}
