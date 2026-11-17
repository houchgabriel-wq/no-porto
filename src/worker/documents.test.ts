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
  const ship = (body: object, cookie = who.editor.cookie) => app.call('POST', '/api/shipments', { cookie, body });
  const invoice = (supplierId: string, number: string, lines: object[], over: object = {}) => ({ supplierId, number, ref: '', container: '', lines, ...over });

  async function setup() {
    // A Claire tem Alice em duas POs (a 24 é a mais antiga); a Sara também tem Alice.
    await order('PO-050', 'Claire', [line({ quantity: 5000, unitPriceMicros: 1_700_000, piecesPerCarton: 20 })]);
    await order('PO-024', 'Claire', [line({ quantity: 3000, unitPriceMicros: 1_700_000, piecesPerCarton: 20 })]);
    await order('PO-030', 'Sara', [line({ quantity: 9000 })]);
    const d = await data();
    const id = (name: string) => d.suppliers.find((s: { name: string }) => s.name === name).id as string;
    const code = (oid: string | null) => d.orders.find((o: { id: string }) => o.id === oid)?.code ?? null;
    return { claire: id('Claire'), sara: id('Sara'), code };
  }

  it('tira da produção do mesmo fornecedor, a PO mais antiga primeiro, com o preço da invoice e as peças da packing list', async () => {
    const { claire, code } = await setup();
    const res = await ship({
      bill: 'MEDU123',
      eta: '2026-12-20',
      invoices: [
        invoice(
          claire,
          '126062009-2',
          [line({ quantity: 4000, orderCode: 'PO-024', piecesPerCarton: 22 }), line({ row: 8, description: 'A Odisseia', isbn: ODISSEIA, quantity: 200, unitPriceMicros: 1_120_000, piecesPerCarton: 26 })],
          { ref: 'CTNR04', container: 'YMLU5449045' },
        ),
      ],
    });
    expect(res.status).toBe(201);
    expect(res.data).toMatchObject({ taken: 4000, extra: 200, billId: expect.any(String), invoiceIds: [expect.any(String)] });

    const d = await data();
    const rows = (d.items as Row[]).map((i) => ({
      desc: i.description,
      status: i.status,
      qty: i.quantity,
      po: code(i.purchaseOrderId),
      supplier: d.suppliers.find((s: { id: string }) => s.id === i.supplierId).name,
      price: i.unitPriceMicros,
      pcs: (i as unknown as { piecesPerCarton: number | null }).piecesPerCarton,
    }));
    // PO-024 sai inteira, 1.000 da PO-050 saem e 4.000 ficam; a Sara não é tocada.
    expect(rows).toEqual(
      expect.arrayContaining([
        { desc: 'Coleção Alice', status: 'embarcado', qty: 3000, po: 'PO-024', supplier: 'Claire', price: 1_750_000, pcs: 22 },
        { desc: 'Coleção Alice', status: 'producao', qty: 4000, po: 'PO-050', supplier: 'Claire', price: 1_700_000, pcs: 20 },
        { desc: 'Coleção Alice', status: 'embarcado', qty: 1000, po: 'PO-050', supplier: 'Claire', price: 1_750_000, pcs: 22 },
        { desc: 'Coleção Alice', status: 'producao', qty: 9000, po: 'PO-030', supplier: 'Sara', price: 1_750_000, pcs: null },
        { desc: 'A Odisseia', status: 'embarcado', qty: 200, po: null, supplier: 'Claire', price: 1_120_000, pcs: 26 },
      ]),
    );
    expect(rows).toHaveLength(5);
    expect((d.items as Row[]).find((i) => i.description === 'A Odisseia')!.notes).toBe('Não estava na produção da Claire. Confira.');
    expect(d.invoices).toMatchObject([{ number: '126062009-2', ref: 'CTNR04', supplierId: claire, billId: d.bills[0].id, notes: 'Container YMLU5449045' }]);
    expect(d.bills).toMatchObject([{ number: 'MEDU123', eta: '2026-12-20', document: null }]);
  });

  it('vários containers no mesmo BL consomem a produção em sequência', async () => {
    const { claire, sara } = await setup();
    const res = await ship({
      bill: 'MEDU999',
      eta: '2026-12-20',
      invoices: [invoice(claire, 'C1', [line({ quantity: 2000 })]), invoice(sara, 'S1', [line({ quantity: 1000 })]), invoice(claire, 'C2', [line({ quantity: 2000 })])],
    });
    expect(res.status).toBe(201);
    expect(res.data).toMatchObject({ taken: 5000, extra: 0 });
    const d = await data();
    expect(d.bills).toHaveLength(1);
    expect(d.invoices.map((v: { number: string; billId: string }) => [v.number, v.billId === d.bills[0].id])).toEqual([
      ['C1', true],
      ['S1', true],
      ['C2', true],
    ]);
    const inv = (n: string) => d.invoices.find((v: { number: string }) => v.number === n).id;
    const qty = (invoiceNumber: string) => (d.items as Row[]).filter((i) => i.invoiceId === inv(invoiceNumber)).map((i) => i.quantity).sort();
    expect(qty('C1')).toEqual([2000]);
    expect(qty('C2')).toEqual([1000, 1000]);
    expect(qty('S1')).toEqual([1000]);
  });

  it('a mesma invoice não entra duas vezes, nem repetida no mesmo envio; o leitor não registra', async () => {
    const { claire } = await setup();
    const body = { bill: null, eta: null, invoices: [invoice(claire, 'X1', [line({ quantity: 100 })])] };
    expect((await ship(body, who.leitor.cookie)).status).toBe(403);
    expect((await ship(body)).status).toBe(201);
    const again = await ship(body);
    expect(again.status).toBe(409);
    expect(again.data.error).toBe('A invoice X1 da Claire já foi registrada.');
    const twice = await ship({ bill: null, eta: null, invoices: [invoice(claire, 'X2', [line({})]), invoice(claire, 'x2', [line({})])] });
    expect(twice.status).toBe(409);
  });

  it('fornecedor desconhecido', async () => {
    const res = await ship({ bill: null, eta: null, invoices: [invoice('x', 'Z1', [line({})])] });
    expect(res.status).toBe(404);
  });
});

