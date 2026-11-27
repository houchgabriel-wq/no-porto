// A produção no Brasil junto com a importação (27/11/2026): o terminal de consulta, a previsão de estoque e a ficha
// do produto juntam os pedidos nas gráficas aos produtos pelo ISBN. Só quantidades, datas e o nome da gráfica; o
// total do pedido, só na ficha do produto e só para quem vê valores.
import { beforeEach, describe, expect, it } from 'vitest';
import { forecastSummary, stockForecast, type TitleHolding } from '../core/stockForecast';
import type { CurveRow } from '../core/stockCurve';
import { testApp } from './test-api';

let app: ReturnType<typeof testApp>;
let who: Awaited<ReturnType<ReturnType<typeof testApp>['accounts']>>;

const ALICE = '9786583970527';
const BLUEY = '9786561263023';
const line = (over: object) => ({ row: 7, description: 'Coleção Alice', isbn: ALICE, quantity: 5000, piecesPerCarton: null, unitPriceMicros: 1_750_000, notes: '', ...over });
const post = (path: string, body: object) => app.call('POST', path, { cookie: who.editor.cookie, body });

/** Um orçamento fechado com uma gráfica: o pedido em produção no Brasil. */
async function brazilOrder(title: string, isbn: string | null, quantity: number, printer: string, unitPriceE4: number, orderedAt: string, dueAt: string | null) {
  const quote = (await post('/api/brasil/quotes', { title, isbn, quantity })).data.id as string;
  const offer = (await post(`/api/brasil/quotes/${quote}/offers`, { printer, quantity, paperBy: 'grafica', items: [{ description: 'Livro', quantity, unitPriceE4 }], leadDays: null })).data
    .id as string;
  return (await post(`/api/brasil/quotes/${quote}/close`, { offerId: offer, orderedAt, dueAt })).data.id as string;
}

beforeEach(async () => {
  app = testApp();
  who = await app.accounts();
  // Fora: 5.000 da Alice em produção na PO-070. No Brasil: mais 5.000 da Alice na Santa Marta (2.000 já entregues
  // em 16/11) e 3.000 de um Box Bluey que só é feito aqui.
  await post('/api/orders', { code: 'PO-070', supplier: 'Nicola', orderedAt: '2026-10-01', items: [line({})] });
  const alice = await brazilOrder('Coleção Alice (Brasil)', '978-65-83970-52-7', 5000, 'Gráfica Santa Marta', 37_000, '2026-11-01', '2026-12-05');
  await post(`/api/brasil/orders/${alice}/deliveries`, { deliveredAt: '2026-11-16', quantity: 2000 });
  await brazilOrder('Box Bluey', BLUEY, 3000, 'Grafilar', 34_600, '2026-11-10', null);
});

interface Summary {
  key: string;
  productId: string | null;
  isbn: string | null;
  title: string;
  names: string[];
  brazil: { quantity: number; printers: string[]; nextDue: string | null };
  lastArrival: { date: string; quantity: number; printers: string[] } | null;
}
const lookup = async (cookie: string) => (await app.call('GET', '/api/lookup', { cookie })).data.products as Summary[];

