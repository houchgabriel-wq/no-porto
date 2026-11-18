// Carga da aba Produção da planilha status_importações (SPEC.md, seção 7). Lê as linhas já
// convertidas em texto, separa o que entra, o que é descartado e o que precisa de conferência, e
// monta o resumo que o Gabriel compara com a planilha antes de gravar.

import { isbnDigits, isbnProblem } from './isbn';
import { searchKey, normalizeOrderCode, NO_SUPPLIER, orderOwners } from './items';
import { itemTotalCents, looksLikeReais, parseCents, parseSheetUnitPrice } from './money';
import { cleanSpecification } from './specification';

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
  /** Especificação do produto (só na cópia completa do app). */
  specification: string;
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

const ITEM_HEADERS = {
  description: ['produto'],
  isbn: ['isbn'],
  piecesPerCarton: ['pcs/ctn', 'pecas por caixa'],
  quantity: ['quantidade', 'qtd'],
  unitPrice: ['$ unitario', 'preco unitario', 'us$ unitario'],
  total: ['$ total', 'total'],
  supplier: ['fornecedor'],
  // Só na cópia completa do app (a status_importações não tem): a especificação do produto.
  specification: ['especificacao'],
} as const;

const PO_PATTERN = /^\s*PO[\s-]*\d+\s*$/i;

/** Texto numa linha só, sem espaços repetidos (a planilha tem quebras de linha dentro das células). */
export function clean(text: string | undefined): string {
  return (text ?? '').replace(/\s+/g, ' ').trim();
}

function parseCount(text: string): number | null {
  const t = clean(text).replace(/\.0+$/, '');
  if (!/^\d+$/.test(t)) return null;
  const n = Number(t);
  return n > 0 && Number.isSafeInteger(n) ? n : null;
}

export interface SheetHeader<C extends string> {
  index: number;
  cols: Partial<Record<C | keyof typeof ITEM_HEADERS, number>>;
  keys: string[];
}

/**
 * Acha o cabeçalho (a linha com Produto e Quantidade) e a posição de cada coluna: as colunas comuns
 * dos itens e as `extra` de cada aba.
 */
export function findHeader<C extends string>(rows: readonly string[][], extra: Readonly<Record<C, readonly string[]>>): SheetHeader<C> | null {
  const all = { ...ITEM_HEADERS, ...extra } as Record<string, readonly string[]>;
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const keys = rows[i]!.map((c) => searchKey(c));
    if (!keys.includes('produto') || !keys.some((k) => (ITEM_HEADERS.quantity as readonly string[]).includes(k))) continue;
    const cols: Record<string, number> = {};
    for (const [col, names] of Object.entries(all)) {
      const at = keys.findIndex((k) => names.includes(k));
      if (at >= 0) cols[col] = at;
    }
    return { index: i, cols: cols as SheetHeader<C>['cols'], keys };
  }
  return null;
}

export interface ItemCells {
  description: string;
  isbn: string | null;
  supplier: string | null;
  quantity: number;
  piecesPerCarton: number | null;
  unitPriceMicros: number | null;
  notes: string[];
  specification: string;
}

/**
 * Lê as colunas comuns a todas as abas (produto, ISBN, peças por caixa, quantidade, preço, total e
 * fornecedor). Devolve os campos, ou o motivo para a linha não entrar. `warn` registra os avisos.
 */
