// Produção no Brasil (27/11/2026): orçamentos com as propostas das gráficas (itens, papel da gráfica ou nosso, pela
// tabela de papéis, e o PDF), o pedido que sai do orçamento fechado e as entregas no estoque, em partes. Quem vê:
// como na importação; o leitor, sem os valores.
import { beforeEach, describe, expect, it } from 'vitest';
import { testApp } from './test-api';

let app: ReturnType<typeof testApp>;
let who: Awaited<ReturnType<ReturnType<typeof testApp>['accounts']>>;

beforeEach(async () => {
  app = testApp();
  who = await app.accounts();
});

const QUOTE = { title: 'Cartas a Milena - Franz Kafka - Camelot Editora', isbn: '978-65-85168-66-3', quantity: 5000, specification: '14 x 21 cm, 160 páginas, pólen 80 g, capa cartão 250 g com laminação fosca', notes: '' };
/** Proposta de um item só, com o papel da gráfica. */
const simple = (printer: string, unitPriceE4: number, leadDays: number | null, quantity = 5000) => ({ printer, quantity, paperBy: 'grafica', items: [{ description: 'Livro', quantity, unitPriceE4 }], leadDays });
/** A proposta da Assahi (orçamento 103896.04): 20.000 livros a R$ 1,18 com o papel nosso, capa e dois miolos. */
const ASSAHI = {
  printer: 'Assahi Gráfica e Editora',
  quantity: 20_000,
  paperBy: 'editora',
  items: [{ description: 'Livro Fresado Hot melt', quantity: 20_000, unitPriceE4: 11_800 }],
  papers: [
    { part: 'capa', paper: 'Triplex LD 230 g', grams: 707_000, pricePerKgE4: 85_000 },
    { part: 'miolo', paper: 'Offwhite Rot 60 g', grams: 2_463_440, pricePerKgE4: 72_000 },
    { part: 'miolo', paper: 'offwhite rot 60 g', grams: 846_810, pricePerKgE4: 72_000 },
  ],
  leadDays: 15,
  proposalNumber: '103896.04',
  proposalDate: '2026-11-24',
  validDays: 15,
  paymentTerms: '30 dias',
  notes: 'Impressão rotativa; frete incluso na Grande São Paulo',
};
const post = (path: string, body: object, cookie = who.editor.cookie) => app.call('POST', path, { cookie, body });
const patch = (path: string, body: object, cookie = who.editor.cookie) => app.call('PATCH', path, { cookie, body });
const del = (path: string, cookie = who.editor.cookie) => app.call('DELETE', path, { cookie });

interface OfferView {
  id: string;
  printerId: string;
  quantity: number;
  paperBy: string;
  items: { description: string; quantity: number; unitPriceE4: number | null }[];
  papers: { part: string; paperId: string | null; paperName: string; grams: number; pricePerKgE4: number | null }[];
  leadDays: number | null;
  proposalNumber: string;
  document: { name: string; size: number } | null;
}
interface View {
  today: string;
  seeValues: boolean;
  printers: { id: string; name: string }[];
  papers: { id: string; name: string; pricePerKgE4: number | null }[];
  quotes: { id: string; status: string; isbn: string | null; quantity: number; specification: string; notes: string; createdBy: string | null; orderId: string | null; offers: OfferView[] }[];
  orders: { id: string; quoteId: string; printerId: string; quantity: number; printerCents: number | null; paperCents: number | null; orderedAt: string; dueAt: string | null; title: string; specification: string; deliveries: { id: string; quantity: number; last: boolean }[] }[];
}
const view = async (cookie = who.admin.cookie): Promise<View> => (await app.call('GET', '/api/brasil', { cookie })).data;

