// Curva ABC (pedido do Gabriel em 20/11/2026): a planilha do sistema de vendas, com o estoque atual e
// as vendas de 1, 3, 6, 9 e 12 meses de cada título (o total vendido em cada período, não a média). Ela
// é carregada toda semana do jeito que sai: as colunas são achadas pelo nome, cada linha vira um título
// e o que não é título (a linha do total, no fim) fica de fora. Valores em dinheiro não são lidos: a
// previsão de estoque só tem quantidades.

import { toIsbn13 } from './isbn';
import { searchKey } from './items';

/** Até quantas linhas a planilha da curva é lida (a de 19/11/2026 tem 2.460 títulos). */
export const CURVE_MAX_ROWS = 20_000;

export interface CurveSales {
  m1: number | null;
  m3: number;
  m6: number;
  m9: number | null;
  m12: number | null;
}

export interface CurveRow {
  /** Código de barras: o ISBN-13 dos livros (o ISBN-10 vira ISBN-13) ou o código das revistas. */
  isbn: string;
  title: string;
  /** Código do produto no sistema de vendas. */
  code: string;
  /** Classe na curva ABC (A, B ou C); vazio se a planilha não traz. */
  abcClass: string;
  /** Estoque atual. */
  stock: number;
  /** Total vendido em cada período. As colunas de 1, 9 e 12 meses podem faltar; as de 3 e 6, não. */
  sales: CurveSales;
}

export interface CurveRead {
  rows: CurveRow[];
  /** Linhas descartadas, com o motivo. */
  ignored: { row: number; text: string; reason: string }[];
  /** Códigos que aparecem em mais de uma linha: o estoque e as vendas são somados. */
  merged: { isbn: string; title: string; lines: number }[];
  /** Títulos com estoque negativo, que conta como zero. */
  negativeStock: number;
  /** Títulos com venda negativa em algum período (devolução maior que a venda), que conta como zero. */
  negativeSales: number;
}

type Column = 'isbn' | 'title' | 'code' | 'abcClass' | 'stock' | 'm1' | 'm3' | 'm6' | 'm9' | 'm12';

/** Nomes aceitos para cada coluna, já sem acento, maiúscula nem pontuação. */
const NAMES: Record<Column, readonly string[]> = {
  isbn: ['codigo barras', 'codigo de barras', 'cod barras', 'isbn', 'ean', 'codigo ean'],
  title: ['descricao', 'descricao do produto', 'titulo', 'nome'],
  code: ['produto', 'codigo', 'cod produto', 'codigo do produto'],
  abcClass: ['classe', 'classe abc', 'curva'],
  stock: ['estoque atual', 'estoque', 'estoque fisico', 'saldo', 'saldo atual'],
  m1: ['vendas 1 mes', 'venda 1 mes', 'vendas 1 meses', 'vendas 30 dias'],
  m3: ['vendas 3 meses', 'venda 3 meses', 'vendas 90 dias'],
  m6: ['vendas 6 meses', 'venda 6 meses', 'vendas 180 dias'],
  m9: ['vendas 9 meses', 'venda 9 meses', 'vendas 270 dias'],
  m12: ['vendas 12 meses', 'venda 12 meses', 'vendas 1 ano', 'vendas 360 dias', 'vendas 365 dias'],
};

const REQUIRED: readonly Column[] = ['isbn', 'title', 'stock', 'm3', 'm6'];

const LABELS: Record<Column, string> = {
  isbn: 'Codigo Barras',
  title: 'Descrição',
  code: 'Produto',
  abcClass: 'Classe',
  stock: 'Estoque Atual',
  m1: 'Vendas 1 mês',
  m3: 'Vendas 3 meses',
  m6: 'Vendas 6 meses',
  m9: 'Vendas 9 meses',
  m12: 'Vendas 12 meses',
};

const headerKey = (text: string) =>
  searchKey(text)
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

