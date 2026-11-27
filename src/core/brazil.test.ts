import { describe, expect, it } from 'vitest';
import {
  addDays,
  bestOffer,
  formatKg,
  kgInput,
  offerCost,
  offerExpiry,
  orderTotalCents,
  paperCostCents,
  parseKgGrams,
  brazilSummary,
  brlTotalCents,
  brlUnitInput,
  deliveryProblem,
  finishedAt,
  formatBrl,
  formatBrlUnit,
  matchesBrazil,
  orderState,
  orderStateText,
  parseBrlUnitPrice,
  type BrOrder,
  type Offer,
} from './brazil';

/** Proposta de um item só, com o papel da gráfica. */
const offer = (id: string, unitPriceE4: number | null, leadDays: number | null = null, quantity = 5000): Offer => ({
  id,
  quoteId: 'q',
  printerId: id,
  quantity,
  paperBy: 'grafica',
  items: [{ description: 'Livro', quantity, unitPriceE4 }],
  papers: [],
  leadDays,
  proposalNumber: '',
  proposalDate: null,
  validDays: null,
  paymentTerms: '',
  notes: '',
  document: null,
});
/** A proposta da Assahi (orçamento 103896.04): 20.000 livros a R$ 1,18, com o papel nosso (capa e dois miolos). */
const assahi = (): Offer => ({
  ...offer('assahi', 11_800, 15, 20_000),
  paperBy: 'editora',
  papers: [
    { part: 'capa', paperId: 'triplex', paperName: 'Triplex LD 230 g', grams: 707_000, pricePerKgE4: 85_000 },
    { part: 'miolo', paperId: 'offwhite', paperName: 'Offwhite Rot 60 g', grams: 2_463_440, pricePerKgE4: 72_000 },
    { part: 'miolo', paperId: 'offwhite', paperName: 'Offwhite Rot 60 g', grams: 846_810, pricePerKgE4: 72_000 },
  ],
});
const order = (over: Partial<BrOrder> = {}): BrOrder => ({
  id: 'o',
  quoteId: 'q',
  offerId: 'f',
  printerId: 'p',
  title: 'Cartas a Milena',
  isbn: '9786585168663',
  quantity: 5000,
  printerCents: 1_850_000,
  paperCents: 0,
  orderedAt: '2026-11-01',
  dueAt: '2026-11-20',
  specification: '',
  notes: '',
  deliveries: [],
  ...over,
});
const delivery = (deliveredAt: string, quantity: number, last = false) => ({ id: deliveredAt, orderId: 'o', deliveredAt, quantity, last, notes: '' });

