// Atualizar pela planilha (pedido do Gabriel em 19/11/2026): a lista da Produção baixada pelo "Baixar
// .xlsx" volta com o que foi mudado nela. Só três colunas mudam por aqui: Aprovação do arquivo,
// Programação de envio e Observações. Quantidade, preço e o resto continuam só na ficha do item.
//
// Cada linha baixada leva o código do item: o id e uma marca do valor de cada uma das três colunas no
// momento do download. Na volta, o valor da planilha que não bate com a marca é o que a pessoa mudou; o
// valor do app que não bate com a marca é o que mudou no app depois do download. Entra só o que mudou
// na planilha, e o que outra pessoa mudou no app nesse meio-tempo não é desfeito.

import type { RowNote } from './importProduction';
import { NO_ORDER, normalizeOrderCode, searchKey, type Item, type PurchaseOrder } from './items';
import { formatQuantity, formatUnitPrice, parseSheetUnitPrice } from './money';
import { parseDate } from './shipments';
import { readShipPlanText, shipPlanProblem, shipPlanText, sortPlan, type ShipPlan } from './shipPlan';

/** Os campos que mudam pela planilha. */
export const SHEET_FIELDS = ['fileApprovedAt', 'shipPlan', 'notes'] as const;
export type SheetField = (typeof SHEET_FIELDS)[number];

/** O nome de cada campo, como na planilha e no histórico do item. */
export const SHEET_FIELD_LABELS: Record<SheetField, string> = {
  fileApprovedAt: 'Aprovação do arquivo',
  shipPlan: 'Programação de envio',
  notes: 'Observações',
};

/** O campo no meio de uma frase ("a programação de envio mudou"). */
const IN_SENTENCE: Record<SheetField, string> = {
  fileApprovedAt: 'a aprovação do arquivo',
  shipPlan: 'a programação de envio',
  notes: 'as observações',
};

/** Título da coluna do código na planilha baixada. */
export const ITEM_CODE_HEADER = 'Código do item (não altere)';

/** O máximo das observações, o mesmo da ficha do item. */
export const NOTES_MAX = 2000;

/** Os três campos de um item. */
export interface SheetValues {
  /** AAAA-MM-DD, ou null. */
  fileApprovedAt: string | null;
  shipPlan: ShipPlan;
  notes: string;
}

export function sheetValues(item: Pick<Item, 'fileApprovedAt' | 'shipPlan' | 'notes'>): SheetValues {
  return { fileApprovedAt: item.fileApprovedAt ?? null, shipPlan: sortPlan(item.shipPlan ?? []), notes: item.notes };
}

/** Observações como a planilha devolve: a quebra de linha do Windows vira "\n", sem espaço nas pontas. */
export function normalizeNotes(text: string): string {
  return text.replace(/\r\n?/g, '\n').trim();
}

/** O valor de um campo num texto só, para comparar. */
function canonical(field: SheetField, v: SheetValues): string {
  if (field === 'fileApprovedAt') return v.fileApprovedAt ?? '';
  if (field === 'shipPlan') return sortPlan(v.shipPlan).map((p) => `${p.month}=${p.quantity}`).join(';');
  return normalizeNotes(v.notes);
}

export function sameSheetValue(field: SheetField, a: SheetValues, b: SheetValues): boolean {
  return canonical(field, a) === canonical(field, b);
}

const MARK_LENGTH = 6;

/** Seis letras e números que marcam um texto (FNV-1a de 32 bits, com 31 deles em base 36). */
function mark(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 1).toString(36).padStart(MARK_LENGTH, '0');
}

/** A marca do valor de um campo. */
export function fieldMark(field: SheetField, values: SheetValues): string {
  return mark(`${field}=${canonical(field, values)}`);
}

