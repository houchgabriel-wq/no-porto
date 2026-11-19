// Histórico (SPEC.md, seções 5 e 7): os itens que chegaram, desde 2023, a ficha de cada produto com
// todas as compras e a carga da aba Entregues. O leitor não recebe preço nem total.

import { z } from 'zod';
import { IMPORT_BATCH, newImportItems } from '../core/importProduction';
import { invoiceKey, shipmentKey } from '../core/importShipments';
import { isbnDigits, isbnProblem } from '../core/isbn';
import { itemForViewer } from '../core/items';
import { isValidUnitPrice } from '../core/money';
import { can } from '../core/roles';
import { cleanSpecification, latestSpecification, SPECIFICATION_MAX } from '../core/specification';
import { shipPlanProblem } from '../core/shipPlan';
import type { Session } from './auth';
import type { Env } from './env';
import { checkMutation, error, json, readBody } from './http';
import { eventStatement, insertItem, itemDay, ITEM_SELECT, loadRefs, shipPlanSchema, toItem, type ItemRow } from './orders';

const text = (max: number) => z.string().max(max).transform((s) => s.replace(/\s+/g, ' ').trim());
const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida.')
  .nullable();

const importBody = z.object({
  items: z
    .array(
      z.object({
        row: z.number().int().min(1),
        description: text(300).pipe(z.string().min(1, 'Informe o produto.')),
        isbn: z
          .string()
          .max(40)
          .nullable()
          .refine((s) => !s || isbnProblem(s) === null, 'ISBN inválido.')
          .transform((s) => (s ? isbnDigits(s) : null)),
        supplier: text(100)
          .nullable()
          .transform((s) => s || null),
        quantity: z.number().int().positive().max(100_000_000),
        piecesPerCarton: z.number().int().positive().max(1_000_000).nullable(),
        unitPriceMicros: z.number().int().min(0).max(1_000_000_000).refine(isValidUnitPrice, 'O preço unitário tem no máximo três casas decimais.').nullable(),
        notes: z.string().max(2000),
        specification: z.string().max(SPECIFICATION_MAX + 2000).transform(cleanSpecification).default(''),
        fileApprovedAt: itemDay('Aprovação do arquivo').default(null),
        shipPlan: shipPlanSchema.default([]),
        invoice: text(80).pipe(z.string().min(1, 'Informe a invoice.')),
        ref: text(60),
        bill: text(40)
          .nullable()
          .transform((s) => s || null),
        arrivedAt: day,
        arrivalNote: z.string().max(500),
        paid: z.boolean(),
      }),
    )
    .min(1, 'A planilha não tem itens.')
    .max(IMPORT_BATCH, `Envie no máximo ${IMPORT_BATCH} itens por vez.`),
});

interface InvoiceInfoRow {
  id: string;
  number: string;
  ref: string;
  supplier_id: string | null;
  bill_number: string | null;
  arrived_at: string | null;
  notes: string;
}

/** Invoice como o histórico e a ficha do produto mostram: com o número do BL e a chegada que vale. */
function invoiceInfo(r: InvoiceInfoRow) {
  return { id: r.id, number: r.number, ref: r.ref, supplierId: r.supplier_id, billNumber: r.bill_number, arrivedAt: r.arrived_at, notes: r.notes };
}

const INVOICE_INFO = `SELECT v.id, v.number, v.ref, v.supplier_id, b.number AS bill_number, COALESCE(v.arrived_at, b.arrived_at) AS arrived_at, v.notes
  FROM invoices v LEFT JOIN bills_of_lading b ON b.id = v.bill_of_lading_id`;

