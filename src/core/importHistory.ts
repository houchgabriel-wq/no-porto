// Carga da aba Entregues (SPEC.md, seção 7): cerca de 4.000 itens recebidos desde 2023. A chegada
// está quase sempre como texto sem ano ("chegada 29/08", "chegou 18/04", "Entregue 10-10"); o ano é
// deduzido, nesta ordem: do ano escrito na célula; do bloco do ano na própria aba (as linhas "2024",
// "2025" e "2026" separam os anos de chegada, e o bloco antes da primeira é o ano anterior; conferido
// em 17/11/2026: as 240 datas com ano escrito caem todas no bloco certo); do BL ou da invoice (que
// trazem ano e mês do embarque); do ano da ref. do embarque; e, por fim, da ordem das linhas.

import { clean, findHeader, readItemCells, type RowNote } from './importProduction';
import { invoiceKey } from './importShipments';
import { itemTotalCents } from './money';
import { searchKey } from './items';
import { daysBetween, parseDate } from './shipments';

export interface ImportedHistoryItem {
  row: number;
  description: string;
  isbn: string | null;
  supplier: string | null;
  quantity: number;
  piecesPerCarton: number | null;
  unitPriceMicros: number | null;
  notes: string;
  /** Especificação do produto (só na cópia completa do app). */
  specification: string;
  /** Número da invoice; sem invoice, a ref.; sem as duas, "Planilha, linha N". */
  invoice: string;
  ref: string;
  bill: string | null;
  /** Chegada (AAAA-MM-DD), ou null quando não deu para saber. */
  arrivedAt: string | null;
  /** Texto original da chegada e de onde veio o ano, para conferência. */
  arrivalNote: string;
  paid: boolean;
}

export interface HistoryImportReport {
  items: ImportedHistoryItem[];
  skipped: RowNote[];
  warnings: RowNote[];
}

// Colunas da aba Entregues pela posição: o cabeçalho da planilha está deslocado (dois "Fornecedor" e
// "Chegada na Editora" em cima da coluna do pagamento), mas as colunas são as mesmas da aba Embarques.
const COLS = { ref: 0, description: 1, isbn: 2, piecesPerCarton: 3, quantity: 4, unitPrice: 5, total: 6, supplier: 7, arrival: 8, payment: 9, invoice: 10, bill: 11 } as const;

type ArrivalKind = 'chegada' | 'previsao' | 'porto' | 'saida';

interface ArrivalText {
  kind: ArrivalKind;
  day: number;
  month: number;
  year: number | null;
}

/** Lê "chegada 29/08", "Previsão chegada 12-01-24", "recebido 25/06/24" ou uma data (dd/mm/aaaa). */
export function parseArrivalText(text: string): ArrivalText | null {
  const t = clean(text).toLowerCase();
  const m = /(\d{1,2})\s*[/-]\s*(\d{1,2})(?:\s*[/-]\s*(\d{2,4}))?/.exec(t);
  if (!m) return null;
  const day = Number(m[1]);
  const month = Number(m[2]);
  if (day < 1 || day > 31 || month < 1 || month > 12) return null;
  let year: number | null = null;
  if (m[3]) year = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  const kind: ArrivalKind = /embarque|sa[ií]da/.test(t) ? 'saida' : /previs/.test(t) ? 'previsao' : /porto/.test(t) ? 'porto' : 'chegada';
  return { kind, day, month, year };
}

export interface YearHint {
  /** Primeiro mês em que a chegada pode cair (AAAA-MM). */
  from: string;
  /** De onde veio a pista, para a observação. */
  source: string;
}

/** Pista de quando o item embarcou, pelo BL, pela invoice ou pela ref. */
export function yearHint(ref: string, invoice: string, bill: string): YearHint | null {
  const ym = (y: number, m: number) => `${y}-${String(m).padStart(2, '0')}`;
  let m = /ROECHN\s*(\d{2})(\d{2})/i.exec(bill);
  if (m && Number(m[2]) >= 1 && Number(m[2]) <= 12) return { from: ym(2000 + Number(m[1]), Number(m[2])), source: `BL ${bill.trim()}` };
  for (const [text, label] of [
    [invoice, 'invoice'],
    [ref, 'ref.'],
  ] as const) {
    m = /(20(2\d))[-_]?(0[1-9]|1[0-2])(?!\d)/.exec(text) ?? /(20(2\d))[-_]?(0[1-9]|1[0-2])\d{2}/.exec(text);
    if (m) return { from: ym(Number(m[1]), Number(m[3])), source: `${label} ${text.trim()}` };
  }
  for (const [text, label] of [
    [ref, 'ref.'],
    [invoice, 'invoice'],
  ] as const) {
    // Só o ano: "23-1089", "24/049", "SSL23/0573CT", "IM24/00106", "SS2024/0002", "GN/23-24/232".
    m = /^\s*(2\d)[-/]/.exec(text) ?? /(?:SSL\/?|IM|GN\/|Export\/\d+\/)(2\d)[-/]/i.exec(text) ?? /SS(20(2\d))\//i.exec(text);
    if (m) {
      const year = m[1]!.length === 4 ? Number(m[1]) : 2000 + Number(m[1]);
      return { from: ym(year, 1), source: `${label} ${text.trim()}` };
    }
  }
  return null;
}

