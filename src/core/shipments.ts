// Embarques (SPEC.md, seções 3 e 6): BLs e invoices, chegada prevista e atraso, situação de
// pagamento da invoice e as regras para embarcar itens da produção, inteiros ou em parte.

import { totalOf, type Item, type ItemStatus } from './items';
import { reaisCents } from './money';

export interface Bill {
  id: string;
  number: string;
  /** Chegada prevista (AAAA-MM-DD). */
  eta: string | null;
  /** Chegada real (AAAA-MM-DD). */
  arrivedAt: string | null;
  notes: string;
  /** Arquivo do BL anexado (PDF ou imagem), quando há. */
  document?: { name: string; size: number } | null;
}

export interface Invoice {
  id: string;
  number: string;
  ref: string;
  supplierId: string | null;
  billId: string | null;
  /** Só vale para invoice sem BL; com BL, vale a do BL. */
  eta: string | null;
  arrivedAt: string | null;
  notes: string;
}

export interface Payment {
  id: string;
  invoiceId: string;
  paidAt: string | null;
  /** Sem valor: pagamento antigo da planilha, marcado só como "pago"; quita a invoice. */
  amountCents: number | null;
  /** Reais por dólar × 10.000. */
  exchangeRateE4: number | null;
  notes: string;
}

// ---------- Datas ----------

const spFormat = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' });

/** Dia (AAAA-MM-DD) no fuso de São Paulo. */
export function spDate(instant: Date): string {
  return spFormat.format(instant);
}

/** Dias de `from` até `to` (AAAA-MM-DD); negativo quando `to` é antes. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** Data digitada como dia/mês/ano (ou já AAAA-MM-DD) → AAAA-MM-DD; null se não for uma data válida. */
export function parseDate(text: string): string | null {
  const t = text.trim();
  let y: number, m: number, d: number;
  let match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  if (match) [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  else {
    match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t);
    if (!match) return null;
    [d, m, y] = [Number(match[1]), Number(match[2]), Number(match[3])];
  }
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

const brDate = new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC', day: '2-digit', month: 'short' });
const brDateYear = new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC', day: '2-digit', month: '2-digit', year: 'numeric' });

/** "26 de nov." → "26 nov"; com ano, "26/11/2026". */
export function formatDay(iso: string, withYear = false): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return withYear ? brDateYear.format(d) : brDate.format(d).replace(/\.|de /g, '').trim();
}

// ---------- Chegada ----------

/**
 * Chegada que vale para a invoice: a previsão é a do BL, quando ela está num BL; a chegada real é a
 * da própria invoice, quando registrada (os containers de um BL podem chegar em dias diferentes, como
 * no histórico), e senão a do BL.
 */
export function arrivalOf(invoice: Pick<Invoice, 'billId' | 'eta' | 'arrivedAt'>, bills: ReadonlyMap<string, Pick<Bill, 'eta' | 'arrivedAt'>>): { eta: string | null; arrivedAt: string | null } {
  const bill = invoice.billId ? bills.get(invoice.billId) : undefined;
  return bill ? { eta: bill.eta, arrivedAt: invoice.arrivedAt ?? bill.arrivedAt } : { eta: invoice.eta, arrivedAt: invoice.arrivedAt };
}

export type ArrivalState =
  | { kind: 'chegou'; on: string }
  /** A previsão já passou e a chegada à editora ainda não foi registrada: em geral, liberação no porto. */
  | { kind: 'liberacao'; days: number }
  | { kind: 'previsto'; days: number }
  | { kind: 'sem_previsao' };

/** Situação da chegada: chegou, em liberação (previsão no passado sem chegada), previsto ou sem previsão. */
export function arrivalState(eta: string | null, arrivedAt: string | null, today: string): ArrivalState {
  if (arrivedAt) return { kind: 'chegou', on: arrivedAt };
  if (!eta) return { kind: 'sem_previsao' };
  const days = daysBetween(today, eta);
  return days < 0 ? { kind: 'liberacao', days: -days } : { kind: 'previsto', days };
}

export function arrivalText(state: ArrivalState): string {
  switch (state.kind) {
    case 'chegou':
      return `Chegou em ${formatDay(state.on, true)}`;
    case 'liberacao':
      return state.days === 1 ? 'Em liberação · previsão há 1 dia' : `Em liberação · previsão há ${state.days} dias`;
    case 'previsto':
      return state.days === 0 ? 'Chega hoje' : state.days === 1 ? 'Chega amanhã' : `Chega em ${state.days} dias`;
    case 'sem_previsao':
      return 'Sem previsão de chegada';
  }
}

