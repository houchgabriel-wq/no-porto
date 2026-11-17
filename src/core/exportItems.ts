// Planilha dos itens em produção para baixar: as colunas da aba Produção, com preço e total só para
// quem vê valores.

import { NO_ORDER, NO_SUPPLIER, type Item, type PurchaseOrder, type Supplier } from './items';

export interface ItemExportRow {
  po: string;
  supplier: string;
  description: string;
  isbn: string;
  quantity: number;
  piecesPerCarton: number | null;
  /** Em dólar, com as casas do preço; ausente para quem não vê valores. */
  unitPrice?: number | null;
  total?: number | null;
  notes: string;
}

export function itemExportRows(items: readonly Item[], orders: readonly PurchaseOrder[], suppliers: readonly Supplier[], seeValues: boolean): ItemExportRow[] {
  const codes = new Map(orders.map((o) => [o.id, o.code]));
  const names = new Map(suppliers.map((s) => [s.id, s.name]));
  return items.map((i) => {
    const row: ItemExportRow = {
      po: i.purchaseOrderId ? (codes.get(i.purchaseOrderId) ?? '') : NO_ORDER,
      supplier: i.supplierId ? (names.get(i.supplierId) ?? '') : NO_SUPPLIER,
      description: i.description,
      isbn: i.isbn ?? '',
      quantity: i.quantity,
      piecesPerCarton: i.piecesPerCarton,
      notes: i.notes,
    };
    if (seeValues) {
      // Para a planilha, número em dólar (o Excel soma e formata).
      row.unitPrice = i.unitPriceMicros == null ? null : i.unitPriceMicros / 1_000_000;
      row.total = i.totalCents == null ? null : i.totalCents / 100;
    }
    return row;
  });
}
