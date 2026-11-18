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

describe('excluir embarque ou container', () => {
  const ship = (body: object) => app.call('POST', '/api/shipments', { cookie: who.editor.cookie, body });

  async function setup() {
    await order('PO-050', 'Claire', [line({ quantity: 5000, unitPriceMicros: 1_700_000, piecesPerCarton: 20 })]);
    await order('PO-024', 'Claire', [line({ quantity: 3000, unitPriceMicros: 1_700_000, piecesPerCarton: 20 })]);
    const claire = (await data()).suppliers[0].id as string;
    const res = await ship({
      bill: 'MEDU1',
      eta: '2026-12-20',
      invoices: [
        { supplierId: claire, number: 'C1', lines: [line({ quantity: 4000, piecesPerCarton: 22 }), line({ row: 8, description: 'A Odisseia', isbn: ODISSEIA, quantity: 200 })] },
        { supplierId: claire, number: 'C2', lines: [line({ quantity: 500 })] },
      ],
    });
    await app.call('POST', `/api/invoices/${res.data.invoiceIds[0]}/payments`, { cookie: who.admin.cookie, body: { paidAt: '2026-11-01', amountCents: 100, exchangeRateE4: null, notes: '' } });
    return { claire, billId: res.data.billId as string, invoiceIds: res.data.invoiceIds as string[] };
  }

  const production = async () =>
    ((await data()).items as Row[])
      .filter((i) => i.status === 'producao')
      .map((i) => [i.quantity, i.unitPriceMicros, (i as unknown as { piecesPerCarton: number | null }).piecesPerCarton])
      .sort((a, b) => Number(a[0]) - Number(b[0]));

  it('excluir um container: o que saiu volta para a produção (juntando as partes), o resto é apagado; o BL fica', async () => {
    const { invoiceIds } = await setup();
    // C1 levou toda a PO-024 (3.000) e 1.000 da PO-050; C2 levou mais 500 da PO-050. Ficaram 3.500.
    expect(await production()).toEqual([[3500, 1_700_000, 20]]);
    expect((await app.call('DELETE', `/api/invoices/${invoiceIds[0]}`, { cookie: who.editor.cookie })).status).toBe(403);
    const res = await app.call('DELETE', `/api/invoices/${invoiceIds[0]}`, { cookie: who.admin.cookie });
    expect(res.status).toBe(200);
    expect(res.data).toEqual({ back: 1, merged: 1, removed: 1, billRemoved: false });
    // A PO-024 volta com o preço e as peças de antes; a parte da PO-050 se junta ao saldo.
    expect(await production()).toEqual([
      [3000, 1_700_000, 20],
      [4500, 1_700_000, 20],
    ]);
    const d = await data();
    expect(d.invoices.map((v: { number: string }) => v.number)).toEqual(['C2']);
    expect(d.bills).toHaveLength(1);
    expect(d.payments).toEqual([]);
    expect((d.items as Row[]).some((i) => i.description === 'A Odisseia')).toBe(false);
  });

  it('excluir o embarque inteiro: o BL e todas as invoices; a produção volta ao que era', async () => {
    const { billId } = await setup();
    const res = await app.call('DELETE', `/api/bills/${billId}`, { cookie: who.admin.cookie });
    expect(res.status).toBe(200);
    expect(res.data).toMatchObject({ invoices: 2 });
    expect(await production()).toEqual([
      [3000, 1_700_000, 20],
      [5000, 1_700_000, 20],
    ]);
    const d = await data();
    expect([d.bills.length, d.invoices.length]).toEqual([0, 0]);
  });

  it('o último container leva o BL junto; o que já chegou não se exclui', async () => {
    const { billId, invoiceIds } = await setup();
    await app.call('POST', '/api/arrivals', { cookie: who.editor.cookie, body: { invoiceIds: [invoiceIds[1]], arrivedAt: '2026-11-16' } });
    const arrived = await app.call('DELETE', `/api/invoices/${invoiceIds[1]}`, { cookie: who.admin.cookie });
    expect(arrived.status).toBe(409);
    expect(arrived.data.error).toBe('A invoice C2 já chegou. Para excluir, apague antes a data de chegada.');
    expect((await app.call('DELETE', `/api/bills/${billId}`, { cookie: who.admin.cookie })).status).toBe(409);
    await app.call('PATCH', `/api/invoices/${invoiceIds[1]}`, { cookie: who.editor.cookie, body: { arrivedAt: null } });
    await app.call('DELETE', `/api/invoices/${invoiceIds[0]}`, { cookie: who.admin.cookie });
    const last = await app.call('DELETE', `/api/invoices/${invoiceIds[1]}`, { cookie: who.admin.cookie });
    expect(last.data.billRemoved).toBe(true);
    expect((await data()).bills).toEqual([]);
  });

  it('o que veio da carga da aba Embarques é apagado', async () => {
    const imported = await app.call('POST', '/api/import/shipments', {
      cookie: who.admin.cookie,
      body: { items: [{ row: 2, description: 'Livro da planilha', isbn: null, supplier: 'Sara', quantity: 100, piecesPerCarton: null, unitPriceMicros: null, notes: '', invoice: 'P1', ref: '', bill: null, eta: null, paid: true }] },
    });
    expect(imported.status).toBe(201);
    const inv = (await data()).invoices[0].id;
    const res = await app.call('DELETE', `/api/invoices/${inv}`, { cookie: who.admin.cookie });
    expect(res.data).toEqual({ back: 0, merged: 0, removed: 1, billRemoved: false });
    expect((await data()).items).toEqual([]);
  });
});

