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

  it('só admin e editor veem os fornecedores (decidido em 19/11/2026)', async () => {
    await app.call('POST', '/api/items', { cookie: who.editor.cookie, body: item({}) });
    expect((await app.call('GET', '/api/suppliers', { cookie: who.editor.cookie })).status).toBe(200);
    for (const w of [who.consulta, who.leitor, who.embarques, who.vendas, who.agente]) {
      const res = await app.call('GET', '/api/suppliers', { cookie: w.cookie });
      expect(res.status).toBe(403);
      expect(res.data.error).toBe('Seu perfil não vê os fornecedores.');
    }
  });

  it('o recebido no ano do painel sai para quem vê o painel; o leitor, sem valores', async () => {
    await app.call('POST', '/api/import/history', {
      cookie: who.admin.cookie,
      body: { items: [history({}), history({ row: 3, description: 'Outro', invoice: '26-0001', ref: '26-0001', arrivedAt: '2026-01-10', quantity: 30 })] },
    });
    // O relógio dos testes está em 17/11/2026: vale o que chegou em 2026.
    const consulta = await app.call('GET', '/api/received', { cookie: who.consulta.cookie });
    expect(consulta.data).toEqual({ year: '2026', amount: { items: 1, quantity: 30, valueCents: 999 }, seeValues: true });
    const leitor = await app.call('GET', '/api/received', { cookie: who.leitor.cookie });
    expect(leitor.data).toEqual({ year: '2026', amount: { items: 1, quantity: 30 }, seeValues: false });
    for (const w of [who.embarques, who.vendas, who.agente]) expect((await app.call('GET', '/api/received', { cookie: w.cookie })).status).toBe(403);
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

describe('cópia completa', () => {
  it('admin, Editor e Consulta baixam; traz itens, invoices, BLs, pagamentos, POs e fornecedores', async () => {
    await app.call('POST', '/api/items', { cookie: who.editor.cookie, body: item({}) });
    for (const w of [who.leitor, who.embarques, who.vendas, who.agente]) {
      const denied = await app.call('GET', '/api/export', { cookie: w.cookie });
      expect(denied.status).toBe(403);
      expect(denied.data.error).toBe('Seu perfil não baixa a cópia completa.');
    }
    for (const w of [who.admin, who.editor, who.consulta]) {
      const res = await app.call('GET', '/api/export', { cookie: w.cookie });
      expect(res.status).toBe(200);
      expect(Object.keys(res.data).sort()).toEqual(['bills', 'invoices', 'items', 'orders', 'payments', 'suppliers']);
      expect(res.data.items[0]).toMatchObject({ unitPriceMicros: 575_000, purchaseOrderId: expect.any(String) });
    }
  });
});

describe('cargas com as datas do item (cópia completa)', () => {
  it('Produção, Embarques e Entregues gravam a aprovação do arquivo e a programação de envio', async () => {
    const dates = { fileApprovedAt: '2026-10-02', shipPlan: [{ month: '2026-12', quantity: 10 }] };
    expect((await app.call('POST', '/api/import/production', { cookie: who.admin.cookie, body: { items: [{ ...item({ description: 'Na produção' }), row: 2, ...dates }] } })).status).toBe(201);
    const ship = { row: 2, description: 'No mar', isbn: null, supplier: 'Sara', quantity: 10, piecesPerCarton: null, unitPriceMicros: 1_000, notes: '', invoice: 'S-1', ref: '', bill: null, eta: '2026-12-20', paid: false };
    expect((await app.call('POST', '/api/import/shipments', { cookie: who.admin.cookie, body: { items: [{ ...ship, ...dates }] } })).status).toBe(201);
    expect((await app.call('POST', '/api/import/history', { cookie: who.admin.cookie, body: { items: [history({ description: 'Entregue', fileApprovedAt: '2025-03-01' })] } })).status).toBe(201);
    const d = (await app.call('GET', '/api/data', { cookie: who.admin.cookie })).data;
    const got = (desc: string) => d.items.find((i: { description: string }) => i.description === desc);
    expect(got('Na produção')).toMatchObject(dates);
    expect(got('No mar')).toMatchObject(dates);
    const copy = (await app.call('GET', '/api/export', { cookie: who.admin.cookie })).data;
    expect(copy.items.find((i: { description: string }) => i.description === 'Entregue')).toMatchObject({ fileApprovedAt: '2025-03-01', shipPlan: [] });
    // Programação maior que a quantidade não entra pela carga.
    const bad = await app.call('POST', '/api/import/production', { cookie: who.admin.cookie, body: { items: [{ ...item({ description: 'Outro' }), row: 7, shipPlan: [{ month: '2026-12', quantity: 5_000 }] }] } });
    expect(bad.status).toBe(400);
    expect(bad.data.error).toBe('Linha 7: A programação de envio soma 5.000 exemplares, mais que os 1.000 do item.');
  });
});

describe('juntar fornecedores', () => {
  it('o admin junta a Lilian na Ricky: produção, embarques e entregues passam, e a Lilian some', async () => {
    await app.call('POST', '/api/items', { cookie: who.editor.cookie, body: item({ supplier: 'Ricky', description: 'Do Ricky', orderCode: 'PO-070' }) });
    await app.call('POST', '/api/items', { cookie: who.editor.cookie, body: item({ supplier: 'Lilian', description: 'Da Lilian', orderCode: 'PO-071', quantity: 500 }) });
    const shipped = (await app.call('POST', '/api/items', { cookie: who.editor.cookie, body: item({ supplier: 'Lilian', description: 'No mar', orderCode: 'PO-071', quantity: 2000 }) })).data.item;
    await app.call('POST', '/api/ship', { cookie: who.editor.cookie, body: { lines: [{ itemId: shipped.id, quantity: 2000 }], newInvoice: { number: 'L-1', ref: '', bill: 'BL-9', eta: null } } });
    await app.call('POST', '/api/import/history', { cookie: who.admin.cookie, body: { items: [history({ supplier: 'Lilian' })] } });

    const before = (await summary()).suppliers as { supplierId: string; name: string }[];
    const ricky = before.find((s) => s.name === 'Ricky')!.supplierId;
    const lilian = before.find((s) => s.name === 'Lilian')!.supplierId;
    await app.call('PATCH', `/api/suppliers/${lilian}`, { cookie: who.admin.cookie, body: { notes: 'Paga em 30 dias' } });

    expect((await app.call('POST', `/api/suppliers/${lilian}/merge`, { cookie: who.editor.cookie, body: { into: ricky } })).status).toBe(403);
    expect((await app.call('POST', `/api/suppliers/${lilian}/merge`, { cookie: who.admin.cookie, body: { into: lilian } })).status).toBe(400);
    expect((await app.call('POST', `/api/suppliers/${lilian}/merge`, { cookie: who.admin.cookie, body: { into: 'nao-existe' } })).status).toBe(404);

    const res = await app.call('POST', `/api/suppliers/${lilian}/merge`, { cookie: who.admin.cookie, body: { into: ricky } });
    expect(res.status).toBe(200);
    expect(res.data.moved).toEqual({ items: 3, invoices: 2 });

    const { suppliers } = await summary();
    expect(suppliers).toHaveLength(1);
    expect(suppliers[0]).toMatchObject({
      supplierId: ricky,
      name: 'Ricky',
      notes: 'Paga em 30 dias\n\nTambém aparecia como Lilian.',
      production: { items: 2, quantity: 1500 },
      atSea: { items: 1, quantity: 2000 },
      delivered: { items: 1, quantity: 3 },
    });
    // Nos embarques e no histórico, tudo aparece com a Ricky.
    const data = (await app.call('GET', '/api/data', { cookie: who.admin.cookie })).data;
    expect(new Set(data.items.map((i: { supplierId: string }) => i.supplierId))).toEqual(new Set([ricky]));
    expect(data.suppliers.map((s: { name: string }) => s.name)).toEqual(['Ricky']);
    // Juntar de novo o que já saiu não acha o fornecedor.
    expect((await app.call('POST', `/api/suppliers/${lilian}/merge`, { cookie: who.admin.cookie, body: { into: ricky } })).status).toBe(404);
  });
});
