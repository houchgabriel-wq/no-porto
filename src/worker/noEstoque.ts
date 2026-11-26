// Ligação com o No Estoque (SPEC.md, seção 8): a porta interna NoEstoqueApi (src/worker/index.ts)
// responde com os containers em liberação e os que chegaram a partir de um dia, para o No Estoque montar
// as entradas previstas. Só lê: nada muda no No Porto, e nada de valores sai daqui (src/core/stockArrivals.ts).

import { forStock, stockArrivals, type StockArrival } from '../core/stockArrivals';
import { spDate } from '../core/shipments';
import type { Env } from './env';

/** A chegada da invoice: a dela ou, sem ela, a do BL; a previsão: a do BL ou, sem BL, a dela (como em arrivalOf). */
const ARRIVED = 'COALESCE(v.arrived_at, b.arrived_at)';
const ETA = 'CASE WHEN b.id IS NULL THEN v.eta ELSE b.eta END';

/**
 * Os containers em liberação (a previsão passou e a chegada não foi registrada, como na tela Embarques)
 * e os que chegaram a partir do dia: os que chegaram primeiro e, depois, pela previsão. Os itens de cada
 * um vão na ordem em que entraram; os que entraram juntos (o Novo embarque grava todos na mesma hora),
 * pelo título, para a ordem não mudar de uma busca para a outra.
 */
export async function arrivalsSince(env: Env, since: string, now: Date): Promise<StockArrival[]> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(since)) throw new Error('Dia inválido: use AAAA-MM-DD.');
  const today = spDate(now);
  // No ORDER BY, as expressões vão inteiras: com o nome da coluna, o SQLite acusa "ambiguous column name".
  const { results } = await env.DB.prepare(
    `SELECT v.id, v.number, v.ref, s.name AS supplier, b.number AS bill, ${ETA} AS eta, ${ARRIVED} AS arrived_at,
            v.container, v.container_kind, v.container_cartons, v.container_weight_grams, v.container_volume_liters
       FROM invoices v LEFT JOIN bills_of_lading b ON b.id = v.bill_of_lading_id LEFT JOIN suppliers s ON s.id = v.supplier_id
      WHERE ${ARRIVED} >= ? OR (${ARRIVED} IS NULL AND ${ETA} < ?)
      ORDER BY ${ARRIVED} IS NULL, ${ARRIVED}, ${ETA}, b.number, v.number, v.id`,
  )
    .bind(since, today)
    .all<{
      id: string;
      number: string;
      ref: string;
      supplier: string | null;
      bill: string | null;
      eta: string | null;
      arrived_at: string | null;
      container: string;
      container_kind: string;
      container_cartons: number | null;
      container_weight_grams: number | null;
      container_volume_liters: number | null;
    }>();
  // A mesma regra da tela Embarques decide o que vai (a consulta só separa as candidatas).
  const invoices = results
    .map((r) => ({
      id: r.id,
      number: r.number,
      ref: r.ref,
      supplier: r.supplier,
      bill: r.bill,
      eta: r.eta,
      arrivedAt: r.arrived_at,
      container: r.container ?? '',
      containerKind: r.container_kind ?? '',
      cartons: r.container_cartons,
      weightGrams: r.container_weight_grams,
      volumeLiters: r.container_volume_liters,
    }))
    .filter((v) => forStock(v, since, today));
  if (!invoices.length) return [];
  const items = await env.DB.prepare(
    `SELECT i.invoice_id, p.isbn, p.title, i.description, i.quantity, i.pieces_per_carton
       FROM order_items i JOIN products p ON p.id = i.product_id
      WHERE i.deleted_at IS NULL AND i.invoice_id IN (SELECT value FROM json_each(?))
      ORDER BY i.invoice_id, i.created_at, p.title, i.id`,
  )
    .bind(JSON.stringify(invoices.map((v) => v.id)))
    .all<{ invoice_id: string; isbn: string | null; title: string; description: string; quantity: number; pieces_per_carton: number | null }>();
  return stockArrivals(
    invoices,
    items.results.map((r) => ({ invoiceId: r.invoice_id, isbn: r.isbn, title: r.title, description: r.description, quantity: r.quantity, piecesPerCarton: r.pieces_per_carton })),
  );
}
