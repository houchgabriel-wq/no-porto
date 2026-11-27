// Produção no Brasil (pedido do Gabriel em 27/11/2026; SPEC.md, seção 3): os orçamentos com as gráficas do Brasil,
// as propostas de cada gráfica, o pedido que sai do orçamento fechado e as entregas no estoque, em uma ou mais
// partes. Quem vê: como na importação (admin, editor, Consulta e o leitor, este sem os valores, que o servidor
// tira). Admin e editor lançam. Embarques, Vendas e o Agente de cargas são recusados.

import { z } from 'zod';
import { addDays, deliveryProblem, type BrOrder, type Delivery, type Offer, type Printer, type Quote, type QuoteStatus } from '../core/brazil';
import { isbnDigits, isbnProblem } from '../core/isbn';
import { can } from '../core/roles';
import { spDate } from '../core/shipments';
import type { Session } from './auth';
import type { Env } from './env';
import { checkMutation, error, json, readBody } from './http';

const text = (max: number, label: string) =>
  z
    .string({ error: `${label}: texto inválido.` })
    .max(max, `${label}: no máximo ${max} caracteres.`)
    .transform((s) => s.replace(/\s+/g, ' ').trim());
const longText = (max: number, label: string) =>
  z
    .string({ error: `${label}: texto inválido.` })
    .max(max, `${label}: no máximo ${max} caracteres.`)
    .transform((s) => s.trim());
const title = text(300, 'Produto').pipe(z.string().min(1, 'Informe o produto.'));
const isbn = z
  .string()
  .max(40)
  .nullable()
  .refine((s) => !s || isbnProblem(s) === null, 'ISBN inválido.')
  .transform((s) => (s ? isbnDigits(s) : null));
const quantity = z.number({ error: 'Informe a quantidade.' }).int('Quantidade inválida.').positive('A quantidade precisa ser maior que zero.').max(100_000_000, 'Quantidade grande demais.');
const day = z
  .string({ error: 'Data inválida.' })
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida.')
  .refine((s) => !Number.isNaN(Date.parse(`${s}T00:00:00Z`)), 'Data inválida.');

const quoteBody = z.object({
  title,
  isbn: isbn.default(null),
  quantity,
  specification: longText(2000, 'Especificação').default(''),
  notes: longText(2000, 'Observações').default(''),
});

// Na alteração, só os campos enviados: sem os valores padrão do cadastro, que apagariam o que não veio.
const quotePatch = z
  .object({
    title,
    isbn,
    quantity,
    specification: longText(2000, 'Especificação'),
    notes: longText(2000, 'Observações'),
    status: z.enum(['aberto', 'cancelado'], { error: 'Situação inválida.' }),
  })
  .partial()
  .refine((b) => Object.keys(b).length > 0, 'Nada para alterar.');

const offerBody = z.object({
  printer: text(100, 'Gráfica').pipe(z.string().min(1, 'Informe a gráfica.')),
  quantity,
  unitPriceE4: z.number({ error: 'Informe o preço por exemplar.' }).int('Preço inválido.').positive('Informe o preço por exemplar.').max(100_000_000, 'Preço grande demais.'),
  leadDays: z.number().int('Prazo inválido.').min(0, 'Prazo inválido.').max(365, 'Prazo de no máximo 365 dias.').nullable().default(null),
  notes: longText(2000, 'Observações').default(''),
});

const closeBody = z.object({
  offerId: z.string({ error: 'Escolha a proposta.' }).min(1, 'Escolha a proposta.').max(100),
  orderedAt: day.optional(),
  dueAt: day.nullable().optional(),
});

const orderPatch = z
  .object({ dueAt: day.nullable(), notes: longText(2000, 'Observações') })
  .partial()
  .refine((b) => Object.keys(b).length > 0, 'Nada para alterar.');

const deliveryBody = z.object({
  deliveredAt: day,
  quantity,
  last: z.boolean().default(false),
  notes: longText(2000, 'Observações').default(''),
});

