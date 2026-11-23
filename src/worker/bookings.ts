// Solicitações de embarque (SPEC.md, seção 3): o agente de cargas pede os containers de cada
// fornecedor e só o Gabriel aprova ou recusa. O Agente recebe só as próprias solicitações e a lista de
// nomes dos fornecedores; nada da produção, dos embarques ou dos valores dos livros sai para ele.

import { z } from 'zod';
import {
  approvalProblem,
  BOOKING_STATUS_LABELS,
  bookingProblem,
  canDecideBookings,
  canEditBookingDetails,
  CONTAINER_TYPES,
  arrivalDateProblem,
  MAX_CONTAINERS,
  normalizeReference,
  readyDateProblem,
  referenceProblem,
  type BookingRequest,
  type BookingStatus,
  type ContainerType,
} from '../core/bookings';
import { can } from '../core/roles';
import { spDate } from '../core/shipments';
import type { Session } from './auth';
import type { Env } from './env';
import { checkMutation, error, json, readBody } from './http';

const containerType = z.enum(CONTAINER_TYPES, { error: 'Tipo de container inválido.' });
const wholeNumber = (message: string) => z.number({ error: message }).int(message);
const note = (max: number) =>
  z
    .string({ error: 'Texto inválido.' })
    .max(max, `O texto pode ter no máximo ${max.toLocaleString('pt-BR')} caracteres.`)
    .transform((s) => s.trim());

const reference = z.string({ error: 'Informe o número de referência.' }).max(400, 'O número de referência pode ter no máximo 40 caracteres.').transform(normalizeReference);

const day = (message: string) => z.string({ error: message }).max(20, message);

const createBody = z.object({
  reference,
  readyDate: day('Informe a prontidão do container.'),
  arrivalDate: day('Informe a previsão de chegada.'),
  supplierId: z.string({ error: 'Escolha o fornecedor.' }).min(1, 'Escolha o fornecedor.').max(100, 'Fornecedor inválido.'),
  departurePort: z
    .string({ error: 'Informe o porto de saída.' })
    .max(400, 'O porto pode ter no máximo 80 caracteres.')
    .transform((s) => s.replace(/\s+/g, ' ').trim())
    .pipe(z.string().max(80, 'O porto pode ter no máximo 80 caracteres.')),
  departureDate: z.string({ error: 'Informe a data de saída.' }).max(20, 'Informe a data de saída.'),
  notes: note(1000).default(''),
  lines: z
    .array(z.object({ containerType, quantity: wholeNumber('Quantidade de containers inválida.'), priceCents: wholeNumber('Valor do container inválido.') }), {
      error: 'Informe os containers.',
    })
    .max(CONTAINER_TYPES.length, 'Cada tipo de container entra uma vez só.'),
});

const approveBody = z.object({
  lines: z
    .array(z.object({ containerType, approvedQuantity: wholeNumber('Quantidade aprovada inválida.').max(MAX_CONTAINERS, 'Quantidade aprovada inválida.') }), {
      error: 'Informe as quantidades aprovadas.',
    })
    .max(CONTAINER_TYPES.length, 'Informe quantos containers de cada tipo pedido são aprovados.'),
  note: note(1000).default(''),
});

/** O que se corrige depois: o número de referência e as duas datas, um de cada vez ou juntos. */
const detailsBody = z.object({
  reference: reference.optional(),
  readyDate: day('Informe a prontidão do container.').optional(),
  arrivalDate: day('Informe a previsão de chegada.').optional(),
});

const refuseBody = z.object({
  note: z
    .string({ error: 'Informe o motivo da recusa.' })
    .max(1000, 'O motivo pode ter no máximo 1.000 caracteres.')
    .transform((s) => s.trim())
    .pipe(z.string().min(1, 'Informe o motivo da recusa.')),
});

// ---------- Banco ----------