/** Um orçamento com três propostas: duas gráficas, uma delas com duas tiragens. */
async function quoteWithOffers() {
  const quote = (await post('/api/brasil/quotes', QUOTE)).data.id as string;
  const a = (await post(`/api/brasil/quotes/${quote}/offers`, simple('Gráfica Santa Marta', 41_000, 15))).data.id as string;
  const b = (await post(`/api/brasil/quotes/${quote}/offers`, { ...simple('Gráfica Exklusiva', 37_000, 20), notes: 'Prova digital incluída' })).data.id as string;
  // A mesma gráfica, escrita de outro jeito, com outra tiragem.
  const c = (await post(`/api/brasil/quotes/${quote}/offers`, simple('gráfica santa marta', 33_500, 25, 10_000))).data.id as string;
  return { quote, a, b, c };
}

describe('orçamentos com as gráficas do Brasil', () => {
  it('cadastra o orçamento e as propostas; a gráfica nova entra no cadastro, sem repetir', async () => {
    const { quote, a, b, c } = await quoteWithOffers();
    const d = await view();
    expect(d.printers.map((p) => p.name)).toEqual(['Gráfica Exklusiva', 'Gráfica Santa Marta']);
    const [q] = d.quotes;
    expect(q).toMatchObject({ id: quote, status: 'aberto', isbn: '9786585168663', createdBy: 'Bia Editora', orderId: null });
    expect(q!.offers.map((o) => [o.id, o.quantity, o.paperBy, o.items[0]!.unitPriceE4, o.leadDays])).toEqual([
      [a, 5000, 'grafica', 41_000, 15],
      [b, 5000, 'grafica', 37_000, 20],
      [c, 10000, 'grafica', 33_500, 25],
    ]);
    const santaMarta = d.printers.find((p) => p.name === 'Gráfica Santa Marta')!.id;
    expect([q!.offers[0]!.printerId, q!.offers[2]!.printerId]).toEqual([santaMarta, santaMarta]);
  });

  it('o kit: uma proposta com vários itens da gráfica', async () => {
    const quote = (await post('/api/brasil/quotes', { ...QUOTE, title: 'Kit Curso Básico de Desenho (box + 3 livros)', isbn: null, quantity: 15_000 })).data.id as string;
    const kit = {
      printer: 'Grafilar',
      quantity: 15_000,
      paperBy: 'grafica',
      items: [
        { description: 'Box', quantity: 15_000, unitPriceE4: 34_600 },
        { description: 'Livros Básico, Mangá e Rosto (15.000 de cada)', quantity: 45_000, unitPriceE4: 32_900 },
      ],
      proposalNumber: '117.627',
      proposalDate: '2026-11-24',
      validDays: 10,
      paymentTerms: '30 DDL',
    };
    const offer = (await post(`/api/brasil/quotes/${quote}/offers`, kit)).data.id as string;
    expect((await view()).quotes[0]!.offers[0]).toMatchObject({ proposalNumber: '117.627', items: kit.items, papers: [] });
    const order = (await post(`/api/brasil/quotes/${quote}/close`, { offerId: offer, orderedAt: '2026-11-17' })).data.id as string;
    expect((await view()).orders.find((o) => o.id === order)).toMatchObject({ quantity: 15_000, printerCents: 19_995_000, paperCents: 0 });
  });

  it('papel nosso: o papel entra na tabela, a proposta guarda o peso e o preço, e o custo vai para o pedido', async () => {
    const quote = (await post('/api/brasil/quotes', { ...QUOTE, title: 'Meditações', isbn: null, quantity: 20_000 })).data.id as string;
    const offer = (await post(`/api/brasil/quotes/${quote}/offers`, ASSAHI)).data.id as string;
    let d = await view();
    expect(d.papers.map((p) => [p.name, p.pricePerKgE4])).toEqual([
      ['Offwhite Rot 60 g', 72_000],
      ['Triplex LD 230 g', 85_000],
    ]);
    const o = d.quotes[0]!.offers[0]!;
    expect(o.papers.map((p) => [p.part, p.paperName, p.grams, p.pricePerKgE4])).toEqual([
      ['capa', 'Triplex LD 230 g', 707_000, 85_000],
      ['miolo', 'Offwhite Rot 60 g', 2_463_440, 72_000],
      ['miolo', 'offwhite rot 60 g', 846_810, 72_000],
    ]);
    expect(new Set(o.papers.slice(1).map((p) => p.paperId)).size).toBe(1);
    // Fechado: R$ 23.600,00 da gráfica e R$ 29.843,30 de papel.
    await post(`/api/brasil/quotes/${quote}/close`, { offerId: offer, orderedAt: '2026-11-17' });
    d = await view();
    expect(d.orders[0]).toMatchObject({ quantity: 20_000, printerCents: 2_360_000, paperCents: 2_984_330, dueAt: '2026-12-02' });
    // Papel nosso sem o papel: recusa.
    const other = (await post('/api/brasil/quotes', QUOTE)).data.id as string;
    const bad = await post(`/api/brasil/quotes/${other}/offers`, { ...ASSAHI, papers: [] });
    expect([bad.status, bad.data.error]).toEqual([400, 'Com o papel nosso, informe o papel: a parte, o papel, o peso e o preço por kg.']);
  });

  it('a tabela de papéis: cadastrar e mudar o preço; a proposta feita fica com o preço que usou', async () => {
    const created = await post('/api/brasil/papers', { name: 'Triplex LD 230 g', pricePerKgE4: 85_000 });
    expect(created.status).toBe(201);
    const same = await post('/api/brasil/papers', { name: 'triplex ld 230 g', pricePerKgE4: 90_000 });
    expect([same.status, same.data.error]).toEqual([409, 'O papel triplex ld 230 g já está na tabela.']);
    const quote = (await post('/api/brasil/quotes', QUOTE)).data.id as string;
    await post(`/api/brasil/quotes/${quote}/offers`, { ...ASSAHI, papers: [ASSAHI.papers[0]] });
    expect((await patch(`/api/brasil/papers/${created.data.id}`, { pricePerKgE4: 91_500 })).status).toBe(200);
    const d = await view();
    expect(d.papers.map((p) => [p.name, p.pricePerKgE4])).toEqual([['Triplex LD 230 g', 91_500]]);
    expect(d.quotes[0]!.offers[0]!.papers[0]!.pricePerKgE4).toBe(85_000);
    expect((await post('/api/brasil/papers', { name: 'Pólen 80 g', pricePerKgE4: 0 })).data.error).toBe('Informe o preço por kg.');
  });

  it('o PDF da proposta: guardar, baixar, trocar e tirar; sai junto com a proposta', async () => {
    const { a } = await quoteWithOffers();
    const pdf = Buffer.from('%PDF-1.4 proposta 117.627').toString('base64');
    expect((await app.call('PUT', `/api/brasil/offers/${a}/document`, { cookie: who.editor.cookie, body: { name: 'O117627.pdf', contentType: 'application/pdf', data: pdf } })).status).toBe(201);
    expect((await view()).quotes[0]!.offers[0]!.document).toEqual({ name: 'O117627.pdf', size: 25 });
    const got = await app.raw('GET', `/api/brasil/offers/${a}/document`, { cookie: who.consulta.cookie });
    expect([got.status, got.headers.get('content-type')]).toEqual([200, 'application/pdf']);
    expect(new TextDecoder().decode(await got.arrayBuffer())).toBe('%PDF-1.4 proposta 117.627');
    const wrong = await app.call('PUT', `/api/brasil/offers/${a}/document`, { cookie: who.editor.cookie, body: { name: 'a.exe', contentType: 'application/x-msdownload', data: pdf } });
    expect([wrong.status, wrong.data.error]).toEqual([400, 'Envie a proposta em PDF, PNG ou JPG.']);
    expect((await del(`/api/brasil/offers/${a}/document`)).status).toBe(200);
    expect((await view()).quotes[0]!.offers[0]!.document).toBeNull();
    // Tirar a proposta leva o arquivo junto.
    await app.call('PUT', `/api/brasil/offers/${a}/document`, { cookie: who.editor.cookie, body: { name: 'O117627.pdf', contentType: 'application/pdf', data: pdf } });
    expect((await del(`/api/brasil/offers/${a}`)).status).toBe(200);
    const left = await app.env.DB.prepare('SELECT (SELECT COUNT(*) FROM br_offer_documents) AS docs, (SELECT COUNT(*) FROM br_offer_document_parts) AS parts, (SELECT COUNT(*) FROM br_offer_items WHERE offer_id = ?) AS items').bind(a).first();
    expect(left).toEqual({ docs: 0, parts: 0, items: 0 });
  });

  it('corrige e tira propostas enquanto o orçamento está aberto; cancelado, só reabrindo', async () => {
    const { quote, a, c } = await quoteWithOffers();
    expect((await patch(`/api/brasil/offers/${a}`, simple('Gráfica Santa Marta', 39_500, 12))).status).toBe(200);
    expect((await del(`/api/brasil/offers/${c}`)).status).toBe(200);
    expect((await view()).quotes[0]!.offers.map((o) => [o.items[0]!.unitPriceE4, o.leadDays])).toEqual([
      [39_500, 12],
      [37_000, 20],
    ]);
    expect((await patch(`/api/brasil/quotes/${quote}`, { status: 'cancelado' })).status).toBe(200);
    const blocked = await post(`/api/brasil/quotes/${quote}/offers`, simple('Gráfica Nova', 30_000, null));
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
    expect(d.orders[0]).toMatchObject({ quoteId: quote, quantity: 5000, printerCents: 1_850_000, paperCents: 0, orderedAt: '2026-11-10', dueAt: '2026-11-30', title: QUOTE.title, specification: QUOTE.specification });
    // Fechado, as propostas e o orçamento não mudam, e não fecha de novo.
    expect((await post(`/api/brasil/quotes/${quote}/close`, { offerId: b })).status).toBe(409);
    expect((await patch(`/api/brasil/offers/${b}`, simple('X', 1, null, 1))).status).toBe(409);
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

  it('confere o que chega: produto, ISBN, quantidade, itens, gráfica, proposta e datas', async () => {
    const bad = async (path: string, body: object) => {
      const r = await post(path, body);
      return [r.status, r.data.error];
    };
    expect(await bad('/api/brasil/quotes', { ...QUOTE, title: '  ' })).toEqual([400, 'Informe o produto.']);
    expect(await bad('/api/brasil/quotes', { ...QUOTE, isbn: '978-65-85168-66-0' })).toEqual([400, 'ISBN inválido.']);
    expect(await bad('/api/brasil/quotes', { ...QUOTE, quantity: 0 })).toEqual([400, 'A quantidade precisa ser maior que zero.']);
    const { quote, b } = await quoteWithOffers();
    const other = (await post('/api/brasil/quotes', QUOTE)).data.id as string;
    expect(await bad(`/api/brasil/quotes/${quote}/offers`, simple('Gráfica X', 0, null))).toEqual([400, 'Informe o preço por unidade de cada item.']);
    expect(await bad(`/api/brasil/quotes/${quote}/offers`, simple(' ', 10_000, null))).toEqual([400, 'Informe a gráfica.']);
    expect(await bad(`/api/brasil/quotes/${quote}/offers`, { ...simple('Gráfica X', 10_000, null), items: [] })).toEqual([400, 'Informe ao menos um item da proposta.']);
    expect(await bad(`/api/brasil/quotes/${other}/close`, { offerId: b })).toEqual([400, 'A proposta não é deste orçamento.']);
    expect(await bad(`/api/brasil/quotes/${quote}/close`, { offerId: b, orderedAt: '2026-11-20' })).toEqual([400, 'O fechamento não pode ser num dia que ainda não chegou.']);
    expect(await bad(`/api/brasil/quotes/${quote}/close`, { offerId: b, orderedAt: '2026-11-10', dueAt: '2026-11-01' })).toEqual([400, 'A entrega prevista não pode ser antes do fechamento.']);
    const order = (await post(`/api/brasil/quotes/${quote}/close`, { offerId: b, orderedAt: '2026-11-10' })).data.id as string;
    expect(await bad(`/api/brasil/orders/${order}/deliveries`, { deliveredAt: '2026-11-18', quantity: 100 })).toEqual([400, 'A entrega não pode ser num dia que ainda não chegou.']);
    expect(await bad(`/api/brasil/orders/${order}/deliveries`, { deliveredAt: '2026-11-09', quantity: 100 })).toEqual([400, 'A entrega não pode ser antes do pedido.']);
    expect((await post('/api/brasil/quotes/nao-existe/offers', simple('X', 1, null, 1))).status).toBe(404);
    expect((await post('/api/brasil/orders/nao-existe/deliveries', { deliveredAt: '2026-11-17', quantity: 1 })).status).toBe(404);
  });
});

describe('quem vê e quem lança a produção no Brasil', () => {
  it('Consulta vê tudo, com os valores e o PDF; o leitor vê sem os valores nem o PDF; nenhum dos dois lança', async () => {
    const quote = (await post('/api/brasil/quotes', QUOTE)).data.id as string;
    const offer = (await post(`/api/brasil/quotes/${quote}/offers`, ASSAHI)).data.id as string;
    await app.call('PUT', `/api/brasil/offers/${offer}/document`, { cookie: who.editor.cookie, body: { name: 'proposta.pdf', contentType: 'application/pdf', data: Buffer.from('%PDF').toString('base64') } });
    await post(`/api/brasil/quotes/${quote}/close`, { offerId: offer, orderedAt: '2026-11-10' });
    const consulta = await view(who.consulta.cookie);
    expect([consulta.seeValues, consulta.quotes[0]!.offers[0]!.items[0]!.unitPriceE4, consulta.quotes[0]!.offers[0]!.document?.name, consulta.orders[0]!.paperCents]).toEqual([true, 11_800, 'proposta.pdf', 2_984_330]);
    const leitor = await view(who.leitor.cookie);
    expect(leitor.seeValues).toBe(false);
    const lo = leitor.quotes[0]!.offers[0]!;
    expect([lo.items[0]!.unitPriceE4, lo.papers.map((p) => p.pricePerKgE4), lo.document]).toEqual([null, [null, null, null], null]);
    expect(leitor.papers.map((p) => p.pricePerKgE4)).toEqual([null, null]);
    expect(leitor.orders.map((o) => [o.quantity, o.printerCents, o.paperCents])).toEqual([[20_000, null, null]]);
    expect((await app.raw('GET', `/api/brasil/offers/${offer}/document`, { cookie: who.leitor.cookie })).status).toBe(403);
    for (const w of [who.consulta, who.leitor]) {
      expect((await post('/api/brasil/quotes', QUOTE, w.cookie)).status).toBe(403);
      expect((await post('/api/brasil/papers', { name: 'Pólen 80 g', pricePerKgE4: 90_000 }, w.cookie)).status).toBe(403);
      expect((await post(`/api/brasil/orders/${leitor.orders[0]!.id}/deliveries`, { deliveredAt: '2026-11-17', quantity: 10 }, w.cookie)).status).toBe(403);
    }
  });

  it('Embarques, Vendas e o Agente de cargas não veem nem lançam; o admin lança', async () => {
    for (const w of [who.embarques, who.vendas, who.agente]) {
      expect((await app.call('GET', '/api/brasil', { cookie: w.cookie })).status).toBe(403);
      expect((await post('/api/brasil/quotes', QUOTE, w.cookie)).status).toBe(403);
      expect((await app.raw('GET', '/api/brasil/offers/x/document', { cookie: w.cookie })).status).toBe(403);
    }
    expect((await post('/api/brasil/quotes', QUOTE, who.admin.cookie)).status).toBe(201);
    expect((await view()).quotes).toHaveLength(1);
  });
});