interface QuoteRow {
  id: string;
  title: string;
  isbn: string | null;
  quantity: number;
  specification: string;
  notes: string;
  status: QuoteStatus;
  created_at: string;
  created_by_name: string | null;
  closed_at: string | null;
}
interface OfferRow {
  id: string;
  quote_id: string;
  printer_id: string;
  quantity: number;
  unit_price_e4: number;
  lead_days: number | null;
  notes: string;
}
interface OrderRow {
  id: string;
  quote_id: string | null;
  offer_id: string | null;
  printer_id: string;
  title: string;
  isbn: string | null;
  quantity: number;
  unit_price_e4: number;
  ordered_at: string;
  due_at: string | null;
  specification: string;
  notes: string;
}
interface DeliveryRow {
  id: string;
  order_id: string;
  delivered_at: string;
  quantity: number;
  is_last: number;
  notes: string;
}

const toDelivery = (r: DeliveryRow): Delivery => ({ id: r.id, orderId: r.order_id, deliveredAt: r.delivered_at, quantity: r.quantity, last: r.is_last === 1, notes: r.notes });

async function loadOrder(env: Env, id: string): Promise<(BrOrder & { unitPriceE4: number }) | null> {
  const r = await env.DB.prepare('SELECT * FROM br_orders WHERE id = ?').bind(id).first<OrderRow>();
  if (!r) return null;
  const { results } = await env.DB.prepare('SELECT * FROM br_deliveries WHERE order_id = ? ORDER BY delivered_at, created_at').bind(id).all<DeliveryRow>();
  return {
    id: r.id,
    quoteId: r.quote_id,
    offerId: r.offer_id,
    printerId: r.printer_id,
    title: r.title,
    isbn: r.isbn,
    quantity: r.quantity,
    unitPriceE4: r.unit_price_e4,
    orderedAt: r.ordered_at,
    dueAt: r.due_at,
    specification: r.specification,
    notes: r.notes,
    deliveries: results.map(toDelivery),
  };
}

/** Tudo da sub-aba Brasil; sem os valores para quem não vê valores (o leitor). */
async function getBrazil(env: Env, session: Session, now: Date): Promise<Response> {
  const seeValues = can(session.user.role, 'see_values');
  const [p, q, o, r, d] = await env.DB.batch([
    env.DB.prepare('SELECT id, name, notes FROM printers ORDER BY name COLLATE NOCASE'),
    env.DB.prepare('SELECT q.*, u.name AS created_by_name FROM br_quotes q LEFT JOIN users u ON u.id = q.created_by ORDER BY q.created_at DESC, q.rowid DESC'),
    env.DB.prepare('SELECT * FROM br_offers ORDER BY created_at, rowid'),
    env.DB.prepare('SELECT * FROM br_orders ORDER BY ordered_at DESC, created_at DESC'),
    env.DB.prepare('SELECT * FROM br_deliveries ORDER BY delivered_at, created_at'),
  ]);
  const price = (v: number) => (seeValues ? v : null);
  const offers = new Map<string, Offer[]>();
  for (const row of o!.results as OfferRow[]) {
    const list = offers.get(row.quote_id) ?? [];
    list.push({ id: row.id, quoteId: row.quote_id, printerId: row.printer_id, quantity: row.quantity, unitPriceE4: price(row.unit_price_e4), leadDays: row.lead_days, notes: row.notes });
    offers.set(row.quote_id, list);
  }
  const deliveries = new Map<string, Delivery[]>();
  for (const row of d!.results as DeliveryRow[]) deliveries.set(row.order_id, [...(deliveries.get(row.order_id) ?? []), toDelivery(row)]);
  const orderRows = r!.results as OrderRow[];
  const orderOfQuote = new Map(orderRows.filter((x) => x.quote_id).map((x) => [x.quote_id!, x.id]));
  const quotes: Quote[] = (q!.results as QuoteRow[]).map((row) => ({
    id: row.id,
    title: row.title,
    isbn: row.isbn,
    quantity: row.quantity,
    specification: row.specification,
    notes: row.notes,
    status: row.status,
    createdAt: row.created_at,
    createdBy: row.created_by_name,
    closedAt: row.closed_at,
    offers: offers.get(row.id) ?? [],
    orderId: orderOfQuote.get(row.id) ?? null,
  }));
  const orders: BrOrder[] = orderRows.map((row) => ({
    id: row.id,
    quoteId: row.quote_id,
    offerId: row.offer_id,
    printerId: row.printer_id,
    title: row.title,
    isbn: row.isbn,
    quantity: row.quantity,
    unitPriceE4: price(row.unit_price_e4),
    orderedAt: row.ordered_at,
    dueAt: row.due_at,
    specification: row.specification,
    notes: row.notes,
    deliveries: deliveries.get(row.id) ?? [],
  }));
  return json({ today: spDate(now), seeValues, printers: p!.results as unknown as Printer[], quotes, orders });
}

