// Terminal de consulta do painel (pedido do Gabriel em 19/11/2026): digita-se o nome do produto ou o
// ISBN e aparece o resumo de cada produto que bate: quanto está em produção, quanto está embarcado (a
// caminho) e a última chegada, com a quantidade que chegou naquele dia. Só quantidades, sem valores.

import { compareOrderCodes, searchKey, type ItemStatus } from './items';
import { sortPlan, type ShipPlan } from './shipPlan';

/** Um item, com o que o resumo precisa (a chegada é a da invoice ou do BL, como em arrivalOf). */
export interface LookupItem {
  productId: string;
  isbn: string | null;
  description: string;
  status: ItemStatus;
  quantity: number;
  orderCode: string | null;
  shipPlan: ShipPlan;
  /** Previsão de chegada (AAAA-MM-DD) do embarque do item; null sem previsão ou em produção. */
  eta: string | null;
  /** Chegada à editora (AAAA-MM-DD); null enquanto não chegou ou quando o histórico não tem a data. */
  arrivedAt: string | null;
}

export interface ProductSummary {
  productId: string;
  isbn: string | null;
  /**
   * O nome atual do produto: o do item em produção que entrou por último; sem produção, o do que está a
   * caminho; sem os dois, o da chegada mais recente. (O histórico entra pela carga depois da produção,
   * então "o último que entrou" daria os nomes antigos.)
   */
  title: string;
  /** Os nomes com que o produto já apareceu (cada compra guarda o seu), para a busca. */
  names: string[];
  production: {
    quantity: number;
    /** As POs dos itens em produção, da mais antiga para a mais nova. */
    orders: string[];
    /** O mês (AAAA-MM) do próximo embarque programado, entre os itens em produção. */
    nextShip: string | null;
  };
  atSea: {
    quantity: number;
    /** A previsão de chegada mais próxima entre os embarques a caminho. */
    nextEta: string | null;
  };
  /** A chegada mais recente, com o total do produto que chegou naquele dia. */
  lastArrival: { date: string; quantity: number } | null;
}

/** Quanto um item diz do nome atual: em produção, depois a caminho, depois pela data da chegada. */
function nameWeight(item: LookupItem): string {
  const rank = item.status === 'producao' ? 3 : item.status === 'embarcado' ? 2 : item.arrivedAt ? 1 : 0;
  return `${rank}|${item.status === 'entregue' ? (item.arrivedAt ?? '') : ''}`;
}

/** Resumo de cada produto. `items` na ordem em que entraram. */
export function productSummaries(items: readonly LookupItem[]): ProductSummary[] {
  const byProduct = new Map<string, ProductSummary>();
  const titleWeight = new Map<string, string>();
  for (const item of items) {
    let s = byProduct.get(item.productId);
    if (!s) {
      s = {
        productId: item.productId,
        isbn: item.isbn,
        title: item.description,
        names: [],
        production: { quantity: 0, orders: [], nextShip: null },
        atSea: { quantity: 0, nextEta: null },
        lastArrival: null,
      };
      byProduct.set(item.productId, s);
    }
    // No empate, vale o que entrou depois.
    const weight = nameWeight(item);
    if (weight >= (titleWeight.get(item.productId) ?? '')) {
      titleWeight.set(item.productId, weight);
      s.title = item.description;
    }
    if (!s.names.includes(item.description)) s.names.push(item.description);
    if (item.status === 'producao') {
      s.production.quantity += item.quantity;
      if (item.orderCode && !s.production.orders.includes(item.orderCode)) s.production.orders.push(item.orderCode);
      const first = sortPlan(item.shipPlan)[0];
      if (first && (s.production.nextShip === null || first.month < s.production.nextShip)) s.production.nextShip = first.month;
    } else if (item.status === 'embarcado') {
      s.atSea.quantity += item.quantity;
      if (item.eta && (s.atSea.nextEta === null || item.eta < s.atSea.nextEta)) s.atSea.nextEta = item.eta;
    } else if (item.arrivedAt) {
      const last = s.lastArrival;
      if (!last || item.arrivedAt > last.date) s.lastArrival = { date: item.arrivedAt, quantity: item.quantity };
      else if (item.arrivedAt === last.date) last.quantity += item.quantity;
    }
  }
  for (const s of byProduct.values()) s.production.orders.sort(compareOrderCodes);
  return [...byProduct.values()];
}

/** Os produtos que batem com o que foi digitado, os mais parecidos primeiro, e quantos bateram ao todo. */
export interface LookupResult {
  products: ProductSummary[];
  total: number;
}

/** O que foi digitado é um ISBN (ou o começo de um): só dígitos, hífens e espaços, com 3 dígitos ou mais. */
function isbnQuery(query: string): string | null {
  if (!/^[\d\s-]+$/.test(query)) return null;
  const digits = query.replace(/\D/g, '');
  return digits.length >= 3 ? digits : null;
}

/**
 * Busca pelo nome (cada palavra digitada aparece em algum dos nomes do produto, sem acento nem
 * maiúscula, em qualquer ordem) ou pelo ISBN (o ISBN inteiro ou parte dele; só números também
 * procuram no nome, como o livro "1984"). A ordem: o ISBN exato; depois, no nome, a palavra inteira vale
 * mais que o começo de uma palavra, que vale mais que um pedaço dela, e o nome que começa com o que foi
 * digitado ganha um pouco. No empate, o que está em produção ou a caminho, depois a chegada mais recente.
 */
export function searchProducts(products: readonly ProductSummary[], query: string, limit = 8): LookupResult {
  const q = searchKey(query);
  if (q.length < 2) return { products: [], total: 0 };
  const isbn = isbnQuery(q);
  const words = q.split(' ');
  const scored: { product: ProductSummary; score: number; active: boolean }[] = [];
  for (const product of products) {
    let score = -1;
    if (isbn && product.isbn && product.isbn.includes(isbn)) score = product.isbn === isbn ? 1000 : product.isbn.startsWith(isbn) ? 500 : 100;
    const names = product.names.map((n) => ` ${searchKey(n)} `);
    if (words.every((w) => names.some((n) => n.includes(w)))) {
      let byName = 0;
      for (const w of words) byName += names.some((n) => n.includes(` ${w} `)) ? 30 : names.some((n) => n.includes(` ${w}`)) ? 20 : 10;
      if (names.some((n) => n.startsWith(` ${q}`))) byName += 5;
      score = Math.max(score, byName);
    }
    if (score < 0) continue;
    scored.push({ product, score, active: product.production.quantity > 0 || product.atSea.quantity > 0 });
  }
  scored.sort(
    (a, b) =>
      b.score - a.score ||
      Number(b.active) - Number(a.active) ||
      (b.product.lastArrival?.date ?? '').localeCompare(a.product.lastArrival?.date ?? '') ||
      a.product.title.localeCompare(b.product.title, 'pt-BR'),
  );
  return { products: scored.slice(0, limit).map((s) => s.product), total: scored.length };
}
