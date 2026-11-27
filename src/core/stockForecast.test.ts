// Previsão de estoque (20/11/2026): as contas decididas pelo Gabriel, com exemplos feitos à mão.
import { describe, expect, it } from 'vitest';
import type { BrOrderSummary } from './brazil';
import type { CurveRow } from './stockCurve';
import { forecastAlerts, forecastSummary, holdingsFor, reprintAdvice, stockForecast, titleHoldings, type ForecastItem, type ForecastRow } from './stockForecast';

const STOCK_DATE = '2026-11-19';
const TODAY = '2026-11-20';

const curveRow = (isbn: string, title: string, stock: number, m3: number, m6: number): CurveRow => ({
  isbn,
  title,
  code: '',
  abcClass: 'A',
  stock,
  sales: { m1: null, m3, m6, m9: null, m12: null },
});

const item = (over: Partial<ForecastItem>): ForecastItem => ({
  productId: 'p-alice',
  isbn: '9786583970527',
  description: 'Coleção Alice',
  status: 'producao',
  quantity: 1000,
  orderCode: 'PO-070',
  orderedAt: '2026-10-01',
  shipPlan: [],
  eta: null,
  arrivedAt: null,
  ...over,
});

// A: vende 500/mês pela média de 3 meses e 400 pela de 6; 3.000 no estoque, nada no No Porto.
const A = curveRow('9786560950702', 'A · 365 Hábitos', 3000, 1500, 2400);
// B: 1.000 no estoque, vende 1.000/mês (3 meses) e 800 (6 meses); no No Porto, 2.000 a caminho, 500 que
// chegaram depois da data da curva e 5.000 em produção na PO-070, programados para fevereiro.
const B = curveRow('9786583970527', 'B · Coleção Alice', 1000, 3000, 4800);
const B_ITEMS = [
  item({ status: 'embarcado', quantity: 2000, orderCode: 'PO-061', eta: '2027-01-10' }),
  item({ status: 'producao', quantity: 5000, shipPlan: [{ month: '2027-02', quantity: 5000 }] }),
  item({ status: 'entregue', quantity: 500, orderCode: 'PO-061', arrivedAt: '2026-11-20' }),
  item({ status: 'entregue', quantity: 800, orderCode: 'PO-056', arrivedAt: '2026-11-10' }),
];
// C: sem estoque, só vendeu nos últimos 3 meses (600); 4.000 em produção numa PO de 15/11.
const C = curveRow('9786580921232', 'C · O Caibalion', 0, 600, 600);
const C_ITEMS = [item({ productId: 'p-caibalion', isbn: '9786580921232', description: 'O Caibalion', quantity: 4000, orderCode: 'PO-071', orderedAt: '2026-11-15' })];
// D: vende 10/mês e tem 10 no estoque: a tiragem mínima cobriria 200 meses.
const D = curveRow('7898084025476', 'D · Revista', 10, 30, 60);
// E: não vendeu, mas tem produção.
const E = curveRow('9786561262132', 'E · Sem venda', 50, 0, 0);
const E_ITEMS = [item({ productId: 'p-e', isbn: '9786561262132', description: 'Sem venda', quantity: 2000, orderCode: 'PO-072' })];

/** A previsão como a tela calcula: o que o No Porto tem de cada título, juntado pelo servidor. */
const run = (rows: CurveRow[], items: ForecastItem[]) => stockForecast({ stockDate: STOCK_DATE, rows }, titleHoldings(items, STOCK_DATE), TODAY);
const forecast = () => run([A, B, C, D, E], [...B_ITEMS, ...C_ITEMS, ...E_ITEMS]);
const row = (rows: ForecastRow[], title: string) => rows.find((r) => r.title === title)!;

