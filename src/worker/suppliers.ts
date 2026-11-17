// Fornecedores (SPEC.md, seção 5): o resumo de cada um (produção, mar e entregue por ano), somado no
// banco, e a alteração do nome e das observações. O leitor não recebe valores.

import { z } from 'zod';
import { can } from '../core/roles';
import { supplierSummaries, type SupplierSumRow } from '../core/suppliers';
import type { Session } from './auth';
import type { Env } from './env';
import { checkMutation, error, json, readBody } from './http';

const updateBody = z
  .object({
    name: z
      .string()
      .transform((s) => s.replace(/\s+/g, ' ').trim())
      .pipe(z.string().min(1, 'Informe o nome do fornecedor.').max(100, 'O nome pode ter no máximo 100 caracteres.')),
    notes: z
      .string()
      .max(2000, 'As observações podem ter no máximo 2.000 caracteres.')
      .transform((s) => s.trim()),
  })
  .partial()
  .refine((b) => Object.keys(b).length > 0, 'Nada para alterar.');

// Total de cada item arredondado ao centavo, como em itemTotalCents (src/core/money.ts).
const SUMS = `SELECT i.supplier_id, i.status,
       CASE WHEN i.status = 'entregue' THEN substr(COALESCE(v.arrived_at, b.arrived_at), 1, 4) END AS year,
       COUNT(*) AS items, SUM(i.quantity) AS quantity,
       SUM(CASE WHEN i.unit_price_micros IS NULL THEN 0 ELSE CAST(ROUND(i.quantity * i.unit_price_micros / 10000.0) AS INTEGER) END) AS value_cents,
       MAX(CASE WHEN i.status = 'entregue' THEN COALESCE(v.arrived_at, b.arrived_at) END) AS last_arrival
  FROM order_items i
  LEFT JOIN invoices v ON v.id = i.invoice_id
  LEFT JOIN bills_of_lading b ON b.id = v.bill_of_lading_id
 WHERE i.deleted_at IS NULL
 GROUP BY i.supplier_id, i.status, year`;

interface SumRow {
  supplier_id: string | null;
  status: SupplierSumRow['status'];
  year: string | null;
  items: number;
  quantity: number;
  value_cents: number;
  last_arrival: string | null;
}

async function getSuppliers(env: Env, session: Session): Promise<Response> {
  const seeValues = can(session.user.role, 'see_values');
  const [s, sums] = await env.DB.batch([env.DB.prepare('SELECT id, name, notes FROM suppliers ORDER BY name COLLATE NOCASE'), env.DB.prepare(SUMS)]);
  const rows: SupplierSumRow[] = (sums!.results as SumRow[]).map((r) => ({
    supplierId: r.supplier_id,
    status: r.status,
    year: r.year,
    items: r.items,
    quantity: r.quantity,
    valueCents: r.value_cents,
    lastArrival: r.last_arrival,
  }));
  return json({ suppliers: supplierSummaries(rows, s!.results as { id: string; name: string; notes: string }[], seeValues), seeValues });
}

async function updateSupplier(request: Request, env: Env, session: Session, id: string, now: Date): Promise<Response> {
  checkMutation(request);
  const body = await readBody(request, updateBody);
  const before = await env.DB.prepare('SELECT id, name, notes FROM suppliers WHERE id = ?').bind(id).first<{ id: string; name: string; notes: string }>();
  if (!before) return error(404, 'Fornecedor não encontrado.');
  if (body.name && body.name.toLowerCase() !== before.name.toLowerCase()) {
    const other = await env.DB.prepare('SELECT id FROM suppliers WHERE name = ? COLLATE NOCASE AND id <> ?').bind(body.name, id).first();
    if (other) return error(409, `Já existe o fornecedor ${body.name}.`);
  }
  const next = { name: body.name ?? before.name, notes: body.notes ?? before.notes };
  const changes = (['name', 'notes'] as const).filter((k) => next[k] !== before[k]).map((k) => ({ field: k === 'name' ? 'Nome' : 'Observações', from: before[k], to: next[k] }));
  if (changes.length) {
    const at = now.toISOString();
    await env.DB.batch([
      env.DB.prepare('UPDATE suppliers SET name = ?, notes = ? WHERE id = ?').bind(next.name, next.notes, id),
      env.DB.prepare("INSERT INTO events (id, entity, entity_id, user_id, type, detail, created_at) VALUES (?, 'supplier', ?, ?, 'changed', ?, ?)").bind(
        crypto.randomUUID(),
        id,
        session.user.id,
        JSON.stringify({ changes }),
        at,
      ),
    ]);
  }
  return json({ supplier: { id, ...next } });
}

export async function routeSuppliers(request: Request, env: Env, session: Session, key: string, path: string, now: Date): Promise<Response | null> {
  if (key === 'GET /api/suppliers') return getSuppliers(env, session);
  const m = /^\/api\/suppliers\/([^/]+)$/.exec(path);
  if (m && request.method === 'PATCH') {
    if (!can(session.user.role, 'edit')) return error(403, 'Seu perfil só pode acompanhar.');
    return updateSupplier(request, env, session, decodeURIComponent(m[1]!), now);
  }
  return null;
}
