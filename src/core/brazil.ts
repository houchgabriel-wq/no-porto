// Produção no Brasil (pedido do Gabriel em 27/11/2026; SPEC.md, seção 3): os orçamentos com as gráficas do
// Brasil (várias propostas por produto, fecha-se com uma), os pedidos de produção que saem deles e as entregas no
// estoque, em uma ou mais partes. Dinheiro em reais, sem ponto flutuante: o preço por exemplar tem até quatro casas
// e fica como inteiro (× 10.000, como o câmbio); o total fica em centavos.

import { searchKey } from './items';
import { parseScaled } from './money';
import { daysBetween } from './shipments';

export type QuoteStatus = 'aberto' | 'fechado' | 'cancelado';

export const QUOTE_STATUS_LABELS: Record<QuoteStatus, string> = { aberto: 'Aberto', fechado: 'Fechado', cancelado: 'Cancelado' };

/** Uma gráfica do Brasil (separada dos fornecedores de fora). */
export interface Printer {
  id: string;
  name: string;
  notes: string;
}

/** A proposta de uma gráfica para um orçamento. */
export interface Offer {
  id: string;
  quoteId: string;
  printerId: string;
  quantity: number;
  /** Preço por exemplar em reais × 10.000; null para quem não vê valores (o leitor). */
  unitPriceE4: number | null;
  /** Prazo de produção, em dias. */
  leadDays: number | null;
  notes: string;
}

/** O orçamento de um produto, pedido a uma ou mais gráficas. */
export interface Quote {
  id: string;
  title: string;
  isbn: string | null;
  quantity: number;
  specification: string;
  notes: string;
  status: QuoteStatus;
  createdAt: string;
  createdBy: string | null;
  closedAt: string | null;
  offers: Offer[];
  /** O pedido que saiu do orçamento fechado. */
  orderId: string | null;
}

/** Uma entrega da gráfica no estoque. */
export interface Delivery {
  id: string;
  orderId: string;
  deliveredAt: string;
  quantity: number;
  /** A gráfica disse que é a última: o pedido fica entregue mesmo com um pouco menos. */
  last: boolean;
  notes: string;
}

/** O pedido fechado com a gráfica: a produção no Brasil. */
export interface BrOrder {
  id: string;
  quoteId: string | null;
  offerId: string | null;
  printerId: string;
  title: string;
  isbn: string | null;
  quantity: number;
  /** Preço por exemplar em reais × 10.000; null para quem não vê valores. */
  unitPriceE4: number | null;
  orderedAt: string;
  dueAt: string | null;
  specification: string;
  notes: string;
  deliveries: Delivery[];
}

/** Preço por exemplar em reais, até quatro casas ("3,70", "0,1234", "R$ 2,5") → inteiro × 10.000; null se não servir. */
export function parseBrlUnitPrice(text: string): number | null {
  const v = parseScaled(text.trim().replace(/^R\$/i, ''), 4);
  return v === null || v === 0 ? null : v;
}

/** Total em centavos de real: quantidade × preço por exemplar, arredondado ao centavo. */
export function brlTotalCents(quantity: number, unitPriceE4: number): number {
  return Math.round((quantity * unitPriceE4) / 100);
}

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const brlUnit = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 4 });
const plain = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 4, useGrouping: false });

/** "R$ 18.500,00". */
export function formatBrl(cents: number): string {
  return brl.format(cents / 100);
}

/** O preço por exemplar: "R$ 3,70", "R$ 0,1234". */
export function formatBrlUnit(unitPriceE4: number): string {
  return brlUnit.format(unitPriceE4 / 10_000);
}

/** O preço por exemplar para editar no campo: "3,70", "0,1234". */
export function brlUnitInput(unitPriceE4: number | null): string {
  return unitPriceE4 === null ? '' : plain.format(unitPriceE4 / 10_000);
}

