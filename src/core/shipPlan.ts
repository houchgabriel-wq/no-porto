// Programação de envio de cada item (pedido do Gabriel em 19/11/2026): até três embarques, cada um com o
// mês e a quantidade. Um título grande pode sair em três vezes: dez 20 mil, fev 20 mil e abr 20 mil.
// Quando parte do item embarca, sai primeiro o que estava programado para antes.

import { formatQuantity } from './money';

export interface ShipParcel {
  /** Mês do envio (AAAA-MM). */
  month: string;
  /** Exemplares deste embarque. */
  quantity: number;
}

export type ShipPlan = ShipParcel[];

/** Um título sai em até três embarques. */
export const MAX_PARCELS = 3;

const MONTH_NAMES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'] as const;

export function isMonth(text: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(text);
}

/** "2026-12" → "dez/2026". */
export function formatMonth(month: string): string {
  const [year, m] = month.split('-');
  return `${MONTH_NAMES[Number(m) - 1] ?? m}/${year}`;
}

/** O mês (AAAA-MM) `n` meses depois de `month` (antes, com `n` negativo). */
export function addMonths(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const index = y * 12 + (m - 1) + n;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
}

/** Os meses da lista de escolha: de `back` meses antes até `ahead` meses depois de `from`, mais os já usados. */
export function monthOptions(from: string, back: number, ahead: number, keep: readonly string[] = []): string[] {
  const months = new Set<string>(keep.filter(isMonth));
  for (let i = -back; i <= ahead; i++) months.add(addMonths(from, i));
  return [...months].sort();
}

export function sortPlan<T extends ShipParcel>(plan: readonly T[]): T[] {
  return [...plan].sort((a, b) => a.month.localeCompare(b.month));
}

export function plannedTotal(plan: readonly ShipParcel[]): number {
  return plan.reduce((sum, p) => sum + p.quantity, 0);
}

/** O que impede a programação de valer para um item com `itemQuantity` exemplares, ou null. */
export function shipPlanProblem(plan: readonly ShipParcel[], itemQuantity: number): string | null {
  if (plan.length > MAX_PARCELS) return `No máximo ${MAX_PARCELS} embarques na programação de envio.`;
  const seen = new Set<string>();
  for (const [i, p] of plan.entries()) {
    const n = i + 1;
    if (!isMonth(p.month)) return `Escolha o mês do embarque ${n}.`;
    if (seen.has(p.month)) return `O mês ${formatMonth(p.month)} aparece em dois embarques. Junte as quantidades num só.`;
    seen.add(p.month);
    if (!Number.isInteger(p.quantity) || p.quantity <= 0) return `Informe a quantidade do embarque ${n}.`;
  }
  const total = plannedTotal(plan);
  if (total > itemQuantity) {
    return `A programação de envio soma ${formatQuantity(total)} exemplares, mais que os ${formatQuantity(itemQuantity)} do item.`;
  }
  return null;
}

/**
 * Embarcando `quantity` exemplares do item, sai primeiro o que está programado para antes: `taken` vai
 * com a parte embarcada e `left` fica com o saldo em produção.
 */
export function takeFromPlan(plan: readonly ShipParcel[], quantity: number): { taken: ShipPlan; left: ShipPlan } {
  let rest = quantity;
  const taken: ShipPlan = [];
  const left: ShipPlan = [];
  for (const p of sortPlan(plan)) {
    const t = Math.min(Math.max(rest, 0), p.quantity);
    if (t > 0) taken.push({ month: p.month, quantity: t });
    if (p.quantity > t) left.push({ month: p.month, quantity: p.quantity - t });
    rest -= t;
  }
  return { taken, left };
}

/** Junta duas programações (a parte embarcada que volta ao saldo): soma as quantidades de cada mês. */
export function mergePlans(a: readonly ShipParcel[], b: readonly ShipParcel[]): ShipPlan {
  const byMonth = new Map<string, number>();
  for (const p of [...a, ...b]) byMonth.set(p.month, (byMonth.get(p.month) ?? 0) + p.quantity);
  return sortPlan([...byMonth].map(([month, quantity]) => ({ month, quantity })));
}

/** O embarque já devia ter saído: o mês passou e o item continua em produção. `today`: AAAA-MM-DD. */
export function parcelPassed(month: string, today: string): boolean {
  return month < today.slice(0, 7);
}