describe('previsão de estoque', () => {
  it('venda mensal pela média de 3 e de 6 meses; cobertura do físico e do físico + embarcado por cada média', () => {
    const { rows } = forecast();
    expect(row(rows, A.title)).toMatchObject({ monthly3: 500, monthly6: 400, cover: { stock3: 6, stock6: 7.5, total3: 6, total6: 7.5 }, imported: false, productId: null });
    // B: embarcado = 2.000 a caminho + 500 que chegaram depois da data da curva; a chegada de 10/11 já está no estoque.
    expect(row(rows, B.title)).toMatchObject({
      atSea: 2500,
      arrivedAfter: 500,
      production: 5000,
      nextEta: '2027-01-10',
      nextPlan: '2027-02',
      imported: true,
      productId: 'p-alice',
      cover: { stock3: 1, stock6: 1.25, total3: 3.5, total6: 4.375 },
    });
    expect(row(rows, E.title)).toMatchObject({ monthly3: 0, cover: { stock3: null, stock6: null, total3: null, total6: null }, runsOutAt: null, ship: null });
  });

  it('reimpressão: quando físico + embarcado + produção não cobrem 7 meses, cobre 13 meses menos o que se tem, em múltiplos de 1.000, com mínimo de 2.000', () => {
    const { rows } = forecast();
    // A pela média de 3 meses: 3.000 < 500 × 7 = 3.500; 500 × 13 − 3.000 = 3.500 → 4.000. Pela de 6: 3.000 ≥ 400 × 7.
    expect(row(rows, A.title)).toMatchObject({ reprint3: { kind: 'reprint', quantity: 4000 }, reprint6: { kind: 'none' } });
    // B: 1.000 + 2.500 + 5.000 = 8.500 cobre 7 meses pelas duas médias (a produção conta).
    expect(row(rows, B.title)).toMatchObject({ reprint3: { kind: 'none' }, reprint6: { kind: 'none' } });
    // Mínimo de 2.000: vende 100/mês, sem nada → 1.300 → 2.000; múltiplo exato não sobe.
    expect(reprintAdvice(300, 3, 0)).toEqual({ kind: 'reprint', quantity: 2000 });
    expect(reprintAdvice(3000, 3, 1000)).toEqual({ kind: 'reprint', quantity: 12000 });
    expect(reprintAdvice(37807 * 3 + 1, 3, 0)).toEqual({ kind: 'reprint', quantity: 492000 });
  });

  it('venda baixa: sem sugestão quando a tiragem mínima cobriria mais de 24 meses', () => {
    const { rows } = forecast();
    expect(row(rows, D.title)).toMatchObject({ reprint3: { kind: 'lowSales', months: 200 }, reprint6: { kind: 'lowSales', months: 200 }, needsAction: false });
    expect(reprintAdvice(250, 3, 0)).toEqual({ kind: 'reprint', quantity: 2000 });
    expect(reprintAdvice(249, 3, 0)).toEqual({ kind: 'lowSales', months: 24 });
    expect(reprintAdvice(0, 3, 0)).toEqual({ kind: 'none' });
  });

  it('aviso de embarque pela maior média: embarcar até (o dia em que físico + embarcado acabam, menos 60 dias) e pelo menos 3 meses de venda', () => {
    const { rows } = forecast();
    // B: 3.500 ÷ 1.000 por mês = 105 dias → acaba em 04/03/2027; embarcar até 03/01/2027, 3.000 ex.
    // A PO-070 (01/10) fica pronta em 30/11; o envio está programado para fevereiro, depois do prazo.
    const b = row(rows, B.title);
    expect(b.runsOutAt).toBe('2027-03-04');
    expect(b.ship).toEqual({ shipBy: '2027-01-03', quantity: 3000, short: false, readyAt: '2026-11-30', late: false, overdue: false, planLate: true });
    // O físico com os 500 que chegaram (1.500) dura 45 dias, até 03/01, antes de o embarcado chegar (10/01).
    expect(b.gapBefore).toBe('embarcado');
    expect(forecastAlerts(b)).toEqual(['Envio programado para fev/2027, depois do prazo', 'O estoque acaba antes de o embarcado chegar']);
    // C: sem estoque, o prazo já passou; a PO de 15/11 só fica pronta em 14/01: pode faltar.
    const c = row(rows, C.title);
    expect(c.ship).toEqual({ shipBy: '2026-09-20', quantity: 600, short: false, readyAt: '2027-01-14', late: true, overdue: true, planLate: false });
    expect(c.recentOnly).toBe(true);
    expect(forecastAlerts(c)).toEqual(['Embarcar já: o prazo passou', 'Pode faltar: a PO fica pronta em 14/01/2027']);
    // Sem produção ou sem venda, não há aviso.
    expect(row(rows, A.title).ship).toBeNull();
    expect(row(rows, E.title).ship).toBeNull();
  });

  it('PO sem data: mostra o prazo, mas não confere se fica pronta; produção menor que 3 meses de venda é avisada', () => {
    const { rows } = run([curveRow('9786583970527', 'Alice', 0, 3000, 6000)], [item({ quantity: 1200, orderedAt: null })]);
    expect(rows[0]!.ship).toEqual({ shipBy: '2026-09-20', quantity: 1200, short: true, readyAt: null, late: false, overdue: true, planLate: false });
    expect(forecastAlerts(rows[0]!)).toEqual(['Embarcar já: o prazo passou', 'A produção não cobre 3 meses de venda']);
  });

  it('casa o ISBN-10 do No Porto com o ISBN-13 da curva; com duas POs, vale a mais antiga', () => {
    const { rows } = run(
      [curveRow('9788535902778', 'Livro antigo', 100, 300, 600)],
      [
        item({ productId: 'p-antigo', isbn: '8535902775', description: 'Livro antigo', quantity: 600, orderCode: 'PO-075', orderedAt: '2026-11-05' }),
        item({ productId: 'p-antigo', isbn: '8535902775', description: 'Livro antigo', quantity: 400, orderCode: 'PO-068', orderedAt: '2026-09-01' }),
      ],
    );
    expect(rows[0]).toMatchObject({
      imported: true,
      production: 1000,
      orders: [
        { code: 'PO-068', orderedAt: '2026-09-01', quantity: 400 },
        { code: 'PO-075', orderedAt: '2026-11-05', quantity: 600 },
      ],
      ship: { readyAt: '2026-10-31' },
    });
  });

  it('o que está em produção ou a caminho no No Porto e não está na curva aparece à parte', () => {
    const items = [
      item({ productId: 'p-box', isbn: '9786561263023', description: 'Box Bluey', quantity: 2000 }),
      item({ productId: 'p-sara', isbn: null, description: 'Livro da Sara', status: 'embarcado', quantity: 300, eta: '2026-12-15' }),
      item({ productId: 'p-velho', isbn: '9786584956933', description: 'Já chegou', status: 'entregue', quantity: 500, arrivedAt: '2026-01-10' }),
    ];
    const { missing } = run([A], items);
    expect(missing).toEqual([
      {
        key: '9786561263023',
        productId: 'p-box',
        isbn: '9786561263023',
        title: 'Box Bluey',
        atSea: 0,
        production: 2000,
        nextEta: null,
        orders: [{ code: 'PO-070', orderedAt: '2026-10-01', quantity: 2000 }],
        brazil: 0,
        brazilOrders: [],
      },
      { key: 'produto:p-sara', productId: 'p-sara', isbn: null, title: 'Livro da Sara', atSea: 300, production: 0, nextEta: '2026-12-15', orders: [], brazil: 0, brazilOrders: [] },
    ]);
    // O servidor manda só o que a previsão usa: o que já chegou e não está na curva fica de fora.
    expect(holdingsFor([A], titleHoldings(items, STOCK_DATE)).map((h) => h.key)).toEqual(['9786561263023', 'produto:p-sara']);
  });

  it('os mais urgentes primeiro: os que precisam de alguma coisa, de quem acaba antes; depois os outros', () => {
    const { rows } = forecast();
    expect(rows.map((r) => [r.title, r.needsAction])).toEqual([
      [C.title, true],
      [B.title, true],
      [A.title, true],
      [D.title, false],
      [E.title, false],
    ]);
  });

  it('o resumo do painel', () => {
    const { rows } = forecast();
    // B: o envio programado é depois do prazo e o estoque acaba antes de o embarcado chegar; C: embarcar já, e pode faltar.
    expect(forecastSummary(rows, TODAY)).toEqual({ titles: 5, action: 3, reprint: 1, reprint3: 1, reprint6: 0, ship: 1, shipSoon: 1, late: 1, gaps: 1 });
    // A PO recente que fica pronta depois do prazo pede atenção mesmo com o prazo longe: conta em "embarque", não em "30 dias".
    // 3.500 ÷ 1.000 por mês = 105 dias: acaba em 04/03, embarcar até 03/01 (44 dias); a PO de 19/11 só fica pronta em 18/01.
    const late = run([curveRow('9786583970527', 'Alice', 3500, 3000, 6000)], [item({ quantity: 5000, orderedAt: '2026-11-19' })]);
    expect(late.rows[0]!.ship).toMatchObject({ shipBy: '2027-01-03', readyAt: '2027-01-18', late: true, overdue: false });
    expect(forecastSummary(late.rows, TODAY)).toMatchObject({ ship: 1, shipSoon: 0, late: 1 });
  });
});

