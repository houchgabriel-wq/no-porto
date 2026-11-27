import { describe, expect, it } from 'vitest';
import type { BrOrderSummary } from './brazil';
import { productSummaries, searchProducts, type LookupItem } from './productLookup';

const ALICE = '9786583970527';
const MEDITACOES = '9786587817675';

function item(over: Partial<LookupItem>): LookupItem {
  return { productId: 'alice', isbn: ALICE, description: 'Coleção Alice', status: 'producao', quantity: 1000, orderCode: null, shipPlan: [], eta: null, arrivedAt: null, ...over };
}

// Em ordem de entrada: o histórico de 2025, um embarque a caminho e as POs em produção.
const ITEMS: LookupItem[] = [
  item({ description: 'Box Coleção Alice no País das Maravilhas', status: 'entregue', quantity: 4000, arrivedAt: '2025-05-22' }),
  item({ description: 'Coleção Alice', status: 'entregue', quantity: 2500, arrivedAt: '2026-03-10' }),
  item({ description: 'Coleção Alice', status: 'entregue', quantity: 500, arrivedAt: '2026-03-10' }),
  item({ description: 'Coleção Alice', status: 'entregue', quantity: 300, arrivedAt: null }),
  item({ description: 'Coleção Alice', status: 'embarcado', quantity: 3000, eta: '2026-12-20' }),
  item({ description: 'Coleção Alice', status: 'embarcado', quantity: 1000, eta: '2026-12-05' }),
  item({ description: 'Coleção Alice', status: 'producao', quantity: 5000, orderCode: 'PO-070', shipPlan: [{ month: '2027-03', quantity: 5000 }] }),
  item({ description: 'Coleção Alice (nova capa)', status: 'producao', quantity: 2000, orderCode: 'PO-056', shipPlan: [{ month: '2026-12', quantity: 2000 }] }),
  item({ productId: 'meditacoes', isbn: MEDITACOES, description: 'Meditações - Marco Aurélio', status: 'producao', quantity: 30000, orderCode: 'PO-070' }),
  item({ productId: 'sem-isbn', isbn: null, description: 'Livro de Colorir Fazenda', status: 'entregue', quantity: 800, arrivedAt: '2024-08-01' }),
  item({ productId: '1984', isbn: null, description: '1984 - George Orwell', status: 'entregue', quantity: 1200, arrivedAt: '2025-01-15' }),
];

describe('resumo de cada produto', () => {
  it('soma em produção (com as POs e o próximo envio), embarcado (com a previsão mais próxima) e a última chegada', () => {
    const [alice] = productSummaries(ITEMS);
    expect(alice).toEqual({
      key: 'alice',
      productId: 'alice',
      isbn: ALICE,
      title: 'Coleção Alice (nova capa)',
      names: ['Box Coleção Alice no País das Maravilhas', 'Coleção Alice', 'Coleção Alice (nova capa)'],
      production: { quantity: 7000, orders: ['PO-056', 'PO-070'], nextShip: '2026-12' },
      atSea: { quantity: 4000, nextEta: '2026-12-05' },
      brazil: { quantity: 0, printers: [], nextDue: null },
      // Duas invoices chegaram no mesmo dia: a quantidade é a soma; o item sem data não conta.
      lastArrival: { date: '2026-03-10', quantity: 3000, printers: [] },
    });
  });

  it('o nome atual é o da produção, mesmo quando o histórico (com os nomes antigos) entrou depois', () => {
    const later = [
      item({ description: 'Coleção Alice', status: 'producao' }),
      item({ description: 'Box Alice (2023)', status: 'entregue', arrivedAt: '2023-04-01' }),
      item({ description: 'Box Alice (2024)', status: 'entregue', arrivedAt: '2024-04-01' }),
    ];
    expect(productSummaries(later)[0]!.title).toBe('Coleção Alice');
    // Sem produção nem embarque: o da chegada mais recente, não o do último que entrou.
    expect(productSummaries([later[2]!, later[1]!])[0]!.title).toBe('Box Alice (2024)');
    // A caminho vale mais que o que já chegou.
    expect(productSummaries([item({ description: 'Alice a caminho', status: 'embarcado' }), later[2]!])[0]!.title).toBe('Alice a caminho');
  });

  it('produto só em produção não tem chegada; só no histórico, não tem produção nem embarque', () => {
    const all = productSummaries(ITEMS);
    expect(all.find((p) => p.productId === 'meditacoes')).toMatchObject({ production: { quantity: 30000, orders: ['PO-070'], nextShip: null }, atSea: { quantity: 0, nextEta: null }, lastArrival: null });
    expect(all.find((p) => p.productId === 'sem-isbn')).toMatchObject({ isbn: null, production: { quantity: 0, orders: [] }, atSea: { quantity: 0 }, lastArrival: { date: '2024-08-01', quantity: 800, printers: [] } });
  });
});