describe('a produção no Brasil no terminal de consulta', () => {
  it('junta ao produto pelo ISBN e mostra à parte o que só é feito no Brasil; sem valores, nem para quem vê', async () => {
    const res = await app.call('GET', '/api/lookup', { cookie: who.admin.cookie });
    const products = res.data.products as Summary[];
    const alice = products.find((p) => p.isbn === ALICE)!;
    expect(alice).toMatchObject({
      productId: expect.any(String),
      title: 'Coleção Alice',
      names: ['Coleção Alice', 'Coleção Alice (Brasil)'],
      brazil: { quantity: 3000, printers: ['Gráfica Santa Marta'], nextDue: '2026-12-05' },
      lastArrival: { date: '2026-11-16', quantity: 2000, printers: ['Gráfica Santa Marta'] },
    });
    expect(products.find((p) => p.isbn === BLUEY)).toEqual({
      key: `brasil:${BLUEY}`,
      productId: null,
      isbn: BLUEY,
      title: 'Box Bluey',
      names: ['Box Bluey'],
      production: { quantity: 0, orders: [], nextShip: null },
      atSea: { quantity: 0, nextEta: null },
      brazil: { quantity: 3000, printers: ['Grafilar'], nextDue: null },
      lastArrival: null,
    });
    expect(JSON.stringify(res.data)).not.toMatch(/price|cents|valor|e4":/i);
  });

  it('o leitor e a Consulta veem o mesmo; o Agente, o perfil Embarques e Vendas continuam sem o terminal', async () => {
    const forAdmin = await lookup(who.admin.cookie);
    for (const w of [who.consulta, who.leitor]) expect(await lookup(w.cookie)).toEqual(forAdmin);
    for (const w of [who.agente, who.embarques, who.vendas]) expect((await app.call('GET', '/api/lookup', { cookie: w.cookie })).status).toBe(403);
  });
});

const curveRow = (isbn: string, title: string, stock: number, m3: number, m6: number): CurveRow => ({
  isbn,
  title,
  code: '',
  abcClass: 'A',
  stock,
  sales: { m1: null, m3, m6, m9: null, m12: null },
});

describe('a produção no Brasil na previsão de estoque', () => {
  it('cada título com o que falta o Brasil entregar e o que entregou depois da curva; a tela e o painel fazem a mesma conta', async () => {
    const curve = { stockDate: '2026-11-15', fileName: 'curva.xlsx', rows: [curveRow(ALICE, 'Coleção Alice', 1000, 3000, 4800), curveRow(BLUEY, 'Box Bluey', 200, 1500, 3000)] };
    expect((await app.call('POST', '/api/stock', { cookie: who.editor.cookie, body: curve })).status).toBe(201);
    const res = await app.call('GET', '/api/stock', { cookie: who.leitor.cookie });
    const holdings = res.data.holdings as TitleHolding[];
    expect(holdings.map((h) => [h.key, h.productId === null, h.production, h.brazil, h.brazilArrivedAfter, h.brazilOrders.map((o) => [o.printer, o.remaining, o.dueAt])])).toEqual([
      // A Alice: 3.000 por entregar e os 2.000 entregues em 16/11, depois da curva de 15/11.
      [ALICE, false, 5000, 5000, 2000, [['Gráfica Santa Marta', 3000, '2026-12-05']]],
      [BLUEY, true, 0, 3000, 0, [['Grafilar', 3000, null]]],
    ]);
    expect(JSON.stringify(res.data)).not.toMatch(/price|Cents|micros|e4":/i);
    const { rows } = stockForecast({ stockDate: curve.stockDate, rows: res.data.rows }, holdings, res.data.today);
    // A Alice: (1.000 + 5.000) ÷ 1.000 por mês = 6 meses com o que vem do Brasil.
    expect(rows.find((r) => r.isbn === ALICE)).toMatchObject({ imported: true, brazil: 5000, cover: { total3: 6 } });
    expect(rows.find((r) => r.isbn === BLUEY)).toMatchObject({ imported: false, productId: null, brazil: 3000 });
    const summary = await app.call('GET', '/api/stock/summary', { cookie: who.consulta.cookie });
    expect(summary.data.summary).toEqual(forecastSummary(rows, res.data.today));
  });
});

describe('a produção no Brasil na ficha do produto', () => {
  it('os pedidos com o mesmo ISBN, com as entregas; o total só para quem vê valores', async () => {
    const productId = (await lookup(who.admin.cookie)).find((p) => p.isbn === ALICE)!.productId!;
    const product = async (cookie: string) => (await app.call('GET', `/api/products/${productId}`, { cookie })).data;
    const forAdmin = await product(who.admin.cookie);
    expect(forAdmin.brazil).toEqual([
      {
        id: expect.any(String),
        isbn: ALICE,
        title: 'Coleção Alice (Brasil)',
        printer: 'Gráfica Santa Marta',
        quantity: 5000,
        orderedAt: '2026-11-01',
        dueAt: '2026-12-05',
        deliveries: [{ deliveredAt: '2026-11-16', quantity: 2000, last: false }],
        // 5.000 a R$ 3,70.
        totalCents: 1_850_000,
      },
    ]);
    expect((await product(who.consulta.cookie)).brazil[0].totalCents).toBe(1_850_000);
    const forReader = await product(who.leitor.cookie);
    expect(forReader.brazil[0]).toMatchObject({ printer: 'Gráfica Santa Marta', quantity: 5000, totalCents: null });
    expect(JSON.stringify(forReader.brazil)).not.toMatch(/1850000|cents":\d/i);
    for (const w of [who.agente, who.embarques, who.vendas]) expect((await app.call('GET', `/api/products/${productId}`, { cookie: w.cookie })).status).toBe(403);
  });

  it('o produto sem pedido no Brasil vem com a lista vazia', async () => {
    await post('/api/orders', { code: 'PO-071', supplier: 'Nicola', items: [line({ description: 'Meditações', isbn: '9786587817675', quantity: 1000 })] });
    const productId = (await lookup(who.admin.cookie)).find((p) => p.isbn === '9786587817675')!.productId!;
    expect((await app.call('GET', `/api/products/${productId}`, { cookie: who.admin.cookie })).data.brazil).toEqual([]);
  });
});