export function readItemCells(cell: (col: keyof typeof ITEM_HEADERS) => string, warn: (message: string) => void): ItemCells | { skip: string } {
  let description = clean(cell('description'));
  const quantity = parseCount(cell('quantity'));
  // Separador de ano no meio da aba ("2024", "2025").
  if (/^20\d\d$/.test(description) && quantity === null) return { skip: `Separador de ano ("${description}").` };
  if (!/[\p{L}\d]/u.test(description)) {
    // Item sem o nome, mas com ISBN e quantidade: entra com um nome provisório, para não sumir da soma.
    const isbnText = clean(cell('isbn'));
    if (quantity !== null && isbnText && isbnProblem(isbnText) === null) {
      description = `Produto sem nome (ISBN ${isbnDigits(isbnText)})`;
      warn(`"${description}": a linha não tem o nome do produto; entra com este nome provisório.`);
    } else return { skip: description ? `Linha de soma ou sem produto ("${description}").` : 'Linha sem produto.' };
  }
  if (quantity === null) return { skip: `"${description}": quantidade inválida ("${clean(cell('quantity'))}").` };

  const notes: string[] = [];

  const isbnText = clean(cell('isbn'));
  let isbn: string | null = null;
  if (isbnText) {
    if (isbnProblem(isbnText) === null) isbn = isbnDigits(isbnText);
    else {
      notes.push(`ISBN informado na planilha: ${isbnText}`);
      warn(`"${description}": ISBN "${isbnText}" não é válido; o item entra sem ISBN.`);
    }
  }

  const supplier = clean(cell('supplier')) || null;
  if (!supplier) warn(`"${description}": sem fornecedor; entra como "${NO_SUPPLIER}".`);

  const piecesText = clean(cell('piecesPerCarton'));
  const piecesPerCarton = piecesText ? parseCount(piecesText) : null;
  if (piecesText && piecesPerCarton === null) notes.push(`Peças por caixa na planilha: ${cell('piecesPerCarton').trim()}`);

  const priceText = clean(cell('unitPrice'));
  let unitPriceMicros: number | null = null;
  let warnedRounding = false;
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
      if (price.rounded) {
        warnedRounding = true;
        warn(`"${description}": preço ${priceText} arredondado para três casas.`);
      }
    }
  }
  // Com o preço arredondado, o total digitado naturalmente difere um pouco: não avisa de novo.
  if (unitPriceMicros !== null && !warnedRounding) {
    const typed = parseCents(clean(cell('total')));
    const computed = itemTotalCents(quantity, unitPriceMicros);
    if (typed !== null && typed !== 0 && Math.abs(typed - computed) > 1) {
      warn(`"${description}": o total da planilha não bate com quantidade × preço; vale quantidade × preço.`);
    }
  }
  return { description, isbn, supplier, quantity, piecesPerCarton, unitPriceMicros, notes, specification: cleanSpecification(cell('specification')) };
}

/** A coluna da PO não tem título: é a coluna sem título com mais códigos "PO-0xx". */
function findOrderColumn(rows: readonly string[][], header: SheetHeader<string>): number | null {
  let orderCol: number | null = null;
  let best = 0;
  const body = rows.slice(header.index + 1, header.index + 2000);
  const width = Math.max(0, ...body.map((r) => r.length));
  for (let c = 0; c < width; c++) {
    if (header.keys[c]) continue;
    const count = body.filter((r) => PO_PATTERN.test(r[c] ?? '')).length;
    if (count > best) {
      best = count;
      orderCol = c;
    }
  }
  return orderCol;
}

export function parseProductionRows(rows: readonly string[][]): ImportReport | { error: string } {
  const header = findHeader(rows, {});
  if (!header) return { error: 'Não achei o cabeçalho da aba Produção (a linha com "Produto" e "Quantidade").' };
  const { cols } = header;
  if (cols.description === undefined || cols.quantity === undefined) {
    return { error: 'A aba precisa das colunas "Produto" e "Quantidade".' };
  }
  const orderCol = findOrderColumn(rows, header);

  const report: ImportReport = { items: [], skipped: [], warnings: [] };
  for (let i = header.index + 1; i < rows.length; i++) {
    const row = rows[i]!;
    const line = i + 1;
    if (row.every((c) => !clean(c))) continue;
    const warn = (message: string) => report.warnings.push({ row: line, message });
    const cells = readItemCells((col) => (cols[col] === undefined ? '' : (row[cols[col]!] ?? '')), warn);
    if ('skip' in cells) {
      report.skipped.push({ row: line, message: cells.skip });
      continue;
    }
    const { notes, ...fields } = cells;

    let orderCode: string | null = null;
    const orderText = orderCol === null ? '' : (row[orderCol] ?? '').trim();
    if (orderText) {
      orderCode = normalizeOrderCode(orderText);
      if (!orderCode) notes.push(`Observação da planilha: ${clean(orderText)}`);
    }

    report.items.push({ row: line, ...fields, orderCode, notes: notes.join('\n') });
  }
  const separated = separateMixedOrders(report.items, new Map());
  report.items = separated.items;
  report.warnings.push(...separated.moved);
  report.warnings.sort((a, b) => a.row - b.row);
  return report;
}