describe('busca do terminal', () => {
  const products = productSummaries(ITEMS);
  const ids = (q: string) => searchProducts(products, q).products.map((p) => p.productId);

  it('pelo ISBN inteiro, com ou sem hífens, ou por parte dele', () => {
    expect(ids(ALICE)).toEqual(['alice']);
    expect(ids('978-65-87817-675')).toEqual(['meditacoes']);
    expect(ids('6583970')).toEqual(['alice']);
    // "978" está nos dois ISBNs: o que está em produção ou a caminho vem antes, depois a chegada mais recente.
    expect(ids('978')).toEqual(['alice', 'meditacoes']);
  });

  it('pelo nome, sem acento nem maiúscula, com as palavras em qualquer ordem e em qualquer nome que o produto já teve', () => {
    expect(ids('meditacoes')).toEqual(['meditacoes']);
    expect(ids('MARAVILHAS alice')).toEqual(['alice']);
    expect(ids('aurelio marco')).toEqual(['meditacoes']);
    expect(ids('colorir')).toEqual(['sem-isbn']);
    expect(ids('alice xyz')).toEqual([]);
  });

  it('só números também procuram no nome', () => {
    expect(ids('1984')).toEqual(['1984']);
  });

  it('a palavra inteira vem antes do começo de outra palavra; o nome que começa com ela, antes de todos', () => {
    const more = productSummaries([
      ...ITEMS,
      item({ productId: 'artesanato', isbn: null, description: 'Artesanato fácil', status: 'entregue', arrivedAt: '2026-06-01' }),
      item({ productId: 'arte-viver', isbn: null, description: 'A Arte de Viver', status: 'entregue', arrivedAt: '2026-01-01' }),
      item({ productId: 'arte-guerra', isbn: null, description: 'Arte da Guerra', status: 'entregue', arrivedAt: '2020-01-01' }),
    ]);
    expect(searchProducts(more, 'arte').products.map((p) => p.productId)).toEqual(['arte-guerra', 'arte-viver', 'artesanato']);
  });

  it('menos de dois caracteres não busca; o total diz quantos bateram além dos mostrados', () => {
    expect(searchProducts(products, 'a')).toEqual({ products: [], total: 0 });
    const many = productSummaries(Array.from({ length: 12 }, (_, i) => item({ productId: `p${i}`, isbn: null, description: `Livro ${i}` })));
    const res = searchProducts(many, 'livro', 8);
    expect([res.products.length, res.total]).toEqual([8, 12]);
  });
});

// Produção no Brasil (27/11/2026): os pedidos nas gráficas, juntados ao produto pelo ISBN.
const brOrder = (over: Partial<BrOrderSummary>): BrOrderSummary => ({
  id: 'br-1',
  isbn: MEDITACOES,
  title: 'Meditações',
  printer: 'Assahi',
  quantity: 20000,
  orderedAt: '2026-11-20',
  dueAt: '2026-12-15',
  deliveries: [],
  ...over,
});

