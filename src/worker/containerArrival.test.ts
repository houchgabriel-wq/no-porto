// Chegada por container (27/11/2026): no BL com vários containers, cada um chega no seu dia, porque nem sempre dá
// para receber todos no mesmo dia. A chegada gravada no BL (o jeito de antes) passa para os containers quando um
// deles muda.
import { beforeEach, describe, expect, it } from 'vitest';
import { testApp } from './test-api';

let app: ReturnType<typeof testApp>;
let who: Awaited<ReturnType<ReturnType<typeof testApp>['accounts']>>;
let a: string;
let b: string;
let billId: string;

const line = (over: object) => ({ row: 7, description: 'Coleção Alice', isbn: '9786583970527', quantity: 1000, piecesPerCarton: null, unitPriceMicros: 1_750_000, notes: '', ...over });

beforeEach(async () => {
  app = testApp();
  who = await app.accounts();
  await app.call('POST', '/api/orders', {
    cookie: who.editor.cookie,
    body: { code: 'PO-036', supplier: 'Claire', orderedAt: '2026-10-01', items: [line({ quantity: 6000 }), line({ description: 'Ágape', isbn: '9788543230139', quantity: 4000 })] },
  });
  const claire = (await app.call('GET', '/api/data', { cookie: who.admin.cookie })).data.suppliers[0].id;
  const res = await app.call('POST', '/api/shipments', {
    cookie: who.editor.cookie,
    body: {
      bill: 'ROECHN26112871',
      eta: '2026-11-10',
      invoices: [
        { supplierId: claire, number: '126082125-3', lines: [line({ quantity: 6000 })] },
        { supplierId: claire, number: '126082125-4', lines: [line({ description: 'Ágape', isbn: '9788543230139', quantity: 4000 })] },
      ],
    },
  });
  [a, b] = res.data.invoiceIds;
  billId = res.data.billId;
});

interface View {
  bills: { id: string; arrivedAt: string | null }[];
  invoices: { id: string; arrivedAt: string | null }[];
  items: { invoiceId: string | null; status: string }[];
}
const view = async (): Promise<View> => (await app.call('GET', '/api/data', { cookie: who.admin.cookie })).data;
const arrive = (id: string, arrivedAt: string | null, cookie = who.editor.cookie) => app.call('PATCH', `/api/invoices/${id}`, { cookie, body: { arrivedAt } });
/** O dia de chegada e a situação dos itens de cada container, e a chegada gravada no BL. */
async function state() {
  const d = await view();
  const of = (id: string) => [d.invoices.find((v) => v.id === id)!.arrivedAt, [...new Set(d.items.filter((i) => i.invoiceId === id).map((i) => i.status))].join()];
  return { a: of(a), b: of(b), bill: d.bills.find((x) => x.id === billId)!.arrivedAt };
}

describe('chegada por container', () => {
  it('cada container do BL chega no seu dia; os itens vão para o histórico e voltam com ele', async () => {
    expect((await arrive(a, '2026-11-16')).status).toBe(200);
    expect(await state()).toEqual({ a: ['2026-11-16', 'entregue'], b: [null, 'embarcado'], bill: null });
    await arrive(b, '2026-11-17');
    expect(await state()).toEqual({ a: ['2026-11-16', 'entregue'], b: ['2026-11-17', 'entregue'], bill: null });
    // Desfazer a chegada de um container não mexe no outro.
    await arrive(a, null);
    expect(await state()).toEqual({ a: [null, 'embarcado'], b: ['2026-11-17', 'entregue'], bill: null });
  });

  it('a chegada gravada no BL (o jeito de antes) passa para os containers quando um deles muda', async () => {
    expect((await app.call('PATCH', `/api/bills/${billId}`, { cookie: who.editor.cookie, body: { arrivedAt: '2026-11-15' } })).status).toBe(200);
    expect(await state()).toEqual({ a: [null, 'entregue'], b: [null, 'entregue'], bill: '2026-11-15' });
    // Este container não tinha chegado, na verdade: o outro fica com o dia do BL.
    await arrive(a, null);
    expect(await state()).toEqual({ a: [null, 'embarcado'], b: ['2026-11-15', 'entregue'], bill: null });
    await arrive(a, '2026-11-17');
    expect(await state()).toEqual({ a: ['2026-11-17', 'entregue'], b: ['2026-11-15', 'entregue'], bill: null });
  });

  it('só admin e editor registram a chegada; os outros perfis, inclusive o Agente de cargas, não', async () => {
    for (const w of [who.consulta, who.leitor, who.embarques, who.vendas, who.agente]) expect((await arrive(a, '2026-11-16', w.cookie)).status, w.id).toBe(403);
    expect((await arrive(a, '2026-11-16', who.admin.cookie)).status).toBe(200);
    expect(await state()).toEqual({ a: ['2026-11-16', 'entregue'], b: [null, 'embarcado'], bill: null });
  });
});
