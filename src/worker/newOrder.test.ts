// Nova PO pelo sistema (24/11/2026): o catálogo de produtos e a PO gravada com os itens que as regras
// montam (os mesmos que o Novo pedido leria do Excel gerado).
import { beforeEach, describe, expect, it } from 'vitest';
import { orderItems, type NewOrder } from '../core/newOrder';
import { testApp } from './test-api';

let app: ReturnType<typeof testApp>;
let who: Awaited<ReturnType<ReturnType<typeof testApp>['accounts']>>;

const ALICE = '9786583970527';
const BREVIDADE = '9786587817668';

beforeEach(async () => {
  app = testApp();
  who = await app.accounts();
  // A Alice já teve PO, com preço, caixa e especificação.
  await app.call('POST', '/api/orders', {
    cookie: who.editor.cookie,
    body: {
      code: 'PO-070',
      supplier: 'Nicola',
      orderedAt: '2026-10-01',
      items: [{ row: 7, description: 'Coleção Alice', isbn: ALICE, quantity: 5000, piecesPerCarton: 12, unitPriceMicros: 1_750_000, notes: '', specification: 'Box 4 livros, 350gsm' }],
    },
  });
  // A curva traz a Alice e um título que nunca teve PO.
  const row = (isbn: string, title: string) => ({ isbn, title, code: '1', abcClass: 'A', stock: 100, sales: { m1: 10, m3: 30, m6: 60, m9: null, m12: null } });
  await app.call('POST', '/api/stock', {
    cookie: who.editor.cookie,
    body: { stockDate: '2026-11-16', fileName: 'curva.xlsx', rows: [row(ALICE, 'COLEÇÃO ALICE (CURVA)'), row(BREVIDADE, 'Sobre a Brevidade da Vida')] },
  });
});

describe('catálogo da Nova PO', () => {
  it('admin e editor recebem os produtos com a última compra e os títulos da curva que faltam', async () => {
    for (const w of [who.admin, who.editor]) {
      const res = await app.call('GET', '/api/po-catalog', { cookie: w.cookie });
      expect(res.status).toBe(200);
      expect(res.data.products).toEqual([
        {
          title: 'Coleção Alice',
          isbn: ALICE,
          source: 'sistema',
          last: { orderCode: 'PO-070', supplierName: 'Nicola', createdAt: expect.any(String), unitPriceMicros: 1_750_000, piecesPerCarton: 12, specification: 'Box 4 livros, 350gsm' },
        },
        { title: 'Sobre a Brevidade da Vida', isbn: BREVIDADE, source: 'curva', last: null },
      ]);
    }
  });

  it('os outros perfis não recebem, nem o agente', async () => {
    for (const w of [who.consulta, who.leitor, who.embarques, who.vendas, who.agente]) {
      const res = await app.call('GET', '/api/po-catalog', { cookie: w.cookie });
      expect([res.status, res.data.error]).toEqual([403, 'Só admin e editor criam PO.']);
    }
  });
});

describe('PO criada pelo sistema', () => {
  it('grava os itens das regras: em produção, com preço, caixa, especificação, observação e programação', async () => {
    const order: NewOrder = {
      code: 'PO-071',
      supplier: 'Nicola',
      date: '2026-11-24',
      from: 'GABRIEL',
      lines: [
        { description: 'Coleção Alice', isbn: ALICE, specification: 'Box 4 livros, 350gsm', shrinkWrap: 'YES', piecesPerCarton: 12, quantity: 6000, unitPriceMicros: 1_750_000, comment: 'Ship in 2 lots: 3,000 pcs by 16-Dec-2026 / 3,000 pcs by 01-Mar-2027', shipDate: '2026-12-16' },
        { description: 'Sobre a Brevidade da Vida', isbn: BREVIDADE, specification: '', shrinkWrap: 'YES', piecesPerCarton: null, quantity: 30_000, unitPriceMicros: null, comment: 'New title.', shipDate: '2027-01-20' },
      ],
    };
    const res = await app.call('POST', '/api/orders', { cookie: who.admin.cookie, body: { code: order.code, supplier: order.supplier, orderedAt: order.date, items: orderItems(order) } });
    expect(res.status).toBe(201);
    const data = (await app.call('GET', '/api/data', { cookie: who.admin.cookie })).data;
    const po = data.orders.find((o: { code: string }) => o.code === 'PO-071');
    expect(po.orderedAt).toBe('2026-11-24');
    const items = data.items.filter((i: { purchaseOrderId: string }) => i.purchaseOrderId === po.id);
    expect(items.map((i: { description: string; status: string; quantity: number; unitPriceMicros: number | null; piecesPerCarton: number | null; notes: string; shipPlan: unknown }) => [i.description, i.status, i.quantity, i.unitPriceMicros, i.piecesPerCarton, i.notes, i.shipPlan])).toEqual([
      ['Coleção Alice', 'producao', 6000, 1_750_000, 12, 'Ship in 2 lots: 3,000 pcs by 16-Dec-2026 / 3,000 pcs by 01-Mar-2027', [{ month: '2026-12', quantity: 3000 }, { month: '2027-03', quantity: 3000 }]],
      ['Sobre a Brevidade da Vida', 'producao', 30_000, null, null, 'New title.', [{ month: '2027-01', quantity: 30_000 }]],
    ]);
    // O mesmo número não entra duas vezes.
    const again = await app.call('POST', '/api/orders', { cookie: who.admin.cookie, body: { code: 'PO-071', supplier: 'Nicola', items: orderItems(order) } });
    expect(again.status).toBe(409);
  });
});
