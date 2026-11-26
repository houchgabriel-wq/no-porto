import { beforeEach, describe, expect, it } from 'vitest';
import { arrivalsSince } from './noEstoque';
import { testApp } from './test-api';

let app: ReturnType<typeof testApp>;
let who: Awaited<ReturnType<ReturnType<typeof testApp>['accounts']>>;

beforeEach(async () => {
  app = testApp();
  who = await app.accounts();
});

const item = (over: object) => ({ description: 'Livro', isbn: null, supplier: 'Miyi', orderCode: 'PO-063', quantity: 1000, piecesPerCarton: null, unitPriceMicros: 500_000, notes: '', ...over });

async function create(over: object): Promise<string> {
  const res = await app.call('POST', '/api/items', { cookie: who.editor.cookie, body: item(over) });
  expect(res.status).toBe(201);
  return res.data.item.id as string;
}

async function ship(itemIds: string[], newInvoice: object): Promise<string> {
  const res = await app.call('POST', '/api/ship', { cookie: who.editor.cookie, body: { lines: itemIds.map((itemId) => ({ itemId, quantity: 1000 })), newInvoice } });
  expect(res.status).toBe(201);
  return res.data.invoiceId as string;
}

const billId = async () => (await app.call('GET', '/api/data', { cookie: who.admin.cookie })).data.bills[0].id as string;

describe('porta do No Estoque', () => {
  it('manda as invoices que chegaram a partir do dia, com os itens e sem valores', async () => {
    const a = await create({ description: 'Coleção 101 Palavras', isbn: '978-65-5547-866-2', piecesPerCarton: 20 });
    const b = await create({ description: 'Ágape', isbn: '9788543230139', piecesPerCarton: 40 });
    const invoiceId = await ship([a, b], { number: '2026-47B', ref: '2026-10-13 (2)', bill: 'ROECHN26101769', eta: '2026-11-26' });
    // A caminho: ainda não vai.
    expect(await arrivalsSince(app.env, '2026-11-01')).toEqual([]);
    await app.call('PATCH', `/api/bills/${await billId()}`, { cookie: who.editor.cookie, body: { arrivedAt: '2026-11-17' } });
    const out = await arrivalsSince(app.env, '2026-11-01');
    expect(out).toEqual([
      {
        id: invoiceId,
        arrivedAt: '2026-11-17',
        supplier: 'Miyi',
        invoice: '2026-47B',
        ref: '2026-10-13 (2)',
        bill: 'ROECHN26101769',
        container: '',
        containerKind: '',
        cartons: null,
        items: [
          { barcode: '9786555478662', title: 'Coleção 101 Palavras', quantity: 1000, piecesPerCarton: 20 },
          { barcode: '9788543230139', title: 'Ágape', quantity: 1000, piecesPerCarton: 40 },
        ],
      },
    ]);
    expect(JSON.stringify(out)).not.toMatch(/price|micros|cents|500000/i);
    // Antes do dia pedido, não vai; desmarcar a chegada tira da lista.
    expect(await arrivalsSince(app.env, '2026-11-18')).toEqual([]);
    await app.call('PATCH', `/api/bills/${await billId()}`, { cookie: who.editor.cookie, body: { arrivedAt: null } });
    expect(await arrivalsSince(app.env, '2026-11-01')).toEqual([]);
  });

  it('a invoice sem BL vale pela própria chegada; o item excluído não vai', async () => {
    const a = await create({ description: 'Ecobag' });
    const b = await create({ description: 'Excluído' });
    const invoiceId = await ship([a, b], { number: '108', ref: '', bill: null, eta: '2026-11-21' });
    await app.call('PATCH', `/api/invoices/${invoiceId}`, { cookie: who.editor.cookie, body: { arrivedAt: '2026-11-20' } });
    await app.env.DB.prepare('UPDATE order_items SET deleted_at = ? WHERE id = ?').bind('2026-11-20T10:00:00Z', b).run();
    const [arrival] = await arrivalsSince(app.env, '2026-11-20');
    expect(arrival).toMatchObject({ id: invoiceId, invoice: '108', bill: null, arrivedAt: '2026-11-20', items: [{ barcode: null, title: 'Ecobag', quantity: 1000, piecesPerCarton: null }] });
  });

  it('recusa dia em outro formato', async () => {
    await expect(arrivalsSince(app.env, '20/11/2026')).rejects.toThrow('Dia inválido');
  });
});