/** O dia `days` dias depois de `day` (AAAA-MM-DD). */
export function addDays(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/** A proposta com o menor preço por exemplar (no empate, o menor prazo); null quando nenhuma tem preço. */
export function bestOffer(offers: readonly Offer[]): Offer | null {
  let best: Offer | null = null;
  for (const o of offers) {
    if (o.unitPriceE4 === null) continue;
    if (!best || o.unitPriceE4 < best.unitPriceE4! || (o.unitPriceE4 === best.unitPriceE4 && (o.leadDays ?? Infinity) < (best.leadDays ?? Infinity))) best = o;
  }
  return best;
}

/**
 * O dia em que o pedido ficou entregue: o da última entrega, quando a soma das entregas alcança a quantidade ou
 * quando uma entrega foi marcada como a última (a gráfica pode entregar um pouco a mais ou a menos); null enquanto
 * não foi entregue. Desfazer uma entrega reabre o pedido, se for o caso.
 */
export function finishedAt(order: Pick<BrOrder, 'quantity' | 'deliveries'>): string | null {
  if (order.deliveries.length === 0) return null;
  const delivered = order.deliveries.reduce((s, d) => s + d.quantity, 0);
  if (delivered < order.quantity && !order.deliveries.some((d) => d.last)) return null;
  return order.deliveries.map((d) => d.deliveredAt).sort().at(-1)!;
}

export type OrderStage = 'producao' | 'parcial' | 'entregue';

export interface OrderState {
  stage: OrderStage;
  delivered: number;
  /** O que falta entregar (zero depois de entregue). */
  remaining: number;
  finishedAt: string | null;
  /** A entrega prevista já passou e o pedido não foi entregue. */
  late: boolean;
  lateDays: number;
}

/** A situação do pedido: em produção, entregue em parte ou entregue; e se está atrasado. */
export function orderState(order: Pick<BrOrder, 'quantity' | 'dueAt' | 'deliveries'>, today: string): OrderState {
  const delivered = order.deliveries.reduce((s, d) => s + d.quantity, 0);
  const done = finishedAt(order);
  const late = !done && order.dueAt !== null && order.dueAt < today;
  return {
    stage: done ? 'entregue' : delivered > 0 ? 'parcial' : 'producao',
    delivered,
    remaining: done ? 0 : Math.max(0, order.quantity - delivered),
    finishedAt: done,
    late,
    lateDays: late ? daysBetween(order.dueAt!, today) : 0,
  };
}

/** O texto da situação: "Em produção · entrega prevista em 12 dias", "Atrasado há 3 dias", "Entregue". */
export function orderStateText(state: OrderState, dueAt: string | null, today: string): string {
  if (state.stage === 'entregue') return 'Entregue';
  const part = state.stage === 'parcial' ? 'Entregue em parte' : 'Em produção';
  if (state.late) return `${part} · atrasado há ${state.lateDays === 1 ? '1 dia' : `${state.lateDays} dias`}`;
  if (!dueAt) return `${part} · sem entrega prevista`;
  const days = daysBetween(today, dueAt);
  return `${part} · ${days === 0 ? 'entrega prevista para hoje' : days === 1 ? 'entrega prevista para amanhã' : `entrega prevista em ${days} dias`}`;
}

/** O que impede registrar a entrega; null quando pode. */
export function deliveryProblem(order: Pick<BrOrder, 'quantity' | 'orderedAt' | 'deliveries'>, delivery: { deliveredAt: string; quantity: number }, today: string): string | null {
  if (finishedAt(order)) return 'Este pedido já foi entregue. Para registrar outra entrega, desfaça a última.';
  if (!Number.isInteger(delivery.quantity) || delivery.quantity <= 0) return 'Informe quantos exemplares chegaram.';
  if (delivery.deliveredAt > today) return 'A entrega não pode ser num dia que ainda não chegou.';
  if (delivery.deliveredAt < order.orderedAt) return 'A entrega não pode ser antes do pedido.';
  return null;
}

export interface BrazilSummary {
  openQuotes: number;
  /** Pedidos ainda não entregues: quantos, os exemplares que faltam e o valor deles (null sem valores). */
  producing: { orders: number; copies: number; valueCents: number | null };
  late: number;
  /** Exemplares entregues nos últimos 30 dias. */
  deliveredLast30: number;
}

/** O resumo do topo da sub-aba Brasil. */
export function brazilSummary(quotes: readonly Pick<Quote, 'status'>[], orders: readonly BrOrder[], today: string): BrazilSummary {
  const since = addDays(today, -30);
  let producingOrders = 0;
  let copies = 0;
  let valueCents: number | null = 0;
  let late = 0;
  let deliveredLast30 = 0;
  for (const o of orders) {
    const s = orderState(o, today);
    deliveredLast30 += o.deliveries.filter((d) => d.deliveredAt >= since && d.deliveredAt <= today).reduce((n, d) => n + d.quantity, 0);
    if (s.stage === 'entregue') continue;
    producingOrders++;
    copies += s.remaining;
    if (s.late) late++;
    valueCents = o.unitPriceE4 === null || valueCents === null ? null : valueCents + brlTotalCents(s.remaining, o.unitPriceE4);
  }
  return { openQuotes: quotes.filter((q) => q.status === 'aberto').length, producing: { orders: producingOrders, copies, valueCents }, late, deliveredLast30 };
}

/** A busca da sub-aba: produto, ISBN ou gráfica, sem acento nem maiúscula e com as palavras em qualquer ordem. */
export function matchesBrazil(query: string, item: { title: string; isbn: string | null; printers: readonly string[] }): boolean {
  const words = searchKey(query).split(' ').filter(Boolean);
  if (!words.length) return true;
  const digits = query.replace(/\D/g, '');
  if (digits.length >= 4 && /^[\d\s-]+$/.test(query.trim())) return (item.isbn ?? '').includes(digits);
  const text = searchKey(`${item.title} ${item.isbn ?? ''} ${item.printers.join(' ')}`);
  return words.every((w) => text.includes(w));
}
