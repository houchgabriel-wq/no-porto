import { describe, expect, it } from 'vitest';
import { EMPTY_HISTORY_FILTERS, filterHistory, historyRows, NO_DATE, priceStats, purchaseDate, totalsByYear, type InvoiceInfo } from './history';
import type { Item } from './items';

const base: Item = {
  id: '',
  productId: 'p',
  isbn: null,
  description: '',
  supplierId: 's1',
  purchaseOrderId: null,
  invoiceId: null,
  status: 'entregue',
  quantity: 1000,
  piecesPerCarton: null,
  unitPriceMicros: 500_000,
  notes: '',
  createdAt: '2026-11-17T12:00:00Z',
  updatedAt: '2026-11-17T12:00:00Z',
};
const invoice = (id: string, arrivedAt: string | null, extra: Partial<InvoiceInfo> = {}): InvoiceInfo => ({ id, number: id.toUpperCase(), ref: '', supplierId: 's1', billId: null, billNumber: null, arrivedAt, notes: '', ...extra });
const invoices = [invoice('a', '2023-05-22', { ref: '23-1089' }), invoice('b', '2025-08-29', { billNumber: 'ROECHN25071889' }), invoice('c', null)];
const items: Item[] = [
  { ...base, id: '1', invoiceId: 'a', description: 'Escolinha Divertida - Alfabeto', isbn: '9786560950856' },
  { ...base, id: '2', invoiceId: 'b', description: 'Café com Aristóteles', supplierId: 's2', quantity: 2000, unitPriceMicros: 600_000 },
  { ...base, id: '3', invoiceId: 'c', description: 'Sem data' },
];
const suppliers = [
  { id: 's1', name: 'Sara' },
  { id: 's2', name: 'Claire' },
];

describe('histórico', () => {
  const rows = historyRows(items, invoices);

  it('ordena da chegada mais recente para a mais antiga, sem data no fim', () => {
    expect(rows.map((r) => [r.item.id, r.arrivedAt])).toEqual([
      ['2', '2025-08-29'],
      ['1', '2023-05-22'],
      ['3', null],
    ]);
  });

  it('busca por produto, ISBN, invoice, ref., BL e fornecedor, sem acento', () => {
    const find = (query: string) => filterHistory(rows, { ...EMPTY_HISTORY_FILTERS, query }, suppliers).map((r) => r.item.id);
    expect(find('cafe')).toEqual(['2']);
    expect(find('9786560950856')).toEqual(['1']);
    expect(find('23-1089')).toEqual(['1']);
    expect(find('roechn25071889')).toEqual(['2']);
    expect(find('claire')).toEqual(['2']);
  });

  it('filtra por ano de chegada, por "sem data" e por fornecedor', () => {
    const f = (over: object) => filterHistory(rows, { ...EMPTY_HISTORY_FILTERS, ...over }, suppliers).map((r) => r.item.id);
    expect(f({ year: '2023' })).toEqual(['1']);
    expect(f({ year: NO_DATE })).toEqual(['3']);
    expect(f({ supplierId: 's1' })).toEqual(['1', '3']);
  });

  it('totais por ano, com e sem valores', () => {
    expect(totalsByYear(rows, true)).toEqual([
      { year: '2025', items: 1, quantity: 2000, valueCents: 120_000 },
      { year: '2023', items: 1, quantity: 1000, valueCents: 50_000 },
      { year: NO_DATE, items: 1, quantity: 1000, valueCents: 50_000 },
    ]);
    expect(totalsByYear(rows, false)[0]).toEqual({ year: '2025', items: 1, quantity: 2000 });
  });
});

describe('ficha do produto', () => {
  it('preço: menor, maior, último e variação', () => {
    expect(priceStats([{ unitPriceMicros: 500_000 }, { unitPriceMicros: null }, { unitPriceMicros: 450_000 }, { unitPriceMicros: 575_000 }])).toEqual({
      count: 3,
      minMicros: 450_000,
      maxMicros: 575_000,
      lastMicros: 575_000,
      changePermille: 150,
    });
    expect(priceStats([{ unitPriceMicros: 500_000 }])!.changePermille).toBeNull();
    expect(priceStats([{}, { unitPriceMicros: null }])).toBeNull();
  });

  it('data da compra: chegada, previsão ou cadastro', () => {
    expect(purchaseDate(base, { arrivedAt: '2025-08-29' })).toBe('2025-08-29');
    expect(purchaseDate(base, { eta: '2026-12-10', arrivedAt: null })).toBe('2026-12-10');
    expect(purchaseDate(base, undefined)).toBe('2026-11-17');
  });
});