describe('especificação do produto', () => {
  const spec = (id: string, cookie = who.admin.cookie) => app.call('GET', `/api/items/${id}/specification`, { cookie });
  const items = async () => (await data()).items as Row[];

  it('a PO guarda a especificação de cada item; a reimpressão mostra a última de verdade', async () => {
    await order('PO-055', 'Sara', [line({ specification: '20,5x27,5\nwire-o binding' })]);
    await order('PO-064', 'Sara', [line({ specification: 'REPRINT — same specs as last order (2026-08-27 (3))' })]);
    const [first, reprint] = await items();
    const a = await spec(reprint!.id);
    expect(a.status).toBe(200);
    expect(a.data).toEqual({
      specification: 'REPRINT — same specs as last order (2026-08-27 (3))',
      latest: { specification: '20,5x27,5\nwire-o binding', createdAt: expect.any(String), orderCode: 'PO-055' },
    });
    expect((await spec(first!.id)).data.specification).toBe('20,5x27,5\nwire-o binding');
    // A parte embarcada leva a especificação.
    const sara = (await data()).suppliers[0].id;
    await app.call('POST', '/api/shipments', { cookie: who.editor.cookie, body: { bill: null, eta: null, invoices: [{ supplierId: sara, number: 'S1', lines: [line({ quantity: 400 })] }] } });
    const shipped = (await items()).find((i) => i.status === 'embarcado')!;
    expect((await spec(shipped.id)).data.specification).toBe('20,5x27,5\nwire-o binding');
    // O perfil Vendas não vê; o Embarques vê.
    expect((await spec(first!.id, who.vendas.cookie)).status).toBe(403);
    expect((await spec(shipped.id, who.embarques.cookie)).status).toBe(200);
  });

  it('a especificação pode ser corrigida na ficha e entra no histórico do item', async () => {
    await order('PO-055', 'Sara', [line({})]);
    const [item] = await items();
    expect((await app.call('PATCH', `/api/items/${item!.id}`, { cookie: who.editor.cookie, body: { specification: '  15x23\r\n\r\n\r\ncapa dura  ' } })).status).toBe(200);
    expect((await spec(item!.id)).data.specification).toBe('15x23\n\ncapa dura');
  });

  it('guarda as especificações de uma PO que já estava cadastrada', async () => {
    await order('PO-062', 'Claire', [line({}), line({ row: 8, description: 'A Odisseia', isbn: ODISSEIA, quantity: 500 })]);
    const res = await app.call('POST', '/api/orders/PO-062/specifications', {
      cookie: who.editor.cookie,
      body: { items: [{ description: 'Coleção Alice', isbn: ALICE, specification: 'Box C1S 400gsm' }, { description: 'Outro livro', isbn: null, specification: 'x' }] },
    });
    expect(res.data).toEqual({ updated: 1, items: 2 });
    const all = await items();
    expect((await spec(all.find((i) => i.isbn === ALICE)!.id)).data.specification).toBe('Box C1S 400gsm');
    expect((await spec(all.find((i) => i.isbn === ODISSEIA)!.id)).data.specification).toBe('');
    expect((await app.call('POST', '/api/orders/PO-099/specifications', { cookie: who.editor.cookie, body: { items: [{ description: 'x', isbn: null, specification: 'y' }] } })).status).toBe(404);
    expect((await app.call('POST', '/api/orders/PO-062/specifications', { cookie: who.consulta.cookie, body: { items: [{ description: 'x', isbn: null, specification: 'y' }] } })).status).toBe(403);
  });
});