/** O código do item na planilha: o id, um ponto e a marca dos três campos ("<id>.k2j3h4a1b2c3x9y8z7"). */
export function itemCode(item: Pick<Item, 'id' | 'fileApprovedAt' | 'shipPlan' | 'notes'>): string {
  const values = sheetValues(item);
  return `${item.id}.${SHEET_FIELDS.map((f) => fieldMark(f, values)).join('')}`;
}

export interface ItemCode {
  id: string;
  /** A marca de cada campo no momento do download. */
  marks: Record<SheetField, string>;
}

/** Lê o código do item; null quando ele não está inteiro. */
export function readItemCode(text: string): ItemCode | null {
  const t = text.trim();
  const dot = t.lastIndexOf('.');
  const id = t.slice(0, dot);
  const marks = t.slice(dot + 1).toLowerCase();
  if (dot < 1 || !/^[\w-]{1,64}$/.test(id) || marks.length !== MARK_LENGTH * SHEET_FIELDS.length || !/^[0-9a-z]+$/.test(marks)) return null;
  const byField = Object.fromEntries(SHEET_FIELDS.map((f, i) => [f, marks.slice(i * MARK_LENGTH, (i + 1) * MARK_LENGTH)]));
  return { id, marks: byField as Record<SheetField, string> };
}

/** A coluna do código: "Código do item", com ou sem o "(não altere)". */
export function isItemCodeHeader(text: string): boolean {
  return searchKey(text).startsWith('codigo do item');
}

/** O valor de um campo como a pessoa vê ('' quando vazio): o dia (dd/mm/aaaa), a programação, as observações. */
export function sheetFieldText(field: SheetField, v: SheetValues): string {
  if (field === 'fileApprovedAt') return v.fileApprovedAt ? v.fileApprovedAt.split('-').reverse().join('/') : '';
  if (field === 'shipPlan') return shipPlanText(v.shipPlan);
  return normalizeNotes(v.notes);
}

/** "a, b e c". */
function list(words: readonly string[]): string {
  return words.length <= 1 ? (words[0] ?? '') : `${words.slice(0, -1).join(', ')} e ${words[words.length - 1]}`;
}

const oneLine = (text: string | undefined) => (text ?? '').replace(/\s+/g, ' ').trim();
const lowerFirst = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);
const upperFirst = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** Problema da programação de envio no meio da frase: "na programação de envio, falta a quantidade…". */
function planSentence(message: string): string {
  return /programação de envio/i.test(message) ? lowerFirst(message) : `na programação de envio, ${lowerFirst(message)}`;
}

export interface SheetChange {
  field: SheetField;
  /** Como está no app e como fica, para a pessoa conferir ('' quando vazio). */
  from: string;
  to: string;
}

export interface SheetUpdate {
  /** Linha da planilha (contando o cabeçalho). */
  row: number;
  id: string;
  description: string;
  orderCode: string | null;
  changes: SheetChange[];
  /** Os campos que mudam, como a API recebe. */
  patch: Partial<SheetValues>;
  /** A marca de cada campo que muda, para o servidor conferir que o app não mudou desde o download. */
  marks: Partial<Record<SheetField, string>>;
}

export interface UpdateSheetReport {
  /** Os itens que mudaram na planilha. */
  updates: SheetUpdate[];
  /** Linhas que não entram, com o motivo. */
  problems: RowNote[];
  /** Linhas que pedem atenção: a quantidade ou o preço mudados na planilha não entram. */
  warnings: RowNote[];
  /** Itens da planilha sem mudança nas três colunas. */
  unchanged: number;
  /** Os campos que mudam por aqui e têm coluna na planilha. */
  fields: SheetField[];
}

const COLUMNS = {
  description: ['produto'],
  order: ['po'],
  quantity: ['quantidade'],
  unitPrice: ['$ unitario'],
  fileApprovedAt: ['aprovacao do arquivo'],
  shipPlan: ['programacao de envio'],
  notes: ['observacoes'],
} as const;
type Column = keyof typeof COLUMNS | 'code';

