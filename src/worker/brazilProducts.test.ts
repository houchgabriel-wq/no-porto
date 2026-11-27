// Orçamento com vários produtos (27/11/2026): o box Curso Básico de Desenho com os 3 livros que vão dentro dele e mais
// 2.000 do Mangá avulsos, como na proposta 117.627 da Grafilar. Os itens se ligam aos produtos, o pedido guarda cada
// produto com a quantidade e o custo, as entregas são de cada produto, e o que vai dentro do box não conta no estoque.
import { beforeEach, describe, expect, it } from 'vitest';
import { testApp } from './test-api';

let app: ReturnType<typeof testApp>;
let who: Awaited<ReturnType<ReturnType<typeof testApp>['accounts']>>;

beforeEach(async () => {
  app = testApp();
  who = await app.accounts();
});

const post = (path: string, body: object, cookie = who.editor.cookie) => app.call('POST', path, { cookie, body });
const patch = (path: string, body: object, cookie = who.editor.cookie) => app.call('PATCH', path, { cookie, body });
const del = (path: string, cookie = who.editor.cookie) => app.call('DELETE', path, { cookie });

const BOX = '9786561263023';
const MANGA = '9786561263030';
const KIT = {
  products: [
    { title: 'Box Curso Básico de Desenho', isbn: BOX, quantity: 15_000 },
    { title: 'Curso Básico de Desenho - Básico', isbn: '9786561263047', quantity: 15_000, inBox: true },
    { title: 'Curso Básico de Desenho - Mangá', isbn: MANGA, quantity: 15_000, inBox: true },
    { title: 'Curso Básico de Desenho - Rosto', isbn: '9786561263054', quantity: 15_000, inBox: true },
    { title: 'Curso Básico de Desenho - Mangá (avulso)', isbn: MANGA, quantity: 2_000 },
  ],
  specification: 'Box em cartão triplex; livros 151 x 230 mm, 160 páginas',
};
interface ProductView {
  id: string;
  title: string;
  isbn: string | null;
  quantity: number;
  inBox: boolean;
}
interface View {
  quotes: { id: string; title: string; isbn: string | null; status: string; products: ProductView[]; offers: { id: string; items: { productId: string | null; specification: string; unitPriceE4: number | null }[] }[] }[];
  orders: {
    id: string;
    quantity: number;
    products: (ProductView & { productId: string | null; costCents: number | null })[];
    deliveries: { id: string; productId: string | null; groupId: string; quantity: number; last: boolean }[];
  }[];
}
const view = async (cookie = who.admin.cookie): Promise<View> => (await app.call('GET', '/api/brasil', { cookie })).data;

/** O kit com a proposta da Grafilar: o box, os 3 livros e o avulso, cada item ligado ao produto. */
async function kitWithOffer() {
  const created = await post('/api/brasil/quotes', KIT);
  expect(created.status).toBe(201);
  const quote = created.data.id as string;
  const ids = (created.data.products as { id: string }[]).map((p) => p.id);
  const item = (n: number, quantity: number, unitPriceE4: number, specification = '') => ({ productId: ids[n], description: KIT.products[n]!.title, specification, quantity, unitPriceE4 });
  const offer = await post(`/api/brasil/quotes/${quote}/offers`, {
    printer: 'Grafilar',
    quantity: 15_000,
    paperBy: 'grafica',
    items: [item(0, 15_000, 34_600, 'Form. 292 x 416 mm, Cartão Triplex C1S LD 250 g/m2'), item(1, 15_000, 32_900), item(2, 15_000, 32_900), item(3, 15_000, 32_900), item(4, 2_000, 32_900)],
    leadDays: 20,
    proposalNumber: '117.627',
  });
  expect(offer.status).toBe(201);
  return { quote, ids, offer: offer.data.id as string };
}

