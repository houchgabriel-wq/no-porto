// Tela Histórico (SPEC.md, seção 5): tudo o que chegou desde 2023, com busca, filtros por fornecedor
// e ano, totais por ano e a ficha de cada produto. Os dados são carregados ao abrir a tela.

import { useMemo, useState } from 'react';
import { EMPTY_HISTORY_FILTERS, filterHistory, historyRows, NO_DATE, totalsByYear, type HistoryFilters, type HistoryRow, type InvoiceInfo } from '../core/history';
import { NO_SUPPLIER, totals, type Item, type Supplier } from '../core/items';
import { formatQuantity, formatUnitPrice, formatUsd, formatUsdWhole } from '../core/money';
import { formatDay } from '../core/shipments';
import { supplierHue, hueStyle } from './components';
import { Icon } from './icons';
import { headline, itemsCount } from './Production';

/** Quantas linhas aparecem de cada vez. */
const PAGE = 200;

export interface HistoryData {
  items: Item[];
  /** Os fornecedores dos itens que chegaram. */
  suppliers: Supplier[];
  invoices: InvoiceInfo[];
  seeValues: boolean;
}

interface Props {
  history: HistoryData;
  suppliers: Supplier[];
  /** Abre a ficha do produto; ausente para quem não vê fichas (o perfil Embarques). */
  onProduct?: (productId: string) => void;
  /** Mostra o recebido por ano no topo (o perfil Embarques não vê). */
  showYears: boolean;
  onExport: (rows: HistoryRow[]) => void;
  exporting: boolean;
  actions: React.ReactNode;
}

const yearLabel = (y: string) => (y === NO_DATE ? 'Sem data' : y);

