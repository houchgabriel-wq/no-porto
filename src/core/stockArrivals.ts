// Ligação com o No Estoque (decidida pelo Gabriel em 24/11/2026; SPEC.md, seção 8): o No Estoque, que
// cuida do estoque físico de Jandira, busca aqui as chegadas de container para montar as entradas
// previstas. Cada invoice que chegou (a chegada da invoice ou, sem ela, a do BL) vai com o fornecedor, o
// BL, o container e os itens da packing list (código de barras, título, quantidade e peças por caixa).
// Sem preço nem total: nada de valores sai pela ligação.

import { toIsbn13 } from './isbn';

/** Uma chegada como o No Estoque recebe: uma invoice (um container). */
export interface StockArrival {
  /** A invoice no No Porto. */
  id: string;
  /** Dia da chegada (AAAA-MM-DD): o da invoice ou, sem ele, o do BL. */
  arrivedAt: string;
  supplier: string;
  invoice: string;
  ref: string;
  bill: string | null;
  /** Número do container (a unidade do BL); vazio quando não informado. */
  container: string;
  containerKind: string;
  cartons: number | null;
  items: StockArrivalItem[];
}

export interface StockArrivalItem {
  /** O código de barras: o ISBN-13, sem hífens (o ISBN-10 vira ISBN-13); null sem ISBN. */
  barcode: string | null;
  title: string;
  quantity: number;
  piecesPerCarton: number | null;
}

/** Uma invoice que chegou, como sai do banco. */
export interface ArrivedInvoice {
  id: string;
  number: string;
  ref: string;
  supplier: string | null;
  bill: string | null;
  arrivedAt: string;
  container: string;
  containerKind: string;
  cartons: number | null;
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
    supplier: v.supplier ?? '',
    invoice: v.number,
    ref: v.ref,
    bill: v.bill,
    container: v.container,
    containerKind: v.containerKind,
    cartons: v.cartons,
    items: byInvoice.get(v.id) ?? [],
  }));
}
