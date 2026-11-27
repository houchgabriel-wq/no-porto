// Ligação com o No Estoque (SPEC.md, seção 8): a porta interna NoEstoqueApi (src/worker/index.ts)
// responde com os containers em liberação e os que chegaram a partir de um dia, para o No Estoque montar
// as entradas previstas. Só lê: nada muda no No Porto. Nada de valores sai daqui (src/core/stockArrivals.ts),
// a não ser os arquivos da nota fiscal, que o No Estoque lê por inteiro (decidido pelo Gabriel em 27/11/2026).

import { forStock, stockArrivals, type ArrivedFiscalFile, type StockArrival, type StockFiscalFileContent } from '../core/stockArrivals';
import { spDate } from '../core/shipments';
import { decodeParts } from './billDocuments';
import type { Env } from './env';
import { FISCAL_COLUMNS, type FiscalRow } from './fiscalDocuments';

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
    `SELECT v.id, v.number, v.ref, s.name AS supplier, v.bill_of_lading_id AS bill_id, b.number AS bill, ${ETA} AS eta, ${ARRIVED} AS arrived_at,
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
      bill_id: string | null;
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
      billId: r.bill_id,
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
  const invoiceIds = JSON.stringify(invoices.map((v) => v.id));
  const [items, fiscal] = await env.DB.batch([
    env.DB.prepare(
      `SELECT i.invoice_id, p.isbn, p.title, i.description, i.quantity, i.pieces_per_carton
         FROM order_items i JOIN products p ON p.id = i.product_id
        WHERE i.deleted_at IS NULL AND i.invoice_id IN (SELECT value FROM json_each(?))
        ORDER BY i.invoice_id, i.created_at, p.title, i.id`,
    ).bind(invoiceIds),
    // A nota de cada container e a master de cada BL (27/11/2026): só o nome e o que foi lido; o conteúdo, em fiscalFile.
    env.DB.prepare(
      `SELECT ${FISCAL_COLUMNS} FROM fiscal_documents
        WHERE invoice_id IN (SELECT value FROM json_each(?)) OR bill_of_lading_id IN (SELECT value FROM json_each(?))`,
    ).bind(invoiceIds, JSON.stringify([...new Set(invoices.map((v) => v.billId).filter(Boolean))])),
  ]);
  return stockArrivals(
    invoices,
    (items!.results as { invoice_id: string; isbn: string | null; title: string; description: string; quantity: number; pieces_per_carton: number | null }[]).map((r) => ({
      invoiceId: r.invoice_id,
      isbn: r.isbn,
      title: r.title,
      description: r.description,
      quantity: r.quantity,
      piecesPerCarton: r.pieces_per_carton,
    })),
    (fiscal!.results as FiscalRow[]).map(
      (r): ArrivedFiscalFile => ({
        id: r.id,
        invoiceId: r.invoice_id,
        billId: r.bill_of_lading_id,
        kind: r.kind,
        name: r.name,
        contentType: r.content_type,
        size: r.size,
        key: r.nfe_key,
        number: r.nfe_number,
        series: r.nfe_series,
        issuedAt: r.nfe_issued_at,
      }),
    ),
  );
}

/**
 * O arquivo inteiro da nota fiscal (o PDF ou o XML), pelo id que veio nas chegadas, para o No Estoque ler por
 * completo (pedido do Gabriel em 27/11/2026); null quando o arquivo não existe mais (foi trocado ou tirado).
 */
export async function fiscalFileContent(env: Env, id: string): Promise<StockFiscalFileContent | null> {
  const doc = await env.DB.prepare('SELECT id, name, content_type, size FROM fiscal_documents WHERE id = ?').bind(id).first<{ id: string; name: string; content_type: string; size: number }>();
  if (!doc) return null;
  const { results } = await env.DB.prepare('SELECT data FROM fiscal_document_parts WHERE document_id = ? ORDER BY seq').bind(doc.id).all<{ data: string }>();
  return { id: doc.id, name: doc.name, contentType: doc.content_type, size: doc.size, data: decodeParts(doc.size, results) };
}
