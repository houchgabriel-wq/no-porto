// Produção no Brasil (pedido do Gabriel em 27/11/2026; SPEC.md, seção 3): os orçamentos com as gráficas do
// Brasil (várias propostas por produto, fecha-se com uma), os pedidos de produção que saem deles e as entregas no
// estoque, em uma ou mais partes. A proposta lista os itens que a gráfica cobra (o kit tem o box e os livros) e diz
// de quem é o papel: da gráfica, incluído no preço, ou nosso, que a editora compra pelo preço por kg da tabela de
// papéis e entra no custo. Dinheiro em reais, sem ponto flutuante: preços por unidade e por kg com até quatro casas,
// como inteiros (× 10.000, como o câmbio); totais em centavos; peso do papel em gramas.
// Desde 27/11/2026, o orçamento tem um ou mais produtos (cada ISBN, como o box e os 3 livros que vão dentro dele, e o
// avulso): os itens e o papel da proposta se ligam aos produtos, o custo sai por produto e por kit, e o pedido tem as
// entregas de cada produto. O que vai dentro do box não conta no estoque do livro: conta o box.

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

/** Um produto do orçamento: cada ISBN orçado, com a quantidade. */
export interface QuoteProduct {
  id: string;
  title: string;
  isbn: string | null;
  quantity: number;
  /** Vai dentro do box (o kit): não conta no estoque do livro nem tem entrega própria; vem com o box. */
  inBox: boolean;
}

/** Um item que a gráfica cobra (o box, os livros do kit), com o preço por unidade; null sem valores. */
export interface OfferItem {
  /** O produto do orçamento que o item cobra; null no orçamento de um produto só (vale para ele). */
  productId: string | null;
  description: string;
  /** A especificação que a gráfica escreveu (formato, papel, acabamento). */
  specification: string;
  quantity: number;
  unitPriceE4: number | null;
}

