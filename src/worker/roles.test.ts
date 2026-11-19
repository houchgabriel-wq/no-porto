// Perfis da equipe (SPEC.md, seção 4): Consulta vê tudo, com valores, e não altera; Embarques vê só os
// produtos embarcados, sem valores. O servidor é quem corta.
import { beforeEach, describe, expect, it } from 'vitest';
import { testApp } from './test-api';

let app: ReturnType<typeof testApp>;
let who: Awaited<ReturnType<ReturnType<typeof testApp>['accounts']>>;

const line = (over: object) => ({ row: 7, description: 'Coleção Alice', isbn: '9786583970527', quantity: 1000, piecesPerCarton: null, unitPriceMicros: 1_750_000, notes: '', ...over });

beforeEach(async () => {
  app = testApp();
  who = await app.accounts();
  // Produção da Claire (PO-024) e da Sara (PO-030); metade da Claire embarcou num BL com arquivo e pagamento.
  await app.call('POST', '/api/orders', { cookie: who.editor.cookie, body: { code: 'PO-024', supplier: 'Claire', items: [line({ quantity: 2000 })] } });
  await app.call('POST', '/api/orders', { cookie: who.editor.cookie, body: { code: 'PO-030', supplier: 'Sara', items: [line({ description: 'Livro da Sara', isbn: null })] } });
  const claire = (await app.call('GET', '/api/data', { cookie: who.admin.cookie })).data.suppliers.find((s: { name: string }) => s.name === 'Claire').id;
  const res = await app.call('POST', '/api/shipments', { cookie: who.editor.cookie, body: { bill: 'BL1', eta: '2026-12-20', invoices: [{ supplierId: claire, number: 'C1', lines: [line({ quantity: 1000 })] }] } });
  await app.call('PUT', `/api/bills/${res.data.billId}/document`, { cookie: who.editor.cookie, body: { name: 'bl.pdf', contentType: 'application/pdf', data: Buffer.from('%PDF').toString('base64') } });
  await app.call('POST', `/api/invoices/${res.data.invoiceIds[0]}/payments`, { cookie: who.admin.cookie, body: { paidAt: '2026-11-01', amountCents: 100, exchangeRateE4: null, notes: '' } });
});

describe('perfil Consulta', () => {
  it('vê tudo, com valores e pagamentos, e baixa o arquivo do BL', async () => {
    const d = (await app.call('GET', '/api/data', { cookie: who.consulta.cookie })).data;
    expect(d.seeValues).toBe(true);
    expect(d.items).toHaveLength(3);
    expect(d.items[0].unitPriceMicros).toBe(1_750_000);
    expect(d.payments).toHaveLength(1);
    for (const path of ['/api/history', '/api/suppliers']) expect((await app.call('GET', path, { cookie: who.consulta.cookie })).status).toBe(200);
    expect((await app.raw('GET', `/api/bills/${d.bills[0].id}/document`, { cookie: who.consulta.cookie })).status).toBe(200);
  });

  it('não altera nada', async () => {
    const d = (await app.call('GET', '/api/data', { cookie: who.consulta.cookie })).data;
    const tries: [string, string, object][] = [
      ['POST', '/api/items', line({})],
      ['PATCH', `/api/items/${d.items[0].id}`, { quantity: 5 }],
      ['PATCH', '/api/items', { items: [{ id: d.items[0].id, row: 2, notes: 'x', marks: { notes: '000000' } }] }],
      ['POST', '/api/orders', { code: 'PO-099', supplier: 'Sara', items: [line({})] }],
      ['POST', '/api/arrivals', { invoiceIds: [d.invoices[0].id], arrivedAt: '2026-11-16' }],
      ['POST', `/api/invoices/${d.invoices[0].id}/payments`, { paidAt: null, amountCents: 1, exchangeRateE4: null, notes: '' }],
      ['DELETE', `/api/invoices/${d.invoices[0].id}`, {}],
      ['POST', '/api/users', { name: 'X', email: 'x@x.exemplo', role: 'admin' }],
    ];
    for (const [method, path, body] of tries) expect((await app.call(method, path, { cookie: who.consulta.cookie, body })).status, `${method} ${path}`).toBe(403);
  });
});

