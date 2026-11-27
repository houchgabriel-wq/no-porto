// Produção no Brasil (27/11/2026): orçamentos com as propostas das gráficas, o pedido que sai do orçamento fechado
// e as entregas no estoque, em partes. Quem vê: como na importação; o leitor, sem os valores.
import { beforeEach, describe, expect, it } from 'vitest';
import { testApp } from './test-api';

let app: ReturnType<typeof testApp>;
let who: Awaited<ReturnType<ReturnType<typeof testApp>['accounts']>>;

beforeEach(async () => {
  app = testApp();
  who = await app.accounts();
});

const QUOTE = { title: 'Cartas a Milena - Franz Kafka - Camelot Editora', isbn: '978-65-85168-66-3', quantity: 5000, specification: '14 x 21 cm, 160 páginas, pólen 80 g, capa cartão 250 g com laminação fosca', notes: '' };
const post = (path: string, body: object, cookie = who.editor.cookie) => app.call('POST', path, { cookie, body });
const patch = (path: string, body: object, cookie = who.editor.cookie) => app.call('PATCH', path, { cookie, body });
const del = (path: string, cookie = who.editor.cookie) => app.call('DELETE', path, { cookie });

interface View {
  today: string;
  seeValues: boolean;
  printers: { id: string; name: string }[];
  quotes: { id: string; status: string; isbn: string | null; quantity: number; specification: string; notes: string; createdBy: string | null; orderId: string | null; offers: { id: string; printerId: string; quantity: number; unitPriceE4: number | null; leadDays: number | null }[] }[];
  orders: { id: string; quoteId: string; printerId: string; quantity: number; unitPriceE4: number | null; orderedAt: string; dueAt: string | null; title: string; specification: string; deliveries: { id: string; quantity: number; last: boolean }[] }[];
}
const view = async (cookie = who.admin.cookie): Promise<View> => (await app.call('GET', '/api/brasil', { cookie })).data;

/** Um orçamento com três propostas: duas gráficas, uma delas com duas tiragens. */
async function quoteWithOffers() {
  const quote = (await post('/api/brasil/quotes', QUOTE)).data.id as string;
  const a = (await post(`/api/brasil/quotes/${quote}/offers`, { printer: 'Gráfica Santa Marta', quantity: 5000, unitPriceE4: 41_000, leadDays: 15 })).data.id as string;
  const b = (await post(`/api/brasil/quotes/${quote}/offers`, { printer: 'Gráfica Exklusiva', quantity: 5000, unitPriceE4: 37_000, leadDays: 20, notes: 'Prova digital incluída' })).data.id as string;
  // A mesma gráfica, escrita de outro jeito, com outra tiragem.
  const c = (await post(`/api/brasil/quotes/${quote}/offers`, { printer: 'gráfica santa marta', quantity: 10000, unitPriceE4: 33_500, leadDays: 25 })).data.id as string;
  return { quote, a, b, c };
}

