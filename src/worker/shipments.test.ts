import { beforeEach, describe, expect, it } from 'vitest';
import { testApp } from './test-api';

let app: ReturnType<typeof testApp>;
let who: Awaited<ReturnType<ReturnType<typeof testApp>['accounts']>>;

beforeEach(async () => {
  app = testApp();
  who = await app.accounts();
});

const item = (over: object) => ({ description: 'Livro', isbn: null, supplier: 'Sara', orderCode: 'PO-063', quantity: 1000, piecesPerCarton: null, unitPriceMicros: 500_000, notes: '', ...over });

async function create(over: object) {
  const res = await app.call('POST', '/api/items', { cookie: who.editor.cookie, body: item(over) });
  expect(res.status).toBe(201);
  return res.data.item as { id: string };
}

const data = async (cookie = who.admin.cookie) => (await app.call('GET', '/api/data', { cookie })).data;
const NEW_INVOICE = { number: '2026-47B', ref: '2026-10-13 (2)', bill: 'ROECHN26101769', eta: '2026-11-26' };

describe('embarcar', () => {
  it('embarca inteiro e em parte numa invoice nova, com BL novo', async () => {
    const a = await create({ description: 'Livro A', quantity: 1000 });
    const b = await create({ description: 'Livro B', quantity: 5000 });
    const res = await app.call('POST', '/api/ship', {
      cookie: who.editor.cookie,
      body: { lines: [{ itemId: a.id, quantity: 1000 }, { itemId: b.id, quantity: 2000 }], newInvoice: NEW_INVOICE },
    });
    expect(res.status).toBe(201);

    const d = await data();
    expect(d.bills).toEqual([{ id: expect.any(String), number: 'ROECHN26101769', eta: '2026-11-26', arrivedAt: null, notes: '', document: null }]);
    expect(d.invoices).toMatchObject([{ number: '2026-47B', ref: '2026-10-13 (2)', billId: d.bills[0].id, eta: null }]);
    const byDesc = (desc: string, status: string) => d.items.filter((i: { description: string; status: string }) => i.description === desc && i.status === status);
    expect(byDesc('Livro A', 'embarcado')).toMatchObject([{ quantity: 1000, invoiceId: res.data.invoiceId }]);
    // B se divide: 3.000 seguem em produção, 2.000 embarcam, com a mesma PO e o mesmo preço.
    expect(byDesc('Livro B', 'producao')).toMatchObject([{ quantity: 3000 }]);
    expect(byDesc('Livro B', 'embarcado')).toMatchObject([{ quantity: 2000, unitPriceMicros: 500_000, purchaseOrderId: byDesc('Livro B', 'producao')[0].purchaseOrderId }]);
  });

  it('embarca numa invoice que já existe, do mesmo fornecedor', async () => {
    const a = await create({ description: 'Livro A' });
    const first = await app.call('POST', '/api/ship', { cookie: who.editor.cookie, body: { lines: [{ itemId: a.id, quantity: 1000 }], newInvoice: NEW_INVOICE } });
    const b = await create({ description: 'Livro B' });
    const res = await app.call('POST', '/api/ship', { cookie: who.editor.cookie, body: { lines: [{ itemId: b.id, quantity: 1000 }], invoiceId: first.data.invoiceId } });
    expect(res.status).toBe(201);
    expect((await data()).invoices).toHaveLength(1);
  });

  it('recusa fornecedores misturados, invoice de outro fornecedor e invoice repetida', async () => {
    const sara = await create({ description: 'Da Sara' });
    const claire = await create({ description: 'Da Claire', supplier: 'Claire', orderCode: 'PO-064' });
    const mixed = await app.call('POST', '/api/ship', {
      cookie: who.editor.cookie,
      body: { lines: [{ itemId: sara.id, quantity: 1000 }, { itemId: claire.id, quantity: 1000 }], newInvoice: NEW_INVOICE },
    });
    expect(mixed.status).toBe(400);
    expect(mixed.data.error).toContain('um fornecedor só');

    const ok = await app.call('POST', '/api/ship', { cookie: who.editor.cookie, body: { lines: [{ itemId: sara.id, quantity: 1000 }], newInvoice: NEW_INVOICE } });
    const other = await app.call('POST', '/api/ship', { cookie: who.editor.cookie, body: { lines: [{ itemId: claire.id, quantity: 1000 }], invoiceId: ok.data.invoiceId } });
    expect(other.data.error).toBe('Esta invoice é de outro fornecedor.');

    const sara2 = await create({ description: 'Da Sara 2' });
    const again = await app.call('POST', '/api/ship', { cookie: who.editor.cookie, body: { lines: [{ itemId: sara2.id, quantity: 1000 }], newInvoice: NEW_INVOICE } });
    expect(again.status).toBe(409);
    expect(again.data.error).toBe('A invoice 2026-47B já existe. Escolha-a na lista em vez de criar outra.');
  });

  it('o leitor não embarca', async () => {
    const a = await create({});
    expect((await app.call('POST', '/api/ship', { cookie: who.leitor.cookie, body: { lines: [{ itemId: a.id, quantity: 1 }], newInvoice: NEW_INVOICE } })).status).toBe(403);
  });

  it('desfaz o embarque; item embarcado não troca de fornecedor', async () => {
    const a = await create({});
    await app.call('POST', '/api/ship', { cookie: who.editor.cookie, body: { lines: [{ itemId: a.id, quantity: 1000 }], newInvoice: NEW_INVOICE } });
    const change = await app.call('PATCH', `/api/items/${a.id}`, { cookie: who.editor.cookie, body: { supplier: 'Claire', orderCode: 'PO-099' } });
    expect(change.status).toBe(409);
    expect((await app.call('POST', `/api/items/${a.id}/unship`, { cookie: who.editor.cookie })).status).toBe(200);
    expect((await data()).items[0]).toMatchObject({ status: 'producao', invoiceId: null });
  });
});

