// Ligação com o No Estoque (SPEC.md, seção 8): a porta interna NoEstoqueApi (src/worker/index.ts)
// responde com as chegadas de container a partir de um dia, para o No Estoque montar as entradas
// previstas. Só lê: nada muda no No Porto, e nada de valores sai daqui (src/core/stockArrivals.ts).

import { stockArrivals, type StockArrival } from '../core/stockArrivals';
import type { Env } from './env';

/** A chegada da invoice: a dela ou, sem ela, a do BL (como em src/core/shipments.ts). */
const ARRIVED = 'COALESCE(v.arrived_at, b.arrived_at)';

/**
 * As invoices que chegaram a partir do dia, da chegada mais antiga para a mais nova. Os itens de cada uma
 * vão na ordem em que entraram; os que entraram juntos (o Novo embarque grava todos na mesma hora), pelo
 * título, para a ordem não mudar de uma busca para a outra.
 */
export async function arrivalsSince(env: Env, since: string): Promise<StockArrival[]> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(since)) throw new Error('Dia inválido: use AAAA-MM-DD.');
  const [invoices, items] = await Promise.all([
    env.DB.prepare(
      `SELECT v.id, v.number, v.ref, s.name AS supplier, b.number AS bill, ${ARRIVED} AS arrived_at, v.container, v.container_kind, v.container_cartons
         FROM invoices v LEFT JOIN bills_of_lading b ON b.id = v.bill_of_lading_id LEFT JOIN suppliers s ON s.id = v.supplier_id
        WHERE ${ARRIVED} >= ?
        ORDER BY arrived_at, b.number, v.number, v.id`,
    )
      .bind(since)
      .all<{ id: string; number: string; ref: string; supplier: string | null; bill: string | null; arrived_at: string; container: string; container_kind: string; container_cartons: number | null }>(),
    env.DB.prepare(
      `SELECT i.invoice_id, p.isbn, p.title, i.description, i.quantity, i.pieces_per_carton
         FROM order_items i JOIN products p ON p.id = i.product_id JOIN invoices v ON v.id = i.invoice_id LEFT JOIN bills_of_lading b ON b.id = v.bill_of_lading_id
        WHERE i.deleted_at IS NULL AND ${ARRIVED} >= ?
        ORDER BY i.invoice_id, i.created_at, p.title, i.id`,
    )
      .bind(since)
      .all<{ invoice_id: string; isbn: string | null; title: string; description: string; quantity: number; pieces_per_carton: number | null }>(),
  ]);
  return stockArrivals(
    invoices.results.map((r) => ({
      id: r.id,
      number: r.number,
      ref: r.ref,
      supplier: r.supplier,
      bill: r.bill,
      arrivedAt: r.arrived_at,
      container: r.container ?? '',
      containerKind: r.container_kind ?? '',
      cartons: r.container_cartons,
    })),
    items.results.map((r) => ({ invoiceId: r.invoice_id, isbn: r.isbn, title: r.title, description: r.description, quantity: r.quantity, piecesPerCarton: r.pieces_per_carton })),
  );
}
