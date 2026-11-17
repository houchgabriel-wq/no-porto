// Leitura dos documentos dos fornecedores (SPEC.md, seção 3): o pedido (PO) que a editora manda e a
// invoice ou packing list de cada embarque. Cada fornecedor monta a planilha de um jeito, então a
// leitura procura o cabeçalho pelos nomes das colunas (Name, Title, Description, Qty, Unit Price,
// Rate, ISBN, Order No.) e aceita o ISBN numa coluna própria, junto do nome do produto ou na linha de
// baixo. As linhas chegam já convertidas em texto.

import { isbnDigits, isbnProblem } from './isbn';
import { normalizeOrderCode, searchKey } from './items';
import { parseSheetUnitPrice } from './money';
import { parseDate } from './shipments';

export interface SheetRows {
  name: string;
  rows: string[][];
}

export interface DocumentLine {
  /** Linha da planilha, para a pessoa achar o item. */
  row: number;
  description: string;
  isbn: string | null;
  quantity: number;
  piecesPerCarton: number | null;
  unitPriceMicros: number | null;
  /** PO citada na linha (as invoices da Claire trazem). */
  orderCode: string | null;
  notes: string;
}

export interface DocumentNote {
  row: number;
  message: string;
}

export interface OrderDocument {
  code: string | null;
  supplier: string | null;
  /** Data do pedido (AAAA-MM-DD). */
  orderedAt: string | null;
  lines: DocumentLine[];
  warnings: DocumentNote[];
}

export interface InvoiceDocument {
  /** Aba de onde vieram os itens. */
  sheet: string;
  number: string | null;
  lines: DocumentLine[];
  warnings: DocumentNote[];
  /** Os primeiros textos do arquivo (remetente, destinatário), para reconhecer o fornecedor. */
  headerText: string;
}

/** Linhas lidas do topo procurando o cabeçalho e os dados do documento. */
const HEADER_SCAN = 40;

