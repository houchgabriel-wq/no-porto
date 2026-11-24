// Embarques por item (SPEC.md, seção 5): os itens no mar numa tabela, como na Produção, com a invoice,
// o BL e a chegada de cada um. Busca, filtros por fornecedor e por embarque, ordenação e o
// agrupamento por embarque (o BL com suas invoices, ou a invoice sem BL).

import { compareOrderCodes, NO_ORDER, NO_SUPPLIER, searchKey, totalOf, totals, type Item, type PurchaseOrder, type Supplier, type Totals } from './items';
import { arrivalOf, arrivalState, invoiceTotal, paymentSummary, shipmentUnits, type ArrivalState, type Bill, type Invoice, type Payment, type PaymentStatus, type PaymentSummary } from './shipments';

export interface ShippedRow {
  item: Item;
  invoice: Invoice | null;
  bill: Bill | null;
  /** Chave do embarque (como em shipmentUnits): "bl:<id>" ou "inv:<id>". */
  unitKey: string;
  /** Nome do embarque na tela: "BL ROECHN…" ou "Invoice 108". */
  unitLabel: string;
  eta: string | null;
  state: ArrivalState;
}

/** Os itens embarcados (no mar), cada um com a invoice, o BL e a situação da chegada. */
export function shippedRows(items: readonly Item[], invoices: readonly Invoice[], bills: readonly Bill[], today: string): ShippedRow[] {
  const byInvoice = new Map(invoices.map((v) => [v.id, v]));
  const byBill = new Map(bills.map((b) => [b.id, b]));
  return items
    .filter((i) => i.status === 'embarcado')
    .map((item) => {
      const invoice = item.invoiceId ? (byInvoice.get(item.invoiceId) ?? null) : null;
      const bill = invoice?.billId ? (byBill.get(invoice.billId) ?? null) : null;
      const { eta, arrivedAt } = invoice ? arrivalOf(invoice, byBill) : { eta: null, arrivedAt: null };
      return {
        item,
        invoice,
        bill,
        unitKey: bill ? `bl:${bill.id}` : invoice ? `inv:${invoice.id}` : 'sem',
        unitLabel: bill ? `BL ${bill.number}` : invoice ? `Invoice ${invoice.number}` : 'Sem invoice',
        eta,
        state: arrivalState(eta, arrivedAt, today),
      };
    });
}

/**
 * Situação de pagamento de cada invoice (pelo total dos itens dela e pelos pagamentos). Vazio para
 * quem não vê valores: o servidor não manda pagamentos para o leitor.
 */
export function invoicePayments(invoices: readonly Invoice[], items: readonly Item[], payments: readonly Payment[], seeValues: boolean): Map<string, PaymentSummary> {
  const map = new Map<string, PaymentSummary>();
  if (!seeValues) return map;
  for (const invoice of invoices) {
    map.set(
      invoice.id,
      paymentSummary(
        invoiceTotal(items.filter((i) => i.invoiceId === invoice.id)),
        payments.filter((p) => p.invoiceId === invoice.id),
      ),
    );
  }
  return map;
}

export interface ShippedFilters {
  query: string;
  /** Id do fornecedor; "" para todos. */
  supplierId: string;
  /** Chave do embarque; "" para todos. */
  unitKey: string;
  /** Situação de pagamento da invoice; "" para todas. */
  payment: PaymentStatus | '';
}

export const EMPTY_SHIPPED_FILTERS: ShippedFilters = { query: '', supplierId: '', unitKey: '', payment: '' };

