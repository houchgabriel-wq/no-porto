// Produção no Brasil (pedido do Gabriel em 27/11/2026; SPEC.md, seção 3): os orçamentos com as gráficas do
// Brasil (várias propostas por produto, fecha-se com uma), os pedidos de produção que saem deles e as entregas no
// estoque, em uma ou mais partes. A proposta lista os itens que a gráfica cobra (o kit tem o box e os livros) e diz
// de quem é o papel: da gráfica, incluído no preço, ou nosso, que a editora compra pelo preço por kg da tabela de
// papéis e entra no custo. Dinheiro em reais, sem ponto flutuante: preços por unidade e por kg com até quatro casas,
// como inteiros (× 10.000, como o câmbio); totais em centavos; peso do papel em gramas.

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

/** Um papel da tabela: o preço por kg que a editora paga (reais × 10.000; null para quem não vê valores). */
export interface Paper {
  id: string;
  name: string;
  pricePerKgE4: number | null;
  notes: string;
  updatedAt: string;
}

export type PaperBy = 'grafica' | 'editora';
export const PAPER_PARTS = ['capa', 'miolo', 'outro'] as const;
export type PaperPart = (typeof PAPER_PARTS)[number];
export const PAPER_PART_LABELS: Record<PaperPart, string> = { capa: 'Capa', miolo: 'Miolo', outro: 'Outro' };

/** Um item que a gráfica cobra (o box, os livros do kit), com o preço por unidade; null sem valores. */
export interface OfferItem {
  description: string;
  quantity: number;
  unitPriceE4: number | null;
}

/** O papel nosso que a proposta consome: a parte, o papel, o peso e o preço por kg usado (o da tabela, ajustável). */
export interface OfferPaper {
  part: PaperPart;
  paperId: string | null;
  paperName: string;
  grams: number;
  pricePerKgE4: number | null;
}

/** A proposta de uma gráfica para um orçamento. */
export interface Offer {
  id: string;
  quoteId: string;
  printerId: string;
  /** Quantos produtos prontos a proposta entrega (o kit conta como um): a base do custo por unidade. */
  quantity: number;
  paperBy: PaperBy;
  items: OfferItem[];
  /** Só com o papel nosso. */
  papers: OfferPaper[];
  /** Prazo de produção, em dias. */
  leadDays: number | null;
  proposalNumber: string;
  proposalDate: string | null;
  /** Validade da proposta, em dias a partir da data dela. */
  validDays: number | null;
  paymentTerms: string;
  notes: string;
  /** O PDF da proposta guardado; só para quem vê valores. */
  document: { name: string; size: number } | null;
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

/** O que as contas de entrega usam de cada entrega. */
export type DeliveredPart = Pick<Delivery, 'deliveredAt' | 'quantity' | 'last'>;

/** O pedido fechado com a gráfica: a produção no Brasil. */
export interface BrOrder {
  id: string;
  quoteId: string | null;
  offerId: string | null;
  printerId: string;
  title: string;
  isbn: string | null;
  quantity: number;
  /** O que a gráfica cobra (a soma dos itens), em centavos; null para quem não vê valores. */
  printerCents: number | null;
  /** O papel nosso, em centavos (zero com o papel da gráfica); null para quem não vê valores. */
  paperCents: number | null;
  orderedAt: string;
  dueAt: string | null;
  specification: string;
  notes: string;
  deliveries: Delivery[];
}

/**
 * O pedido no Brasil só com as quantidades, as datas e o nome da gráfica, sem valores: o que o terminal de consulta
 * e a previsão de estoque usam para mostrar a produção no Brasil junto com a importação.
 */
export interface BrOrderSummary {
  id: string;
  isbn: string | null;
  title: string;
  printer: string;
  quantity: number;
  orderedAt: string;
  dueAt: string | null;
  deliveries: DeliveredPart[];
}

/** Um pedido no Brasil na ficha do produto: o total (gráfica + papel nosso, em centavos) só para quem vê valores. */
export type ProductBrazilOrder = BrOrderSummary & { totalCents: number | null };

/** Preço por exemplar em reais, até quatro casas ("3,70", "0,1234", "R$ 2,5") → inteiro × 10.000; null se não servir. */
export function parseBrlUnitPrice(text: string): number | null {
  const v = parseScaled(text.trim().replace(/^R\$/i, ''), 4);
  return v === null || v === 0 ? null : v;
}

/** Total em centavos de real: quantidade × preço por unidade, arredondado ao centavo. */
export function brlTotalCents(quantity: number, unitPriceE4: number): number {
  return Math.round((quantity * unitPriceE4) / 100);
}

/** Peso do papel em kg ("707", "2.463,44", "846,81") → gramas; null se não servir. */
export function parseKgGrams(text: string): number | null {
  const v = parseScaled(text.trim().replace(/\s*kg$/i, ''), 3);
  return v === null || v === 0 ? null : v;
}

/** O peso para ler: "2.463,44 kg". */
export function formatKg(grams: number): string {
  return `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 }).format(grams / 1000)} kg`;
}

/** O peso para editar no campo: "2463,44". */
export function kgInput(grams: number): string {
  return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3, useGrouping: false }).format(grams / 1000);
}

/** O custo do papel em centavos: o peso (gramas) × o preço por kg (reais × 10.000). */
export function paperCostCents(grams: number, pricePerKgE4: number): number {
  return Math.round((grams * pricePerKgE4) / 100_000);
}