async function findQuote(env: Env, id: string) {
  return env.DB.prepare('SELECT id, status, quantity FROM br_quotes WHERE id = ?').bind(id).first<{ id: string; status: QuoteStatus; quantity: number }>();
}

async function createQuote(request: Request, env: Env, session: Session, now: Date): Promise<Response> {
  checkMutation(request);
  const body = await readBody(request, quoteBody);
  const id = crypto.randomUUID();
  await env.DB.prepare('INSERT INTO br_quotes (id, title, isbn, quantity, specification, notes, status, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(id, body.title, body.isbn, body.quantity, body.specification, body.notes, 'aberto', now.toISOString(), session.user.id)
    .run();
  return json({ id }, 201);
}

async function updateQuote(request: Request, env: Env, id: string): Promise<Response> {
  checkMutation(request);
  const body = await readBody(request, quotePatch);
  const quote = await findQuote(env, id);
  if (!quote) return error(404, 'Orçamento não encontrado.');
  if (quote.status === 'fechado') return error(409, 'Este orçamento já foi fechado. Para mudar, desfaça o fechamento no pedido.');
  const fields = Object.keys(body).filter((k) => k !== 'status');
  if (quote.status === 'cancelado' && fields.length > 0) return error(409, 'Este orçamento foi cancelado. Reabra para mudar.');
  const cols: Record<string, string> = { title: 'title', isbn: 'isbn', quantity: 'quantity', specification: 'specification', notes: 'notes', status: 'status' };
  const keys = Object.keys(body) as (keyof typeof body)[];
  await env.DB.prepare(`UPDATE br_quotes SET ${keys.map((k) => `${cols[k]} = ?`).join(', ')} WHERE id = ?`)
    .bind(...keys.map((k) => body[k] ?? null), id)
    .run();
  return json({ ok: true });
}

/** A gráfica pelo nome (sem diferença de maiúsculas); a nova é criada nas instruções devolvidas. */
async function printerId(env: Env, name: string, session: Session, now: Date): Promise<{ id: string; statements: D1PreparedStatement[] }> {
  const found = await env.DB.prepare('SELECT id FROM printers WHERE name = ? COLLATE NOCASE').bind(name).first<{ id: string }>();
  if (found) return { id: found.id, statements: [] };
  const id = crypto.randomUUID();
  return { id, statements: [env.DB.prepare('INSERT INTO printers (id, name, notes, created_at, created_by) VALUES (?, ?, ?, ?, ?)').bind(id, name, '', now.toISOString(), session.user.id)] };
}

async function addOffer(request: Request, env: Env, session: Session, quoteId: string, now: Date): Promise<Response> {
  checkMutation(request);
  const body = await readBody(request, offerBody);
  const quote = await findQuote(env, quoteId);
  if (!quote) return error(404, 'Orçamento não encontrado.');
  if (quote.status !== 'aberto') return error(409, 'As propostas só mudam com o orçamento aberto.');
  const printer = await printerId(env, body.printer, session, now);
  const id = crypto.randomUUID();
  await env.DB.batch([
    ...printer.statements,
    env.DB.prepare('INSERT INTO br_offers (id, quote_id, printer_id, quantity, unit_price_e4, lead_days, notes, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(
      id,
      quoteId,
      printer.id,
      body.quantity,
      body.unitPriceE4,
      body.leadDays,
      body.notes,
      now.toISOString(),
      session.user.id,
    ),
  ]);
  return json({ id }, 201);
}

async function offerOfOpenQuote(env: Env, id: string): Promise<{ offer: { id: string; quote_id: string } } | Response> {
  const offer = await env.DB.prepare('SELECT o.id, o.quote_id, q.status FROM br_offers o JOIN br_quotes q ON q.id = o.quote_id WHERE o.id = ?').bind(id).first<{ id: string; quote_id: string; status: QuoteStatus }>();
  if (!offer) return error(404, 'Proposta não encontrada.');
  if (offer.status !== 'aberto') return error(409, 'As propostas só mudam com o orçamento aberto.');
  return { offer };
}

async function updateOffer(request: Request, env: Env, session: Session, id: string, now: Date): Promise<Response> {
  checkMutation(request);
  const body = await readBody(request, offerBody);
  const found = await offerOfOpenQuote(env, id);
  if (found instanceof Response) return found;
  const printer = await printerId(env, body.printer, session, now);
  await env.DB.batch([
    ...printer.statements,
    env.DB.prepare('UPDATE br_offers SET printer_id = ?, quantity = ?, unit_price_e4 = ?, lead_days = ?, notes = ? WHERE id = ?').bind(printer.id, body.quantity, body.unitPriceE4, body.leadDays, body.notes, id),
  ]);
  return json({ ok: true });
}

async function deleteOffer(request: Request, env: Env, id: string): Promise<Response> {
  checkMutation(request);
  const found = await offerOfOpenQuote(env, id);
  if (found instanceof Response) return found;
  await env.DB.prepare('DELETE FROM br_offers WHERE id = ?').bind(id).run();
  return json({ ok: true });
}

/** Fecha o orçamento com uma proposta: ela vira o pedido de produção na gráfica. */
async function closeQuote(request: Request, env: Env, session: Session, quoteId: string, now: Date): Promise<Response> {
  checkMutation(request);
  const body = await readBody(request, closeBody);
  const quote = await env.DB.prepare('SELECT * FROM br_quotes WHERE id = ?').bind(quoteId).first<QuoteRow>();
  if (!quote) return error(404, 'Orçamento não encontrado.');
  if (quote.status !== 'aberto') return error(409, quote.status === 'fechado' ? 'Este orçamento já foi fechado.' : 'Este orçamento foi cancelado. Reabra para fechar.');
  const offer = await env.DB.prepare('SELECT * FROM br_offers WHERE id = ? AND quote_id = ?').bind(body.offerId, quoteId).first<OfferRow>();
  if (!offer) return error(400, 'A proposta não é deste orçamento.');
  const orderedAt = body.orderedAt ?? spDate(now);
  if (orderedAt > spDate(now)) return error(400, 'O fechamento não pode ser num dia que ainda não chegou.');
  const dueAt = body.dueAt !== undefined ? body.dueAt : offer.lead_days !== null ? addDays(orderedAt, offer.lead_days) : null;
  if (dueAt && dueAt < orderedAt) return error(400, 'A entrega prevista não pode ser antes do fechamento.');
  const id = crypto.randomUUID();
  const at = now.toISOString();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO br_orders (id, quote_id, offer_id, printer_id, title, isbn, quantity, unit_price_e4, ordered_at, due_at, specification, notes, created_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(id, quoteId, offer.id, offer.printer_id, quote.title, quote.isbn, offer.quantity, offer.unit_price_e4, orderedAt, dueAt, quote.specification, quote.notes, at, session.user.id),
    env.DB.prepare("UPDATE br_quotes SET status = 'fechado', closed_at = ?, closed_by = ? WHERE id = ?").bind(at, session.user.id, quoteId),
  ]);
  return json({ id }, 201);
}