/** Busca (produto, ISBN, PO, fornecedor, invoice, ref. e BL, sem acento) e filtros. */
export function filterShipped(
  rows: readonly ShippedRow[],
  filters: ShippedFilters,
  orders: readonly PurchaseOrder[],
  suppliers: readonly Supplier[],
  payments: ReadonlyMap<string, PaymentSummary> = new Map(),
): ShippedRow[] {
  const codes = new Map(orders.map((o) => [o.id, o.code]));
  const names = new Map(suppliers.map((s) => [s.id, s.name]));
  const words = searchKey(filters.query).split(' ').filter(Boolean);
  return rows.filter((r) => {
    if (filters.supplierId && r.item.supplierId !== filters.supplierId) return false;
    if (filters.unitKey && r.unitKey !== filters.unitKey) return false;
    if (filters.payment && (!r.invoice || payments.get(r.invoice.id)?.status !== filters.payment)) return false;
    if (!words.length) return true;
    const hay = searchKey(
      [
        r.item.description,
        r.item.isbn ?? '',
        r.item.purchaseOrderId ? (codes.get(r.item.purchaseOrderId) ?? '') : NO_ORDER,
        r.item.supplierId ? (names.get(r.item.supplierId) ?? '') : NO_SUPPLIER,
        r.invoice?.number ?? '',
        r.invoice?.ref ?? '',
        r.bill?.number ?? '',
        r.item.notes,
      ].join(' '),
    );
    return words.every((w) => hay.includes(w));
  });
}

export const SHIPPED_SORT_KEYS = ['description', 'shipment', 'supplier', 'arrival', 'quantity', 'price', 'total'] as const;
export type ShippedSortKey = (typeof SHIPPED_SORT_KEYS)[number];
export interface ShippedSort {
  key: ShippedSortKey;
  dir: 1 | -1;
}

/** Ordena a tabela; sem previsão, sem preço ou sem invoice vão sempre para o fim. */
export function sortShipped(rows: readonly ShippedRow[], sort: ShippedSort, suppliers: readonly Supplier[]): ShippedRow[] {
  const names = new Map(suppliers.map((s) => [s.id, s.name]));
  const value = (r: ShippedRow): string | number | null => {
    switch (sort.key) {
      case 'description':
        return searchKey(r.item.description);
      case 'shipment':
        return r.unitKey === 'sem' ? null : searchKey(r.unitLabel);
      case 'supplier':
        return r.item.supplierId ? searchKey(names.get(r.item.supplierId) ?? '') : null;
      case 'arrival':
        return r.eta;
      case 'quantity':
        return r.item.quantity;
      case 'price':
        return r.item.unitPriceMicros ?? null;
      case 'total':
        return r.item.totalCents ?? totalOf(r.item);
    }
  };
  return [...rows].sort((a, b) => {
    const x = value(a);
    const y = value(b);
    if (x === null || y === null) return x === y ? 0 : x === null ? 1 : -1;
    const c = typeof x === 'number' && typeof y === 'number' ? x - y : compareOrderCodes(String(x), String(y));
    return c * sort.dir;
  });
}

export interface ShippedGroup extends Totals {
  unitKey: string;
  label: string;
  eta: string | null;
  state: ArrivalState;
  /** Invoices do embarque com itens na lista, na ordem em que aparecem. */
  invoices: { id: string; number: string }[];
  /** Fornecedores do embarque, em ordem alfabética. */
  suppliers: string[];
}

/** Grupos por embarque, na ordem da tela de embarques (em liberação e mais próximos primeiro). */
export function groupShipped(rows: readonly ShippedRow[], bills: readonly Bill[], invoices: readonly Invoice[], suppliers: readonly Supplier[], today: string, seeValues: boolean): ShippedGroup[] {
  const names = new Map(suppliers.map((s) => [s.id, s.name]));
  const order = new Map(shipmentUnits(bills, invoices, today).map((u, i) => [u.key, i]));
  const byKey = new Map<string, ShippedRow[]>();
  for (const r of rows) byKey.set(r.unitKey, [...(byKey.get(r.unitKey) ?? []), r]);
  return [...byKey.entries()]
    .sort(([a], [b]) => (order.get(a) ?? Infinity) - (order.get(b) ?? Infinity))
    .map(([unitKey, list]) => ({
      ...totals(
        list.map((r) => r.item),
        seeValues,
      ),
      unitKey,
      label: list[0]!.unitLabel,
      eta: list[0]!.eta,
      state: list[0]!.state,
      invoices: [...new Map(list.filter((r) => r.invoice).map((r) => [r.invoice!.id, { id: r.invoice!.id, number: r.invoice!.number }])).values()],
      suppliers: [...new Set(list.map((r) => (r.item.supplierId ? (names.get(r.item.supplierId) ?? NO_SUPPLIER) : NO_SUPPLIER)))].sort((a, b) => a.localeCompare(b, 'pt-BR')),
    }));
}

