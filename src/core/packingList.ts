// Packing list de um container já registrado (pedido do Gabriel em 26/11/2026): para o No Estoque montar
// a entrada, cada item precisa das peças por caixa, que vêm da packing list. Aqui: ligar as linhas da
// packing list aos itens da invoice (pelo ISBN ou, sem ele, pelo nome, como no Novo embarque) e dizer o
// que muda. As linhas do mesmo produto se juntam como no Novo embarque (a caixa de sobra da Sara), e
// vale a caixa padrão.

import { sameProduct } from './allocation';
import { packingTotals } from './billUnits';
import type { DocumentLine } from './documents';
import { formatQuantity } from './money';
import { combinePackingLines } from './shipmentFiles';

/** Um item da invoice, como a tela tem. */
export interface PackingItem {
  id: string;
  isbn: string | null;
  description: string;
  quantity: number;
  piecesPerCarton: number | null;
}

/** Um item da invoice diante da packing list. */
export interface PackingRow {
  itemId: string;
  description: string;
  quantity: number;
  /** As peças por caixa de agora. */
  from: number | null;
  /** As da packing list; null quando o item não está nela ou ela não traz. */
  to: number | null;
  /** O item está na packing list. */
  found: boolean;
}

export interface PackingPlan {
  rows: PackingRow[];
  /** Os itens que mudam: as peças por caixa da packing list, diferentes das de agora. */
  changes: { itemId: string; piecesPerCarton: number }[];
  /** O que a pessoa precisa conferir: item fora da packing list, linha a mais, quantidade diferente. */
  warnings: string[];
  /** Caixas e peso bruto da packing list inteira, quando dá para somar. */
  cartons: number | null;
  weightGrams: number | null;
}

/** Liga a packing list aos itens do container. A quantidade não muda: só as peças por caixa. */
export function packingPlan(items: readonly PackingItem[], packing: readonly DocumentLine[]): PackingPlan {
  const pl = combinePackingLines(packing);
  const used = new Set<number>();
  const rows: PackingRow[] = items.map((item) => {
    const i = pl.findIndex((p) => sameProduct(p, item));
    if (i >= 0) used.add(i);
    return { itemId: item.id, description: item.description, quantity: item.quantity, from: item.piecesPerCarton, to: i >= 0 ? pl[i]!.piecesPerCarton : null, found: i >= 0 };
  });
  const warnings: string[] = [];
  for (const r of rows) {
    if (!r.found) warnings.push(`"${r.description}" não está na packing list: as peças por caixa ficam como estão.`);
    else if (r.to === null) warnings.push(`"${r.description}": a packing list não traz as peças por caixa. Ficam como estão.`);
  }
  pl.forEach((p, i) => {
    if (!used.has(i)) {
      warnings.push(`"${p.description}" está na packing list (linha ${p.row}) e não neste container: fica de fora.`);
      return;
    }
    // Os itens do mesmo produto (de POs diferentes) somam juntos, como na invoice.
    const same = items.filter((it) => sameProduct(p, it));
    const total = same.reduce((s, it) => s + it.quantity, 0);
    if (total !== p.quantity) {
      warnings.push(`"${same[0]!.description}": o container tem ${formatQuantity(total)} e a packing list, ${formatQuantity(p.quantity)}. A quantidade não muda.`);
    }
  });
  const changes = rows.filter((r) => r.to !== null && r.to !== r.from).map((r) => ({ itemId: r.itemId, piecesPerCarton: r.to! }));
  // As caixas contam todas as linhas, inclusive a caixa de sobra.
  const totals = packingTotals(packing);
  return { rows, changes, warnings, cartons: totals.cartons, weightGrams: totals.weightGrams };
}

/** "6.000 ex. em 150 caixas de 40": o resumo das caixas de um item, quando se sabe. */
export function cartonsText(quantity: number, piecesPerCarton: number | null): string {
  if (!piecesPerCarton) return `${formatQuantity(quantity)} ex.`;
  const cartons = Math.ceil(quantity / piecesPerCarton);
  return `${formatQuantity(quantity)} ex. em ${formatQuantity(cartons)} ${cartons === 1 ? 'caixa' : 'caixas'} de ${formatQuantity(piecesPerCarton)}`;
}

/** Quantos itens do container ainda estão sem as peças por caixa. */
export function missingPieces(items: readonly Pick<PackingItem, 'piecesPerCarton'>[]): number {
  return items.filter((i) => !i.piecesPerCarton).length;
}