describe('o orçamento com vários produtos', () => {
  it('cadastra os produtos na ordem, com o que vai dentro do box; o orçamento fica com o nome e o ISBN do primeiro', async () => {
    const { quote, ids } = await kitWithOffer();
    const q = (await view()).quotes.find((x) => x.id === quote)!;
    expect(q).toMatchObject({ title: 'Box Curso Básico de Desenho', isbn: BOX, status: 'aberto' });
    expect(q.products.map((p) => [p.id, p.title, p.quantity, p.inBox])).toEqual(KIT.products.map((p, n) => [ids[n], p.title, p.quantity, p.inBox ?? false]));
    expect(q.offers[0]!.items.map((i) => i.productId)).toEqual(ids);
    expect(q.offers[0]!.items[0]!.specification).toBe('Form. 292 x 416 mm, Cartão Triplex C1S LD 250 g/m2');
  });

  it('recusa produtos sem o box, item sem produto e produto de outro orçamento', async () => {
    const allInBox = await post('/api/brasil/quotes', { products: [{ title: 'A', quantity: 10, inBox: true }] });
    expect([allInBox.status, allInBox.data.error]).toEqual([400, 'Algum produto precisa ser o box: os que vão dentro dele não podem ser todos.']);
    const { quote, ids } = await kitWithOffer();
    const other = (await post('/api/brasil/quotes', { title: 'Outro', quantity: 100 })).data.products[0].id as string;
    const offer = (items: object[]) => post(`/api/brasil/quotes/${quote}/offers`, { printer: 'Assahi', quantity: 15_000, paperBy: 'grafica', items });
    const noProduct = await offer([{ description: 'Box', quantity: 15_000, unitPriceE4: 30_000 }]);
    expect([noProduct.status, noProduct.data.error]).toEqual([400, 'Diga qual produto o 1º item (Box) cobra.']);
    const foreign = await offer([{ productId: other, description: 'Box', quantity: 15_000, unitPriceE4: 30_000 }]);
    expect([foreign.status, foreign.data.error]).toEqual([400, 'O produto de um dos itens não é deste orçamento.']);
    // A proposta que não orçou todos os produtos não fecha.
    const partial = (await offer([{ productId: ids[0], description: 'Box', quantity: 15_000, unitPriceE4: 30_000 }])).data.id as string;
    const closing = await post(`/api/brasil/quotes/${quote}/close`, { offerId: partial, orderedAt: '2026-11-10' });
    expect([closing.status, closing.data.error]).toEqual([
      400,
      'A proposta não orçou Curso Básico de Desenho - Básico, Curso Básico de Desenho - Mangá, Curso Básico de Desenho - Rosto, Curso Básico de Desenho - Mangá (avulso). Corrija a proposta antes de fechar.',
    ]);
  });

  it('muda os produtos: renomeia, acrescenta e tira; não tira o que tem preço numa proposta', async () => {
    const { quote, ids } = await kitWithOffer();
    const products = (await view()).quotes.find((x) => x.id === quote)!.products;
    const keep = products.map((p) => ({ id: p.id, title: p.title, isbn: p.isbn, quantity: p.quantity, inBox: p.inBox }));
    const removing = await patch(`/api/brasil/quotes/${quote}`, { products: keep.slice(0, 4) });
    expect([removing.status, removing.data.error]).toEqual([409, 'Curso Básico de Desenho - Mangá (avulso) tem preço numa proposta: tire o item da proposta antes de tirar o produto.']);
    const renamed = await patch(`/api/brasil/quotes/${quote}`, { products: [{ ...keep[0]!, title: 'Box Curso Básico de Desenho (3 livros)' }, ...keep.slice(1), { title: 'Marcador', quantity: 15_000, inBox: true }] });
    expect(renamed.status).toBe(200);
    const after = (await view()).quotes.find((x) => x.id === quote)!;
    expect(after.title).toBe('Box Curso Básico de Desenho (3 livros)');
    expect(after.products.map((p) => p.title).at(-1)).toBe('Marcador');
    expect(after.products.slice(0, 5).map((p) => p.id)).toEqual(ids);
    // O jeito de antes (um produto só) não serve para o orçamento com vários.
    expect((await patch(`/api/brasil/quotes/${quote}`, { quantity: 10 })).data.error).toBe('Este orçamento tem vários produtos: mude os produtos.');
  });
});

