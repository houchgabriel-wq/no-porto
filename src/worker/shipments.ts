// Rotas de embarque (SPEC.md, seções 3 a 7): embarcar itens da produção (inteiros ou em parte),
// desfazer, alterar BL e invoice (chegada prevista e chegada real), pagamentos e a carga da aba
// Embarques. Toda rota confere o perfil.

import { z } from 'zod';
import { IMPORT_BATCH, newImportItems } from '../core/importProduction';
import { shipmentKey } from '../core/importShipments';
import { isbnDigits, isbnProblem } from '../core/isbn';
import { isValidUnitPrice } from '../core/money';
import { can } from '../core/roles';
import { itemStatusFor, shipProblem } from '../core/shipments';
import type { Session } from './auth';
import type { Env } from './env';
import { checkMutation, error, HttpError, json, readBody } from './http';
import { eventStatement, findItem, insertItem, ITEM_SELECT, loadRefs, toItem, type ItemRow } from './orders';

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
  for (const { item, quantity } of lines) {
    if (quantity === item.quantity) {
      statements.push(
        env.DB.prepare('UPDATE order_items SET invoice_id = ?, status = ?, updated_at = ?, updated_by = ? WHERE id = ?').bind(invoice.id, status, at, userId, item.id),
      );
      statements.push(eventStatement(env, item.id, userId, 'shipped', { invoice: invoice.number, quantity }, at));
    } else {
      // Embarque em parte: o item fica com o saldo em produção e a parte embarcada vira um item novo.
      const id = crypto.randomUUID();
      statements.push(
        env.DB.prepare('UPDATE order_items SET quantity = ?, updated_at = ?, updated_by = ? WHERE id = ?').bind(item.quantity - quantity, at, userId, item.id),
      );
      statements.push(
        insertItem(
          env,
          id,
          { description: item.description, quantity, piecesPerCarton: item.piecesPerCarton, unitPriceMicros: item.unitPriceMicros ?? null, notes: item.notes },
          { productId: item.productId, supplierId: item.supplierId, orderId: item.purchaseOrderId, invoiceId: invoice.id, status },
          userId,
          at,
        ),
      );
      statements.push(eventStatement(env, item.id, userId, 'split', { invoice: invoice.number, shipped: quantity, left: item.quantity - quantity, newItem: id }, at));
      statements.push(eventStatement(env, id, userId, 'shipped', { invoice: invoice.number, quantity, splitFrom: item.id }, at));
    }
  }
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

// ---------- Carga da aba Embarques ----------

async function importShipments(request: Request, env: Env, session: Session, now: Date): Promise<Response> {
  checkMutation(request);
  const body = await readBody(request, importBody);
  const at = now.toISOString();
  const userId = session.user.id;
  const refs = await loadRefs(env, at);
  const statements: D1PreparedStatement[] = [];
  const bills = await loadBills(env, at, statements);

  const [inv, existing, paid] = await env.DB.batch([
    env.DB.prepare('SELECT id, number, ref, supplier_id, bill_of_lading_id, eta, arrived_at FROM invoices'),
    env.DB.prepare(
      `SELECT v.number AS invoice, p.isbn, i.description, i.quantity, i.unit_price_micros
         FROM order_items i JOIN products p ON p.id = i.product_id JOIN invoices v ON v.id = i.invoice_id
        WHERE i.deleted_at IS NULL`,
    ),
    env.DB.prepare('SELECT DISTINCT invoice_id FROM payments'),
  ]);
  const invoices = new Map((inv!.results as InvoiceRow[]).map((r) => [`${r.supplier_id ?? ''}|${r.number.toUpperCase()}`, r]));
  const withPayment = new Set((paid!.results as { invoice_id: string }[]).map((r) => r.invoice_id));
  const keys = (existing!.results as { invoice: string; isbn: string | null; description: string; quantity: number; unit_price_micros: number | null }[]).map((r) =>
    shipmentKey({ invoice: r.invoice, isbn: r.isbn, description: r.description, quantity: r.quantity, unitPriceMicros: r.unit_price_micros }),
  );
  const keep = newImportItems(body.items, keys, shipmentKey);

  const items: string[] = [];
  for (const index of keep) {
    const input = body.items[index]!;
    const supplierId = refs.supplier(input.supplier);
    const key = `${supplierId ?? ''}|${input.invoice.toUpperCase()}`;
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

// ---------- Roteador ----------

export async function routeShipments(request: Request, env: Env, session: Session, key: string, path: string, now: Date): Promise<Response | null> {
  const role = session.user.role;
  const onlyEdit = () => (can(role, 'edit') ? null : error(403, 'Seu perfil só pode acompanhar.'));

  if (key === 'POST /api/ship') return onlyEdit() ?? ship(request, env, session, now);
  if (key === 'POST /api/import/shipments') {
    if (!can(role, 'import')) return error(403, 'Só o admin faz a carga da planilha.');
    return importShipments(request, env, session, now);
  }
  let m = /^\/api\/items\/([^/]+)\/unship$/.exec(path);
  if (m && request.method === 'POST') return onlyEdit() ?? unship(request, env, session, decodeURIComponent(m[1]!), now);
  m = /^\/api\/bills\/([^/]+)$/.exec(path);
  if (m && request.method === 'PATCH') return onlyEdit() ?? updateBill(request, env, session, decodeURIComponent(m[1]!), now);
  m = /^\/api\/invoices\/([^/]+)$/.exec(path);
  if (m && request.method === 'PATCH') return onlyEdit() ?? updateInvoice(request, env, session, decodeURIComponent(m[1]!), now);
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

