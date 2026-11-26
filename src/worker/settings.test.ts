// Configurações (26/11/2026): o prazo da chegada prevista pelo BL. Admin e editor leem; só o admin muda.
import { beforeEach, describe, expect, it } from 'vitest';
import { testApp } from './test-api';

let app: ReturnType<typeof testApp>;
let who: Awaited<ReturnType<ReturnType<typeof testApp>['accounts']>>;

beforeEach(async () => {
  app = testApp();
  who = await app.accounts();
});

describe('prazo da chegada prevista pelo BL', () => {
  it('sem mudança, vale o padrão de 35 dias', async () => {
    for (const w of [who.admin, who.editor]) {
      const res = await app.call('GET', '/api/settings', { cookie: w.cookie });
      expect(res.status).toBe(200);
      expect(res.data).toEqual({ arrivalDays: 35, arrivalDaysUpdatedAt: null, arrivalDaysUpdatedBy: null });
    }
  });

  it('o admin muda; o editor passa a receber o prazo novo, e a mudança fica nos eventos', async () => {
    const saved = await app.call('PUT', '/api/settings', { cookie: who.admin.cookie, body: { arrivalDays: 40 } });
    expect(saved.status).toBe(200);
    expect(saved.data).toEqual({ arrivalDays: 40, arrivalDaysUpdatedAt: '2026-11-17T12:00:00.000Z', arrivalDaysUpdatedBy: 'Gabriel' });
    expect((await app.call('GET', '/api/settings', { cookie: who.editor.cookie })).data.arrivalDays).toBe(40);
    // Mudar de novo substitui (uma linha por chave).
    await app.call('PUT', '/api/settings', { cookie: who.admin.cookie, body: { arrivalDays: 38 } });
    expect((await app.call('GET', '/api/settings', { cookie: who.editor.cookie })).data.arrivalDays).toBe(38);
    const events = await app.env.DB.prepare("SELECT entity_id, user_id, type, detail FROM events WHERE entity = 'setting' ORDER BY created_at, detail").all();
    expect(events.results).toEqual([
      { entity_id: 'arrival_days', user_id: who.admin.id, type: 'changed', detail: '{"from":35,"to":40}' },
      { entity_id: 'arrival_days', user_id: who.admin.id, type: 'changed', detail: '{"from":40,"to":38}' },
    ]);
  });

  it('prazo fora de 1 a 120 dias, ou com fração, é recusado', async () => {
    for (const arrivalDays of [0, 121, 35.5, '35']) {
      const res = await app.call('PUT', '/api/settings', { cookie: who.admin.cookie, body: { arrivalDays } });
      expect(res.status, String(arrivalDays)).toBe(400);
    }
    expect((await app.call('PUT', '/api/settings', { cookie: who.admin.cookie, body: { arrivalDays: 0 } })).data.error).toBe('Informe o prazo em dias, um número inteiro de 1 a 120.');
    expect((await app.call('GET', '/api/settings', { cookie: who.admin.cookie })).data.arrivalDays).toBe(35);
  });

  it('um valor estragado no banco não trava: vale o padrão', async () => {
    await app.env.DB.prepare("INSERT INTO settings (key, value, updated_at, updated_by) VALUES ('arrival_days', 'abc', '2026-11-17T12:00:00Z', ?)").bind(who.admin.id).run();
    expect((await app.call('GET', '/api/settings', { cookie: who.editor.cookie })).data.arrivalDays).toBe(35);
  });

  it('o editor não muda; os outros perfis, inclusive o Agente de cargas, nem leem', async () => {
    expect((await app.call('PUT', '/api/settings', { cookie: who.editor.cookie, body: { arrivalDays: 40 } })).status).toBe(403);
    for (const w of [who.consulta, who.leitor, who.embarques, who.vendas, who.agente]) {
      expect((await app.call('GET', '/api/settings', { cookie: w.cookie })).status).toBe(403);
      expect((await app.call('PUT', '/api/settings', { cookie: w.cookie, body: { arrivalDays: 40 } })).status).toBe(403);
    }
    expect((await app.call('GET', '/api/settings')).status).toBe(401);
    expect((await app.call('GET', '/api/settings', { cookie: who.admin.cookie })).data.arrivalDays).toBe(35);
  });
});