/** Desfaz o fechamento: o pedido sem entregas sai, e o orçamento volta a ficar aberto. */
async function reopenOrder(request: Request, env: Env, id: string): Promise<Response> {
  checkMutation(request);
  const order = await loadOrder(env, id);
  if (!order) return error(404, 'Pedido não encontrado.');
  if (order.deliveries.length > 0) return error(409, 'O pedido já tem entrega. Para desfazer o fechamento, desfaça antes as entregas.');
  await env.DB.batch([
    env.DB.prepare('DELETE FROM br_orders WHERE id = ?').bind(id),
    ...(order.quoteId ? [env.DB.prepare("UPDATE br_quotes SET status = 'aberto', closed_at = NULL, closed_by = NULL WHERE id = ?").bind(order.quoteId)] : []),
  ]);
  return json({ ok: true });
}

async function updateOrder(request: Request, env: Env, id: string): Promise<Response> {
  checkMutation(request);
  const body = await readBody(request, orderPatch);
  const order = await env.DB.prepare('SELECT id, ordered_at FROM br_orders WHERE id = ?').bind(id).first<{ id: string; ordered_at: string }>();
  if (!order) return error(404, 'Pedido não encontrado.');
  if (body.dueAt && body.dueAt < order.ordered_at) return error(400, 'A entrega prevista não pode ser antes do fechamento.');
  const keys = Object.keys(body) as (keyof typeof body)[];
  const cols = { dueAt: 'due_at', notes: 'notes' } as const;
  await env.DB.prepare(`UPDATE br_orders SET ${keys.map((k) => `${cols[k]} = ?`).join(', ')} WHERE id = ?`)
    .bind(...keys.map((k) => body[k] ?? null), id)
    .run();
  return json({ ok: true });
}

