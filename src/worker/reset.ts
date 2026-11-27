// Começar do zero (SPEC.md, seção 7): o admin apaga fornecedores, produtos, POs, itens, BLs, invoices,
// pagamentos, arquivos dos BLs e o histórico de alterações, para fazer de novo a carga completa da planilha. Usuários,
// sessões e as solicitações de embarque ficam (estas, sem a ligação com o fornecedor, só com o nome que tinham).
// Pede a palavra APAGAR, para não acontecer por engano.

import { z } from 'zod';
import { can } from '../core/roles';
import type { Session } from './auth';
import type { Env } from './env';
import { checkMutation, error, json, readBody } from './http';

/** A palavra que a pessoa digita para confirmar. */
export const RESET_WORD = 'APAGAR';

const resetBody = z.object({ confirm: z.string().refine((s) => s.trim().toUpperCase() === RESET_WORD, `Digite ${RESET_WORD} para confirmar.`) });

/** Na ordem das chaves: o que aponta para outra tabela sai antes dela. */
const TABLES = [
  'bill_document_parts',
  'bill_documents',
  'invoice_document_parts',
  'invoice_documents',
  'payments',
  'events',
  'order_items',
  'invoices',
  'bills_of_lading',
  'purchase_orders',
  'products',
  'suppliers',
] as const;

async function reset(request: Request, env: Env): Promise<Response> {
  checkMutation(request);
  await readBody(request, resetBody);
  const counted = await env.DB.prepare('SELECT COUNT(*) AS n FROM order_items').first<{ n: number }>();
  await env.DB.batch([
    // As solicitações de embarque guardam o nome do fornecedor e não saem; só perdem a ligação com ele.
    env.DB.prepare('UPDATE booking_requests SET supplier_id = NULL'),
    ...TABLES.map((t) => env.DB.prepare(`DELETE FROM ${t}`)),
  ]);
  return json({ items: counted?.n ?? 0 });
}

export async function routeReset(request: Request, env: Env, session: Session, key: string): Promise<Response | null> {
  if (key !== 'POST /api/reset') return null;
  if (!can(session.user.role, 'import') || !can(session.user.role, 'delete')) return error(403, 'Só o admin apaga os dados.');
  return reset(request, env);
}
