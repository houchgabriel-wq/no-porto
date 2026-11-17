import { describe, expect, it } from 'vitest';
import {
  EMPTY_FILTERS,
  filterItems,
  itemForViewer,
  normalizeOrderCode,
  orderOwners,
  orderSupplierProblem,
  searchKey,
  sortItems,
  totals,
  totalsByOrder,
  totalsBySupplier,
  type Item,
} from './items';

const suppliers = [
  { id: 's1', name: 'Sara' },
  { id: 's2', name: 'Claire' },
];
const orders = [
  { id: 'o9', code: 'PO-009', orderedAt: null, notes: '' },
  { id: 'o63', code: 'PO-063', orderedAt: null, notes: '' },
];

function item(over: Partial<Item>): Item {
  return {
    id: Math.random().toString(36).slice(2),
    productId: 'p',
    isbn: null,
    description: 'Livro',
    supplierId: 's1',
    purchaseOrderId: 'o63',
    invoiceId: null,
    status: 'producao',
    quantity: 1000,
    piecesPerCarton: null,
    unitPriceMicros: 500_000,
    notes: '',
    createdAt: '2026-11-17T12:00:00Z',
    updatedAt: '2026-11-17T12:00:00Z',
    ...over,
  };
}

const items = [
  item({ description: 'Cartilha Mágica 01 - Alfabeto', isbn: '9786561267106', quantity: 9440, unitPriceMicros: 330_000 }),
  item({ description: 'Café com Aristóteles', supplierId: 's2', quantity: 6000, unitPriceMicros: 575_000 }),
  item({ description: 'Por que uma Filha precisa de uma Mãe 01', purchaseOrderId: 'o9', quantity: 5000, unitPriceMicros: null }),
  item({ description: 'Patrulha Canina Brincando de Banho', supplierId: null, purchaseOrderId: null, quantity: 8000, unitPriceMicros: null, notes: 'ISBN informado: TBC' }),
];

describe('o leitor não vê valores', () => {
  it('tira preço e total do item', () => {
    const shown = itemForViewer(items[0]!, false);
    expect(shown).not.toHaveProperty('unitPriceMicros');
    expect(shown).not.toHaveProperty('totalCents');
    expect(shown.quantity).toBe(9440);
  });

  it('quem vê valores recebe o total calculado', () => {
    expect(itemForViewer(items[0]!, true).totalCents).toBe(311_520);
    expect(itemForViewer(items[2]!, true).totalCents).toBeNull();
  });

  it('nos totais, o leitor só vê itens e exemplares', () => {
    const forReader = items.map((i) => itemForViewer(i, false));
    expect(totals(forReader, false)).toEqual({ items: 4, quantity: 28_440, unpriced: 0 });
  });
});

describe('totais', () => {
  it('somam os itens com preço e contam os sem preço à parte', () => {
    expect(totals(items, true)).toEqual({ items: 4, quantity: 28_440, valueCents: 311_520 + 345_000, unpriced: 2 });
  });

  it('por fornecedor, do maior valor para o menor, com "Sem fornecedor"', () => {
    const rows = totalsBySupplier(items, suppliers, true);
    expect(rows.map((r) => [r.name, r.valueCents, r.unpriced])).toEqual([
      ['Claire', 345_000, 0],
      ['Sara', 311_520, 1],
      ['Sem fornecedor', 0, 1],
    ]);
  });

  it('por fornecedor, para o leitor, pelos exemplares', () => {
    const rows = totalsBySupplier(items.map((i) => itemForViewer(i, false)), suppliers, false);
    expect(rows.map((r) => [r.name, r.quantity])).toEqual([
      ['Sara', 14_440],
      ['Sem fornecedor', 8000],
      ['Claire', 6000],
    ]);
    expect(rows[0]).not.toHaveProperty('valueCents');
  });

  it('por PO, da mais nova para a mais antiga, com "Sem PO" no fim e os fornecedores de cada uma', () => {
    const rows = totalsByOrder(items, orders, suppliers, true);
    expect(rows.map((r) => [r.code, r.items, r.suppliers])).toEqual([
      ['PO-063', 2, ['Claire', 'Sara']],
      ['PO-009', 1, ['Sara']],
      ['Sem PO', 1, ['Sem fornecedor']],
    ]);
  });
});

