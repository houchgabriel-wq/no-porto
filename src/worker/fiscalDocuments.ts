// A nota fiscal do embarque (pedido do Gabriel em 27/11/2026; SPEC.md, seção 3): o PDF (o DANFE) e o XML da NF-e
// de cada container e, no BL com mais de um container, a nota master, com o embarque todo. Ficam guardados como os
// outros arquivos do embarque (src/worker/billDocuments.ts), em partes de 1 MB, em base64. O XML é lido aqui
// (src/core/nfe.ts): só entra o de uma NF-e, e a chave, o número, a série, o dia e a situação ficam gravados; a
// chave do PDF vem lida pelo navegador. Anexar, trocar e tirar: admin e editor. Baixar: quem vê valores, porque a
// nota traz os valores e os impostos (o leitor e o perfil Embarques não baixam nem recebem os nomes). O Agente de
// cargas é recusado em todas. Os arquivos vão inteiros para o No Estoque (src/worker/noEstoque.ts).

import { z } from 'zod';
import { readNfe, validNfeKey, type FiscalNote, type NfeStatus } from '../core/nfe';
import { can } from '../core/roles';
import type { Session } from './auth';
import { decodedSize, fileResponse, MAX_DOCUMENT_BYTES, PART_CHARS } from './billDocuments';
import type { Env } from './env';
import { checkMutation, error, json, readBody } from './http';
import { DOCUMENT_BODY_BYTES, documentName } from './invoiceDocuments';

export const FISCAL_KINDS = ['pdf', 'xml'] as const;
export type FiscalKind = (typeof FISCAL_KINDS)[number];

/** A nota do container (na invoice) ou a master (no BL). */
type Scope = 'invoice' | 'bill';
const COLUMN: Record<Scope, 'invoice_id' | 'bill_of_lading_id'> = { invoice: 'invoice_id', bill: 'bill_of_lading_id' };

const LABEL: Record<Scope, Record<FiscalKind, string>> = {
  invoice: { pdf: 'o PDF da nota fiscal', xml: 'o XML da nota fiscal' },
  bill: { pdf: 'o PDF da nota master', xml: 'o XML da nota master' },
};

/** O XML chega como o navegador conhece o tipo: application/xml ou text/xml. Fica guardado como application/xml. */
const XML_TYPES = ['application/xml', 'text/xml'];

const putBody = z.object({
  name: documentName,
  contentType: z.string().max(100),
  data: z.string().regex(/^[A-Za-z0-9+/]*={0,2}$/, 'Arquivo inválido.'),
  // A chave de acesso impressa no PDF, que o navegador leu (só no PDF; sem ela, null).
  key: z.string().nullable().default(null),
});

/** O que fica gravado do arquivo, além dele: a chave e, do XML, o número, a série, o dia e a situação. */
interface NfeColumns {
  key: string | null;
  number: string | null;
  series: string | null;
  issuedAt: string | null;
  status: NfeStatus | null;
}

/** Os bytes do começo do arquivo, para conferir que é PDF ("%PDF-" no primeiro KB, como os leitores aceitam). */
function looksLikePdf(base64: string): boolean {
  const head = atob(base64.slice(0, 1368));
  return head.slice(0, 1024).includes('%PDF-');
}