describe('a produção no Brasil no terminal', () => {
  it('junta ao produto pelo ISBN (o ISBN-10 também): o que falta entregar, as gráficas e a entrega mais próxima', () => {
    const orders = [
      brOrder({ deliveries: [{ deliveredAt: '2026-11-25', quantity: 5000, last: false }] }),
      brOrder({ id: 'br-2', printer: 'Grafilar', quantity: 3000, dueAt: '2026-12-08' }),
      // Entregue: não falta nada, mas a entrega conta na última chegada.
      brOrder({ id: 'br-3', quantity: 1000, dueAt: '2026-10-01', deliveries: [{ deliveredAt: '2026-10-02', quantity: 1000, last: false }] }),
    ];
    const meditacoes = productSummaries(ITEMS, orders).find((p) => p.productId === 'meditacoes')!;
    expect(meditacoes).toMatchObject({
      key: 'meditacoes',
      // O nome segue o da importação; o do pedido entra na busca.
      title: 'Meditações - Marco Aurélio',
      names: ['Meditações - Marco Aurélio', 'Meditações'],
      production: { quantity: 30000 },
      brazil: { quantity: 15000 + 3000, printers: ['Assahi', 'Grafilar'], nextDue: '2026-12-08' },
      lastArrival: { date: '2026-11-25', quantity: 5000, printers: ['Assahi'] },
    });
    // O ISBN-10 do pedido acha o produto com o ISBN-13.
    const old = productSummaries([item({ productId: 'antigo', isbn: '9788535902778', description: 'Livro antigo', status: 'entregue', arrivedAt: '2025-01-10' })], [
      brOrder({ isbn: '8535902775', title: 'Livro antigo' }),
    ]);
    expect(old).toHaveLength(1);
    expect(old[0]).toMatchObject({ productId: 'antigo', brazil: { quantity: 20000 } });
  });

  it('a entrega do Brasil e a chegada da importação no mesmo dia se somam; a mais recente vale', () => {
    const items = [item({ productId: 'm', isbn: MEDITACOES, description: 'Meditações', status: 'entregue', quantity: 2000, arrivedAt: '2026-11-25' })];
    const [same] = productSummaries(items, [brOrder({ deliveries: [{ deliveredAt: '2026-11-25', quantity: 500, last: false }] })]);
    expect(same!.lastArrival).toEqual({ date: '2026-11-25', quantity: 2500, printers: ['Assahi'] });
    const [older] = productSummaries(items, [brOrder({ deliveries: [{ deliveredAt: '2026-11-20', quantity: 500, last: false }] })]);
    expect(older!.lastArrival).toEqual({ date: '2026-11-25', quantity: 2000, printers: [] });
  });

  it('o que só tem pedidos no Brasil vira um produto à parte, sem ficha: pelo ISBN ou, sem ele, pelo nome', () => {
    const orders = [
      brOrder({ id: 'br-a', isbn: '9786561263023', title: 'Box Bluey', quantity: 2000 }),
      brOrder({ id: 'br-b', isbn: '9786561263023', title: 'Box Bluey - 2ª edição', quantity: 1000, dueAt: '2026-12-20' }),
      brOrder({ id: 'br-c', isbn: null, title: 'Marcador de Página', quantity: 10000, dueAt: null }),
      brOrder({ id: 'br-d', isbn: null, title: 'marcador de pagina', quantity: 5000, dueAt: null }),
    ];
    const brazilOnly = productSummaries([], orders);
    expect(brazilOnly).toEqual([
      {
        key: 'brasil:9786561263023',
        productId: null,
        isbn: '9786561263023',
        title: 'Box Bluey - 2ª edição',
        names: ['Box Bluey', 'Box Bluey - 2ª edição'],
        production: { quantity: 0, orders: [], nextShip: null },
        atSea: { quantity: 0, nextEta: null },
        brazil: { quantity: 3000, printers: ['Assahi'], nextDue: '2026-12-15' },
        lastArrival: null,
      },
      {
        key: 'brasil:marcador de pagina',
        productId: null,
        isbn: null,
        title: 'marcador de pagina',
        names: ['Marcador de Página', 'marcador de pagina'],
        production: { quantity: 0, orders: [], nextShip: null },
        atSea: { quantity: 0, nextEta: null },
        brazil: { quantity: 15000, printers: ['Assahi'], nextDue: null },
        lastArrival: null,
      },
    ]);
    // A busca acha pelo nome e pelo ISBN; o que está no Brasil conta como ativo no empate.
    expect(searchProducts(brazilOnly, 'bluey').products.map((p) => p.key)).toEqual(['brasil:9786561263023']);
    expect(searchProducts(brazilOnly, '978-65-612').products.map((p) => p.key)).toEqual(['brasil:9786561263023']);
    const tie = productSummaries([item({ productId: 'velho', isbn: '9786584956933', description: 'Box Bluey antigo', status: 'entregue', arrivedAt: '2026-11-01' })], [orders[0]!]);
    expect(searchProducts(tie, 'box bluey').products.map((p) => p.key)).toEqual(['brasil:9786561263023', 'velho']);
  });
});
