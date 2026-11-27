// Rotas de embarque (SPEC.md, seções 3 a 7): embarcar itens da produção (inteiros ou em parte),
// desfazer, alterar BL e invoice (chegada prevista e chegada real), pagamentos e a carga da aba
// Embarques. Toda rota confere o perfil.

import { z } from 'zod';
import { allocateInvoices } from '../core/allocation';
import { itemOrigin, planShipmentUndo, type ItemEvent } from '../core/undoShipment';
import { cleanSpecification, SPECIFICATION_MAX } from '../core/specification';
import { IMPORT_BATCH, newImportItems } from '../core/importProduction';
import { invoiceKey, shipmentKey } from '../core/importShipments';
import { isbnDigits, isbnProblem } from '../core/isbn';
import { curveTitleFor, curveTitles } from '../core/curveNames';
import { titleKey } from '../core/items';
import { isValidUnitPrice } from '../core/money';
import { can } from '../core/roles';
import { itemStatusFor, shipProblem } from '../core/shipments';
import type { Item, ItemStatus } from '../core/items';
import type { Session } from './auth';
import type { Env } from './env';
import { checkMutation, error, HttpError, json, readBody } from './http';
import { eventStatement, findItem, insertItem, itemDay, ITEM_SELECT, loadRefs, shipPlanSchema, toItem, type ItemRow } from './orders';
import { deleteInvoiceDocumentsStatements, DOCUMENT_BODY_BYTES, documentContent, removeInvoiceDocumentStatements, storeInvoiceDocument } from './invoiceDocuments';
import { deleteBillFiscalStatements, deleteInvoiceFiscalStatements } from './fiscalDocuments';
import { readCurve } from './stock';
import { mergePlans, readStoredPlan, shipPlanProblem, takeFromPlan, type ShipPlan } from '../core/shipPlan';

// ---------- Esquemas de entrada ----------

const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida.')
  .refine((s) => !Number.isNaN(Date.parse(`${s}T00:00:00Z`)), 'Data inválida.')
  .nullable();
const text = (max: number, label: string) =>
  z
    .string()
    .max(max, `${label}: no máximo ${max} caracteres.`)
    .transform((s) => s.replace(/\s+/g, ' ').trim());
const invoiceNumber = text(60, 'Número da invoice').pipe(z.string().min(1, 'Informe o número da invoice.'));
const billNumber = text(40, 'Número do BL')
  .nullable()
  .transform((s) => s || null);

const shipBody = z
  .object({
    lines: z
      .array(z.object({ itemId: z.string().max(100), quantity: z.number().int() }))
      .min(1, 'Escolha os itens para embarcar.')
      .max(IMPORT_BATCH, `Embarque no máximo ${IMPORT_BATCH} itens por vez.`),
    invoiceId: z.string().max(100).optional(),
    newInvoice: z.object({ number: invoiceNumber, ref: text(60, 'Ref.').default(''), bill: billNumber.default(null), eta: day.default(null) }).optional(),
  })
  .refine((b) => Boolean(b.invoiceId) !== Boolean(b.newInvoice), 'Escolha uma invoice ou informe uma nova.');

const billBody = z
  .object({ number: text(40, 'Número do BL').pipe(z.string().min(1, 'Informe o número do BL.')), eta: day, arrivedAt: day, notes: z.string().max(2000).transform((s) => s.trim()) })
  .partial()
  .refine((b) => Object.keys(b).length > 0, 'Nada para alterar.');

const invoiceBody = z
  .object({ number: invoiceNumber, ref: text(60, 'Ref.'), bill: billNumber, eta: day, arrivedAt: day, notes: z.string().max(2000).transform((s) => s.trim()) })
  .partial()
  .refine((b) => Object.keys(b).length > 0, 'Nada para alterar.');

const paymentBody = z.object({
  paidAt: day.default(null),
  amountCents: z.number().int('Valor inválido.').positive('O valor precisa ser maior que zero.').max(100_000_000_000, 'Valor grande demais.').nullable(),
  exchangeRateE4: z.number().int('Câmbio inválido.').positive('O câmbio precisa ser maior que zero.').max(10_000_000, 'Câmbio grande demais.').nullable().default(null),
  notes: z.string().max(2000).transform((s) => s.trim()).default(''),
});

const isbn = z
  .string()
  .max(40)
  .nullable()
  .refine((s) => !s || isbnProblem(s) === null, 'ISBN inválido.')
  .transform((s) => (s ? isbnDigits(s) : null));

const receiveLine = z.object({
  row: z.number().int().min(1),
  description: text(300, 'Produto').pipe(z.string().min(1, 'Informe o produto.')),
  isbn,
  quantity: z.number().int().positive('A quantidade precisa ser maior que zero.').max(100_000_000),
  piecesPerCarton: z.number().int().positive().max(1_000_000).nullable().default(null),
  unitPriceMicros: z.number().int().min(0).max(1_000_000_000).refine(isValidUnitPrice, 'O preço unitário tem no máximo três casas decimais.').nullable(),
  orderCode: z.string().max(20).nullable().default(null),
  /** O nome escrito na prévia do Novo embarque (27/11/2026): vale no lugar do da curva ABC e do da invoice. */
  title: text(300, 'Nome do produto').pipe(z.string().min(1, 'Informe o nome do produto.')).nullable().default(null),
});

/** A unidade do BL (o container) de uma invoice: lida do PDF do BL e ligada pela packing list (25/11/2026). */
const unitSchema = z.object({
  container: z
    .string({ error: 'Informe o número do container.' })
    .max(30, 'Número do container inválido.')
    .transform((s) => s.replace(/\s+/g, '').toUpperCase())
    .pipe(z.string().min(4, 'Informe o número do container.').max(20, 'Número do container inválido.')),
  seal: text(30, 'Lacre').default(''),
  kind: text(20, 'Tipo do container').default(''),
  cartons: z.number().int('Caixas inválidas.').min(0, 'Caixas inválidas.').max(1_000_000, 'Caixas inválidas.').nullable().default(null),
  weightGrams: z.number().int('Peso inválido.').min(0, 'Peso inválido.').max(1_000_000_000, 'Peso inválido.').nullable().default(null),
  volumeLiters: z.number().int('Cubagem inválida.').min(0, 'Cubagem inválida.').max(10_000_000, 'Cubagem inválida.').nullable().default(null),
});

/** Novo embarque: um BL (ou nenhum, por enquanto) com um ou mais containers, cada um com a sua invoice. */
const receiveBody = z
  .object({
    bill: billNumber.default(null),
    eta: day.default(null),
    invoices: z
      .array(
        z.object({
          supplierId: z.string().min(1, 'Escolha o fornecedor de cada container.').max(100),
          number: invoiceNumber,
          ref: text(60, 'Ref.').default(''),
          container: text(20, 'Container').default(''),
          unit: unitSchema.nullable().default(null),
          /** O arquivo da packing list do container (26/11/2026); vazio sem packing list. */
          packingList: text(200, 'Arquivo da packing list').default(''),
          lines: z.array(receiveLine).min(1, 'Um dos containers não tem itens.'),
        }),
      )
      .min(1, 'Informe ao menos um container.')
      .max(30, 'No máximo 30 containers por vez.'),
  })
  .refine((b) => b.invoices.reduce((n, v) => n + v.lines.length, 0) <= IMPORT_BATCH, `No máximo ${IMPORT_BATCH} linhas por embarque.`);