/** "dez/2026: 20.000; fev/2027: 20.000" (vazio sem programação), para a planilha e o histórico. */
export function shipPlanText(plan: readonly ShipParcel[]): string {
  return sortPlan(plan)
    .map((p) => `${formatMonth(p.month)}: ${formatQuantity(p.quantity)}`)
    .join('; ');
}

/** Um embarque escrito: o mês e, depois de dois pontos, a quantidade ("dez/2026: 20.000"). */
const PARCEL = /^\s*(.+?)\s*(?::\s*([\d.]+)\s*(?:ex\.?)?)?\s*$/i;

/**
 * O mês (AAAA-MM) escrito como "dez/2026", "12/2026" ou "2026-12". Também como dia ("01/12/2026" ou
 * "2026-12-01"), porque a planilha transforma em data o "dez/2026" digitado; o dia não conta.
 */
function readMonth(text: string): string | null {
  let m = /^([a-zç]{3})\/(\d{4})$/i.exec(text);
  if (m) {
    const index = MONTH_NAMES.indexOf(m[1]!.toLowerCase() as (typeof MONTH_NAMES)[number]);
    return index < 0 ? null : `${m[2]}-${String(index + 1).padStart(2, '0')}`;
  }
  let month: string | null = null;
  if ((m = /^(\d{1,2})\/(\d{4})$/.exec(text))) month = `${m[2]}-${m[1]!.padStart(2, '0')}`;
  else if ((m = /^(\d{4})-(\d{2})$/.exec(text))) month = `${m[1]}-${m[2]}`;
  else if ((m = /^\d{1,2}\/(\d{1,2})\/(\d{4})$/.exec(text))) month = `${m[2]}-${m[1]!.padStart(2, '0')}`;
  else if ((m = /^(\d{4})-(\d{2})-\d{2}$/.exec(text))) month = `${m[1]}-${m[2]}`;
  return month && isMonth(month) ? month : null;
}

/**
 * Lê a programação escrita na planilha: "dez/2026: 20.000; fev/2027: 20.000", com os embarques
 * separados por ";" ou quebra de linha. Um mês sozinho, sem quantidade, vale para o item inteiro. Só
 * confere a escrita; quem usa confere a programação com shipPlanProblem.
 */
export function readShipPlanText(text: string, itemQuantity: number): { plan: ShipPlan } | { error: string } {
  const parts = text
    .split(/[;\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const plan: ShipPlan = [];
  for (const part of parts) {
    const m = PARCEL.exec(part);
    const month = m ? readMonth(m[1]!) : null;
    if (!m || !month) return { error: `"${part}" não é um embarque. Escreva como "dez/2026: 20.000; fev/2027: 20.000".` };
    let quantity: number;
    if (m[2]) quantity = Number(m[2].replace(/\./g, ''));
    else if (parts.length === 1) quantity = itemQuantity;
    else return { error: `Falta a quantidade em "${part}". Com mais de um embarque, escreva como "dez/2026: 20.000; fev/2027: 20.000".` };
    plan.push({ month, quantity });
  }
  return { plan: sortPlan(plan) };
}

/**
 * Lê a programação escrita na planilha (a cópia completa do app), como readShipPlanText. Devolve null
 * quando não dá para ler ou quando a programação não vale para o item.
 */
export function parseShipPlanText(text: string, itemQuantity: number): ShipPlan | null {
  const read = readShipPlanText(text, itemQuantity);
  if ('error' in read) return null;
  return shipPlanProblem(read.plan, itemQuantity) === null ? read.plan : null;
}

/** Programação gravada no banco (texto JSON) → lista; o que não for uma lista válida vira vazia. */
export function readStoredPlan(stored: string | null | undefined): ShipPlan {
  if (!stored) return [];
  try {
    const value = JSON.parse(stored) as unknown;
    if (!Array.isArray(value)) return [];
    return sortPlan(
      value.filter(
        (p): p is ShipParcel => !!p && typeof p === 'object' && isMonth((p as ShipParcel).month) && Number.isInteger((p as ShipParcel).quantity) && (p as ShipParcel).quantity > 0,
      ),
    ).map((p) => ({ month: p.month, quantity: p.quantity }));
  } catch {
    return [];
  }
}
