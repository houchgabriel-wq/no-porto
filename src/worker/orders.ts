// Rotas de produção: itens, POs e fornecedores, e a carga da aba Produção (SPEC.md, seções 3 a 7).
// Toda rota confere o perfil; preço e total saem das respostas para quem não vê valores.

import { z } from 'zod';
import { IMPORT_BATCH, importKey, newImportItems, separateMixedOrders } from '../core/importProduction';
import { isbnDigits, isbnProblem } from '../core/isbn';
import { isValidUnitPrice } from '../core/money';
import { itemForViewer, normalizeOrderCode, orderOwners, orderSupplierProblem, searchKey, titleKey, type Item, type ItemStatus, type PurchaseOrder, type Supplier } from '../core/items';
import { can } from '../core/roles';
import type { BillUnit } from '../core/billUnits';
import { onlyShipped, salesArrivals, withoutSuppliers } from '../core/shippedItems';
import { cleanSpecification, latestSpecification, SPECIFICATION_MAX } from '../core/specification';
import { MAX_PARCELS, readStoredPlan, shipPlanProblem, shipPlanText, sortPlan, type ShipPlan } from '../core/shipPlan';
import { changedInAppText, checkSheetPatch, SHEET_FIELD_LABELS, SHEET_FIELDS, sheetValues, type SheetField, type SheetValues } from '../core/updateSheet';
import { NO_PRELO, NO_PRELO_LOCKED } from '../core/noPrelo';
import { planAssignments, sameProduct } from '../core/allocation';
import { parseDate, spDate, type Bill, type Invoice, type Payment } from '../core/shipments';
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
const specification = z
  .string()
  .max(SPECIFICATION_MAX + 2000, 'A especificação pode ter no máximo 4.000 caracteres.')
  .transform(cleanSpecification);

/** Data de um campo do item: AAAA-MM-DD ou vazia (null). */
export const itemDay = (label: string) =>
  z
    .string({ error: `${label}: data inválida.` })
    .max(20, `${label}: data inválida.`)
    .nullable()
    .transform((s, ctx) => {
      const t = (s ?? '').trim();
      if (!t) return null;
      if (parseDate(t) !== t) {
        ctx.addIssue({ code: 'custom', message: `${label}: data inválida.` });
        return z.NEVER;
      }
      return t;
    });
const fileApprovedAt = itemDay('Aprovação do arquivo');
/** Programação de envio: até três embarques, com o mês (AAAA-MM) e a quantidade. */
export const shipPlanSchema = z
  .array(
    z.object({
      month: z.string({ error: 'Escolha o mês de cada embarque.' }).regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Escolha o mês de cada embarque.'),
      quantity: z.number({ error: 'Informe a quantidade de cada embarque.' }).int('A quantidade do embarque é um número inteiro.').positive('Informe a quantidade de cada embarque.').max(100_000_000, 'Quantidade grande demais.'),
    }),
    { error: 'Programação de envio inválida.' },
  )
  .max(MAX_PARCELS, `No máximo ${MAX_PARCELS} embarques na programação de envio.`);

const itemFields = {
  description,
  isbn: isbn.default(null),
  supplier: supplier.default(null),
  orderCode: orderCode.default(null),
  quantity,
  piecesPerCarton: piecesPerCarton.default(null),
  unitPriceMicros: unitPriceMicros.default(null),
  notes: notes.default(''),
  specification: specification.default(''),
  fileApprovedAt: fileApprovedAt.default(null),
  shipPlan: shipPlanSchema.default([]),
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
    specification,
    fileApprovedAt,
    shipPlan: shipPlanSchema,
  })
  .partial()
  .refine((b) => Object.keys(b).length > 0, 'Nada para alterar.');

const importBody = z.object({
  items: z
    .array(z.object({ ...itemFields, row: z.number().int().min(1) }))
    .min(1, 'A planilha não tem itens.')
    .max(IMPORT_BATCH, `Envie no máximo ${IMPORT_BATCH} itens por vez.`),
});

