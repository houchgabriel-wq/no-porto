// Carga da aba Embarques da planilha status_importações (SPEC.md, seção 7): cada linha é um item
// embarcado, com a ref. do embarque, a invoice, o BL, a chegada prevista e se está pago.

import { clean, findHeader, readItemCells, type RowNote } from './importProduction';
import { itemTotalCents } from './money';
import { NO_SUPPLIER, searchKey } from './items';
import { parseDate } from './shipments';

export interface ImportedShipmentItem {
  row: number;
  description: string;
  isbn: string | null;
  supplier: string | null;
  quantity: number;
  piecesPerCarton: number | null;
  unitPriceMicros: number | null;
  notes: string;
  invoice: string;
  ref: string;
  bill: string | null;
  /** Chegada prevista (AAAA-MM-DD). */
  eta: string | null;
  paid: boolean;
}

export interface ShipmentImportReport {
  items: ImportedShipmentItem[];
  skipped: RowNote[];
  warnings: RowNote[];
}

const EXTRA = {
  ref: ['ref. embarque', 'ref embarque'],
  eta: ['chegada', 'previsao de chegada'],
  payment: ['pagamento'],
  invoice: ['invoice'],
  bill: ['bl'],
} as const;

/**
 * A ref. às vezes virou data no Google Planilhas ("2026-10-26" → 26/10/2026): volta para o texto
 * original, no formato AAAA-MM-DD.
 */
function refText(text: string): string {
  const t = clean(text);
  if (t === '-') return '';
  const date = /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(t) ? parseDate(t) : null;
  return date ?? t;
}

export function parseShipmentRows(rows: readonly string[][]): ShipmentImportReport | { error: string } {
  const header = findHeader(rows, EXTRA);
  if (!header) return { error: 'Não achei o cabeçalho da aba Embarques (a linha com "Produto" e "Quantidade").' };
  const { cols } = header;
  if (cols.description === undefined || cols.quantity === undefined || cols.invoice === undefined) {
    return { error: 'A aba precisa das colunas "Produto", "Quantidade" e "Invoice".' };
  }
  const cell = (row: string[], col: keyof typeof cols) => (cols[col] === undefined ? '' : (row[cols[col]!] ?? ''));

  const report: ShipmentImportReport = { items: [], skipped: [], warnings: [] };
  for (let i = header.index + 1; i < rows.length; i++) {
    const row = rows[i]!;
    const line = i + 1;
    // Linhas de preenchimento ("-" e total 0) não são itens.
    if (row.every((c) => ['', '-', '0'].includes(clean(c)))) continue;
    const warn = (message: string) => report.warnings.push({ row: line, message });
    const cells = readItemCells((col) => cell(row, col), warn);
    if ('skip' in cells) {
      report.skipped.push({ row: line, message: cells.skip });
      continue;
    }
    const invoice = clean(cell(row, 'invoice'));
    if (!invoice) {
      report.skipped.push({ row: line, message: `"${cells.description}": sem invoice.` });
      continue;
    }
    const { notes, ...fields } = cells;
    const etaText = clean(cell(row, 'eta'));
    const eta = etaText ? parseDate(etaText) : null;
    if (etaText && !eta) notes.push(`Chegada na planilha: ${etaText}`);
    const bill = clean(cell(row, 'bill')) || null;
    if (!bill) warn(`"${cells.description}": invoice ${invoice} sem BL; a chegada prevista fica na invoice.`);
    const paid = /^pago/i.test(clean(cell(row, 'payment')));
    report.items.push({ row: line, ...fields, notes: notes.join('\n'), invoice, ref: refText(cell(row, 'ref')), bill, eta, paid });
  }
  return report;
}

export interface ShipmentSummaryRow {
  bill: string | null;
  invoice: string;
  ref: string;
  supplier: string;
  eta: string | null;
  items: number;
  quantity: number;
  valueCents: number;
  paid: boolean;
}

/** Resumo por invoice (na ordem da planilha), para comparar antes de gravar. */
export function summarizeShipments(items: readonly ImportedShipmentItem[]): { invoices: ShipmentSummaryRow[]; bills: number; total: { items: number; quantity: number; valueCents: number } } {
  const byInvoice = new Map<string, ShipmentSummaryRow>();
  const total = { items: 0, quantity: 0, valueCents: 0 };
  for (const item of items) {
    const key = `${searchKey(item.supplier ?? '')}|${item.invoice.toUpperCase()}`;
    const row = byInvoice.get(key) ?? { bill: item.bill, invoice: item.invoice, ref: item.ref, supplier: item.supplier ?? NO_SUPPLIER, eta: item.eta, items: 0, quantity: 0, valueCents: 0, paid: item.paid };
    byInvoice.set(key, row);
    const value = item.unitPriceMicros === null ? 0 : itemTotalCents(item.quantity, item.unitPriceMicros);
    row.items += 1;
    row.quantity += item.quantity;
    row.valueCents += value;
    total.items += 1;
    total.quantity += item.quantity;
    total.valueCents += value;
  }
  const bills = new Set(items.map((i) => i.bill?.toUpperCase()).filter(Boolean)).size;
  return { invoices: [...byInvoice.values()], bills, total };
}

/** Chave para não repetir a carga: invoice, ISBN, nome do produto, quantidade e preço. */
export function shipmentKey(item: { invoice: string; isbn: string | null; description: string; quantity: number; unitPriceMicros: number | null }): string {
  return [item.invoice.toUpperCase(), item.isbn ?? '', searchKey(item.description), item.quantity, item.unitPriceMicros ?? ''].join('|');
}
