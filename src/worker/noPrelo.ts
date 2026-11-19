// Ligação com o No Prelo (decidida pelo Gabriel em 19/11/2026): busca no No Prelo, pela ligação
// interna entre os dois Workers da mesma conta (a porta NoPortoApi do Worker "no-prelo"), as datas de
// aprovação da gráfica, e grava a "Aprovação do arquivo" dos itens do mesmo ISBN e da mesma PO
// (src/core/noPrelo.ts). Roda uma vez por dia, de manhã, e quando o admin pede.

import { approvalChanges, type NoPreloApproval } from '../core/noPrelo';
import { can } from '../core/roles';
import type { Session } from './auth';
import type { Env } from './env';
import { checkMutation, error, HttpError, json } from './http';
import { eventStatement } from './orders';

export interface NoPreloSync {
  /** Itens com a aprovação do arquivo trocada (os que só passaram a vir do No Prelo não contam). */
  updated: number;
  /** Aprovações que o No Prelo mandou. */
  approvals: number;
}

/** Quem assina as mudanças da busca diária: o primeiro admin, como nas mudanças automáticas do No Prelo. */
async function firstAdmin(env: Env): Promise<string | null> {
  const row = await env.DB.prepare("SELECT id FROM users WHERE role = 'admin' AND active = 1 ORDER BY created_at LIMIT 1").first<{ id: string }>();
  return row?.id ?? null;
}

export async function syncNoPrelo(env: Env, now: Date, userId?: string): Promise<NoPreloSync> {
  if (!env.NOPRELO) throw new HttpError(503, 'A ligação com o No Prelo não está configurada.');
  let approvals: NoPreloApproval[];
  try {
    approvals = await env.NOPRELO.fileApprovals();
  } catch {
    throw new HttpError(502, 'O No Prelo não respondeu. Tente de novo mais tarde.');
  }
  const by = userId ?? (await firstAdmin(env));
  if (!by) return { updated: 0, approvals: approvals.length };
  const { results } = await env.DB.prepare(
    `SELECT i.id, p.isbn, o.code AS order_code, i.file_approved_at, i.file_approved_from
       FROM order_items i JOIN products p ON p.id = i.product_id LEFT JOIN purchase_orders o ON o.id = i.purchase_order_id
      WHERE i.deleted_at IS NULL AND (o.code IS NOT NULL OR i.file_approved_from IS NOT NULL)`,
  ).all<{ id: string; isbn: string | null; order_code: string | null; file_approved_at: string | null; file_approved_from: string | null }>();
  const changes = approvalChanges(
    approvals,
    results.map((r) => ({ id: r.id, isbn: r.isbn, orderCode: r.order_code, fileApprovedAt: r.file_approved_at, fileApprovedFrom: r.file_approved_from })),
  );
  const at = now.toISOString();
  const statements: D1PreparedStatement[] = [];
  for (const c of changes) {
    statements.push(env.DB.prepare('UPDATE order_items SET file_approved_at = ?, file_approved_from = ?, updated_at = ?, updated_by = ? WHERE id = ?').bind(c.to, c.source, at, by, c.itemId));
    if (c.from !== c.to) {
      statements.push(eventStatement(env, c.itemId, by, 'changed', { changes: [{ field: 'Aprovação do arquivo', from: c.from, to: c.to }], source: 'no-prelo' }, at));
    }
  }
  // Em partes, como as cargas, para não passar do limite de um envio ao banco.
  for (let i = 0; i < statements.length; i += 500) await env.DB.batch(statements.slice(i, i + 500));
  return { updated: changes.filter((c) => c.from !== c.to).length, approvals: approvals.length };
}

export async function routeNoPrelo(request: Request, env: Env, session: Session, key: string, now: Date): Promise<Response | null> {
  if (key !== 'POST /api/noprelo/sync') return null;
  // Buscar agora, fora do horário: só o admin (como as cargas de planilha).
  if (!can(session.user.role, 'import')) return error(403, 'Só o admin busca as aprovações no No Prelo.');
  checkMutation(request);
  return json(await syncNoPrelo(env, now, session.user.id));
}
