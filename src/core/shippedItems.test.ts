import { describe, expect, it } from 'vitest';
import type { Item } from './items';
import type { Bill, Invoice } from './shipments';
import { filterShipped, groupShipped, invoicePayments, onlyShipped, shippedRows, sortShipped, EMPTY_SHIPPED_FILTERS } from './shippedItems';

const today = '2026-11-17';
const bills: Bill[] = [
  { id: 'b1', number: 'ROECHN1', eta: '2026-11-12', arrivedAt: null, notes: '' },
  { id: 'b2', number: 'ROECHN2', eta: '2026-11-26', arrivedAt: null, notes: '' },
];
const invoices: Invoice[] = [
  { id: 'v1', number: '2026-46A', ref: '55th', supplierId: 'sara', billId: 'b2', eta: null, arrivedAt: null, notes: '' },
  { id: 'v2', number: '2026-46B', ref: '', supplierId: 'sara', billId: 'b2', eta: null, arrivedAt: null, notes: '' },
  { id: 'v3', number: 'TW1', ref: '', supplierId: 'sally', billId: 'b1', eta: null, arrivedAt: null, notes: '' },
  { id: 'v4', number: '108', ref: '', supplierId: 'kaushik', billId: null, eta: null, arrivedAt: null, notes: '' },
];
const suppliers = [
  { id: 'sara', name: 'Sara' },
  { id: 'sally', name: 'Sally' },
  { id: 'kaushik', name: 'Kaushik' },
];

function item(id: string, invoiceId: string | null, over: Partial<Item> = {}): Item {
  return {
    id,
    productId: 'p',
    isbn: null,
    description: `Livro ${id}`,
    supplierId: invoices.find((v) => v.id === invoiceId)?.supplierId ?? 'sara',
    purchaseOrderId: null,
    invoiceId,
    status: invoiceId ? 'embarcado' : 'producao',
    quantity: 1000,
    piecesPerCarton: null,
    unitPriceMicros: 500_000,
    notes: '',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...over,
  };
}

const items = [item('a', 'v1', { quantity: 3000 }), item('b', 'v2'), item('c', 'v3', { unitPriceMicros: null }), item('d', 'v4', { quantity: 500 }), item('e', null), item('f', 'v1', { status: 'entregue' })];
const rows = shippedRows(items, invoices, bills, today);

describe('shippedRows', () => {
  it('só os embarcados, com o embarque e a chegada de cada um', () => {
    expect(rows.map((r) => [r.item.id, r.unitLabel, r.eta, r.state.kind])).toEqual([
      ['a', 'BL ROECHN2', '2026-11-26', 'previsto'],
      ['b', 'BL ROECHN2', '2026-11-26', 'previsto'],
      ['c', 'BL ROECHN1', '2026-11-12', 'liberacao'],
      ['d', 'Invoice 108', null, 'sem_previsao'],
    ]);
  });
});

describe('filterShipped', () => {
  it('busca por invoice, ref. e BL, e filtra por fornecedor e embarque', () => {
    const f = (over: object) => filterShipped(rows, { ...EMPTY_SHIPPED_FILTERS, ...over }, [], suppliers).map((r) => r.item.id);
    expect(f({ query: '46b' })).toEqual(['b']);
    expect(f({ query: '55TH' })).toEqual(['a']);
    expect(f({ query: 'roechn1' })).toEqual(['c']);
    expect(f({ supplierId: 'sara' })).toEqual(['a', 'b']);
    expect(f({ unitKey: 'inv:v4' })).toEqual(['d']);
  });
});

describe('sortShipped', () => {
  it('por chegada, sem previsão no fim nos dois sentidos', () => {
    expect(sortShipped(rows, { key: 'arrival', dir: 1 }, suppliers).map((r) => r.item.id)).toEqual(['c', 'a', 'b', 'd']);
    expect(sortShipped(rows, { key: 'arrival', dir: -1 }, suppliers).map((r) => r.item.id)).toEqual(['a', 'b', 'c', 'd']);
  });
  it('por total, sem preço no fim', () => {
    expect(sortShipped(rows, { key: 'total', dir: -1 }, suppliers).map((r) => r.item.id)).toEqual(['a', 'b', 'd', 'c']);
  });
});

describe('groupShipped', () => {
  it('um grupo por embarque, em liberação primeiro, com os totais', () => {
    const groups = groupShipped(rows, bills, invoices, suppliers, today, true);
    expect(groups.map((g) => [g.label, g.items, g.quantity, g.valueCents, g.invoices.map((v) => v.number), g.suppliers])).toEqual([
      ['BL ROECHN1', 1, 1000, 0, ['TW1'], ['Sally']],
      ['BL ROECHN2', 2, 4000, 200_000, ['2026-46A', '2026-46B'], ['Sara']],
      ['Invoice 108', 1, 500, 25_000, ['108'], ['Kaushik']],
    ]);
  });
});

describe('pagamento das invoices', () => {
  const payments = [
    { id: 'p1', invoiceId: 'v1', paidAt: null, amountCents: null, exchangeRateE4: null, notes: 'Pago, segundo a planilha' },
    { id: 'p2', invoiceId: 'v2', paidAt: '2026-11-01', amountCents: 20_000, exchangeRateE4: 55_000, notes: '' },
  ];
  it('a situação de cada invoice; nada para quem não vê valores', () => {
    const map = invoicePayments(invoices, items, payments, true);
    expect([...map].map(([id, p]) => [id, p.status])).toEqual([
      ['v1', 'pago'],
      ['v2', 'parcial'],
      ['v3', 'a_pagar'],
      ['v4', 'a_pagar'],
    ]);
    expect(invoicePayments(invoices, items, payments, false).size).toBe(0);
  });
  it('filtra pela situação de pagamento', () => {
    const map = invoicePayments(invoices, items, payments, true);
    const f = (payment: 'pago' | 'parcial' | 'a_pagar') => filterShipped(rows, { ...EMPTY_SHIPPED_FILTERS, payment }, [], suppliers, map).map((r) => r.item.id);
    expect(f('pago')).toEqual(['a']);
    expect(f('parcial')).toEqual(['b']);
    expect(f('a_pagar')).toEqual(['c', 'd']);
  });
});

describe('onlyShipped', () => {
  it('só o que está no mar, com as invoices, os BLs, as POs e os fornecedores desses itens', () => {
    const orders = [
      { id: 'o1', code: 'PO-001', orderedAt: null, notes: '' },
      { id: 'o2', code: 'PO-002', orderedAt: null, notes: '' },
    ];
    const data = {
      items: [item('a', 'v1', { purchaseOrderId: 'o1' }), item('e', null, { purchaseOrderId: 'o2', supplierId: 'outro' }), item('f', 'v3', { status: 'entregue' })],
      invoices,
      bills,
      orders,
      suppliers: [...suppliers, { id: 'outro', name: 'Outro' }],
      seeValues: false,
    };
    const view = onlyShipped(data);
    expect(view.items.map((i) => i.id)).toEqual(['a']);
    expect(view.invoices.map((v) => v.id)).toEqual(['v1']);
    expect(view.bills.map((b) => b.id)).toEqual(['b2']);
    expect(view.orders.map((o) => o.code)).toEqual(['PO-001']);
    expect(view.suppliers.map((s) => s.name)).toEqual(['Sara']);
    expect(view.seeValues).toBe(false);
  });
});
