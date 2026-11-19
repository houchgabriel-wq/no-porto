// Planilha dos itens em produção para baixar: as colunas da aba Produção, com preço e total só para
// quem vê valores, e o código de cada item no fim, para a planilha voltar pelo "Atualizar pela planilha".

import { NO_ORDER, NO_SUPPLIER, type Item, type PurchaseOrder, type Supplier } from './items';
import { shipPlanText } from './shipPlan';
import { ITEM_CODE_HEADER, itemCode, SHEET_FIELD_LABELS } from './updateSheet';

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
  /** Aprovação do arquivo, como dd/mm/aaaa (vazio quando não há). */
  fileApproved: string;
  /** Programação de envio: "dez/2026: 20.000; fev/2027: 20.000" (vazio quando não há). */
  shipPlanned: string;
  notes: string;
  /** Código do item, com a marca dos campos que mudam pela planilha (updateSheet.ts). */
  code: string;
}

/** AAAA-MM-DD → dd/mm/aaaa. */
const br = (iso: string | null | undefined) => (iso ? iso.split('-').reverse().join('/') : '');

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
      fileApproved: br(i.fileApprovedAt),
      shipPlanned: shipPlanText(i.shipPlan ?? []),
      notes: i.notes,
      code: itemCode(i),
    };
    if (seeValues) {
      // Para a planilha, número em dólar (o Excel soma e formata).
      row.unitPrice = i.unitPriceMicros == null ? null : i.unitPriceMicros / 1_000_000;
      row.total = i.totalCents == null ? null : i.totalCents / 100;
    }
    return row;
  });
}

/** Uma coluna da planilha para baixar (a forma de ExportColumn, em src/app/spreadsheet.ts). */
export interface ItemExportColumn {
  header: string;
  width: number;
  value: (row: ItemExportRow) => string | number | null;
  /** Formato de número do Excel. */
  numFmt?: string;
  /** Texto em cinza: a coluna é do sistema, não da pessoa. */
  muted?: boolean;
}

/** As colunas do "Baixar .xlsx" da Produção; preço e total só para quem vê valores; o código do item no fim. */
export function productionExportColumns(seeValues: boolean): ItemExportColumn[] {
  const columns: ItemExportColumn[] = [
    { header: 'PO', width: 10, value: (r) => r.po },
    { header: 'Fornecedor', width: 14, value: (r) => r.supplier },
    { header: 'Produto', width: 60, value: (r) => r.description },
    { header: 'ISBN', width: 16, value: (r) => r.isbn },
    { header: 'Quantidade', width: 12, value: (r) => r.quantity, numFmt: '#,##0' },
    { header: 'pcs/ctn', width: 9, value: (r) => r.piecesPerCarton },
  ];
  if (seeValues) {
    columns.push({ header: '$ unitário', width: 12, value: (r) => r.unitPrice ?? null, numFmt: '0.00#' });
    columns.push({ header: '$ total', width: 14, value: (r) => r.total ?? null, numFmt: '#,##0.00' });
  }
  columns.push({ header: SHEET_FIELD_LABELS.fileApprovedAt, width: 14, value: (r) => r.fileApproved });
  columns.push({ header: SHEET_FIELD_LABELS.shipPlan, width: 14, value: (r) => r.shipPlanned });
  columns.push({ header: SHEET_FIELD_LABELS.notes, width: 40, value: (r) => r.notes });
  columns.push({ header: ITEM_CODE_HEADER, width: 26, value: (r) => r.code, muted: true });
  return columns;
}