interface RequestRow {
  id: string;
  reference: string;
  ready_date: string | null;
  arrival_date: string | null;
  supplier_id: string | null;
  supplier_name: string;
  current_supplier_name: string | null;
  departure_port: string;
  departure_date: string;
  notes: string;
  status: BookingStatus;
  created_at: string;
  created_by: string;
  created_by_name: string;
  decided_at: string | null;
  decided_by: string | null;
  decided_by_name: string | null;
  decision_note: string;
}

interface LineRow {
  request_id: string;
  container_type: ContainerType;
  quantity: number;
  approved_quantity: number | null;
  price_cents: number;
}

const SELECT_REQUESTS = `SELECT r.*, s.name AS current_supplier_name, cu.name AS created_by_name, du.name AS decided_by_name
  FROM booking_requests r
  JOIN users cu ON cu.id = r.created_by
  LEFT JOIN users du ON du.id = r.decided_by
  LEFT JOIN suppliers s ON s.id = r.supplier_id`;

function toRequest(row: RequestRow, lines: readonly LineRow[]): BookingRequest {
  return {
    id: row.id,
    reference: row.reference,
    readyDate: row.ready_date,
    arrivalDate: row.arrival_date,
    supplierId: row.supplier_id,
    // O nome atual do fornecedor (pode ter sido corrigido); sem fornecedor, o nome do pedido.
    supplierName: row.current_supplier_name ?? row.supplier_name,
    departurePort: row.departure_port,
    departureDate: row.departure_date,
    notes: row.notes,
    status: row.status,
    createdAt: row.created_at,
    createdBy: { id: row.created_by, name: row.created_by_name },
    decidedAt: row.decided_at,
    decidedBy: row.decided_by ? { id: row.decided_by, name: row.decided_by_name ?? '' } : null,
    decisionNote: row.decision_note,
    lines: lines
      .filter((l) => l.request_id === row.id)
      .map((l) => ({ containerType: l.container_type, quantity: l.quantity, approvedQuantity: l.approved_quantity, priceCents: l.price_cents })),
  };
}

/** As solicitações (todas, ou só as de quem pediu), com as linhas, da mais nova para a mais antiga. */
async function loadRequests(env: Env, createdBy: string | null): Promise<BookingRequest[]> {
  const filter = createdBy ? ' WHERE r.created_by = ?' : '';
  const lineFilter = createdBy ? ' WHERE request_id IN (SELECT id FROM booking_requests WHERE created_by = ?)' : '';
  const requests = env.DB.prepare(`${SELECT_REQUESTS}${filter} ORDER BY r.created_at DESC`);
  const lines = env.DB.prepare(`SELECT * FROM booking_request_lines${lineFilter}`);
  const [r, l] = await env.DB.batch(createdBy ? [requests.bind(createdBy), lines.bind(createdBy)] : [requests, lines]);
  const lineRows = l!.results as LineRow[];
  return (r!.results as RequestRow[]).map((row) => toRequest(row, lineRows));
}

async function loadRequest(env: Env, id: string): Promise<BookingRequest | null> {
  const [r, l] = await env.DB.batch([
    env.DB.prepare(`${SELECT_REQUESTS} WHERE r.id = ?`).bind(id),
    env.DB.prepare('SELECT * FROM booking_request_lines WHERE request_id = ?').bind(id),
  ]);
  const row = (r!.results as RequestRow[])[0];
  return row ? toRequest(row, l!.results as LineRow[]) : null;
}

// ---------- Rotas ----------

/** A lista da tela: o Agente recebe só as dele; a equipe, todas. Os fornecedores vão só com id e nome. */
async function listRequests(env: Env, session: Session, now: Date): Promise<Response> {
  const own = can(session.user.role, 'request_bookings');
  const [requests, suppliers] = await Promise.all([
    loadRequests(env, own ? session.user.id : null),
    env.DB.prepare('SELECT id, name FROM suppliers ORDER BY name COLLATE NOCASE').all<{ id: string; name: string }>(),
  ]);
  return json({ today: spDate(now), requests, suppliers: suppliers.results, canDecide: canDecideBookings(session.user) });
}