async function addDelivery(request: Request, env: Env, session: Session, orderId: string, now: Date): Promise<Response> {
  checkMutation(request);
  const body = await readBody(request, deliveryBody);
  const order = await loadOrder(env, orderId);
  if (!order) return error(404, 'Pedido não encontrado.');
  const problem = deliveryProblem(order, body, spDate(now));
  if (problem) return error(400, problem);
  const id = crypto.randomUUID();
  await env.DB.prepare('INSERT INTO br_deliveries (id, order_id, delivered_at, quantity, is_last, notes, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(id, orderId, body.deliveredAt, body.quantity, body.last ? 1 : 0, body.notes, now.toISOString(), session.user.id)
    .run();
  return json({ id }, 201);
}

async function deleteDelivery(request: Request, env: Env, id: string): Promise<Response> {
  checkMutation(request);
  const found = await env.DB.prepare('SELECT id FROM br_deliveries WHERE id = ?').bind(id).first();
  if (!found) return error(404, 'Entrega não encontrada.');
  await env.DB.prepare('DELETE FROM br_deliveries WHERE id = ?').bind(id).run();
  return json({ ok: true });
}

export async function routeBrazil(request: Request, env: Env, session: Session, path: string, now: Date): Promise<Response | null> {
  if (path !== '/api/brasil' && !path.startsWith('/api/brasil/')) return null;
  const role = session.user.role;
  // Como a Produção: admin, editor, Consulta e leitor; Embarques, Vendas e o Agente de cargas, não.
  if (!can(role, 'view_all')) return error(403, 'Seu perfil não vê a produção no Brasil.');
  const method = request.method;
  if (path === '/api/brasil') return method === 'GET' ? getBrazil(env, session, now) : error(405, 'Método não permitido.');
  if (!can(role, 'edit')) return error(403, 'Seu perfil só pode acompanhar.');
  let m: RegExpExecArray | null;
  if (path === '/api/brasil/quotes' && method === 'POST') return createQuote(request, env, session, now);
  if ((m = /^\/api\/brasil\/quotes\/([^/]+)$/.exec(path)) && method === 'PATCH') return updateQuote(request, env, decodeURIComponent(m[1]!));
  if ((m = /^\/api\/brasil\/quotes\/([^/]+)\/offers$/.exec(path)) && method === 'POST') return addOffer(request, env, session, decodeURIComponent(m[1]!), now);
  if ((m = /^\/api\/brasil\/quotes\/([^/]+)\/close$/.exec(path)) && method === 'POST') return closeQuote(request, env, session, decodeURIComponent(m[1]!), now);
  if ((m = /^\/api\/brasil\/offers\/([^/]+)$/.exec(path))) {
    if (method === 'PATCH') return updateOffer(request, env, session, decodeURIComponent(m[1]!), now);
    if (method === 'DELETE') return deleteOffer(request, env, decodeURIComponent(m[1]!));
  }
  if ((m = /^\/api\/brasil\/orders\/([^/]+)$/.exec(path)) && method === 'PATCH') return updateOrder(request, env, decodeURIComponent(m[1]!));
  if ((m = /^\/api\/brasil\/orders\/([^/]+)\/reopen$/.exec(path)) && method === 'POST') return reopenOrder(request, env, decodeURIComponent(m[1]!));
  if ((m = /^\/api\/brasil\/orders\/([^/]+)\/deliveries$/.exec(path)) && method === 'POST') return addDelivery(request, env, session, decodeURIComponent(m[1]!), now);
  if ((m = /^\/api\/brasil\/deliveries\/([^/]+)$/.exec(path)) && method === 'DELETE') return deleteDelivery(request, env, decodeURIComponent(m[1]!));
  return error(404, 'Rota não encontrada.');
}
