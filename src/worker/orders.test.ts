import { beforeEach, describe, expect, it } from 'vitest';
import { testApp } from './test-api';

let app: ReturnType<typeof testApp>;
let who: Awaited<ReturnType<ReturnType<typeof testApp>['accounts']>>;

beforeEach(async () => {
  app = testApp();
  who = await app.accounts();
});

const BASE = {
  description: 'Livro Café com Aristóteles',
  isbn: '978-65-6095-085-6',
  supplier: 'Claire',
  orderCode: 'po 63',
  quantity: 6000,
  piecesPerCarton: 40,
  unitPriceMicros: 575_000,
  notes: '',
};

const production = async (cookie: string) => (await app.call('GET', '/api/data', { cookie })).data;

describe('cadastro de itens', () => {
  it('editor cadastra; fornecedor, PO e produto são criados na hora', async () => {
    const res = await app.call('POST', '/api/items', { cookie: who.editor.cookie, body: BASE });
    expect(res.status).toBe(201);
    expect(res.data.item).toMatchObject({ isbn: '9786560950856', status: 'producao', quantity: 6000, unitPriceMicros: 575_000, totalCents: 345_000 });

    const data = await production(who.admin.cookie);
    expect(data.suppliers.map((s: { name: string }) => s.name)).toEqual(['Claire']);
    expect(data.orders.map((o: { code: string }) => o.code)).toEqual(['PO-063']);
    expect(data.items).toHaveLength(1);
  });

  it('reaproveita fornecedor (sem diferença de maiúscula), PO e produto pelo ISBN', async () => {
    await app.call('POST', '/api/items', { cookie: who.editor.cookie, body: BASE });
    const second = await app.call('POST', '/api/items', {
      cookie: who.editor.cookie,
      body: { ...BASE, description: 'Café com Aristóteles (2ª impressão)', supplier: 'claire', orderCode: 'PO-063', quantity: 3000 },
    });
    expect(second.status).toBe(201);
    const data = await production(who.admin.cookie);
    expect(data.suppliers).toHaveLength(1);
    expect(data.orders).toHaveLength(1);
    expect(new Set(data.items.map((i: { productId: string }) => i.productId)).size).toBe(1);
  });

  it('confere ISBN, PO e quantidade', async () => {
    const bad = async (body: object) => (await app.call('POST', '/api/items', { cookie: who.editor.cookie, body: { ...BASE, ...body } })).data.error;
    expect(await bad({ isbn: '978-65-6095-085-7' })).toContain('ISBN inválido');
    expect(await bad({ orderCode: 'pedido 7' })).toBe('Código de PO inválido. Use o formato PO-063.');
    expect(await bad({ quantity: 0 })).toBe('A quantidade precisa ser maior que zero.');
    expect(await bad({ description: '   ' })).toBe('Informe o produto.');
  });

  it('preço com no máximo três casas', async () => {
    const res = await app.call('POST', '/api/items', { cookie: who.editor.cookie, body: { ...BASE, unitPriceMicros: 575_500 } });
    expect(res.status).toBe(400);
    expect(res.data.error).toBe('O preço unitário tem no máximo três casas decimais.');
  });

  it('uma PO tem um fornecedor só', async () => {
    const { item } = (await app.call('POST', '/api/items', { cookie: who.editor.cookie, body: BASE })).data;
    const other = await app.call('POST', '/api/items', { cookie: who.editor.cookie, body: { ...BASE, description: 'Outro livro', supplier: 'Sara' } });
    expect(other.status).toBe(409);
    expect(other.data.error).toBe('A PO-063 é de Claire. Uma PO tem um fornecedor só: use outra PO para o item de Sara.');
    // O mesmo fornecedor, escrito de outro jeito, pode.
    expect((await app.call('POST', '/api/items', { cookie: who.editor.cookie, body: { ...BASE, description: 'Outro livro', supplier: 'CLAIRE' } })).status).toBe(201);
    // Trocar o fornecedor de um item da PO também é conferido.
    const change = await app.call('PATCH', `/api/items/${item.id}`, { cookie: who.editor.cookie, body: { supplier: 'Sara' } });
    expect(change.status).toBe(409);
    // Levar para outra PO resolve.
    const moved = await app.call('PATCH', `/api/items/${item.id}`, { cookie: who.editor.cookie, body: { supplier: 'Sara', orderCode: 'PO-070' } });
    expect(moved.status).toBe(200);
  });

  it('item sem preço, sem PO e sem fornecedor é aceito', async () => {
    const res = await app.call('POST', '/api/items', {
      cookie: who.editor.cookie,
      body: { description: 'Patrulha Canina Brincando de Banho', quantity: 8000, unitPriceMicros: null, supplier: null, orderCode: null },
    });
    expect(res.status).toBe(201);
    expect(res.data.item).toMatchObject({ supplierId: null, purchaseOrderId: null, unitPriceMicros: null, totalCents: null, isbn: null });
  });

  it('altera e registra o que mudou no histórico', async () => {
    const { item } = (await app.call('POST', '/api/items', { cookie: who.editor.cookie, body: BASE })).data;
    const res = await app.call('PATCH', `/api/items/${item.id}`, { cookie: who.editor.cookie, body: { quantity: 6500, orderCode: 'PO-064' } });
    expect(res.status).toBe(200);
    expect(res.data.item.quantity).toBe(6500);
    const events = await app.env.DB.prepare("SELECT type, detail FROM events WHERE entity_id = ? ORDER BY created_at, rowid").bind(item.id).all<{ type: string; detail: string }>();
    expect(events.results.map((e) => e.type)).toEqual(['created', 'changed']);
    expect(JSON.parse(events.results[1]!.detail).changes).toEqual([
      { field: 'PO', from: 'PO-063', to: 'PO-064' },
      { field: 'Quantidade', from: 6000, to: 6500 },
    ]);
  });

  it('guarda a aprovação do arquivo e a programação de envio, com o histórico das mudanças', async () => {
    const { item } = (await app.call('POST', '/api/items', { cookie: who.editor.cookie, body: { ...BASE, fileApprovedAt: '2026-10-02' } })).data;
    expect(item).toMatchObject({ fileApprovedAt: '2026-10-02', shipPlannedAt: null });
    const res = await app.call('PATCH', `/api/items/${item.id}`, { cookie: who.editor.cookie, body: { shipPlannedAt: '2026-12-05', fileApprovedAt: null } });
    expect(res.status).toBe(200);
    expect(res.data.item).toMatchObject({ fileApprovedAt: null, shipPlannedAt: '2026-12-05' });
    const events = await app.env.DB.prepare("SELECT detail FROM events WHERE entity_id = ? AND type = 'changed'").bind(item.id).all<{ detail: string }>();
    expect(JSON.parse(events.results[0]!.detail).changes).toEqual([
      { field: 'Aprovação do arquivo', from: '2026-10-02', to: null },
      { field: 'Programação de envio', from: null, to: '2026-12-05' },
    ]);
    // O leitor também vê as datas (não são valores).
    const seen = (await production(who.leitor.cookie)).items.find((i: { id: string }) => i.id === item.id);
    expect(seen).toMatchObject({ fileApprovedAt: null, shipPlannedAt: '2026-12-05' });
  });

  it('recusa data que não existe', async () => {
    const bad = await app.call('POST', '/api/items', { cookie: who.editor.cookie, body: { ...BASE, shipPlannedAt: '2026-02-30' } });
    expect(bad.status).toBe(400);
    expect(bad.data.error).toBe('Programação de envio: data inválida.');
    const { item } = (await app.call('POST', '/api/items', { cookie: who.editor.cookie, body: BASE })).data;
    const patch = await app.call('PATCH', `/api/items/${item.id}`, { cookie: who.editor.cookie, body: { fileApprovedAt: '05/12/2026' } });
    expect(patch.status).toBe(400);
    expect(patch.data.error).toBe('Aprovação do arquivo: data inválida.');
  });

  it('trocar só a maiúscula do fornecedor não é mudança', async () => {
    const { item } = (await app.call('POST', '/api/items', { cookie: who.editor.cookie, body: BASE })).data;
    await app.call('PATCH', `/api/items/${item.id}`, { cookie: who.editor.cookie, body: { supplier: 'CLAIRE' } });
    const n = await app.env.DB.prepare('SELECT COUNT(*) AS n FROM events WHERE entity_id = ?').bind(item.id).first<{ n: number }>();
    expect(n!.n).toBe(1);
  });
});