describe('perfil Embarques', () => {
  it('recebe só os itens no mar, sem preço nem pagamentos', async () => {
    const d = (await app.call('GET', '/api/data', { cookie: who.embarques.cookie })).data;
    expect(d.seeValues).toBe(false);
    expect(d.items.map((i: { status: string; quantity: number }) => [i.status, i.quantity])).toEqual([['embarcado', 1000]]);
    expect(d.items[0]).not.toHaveProperty('unitPriceMicros');
    expect(d.items[0]).not.toHaveProperty('totalCents');
    expect(d.payments).toEqual([]);
    expect(d.invoices.map((v: { number: string }) => v.number)).toEqual(['C1']);
    expect(d.bills.map((b: { number: string }) => b.number)).toEqual(['BL1']);
    expect(d.orders.map((o: { code: string }) => o.code)).toEqual(['PO-024']);
    expect(d.suppliers.map((s: { name: string }) => s.name)).toEqual(['Claire']);
  });

  it('vê o histórico, sem preço nem total', async () => {
    await app.call('POST', '/api/arrivals', {
      cookie: who.editor.cookie,
      body: { invoiceIds: (await app.call('GET', '/api/data', { cookie: who.admin.cookie })).data.invoices.map((v: { id: string }) => v.id), arrivedAt: '2026-11-16' },
    });
    const h = await app.call('GET', '/api/history', { cookie: who.embarques.cookie });
    expect(h.status).toBe(200);
    expect(h.data.seeValues).toBe(false);
    expect(h.data.items).toHaveLength(1);
    expect(h.data.items[0]).toMatchObject({ status: 'entregue', quantity: 1000 });
    expect(h.data.items[0]).not.toHaveProperty('unitPriceMicros');
    expect(h.data.items[0]).not.toHaveProperty('totalCents');
  });

  it('não vê fornecedores, fichas de produto nem o arquivo do BL; não altera', async () => {
    const admin = (await app.call('GET', '/api/data', { cookie: who.admin.cookie })).data;
    for (const path of ['/api/suppliers', `/api/products/${admin.items[0].productId}`, '/api/export']) {
      expect((await app.call('GET', path, { cookie: who.embarques.cookie })).status, path).toBe(403);
    }
    expect((await app.raw('GET', `/api/bills/${admin.bills[0].id}/document`, { cookie: who.embarques.cookie })).status).toBe(403);
    expect((await app.call('POST', '/api/arrivals', { cookie: who.embarques.cookie, body: { invoiceIds: [admin.invoices[0].id], arrivedAt: '2026-11-16' } })).status).toBe(403);
  });
});

describe('perfil Leitor (como antes)', () => {
  it('vê tudo, sem valores', async () => {
    const d = (await app.call('GET', '/api/data', { cookie: who.leitor.cookie })).data;
    expect(d.seeValues).toBe(false);
    expect(d.items).toHaveLength(3);
    expect(d.payments).toEqual([]);
    expect((await app.call('GET', '/api/history', { cookie: who.leitor.cookie })).status).toBe(200);
  });
});

describe('perfil Vendas', () => {
  it('recebe só produto e chegada dos itens no mar', async () => {
    const res = await app.call('GET', '/api/sales', { cookie: who.vendas.cookie });
    expect(res.status).toBe(200);
    expect(res.data.rows).toEqual([
      { productId: expect.any(String), description: 'Coleção Alice', isbn: '9786583970527', eta: '2026-12-20', state: { kind: 'previsto', days: 33 } },
    ]);
  });

  it('não recebe a tela de embarques completa, histórico, fornecedores, fichas nem arquivos; não altera', async () => {
    const admin = (await app.call('GET', '/api/data', { cookie: who.admin.cookie })).data;
    for (const path of ['/api/data', '/api/history', '/api/suppliers', `/api/products/${admin.items[0].productId}`, '/api/export', '/api/users']) {
      expect((await app.call('GET', path, { cookie: who.vendas.cookie })).status, path).toBe(403);
    }
    expect((await app.raw('GET', `/api/bills/${admin.bills[0].id}/document`, { cookie: who.vendas.cookie })).status).toBe(403);
    expect((await app.call('POST', '/api/arrivals', { cookie: who.vendas.cookie, body: { invoiceIds: [admin.invoices[0].id], arrivedAt: '2026-11-16' } })).status).toBe(403);
  });
});