/** Marca de um campo no código do item (updateSheet.ts). */
const sheetMark = z.string().regex(/^[0-9a-z]{6}$/, 'Código do item inválido.');

/** Atualizar pela planilha: só os campos que mudaram, cada um com a marca do download. */
const sheetUpdateBody = z.object({
  items: z
    .array(
      z
        .object({
          id: z.string().min(1).max(64),
          row: z.number().int().min(1),
          fileApprovedAt: fileApprovedAt.optional(),
          shipPlan: shipPlanSchema.optional(),
          notes: notes.optional(),
          marks: z.object({ fileApprovedAt: sheetMark.optional(), shipPlan: sheetMark.optional(), notes: sheetMark.optional() }),
        })
        .refine((i) => SHEET_FIELDS.some((f) => i[f] !== undefined), 'Nada para alterar.'),
    )
    .min(1, 'Nenhum item para atualizar.')
    .max(IMPORT_BATCH, `Envie no máximo ${IMPORT_BATCH} itens por vez.`),
});

const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida.')
  .refine((t) => !Number.isNaN(Date.parse(`${t}T00:00:00Z`)), 'Data inválida.')
  .nullable();

const orderBody = z.object({
  code: orderCode.refine((c) => c !== null, 'Informe o número da PO (como PO-065).'),
  supplier: supplier.refine((t) => t !== null, 'Informe o fornecedor.'),
  orderedAt: day.default(null),
  items: z
    .array(
      z.object({
        description,
        isbn: isbn.default(null),
        quantity,
        piecesPerCarton: piecesPerCarton.default(null),
        unitPriceMicros: unitPriceMicros.default(null),
        notes: notes.default(''),
        specification: specification.default(''),
        shipPlan: shipPlanSchema.default([]),
        row: z.number().int().min(1),
      }),
    )
    .min(1, 'A PO não tem itens.')
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
  file_approved_at: string | null;
  file_approved_from: string | null;
  ship_plan: string;
  created_at: string;
  updated_at: string;
}

export const ITEM_SELECT = `SELECT i.id, i.product_id, p.isbn, i.description, i.supplier_id, i.purchase_order_id, i.invoice_id, i.status, i.quantity,
       i.pieces_per_carton, i.unit_price_micros, i.notes, i.file_approved_at, i.file_approved_from, i.ship_plan, i.created_at, i.updated_at
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
    fileApprovedAt: row.file_approved_at,
    fileApprovedFrom: row.file_approved_from,
    shipPlan: readStoredPlan(row.ship_plan),
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

export type ItemFieldsInput = Pick<ItemInput, 'description' | 'quantity' | 'piecesPerCarton' | 'unitPriceMicros' | 'notes'> & {
  specification?: string;
  fileApprovedAt?: string | null;
  /** De onde veio a aprovação do arquivo ('noprelo'); a parte que embarca leva junto. */
  fileApprovedFrom?: string | null;
  shipPlan?: ShipPlan;
};

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
                              unit_price_micros, notes, specification, file_approved_at, file_approved_from, ship_plan, created_at, created_by, updated_at, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
    input.specification ?? '',
    input.fileApprovedAt ?? null,
    input.fileApprovedFrom ?? null,
    JSON.stringify(sortPlan(input.shipPlan ?? [])),
    at,
    userId,
    at,
    userId,
  );
}

// ---------- Rotas ----------

/** As colunas da unidade do BL na invoice (migração 0016). */
export interface UnitColumns {
  container: string;
  container_seal: string;
  container_kind: string;
  container_cartons: number | null;
  container_weight_grams: number | null;
  container_volume_liters: number | null;
}

/** A unidade da invoice, ou null quando ainda não se sabe o container. */
export function unitOf(r: UnitColumns): BillUnit | null {
  if (!r.container) return null;
  return { container: r.container, seal: r.container_seal, kind: r.container_kind, cartons: r.container_cartons, weightGrams: r.container_weight_grams, volumeLiters: r.container_volume_liters };
}

/** Quantos dias os embarques que chegaram continuam na tela de embarques (depois, vão para o histórico). */
export const RECENT_ARRIVAL_DAYS = 60;

/**
 * Tudo o que as telas usam numa consulta só: fornecedores, POs, itens em produção e embarcados (e os
 * que chegaram nos últimos 60 dias), BLs, invoices e pagamentos. O leitor não recebe preço, total nem
 * pagamentos.
 */
async function loadData(env: Env, session: Session, now: Date) {
  const seeValues = can(session.user.role, 'see_values');
  // O perfil Embarques, que o marketing usa, não vê os fornecedores (24/11/2026): getData tira.
  const seeSuppliers = can(session.user.role, 'see_supplier_names');
  const today = spDate(now);
  const cutoff = new Date(Date.parse(`${today}T00:00:00Z`) - RECENT_ARRIVAL_DAYS * 86_400_000).toISOString().slice(0, 10);
  const [s, o, i, b, v, pay, docs] = await env.DB.batch([
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
      `SELECT v.id, v.number, v.ref, v.supplier_id, v.bill_of_lading_id, v.eta, v.arrived_at, v.notes,
              v.container, v.container_seal, v.container_kind, v.container_cartons, v.container_weight_grams, v.container_volume_liters
         FROM invoices v LEFT JOIN bills_of_lading b ON b.id = v.bill_of_lading_id
        WHERE COALESCE(v.arrived_at, b.arrived_at) >= ?
           OR (COALESCE(v.arrived_at, b.arrived_at) IS NULL
               AND NOT EXISTS (SELECT 1 FROM order_items i WHERE i.invoice_id = v.id AND i.status = 'entregue' AND i.deleted_at IS NULL))`,
    ).bind(cutoff),
    env.DB.prepare('SELECT id, invoice_id, paid_at, amount_cents, exchange_rate_e4, notes FROM payments ORDER BY created_at, rowid'),
    env.DB.prepare('SELECT bill_of_lading_id, name, size FROM bill_documents'),
  ]);
  const documents = new Map((docs!.results as { bill_of_lading_id: string; name: string; size: number }[]).map((d) => [d.bill_of_lading_id, { name: d.name, size: d.size }]));
  const suppliers: Supplier[] = s!.results as Supplier[];
  const orders: PurchaseOrder[] = (o!.results as { id: string; code: string; ordered_at: string | null; notes: string }[]).map((r) => ({
    id: r.id,
    code: r.code,
    orderedAt: r.ordered_at,
    notes: r.notes,
  }));
  const items = (i!.results as ItemRow[]).map((r) => itemForViewer(toItem(r), seeValues));
  const invoiceRows = v!.results as ({ id: string; number: string; ref: string; supplier_id: string | null; bill_of_lading_id: string | null; eta: string | null; arrived_at: string | null; notes: string } & UnitColumns)[];
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
    document: documents.get(r.id) ?? null,
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
    unit: unitOf(r),
  }));
  const shown = new Set(invoices.map((x) => x.id));
  const payments: Payment[] = seeValues
    ? (pay!.results as { id: string; invoice_id: string; paid_at: string | null; amount_cents: number | null; exchange_rate_e4: number | null; notes: string }[])
        .filter((r) => shown.has(r.invoice_id))
        .map((r) => ({ id: r.id, invoiceId: r.invoice_id, paidAt: r.paid_at, amountCents: r.amount_cents, exchangeRateE4: r.exchange_rate_e4, notes: r.notes }))
    : [];
  return { today, suppliers, orders, items, bills, invoices, payments, seeValues, seeSuppliers };
}

async function getData(env: Env, session: Session, now: Date): Promise<Response> {
  // Vendas não recebe a tela de embarques completa: só a lista de /api/sales.
  if (!can(session.user.role, 'view_shipments')) return error(403, 'Seu perfil vê só a lista de produtos a caminho.');
  const all = await loadData(env, session, now);
  // O perfil Embarques recebe só os embarques a caminho (o servidor corta; a tela só esconde as abas),
  // e sem os fornecedores, nem nas observações (24/11/2026).
  const shown = can(session.user.role, 'view_all') ? all : onlyShipped(all);
  return json(all.seeSuppliers ? shown : withoutSuppliers(shown));
}

/** Lista para Vendas (SPEC.md, seção 4): produto e previsão de chegada, nada mais. */
async function getSales(env: Env, session: Session, now: Date): Promise<Response> {
  const all = await loadData(env, session, now);
  return json({ today: all.today, rows: salesArrivals(all.items, all.invoices, all.bills, all.today) });
}

async function createItem(request: Request, env: Env, session: Session, now: Date): Promise<Response> {
  checkMutation(request);
  const input = await readBody(request, createItemBody);
  const planProblem = shipPlanProblem(input.shipPlan, input.quantity);
  if (planProblem) return error(400, planProblem);
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
  specification: 'Especificação',
  fileApprovedAt: 'Aprovação do arquivo',
  shipPlan: 'Programação de envio',
};

async function updateItem(request: Request, env: Env, session: Session, id: string, now: Date): Promise<Response> {
  checkMutation(request);
  const body = await readBody(request, updateItemBody);
  const before = await findItem(env, id);
  if (!before) return error(404, 'Item não encontrado.');
  const at = now.toISOString();
  const refs = await loadRefs(env, at);

  const [names, codes, spec] = await env.DB.batch([
    env.DB.prepare('SELECT name FROM suppliers WHERE id = ?').bind(before.supplierId),
    env.DB.prepare('SELECT code FROM purchase_orders WHERE id = ?').bind(before.purchaseOrderId),
    env.DB.prepare('SELECT specification FROM order_items WHERE id = ?').bind(id),
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
    specification: (spec!.results[0] as { specification: string } | undefined)?.specification ?? '',
    fileApprovedAt: before.fileApprovedAt ?? null,
    shipPlan: before.shipPlan ?? [],
  };
  // A aprovação do arquivo que veio do No Prelo só muda lá (decidido em 19/11/2026).
  if (body.fileApprovedAt !== undefined && body.fileApprovedAt !== old.fileApprovedAt && before.fileApprovedFrom === NO_PRELO) {
    return error(409, NO_PRELO_LOCKED);
  }
  const next = { ...old, ...body, shipPlan: sortPlan(body.shipPlan ?? old.shipPlan) };
  // A programação não pode somar mais que a quantidade (que também pode ter mudado agora).
  if (body.shipPlan !== undefined || body.quantity !== undefined) {
    const problem = shipPlanProblem(next.shipPlan, next.quantity);
    if (problem) return error(400, problem);
  }
  // A programação entra no histórico como texto ("dez/2026: 20.000; fev/2027: 20.000").
  const value = (from: typeof old, k: string) => (k === 'shipPlan' ? shipPlanText(from.shipPlan) : from[k as keyof typeof old]);
  const changes = Object.keys(TRACKED)
    .filter((k) => {
      const a = value(old, k);
      const b = value(next, k);
      // "sara" e "Sara" são o mesmo fornecedor.
      if (k === 'supplier') return (a ? searchKey(String(a)) : null) !== (b ? searchKey(String(b)) : null);
      return a !== b;
    })
    .map((k) => ({ field: TRACKED[k], from: value(old, k), to: value(next, k) }));
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
              unit_price_micros = ?, notes = ?, specification = ?, file_approved_at = ?, ship_plan = ?, updated_at = ?, updated_by = ?
        WHERE id = ?`,
    ).bind(
      productId,
      next.description,
      supplierId,
      orderId,
      next.quantity,
      next.piecesPerCarton,
      next.unitPriceMicros,
      next.notes,
      next.specification,
      next.fileApprovedAt,
      JSON.stringify(next.shipPlan),
      at,
      session.user.id,
      id,
    ),
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

