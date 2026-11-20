// Previsão de estoque (20/11/2026): a curva ABC guardada e o que o No Porto tem de cada título.
import { beforeEach, describe, expect, it } from 'vitest';
import type { CurveRow } from '../core/stockCurve';
import { stockForecast, type TitleHolding } from '../core/stockForecast';
import { testApp } from './test-api';

let app: ReturnType<typeof testApp>;
let who: Awaited<ReturnType<ReturnType<typeof testApp>['accounts']>>;

const ALICE = '9786583970527';
const curveRow = (isbn: string, title: string, stock: number, m3: number, m6: number): CurveRow => ({
  isbn,
  title,
  code: '33667',
  abcClass: 'A',
  stock,
  sales: { m1: Math.round(m3 / 3), m3, m6, m9: null, m12: m6 * 2 },
});
const CURVE = {
  stockDate: '2026-11-16',
  fileName: 'curva_abc_16-11.xlsx',
  rows: [curveRow(ALICE, 'Coleção Alice no País das Maravilhas', 1000, 3000, 4800), curveRow('9786560950702', '365 Hábitos Simples e Poderosos', 3000, 1500, 2400)],
};
const line = (over: object) => ({ row: 7, description: 'Coleção Alice', isbn: ALICE, quantity: 5000, piecesPerCarton: null, unitPriceMicros: 1_750_000, notes: '', ...over });

beforeEach(async () => {
  app = testApp();
  who = await app.accounts();
  // No No Porto: 5.000 da Alice em produção na PO-070 e 2.000 de um título que não está na curva.
  await app.call('POST', '/api/orders', {
    cookie: who.editor.cookie,
    body: { code: 'PO-070', supplier: 'Nicola', orderedAt: '2026-10-01', items: [line({}), line({ row: 8, description: 'Box Bluey', isbn: '9786561263023', quantity: 2000 })] },
  });
});

const load = (cookie: string, body: object = CURVE) => app.call('POST', '/api/stock', { cookie, body });

