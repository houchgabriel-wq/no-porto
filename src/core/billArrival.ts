// Chegada prevista pelo BL (pedido do Gabriel em 26/11/2026): ao ler o BL, a chegada prevista vem
// preenchida com a data do BL mais um prazo, de 35 dias por padrão, que o admin pode mudar depois. A data
// do BL é a do embarque a bordo ("Shipped on Board"); sem ela, a da emissão ("Place and date of issue").
// No HBL do 57º embarque da Miyi, as duas são "Nov 28, 2026", cada uma embaixo do seu rótulo. A data do
// BL não é guardada (a data de saída ficou de fora, decisão de 17/11/2026): ela só calcula a chegada.

import { daysBetween, formatDay } from './shipments';
import { addDays } from './stockForecast';

/** O prazo padrão, em dias, da data do BL até a chegada prevista. */
export const ARRIVAL_DAYS_DEFAULT = 35;
export const ARRIVAL_DAYS_MAX = 120;

/** O prazo digitado: um número inteiro de dias, de 1 a 120. null quando serve. */
export function arrivalDaysProblem(days: number): string | null {
  return Number.isInteger(days) && days >= 1 && days <= ARRIVAL_DAYS_MAX ? null : `Informe o prazo em dias, um número inteiro de 1 a ${ARRIVAL_DAYS_MAX}.`;
}

/** A chegada prevista: a data do BL mais o prazo. */
export function arrivalFromBill(billDate: string, days: number): string {
  return addDays(billDate, days);
}

// ---------- Datas escritas no BL ----------

const MONTH_NAMES = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)(?![a-z])';
const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