describe('chegada', () => {
  async function shipped() {
    const a = await create({});
    const res = await app.call('POST', '/api/ship', { cookie: who.editor.cookie, body: { lines: [{ itemId: a.id, quantity: 1000 }], newInvoice: NEW_INVOICE } });
    const d = await data();
    return { itemId: a.id, invoiceId: res.data.invoiceId as string, billId: d.bills[0].id as string };
  }

  it('marcar a chegada do BL entrega os itens; desmarcar volta para embarcado', async () => {
    const { billId, itemId } = await shipped();
    expect((await app.call('PATCH', `/api/bills/${billId}`, { cookie: who.editor.cookie, body: { arrivedAt: '2026-11-17' } })).status).toBe(200);
    let d = await data();
    expect(d.items[0]).toMatchObject({ status: 'entregue' });
    expect(d.bills[0].arrivedAt).toBe('2026-11-17');
    expect((await app.call('POST', `/api/items/${itemId}/unship`, { cookie: who.editor.cookie })).status).toBe(409);
    await app.call('PATCH', `/api/bills/${billId}`, { cookie: who.editor.cookie, body: { arrivedAt: null } });
    d = await data();
    expect(d.items[0]).toMatchObject({ status: 'embarcado' });
  });

  it('o que chegou há mais de 60 dias sai da tela de embarques', async () => {
    const { billId } = await shipped();
    await app.call('PATCH', `/api/bills/${billId}`, { cookie: who.editor.cookie, body: { arrivedAt: '2026-09-01' } });
    const d = await data();
    expect(d.items).toHaveLength(0);
    expect(d.bills).toHaveLength(0);
    expect(d.invoices).toHaveLength(0);
  });

  it('invoice sem BL tem chegada própria; ao ganhar um BL, vale a do BL', async () => {
    const a = await create({});
    const res = await app.call('POST', '/api/ship', { cookie: who.editor.cookie, body: { lines: [{ itemId: a.id, quantity: 1000 }], newInvoice: { number: '108', ref: '', bill: null, eta: '2026-11-21' } } });
    let d = await data();
    expect(d.invoices[0]).toMatchObject({ billId: null, eta: '2026-11-21' });
    await app.call('PATCH', `/api/invoices/${res.data.invoiceId}`, { cookie: who.editor.cookie, body: { arrivedAt: '2026-11-17' } });
    expect((await data()).items[0].status).toBe('entregue');
    await app.call('PATCH', `/api/invoices/${res.data.invoiceId}`, { cookie: who.editor.cookie, body: { bill: 'ROECHN26110606', arrivedAt: null } });
    d = await data();
    expect(d.invoices[0].billId).toBe(d.bills[0].id);
    expect(d.items[0].status).toBe('embarcado');
  });

  it('número de BL repetido é recusado', async () => {
    const { billId } = await shipped();
    const b = await create({ description: 'Outro', orderCode: 'PO-064' });
    await app.call('POST', '/api/ship', { cookie: who.editor.cookie, body: { lines: [{ itemId: b.id, quantity: 1000 }], newInvoice: { ...NEW_INVOICE, number: 'X', bill: 'OUTRO-BL' } } });
    const res = await app.call('PATCH', `/api/bills/${billId}`, { cookie: who.editor.cookie, body: { number: 'outro-bl' } });
    expect(res.status).toBe(409);
  });
});