describe('orçamentos com as gráficas do Brasil', () => {
  it('cadastra o orçamento e as propostas; a gráfica nova entra no cadastro, sem repetir', async () => {
    const { quote, a, b, c } = await quoteWithOffers();
    const d = await view();
    expect(d.printers.map((p) => p.name)).toEqual(['Gráfica Exklusiva', 'Gráfica Santa Marta']);
    const [q] = d.quotes;
    expect(q).toMatchObject({ id: quote, status: 'aberto', isbn: '9786585168663', createdBy: 'Bia Editora', orderId: null });
    expect(q!.offers.map((o) => [o.id, o.quantity, o.unitPriceE4, o.leadDays])).toEqual([
      [a, 5000, 41_000, 15],
      [b, 5000, 37_000, 20],
      [c, 10000, 33_500, 25],
    ]);
    const santaMarta = d.printers.find((p) => p.name === 'Gráfica Santa Marta')!.id;
    expect([q!.offers[0]!.printerId, q!.offers[2]!.printerId]).toEqual([santaMarta, santaMarta]);
  });

  it('corrige e tira propostas enquanto o orçamento está aberto; cancelado, só reabrindo', async () => {
    const { quote, a, c } = await quoteWithOffers();
    expect((await patch(`/api/brasil/offers/${a}`, { printer: 'Gráfica Santa Marta', quantity: 5000, unitPriceE4: 39_500, leadDays: 12 })).status).toBe(200);
    expect((await del(`/api/brasil/offers/${c}`)).status).toBe(200);
    expect((await view()).quotes[0]!.offers.map((o) => [o.unitPriceE4, o.leadDays])).toEqual([
      [39_500, 12],
      [37_000, 20],
    ]);
    expect((await patch(`/api/brasil/quotes/${quote}`, { status: 'cancelado' })).status).toBe(200);
    const blocked = await post(`/api/brasil/quotes/${quote}/offers`, { printer: 'Gráfica Nova', quantity: 5000, unitPriceE4: 30_000 });
    expect([blocked.status, blocked.data.error]).toEqual([409, 'As propostas só mudam com o orçamento aberto.']);
    expect((await patch(`/api/brasil/quotes/${quote}`, { quantity: 6000 })).status).toBe(409);
    expect((await patch(`/api/brasil/quotes/${quote}`, { status: 'aberto' })).status).toBe(200);
    expect((await patch(`/api/brasil/quotes/${quote}`, { quantity: 6000, notes: 'Pedir prova de cor' })).status).toBe(200);
    // Cancelar, reabrir e mudar um campo não apagam os outros.
    expect((await view()).quotes[0]).toMatchObject({ status: 'aberto', isbn: '9786585168663', quantity: 6000, specification: QUOTE.specification, notes: 'Pedir prova de cor' });
  });

  it('fechar com uma proposta cria o pedido, com a entrega prevista pelo prazo; dá para desfazer sem entrega', async () => {
    const { quote, b } = await quoteWithOffers();
    const closed = await post(`/api/brasil/quotes/${quote}/close`, { offerId: b, orderedAt: '2026-11-10' });
    expect(closed.status).toBe(201);
    let d = await view();
    expect(d.quotes[0]).toMatchObject({ status: 'fechado', orderId: closed.data.id });
    expect(d.orders).toHaveLength(1);
    expect(d.orders[0]).toMatchObject({ quoteId: quote, quantity: 5000, unitPriceE4: 37_000, orderedAt: '2026-11-10', dueAt: '2026-11-30', title: QUOTE.title, specification: QUOTE.specification });
    // Fechado, as propostas e o orçamento não mudam, e não fecha de novo.
    expect((await post(`/api/brasil/quotes/${quote}/close`, { offerId: b })).status).toBe(409);
    expect((await patch(`/api/brasil/offers/${b}`, { printer: 'X', quantity: 1, unitPriceE4: 1 })).status).toBe(409);
    expect((await patch(`/api/brasil/quotes/${quote}`, { status: 'cancelado' })).status).toBe(409);
    // A entrega prevista muda no pedido.
    expect((await patch(`/api/brasil/orders/${closed.data.id}`, { dueAt: '2026-12-05' })).status).toBe(200);
    expect((await view()).orders[0]!.dueAt).toBe('2026-12-05');
    // Desfazer o fechamento: o pedido sai e o orçamento volta a ficar aberto.
    expect((await post(`/api/brasil/orders/${closed.data.id}/reopen`, {})).status).toBe(200);
    d = await view();
    expect([d.quotes[0]!.status, d.orders.length]).toEqual(['aberto', 0]);
  });

  it('as entregas, em partes: a soma ou a última entrega encerra o pedido; desfazer reabre', async () => {
    const { quote, b } = await quoteWithOffers();
    const order = (await post(`/api/brasil/quotes/${quote}/close`, { offerId: b, orderedAt: '2026-11-01' })).data.id as string;
    const first = await post(`/api/brasil/orders/${order}/deliveries`, { deliveredAt: '2026-11-12', quantity: 3000 });
    expect(first.status).toBe(201);
    const second = await post(`/api/brasil/orders/${order}/deliveries`, { deliveredAt: '2026-11-16', quantity: 1950, last: true, notes: 'A gráfica disse que é a última' });
    expect(second.status).toBe(201);
    expect((await view()).orders[0]!.deliveries.map((x) => [x.quantity, x.last])).toEqual([
      [3000, false],
      [1950, true],
    ]);
    const more = await post(`/api/brasil/orders/${order}/deliveries`, { deliveredAt: '2026-11-17', quantity: 50 });
    expect([more.status, more.data.error]).toEqual([400, 'Este pedido já foi entregue. Para registrar outra entrega, desfaça a última.']);
    // Desfazer a última reabre o pedido, e a entrega que faltava entra.
    expect((await del(`/api/brasil/deliveries/${second.data.id}`)).status).toBe(200);
    expect((await post(`/api/brasil/orders/${order}/deliveries`, { deliveredAt: '2026-11-17', quantity: 2000 })).status).toBe(201);
    expect((await view()).orders[0]!.deliveries.map((x) => x.quantity)).toEqual([3000, 2000]);
    // Com entrega, não dá para desfazer o fechamento.
    const reopen = await post(`/api/brasil/orders/${order}/reopen`, {});
    expect([reopen.status, reopen.data.error]).toEqual([409, 'O pedido já tem entrega. Para desfazer o fechamento, desfaça antes as entregas.']);
  });

  it('confere o que chega: produto, ISBN, quantidade, preço, proposta e datas', async () => {
    const bad = async (path: string, body: object) => {
      const r = await post(path, body);
      return [r.status, r.data.error];
    };
    expect(await bad('/api/brasil/quotes', { ...QUOTE, title: '  ' })).toEqual([400, 'Informe o produto.']);
    expect(await bad('/api/brasil/quotes', { ...QUOTE, isbn: '978-65-85168-66-0' })).toEqual([400, 'ISBN inválido.']);
    expect(await bad('/api/brasil/quotes', { ...QUOTE, quantity: 0 })).toEqual([400, 'A quantidade precisa ser maior que zero.']);
    const { quote, b } = await quoteWithOffers();
    const other = (await post('/api/brasil/quotes', QUOTE)).data.id as string;
    expect(await bad(`/api/brasil/quotes/${quote}/offers`, { printer: 'Gráfica X', quantity: 5000, unitPriceE4: 0 })).toEqual([400, 'Informe o preço por exemplar.']);
    expect(await bad(`/api/brasil/quotes/${quote}/offers`, { printer: ' ', quantity: 5000, unitPriceE4: 10_000 })).toEqual([400, 'Informe a gráfica.']);
    expect(await bad(`/api/brasil/quotes/${other}/close`, { offerId: b })).toEqual([400, 'A proposta não é deste orçamento.']);
    expect(await bad(`/api/brasil/quotes/${quote}/close`, { offerId: b, orderedAt: '2026-11-20' })).toEqual([400, 'O fechamento não pode ser num dia que ainda não chegou.']);
    expect(await bad(`/api/brasil/quotes/${quote}/close`, { offerId: b, orderedAt: '2026-11-10', dueAt: '2026-11-01' })).toEqual([400, 'A entrega prevista não pode ser antes do fechamento.']);
    const order = (await post(`/api/brasil/quotes/${quote}/close`, { offerId: b, orderedAt: '2026-11-10' })).data.id as string;
    expect(await bad(`/api/brasil/orders/${order}/deliveries`, { deliveredAt: '2026-11-18', quantity: 100 })).toEqual([400, 'A entrega não pode ser num dia que ainda não chegou.']);
    expect(await bad(`/api/brasil/orders/${order}/deliveries`, { deliveredAt: '2026-11-09', quantity: 100 })).toEqual([400, 'A entrega não pode ser antes do pedido.']);
    expect((await post('/api/brasil/quotes/nao-existe/offers', { printer: 'X', quantity: 1, unitPriceE4: 1 })).status).toBe(404);
    expect((await post('/api/brasil/orders/nao-existe/deliveries', { deliveredAt: '2026-11-17', quantity: 1 })).status).toBe(404);
  });
});

