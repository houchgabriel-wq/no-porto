// Terminal de consulta do painel (19/11/2026): o resumo de cada produto, só com quantidades.
import { beforeEach, describe, expect, it } from 'vitest';
import { testApp } from './test-api';

let app: ReturnType<typeof testApp>;
let who: Awaited<ReturnType<ReturnType<typeof testApp>['accounts']>>;

const ALICE = '9786583970527';
const line = (over: object) => ({ row: 7, description: 'Coleção Alice', isbn: ALICE, quantity: 1000, piecesPerCarton: null, unitPriceMicros: 1_750_000, notes: '', ...over });

beforeEach(async () => {
  app = testApp();
  who = await app.accounts();
  const order = (code: string, items: object[]) => app.call('POST', '/api/orders', { cookie: who.editor.cookie, body: { code, supplier: 'Claire', items } });
  await order('PO-061', [line({ quantity: 3000, shipPlan: [{ month: '2026-12', quantity: 3000 }] })]);
  await order('PO-070', [line({ quantity: 5000, shipPlan: [{ month: '2027-03', quantity: 5000 }] }), line({ row: 8, description: 'Meditações - Marco Aurélio', isbn: null, quantity: 30000 })]);
  const claire = (await app.call('GET', '/api/data', { cookie: who.admin.cookie })).data.suppliers[0].id;
  // Dois embarques da Alice saem da PO-061 (a mais antiga): 1.000 a caminho; 500 já chegaram.
  await app.call('POST', '/api/shipments', { cookie: who.editor.cookie, body: { bill: 'BL1', eta: '2026-12-20', invoices: [{ supplierId: claire, number: 'C1', lines: [line({ quantity: 1000 })] }] } });
  const second = await app.call('POST', '/api/shipments', { cookie: who.editor.cookie, body: { bill: 'BL2', eta: '2026-11-10', invoices: [{ supplierId: claire, number: 'C2', lines: [line({ quantity: 500 })] }] } });
  await app.call('POST', '/api/arrivals', { cookie: who.editor.cookie, body: { invoiceIds: second.data.invoiceIds, arrivedAt: '2026-11-16' } });
});

describe('terminal de consulta', () => {
  it('cada produto com a produção, o que está a caminho e a última chegada; sem valores, nem para quem vê', async () => {
    const res = await app.call('GET', '/api/lookup', { cookie: who.admin.cookie });
    expect(res.status).toBe(200);
    const alice = res.data.products.find((p: { isbn: string | null }) => p.isbn === ALICE);
    expect(alice).toEqual({
      key: alice.productId,
      productId: expect.any(String),
      isbn: ALICE,
      title: 'Coleção Alice',
      names: ['Coleção Alice'],
      production: { quantity: 6500, orders: ['PO-061', 'PO-070'], nextShip: '2026-12' },
      atSea: { quantity: 1000, nextEta: '2026-12-20' },
      brazil: { quantity: 0, printers: [], nextDue: null },
      lastArrival: { date: '2026-11-16', quantity: 500, printers: [] },
    });
    expect(res.data.products.find((p: { title: string }) => p.title.startsWith('Meditações'))).toMatchObject({ production: { quantity: 30000, orders: ['PO-070'] }, lastArrival: null });
    expect(JSON.stringify(res.data)).not.toMatch(/price|cents|valor/i);
  });

  it('quem vê o painel consulta, inclusive o leitor; o Agente, o perfil Embarques e Vendas não', async () => {
    for (const w of [who.editor, who.consulta, who.leitor]) expect((await app.call('GET', '/api/lookup', { cookie: w.cookie })).status).toBe(200);
    for (const w of [who.agente, who.embarques, who.vendas]) expect((await app.call('GET', '/api/lookup', { cookie: w.cookie })).status).toBe(403);
    expect((await app.call('GET', '/api/lookup')).status).toBe(401);
  });
});
