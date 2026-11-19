// Ida e volta da cópia completa: a planilha gerada é lida de novo pela carga do próprio sistema.

import { describe, expect, it } from 'vitest';
import { copySheets, DELIVERED_HEADER, PRODUCTION_HEADER, SHIPMENTS_HEADER } from '../core/fullCopy';
import { parseHistoryRows } from '../core/importHistory';
import { parseProductionRows } from '../core/importProduction';
import { parseShipmentRows } from '../core/importShipments';
import type { Item } from '../core/items';
import { buildSheets, readSheetRows } from './spreadsheet';

const base: Item = {
  id: '',
  productId: 'p',
  isbn: null,
  description: '',
  supplierId: 's1',
  purchaseOrderId: null,
  invoiceId: null,
  status: 'producao',
  quantity: 1000,
  piecesPerCarton: null,
  unitPriceMicros: 500_000,
  notes: '',
  createdAt: '2026-11-17T12:00:00Z',
  updatedAt: '2026-11-17T12:00:00Z',
};

const input = {
  suppliers: [
    { id: 's1', name: 'Sara' },
    { id: 's2', name: 'Kaushik' },
  ],
  orders: [{ id: 'o1', code: 'PO-063', orderedAt: null, notes: '' }],
  bills: [{ id: 'b1', number: 'ROECHN26093881', eta: '2026-11-20', arrivedAt: null, notes: '' }],
  invoices: [
    { id: 'v1', number: '2026-46A', ref: '2026-09-25 (1)', supplierId: 's1', billId: 'b1', eta: null, arrivedAt: null, notes: '' },
    { id: 'v2', number: '108', ref: '', supplierId: 's2', billId: null, eta: '2026-11-21', arrivedAt: null, notes: '' },
    { id: 'v3', number: '23-1089', ref: '23-1089', supplierId: 's1', billId: null, eta: null, arrivedAt: '2023-05-22', notes: 'Chegada na planilha: "Chegada dia 22/05"' },
  ],
  payments: [
    { id: 'p1', invoiceId: 'v1', paidAt: null, amountCents: null, exchangeRateE4: null, notes: '' },
    { id: 'p3', invoiceId: 'v3', paidAt: null, amountCents: null, exchangeRateE4: null, notes: '' },
  ],
  items: [
    {
      ...base,
      id: '1',
      description: 'Livro Café com Aristóteles',
      isbn: '9786560950856',
      purchaseOrderId: 'o1',
      quantity: 6000,
      unitPriceMicros: 575_000,
      piecesPerCarton: 40,
      specification: '15,1x23cm\ncapa dura, hot stamping',
      fileApprovedAt: '2026-10-02',
      shipPlan: [
        { month: '2026-12', quantity: 3_000 },
        { month: '2027-02', quantity: 3_000 },
      ],
    },
    { ...base, id: '2', description: 'Sem preço', unitPriceMicros: null },
    { ...base, id: '3', description: 'Cartilha Mágica 01', status: 'embarcado' as const, invoiceId: 'v1', quantity: 9440, unitPriceMicros: 330_000, specification: '20,5x27,5 wire-o', fileApprovedAt: '2026-08-15', shipPlan: [{ month: '2026-09', quantity: 9440 }] },
    { ...base, id: '4', description: 'Livro do Kaushik', supplierId: 's2', status: 'embarcado' as const, invoiceId: 'v2', quantity: 2000, unitPriceMicros: 400_000 },
    { ...base, id: '5', description: 'Escolinha Divertida', status: 'entregue' as const, invoiceId: 'v3', quantity: 10000, unitPriceMicros: 750_000, specification: 'Board book 6 títulos', fileApprovedAt: '2023-03-01' },
  ],
};

async function roundTrip(sheet: string, header: string[], rows: ReturnType<typeof copySheets>['production']) {
  const buf = await buildSheets([{ name: sheet, header, rows }]);
  const res = await readSheetRows(buf, sheet);
  if ('missing' in res) throw new Error('aba faltando');
  return res.rows;
}