/** O valor de um campo como entra no histórico do item (o mesmo formato da ficha). */
function historyValue(field: SheetField, v: SheetValues): string | null {
  if (field === 'shipPlan') return shipPlanText(v.shipPlan);
  return field === 'fileApprovedAt' ? v.fileApprovedAt : v.notes;
}

/**
 * Atualizar pela planilha (19/11/2026): grava a aprovação do arquivo, a programação de envio e as
 * observações que mudaram na lista baixada, só de itens em produção. Um campo só muda se, no app, ele
 * está como no download (a marca do código do item bate); senão o item é pulado, para não desfazer a
 * mudança de outra pessoa. Cada item gravado ganha a mudança no histórico.
 */
async function updateItemsFromSheet(request: Request, env: Env, session: Session, now: Date): Promise<Response> {
  checkMutation(request);
  const body = await readBody(request, sheetUpdateBody);
  const ids = [...new Set(body.items.map((i) => i.id))];
  if (ids.length !== body.items.length) return error(400, 'O mesmo item aparece duas vezes.');
  // Os itens numa consulta só (o D1 aceita no máximo 100 valores por consulta, por isso a lista vai em JSON).
  const { results } = await env.DB.prepare(`${ITEM_SELECT} WHERE i.id IN (SELECT value FROM json_each(?)) AND i.deleted_at IS NULL`)
    .bind(JSON.stringify(ids))
    .all<ItemRow>();
  const byId = new Map(results.map((r) => [r.id, toItem(r)]));
  const at = now.toISOString();
  const statements: D1PreparedStatement[] = [];
  const skipped: { row: number; message: string }[] = [];
  for (const input of body.items) {
    const item = byId.get(input.id);
    if (!item) {
      skipped.push({ row: input.row, message: 'O item não está mais no app (pode ter sido excluído).' });
      continue;
    }
    const name = `"${item.description}"`;
    if (item.status !== 'producao') {
      skipped.push({ row: input.row, message: `${name} não está mais em produção.` });
      continue;
    }
    const before = sheetValues(item);
    if (input.fileApprovedAt !== undefined && input.fileApprovedAt !== before.fileApprovedAt && item.fileApprovedFrom === NO_PRELO) {
      skipped.push({ row: input.row, message: `${name}: ${NO_PRELO_LOCKED.charAt(0).toLowerCase()}${NO_PRELO_LOCKED.slice(1)}` });
      continue;
    }
    const check = checkSheetPatch({ ...before, quantity: item.quantity }, { fileApprovedAt: input.fileApprovedAt, shipPlan: input.shipPlan, notes: input.notes }, input.marks);
    if ('conflict' in check) {
      skipped.push({ row: input.row, message: `${name}: ${changedInAppText(check.conflict)} enquanto a planilha era conferida. Baixe a lista de novo e confira.` });
      continue;
    }
    if ('problem' in check) {
      skipped.push({ row: input.row, message: `${name}: ${check.problem.charAt(0).toLowerCase()}${check.problem.slice(1)}` });
      continue;
    }
    if (check.changed.length === 0) continue;
    const changes = check.changed.map((f) => ({ field: SHEET_FIELD_LABELS[f], from: historyValue(f, before), to: historyValue(f, check.next) }));
    statements.push(
      env.DB.prepare(
        `UPDATE order_items SET file_approved_at = ?, ship_plan = ?, notes = ?, updated_at = ?, updated_by = ?
          WHERE id = ? AND status = 'producao' AND deleted_at IS NULL`,
      ).bind(check.next.fileApprovedAt, JSON.stringify(check.next.shipPlan), check.next.notes, at, session.user.id, item.id),
      eventStatement(env, item.id, session.user.id, 'changed', { changes, source: 'planilha', row: input.row }, at),
    );
  }
  if (statements.length) await env.DB.batch(statements);
  return json({ updated: statements.length / 2, skipped });
}

