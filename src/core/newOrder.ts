// Nova PO pelo sistema (pedido do Gabriel em 24/11/2026): a editora monta a PO no No Porto, escolhendo
// os produtos entre os que já tiveram PO e os títulos da curva ABC, com o preço, as peças por caixa e a
// especificação da última compra já preenchidos. O sistema grava a PO e gera o Excel no modelo que vai
// para o fornecedor (o PRINTING ORDER, como a PO-070 da Nicola). Os itens gravados são os mesmos que o
// Novo pedido leria do arquivo gerado: a conferência está no teste, que lê o arquivo de volta.

import { lotsFromComment } from './documents';
import { isbnDigits, isbnProblem } from './isbn';
import { normalizeOrderCode } from './items';
import { isValidUnitPrice, itemTotalCents } from './money';
import { parseDate } from './shipments';
import type { ShipPlan } from './shipPlan';
import { cleanSpecification, latestSpecification } from './specification';

/** O topo da PO, como no modelo da editora. */
export const PO_COMPANY = 'IBC - INSTITUTO BRASILEIRO DE CULTURA LTDA';
export const PO_TITLE = 'PRINTING ORDER';
/** As colunas da tabela, de A a K. */
export const PO_COLUMNS = ['Reference', 'Name', 'Specifications', 'Shrink wrap?', 'ISBN', 'pcs/ctn', 'Quantity', 'Price', 'Amount\n($ USD)', 'Comments', 'Estimated Shipping Date'] as const;
/** As condições, embaixo do total. */
export const PO_TERMS =
  '1. Payment term: 100% on shipping (after BL release)\n2. Shipping in cartons only (no pallet)\n3. Unit prices shown are from the last print run — please confirm or quote current price';
/** O que vai na coluna "Shrink wrap?" quando ninguém muda (na PO-070, quase todas as linhas). */
export const SHRINK_WRAP_DEFAULT = 'YES';
/** A primeira linha de produto na planilha: 1 e 2 são a editora, 3 o título, 4 e 5 os dados da PO, 6 o cabeçalho. */
export const PO_FIRST_ROW = 7;
/** Quantos produtos uma PO pode ter (o mesmo limite do Novo pedido). */
export const NEW_ORDER_MAX_LINES = 500;
const MAX_QUANTITY = 10_000_000;

export interface NewOrderLine {
  description: string;
  isbn: string | null;
  specification: string;
  shrinkWrap: string;
  piecesPerCarton: number | null;
  quantity: number;
  unitPriceMicros: number | null;
  /** Vai para a coluna Comments e vira a observação do item. */
  comment: string;
  /** Envio previsto (AAAA-MM-DD), ou null. */
  shipDate: string | null;
}

export interface NewOrder {
  code: string;
  supplier: string;
  /** Data da PO (AAAA-MM-DD). */
  date: string;
  /** Quem manda: o "From:" da PO, como "GABRIEL". */
  from: string;
  lines: NewOrderLine[];
}

/** O número seguinte ao maior "PO-NNN" que existe: PO-070 → PO-071; sem nenhum, PO-001. */
export function nextOrderCode(codes: readonly string[]): string {
  let max = 0;
  for (const code of codes) {
    const normal = normalizeOrderCode(code);
    if (normal) max = Math.max(max, Number(normal.slice(3)));
  }
  return `PO-${String(max + 1).padStart(3, '0')}`;
}

/** O "From:" da PO: o primeiro nome de quem cria, em maiúsculas ("Gabriel Houch" → "GABRIEL"). */
export function orderSender(name: string): string {
  return (name.trim().split(/\s+/)[0] ?? '').toLocaleUpperCase('pt-BR');
}

