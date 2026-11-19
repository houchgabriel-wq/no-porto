// Ligação com o No Prelo (19/11/2026): a aprovação do arquivo vem da "Data de aprovação" da gráfica.
import { beforeEach, describe, expect, it } from 'vitest';
import type { NoPreloApproval } from '../core/noPrelo';
import { itemCode, readItemCode } from '../core/updateSheet';
import type { Item } from '../core/items';
import { syncNoPrelo } from './noPrelo';
import { testApp } from './test-api';

let app: ReturnType<typeof testApp>;
let who: Awaited<ReturnType<ReturnType<typeof testApp>['accounts']>>;
let approvals: NoPreloApproval[];

const ALICE = '9786583970527';
const line = (over: object) => ({ row: 7, description: 'Coleção Alice', isbn: ALICE, quantity: 3000, piecesPerCarton: null, unitPriceMicros: 1_750_000, notes: '', ...over });
const approval = (over: Partial<NoPreloApproval> = {}): NoPreloApproval => ({ isbn: '978-65-83970-52-7', printOrder: 'PO-070', approvedAt: '2026-11-12', title: 'Coleção Alice', printer: 'Nicola', ...over });

beforeEach(async () => {
  app = testApp();
  who = await app.accounts();
  approvals = [approval()];
  (app.env as unknown as { NOPRELO?: unknown }).NOPRELO = { fileApprovals: async () => approvals };
  await app.call('POST', '/api/orders', { cookie: who.editor.cookie, body: { code: 'PO-070', supplier: 'Nicola', items: [line({}), line({ row: 8, description: 'Livro da Sara', isbn: null })] } });
  await app.call('POST', '/api/orders', { cookie: who.editor.cookie, body: { code: 'PO-056', supplier: 'Nicola', items: [line({ quantity: 1000 })] } });
});

const items = async (): Promise<(Item & { purchaseOrderId: string })[]> => (await app.call('GET', '/api/data', { cookie: who.admin.cookie })).data.items;
const sync = (cookie = who.admin.cookie) => app.call('POST', '/api/noprelo/sync', { cookie });