async function importProduction(request: Request, env: Env, session: Session, now: Date): Promise<Response> {
  checkMutation(request);
  const body = await readBody(request, importBody);
  const badPlan = body.items.map((i) => ({ row: i.row, problem: shipPlanProblem(i.shipPlan, i.quantity) })).find((p) => p.problem);
  if (badPlan) return error(400, `Linha ${badPlan.row}: ${badPlan.problem}`);
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

/**
 * Novo pedido (SPEC.md, seção 3): a PO que a editora mandou ao fornecedor entra inteira na produção.
 * Uma PO que já tem itens não entra de novo (para acrescentar, use Novo item).
 */
async function createOrder(request: Request, env: Env, session: Session, now: Date): Promise<Response> {
  checkMutation(request);
  const body = await readBody(request, orderBody);
  const code = body.code!;
  const badPlan = body.items.map((i) => ({ row: i.row, problem: shipPlanProblem(i.shipPlan, i.quantity) })).find((p) => p.problem);
  if (badPlan) return error(400, `Linha ${badPlan.row}: ${badPlan.problem}`);
  const existing = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM order_items i JOIN purchase_orders o ON o.id = i.purchase_order_id WHERE o.code = ? AND i.deleted_at IS NULL`,
  )
    .bind(code)
    .first<{ n: number }>();
  if (existing && existing.n > 0) {
    return error(409, `A ${code} já está cadastrada, com ${existing.n} ${existing.n === 1 ? 'item' : 'itens'}. Para acrescentar itens, use Novo item.`);
  }
  const at = now.toISOString();
  const userId = session.user.id;
  const refs = await loadRefs(env, at);
  const supplierId = refs.supplier(body.supplier);
  const orderId = refs.order(code)!;
  const statements: D1PreparedStatement[] = [];
  for (const input of body.items) {
    const id = crypto.randomUUID();
    statements.push(insertItem(env, id, input, { productId: refs.product(input.isbn, input.description), supplierId, orderId }, userId, at));
    statements.push(eventStatement(env, id, userId, 'created', { order: code, row: input.row }, at));
  }
  // A data do pedido fica na PO (as POs da carga da planilha não têm).
  if (body.orderedAt) statements.push(env.DB.prepare('UPDATE purchase_orders SET ordered_at = ? WHERE id = ?').bind(body.orderedAt, orderId));
  await env.DB.batch([...refs.statements, ...statements]);
  return json({ orderId, inserted: body.items.length }, 201);
}

const specificationsBody = z.object({
  items: z
    .array(z.object({ description, isbn: isbn.default(null), quantity: quantity.optional(), specification: specification.default(''), shipPlan: shipPlanSchema.default([]) }))
    .min(1, 'A PO não tem itens.')
    .max(IMPORT_BATCH, `Envie no máximo ${IMPORT_BATCH} itens por vez.`),
});

/**
 * Especificação do item e a última do produto (a reimpressão remete à compra anterior). Carregada ao
 * abrir a ficha do item, para as listas não carregarem esses textos longos.
 */
async function getSpecification(env: Env, id: string): Promise<Response> {
  const item = await env.DB.prepare('SELECT product_id, specification FROM order_items WHERE id = ? AND deleted_at IS NULL').bind(id).first<{ product_id: string; specification: string }>();
  if (!item) return error(404, 'Item não encontrado.');
  const { results } = await env.DB.prepare(
    `SELECT i.specification, i.created_at, o.code AS order_code FROM order_items i LEFT JOIN purchase_orders o ON o.id = i.purchase_order_id
      WHERE i.product_id = ? AND i.deleted_at IS NULL AND i.specification <> ''`,
  )
    .bind(item.product_id)
    .all<{ specification: string; created_at: string; order_code: string | null }>();
  const latest = latestSpecification(results.map((r) => ({ specification: r.specification, createdAt: r.created_at, orderCode: r.order_code })));
  return json({ specification: item.specification, latest });
}

/**
 * PO já cadastrada, com o arquivo de novo (as que entraram antes destes campos): cada linha do arquivo
 * guarda a especificação nos itens do mesmo produto naquela PO, em produção, no mar ou já entregues, e a
 * programação de envio num item em produção do mesmo produto que ainda não tem (planAssignments). A
 * programação gravada entra no histórico do item.
 */
async function saveOrderSpecifications(request: Request, env: Env, session: Session, code: string, now: Date): Promise<Response> {
  checkMutation(request);
  const body = await readBody(request, specificationsBody);
  const normalized = normalizeOrderCode(code);
  if (!normalized) return error(400, 'Código de PO inválido.');
  const { results } = await env.DB.prepare(
    `SELECT i.id, p.isbn, i.description, i.status, i.quantity, i.ship_plan FROM order_items i
       JOIN products p ON p.id = i.product_id JOIN purchase_orders o ON o.id = i.purchase_order_id
      WHERE o.code = ? AND i.deleted_at IS NULL`,
  )
    .bind(normalized)
    .all<{ id: string; isbn: string | null; description: string; status: ItemStatus; quantity: number; ship_plan: string }>();
  if (results.length === 0) return error(404, `A ${normalized} não tem itens cadastrados.`);
  const at = now.toISOString();
  const userId = session.user.id;
  const statements: D1PreparedStatement[] = [];
  const updated = new Set<string>();
  for (const line of body.items) {
    if (!line.specification) continue;
    for (const item of results) {
      if (updated.has(item.id) || !sameProduct(line, item)) continue;
      updated.add(item.id);
      statements.push(env.DB.prepare('UPDATE order_items SET specification = ?, updated_at = ?, updated_by = ? WHERE id = ?').bind(line.specification, at, userId, item.id));
    }
  }
  const plans = planAssignments(
    body.items.map((l) => ({ ...l, quantity: l.quantity ?? 0 })),
    results.map((r) => ({ ...r, shipPlan: readStoredPlan(r.ship_plan) })),
  );
  for (const { itemId, plan } of plans.assign) {
    statements.push(
      env.DB.prepare('UPDATE order_items SET ship_plan = ?, updated_at = ?, updated_by = ? WHERE id = ?').bind(JSON.stringify(sortPlan(plan)), at, userId, itemId),
      eventStatement(env, itemId, userId, 'changed', { changes: [{ field: TRACKED.shipPlan, from: '', to: shipPlanText(plan) }], source: 'pedido', order: normalized }, at),
    );
  }
  if (statements.length) await env.DB.batch(statements);
  return json({ updated: updated.size, items: results.length, planned: plans.assign.length, kept: plans.kept, notFit: plans.notFit });
}

export async function routeOrders(request: Request, env: Env, session: Session, key: string, path: string, now: Date): Promise<Response | null> {
  const role = session.user.role;
  if (key === 'GET /api/data') return getData(env, session, now);
  if (key === 'GET /api/sales') {
    // A lista é de toda a equipe; o Agente, que é de fora, não recebe.
    if (!can(role, 'view')) return error(403, 'Seu perfil vê só as solicitações de embarque.');
    return getSales(env, session, now);
  }

  if (key === 'POST /api/import/production') {
    if (!can(role, 'import')) return error(403, 'Só o admin faz a carga da planilha.');
    return importProduction(request, env, session, now);
  }

  if (key === 'POST /api/orders') {
    if (!can(role, 'edit')) return error(403, 'Seu perfil só pode acompanhar.');
    return createOrder(request, env, session, now);
  }
  const specs = /^\/api\/orders\/([^/]+)\/specifications$/.exec(path);
  if (specs && request.method === 'POST') {
    if (!can(role, 'edit')) return error(403, 'Seu perfil só pode acompanhar.');
    return saveOrderSpecifications(request, env, session, decodeURIComponent(specs[1]!), now);
  }
  const itemSpec = /^\/api\/items\/([^/]+)\/specification$/.exec(path);
  if (itemSpec && request.method === 'GET') {
    if (!can(role, 'view_shipments')) return error(403, 'Seu perfil vê só a lista de produtos a caminho.');
    return getSpecification(env, decodeURIComponent(itemSpec[1]!));
  }
  if (key === 'POST /api/items') {
    if (!can(role, 'edit')) return error(403, 'Seu perfil só pode acompanhar.');
    return createItem(request, env, session, now);
  }
  if (key === 'PATCH /api/items') {
    if (!can(role, 'edit')) return error(403, 'Seu perfil só pode acompanhar.');
    return updateItemsFromSheet(request, env, session, now);
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