export const ARRIVAL_GROUPS = ['liberacao', 'semana', 'proxima', 'depois', 'sem_previsao', 'chegaram'] as const;
export type ArrivalGroup = (typeof ARRIVAL_GROUPS)[number];

export const ARRIVAL_GROUP_LABELS: Record<ArrivalGroup, string> = {
  liberacao: 'Em liberação',
  semana: 'Chegam nesta semana',
  proxima: 'Chegam na próxima semana',
  depois: 'Chegam depois',
  sem_previsao: 'Sem previsão',
  chegaram: 'Chegaram',
};

/** Segunda-feira da semana de `day` (AAAA-MM-DD). */
function weekStart(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  const back = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - back);
  return d.toISOString().slice(0, 10);
}

/** Em que grupo da lista de chegadas o embarque entra (semanas de segunda a domingo). */
export function arrivalGroup(eta: string | null, arrivedAt: string | null, today: string): ArrivalGroup {
  const state = arrivalState(eta, arrivedAt, today);
  if (state.kind === 'chegou') return 'chegaram';
  if (state.kind === 'sem_previsao') return 'sem_previsao';
  if (state.kind === 'liberacao') return 'liberacao';
  const weeks = daysBetween(weekStart(today), weekStart(eta!)) / 7;
  return weeks === 0 ? 'semana' : weeks === 1 ? 'proxima' : 'depois';
}

// ---------- Situação dos itens ----------

/** Situação do item pelo embarque: sem invoice, em produção; com invoice, embarcado até chegar. */
export function itemStatusFor(invoiceId: string | null, arrivedAt: string | null): ItemStatus {
  if (!invoiceId) return 'producao';
  return arrivedAt ? 'entregue' : 'embarcado';
}

// ---------- Pagamento ----------

export type PaymentStatus = 'a_pagar' | 'parcial' | 'pago';

export const PAYMENT_LABELS: Record<PaymentStatus, string> = { a_pagar: 'A pagar', parcial: 'Pago em parte', pago: 'Pago' };

export interface PaymentSummary {
  status: PaymentStatus;
  /** Soma dos pagamentos com valor. */
  paidCents: number;
  /** Quanto falta; 0 quando paga. */
  dueCents: number;
  /** Valor em reais dos pagamentos com câmbio (centavos de real). */
  paidReaisCents: number;
}

/**
 * Situação da invoice pelos pagamentos: um pagamento antigo sem valor quita a invoice (decidido em
 * 17/11/2026); senão, compara a soma dos pagamentos com o total dos itens.
 */
export function paymentSummary(totalCents: number, payments: readonly Pick<Payment, 'amountCents' | 'exchangeRateE4'>[]): PaymentSummary {
  const paidCents = payments.reduce((s, p) => s + (p.amountCents ?? 0), 0);
  const paidReaisCents = payments.reduce((s, p) => s + (p.amountCents !== null && p.exchangeRateE4 !== null ? reaisCents(p.amountCents, p.exchangeRateE4) : 0), 0);
  const settled = payments.some((p) => p.amountCents === null) || (paidCents >= totalCents && payments.length > 0);
  if (settled) return { status: 'pago', paidCents, dueCents: 0, paidReaisCents };
  if (paidCents > 0) return { status: 'parcial', paidCents, dueCents: totalCents - paidCents, paidReaisCents };
  return { status: 'a_pagar', paidCents: 0, dueCents: totalCents, paidReaisCents };
}

/** Total da invoice: soma dos itens com preço. */
export function invoiceTotal(items: readonly Item[]): number {
  return items.reduce((s, i) => s + (i.totalCents ?? totalOf(i) ?? 0), 0);
}

// ---------- Embarcar ----------

export interface ShipLine {
  item: Pick<Item, 'id' | 'status' | 'supplierId' | 'quantity' | 'description'>;
  /** Quanto embarca; menos que a quantidade do item divide o item em dois. */
  quantity: number;
}

/**
 * Confere um embarque: só itens em produção, todos do mesmo fornecedor (o da invoice, quando ela já
 * existe), e quantidade entre 1 e a do item. Devolve a mensagem de erro, ou null.
 */