describe('quem vê e quem lança a produção no Brasil', () => {
  it('Consulta vê tudo, com os valores; o leitor vê sem os valores; nenhum dos dois lança', async () => {
    const { quote, b } = await quoteWithOffers();
    await post(`/api/brasil/quotes/${quote}/close`, { offerId: b, orderedAt: '2026-11-10' });
    const consulta = await view(who.consulta.cookie);
    expect([consulta.seeValues, consulta.quotes[0]!.offers[0]!.unitPriceE4, consulta.orders[0]!.unitPriceE4]).toEqual([true, 41_000, 37_000]);
    const leitor = await view(who.leitor.cookie);
    expect(leitor.seeValues).toBe(false);
    expect(leitor.quotes[0]!.offers.map((o) => o.unitPriceE4)).toEqual([null, null, null]);
    expect(leitor.orders.map((o) => [o.quantity, o.unitPriceE4])).toEqual([[5000, null]]);
    for (const w of [who.consulta, who.leitor]) {
      expect((await post('/api/brasil/quotes', QUOTE, w.cookie)).status).toBe(403);
      expect((await post(`/api/brasil/orders/${leitor.orders[0]!.id}/deliveries`, { deliveredAt: '2026-11-17', quantity: 10 }, w.cookie)).status).toBe(403);
    }
  });

  it('Embarques, Vendas e o Agente de cargas não veem nem lançam; o admin lança', async () => {
    for (const w of [who.embarques, who.vendas, who.agente]) {
      expect((await app.call('GET', '/api/brasil', { cookie: w.cookie })).status).toBe(403);
      expect((await post('/api/brasil/quotes', QUOTE, w.cookie)).status).toBe(403);
    }
    expect((await post('/api/brasil/quotes', QUOTE, who.admin.cookie)).status).toBe(201);
    expect((await view()).quotes).toHaveLength(1);
  });
});