const arrivalBody = z.object({
  invoiceIds: z.array(z.string().max(100)).min(1, 'Escolha as invoices que chegaram.').max(200, 'Escolha no máximo 200 invoices por vez.'),
  arrivedAt: day.refine((d) => d !== null, 'Informe o dia da chegada.'),
});

const importBody = z.object({
  items: z
    .array(
      z.object({
        row: z.number().int().min(1),
        description: text(300, 'Produto').pipe(z.string().min(1, 'Informe o produto.')),
        isbn,
        supplier: text(100, 'Fornecedor')
          .nullable()
          .transform((s) => s || null),
        quantity: z.number().int().positive().max(100_000_000),
        piecesPerCarton: z.number().int().positive().max(1_000_000).nullable(),
        unitPriceMicros: z.number().int().min(0).max(1_000_000_000).refine(isValidUnitPrice, 'O preço unitário tem no máximo três casas decimais.').nullable(),
        notes: z.string().max(2000),
        specification: z.string().max(SPECIFICATION_MAX + 2000).transform(cleanSpecification).default(''),
        fileApprovedAt: itemDay('Aprovação do arquivo').default(null),
        shipPlan: shipPlanSchema.default([]),
        invoice: invoiceNumber,
        ref: text(60, 'Ref.'),
        bill: billNumber,
        eta: day,
        paid: z.boolean(),
      }),
    )
    .min(1, 'A planilha não tem itens.')
    .max(IMPORT_BATCH, `Envie no máximo ${IMPORT_BATCH} itens por vez.`),
});

// ---------- Banco ----------

interface InvoiceRow {
  id: string;
  number: string;
  ref: string;
  supplier_id: string | null;
  bill_of_lading_id: string | null;
  eta: string | null;
  arrived_at: string | null;
}

interface BillRow {
  id: string;
  number: string;
  eta: string | null;
  arrived_at: string | null;
}

/** Chegada real que vale para a invoice: a dela, quando registrada; senão, a do BL. */
async function invoiceArrival(env: Env, invoice: InvoiceRow): Promise<string | null> {
  if (invoice.arrived_at || !invoice.bill_of_lading_id) return invoice.arrived_at;
  const bill = await env.DB.prepare('SELECT arrived_at FROM bills_of_lading WHERE id = ?').bind(invoice.bill_of_lading_id).first<{ arrived_at: string | null }>();
  return bill?.arrived_at ?? null;
}

/** Atualiza a situação (embarcado ou entregue) dos itens das invoices indicadas. */
function itemsStatusStatement(env: Env, invoiceIds: string, arrivedAt: string | null, at: string, userId: string): D1PreparedStatement {
  return env.DB.prepare(
    `UPDATE order_items SET status = ?, updated_at = ?, updated_by = ?
      WHERE deleted_at IS NULL AND invoice_id IN (SELECT value FROM json_each(?))`,
  ).bind(arrivedAt ? 'entregue' : 'embarcado', at, userId, invoiceIds);
}

/** BLs pelo número, em memória; os novos são criados pelas instruções em `statements`. */
async function loadBills(env: Env, at: string, statements: D1PreparedStatement[]) {
  const { results } = await env.DB.prepare('SELECT id, number, eta, arrived_at FROM bills_of_lading').all<BillRow>();
  const byNumber = new Map(results.map((r) => [r.number.toUpperCase(), r]));
  return {
    get(number: string): BillRow | undefined {
      return byNumber.get(number.toUpperCase());
    },
    /** Acha ou cria o BL; um BL novo recebe a chegada prevista informada. */
    resolve(number: string, eta: string | null, supplierId: string | null): BillRow {
      let bill = byNumber.get(number.toUpperCase());
      if (!bill) {
        bill = { id: crypto.randomUUID(), number, eta, arrived_at: null };
        byNumber.set(number.toUpperCase(), bill);
        statements.push(
          env.DB.prepare('INSERT INTO bills_of_lading (id, number, supplier_id, eta, created_at) VALUES (?, ?, ?, ?, ?)').bind(bill.id, number, supplierId, eta, at),
        );
      } else if (!bill.eta && eta) {
        bill.eta = eta;
        statements.push(env.DB.prepare('UPDATE bills_of_lading SET eta = ? WHERE id = ?').bind(eta, bill.id));
      }
      return bill;
    },
  };
}

/**
 * Instruções que levam o item (inteiro ou em parte) para a invoice. Em parte, o item fica com o saldo
 * em produção e a parte embarcada vira um item novo. `override` troca o preço (o da invoice do
 * fornecedor) e as peças por caixa (as da packing list) da parte embarcada; null mantém os do item.
 */
function shipItemStatements(
  env: Env,
  item: Item,
  quantity: number,
  invoice: { id: string; number: string },
  status: ItemStatus,
  override: { priceMicros: number | null; piecesPerCarton: number | null; description?: string | null },
  userId: string,
  at: string,
): D1PreparedStatement[] {
  const price = override.priceMicros ?? item.unitPriceMicros ?? null;
  const pieces = override.piecesPerCarton ?? item.piecesPerCarton;
  // O nome escolhido no Novo embarque, o escrito na prévia ou o da curva ABC (27/11/2026); sem ele, fica o do item.
  const description = override.description || item.description;
  if (quantity === item.quantity) {
    return [
      env.DB.prepare(
        'UPDATE order_items SET invoice_id = ?, status = ?, unit_price_micros = ?, pieces_per_carton = ?, description = ?, updated_at = ?, updated_by = ? WHERE id = ?',
      ).bind(invoice.id, status, price, pieces, description, at, userId, item.id),
      // O preço, as peças e o nome de antes ficam no histórico, para voltar a eles se o embarque for excluído.
      eventStatement(
        env,
        item.id,
        userId,
        'shipped',
        {
          invoice: invoice.number,
          quantity,
          previousPriceMicros: item.unitPriceMicros ?? null,
          previousPieces: item.piecesPerCarton,
          ...(description !== item.description ? { previousDescription: item.description } : {}),
        },
        at,
      ),
    ];
  }
  const id = crypto.randomUUID();
  // Da programação de envio, a parte embarcada leva o que estava programado para antes; o saldo fica com o resto.
  const plan = takeFromPlan(item.shipPlan ?? [], quantity);
  return [
    env.DB.prepare('UPDATE order_items SET quantity = ?, ship_plan = ?, updated_at = ?, updated_by = ? WHERE id = ?').bind(item.quantity - quantity, JSON.stringify(plan.left), at, userId, item.id),
    insertItem(
      env,
      id,
      // A parte embarcada leva também a data de aprovação do arquivo.
      { description, quantity, piecesPerCarton: pieces, unitPriceMicros: price, notes: item.notes, fileApprovedAt: item.fileApprovedAt ?? null, fileApprovedFrom: item.fileApprovedFrom ?? null, shipPlan: plan.taken },
      { productId: item.productId, supplierId: item.supplierId, orderId: item.purchaseOrderId, invoiceId: invoice.id, status },
      userId,
      at,
    ),
    // A parte embarcada leva a especificação do item.
    env.DB.prepare('UPDATE order_items SET specification = (SELECT specification FROM order_items WHERE id = ?) WHERE id = ?').bind(item.id, id),
    eventStatement(env, item.id, userId, 'split', { invoice: invoice.number, shipped: quantity, left: item.quantity - quantity, newItem: id }, at),
    eventStatement(env, id, userId, 'shipped', { invoice: invoice.number, quantity, splitFrom: item.id }, at),
  ];
}