export function shipProblem(lines: readonly ShipLine[], invoiceSupplierId: string | null | undefined): string | null {
  if (lines.length === 0) return 'Escolha os itens para embarcar.';
  const ids = new Set<string>();
  for (const { item, quantity } of lines) {
    if (ids.has(item.id)) return `"${item.description}" aparece duas vezes.`;
    ids.add(item.id);
    if (item.status !== 'producao') return `"${item.description}" já está embarcado.`;
    if (!Number.isInteger(quantity) || quantity < 1) return `"${item.description}": a quantidade a embarcar precisa ser maior que zero.`;
    if (quantity > item.quantity) return `"${item.description}": só há ${item.quantity} em produção.`;
  }
  const suppliers = new Set(lines.map((l) => l.item.supplierId));
  if (suppliers.has(null)) return 'Há item sem fornecedor. Informe o fornecedor na ficha do item antes de embarcar.';
  if (suppliers.size > 1) return 'Uma invoice tem um fornecedor só: embarque os itens de cada fornecedor separadamente.';
  if (invoiceSupplierId && !suppliers.has(invoiceSupplierId)) return 'Esta invoice é de outro fornecedor.';
  return null;
}

// ---------- Tela de embarques ----------

/** Um embarque na tela: um BL com suas invoices, ou uma invoice sem BL. */
export interface ShipmentUnit {
  key: string;
  bill: Bill | null;
  invoices: Invoice[];
  eta: string | null;
  arrivedAt: string | null;
  group: ArrivalGroup;
  /** Fornecedores das invoices, sem repetir. */
  supplierIds: (string | null)[];
}

/**
 * Junta as invoices por BL (as sem BL ficam sozinhas) e ordena pela chegada: em liberação e próximos
 * primeiro, sem previsão depois e os que chegaram no fim, do mais recente para o mais antigo.
 */
export function shipmentUnits(bills: readonly Bill[], invoices: readonly Invoice[], today: string): ShipmentUnit[] {
  const byBill = new Map(bills.map((b) => [b.id, b]));
  const units = new Map<string, ShipmentUnit>();
  for (const invoice of invoices) {
    const bill = invoice.billId ? byBill.get(invoice.billId) : undefined;
    const key = bill ? `bl:${bill.id}` : `inv:${invoice.id}`;
    let unit = units.get(key);
    if (!unit) {
      const { eta, arrivedAt } = bill ? bill : invoice;
      unit = { key, bill: bill ?? null, invoices: [], eta, arrivedAt, group: arrivalGroup(eta, arrivedAt, today), supplierIds: [] };
      units.set(key, unit);
    }
    unit.invoices.push(invoice);
    if (!unit.supplierIds.includes(invoice.supplierId)) unit.supplierIds.push(invoice.supplierId);
  }
  // Um BL chegou quando o BL tem a chegada registrada ou, sem ela, quando todas as suas invoices
  // chegaram (no histórico, cada container chegou num dia): vale a última chegada.
  for (const unit of units.values()) {
    if (!unit.bill || unit.arrivedAt || unit.invoices.length === 0) continue;
    const dates = unit.invoices.map((v) => v.arrivedAt);
    if (dates.every((d): d is string => d !== null)) {
      unit.arrivedAt = dates.sort().at(-1)!;
      unit.group = arrivalGroup(unit.eta, unit.arrivedAt, today);
    }
  }
  // BL sem invoice (todas desfeitas) também aparece, para poder ser corrigido.
  for (const bill of bills) {
    if (!units.has(`bl:${bill.id}`)) {
      units.set(`bl:${bill.id}`, { key: `bl:${bill.id}`, bill, invoices: [], eta: bill.eta, arrivedAt: bill.arrivedAt, group: arrivalGroup(bill.eta, bill.arrivedAt, today), supplierIds: [] });
    }
  }
  const order = (u: ShipmentUnit) => ARRIVAL_GROUPS.indexOf(u.group);
  return [...units.values()].sort((a, b) => {
    if (order(a) !== order(b)) return order(a) - order(b);
    if (a.group === 'chegaram') return (b.arrivedAt ?? '').localeCompare(a.arrivedAt ?? '');
    return (a.eta ?? '').localeCompare(b.eta ?? '') || (a.bill?.number ?? a.invoices[0]?.number ?? '').localeCompare(b.bill?.number ?? b.invoices[0]?.number ?? '');
  });
}

/** Quanto falta pagar, somando as invoices (as pagas e as quitadas pela planilha não entram). */
export function totalDue(invoices: readonly Invoice[], items: readonly Item[], payments: readonly Payment[]): { dueCents: number; invoices: number } {
  let dueCents = 0;
  let count = 0;
  for (const invoice of invoices) {
    const total = invoiceTotal(items.filter((i) => i.invoiceId === invoice.id));
    const summary = paymentSummary(
      total,
      payments.filter((p) => p.invoiceId === invoice.id),
    );
    if (summary.dueCents > 0) {
      dueCents += summary.dueCents;
      count += 1;
    }
  }
  return { dueCents, invoices: count };
}
