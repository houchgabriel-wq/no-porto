// Atualizar pela planilha (19/11/2026): a rota que grava, de uma vez, o que mudou na lista baixada.
import { beforeEach, describe, expect, it } from 'vitest';
import type { Item } from '../core/items';
import { itemCode, readItemCode } from '../core/updateSheet';
import { testApp } from './test-api';

let app: ReturnType<typeof testApp>;
let who: Awaited<ReturnType<ReturnType<typeof testApp>['accounts']>>;

const line = (over: object) => ({ row: 7, description: 'Coleção Alice', isbn: '9786583970527', quantity: 8000, piecesPerCarton: null, unitPriceMicros: 1_750_000, notes: '', ...over });

beforeEach(async () => {
  app = testApp();
  who = await app.accounts();
  await app.call('POST', '/api/orders', {
    cookie: who.editor.cookie,
    body: { code: 'PO-061', supplier: 'Claire', items: [line({}), line({ row: 8, description: 'Livro da Sara', isbn: null, quantity: 1000, notes: 'Capa dura' })] },
  });
});

async function items(): Promise<Item[]> {
  return (await app.call('GET', '/api/data', { cookie: who.admin.cookie })).data.items;
}

/** As marcas do código do item, como a planilha baixada agora traria. */
const marks = (item: Item) => readItemCode(itemCode(item))!.marks;

async function events(itemId: string) {
  const { results } = await app.env.DB.prepare("SELECT type, detail, user_id FROM events WHERE entity = 'item' AND entity_id = ? AND type = 'changed'").bind(itemId).all<{ type: string; detail: string; user_id: string }>();
  return results.map((r) => ({ ...r, detail: JSON.parse(r.detail) }));
}