/** O texto do XML (a NF-e é sempre em UTF-8). */
function xmlText(base64: string): string {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/** Confere o arquivo pelo tipo: o PDF (com a chave lida no navegador, se veio) ou o XML da NF-e, que é lido. */
function checkFile(kind: FiscalKind, body: z.infer<typeof putBody>): { contentType: string; nfe: NfeColumns } | Response {
  if (kind === 'pdf') {
    if (body.contentType !== 'application/pdf' || !looksLikePdf(body.data)) return error(400, 'Envie a nota fiscal em PDF.');
    if (body.key !== null && !validNfeKey(body.key)) return error(400, 'A chave de acesso lida no PDF não confere.');
    return { contentType: 'application/pdf', nfe: { key: body.key, number: null, series: null, issuedAt: null, status: null } };
  }
  if (!XML_TYPES.includes(body.contentType)) return error(400, 'Envie o XML da nota (o arquivo .xml).');
  const read = readNfe(xmlText(body.data));
  if (!read.ok) return error(400, read.error);
  return { contentType: 'application/xml', nfe: read.nfe };
}

/** Os comandos que tiram o arquivo guardado deste tipo (se houver). */
function removeStatements(env: Env, scope: Scope, ownerId: string, kind: FiscalKind): D1PreparedStatement[] {
  const column = COLUMN[scope];
  return [
    env.DB.prepare(`DELETE FROM fiscal_document_parts WHERE document_id IN (SELECT id FROM fiscal_documents WHERE ${column} = ? AND kind = ?)`).bind(ownerId, kind),
    env.DB.prepare(`DELETE FROM fiscal_documents WHERE ${column} = ? AND kind = ?`).bind(ownerId, kind),
  ];
}

/** As notas das invoices excluídas saem junto com elas (`ids` é a lista em JSON). */
export function deleteInvoiceFiscalStatements(env: Env, ids: string): D1PreparedStatement[] {
  return [
    env.DB.prepare('DELETE FROM fiscal_document_parts WHERE document_id IN (SELECT id FROM fiscal_documents WHERE invoice_id IN (SELECT value FROM json_each(?)))').bind(ids),
    env.DB.prepare('DELETE FROM fiscal_documents WHERE invoice_id IN (SELECT value FROM json_each(?))').bind(ids),
  ];
}

/** A nota master sai junto com o BL. */
export function deleteBillFiscalStatements(env: Env, billId: string): D1PreparedStatement[] {
  return [
    env.DB.prepare('DELETE FROM fiscal_document_parts WHERE document_id IN (SELECT id FROM fiscal_documents WHERE bill_of_lading_id = ?)').bind(billId),
    env.DB.prepare('DELETE FROM fiscal_documents WHERE bill_of_lading_id = ?').bind(billId),
  ];
}

async function putDocument(request: Request, env: Env, session: Session, scope: Scope, ownerId: string, kind: FiscalKind, now: Date): Promise<Response> {
  checkMutation(request);
  const body = await readBody(request, putBody, DOCUMENT_BODY_BYTES);
  if (body.data.length % 4 !== 0 || body.data.length === 0) return error(400, 'Arquivo inválido.');
  const size = decodedSize(body.data);
  if (size > MAX_DOCUMENT_BYTES) return error(413, `${LABEL[scope][kind].replace(/^o/, 'O')} pode ter no máximo 5 MB.`);
  const owner = await env.DB.prepare(scope === 'invoice' ? 'SELECT id FROM invoices WHERE id = ?' : 'SELECT id FROM bills_of_lading WHERE id = ?').bind(ownerId).first();
  if (!owner) return error(404, scope === 'invoice' ? 'Invoice não encontrada.' : 'BL não encontrado.');
  const checked = checkFile(kind, body);
  if (checked instanceof Response) return checked;
  const { nfe } = checked;
  const id = crypto.randomUUID();
  const statements: D1PreparedStatement[] = [
    ...removeStatements(env, scope, ownerId, kind),
    env.DB.prepare(
      `INSERT INTO fiscal_documents (id, ${COLUMN[scope]}, kind, name, content_type, size, nfe_key, nfe_number, nfe_series, nfe_issued_at, nfe_status, created_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(id, ownerId, kind, body.name, checked.contentType, size, nfe.key, nfe.number, nfe.series, nfe.issuedAt, nfe.status, now.toISOString(), session.user.id),
  ];
  for (let i = 0, seq = 0; i < body.data.length; i += PART_CHARS, seq++) {
    statements.push(env.DB.prepare('INSERT INTO fiscal_document_parts (document_id, seq, data) VALUES (?, ?, ?)').bind(id, seq, body.data.slice(i, i + PART_CHARS)));
  }
  await env.DB.batch(statements);
  return json({ document: { name: body.name, size, ...nfe } }, 201);
}

async function getDocument(env: Env, scope: Scope, ownerId: string, kind: FiscalKind): Promise<Response> {
  const doc = await env.DB.prepare(`SELECT id, name, content_type, size FROM fiscal_documents WHERE ${COLUMN[scope]} = ? AND kind = ?`).bind(ownerId, kind).first<{
    id: string;
    name: string;
    content_type: string;
    size: number;
  }>();
  if (!doc) return error(404, `${scope === 'invoice' ? 'Este container' : 'Este BL'} não tem ${LABEL[scope][kind]}.`);
  const { results } = await env.DB.prepare('SELECT data FROM fiscal_document_parts WHERE document_id = ? ORDER BY seq').bind(doc.id).all<{ data: string }>();
  return fileResponse(doc, results);
}

async function deleteDocument(request: Request, env: Env, scope: Scope, ownerId: string, kind: FiscalKind): Promise<Response> {
  checkMutation(request);
  const doc = await env.DB.prepare(`SELECT id FROM fiscal_documents WHERE ${COLUMN[scope]} = ? AND kind = ?`).bind(ownerId, kind).first();
  if (!doc) return error(404, `${scope === 'invoice' ? 'Este container' : 'Este BL'} não tem ${LABEL[scope][kind]}.`);
  await env.DB.batch(removeStatements(env, scope, ownerId, kind));
  return json({ ok: true });
}

/** Uma linha de fiscal_documents como /api/data e a porta do No Estoque leem. */
export interface FiscalRow {
  id: string;
  invoice_id: string | null;
  bill_of_lading_id: string | null;
  kind: FiscalKind;
  name: string;
  content_type: string;
  size: number;
  nfe_key: string | null;
  nfe_number: string | null;
  nfe_series: string | null;
  nfe_issued_at: string | null;
  nfe_status: NfeStatus | null;
}

export const FISCAL_COLUMNS = 'id, invoice_id, bill_of_lading_id, kind, name, content_type, size, nfe_key, nfe_number, nfe_series, nfe_issued_at, nfe_status';

/** As notas como as telas recebem: a de cada invoice (o container) e a de cada BL (a master). */
export function fiscalNotes(rows: readonly FiscalRow[]): { byInvoice: Map<string, FiscalNote>; byBill: Map<string, FiscalNote> } {
  const byInvoice = new Map<string, FiscalNote>();
  const byBill = new Map<string, FiscalNote>();
  for (const r of rows) {
    const map = r.invoice_id ? byInvoice : byBill;
    const owner = r.invoice_id ?? r.bill_of_lading_id!;
    const note: FiscalNote = { ...map.get(owner) };
    if (r.kind === 'pdf') note.pdf = { name: r.name, size: r.size, key: r.nfe_key };
    else if (r.nfe_key && r.nfe_number && r.nfe_series && r.nfe_status) {
      note.xml = { name: r.name, size: r.size, key: r.nfe_key, number: r.nfe_number, series: r.nfe_series, issuedAt: r.nfe_issued_at, status: r.nfe_status };
    }
    map.set(owner, note);
  }
  return { byInvoice, byBill };
}

export async function routeFiscalDocuments(request: Request, env: Env, session: Session, path: string, now: Date): Promise<Response | null> {
  const m = /^\/api\/(invoices|bills)\/([^/]+)\/fiscal\/(pdf|xml)$/.exec(path);
  if (!m) return null;
  const scope: Scope = m[1] === 'invoices' ? 'invoice' : 'bill';
  const ownerId = decodeURIComponent(m[2]!);
  const kind = m[3] as FiscalKind;
  const role = session.user.role;
  if (request.method === 'GET') {
    // A nota traz os valores e os impostos: segue a regra dos valores, como os outros arquivos do embarque.
    if (!can(role, 'see_values')) return error(403, 'Seu perfil não baixa as notas fiscais.');
    return getDocument(env, scope, ownerId, kind);
  }
  if (!can(role, 'edit')) return error(403, 'Seu perfil só pode acompanhar.');
  if (request.method === 'PUT') return putDocument(request, env, session, scope, ownerId, kind, now);
  if (request.method === 'DELETE') return deleteDocument(request, env, scope, ownerId, kind);
  return error(405, 'Método não permitido.');
}
