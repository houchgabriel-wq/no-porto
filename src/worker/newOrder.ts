// Nova PO pelo sistema (pedido do Gabriel em 24/11/2026): o catálogo para escolher os produtos. Vêm os
// que já tiveram PO, com a última compra (preço, peças por caixa, especificação, PO e fornecedor), e os
// títulos da curva ABC que ainda não estão no No Porto. A PO em si é gravada pelo POST /api/orders, o
// mesmo do Novo pedido. Só admin e editor criam PO; os outros perfis recebem 403.

import { poCatalog } from '../core/newOrder';
import { can } from '../core/roles';
import type { Session } from './auth';
import type { Env } from './env';
import { error, json } from './http';
import { readCurve } from './stock';

async function getCatalog(env: Env): Promise<Response> {
  const { results } = await env.DB.prepare(
    `SELECT i.product_id, p.isbn, i.description, o.code AS order_code, s.name AS supplier_name, i.created_at,
            i.unit_price_micros, i.pieces_per_carton, i.specification
       FROM order_items i JOIN products p ON p.id = i.product_id
       LEFT JOIN purchase_orders o ON o.id = i.purchase_order_id
       LEFT JOIN suppliers s ON s.id = i.supplier_id
      WHERE i.deleted_at IS NULL`,
  ).all<{
    product_id: string;
    isbn: string | null;
    description: string;
    order_code: string | null;
    supplier_name: string | null;
    created_at: string;
    unit_price_micros: number | null;
    pieces_per_carton: number | null;
    specification: string;
  }>();
  const curve = await readCurve(env);
  const products = poCatalog(
    results.map((r) => ({
      productId: r.product_id,
      isbn: r.isbn,
      description: r.description,
      orderCode: r.order_code,
      supplierName: r.supplier_name,
      createdAt: r.created_at,
      unitPriceMicros: r.unit_price_micros,
      piecesPerCarton: r.pieces_per_carton,
      specification: r.specification ?? '',
    })),
    curve?.rows ?? [],
  );
  return json({ products });
}

export async function routeNewOrder(env: Env, session: Session, key: string): Promise<Response | null> {
  if (key !== 'GET /api/po-catalog') return null;
  if (!can(session.user.role, 'edit')) return error(403, 'Só admin e editor criam PO.');
  return getCatalog(env);
}