// Produção no Brasil (27/11/2026): o que falta as gráficas entregarem vai direto para o estoque e conta como o
// embarcado; o que entregaram depois da data da curva, como o que chegou depois dela.
const brOrder = (over: Partial<BrOrderSummary>): BrOrderSummary => ({
  id: 'br-1',
  isbn: '9786585168663',
  title: 'Cartas a Milena',
  printer: 'Gráfica Santa Marta',
  quantity: 5000,
  orderedAt: '2026-10-20',
  dueAt: '2026-12-10',
  deliveries: [],
  ...over,
});
const withBrazil = (rows: CurveRow[], items: ForecastItem[], orders: BrOrderSummary[]) =>
  stockForecast({ stockDate: STOCK_DATE, rows }, titleHoldings(items, STOCK_DATE, orders), TODAY);

describe('previsão de estoque com a produção no Brasil', () => {
  // F: 1.000 no estoque, vende 1.000/mês (3 meses) e 800 (6 meses); 4.000 em produção fora, numa PO de 01/11.
  // No Brasil, 5.000 na Santa Marta, para 10/12: 2.000 entregues em 18/11 (a curva já conta) e 1.000 em 20/11 (ainda não).
  const F = curveRow('9786585168663', 'F · Cartas a Milena', 1000, 3000, 4800);
  const F_ITEMS = [item({ productId: 'p-milena', isbn: '9786585168663', description: 'Cartas a Milena', quantity: 4000, orderCode: 'PO-080', orderedAt: '2026-11-01' })];
  const F_BRAZIL = [
    brOrder({ deliveries: [{ deliveredAt: '2026-11-18', quantity: 2000, last: false }, { deliveredAt: '2026-11-20', quantity: 1000, last: false }] }),
    // Um pedido antigo, entregue antes da curva: já está no estoque dela.
    brOrder({ id: 'br-0', quantity: 3000, orderedAt: '2026-08-01', dueAt: '2026-09-01', deliveries: [{ deliveredAt: '2026-09-02', quantity: 3000, last: false }] }),
  ];

  it('o que falta entregar e o que foi entregue depois da curva contam como o embarcado: cobertura, reimpressão e prazo do embarque', () => {
    const f = withBrazil([F], F_ITEMS, F_BRAZIL).rows[0]!;
    // Brasil = 2.000 que faltam + 1.000 entregues depois da curva.
    expect(f).toMatchObject({
      imported: true,
      productId: 'p-milena',
      brazil: 3000,
      brazilArrivedAfter: 1000,
      brazilOrders: [{ id: 'br-1', printer: 'Gráfica Santa Marta', remaining: 2000, dueAt: '2026-12-10' }],
      cover: { stock3: 1, stock6: 1.25, total3: 4, total6: 5 },
      reprint3: { kind: 'none' },
      reprint6: { kind: 'none' },
    });
    // 4.000 ÷ 1.000 por mês = 120 dias: acabam em 19/03/2027; embarcar até 18/01/2027 os 3.000 de 3 meses de venda.
    expect(f.runsOutAt).toBe('2027-03-19');
    expect(f.ship).toEqual({ shipBy: '2027-01-18', quantity: 3000, short: false, readyAt: '2026-12-31', late: false, overdue: false, planLate: false });
    // O físico com os 1.000 entregues (2.000) dura até 18/01, depois da entrega do Brasil (10/12): não falta.
    expect(f.gapBefore).toBeNull();
    expect(f.needsAction).toBe(false);
    // Sem o Brasil, o físico duraria 30 dias, o prazo do embarque já teria passado e a reimpressão seria sugerida.
    const without = withBrazil([F], F_ITEMS, []).rows[0]!;
    expect(without).toMatchObject({ brazil: 0, brazilOrders: [], cover: { total3: 1 }, ship: { shipBy: '2026-10-20', overdue: true }, reprint3: { kind: 'reprint', quantity: 8000 } });
  });

  it('avisa quando o estoque acaba antes da entrega do Brasil, e a entrega do Brasil pode evitar o aviso do embarcado', () => {
    // G: 500 no estoque, 1.000 por mês; 3.000 no Brasil para 31/12: o físico acaba em 04/12.
    const G = curveRow('9786561263023', 'G · Box Bluey', 500, 3000, 6000);
    const g = withBrazil([G], [], [brOrder({ id: 'br-g', isbn: '9786561263023', title: 'Box Bluey', quantity: 3000, dueAt: '2026-12-31' })]).rows[0]!;
    expect(g).toMatchObject({ imported: false, productId: null, brazil: 3000, gapBefore: 'brasil', needsAction: true });
    expect(forecastAlerts(g)).toEqual(['O estoque acaba antes da entrega do Brasil']);
    // H: 1.000 no estoque, 1.000 por mês; 2.000 a caminho para 10/01. O físico acaba em 19/12, antes do navio...
    const H = curveRow('9786583970527', 'H · Coleção Alice', 1000, 3000, 6000);
    const atSea = [item({ status: 'embarcado', quantity: 2000, eta: '2027-01-10' })];
    expect(withBrazil([H], atSea, []).rows[0]!.gapBefore).toBe('embarcado');
    // ...mas 1.000 do Brasil em 10/12 fazem o estoque durar até 18/01, depois da chegada do navio.
    const h = withBrazil([H], atSea, [brOrder({ id: 'br-h', isbn: '9786583970527', title: 'Coleção Alice', quantity: 1000, dueAt: '2026-12-10' })]).rows[0]!;
    expect(h.gapBefore).toBeNull();
    // O pedido sem entrega prevista conta no total, mas não entra na conta de quando acaba.
    const noDue = withBrazil([G], [], [brOrder({ id: 'br-g', isbn: '9786561263023', title: 'Box Bluey', quantity: 3000, dueAt: null })]).rows[0]!;
    expect(noDue).toMatchObject({ brazil: 3000, gapBefore: null, cover: { total3: 3.5 } });
    // Só o G acaba antes de uma chegada; os dois pedem reimpressão (3.500 e 4.000 não cobrem 7 meses de 1.000 por mês).
    expect(forecastSummary([g, h], TODAY)).toMatchObject({ gaps: 1, action: 2, reprint: 2 });
  });

  it('casa o ISBN-10 do pedido com a curva; o pedido entregue (a última entrega, com um pouco menos) não falta nada', () => {
    const rows = [curveRow('9788535902778', 'Livro antigo', 100, 300, 600)];
    const orders = [
      brOrder({ id: 'br-a', isbn: '8535902775', title: 'Livro antigo', quantity: 2000, deliveries: [{ deliveredAt: '2026-11-25', quantity: 1950, last: true }] }),
      brOrder({ id: 'br-b', isbn: '8535902775', title: 'Livro antigo', quantity: 1000, dueAt: null }),
    ];
    expect(withBrazil(rows, [], orders).rows[0]).toMatchObject({
      brazil: 1950 + 1000,
      brazilArrivedAfter: 1950,
      brazilOrders: [{ id: 'br-b', remaining: 1000, dueAt: null }],
    });
  });

  it('o que está no Brasil e não está na curva aparece à parte, com ou sem ISBN', () => {
    const orders = [
      brOrder({ id: 'br-x', isbn: '9786584956933', title: 'Lançamento', quantity: 2000, deliveries: [{ deliveredAt: '2026-11-20', quantity: 500, last: false }] }),
      brOrder({ id: 'br-y', isbn: null, title: 'Marcador de página', quantity: 10000, dueAt: '2026-12-01' }),
      // Entregue: não falta nada, não aparece.
      brOrder({ id: 'br-z', isbn: '9786560950702', title: 'Já entregue', quantity: 1000, deliveries: [{ deliveredAt: '2026-11-10', quantity: 1000, last: false }] }),
    ];
    const { missing } = withBrazil([A], [], orders);
    expect(missing).toEqual([
      {
        key: '9786584956933',
        productId: null,
        isbn: '9786584956933',
        title: 'Lançamento',
        atSea: 0,
        production: 0,
        nextEta: null,
        orders: [],
        brazil: 1500,
        brazilOrders: [{ id: 'br-x', printer: 'Gráfica Santa Marta', remaining: 1500, dueAt: '2026-12-10' }],
      },
      {
        key: 'brasil:br-y',
        productId: null,
        isbn: null,
        title: 'Marcador de página',
        atSea: 0,
        production: 0,
        nextEta: null,
        orders: [],
        brazil: 10000,
        brazilOrders: [{ id: 'br-y', printer: 'Gráfica Santa Marta', remaining: 10000, dueAt: '2026-12-01' }],
      },
    ]);
    // O título "Já entregue" (o A, na curva) fica com o que o Brasil entregou antes da curva fora da conta.
    expect(withBrazil([A], [], orders).rows[0]).toMatchObject({ brazil: 0, brazilOrders: [], imported: false });
    // O servidor manda o que está no Brasil por entregar, e não o que já foi entregue fora da curva.
    expect(holdingsFor([A], titleHoldings([], STOCK_DATE, orders)).map((h) => h.key)).toEqual(['9786584956933', 'brasil:br-y', '9786560950702']);
  });

  it('o título só do Brasil fica com o nome do pedido mais novo; o importado, com o da importação', () => {
    const items = [item({ productId: 'p-alice', isbn: '9786583970527', description: 'Coleção Alice', quantity: 1000 })];
    const orders = [
      brOrder({ id: 'br-1', isbn: '9786583970527', title: 'Alice (Brasil)' }),
      brOrder({ id: 'br-2', isbn: '9786561263023', title: 'Box Bluey' }),
      brOrder({ id: 'br-3', isbn: '9786561263023', title: 'Box Bluey - 2ª edição' }),
    ];
    const holdings = titleHoldings(items, STOCK_DATE, orders);
    expect(holdings.map((h) => [h.key, h.productId, h.title, h.brazil])).toEqual([
      ['9786583970527', 'p-alice', 'Coleção Alice', 5000],
      ['9786561263023', null, 'Box Bluey - 2ª edição', 10000],
    ]);
  });
});