describe('pagamentos', () => {
  async function invoice() {
    const a = await create({ quantity: 1000, unitPriceMicros: 500_000 });
    return (await app.call('POST', '/api/ship', { cookie: who.editor.cookie, body: { lines: [{ itemId: a.id, quantity: 1000 }], newInvoice: NEW_INVOICE } })).data.invoiceId as string;
  }

  it('o editor registra pagamento com câmbio; só o admin exclui', async () => {
    const id = await invoice();
    const res = await app.call('POST', `/api/invoices/${id}/payments`, {
      cookie: who.editor.cookie,
      body: { paidAt: '2026-11-17', amountCents: 20_000, exchangeRateE4: 54_321, notes: 'sinal' },
    });
    expect(res.status).toBe(201);
    expect((await data()).payments).toEqual([{ id: res.data.id, invoiceId: id, paidAt: '2026-11-17', amountCents: 20_000, exchangeRateE4: 54_321, notes: 'sinal' }]);
    expect((await app.call('DELETE', `/api/payments/${res.data.id}`, { cookie: who.editor.cookie })).status).toBe(403);
    expect((await app.call('DELETE', `/api/payments/${res.data.id}`, { cookie: who.admin.cookie })).status).toBe(200);
  });

  it('o leitor não vê nem registra pagamentos', async () => {
    const id = await invoice();
    await app.call('POST', `/api/invoices/${id}/payments`, { cookie: who.editor.cookie, body: { amountCents: 20_000 } });
    const d = await data(who.leitor.cookie);
    expect(d.payments).toEqual([]);
    expect(JSON.stringify(d)).not.toContain('20000');
    expect((await app.call('POST', `/api/invoices/${id}/payments`, { cookie: who.leitor.cookie, body: { amountCents: 1 } })).status).toBe(403);
  });

  it('pagamento precisa de valor', async () => {
    const id = await invoice();
    const res = await app.call('POST', `/api/invoices/${id}/payments`, { cookie: who.editor.cookie, body: { amountCents: null } });
    expect(res.data.error).toBe('Informe o valor pago.');
  });
});

describe('carga da aba Embarques', () => {
  const row = (over: object) => ({
    row: 2,
    description: 'Cartilha Mágica 01 - Alfabeto',
    isbn: '9786561267106',
    supplier: 'Sara',
    quantity: 9440,
    piecesPerCarton: 40,
    unitPriceMicros: 330_000,
    notes: '',
    invoice: '2026-46A',
    ref: '2026-09-25 (1)',
    bill: 'ROECHN26093881',
    eta: '2026-11-20',
    paid: true,
    ...over,
  });
  const rows = [
    row({}),
    row({ row: 3, description: 'Cartilha Mágica 01 - Vogais', isbn: '9786561267120', quantity: 10040 }),
    row({ row: 4, description: 'Patrulha Canina 05', isbn: null, invoice: '2026-46B', ref: '2026-09-25 (2)', quantity: 10000, unitPriceMicros: 250_000 }),
    row({ row: 5, description: 'Livro do Kaushik', isbn: null, supplier: 'Kaushik', invoice: '108', ref: '', bill: null, eta: '2026-11-21', quantity: 2000 }),
  ];

  it('cria BLs, invoices, um pagamento antigo por invoice e os itens embarcados', async () => {
    const res = await app.call('POST', '/api/import/shipments', { cookie: who.admin.cookie, body: { items: rows } });
    expect(res.status).toBe(201);
    expect(res.data).toEqual({ inserted: 4, skipped: 0 });
    const d = await data();
    expect(d.bills.map((b: { number: string; eta: string }) => [b.number, b.eta])).toEqual([['ROECHN26093881', '2026-11-20']]);
    expect(d.invoices.map((v: { number: string; billId: string | null; eta: string | null }) => [v.number, Boolean(v.billId), v.eta])).toEqual([
      ['2026-46A', true, null],
      ['2026-46B', true, null],
      ['108', false, '2026-11-21'],
    ]);
    expect(d.payments).toHaveLength(3);
    expect(d.payments.every((p: { amountCents: number | null }) => p.amountCents === null)).toBe(true);
    expect(d.items.every((i: { status: string; purchaseOrderId: string | null }) => i.status === 'embarcado' && i.purchaseOrderId === null)).toBe(true);
  });

  it('mandar de novo não repete', async () => {
    await app.call('POST', '/api/import/shipments', { cookie: who.admin.cookie, body: { items: rows } });
    const again = await app.call('POST', '/api/import/shipments', { cookie: who.admin.cookie, body: { items: rows } });
    expect(again.data).toEqual({ inserted: 0, skipped: 4 });
    expect((await data()).payments).toHaveLength(3);
  });

  it('só o admin faz a carga; cabe no limite de consultas', async () => {
    expect((await app.call('POST', '/api/import/shipments', { cookie: who.editor.cookie, body: { items: rows } })).status).toBe(403);
    const many = Array.from({ length: 500 }, (_, i) => row({ row: i + 2, description: `Livro ${i}`, isbn: null, invoice: `INV-${i % 25}`, bill: `BL-${i % 10}` }));
    const before = (app.env.DB as unknown as { queries: number }).queries;
    const res = await app.call('POST', '/api/import/shipments', { cookie: who.admin.cookie, body: { items: many } });
    expect(res.data.inserted).toBe(500);
    expect((app.env.DB as unknown as { queries: number }).queries - before).toBeLessThan(12);
  });
});
