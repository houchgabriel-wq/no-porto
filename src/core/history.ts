// Histórico e ficha do produto (SPEC.md, seção 5): busca, filtros por fornecedor e ano de chegada,
// totais por ano e a variação do preço de um produto ao longo das compras.

import { NO_SUPPLIER, searchKey, totalOf, type Item, type Supplier } from './items';

/** Invoice como o histórico mostra: com o número do BL e a chegada que vale. */
export interface InvoiceInfo {
  id: string;
  number: string;
  ref: string;
  supplierId: string | null;
  billNumber: string | null;
  arrivedAt: string | null;
  notes: string;
}

export const NO_DATE = 'sem-data';

export interface HistoryFilters {
  query: string;
  supplierId: string;
  /** Ano de chegada ("2025"), "" para todos, ou NO_DATE. */
  year: string;
}

export const EMPTY_HISTORY_FILTERS: HistoryFilters = { query: '', supplierId: '', year: '' };

export interface HistoryRow {
  item: Item;
  invoice: InvoiceInfo | undefined;
  arrivedAt: string | null;
}

/** Junta cada item à sua invoice e ordena da chegada mais recente para a mais antiga (sem data no fim). */
export function historyRows(items: readonly Item[], invoices: readonly InvoiceInfo[]): HistoryRow[] {
  const byId = new Map(invoices.map((v) => [v.id, v]));
  return items
    .map((item) => {
      const invoice = item.invoiceId ? byId.get(item.invoiceId) : undefined;
      return { item, invoice, arrivedAt: invoice?.arrivedAt ?? null };
    })
    .sort((a, b) => (b.arrivedAt ?? '').localeCompare(a.arrivedAt ?? '') || (a.invoice?.number ?? '').localeCompare(b.invoice?.number ?? '') || a.item.description.localeCompare(b.item.description, 'pt-BR'));
}

/** Busca (produto, ISBN, invoice, ref., BL, fornecedor e observações, sem acento) e filtros. */
export function filterHistory(rows: readonly HistoryRow[], filters: HistoryFilters, suppliers: readonly Supplier[]): HistoryRow[] {
  const names = new Map(suppliers.map((s) => [s.id, s.name]));
  const words = searchKey(filters.query).split(' ').filter(Boolean);
  return rows.filter(({ item, invoice, arrivedAt }) => {
    if (filters.supplierId && item.supplierId !== filters.supplierId) return false;
    if (filters.year === NO_DATE ? arrivedAt !== null : filters.year && arrivedAt?.slice(0, 4) !== filters.year) return false;
    if (!words.length) return true;
    const hay = searchKey(
      [item.description, item.isbn ?? '', invoice?.number ?? '', invoice?.ref ?? '', invoice?.billNumber ?? '', item.supplierId ? (names.get(item.supplierId) ?? '') : NO_SUPPLIER, item.notes].join(' '),
    );
    return words.every((w) => hay.includes(w));
  });
}

export interface YearTotals {
  year: string;
  items: number;
  quantity: number;
  /** Ausente para quem não vê valores. */
  valueCents?: number;
}

/** Totais por ano de chegada, do mais recente para o mais antigo, com "sem data" no fim. */
export function totalsByYear(rows: readonly HistoryRow[], seeValues: boolean): YearTotals[] {
  const groups = new Map<string, YearTotals>();
  for (const { item, arrivedAt } of rows) {
    const year = arrivedAt?.slice(0, 4) ?? NO_DATE;
    const g = groups.get(year) ?? (seeValues ? { year, items: 0, quantity: 0, valueCents: 0 } : { year, items: 0, quantity: 0 });
    groups.set(year, g);
    g.items += 1;
    g.quantity += item.quantity;
    if (g.valueCents !== undefined) g.valueCents += item.totalCents ?? totalOf(item) ?? 0;
  }
  return [...groups.values()].sort((a, b) => (a.year === NO_DATE ? 1 : b.year === NO_DATE ? -1 : b.year.localeCompare(a.year)));
}

export interface PriceStats {
  /** Compras com preço. */
  count: number;
  minMicros: number;
  maxMicros: number;
  /** Preço da compra mais recente com preço. */
  lastMicros: number;
  /** Variação da compra mais antiga para a mais recente, em pontos percentuais × 10 (uma casa). */
  changePermille: number | null;
}

/**
 * Preços de um produto, das compras em ordem cronológica: menor, maior, o último e quanto variou do
 * primeiro para o último. Null quando nenhuma compra tem preço (ou para quem não vê valores).
 */
export function priceStats(purchases: readonly { unitPriceMicros?: number | null }[]): PriceStats | null {
  const prices = purchases.map((p) => p.unitPriceMicros).filter((p): p is number => typeof p === 'number');
  if (!prices.length) return null;
  const first = prices[0]!;
  const last = prices[prices.length - 1]!;
  return {
    count: prices.length,
    minMicros: Math.min(...prices),
    maxMicros: Math.max(...prices),
    lastMicros: last,
    changePermille: prices.length > 1 && first > 0 ? Math.round(((last - first) / first) * 1000) : null,
  };
}

/** Data que representa a compra na ficha do produto: a chegada; sem ela, a previsão; sem as duas, o cadastro. */
export function purchaseDate(item: Pick<Item, 'createdAt'>, arrival: { eta?: string | null; arrivedAt: string | null } | undefined): string {
  return arrival?.arrivedAt ?? arrival?.eta ?? item.createdAt.slice(0, 10);
}
