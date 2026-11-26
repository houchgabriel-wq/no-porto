// Ligação com o No Estoque (decidida pelo Gabriel em 24/11/2026; SPEC.md, seção 8): o No Estoque, que
// cuida do estoque físico de Jandira, busca aqui os containers para montar as entradas previstas: os em
// liberação, como na tela Embarques (pedido do Gabriel em 26/11/2026), e os que chegaram a partir do dia
// pedido (para o container que chega não sumir de lá antes de ser guardado). Cada invoice vai com a
// previsão, a chegada, o container (a unidade do BL, com as caixas, o peso e o volume) e os itens da
// packing list (código de barras, título, quantidade e peças por caixa). Sem preço nem total: nada de
// valores sai pela ligação.

import { toIsbn13 } from './isbn';
import { arrivalState } from './shipments';

/** Uma chegada como o No Estoque recebe: uma invoice (um container). */
export interface StockArrival {
  /** A invoice no No Porto. */
  id: string;
  /** Dia da chegada (AAAA-MM-DD): o da invoice ou, sem ele, o do BL; null em liberação. */
  arrivedAt: string | null;
  /** Chegada prevista: a do BL ou, sem BL, a da invoice (como em arrivalOf). */
  eta: string | null;
  supplier: string;
  invoice: string;
  ref: string;
  bill: string | null;
  /** Número do container (a unidade do BL); vazio quando não informado. */
  container: string;
  containerKind: string;
  cartons: number | null;
  /** Peso bruto do container, em gramas (a unidade do BL). */
  weightGrams: number | null;
  /** Cubagem do container, em litros (m³ × 1000). */
  volumeLiters: number | null;
  items: StockArrivalItem[];
}

export interface StockArrivalItem {
  /** O código de barras: o ISBN-13, sem hífens (o ISBN-10 vira ISBN-13); null sem ISBN. */
  barcode: string | null;
  title: string;
  quantity: number;
  piecesPerCarton: number | null;
}

/** Uma invoice em liberação ou que chegou, como sai do banco. */
export interface ArrivedInvoice {
  id: string;
  number: string;
  ref: string;
  supplier: string | null;
  bill: string | null;
  eta: string | null;
  arrivedAt: string | null;
  container: string;
  containerKind: string;
  cartons: number | null;
  weightGrams: number | null;
  volumeLiters: number | null;
}

/**
 * Vai para o No Estoque: o container em liberação (a previsão passou e a chegada não foi registrada,
 * pela mesma regra da tela Embarques) e o que chegou a partir do dia pedido.
 */
export function forStock(v: Pick<ArrivedInvoice, 'eta' | 'arrivedAt'>, since: string, today: string): boolean {
  const state = arrivalState(v.eta, v.arrivedAt, today);
  return state.kind === 'liberacao' || (state.kind === 'chegou' && state.on >= since);
}

/** Um item de uma invoice que chegou, como sai do banco. */
export interface ArrivedItem {
  invoiceId: string;
  isbn: string | null;
  title: string;
  description: string;
  quantity: number;
  piecesPerCarton: number | null;
}

/** As chegadas, na ordem das invoices, cada uma com os seus itens. */
export function stockArrivals(invoices: readonly ArrivedInvoice[], items: readonly ArrivedItem[]): StockArrival[] {
  const byInvoice = new Map<string, StockArrivalItem[]>();
  for (const i of items) {
    const list = byInvoice.get(i.invoiceId) ?? [];
    list.push({
      barcode: i.isbn?.trim() ? toIsbn13(i.isbn) : null,
      title: i.title.trim() || i.description.trim(),
      quantity: i.quantity,
      piecesPerCarton: i.piecesPerCarton && i.piecesPerCarton > 0 ? i.piecesPerCarton : null,
    });
    byInvoice.set(i.invoiceId, list);
  }
  return invoices.map((v) => ({
    id: v.id,
    arrivedAt: v.arrivedAt,
    eta: v.eta,
    supplier: v.supplier ?? '',
    invoice: v.number,
    ref: v.ref,
    bill: v.bill,
    container: v.container,
    containerKind: v.containerKind,
    cartons: v.cartons,
    weightGrams: v.weightGrams,
    volumeLiters: v.volumeLiters,
    items: byInvoice.get(v.id) ?? [],
  }));
}