const DATE_PATTERNS: { re: RegExp; parts: (m: RegExpExecArray) => [number, number, number] | null }[] = [
  // "Nov 28, 2026", "NOV.28,2026", "November 28th 2026"
  {
    re: new RegExp(`\\b${MONTH_NAMES}\\.?[\\s-]*(\\d{1,2})(?:st|nd|rd|th)?(?:\\s*,\\s*|[\\s.-]+)(\\d{4}|\\d{2})\\b`, 'gi'),
    parts: (m) => [year(m[3]!), MONTHS[m[1]!.slice(0, 3).toLowerCase()]!, Number(m[2])],
  },
  // "28 Nov 2026", "28-NOV-26", "28th November, 2026"
  {
    re: new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?[\\s./-]*${MONTH_NAMES}\\.?[\\s./,-]*(\\d{4}|\\d{2})\\b`, 'gi'),
    parts: (m) => [year(m[3]!), MONTHS[m[2]!.slice(0, 3).toLowerCase()]!, Number(m[1])],
  },
  // "2026-11-28", "2026/11/28", "2026.11.28"
  { re: /\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b/g, parts: (m) => [Number(m[1]), Number(m[2]), Number(m[3])] },
  // "28/11/2026" (dia primeiro) ou "11/28/2026" (mês primeiro, como nos Estados Unidos). Quando os dois
  // números vão até 12, não dá para saber qual é o mês, e a data fica de fora.
  {
    re: /\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})\b/g,
    parts: (m) => {
      const [a, b, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
      if (a > 12 && b <= 12) return [y, b, a];
      if (b > 12 && a <= 12) return [y, a, b];
      return a === b ? [y, a, a] : null;
    },
  },
];

function year(text: string): number {
  return text.length === 2 ? 2000 + Number(text) : Number(text);
}

function isoDate(y: number, m: number, d: number): string | null {
  if (y < 2000 || y > 2099) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** As datas escritas num texto, na ordem em que aparecem, em AAAA-MM-DD. */
export function datesInText(text: string): string[] {
  const found: { index: number; end: number; date: string }[] = [];
  for (const { re, parts } of DATE_PATTERNS) {
    for (const m of text.matchAll(re)) {
      const p = parts(m as RegExpExecArray);
      const date = p ? isoDate(...p) : null;
      if (date) found.push({ index: m.index, end: m.index + m[0].length, date });
    }
  }
  found.sort((a, b) => a.index - b.index);
  const result: string[] = [];
  let end = -1;
  for (const f of found) {
    if (f.index < end) continue;
    result.push(f.date);
    end = f.end;
  }
  return result;
}

// ---------- A data do BL ----------

/** Um pedaço do texto do PDF, com a posição na página (em pontos; y cresce para cima, como no PDF). */
export interface PdfItem {
  text: string;
  page: number;
  x: number;
  y: number;
  width: number;
}

export interface BillDate {
  /** AAAA-MM-DD. */
  date: string;
  /** De onde veio: do embarque a bordo, da emissão do BL ou, sem os rótulos, a única data do documento. */
  source: 'embarque' | 'emissao' | 'unica';
}

const ON_BOARD = /\b(?:shipped|laden|loaded)\s*on\s*board\b|\bon\s*board\s*date\b|\bdate\s*(?:of\s*)?(?:shipment|loading)\b|\b(?:shipment|loading)\s*date\b/i;
const ISSUE = /\bdate\s*of\s*issue\b|\bissue\s*date\b|\bdate\s*issued\b/i;
/** Rótulo é texto curto: as cláusulas do BL também falam em "shipped on board", em linhas compridas. */
const LABEL_MAX_CHARS = 60;

/** A data mais perto do rótulo: no próprio pedaço, à direita na mesma linha ou logo embaixo, na coluna dele. */
function dateNear(label: PdfItem, match: RegExpExecArray, items: readonly PdfItem[]): { date: string; distance: number } | null {
  const own = datesInText(label.text.slice(match.index + match[0].length))[0];
  if (own) return { date: own, distance: 0 };
  let best: { date: string; distance: number } | null = null;
  for (const it of items) {
    if (it === label || it.page !== label.page) continue;
    const date = datesInText(it.text)[0];
    if (!date) continue;
    const right = label.x + label.width;
    const drop = label.y - it.y;
    let distance: number | null = null;
    // À direita, na mesma linha.
    if (Math.abs(drop) <= 3 && it.x >= right - 1 && it.x - right <= 220) distance = Math.max(0, it.x - right) / 2;
    // Embaixo, até umas três linhas, começando na coluna do rótulo.
    else if (drop > 3 && drop <= 45 && it.x >= label.x - 40 && it.x <= label.x + Math.max(label.width, 120)) distance = drop + Math.abs(it.x - label.x) / 4;
    if (distance !== null && (!best || distance < best.distance)) best = { date, distance };
  }
  return best;
}

function labeledDate(items: readonly PdfItem[], label: RegExp): string | null {
  let best: { date: string; distance: number } | null = null;
  for (const it of items) {
    if (it.text.trim().length > LABEL_MAX_CHARS) continue;
    const m = label.exec(it.text);
    if (!m) continue;
    const near = dateNear(it, m, items);
    if (near && (!best || near.distance < best.distance)) best = near;
  }
  return best?.date ?? null;
}

/**
 * A data do BL: a do embarque a bordo; sem ela, a da emissão; sem os dois rótulos (ou sem data perto
 * deles), a única data que o documento tem. null quando não acha, ou quando há mais de uma data sem rótulo.
 */
export function readBillDate(items: readonly PdfItem[]): BillDate | null {
  const onBoard = labeledDate(items, ON_BOARD);
  if (onBoard) return { date: onBoard, source: 'embarque' };
  const issue = labeledDate(items, ISSUE);
  if (issue) return { date: issue, source: 'emissao' };
  const all = new Set(items.flatMap((it) => datesInText(it.text)));
  return all.size === 1 ? { date: [...all][0]!, source: 'unica' } : null;
}

/** Data do BL fora do razoável (mais de um ano antes de hoje, ou mais de 60 dias depois) é erro de leitura. */
export function billDateProblem(date: string, today: string): string | null {
  const days = daysBetween(today, date);
  return days > 60 || days < -365 ? `A data lida no BL (${formatDay(date, true)}) parece errada: confira e informe a chegada prevista.` : null;
}

const SOURCE_TEXT: Record<BillDate['source'], string> = {
  embarque: 'do embarque a bordo',
  emissao: 'da emissão do BL',
  unica: 'a única data do BL',
};

/** "Data do BL: 28/11/2026, do embarque a bordo." */
export function billDateText(d: BillDate): string {
  return `Data do BL: ${formatDay(d.date, true)}, ${SOURCE_TEXT[d.source]}.`;
}

/** "35 dias depois, em 02/01/2027" */
export function arrivalText(billDate: string, days: number): string {
  return `${days === 1 ? '1 dia' : `${days} dias`} depois, em ${formatDay(arrivalFromBill(billDate, days), true)}`;
}
