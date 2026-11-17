import { beforeEach, describe, expect, it } from 'vitest';
import { testApp } from './test-api';

let app: ReturnType<typeof testApp>;
let who: Awaited<ReturnType<ReturnType<typeof testApp>['accounts']>>;

beforeEach(async () => {
  app = testApp();
  who = await app.accounts();
});

const row = (over: object) => ({
  row: 2,
  description: 'Escolinha Divertida Extra - Alfabeto',
  isbn: '9786560950856',
  supplier: 'Sara',
  quantity: 10000,
  piecesPerCarton: null,
  unitPriceMicros: 750_000,
  notes: '',
  invoice: '23-1089',
  ref: '23-1089',
  bill: null,
  arrivedAt: '2023-05-22',
  arrivalNote: 'Chegada na planilha: "Chegada dia 22/05" (ano pelo bloco 2023 da planilha)',
  paid: true,
  ...over,
});

const rows = [
  row({}),
  row({ row: 3, description: 'Escolinha Divertida Extra - Números', isbn: null, quantity: 5000 }),
  row({ row: 4, description: 'Livro do BL', isbn: null, invoice: 'WAC20250712_D', ref: '', bill: 'ROECHN25071889', arrivedAt: '2025-08-29' }),
  row({ row: 5, description: 'Outro container do mesmo BL', isbn: null, invoice: 'WAC20250712_C', ref: '', bill: 'ROECHN25071889', arrivedAt: '2025-09-02' }),
  row({ row: 6, description: 'Sem data', isbn: null, invoice: 'GN-572', ref: 'GN-572', supplier: 'Apurv', arrivedAt: null, arrivalNote: 'Sem chegada na planilha', paid: false }),
];

const history = async (cookie = who.admin.cookie) => (await app.call('GET', '/api/history', { cookie })).data;

describe('carga da aba Entregues', () => {
  it('grava itens entregues com a chegada na invoice e a anotação da planilha', async () => {
    const res = await app.call('POST', '/api/import/history', { cookie: who.admin.cookie, body: { items: rows } });
    expect(res.status).toBe(201);
    expect(res.data).toEqual({ inserted: 5, skipped: 0 });
    const h = await history();
    expect(h.items).toHaveLength(5);
    expect(h.items.every((i: { status: string }) => i.status === 'entregue')).toBe(true);
    const byNumber = Object.fromEntries(h.invoices.map((v: { number: string }) => [v.number, v]));
    expect(byNumber['23-1089']).toMatchObject({ arrivedAt: '2023-05-22', billNumber: null, notes: expect.stringContaining('bloco 2023') });
    // Dois containers do mesmo BL, cada um com o seu dia.
    expect(byNumber['WAC20250712_D']).toMatchObject({ billNumber: 'ROECHN25071889', arrivedAt: '2025-08-29' });
    expect(byNumber['WAC20250712_C']).toMatchObject({ billNumber: 'ROECHN25071889', arrivedAt: '2025-09-02' });
    expect(byNumber['GN-572'].arrivedAt).toBeNull();
  });

  it('o histórico não aparece na tela de embarques, nem o que não tem data', async () => {
    await app.call('POST', '/api/import/history', { cookie: who.admin.cookie, body: { items: rows } });
    const d = (await app.call('GET', '/api/data', { cookie: who.admin.cookie })).data;
    expect(d.items).toHaveLength(0);
    expect(d.invoices).toHaveLength(0);
    expect(d.bills).toHaveLength(0);
  });

  it('mandar de novo não repete; só o admin faz a carga', async () => {
    await app.call('POST', '/api/import/history', { cookie: who.admin.cookie, body: { items: rows } });
    const again = await app.call('POST', '/api/import/history', { cookie: who.admin.cookie, body: { items: rows } });
    expect(again.data).toEqual({ inserted: 0, skipped: 5 });
    expect((await app.call('POST', '/api/import/history', { cookie: who.editor.cookie, body: { items: rows } })).status).toBe(403);
  });

  it('o leitor vê o histórico sem preço nem total', async () => {
    await app.call('POST', '/api/import/history', { cookie: who.admin.cookie, body: { items: rows } });
    const h = await history(who.leitor.cookie);
    expect(h.seeValues).toBe(false);
    expect(h.items).toHaveLength(5);
    expect(JSON.stringify(h)).not.toContain('750000');
  });

  it('cabe no limite de consultas', async () => {
    const many = Array.from({ length: 500 }, (_, i) => row({ row: i + 2, description: `Livro ${i}`, isbn: null, invoice: `INV-${i % 40}`, bill: `BL-${i % 15}` }));
    const before = (app.env.DB as unknown as { queries: number }).queries;
    const res = await app.call('POST', '/api/import/history', { cookie: who.admin.cookie, body: { items: many } });
    expect(res.data.inserted).toBe(500);
    expect((app.env.DB as unknown as { queries: number }).queries - before).toBeLessThan(10);
  });
});

describe('ficha do produto', () => {
  it('junta as compras do histórico e da produção pelo ISBN', async () => {
    await app.call('POST', '/api/import/history', { cookie: who.admin.cookie, body: { items: rows } });
    await app.call('POST', '/api/items', {
      cookie: who.editor.cookie,
      body: { description: 'Livro Café com Aristóteles (reimpressão)', isbn: '9786560950856', supplier: 'Claire', orderCode: 'PO-070', quantity: 6000, unitPriceMicros: 575_000 },
    });
    const h = await history();
    const productId = h.items.find((i: { isbn: string | null }) => i.isbn === '9786560950856').productId;
    const res = await app.call('GET', `/api/products/${productId}`, { cookie: who.editor.cookie });
    expect(res.status).toBe(200);
    expect(res.data.product).toMatchObject({ isbn: '9786560950856' });
    expect(res.data.items.map((i: { status: string; unitPriceMicros: number }) => [i.status, i.unitPriceMicros])).toEqual([
      ['entregue', 750_000],
      ['producao', 575_000],
    ]);
    expect(res.data.orders.map((o: { code: string }) => o.code)).toEqual(['PO-070']);
    expect(res.data.invoices.map((v: { number: string }) => v.number)).toEqual(['23-1089']);
    const forReader = await app.call('GET', `/api/products/${productId}`, { cookie: who.leitor.cookie });
    expect(forReader.data.items[0]).not.toHaveProperty('unitPriceMicros');
    expect((await app.call('GET', '/api/products/nao-existe', { cookie: who.leitor.cookie })).status).toBe(404);
  });
});