describe('reais na produção no Brasil', () => {
  it('lê o preço por exemplar com até quatro casas, sem ponto flutuante', () => {
    expect(['3,70', '3.70', 'R$ 3,7', '0,1234', '12', ' R$2,5 '].map(parseBrlUnitPrice)).toEqual([37_000, 37_000, 37_000, 1234, 120_000, 25_000]);
    expect(['', 'abc', '0', '0,12345', '-2'].map(parseBrlUnitPrice)).toEqual([null, null, null, null, null]);
  });

  it('total em centavos, arredondado, e os formatos', () => {
    expect(brlTotalCents(5000, 37_000)).toBe(1_850_000);
    expect(brlTotalCents(3, 1234)).toBe(37);
    expect(formatBrl(1_850_000).replace(/\s/g, ' ')).toBe('R$ 18.500,00');
    expect([formatBrlUnit(37_000), formatBrlUnit(1234)].map((s) => s.replace(/\s/g, ' '))).toEqual(['R$ 3,70', 'R$ 0,1234']);
    expect([brlUnitInput(37_000), brlUnitInput(1234), brlUnitInput(null)]).toEqual(['3,70', '0,1234', '']);
    expect(addDays('2026-11-27', 20)).toBe('2026-12-17');
  });

  it('a melhor proposta: o menor custo por unidade; no empate, o menor prazo; sem preço, nenhuma', () => {
    expect(bestOffer([offer('a', 41_000, 15), offer('b', 37_000, 30), offer('c', 37_000, 20)])?.id).toBe('c');
    expect(bestOffer([offer('a', null), offer('b', null)])).toBeNull();
    expect(bestOffer([])).toBeNull();
    // Com o papel nosso, a Assahi (R$ 1,18 + papel) sai mais cara que outra a R$ 2,50 com o papel dela.
    expect(bestOffer([assahi(), offer('outra', 25_000, 20, 20_000)])?.id).toBe('outra');
  });

  it('o papel: peso em gramas, o custo pelo preço por kg', () => {
    expect(['707', '2.463,44', '846,81', '1,5 kg'].map(parseKgGrams)).toEqual([707_000, 2_463_440, 846_810, 1500]);
    expect(['', '0', 'abc', '1,2345'].map(parseKgGrams)).toEqual([null, null, null, null]);
    expect([formatKg(2_463_440), kgInput(2_463_440), kgInput(707_000)]).toEqual(['2.463,44 kg', '2463,44', '707']);
    expect(paperCostCents(707_000, 85_000)).toBe(600_950);
  });

  it('o custo da proposta: os itens da gráfica, o papel nosso e o custo por unidade', () => {
    // Assahi: R$ 23.600,00 da gráfica + R$ 29.843,30 de papel = R$ 53.443,30, ou R$ 2,6722 por livro.
    expect(offerCost(assahi())).toEqual({ printerCents: 2_360_000, paperCents: 2_984_330, totalCents: 5_344_330, unitCostE4: 26_722 });
    // Grafilar (proposta 117.627): o kit de 15.000 com o box a R$ 3,46 e os três livros a R$ 3,29, papel deles.
    const kit: Offer = {
      ...offer('grafilar', null, null, 15_000),
      items: [
        { description: 'Box', quantity: 15_000, unitPriceE4: 34_600 },
        { description: 'Livros Básico, Mangá e Rosto (15.000 de cada)', quantity: 45_000, unitPriceE4: 32_900 },
      ],
    };
    expect(offerCost(kit)).toEqual({ printerCents: 19_995_000, paperCents: 0, totalCents: 19_995_000, unitCostE4: 133_300 });
    // O papel só conta com o papel nosso; sem os valores, não há custo.
    expect(offerCost({ ...assahi(), paperBy: 'grafica' })?.paperCents).toBe(0);
    expect(offerCost({ ...assahi(), papers: [{ ...assahi().papers[0]!, pricePerKgE4: null }] })).toBeNull();
    expect([orderTotalCents({ printerCents: 2_360_000, paperCents: 2_984_330 }), orderTotalCents({ printerCents: null, paperCents: null })]).toEqual([5_344_330, null]);
  });

  it('a validade da proposta: a data dela mais os dias', () => {
    const o = { proposalDate: '2026-11-24', validDays: 10 };
    expect(offerExpiry(o, '2026-11-27')).toEqual({ until: '2026-12-04', expired: false });
    expect(offerExpiry(o, '2026-12-05')).toEqual({ until: '2026-12-04', expired: true });
    expect(offerExpiry({ proposalDate: null, validDays: 10 }, '2026-11-27')).toBeNull();
  });
});

