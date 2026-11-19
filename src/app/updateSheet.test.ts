// Ida e volta do "Atualizar pela planilha": a lista gerada pelo "Baixar .xlsx" da Produção é mudada como
// a pessoa muda no Excel (data digitada vira data; "mar/2027" digitado também) e lida de novo.

import { describe, expect, it } from 'vitest';
import type { Workbook } from 'exceljs';
import { itemExportRows, productionExportColumns } from '../core/exportItems';
import type { Item } from '../core/items';
import { ITEM_CODE_HEADER, parseUpdateRows } from '../core/updateSheet';
import { buildExport, readSheetRows } from './spreadsheet';

const base: Item = {
  id: '',
  productId: 'p',
  isbn: null,
  description: '',
  supplierId: 's1',
  purchaseOrderId: 'o1',
  invoiceId: null,
  status: 'producao',
  quantity: 1000,
  piecesPerCarton: null,
  unitPriceMicros: 500_000,
  notes: '',
  fileApprovedAt: null,
  shipPlan: [],
  createdAt: '2026-11-17T12:00:00Z',
  updatedAt: '2026-11-17T12:00:00Z',
};

const items: Item[] = [
  { ...base, id: 'cafe', description: 'Livro Café com Aristóteles', isbn: '9786560950856', quantity: 60_000, unitPriceMicros: 575_000, shipPlan: [{ month: '2026-12', quantity: 20_000 }], notes: 'Capa dura' },
  { ...base, id: 'alice', description: 'Coleção Alice', isbn: '9786583970527', quantity: 8_000, unitPriceMicros: 1_750_000 },
  { ...base, id: 'sara', description: 'Livro da Sara', purchaseOrderId: null, fileApprovedAt: '2026-10-02' },
  { ...base, id: 'igual', description: 'Box Machado de Assis', notes: 'Linha 1\nLinha 2', shipPlan: [{ month: '2027-01', quantity: 400 }] },
];
const orders = [{ id: 'o1', code: 'PO-063', orderedAt: null, notes: '' }];

async function workbook(buffer: ArrayBuffer): Promise<Workbook> {
  const mod = await import('exceljs');
  const ExcelJS = (mod as unknown as { default?: typeof mod }).default ?? mod;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  return wb;
}

describe('atualizar pela planilha, com um .xlsx de verdade', () => {
  it('lê só o que foi mudado no Excel', async () => {
    const downloaded = await buildExport('Produção', productionExportColumns(true), itemExportRows(items, orders, [{ id: 's1', name: 'Sara' }], true));
    const wb = await workbook(downloaded);
    const sheet = wb.getWorksheet('Produção')!;
    const header = (sheet.getRow(1).values as unknown[]).map((v) => String(v ?? ''));
    const col = (name: string) => header.indexOf(name);
    // O código vai no fim, em cinza.
    expect(header.at(-1)).toBe(ITEM_CODE_HEADER);
    expect(sheet.getCell(2, col(ITEM_CODE_HEADER)).font?.color?.argb).toBe('FF8A8F98');

    // Linha 2 (Café): a aprovação digitada como data. Linha 3 (Alice): "mar/2027" digitado, que o Excel
    // guarda como data, e a quantidade mudada. Linha 4 (Sara): observações em duas linhas.
    sheet.getCell(2, col('Aprovação do arquivo')).value = new Date(Date.UTC(2026, 11, 5));
    sheet.getCell(3, col('Programação de envio')).value = new Date(Date.UTC(2027, 2, 1));
    sheet.getCell(3, col('Quantidade')).value = 9000;
    sheet.getCell(4, col('Observações')).value = 'Esperar a prova\nde cor';
    const uploaded = (await wb.xlsx.writeBuffer()) as ArrayBuffer;

    const read = await readSheetRows(uploaded, 'Produção');
    if ('missing' in read) throw new Error('sem a aba Produção');
    const report = parseUpdateRows(read.rows, items, orders);
    if ('error' in report) throw new Error(report.error);

    expect(report.problems).toEqual([]);
    expect(report.unchanged).toBe(1);
    expect(report.updates.map((u) => [u.id, u.patch])).toEqual([
      ['cafe', { fileApprovedAt: '2026-12-05' }],
      ['alice', { shipPlan: [{ month: '2027-03', quantity: 8_000 }] }],
      ['sara', { notes: 'Esperar a prova\nde cor' }],
    ]);
    expect(report.updates[1]!.changes).toEqual([{ field: 'shipPlan', from: '', to: 'mar/2027: 8.000' }]);
    expect(report.warnings).toEqual([
      { row: 3, message: '"Coleção Alice": a quantidade da planilha (9.000) não é a do app (8.000). Quantidade e preço só mudam na ficha do item.' },
    ]);
  });

  it('a lista baixada por quem não vê valores também volta', async () => {
    const downloaded = await buildExport('Produção', productionExportColumns(false), itemExportRows(items, orders, [], false));
    const read = await readSheetRows(downloaded, 'Produção');
    if ('missing' in read) throw new Error('sem a aba Produção');
    const report = parseUpdateRows(read.rows, items, orders);
    expect(report).toMatchObject({ updates: [], problems: [], warnings: [], unchanged: 4 });
  });
});
