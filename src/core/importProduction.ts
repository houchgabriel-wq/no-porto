// Carga da aba Produção da planilha status_importações (SPEC.md, seção 7). Lê as linhas já
// convertidas em texto, separa o que entra, o que é descartado e o que precisa de conferência, e
// monta o resumo que o Gabriel compara com a planilha antes de gravar.

import { isbnDigits, isbnProblem } from './isbn';
import { searchKey, normalizeOrderCode, NO_SUPPLIER } from './items';
import { itemTotalCents, looksLikeReais, parseCents, parseSheetUnitPrice } from './money';

/** Itens por envio ao servidor; a planilha vai em partes deste tamanho. */
export const IMPORT_BATCH = 500;
/** Limite de linhas lidas de uma aba. */
export const IMPORT_MAX_ROWS = 10_000;

export interface ImportedItem {
  /** Linha da planilha (contando o cabeçalho), para a pessoa achar o item. */
  row: number;
  description: string;
  isbn: string | null;
  supplier: string | null;
  orderCode: string | null;
  quantity: number;
  piecesPerCarton: number | null;
  unitPriceMicros: number | null;
  notes: string;
}

export interface RowNote {
  row: number;
  message: string;
}

export interface ImportReport {
  items: ImportedItem[];
  /** Linhas que não entram, com o motivo. */
  skipped: RowNote[];
  /** Linhas que entram, mas pedem conferência. */
  warnings: RowNote[];
}

const HEADERS = {
  description: ['produto'],
  isbn: ['isbn'],
  piecesPerCarton: ['pcs/ctn', 'pecas por caixa'],
  quantity: ['quantidade', 'qtd'],
  unitPrice: ['$ unitario', 'preco unitario', 'us$ unitario'],
  total: ['$ total', 'total'],
  supplier: ['fornecedor'],
} as const;

type Column = keyof typeof HEADERS;

const PO_PATTERN = /^\s*PO[\s-]*\d+\s*$/i;

/** Texto numa linha só, sem espaços repetidos (a planilha tem quebras de linha dentro das células). */
function clean(text: string | undefined): string {
  return (text ?? '').replace(/\s+/g, ' ').trim();
}

function parseCount(text: string): number | null {
  const t = clean(text).replace(/\.0+$/, '');
  if (!/^\d+$/.test(t)) return null;
  const n = Number(t);
  return n > 0 && Number.isSafeInteger(n) ? n : null;
}

/** Acha o cabeçalho (a linha com Produto e Quantidade) e a posição de cada coluna. */
function findHeader(rows: readonly string[][]): { index: number; cols: Partial<Record<Column, number>>; orderCol: number | null } | null {
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const keys = rows[i]!.map((c) => searchKey(c));
    if (!keys.includes('produto') || !keys.some((k) => (HEADERS.quantity as readonly string[]).includes(k))) continue;
    const cols: Partial<Record<Column, number>> = {};
    for (const [col, names] of Object.entries(HEADERS) as [Column, readonly string[]][]) {
      const at = keys.findIndex((k) => names.includes(k));
      if (at >= 0) cols[col] = at;
    }
    // A coluna da PO não tem título: é a coluna sem título com mais códigos "PO-0xx".
    let orderCol: number | null = null;
    let best = 0;
    const width = Math.max(...rows.slice(i, i + 2000).map((r) => r.length));
    for (let c = 0; c < width; c++) {
      if (keys[c]) continue;
      let count = 0;
      for (let r = i + 1; r < Math.min(rows.length, i + 2000); r++) if (PO_PATTERN.test(rows[r]![c] ?? '')) count++;
      if (count > best) {
        best = count;
        orderCol = c;
      }
    }
    return { index: i, cols, orderCol };
  }
  return null;
}