describe('arquivo do BL', () => {
  const TEXT = '%PDF-1.4 conteúdo de teste';
  const PDF = Buffer.from(TEXT).toString('base64');

  async function bill() {
    await order('PO-024', 'Claire', [line({ quantity: 3000 })]);
    const claire = (await data()).suppliers[0].id;
    const res = await app.call('POST', '/api/shipments', { cookie: who.editor.cookie, body: { bill: 'BL1', eta: null, invoices: [{ supplierId: claire, number: 'A1', lines: [line({})] }] } });
    return res.data.billId as string;
  }

  it('anexa, baixa, substitui e tira', async () => {
    const id = await bill();
    const put = await app.call('PUT', `/api/bills/${id}/document`, { cookie: who.editor.cookie, body: { name: 'BL MEDU123.pdf', contentType: 'application/pdf', data: PDF } });
    expect(put.status).toBe(201);
    expect((await data()).bills[0].document).toEqual({ name: 'BL MEDU123.pdf', size: Buffer.byteLength(TEXT) });

    const got = await app.raw('GET', `/api/bills/${id}/document`, { cookie: who.admin.cookie });
    expect(got.status).toBe(200);
    expect(got.headers.get('content-type')).toBe('application/pdf');
    expect(got.headers.get('content-disposition')).toContain("filename*=UTF-8''BL%20MEDU123.pdf");
    expect(new TextDecoder().decode(await got.arrayBuffer())).toBe(TEXT);

    await app.call('PUT', `/api/bills/${id}/document`, { cookie: who.editor.cookie, body: { name: 'novo.png', contentType: 'image/png', data: btoa('png') } });
    expect((await data()).bills[0].document).toEqual({ name: 'novo.png', size: 3 });

    expect((await app.call('DELETE', `/api/bills/${id}/document`, { cookie: who.editor.cookie })).status).toBe(200);
    expect((await data()).bills[0].document).toBeNull();
  });

  it('recusa tipo errado e arquivo grande; o leitor não anexa nem baixa', async () => {
    const id = await bill();
    const exe = await app.call('PUT', `/api/bills/${id}/document`, { cookie: who.editor.cookie, body: { name: 'x.exe', contentType: 'application/x-msdownload', data: PDF } });
    expect(exe.data.error).toBe('Envie o BL em PDF, PNG ou JPG.');
    const big = await app.call('PUT', `/api/bills/${id}/document`, { cookie: who.editor.cookie, body: { name: 'g.pdf', contentType: 'application/pdf', data: 'A'.repeat(6_700_000) } });
    expect(big.status).toBe(413);
    expect((await app.call('PUT', `/api/bills/${id}/document`, { cookie: who.leitor.cookie, body: { name: 'a.pdf', contentType: 'application/pdf', data: PDF } })).status).toBe(403);
    expect((await app.raw('GET', `/api/bills/${id}/document`, { cookie: who.leitor.cookie })).status).toBe(403);
  });
});

describe('container entregue', () => {
  it('as invoices escolhidas chegam no dia e os itens vão para o histórico', async () => {
    await order('PO-024', 'Claire', [line({ quantity: 3000 })]);
    const claire = (await data()).suppliers[0].id;
    const shipped = await app.call('POST', '/api/shipments', {
      cookie: who.editor.cookie,
      body: { bill: 'BL1', eta: null, invoices: ['A1', 'A2'].map((number) => ({ supplierId: claire, number, lines: [line({ quantity: 1000 })] })) },
    });
    const a = { data: { invoiceId: shipped.data.invoiceIds[0] } };

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
