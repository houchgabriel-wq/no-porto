// Arquivos de cada container (pedido do Gabriel em 27/11/2026): a invoice e a packing list, guardadas como o
// arquivo do BL (src/worker/billDocuments.ts), em partes de 1 MB, em base64. Anexar, trocar e tirar: editor e
// admin. Baixar: quem vê valores, porque a invoice traz os preços (o leitor e o perfil Embarques não baixam).

import { z } from 'zod';
import { can } from '../core/roles';
import type { Session } from './auth';
import { decodedSize, fileResponse, MAX_DOCUMENT_BYTES, PART_CHARS } from './billDocuments';
import type { Env } from './env';
import { checkMutation, error, json, readBody } from './http';

export const INVOICE_DOCUMENT_KINDS = ['invoice', 'packing'] as const;
export type InvoiceDocumentKind = (typeof INVOICE_DOCUMENT_KINDS)[number];

/** Excel (.xlsx e .xls) e PDF: as invoices e packing lists chegam assim. */
export const INVOICE_DOCUMENT_TYPES = ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel', 'application/pdf'] as const;

const LABEL: Record<InvoiceDocumentKind, string> = { invoice: 'da invoice', packing: 'da packing list' };

/** O nome do arquivo, sem barras nem caracteres de controle. */
const documentName = z
  .string()
  .transform((s) => s.replace(/[\\/\u0000-\u001f]+/g, ' ').trim())
  .pipe(z.string().min(1, 'Arquivo sem nome.').max(200, 'Nome de arquivo longo demais.'));

/** O tipo e o conteúdo (em base64) do arquivo enviado. */
export const documentContent = z.object({
  contentType: z.enum(INVOICE_DOCUMENT_TYPES, { error: 'Envie o arquivo em Excel (.xlsx ou .xls) ou PDF.' }),
  data: z.string().regex(/^[A-Za-z0-9+/]*={0,2}$/, 'Arquivo inválido.'),
});

/** O limite do corpo de um pedido que traz o arquivo. */
export const DOCUMENT_BODY_BYTES = Math.ceil((MAX_DOCUMENT_BYTES * 4) / 3) + 10_000;

const putBody = documentContent.extend({ name: documentName });

/**
 * Os comandos que guardam o arquivo da invoice ou da packing list no lugar do que houver (também usados ao
 * registrar a packing list, que guarda o arquivo junto); ou o erro, se o arquivo não serve.
 */
export function storeInvoiceDocument(
  env: Env,
  userId: string,
  invoiceId: string,
  kind: InvoiceDocumentKind,
  doc: { name: string; contentType: string; data: string },
  now: Date,
): { statements: D1PreparedStatement[]; size: number } | Response {
  if (doc.data.length % 4 !== 0 || doc.data.length === 0) return error(400, 'Arquivo inválido.');
  const size = decodedSize(doc.data);
  if (size > MAX_DOCUMENT_BYTES) return error(413, `O arquivo ${LABEL[kind]} pode ter no máximo 5 MB.`);
  const id = crypto.randomUUID();
  const statements: D1PreparedStatement[] = [
    ...removeInvoiceDocumentStatements(env, invoiceId, kind),
    env.DB.prepare('INSERT INTO invoice_documents (id, invoice_id, kind, name, content_type, size, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(
      id,
      invoiceId,
      kind,
      doc.name,
      doc.contentType,
      size,
      now.toISOString(),
      userId,
    ),
  ];
  for (let i = 0, seq = 0; i < doc.data.length; i += PART_CHARS, seq++) {
    statements.push(env.DB.prepare('INSERT INTO invoice_document_parts (document_id, seq, data) VALUES (?, ?, ?)').bind(id, seq, doc.data.slice(i, i + PART_CHARS)));
  }
  return { statements, size };
}