describe('previsão de estoque', () => {
  it('sem curva carregada, a aba e o painel dizem que não há curva', async () => {
    expect((await app.call('GET', '/api/stock', { cookie: who.leitor.cookie })).data).toEqual({ today: '2026-11-17', curve: null, rows: [], holdings: [] });
    expect((await app.call('GET', '/api/stock/summary', { cookie: who.consulta.cookie })).data).toEqual({ today: '2026-11-17', curve: null, summary: null });
  });

  it('o editor carrega a curva; a aba recebe a curva e o que o No Porto tem de cada título, e a nova carga substitui a anterior', async () => {
    expect((await load(who.editor.cookie)).data).toEqual({ stockDate: '2026-11-16', rowCount: 2 });
    const res = await app.call('GET', '/api/stock', { cookie: who.leitor.cookie });
    expect(res.status).toBe(200);
    expect(res.data.curve).toMatchObject({ stockDate: '2026-11-16', fileName: 'curva_abc_16-11.xlsx', rowCount: 2, uploadedBy: 'Bia Editora' });
    expect(res.data.rows).toEqual(CURVE.rows);
    const holdings = res.data.holdings as TitleHolding[];
    expect(holdings.map((h) => [h.key, h.production, h.orders])).toEqual([
      [ALICE, 5000, [{ code: 'PO-070', orderedAt: '2026-10-01', quantity: 5000 }]],
      ['9786561263023', 2000, [{ code: 'PO-070', orderedAt: '2026-10-01', quantity: 2000 }]],
    ]);
    // Nada de valores em dinheiro, nem para quem vê valores.
    expect(JSON.stringify(res.data)).not.toMatch(/price|Cents|micros/i);
    // A tela calcula: 1.000 ÷ 1.000 por mês acaba em 30 dias (16/12); embarcar até 60 dias antes, 3.000 ex.
    const { rows, missing } = stockForecast({ stockDate: res.data.curve.stockDate, rows: res.data.rows }, holdings, res.data.today);
    expect(rows[0]!.ship).toMatchObject({ shipBy: '2026-10-17', quantity: 3000, readyAt: '2026-11-30', late: true, overdue: true });
    expect(missing.map((m) => m.title)).toEqual(['Box Bluey']);

    await load(who.admin.cookie, { ...CURVE, stockDate: '2026-11-17', rows: [CURVE.rows[1]] });
    const again = await app.call('GET', '/api/stock', { cookie: who.editor.cookie });
    expect(again.data.curve).toMatchObject({ stockDate: '2026-11-17', rowCount: 1, uploadedBy: 'Gabriel' });
    expect(again.data.rows).toEqual([CURVE.rows[1]]);
  });

  it('o painel recebe só os números', async () => {
    await load(who.editor.cookie);
    const res = await app.call('GET', '/api/stock/summary', { cookie: who.consulta.cookie });
    expect(res.data.curve).toMatchObject({ stockDate: '2026-11-16', rowCount: 2 });
    // Pela média de 3 meses, reimprimir os dois: 365 Hábitos (3.000 < 500 × 7) e Alice (1.000 + 5.000 < 1.000 × 7).
    // Pela de 6, nenhum. A Alice precisa embarcar já, e a PO só fica pronta em 30/11: pode faltar.
    expect(res.data.summary).toEqual({ titles: 2, action: 2, reprint: 2, reprint3: 2, reprint6: 0, ship: 1, shipSoon: 1, late: 1, gaps: 0 });
  });

  it('recusa data inválida ou futura, código repetido ou inválido e curva vazia', async () => {
    const tries: [object, string][] = [
      [{ ...CURVE, stockDate: '16/11/2026' }, 'Data do estoque inválida.'],
      [{ ...CURVE, stockDate: '2026-11-18' }, 'A data do estoque não pode ser depois de hoje.'],
      [{ ...CURVE, rows: [CURVE.rows[0], CURVE.rows[0]] }, `O código ${ALICE} aparece em mais de uma linha da curva.`],
      [{ ...CURVE, rows: [{ ...CURVE.rows[0], isbn: '600402' }] }, 'Código de barras inválido.'],
      [{ ...CURVE, rows: [{ ...CURVE.rows[0], stock: -1 }] }, 'Estoque inválido.'],
      [{ ...CURVE, rows: [] }, 'A curva não tem nenhum título.'],
    ];
    for (const [body, message] of tries) {
      const res = await load(who.editor.cookie, body);
      expect([res.status, res.data.error]).toEqual([400, message]);
    }
    expect((await app.call('GET', '/api/stock', { cookie: who.admin.cookie })).data.curve).toBeNull();
  });

  it('veem admin, editor, consulta e leitor; só admin e editor carregam; Embarques, Vendas e o Agente não recebem nada', async () => {
    await load(who.editor.cookie);
    for (const w of [who.admin, who.editor, who.consulta, who.leitor]) {
      expect((await app.call('GET', '/api/stock', { cookie: w.cookie })).status).toBe(200);
      expect((await app.call('GET', '/api/stock/summary', { cookie: w.cookie })).status).toBe(200);
    }
    for (const w of [who.consulta, who.leitor]) {
      const res = await load(w.cookie);
      expect([res.status, res.data.error]).toEqual([403, 'Só o admin e o editor carregam a curva ABC.']);
    }
    for (const w of [who.embarques, who.vendas, who.agente]) {
      for (const [method, path] of [
        ['GET', '/api/stock'],
        ['GET', '/api/stock/summary'],
        ['POST', '/api/stock'],
      ] as const) {
        const res = method === 'POST' ? await load(w.cookie) : await app.call(method, path, { cookie: w.cookie });
        expect([res.status, res.data.error]).toEqual([403, 'Seu perfil não vê a previsão de estoque.']);
      }
    }
  });
});
