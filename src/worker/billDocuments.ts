// Arquivo do BL (SPEC.md, seção 3): anexar (editor e admin), baixar (quem vê valores) e tirar. O
// arquivo chega em base64 dentro do JSON, como os outros pedidos, e fica no banco em partes de 1 MB.

import { z } from 'zod';
import { can } from '../core/roles';
import type { Session } from './auth';
import type { Env } from './env';
import { checkMutation, error, json, readBody } from './http';

/** Tamanho máximo do arquivo do BL. */
export const MAX_DOCUMENT_BYTES = 5_000_000;
/** Caracteres de base64 por parte guardada (múltiplo de 4, para cada parte se decodificar sozinha). */
const PART_CHARS = 1_000_000;

export const DOCUMENT_TYPES = ['application/pdf', 'image/png', 'image/jpeg'] as const;

const putBody = z.object({
  name: z
    .string()
    .transform((s) => s.replace(/[\\/\u0000-\u001f]+/g, ' ').trim())
    .pipe(z.string().min(1, 'Arquivo sem nome.').max(200, 'Nome de arquivo longo demais.')),
  contentType: z.enum(DOCUMENT_TYPES, { error: 'Envie o BL em PDF, PNG ou JPG.' }),
  data: z.string().regex(/^[A-Za-z0-9+/]*={0,2}$/, 'Arquivo inválido.'),
});

function decodedSize(base64: string): number {
  const pad = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return (base64.length / 4) * 3 - pad;
}

async function putDocument(request: Request, env: Env, session: Session, billId: string, now: Date): Promise<Response> {
  checkMutation(request);
  const body = await readBody(request, putBody, Math.ceil((MAX_DOCUMENT_BYTES * 4) / 3) + 10_000);
  if (body.data.length % 4 !== 0 || body.data.length === 0) return error(400, 'Arquivo inválido.');
  const size = decodedSize(body.data);
  if (size > MAX_DOCUMENT_BYTES) return error(413, 'O arquivo do BL pode ter no máximo 5 MB.');
  const bill = await env.DB.prepare('SELECT id FROM bills_of_lading WHERE id = ?').bind(billId).first();
  if (!bill) return error(404, 'BL não encontrado.');
  const id = crypto.randomUUID();
  const statements: D1PreparedStatement[] = [
    env.DB.prepare('DELETE FROM bill_document_parts WHERE document_id IN (SELECT id FROM bill_documents WHERE bill_of_lading_id = ?)').bind(billId),
    env.DB.prepare('DELETE FROM bill_documents WHERE bill_of_lading_id = ?').bind(billId),
    env.DB.prepare('INSERT INTO bill_documents (id, bill_of_lading_id, name, content_type, size, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(
      id,
      billId,
      body.name,
      body.contentType,
      size,
      now.toISOString(),
      session.user.id,
    ),
  ];
  for (let i = 0, seq = 0; i < body.data.length; i += PART_CHARS, seq++) {
    statements.push(env.DB.prepare('INSERT INTO bill_document_parts (document_id, seq, data) VALUES (?, ?, ?)').bind(id, seq, body.data.slice(i, i + PART_CHARS)));
  }
  await env.DB.batch(statements);
  return json({ document: { name: body.name, size } }, 201);
}

async function getDocument(env: Env, billId: string): Promise<Response> {
  const doc = await env.DB.prepare('SELECT id, name, content_type, size FROM bill_documents WHERE bill_of_lading_id = ?').bind(billId).first<{
    id: string;
    name: string;
    content_type: string;
    size: number;
  }>();
  if (!doc) return error(404, 'Este BL não tem arquivo.');
  const { results } = await env.DB.prepare('SELECT data FROM bill_document_parts WHERE document_id = ? ORDER BY seq').bind(doc.id).all<{ data: string }>();
  const bytes = new Uint8Array(doc.size);
  let at = 0;
  for (const { data } of results) {
    const bin = atob(data);
    for (let i = 0; i < bin.length; i++) bytes[at++] = bin.charCodeAt(i);
  }
  return new Response(bytes, {
    headers: {
      'content-type': doc.content_type,
      'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(doc.name)}`,
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; sandbox",
    },
  });
}

async function deleteDocument(request: Request, env: Env, billId: string): Promise<Response> {
  checkMutation(request);
  const doc = await env.DB.prepare('SELECT id FROM bill_documents WHERE bill_of_lading_id = ?').bind(billId).first();
  if (!doc) return error(404, 'Este BL não tem arquivo.');
  await env.DB.batch([
    env.DB.prepare('DELETE FROM bill_document_parts WHERE document_id IN (SELECT id FROM bill_documents WHERE bill_of_lading_id = ?)').bind(billId),
    env.DB.prepare('DELETE FROM bill_documents WHERE bill_of_lading_id = ?').bind(billId),
  ]);
  return json({ ok: true });
}

export async function routeBillDocuments(request: Request, env: Env, session: Session, path: string, now: Date): Promise<Response | null> {
  const m = /^\/api\/bills\/([^/]+)\/document$/.exec(path);
  if (!m) return null;
  const billId = decodeURIComponent(m[1]!);
  const role = session.user.role;
  if (request.method === 'GET') {
    // O BL pode trazer frete e valores: segue a regra dos valores (o leitor não baixa).
    if (!can(role, 'see_values')) return error(403, 'Seu perfil não baixa o arquivo do BL.');
    return getDocument(env, billId);
  }
  if (!can(role, 'edit')) return error(403, 'Seu perfil só pode acompanhar.');
  if (request.method === 'PUT') return putDocument(request, env, session, billId, now);
  if (request.method === 'DELETE') return deleteDocument(request, env, billId);
  return error(405, 'Método não permitido.');
}