// ---------- Embarcar e desfazer ----------

async function ship(request: Request, env: Env, session: Session, now: Date): Promise<Response> {
  checkMutation(request);
  const body = await readBody(request, shipBody);
  const at = now.toISOString();
  const userId = session.user.id;
  const ids = JSON.stringify(body.lines.map((l) => l.itemId));
  const { results } = await env.DB.prepare(`${ITEM_SELECT} WHERE i.deleted_at IS NULL AND i.id IN (SELECT value FROM json_each(?))`).bind(ids).all<ItemRow>();
  const items = new Map(results.map((r) => [r.id, toItem(r)]));
  const missing = body.lines.find((l) => !items.has(l.itemId));
  if (missing) return error(404, 'Um dos itens não foi encontrado. Atualize a página e tente de novo.');
  const lines = body.lines.map((l) => ({ item: items.get(l.itemId)!, quantity: l.quantity }));

  const statements: D1PreparedStatement[] = [];
  let invoice: InvoiceRow;
  let arrivedAt: string | null;
  if (body.invoiceId) {
    const found = await env.DB.prepare('SELECT id, number, ref, supplier_id, bill_of_lading_id, eta, arrived_at FROM invoices WHERE id = ?').bind(body.invoiceId).first<InvoiceRow>();
    if (!found) return error(404, 'Invoice não encontrada.');
    invoice = found;
    arrivedAt = await invoiceArrival(env, invoice);
    if (arrivedAt) return error(409, `A invoice ${invoice.number} já chegou. Embarque numa invoice que ainda está a caminho.`);
  } else {
    const n = body.newInvoice!;
    const supplierId = lines[0]?.item.supplierId ?? null;
    const same = await env.DB.prepare('SELECT number FROM invoices WHERE number = ? COLLATE NOCASE AND supplier_id IS ?').bind(n.number, supplierId).first<{ number: string }>();
    if (same) return error(409, `A invoice ${same.number} já existe. Escolha-a na lista em vez de criar outra.`);
    let billId: string | null = null;
    arrivedAt = null;
    if (n.bill) {
      const bills = await loadBills(env, at, statements);
      const bill = bills.resolve(n.bill, n.eta, supplierId);
      if (bill.arrived_at) return error(409, `O BL ${bill.number} já chegou. Use outro BL.`);
      billId = bill.id;
    }
    invoice = { id: crypto.randomUUID(), number: n.number, ref: n.ref, supplier_id: supplierId, bill_of_lading_id: billId, eta: billId ? null : n.eta, arrived_at: null };
    statements.push(
      env.DB.prepare('INSERT INTO invoices (id, number, ref, supplier_id, bill_of_lading_id, eta, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(
        invoice.id,
        invoice.number,
        invoice.ref,
        invoice.supplier_id,
        invoice.bill_of_lading_id,
        invoice.eta,
        at,
      ),
    );
  }
  const problem = shipProblem(lines, body.invoiceId ? invoice.supplier_id : null);
  if (problem) return error(400, problem);

  const status = itemStatusFor(invoice.id, arrivedAt);
  for (const { item, quantity } of lines) statements.push(...shipItemStatements(env, item, quantity, { id: invoice.id, number: invoice.number }, status, { priceMicros: null, piecesPerCarton: null }, userId, at));
  await env.DB.batch(statements);
  return json({ invoiceId: invoice.id, shipped: lines.length }, 201);
}

async function unship(request: Request, env: Env, session: Session, id: string, now: Date): Promise<Response> {
  checkMutation(request);
  const item = await findItem(env, id);
  if (!item) return error(404, 'Item não encontrado.');
  if (item.status === 'producao') return error(409, 'Este item não está embarcado.');
  if (item.status === 'entregue') return error(409, 'Este item já chegou. Para voltar, desmarque a chegada do embarque.');
  const at = now.toISOString();
  await env.DB.batch([
    env.DB.prepare("UPDATE order_items SET invoice_id = NULL, status = 'producao', updated_at = ?, updated_by = ? WHERE id = ?").bind(at, session.user.id, id),
    eventStatement(env, id, session.user.id, 'unshipped', {}, at),
  ]);
  return json({ ok: true });
}

// ---------- BL e invoice ----------

async function updateBill(request: Request, env: Env, session: Session, id: string, now: Date): Promise<Response> {
  checkMutation(request);
  const body = await readBody(request, billBody);
  const bill = await env.DB.prepare('SELECT id, number, eta, arrived_at FROM bills_of_lading WHERE id = ?').bind(id).first<BillRow>();
  if (!bill) return error(404, 'BL não encontrado.');
  if (body.number && body.number.toUpperCase() !== bill.number.toUpperCase()) {
    const other = await env.DB.prepare('SELECT id FROM bills_of_lading WHERE number = ? COLLATE NOCASE AND id <> ?').bind(body.number, id).first();
    if (other) return error(409, `Já existe o BL ${body.number}.`);
  }
  const at = now.toISOString();
  const next = { number: body.number ?? bill.number, eta: body.eta === undefined ? bill.eta : body.eta, arrivedAt: body.arrivedAt === undefined ? bill.arrived_at : body.arrivedAt };
  const statements: D1PreparedStatement[] = [
    env.DB.prepare('UPDATE bills_of_lading SET number = ?, eta = ?, arrived_at = ?, notes = COALESCE(?, notes) WHERE id = ?').bind(next.number, next.eta, next.arrivedAt, body.notes ?? null, id),
  ];
  if (next.arrivedAt !== bill.arrived_at) {
    // Chegou (ou deixou de ter chegado): os itens de todas as invoices do BL acompanham.
    // As invoices com chegada própria (containers que chegaram em outro dia) não mudam.
    const { results } = await env.DB.prepare('SELECT id FROM invoices WHERE bill_of_lading_id = ? AND arrived_at IS NULL').bind(id).all<{ id: string }>();
    statements.push(itemsStatusStatement(env, JSON.stringify(results.map((r) => r.id)), next.arrivedAt, at, session.user.id));
  }
  await env.DB.batch(statements);
  return json({ ok: true });
}