describe('pedidos e entregas', () => {
  it('em produção, entregue em parte e entregue (pela soma ou pela última entrega)', () => {
    expect(orderState(order(), '2026-11-15')).toEqual({ stage: 'producao', delivered: 0, remaining: 5000, finishedAt: null, late: false, lateDays: 0 });
    expect(orderState(order({ deliveries: [delivery('2026-11-18', 3000)] }), '2026-11-19')).toMatchObject({ stage: 'parcial', delivered: 3000, remaining: 2000 });
    expect(orderState(order({ deliveries: [delivery('2026-11-18', 3000), delivery('2026-11-25', 2120)] }), '2026-11-27')).toMatchObject({ stage: 'entregue', delivered: 5120, remaining: 0, finishedAt: '2026-11-25', late: false });
    // A gráfica entregou um pouco menos e disse que é a última.
    expect(finishedAt(order({ deliveries: [delivery('2026-11-18', 3000), delivery('2026-11-22', 1950, true)] }))).toBe('2026-11-22');
    expect(finishedAt(order({ deliveries: [delivery('2026-11-18', 3000)] }))).toBeNull();
  });

  it('atrasado: a entrega prevista passou e o pedido não foi entregue', () => {
    const late = orderState(order({ deliveries: [delivery('2026-11-18', 3000)] }), '2026-11-23');
    expect(late).toMatchObject({ stage: 'parcial', late: true, lateDays: 3 });
    expect(orderStateText(late, '2026-11-20', '2026-11-23')).toBe('Entregue em parte · atrasado há 3 dias');
    expect(orderStateText(orderState(order(), '2026-11-08'), '2026-11-20', '2026-11-08')).toBe('Em produção · entrega prevista em 12 dias');
    expect(orderStateText(orderState(order({ dueAt: null }), '2026-11-08'), null, '2026-11-08')).toBe('Em produção · sem entrega prevista');
    expect(orderStateText(orderState(order(), '2026-11-19'), '2026-11-20', '2026-11-19')).toBe('Em produção · entrega prevista para amanhã');
  });

  it('a entrega: quantidade, dia e pedido ainda não entregue', () => {
    expect(deliveryProblem(order(), { deliveredAt: '2026-11-18', quantity: 3000 }, '2026-11-27')).toBeNull();
    expect(deliveryProblem(order(), { deliveredAt: '2026-11-18', quantity: 0 }, '2026-11-27')).toBe('Informe quantos exemplares chegaram.');
    expect(deliveryProblem(order(), { deliveredAt: '2026-11-28', quantity: 10 }, '2026-11-27')).toBe('A entrega não pode ser num dia que ainda não chegou.');
    expect(deliveryProblem(order(), { deliveredAt: '2026-10-30', quantity: 10 }, '2026-11-27')).toBe('A entrega não pode ser antes do pedido.');
    expect(deliveryProblem(order({ deliveries: [delivery('2026-11-18', 5000)] }), { deliveredAt: '2026-11-20', quantity: 10 }, '2026-11-27')).toBe(
      'Este pedido já foi entregue. Para registrar outra entrega, desfaça a última.',
    );
  });

  it('o resumo do topo: orçamentos abertos, em produção (o que falta e o valor), atrasados e entregues em 30 dias', () => {
    const today = '2026-11-27';
    const orders = [
      order({ id: 'a', deliveries: [delivery('2026-11-18', 3000)] }),
      order({ id: 'b', quantity: 1000, printerCents: 400_000, paperCents: 100_000, dueAt: '2026-12-10' }),
      order({ id: 'c', deliveries: [delivery('2026-10-01', 5000)] }),
    ];
    expect(brazilSummary([{ status: 'aberto' }, { status: 'fechado' }, { status: 'aberto' }, { status: 'cancelado' }], orders, today)).toEqual({
      openQuotes: 2,
      // O que falta do primeiro (2.000 de 5.000) e o segundo inteiro, com o papel.
      producing: { orders: 2, copies: 3000, valueCents: brlTotalCents(2000, 37_000) + 500_000 },
      late: 1,
      deliveredLast30: 3000,
    });
    // Sem os valores (o leitor), o valor fica de fora.
    expect(brazilSummary([], [order({ printerCents: null, paperCents: null })], today).producing.valueCents).toBeNull();
  });

  it('a busca: produto, ISBN ou gráfica, sem acento e em qualquer ordem', () => {
    const item = { title: 'Cartas a Milena - Franz Kafka', isbn: '9786585168663', printers: ['Gráfica Santa Marta'] };
    expect(['milena', 'KAFKA cartas', 'santa marta', 'grafica', '8516', '978-65-85168'].map((q) => matchesBrazil(q, item))).toEqual([true, true, true, true, true, true]);
    expect(['dostoievski', '1234'].map((q) => matchesBrazil(q, item))).toEqual([false, false]);
  });
});