/** Todos os itens que chegaram, com as invoices deles. Carregado quando a pessoa abre o Histórico. */
async function getHistory(env: Env, session: Session): Promise<Response> {
  const seeValues = can(session.user.role, 'see_values');
  const [i, v, s] = await env.DB.batch([
    env.DB.prepare(`${ITEM_SELECT} WHERE i.deleted_at IS NULL AND i.status = 'entregue'`),
    env.DB.prepare(`${INVOICE_INFO} WHERE EXISTS (SELECT 1 FROM order_items i WHERE i.invoice_id = v.id AND i.status = 'entregue' AND i.deleted_at IS NULL)`),
    // Os fornecedores do histórico vêm junto: o perfil Embarques só recebe, em /api/data, os dos itens no mar.
    env.DB.prepare(
      `SELECT id, name FROM suppliers WHERE id IN (SELECT supplier_id FROM order_items WHERE status = 'entregue' AND deleted_at IS NULL) ORDER BY name COLLATE NOCASE`,
    ),
  ]);
  return json({
    items: (i!.results as ItemRow[]).map((r) => itemForViewer(toItem(r), seeValues)),
    invoices: (v!.results as InvoiceInfoRow[]).map(invoiceInfo),
    suppliers: s!.results as { id: string; name: string }[],
    seeValues,
  });
}

/** Ficha do produto: todas as compras (em produção, embarcadas e entregues), com PO, invoice e chegada. */
async function getProduct(env: Env, session: Session, id: string): Promise<Response> {
  const seeValues = can(session.user.role, 'see_values');
  const product = await env.DB.prepare('SELECT id, isbn, title FROM products WHERE id = ?').bind(id).first<{ id: string; isbn: string | null; title: string }>();
  if (!product) return error(404, 'Produto não encontrado.');
  const [i, v, o, sp] = await env.DB.batch([
    env.DB.prepare(`${ITEM_SELECT} WHERE i.deleted_at IS NULL AND i.product_id = ? ORDER BY i.created_at`).bind(id),
    env.DB.prepare(`${INVOICE_INFO} WHERE v.id IN (SELECT invoice_id FROM order_items WHERE product_id = ? AND deleted_at IS NULL)`).bind(id),
    env.DB.prepare('SELECT id, code FROM purchase_orders WHERE id IN (SELECT purchase_order_id FROM order_items WHERE product_id = ? AND deleted_at IS NULL)').bind(id),
    env.DB.prepare(
      `SELECT i.specification, i.created_at, o.code AS order_code FROM order_items i LEFT JOIN purchase_orders o ON o.id = i.purchase_order_id
        WHERE i.product_id = ? AND i.deleted_at IS NULL AND i.specification <> ''`,
    ).bind(id),
  ]);
  const specification = latestSpecification(
    (sp!.results as { specification: string; created_at: string; order_code: string | null }[]).map((r) => ({ specification: r.specification, createdAt: r.created_at, orderCode: r.order_code })),
  );
  return json({
    product,
    items: (i!.results as ItemRow[]).map((r) => itemForViewer(toItem(r), seeValues)),
    invoices: (v!.results as InvoiceInfoRow[]).map(invoiceInfo),
    orders: o!.results as { id: string; code: string }[],
    specification,
    seeValues,
  });
}