export function HistoryView({ history, suppliers, onProduct, showYears, onExport, exporting, actions }: Props) {
  const [filters, setFilters] = useState<HistoryFilters>(EMPTY_HISTORY_FILTERS);
  const [shownCount, setShownCount] = useState(PAGE);
  const { seeValues } = history;
  const rows = useMemo(() => historyRows(history.items, history.invoices), [history]);
  const byYear = useMemo(() => totalsByYear(rows, seeValues), [rows, seeValues]);
  const shown = useMemo(() => filterHistory(rows, filters, suppliers), [rows, filters, suppliers]);
  const shownTotals = useMemo(() => totals(shown.map((r) => r.item), seeValues), [shown, seeValues]);
  const names = useMemo(() => new Map(suppliers.map((s) => [s.id, s.name])), [suppliers]);
  const historySuppliers = useMemo(() => suppliers.filter((s) => history.items.some((i) => i.supplierId === s.id)), [suppliers, history.items]);
  const invoiceCount = new Set(shown.map((r) => r.item.invoiceId)).size;
  const filtered = filters.query.trim() !== '' || filters.supplierId !== '' || filters.year !== '';
  const maxYear = Math.max(1, ...byYear.map((y) => (seeValues ? (y.valueCents ?? 0) : y.quantity)));

  function change(f: HistoryFilters) {
    setFilters(f);
    setShownCount(PAGE);
  }

  return (
    <>
      {showYears && (
      <section className="hist-anos" aria-label="Recebido por ano de chegada">
        {byYear.map((y) => {
          const active = filters.year === y.year;
          const size = seeValues ? (y.valueCents ?? 0) : y.quantity;
          return (
            <button key={y.year} type="button" className="hist-ano" aria-pressed={active} onClick={() => change({ ...filters, year: active ? '' : y.year })}>
              <span className="forn-rot">{yearLabel(y.year)}</span>
              <b>{seeValues ? formatUsdWhole(y.valueCents ?? 0) : `${formatQuantity(y.quantity)} ex.`}</b>
              <span className="barra" aria-hidden="true">
                <span style={{ width: `${Math.max(2, (size / maxYear) * 100)}%` }} />
              </span>
              <span className="forn-sub">
                {itemsCount(y.items)}
                {seeValues && ` · ${formatQuantity(y.quantity)} ex.`}
              </span>
            </button>
          );
        })}
      </section>
      )}

      <div className="filtros">
        <label className="busca">
          <Icon name="busca" />
          <span className="so-leitor">Buscar</span>
          <input
            className="campo"
            type="search"
            placeholder="Buscar produto, ISBN, invoice, ref., BL"
            value={filters.query}
            onChange={(e) => change({ ...filters, query: e.target.value })}
          />
        </label>
        <label className="so-leitor" htmlFor="hist-forn">
          Fornecedor
        </label>
        <select id="hist-forn" className="campo filtro-sel" value={filters.supplierId} onChange={(e) => change({ ...filters, supplierId: e.target.value })}>
          <option value="">Fornecedor: todos</option>
          {historySuppliers.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <label className="so-leitor" htmlFor="hist-ano">
          Ano de chegada
        </label>
        <select id="hist-ano" className="campo filtro-sel" value={filters.year} onChange={(e) => change({ ...filters, year: e.target.value })}>
          <option value="">Ano: todos</option>
          {byYear.map((y) => (
            <option key={y.year} value={y.year}>
              {yearLabel(y.year)}
            </option>
          ))}
        </select>
        <div className="filtros-acoes">
          <button type="button" className="btn" onClick={() => onExport(shown)} disabled={exporting || shown.length === 0}>
            <Icon name="arquivo" />
            <span className="rot">{exporting ? 'Gerando…' : 'Baixar .xlsx'}</span>
          </button>
          {actions}
        </div>
      </div>

      <p className="contagem-linha" role="status">
        {shown.length === rows.length ? `${itemsCount(rows.length)} recebidos` : `${shown.length} de ${itemsCount(rows.length)}`} · {invoiceCount}{' '}
        {invoiceCount === 1 ? 'invoice' : 'invoices'} · {headline(shownTotals)}
        {seeValues && ` · ${formatQuantity(shownTotals.quantity)} ex.`}
        {filtered && (
          <>
            {' '}
            <button type="button" className="btn-texto" onClick={() => change(EMPTY_HISTORY_FILTERS)}>
              Limpar filtros
            </button>
          </>
        )}
      </p>

      {rows.length === 0 ? (
        <div className="bloco tabela-vazia">O histórico ainda está vazio. O admin faz a carga da aba Entregues da planilha.</div>
      ) : shown.length === 0 ? (
        <div className="bloco tabela-vazia">Nenhum item com estes filtros.</div>
      ) : (
        <>
          <div className="tabela-caixa" tabIndex={onProduct ? undefined : 0} role={onProduct ? undefined : 'region'} aria-label={onProduct ? undefined : 'Itens recebidos'}>
            <table className="tabela-hist tabela-empilha">
              <thead>
                <tr>
                  <th>Chegada</th>
                  <th>Produto</th>
                  <th>Fornecedor</th>
                  <th>Invoice</th>
                  <th className="num">Quantidade</th>
                  {seeValues && (
                    <>
                      <th className="num">Preço unitário</th>
                      <th className="num">Total</th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody>
                {shown.slice(0, shownCount).map(({ item, invoice, arrivedAt }) => (
                  <tr key={item.id}>
                    <td className="nowrap" title={invoice?.notes || undefined} data-rot="Chegada">
                      {arrivedAt ? formatDay(arrivedAt, true) : <span className="mudo">Sem data</span>}
                    </td>
                    <td className="t-produto">
                      {onProduct ? (
                        <button type="button" className="abrir-item" onClick={() => onProduct(item.productId)}>
                          {item.description}
                        </button>
                      ) : (
                        <span className="t-nome">{item.description}</span>
                      )}
                      <span className="t-isbn">{item.isbn ?? 'Sem ISBN'}</span>
                    </td>
                    <td className="nowrap" data-rot="Fornecedor">
                      <span className="forn-ponto h" style={hueStyle(item.supplierId ? supplierHue(item.supplierId) : 0)} aria-hidden="true" />
                      {item.supplierId ? (names.get(item.supplierId) ?? NO_SUPPLIER) : NO_SUPPLIER}
                    </td>
                    <td data-rot="Invoice">
                      {invoice?.number ?? '—'}
                      {invoice?.billNumber && <span className="t-isbn">BL {invoice.billNumber}</span>}
                    </td>
                    <td className="num" data-rot="Quantidade">{formatQuantity(item.quantity)}</td>
                    {seeValues && (
                      <>
                        <td className="num" data-rot="Preço unitário">{item.unitPriceMicros == null ? <span className="mudo">Sem preço</span> : formatUnitPrice(item.unitPriceMicros)}</td>
                        <td className="num forte" data-rot="Total">{item.totalCents == null ? <span className="mudo">—</span> : formatUsd(item.totalCents)}</td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {shown.length > shownCount && (
            <p className="mais-linhas">
              <button type="button" className="btn" onClick={() => setShownCount((n) => n + PAGE)}>
                Mostrar mais {Math.min(PAGE, shown.length - shownCount)} de {shown.length - shownCount}
              </button>
            </p>
          )}
        </>
      )}
    </>
  );
}