/** O papel nosso que a proposta consome: a parte, o papel, o peso e o preço por kg usado (o da tabela, ajustável). */
export interface OfferPaper {
  /** O produto que usa o papel; null quando é da proposta toda (o custo se reparte pelos produtos). */
  productId: string | null;
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

/** O orçamento, pedido a uma ou mais gráficas: um produto ou vários (o kit, os livros orçados juntos). */
export interface Quote {
  id: string;
  /** O nome do orçamento: o do primeiro produto. */
  title: string;
  isbn: string | null;
  quantity: number;
  products: QuoteProduct[];
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

/** Uma entrega da gráfica no estoque, de um produto do pedido. */
export interface Delivery {
  id: string;
  orderId: string;
  /** O produto do pedido; null nas entregas de antes dos produtos (valem para o produto único). */
  productId: string | null;
  /** As entregas registradas juntas (o kit e o avulso que chegaram no mesmo dia) têm o mesmo grupo. */
  groupId: string;
  deliveredAt: string;
  quantity: number;
  /** A gráfica disse que é a última: o produto fica entregue mesmo com um pouco menos. */
  last: boolean;
  notes: string;
}

/** O que as contas de entrega usam de cada entrega. */
export type DeliveredPart = Pick<Delivery, 'deliveredAt' | 'quantity' | 'last'>;

/** Um produto do pedido, com a quantidade da proposta escolhida e o custo dele. */
export interface OrderProduct {
  id: string;
  /** O produto do orçamento de onde veio. */
  productId: string | null;
  title: string;
  isbn: string | null;
  quantity: number;
  inBox: boolean;
  /** O custo do produto no pedido (itens e papel nosso), em centavos; null para quem não vê valores. */
  costCents: number | null;
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
  /** O que a gráfica cobra (a soma dos itens), em centavos; null para quem não vê valores. */
  printerCents: number | null;
  /** O papel nosso, em centavos (zero com o papel da gráfica); null para quem não vê valores. */
  paperCents: number | null;
  orderedAt: string;
  dueAt: string | null;
  specification: string;
  notes: string;
  products: OrderProduct[];
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

/**
 * Um produto de um pedido no Brasil na ficha do produto: se vai dentro do box e o custo dele no pedido (itens e papel
 * nosso, em centavos), só para quem vê valores.
 */
export type ProductBrazilOrder = BrOrderSummary & { inBox: boolean; totalCents: number | null };

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

/** O custo de um produto numa proposta: a quantidade que ela orça, o custo (itens e papel nosso) e o custo por unidade. */
export interface ProductCost {
  productId: string | null;
  /** A quantidade orçada (zero quando a proposta não orçou o produto). */
  quantity: number;
  cents: number;
  /** null quando a proposta não orçou o produto. */
  unitCostE4: number | null;
}

export interface OfferCost {
  /** O que a gráfica cobra: a soma dos itens. */
  printerCents: number;
  /** O papel nosso (zero com o papel da gráfica). */
  paperCents: number;
  totalCents: number;
  /** O custo por produto pronto (pela quantidade pronta da proposta), com o papel, em reais × 10.000. */
  unitCostE4: number;
  /** O custo de cada produto do orçamento. */
  products: ProductCost[];
  /** No kit: o box e o que vai dentro dele, um de cada (reais × 10.000); null sem kit ou sem o preço de algum. */
  kitUnitCostE4: number | null;
  /**
   * Para comparar as propostas: o custo das quantidades do orçamento pelo custo por unidade de cada produto, em
   * centavos; com um produto só, o custo por unidade. null quando falta orçar algum produto.
   */
  compare: number | null;
}

/** O box do kit: o primeiro produto que não vai dentro do box, quando algum vai; null sem kit. */
export function boxProduct<T extends Pick<QuoteProduct, 'inBox'>>(products: readonly T[]): T | null {
  return products.some((p) => p.inBox) ? (products.find((p) => !p.inBox) ?? null) : null;
}

/** O que impede os produtos do orçamento; null quando servem. */
export function quoteProductsProblem(products: readonly Pick<QuoteProduct, 'title' | 'quantity' | 'inBox'>[]): string | null {
  if (products.length === 0) return 'Informe o produto.';
  if (products.length > MAX_QUOTE_PRODUCTS) return `O orçamento pode ter no máximo ${MAX_QUOTE_PRODUCTS} produtos.`;
  const blank = products.findIndex((p) => !p.title.trim());
  if (blank >= 0) return products.length === 1 ? 'Informe o produto.' : `Informe o nome do ${blank + 1}º produto.`;
  const noQty = products.findIndex((p) => !Number.isInteger(p.quantity) || p.quantity <= 0);
  if (noQty >= 0) return products.length === 1 ? 'Informe a quantidade.' : `Informe a quantidade de ${products[noQty]!.title.trim()}.`;
  if (products.some((p) => p.inBox) && !boxProduct(products)) return 'Algum produto precisa ser o box: os que vão dentro dele não podem ser todos.';
  return null;
}

/** Quantos produtos um orçamento pode ter. */
export const MAX_QUOTE_PRODUCTS = 30;

/**
 * O custo da proposta: os itens da gráfica, o papel nosso e o custo por unidade; null sem os valores. Com vários
 * produtos, cada um tem o custo dos itens dele e do papel dele; o papel (e o item) sem produto se reparte pelos
 * produtos na proporção do que a gráfica cobra de cada um. A quantidade orçada de um produto é a do maior item dele.
 */
export function offerCost(
  offer: Pick<Offer, 'quantity' | 'paperBy' | 'items' | 'papers'>,
  products: readonly Pick<QuoteProduct, 'id' | 'quantity' | 'inBox'>[] = [],
): OfferCost | null {
  if (offer.items.some((i) => i.unitPriceE4 === null) || offer.papers.some((p) => p.pricePerKgE4 === null)) return null;
  const itemCents = offer.items.map((i) => brlTotalCents(i.quantity, i.unitPriceE4!));
  const paperCentsEach = offer.paperBy === 'editora' ? offer.papers.map((p) => paperCostCents(p.grams, p.pricePerKgE4!)) : offer.papers.map(() => 0);
  const printerCents = itemCents.reduce((s, c) => s + c, 0);
  const paperCents = paperCentsEach.reduce((s, c) => s + c, 0);
  const totalCents = printerCents + paperCents;
  const unitCostE4 = Math.round((totalCents * 100) / offer.quantity);
  if (products.length <= 1) {
    const only: ProductCost = { productId: products[0]?.id ?? null, quantity: offer.quantity, cents: totalCents, unitCostE4 };
    return { printerCents, paperCents, totalCents, unitCostE4, products: [only], kitUnitCostE4: null, compare: unitCostE4 };
  }
  const ids = new Set(products.map((p) => p.id));
  const direct = new Map(products.map((p) => [p.id, { printer: 0, paper: 0, quantity: 0 }]));
  let loose = 0;
  offer.items.forEach((item, n) => {
    const own = item.productId && ids.has(item.productId) ? direct.get(item.productId)! : null;
    if (!own) return void (loose += itemCents[n]!);
    own.printer += itemCents[n]!;
    own.quantity = Math.max(own.quantity, item.quantity);
  });
  offer.papers.forEach((paper, n) => {
    const own = paper.productId && ids.has(paper.productId) ? direct.get(paper.productId)! : null;
    if (own) own.paper += paperCentsEach[n]!;
    else loose += paperCentsEach[n]!;
  });
  // O que não tem produto se reparte pelo que a gráfica cobra de cada um (sem nada cobrado, tudo no primeiro).
  const base = [...direct.values()].reduce((s, d) => s + d.printer, 0);
  const shares = products.map((p) => (base > 0 ? Math.floor((loose * direct.get(p.id)!.printer) / base) : 0));
  const rest = loose - shares.reduce((s, c) => s + c, 0);
  const firstPriced = Math.max(0, products.findIndex((p) => direct.get(p.id)!.printer > 0));
  shares[firstPriced]! += rest;
  const costs = products.map((p, n): ProductCost => {
    const d = direct.get(p.id)!;
    const cents = d.printer + d.paper + shares[n]!;
    return { productId: p.id, quantity: d.quantity, cents, unitCostE4: d.quantity > 0 ? Math.round((cents * 100) / d.quantity) : null };
  });
  const box = boxProduct(products);
  const kitIds = box ? [box.id, ...products.filter((p) => p.inBox).map((p) => p.id)] : [];
  const kitUnits = costs.filter((c) => kitIds.includes(c.productId!)).map((c) => c.unitCostE4);
  const kitUnitCostE4 = box && kitUnits.every((u) => u !== null) ? kitUnits.reduce<number>((s, u) => s + u!, 0) : null;
  const compare = costs.every((c) => c.unitCostE4 !== null)
    ? costs.reduce((s, c, n) => s + Math.round((c.unitCostE4! * products[n]!.quantity) / 100), 0)
    : null;
  return { printerCents, paperCents, totalCents, unitCostE4, products: costs, kitUnitCostE4, compare };
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

/**
 * A proposta com o menor custo, com o papel nosso (no empate, o menor prazo); null sem os valores. Com um produto, o
 * menor custo por unidade; com vários, o menor custo das quantidades do orçamento (a que não orçou algum produto fica
 * de fora).
 */
export function bestOffer(offers: readonly Offer[], products: readonly Pick<QuoteProduct, 'id' | 'quantity' | 'inBox'>[] = []): Offer | null {
  let best: { offer: Offer; value: number } | null = null;
  for (const o of offers) {
    const value = offerCost(o, products)?.compare ?? null;
    if (value === null) continue;
    if (!best || value < best.value || (value === best.value && (o.leadDays ?? Infinity) < (best.offer.leadDays ?? Infinity))) best = { offer: o, value };
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

/** Uma entrega, com o produto (as de antes dos produtos não têm). */
type ProductDelivery = DeliveredPart & { productId?: string | null };

/** O pedido como as contas de entrega o veem: sem os produtos, é o pedido de um produto só. */
export interface OrderLike {
  quantity: number;
  dueAt: string | null;
  deliveries: readonly ProductDelivery[];
  products?: readonly Pick<OrderProduct, 'id' | 'title' | 'quantity' | 'inBox'>[];
}

/** Os produtos que contam no pedido: os que não vão dentro do box (sem os produtos, o pedido inteiro). */
export function countedProducts(order: OrderLike): { id: string | null; title: string; quantity: number }[] {
  const list = (order.products ?? []).filter((p) => !p.inBox);
  return list.length ? list : [{ id: null, title: '', quantity: order.quantity }];
}

/** As entregas de um produto do pedido; as de antes dos produtos valem para o produto único. */
export function productDeliveries(order: OrderLike, productId: string | null): ProductDelivery[] {
  if (productId === null) return [...order.deliveries];
  const single = countedProducts(order).length === 1;
  return order.deliveries.filter((d) => d.productId === productId || (single && (d.productId ?? null) === null));
}

export interface ProductState {
  productId: string | null;
  title: string;
  quantity: number;
  delivered: number;
  remaining: number;
  finishedAt: string | null;
}

/** A situação de cada produto que conta no pedido: quanto chegou, quanto falta e quando ficou entregue. */
export function productStates(order: OrderLike): ProductState[] {
  return countedProducts(order).map((p) => {
    const deliveries = productDeliveries(order, p.id);
    const delivered = deliveries.reduce((n, d) => n + d.quantity, 0);
    const done = finishedAt({ quantity: p.quantity, deliveries });
    return { productId: p.id, title: p.title, quantity: p.quantity, delivered, remaining: done ? 0 : Math.max(0, p.quantity - delivered), finishedAt: done };
  });
}

/**
 * A situação do pedido: em produção, entregue em parte ou entregue; e se está atrasado. Com vários produtos, ele fica
 * entregue quando todos os que contam (os que não vão dentro do box) ficam; o que chegou e o que falta somam os deles.
 */
export function orderState(order: OrderLike, today: string): OrderState {
  const states = productStates(order);
  const delivered = states.reduce((n, s) => n + s.delivered, 0);
  const done = states.every((s) => s.finishedAt) ? states.map((s) => s.finishedAt!).sort().at(-1)! : null;
  const late = !done && order.dueAt !== null && order.dueAt < today;
  return {
    stage: done ? 'entregue' : delivered > 0 ? 'parcial' : 'producao',
    delivered,
    remaining: states.reduce((n, s) => n + s.remaining, 0),
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
export function producingOrders<T extends OrderLike>(
  orders: readonly T[],
  today: string,
): { order: T; state: OrderState }[] {
  return orders
    .map((order) => ({ order, state: orderState(order, today) }))
    .filter((o) => o.state.stage !== 'entregue')
    .sort((a, b) => (a.order.dueAt ?? '9999-12-31').localeCompare(b.order.dueAt ?? '9999-12-31'));
}

/** O que chega numa entrega: a quantidade de cada produto (no pedido de um produto só, a quantidade dele). */
export type DeliveryInput = { deliveredAt: string; quantity: number } | { deliveredAt: string; parts: readonly { productId: string | null; quantity: number }[] };

/** As quantidades de cada produto numa entrega, as que chegaram (mais que zero). */
export function deliveryParts(order: OrderLike, delivery: DeliveryInput): { productId: string | null; quantity: number }[] {
  if ('parts' in delivery) return delivery.parts.filter((p) => p.quantity !== 0);
  return [{ productId: countedProducts(order)[0]!.id, quantity: delivery.quantity }];
}

/** O que impede registrar a entrega; null quando pode. */
export function deliveryProblem(order: OrderLike & { orderedAt: string }, delivery: DeliveryInput, today: string): string | null {
  const states = productStates(order);
  if (states.every((s) => s.finishedAt)) return 'Este pedido já foi entregue. Para registrar outra entrega, desfaça a última.';
  const parts = deliveryParts(order, delivery);
  if (parts.length === 0 || parts.some((p) => !Number.isInteger(p.quantity) || p.quantity <= 0)) return 'Informe quantos exemplares chegaram.';
  for (const part of parts) {
    const state = states.find((s) => s.productId === part.productId);
    if (!state) return 'O produto da entrega não é deste pedido, ou vai dentro do box (vem com ele).';
    if (state.finishedAt) return `${state.title || 'O produto'} já foi entregue. Para registrar outra entrega dele, desfaça a última.`;
  }
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
    const quantity = countedProducts(o).reduce((n, p) => n + p.quantity, 0);
    valueCents = total === null || valueCents === null ? null : valueCents + Math.round((total * s.remaining) / quantity);
  }
  return { openQuotes: quotes.filter((q) => q.status === 'aberto').length, producing: { orders: producingOrders, copies, valueCents }, late, deliveredLast30 };
}

/**
 * A busca da sub-aba: produto (qualquer um dos produtos do orçamento ou do pedido), ISBN ou gráfica, sem acento nem
 * maiúscula e com as palavras em qualquer ordem.
 */
export function matchesBrazil(
  query: string,
  item: { title: string; isbn: string | null; printers: readonly string[]; products?: readonly { title: string; isbn: string | null }[] },
): boolean {
  const words = searchKey(query).split(' ').filter(Boolean);
  if (!words.length) return true;
  const all = [{ title: item.title, isbn: item.isbn }, ...(item.products ?? [])];
  const digits = query.replace(/\D/g, '');
  if (digits.length >= 4 && /^[\d\s-]+$/.test(query.trim())) return all.some((p) => (p.isbn ?? '').includes(digits));
  const text = searchKey(`${all.map((p) => `${p.title} ${p.isbn ?? ''}`).join(' ')} ${item.printers.join(' ')}`);
  return words.every((w) => text.includes(w));
}