async function createRequest(request: Request, env: Env, session: Session, now: Date): Promise<Response> {
  checkMutation(request);
  const body = await readBody(request, createBody);
  const problem = bookingProblem(body, spDate(now));
  if (problem) return error(400, problem);
  const supplier = await env.DB.prepare('SELECT id, name FROM suppliers WHERE id = ?').bind(body.supplierId).first<{ id: string; name: string }>();
  if (!supplier) return error(400, 'Fornecedor não encontrado. Escolha um da lista.');

  const id = crypto.randomUUID();
  const at = now.toISOString();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO booking_requests (id, reference, supplier_id, supplier_name, departure_port, departure_date, ready_date, arrival_date, notes, status, created_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'aguardando', ?, ?)`,
    ).bind(id, body.reference, supplier.id, supplier.name, body.departurePort, body.departureDate, body.readyDate, body.arrivalDate, body.notes, at, session.user.id),
    ...body.lines.map((l) =>
      env.DB.prepare('INSERT INTO booking_request_lines (request_id, container_type, quantity, price_cents) VALUES (?, ?, ?, ?)').bind(id, l.containerType, l.quantity, l.priceCents),
    ),
  ]);
  return json({ request: await loadRequest(env, id) }, 201);
}

/**
 * Corrige o número de referência, a prontidão do container e a previsão de chegada: o agente nas
 * próprias solicitações, admin e editor em qualquer uma. As datas são conferidas com a saída prevista.
 */
async function updateDetails(request: Request, env: Env, session: Session, id: string): Promise<Response> {
  checkMutation(request);
  const body = await readBody(request, detailsBody);
  const current = await loadRequest(env, id);
  // A de outra pessoa nem aparece para o Agente: responde como se não existisse.
  if (!current || (can(session.user.role, 'request_bookings') && current.createdBy.id !== session.user.id)) return error(404, 'Solicitação não encontrada.');
  if (!canEditBookingDetails(current, session.user)) return error(403, 'Você não corrige os dados desta solicitação.');
  const sets: string[] = [];
  const values: string[] = [];
  if (body.reference !== undefined) {
    const problem = referenceProblem(body.reference);
    if (problem) return error(400, problem);
    sets.push('reference = ?');
    values.push(body.reference);
  }
  if (body.readyDate !== undefined) {
    const problem = readyDateProblem(current.departureDate, body.readyDate);
    if (problem) return error(400, problem);
    sets.push('ready_date = ?');
    values.push(body.readyDate);
  }
  if (body.arrivalDate !== undefined) {
    const problem = arrivalDateProblem(current.departureDate, body.arrivalDate);
    if (problem) return error(400, problem);
    sets.push('arrival_date = ?');
    values.push(body.arrivalDate);
  }
  if (!sets.length) return error(400, 'Informe o que corrigir.');
  await env.DB.prepare(`UPDATE booking_requests SET ${sets.join(', ')} WHERE id = ?`)
    .bind(...values, id)
    .run();
  return json({ request: await loadRequest(env, id) });
}

/** Recusa decidir o que já foi decidido, dizendo como está. */
function alreadyDecided(current: BookingRequest): Response {
  return error(409, `Esta solicitação já está ${BOOKING_STATUS_LABELS[current.status].toLowerCase()}.`);
}

async function cancelRequest(request: Request, env: Env, session: Session, id: string, now: Date): Promise<Response> {
  checkMutation(request);
  const current = await loadRequest(env, id);
  // A de outra pessoa nem aparece para o Agente: responde como se não existisse.
  if (!current || current.createdBy.id !== session.user.id) return error(404, 'Solicitação não encontrada.');
  if (current.status !== 'aguardando') return alreadyDecided(current);
  const result = await env.DB.prepare("UPDATE booking_requests SET status = 'cancelada', decided_at = ?, decided_by = ? WHERE id = ? AND status = 'aguardando'")
    .bind(now.toISOString(), session.user.id, id)
    .run();
  if (!result.meta.changes) return alreadyDecided((await loadRequest(env, id))!);
  return json({ request: await loadRequest(env, id) });
}

async function approveRequest(request: Request, env: Env, session: Session, id: string, now: Date): Promise<Response> {
  checkMutation(request);
  const body = await readBody(request, approveBody);
  const current = await loadRequest(env, id);
  if (!current) return error(404, 'Solicitação não encontrada.');
  if (current.status !== 'aguardando') return alreadyDecided(current);
  const problem = approvalProblem(current.lines, body.lines);
  if (problem) return error(400, problem);

  const at = now.toISOString();
  const me = session.user.id;
  // Num lote só (transação no D1): a solicitação muda só se ainda aguarda, e as quantidades só são
  // gravadas se foi esta aprovação que mudou a solicitação.
  await env.DB.batch([
    env.DB.prepare("UPDATE booking_requests SET status = 'aprovada', decided_at = ?, decided_by = ?, decision_note = ? WHERE id = ? AND status = 'aguardando'").bind(at, me, body.note, id),
    ...body.lines.map((l) =>
      env.DB.prepare(
        `UPDATE booking_request_lines SET approved_quantity = ?
          WHERE request_id = ? AND container_type = ?
            AND EXISTS (SELECT 1 FROM booking_requests WHERE id = ? AND status = 'aprovada' AND decided_at = ? AND decided_by = ?)`,
      ).bind(l.approvedQuantity, id, l.containerType, id, at, me),
    ),
  ]);
  const after = (await loadRequest(env, id))!;
  if (after.status !== 'aprovada' || after.decidedAt !== at || after.decidedBy?.id !== me) return alreadyDecided(after);
  return json({ request: after });
}

async function refuseRequest(request: Request, env: Env, session: Session, id: string, now: Date): Promise<Response> {
  checkMutation(request);
  const body = await readBody(request, refuseBody);
  const current = await loadRequest(env, id);
  if (!current) return error(404, 'Solicitação não encontrada.');
  if (current.status !== 'aguardando') return alreadyDecided(current);
  const result = await env.DB.prepare("UPDATE booking_requests SET status = 'recusada', decided_at = ?, decided_by = ?, decision_note = ? WHERE id = ? AND status = 'aguardando'")
    .bind(now.toISOString(), session.user.id, body.note, id)
    .run();
  if (!result.meta.changes) return alreadyDecided((await loadRequest(env, id))!);
  return json({ request: await loadRequest(env, id) });
}

export async function routeBookings(request: Request, env: Env, session: Session, key: string, path: string, now: Date): Promise<Response | null> {
  if (path !== '/api/bookings' && !path.startsWith('/api/bookings/')) return null;
  const role = session.user.role;
  const requester = can(role, 'request_bookings');

  if (key === 'GET /api/bookings') {
    if (!requester && !can(role, 'view_bookings')) return error(403, 'Seu perfil não vê as solicitações de embarque.');
    return listRequests(env, session, now);
  }
  if (key === 'POST /api/bookings') {
    if (!requester) return error(403, 'Só o agente de cargas cadastra solicitações de embarque.');
    return createRequest(request, env, session, now);
  }
  const one = /^\/api\/bookings\/([^/]+)$/.exec(path);
  if (one && request.method === 'PATCH') {
    if (!requester && !can(role, 'view_bookings')) return error(403, 'Seu perfil não vê as solicitações de embarque.');
    return updateDetails(request, env, session, decodeURIComponent(one[1]!));
  }
  const m = /^\/api\/bookings\/([^/]+)\/(cancel|approve|refuse)$/.exec(path);
  if (m && request.method === 'POST') {
    const id = decodeURIComponent(m[1]!);
    if (m[2] === 'cancel') {
      if (!requester) return error(403, 'Só o agente de cargas cancela as próprias solicitações.');
      return cancelRequest(request, env, session, id, now);
    }
    if (!canDecideBookings(session.user)) return error(403, 'Você não aprova nem recusa solicitações de embarque.');
    return m[2] === 'approve' ? approveRequest(request, env, session, id, now) : refuseRequest(request, env, session, id, now);
  }
  return error(404, 'Rota não encontrada.');
}
