// Novo pedido, novo embarque pela invoice do fornecedor e container entregue (SPEC.md, seção 3).
import { beforeEach, describe, expect, it } from 'vitest';
import { testApp } from './test-api';

let app: ReturnType<typeof testApp>;
let who: Awaited<ReturnType<ReturnType<typeof testApp>['accounts']>>;

beforeEach(async () => {
  app = testApp();
  who = await app.accounts();
});

type Row = { id: string; description: string; isbn: string | null; status: string; quantity: number; supplierId: string; purchaseOrderId: string | null; invoiceId: string | null; unitPriceMicros?: number | null; notes: string };
const data = async (cookie = who.admin.cookie) => (await app.call('GET', '/api/data', { cookie })).data;

const ALICE = '9786583970527';
const ODISSEIA = '9786583970213';
const line = (over: object) => ({ row: 7, description: 'Coleção Alice', isbn: ALICE, quantity: 1000, piecesPerCarton: null, unitPriceMicros: 1_750_000, notes: '', ...over });

async function order(code: string, supplier: string, items: object[]) {
  const res = await app.call('POST', '/api/orders', { cookie: who.editor.cookie, body: { code, supplier, orderedAt: '2026-11-09', items } });
  expect(res.status).toBe(201);
  return res.data as { orderId: string; inserted: number };
}

describe('novo pedido', () => {
  it('a PO entra inteira na produção, com fornecedor e data do pedido', async () => {
    const res = await order('po 65', 'Nicola', [line({}), line({ row: 8, description: 'Livro sem ISBN', isbn: null, quantity: 500, unitPriceMicros: null })]);
    expect(res.inserted).toBe(2);
    const d = await data();
    expect(d.orders).toMatchObject([{ code: 'PO-065', orderedAt: '2026-11-09' }]);
    expect(d.suppliers).toMatchObject([{ name: 'Nicola' }]);
    expect(d.items.map((i: Row) => [i.description, i.status, i.quantity, i.purchaseOrderId])).toEqual([
      ['Coleção Alice', 'producao', 1000, res.orderId],
      ['Livro sem ISBN', 'producao', 500, res.orderId],
    ]);
  });

  it('não cadastra a mesma PO duas vezes; o fornecedor é reconhecido sem diferença de maiúsculas', async () => {
    await order('PO-065', 'Nicola', [line({})]);
    const again = await app.call('POST', '/api/orders', { cookie: who.editor.cookie, body: { code: 'PO-065', supplier: 'NICOLA', items: [line({})] } });
    expect(again.status).toBe(409);
    expect(again.data.error).toBe('A PO-065 já está cadastrada, com 1 item. Para acrescentar itens, use Novo item.');
    await order('PO-066', 'NICOLA', [line({})]);
    expect((await data()).suppliers).toHaveLength(1);
  });

  it('pede PO e fornecedor; o leitor não cadastra', async () => {
    const noCode = await app.call('POST', '/api/orders', { cookie: who.editor.cookie, body: { code: null, supplier: 'Sara', items: [line({})] } });
    expect(noCode.data.error).toContain('número da PO');
    const noSupplier = await app.call('POST', '/api/orders', { cookie: who.editor.cookie, body: { code: 'PO-070', supplier: ' ', items: [line({})] } });
    expect(noSupplier.data.error).toContain('fornecedor');
    expect((await app.call('POST', '/api/orders', { cookie: who.leitor.cookie, body: { code: 'PO-070', supplier: 'Sara', items: [line({})] } })).status).toBe(403);
  });
});

