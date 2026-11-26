// Prioridade de cada container no desembaraço e no transporte (26/11/2026): admin e editor marcam e tiram;
// quem vê os embarques vê a marca.
import { beforeEach, describe, expect, it } from 'vitest';
import { testApp } from './test-api';

let app: ReturnType<typeof testApp>;
let who: Awaited<ReturnType<ReturnType<typeof testApp>['accounts']>>;
let invoiceId: string;

beforeEach(async () => {
  app = testApp();
  who = await app.accounts();
  const created = await app.call('POST', '/api/items', {
    cookie: who.editor.cookie,
    body: { description: 'Coleção Alice', isbn: null, supplier: 'Claire', orderCode: 'PO-036', quantity: 1000, piecesPerCarton: null, unitPriceMicros: 500_000, notes: '' },
  });
  const shipped = await app.call('POST', '/api/ship', {
    cookie: who.editor.cookie,
    body: { lines: [{ itemId: created.data.item.id, quantity: 1000 }], newInvoice: { number: '126082125-3', ref: '', bill: 'ROECHN26112871', eta: '2026-11-10' } },
  });
  invoiceId = shipped.data.invoiceId;
});

const priorityOf = async (cookie = who.admin.cookie) =>
  ((await app.call('GET', '/api/data', { cookie })).data.invoices as { id: string; priority: unknown }[]).find((v) => v.id === invoiceId)!.priority;
const mark = (priority: boolean, cookie = who.editor.cookie) => app.call('PUT', `/api/invoices/${invoiceId}/priority`, { cookie, body: { priority } });

describe('prioridade do container', () => {
  it('o editor marca e tira; fica quem marcou e quando, e a mudança nos eventos', async () => {
    expect(await priorityOf()).toBeNull();
    expect((await mark(true)).data).toEqual({ changed: true });
    expect(await priorityOf()).toEqual({ at: '2026-11-17T12:00:00.000Z', by: 'Bia Editora' });
    // Marcar de novo não muda nada (nem quem marcou).
    expect((await mark(true, who.admin.cookie)).data).toEqual({ changed: false });
    expect(await priorityOf()).toEqual({ at: '2026-11-17T12:00:00.000Z', by: 'Bia Editora' });
    expect((await mark(false, who.admin.cookie)).data).toEqual({ changed: true });
    expect(await priorityOf()).toBeNull();
    const events = await app.env.DB.prepare("SELECT user_id, type, detail FROM events WHERE entity = 'invoice' ORDER BY rowid").all<{ user_id: string; type: string; detail: string }>();
    expect(events.results.map((e) => [e.user_id, e.type, JSON.parse(e.detail)])).toEqual([
      [who.editor.id, 'priority', { invoice: '126082125-3', priority: true }],
      [who.admin.id, 'priority', { invoice: '126082125-3', priority: false }],
    ]);
  });

  it('quem vê os embarques vê a marca, inclusive o perfil Embarques e o leitor', async () => {
    await mark(true);
    for (const w of [who.consulta, who.leitor, who.embarques]) expect(await priorityOf(w.cookie), w.id).toMatchObject({ by: 'Bia Editora' });
  });

  it('só admin e editor marcam; confere a invoice e o pedido', async () => {
    for (const w of [who.consulta, who.leitor, who.embarques, who.vendas, who.agente]) expect((await mark(true, w.cookie)).status).toBe(403);
    expect(await priorityOf()).toBeNull();
    expect((await app.call('PUT', '/api/invoices/nao-existe/priority', { cookie: who.editor.cookie, body: { priority: true } })).status).toBe(404);
    const bad = await app.call('PUT', `/api/invoices/${invoiceId}/priority`, { cookie: who.editor.cookie, body: { priority: 'sim' } });
    expect([bad.status, bad.data.error]).toEqual([400, 'Informe se o container tem prioridade.']);
  });
});
