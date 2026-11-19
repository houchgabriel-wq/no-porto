import { describe, expect, it } from 'vitest';
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
      productId: 'alice',
      isbn: ALICE,
      title: 'Coleção Alice (nova capa)',
      names: ['Box Coleção Alice no País das Maravilhas', 'Coleção Alice', 'Coleção Alice (nova capa)'],
      production: { quantity: 7000, orders: ['PO-056', 'PO-070'], nextShip: '2026-12' },
      atSea: { quantity: 4000, nextEta: '2026-12-05' },
      // Duas invoices chegaram no mesmo dia: a quantidade é a soma; o item sem data não conta.
      lastArrival: { date: '2026-03-10', quantity: 3000 },
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
    expect(all.find((p) => p.productId === 'sem-isbn')).toMatchObject({ isbn: null, production: { quantity: 0, orders: [] }, atSea: { quantity: 0 }, lastArrival: { date: '2024-08-01', quantity: 800 } });
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