/** Acha o cabeçalho (a linha com o código do item) e a posição de cada coluna. */
function findColumns(rows: readonly string[][]): { index: number; cols: Partial<Record<Column, number>> } | null {
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const code = rows[i]!.findIndex(isItemCodeHeader);
    if (code < 0) continue;
    const keys = rows[i]!.map((c) => searchKey(c));
    const cols: Partial<Record<Column, number>> = { code };
    for (const [col, names] of Object.entries(COLUMNS)) {
      const at = keys.findIndex((k) => (names as readonly string[]).includes(k));
      if (at >= 0) cols[col as Column] = at;
    }
    return { index: i, cols };
  }
  return null;
}

/** Quantidade como a planilha devolve ("60000") ou como a pessoa digita ("60.000"). */
function sheetCount(text: string): number | null {
  const t = text.replace(/\s/g, '');
  if (/^\d{1,3}([.,]\d{3})+$/.test(t)) return Number(t.replace(/[.,]/g, ''));
  return /^\d+$/.test(t) ? Number(t) : null;
}

/** PO da linha: o código; null para "Sem PO" ou vazia; o texto como veio quando não é um código. */
function rowOrder(text: string): string | null {
  const t = oneLine(text);
  if (!t || searchKey(t) === searchKey(NO_ORDER)) return null;
  return normalizeOrderCode(t) ?? t;
}

/**
 * Lê a lista da Produção que volta pelo "Atualizar pela planilha" e compara cada linha com o item do
 * app: devolve só os itens que mudaram na planilha, com o antes e o depois, e as linhas que não entram.
 * `items` e `orders` são os do app, como a pessoa está vendo agora.
 */