function columnsOf(row: readonly string[]): Partial<Record<Column, number>> {
  const found: Partial<Record<Column, number>> = {};
  row.forEach((cell, index) => {
    const key = headerKey(cell);
    for (const col of Object.keys(NAMES) as Column[]) {
      if (found[col] === undefined && NAMES[col].includes(key)) found[col] = index;
    }
  });
  return found;
}

/**
 * Código de barras como chave do título: só os dígitos; o ISBN-10 vira ISBN-13. Aceita 13 dígitos
 * (ISBN e código de barras das revistas), 12 e 8 (outros códigos de barras) e o ISBN-10 válido; null
 * para o resto (como o código interno de 6 dígitos do conteúdo digital).
 */
export function barcodeKey(text: string): string | null {
  const t = text.replace(/[\s.-]/g, '').toUpperCase();
  if (/^\d{9}[\dX]$/.test(t)) {
    const isbn = toIsbn13(t);
    return isbn.length === 13 ? isbn : null;
  }
  return /^(\d{8}|\d{12}|\d{13})$/.test(t) ? t : null;
}

/** Quantidade escrita na planilha ("41900", "41.900", "41,900", vazio = 0); null se não é número. */
export function quantityValue(text: string): number | null {
  const t = text.replace(/\s/g, '');
  if (t === '') return 0;
  if (/^-?\d+$/.test(t)) return Number(t);
  if (/^-?\d{1,3}(\.\d{3})+$/.test(t)) return Number(t.replace(/\./g, ''));
  if (/^-?\d{1,3}(,\d{3})+$/.test(t)) return Number(t.replace(/,/g, ''));
  const decimal = /^(-?\d+)[.,](\d+)$/.exec(t);
  if (decimal) return Math.round(Number(`${decimal[1]}.${decimal[2]}`));
  return null;
}