describe('permissões', () => {
  it('o leitor acompanha, mas não cadastra nem altera', async () => {
    const { item } = (await app.call('POST', '/api/items', { cookie: who.editor.cookie, body: BASE })).data;
    expect((await app.call('POST', '/api/items', { cookie: who.leitor.cookie, body: BASE })).status).toBe(403);
    expect((await app.call('PATCH', `/api/items/${item.id}`, { cookie: who.leitor.cookie, body: { quantity: 1 } })).status).toBe(403);
    expect((await app.call('GET', '/api/data', { cookie: who.leitor.cookie })).status).toBe(200);
  });

  it('o leitor não recebe preço nem total', async () => {
    await app.call('POST', '/api/items', { cookie: who.editor.cookie, body: BASE });
    const data = await production(who.leitor.cookie);
    expect(data.seeValues).toBe(false);
    expect(data.items[0]).not.toHaveProperty('unitPriceMicros');
    expect(data.items[0]).not.toHaveProperty('totalCents');
    expect(JSON.stringify(data)).not.toContain('575000');
    const forEditor = await production(who.editor.cookie);
    expect(forEditor.items[0].totalCents).toBe(345_000);
  });

  it('só o admin exclui; o item some da produção', async () => {
    const { item } = (await app.call('POST', '/api/items', { cookie: who.editor.cookie, body: BASE })).data;
    expect((await app.call('DELETE', `/api/items/${item.id}`, { cookie: who.editor.cookie })).status).toBe(403);
    expect((await app.call('DELETE', `/api/items/${item.id}`, { cookie: who.admin.cookie })).status).toBe(200);
    expect((await production(who.admin.cookie)).items).toHaveLength(0);
    expect((await app.call('PATCH', `/api/items/${item.id}`, { cookie: who.admin.cookie, body: { quantity: 1 } })).status).toBe(404);
  });

  it('só o admin faz a carga', async () => {
    const res = await app.call('POST', '/api/import/production', { cookie: who.editor.cookie, body: { items: [{ ...BASE, row: 2 }] } });
    expect(res.status).toBe(403);
  });
});

