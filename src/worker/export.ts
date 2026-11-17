// Cópia completa (SPEC.md, seção 5): todos os dados para a planilha no formato da status_importações,
// montada no navegador. Só para o admin, porque leva preços, pagamentos e tudo o que foi excluído não.

import { can } from '../core/roles';
import type { Session } from './auth';
import type { Env } from './env';
import { error, json } from './http';
import { ITEM_SELECT, toItem, type ItemRow } from './orders';

async function getExport(env: Env): Promise<Response> {
  const [i, v, b, p, o, s] = await env.DB.batch([
    env.DB.prepare(`${ITEM_SELECT} WHERE i.deleted_at IS NULL ORDER BY i.created_at, i.rowid`),
    env.DB.prepare('SELECT id, number, ref, supplier_id, bill_of_lading_id, eta, arrived_at, notes FROM invoices'),
    env.DB.prepare('SELECT id, number, eta, arrived_at, notes FROM bills_of_lading'),
    env.DB.prepare('SELECT id, invoice_id, paid_at, amount_cents, exchange_rate_e4, notes FROM payments'),
    env.DB.prepare('SELECT id, code, ordered_at, notes FROM purchase_orders'),
    env.DB.prepare('SELECT id, name FROM suppliers ORDER BY name COLLATE NOCASE'),
  ]);
  type V = { id: string; number: string; ref: string; supplier_id: string | null; bill_of_lading_id: string | null; eta: string | null; arrived_at: string | null; notes: string };
  type B = { id: string; number: string; eta: string | null; arrived_at: string | null; notes: string };
  type P = { id: string; invoice_id: string; paid_at: string | null; amount_cents: number | null; exchange_rate_e4: number | null; notes: string };
  type O = { id: string; code: string; ordered_at: string | null; notes: string };
  return json({
    items: (i!.results as ItemRow[]).map((r) => toItem(r)),
    invoices: (v!.results as V[]).map((r) => ({ id: r.id, number: r.number, ref: r.ref, supplierId: r.supplier_id, billId: r.bill_of_lading_id, eta: r.eta, arrivedAt: r.arrived_at, notes: r.notes })),
    bills: (b!.results as B[]).map((r) => ({ id: r.id, number: r.number, eta: r.eta, arrivedAt: r.arrived_at, notes: r.notes })),
    payments: (p!.results as P[]).map((r) => ({ id: r.id, invoiceId: r.invoice_id, paidAt: r.paid_at, amountCents: r.amount_cents, exchangeRateE4: r.exchange_rate_e4, notes: r.notes })),
    orders: (o!.results as O[]).map((r) => ({ id: r.id, code: r.code, orderedAt: r.ordered_at, notes: r.notes })),
    suppliers: s!.results as { id: string; name: string }[],
  });
}

export async function routeExport(env: Env, session: Session, key: string): Promise<Response | null> {
  if (key !== 'GET /api/export') return null;
  if (!can(session.user.role, 'import')) return error(403, 'Só o admin baixa a cópia completa.');
  return getExport(env);
}
