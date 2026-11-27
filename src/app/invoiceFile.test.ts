// A invoice guardada com os nomes novos (27/11/2026): só as células dos nomes mudam; o resto do pacote fica igual.
import type { Workbook } from 'exceljs';
import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { invoiceWithNames } from './invoiceFile';

async function workbook(): Promise<Workbook> {
  const mod = await import('exceljs');
  const ExcelJS = (mod as unknown as { default?: typeof mod }).default ?? mod;
  return new ExcelJS.Workbook();
}

/** Uma invoice como a da Claire: título mesclado, nomes em negrito com borda, ISBN, preço e fórmula; e a aba da packing list. */
async function invoiceFile(): Promise<ArrayBuffer> {
  const wb = await workbook();
  const ci = wb.addWorksheet('CI');
  ci.mergeCells('A1:E1');
  ci.getCell('A1').value = 'COMMERCIAL INVOICE';
  ci.addRow(['ITEM', 'ISBN', 'Quantity', 'Unit Price', 'Amount']);
  ci.addRow(['Livro Cartas a Milena - Camelot', '9786585168663', 6000, 0.44, { formula: 'C3*D3', result: 2640 }]);
  ci.addRow(['Box Bluey', '9786561263023', 1000, 1.5, { formula: 'C4*D4', result: 1500 }]);
  for (const ref of ['A3', 'A4']) {
    ci.getCell(ref).font = { bold: true, size: 9 };
    ci.getCell(ref).border = { left: { style: 'thin' } };
  }
  ci.getColumn(1).width = 48;
  wb.addWorksheet('PL').addRow(['ITEM', 'Qty per Ctn']);
  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}

/**
 * O conteúdo de cada arquivo do pacote, para ver que só a aba da invoice mudou. As pastas, que alguns programas
 * gravam como entradas vazias no zip, ficam de fora, assim como a marca interna da biblioteca do zip.
 */
function parts(data: ArrayBuffer | Uint8Array): Map<string, string> {
  const zip = XLSX.CFB.read(new Uint8Array(data), { type: 'array' });
  const out = new Map<string, string>();
  zip.FullPaths.forEach((p: string, i: number) => {
    const c = zip.FileIndex[i]?.content;
    const path = p.replace(/^[^/]*\//, '');
    if (zip.FileIndex[i]?.type === 2 && c && !path.endsWith('/') && !path.endsWith('Sh33tJ5')) out.set(path, new TextDecoder().decode(Uint8Array.from(c)));
  });
  return out;
}

describe('invoice guardada com os nomes novos', () => {
  it('troca só as células dos nomes; o estilo, a fórmula, a mescla e a outra aba ficam como estavam', async () => {
    const original = await invoiceFile();
    const result = await invoiceWithNames(original, 'CI', new Map([['A3', 'Cartas a Milena - Franz Kafka - Camelot Editora']]));
    expect(result?.replaced).toBe(1);

    const wb = await workbook();
    await wb.xlsx.load(result!.data.buffer.slice(result!.data.byteOffset, result!.data.byteOffset + result!.data.byteLength) as ArrayBuffer);
    const ci = wb.getWorksheet('CI')!;
    expect(ci.getCell('A3').value).toBe('Cartas a Milena - Franz Kafka - Camelot Editora');
    expect(ci.getCell('A3').font).toMatchObject({ bold: true, size: 9 });
    expect(ci.getCell('A3').border.left).toMatchObject({ style: 'thin' });
    expect(ci.getCell('A4').value).toBe('Box Bluey');
    expect(ci.getCell('E3').value).toMatchObject({ formula: 'C3*D3' });
    expect(ci.getCell('A1').isMerged).toBe(true);
    expect(ci.getColumn(1).width).toBe(48);
    expect(wb.getWorksheet('PL')!.getCell('B1').value).toBe('Qty per Ctn');

    // Fora a aba da invoice, o pacote é o mesmo, arquivo por arquivo.
    const before = parts(original);
    const after = parts(result!.data);
    expect([...after.keys()].sort()).toEqual([...before.keys()].sort());
    const changed = [...after].filter(([p, c]) => before.get(p) !== c).map(([p]) => p);
    expect(changed).toEqual(['xl/worksheets/sheet1.xml']);
  });

  it('sem o que trocar, com a aba ou as células que não existem, ou em .xls, não mexe', async () => {
    const original = await invoiceFile();
    expect(await invoiceWithNames(original, 'CI', new Map())).toBeNull();
    expect(await invoiceWithNames(original, 'Outra', new Map([['A3', 'X']]))).toBeNull();
    expect(await invoiceWithNames(original, 'CI', new Map([['A30', 'X']]))).toBeNull();
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['ITEM'], ['Box Bluey']]), 'CI');
    const xls = XLSX.write(wb, { type: 'array', bookType: 'biff8' }) as ArrayBuffer;
    expect(await invoiceWithNames(xls, 'CI', new Map([['A2', 'X']]))).toBeNull();
  });
});
