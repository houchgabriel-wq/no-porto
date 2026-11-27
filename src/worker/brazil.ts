// Produção no Brasil (pedido do Gabriel em 27/11/2026; SPEC.md, seção 3): os orçamentos com as gráficas do Brasil,
// as propostas de cada gráfica (os itens que ela cobra, o papel da gráfica ou o nosso, pela tabela de papéis, e o
// PDF), o pedido que sai do orçamento fechado e as entregas no estoque, em uma ou mais partes. Quem vê: como na
// importação (admin, editor, Consulta e o leitor, este sem os valores, que o servidor tira). Admin e editor lançam.
// Embarques, Vendas e o Agente de cargas são recusados.

import { z } from 'zod';
import {
  addDays,
  deliveryProblem,
  offerCost,
  PAPER_PARTS,
  type BrOrder,
  type BrOrderSummary,
  type Delivery,
  type Offer,
  type OfferItem,
  type OfferPaper,
  type Paper,
  type PaperBy,
  type PaperPart,
  type Printer,
  type Quote,
  type QuoteStatus,
} from '../core/brazil';
import { isbnDigits, isbnProblem, toIsbn13 } from '../core/isbn';
import { can } from '../core/roles';
import { spDate } from '../core/shipments';
import type { Session } from './auth';
import { decodedSize, DOCUMENT_TYPES, fileResponse, MAX_DOCUMENT_BYTES, PART_CHARS } from './billDocuments';
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
const priceE4 = (label: string) => z.number({ error: `Informe ${label}.` }).int(`${label}: valor inválido.`).positive(`Informe ${label}.`).max(100_000_000, `${label}: valor grande demais.`);
const days = (label: string) => z.number().int(`${label} inválido.`).min(0, `${label} inválido.`).max(365, `${label} de no máximo 365 dias.`).nullable().default(null);

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

const offerBody = z
  .object({
    printer: text(100, 'Gráfica').pipe(z.string().min(1, 'Informe a gráfica.')),
    quantity,
    paperBy: z.enum(['grafica', 'editora'], { error: 'Diga se o papel é da gráfica ou nosso.' }),
    items: z
      .array(
        z.object({
          description: text(300, 'Item').pipe(z.string().min(1, 'Informe a descrição de cada item.')),
          quantity,
          unitPriceE4: priceE4('o preço por unidade de cada item'),
        }),
        { error: 'Informe os itens da proposta.' },
      )
      .min(1, 'Informe ao menos um item da proposta.')
      .max(20, 'No máximo 20 itens por proposta.'),
    papers: z
      .array(
        z.object({
          part: z.enum(PAPER_PARTS, { error: 'Parte do papel inválida.' }),
          paper: text(100, 'Papel').pipe(z.string().min(1, 'Informe o papel.')),
          grams: z.number({ error: 'Informe o peso do papel.' }).int('Peso inválido.').positive('Informe o peso do papel.').max(100_000_000, 'Peso grande demais.'),
          pricePerKgE4: priceE4('o preço por kg do papel'),
        }),
      )
      .max(10, 'No máximo 10 papéis por proposta.')
      .default([]),
    leadDays: days('Prazo'),
    proposalNumber: text(40, 'Número da proposta').default(''),
    proposalDate: day.nullable().default(null),
    validDays: days('Validade'),
    paymentTerms: text(100, 'Pagamento').default(''),
    notes: longText(2000, 'Observações').default(''),
  })
  .refine((b) => b.paperBy === 'grafica' || b.papers.length > 0, 'Com o papel nosso, informe o papel: a parte, o papel, o peso e o preço por kg.');

const paperBody = z.object({
  name: text(100, 'Papel').pipe(z.string().min(1, 'Informe o nome do papel.')),
  pricePerKgE4: priceE4('o preço por kg'),
  notes: longText(2000, 'Observações').default(''),
});
const paperPatch = z
  .object({ name: paperBody.shape.name, pricePerKgE4: paperBody.shape.pricePerKgE4, notes: longText(2000, 'Observações') })
  .partial()
  .refine((b) => Object.keys(b).length > 0, 'Nada para alterar.');

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