/** Rótulo para comparar: sem acento, maiúscula nem pontuação ("Qty. Unit" → "qty unit"). */
function label(text: string | undefined): string {
  return searchKey(text ?? '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function clean(text: string | undefined): string {
  return (text ?? '').replace(/\s+/g, ' ').trim();
}

type Role = 'description' | 'quantity' | 'price' | 'isbn' | 'order' | 'pieces' | 'comments';

/** Peso de cada coluna candidata a nome do produto: "Name" vale mais que "Description". */
function descriptionScore(l: string): number {
  if (['name', 'title', 'produto', 'product', 'titulo', 'item name', 'book name', 'product name', 'nome'].includes(l)) return 3;
  if (l.includes('specification') || l.includes('spec')) return 0;
  if (l.includes('description of goods')) return 2;
  if (l === 'description' || l === 'descricao' || l.startsWith('description ')) return 1;
  // "ITEM" é o nome do produto na packing list da Claire; em outras planilhas é só o número da linha
  // (a escolha confere os dados, em descriptionColumn).
  if (l === 'item' || l === 'items') return 1;
  return 0;
}

const ROLE_TESTS: Record<Exclude<Role, 'description'>, (l: string) => boolean> = {
  // "Total Qty per title" é a quantidade; "Qty per Ctn" e "Qty. Unit", não.
  quantity: (l) => (/^(qty|quantity|quantidade|qtd|total qty)\b/.test(l) || l === 'qtd') && !/\b(unit|each|ctn|ctns|carton|cartons)\b/.test(l),
  price: (l) => (l.includes('price') || /^rate\b/.test(l) || l.includes('preco')) && !l.includes('amount') && !l.includes('total'),
  isbn: (l) => l.includes('isbn'),
  order: (l) => /\border (no|number|n)\b/.test(l) || l === 'order' || l === 'po' || /^p ?o (no|number)\b/.test(l) || l === 'pedido',
  pieces: (l) => l === 'pcs ctn' || /^per (ctn|carton)\b/.test(l) || l.includes('each ctn') || /\b(pcs|qty) per (ctn|carton)\b/.test(l) || l.includes('pecas por caixa'),
  comments: (l) => /^(comment|remark|observ)/.test(l),
};

interface Header {
  /** Última linha do cabeçalho (os dados começam depois). */
  end: number;
  cols: Partial<Record<Role, number>>;
}

/** Texto que é só um número (o "1, 2, 3" da coluna Item). */
const NUMBER_ONLY = /^\s*\d+([.,]\d+)?\s*$/;

function columnsOf(labels: string[], data: readonly string[][]): Partial<Record<Role, number>> {
  const cols: Partial<Record<Role, number>> = {};
  // Coluna do nome: a de maior peso cujos dados não são só números.
  const candidates = labels
    .map((l, c) => ({ c, score: descriptionScore(l) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.c - b.c);
  const textual = (c: number) => {
    const values = data.map((r) => clean(r[c])).filter(Boolean).slice(0, 8);
    return values.length === 0 || values.filter((v) => NUMBER_ONLY.test(v)).length * 2 < values.length;
  };
  const chosen = candidates.find((x) => textual(x.c)) ?? candidates[0];
  if (chosen) cols.description = chosen.c;
  for (const [role, test] of Object.entries(ROLE_TESTS) as [Exclude<Role, 'description'>, (l: string) => boolean][]) {
    const c = labels.findIndex((l, i) => l !== '' && i !== cols.description && test(l));
    if (c >= 0) cols[role] = c;
  }
  return cols;
}

function joinedLabels(a: readonly string[], b: readonly string[]): string[] {
  return Array.from({ length: Math.max(a.length, b.length) }, (_, c) => label(`${a[c] ?? ''} ${b[c] ?? ''}`));
}

/**
 * Acha a linha de cabeçalho (com o nome do produto e a quantidade), sozinha ou somada à de baixo
 * ("QTY." em cima, "In Pcs" embaixo). Quando a linha de baixo ainda é cabeçalho ("each Ctn",
 * "(USD)"), ela completa as colunas que faltaram.
 */
function findHeader(rows: readonly string[][]): Header | null {
  const found = (c: Partial<Record<Role, number>>) => c.description !== undefined && c.quantity !== undefined;
  for (let i = 0; i < Math.min(rows.length, HEADER_SCAN); i++) {
    const own = columnsOf(rows[i]!.map(label), rows.slice(i + 1, i + 12));
    const next = rows[i + 1];
    if (found(own)) {
      if (next && parseQuantity(next[own.quantity!]) === null && next.some((c) => clean(c) !== '')) {
        const both = columnsOf(joinedLabels(rows[i]!, next), rows.slice(i + 2, i + 13));
        // As duas linhas juntas dizem mais ("Qty. in" + "each Ctn" são as peças por caixa, não a quantidade).
        return { end: i + 1, cols: found(both) ? { ...own, ...both } : own };
      }
      return { end: i, cols: own };
    }
    if (!next) continue;
    // A linha de baixo sozinha já é o cabeçalho (a de cima é só um título, como "TOTAL"): fica para a próxima volta.
    if (found(columnsOf(next.map(label), rows.slice(i + 2, i + 13)))) continue;
    const both = columnsOf(joinedLabels(rows[i]!, next), rows.slice(i + 2, i + 13));
    if (found(both)) return { end: i + 1, cols: both };
  }
  return null;
}

/** Quantidade inteira: "30,000", "9878", "8680.0". */
export function parseQuantity(text: string | undefined): number | null {
  let t = clean(text).replace(/\s/g, '');
  if (/^\d{1,3}([.,]\d{3})+$/.test(t)) t = t.replace(/[.,]/g, '');
  else if (/^\d+[.,]0+$/.test(t)) t = t.replace(/[.,]0+$/, '');
  if (!/^\d+$/.test(t)) return null;
  const n = Number(t);
  return n > 0 && Number.isSafeInteger(n) ? n : null;
}

const ISBN_IN_TEXT = /97[89][\d\s-]{10,20}/g;

/** O primeiro ISBN-13 válido que aparece no texto, sem hífens. */
export function findIsbn(text: string): string | null {
  for (const match of text.matchAll(ISBN_IN_TEXT)) {
    const digits = match[0].replace(/\D/g, '').slice(0, 13);
    if (digits.length === 13 && isbnProblem(digits) === null) return digits;
  }
  return null;
}

/** Nome do produto sem o ISBN e sem o rótulo "ISBN" que alguns fornecedores põem junto. */
function stripIsbn(text: string): string {
  return clean(text.replace(ISBN_IN_TEXT, ' ').replace(/\bISBN\b\s*:?/gi, ' ')).replace(/[\s:–-]+$/, '');
}

/** Fim da tabela: "TOTAL", "TOTAL AMOUNT USD", "In total:". */
function isTotalRow(row: readonly string[]): boolean {
  return row.some((c) => /^(in )?total( |$)/.test(label(c)));
}

function readLines(rows: readonly string[][], header: Header, warnings: DocumentNote[]): DocumentLine[] {
  const { cols } = header;
  const cell = (row: readonly string[], role: Role) => (cols[role] === undefined ? '' : (row[cols[role]!] ?? ''));
  const lines: DocumentLine[] = [];
  for (let r = header.end + 1; r < rows.length; r++) {
    const row = rows[r]!;
    if (isTotalRow(row)) break;
    const rowNumber = r + 1;
    const rawName = cell(row, 'description');
    const quantity = parseQuantity(cell(row, 'quantity'));
    if (quantity === null) {
      // Linha de complemento: o ISBN embaixo do nome ("ISBN 978-65-5547-502-9").
      const last = lines[lines.length - 1];
      const isbn = findIsbn(rawName);
      if (last && !last.isbn && isbn && rowNumber - last.row <= 3) last.isbn = isbn;
      continue;
    }
    const isbnText = cell(row, 'isbn');
    let isbn = findIsbn(isbnText) ?? findIsbn(rawName);
    if (!isbn && clean(isbnText)) {
      const problem = isbnProblem(clean(isbnText));
      if (problem) warnings.push({ row: rowNumber, message: `ISBN "${clean(isbnText)}" não serve (${problem}); o item entra sem ISBN.` });
      else isbn = isbnDigits(clean(isbnText));
    }
    const description = stripIsbn(rawName);
    // Sem produto: é a linha de soma no fim da tabela (a packing list da Claire não escreve "TOTAL").
    if (!description && !isbn) continue;
    let unitPriceMicros: number | null = null;
    const priceText = clean(cell(row, 'price'));
    if (priceText) {
      const price = parseSheetUnitPrice(priceText);
      if (!price) warnings.push({ row: rowNumber, message: `Preço "${priceText}" não reconhecido; o item entra sem preço.` });
      else {
        unitPriceMicros = price.micros;
        if (price.rounded) warnings.push({ row: rowNumber, message: `Preço ${priceText} arredondado para três casas.` });
      }
    }
    const orderMatch = /PO[\s-]*\d{1,6}/i.exec(cell(row, 'order'));
    lines.push({
      row: rowNumber,
      description: description || `ISBN ${isbn}`,
      isbn,
      quantity,
      piecesPerCarton: parseQuantity(cell(row, 'pieces')),
      unitPriceMicros,
      orderCode: orderMatch ? normalizeOrderCode(orderMatch[0]) : null,
      notes: clean(cell(row, 'comments')).slice(0, 2000),
    });
  }
  return lines;
}

/**
 * Valor de um campo do topo do documento ("Invoice No.:126062009-2", "To: | Sara", "INVOICE NO." com o
 * número embaixo): o texto depois do rótulo na mesma célula, a próxima célula preenchida à direita ou
 * a célula de baixo.
 */
function fieldValue(rows: readonly string[][], pattern: RegExp, limit = HEADER_SCAN): string | null {
  for (let r = 0; r < Math.min(rows.length, limit); r++) {
    const row = rows[r]!;
    for (let c = 0; c < row.length; c++) {
      const text = clean(row[c]);
      const m = pattern.exec(text);
      if (!m || m.index !== 0) continue;
      const rest = clean(text.slice(m[0].length).replace(/^[\s:.#º°-]+/, ''));
      if (rest) return rest;
      for (let k = c + 1; k < Math.min(row.length, c + 6); k++) {
        const next = clean(row[k]);
        if (!next) continue;
        // Outro rótulo ao lado ("INVOICE NO. | DATE"): o valor está embaixo.
        if (/:$/.test(next) || /^(date|data|to|from|ref)\b/i.test(next)) break;
        return next;
      }
      const below = clean(rows[r + 1]?.[c]);
      if (below) return below;
      return null;
    }
  }
  return null;
}

function topText(rows: readonly string[][], upTo: number): string {
  return rows
    .slice(0, upTo)
    .flat()
    .map(clean)
    .filter(Boolean)
    .join(' ');
}

const NO_ITEMS = 'Não achei os itens no arquivo. A planilha precisa ter uma linha de cabeçalho com o nome do produto e a quantidade (como Name, Title ou Description, e Quantity ou Qty).';

/** O pedido (PO) que a editora manda ao fornecedor: "To:" é o fornecedor; "Order No.:", a PO. */
export function parseOrderDocument(sheets: readonly SheetRows[], fileName: string): OrderDocument | { error: string } {
  for (const sheet of sheets) {
    const header = findHeader(sheet.rows);
    if (!header) continue;
    const warnings: DocumentNote[] = [];
    const lines = readLines(sheet.rows, header, warnings);
    if (lines.length === 0) continue;
    const top = sheet.rows.slice(0, header.end);
    const codeText = fieldValue(top, /order\s*(no|n[º°o]|number)\b\.?/i);
    const codeMatch = /PO[\s-]*\d{1,6}/i.exec(codeText ?? '') ?? /PO[\s-]*\d{1,6}/i.exec(fileName);
    const supplier = fieldValue(top, /to\b/i);
    const dateText = fieldValue(top, /date\b/i);
    return {
      code: codeMatch ? normalizeOrderCode(codeMatch[0]) : null,
      supplier: supplier && supplier.length <= 100 ? supplier : null,
      orderedAt: dateText ? parseDate(dateText) : null,
      lines,
      warnings,
    };
  }
  return { error: NO_ITEMS };
}

const INVOICE_LABEL = /(commercial\s+|proforma\s+)?invoice\s*(no|n[º°o]|number|#)\.?|pi\s*(no|n[º°o])\.?/i;

/**
 * Invoice ou packing list de um embarque. Quando o arquivo tem as duas abas (packing list e invoice),
 * vale a que tem preço; o número da invoice pode estar em qualquer uma.
 */
export function parseInvoiceDocument(sheets: readonly SheetRows[], fileName: string): InvoiceDocument | { error: string } {
  let best: InvoiceDocument | null = null;
  let number: string | null = null;
  for (const sheet of sheets) {
    const found = fieldValue(sheet.rows, INVOICE_LABEL);
    if (found && !number && found.length <= 60) number = found;
    const header = findHeader(sheet.rows);
    if (!header) continue;
    const warnings: DocumentNote[] = [];
    const lines = readLines(sheet.rows, header, warnings);
    if (lines.length === 0) continue;
    const doc: InvoiceDocument = { sheet: sheet.name, number: found && found.length <= 60 ? found : null, lines, warnings, headerText: topText(sheet.rows, header.end) };
    const priced = (d: InvoiceDocument) => d.lines.filter((l) => l.unitPriceMicros !== null).length;
    if (!best || priced(doc) > priced(best) || (priced(doc) === priced(best) && doc.lines.length > best.lines.length)) best = doc;
  }
  if (!best) return { error: NO_ITEMS };
  return { ...best, number: best.number ?? number, headerText: `${best.headerText} ${fileName}` };
}

// ---------- Arquivos de um container: invoice e packing list ----------

const CONTAINER = /\b([A-Z]{4})\s?(\d{7})\b/;

/** Número do container (padrão ISO 6346: quatro letras e sete dígitos, como YMLU5449045). */
export function findContainer(text: string): string | null {
  const m = CONTAINER.exec(text);
  return m ? `${m[1]}${m[2]}` : null;
}

export interface ShipmentFile {
  fileName: string;
  /** Os itens com preço (a invoice), quando o arquivo tem. */
  invoice: InvoiceDocument | null;
  /** Os itens com peças por caixa (a packing list), quando o arquivo tem. Pode ser a mesma aba da invoice. */
  packing: InvoiceDocument | null;
  /** Número da invoice escrito no arquivo. */
  number: string | null;
  container: string | null;
  /** Os primeiros textos do arquivo e o nome dele, para reconhecer o fornecedor. */
  headerText: string;
}

/**
 * Um arquivo do embarque: invoice, packing list ou os dois (a Brijbasi manda as duas abas no mesmo
 * arquivo). A aba com mais preços é a invoice; a com mais peças por caixa, a packing list.
 */
export function parseShipmentFile(sheets: readonly SheetRows[], fileName: string): ShipmentFile | { error: string } {
  const docs: InvoiceDocument[] = [];
  let number: string | null = null;
  let container: string | null = null;
  for (const sheet of sheets) {
    const found = fieldValue(sheet.rows, INVOICE_LABEL);
    if (found && !number && found.length <= 60) number = found;
    container ??= findContainer(topText(sheet.rows, 60));
    const header = findHeader(sheet.rows);
    if (!header) continue;
    const warnings: DocumentNote[] = [];
    const lines = readLines(sheet.rows, header, warnings);
    if (lines.length) docs.push({ sheet: sheet.name, number: found && found.length <= 60 ? found : null, lines, warnings, headerText: topText(sheet.rows, header.end) });
  }
  if (docs.length === 0) return { error: NO_ITEMS };
  const count = (d: InvoiceDocument, f: (l: DocumentLine) => boolean) => d.lines.filter(f).length;
  const most = (f: (l: DocumentLine) => boolean) => docs.filter((d) => count(d, f) > 0).sort((a, b) => count(b, f) - count(a, f) || b.lines.length - a.lines.length)[0] ?? null;
  let invoice = most((l) => l.unitPriceMicros !== null);
  const packing = most((l) => l.piecesPerCarton !== null);
  // Sem preço e sem peças por caixa: vale como invoice só com as quantidades.
  if (!invoice && !packing) invoice = [...docs].sort((a, b) => b.lines.length - a.lines.length)[0]!;
  const main = invoice ?? packing!;
  return { fileName, invoice, packing, number, container: container ?? findContainer(fileName), headerText: `${main.headerText} ${fileName}` };
}