describe('busca e filtros', () => {
  const find = (f: Partial<typeof EMPTY_FILTERS>) => filterItems(items, { ...EMPTY_FILTERS, ...f }, orders, suppliers).map((i) => i.description);

  it('acha sem acento, por palavras, em produto, ISBN, PO, fornecedor e observações', () => {
    expect(find({ query: 'cafe aristoteles' })).toEqual(['Café com Aristóteles']);
    expect(find({ query: '9786561267106' })).toEqual(['Cartilha Mágica 01 - Alfabeto']);
    expect(find({ query: 'po-009' })).toEqual(['Por que uma Filha precisa de uma Mãe 01']);
    expect(find({ query: 'claire' })).toEqual(['Café com Aristóteles']);
    expect(find({ query: 'tbc' })).toEqual(['Patrulha Canina Brincando de Banho']);
    expect(find({ query: 'sem po' })).toEqual(['Patrulha Canina Brincando de Banho']);
  });

  it('filtra por fornecedor e por PO, inclusive os sem', () => {
    expect(find({ supplierId: 's2' })).toEqual(['Café com Aristóteles']);
    expect(find({ supplierId: 'sem' })).toEqual(['Patrulha Canina Brincando de Banho']);
    expect(find({ orderId: 'o9' })).toEqual(['Por que uma Filha precisa de uma Mãe 01']);
    expect(find({ orderId: 'sem', supplierId: 's1' })).toEqual([]);
  });
});

describe('códigos e textos', () => {
  it('código de PO no formato da editora', () => {
    expect(normalizeOrderCode('PO-063')).toBe('PO-063');
    expect(normalizeOrderCode('po 63')).toBe('PO-063');
    expect(normalizeOrderCode('PO-1234')).toBe('PO-1234');
    expect(normalizeOrderCode('6k dec + 6k apr')).toBeNull();
    expect(normalizeOrderCode('')).toBeNull();
  });

  it('chave de busca sem acento e sem espaço sobrando', () => {
    expect(searchKey('  Livro   Alice no País das\nMaravilhas ')).toBe('livro alice no pais das maravilhas');
  });
});

describe('ordenação da tabela', () => {
  it('por total, do maior para o menor, com os sem preço no fim', () => {
    const sorted = sortItems(items, { key: 'total', dir: -1 }, orders, suppliers).map((i) => i.description);
    expect(sorted.slice(0, 2)).toEqual(['Café com Aristóteles', 'Cartilha Mágica 01 - Alfabeto']);
    expect(sorted.slice(2).every((d) => d.startsWith('Por que') || d.startsWith('Patrulha'))).toBe(true);
  });

  it('por PO em ordem natural, com "Sem PO" no fim nos dois sentidos', () => {
    const up = sortItems(items, { key: 'order', dir: 1 }, orders, suppliers);
    const down = sortItems(items, { key: 'order', dir: -1 }, orders, suppliers);
    expect(up[0]!.purchaseOrderId).toBe('o9');
    expect(up.at(-1)!.purchaseOrderId).toBeNull();
    expect(down[0]!.purchaseOrderId).toBe('o63');
    expect(down.at(-1)!.purchaseOrderId).toBeNull();
  });

  it('por produto, sem acento', () => {
    const sorted = sortItems(items, { key: 'description', dir: 1 }, orders, suppliers).map((i) => i.description[0]);
    expect(sorted).toEqual(['C', 'C', 'P', 'P']);
  });
});

describe('uma PO, um fornecedor', () => {
  it('o dono da PO é o fornecedor com mais itens; no empate, o primeiro', () => {
    const owners = orderOwners([
      { order: 'PO-063', supplier: 'Claire' },
      { order: 'PO-063', supplier: 'Sara' },
      { order: 'PO-063', supplier: 'Sara' },
      { order: 'PO-067', supplier: 'Sara' },
      { order: 'PO-067', supplier: 'Nicola' },
      { order: 'PO-070', supplier: null },
      { order: null, supplier: 'Sara' },
    ]);
    expect([...owners]).toEqual([
      ['PO-063', 'Sara'],
      ['PO-067', 'Sara'],
    ]);
  });

  it('recusa item de outro fornecedor na PO', () => {
    const sara = { id: 's1', name: 'Sara' };
    const claire = { id: 's2', name: 'Claire' };
    expect(orderSupplierProblem('PO-063', claire, [sara, sara])).toBe('A PO-063 é de Sara. Uma PO tem um fornecedor só: use outra PO para o item de Claire.');
    expect(orderSupplierProblem('PO-063', sara, [sara])).toBeNull();
    expect(orderSupplierProblem('PO-063', sara, [])).toBeNull();
    // Item sem fornecedor não briga com ninguém.
    expect(orderSupplierProblem('PO-063', null, [sara])).toBeNull();
  });
});
