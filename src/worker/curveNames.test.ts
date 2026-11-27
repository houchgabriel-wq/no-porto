// Nomes da curva ABC no embarque (27/11/2026): o Novo embarque grava o título da curva, pelo ISBN, no lugar
// do nome da invoice, nos itens da invoice e no produto; excluir o embarque devolve o nome de antes.
import { beforeEach, describe, expect, it } from 'vitest';
import type { CurveRow } from '../core/stockCurve';
import { testApp } from './test-api';

let app: ReturnType<typeof testApp>;
let who: Awaited<ReturnType<ReturnType<typeof testApp>['accounts']>>;
let claire: string;

const ALICE = '9786583970527';
const HABITOS = '9786560950702';
const CAIBALION = '9786580921232';
const BLUEY = '9786561263023';
const row = (isbn: string, title: string): CurveRow => ({ isbn, title, code: '1', abcClass: 'A', stock: 100, sales: { m1: 10, m3: 30, m6: 60, m9: null, m12: null } });
const CURVE = {
  stockDate: '2026-11-16',
  fileName: 'curva_abc_16-11.xlsx',
  rows: [row(ALICE, 'Coleção Alice no País das Maravilhas'), row(HABITOS, '365 Hábitos Simples e Poderosos'), row(CAIBALION, '  O Caibalion -  Os Três Iniciados ')],
};
const line = (over: object) => ({ row: 7, description: 'Livro', isbn: null, quantity: 1000, piecesPerCarton: null, unitPriceMicros: 1_000_000, notes: '', ...over });

beforeEach(async () => {
  app = testApp();
  who = await app.accounts();
  // Em produção, com os nomes como estão na PO.
  await app.call('POST', '/api/orders', {
    cookie: who.editor.cookie,
    body: {
      code: 'PO-070',
      supplier: 'Claire',
      orderedAt: '2026-10-01',
      items: [
        line({ description: 'Coleção Alice', isbn: ALICE, quantity: 5000 }),
        line({ row: 8, description: '365 hábitos (PO)', isbn: HABITOS, quantity: 1000 }),
        line({ row: 9, description: 'Box Bluey', isbn: BLUEY, quantity: 2000 }),
      ],
    },
  });
  claire = (await app.call('GET', '/api/data', { cookie: who.admin.cookie })).data.suppliers[0].id;
});

/** O embarque com os nomes que o fornecedor escreveu na invoice. */
const receive = () =>
  app.call('POST', '/api/shipments', {
    cookie: who.editor.cookie,
    body: {
      bill: 'ROECHN1',
      eta: '2026-12-28',
      invoices: [
        {
          supplierId: claire,
          number: 'X1',
          lines: [
            line({ description: 'Alice in Wonderland box', isbn: ALICE, quantity: 3000 }),
            line({ row: 8, description: '365 habits', isbn: HABITOS, quantity: 1000 }),
            line({ row: 9, description: 'Bluey boxset', isbn: BLUEY, quantity: 1000 }),
            line({ row: 10, description: 'The Kybalion', isbn: CAIBALION, quantity: 500 }),
          ],
        },
      ],
    },
  });

const data = async () => (await app.call('GET', '/api/data', { cookie: who.admin.cookie })).data as { items: { id: string; description: string; status: string; quantity: number; invoiceId: string | null; productId: string }[]; invoices: { id: string }[] };
const productTitle = async (isbn: string) => (await app.env.DB.prepare('SELECT title FROM products WHERE isbn = ?').bind(isbn).first<{ title: string }>())?.title;

describe('nomes da curva ABC no Novo embarque', () => {
  it('com a curva carregada, os itens da invoice e o produto ficam com o título da curva', async () => {
    expect((await app.call('POST', '/api/stock', { cookie: who.admin.cookie, body: CURVE })).status).toBe(201);
    expect((await receive()).status).toBe(201);
    const { items } = await data();
    const shipped = items.filter((i) => i.status === 'embarcado').map((i) => [i.description, i.quantity]);
    expect(shipped).toEqual(
      expect.arrayContaining([
        ['Coleção Alice no País das Maravilhas', 3000],
        ['365 Hábitos Simples e Poderosos', 1000],
        // Fora da curva: fica o nome que já tinha (o da PO).
        ['Box Bluey', 1000],
        // Não estava na produção: entra com o título da curva, com os espaços acertados.
        ['O Caibalion - Os Três Iniciados', 500],
      ]),
    );
    expect(shipped).toHaveLength(4);
    // O que ficou em produção continua com o nome de antes.
    expect(items.filter((i) => i.status === 'producao').map((i) => [i.description, i.quantity])).toEqual([
      ['Coleção Alice', 2000],
      ['Box Bluey', 1000],
    ]);
    expect([await productTitle(ALICE), await productTitle(HABITOS), await productTitle(CAIBALION), await productTitle(BLUEY)]).toEqual([
      'Coleção Alice no País das Maravilhas',
      '365 Hábitos Simples e Poderosos',
      'O Caibalion - Os Três Iniciados',
      'Box Bluey',
    ]);
  });

  it('excluir o embarque devolve o nome de antes ao que volta para a produção', async () => {
    await app.call('POST', '/api/stock', { cookie: who.admin.cookie, body: CURVE });
    await receive();
    const { invoices } = await data();
    expect((await app.call('DELETE', `/api/invoices/${invoices[0]!.id}`, { cookie: who.admin.cookie })).status).toBe(200);
    const { items } = await data();
    expect(items.map((i) => [i.description, i.status, i.quantity])).toEqual([
      ['Coleção Alice', 'producao', 5000],
      ['365 hábitos (PO)', 'producao', 1000],
      ['Box Bluey', 'producao', 2000],
    ]);
  });

  it('sem curva carregada, ficam os nomes de sempre', async () => {
    await receive();
    const { items } = await data();
    expect(items.filter((i) => i.status === 'embarcado').map((i) => i.description)).toEqual(expect.arrayContaining(['Coleção Alice', '365 hábitos (PO)', 'Box Bluey', 'The Kybalion']));
    expect(await productTitle(CAIBALION)).toBe('The Kybalion');
  });
});

describe('títulos da curva para a prévia do Novo embarque', () => {
  const titles = (isbns: string[], cookie = who.editor.cookie) => app.call('POST', '/api/stock/titles', { cookie, body: { isbns } });

  it('o título de cada ISBN que está na curva, pelo ISBN-13 ou pelo ISBN-10', async () => {
    expect((await titles([ALICE])).data).toEqual({ stockDate: null, titles: {} });
    await app.call('POST', '/api/stock', { cookie: who.admin.cookie, body: CURVE });
    // O Bluey não está na curva; o ISBN-10 do Caibalion acha o ISBN-13 da curva.
    expect((await titles([ALICE, BLUEY, '6580921234'])).data).toEqual({
      stockDate: '2026-11-16',
      titles: { [ALICE]: 'Coleção Alice no País das Maravilhas', '6580921234': 'O Caibalion - Os Três Iniciados' },
    });
  });

  it('só admin e editor, que importam embarques; os outros perfis, inclusive o Agente de cargas, não', async () => {
    expect((await titles([ALICE], who.admin.cookie)).status).toBe(200);
    for (const w of [who.consulta, who.leitor, who.embarques, who.vendas, who.agente]) expect((await titles([ALICE], w.cookie)).status).toBe(403);
  });
});