async function putDocument(request: Request, env: Env, session: Session, invoiceId: string, kind: InvoiceDocumentKind, now: Date): Promise<Response> {
  checkMutation(request);
  const body = await readBody(request, putBody, DOCUMENT_BODY_BYTES);
  const stored = storeInvoiceDocument(env, session.user.id, invoiceId, kind, body, now);
  if (stored instanceof Response) return stored;
  const invoice = await env.DB.prepare('SELECT id FROM invoices WHERE id = ?').bind(invoiceId).first();
  if (!invoice) return error(404, 'Invoice não encontrada.');
  await env.DB.batch(stored.statements);
  return json({ document: { name: body.name, size: stored.size } }, 201);
}

/** Os comandos que tiram o arquivo guardado (se houver). */
export function removeInvoiceDocumentStatements(env: Env, invoiceId: string, kind: InvoiceDocumentKind): D1PreparedStatement[] {
  return [
    env.DB.prepare('DELETE FROM invoice_document_parts WHERE document_id IN (SELECT id FROM invoice_documents WHERE invoice_id = ? AND kind = ?)').bind(invoiceId, kind),
    env.DB.prepare('DELETE FROM invoice_documents WHERE invoice_id = ? AND kind = ?').bind(invoiceId, kind),
  ];
}

/** Os arquivos das invoices excluídas saem junto com elas (`ids` é a lista em JSON). */
export function deleteInvoiceDocumentsStatements(env: Env, ids: string): D1PreparedStatement[] {
  return [
    env.DB.prepare('DELETE FROM invoice_document_parts WHERE document_id IN (SELECT id FROM invoice_documents WHERE invoice_id IN (SELECT value FROM json_each(?)))').bind(ids),
    env.DB.prepare('DELETE FROM invoice_documents WHERE invoice_id IN (SELECT value FROM json_each(?))').bind(ids),
  ];
}

async function getDocument(env: Env, invoiceId: string, kind: InvoiceDocumentKind): Promise<Response> {
  const doc = await env.DB.prepare('SELECT id, name, content_type, size FROM invoice_documents WHERE invoice_id = ? AND kind = ?').bind(invoiceId, kind).first<{
    id: string;
    name: string;
    content_type: string;
    size: number;
  }>();
  if (!doc) return error(404, `Este container não tem o arquivo ${LABEL[kind]}.`);
  const { results } = await env.DB.prepare('SELECT data FROM invoice_document_parts WHERE document_id = ? ORDER BY seq').bind(doc.id).all<{ data: string }>();
  return fileResponse(doc, results);
}

async function deleteDocument(request: Request, env: Env, invoiceId: string, kind: InvoiceDocumentKind): Promise<Response> {
  checkMutation(request);
  const doc = await env.DB.prepare('SELECT id FROM invoice_documents WHERE invoice_id = ? AND kind = ?').bind(invoiceId, kind).first();
  if (!doc) return error(404, `Este container não tem o arquivo ${LABEL[kind]}.`);
  await env.DB.batch(removeInvoiceDocumentStatements(env, invoiceId, kind));
  return json({ ok: true });
}

export async function routeInvoiceDocuments(request: Request, env: Env, session: Session, path: string, now: Date): Promise<Response | null> {
  const m = /^\/api\/invoices\/([^/]+)\/documents\/(invoice|packing)$/.exec(path);
  if (!m) return null;
  const invoiceId = decodeURIComponent(m[1]!);
  const kind = m[2] as InvoiceDocumentKind;
  const role = session.user.role;
  if (request.method === 'GET') {
    // A invoice traz os preços: segue a regra dos valores, como o arquivo do BL.
    if (!can(role, 'see_values')) return error(403, 'Seu perfil não baixa os arquivos do embarque.');
    return getDocument(env, invoiceId, kind);
  }
  if (!can(role, 'edit')) return error(403, 'Seu perfil só pode acompanhar.');
  if (request.method === 'PUT') return putDocument(request, env, session, invoiceId, kind, now);
  if (request.method === 'DELETE') return deleteDocument(request, env, invoiceId, kind);
  return error(405, 'Método não permitido.');
}
