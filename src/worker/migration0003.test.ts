// A migração 0003 roda sobre dados que já existiam: aqui, os dados entram antes e a migração roda de novo.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeEach, expect, it } from 'vitest';
import { testApp } from './test-api';

const sql = readFileSync(fileURLToPath(new URL('../../migrations/0003_price_decimals_and_po_supplier.sql', import.meta.url).href), 'utf8');

let app: ReturnType<typeof testApp>;
let who: Awaited<ReturnType<ReturnType<typeof testApp>['accounts']>>;

beforeEach(async () => {
  app = testApp();
  who = await app.accounts();
});

async function insert(description: string, supplier: string, po: string, price: number | null, at: string) {
  const db = app.env.DB;
  await db.prepare('INSERT OR IGNORE INTO suppliers (id, name, created_at) VALUES (?, ?, ?)').bind(supplier, supplier, at).run();
  await db.prepare('INSERT OR IGNORE INTO purchase_orders (id, code, created_at) VALUES (?, ?, ?)').bind(po, po, at).run();
  await db.prepare('INSERT INTO products (id, isbn, title, title_key, created_at) VALUES (?, NULL, ?, ?, ?)').bind(description, description, description, at).run();
  await db
    .prepare(
      `INSERT INTO order_items (id, product_id, description, supplier_id, purchase_order_id, status, quantity, unit_price_micros, notes, created_at, created_by, updated_at, updated_by)
       VALUES (?, ?, ?, ?, ?, 'producao', 1000, ?, '', ?, ?, ?, ?)`,
    )
    .bind(description, description, description, supplier, po, price, at, who.admin.id, at, who.admin.id)
    .run();
}

it('arredonda os preços e tira da PO os itens de outro fornecedor, com histórico', async () => {
  await insert('A', 'Claire', 'PO-063', 653_924, '2026-11-17T10:00:00Z');
  await insert('B', 'Sara', 'PO-063', 575_000, '2026-11-17T10:00:01Z');
  await insert('C', 'Sara', 'PO-063', 395_749, '2026-11-17T10:00:02Z');
  await insert('D', 'Sara', 'PO-067', null, '2026-11-17T10:00:03Z');
  await insert('E', 'Nicola', 'PO-067', 820_000, '2026-11-17T10:00:04Z');

  await app.env.DB.exec(sql);

  const { results } = await app.env.DB.prepare('SELECT id, purchase_order_id AS po, unit_price_micros AS price, notes FROM order_items ORDER BY id').all<{ id: string; po: string | null; price: number | null; notes: string }>();
  expect(results).toEqual([
    // Sara tem dois itens na PO-063, Claire um: o da Claire sai.
    { id: 'A', po: null, price: 654_000, notes: 'PO na planilha: PO-063 (a PO é de Sara)' },
    { id: 'B', po: 'PO-063', price: 575_000, notes: '' },
    { id: 'C', po: 'PO-063', price: 396_000, notes: '' },
    // Empate na PO-067: fica o fornecedor do item cadastrado primeiro (Sara).
    { id: 'D', po: 'PO-067', price: null, notes: '' },
    { id: 'E', po: null, price: 820_000, notes: 'PO na planilha: PO-067 (a PO é de Sara)' },
  ]);
  const events = await app.env.DB.prepare("SELECT entity_id, detail FROM events WHERE type = 'changed' ORDER BY entity_id, detail").all<{ entity_id: string; detail: string }>();
  expect(events.results.map((e) => [e.entity_id, JSON.parse(e.detail).changes[0].field])).toEqual([
    ['A', 'PO'],
    ['A', 'Preço unitário'],
    ['C', 'Preço unitário'],
    ['E', 'PO'],
  ]);
  // As tabelas de apoio não ficam no banco.
  expect(await app.env.DB.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name LIKE '\\_%' ESCAPE '\\'").first<{ n: number }>()).toEqual({ n: 0 });
});
