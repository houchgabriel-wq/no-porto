// Leitura dos documentos dos fornecedores (SPEC.md, seção 3): o pedido (PO) que a editora manda e a
// invoice ou packing list de cada embarque. Cada fornecedor monta a planilha de um jeito, então a
// leitura procura o cabeçalho pelos nomes das colunas (Name, Title, Description, Qty, Unit Price,
// Rate, ISBN, Order No.) e aceita o ISBN numa coluna própria, junto do nome do produto ou na linha de
// baixo. As linhas chegam já convertidas em texto.

import { isbnDigits, isbnProblem } from './isbn';
import { normalizeOrderCode, searchKey } from './items';
import { formatQuantity, parseScaled, parseSheetUnitPrice } from './money';
import { parseDate } from './shipments';
import { mergePlans, plannedTotal, readMonthText, shipPlanProblem, type ShipPlan } from './shipPlan';
import { cleanSpecification } from './specification';

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
  /** Especificação do produto (formato, papel, acabamento), como veio na PO. */
  specification: string;
  /**
   * Programação de envio, da coluna "Estimated Shipping Date" da PO (o item inteiro naquele mês) ou dos
   * lotes escritos no comentário. Só na PO.
   */
  shipPlan?: ShipPlan;
  /**
   * O texto da célula do nome como veio, quando trazia mais que o nome (o ISBN junto): ao guardar a invoice com
   * os nomes novos, o ISBN continua na célula (27/11/2026).
   */
  nameCell?: string;
  /**
   * Caixas fora do padrão (a sobra, como 1 caixa de 50 quando o padrão é 60), vindas da packing list.
   * Só para a prévia: não é gravado.
   */
  extraCartons?: { cartons: number; pieces: number }[];
  /** Caixas da linha (a coluna "No. of Cartons" da packing list), quando a planilha traz. */
  cartons?: number | null;
  /** Peso bruto da linha em gramas ("Total GW", ou o peso por caixa vezes as caixas), quando a planilha traz. */
  grossWeightGrams?: number | null;
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
  /** A coluna dos nomes (0 é a coluna A), para guardar a invoice com os nomes novos (27/11/2026). */
  nameColumn?: number;
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

type Role = 'description' | 'quantity' | 'price' | 'isbn' | 'order' | 'pieces' | 'comments' | 'specification' | 'shipDate' | 'cartons' | 'grossTotal' | 'grossEach';

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
  // "UNIT" sozinho é o preço unitário na invoice da Sara (ao lado de "Amount").
  price: (l) => (l.includes('price') || /^rate\b/.test(l) || l.includes('preco') || l === 'unit' || l === 'unit usd') && !l.includes('amount') && !l.includes('total'),
  isbn: (l) => l.includes('isbn'),
  order: (l) => /\border (no|number|n)\b/.test(l) || l === 'order' || l === 'po' || /^p ?o (no|number)\b/.test(l) || l === 'pedido',
  // Cada fornecedor escreve de um jeito: "PCS/CTN", "Qty per Ctn", "Qty. in each Ctn", "PER CTN." e, na
  // packing list da Ricky (26/11/2026), "QTY/CARTON". "QTY/CTNS", no plural, fica de fora: pode ser o total de caixas.
  pieces: (l) =>
    l === 'pcs ctn' ||
    /^per (ctn|carton)\b/.test(l) ||
    l.includes('each ctn') ||
    /\b(pcs|qty) per (ctn|carton)\b/.test(l) ||
    l.includes('pecas por caixa') ||
    /^(pcs|pc|qty|q ty|quantity|units?|copies|books|pieces?|pecas|unidades|exemplares) (per |in each |each |in |por )?(ctn|carton|box|caixa|cx)$/.test(l),
  comments: (l) => /^(comment|remark|observ)/.test(l),
  // "Specifications" na PO da editora (a "DESCRIPTION & SPECIFICATION" da Nicola também serve).
  specification: (l) => l.includes('specification') || l === 'specs' || l === 'spec' || l.startsWith('especifica'),
  // "Estimated Shipping Date" na PO da editora; "ETD", "Delivery date", "Data de envio".
  shipDate: (l) => /^etd\b/.test(l) || (/\b(ship|shipping|shipment|delivery|envio|embarque)\b/.test(l) && /\b(date|data|dia)\b/.test(l)),
  // Para ligar o container à unidade do BL (25/11/2026): as caixas ("No. of Cartons", "CTNS") e o peso
  // bruto, total ("Total GW") ou por caixa ("GW (kgs)"), como na packing list da Miyi.
  cartons: (l) => /^(no of |number of |qty of |total )?(cartons?|ctns?)\b/.test(l) && !/\b(per|size|meas|dimension)\b/.test(l),
  grossTotal: (l) => /\btotal\b/.test(l) && /\b(gw|g w|gross)\b/.test(l),
  grossEach: (l) => /^(gw|g w|gross weight)\b/.test(l) && !/\btotal\b/.test(l),
};

