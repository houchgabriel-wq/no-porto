// Itens de pedido: situação, totais por fornecedor e por PO, busca e o que o leitor não vê
// (SPEC.md, seções 3, 4 e 6).

import { itemTotalCents } from './money';
import { parcelPassed, type ShipPlan } from './shipPlan';

export const ITEM_STATUSES = ['producao', 'embarcado', 'entregue'] as const;
export type ItemStatus = (typeof ITEM_STATUSES)[number];

export const STATUS_LABELS: Record<ItemStatus, string> = {
  producao: 'Em produção',
  embarcado: 'Embarcado',
  entregue: 'Entregue',
};

/** Matiz de cada situação, o mesmo nas telas de entrada, no painel e nas etiquetas. */
export const STATUS_HUES: Record<ItemStatus, number> = { producao: 32, embarcado: 200, entregue: 150 };

export interface Supplier {
  id: string;
  name: string;
}

export interface PurchaseOrder {
  id: string;
  code: string;
  orderedAt: string | null;
  notes: string;
}

export interface Item {
  id: string;
  productId: string;
  isbn: string | null;
  description: string;
  supplierId: string | null;
  purchaseOrderId: string | null;
  /** Invoice em que o item embarcou; null enquanto está em produção. */
  invoiceId: string | null;
  status: ItemStatus;
  quantity: number;
  piecesPerCarton: number | null;
  /** Ausente para quem não vê valores (o leitor). null: item sem preço. */
  unitPriceMicros?: number | null;
  /** Ausente para quem não vê valores. null: item sem preço. */
  totalCents?: number | null;
  notes: string;
  /** Especificação do produto: só na cópia completa (as telas carregam ao abrir a ficha). */
  specification?: string;
  /** Dia (AAAA-MM-DD) em que o arquivo do livro foi aprovado; null enquanto não foi (19/11/2026). */
  fileApprovedAt?: string | null;
  /** 'noprelo' quando a aprovação do arquivo veio do No Prelo (e só muda lá); null quando foi digitada. */
  fileApprovedFrom?: string | null;
  /** Programação de envio: até três embarques (mês e quantidade), do mais próximo para o mais distante. */
  shipPlan?: ShipPlan;
  createdAt: string;
  updatedAt: string;
}

/** Total do item, ou null quando não tem preço. */
export function totalOf(item: Pick<Item, 'quantity' | 'unitPriceMicros'>): number | null {
  return item.unitPriceMicros === null || item.unitPriceMicros === undefined ? null : itemTotalCents(item.quantity, item.unitPriceMicros);
}

/** Item como sai da API: com preço e total para quem vê valores; sem os dois campos para o leitor. */
export function itemForViewer<T extends Item>(item: T, seeValues: boolean): T {
  if (seeValues) return { ...item, totalCents: totalOf(item) };
  const { unitPriceMicros: _p, totalCents: _t, ...rest } = item;
  return rest as T;
}

