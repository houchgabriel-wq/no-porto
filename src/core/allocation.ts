// Novo embarque (SPEC.md, seção 3): a invoice do fornecedor diz o que foi embarcado, e o app tira da
// produção do mesmo fornecedor o que saiu, a produção mais antiga primeiro (decidido pelo Gabriel em
// 17/11/2026). Um embarque da Claire nunca tira produção da Sara. O que a invoice traz e não está na
// produção entra embarcado assim mesmo, sem PO, para a pessoa conferir.

import { compareOrderCodes, searchKey, titleKey, type Item, type PurchaseOrder, type Supplier } from './items';

export interface ShipmentLineInput {
  description: string;
  isbn: string | null;
  quantity: number;
}

export interface Take {
  itemId: string;
  quantity: number;
  /** O item sai inteiro da produção (senão, sai em parte e o saldo fica). */
  whole: boolean;
}

export interface LineAllocation {
  takes: Take[];
  /** Quantidade da linha que não estava na produção. */
  extra: number;
}

type ProductionItem = Pick<Item, 'id' | 'isbn' | 'description' | 'supplierId' | 'purchaseOrderId' | 'quantity' | 'status' | 'createdAt'>;

/** O item da produção é o produto da linha? Pelo ISBN; sem ISBN de um dos lados, pelo nome. */
export function sameProduct(line: Pick<ShipmentLineInput, 'isbn' | 'description'>, item: Pick<Item, 'isbn' | 'description'>): boolean {
  if (line.isbn && item.isbn) return line.isbn === item.isbn;
  return titleKey(line.description) === titleKey(item.description);
}

/**
 * A produção do fornecedor, da mais antiga para a mais nova: pela PO (PO-024 antes de PO-050), os
 * itens sem PO depois, e na mesma PO pela ordem em que entraram.
 */
export function productionQueue<T extends ProductionItem>(items: readonly T[], orders: readonly Pick<PurchaseOrder, 'id' | 'code'>[], supplierId: string): T[] {
  const code = new Map(orders.map((o) => [o.id, o.code]));
  return items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.status === 'producao' && item.supplierId === supplierId)
    .sort((a, b) => {
      const ca = a.item.purchaseOrderId ? code.get(a.item.purchaseOrderId) : undefined;
      const cb = b.item.purchaseOrderId ? code.get(b.item.purchaseOrderId) : undefined;
      if (ca && cb && ca !== cb) return compareOrderCodes(ca, cb);
      if (ca && !cb) return -1;
      if (!ca && cb) return 1;
      return a.item.createdAt.localeCompare(b.item.createdAt) || a.index - b.index;
    })
    .map(({ item }) => item);
}

/**
 * Distribui cada linha da invoice pela produção do fornecedor, a mais antiga primeiro. Linhas do mesmo
 * produto consomem a produção em sequência; o que sobra de uma linha é `extra`.
 */
export function allocateShipment(
  lines: readonly ShipmentLineInput[],
  items: readonly ProductionItem[],
  orders: readonly Pick<PurchaseOrder, 'id' | 'code'>[],
  supplierId: string,
): LineAllocation[] {
  const queue = productionQueue(items, orders, supplierId);
  const left = new Map(queue.map((i) => [i.id, i.quantity]));
  return lines.map((line) => {
    let need = line.quantity;
    const takes: Take[] = [];
    for (const item of queue) {
      if (need === 0) break;
      const available = left.get(item.id)!;
      if (available === 0 || !sameProduct(line, item)) continue;
      const quantity = Math.min(need, available);
      left.set(item.id, available - quantity);
      need -= quantity;
      // Inteiro quando o que restava do item sai todo (as partes tiradas antes por outra linha já
      // viraram itens próprios).
      takes.push({ itemId: item.id, quantity, whole: quantity === available });
    }
    return { takes, extra: need };
  });
}

/**
 * Qual fornecedor mandou a invoice: o nome dele no cabeçalho do arquivo (a Claire assina "Claire &
 * ivy") ou, sem isso, o que tem em produção mais exemplares dos produtos da invoice.
 */
export function guessSupplier(
  lines: readonly ShipmentLineInput[],
  headerText: string,
  items: readonly ProductionItem[],
  suppliers: readonly Supplier[],
): string | null {
  const words = ` ${searchKey(headerText).replace(/[^a-z0-9]+/g, ' ')} `;
  const named = suppliers.filter((s) => {
    const name = searchKey(s.name).replace(/[^a-z0-9]+/g, ' ').trim();
    return name.length >= 3 && words.includes(` ${name} `);
  });
  if (named.length === 1) return named[0]!.id;
  const score = new Map<string, number>();
  for (const item of items) {
    if (item.status !== 'producao' || !item.supplierId) continue;
    if (named.length > 1 && !named.some((s) => s.id === item.supplierId)) continue;
    const line = lines.find((l) => sameProduct(l, item));
    if (line) score.set(item.supplierId, (score.get(item.supplierId) ?? 0) + Math.min(line.quantity, item.quantity));
  }
  let best: string | null = null;
  for (const [id, n] of score) if (best === null || n > score.get(best)!) best = id;
  return best;
}