/** Peso escrito na planilha, em quilos ("24430", "4211.7", "1,680.5 kgs") → gramas; null se não é número. */
function gramsOf(text: string): number | null {
  const t = clean(text).replace(/\s*kgs?\.?$/i, '');
  return t ? parseScaled(t, 3, { round: true }) : null;
}

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
  let chosen = candidates.find((x) => textual(x.c)) ?? candidates[0];
  // Cabeçalho mesclado sobre duas colunas (na packing list da Ricky, "DESCRIPTION" sobre a categoria, que se
  // repete em todas as linhas, e o título): o mesmo nome nas duas, e vale a de mais valores diferentes.
  if (chosen) {
    const distinct = (c: number) => new Set(data.map((r) => clean(r[c])).filter(Boolean)).size;
    const twins = candidates.filter((x) => x.score === chosen!.score && labels[x.c] === labels[chosen!.c] && textual(x.c));
    if (twins.length > 1) chosen = [...twins].sort((a, b) => distinct(b.c) - distinct(a.c) || a.c - b.c)[0]!;
  }
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

/** O comentário fala em lotes: "Ship in 2 lots", "em 2 lotes". */
const LOTS = /\b(?:in|em)\s+(?:\d|two|three|dois|duas|tr[eê]s)\s+(?:lots|lotes|shipments|embarques|parts|partes)\b/i;
/** Um lote: "15,000 pcs by 16-Dec-2026". */
const LOT = /(\d[\d.,]*)\s*(?:pcs|pieces|copies|units|ex\.?|exemplares)\s+(?:by|on|until|em|até)\s+(\d{1,2}[-\s.][a-zç]{3,9}\.?[-\s.]\d{4}|\d{1,2}\/\d{1,2}\/\d{4}|\d{4}-\d{2}-\d{2}|[a-zç]{3,9}\.?\s+\d{4}|\d{1,2}\/\d{4})/gi;

/**
 * Os lotes escritos no comentário da linha da PO: "Ship in 2 lots: 15,000 pcs by 16-Dec-2026 / 15,000
 * pcs by 01-Mar-2027". Só valem quando o comentário fala em lotes e as quantidades somam a da linha
 * (assim, "ship FIRST the lot already in production (PO-056 – 5,000 pcs)" não conta). null quando o
 * comentário não fala em lotes.
 */
export function lotsFromComment(text: string, quantity: number): { plan: ShipPlan } | { error: string } | null {
  if (!LOTS.test(text)) return null;
  const lots: ShipPlan = [];
  for (const m of text.matchAll(LOT)) {
    const lotQuantity = parseQuantity(m[1]);
    const month = readMonthText(m[2]!);
    if (lotQuantity !== null && month !== null) lots.push({ month, quantity: lotQuantity });
  }
  if (lots.length < 2) return { error: 'o comentário fala em lotes, mas não deu para ler a quantidade e a data de cada um' };
  const total = plannedTotal(lots);
  if (total !== quantity) return { error: `os lotes do comentário somam ${formatQuantity(total)} exemplares, e a linha tem ${formatQuantity(quantity)}` };
  const plan = mergePlans(lots, []);
  const problem = shipPlanProblem(plan, quantity);
  return problem ? { error: problem.charAt(0).toLowerCase() + problem.slice(1).replace(/\.$/, '') } : { plan };
}

/** A data escrita no meio de um texto, depois de "by", "until", "até"...: "New title – ship by 01-Jan-2027." */
const SHIP_BY = /\b(?:by|on|until|till|before|até|em|in|for)\s+(?:the\s+)?(\d{1,2}[-\s.][a-zç]{3,9}\.?[-\s.]\d{4}|\d{1,2}\/\d{1,2}\/\d{4}|\d{4}-\d{2}-\d{2}|[a-zç]{3,9}\.?\s+\d{4}|\d{1,2}\/\d{4})/i;

/**
 * O mês de envio escrito como texto na coluna de envio, em vez de uma data (a PO-073 da Claire, de
 * 25/11/2026, traz "New title – ship by 01-Jan-2027."). null quando o texto não tem uma data.
 */
export function shipMonthInText(text: string): string | null {
  const m = SHIP_BY.exec(text);
  return m ? readMonthText(m[1]!) : null;
}

