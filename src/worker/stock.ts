// Previsão de estoque (pedido do Gabriel em 20/11/2026): guarda a curva ABC da semana e entrega, para a
// tela calcular a previsão (src/core/stockForecast.ts), a curva e o que o No Porto tem de cada título (o
// que está embarcado e o que está em produção). Veem admin, editor, consulta e leitor; carregam a curva
// admin e editor. O perfil Embarques, Vendas e o Agente de cargas, que é de fora, não recebem nada daqui.
// Só quantidades: a curva chega sem os valores em dinheiro, e nada de preço sai daqui.

import { z } from 'zod';
import type { ItemStatus } from '../core/items';
import { can } from '../core/roles';
import { readStoredPlan } from '../core/shipPlan';
import { parseDate, spDate } from '../core/shipments';
import { CURVE_MAX_ROWS, type CurveInfo, type CurveRow } from '../core/stockCurve';
import { forecastSummary, holdingsFor, stockForecast, titleHoldings, type TitleHolding } from '../core/stockForecast';
import type { Session } from './auth';
import type { Env } from './env';
import { checkMutation, error, json, readBody } from './http';

/** Tamanho máximo do pedido de carga (a curva de 19/11/2026, com 2.457 títulos, tem uns 450 KB). */
const MAX_LOAD_BYTES = 6_000_000;
/** Tamanho máximo da curva guardada: um valor do D1 vai até 2 MB. */
const MAX_STORED_CHARS = 1_900_000;

const count = (label: string) => z.number({ error: `${label} inválido.` }).int(`${label} inválido.`).min(0, `${label} inválido.`).max(1_000_000_000, `${label} inválido.`);

const curveRow = z.object({
  isbn: z.string({ error: 'Código de barras inválido.' }).regex(/^(\d{8}|\d{12}|\d{13})$/, 'Código de barras inválido.'),
  title: z
    .string({ error: 'Título inválido.' })
    .max(300, 'O título pode ter no máximo 300 caracteres.')
    .transform((s) => s.replace(/\s+/g, ' ').trim())
    .pipe(z.string().min(1, 'Há um título sem nome.')),
  code: z.string({ error: 'Código do produto inválido.' }).max(200, 'Código do produto inválido.').default(''),
  abcClass: z.string({ error: 'Classe inválida.' }).max(2, 'Classe inválida.').default(''),
  stock: count('Estoque'),
  sales: z.object({
    m1: count('Venda de 1 mês').nullable(),
    m3: count('Venda de 3 meses'),
    m6: count('Venda de 6 meses'),
    m9: count('Venda de 9 meses').nullable(),
    m12: count('Venda de 12 meses').nullable(),
  }),
});

const loadBody = z.object({
  stockDate: z.string({ error: 'Informe a data do estoque.' }).max(20, 'Data do estoque inválida.'),
  fileName: z.string({ error: 'Nome do arquivo inválido.' }).max(200, 'Nome do arquivo inválido.').default(''),
  rows: z
    .array(curveRow, { error: 'A curva não tem nenhum título.' })
    .min(1, 'A curva não tem nenhum título.')
    .max(CURVE_MAX_ROWS, `A curva pode ter no máximo ${CURVE_MAX_ROWS.toLocaleString('pt-BR')} títulos.`),
});

/** Cada título é guardado como uma lista curta, para caber num valor do banco. */
type StoredRow = [string, string, string, string, number, number | null, number, number, number | null, number | null];

const encode = (r: CurveRow): StoredRow => [r.isbn, r.title, r.code, r.abcClass, r.stock, r.sales.m1, r.sales.m3, r.sales.m6, r.sales.m9, r.sales.m12];
const decode = (s: StoredRow): CurveRow => ({ isbn: s[0], title: s[1], code: s[2], abcClass: s[3], stock: s[4], sales: { m1: s[5], m3: s[6], m6: s[7], m9: s[8], m12: s[9] } });

async function readCurve(env: Env): Promise<{ info: CurveInfo; rows: CurveRow[] } | null> {
  const row = await env.DB.prepare(
    `SELECT c.stock_date, c.file_name, c.row_count, c.rows_json, c.created_at, u.name AS user_name
       FROM stock_curves c LEFT JOIN users u ON u.id = c.created_by
      ORDER BY c.created_at DESC LIMIT 1`,
  ).first<{ stock_date: string; file_name: string; row_count: number; rows_json: string; created_at: string; user_name: string | null }>();
  if (!row) return null;
  return {
    info: { stockDate: row.stock_date, fileName: row.file_name, rowCount: row.row_count, uploadedAt: row.created_at, uploadedBy: row.user_name ?? '' },
    rows: (JSON.parse(row.rows_json) as StoredRow[]).map(decode),
  };
}