export interface OfferCost {
  /** O que a gráfica cobra: a soma dos itens. */
  printerCents: number;
  /** O papel nosso (zero com o papel da gráfica). */
  paperCents: number;
  totalCents: number;
  /** O custo por produto pronto, com o papel, em reais × 10.000. */
  unitCostE4: number;
}

/** O custo da proposta: os itens da gráfica, o papel nosso e o custo por unidade; null sem os valores. */
export function offerCost(offer: Pick<Offer, 'quantity' | 'paperBy' | 'items' | 'papers'>): OfferCost | null {
  if (offer.items.some((i) => i.unitPriceE4 === null) || offer.papers.some((p) => p.pricePerKgE4 === null)) return null;
  const printerCents = offer.items.reduce((s, i) => s + brlTotalCents(i.quantity, i.unitPriceE4!), 0);
  const paperCents = offer.paperBy === 'editora' ? offer.papers.reduce((s, p) => s + paperCostCents(p.grams, p.pricePerKgE4!), 0) : 0;
  const totalCents = printerCents + paperCents;
  return { printerCents, paperCents, totalCents, unitCostE4: Math.round((totalCents * 100) / offer.quantity) };
}

/** O total do pedido (gráfica + papel nosso), em centavos; null sem os valores. */
export function orderTotalCents(order: Pick<BrOrder, 'printerCents' | 'paperCents'>): number | null {
  return order.printerCents === null || order.paperCents === null ? null : order.printerCents + order.paperCents;
}

/** Até quando vale a proposta (a data dela mais a validade), e se já venceu; null sem a data ou a validade. */
export function offerExpiry(offer: Pick<Offer, 'proposalDate' | 'validDays'>, today: string): { until: string; expired: boolean } | null {
  if (!offer.proposalDate || offer.validDays === null) return null;
  const until = addDays(offer.proposalDate, offer.validDays);
  return { until, expired: until < today };
}

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const brlUnit = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 4 });
const plain = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 4, useGrouping: false });

/** "R$ 18.500,00". */
export function formatBrl(cents: number): string {
  return brl.format(cents / 100);
}

const brlWhole = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 0, maximumFractionDigits: 0 });

/** Reais inteiros, para os números em destaque do painel: "R$ 53.443" (como os dólares do painel). */
export function formatBrlWhole(cents: number): string {
  return brlWhole.format(Math.round(cents / 100));
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

/** A proposta com o menor custo por unidade, com o papel nosso (no empate, o menor prazo); null sem os valores. */
export function bestOffer(offers: readonly Offer[]): Offer | null {
  let best: { offer: Offer; unit: number } | null = null;
  for (const o of offers) {
    const cost = offerCost(o);
    if (!cost) continue;
    if (!best || cost.unitCostE4 < best.unit || (cost.unitCostE4 === best.unit && (o.leadDays ?? Infinity) < (best.offer.leadDays ?? Infinity))) best = { offer: o, unit: cost.unitCostE4 };
  }
  return best?.offer ?? null;
}

/**
 * O dia em que o pedido ficou entregue: o da última entrega, quando a soma das entregas alcança a quantidade ou
 * quando uma entrega foi marcada como a última (a gráfica pode entregar um pouco a mais ou a menos); null enquanto
 * não foi entregue. Desfazer uma entrega reabre o pedido, se for o caso.
 */
export function finishedAt(order: { quantity: number; deliveries: readonly DeliveredPart[] }): string | null {
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
export function orderState(order: { quantity: number; dueAt: string | null; deliveries: readonly DeliveredPart[] }, today: string): OrderState {
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

/** A entrega prevista em poucas palavras, para o painel e o terminal: "Atrasado há 3 dias", "Entrega em 12 dias". */
export function dueText(state: Pick<OrderState, 'late' | 'lateDays'>, dueAt: string | null, today: string): string {
  if (state.late) return `Atrasado há ${state.lateDays === 1 ? '1 dia' : `${state.lateDays} dias`}`;
  if (!dueAt) return 'Sem entrega prevista';
  const days = daysBetween(today, dueAt);
  return days === 0 ? 'Entrega hoje' : days === 1 ? 'Entrega amanhã' : `Entrega em ${days} dias`;
}

/** Os pedidos ainda não entregues, com a situação, da entrega prevista mais próxima (os atrasados primeiro) para a mais distante. */
export function producingOrders<T extends { quantity: number; dueAt: string | null; deliveries: readonly DeliveredPart[] }>(
  orders: readonly T[],
  today: string,
): { order: T; state: OrderState }[] {
  return orders
    .map((order) => ({ order, state: orderState(order, today) }))
    .filter((o) => o.state.stage !== 'entregue')
    .sort((a, b) => (a.order.dueAt ?? '9999-12-31').localeCompare(b.order.dueAt ?? '9999-12-31'));
}

/** O que impede registrar a entrega; null quando pode. */
export function deliveryProblem(order: { quantity: number; orderedAt: string; deliveries: readonly DeliveredPart[] }, delivery: { deliveredAt: string; quantity: number }, today: string): string | null {
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
    // O valor do que falta: a parte do total (gráfica + papel) que corresponde aos exemplares que faltam.
    const total = orderTotalCents(o);
    valueCents = total === null || valueCents === null ? null : valueCents + Math.round((total * s.remaining) / o.quantity);
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