describe('cópia completa', () => {
  const sheets = copySheets(input);

  it('separa produção, embarques e entregues', () => {
    expect([sheets.production.length, sheets.shipments.length, sheets.delivered.length]).toEqual([2, 2, 1]);
    expect(sheets.shipments[0]).toEqual(['2026-09-25 (1)', 'Cartilha Mágica 01', null, null, 9440, 0.33, 3115.2, 'Sara', { date: '2026-11-20' }, 'Pago', '2026-46A', 'ROECHN26093881', null, '20,5x27,5 wire-o', { date: '2026-08-15' }, 'set/2026: 9.440']);
    expect(sheets.shipments[1]![9]).toBe('A pagar');
  });

  it('a aba Produção volta pela carga, com PO, ISBN e preço', async () => {
    const r = parseProductionRows(await roundTrip('Produção', PRODUCTION_HEADER, sheets.production));
    if ('error' in r) throw new Error(r.error);
    expect(r.items.map((i) => [i.description, i.isbn, i.orderCode, i.quantity, i.unitPriceMicros, i.piecesPerCarton])).toEqual([
      ['Livro Café com Aristóteles', '9786560950856', 'PO-063', 6000, 575_000, 40],
      ['Sem preço', null, null, 1000, null, null],
    ]);
  });

  it('a aba Embarques volta com invoice, BL, chegada e pagamento', async () => {
    const r = parseShipmentRows(await roundTrip('Embarques', SHIPMENTS_HEADER, sheets.shipments));
    if ('error' in r) throw new Error(r.error);
    expect(r.items.map((i) => [i.invoice, i.ref, i.bill, i.eta, i.paid, i.unitPriceMicros])).toEqual([
      ['2026-46A', '2026-09-25 (1)', 'ROECHN26093881', '2026-11-20', true, 330_000],
      ['108', '108', null, '2026-11-21', false, 400_000],
    ]);
  });

  it('a aba Entregues volta com a data de chegada completa', async () => {
    const r = parseHistoryRows(await roundTrip('Entregues', DELIVERED_HEADER, sheets.delivered), '2026-11-17');
    if ('error' in r) throw new Error(r.error);
    expect(r.items.map((i) => [i.invoice, i.arrivedAt, i.paid, i.quantity])).toEqual([['23-1089', '2023-05-22', true, 10000]]);
  });

  it('a especificação vai na última coluna e volta pela carga nas três abas, com as quebras de linha', async () => {
    const prod = parseProductionRows(await roundTrip('Produção', PRODUCTION_HEADER, sheets.production));
    const ship = parseShipmentRows(await roundTrip('Embarques', SHIPMENTS_HEADER, sheets.shipments));
    const hist = parseHistoryRows(await roundTrip('Entregues', DELIVERED_HEADER, sheets.delivered), '2026-11-18');
    if ('error' in prod || 'error' in ship || 'error' in hist) throw new Error('carga falhou');
    expect(prod.items.map((i) => i.specification)).toEqual(['15,1x23cm\ncapa dura, hot stamping', '']);
    expect(ship.items.map((i) => i.specification)).toEqual(['20,5x27,5 wire-o', '']);
    expect(hist.items.map((i) => i.specification)).toEqual(['Board book 6 títulos']);
  });

  it('a aprovação do arquivo e a programação de envio vão no fim e voltam pela carga nas três abas', async () => {
    const prod = parseProductionRows(await roundTrip('Produção', PRODUCTION_HEADER, sheets.production));
    const ship = parseShipmentRows(await roundTrip('Embarques', SHIPMENTS_HEADER, sheets.shipments));
    const hist = parseHistoryRows(await roundTrip('Entregues', DELIVERED_HEADER, sheets.delivered), '2026-11-18');
    if ('error' in prod || 'error' in ship || 'error' in hist) throw new Error('carga falhou');
    expect(prod.items.map((i) => [i.fileApprovedAt, i.shipPlan])).toEqual([
      [
        '2026-10-02',
        [
          { month: '2026-12', quantity: 3_000 },
          { month: '2027-02', quantity: 3_000 },
        ],
      ],
      [null, []],
    ]);
    expect(ship.items.map((i) => [i.fileApprovedAt, i.shipPlan])).toEqual([
      ['2026-08-15', [{ month: '2026-09', quantity: 9440 }]],
      [null, []],
    ]);
    expect(hist.items.map((i) => [i.fileApprovedAt, i.shipPlan])).toEqual([['2023-03-01', []]]);
  });
});