describe('atualizar pela planilha', () => {
  it('admin e editor gravam o que mudou, com a mudança no histórico de cada item', async () => {
    const [alice, sara] = await items();
    const res = await app.call('PATCH', '/api/items', {
      cookie: who.editor.cookie,
      body: {
        items: [
          { id: alice!.id, row: 2, fileApprovedAt: '2026-12-05', shipPlan: [{ month: '2027-02', quantity: 4000 }, { month: '2026-12', quantity: 4000 }], marks: marks(alice!) },
          { id: sara!.id, row: 3, notes: '  Capa mole ', marks: { notes: marks(sara!).notes } },
        ],
      },
    });
    expect(res.status).toBe(200);
    expect(res.data).toEqual({ updated: 2, skipped: [] });

    const [a, s] = await items();
    expect(a).toMatchObject({ fileApprovedAt: '2026-12-05', shipPlan: [{ month: '2026-12', quantity: 4000 }, { month: '2027-02', quantity: 4000 }], notes: '' });
    expect(s).toMatchObject({ fileApprovedAt: null, notes: 'Capa mole' });
    expect(await events(alice!.id)).toEqual([
      {
        type: 'changed',
        user_id: who.editor.id,
        detail: {
          changes: [
            { field: 'Aprovação do arquivo', from: null, to: '2026-12-05' },
            { field: 'Programação de envio', from: '', to: 'dez/2026: 4.000; fev/2027: 4.000' },
          ],
          source: 'planilha',
          row: 2,
        },
      },
    ]);
    expect((await events(sara!.id))[0]!.detail.changes).toEqual([{ field: 'Observações', from: 'Capa dura', to: 'Capa mole' }]);

    // O admin também grava.
    const again = await app.call('PATCH', '/api/items', { cookie: who.admin.cookie, body: { items: [{ id: a!.id, row: 2, fileApprovedAt: null, marks: { fileApprovedAt: marks(a!).fileApprovedAt } }] } });
    expect(again.data).toEqual({ updated: 1, skipped: [] });
  });

  it('pula o campo que mudou no app depois do download, sem desfazer a mudança', async () => {
    const [alice] = await items();
    const downloaded = marks(alice!);
    await app.call('PATCH', `/api/items/${alice!.id}`, { cookie: who.admin.cookie, body: { notes: 'Mudança no app' } });
    const res = await app.call('PATCH', '/api/items', {
      cookie: who.editor.cookie,
      body: { items: [{ id: alice!.id, row: 4, notes: 'Mudança na planilha', fileApprovedAt: '2026-12-05', marks: downloaded }] },
    });
    expect(res.data).toEqual({
      updated: 0,
      skipped: [{ row: 4, message: '"Coleção Alice": as observações mudaram no app enquanto a planilha era conferida. Baixe a lista de novo e confira.' }],
    });
    expect((await items())[0]).toMatchObject({ notes: 'Mudança no app', fileApprovedAt: null });
  });

  it('a programação precisa caber na quantidade de agora do item', async () => {
    const [alice] = await items();
    const res = await app.call('PATCH', '/api/items', {
      cookie: who.editor.cookie,
      body: { items: [{ id: alice!.id, row: 2, shipPlan: [{ month: '2026-12', quantity: 9000 }], marks: marks(alice!) }] },
    });
    expect(res.data.skipped).toEqual([{ row: 2, message: '"Coleção Alice": a programação de envio soma 9.000 exemplares, mais que os 8.000 do item.' }]);
  });

  it('pula o item que embarcou ou foi excluído; o mesmo item duas vezes é recusado', async () => {
    const [alice, sara] = await items();
    await app.call('POST', '/api/ship', { cookie: who.editor.cookie, body: { lines: [{ itemId: alice!.id, quantity: 8000 }], newInvoice: { number: 'X1', ref: '', bill: null, eta: null } } });
    await app.call('DELETE', `/api/items/${sara!.id}`, { cookie: who.admin.cookie });
    const res = await app.call('PATCH', '/api/items', {
      cookie: who.editor.cookie,
      body: {
        items: [
          { id: alice!.id, row: 2, notes: 'x', marks: marks(alice!) },
          { id: sara!.id, row: 3, notes: 'x', marks: marks(sara!) },
          { id: 'nao-existe', row: 4, notes: 'x', marks: marks(sara!) },
        ],
      },
    });
    expect(res.data).toEqual({
      updated: 0,
      skipped: [
        { row: 2, message: '"Coleção Alice" não está mais em produção.' },
        { row: 3, message: 'O item não está mais no app (pode ter sido excluído).' },
        { row: 4, message: 'O item não está mais no app (pode ter sido excluído).' },
      ],
    });
    const twice = await app.call('PATCH', '/api/items', {
      cookie: who.editor.cookie,
      body: { items: [1, 2].map((row) => ({ id: alice!.id, row, notes: `${row}`, marks: marks(alice!) })) },
    });
    expect(twice.status).toBe(400);
  });

  it('o que já está gravado não conta como mudança nem entra no histórico', async () => {
    const [, sara] = await items();
    const res = await app.call('PATCH', '/api/items', { cookie: who.editor.cookie, body: { items: [{ id: sara!.id, row: 3, notes: 'Capa dura', marks: marks(sara!) }] } });
    expect(res.data).toEqual({ updated: 0, skipped: [] });
    expect(await events(sara!.id)).toEqual([]);
  });

  it('recusa o que não vale: sem campo, sem marca válida, data inválida, observações longas demais', async () => {
    const [alice] = await items();
    const m = marks(alice!);
    for (const item of [
      { id: alice!.id, row: 2, marks: m },
      { id: alice!.id, row: 2, notes: 'x', marks: { notes: 'curta' } },
      { id: alice!.id, row: 2, fileApprovedAt: '31/12/2026', marks: m },
      { id: alice!.id, row: 2, notes: 'x'.repeat(2001), marks: m },
    ]) {
      expect((await app.call('PATCH', '/api/items', { cookie: who.editor.cookie, body: { items: [item] } })).status, JSON.stringify(item).slice(0, 80)).toBe(400);
    }
    expect((await app.call('PATCH', '/api/items', { cookie: who.editor.cookie, body: { items: [] } })).status).toBe(400);
  });

  it('Consulta, Leitor, Embarques, Vendas e o Agente de cargas não gravam', async () => {
    const [alice] = await items();
    const body = { items: [{ id: alice!.id, row: 2, notes: 'x', marks: marks(alice!) }] };
    for (const w of [who.consulta, who.leitor, who.embarques, who.vendas, who.agente]) {
      expect((await app.call('PATCH', '/api/items', { cookie: w.cookie, body })).status).toBe(403);
    }
    expect((await items())[0]!.notes).toBe('');
  });
});
