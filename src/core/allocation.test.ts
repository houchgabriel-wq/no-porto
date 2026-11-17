import { describe, expect, it } from 'vitest';
import { allocateShipment, guessSupplier, productionQueue, sameProduct } from './allocation';
import type { Item } from './items';

const orders = [
  { id: 'o24', code: 'PO-024' },
  { id: 'o50', code: 'PO-050' },
  { id: 'o9', code: 'PO-009' },
];

function item(id: string, over: Partial<Item>): Item {
  return {
    id,
    productId: 'p',
    isbn: '9786583970527',
    description: 'Coleção Alice',
    supplierId: 'claire',
    purchaseOrderId: null,
    invoiceId: null,
    status: 'producao',
    quantity: 1000,
    piecesPerCarton: null,
    unitPriceMicros: 1_000_000,
    notes: '',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...over,
  };
}

describe('productionQueue', () => {
  it('só a produção do fornecedor, da PO mais antiga para a mais nova, sem PO no fim', () => {
    const items = [
      item('semPo', {}),
      item('po50', { purchaseOrderId: 'o50' }),
      item('sara', { purchaseOrderId: 'o9', supplierId: 'sara' }),
      item('po24b', { purchaseOrderId: 'o24', createdAt: '2026-03-01T00:00:00Z' }),
      item('po24a', { purchaseOrderId: 'o24' }),
      item('embarcado', { purchaseOrderId: 'o9', status: 'embarcado' }),
    ];
    expect(productionQueue(items, orders, 'claire').map((i) => i.id)).toEqual(['po24a', 'po24b', 'po50', 'semPo']);
  });
});

describe('sameProduct', () => {
  it('pelo ISBN; sem ISBN, pelo nome sem acento', () => {
    expect(sameProduct({ isbn: '9786583970527', description: 'Outro nome' }, { isbn: '9786583970527', description: 'Coleção Alice' })).toBe(true);
    expect(sameProduct({ isbn: '9786583970213', description: 'Coleção Alice' }, { isbn: '9786583970527', description: 'Coleção Alice' })).toBe(false);
    expect(sameProduct({ isbn: null, description: 'colecao  alice' }, { isbn: '9786583970527', description: 'Coleção Alice' })).toBe(true);
  });
});

describe('allocateShipment', () => {
  const items = [item('novo', { purchaseOrderId: 'o50', quantity: 5000 }), item('velho', { purchaseOrderId: 'o24', quantity: 3000 }), item('sara', { supplierId: 'sara', quantity: 9000 })];

  it('tira primeiro da PO mais antiga e o resto da seguinte, em parte', () => {
    const [a] = allocateShipment([{ isbn: '9786583970527', description: 'Alice', quantity: 4000 }], items, orders, 'claire');
    expect(a).toEqual({
      takes: [
        { itemId: 'velho', quantity: 3000, whole: true },
        { itemId: 'novo', quantity: 1000, whole: false },
      ],
      extra: 0,
    });
  });

  it('nunca tira de outro fornecedor; o que falta fica como extra', () => {
    const [a] = allocateShipment([{ isbn: '9786583970527', description: 'Alice', quantity: 10000 }], items, orders, 'claire');
    expect(a!.takes.map((t) => t.itemId)).toEqual(['velho', 'novo']);
    expect(a!.extra).toBe(2000);
  });

  it('duas linhas do mesmo produto consomem em sequência; a que termina o item leva o item', () => {
    const lines = [
      { isbn: '9786583970527', description: 'Alice', quantity: 1000 },
      { isbn: '9786583970527', description: 'Alice', quantity: 2000 },
    ];
    const [a, b] = allocateShipment(lines, items, orders, 'claire');
    expect(a!.takes).toEqual([{ itemId: 'velho', quantity: 1000, whole: false }]);
    expect(b!.takes).toEqual([{ itemId: 'velho', quantity: 2000, whole: true }]);
  });

  it('produto que não está na produção é todo extra', () => {
    const [a] = allocateShipment([{ isbn: '9786583970213', description: 'A Odisseia', quantity: 500 }], items, orders, 'claire');
    expect(a).toEqual({ takes: [], extra: 500 });
  });
});

describe('guessSupplier', () => {
  const suppliers = [
    { id: 'claire', name: 'Claire' },
    { id: 'sara', name: 'Sara' },
    { id: 'nicola', name: 'Nicola' },
  ];
  const items = [item('a', { supplierId: 'claire', quantity: 100 }), item('b', { supplierId: 'nicola', quantity: 5000 })];
  const lines = [{ isbn: '9786583970527', description: 'Alice', quantity: 3000 }];

  it('pelo nome no cabeçalho do arquivo', () => {
    expect(guessSupplier(lines, 'From: Guangzhou Miyi Printing /Claire & ivy', items, suppliers)).toBe('claire');
  });
  it('sem nome, pelo fornecedor com mais desses produtos em produção', () => {
    expect(guessSupplier(lines, 'HUNAN SPLENDID CULTURE', items, suppliers)).toBe('nicola');
    expect(guessSupplier([{ isbn: null, description: 'Nada', quantity: 1 }], 'x', items, suppliers)).toBeNull();
  });
});
