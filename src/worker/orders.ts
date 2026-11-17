// Rotas de produção: itens, POs e fornecedores, e a carga da aba Produção (SPEC.md, seções 3 a 7).
// Toda rota confere o perfil; preço e total saem das respostas para quem não vê valores.

import { z } from 'zod';
import { IMPORT_BATCH, importKey, newImportItems, separateMixedOrders } from '../core/importProduction';
import { isbnDigits, isbnProblem } from '../core/isbn';
import { isValidUnitPrice } from '../core/money';
import { itemForViewer, normalizeOrderCode, orderOwners, orderSupplierProblem, searchKey, titleKey, type Item, type ItemStatus, type PurchaseOrder, type Supplier } from '../core/items';
import { can } from '../core/roles';
import { spDate, type Bill, type Invoice, type Payment } from '../core/shipments';
import type { Session } from './auth';
import type { Env } from './env';
import { checkMutation, error, HttpError, json, readBody } from './http';

// ---------- Esquemas de entrada ----------

const description = z
  .string({ error: 'Informe o produto.' })
  .transform((s) => s.replace(/\s+/g, ' ').trim())
  .pipe(z.string().min(1, 'Informe o produto.').max(300, 'O nome do produto pode ter no máximo 300 caracteres.'));
const isbn = z
  .string()
  .max(40, 'ISBN longo demais.')
  .nullable()
  .transform((s, ctx) => {
    const t = (s ?? '').trim();
    if (!t) return null;
    const problem = isbnProblem(t);
    if (problem) {
      ctx.addIssue({ code: 'custom', message: problem });
      return z.NEVER;
    }
    return isbnDigits(t);
  });
const supplier = z
  .string()
  .max(100, 'O nome do fornecedor pode ter no máximo 100 caracteres.')
  .nullable()
  .transform((s) => (s ?? '').replace(/\s+/g, ' ').trim() || null);
const orderCode = z
  .string()
  .max(20, 'Código de PO longo demais.')
  .nullable()
  .transform((s, ctx) => {
    const t = (s ?? '').trim();
    if (!t) return null;
    const code = normalizeOrderCode(t);
    if (!code) {
      ctx.addIssue({ code: 'custom', message: 'Código de PO inválido. Use o formato PO-063.' });
      return z.NEVER;
    }
    return code;
  });
const quantity = z
  .number({ error: 'Informe a quantidade.' })
  .int('A quantidade é um número inteiro.')
  .positive('A quantidade precisa ser maior que zero.')
  .max(100_000_000, 'Quantidade grande demais.');
const piecesPerCarton = z
  .number({ error: 'Peças por caixa inválidas.' })
  .int('Peças por caixa é um número inteiro.')
  .positive('Peças por caixa precisa ser maior que zero.')
  .max(1_000_000, 'Peças por caixa: número grande demais.')
  .nullable();
const unitPriceMicros = z
  .number({ error: 'Preço inválido.' })
  .int('Preço inválido.')
  .min(0, 'O preço não pode ser negativo.')
  .max(1_000_000_000, 'Preço grande demais.')
  .refine(isValidUnitPrice, 'O preço unitário tem no máximo três casas decimais.')
  .nullable();
const notes = z.string().max(2000, 'As observações podem ter no máximo 2.000 caracteres.').transform((s) => s.trim());

const itemFields = {
  description,
  isbn: isbn.default(null),
  supplier: supplier.default(null),
  orderCode: orderCode.default(null),
  quantity,
  piecesPerCarton: piecesPerCarton.default(null),
  unitPriceMicros: unitPriceMicros.default(null),
  notes: notes.default(''),
};

const createItemBody = z.object(itemFields);
const updateItemBody = z
  .object({
    description,
    isbn,
    supplier,
    orderCode,
    quantity,
    piecesPerCarton,
    unitPriceMicros,
    notes,
  })
  .partial()
  .refine((b) => Object.keys(b).length > 0, 'Nada para alterar.');

const importBody = z.object({
  items: z
    .array(z.object({ ...itemFields, row: z.number().int().min(1) }))
    .min(1, 'A planilha não tem itens.')
    .max(IMPORT_BATCH, `Envie no máximo ${IMPORT_BATCH} itens por vez.`),
});

