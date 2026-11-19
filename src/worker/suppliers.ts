// Fornecedores (SPEC.md, seção 5): o resumo de cada um (produção, mar e entregue por ano), somado no
// banco, e a alteração do nome e das observações; só admin e editor (decidido em 19/11/2026). O
// "Recebido no ano" do painel sai por uma rota própria, para todos que veem o painel, sem valores para o
// leitor.

import { z } from 'zod';
import { can } from '../core/roles';
import { spDate } from '../core/shipments';
import { mergedSupplierNotes, receivedInYear, supplierSummaries, type SupplierSumRow } from '../core/suppliers';
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

/** O resumo de cada fornecedor, somado no banco; sem valores para quem não os vê. */
async function summaries(env: Env, seeValues: boolean) {
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
  return supplierSummaries(rows, s!.results as { id: string; name: string; notes: string }[], seeValues);
}

async function getSuppliers(env: Env, session: Session): Promise<Response> {
  const seeValues = can(session.user.role, 'see_values');
  return json({ suppliers: await summaries(env, seeValues), seeValues });
}

/** O recebido no ano corrente (todos os fornecedores juntos), para o painel. */
async function getReceived(env: Env, session: Session, now: Date): Promise<Response> {
  const seeValues = can(session.user.role, 'see_values');
  const year = spDate(now).slice(0, 4);
  return json({ year, amount: receivedInYear(await summaries(env, seeValues), year, seeValues), seeValues });
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

const mergeBody = z.object({ into: z.string().min(1, 'Escolha o fornecedor que fica.') });

/**
 * Junta dois fornecedores que são a mesma empresa: tudo o que é do que sai (itens em produção,
 * embarcados e entregues, invoices, BLs e solicitações de embarque) passa para o que fica, as
 * observações se somam e o que sai deixa de existir. Só o admin, como as exclusões.
 */
async function mergeSupplier(request: Request, env: Env, session: Session, id: string, now: Date): Promise<Response> {
  checkMutation(request);
  const { into } = await readBody(request, mergeBody);
  if (into === id) return error(400, 'Escolha outro fornecedor para juntar.');
  const [gone, keep] = await Promise.all(
    [id, into].map((x) => env.DB.prepare('SELECT id, name, notes FROM suppliers WHERE id = ?').bind(x).first<{ id: string; name: string; notes: string }>()),
  );
  if (!gone || !keep) return error(404, 'Fornecedor não encontrado.');
  const counts = await env.DB.prepare(
    `SELECT (SELECT COUNT(*) FROM order_items WHERE supplier_id = ?1 AND deleted_at IS NULL) AS items,
            (SELECT COUNT(*) FROM invoices WHERE supplier_id = ?1) AS invoices`,
  )
    .bind(id)
    .first<{ items: number; invoices: number }>();
  const notes = mergedSupplierNotes(keep, gone);
  const at = now.toISOString();
  const move = (table: string) => env.DB.prepare(`UPDATE ${table} SET supplier_id = ? WHERE supplier_id = ?`).bind(into, id);
  await env.DB.batch([
    move('order_items'),
    move('invoices'),
    move('bills_of_lading'),
    move('booking_requests'),
    env.DB.prepare('UPDATE suppliers SET notes = ? WHERE id = ?').bind(notes, into),
    env.DB.prepare("INSERT INTO events (id, entity, entity_id, user_id, type, detail, created_at) VALUES (?, 'supplier', ?, ?, 'merged', ?, ?)").bind(
      crypto.randomUUID(),
      into,
      session.user.id,
      JSON.stringify({ from: { id, name: gone.name, notes: gone.notes }, items: counts?.items ?? 0, invoices: counts?.invoices ?? 0 }),
      at,
    ),
    env.DB.prepare('DELETE FROM suppliers WHERE id = ?').bind(id),
  ]);
  return json({ supplier: { id: into, name: keep.name, notes }, moved: { items: counts?.items ?? 0, invoices: counts?.invoices ?? 0 } });
}

export async function routeSuppliers(request: Request, env: Env, session: Session, key: string, path: string, now: Date): Promise<Response | null> {
  if (key === 'GET /api/suppliers') {
    if (!can(session.user.role, 'view_suppliers')) return error(403, 'Seu perfil não vê os fornecedores.');
    return getSuppliers(env, session);
  }
  if (key === 'GET /api/received') {
    if (!can(session.user.role, 'view_all') || !can(session.user.role, 'see_year_totals')) return error(403, 'Seu perfil não vê o painel.');
    return getReceived(env, session, now);
  }
  const m = /^\/api\/suppliers\/([^/]+)$/.exec(path);
  if (m && request.method === 'PATCH') {
    if (!can(session.user.role, 'edit')) return error(403, 'Seu perfil só pode acompanhar.');
    return updateSupplier(request, env, session, decodeURIComponent(m[1]!), now);
  }
  const merge = /^\/api\/suppliers\/([^/]+)\/merge$/.exec(path);
  if (merge && request.method === 'POST') {
    if (!can(session.user.role, 'delete')) return error(403, 'Só o administrador junta fornecedores.');
    return mergeSupplier(request, env, session, decodeURIComponent(merge[1]!), now);
  }
  return null;
}