describe('carga da aba Produção', () => {
  const rows = [
    { ...BASE, isbn: '9786560950856', orderCode: null, row: 2 },
    { description: 'Maleta Divertida - LOL Surprise', isbn: '9786561260039', supplier: 'Sara', orderCode: 'PO-046', quantity: 4800, piecesPerCarton: 40, unitPriceMicros: 880_000, notes: '', row: 3 },
    { description: 'Por que uma Filha precisa de uma Mãe 01', isbn: '9786561260671', supplier: 'Sara', orderCode: 'PO-014', quantity: 5000, piecesPerCarton: null, unitPriceMicros: null, notes: '', row: 4 },
    { description: 'Por que uma Filha precisa de uma Mãe 01', isbn: '9786561260671', supplier: 'Sara', orderCode: 'PO-035', quantity: 18000, piecesPerCarton: null, unitPriceMicros: null, notes: '', row: 5 },
    { description: 'Devocional da Mulher (Capa PU)', isbn: null, supplier: 'Nicola', orderCode: 'PO-057', quantity: 20000, piecesPerCarton: null, unitPriceMicros: 820_000, notes: 'ISBN informado na planilha: TBC', row: 6 },
  ];

  it('grava os itens, com fornecedores, POs e produtos', async () => {
    const res = await app.call('POST', '/api/import/production', { cookie: who.admin.cookie, body: { items: rows } });
    expect(res.status).toBe(201);
    expect(res.data).toEqual({ inserted: 5, skipped: 0, withoutOrder: [] });
    const data = await production(who.admin.cookie);
    expect(data.items).toHaveLength(5);
    expect(data.suppliers.map((s: { name: string }) => s.name)).toEqual(['Claire', 'Nicola', 'Sara']);
    expect(data.orders.map((o: { code: string }) => o.code).sort()).toEqual(['PO-014', 'PO-035', 'PO-046', 'PO-057']);
    // O mesmo ISBN em duas POs é o mesmo produto.
    const products = await app.env.DB.prepare('SELECT COUNT(*) AS n FROM products').first<{ n: number }>();
    expect(products!.n).toBe(4);
  });

  it('mandar a mesma planilha de novo não repete itens', async () => {
    await app.call('POST', '/api/import/production', { cookie: who.admin.cookie, body: { items: rows } });
    const again = await app.call('POST', '/api/import/production', { cookie: who.admin.cookie, body: { items: rows } });
    expect(again.data).toEqual({ inserted: 0, skipped: 5, withoutOrder: [] });
    expect((await production(who.admin.cookie)).items).toHaveLength(5);
  });

  it('cabe no limite de consultas por pedido', async () => {
    const many = Array.from({ length: 500 }, (_, i) => ({ ...rows[1]!, description: `Livro ${i}`, isbn: null, orderCode: `PO-${100 + (i % 40)}`, row: i + 2 }));
    const before = (app.env.DB as unknown as { queries: number }).queries;
    const res = await app.call('POST', '/api/import/production', { cookie: who.admin.cookie, body: { items: many } });
    expect(res.data.inserted).toBe(500);
    expect((app.env.DB as unknown as { queries: number }).queries - before).toBeLessThan(10);
  });

  it('item cuja PO já é de outro fornecedor entra sem PO, com a PO nas observações', async () => {
    await app.call('POST', '/api/import/production', { cookie: who.admin.cookie, body: { items: rows } });
    const res = await app.call('POST', '/api/import/production', {
      cookie: who.admin.cookie,
      body: { items: [{ ...rows[1]!, description: 'Livro da Claire', supplier: 'Claire', row: 9 }] },
    });
    expect(res.data.inserted).toBe(1);
    expect(res.data.withoutOrder).toEqual(['"Livro da Claire": a PO-046 é de Sara e este item é de Claire; entra sem PO.']);
    const item = (await production(who.admin.cookie)).items.find((i: { description: string }) => i.description === 'Livro da Claire');
    expect(item).toMatchObject({ purchaseOrderId: null, notes: 'PO na planilha: PO-046 (a PO é de Sara)' });
  });

  it('recusa ISBN inválido mesmo vindo da carga', async () => {
    const res = await app.call('POST', '/api/import/production', { cookie: who.admin.cookie, body: { items: [{ ...rows[1]!, isbn: '9786561260030' }] } });
    expect(res.status).toBe(400);
  });
});
