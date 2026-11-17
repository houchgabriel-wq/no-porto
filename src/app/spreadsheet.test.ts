import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { readSheets, readWorkbook } from './spreadsheet';

/** Uma planilha no formato do Excel antigo (.xls), como a packing list da Claire. */
function legacyXls(): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      ['PACKING LIST'],
      ['ITEM', 'Qty per Ctn', 'Total Qty per title', 'Data'],
      ['Coleção Alice\n978-65-83970-52-7', 22, 9878, new Date(2026, 9, 30)],
      ['Preço', 0.1 + 0.2, 1e15, ''],
    ]),
    'PL',
  );
  const out = XLSX.write(wb, { type: 'array', bookType: 'biff8' }) as ArrayBuffer;
  return out;
}

describe('leitura de .xls (Excel antigo)', () => {
  it('lê as abas como texto, com datas em dia/mês/ano e números sem restos de ponto flutuante', async () => {
    const [sheet] = await readWorkbook(legacyXls());
    expect(sheet!.name).toBe('PL');
    expect(sheet!.rows.slice(0, 4).map((r) => r.slice(0, 4))).toEqual([
      ['PACKING LIST', '', '', ''],
      ['ITEM', 'Qty per Ctn', 'Total Qty per title', 'Data'],
      ['Coleção Alice\n978-65-83970-52-7', '22', '9878', '30/10/2026'],
      ['Preço', '0.3', '1000000000000000', ''],
    ]);
  });

  it('a carga acha a aba pelo nome também no .xls', async () => {
    const { sheets, names } = await readSheets(legacyXls(), ['PL', 'Produção']);
    expect(names).toEqual(['PL']);
    expect(sheets.PL?.[1]?.[0]).toBe('ITEM');
    expect(sheets['Produção']).toBeNull();
  });
});