describe('o pedido com vários produtos e as entregas', () => {
  it('fecha: cada produto com a quantidade e o custo da proposta; o leitor vê sem o custo', async () => {
    const { quote, offer, ids } = await kitWithOffer();
    const order = (await post(`/api/brasil/quotes/${quote}/close`, { offerId: offer, orderedAt: '2026-11-10' })).data.id as string;
    const o = (await view()).orders.find((x) => x.id === order)!;
    // A quantidade do pedido soma o que conta: o box e o avulso.
    expect(o.quantity).toBe(17_000);
    expect(o.products.map((p) => [p.productId, p.quantity, p.inBox, p.costCents])).toEqual([
      [ids[0], 15_000, false, 5_190_000],
      [ids[1], 15_000, true, 4_935_000],
      [ids[2], 15_000, true, 4_935_000],
      [ids[3], 15_000, true, 4_935_000],
      [ids[4], 2_000, false, 658_000],
    ]);
    expect((await view(who.leitor.cookie)).orders[0]!.products.every((p) => p.costCents === null)).toBe(true);
  });

  it('a entrega de cada produto, registrada junta; desfazer leva o grupo; o que vai dentro do box não tem entrega', async () => {
    const { quote, offer } = await kitWithOffer();
    const order = (await post(`/api/brasil/quotes/${quote}/close`, { offerId: offer, orderedAt: '2026-11-10' })).data.id as string;
    const products = (await view()).orders[0]!.products;
    const [box, , manga, , avulso] = products.map((p) => p.id);
    const inBox = await post(`/api/brasil/orders/${order}/deliveries`, { deliveredAt: '2026-11-15', parts: [{ productId: manga, quantity: 100 }] });
    expect([inBox.status, inBox.data.error]).toEqual([400, 'O produto da entrega não é deste pedido, ou vai dentro do box (vem com ele).']);
    const both = await post(`/api/brasil/orders/${order}/deliveries`, {
      deliveredAt: '2026-11-15',
      parts: [
        { productId: box, quantity: 15_000 },
        { productId: avulso, quantity: 0 },
      ],
    });
    expect(both.status).toBe(201);
    const second = await post(`/api/brasil/orders/${order}/deliveries`, { deliveredAt: '2026-11-16', parts: [{ productId: avulso, quantity: 1_950 }], last: true });
    expect(second.status).toBe(201);
    const deliveries = (await view()).orders[0]!.deliveries;
    expect(deliveries.map((d) => [d.productId, d.quantity, d.last])).toEqual([
      [box, 15_000, false],
      [avulso, 1_950, true],
    ]);
    expect(deliveries[0]!.groupId).toBe(both.data.id);
    // Entregue: o box completo e o avulso marcado como a última.
    const full = await post(`/api/brasil/orders/${order}/deliveries`, { deliveredAt: '2026-11-17', parts: [{ productId: box, quantity: 10 }] });
    expect(full.data.error).toBe('Este pedido já foi entregue. Para registrar outra entrega, desfaça a última.');
    expect((await del(`/api/brasil/deliveries/${second.data.id}`)).status).toBe(200);
    expect((await view()).orders[0]!.deliveries.map((d) => d.productId)).toEqual([box]);
  });
});

describe('a visão junta com o kit', () => {
  it('o terminal e a ficha do produto: o box e o avulso contam; o livro de dentro do box não', async () => {
    const { quote, offer } = await kitWithOffer();
    await post(`/api/brasil/quotes/${quote}/close`, { offerId: offer, orderedAt: '2026-11-10', dueAt: '2026-12-01' });
    const products = (await app.call('GET', '/api/lookup', { cookie: who.leitor.cookie })).data.products as { isbn: string | null; brazil: { quantity: number } }[];
    expect(products.find((p) => p.isbn === BOX)?.brazil.quantity).toBe(15_000);
    // O Mangá conta só os 2.000 avulsos; o Básico e o Rosto, que só vão dentro do box, nem aparecem.
    expect(products.find((p) => p.isbn === MANGA)?.brazil.quantity).toBe(2_000);
    expect(products.some((p) => p.isbn === '9786561263047')).toBe(false);
  });
});