/** O que o No Porto tem de cada título (todos os itens, como no terminal de consulta, com a data da PO). */
async function readHoldings(env: Env, stockDate: string): Promise<TitleHolding[]> {
  const { results } = await env.DB.prepare(
    `SELECT i.product_id, p.isbn, i.description, i.status, i.quantity, o.code AS order_code, o.ordered_at, i.ship_plan,
            CASE WHEN v.bill_of_lading_id IS NULL THEN v.eta ELSE b.eta END AS eta,
            COALESCE(v.arrived_at, b.arrived_at) AS arrived_at
       FROM order_items i JOIN products p ON p.id = i.product_id
       LEFT JOIN purchase_orders o ON o.id = i.purchase_order_id
       LEFT JOIN invoices v ON v.id = i.invoice_id
       LEFT JOIN bills_of_lading b ON b.id = v.bill_of_lading_id
      WHERE i.deleted_at IS NULL
      ORDER BY i.created_at, i.rowid`,
  ).all<{
    product_id: string;
    isbn: string | null;
    description: string;
    status: ItemStatus;
    quantity: number;
    order_code: string | null;
    ordered_at: string | null;
    ship_plan: string;
    eta: string | null;
    arrived_at: string | null;
  }>();
  return titleHoldings(
    results.map((r) => ({
      productId: r.product_id,
      isbn: r.isbn,
      description: r.description,
      status: r.status,
      quantity: r.quantity,
      orderCode: r.order_code,
      orderedAt: r.ordered_at,
      shipPlan: readStoredPlan(r.ship_plan),
      eta: r.eta,
      arrivedAt: r.arrived_at,
    })),
    stockDate,
  );
}

async function loadCurve(request: Request, env: Env, session: Session, now: Date): Promise<Response> {
  checkMutation(request);
  const body = await readBody(request, loadBody, MAX_LOAD_BYTES);
  const today = spDate(now);
  if (parseDate(body.stockDate) !== body.stockDate || body.stockDate < '2023-01-01') return error(400, 'Data do estoque inválida.');
  if (body.stockDate > today) return error(400, 'A data do estoque não pode ser depois de hoje.');
  const seen = new Set<string>();
  for (const r of body.rows) {
    if (seen.has(r.isbn)) return error(400, `O código ${r.isbn} aparece em mais de uma linha da curva.`);
    seen.add(r.isbn);
  }
  const stored = JSON.stringify(body.rows.map(encode));
  if (stored.length > MAX_STORED_CHARS) return error(413, 'A curva tem títulos demais para guardar.');
  // Cada carga substitui a anterior, de uma vez só.
  await env.DB.batch([
    env.DB.prepare('DELETE FROM stock_curves'),
    env.DB.prepare('INSERT INTO stock_curves (id, stock_date, file_name, row_count, rows_json, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(
      crypto.randomUUID(),
      body.stockDate,
      body.fileName,
      body.rows.length,
      stored,
      now.toISOString(),
      session.user.id,
    ),
  ]);
  return json({ stockDate: body.stockDate, rowCount: body.rows.length }, 201);
}

export async function routeStock(request: Request, env: Env, session: Session, key: string, now: Date): Promise<Response | null> {
  if (key !== 'GET /api/stock' && key !== 'GET /api/stock/summary' && key !== 'POST /api/stock') return null;
  if (!can(session.user.role, 'view_stock')) return error(403, 'Seu perfil não vê a previsão de estoque.');
  if (key === 'POST /api/stock') {
    if (!can(session.user.role, 'load_stock')) return error(403, 'Só o admin e o editor carregam a curva ABC.');
    return loadCurve(request, env, session, now);
  }
  const today = spDate(now);
  const curve = await readCurve(env);
  // O cartão do painel: só os números, calculados aqui.
  if (key === 'GET /api/stock/summary') {
    if (!curve) return json({ today, curve: null, summary: null });
    const { rows } = stockForecast({ stockDate: curve.info.stockDate, rows: curve.rows }, await readHoldings(env, curve.info.stockDate), today);
    return json({ today, curve: curve.info, summary: forecastSummary(rows, today) });
  }
  // A aba: a curva e o que o No Porto tem de cada título; a tela calcula a previsão.
  if (!curve) return json({ today, curve: null, rows: [], holdings: [] });
  const holdings = holdingsFor(curve.rows, await readHoldings(env, curve.info.stockDate));
  return json({ today, curve: curve.info, rows: curve.rows, holdings });
}