type ItemInput = z.output<typeof createItemBody>;

// ---------- Banco ----------

export interface ItemRow {
  id: string;
  product_id: string;
  isbn: string | null;
  description: string;
  supplier_id: string | null;
  purchase_order_id: string | null;
  invoice_id: string | null;
  status: ItemStatus;
  quantity: number;
  pieces_per_carton: number | null;
  unit_price_micros: number | null;
  notes: string;
  created_at: string;
  updated_at: string;
}

export const ITEM_SELECT = `SELECT i.id, i.product_id, p.isbn, i.description, i.supplier_id, i.purchase_order_id, i.invoice_id, i.status, i.quantity,
       i.pieces_per_carton, i.unit_price_micros, i.notes, i.created_at, i.updated_at
  FROM order_items i JOIN products p ON p.id = i.product_id`;

export function toItem(row: ItemRow): Item {
  return {
    id: row.id,
    productId: row.product_id,
    isbn: row.isbn,
    description: row.description,
    supplierId: row.supplier_id,
    purchaseOrderId: row.purchase_order_id,
    invoiceId: row.invoice_id,
    status: row.status,
    quantity: row.quantity,
    piecesPerCarton: row.pieces_per_carton,
    unitPriceMicros: row.unit_price_micros,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function findItem(env: Env, id: string): Promise<Item | null> {
  const row = await env.DB.prepare(`${ITEM_SELECT} WHERE i.id = ? AND i.deleted_at IS NULL`).bind(id).first<ItemRow>();
  return row ? toItem(row) : null;
}

/**
 * Uma PO tem um fornecedor só: confere se o item (com este fornecedor) pode ficar na PO, olhando os
 * outros itens dela. Lança erro 409 com a explicação quando não pode.
 */
async function checkOrderSupplier(env: Env, orderCode: string | null, supplierName: string | null, exceptItemId: string): Promise<void> {
  if (!orderCode || !supplierName) return;
  const { results } = await env.DB.prepare(
    `SELECT DISTINCT s.id, s.name FROM order_items i
       JOIN purchase_orders o ON o.id = i.purchase_order_id JOIN suppliers s ON s.id = i.supplier_id
      WHERE o.code = ? AND i.deleted_at IS NULL AND i.id <> ?`,
  )
    .bind(orderCode, exceptItemId)
    .all<{ id: string; name: string }>();
  // O fornecedor pelo nome (o formulário manda o nome): "sara" é a Sara já cadastrada.
  const same = results.find((r) => searchKey(r.name) === searchKey(supplierName));
  const problem = orderSupplierProblem(orderCode, { id: same?.id ?? '#novo', name: same?.name ?? supplierName }, results);
  if (problem) throw new HttpError(409, problem);
}

/** Dono de cada PO já cadastrada (código → nome do fornecedor), pela regra de orderOwners. */
async function savedOrderOwners(env: Env): Promise<Map<string, string>> {
  const { results } = await env.DB.prepare(
    `SELECT o.code, s.name FROM order_items i
       JOIN purchase_orders o ON o.id = i.purchase_order_id JOIN suppliers s ON s.id = i.supplier_id
      WHERE i.deleted_at IS NULL ORDER BY i.created_at, i.rowid`,
  ).all<{ code: string; name: string }>();
  return orderOwners(results.map((r) => ({ order: r.code.toUpperCase(), supplier: r.name })));
}

export function eventStatement(env: Env, entityId: string, userId: string, type: string, detail: unknown, at: string): D1PreparedStatement {
  return env.DB.prepare('INSERT INTO events (id, entity, entity_id, user_id, type, detail, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(
    crypto.randomUUID(),
    'item',
    entityId,
    userId,
    type,
    JSON.stringify(detail),
    at,
  );
}

/**
 * Fornecedores, POs e produtos já cadastrados, em memória, para ligar os itens sem uma consulta por
 * item (o plano gratuito da Cloudflare permite 50 consultas por pedido). O que falta é criado pelas
 * instruções em `statements`, gravadas junto com os itens.
 */
export async function loadRefs(env: Env, at: string) {
  const [s, o, p] = await env.DB.batch([
    env.DB.prepare('SELECT id, name FROM suppliers'),
    env.DB.prepare('SELECT id, code FROM purchase_orders'),
    env.DB.prepare('SELECT id, isbn, title_key FROM products'),
  ]);
  const suppliers = new Map((s!.results as { id: string; name: string }[]).map((r) => [searchKey(r.name), r.id]));
  const orders = new Map((o!.results as { id: string; code: string }[]).map((r) => [r.code.toUpperCase(), r.id]));
  const byIsbn = new Map<string, string>();
  const byTitle = new Map<string, string>();
  for (const r of p!.results as { id: string; isbn: string | null; title_key: string }[]) {
    if (r.isbn) byIsbn.set(r.isbn, r.id);
    else if (!byTitle.has(r.title_key)) byTitle.set(r.title_key, r.id);
  }
  const statements: D1PreparedStatement[] = [];

  return {
    statements,
    supplier(name: string | null): string | null {
      if (!name) return null;
      const key = searchKey(name);
      let id = suppliers.get(key);
      if (!id) {
        id = crypto.randomUUID();
        suppliers.set(key, id);
        statements.push(env.DB.prepare('INSERT INTO suppliers (id, name, created_at) VALUES (?, ?, ?)').bind(id, name, at));
      }
      return id;
    },
    order(code: string | null): string | null {
      if (!code) return null;
      let id = orders.get(code.toUpperCase());
      if (!id) {
        id = crypto.randomUUID();
        orders.set(code.toUpperCase(), id);
        statements.push(env.DB.prepare('INSERT INTO purchase_orders (id, code, created_at) VALUES (?, ?, ?)').bind(id, code, at));
      }
      return id;
    },
    product(isbnValue: string | null, title: string): string {
      const key = titleKey(title);
      let id = isbnValue ? byIsbn.get(isbnValue) : byTitle.get(key);
      if (!id) {
        id = crypto.randomUUID();
        if (isbnValue) byIsbn.set(isbnValue, id);
        else byTitle.set(key, id);
        statements.push(
          env.DB.prepare('INSERT INTO products (id, isbn, title, title_key, created_at) VALUES (?, ?, ?, ?, ?)').bind(id, isbnValue, title, key, at),
        );
      }
      return id;
    },
  };
}

export type ItemFieldsInput = Pick<ItemInput, 'description' | 'quantity' | 'piecesPerCarton' | 'unitPriceMicros' | 'notes'>;

export function insertItem(
  env: Env,
  id: string,
  input: ItemFieldsInput,
  refs: { productId: string; supplierId: string | null; orderId: string | null; invoiceId?: string | null; status?: ItemStatus },
  userId: string,
  at: string,
) {
  return env.DB.prepare(
    `INSERT INTO order_items (id, product_id, description, supplier_id, purchase_order_id, invoice_id, status, quantity, pieces_per_carton,
                              unit_price_micros, notes, created_at, created_by, updated_at, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    id,
    refs.productId,
    input.description,
    refs.supplierId,
    refs.orderId,
    refs.invoiceId ?? null,
    refs.status ?? 'producao',
    input.quantity,
    input.piecesPerCarton,
    input.unitPriceMicros,
    input.notes,
    at,
    userId,
    at,
    userId,
  );
}

// ---------- Rotas ----------

/** Quantos dias os embarques que chegaram continuam na tela de embarques (depois, vão para o histórico). */
export const RECENT_ARRIVAL_DAYS = 60;

/**
 * Tudo o que as telas usam numa consulta só: fornecedores, POs, itens em produção e embarcados (e os
 * que chegaram nos últimos 60 dias), BLs, invoices e pagamentos. O leitor não recebe preço, total nem
 * pagamentos.
 */
async function getData(env: Env, session: Session, now: Date): Promise<Response> {
  const seeValues = can(session.user.role, 'see_values');
  const today = spDate(now);
  const cutoff = new Date(Date.parse(`${today}T00:00:00Z`) - RECENT_ARRIVAL_DAYS * 86_400_000).toISOString().slice(0, 10);
  const [s, o, i, b, v, pay] = await env.DB.batch([
    env.DB.prepare('SELECT id, name FROM suppliers ORDER BY name COLLATE NOCASE'),
    env.DB.prepare('SELECT id, code, ordered_at, notes FROM purchase_orders'),
    env.DB.prepare(
      `${ITEM_SELECT}
         LEFT JOIN invoices v ON v.id = i.invoice_id LEFT JOIN bills_of_lading b ON b.id = v.bill_of_lading_id
        WHERE i.deleted_at IS NULL AND (i.status <> 'entregue' OR COALESCE(v.arrived_at, b.arrived_at) >= ?)
        ORDER BY i.created_at, i.rowid`,
    ).bind(cutoff),
    env.DB.prepare('SELECT id, number, eta, arrived_at, notes FROM bills_of_lading'),
    // Invoices a caminho e as que chegaram nos últimos 60 dias. As do histórico sem data de chegada
    // (itens entregues, mas o dia não está na planilha) não voltam para a tela de embarques.
    env.DB.prepare(
      `SELECT v.id, v.number, v.ref, v.supplier_id, v.bill_of_lading_id, v.eta, v.arrived_at, v.notes
         FROM invoices v LEFT JOIN bills_of_lading b ON b.id = v.bill_of_lading_id
        WHERE COALESCE(v.arrived_at, b.arrived_at) >= ?
           OR (COALESCE(v.arrived_at, b.arrived_at) IS NULL
               AND NOT EXISTS (SELECT 1 FROM order_items i WHERE i.invoice_id = v.id AND i.status = 'entregue' AND i.deleted_at IS NULL))`,
    ).bind(cutoff),
    env.DB.prepare('SELECT id, invoice_id, paid_at, amount_cents, exchange_rate_e4, notes FROM payments ORDER BY created_at, rowid'),
  ]);
  const suppliers: Supplier[] = s!.results as Supplier[];
  const orders: PurchaseOrder[] = (o!.results as { id: string; code: string; ordered_at: string | null; notes: string }[]).map((r) => ({
    id: r.id,
    code: r.code,
    orderedAt: r.ordered_at,
    notes: r.notes,
  }));
  const items = (i!.results as ItemRow[]).map((r) => itemForViewer(toItem(r), seeValues));
  const invoiceRows = v!.results as { id: string; number: string; ref: string; supplier_id: string | null; bill_of_lading_id: string | null; eta: string | null; arrived_at: string | null; notes: string }[];
  // BLs das invoices mostradas, e os BLs vazios ainda a caminho (todas as invoices desfeitas).
  const usedBills = new Set(invoiceRows.map((r) => r.bill_of_lading_id));
  const allBills = b!.results as { id: string; number: string; eta: string | null; arrived_at: string | null; notes: string }[];
  const billsWithInvoices = await env.DB.prepare('SELECT DISTINCT bill_of_lading_id AS id FROM invoices WHERE bill_of_lading_id IS NOT NULL').all<{ id: string }>();
  const hasInvoices = new Set(billsWithInvoices.results.map((r) => r.id));
  const bills: Bill[] = allBills.filter((r) => usedBills.has(r.id) || (!hasInvoices.has(r.id) && !r.arrived_at)).map((r) => ({
    id: r.id,
    number: r.number,
    eta: r.eta,
    arrivedAt: r.arrived_at,
    notes: r.notes,
  }));
  const invoices: Invoice[] = invoiceRows.map((r) => ({
    id: r.id,
    number: r.number,
    ref: r.ref,
    supplierId: r.supplier_id,
    billId: r.bill_of_lading_id,
    eta: r.eta,
    arrivedAt: r.arrived_at,
    notes: r.notes,
  }));
  const shown = new Set(invoices.map((x) => x.id));
  const payments: Payment[] = seeValues
    ? (pay!.results as { id: string; invoice_id: string; paid_at: string | null; amount_cents: number | null; exchange_rate_e4: number | null; notes: string }[])
        .filter((r) => shown.has(r.invoice_id))
        .map((r) => ({ id: r.id, invoiceId: r.invoice_id, paidAt: r.paid_at, amountCents: r.amount_cents, exchangeRateE4: r.exchange_rate_e4, notes: r.notes }))
    : [];
  return json({ today, suppliers, orders, items, bills, invoices, payments, seeValues });
}

async function createItem(request: Request, env: Env, session: Session, now: Date): Promise<Response> {
  checkMutation(request);
  const input = await readBody(request, createItemBody);
  await checkOrderSupplier(env, input.orderCode, input.supplier, '');
  const at = now.toISOString();
  const refs = await loadRefs(env, at);
  const id = crypto.randomUUID();
  const links = { productId: refs.product(input.isbn, input.description), supplierId: refs.supplier(input.supplier), orderId: refs.order(input.orderCode) };
  await env.DB.batch([
    ...refs.statements,
    insertItem(env, id, input, links, session.user.id, at),
    eventStatement(env, id, session.user.id, 'created', { description: input.description, quantity: input.quantity }, at),
  ]);
  return json({ item: itemForViewer((await findItem(env, id))!, true) }, 201);
}

/** Campos que entram no histórico, com o nome que a pessoa vê. */
const TRACKED: Record<string, string> = {
  description: 'Produto',
  isbn: 'ISBN',
  supplier: 'Fornecedor',
  orderCode: 'PO',
  quantity: 'Quantidade',
  piecesPerCarton: 'Peças por caixa',
  unitPriceMicros: 'Preço unitário',
  notes: 'Observações',
};

async function updateItem(request: Request, env: Env, session: Session, id: string, now: Date): Promise<Response> {
  checkMutation(request);
  const body = await readBody(request, updateItemBody);
  const before = await findItem(env, id);
  if (!before) return error(404, 'Item não encontrado.');
  const at = now.toISOString();
  const refs = await loadRefs(env, at);

  const [names, codes] = await env.DB.batch([
    env.DB.prepare('SELECT name FROM suppliers WHERE id = ?').bind(before.supplierId),
    env.DB.prepare('SELECT code FROM purchase_orders WHERE id = ?').bind(before.purchaseOrderId),
  ]);
  const old = {
    description: before.description,
    isbn: before.isbn,
    supplier: (names!.results[0] as { name: string } | undefined)?.name ?? null,
    orderCode: (codes!.results[0] as { code: string } | undefined)?.code ?? null,
    quantity: before.quantity,
    piecesPerCarton: before.piecesPerCarton,
    unitPriceMicros: before.unitPriceMicros ?? null,
    notes: before.notes,
  };
  const next = { ...old, ...body };
  const changes = Object.keys(TRACKED)
    .filter((k) => {
      const a = old[k as keyof typeof old];
      const b = next[k as keyof typeof next];
      // "sara" e "Sara" são o mesmo fornecedor.
      if (k === 'supplier') return (a ? searchKey(String(a)) : null) !== (b ? searchKey(String(b)) : null);
      return a !== b;
    })
    .map((k) => ({ field: TRACKED[k], from: old[k as keyof typeof old], to: next[k as keyof typeof next] }));
  if (changes.length === 0) return json({ item: itemForViewer(before, true) });
  // Só confere a regra da PO quando a PO ou o fornecedor mudam; assim, um item antigo de uma PO com
  // dois fornecedores ainda pode ter outros campos corrigidos.
  if (before.invoiceId && changes.some((c) => c.field === TRACKED.supplier)) {
    return error(409, 'Item embarcado: o fornecedor é o da invoice. Para trocar, desfaça o embarque primeiro.');
  }
  if (changes.some((c) => c.field === TRACKED.orderCode || c.field === TRACKED.supplier)) {
    await checkOrderSupplier(env, next.orderCode, next.supplier, id);
  }

  // Produto muda quando muda o ISBN ou, sem ISBN, o nome.
  const productId = next.isbn !== old.isbn || (!next.isbn && titleKey(next.description) !== titleKey(old.description)) ? refs.product(next.isbn, next.description) : before.productId;
  const supplierId = refs.supplier(next.supplier);
  const orderId = refs.order(next.orderCode);
  await env.DB.batch([
    ...refs.statements,
    env.DB.prepare(
      `UPDATE order_items SET product_id = ?, description = ?, supplier_id = ?, purchase_order_id = ?, quantity = ?, pieces_per_carton = ?,
              unit_price_micros = ?, notes = ?, updated_at = ?, updated_by = ?
        WHERE id = ?`,
    ).bind(productId, next.description, supplierId, orderId, next.quantity, next.piecesPerCarton, next.unitPriceMicros, next.notes, at, session.user.id, id),
    eventStatement(env, id, session.user.id, 'changed', { changes }, at),
  ]);
  return json({ item: itemForViewer((await findItem(env, id))!, true) });
}

async function deleteItem(request: Request, env: Env, session: Session, id: string, now: Date): Promise<Response> {
  checkMutation(request);
  const before = await findItem(env, id);
  if (!before) return error(404, 'Item não encontrado.');
  const at = now.toISOString();
  await env.DB.batch([
    env.DB.prepare('UPDATE order_items SET deleted_at = ?, updated_at = ?, updated_by = ? WHERE id = ?').bind(at, at, session.user.id, id),
    eventStatement(env, id, session.user.id, 'deleted', { description: before.description }, at),
  ]);
  return json({ ok: true });
}

async function importProduction(request: Request, env: Env, session: Session, now: Date): Promise<Response> {
  checkMutation(request);
  const body = await readBody(request, importBody);
  const at = now.toISOString();
  const refs = await loadRefs(env, at);

  // O que já está cadastrado não entra de novo (mesma PO, produto, quantidade e preço).
  const existing = await env.DB.prepare(
    `SELECT o.code AS order_code, p.isbn, i.description, i.quantity, i.unit_price_micros
       FROM order_items i JOIN products p ON p.id = i.product_id LEFT JOIN purchase_orders o ON o.id = i.purchase_order_id
      WHERE i.deleted_at IS NULL AND i.status = 'producao'`,
  ).all<{ order_code: string | null; isbn: string | null; description: string; quantity: number; unit_price_micros: number | null }>();
  const keys = existing.results.map((r) =>
    importKey({ orderCode: r.order_code, isbn: r.isbn, description: r.description, quantity: r.quantity, unitPriceMicros: r.unit_price_micros }),
  );
  // Uma PO tem um fornecedor só: vale o dono das POs já cadastradas.
  const { items, moved } = separateMixedOrders(body.items, await savedOrderOwners(env));
  const keep = newImportItems(items, keys, importKey);
  const skipped = items.length - keep.length;

  const statements: D1PreparedStatement[] = [];
  for (const index of keep) {
    const input = items[index]!;
    const id = crypto.randomUUID();
    const links = { productId: refs.product(input.isbn, input.description), supplierId: refs.supplier(input.supplier), orderId: refs.order(input.orderCode) };
    statements.push(insertItem(env, id, input, links, session.user.id, at));
    statements.push(eventStatement(env, id, session.user.id, 'imported', { sheet: 'Produção', row: input.row }, at));
  }
  // Fornecedores, POs e produtos novos primeiro, porque os itens apontam para eles.
  if (statements.length) await env.DB.batch([...refs.statements, ...statements]);
  return json({ inserted: statements.length / 2, skipped, withoutOrder: moved.map((m) => m.message) }, 201);
}

export async function routeOrders(request: Request, env: Env, session: Session, key: string, path: string, now: Date): Promise<Response | null> {
  const role = session.user.role;
  if (key === 'GET /api/data') return getData(env, session, now);

  if (key === 'POST /api/import/production') {
    if (!can(role, 'import')) return error(403, 'Só o admin faz a carga da planilha.');
    return importProduction(request, env, session, now);
  }

  if (key === 'POST /api/items') {
    if (!can(role, 'edit')) return error(403, 'Seu perfil só pode acompanhar.');
    return createItem(request, env, session, now);
  }
  const match = /^\/api\/items\/([^/]+)$/.exec(path);
  if (match) {
    const id = decodeURIComponent(match[1]!);
    if (request.method === 'PATCH') {
      if (!can(role, 'edit')) return error(403, 'Seu perfil só pode acompanhar.');
      return updateItem(request, env, session, id, now);
    }
    if (request.method === 'DELETE') {
      if (!can(role, 'delete')) return error(403, 'Só o admin exclui itens.');
      return deleteItem(request, env, session, id, now);
    }
    throw new HttpError(405, 'Método não permitido.');
  }
  return null;
}