/** O nome da aba e do arquivo: o fornecedor em maiúsculas, sem os caracteres que o Excel não aceita. */
export function orderSheetName(supplier: string): string {
  const name = supplier
    .replace(/[[\]:*?/\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleUpperCase('pt-BR')
    .slice(0, 31);
  return name || 'PO';
}

export function orderFileName(order: Pick<NewOrder, 'code' | 'supplier'>): string {
  const code = normalizeOrderCode(order.code) ?? order.code.trim();
  return `${code} (${orderSheetName(order.supplier).replace(/[<>"|]/g, '')}).xlsx`;
}

// O leitor do Novo pedido junta os espaços e as quebras de linha do nome e do comentário.
const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim();

/** A programação de envio da linha, como o Novo pedido leria: os lotes do comentário, ou o item inteiro no mês do envio. */
function linePlan(line: NewOrderLine): ShipPlan {
  const lots = lotsFromComment(oneLine(line.comment), line.quantity);
  if (lots && 'plan' in lots) return lots.plan;
  return line.shipDate ? [{ month: line.shipDate.slice(0, 7), quantity: line.quantity }] : [];
}

/** O que impede a PO de ser criada, ou null. `usedCodes`: os números de PO que já existem. */
export function newOrderProblem(order: NewOrder, usedCodes: readonly string[]): string | null {
  const supplier = order.supplier.trim();
  if (!supplier) return 'Informe o fornecedor.';
  if (supplier.length > 100) return 'O nome do fornecedor pode ter no máximo 100 caracteres.';
  const code = normalizeOrderCode(order.code);
  if (!code) return 'Informe o número da PO, como PO-071.';
  if (usedCodes.some((c) => normalizeOrderCode(c) === code)) return `A ${code} já existe. Use outro número.`;
  if (parseDate(order.date) !== order.date) return 'Informe a data da PO.';
  if (order.lines.length === 0) return 'Acrescente pelo menos um produto.';
  if (order.lines.length > NEW_ORDER_MAX_LINES) return `Uma PO pode ter no máximo ${NEW_ORDER_MAX_LINES} produtos.`;
  for (const [i, line] of order.lines.entries()) {
    const at = `Produto ${i + 1}`;
    if (!oneLine(line.description)) return `${at}: informe o nome do produto.`;
    if (oneLine(line.description).length > 300) return `${at}: o nome pode ter no máximo 300 caracteres.`;
    if (line.isbn) {
      const problem = isbnProblem(line.isbn);
      if (problem) return `${at}: ${problem.charAt(0).toLowerCase()}${problem.slice(1)}`;
    }
    if (!Number.isInteger(line.quantity) || line.quantity <= 0) return `${at}: informe a quantidade.`;
    if (line.quantity > MAX_QUANTITY) return `${at}: quantidade grande demais. Confira.`;
    if (line.piecesPerCarton !== null && (!Number.isInteger(line.piecesPerCarton) || line.piecesPerCarton <= 0 || line.piecesPerCarton > 100_000)) {
      return `${at}: peças por caixa inválidas.`;
    }
    if (line.unitPriceMicros !== null && (line.unitPriceMicros <= 0 || !isValidUnitPrice(line.unitPriceMicros))) {
      return `${at}: o preço precisa ser maior que zero, com no máximo três casas decimais.`;
    }
    if (line.shipDate !== null && parseDate(line.shipDate) !== line.shipDate) return `${at}: data de envio inválida.`;
    const lots = lotsFromComment(oneLine(line.comment), line.quantity);
    if (lots && 'error' in lots) return `${at}: ${lots.error}.`;
  }
  return null;
}

/** Os itens que a PO cria no No Porto (o corpo do POST /api/orders), linha a linha da planilha. */
export function orderItems(order: NewOrder) {
  return order.lines.map((line, i) => ({
    row: PO_FIRST_ROW + i,
    description: oneLine(line.description),
    isbn: line.isbn ? isbnDigits(line.isbn) : null,
    quantity: line.quantity,
    piecesPerCarton: line.piecesPerCarton,
    unitPriceMicros: line.unitPriceMicros,
    notes: oneLine(line.comment).slice(0, 2000),
    specification: cleanSpecification(line.specification),
    shipPlan: linePlan(line),
  }));
}

/** Total da PO: exemplares e valor em centavos (as linhas sem preço não somam valor). */
export function orderTotals(lines: readonly Pick<NewOrderLine, 'quantity' | 'unitPriceMicros'>[]): { quantity: number; cents: number } {
  let quantity = 0;
  let cents = 0;
  for (const l of lines) {
    if (Number.isInteger(l.quantity) && l.quantity > 0) {
      quantity += l.quantity;
      if (l.unitPriceMicros) cents += itemTotalCents(l.quantity, l.unitPriceMicros);
    }
  }
  return { quantity, cents };
}

// ---------- A planilha ----------

/** Uma célula da PO: texto, número, data (AAAA-MM-DD) ou fórmula com o resultado já calculado. */
export type OrderCell = string | number | null | { date: string } | { formula: string; result: number };

export interface OrderSheet {
  name: string;
  /** As linhas da planilha, a partir da 1, com as colunas de A a K. */
  rows: OrderCell[][];
  /** Linha (1 em diante) da primeira e da última linha de produto, do total e das condições. */
  firstLine: number;
  lastLine: number;
  totalRow: number;
  termsRow: number;
}

/** O conteúdo da PO no modelo da editora (o estilo de cada coluna fica com quem monta o arquivo). */
export function orderSheet(order: NewOrder): OrderSheet {
  const code = normalizeOrderCode(order.code) ?? order.code.trim();
  const blank = (n: number): OrderCell[] => Array.from({ length: n }, () => null);
  const rows: OrderCell[][] = [
    [PO_COMPANY, ...blank(10)],
    blank(11),
    [PO_TITLE, ...blank(10)],
    ['To:', order.supplier.trim(), ...blank(7), 'Date', { date: order.date }],
    ['From:', order.from.trim(), ...blank(7), 'Order No.:', code],
    [...PO_COLUMNS],
  ];
  order.lines.forEach((line, i) => {
    const row = PO_FIRST_ROW + i;
    const amount = line.unitPriceMicros ? itemTotalCents(line.quantity, line.unitPriceMicros) / 100 : 0;
    rows.push([
      i + 1,
      oneLine(line.description),
      cleanSpecification(line.specification),
      line.shrinkWrap.trim(),
      line.isbn ? isbnDigits(line.isbn) : '',
      line.piecesPerCarton,
      line.quantity,
      line.unitPriceMicros === null ? null : line.unitPriceMicros / 1_000_000,
      { formula: `G${row}*H${row}`, result: amount },
      line.comment.trim(),
      line.shipDate ? { date: line.shipDate } : null,
    ]);
  });
  const firstLine = PO_FIRST_ROW;
  const lastLine = PO_FIRST_ROW + order.lines.length - 1;
  const totals = orderTotals(order.lines);
  rows.push([
    'TOTAL',
    ...blank(5),
    { formula: `SUM(G${firstLine}:G${lastLine})`, result: totals.quantity },
    null,
    { formula: `SUM(I${firstLine}:I${lastLine})`, result: totals.cents / 100 },
    null,
    null,
  ]);
  rows.push([PO_TERMS, ...blank(10)]);
  return { name: orderSheetName(order.supplier), rows, firstLine, lastLine, totalRow: lastLine + 1, termsRow: lastLine + 2 };
}

/** O texto de cada célula, como o leitor de planilhas entrega ao Novo pedido. */
export function cellText(cell: OrderCell): string {
  if (cell === null) return '';
  if (typeof cell === 'string') return cell;
  if (typeof cell === 'number') return String(cell);
  if ('date' in cell) return cell.date;
  return String(cell.result);
}

// ---------- O catálogo de produtos ----------

/** Um item já comprado, para o catálogo (o que a rota lê do banco). */
export interface CatalogItem {
  productId: string;
  isbn: string | null;
  description: string;
  orderCode: string | null;
  supplierName: string | null;
  createdAt: string;
  unitPriceMicros: number | null;
  piecesPerCarton: number | null;
  specification: string;
}

export interface LastPurchase {
  orderCode: string | null;
  supplierName: string | null;
  /** Quando a última compra entrou (ISO). */
  createdAt: string;
  /** O último preço conhecido (a compra mais recente que tem preço). */
  unitPriceMicros: number | null;
  piecesPerCarton: number | null;
  /** A última especificação de verdade (sem as que só dizem "REPRINT — same specs"). */
  specification: string;
}

export interface CatalogEntry {
  title: string;
  isbn: string | null;
  /** Já teve PO no No Porto ou só está na curva ABC. */
  source: 'sistema' | 'curva';
  last: LastPurchase | null;
}

/**
 * Os produtos para escolher na Nova PO: os que já tiveram PO, com a última compra, e os títulos da curva
 * ABC que ainda não estão no No Porto (o mesmo código de barras é o mesmo produto). Em ordem de nome.
 */
export function poCatalog(items: readonly CatalogItem[], curve: readonly { isbn: string; title: string }[]): CatalogEntry[] {
  const byProduct = new Map<string, CatalogItem[]>();
  for (const item of items) byProduct.set(item.productId, [...(byProduct.get(item.productId) ?? []), item]);
  const entries: CatalogEntry[] = [];
  const known = new Set<string>();
  for (const list of byProduct.values()) {
    const sorted = [...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const latest = sorted[0]!;
    const priced = sorted.find((i) => i.unitPriceMicros !== null);
    const packed = sorted.find((i) => i.piecesPerCarton !== null);
    const spec = latestSpecification(sorted.map((i) => ({ specification: i.specification, createdAt: i.createdAt, orderCode: i.orderCode })));
    if (latest.isbn) known.add(latest.isbn);
    entries.push({
      title: oneLine(latest.description),
      isbn: latest.isbn,
      source: 'sistema',
      last: {
        orderCode: latest.orderCode,
        supplierName: latest.supplierName,
        createdAt: latest.createdAt,
        unitPriceMicros: priced?.unitPriceMicros ?? null,
        piecesPerCarton: packed?.piecesPerCarton ?? null,
        specification: spec?.specification ?? '',
      },
    });
  }
  for (const row of curve) {
    if (known.has(row.isbn)) continue;
    known.add(row.isbn);
    entries.push({ title: oneLine(row.title), isbn: row.isbn, source: 'curva', last: null });
  }
  return entries.sort((a, b) => a.title.localeCompare(b.title, 'pt-BR'));
}