const documentBody = z.object({
  name: z
    .string()
    .transform((s) => s.replace(/[\\/\u0000-\u001f]+/g, ' ').trim())
    .pipe(z.string().min(1, 'Arquivo sem nome.').max(200, 'Nome de arquivo longo demais.')),
  contentType: z.enum(DOCUMENT_TYPES, { error: 'Envie a proposta em PDF, PNG ou JPG.' }),
  data: z.string().regex(/^[A-Za-z0-9+/]*={0,2}$/, 'Arquivo inválido.'),
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
  paper_by: PaperBy;
  lead_days: number | null;
  proposal_number: string;
  proposal_date: string | null;
  valid_days: number | null;
  payment_terms: string;
  notes: string;
}
interface ItemRow {
  offer_id: string;
  description: string;
  quantity: number;
  unit_price_e4: number;
}
interface PaperLineRow {
  offer_id: string;
  part: PaperPart;
  paper_id: string | null;
  paper_name: string;
  grams: number;
  price_per_kg_e4: number;
}
interface OrderRow {
  id: string;
  quote_id: string | null;
  offer_id: string | null;
  printer_id: string;
  title: string;
  isbn: string | null;
  quantity: number;
  printer_cents: number;
  paper_cents: number;
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

const group = <T extends { offer_id: string }>(rows: T[]) => {
  const map = new Map<string, T[]>();
  for (const r of rows) map.set(r.offer_id, [...(map.get(r.offer_id) ?? []), r]);
  return map;
};

/** A proposta montada, com os itens e o papel; `price` tira os valores para quem não vê. */
function toOffer(row: OfferRow, items: ItemRow[], papers: PaperLineRow[], document: { name: string; size: number } | null, price: (v: number) => number | null): Offer {
  return {
    id: row.id,
    quoteId: row.quote_id,
    printerId: row.printer_id,
    quantity: row.quantity,
    paperBy: row.paper_by,
    items: items.map((i): OfferItem => ({ description: i.description, quantity: i.quantity, unitPriceE4: price(i.unit_price_e4) })),
    papers: papers.map((p): OfferPaper => ({ part: p.part, paperId: p.paper_id, paperName: p.paper_name, grams: p.grams, pricePerKgE4: price(p.price_per_kg_e4) })),
    leadDays: row.lead_days,
    proposalNumber: row.proposal_number,
    proposalDate: row.proposal_date,
    validDays: row.valid_days,
    paymentTerms: row.payment_terms,
    notes: row.notes,
    document,
  };
}

async function loadOrder(env: Env, id: string): Promise<BrOrder | null> {
  const r = await env.DB.prepare('SELECT * FROM br_orders WHERE id = ?').bind(id).first<OrderRow>();
  if (!r) return null;
  const { results } = await env.DB.prepare('SELECT * FROM br_deliveries WHERE order_id = ? ORDER BY delivered_at, created_at').bind(id).all<DeliveryRow>();
  return toOrder(r, results.map(toDelivery), (v) => v);
}

function toOrder(row: OrderRow, deliveries: Delivery[], price: (v: number) => number | null): BrOrder {
  return {
    id: row.id,
    quoteId: row.quote_id,
    offerId: row.offer_id,
    printerId: row.printer_id,
    title: row.title,
    isbn: row.isbn,
    quantity: row.quantity,
    printerCents: price(row.printer_cents),
    paperCents: price(row.paper_cents),
    orderedAt: row.ordered_at,
    dueAt: row.due_at,
    specification: row.specification,
    notes: row.notes,
    deliveries,
  };
}

/** Tudo da sub-aba Brasil; sem os valores (preços, totais, papel e o PDF) para quem não vê valores (o leitor). */
async function getBrazil(env: Env, session: Session, now: Date): Promise<Response> {
  const seeValues = can(session.user.role, 'see_values');
  const price = (v: number) => (seeValues ? v : null);
  const [p, pa, q, o, it, pp, docs, r, d] = await env.DB.batch([
    env.DB.prepare('SELECT id, name, notes FROM printers ORDER BY name COLLATE NOCASE'),
    env.DB.prepare('SELECT id, name, price_per_kg_e4, notes, updated_at FROM papers ORDER BY name COLLATE NOCASE'),
    env.DB.prepare('SELECT q.*, u.name AS created_by_name FROM br_quotes q LEFT JOIN users u ON u.id = q.created_by ORDER BY q.created_at DESC, q.rowid DESC'),
    env.DB.prepare('SELECT * FROM br_offers ORDER BY created_at, rowid'),
    env.DB.prepare('SELECT offer_id, description, quantity, unit_price_e4 FROM br_offer_items ORDER BY offer_id, seq'),
    env.DB.prepare('SELECT offer_id, part, paper_id, paper_name, grams, price_per_kg_e4 FROM br_offer_papers ORDER BY offer_id, seq'),
    env.DB.prepare('SELECT offer_id, name, size FROM br_offer_documents'),
    env.DB.prepare('SELECT * FROM br_orders ORDER BY ordered_at DESC, created_at DESC'),
    env.DB.prepare('SELECT * FROM br_deliveries ORDER BY delivered_at, created_at'),
  ]);
  const items = group(it!.results as unknown as ItemRow[]);
  const paperLines = group(pp!.results as unknown as PaperLineRow[]);
  const documents = new Map((docs!.results as { offer_id: string; name: string; size: number }[]).map((x) => [x.offer_id, { name: x.name, size: x.size }]));
  const offers = new Map<string, Offer[]>();
  for (const row of o!.results as unknown as OfferRow[]) {
    const offer = toOffer(row, items.get(row.id) ?? [], paperLines.get(row.id) ?? [], seeValues ? (documents.get(row.id) ?? null) : null, price);
    offers.set(row.quote_id, [...(offers.get(row.quote_id) ?? []), offer]);
  }
  const deliveries = new Map<string, Delivery[]>();
  for (const row of d!.results as unknown as DeliveryRow[]) deliveries.set(row.order_id, [...(deliveries.get(row.order_id) ?? []), toDelivery(row)]);
  const orderRows = r!.results as unknown as OrderRow[];
  const orderOfQuote = new Map(orderRows.filter((x) => x.quote_id).map((x) => [x.quote_id!, x.id]));
  const quotes: Quote[] = (q!.results as unknown as QuoteRow[]).map((row) => ({
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
  const papers: Paper[] = (pa!.results as { id: string; name: string; price_per_kg_e4: number; notes: string; updated_at: string }[]).map((x) => ({
    id: x.id,
    name: x.name,
    pricePerKgE4: price(x.price_per_kg_e4),
    notes: x.notes,
    updatedAt: x.updated_at,
  }));
  const orders = orderRows.map((row) => toOrder(row, deliveries.get(row.id) ?? [], price));
  return json({ today: spDate(now), seeValues, printers: p!.results as unknown as Printer[], papers, quotes, orders });
}

/**
 * Os pedidos no Brasil só com as quantidades, as datas e o nome da gráfica, do mais antigo para o mais novo: o que o
 * terminal de consulta e a previsão de estoque juntam à importação pelo ISBN (27/11/2026). Nada de valores sai daqui.
 */
export async function readBrazilOrders(env: Env): Promise<BrOrderSummary[]> {
  const [o, d] = await env.DB.batch([
    env.DB.prepare(
      'SELECT o.id, o.isbn, o.title, o.quantity, o.ordered_at, o.due_at, p.name AS printer FROM br_orders o JOIN printers p ON p.id = o.printer_id ORDER BY o.ordered_at, o.created_at, o.rowid',
    ),
    env.DB.prepare('SELECT order_id, delivered_at, quantity, is_last FROM br_deliveries ORDER BY delivered_at, created_at'),
  ]);
  const deliveries = new Map<string, BrOrderSummary['deliveries']>();
  for (const r of d!.results as { order_id: string; delivered_at: string; quantity: number; is_last: number }[]) {
    deliveries.set(r.order_id, [...(deliveries.get(r.order_id) ?? []), { deliveredAt: r.delivered_at, quantity: r.quantity, last: r.is_last === 1 }]);
  }
  return (o!.results as { id: string; isbn: string | null; title: string; quantity: number; ordered_at: string; due_at: string | null; printer: string }[]).map((r) => ({
    id: r.id,
    isbn: r.isbn,
    title: r.title,
    printer: r.printer,
    quantity: r.quantity,
    orderedAt: r.ordered_at,
    dueAt: r.due_at,
    deliveries: deliveries.get(r.id) ?? [],
  }));
}

/** Um pedido no Brasil na ficha do produto: o total (gráfica + papel nosso, em centavos) só para quem vê valores. */
export type ProductBrazilOrder = BrOrderSummary & { totalCents: number | null };

/** Os pedidos no Brasil com o ISBN do produto (o ISBN-10 casa com o ISBN-13), para a ficha do produto. */
export async function brazilOrdersForIsbn(env: Env, isbn: string, seeValues: boolean): Promise<ProductBrazilOrder[]> {
  const key = toIsbn13(isbn);
  const orders = (await readBrazilOrders(env)).filter((o) => o.isbn && toIsbn13(o.isbn) === key);
  if (!orders.length) return [];
  const totals = new Map<string, number>();
  if (seeValues) {
    const { results } = await env.DB.prepare('SELECT id, printer_cents + paper_cents AS total FROM br_orders WHERE isbn IS NOT NULL').all<{ id: string; total: number }>();
    for (const r of results) totals.set(r.id, r.total);
  }
  return orders.map((o) => ({ ...o, totalCents: seeValues ? (totals.get(o.id) ?? null) : null }));
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

type OfferInput = z.infer<typeof offerBody>;

/**
 * As instruções que gravam os itens e o papel da proposta, no lugar dos que havia. O papel é achado na tabela pelo
 * nome; o papel novo entra na tabela com o preço por kg digitado. O preço da proposta fica como digitado (o da
 * tabela vem sugerido na tela, e dá para ajustar).
 */
async function offerLines(env: Env, offerId: string, body: OfferInput, session: Session, now: Date): Promise<D1PreparedStatement[]> {
  const statements: D1PreparedStatement[] = [env.DB.prepare('DELETE FROM br_offer_items WHERE offer_id = ?').bind(offerId), env.DB.prepare('DELETE FROM br_offer_papers WHERE offer_id = ?').bind(offerId)];
  body.items.forEach((item, seq) => {
    statements.push(
      env.DB.prepare('INSERT INTO br_offer_items (id, offer_id, seq, description, quantity, unit_price_e4) VALUES (?, ?, ?, ?, ?, ?)').bind(crypto.randomUUID(), offerId, seq, item.description, item.quantity, item.unitPriceE4),
    );
  });
  if (body.paperBy === 'editora') {
    const created = new Map<string, string>();
    for (const [seq, line] of body.papers.entries()) {
      const key = line.paper.toLowerCase();
      let id = created.get(key) ?? (await env.DB.prepare('SELECT id FROM papers WHERE name = ? COLLATE NOCASE').bind(line.paper).first<{ id: string }>())?.id;
      if (!id) {
        id = crypto.randomUUID();
        created.set(key, id);
        statements.push(env.DB.prepare('INSERT INTO papers (id, name, price_per_kg_e4, notes, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?)').bind(id, line.paper, line.pricePerKgE4, '', now.toISOString(), session.user.id));
      }
      statements.push(
        env.DB.prepare('INSERT INTO br_offer_papers (id, offer_id, seq, part, paper_id, paper_name, grams, price_per_kg_e4) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(
          crypto.randomUUID(),
          offerId,
          seq,
          line.part,
          id,
          line.paper,
          line.grams,
          line.pricePerKgE4,
        ),
      );
    }
  }
  return statements;
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
    env.DB.prepare(
      `INSERT INTO br_offers (id, quote_id, printer_id, quantity, paper_by, lead_days, proposal_number, proposal_date, valid_days, payment_terms, notes, created_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(id, quoteId, printer.id, body.quantity, body.paperBy, body.leadDays, body.proposalNumber, body.proposalDate, body.validDays, body.paymentTerms, body.notes, now.toISOString(), session.user.id),
    ...(await offerLines(env, id, body, session, now)),
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
    env.DB.prepare(
      'UPDATE br_offers SET printer_id = ?, quantity = ?, paper_by = ?, lead_days = ?, proposal_number = ?, proposal_date = ?, valid_days = ?, payment_terms = ?, notes = ? WHERE id = ?',
    ).bind(printer.id, body.quantity, body.paperBy, body.leadDays, body.proposalNumber, body.proposalDate, body.validDays, body.paymentTerms, body.notes, id),
    ...(await offerLines(env, id, body, session, now)),
  ]);
  return json({ ok: true });
}

function removeDocumentStatements(env: Env, offerId: string): D1PreparedStatement[] {
  return [
    env.DB.prepare('DELETE FROM br_offer_document_parts WHERE document_id IN (SELECT id FROM br_offer_documents WHERE offer_id = ?)').bind(offerId),
    env.DB.prepare('DELETE FROM br_offer_documents WHERE offer_id = ?').bind(offerId),
  ];
}

async function deleteOffer(request: Request, env: Env, id: string): Promise<Response> {
  checkMutation(request);
  const found = await offerOfOpenQuote(env, id);
  if (found instanceof Response) return found;
  await env.DB.batch([
    env.DB.prepare('DELETE FROM br_offer_items WHERE offer_id = ?').bind(id),
    env.DB.prepare('DELETE FROM br_offer_papers WHERE offer_id = ?').bind(id),
    ...removeDocumentStatements(env, id),
    env.DB.prepare('DELETE FROM br_offers WHERE id = ?').bind(id),
  ]);
  return json({ ok: true });
}

// ---------- O PDF da proposta ----------

async function putOfferDocument(request: Request, env: Env, session: Session, offerId: string, now: Date): Promise<Response> {
  checkMutation(request);
  const body = await readBody(request, documentBody, Math.ceil((MAX_DOCUMENT_BYTES * 4) / 3) + 10_000);
  if (body.data.length % 4 !== 0 || body.data.length === 0) return error(400, 'Arquivo inválido.');
  const size = decodedSize(body.data);
  if (size > MAX_DOCUMENT_BYTES) return error(413, 'O arquivo da proposta pode ter no máximo 5 MB.');
  const offer = await env.DB.prepare('SELECT id FROM br_offers WHERE id = ?').bind(offerId).first();
  if (!offer) return error(404, 'Proposta não encontrada.');
  const id = crypto.randomUUID();
  const statements: D1PreparedStatement[] = [
    ...removeDocumentStatements(env, offerId),
    env.DB.prepare('INSERT INTO br_offer_documents (id, offer_id, name, content_type, size, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(
      id,
      offerId,
      body.name,
      body.contentType,
      size,
      now.toISOString(),
      session.user.id,
    ),
  ];
  for (let i = 0, seq = 0; i < body.data.length; i += PART_CHARS, seq++) {
    statements.push(env.DB.prepare('INSERT INTO br_offer_document_parts (document_id, seq, data) VALUES (?, ?, ?)').bind(id, seq, body.data.slice(i, i + PART_CHARS)));
  }
  await env.DB.batch(statements);
  return json({ document: { name: body.name, size } }, 201);
}

async function getOfferDocument(env: Env, offerId: string): Promise<Response> {
  const doc = await env.DB.prepare('SELECT id, name, content_type, size FROM br_offer_documents WHERE offer_id = ?').bind(offerId).first<{ id: string; name: string; content_type: string; size: number }>();
  if (!doc) return error(404, 'Esta proposta não tem arquivo.');
  const { results } = await env.DB.prepare('SELECT data FROM br_offer_document_parts WHERE document_id = ? ORDER BY seq').bind(doc.id).all<{ data: string }>();
  return fileResponse(doc, results);
}

async function deleteOfferDocument(request: Request, env: Env, offerId: string): Promise<Response> {
  checkMutation(request);
  const doc = await env.DB.prepare('SELECT id FROM br_offer_documents WHERE offer_id = ?').bind(offerId).first();
  if (!doc) return error(404, 'Esta proposta não tem arquivo.');
  await env.DB.batch(removeDocumentStatements(env, offerId));
  return json({ ok: true });
}

// ---------- A tabela de papéis ----------

async function createPaper(request: Request, env: Env, session: Session, now: Date): Promise<Response> {
  checkMutation(request);
  const body = await readBody(request, paperBody);
  const same = await env.DB.prepare('SELECT id FROM papers WHERE name = ? COLLATE NOCASE').bind(body.name).first();
  if (same) return error(409, `O papel ${body.name} já está na tabela.`);
  const id = crypto.randomUUID();
  await env.DB.prepare('INSERT INTO papers (id, name, price_per_kg_e4, notes, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(id, body.name, body.pricePerKgE4, body.notes, now.toISOString(), session.user.id)
    .run();
  return json({ id }, 201);
}

async function updatePaper(request: Request, env: Env, session: Session, id: string, now: Date): Promise<Response> {
  checkMutation(request);
  const body = await readBody(request, paperPatch);
  const paper = await env.DB.prepare('SELECT id FROM papers WHERE id = ?').bind(id).first();
  if (!paper) return error(404, 'Papel não encontrado.');
  if (body.name) {
    const same = await env.DB.prepare('SELECT id FROM papers WHERE name = ? COLLATE NOCASE AND id <> ?').bind(body.name, id).first();
    if (same) return error(409, `O papel ${body.name} já está na tabela.`);
  }
  const cols = { name: 'name', pricePerKgE4: 'price_per_kg_e4', notes: 'notes' } as const;
  const keys = Object.keys(body) as (keyof typeof body)[];
  // O preço novo vale para as próximas propostas; as que já foram feitas ficam com o preço que usaram.
  await env.DB.prepare(`UPDATE papers SET ${keys.map((k) => `${cols[k]} = ?`).join(', ')}, updated_at = ?, updated_by = ? WHERE id = ?`)
    .bind(...keys.map((k) => body[k] ?? null), now.toISOString(), session.user.id, id)
    .run();
  return json({ ok: true });
}

// ---------- Fechar, pedido e entregas ----------

/** Fecha o orçamento com uma proposta: ela vira o pedido de produção na gráfica, com o custo da gráfica e do papel. */
async function closeQuote(request: Request, env: Env, session: Session, quoteId: string, now: Date): Promise<Response> {
  checkMutation(request);
  const body = await readBody(request, closeBody);
  const quote = await env.DB.prepare('SELECT * FROM br_quotes WHERE id = ?').bind(quoteId).first<QuoteRow>();
  if (!quote) return error(404, 'Orçamento não encontrado.');
  if (quote.status !== 'aberto') return error(409, quote.status === 'fechado' ? 'Este orçamento já foi fechado.' : 'Este orçamento foi cancelado. Reabra para fechar.');
  const row = await env.DB.prepare('SELECT * FROM br_offers WHERE id = ? AND quote_id = ?').bind(body.offerId, quoteId).first<OfferRow>();
  if (!row) return error(400, 'A proposta não é deste orçamento.');
  const [items, papers] = await env.DB.batch([
    env.DB.prepare('SELECT offer_id, description, quantity, unit_price_e4 FROM br_offer_items WHERE offer_id = ? ORDER BY seq').bind(row.id),
    env.DB.prepare('SELECT offer_id, part, paper_id, paper_name, grams, price_per_kg_e4 FROM br_offer_papers WHERE offer_id = ? ORDER BY seq').bind(row.id),
  ]);
  const cost = offerCost(toOffer(row, items!.results as unknown as ItemRow[], papers!.results as unknown as PaperLineRow[], null, (v) => v))!;
  const orderedAt = body.orderedAt ?? spDate(now);
  if (orderedAt > spDate(now)) return error(400, 'O fechamento não pode ser num dia que ainda não chegou.');
  const dueAt = body.dueAt !== undefined ? body.dueAt : row.lead_days !== null ? addDays(orderedAt, row.lead_days) : null;
  if (dueAt && dueAt < orderedAt) return error(400, 'A entrega prevista não pode ser antes do fechamento.');
  const id = crypto.randomUUID();
  const at = now.toISOString();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO br_orders (id, quote_id, offer_id, printer_id, title, isbn, quantity, printer_cents, paper_cents, ordered_at, due_at, specification, notes, created_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(id, quoteId, row.id, row.printer_id, quote.title, quote.isbn, row.quantity, cost.printerCents, cost.paperCents, orderedAt, dueAt, quote.specification, quote.notes, at, session.user.id),
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
  let m: RegExpExecArray | null;
  if ((m = /^\/api\/brasil\/offers\/([^/]+)\/document$/.exec(path)) && method === 'GET') {
    // A proposta traz os preços: baixa quem vê valores, como os arquivos do embarque.
    if (!can(role, 'see_values')) return error(403, 'Seu perfil não baixa as propostas das gráficas.');
    return getOfferDocument(env, decodeURIComponent(m[1]!));
  }
  if (!can(role, 'edit')) return error(403, 'Seu perfil só pode acompanhar.');
  if (path === '/api/brasil/quotes' && method === 'POST') return createQuote(request, env, session, now);
  if (path === '/api/brasil/papers' && method === 'POST') return createPaper(request, env, session, now);
  if ((m = /^\/api\/brasil\/papers\/([^/]+)$/.exec(path)) && method === 'PATCH') return updatePaper(request, env, session, decodeURIComponent(m[1]!), now);
  if ((m = /^\/api\/brasil\/quotes\/([^/]+)$/.exec(path)) && method === 'PATCH') return updateQuote(request, env, decodeURIComponent(m[1]!));
  if ((m = /^\/api\/brasil\/quotes\/([^/]+)\/offers$/.exec(path)) && method === 'POST') return addOffer(request, env, session, decodeURIComponent(m[1]!), now);
  if ((m = /^\/api\/brasil\/quotes\/([^/]+)\/close$/.exec(path)) && method === 'POST') return closeQuote(request, env, session, decodeURIComponent(m[1]!), now);
  if ((m = /^\/api\/brasil\/offers\/([^/]+)$/.exec(path))) {
    if (method === 'PATCH') return updateOffer(request, env, session, decodeURIComponent(m[1]!), now);
    if (method === 'DELETE') return deleteOffer(request, env, decodeURIComponent(m[1]!));
  }
  if ((m = /^\/api\/brasil\/offers\/([^/]+)\/document$/.exec(path))) {
    if (method === 'PUT') return putOfferDocument(request, env, session, decodeURIComponent(m[1]!), now);
    if (method === 'DELETE') return deleteOfferDocument(request, env, decodeURIComponent(m[1]!));
  }
  if ((m = /^\/api\/brasil\/orders\/([^/]+)$/.exec(path)) && method === 'PATCH') return updateOrder(request, env, decodeURIComponent(m[1]!));
  if ((m = /^\/api\/brasil\/orders\/([^/]+)\/reopen$/.exec(path)) && method === 'POST') return reopenOrder(request, env, decodeURIComponent(m[1]!));
  if ((m = /^\/api\/brasil\/orders\/([^/]+)\/deliveries$/.exec(path)) && method === 'POST') return addDelivery(request, env, session, decodeURIComponent(m[1]!), now);
  if ((m = /^\/api\/brasil\/deliveries\/([^/]+)$/.exec(path)) && method === 'DELETE') return deleteDelivery(request, env, decodeURIComponent(m[1]!));
  return error(404, 'Rota não encontrada.');
}
