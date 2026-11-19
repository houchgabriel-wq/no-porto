// Cópia completa (SPEC.md, seção 5): todos os dados para a planilha no formato da status_importações,
// montada no navegador. Para o admin e os perfis Editor e Consulta (pedidos do Gabriel em 19/11/2026),
// que já veem tudo, com preços e pagamentos; os outros perfis não recebem.

import { can } from '../core/roles';
import type { Session } from './auth';
import type { Env } from './env';
import { error, json } from './http';
import { ITEM_SELECT, toItem, type ItemRow } from './orders';

async function getExport(env: Env): Promise<Response> {
  const [i, v, b, p, o, s, sp] = await env.DB.batch([
    env.DB.prepare(`${ITEM_SELECT} WHERE i.deleted_at IS NULL ORDER BY i.created_at, i.rowid`),
    env.DB.prepare('SELECT id, number, ref, supplier_id, bill_of_lading_id, eta, arrived_at, notes FROM invoices'),
    env.DB.prepare('SELECT id, number, eta, arrived_at, notes FROM bills_of_lading'),
    env.DB.prepare('SELECT id, invoice_id, paid_at, amount_cents, exchange_rate_e4, notes FROM payments'),
    env.DB.prepare('SELECT id, code, ordered_at, notes FROM purchase_orders'),
    env.DB.prepare('SELECT id, name FROM suppliers ORDER BY name COLLATE NOCASE'),
    env.DB.prepare("SELECT id, specification FROM order_items WHERE deleted_at IS NULL AND specification <> ''"),
  ]);
  const specs = new Map((sp!.results as { id: string; specification: string }[]).map((r) => [r.id, r.specification]));
  type V = { id: string; number: string; ref: string; supplier_id: string | null; bill_of_lading_id: string | null; eta: string | null; arrived_at: string | null; notes: string };
  type B = { id: string; number: string; eta: string | null; arrived_at: string | null; notes: string };
  type P = { id: string; invoice_id: string; paid_at: string | null; amount_cents: number | null; exchange_rate_e4: number | null; notes: string };
  type O = { id: string; code: string; ordered_at: string | null; notes: string };
  return json({
    items: (i!.results as ItemRow[]).map((r) => ({ ...toItem(r), ...(specs.has(r.id) ? { specification: specs.get(r.id) } : {}) })),
    invoices: (v!.results as V[]).map((r) => ({ id: r.id, number: r.number, ref: r.ref, supplierId: r.supplier_id, billId: r.bill_of_lading_id, eta: r.eta, arrivedAt: r.arrived_at, notes: r.notes })),
    bills: (b!.results as B[]).map((r) => ({ id: r.id, number: r.number, eta: r.eta, arrivedAt: r.arrived_at, notes: r.notes })),
    payments: (p!.results as P[]).map((r) => ({ id: r.id, invoiceId: r.invoice_id, paidAt: r.paid_at, amountCents: r.amount_cents, exchangeRateE4: r.exchange_rate_e4, notes: r.notes })),
    orders: (o!.results as O[]).map((r) => ({ id: r.id, code: r.code, orderedAt: r.ordered_at, notes: r.notes })),
    suppliers: s!.results as { id: string; name: string }[],
  });
}

export async function routeExport(env: Env, session: Session, key: string): Promise<Response | null> {
  if (key !== 'GET /api/export') return null;
  if (!can(session.user.role, 'full_copy')) return error(403, 'Seu perfil não baixa a cópia completa.');
  return getExport(env);
}