export function parseUpdateRows(
  rows: readonly string[][],
  items: readonly Item[],
  orders: readonly Pick<PurchaseOrder, 'id' | 'code'>[],
): UpdateSheetReport | { error: string } {
  const header = findColumns(rows);
  if (!header) {
    return { error: 'Não achei a coluna "Código do item". Baixe a lista pelo "Baixar .xlsx" da Produção (ela traz o código de cada item), mude nela o que precisar e envie de novo.' };
  }
  const { cols } = header;
  if (cols.description === undefined) return { error: 'A planilha precisa da coluna "Produto", para conferir que cada código está na linha certa.' };
  const fields = SHEET_FIELDS.filter((f) => cols[f] !== undefined);
  if (fields.length === 0) return { error: 'A planilha não tem as colunas Aprovação do arquivo, Programação de envio nem Observações: não há o que atualizar.' };

  const byId = new Map(items.map((i) => [i.id, i]));
  const codes = new Map(orders.map((o) => [o.id, o.code]));
  const cell = (row: readonly string[], col: Column) => (cols[col] === undefined ? '' : (row[cols[col]!] ?? ''));
  const body = rows
    .map((row, i) => ({ row, line: i + 1 }))
    .slice(header.index + 1)
    .filter(({ row }) => row.some((c) => oneLine(c)) && !isItemCodeHeader(cell(row, 'code')));

  // As linhas de cada código, para achar o mesmo código em duas linhas.
  const linesById = new Map<string, number[]>();
  for (const { row, line } of body) {
    const code = readItemCode(cell(row, 'code'));
    if (code) linesById.set(code.id, [...(linesById.get(code.id) ?? []), line]);
  }

  const report: UpdateSheetReport = { updates: [], problems: [], warnings: [], unchanged: 0, fields };
  for (const { row, line } of body) {
    const problem = (message: string) => report.problems.push({ row: line, message });
    const codeText = oneLine(cell(row, 'code'));
    const rowDescription = oneLine(cell(row, 'description'));
    if (!codeText) {
      // Sem código e sem produto (uma soma, por exemplo), a linha não é de item.
      if (rowDescription) problem(`"${rowDescription}": sem o código do item, a linha não entra. Item novo entra pelo Novo item ou pelo Novo pedido.`);
      continue;
    }
    const code = readItemCode(codeText);
    if (!code) {
      problem(`O código do item "${codeText}" não está inteiro. Não mude essa coluna; se precisar, baixe a lista de novo.`);
      continue;
    }
    const lines = linesById.get(code.id)!;
    if (lines.length > 1) {
      problem(`O mesmo código do item está nas linhas ${list(lines.map(String))}. Deixe uma linha só para cada item.`);
      continue;
    }
    const item = byId.get(code.id);
    if (!item) {
      problem(`${rowDescription ? `"${rowDescription}": o` : 'O'} item deste código não está mais no app (pode ter sido excluído).`);
      continue;
    }
    const name = `"${item.description}"`;
    if (item.status !== 'producao') {
      problem(`${name} já ${item.status === 'embarcado' ? 'embarcou' : 'chegou'}; a planilha só atualiza o que está em produção. Se precisar, mude na ficha do item.`);
      continue;
    }
    // O código precisa estar na linha do mesmo item: ordenar só parte da planilha tira os códigos do lugar.
    const orderCode = item.purchaseOrderId ? (codes.get(item.purchaseOrderId) ?? null) : null;
    const lineOrder = cols.order === undefined ? orderCode : rowOrder(cell(row, 'order'));
    if (searchKey(rowDescription) !== searchKey(item.description) || lineOrder?.toUpperCase() !== orderCode?.toUpperCase()) {
      const lineText = rowDescription ? `A linha tem "${rowDescription}" (${lineOrder ?? NO_ORDER})` : 'A linha está sem o produto';
      problem(
        `${lineText}, mas o código é de ${name} (${orderCode ?? NO_ORDER}). Se a planilha foi ordenada só em parte, os códigos saíram do lugar: baixe a lista de novo. Produto e PO só mudam na ficha do item.`,
      );
      continue;
    }

    const current = sheetValues(item);
    const sheet: SheetValues = { ...current };
    // O que impede a linha de entrar, em frases que começam em minúscula e terminam com ponto.
    const errors: string[] = [];
    const conflicts: SheetField[] = [];
    const update: SheetUpdate = { row: line, id: item.id, description: item.description, orderCode, changes: [], patch: {}, marks: {} };
    for (const field of fields) {
      const text = cell(row, field);
      if (field === 'fileApprovedAt') {
        const t = oneLine(text);
        const day = t ? parseDate(t) : null;
        if (t && !day) {
          errors.push(`a aprovação do arquivo "${t}" não é uma data (escreva como 05/12/2026).`);
          continue;
        }
        sheet.fileApprovedAt = day;
      } else if (field === 'shipPlan') {
        const read = readShipPlanText(text, item.quantity);
        if ('error' in read) {
          errors.push(planSentence(read.error));
          continue;
        }
        sheet.shipPlan = read.plan;
      } else {
        sheet.notes = normalizeNotes(text);
        if (sheet.notes.length > NOTES_MAX) {
          errors.push(`as observações passam de ${formatQuantity(NOTES_MAX)} caracteres.`);
          continue;
        }
      }
      // O valor bate com a marca: não mudou na planilha (mesmo que tenha mudado no app depois do download).
      if (fieldMark(field, sheet) === code.marks[field]) continue;
      // O app já está assim.
      if (sameSheetValue(field, sheet, current)) continue;
      // Mudou na planilha e também no app depois do download: a planilha não desfaz a mudança do app.
      if (fieldMark(field, current) !== code.marks[field]) {
        conflicts.push(field);
        continue;
      }
      if (field === 'shipPlan') {
        const planProblem = shipPlanProblem(sheet.shipPlan, item.quantity);
        if (planProblem) {
          errors.push(planSentence(planProblem));
          continue;
        }
      }
      update.changes.push({ field, from: sheetFieldText(field, current), to: sheetFieldText(field, sheet) });
      update.marks[field] = code.marks[field];
      if (field === 'fileApprovedAt') update.patch.fileApprovedAt = sheet.fileApprovedAt;
      else if (field === 'shipPlan') update.patch.shipPlan = sheet.shipPlan;
      else update.patch.notes = sheet.notes;
    }
    if (conflicts.length) {
      errors.push(`${changedInAppText(conflicts)} depois que a planilha foi baixada. Para não desfazer essa mudança, a linha não entra: confira na ficha do item ou baixe a lista de novo.`);
    }
    if (errors.length) {
      problem(`${name}: ${errors.map((e, i) => (i === 0 ? e : upperFirst(e))).join(' ')}`);
      continue;
    }

    // Quantidade e preço mudados na planilha não entram: avisa, para a pessoa mudar na ficha.
    const differences: string[] = [];
    if (cols.quantity !== undefined) {
      const t = oneLine(cell(row, 'quantity'));
      const count = sheetCount(t);
      if (count !== item.quantity) differences.push(`a quantidade da planilha (${count === null ? t || 'vazia' : formatQuantity(count)}) não é a do app (${formatQuantity(item.quantity)})`);
    }
    if (cols.unitPrice !== undefined && item.unitPriceMicros !== undefined) {
      const t = oneLine(cell(row, 'unitPrice'));
      const micros = t ? (parseSheetUnitPrice(t)?.micros ?? Number.NaN) : null;
      if (micros !== item.unitPriceMicros) {
        const shown = micros === null ? 'vazio' : Number.isNaN(micros) ? t : formatUnitPrice(micros);
        differences.push(`o preço da planilha (${shown}) não é o do app (${item.unitPriceMicros === null ? 'sem preço' : formatUnitPrice(item.unitPriceMicros)})`);
      }
    }
    if (differences.length) report.warnings.push({ row: line, message: `${name}: ${differences.join(' e ')}. Quantidade e preço só mudam na ficha do item.` });

    if (update.changes.length) report.updates.push(update);
    else report.unchanged++;
  }
  if (report.updates.length + report.unchanged + report.problems.length === 0) return { error: 'A planilha não tem itens com o código do item.' };
  return report;
}