/**
 * Uma PO tem um fornecedor só. Os itens cuja PO é de outro fornecedor entram sem PO, com a PO da
 * planilha nas observações, para o Gabriel acertar o número depois. O dono de cada PO vem de `known`
 * (POs já cadastradas, código → nome do fornecedor) ou, para as novas, do fornecedor com mais itens
 * nela na planilha.
 */
export function separateMixedOrders<T extends Pick<ImportedItem, 'row' | 'description' | 'supplier' | 'orderCode' | 'notes'>>(
  items: readonly T[],
  known: ReadonlyMap<string, string>,
): { items: T[]; moved: RowNote[] } {
  const fresh = orderOwners(items.filter((i) => !i.orderCode || !known.has(i.orderCode.toUpperCase())).map((i) => ({ order: i.orderCode?.toUpperCase() ?? null, supplier: i.supplier ? searchKey(i.supplier) : null })));
  const names = new Map<string, string>();
  for (const i of items) if (i.supplier && !names.has(searchKey(i.supplier))) names.set(searchKey(i.supplier), i.supplier);
  const moved: RowNote[] = [];
  const out = items.map((item) => {
    if (!item.orderCode || !item.supplier) return item;
    const code = item.orderCode.toUpperCase();
    const knownOwner = known.get(code);
    const owner = knownOwner !== undefined ? knownOwner : names.get(fresh.get(code) ?? '');
    if (!owner || searchKey(owner) === searchKey(item.supplier)) return item;
    moved.push({ row: item.row, message: `"${item.description}": a ${item.orderCode} é de ${owner} e este item é de ${item.supplier}; entra sem PO.` });
    const note = `PO na planilha: ${item.orderCode} (a PO é de ${owner})`;
    return { ...item, orderCode: null, notes: item.notes ? `${item.notes}\n${note}` : note };
  });
  return { items: out, moved };
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
 * Chave de um item para não repetir a carga: mesma PO, ISBN, nome do produto, quantidade e preço. O
 * nome entra porque a planilha tem produtos diferentes com o mesmo ISBN (na PO-053, o box "Coleção
 * Estratégia" e "O Livro dos Cinco Anéis"). O servidor usa a mesma chave para pular o que já está
 * cadastrado.
 */
export function importKey(item: { orderCode: string | null; isbn: string | null; description: string; quantity: number; unitPriceMicros: number | null }): string {
  return [item.orderCode ?? '', item.isbn ?? '', searchKey(item.description), item.quantity, item.unitPriceMicros ?? ''].join('|');
}

/**
 * Quais itens da carga entram: linhas repetidas na planilha entram todas; o que já está cadastrado
 * é pulado uma vez para cada item igual que existe. Devolve as posições dos itens que entram.
 */
export function newImportItems<T>(incoming: readonly T[], existingKeys: readonly string[], keyOf: (item: T) => string): number[] {
  const left = new Map<string, number>();
  for (const k of existingKeys) left.set(k, (left.get(k) ?? 0) + 1);
  const keep: number[] = [];
  incoming.forEach((item, i) => {
    const key = keyOf(item);
    const n = left.get(key) ?? 0;
    if (n > 0) left.set(key, n - 1);
    else keep.push(i);
  });
  return keep;
}