async function updateInvoice(request: Request, env: Env, session: Session, id: string, now: Date): Promise<Response> {
  checkMutation(request);
  const body = await readBody(request, invoiceBody);
  const invoice = await env.DB.prepare('SELECT id, number, ref, supplier_id, bill_of_lading_id, eta, arrived_at FROM invoices WHERE id = ?').bind(id).first<InvoiceRow>();
  if (!invoice) return error(404, 'Invoice não encontrada.');
  const at = now.toISOString();
  const statements: D1PreparedStatement[] = [];
  const before = await invoiceArrival(env, invoice);

  let billId = invoice.bill_of_lading_id;
  let billArrived: string | null = null;
  if (body.bill !== undefined) {
    if (body.bill === null) billId = null;
    else {
      const bills = await loadBills(env, at, statements);
      const bill = bills.resolve(body.bill, body.eta ?? invoice.eta, invoice.supplier_id);
      billId = bill.id;
      billArrived = bill.arrived_at;
    }
  } else if (billId) {
    billArrived = (await env.DB.prepare('SELECT arrived_at FROM bills_of_lading WHERE id = ?').bind(billId).first<{ arrived_at: string | null }>())?.arrived_at ?? null;
  }
  // A chegada é de cada container (27/11/2026). O BL com a chegada gravada nele (o jeito de antes) passa o dia para
  // os containers sem chegada própria antes de este mudar: cada um segue com o seu dia, e o BL fica sem.
  if (body.arrivedAt !== undefined && billId && billArrived) {
    statements.push(
      env.DB.prepare('UPDATE invoices SET arrived_at = ? WHERE bill_of_lading_id = ? AND arrived_at IS NULL AND id <> ?').bind(billArrived, billId, id),
      env.DB.prepare('UPDATE bills_of_lading SET arrived_at = NULL WHERE id = ?').bind(billId),
    );
    billArrived = null;
  }
  const next = {
    number: body.number ?? invoice.number,
    ref: body.ref ?? invoice.ref,
    eta: body.eta === undefined ? invoice.eta : body.eta,
    arrivedAt: body.arrivedAt === undefined ? invoice.arrived_at : body.arrivedAt,
  };
  if (next.number.toUpperCase() !== invoice.number.toUpperCase()) {
    const other = await env.DB.prepare('SELECT id FROM invoices WHERE number = ? COLLATE NOCASE AND supplier_id IS ? AND id <> ?').bind(next.number, invoice.supplier_id, id).first();
    if (other) return error(409, `Já existe a invoice ${next.number} deste fornecedor.`);
  }
  statements.push(
    env.DB.prepare('UPDATE invoices SET number = ?, ref = ?, bill_of_lading_id = ?, eta = ?, arrived_at = ?, notes = COALESCE(?, notes) WHERE id = ?').bind(
      next.number,
      next.ref,
      billId,
      next.eta,
      next.arrivedAt,
      body.notes ?? null,
      id,
    ),
  );
  const after = next.arrivedAt ?? (billId ? billArrived : null);
  if (after !== before) statements.push(itemsStatusStatement(env, JSON.stringify([id]), after, at, session.user.id));
  await env.DB.batch(statements);
  return json({ ok: true });
}

// ---------- Pagamentos ----------