async function importHistory(request: Request, env: Env, session: Session, now: Date): Promise<Response> {
  checkMutation(request);
  const body = await readBody(request, importBody);
  const badPlan = body.items.map((i) => ({ row: i.row, problem: shipPlanProblem(i.shipPlan, i.quantity) })).find((p) => p.problem);
  if (badPlan) return error(400, `Linha ${badPlan.row}: ${badPlan.problem}`);
  const at = now.toISOString();
  const userId = session.user.id;
  const refs = await loadRefs(env, at);
  const statements: D1PreparedStatement[] = [];

  const [inv, bl, existing, paid] = await env.DB.batch([
    env.DB.prepare('SELECT v.id, v.number, v.supplier_id, b.number AS bill_number FROM invoices v LEFT JOIN bills_of_lading b ON b.id = v.bill_of_lading_id'),
    env.DB.prepare('SELECT id, number FROM bills_of_lading'),
    env.DB.prepare(
      `SELECT v.number AS invoice, b.number AS bill, p.isbn, i.description, i.quantity, i.unit_price_micros
         FROM order_items i JOIN products p ON p.id = i.product_id JOIN invoices v ON v.id = i.invoice_id
         LEFT JOIN bills_of_lading b ON b.id = v.bill_of_lading_id
        WHERE i.deleted_at IS NULL`,
    ),
    env.DB.prepare('SELECT DISTINCT invoice_id FROM payments'),
  ]);
  const invoices = new Map((inv!.results as { id: string; number: string; supplier_id: string | null; bill_number: string | null }[]).map((r) => [invoiceKey(r.supplier_id, r.number, r.bill_number), r.id]));
  const bills = new Map((bl!.results as { id: string; number: string }[]).map((r) => [r.number.toUpperCase(), r.id]));
  const withPayment = new Set((paid!.results as { invoice_id: string }[]).map((r) => r.invoice_id));
  const keys = (existing!.results as { invoice: string; bill: string | null; isbn: string | null; description: string; quantity: number; unit_price_micros: number | null }[]).map((r) =>
    shipmentKey({ invoice: r.invoice, bill: r.bill, isbn: r.isbn, description: r.description, quantity: r.quantity, unitPriceMicros: r.unit_price_micros }),
  );
  const keep = newImportItems(body.items, keys, shipmentKey);

  for (const index of keep) {
    const input = body.items[index]!;
    const supplierId = refs.supplier(input.supplier);
    const key = invoiceKey(supplierId, input.invoice, input.bill);
    let invoiceId = invoices.get(key);
    if (!invoiceId) {
      let billId: string | null = null;
      if (input.bill) {
        billId = bills.get(input.bill.toUpperCase()) ?? null;
        if (!billId) {
          billId = crypto.randomUUID();
          bills.set(input.bill.toUpperCase(), billId);
          statements.push(env.DB.prepare('INSERT INTO bills_of_lading (id, number, supplier_id, created_at) VALUES (?, ?, ?, ?)').bind(billId, input.bill, supplierId, at));
        }
      }
      // A chegada fica na invoice: os containers de um mesmo BL chegaram em dias diferentes.
      invoiceId = crypto.randomUUID();
      invoices.set(key, invoiceId);
      statements.push(
        env.DB.prepare('INSERT INTO invoices (id, number, ref, supplier_id, bill_of_lading_id, arrived_at, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(
          invoiceId,
          input.invoice,
          input.ref,
          supplierId,
          billId,
          input.arrivedAt,
          input.arrivalNote,
          at,
        ),
      );
    }
    if (input.paid && !withPayment.has(invoiceId)) {
      withPayment.add(invoiceId);
      statements.push(
        env.DB.prepare("INSERT INTO payments (id, invoice_id, notes, created_at, created_by) VALUES (?, ?, 'Pago, segundo a planilha', ?, ?)").bind(crypto.randomUUID(), invoiceId, at, userId),
      );
    }
    const id = crypto.randomUUID();
    // Tudo o que está na aba Entregues chegou, mesmo quando a planilha não diz o dia.
    statements.push(
      insertItem(env, id, input, { productId: refs.product(input.isbn, input.description), supplierId, orderId: null, invoiceId, status: 'entregue' }, userId, at),
    );
    statements.push(eventStatement(env, id, userId, 'imported', { sheet: 'Entregues', row: input.row }, at));
  }
  if (keep.length) await env.DB.batch([...refs.statements, ...statements]);
  return json({ inserted: keep.length, skipped: body.items.length - keep.length }, 201);
}

export async function routeHistory(request: Request, env: Env, session: Session, key: string, path: string, now: Date): Promise<Response | null> {
  // O histórico sai sem valores para quem não os vê; a ficha do produto não é para o perfil Embarques.
  if (key === 'GET /api/history') {
    if (!can(session.user.role, 'view_history')) return error(403, 'Seu perfil não vê o histórico.');
    return getHistory(env, session);
  }
  if (/^\/api\/products\//.test(path) && !can(session.user.role, 'view_all')) return error(403, 'Seu perfil não vê a ficha do produto.');
  if (key === 'POST /api/import/history') {
    if (!can(session.user.role, 'import')) return error(403, 'Só o admin faz a carga da planilha.');
    return importHistory(request, env, session, now);
  }
  const m = /^\/api\/products\/([^/]+)$/.exec(path);
  if (m && request.method === 'GET') return getProduct(env, session, decodeURIComponent(m[1]!));
  return null;
}