describe('ligação com o No Prelo', () => {
  it('a data de aprovação vai para o item do mesmo ISBN e da mesma PO, com histórico; outra PO não muda', async () => {
    const res = await sync();
    expect(res.status).toBe(200);
    expect(res.data).toEqual({ updated: 1, approvals: 1 });
    const all = await items();
    const orders = (await app.call('GET', '/api/data', { cookie: who.admin.cookie })).data.orders as { id: string; code: string }[];
    const po = (i: { purchaseOrderId: string }) => orders.find((o) => o.id === i.purchaseOrderId)!.code;
    expect(all.map((i) => [i.description, po(i), i.fileApprovedAt, i.fileApprovedFrom])).toEqual([
      ['Coleção Alice', 'PO-070', '2026-11-12', 'noprelo'],
      ['Livro da Sara', 'PO-070', null, null],
      ['Coleção Alice', 'PO-056', null, null],
    ]);
    const { results } = await app.env.DB.prepare("SELECT detail, user_id FROM events WHERE entity_id = ? AND type = 'changed'").bind(all[0]!.id).all<{ detail: string; user_id: string }>();
    expect(results.map((r) => [JSON.parse(r.detail), r.user_id])).toEqual([[{ changes: [{ field: 'Aprovação do arquivo', from: null, to: '2026-11-12' }], source: 'no-prelo' }, who.admin.id]]);
    // De novo, sem nada novo no No Prelo: nada muda.
    expect((await sync()).data).toEqual({ updated: 0, approvals: 1 });
  });

  it('vale a do No Prelo: troca a data digitada, segue as correções feitas lá e a parte que embarca leva junto', async () => {
    const [alice] = await items();
    await app.call('PATCH', `/api/items/${alice!.id}`, { cookie: who.editor.cookie, body: { fileApprovedAt: '2026-11-01' } });
    await sync();
    expect((await items())[0]).toMatchObject({ fileApprovedAt: '2026-11-12', fileApprovedFrom: 'noprelo' });
    await app.call('POST', '/api/ship', { cookie: who.editor.cookie, body: { lines: [{ itemId: alice!.id, quantity: 1000 }], newInvoice: { number: 'N1', ref: '', bill: null, eta: null } } });
    approvals = [approval({ approvedAt: '2026-11-14' })];
    expect((await sync()).data).toEqual({ updated: 2, approvals: 1 });
    const parts = (await items()).filter((i) => i.isbn === ALICE && i.fileApprovedAt);
    expect(parts.map((i) => [i.status, i.quantity, i.fileApprovedAt, i.fileApprovedFrom])).toEqual([
      ['producao', 2000, '2026-11-14', 'noprelo'],
      ['embarcado', 1000, '2026-11-14', 'noprelo'],
    ]);
  });

  it('enquanto vem do No Prelo, a data não muda no No Porto, nem pela ficha nem pela planilha; os outros campos, sim', async () => {
    await sync();
    const [alice] = await items();
    const locked = await app.call('PATCH', `/api/items/${alice!.id}`, { cookie: who.editor.cookie, body: { fileApprovedAt: '2026-12-01' } });
    expect(locked.status).toBe(409);
    expect(locked.data.error).toBe('A aprovação do arquivo deste item vem do No Prelo (a data de aprovação da gráfica). Para mudar, altere no No Prelo.');
    expect((await app.call('PATCH', `/api/items/${alice!.id}`, { cookie: who.editor.cookie, body: { notes: 'Capa nova', fileApprovedAt: '2026-11-12' } })).status).toBe(200);
    const marks = readItemCode(itemCode((await items())[0]!))!.marks;
    const sheet = await app.call('PATCH', '/api/items', { cookie: who.editor.cookie, body: { items: [{ id: alice!.id, row: 2, fileApprovedAt: '2026-12-01', marks }] } });
    expect(sheet.data).toEqual({
      updated: 0,
      skipped: [{ row: 2, message: '"Coleção Alice": a aprovação do arquivo deste item vem do No Prelo (a data de aprovação da gráfica). Para mudar, altere no No Prelo.' }],
    });
  });

  it('se a aprovação some do No Prelo, o item fica com a data e volta a poder ser mudado', async () => {
    await sync();
    approvals = [];
    expect((await sync()).data).toEqual({ updated: 0, approvals: 0 });
    const [alice] = await items();
    expect(alice).toMatchObject({ fileApprovedAt: '2026-11-12', fileApprovedFrom: null });
    expect((await app.call('PATCH', `/api/items/${alice!.id}`, { cookie: who.editor.cookie, body: { fileApprovedAt: '2026-12-01' } })).status).toBe(200);
  });

  it('a busca diária assina como o primeiro admin', async () => {
    expect(await syncNoPrelo(app.env, new Date('2026-11-18T09:40:00Z'))).toEqual({ updated: 1, approvals: 1 });
    const { results } = await app.env.DB.prepare("SELECT user_id FROM events WHERE type = 'changed'").all<{ user_id: string }>();
    expect(results.map((r) => r.user_id)).toEqual([who.admin.id]);
  });

  it('só o admin busca agora; sem a ligação ou com o No Prelo fora do ar, explica', async () => {
    for (const w of [who.editor, who.consulta, who.leitor, who.embarques, who.vendas, who.agente]) expect((await sync(w.cookie)).status).toBe(403);
    (app.env as unknown as { NOPRELO?: unknown }).NOPRELO = { fileApprovals: async () => Promise.reject(new Error('fora do ar')) };
    expect((await sync()).data).toEqual({ error: 'O No Prelo não respondeu. Tente de novo mais tarde.' });
    delete (app.env as unknown as { NOPRELO?: unknown }).NOPRELO;
    const off = await sync();
    expect([off.status, off.data.error]).toEqual([503, 'A ligação com o No Prelo não está configurada.']);
  });
});