/**
 * O que o perfil Embarques recebe (SPEC.md, seção 4): só os itens no mar, as invoices e os BLs deles,
 * e as POs e os fornecedores que esses itens citam. Nada da produção nem do que já chegou.
 */
export function onlyShipped<T extends { items: Item[]; invoices: Invoice[]; bills: Bill[]; orders: PurchaseOrder[]; suppliers: Supplier[] }>(data: T): T {
  const items = data.items.filter((i) => i.status === 'embarcado');
  const invoiceIds = new Set(items.map((i) => i.invoiceId));
  const invoices = data.invoices.filter((v) => invoiceIds.has(v.id));
  const billIds = new Set(invoices.map((v) => v.billId));
  const orderIds = new Set(items.map((i) => i.purchaseOrderId));
  const supplierIds = new Set([...items.map((i) => i.supplierId), ...invoices.map((v) => v.supplierId)]);
  return {
    ...data,
    items,
    invoices,
    bills: data.bills.filter((b) => billIds.has(b.id)),
    orders: data.orders.filter((o) => orderIds.has(o.id)),
    suppliers: data.suppliers.filter((s) => supplierIds.has(s.id)),
  };
}

type Noted = { notes: string };
type FromSupplier = Noted & { supplierId: string | null };

/**
 * Os dados para quem não vê os fornecedores (o perfil Embarques, que o marketing usa: pedido do Gabriel
 * em 24/11/2026). Sai a lista de fornecedores e o fornecedor de cada item e invoice; saem também as
 * observações dos itens, das invoices, dos BLs e das POs, porque podem citar o fornecedor (o próprio
 * sistema escreve "Não estava na produção da Claire"). Vale para /api/data e para /api/history.
 */
export function withoutSuppliers<T extends { suppliers: Supplier[]; items: FromSupplier[]; invoices: FromSupplier[]; bills?: Noted[]; orders?: Noted[] }>(data: T): T {
  const anonymous = <U extends FromSupplier>(x: U): U => ({ ...x, supplierId: null, notes: '' });
  const quiet = <U extends Noted>(x: U): U => ({ ...x, notes: '' });
  const out = { ...data, suppliers: [], items: data.items.map(anonymous), invoices: data.invoices.map(anonymous) };
  if (data.bills) out.bills = data.bills.map(quiet);
  if (data.orders) out.orders = data.orders.map(quiet);
  return out;
}

export interface SalesArrival {
  productId: string;
  description: string;
  isbn: string | null;
  /** Chegada prevista (AAAA-MM-DD), ou null sem previsão. */
  eta: string | null;
  state: ArrivalState;
}

/**
 * O que o perfil Vendas vê (SPEC.md, seção 4): os produtos a caminho e a previsão de chegada, nada
 * mais. O mesmo produto em vários itens com a mesma chegada vira uma linha; em embarques com chegadas
 * diferentes, uma linha por chegada. Da chegada mais próxima para a mais distante; sem previsão no fim.
 */
export function salesArrivals(items: readonly Item[], invoices: readonly Invoice[], bills: readonly Bill[], today: string): SalesArrival[] {
  const byKey = new Map<string, SalesArrival>();
  for (const r of shippedRows(items, invoices, bills, today)) {
    const key = `${r.item.productId}|${r.eta ?? ''}`;
    if (!byKey.has(key)) byKey.set(key, { productId: r.item.productId, description: r.item.description, isbn: r.item.isbn, eta: r.eta, state: r.state });
  }
  return [...byKey.values()].sort((a, b) => {
    if (a.eta === b.eta) return a.description.localeCompare(b.description, 'pt-BR');
    if (!a.eta) return 1;
    if (!b.eta) return -1;
    return a.eta.localeCompare(b.eta);
  });
}
