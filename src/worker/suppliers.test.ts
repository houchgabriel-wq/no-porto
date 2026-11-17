import { beforeEach, describe, expect, it } from 'vitest';
import { testApp } from './test-api';

let app: ReturnType<typeof testApp>;
let who: Awaited<ReturnType<ReturnType<typeof testApp>['accounts']>>;

beforeEach(async () => {
  app = testApp();
  who = await app.accounts();
});

const item = (over: object) => ({ description: 'Livro', isbn: null, supplier: 'Sara', orderCode: 'PO-063', quantity: 1000, piecesPerCarton: null, unitPriceMicros: 575_000, notes: '', ...over });
const history = (over: object) => ({
  row: 2,
  description: 'Livro antigo',
  isbn: null,
  supplier: 'Sara',
  quantity: 3,
  piecesPerCarton: null,
  unitPriceMicros: 333_000,
  notes: '',
  invoice: '23-1089',
  ref: '23-1089',
  bill: null,
  arrivedAt: '2025-05-22',
  arrivalNote: '',
  paid: true,
  ...over,
});

const summary = async (cookie = who.admin.cookie) => (await app.call('GET', '/api/suppliers', { cookie })).data;

describe('fornecedores', () => {
  it('soma produção, mar e entregue por ano, com o total arredondado ao centavo como no resto do sistema', async () => {
    await app.call('POST', '/api/items', { cookie: who.editor.cookie, body: item({}) });
    const shipped = (await app.call('POST', '/api/items', { cookie: who.editor.cookie, body: item({ description: 'Embarcado', quantity: 2000 }) })).data.item;
    await app.call('POST', '/api/ship', { cookie: who.editor.cookie, body: { lines: [{ itemId: shipped.id, quantity: 2000 }], newInvoice: { number: 'X', ref: '', bill: null, eta: null } } });
    await app.call('POST', '/api/import/history', { cookie: who.admin.cookie, body: { items: [history({}), history({ row: 3, description: 'Outro', invoice: '26-0001', ref: '26-0001', arrivedAt: '2026-01-10' })] } });

    const { suppliers } = await summary();
    expect(suppliers).toHaveLength(1);
    expect(suppliers[0]).toMatchObject({
      name: 'Sara',
      production: { items: 1, quantity: 1000, valueCents: 57_500 },
      atSea: { items: 1, quantity: 2000, valueCents: 115_000 },
      // 3 × 0,333 = 0,999 → 1,00 cada
      delivered: { items: 2, quantity: 6, valueCents: 200 },
      lastArrival: '2026-01-10',
    });
    expect(suppliers[0].byYear.map((y: { year: string }) => y.year)).toEqual(['2026', '2025']);
  });

  it('o leitor vê sem valores', async () => {
    await app.call('POST', '/api/items', { cookie: who.editor.cookie, body: item({}) });
    const s = await summary(who.leitor.cookie);
    expect(s.seeValues).toBe(false);
    expect(JSON.stringify(s)).not.toContain('valueCents');
  });

  it('editor renomeia e anota; nome repetido é recusado; o leitor não altera', async () => {
    await app.call('POST', '/api/items', { cookie: who.editor.cookie, body: item({}) });
    await app.call('POST', '/api/items', { cookie: who.editor.cookie, body: item({ supplier: 'Claire', orderCode: 'PO-064' }) });
    const { suppliers } = await summary();
    const sara = suppliers.find((s: { name: string }) => s.name === 'Sara');
    expect((await app.call('PATCH', `/api/suppliers/${sara.supplierId}`, { cookie: who.leitor.cookie, body: { notes: 'x' } })).status).toBe(403);
    expect((await app.call('PATCH', `/api/suppliers/${sara.supplierId}`, { cookie: who.editor.cookie, body: { name: 'claire' } })).status).toBe(409);
    const ok = await app.call('PATCH', `/api/suppliers/${sara.supplierId}`, { cookie: who.editor.cookie, body: { name: 'Sara (Ningbo)', notes: 'Contato: Sara Li' } });
    expect(ok.data.supplier).toEqual({ id: sara.supplierId, name: 'Sara (Ningbo)', notes: 'Contato: Sara Li' });
    const data = (await app.call('GET', '/api/data', { cookie: who.admin.cookie })).data;
    expect(data.suppliers.map((s: { name: string }) => s.name)).toContain('Sara (Ningbo)');
  });
});