/**
 * Programação de envio de uma linha da PO: os lotes do comentário, quando há; senão, os lotes escritos na
 * própria coluna de envio; senão, o item inteiro no mês da coluna, que pode ser uma data ou um texto com a
 * data ("ship by 01-Jan-2027"). O que não dá para ler vira aviso, e o item entra sem programação.
 */
function linePlan(shipText: string, comment: string, quantity: number, warn: (message: string) => void): ShipPlan {
  const fromComment = lotsFromComment(comment, quantity);
  if (fromComment && 'plan' in fromComment) return fromComment.plan;
  const fromColumn = fromComment ? null : lotsFromComment(shipText, quantity);
  if (fromColumn && 'plan' in fromColumn) return fromColumn.plan;
  const month = shipText ? (readMonthText(shipText) ?? shipMonthInText(shipText)) : null;
  const error = fromComment ? fromComment.error : fromColumn ? fromColumn.error.replace('do comentário', 'da coluna de envio').replace('o comentário fala', 'a coluna de envio fala') : null;
  if (error) warn(`${error.charAt(0).toUpperCase()}${error.slice(1)}; ${month ? 'vale a data de envio da coluna' : 'o item entra sem programação de envio'}.`);
  if (month) return [{ month, quantity }];
  if (shipText) warn(`Data de envio "${shipText}" não reconhecida; o item entra sem programação de envio.`);
  return [];
}

function readLines(rows: readonly string[][], header: Header, warnings: DocumentNote[], withShipPlan = false): DocumentLine[] {
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
    const notes = clean(cell(row, 'comments')).slice(0, 2000);
    const line: DocumentLine = {
      row: rowNumber,
      description: description || `ISBN ${isbn}`,
      isbn,
      quantity,
      piecesPerCarton: parseQuantity(cell(row, 'pieces')),
      unitPriceMicros,
      orderCode: orderMatch ? normalizeOrderCode(orderMatch[0]) : null,
      notes,
      specification: cleanSpecification(cell(row, 'specification')),
    };
    if (clean(rawName) !== line.description) line.nameCell = rawName;
    if (withShipPlan) line.shipPlan = linePlan(clean(cell(row, 'shipDate')), notes, quantity, (message) => warnings.push({ row: rowNumber, message }));
    // Caixas e peso bruto da linha, quando a planilha traz (a packing list).
    if (cols.cartons !== undefined) line.cartons = parseQuantity(cell(row, 'cartons'));
    // Packing list sem a coluna das peças por caixa, mas com as caixas: a quantidade dividida pelas caixas,
    // quando a conta é exata (com uma caixa de sobra, não dá para saber a caixa padrão). Invoice, com
    // preço, não entra: ela fica sendo invoice.
    if (cols.pieces === undefined && cols.price === undefined && line.cartons && quantity % line.cartons === 0) line.piecesPerCarton = quantity / line.cartons;
    if (cols.grossTotal !== undefined) line.grossWeightGrams = gramsOf(cell(row, 'grossTotal'));
    else if (cols.grossEach !== undefined) {
      const each = gramsOf(cell(row, 'grossEach'));
      line.grossWeightGrams = each !== null && line.cartons ? each * line.cartons : null;
    }
    lines.push(line);
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
      // Os dois-pontos podem ser os largos do chinês ("Invoice NO：").
      const rest = clean(text.slice(m[0].length).replace(/^[\s:：.#º°-]+/, ''));
      if (rest) return rest;
      for (let k = c + 1; k < Math.min(row.length, c + 6); k++) {
        const next = clean(row[k]);
        // Vazia, ou a cópia do próprio rótulo numa célula mesclada: segue para a direita.
        if (!next || next === text) continue;
        // Outro rótulo ao lado ("INVOICE NO. | DATE"): o valor está embaixo.
        if (/[:：]$/.test(next) || /^(date|data|to|from|ref)\b/i.test(next)) break;
        return next;
      }
      // Embaixo, só se não for outro rótulo: com o "To:" vazio (a PO-073 da Claire), embaixo vem "From:".
      const below = clean(rows[r + 1]?.[c]);
      if (below && !/[:：]$/.test(below) && !/^(date|data|to|from|ref)\b/i.test(below)) return below;
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
    const lines = readLines(sheet.rows, header, warnings, true);
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
    if (lines.length) {
      docs.push({ sheet: sheet.name, number: found && found.length <= 60 ? found : null, lines, warnings, headerText: topText(sheet.rows, header.end), nameColumn: header.cols.description });
    }
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
