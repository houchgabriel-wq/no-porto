import { beforeEach, describe, expect, it } from 'vitest';
import { testApp } from './test-api';

let app: ReturnType<typeof testApp>;
let who: Awaited<ReturnType<ReturnType<typeof testApp>['accounts']>>;

beforeEach(async () => {
  app = testApp();
  who = await app.accounts();
});

const item = { description: 'Livro', isbn: null, supplier: 'Sara', orderCode: 'PO-063', quantity: 1000, piecesPerCarton: null, unitPriceMicros: 500_000, notes: '' };

describe('começar do zero', () => {
  it('o admin apaga pedidos, embarques e pagamentos; usuários ficam', async () => {
    const a = (await app.call('POST', '/api/items', { cookie: who.editor.cookie, body: item })).data.item;
    const shipped = await app.call('POST', '/api/ship', { cookie: who.editor.cookie, body: { lines: [{ itemId: a.id, quantity: 1000 }], newInvoice: { number: 'X1', ref: '', bill: 'BL1', eta: null } } });
    await app.call('POST', `/api/invoices/${shipped.data.invoiceId}/payments`, { cookie: who.admin.cookie, body: { paidAt: '2026-11-01', amountCents: 100, exchangeRateE4: null, notes: '' } });

    const wrong = await app.call('POST', '/api/reset', { cookie: who.admin.cookie, body: { confirm: 'sim' } });
    expect(wrong.status).toBe(400);
    expect(wrong.data.error).toBe('Digite APAGAR para confirmar.');

    const res = await app.call('POST', '/api/reset', { cookie: who.admin.cookie, body: { confirm: 'apagar' } });
    expect(res.status).toBe(200);
    expect(res.data).toEqual({ items: 1 });
    const d = (await app.call('GET', '/api/data', { cookie: who.admin.cookie })).data;
    expect([d.suppliers, d.orders, d.items, d.bills, d.invoices, d.payments].map((x: unknown[]) => x.length)).toEqual([0, 0, 0, 0, 0, 0]);
    expect((await app.call('GET', '/api/users', { cookie: who.admin.cookie })).data.users).toHaveLength(5);
  });

  it('editor e leitor não apagam', async () => {
    for (const w of [who.editor, who.leitor]) expect((await app.call('POST', '/api/reset', { cookie: w.cookie, body: { confirm: 'APAGAR' } })).status).toBe(403);
  });
});