/**
 * Confere no servidor o que a planilha manda para um item, contra o item como está agora: um campo só
 * muda se o app não mudou desde o download (a marca bate), e a programação precisa caber na quantidade
 * do item. Devolve os campos que mudam de fato.
 */
export function checkSheetPatch(
  current: SheetValues & { quantity: number },
  patch: Partial<SheetValues>,
  marks: Partial<Record<SheetField, string>>,
): { conflict: SheetField[] } | { problem: string } | { next: SheetValues; changed: SheetField[] } {
  const now = sheetValues(current);
  const next: SheetValues = {
    fileApprovedAt: patch.fileApprovedAt !== undefined ? patch.fileApprovedAt : now.fileApprovedAt,
    shipPlan: sortPlan(patch.shipPlan ?? now.shipPlan),
    notes: patch.notes !== undefined ? normalizeNotes(patch.notes) : now.notes,
  };
  // O que já está gravado assim não muda (mandar de novo depois de uma falha não é conflito).
  const changed = SHEET_FIELDS.filter((f) => patch[f] !== undefined && !sameSheetValue(f, next, now));
  const conflict = changed.filter((f) => marks[f] !== fieldMark(f, now));
  if (conflict.length) return { conflict };
  if (changed.includes('shipPlan')) {
    const problem = shipPlanProblem(next.shipPlan, current.quantity);
    if (problem) return { problem };
  }
  return { next, changed };
}

/** "a programação de envio mudou" / "as observações mudaram", para as mensagens do servidor. */
export function changedInAppText(fields: readonly SheetField[]): string {
  const plural = fields.length > 1 || fields[0] === 'notes';
  return `${list(fields.map((f) => IN_SENTENCE[f]))} ${plural ? 'mudaram' : 'mudou'} no app`;
}