function iso(y: number, m: number, d: number): string | null {
  return parseDate(`${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
}

/**
 * Escolhe o ano da data dia/mês. Com a pista do embarque: o primeiro ano em que a data cai a partir
 * do mês do embarque (com 15 dias de folga). Sem pista: o ano que deixa a data mais perto da linha
 * anterior, aceitando até 90 dias para trás.
 */
export function chooseYear(day: number, month: number, hint: YearHint | null, previous: string | null, today?: string): number | null {
  const chosen = chooseYearRaw(day, month, hint, previous);
  // O que já foi entregue não chegou no futuro: passa para o ano anterior.
  if (chosen !== null && today) {
    const d = iso(chosen, month, day);
    if (d && d > today) return chosen - 1;
  }
  return chosen;
}

function chooseYearRaw(day: number, month: number, hint: YearHint | null, previous: string | null): number | null {
  if (hint) {
    const start = Number(hint.from.slice(0, 4));
    for (const y of [start, start + 1]) {
      const d = iso(y, month, day);
      if (d && daysBetween(`${hint.from}-01`, d) >= -15) return y;
    }
    return start;
  }
  if (!previous) return null;
  const py = Number(previous.slice(0, 4));
  let best: number | null = null;
  let bestScore = Infinity;
  for (const y of [py - 1, py, py + 1]) {
    const d = iso(y, month, day);
    if (!d) continue;
    const diff = daysBetween(previous, d);
    const score = diff >= -90 ? Math.abs(diff) : 10_000 + Math.abs(diff);
    if (score < bestScore) {
      bestScore = score;
      best = y;
    }
  }
  return best;
}

const ARRIVAL_PATTERN = /(cheg|entreg|entrg|receb|porto|previs|embarque|sa[ií]da)\D*\d{1,2}\s*[/-]\s*\d{1,2}/i;

/** `today` (AAAA-MM-DD) impede que a dedução do ano ponha uma chegada no futuro. */
export function parseHistoryRows(rows: readonly string[][], today?: string): HistoryImportReport | { error: string } {
  const header = findHeader(rows, {});
  if (!header || header.cols.description !== COLS.description || header.cols.quantity !== COLS.quantity) {
    return { error: 'A aba Entregues precisa ter "Produto" na coluna B e "Quantidade" na coluna E, como as abas Produção e Embarques.' };
  }
  const report: HistoryImportReport = { items: [], skipped: [], warnings: [] };
  let previous: string | null = null;
  // Linha separadora de ano: só o ano na coluna A, sem quantidade.
  const separatorYear = (row: string[]) => {
    const a = clean(row[COLS.ref]);
    return /^20[2-3]\d$/.test(a) && !clean(row[COLS.quantity]) ? Number(a) : null;
  };
  const firstSeparator = rows.slice(header.index + 1).map(separatorYear).find((y) => y !== null) ?? null;
  let blockYear: number | null = firstSeparator === null ? null : firstSeparator - 1;
  // Bloco de linhas sem invoice e sem ref.: mesma chegada e mesmo fornecedor, em sequência.
  let block: { key: string; name: string } | null = null;

  for (let i = header.index + 1; i < rows.length; i++) {
    const row = rows[i]!;
    const line = i + 1;
    if (row.every((c) => ['', '-', '0'].includes(clean(c)))) continue;
    const separator = separatorYear(row);
    if (separator !== null) {
      blockYear = separator;
      continue;
    }
    const at = (col: keyof typeof COLS) => row[COLS[col]] ?? '';
    const warn = (message: string) => report.warnings.push({ row: line, message });
    // A especificação não tem posição fixa: é a coluna "Especificação", quando existe (cópia completa).
    const specCol = header.cols.specification;
    const cells = readItemCells((col) => (col === 'specification' ? (specCol === undefined ? '' : (row[specCol] ?? '')) : at(col)), warn);
    if ('skip' in cells) {
      report.skipped.push({ row: line, message: cells.skip });
      continue;
    }
    const { notes, ...fields } = cells;

    const refRaw = clean(at('ref'));
    const ref = refRaw === '-' ? '' : /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(refRaw) ? (parseDate(refRaw) ?? refRaw) : refRaw;
    const invoiceCol = clean(at('invoice'));
    const bill = clean(at('bill')) || null;

    // A chegada mora na coluna I; às vezes a coluna J (do pagamento) traz a chegada de verdade e a I, a previsão.
    let arrivalText = clean(at('arrival'));
    let paymentText = clean(at('payment'));
    if (ARRIVAL_PATTERN.test(paymentText) && /chegada|chegou|entreg/i.test(paymentText)) {
      notes.push(`Na planilha: "${arrivalText}"; chegada "${paymentText}"`);
      arrivalText = paymentText;
      paymentText = '';
    }

    let invoice = invoiceCol || ref;
    if (!invoice) {
      const key = `${searchKey(arrivalText)}|${searchKey(fields.supplier ?? '')}`;
      if (!block || block.key !== key) block = { key, name: `Planilha, linha ${line}` };
      invoice = block.name;
    } else block = null;

    let arrivedAt: string | null = null;
    let arrivalNote = '';
    const asDate = /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(arrivalText) ? parseDate(arrivalText) : null;
    const parsed = asDate ? null : parseArrivalText(arrivalText);
    if (asDate) {
      arrivedAt = asDate;
    } else if (!arrivalText) {
      arrivalNote = 'Sem chegada na planilha';
      warn(`"${fields.description}": sem data de chegada.`);
    } else if (!parsed) {
      arrivalNote = `Chegada na planilha: "${arrivalText}" (sem data)`;
      warn(`"${fields.description}": chegada "${arrivalText}" sem data reconhecível.`);
    } else {
      const hint = parsed.year || blockYear ? null : yearHint(ref, invoiceCol, bill ?? '');
      const year: number | null = parsed.year ?? blockYear ?? chooseYear(parsed.day, parsed.month, hint, previous, today);
      const date: string | null = year ? iso(year, parsed.month, parsed.day) : null;
      const source = parsed.year
        ? 'ano escrito na planilha'
        : blockYear
          ? `ano pelo bloco ${blockYear} da planilha`
          : hint
            ? `ano pela ${hint.source}`
            : year
              ? 'ano pela ordem das linhas'
              : 'sem pista do ano';
      arrivalNote = `Chegada na planilha: "${arrivalText}" (${source})`;
      if (parsed.kind === 'saida') {
        arrivalNote = `Na planilha só há a data de embarque: "${arrivalText}"`;
      } else if (date) {
        arrivedAt = date;
      } else {
        warn(`"${fields.description}": não deu para saber o ano da chegada "${arrivalText}".`);
      }
    }
    if (arrivedAt) previous = arrivedAt;

    const paid = /^pago/i.test(paymentText);
    if (/^pago\s+\d/i.test(paymentText)) notes.push(`Pagamento na planilha: ${paymentText}`);
    report.items.push({ row: line, ...fields, notes: notes.join('\n'), invoice, ref, bill, arrivedAt, arrivalNote, paid });
  }
  return report;
}

export interface HistorySummaryRow {
  year: string;
  items: number;
  quantity: number;
  valueCents: number;
}

/** Resumo por ano de chegada, para comparar com a planilha antes de gravar. */
export function summarizeHistory(items: readonly ImportedHistoryItem[]): { byYear: HistorySummaryRow[]; total: HistorySummaryRow; invoices: number; withoutDate: number } {
  const groups = new Map<string, HistorySummaryRow>();
  const total: HistorySummaryRow = { year: 'Total', items: 0, quantity: 0, valueCents: 0 };
  for (const item of items) {
    const year = item.arrivedAt?.slice(0, 4) ?? 'Sem data';
    const g = groups.get(year) ?? { year, items: 0, quantity: 0, valueCents: 0 };
    groups.set(year, g);
    const value = item.unitPriceMicros === null ? 0 : itemTotalCents(item.quantity, item.unitPriceMicros);
    for (const t of [g, total]) {
      t.items += 1;
      t.quantity += item.quantity;
      t.valueCents += value;
    }
  }
  const byYear = [...groups.values()].sort((a, b) => (a.year === 'Sem data' ? 1 : b.year === 'Sem data' ? -1 : a.year.localeCompare(b.year)));
  const invoices = new Set(items.map((i) => invoiceKey(searchKey(i.supplier ?? ''), i.invoice, i.bill))).size;
  return { byYear, total, invoices, withoutDate: items.filter((i) => !i.arrivedAt).length };
}