/** Texto para comparar sem acento, maiúscula nem espaço sobrando. */
export function searchKey(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Chave do produto sem ISBN: o título normalizado. */
export const titleKey = searchKey;

export interface Totals {
  items: number;
  quantity: number;
  /** Soma dos itens com preço; ausente para quem não vê valores. */
  valueCents?: number;
  /** Itens sem preço (não entram na soma). */
  unpriced: number;
}

function emptyTotals(seeValues: boolean): Totals {
  return seeValues ? { items: 0, quantity: 0, valueCents: 0, unpriced: 0 } : { items: 0, quantity: 0, unpriced: 0 };
}

function add(t: Totals, item: Item): void {
  t.items += 1;
  t.quantity += item.quantity;
  // Sem valores (leitor), conta só itens e exemplares.
  if (t.valueCents === undefined) return;
  const total = item.totalCents ?? totalOf(item);
  if (total === null) t.unpriced += 1;
  else t.valueCents += total;
}

export function totals(items: readonly Item[], seeValues: boolean): Totals {
  const t = emptyTotals(seeValues);
  for (const item of items) add(t, item);
  return t;
}

export interface SupplierTotals extends Totals {
  supplierId: string | null;
  name: string;
}

export const NO_SUPPLIER = 'Sem fornecedor';
export const NO_ORDER = 'Sem PO';

/** Totais por fornecedor, do maior para o menor (valor para quem vê valores; senão, exemplares). */
export function totalsBySupplier(items: readonly Item[], suppliers: readonly Supplier[], seeValues: boolean): SupplierTotals[] {
  const names = new Map(suppliers.map((s) => [s.id, s.name]));
  const groups = new Map<string | null, SupplierTotals>();
  for (const item of items) {
    let g = groups.get(item.supplierId);
    if (!g) {
      g = { supplierId: item.supplierId, name: item.supplierId ? (names.get(item.supplierId) ?? NO_SUPPLIER) : NO_SUPPLIER, ...emptyTotals(seeValues) };
      groups.set(item.supplierId, g);
    }
    add(g, item);
  }
  return [...groups.values()].sort((a, b) => (b.valueCents ?? b.quantity) - (a.valueCents ?? a.quantity) || a.name.localeCompare(b.name, 'pt-BR'));
}

export interface OrderTotals extends Totals {
  orderId: string | null;
  code: string;
  /** Fornecedores da PO, em ordem alfabética. */
  suppliers: string[];
}

/** Ordem natural das POs: PO-003 antes de PO-010. */
export function compareOrderCodes(a: string, b: string): number {
  return a.localeCompare(b, 'pt-BR', { numeric: true, sensitivity: 'base' });
}

/** Totais por PO, da PO mais nova (maior número) para a mais antiga, com "Sem PO" no fim. */
export function totalsByOrder(
  items: readonly Item[],
  orders: readonly PurchaseOrder[],
  suppliers: readonly Supplier[],
  seeValues: boolean,
): OrderTotals[] {
  const codes = new Map(orders.map((o) => [o.id, o.code]));
  const names = new Map(suppliers.map((s) => [s.id, s.name]));
  const groups = new Map<string | null, OrderTotals & { names: Set<string> }>();
  for (const item of items) {
    let g = groups.get(item.purchaseOrderId);
    if (!g) {
      const code = item.purchaseOrderId ? (codes.get(item.purchaseOrderId) ?? NO_ORDER) : NO_ORDER;
      g = { orderId: item.purchaseOrderId, code, suppliers: [], names: new Set(), ...emptyTotals(seeValues) };
      groups.set(item.purchaseOrderId, g);
    }
    add(g, item);
    g.names.add(item.supplierId ? (names.get(item.supplierId) ?? NO_SUPPLIER) : NO_SUPPLIER);
  }
  return [...groups.values()]
    .map(({ names: n, ...g }) => ({ ...g, suppliers: [...n].sort((a, b) => a.localeCompare(b, 'pt-BR')) }))
    .sort((a, b) => {
      if (a.orderId === null) return b.orderId === null ? 0 : 1;
      if (b.orderId === null) return -1;
      return compareOrderCodes(b.code, a.code);
    });
}

export interface ItemFilters {
  query: string;
  /** Id do fornecedor; "" para todos; "sem" para os itens sem fornecedor. */
  supplierId: string;
  /** Id da PO; "" para todas; "sem" para os itens sem PO. */
  orderId: string;
}

export const EMPTY_FILTERS: ItemFilters = { query: '', supplierId: '', orderId: '' };

/** Busca (produto, ISBN, PO, fornecedor e observações, sem acento) e filtros de fornecedor e PO. */
export function filterItems(
  items: readonly Item[],
  filters: ItemFilters,
  orders: readonly PurchaseOrder[],
  suppliers: readonly Supplier[],
): Item[] {
  const codes = new Map(orders.map((o) => [o.id, o.code]));
  const names = new Map(suppliers.map((s) => [s.id, s.name]));
  const words = searchKey(filters.query).split(' ').filter(Boolean);
  return items.filter((item) => {
    if (filters.supplierId === 'sem' ? item.supplierId !== null : filters.supplierId && item.supplierId !== filters.supplierId) return false;
    if (filters.orderId === 'sem' ? item.purchaseOrderId !== null : filters.orderId && item.purchaseOrderId !== filters.orderId) return false;
    if (words.length === 0) return true;
    const hay = searchKey(
      [
        item.description,
        item.isbn ?? '',
        item.purchaseOrderId ? (codes.get(item.purchaseOrderId) ?? '') : NO_ORDER,
        item.supplierId ? (names.get(item.supplierId) ?? '') : NO_SUPPLIER,
        item.notes,
      ].join(' '),
    );
    return words.every((w) => hay.includes(w));
  });
}

/** O primeiro embarque programado já devia ter saído e o item continua em produção (a tela destaca). */
export function shipPlanPassed(item: Pick<Item, 'status' | 'shipPlan'>, today: string): boolean {
  const first = item.shipPlan?.[0];
  return item.status === 'producao' && !!first && parcelPassed(first.month, today);
}

/** Código de PO como a editora usa: "PO-063". Aceita "po 63", "PO-63", "po063". */
export function normalizeOrderCode(text: string): string | null {
  const m = /^\s*PO[\s-]*(\d{1,6})\s*$/i.exec(text);
  if (!m) return null;
  return `PO-${m[1]!.padStart(3, '0')}`;
}

export const SORT_KEYS = ['description', 'order', 'supplier', 'fileApproved', 'shipPlanned', 'quantity', 'price', 'total'] as const;
export type SortKey = (typeof SORT_KEYS)[number];
export interface ItemSort {
  key: SortKey;
  dir: 1 | -1;
}

/**
 * Ordena a tabela. Itens sem preço, sem PO ou sem a data vão sempre para o fim, nos dois sentidos, para
 * não esconder os itens com dados no começo da lista.
 */
export function sortItems(items: readonly Item[], sort: ItemSort, orders: readonly PurchaseOrder[], suppliers: readonly Supplier[]): Item[] {
  const codes = new Map(orders.map((o) => [o.id, o.code]));
  const names = new Map(suppliers.map((s) => [s.id, s.name]));
  const value = (item: Item): string | number | null => {
    switch (sort.key) {
      case 'description':
        return searchKey(item.description);
      case 'order':
        return item.purchaseOrderId ? (codes.get(item.purchaseOrderId) ?? null) : null;
      case 'supplier':
        return item.supplierId ? searchKey(names.get(item.supplierId) ?? '') : null;
      case 'fileApproved':
        return item.fileApprovedAt ?? null;
      case 'shipPlanned':
        return item.shipPlan?.[0]?.month ?? null;
      case 'quantity':
        return item.quantity;
      case 'price':
        return item.unitPriceMicros ?? null;
      case 'total':
        return item.totalCents ?? totalOf(item);
    }
  };
  return [...items].sort((a, b) => {
    const x = value(a);
    const y = value(b);
    if (x === null || y === null) return x === y ? 0 : x === null ? 1 : -1;
    const c = typeof x === 'number' && typeof y === 'number' ? x - y : compareOrderCodes(String(x), String(y));
    return c * sort.dir;
  });
}

/**
 * Uma PO tem um fornecedor só (decidido pelo Gabriel em 17/11/2026). O dono de cada PO é o fornecedor
 * com mais itens nela; no empate, o do primeiro item. Itens sem fornecedor não contam nem atrapalham.
 * Recebe os itens na ordem em que foram cadastrados (ou em que aparecem na planilha).
 */
export function orderOwners<T>(items: readonly { order: T | null; supplier: string | null }[]): Map<T, string> {
  const counts = new Map<T, Map<string, { n: number; first: number }>>();
  items.forEach((item, i) => {
    if (item.order === null || item.supplier === null) return;
    const bySupplier = counts.get(item.order) ?? new Map<string, { n: number; first: number }>();
    counts.set(item.order, bySupplier);
    const c = bySupplier.get(item.supplier) ?? { n: 0, first: i };
    c.n += 1;
    bySupplier.set(item.supplier, c);
  });
  const owners = new Map<T, string>();
  for (const [order, bySupplier] of counts) {
    let best: [string, { n: number; first: number }] | null = null;
    for (const entry of bySupplier) if (!best || entry[1].n > best[1].n || (entry[1].n === best[1].n && entry[1].first < best[1].first)) best = entry;
    owners.set(order, best![0]);
  }
  return owners;
}

/**
 * Confere se o item pode ficar na PO: a PO não pode ter itens de outro fornecedor. `others` são os
 * fornecedores dos outros itens da PO. Devolve a mensagem de erro, ou null.
 */
export function orderSupplierProblem(orderCode: string, supplier: { id: string; name: string } | null, others: readonly { id: string; name: string }[]): string | null {
  if (!supplier) return null;
  const foreign = others.filter((o) => o.id !== supplier.id);
  if (foreign.length === 0) return null;
  const names = [...new Set(foreign.map((o) => o.name))].join(' e ');
  return `A ${orderCode} é de ${names}. Uma PO tem um fornecedor só: use outra PO para o item de ${supplier.name}.`;
}