export function parseProductionRows(rows: readonly string[][]): ImportReport | { error: string } {
  const header = findHeader(rows);
  if (!header) return { error: 'Não achei o cabeçalho da aba Produção (a linha com "Produto" e "Quantidade").' };
  const { cols, orderCol } = header;
  if (cols.description === undefined || cols.quantity === undefined) {
    return { error: 'A aba precisa das colunas "Produto" e "Quantidade".' };
  }
  const cell = (row: string[], col: Column) => (cols[col] === undefined ? '' : (row[cols[col]!] ?? ''));

  const report: ImportReport = { items: [], skipped: [], warnings: [] };
  for (let i = header.index + 1; i < rows.length; i++) {
    const row = rows[i]!;
    const line = i + 1;
    if (row.every((c) => !clean(c))) continue;
    const warn = (message: string) => report.warnings.push({ row: line, message });

    const description = clean(cell(row, 'description'));
    if (!/[\p{L}\d]/u.test(description)) {
      report.skipped.push({ row: line, message: description ? `Linha de soma ou sem produto ("${description}").` : 'Linha sem produto.' });
      continue;
    }
    const quantity = parseCount(cell(row, 'quantity'));
    if (quantity === null) {
      report.skipped.push({ row: line, message: `"${description}": quantidade inválida ("${clean(cell(row, 'quantity'))}").` });
      continue;
    }

    const notes: string[] = [];

    const isbnText = clean(cell(row, 'isbn'));
    let isbn: string | null = null;
    if (isbnText) {
      if (isbnProblem(isbnText) === null) isbn = isbnDigits(isbnText);
      else {
        notes.push(`ISBN informado na planilha: ${isbnText}`);
        warn(`"${description}": ISBN "${isbnText}" não é válido; o item entra sem ISBN.`);
      }
    }

    const supplier = clean(cell(row, 'supplier')) || null;
    if (!supplier) warn(`"${description}": sem fornecedor; entra como "${NO_SUPPLIER}".`);

    const piecesText = clean(cell(row, 'piecesPerCarton'));
    const piecesPerCarton = piecesText ? parseCount(piecesText) : null;
    if (piecesText && piecesPerCarton === null) notes.push(`Peças por caixa na planilha: ${(cell(row, 'piecesPerCarton') ?? '').trim()}`);

    const priceText = clean(cell(row, 'unitPrice'));
    let unitPriceMicros: number | null = null;
    if (!priceText) {
      warn(`"${description}": sem preço.`);
    } else if (looksLikeReais(priceText)) {
      notes.push(`Preço na planilha: ${priceText}`);
      warn(`"${description}": preço em reais (${priceText}); entra sem preço em dólar.`);
    } else {
      const price = parseSheetUnitPrice(priceText);
      if (price === null) {
        notes.push(`Preço na planilha: ${priceText}`);
        warn(`"${description}": preço "${priceText}" não reconhecido; entra sem preço.`);
      } else {
        unitPriceMicros = price.micros;
        if (price.rounded) warn(`"${description}": preço ${priceText} arredondado para seis casas.`);
      }
    }
    if (unitPriceMicros !== null) {
      const typed = parseCents(clean(cell(row, 'total')));
      const computed = itemTotalCents(quantity, unitPriceMicros);
      if (typed !== null && typed !== 0 && Math.abs(typed - computed) > 1) {
        warn(`"${description}": o total da planilha não bate com quantidade × preço; vale quantidade × preço.`);
      }
    }

    let orderCode: string | null = null;
    const orderText = orderCol === null ? '' : (row[orderCol] ?? '').trim();
    if (orderText) {
      orderCode = normalizeOrderCode(orderText);
      if (!orderCode) notes.push(`Observação da planilha: ${clean(orderText)}`);
    }

    report.items.push({ row: line, description, isbn, supplier, orderCode, quantity, piecesPerCarton, unitPriceMicros, notes: notes.join('\n') });
  }
  return report;
}

export interface ImportSummaryRow {
  supplier: string;
  items: number;
  quantity: number;
  valueCents: number;
  unpriced: number;
}

/** Resumo por fornecedor (e o total geral no fim), para comparar com a planilha antes de gravar. */
export function summarizeImport(items: readonly ImportedItem[]): { bySupplier: ImportSummaryRow[]; total: ImportSummaryRow; orders: number } {
  const groups = new Map<string, ImportSummaryRow>();
  const total: ImportSummaryRow = { supplier: 'Total', items: 0, quantity: 0, valueCents: 0, unpriced: 0 };
  for (const item of items) {
    const name = item.supplier ?? NO_SUPPLIER;
    const g = groups.get(name) ?? { supplier: name, items: 0, quantity: 0, valueCents: 0, unpriced: 0 };
    groups.set(name, g);
    for (const t of [g, total]) {
      t.items += 1;
      t.quantity += item.quantity;
      if (item.unitPriceMicros === null) t.unpriced += 1;
      else t.valueCents += itemTotalCents(item.quantity, item.unitPriceMicros);
    }
  }
  const orders = new Set(items.map((i) => i.orderCode).filter(Boolean)).size;
  return { bySupplier: [...groups.values()].sort((a, b) => b.valueCents - a.valueCents), total, orders };
}

/**
 * Chave de um item para não repetir a carga: mesma PO, produto (ISBN ou título), quantidade e preço.
 * O servidor usa a mesma chave para pular o que já está cadastrado.
 */
export function importKey(item: { orderCode: string | null; isbn: string | null; description: string; quantity: number; unitPriceMicros: number | null }): string {
  return [item.orderCode ?? '', item.isbn ?? searchKey(item.description), item.quantity, item.unitPriceMicros ?? ''].join('|');
}