/** Lê a planilha da curva (linhas como texto, a primeira aba que tem as colunas). */
export function readStockCurve(rows: readonly (readonly string[])[]): CurveRead | { error: string } {
  // O cabeçalho é a primeira linha (entre as 10 primeiras) com todas as colunas obrigatórias.
  let header = -1;
  let cols: Partial<Record<Column, number>> = {};
  let best: Partial<Record<Column, number>> = {};
  for (let r = 0; r < Math.min(rows.length, 10); r++) {
    const found = columnsOf(rows[r]!);
    if (REQUIRED.every((c) => found[c] !== undefined)) {
      header = r;
      cols = found;
      break;
    }
    if (Object.keys(found).length > Object.keys(best).length) best = found;
  }
  if (header < 0) {
    const missing = REQUIRED.filter((c) => best[c] === undefined).map((c) => `"${LABELS[c]}"`);
    return { error: `A planilha não parece a curva ABC: faltam as colunas ${missing.join(', ')}.` };
  }

  const at = (row: readonly string[], col: Column) => {
    const i = cols[col];
    return i === undefined ? '' : (row[i] ?? '').trim();
  };
  const byKey = new Map<string, CurveRow>();
  const lines = new Map<string, number>();
  const ignored: CurveRead['ignored'] = [];
  let negativeStock = 0;
  let negativeSales = 0;
  for (let r = header + 1; r < rows.length; r++) {
    const row = rows[r]!;
    const barcode = at(row, 'isbn');
    const title = at(row, 'title').replace(/\s+/g, ' ');
    // Sem código e sem nome não é título (a linha do total, no fim da planilha).
    if (!barcode && !title) continue;
    const text = title || barcode;
    if (!barcode) {
      ignored.push({ row: r + 1, text, reason: 'sem código de barras' });
      continue;
    }
    const isbn = barcodeKey(barcode);
    if (!isbn) {
      ignored.push({ row: r + 1, text, reason: `o código ${barcode} não é ISBN nem código de barras` });
      continue;
    }
    const value = (col: Column) => (cols[col] === undefined ? null : quantityValue(at(row, col)));
    const numbers = { stock: value('stock'), m1: value('m1'), m3: value('m3'), m6: value('m6'), m9: value('m9'), m12: value('m12') };
    const bad = (Object.keys(numbers) as (keyof typeof numbers)[]).find((k) => cols[k] !== undefined && numbers[k] === null);
    if (bad) {
      ignored.push({ row: r + 1, text, reason: `"${LABELS[bad]}" não é um número` });
      continue;
    }
    if (numbers.stock !== null && numbers.stock < 0) negativeStock++;
    if ([numbers.m1, numbers.m3, numbers.m6, numbers.m9, numbers.m12].some((n) => n !== null && n < 0)) negativeSales++;
    const pos = (n: number | null) => (n === null ? null : Math.max(0, n));
    const parsed: CurveRow = {
      isbn,
      title: title || `Sem descrição (${barcode})`,
      code: at(row, 'code'),
      abcClass: at(row, 'abcClass').toUpperCase().slice(0, 2),
      stock: pos(numbers.stock)!,
      sales: { m1: pos(numbers.m1), m3: pos(numbers.m3)!, m6: pos(numbers.m6)!, m9: pos(numbers.m9), m12: pos(numbers.m12) },
    };
    const same = byKey.get(isbn);
    lines.set(isbn, (lines.get(isbn) ?? 0) + 1);
    if (!same) {
      byKey.set(isbn, parsed);
      continue;
    }
    // O mesmo código em duas linhas (dois códigos de produto do mesmo livro): soma.
    const sum = (a: number | null, b: number | null) => (a === null && b === null ? null : (a ?? 0) + (b ?? 0));
    same.stock += parsed.stock;
    same.sales = {
      m1: sum(same.sales.m1, parsed.sales.m1),
      m3: same.sales.m3 + parsed.sales.m3,
      m6: same.sales.m6 + parsed.sales.m6,
      m9: sum(same.sales.m9, parsed.sales.m9),
      m12: sum(same.sales.m12, parsed.sales.m12),
    };
    if (parsed.code && !same.code.split(', ').includes(parsed.code)) same.code = same.code ? `${same.code}, ${parsed.code}` : parsed.code;
  }
  const merged = [...lines].filter(([, n]) => n > 1).map(([isbn, n]) => ({ isbn, title: byKey.get(isbn)!.title, lines: n }));
  return { rows: [...byKey.values()], ignored, merged, negativeStock, negativeSales };
}

/**
 * A data do estoque, quando o nome do arquivo ou da aba traz o dia ("curva_abc_19-11.xlsx", "curva
 * 19.11.2026"): o dia mais recente que não passa de hoje (sem ano, o deste ano, ou o do ano passado se
 * cairia no futuro). null quando nenhum nome traz uma data.
 */
export function curveDateFromName(names: readonly string[], today: string): string | null {
  const re = /(?:^|\D)(\d{1,2})[-_./](\d{1,2})(?:[-_./](\d{4}|\d{2}))?(?!\d)/g;
  const thisYear = Number(today.slice(0, 4));
  for (const name of names) {
    // Também AAAA-MM-DD.
    for (const m of name.matchAll(/(?:^|\D)(\d{4})-(\d{2})-(\d{2})(?!\d)/g)) {
      const iso = `${m[1]}-${m[2]}-${m[3]}`;
      const d = new Date(`${iso}T00:00:00Z`);
      if (!Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso && iso <= today) return iso;
    }
    for (const m of name.matchAll(re)) {
      const day = Number(m[1]);
      const month = Number(m[2]);
      const given = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : null;
      for (const year of given ? [given] : [thisYear, thisYear - 1]) {
        const d = new Date(Date.UTC(year, month - 1, day));
        if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) break;
        const iso = d.toISOString().slice(0, 10);
        if (iso <= today) return iso;
      }
    }
  }
  return null;
}