describe('novo embarque pela invoice', () => {
  const INVOICE = { number: '126062009-2', ref: 'CTNR04', bill: 'MEDU123', eta: '2026-12-20' };

  async function setup() {
    // A Claire tem Alice em duas POs (a 24 é a mais antiga); a Sara também tem Alice.
    await order('PO-050', 'Claire', [line({ quantity: 5000, unitPriceMicros: 1_700_000 })]);
    await order('PO-024', 'Claire', [line({ quantity: 3000, unitPriceMicros: 1_700_000 })]);
    await order('PO-030', 'Sara', [line({ quantity: 9000 })]);
    const d = await data();
    const claire = d.suppliers.find((s: { name: string }) => s.name === 'Claire').id as string;
    const code = (id: string | null) => d.orders.find((o: { id: string }) => o.id === id)?.code ?? null;
    return { claire, code };
  }

  it('tira da produção do mesmo fornecedor, a PO mais antiga primeiro, com o preço da invoice', async () => {
    const { claire, code } = await setup();
    const res = await app.call('POST', '/api/shipments', {
      cookie: who.editor.cookie,
      body: { supplierId: claire, invoice: INVOICE, lines: [line({ quantity: 4000, orderCode: 'PO-024' }), line({ row: 8, description: 'A Odisseia', isbn: ODISSEIA, quantity: 200, unitPriceMicros: 1_120_000 })] },
    });
    expect(res.status).toBe(201);
    expect(res.data).toMatchObject({ taken: 4000, extra: 200 });

    const d = await data();
    const rows = (d.items as Row[]).map((i) => ({ desc: i.description, status: i.status, qty: i.quantity, po: code(i.purchaseOrderId), supplier: d.suppliers.find((s: { id: string }) => s.id === i.supplierId).name, price: i.unitPriceMicros }));
    // PO-024 sai inteira, 1.000 da PO-050 saem e 4.000 ficam; a Sara não é tocada.
    expect(rows).toEqual(
      expect.arrayContaining([
        { desc: 'Coleção Alice', status: 'embarcado', qty: 3000, po: 'PO-024', supplier: 'Claire', price: 1_750_000 },
        { desc: 'Coleção Alice', status: 'producao', qty: 4000, po: 'PO-050', supplier: 'Claire', price: 1_700_000 },
        { desc: 'Coleção Alice', status: 'embarcado', qty: 1000, po: 'PO-050', supplier: 'Claire', price: 1_750_000 },
        { desc: 'Coleção Alice', status: 'producao', qty: 9000, po: 'PO-030', supplier: 'Sara', price: 1_750_000 },
        { desc: 'A Odisseia', status: 'embarcado', qty: 200, po: null, supplier: 'Claire', price: 1_120_000 },
      ]),
    );
    expect(rows).toHaveLength(5);
    const extra = (d.items as Row[]).find((i) => i.description === 'A Odisseia')!;
    expect(extra.notes).toBe('Não estava na produção da Claire. Confira.');
    expect(d.invoices).toMatchObject([{ number: '126062009-2', ref: 'CTNR04', supplierId: claire, billId: d.bills[0].id }]);
    expect(d.bills).toMatchObject([{ number: 'MEDU123', eta: '2026-12-20' }]);
  });

  it('a mesma invoice não entra duas vezes; o leitor não registra', async () => {
    const { claire } = await setup();
    const body = { supplierId: claire, invoice: INVOICE, lines: [line({ quantity: 100 })] };
    expect((await app.call('POST', '/api/shipments', { cookie: who.leitor.cookie, body })).status).toBe(403);
    expect((await app.call('POST', '/api/shipments', { cookie: who.editor.cookie, body })).status).toBe(201);
    const again = await app.call('POST', '/api/shipments', { cookie: who.editor.cookie, body });
    expect(again.status).toBe(409);
    expect(again.data.error).toBe('A invoice 126062009-2 da Claire já foi registrada.');
  });

  it('fornecedor desconhecido', async () => {
    const res = await app.call('POST', '/api/shipments', { cookie: who.editor.cookie, body: { supplierId: 'x', invoice: INVOICE, lines: [line({})] } });
    expect(res.status).toBe(404);
  });
});

describe('container entregue', () => {
  it('as invoices escolhidas chegam no dia e os itens vão para o histórico', async () => {
    await order('PO-024', 'Claire', [line({ quantity: 3000 })]);
    const claire = (await data()).suppliers[0].id;
    const a = await app.call('POST', '/api/shipments', { cookie: who.editor.cookie, body: { supplierId: claire, invoice: { number: 'A1', ref: '', bill: 'BL1', eta: null }, lines: [line({ quantity: 1000 })] } });
    await app.call('POST', '/api/shipments', { cookie: who.editor.cookie, body: { supplierId: claire, invoice: { number: 'A2', ref: '', bill: 'BL1', eta: null }, lines: [line({ quantity: 1000 })] } });

    expect((await app.call('POST', '/api/arrivals', { cookie: who.leitor.cookie, body: { invoiceIds: [a.data.invoiceId], arrivedAt: '2026-11-16' } })).status).toBe(403);
    const res = await app.call('POST', '/api/arrivals', { cookie: who.editor.cookie, body: { invoiceIds: [a.data.invoiceId], arrivedAt: '2026-11-16' } });
    expect(res.status).toBe(200);

    const d = await data();
    const inv = (n: string) => d.invoices.find((v: { number: string }) => v.number === n);
    expect(inv('A1').arrivedAt).toBe('2026-11-16');
    expect(inv('A2').arrivedAt).toBeNull();
    const statuses = (d.items as Row[]).map((i) => [i.invoiceId === inv('A1').id ? 'A1' : i.invoiceId === inv('A2').id ? 'A2' : '-', i.status]).sort();
    expect(statuses).toEqual([['-', 'producao'], ['A1', 'entregue'], ['A2', 'embarcado']]);
    const history = (await app.call('GET', '/api/history', { cookie: who.admin.cookie })).data;
    expect(history.items).toMatchObject([{ status: 'entregue', quantity: 1000 }]);
  });

  it('pede o dia e invoices que existem', async () => {
    const noDay = await app.call('POST', '/api/arrivals', { cookie: who.editor.cookie, body: { invoiceIds: ['x'], arrivedAt: null } });
    expect(noDay.data.error).toBe('Informe o dia da chegada.');
    const missing = await app.call('POST', '/api/arrivals', { cookie: who.editor.cookie, body: { invoiceIds: ['x'], arrivedAt: '2026-11-16' } });
    expect(missing.status).toBe(404);
  });
});