async function addPayment(request: Request, env: Env, session: Session, invoiceId: string, now: Date): Promise<Response> {
  checkMutation(request);
  const body = await readBody(request, paymentBody);
  const invoice = await env.DB.prepare('SELECT id FROM invoices WHERE id = ?').bind(invoiceId).first();
  if (!invoice) return error(404, 'Invoice não encontrada.');
  if (body.amountCents === null) throw new HttpError(400, 'Informe o valor pago.');
  const id = crypto.randomUUID();
  await env.DB.prepare(
    'INSERT INTO payments (id, invoice_id, paid_at, amount_cents, exchange_rate_e4, notes, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  )
    .bind(id, invoiceId, body.paidAt, body.amountCents, body.exchangeRateE4, body.notes, now.toISOString(), session.user.id)
    .run();
  return json({ id }, 201);
}

async function deletePayment(request: Request, env: Env, id: string): Promise<Response> {
  checkMutation(request);
  const result = await env.DB.prepare('DELETE FROM payments WHERE id = ?').bind(id).run();
  if (!result.meta.changes) return error(404, 'Pagamento não encontrado.');
  return json({ ok: true });
}

// ---------- Novo embarque pela invoice do fornecedor ----------

/**
 * Novo embarque (SPEC.md, seção 3): um BL com um ou mais containers, cada um com a invoice e a
 * packing list já juntadas no navegador. O que cada invoice traz sai da produção do mesmo fornecedor,
 * a mais antiga primeiro; os containers de um mesmo fornecedor consomem a produção em sequência. O que
 * não estava na produção entra embarcado assim mesmo, sem PO, com uma observação para conferir.
 */
async function receiveShipment(request: Request, env: Env, session: Session, now: Date): Promise<Response> {
  checkMutation(request);
  const body = await readBody(request, receiveBody);
  const at = now.toISOString();
  const userId = session.user.id;
  const supplierIds = [...new Set(body.invoices.map((v) => v.supplierId))];
  const [found, existing] = await env.DB.batch([
    env.DB.prepare('SELECT id, name FROM suppliers WHERE id IN (SELECT value FROM json_each(?))').bind(JSON.stringify(supplierIds)),
    env.DB.prepare('SELECT number, supplier_id FROM invoices WHERE supplier_id IN (SELECT value FROM json_each(?))').bind(JSON.stringify(supplierIds)),
  ]);
  const names = new Map((found!.results as { id: string; name: string }[]).map((r) => [r.id, r.name]));
  if (names.size !== supplierIds.length) return error(404, 'Fornecedor não encontrado.');
  // A mesma invoice do mesmo fornecedor não entra duas vezes (nem repetida no mesmo envio).
  const taken = new Set((existing!.results as { number: string; supplier_id: string }[]).map((r) => `${r.supplier_id}|${r.number.toUpperCase()}`));
  for (const v of body.invoices) {
    const key = `${v.supplierId}|${v.number.toUpperCase()}`;
    if (taken.has(key)) return error(409, `A invoice ${v.number} da ${names.get(v.supplierId)} já foi registrada.`);
    taken.add(key);
  }

  const statements: D1PreparedStatement[] = [];
  let billId: string | null = null;
  if (body.bill) {
    const bill = (await loadBills(env, at, statements)).resolve(body.bill, body.eta, body.invoices[0]!.supplierId);
    if (bill.arrived_at) return error(409, `O BL ${bill.number} já chegou. Confira o número do BL.`);
    billId = bill.id;
  }
  const invoices = body.invoices.map((v) => ({ id: crypto.randomUUID(), number: v.number }));
  body.invoices.forEach((v, i) => {
    statements.push(
      env.DB.prepare(
        `INSERT INTO invoices (id, number, ref, supplier_id, bill_of_lading_id, eta, notes, created_at,
                               container, container_seal, container_kind, container_cartons, container_weight_grams, container_volume_liters,
                               packing_list_name, packing_list_at, packing_list_by)
         VALUES (?, ?, ?, ?, ?, ?, '', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        invoices[i]!.id,
        v.number,
        v.ref,
        v.supplierId,
        billId,
        billId ? null : body.eta,
        at,
        // O container passa a ter campo próprio (antes ia para as observações).
        v.unit?.container ?? v.container.replace(/\s+/g, '').toUpperCase(),
        v.unit?.seal ?? '',
        v.unit?.kind ?? '',
        v.unit?.cartons ?? null,
        v.unit?.weightGrams ?? null,
        v.unit?.volumeLiters ?? null,
        v.packingList,
        v.packingList ? at : null,
        v.packingList ? session.user.id : null,
      ),
    );
  });

  const [rows, orderRows] = await env.DB.batch([
    env.DB.prepare(
      `${ITEM_SELECT} WHERE i.deleted_at IS NULL AND i.status = 'producao' AND i.supplier_id IN (SELECT value FROM json_each(?)) ORDER BY i.created_at, i.rowid`,
    ).bind(JSON.stringify(supplierIds)),
    env.DB.prepare('SELECT id, code FROM purchase_orders'),
  ]);
  const production = (rows!.results as ItemRow[]).map(toItem);
  const byId = new Map(production.map((i) => [i.id, i]));
  const allocation = allocateInvoices(body.invoices, production, orderRows!.results as { id: string; code: string }[]);

  const refs = await loadRefs(env, at);
  // O nome de cada produto (27/11/2026): o escrito na prévia ou, sem ele, o da curva ABC carregada, pelo ISBN;
  // sem nenhum dos dois, ficam os de sempre.
  const titles = body.invoices.some((v) => v.lines.some((l) => l.isbn && !l.title)) ? curveTitles((await readCurve(env))?.rows ?? []) : new Map<string, string>();
  const renamedProducts = new Map<string, string>();
  // O nome gravado de cada linha, para a tela guardar a invoice com os nomes novos; null mantém os de sempre.
  const savedNames: (string | null)[][] = body.invoices.map(() => []);
  let takenQty = 0;
  let extra = 0;
  body.invoices.forEach((v, vi) => {
    const invoice = invoices[vi]!;
    const supplier = names.get(v.supplierId)!;
    v.lines.forEach((line, index) => {
      const { takes, extra: missing } = allocation[vi]![index]!;
      const chosenName = line.title ?? curveTitleFor(line.isbn, titles);
      savedNames[vi]!.push(chosenName);
      if (chosenName && line.isbn) renamedProducts.set(line.isbn, chosenName);
      for (const take of takes) {
        const item = byId.get(take.itemId)!;
        statements.push(
          ...shipItemStatements(env, item, take.quantity, invoice, 'embarcado', { priceMicros: line.unitPriceMicros, piecesPerCarton: line.piecesPerCarton, description: chosenName }, userId, at),
        );
        // O item segue com o saldo: a próxima linha (ou o próximo container) parte do que sobrou.
        byId.set(item.id, { ...item, quantity: item.quantity - take.quantity });
        takenQty += take.quantity;
      }
      if (missing > 0) {
        extra += missing;
        const id = crypto.randomUUID();
        const notes = `Não estava na produção da ${supplier}${line.orderCode ? ` (a invoice cita a ${line.orderCode})` : ''}. Confira.`;
        statements.push(
          insertItem(
            env,
            id,
            { description: chosenName ?? line.description, quantity: missing, piecesPerCarton: line.piecesPerCarton, unitPriceMicros: line.unitPriceMicros, notes },
            { productId: refs.product(line.isbn, chosenName ?? line.description), supplierId: v.supplierId, orderId: null, invoiceId: invoice.id, status: 'embarcado' },
            userId,
            at,
          ),
        );
        statements.push(eventStatement(env, id, userId, 'shipped', { invoice: invoice.number, quantity: missing, notInProduction: true, row: line.row }, at));
      }
    });
  });
  // Produtos novos, o BL e as invoices antes dos itens, que apontam para eles.
  // O produto também fica com o nome escolhido (o No Estoque e as fichas usam o título do produto).
  for (const [isbn, title] of renamedProducts) {
    statements.push(env.DB.prepare('UPDATE products SET title = ?, title_key = ? WHERE isbn = ? AND title <> ?').bind(title, titleKey(title), isbn, title));
  }
  await env.DB.batch([...refs.statements, ...statements]);
  return json({ billId, invoiceIds: invoices.map((v) => v.id), taken: takenQty, extra, names: savedNames }, 201);
}

// ---------- Container entregue ----------

/** As invoices que chegaram no dia informado: os itens delas vão para o histórico. */
async function registerArrival(request: Request, env: Env, session: Session, now: Date): Promise<Response> {
  checkMutation(request);
  const body = await readBody(request, arrivalBody);
  const ids = JSON.stringify([...new Set(body.invoiceIds)]);
  const { results } = await env.DB.prepare('SELECT id FROM invoices WHERE id IN (SELECT value FROM json_each(?))').bind(ids).all<{ id: string }>();
  if (results.length !== new Set(body.invoiceIds).size) return error(404, 'Uma das invoices não foi encontrada. Atualize a página e tente de novo.');
  const at = now.toISOString();
  await env.DB.batch([
    env.DB.prepare('UPDATE invoices SET arrived_at = ? WHERE id IN (SELECT value FROM json_each(?))').bind(body.arrivedAt, ids),
    itemsStatusStatement(env, ids, body.arrivedAt, at, session.user.id),
  ]);
  return json({ invoices: results.length });
}

// ---------- Excluir um embarque ou um container ----------

/**
 * Instruções que desfazem as invoices (SPEC.md, seção 3): o que saiu da produção volta para ela (a
 * parte dividida se junta ao saldo), o que não estava na produção é apagado, e os pagamentos e as
 * invoices são excluídos. Recusa invoice que já chegou.
 */
async function undoInvoices(env: Env, invoiceIds: string[], userId: string, at: string): Promise<{ statements: D1PreparedStatement[]; back: number; merged: number; removed: number }> {
  const ids = JSON.stringify(invoiceIds);
  const [itemRows, eventRows] = await env.DB.batch([
    env.DB.prepare(`${ITEM_SELECT} WHERE i.deleted_at IS NULL AND i.invoice_id IN (SELECT value FROM json_each(?))`).bind(ids),
    env.DB.prepare(
      `SELECT entity_id, type, detail FROM events
        WHERE entity = 'item' AND entity_id IN (SELECT id FROM order_items WHERE invoice_id IN (SELECT value FROM json_each(?)))
        ORDER BY created_at, rowid`,
    ).bind(ids),
  ]);
  const items = (itemRows!.results as ItemRow[]).map(toItem);
  const events = new Map<string, ItemEvent[]>();
  for (const r of eventRows!.results as { entity_id: string; type: string; detail: string }[]) {
    let detail: Record<string, unknown> = {};
    try {
      detail = JSON.parse(r.detail) as Record<string, unknown>;
    } catch {
      // Registro ilegível: conta como sem detalhes.
    }
    events.set(r.entity_id, [...(events.get(r.entity_id) ?? []), { type: r.type, detail }]);
  }
  const withOrigin = items.map((i) => ({ id: i.id, quantity: i.quantity, origin: itemOrigin(events.get(i.id) ?? []) }));
  const targets = [...new Set(withOrigin.flatMap((i) => (i.origin.kind === 'split' ? [i.origin.from] : [])))];
  const alive = new Set<string>();
  // Programação de envio de cada saldo, para somar de volta a da parte embarcada.
  const plans = new Map<string, ShipPlan>();
  if (targets.length) {
    const { results } = await env.DB.prepare(
      "SELECT id, ship_plan FROM order_items WHERE id IN (SELECT value FROM json_each(?)) AND deleted_at IS NULL AND status = 'producao'",
    )
      .bind(JSON.stringify(targets))
      .all<{ id: string; ship_plan: string }>();
    for (const r of results) {
      alive.add(r.id);
      plans.set(r.id, readStoredPlan(r.ship_plan));
    }
  }
  const planOf = new Map(items.map((i) => [i.id, i.shipPlan ?? []]));
  const plan = planShipmentUndo(withOrigin, (id) => alive.has(id));
  const statements: D1PreparedStatement[] = [];
  for (const b of plan.back) {
    statements.push(
      env.DB.prepare(
        `UPDATE order_items SET invoice_id = NULL, status = 'producao', updated_at = ?, updated_by = ?,
                unit_price_micros = CASE WHEN ? THEN ? ELSE unit_price_micros END,
                pieces_per_carton = CASE WHEN ? THEN ? ELSE pieces_per_carton END,
                description = COALESCE(?, description)
          WHERE id = ?`,
      ).bind(at, userId, b.priceMicros !== undefined ? 1 : 0, b.priceMicros ?? null, b.pieces !== undefined ? 1 : 0, b.pieces ?? null, b.description ?? null, b.id),
    );
    statements.push(eventStatement(env, b.id, userId, 'unshipped', { reason: 'embarque excluído' }, at));
  }
  for (const m of plan.merge) {
    const merged = mergePlans(plans.get(m.into) ?? [], planOf.get(m.id) ?? []);
    plans.set(m.into, merged);
    statements.push(
      env.DB.prepare('UPDATE order_items SET quantity = quantity + ?, ship_plan = ?, updated_at = ?, updated_by = ? WHERE id = ?').bind(m.quantity, JSON.stringify(merged), at, userId, m.into),
    );
    statements.push(env.DB.prepare('UPDATE order_items SET deleted_at = ?, invoice_id = NULL, updated_at = ?, updated_by = ? WHERE id = ?').bind(at, at, userId, m.id));
    statements.push(eventStatement(env, m.into, userId, 'merged', { quantity: m.quantity, from: m.id, reason: 'embarque excluído' }, at));
    statements.push(eventStatement(env, m.id, userId, 'deleted', { mergedInto: m.into, reason: 'embarque excluído' }, at));
  }
  for (const id of plan.remove) {
    statements.push(env.DB.prepare('UPDATE order_items SET deleted_at = ?, invoice_id = NULL, updated_at = ?, updated_by = ? WHERE id = ?').bind(at, at, userId, id));
    statements.push(eventStatement(env, id, userId, 'deleted', { reason: 'embarque excluído' }, at));
  }
  // Itens apagados antes ainda apontam para a invoice: soltam para ela poder ser excluída.
  statements.push(env.DB.prepare('UPDATE order_items SET invoice_id = NULL WHERE invoice_id IN (SELECT value FROM json_each(?))').bind(ids));
  statements.push(env.DB.prepare('DELETE FROM payments WHERE invoice_id IN (SELECT value FROM json_each(?))').bind(ids));
  // Os arquivos da invoice e da packing list saem junto (27/11/2026), e a nota fiscal do container também.
  statements.push(...deleteInvoiceDocumentsStatements(env, ids));
  statements.push(...deleteInvoiceFiscalStatements(env, ids));
  statements.push(env.DB.prepare('DELETE FROM invoices WHERE id IN (SELECT value FROM json_each(?))').bind(ids));
  return { statements, back: plan.back.length, merged: plan.merge.length, removed: plan.remove.length };
}

function deleteBillStatements(env: Env, billId: string): D1PreparedStatement[] {
  return [
    env.DB.prepare('DELETE FROM bill_document_parts WHERE document_id IN (SELECT id FROM bill_documents WHERE bill_of_lading_id = ?)').bind(billId),
    env.DB.prepare('DELETE FROM bill_documents WHERE bill_of_lading_id = ?').bind(billId),
    // A nota master sai com o BL (27/11/2026).
    ...deleteBillFiscalStatements(env, billId),
    env.DB.prepare('DELETE FROM bills_of_lading WHERE id = ?').bind(billId),
  ];
}

/** Exclui um container (a invoice). Se o BL fica sem invoices, ele sai junto. */
async function deleteInvoice(request: Request, env: Env, session: Session, id: string, now: Date): Promise<Response> {
  checkMutation(request);
  const invoice = await env.DB.prepare('SELECT id, number, ref, supplier_id, bill_of_lading_id, eta, arrived_at FROM invoices WHERE id = ?').bind(id).first<InvoiceRow>();
  if (!invoice) return error(404, 'Invoice não encontrada.');
  if (await invoiceArrival(env, invoice)) return error(409, `A invoice ${invoice.number} já chegou. Para excluir, apague antes a data de chegada.`);
  const undo = await undoInvoices(env, [id], session.user.id, now.toISOString());
  let billRemoved = false;
  if (invoice.bill_of_lading_id) {
    const others = await env.DB.prepare('SELECT COUNT(*) AS n FROM invoices WHERE bill_of_lading_id = ? AND id <> ?').bind(invoice.bill_of_lading_id, id).first<{ n: number }>();
    if (!others?.n) {
      undo.statements.push(...deleteBillStatements(env, invoice.bill_of_lading_id));
      billRemoved = true;
    }
  }
  await env.DB.batch(undo.statements);
  return json({ back: undo.back, merged: undo.merged, removed: undo.removed, billRemoved });
}

/** Exclui o embarque inteiro: o BL, todas as suas invoices, o arquivo do BL e as notas fiscais. */
async function deleteBill(request: Request, env: Env, session: Session, id: string, now: Date): Promise<Response> {
  checkMutation(request);
  const bill = await env.DB.prepare('SELECT id, number, eta, arrived_at FROM bills_of_lading WHERE id = ?').bind(id).first<BillRow>();
  if (!bill) return error(404, 'BL não encontrado.');
  const { results } = await env.DB.prepare('SELECT id, number, arrived_at FROM invoices WHERE bill_of_lading_id = ?').bind(id).all<{ id: string; number: string; arrived_at: string | null }>();
  if (bill.arrived_at || results.some((r) => r.arrived_at)) return error(409, `O BL ${bill.number} (ou uma das invoices) já chegou. Para excluir, apague antes a data de chegada.`);
  const undo = await undoInvoices(
    env,
    results.map((r) => r.id),
    session.user.id,
    now.toISOString(),
  );
  await env.DB.batch([...undo.statements, ...deleteBillStatements(env, id)]);
  return json({ back: undo.back, merged: undo.merged, removed: undo.removed, invoices: results.length });
}

// ---------- Carga da aba Embarques ----------

async function importShipments(request: Request, env: Env, session: Session, now: Date): Promise<Response> {
  checkMutation(request);
  const body = await readBody(request, importBody);
  const badPlan = body.items.map((i) => ({ row: i.row, problem: shipPlanProblem(i.shipPlan, i.quantity) })).find((p) => p.problem);
  if (badPlan) return error(400, `Linha ${badPlan.row}: ${badPlan.problem}`);
  const at = now.toISOString();
  const userId = session.user.id;
  const refs = await loadRefs(env, at);
  const statements: D1PreparedStatement[] = [];
  const bills = await loadBills(env, at, statements);

  const [inv, existing, paid] = await env.DB.batch([
    env.DB.prepare(
      `SELECT v.id, v.number, v.ref, v.supplier_id, v.bill_of_lading_id, v.eta, v.arrived_at, b.number AS bill_number
         FROM invoices v LEFT JOIN bills_of_lading b ON b.id = v.bill_of_lading_id`,
    ),
    env.DB.prepare(
      `SELECT v.number AS invoice, b.number AS bill, p.isbn, i.description, i.quantity, i.unit_price_micros
         FROM order_items i JOIN products p ON p.id = i.product_id JOIN invoices v ON v.id = i.invoice_id
         LEFT JOIN bills_of_lading b ON b.id = v.bill_of_lading_id
        WHERE i.deleted_at IS NULL`,
    ),
    env.DB.prepare('SELECT DISTINCT invoice_id FROM payments'),
  ]);
  const invoices = new Map((inv!.results as (InvoiceRow & { bill_number: string | null })[]).map((r) => [invoiceKey(r.supplier_id, r.number, r.bill_number), r as InvoiceRow]));
  const withPayment = new Set((paid!.results as { invoice_id: string }[]).map((r) => r.invoice_id));
  const keys = (existing!.results as { invoice: string; bill: string | null; isbn: string | null; description: string; quantity: number; unit_price_micros: number | null }[]).map((r) =>
    shipmentKey({ invoice: r.invoice, bill: r.bill, isbn: r.isbn, description: r.description, quantity: r.quantity, unitPriceMicros: r.unit_price_micros }),
  );
  const keep = newImportItems(body.items, keys, shipmentKey);

  const items: string[] = [];
  for (const index of keep) {
    const input = body.items[index]!;
    const supplierId = refs.supplier(input.supplier);
    const key = invoiceKey(supplierId, input.invoice, input.bill);
    let invoice = invoices.get(key);
    if (!invoice) {
      const bill = input.bill ? bills.resolve(input.bill, input.eta, supplierId) : null;
      invoice = { id: crypto.randomUUID(), number: input.invoice, ref: input.ref, supplier_id: supplierId, bill_of_lading_id: bill?.id ?? null, eta: bill ? null : input.eta, arrived_at: null };
      invoices.set(key, invoice);
      statements.push(
        env.DB.prepare('INSERT INTO invoices (id, number, ref, supplier_id, bill_of_lading_id, eta, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(
          invoice.id,
          invoice.number,
          invoice.ref,
          supplierId,
          invoice.bill_of_lading_id,
          invoice.eta,
          at,
        ),
      );
    }
    if (input.paid && !withPayment.has(invoice.id)) {
      // Pagamento antigo da planilha: marcado só como "pago", sem data, valor e câmbio (decidido em 17/11/2026).
      withPayment.add(invoice.id);
      statements.push(
        env.DB.prepare("INSERT INTO payments (id, invoice_id, notes, created_at, created_by) VALUES (?, ?, 'Pago, segundo a planilha', ?, ?)").bind(crypto.randomUUID(), invoice.id, at, userId),
      );
    }
    const arrived = invoice.bill_of_lading_id ? (bills.get(input.bill ?? '')?.arrived_at ?? null) : invoice.arrived_at;
    const id = crypto.randomUUID();
    items.push(id);
    statements.push(
      insertItem(
        env,
        id,
        input,
        { productId: refs.product(input.isbn, input.description), supplierId, orderId: null, invoiceId: invoice.id, status: itemStatusFor(invoice.id, arrived) },
        userId,
        at,
      ),
    );
    statements.push(eventStatement(env, id, userId, 'imported', { sheet: 'Embarques', row: input.row }, at));
  }
  // Fornecedores, produtos, BLs e invoices novos antes dos itens, que apontam para eles.
  if (items.length) await env.DB.batch([...refs.statements, ...statements]);
  return json({ inserted: items.length, skipped: body.items.length - items.length }, 201);
}

// ---------- Unidades do BL ----------

const unitsBody = z.object({
  units: z
    .array(z.object({ invoiceId: z.string({ error: 'Invoice inválida.' }).min(1).max(100), unit: unitSchema.nullable() }), { error: 'Informe as unidades.' })
    .min(1, 'Informe as unidades.')
    .max(60, 'No máximo 60 unidades por vez.'),
});

/**
 * Grava a unidade de cada invoice do BL (25/11/2026): a que a ficha do embarque leu do PDF do BL e a
 * pessoa conferiu. null tira a unidade. A mesma unidade não vai para duas invoices.
 */
async function saveBillUnits(request: Request, env: Env, billId: string): Promise<Response> {
  checkMutation(request);
  const body = await readBody(request, unitsBody);
  const bill = await env.DB.prepare('SELECT id FROM bills_of_lading WHERE id = ?').bind(billId).first<{ id: string }>();
  if (!bill) return error(404, 'BL não encontrado.');
  const { results } = await env.DB.prepare('SELECT id, container FROM invoices WHERE bill_of_lading_id = ?').bind(billId).all<{ id: string; container: string }>();
  const mine = new Map(results.map((r) => [r.id, r.container]));
  if (body.units.some((u) => !mine.has(u.invoiceId))) return error(400, 'Uma das invoices não é deste BL.');
  // A unidade de cada invoice depois da gravação: as mudadas e as que ficam como estavam.
  const after = new Map(mine);
  for (const u of body.units) after.set(u.invoiceId, u.unit?.container ?? '');
  const taken = [...after.values()].filter(Boolean);
  if (new Set(taken).size !== taken.length) return error(400, 'A mesma unidade ficou em duas invoices. Confira.');
  await env.DB.batch(
    body.units.map((u) =>
      env.DB.prepare(
        `UPDATE invoices SET container = ?, container_seal = ?, container_kind = ?, container_cartons = ?, container_weight_grams = ?, container_volume_liters = ?
          WHERE id = ?`,
      ).bind(u.unit?.container ?? '', u.unit?.seal ?? '', u.unit?.kind ?? '', u.unit?.cartons ?? null, u.unit?.weightGrams ?? null, u.unit?.volumeLiters ?? null, u.invoiceId),
    ),
  );
  return json({ updated: body.units.length });
}

// ---------- Packing list de um container já registrado ----------

const packingListBody = z.object({
  fileName: text(200, 'Arquivo da packing list').pipe(z.string().min(1, 'Informe o arquivo da packing list.')),
  items: z
    .array(
      z.object({
        itemId: z.string({ error: 'Item inválido.' }).min(1).max(100),
        piecesPerCarton: z.number({ error: 'Peças por caixa inválidas.' }).int('Peças por caixa inválidas.').positive('Peças por caixa inválidas.').max(1_000_000, 'Peças por caixa inválidas.'),
      }),
      { error: 'Informe os itens.' },
    )
    .max(IMPORT_BATCH, 'Itens demais para um container.'),
  /** O número do container, as caixas e o peso, da packing list: só preenchem o que estiver vazio. */
  container: unitSchema.shape.container.nullable().default(null),
  cartons: unitSchema.shape.cartons,
  weightGrams: unitSchema.shape.weightGrams,
  /**
   * O próprio arquivo, guardado para baixar depois (27/11/2026). Registrar sem ele tira o arquivo que estava
   * guardado, que era o da packing list anterior.
   */
  document: documentContent.nullable().default(null),
});

/**
 * Registra a packing list de um container (pedido do Gabriel em 26/11/2026): grava as peças por caixa
 * dos itens que a tela ligou (src/core/packingList.ts), com a mudança no histórico de cada item, e anota o
 * arquivo, quando e quem registrou. O número do container, as caixas e o peso entram só onde estão
 * vazios (os do BL valem mais). A quantidade e o preço não mudam. Desde 27/11/2026, o arquivo fica
 * guardado na mesma gravação (src/worker/invoiceDocuments.ts).
 */
async function savePackingList(request: Request, env: Env, session: Session, invoiceId: string, now: Date): Promise<Response> {
  checkMutation(request);
  const body = await readBody(request, packingListBody, DOCUMENT_BODY_BYTES);
  const stored = body.document ? storeInvoiceDocument(env, session.user.id, invoiceId, 'packing', { name: body.fileName, ...body.document }, now) : null;
  if (stored instanceof Response) return stored;
  const invoice = await env.DB.prepare('SELECT id, number, container, container_cartons, container_weight_grams FROM invoices WHERE id = ?')
    .bind(invoiceId)
    .first<{ id: string; number: string; container: string; container_cartons: number | null; container_weight_grams: number | null }>();
  if (!invoice) return error(404, 'Invoice não encontrada.');
  const { results } = await env.DB.prepare('SELECT id, pieces_per_carton FROM order_items WHERE invoice_id = ? AND deleted_at IS NULL')
    .bind(invoiceId)
    .all<{ id: string; pieces_per_carton: number | null }>();
  const before = new Map(results.map((r) => [r.id, r.pieces_per_carton]));
  if (new Set(body.items.map((i) => i.itemId)).size !== body.items.length) return error(400, 'O mesmo item apareceu duas vezes.');
  if (body.items.some((i) => !before.has(i.itemId))) return error(400, 'Um dos itens não é deste container.');
  const at = now.toISOString();
  const statements: D1PreparedStatement[] = [];
  let updated = 0;
  for (const change of body.items) {
    const from = before.get(change.itemId) ?? null;
    if (from === change.piecesPerCarton) continue;
    updated++;
    statements.push(
      env.DB.prepare('UPDATE order_items SET pieces_per_carton = ?, updated_at = ? WHERE id = ?').bind(change.piecesPerCarton, at, change.itemId),
      eventStatement(env, change.itemId, session.user.id, 'changed', { changes: [{ field: 'Peças por caixa', from, to: change.piecesPerCarton }], source: 'packing-list', invoice: invoice.number, file: body.fileName }, at),
    );
  }
  statements.push(
    env.DB.prepare(
      `UPDATE invoices SET packing_list_name = ?, packing_list_at = ?, packing_list_by = ?, container = ?, container_cartons = ?, container_weight_grams = ?
        WHERE id = ?`,
    ).bind(
      body.fileName,
      at,
      session.user.id,
      invoice.container || body.container || '',
      invoice.container_cartons ?? body.cartons,
      invoice.container_weight_grams ?? body.weightGrams,
      invoiceId,
    ),
    ...(stored ? stored.statements : removeInvoiceDocumentStatements(env, invoiceId, 'packing')),
  );
  await env.DB.batch(statements);
  return json({ updated });
}

// ---------- Prioridade do container ----------

const priorityBody = z.object({ priority: z.boolean({ error: 'Informe se o container tem prioridade.' }) });

/**
 * Marca ou tira a prioridade de um container no desembaraço e no transporte (pedido do Gabriel em
 * 26/11/2026): quando e quem marcou ficam na invoice, e a mudança, nos eventos.
 */
async function setPriority(request: Request, env: Env, session: Session, invoiceId: string, now: Date): Promise<Response> {
  checkMutation(request);
  const body = await readBody(request, priorityBody);
  const invoice = await env.DB.prepare('SELECT id, number, priority_at FROM invoices WHERE id = ?').bind(invoiceId).first<{ id: string; number: string; priority_at: string | null }>();
  if (!invoice) return error(404, 'Invoice não encontrada.');
  // Já está como pedido: nada muda (a marca guarda quem marcou primeiro).
  if (Boolean(invoice.priority_at) === body.priority) return json({ changed: false });
  const at = now.toISOString();
  await env.DB.batch([
    env.DB.prepare('UPDATE invoices SET priority_at = ?, priority_by = ? WHERE id = ?').bind(body.priority ? at : null, body.priority ? session.user.id : null, invoiceId),
    env.DB.prepare("INSERT INTO events (id, entity, entity_id, user_id, type, detail, created_at) VALUES (?, 'invoice', ?, ?, 'priority', ?, ?)").bind(
      crypto.randomUUID(),
      invoiceId,
      session.user.id,
      JSON.stringify({ invoice: invoice.number, priority: body.priority }),
      at,
    ),
  ]);
  return json({ changed: true });
}

// ---------- Roteador ----------

export async function routeShipments(request: Request, env: Env, session: Session, key: string, path: string, now: Date): Promise<Response | null> {
  const role = session.user.role;
  const onlyEdit = () => (can(role, 'edit') ? null : error(403, 'Seu perfil só pode acompanhar.'));

  if (key === 'POST /api/ship') return onlyEdit() ?? ship(request, env, session, now);
  if (key === 'POST /api/shipments') return onlyEdit() ?? receiveShipment(request, env, session, now);
  if (key === 'POST /api/arrivals') return onlyEdit() ?? registerArrival(request, env, session, now);
  if (key === 'POST /api/import/shipments') {
    if (!can(role, 'import')) return error(403, 'Só o admin faz a carga da planilha.');
    return importShipments(request, env, session, now);
  }
  let m = /^\/api\/items\/([^/]+)\/unship$/.exec(path);
  if (m && request.method === 'POST') return onlyEdit() ?? unship(request, env, session, decodeURIComponent(m[1]!), now);
  const onlyAdmin = () => (can(role, 'delete') ? null : error(403, 'Só o admin exclui embarques.'));
  m = /^\/api\/bills\/([^/]+)$/.exec(path);
  if (m && request.method === 'PATCH') return onlyEdit() ?? updateBill(request, env, session, decodeURIComponent(m[1]!), now);
  if (m && request.method === 'DELETE') return onlyAdmin() ?? deleteBill(request, env, session, decodeURIComponent(m[1]!), now);
  m = /^\/api\/bills\/([^/]+)\/units$/.exec(path);
  if (m && request.method === 'POST') return onlyEdit() ?? saveBillUnits(request, env, decodeURIComponent(m[1]!));
  m = /^\/api\/invoices\/([^/]+)$/.exec(path);
  if (m && request.method === 'PATCH') return onlyEdit() ?? updateInvoice(request, env, session, decodeURIComponent(m[1]!), now);
  if (m && request.method === 'DELETE') return onlyAdmin() ?? deleteInvoice(request, env, session, decodeURIComponent(m[1]!), now);
  m = /^\/api\/invoices\/([^/]+)\/priority$/.exec(path);
  if (m && request.method === 'PUT') return onlyEdit() ?? setPriority(request, env, session, decodeURIComponent(m[1]!), now);
  m = /^\/api\/invoices\/([^/]+)\/packing-list$/.exec(path);
  if (m && request.method === 'POST') return onlyEdit() ?? savePackingList(request, env, session, decodeURIComponent(m[1]!), now);
  m = /^\/api\/invoices\/([^/]+)\/payments$/.exec(path);
  if (m && request.method === 'POST') {
    // Pagamento é valor: quem não vê valores também não registra.
    if (!can(role, 'edit') || !can(role, 'see_values')) return error(403, 'Seu perfil não registra pagamentos.');
    return addPayment(request, env, session, decodeURIComponent(m[1]!), now);
  }
  m = /^\/api\/payments\/([^/]+)$/.exec(path);
  if (m && request.method === 'DELETE') {
    if (!can(role, 'delete')) return error(403, 'Só o admin exclui pagamentos.');
    return deletePayment(request, env, decodeURIComponent(m[1]!));
  }
  return null;
}

