// Planilhas: lê a aba da planilha de importação que a pessoa envia (.xlsx, ou .xls do Excel antigo) e
// gera as planilhas para baixar.
// A biblioteca de planilhas é grande, por isso só é carregada quando alguém usa uma destas funções.

import type { Workbook, Worksheet } from 'exceljs';
import { IMPORT_MAX_ROWS } from '../core/importProduction';
import type { OrderSheet } from '../core/newOrder';

async function newWorkbook(): Promise<Workbook> {
  const mod = await import('exceljs');
  // O pacote para o navegador expõe a biblioteca como "default"; no Node, direto.
  const ExcelJS = (mod as unknown as { default?: typeof mod }).default ?? mod;
  return new ExcelJS.Workbook();
}

/** Número sem os restos de ponto flutuante que fórmulas deixam (0,30000000000000004 → 0,3). */
function numberText(v: number): string {
  if (Number.isInteger(v)) return BigInt(v).toString();
  return String(Number(v.toPrecision(12)));
}

function cellText(sheet: Worksheet, row: number, col: number): string {
  const cell = sheet.getCell(row, col);
  const v = cell.value;
  if (v === null || v === undefined) return '';
  // Data digitada como data: vira dia/mês/ano, como a pessoa vê.
  if (v instanceof Date) return `${String(v.getUTCDate()).padStart(2, '0')}/${String(v.getUTCMonth() + 1).padStart(2, '0')}/${v.getUTCFullYear()}`;
  // Número inteiro grande (como um ISBN digitado sem formatação) sem notação científica.
  if (typeof v === 'number') return numberText(v);
  // Fórmula: vale o resultado.
  if (typeof v === 'object' && 'result' in v) {
    const r = (v as { result?: unknown }).result;
    if (typeof r === 'number') return numberText(r);
    if (r instanceof Date) return cellText({ getCell: () => ({ value: r }) } as unknown as Worksheet, row, col);
    return r === null || r === undefined || typeof r === 'object' ? '' : String(r);
  }
  return cell.text ?? '';
}

async function loadWorkbook(file: ArrayBuffer): Promise<Workbook> {
  const wb = await newWorkbook();
  try {
    await wb.xlsx.load(file);
  } catch {
    throw new Error('Não foi possível ler o arquivo. Envie uma planilha .xlsx ou .xls (no Google Planilhas: Arquivo → Fazer download → Microsoft Excel).');
  }
  return wb;
}

function sheetRows(sheet: Worksheet, maxRows: number): string[][] {
  const cols = Math.min(sheet.columnCount, 40);
  const last = Math.min(sheet.rowCount, maxRows);
  const rows: string[][] = [];
  for (let r = 1; r <= last; r++) {
    const row: string[] = [];
    for (let c = 1; c <= cols; c++) row.push(cellText(sheet, r, c));
    rows.push(row);
  }
  return rows;
}

const sheetKey = (name: string) => name.normalize('NFC').trim().toLowerCase();

/** O arquivo é do Excel antigo (.xls)? Esses começam com a assinatura do formato OLE. */
function isLegacyXls(file: ArrayBuffer): boolean {
  const b = new Uint8Array(file, 0, Math.min(8, file.byteLength));
  return b.length === 8 && b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0;
}

/**
 * Abas de um .xls como texto, com a biblioteca SheetJS (carregada só quando aparece um .xls). Datas
 * viram dia/mês/ano e números saem sem os restos de ponto flutuante, como no .xlsx.
 */
async function legacyXlsSheets(file: ArrayBuffer, maxRows: number): Promise<{ name: string; rows: string[][] }[]> {
  const XLSX = await import('xlsx');
  let wb: ReturnType<typeof XLSX.read>;
  try {
    wb = XLSX.read(new Uint8Array(file), { type: 'array', cellDates: true });
  } catch {
    throw new Error('Não foi possível ler o arquivo .xls. Abra no Excel e salve como .xlsx.');
  }
  return wb.SheetNames.map((name) => {
    const values = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name]!, { header: 1, raw: true, defval: '', blankrows: true }).slice(0, maxRows);
    const rows = values.map((row) =>
      row.slice(0, 40).map((v) => {
        if (v === null || v === undefined) return '';
        if (v instanceof Date) return `${String(v.getDate()).padStart(2, '0')}/${String(v.getMonth() + 1).padStart(2, '0')}/${v.getFullYear()}`;
        if (typeof v === 'number') return numberText(v);
        return String(v);
      }),
    );
    return { name, rows };
  });
}

/**
 * Lê as abas pedidas da planilha como texto, linha a linha, abrindo o arquivo uma vez só. A aba que
 * não existe vem como null; `names` traz todas as abas do arquivo, para a mensagem de erro.
 */
export async function readSheets<N extends string>(file: ArrayBuffer, wanted: readonly N[]): Promise<{ sheets: Record<N, string[][] | null>; names: string[] }> {
  if (isLegacyXls(file)) {
    const all = await legacyXlsSheets(file, IMPORT_MAX_ROWS);
    const sheets = {} as Record<N, string[][] | null>;
    for (const name of wanted) sheets[name] = all.find((s) => sheetKey(s.name) === sheetKey(name))?.rows ?? null;
    return { sheets, names: all.map((s) => s.name) };
  }
  const wb = await loadWorkbook(file);
  const sheets = {} as Record<N, string[][] | null>;
  for (const name of wanted) {
    const sheet = wb.worksheets.find((w) => sheetKey(w.name) === sheetKey(name));
    sheets[name] = sheet ? sheetRows(sheet, IMPORT_MAX_ROWS) : null;
  }
  return { sheets, names: wb.worksheets.map((w) => w.name) };
}

/**
 * Lê uma aba da planilha como texto, linha a linha. Sem a aba pedida, devolve o nome das abas que
 * existem, para a mensagem de erro.
 */
export async function readSheetRows(file: ArrayBuffer, sheetName: string): Promise<{ rows: string[][] } | { missing: string[] }> {
  const { sheets, names } = await readSheets(file, [sheetName]);
  const rows = sheets[sheetName];
  return rows ? { rows } : { missing: names };
}

/**
 * Lê todas as abas de um arquivo como texto (para a PO e a invoice dos fornecedores, que podem ter a
 * packing list e a invoice em abas diferentes). Lê no máximo `maxRows` linhas (por padrão, 2.000) e 40
 * colunas por aba.
 */
export async function readWorkbook(file: ArrayBuffer, maxRows = 2_000): Promise<{ name: string; rows: string[][] }[]> {
  if (isLegacyXls(file)) return legacyXlsSheets(file, maxRows);
  const wb = await loadWorkbook(file);
  return wb.worksheets.map((sheet) => ({ name: sheet.name, rows: sheetRows(sheet, maxRows) }));
}

export interface ExportColumn<T> {
  header: string;
  width: number;
  value: (row: T) => string | number | null;
  /** Formato de número do Excel, como '#,##0.00'. */
  numFmt?: string;
  /** Texto em cinza: a coluna é do sistema, não da pessoa (o código do item). */
  muted?: boolean;
}

/**
 * Planilha com várias abas de linhas prontas (a cópia completa): cabeçalho na primeira linha, datas
 * ({ date: 'AAAA-MM-DD' }) como data do Excel e ISBN como texto, para não virar número científico.
 */
export async function buildSheets(sheets: readonly { name: string; header: readonly string[]; rows: readonly (string | number | { date: string } | null)[][]; widths?: readonly number[] }[]): Promise<ArrayBuffer> {
  const wb = await newWorkbook();
  wb.creator = 'No Porto';
  for (const s of sheets) {
    const sheet = wb.addWorksheet(s.name, { views: [{ state: 'frozen', ySplit: 1 }] });
    sheet.addRow([...s.header]);
    const head = sheet.getRow(1);
    head.font = { bold: true };
    for (const row of s.rows) {
      sheet.addRow(row.map((c) => (c && typeof c === 'object' ? new Date(`${c.date}T00:00:00Z`) : c)));
    }
    s.header.forEach((h, i) => {
      const col = sheet.getColumn(i + 1);
      col.width = s.widths?.[i] ?? (h === 'Produto' ? 60 : 14);
      if (h === 'ISBN') col.numFmt = '@';
    });
    // Datas no formato dia/mês/ano.
    sheet.eachRow((row, n) => {
      if (n === 1) return;
      row.eachCell((cell) => {
        if (cell.value instanceof Date) cell.numFmt = 'dd/mm/yyyy';
      });
    });
  }
  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}

/** Monta uma planilha simples com uma aba, cabeçalho fixo e as colunas pedidas. */
export async function buildExport<T>(sheetName: string, columns: readonly ExportColumn<T>[], rows: readonly T[]): Promise<ArrayBuffer> {
  const wb = await newWorkbook();
  wb.creator = 'No Porto';
  const sheet = wb.addWorksheet(sheetName, { views: [{ state: 'frozen', ySplit: 1 }] });
  sheet.columns = columns.map((c, i) => ({ header: c.header, key: String(i), width: c.width }));
  const head = sheet.getRow(1);
  head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0B7480' } };
  head.height = 22;
  columns.forEach((c, i) => {
    if (c.numFmt) sheet.getColumn(i + 1).numFmt = c.numFmt;
  });
  for (const row of rows) sheet.addRow(Object.fromEntries(columns.map((c, i) => [String(i), c.value(row) ?? ''])));
  columns.forEach((c, i) => {
    if (!c.muted) return;
    sheet.getColumn(i + 1).eachCell((cell, n) => {
      if (n > 1) cell.font = { color: { argb: 'FF8A8F98' } };
    });
  });
  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}

/** Linhas de texto que a célula precisa, para a altura da linha (o Excel não ajusta sozinho ao abrir). */
function linesNeeded(text: string, width: number, fontSize: number): number {
  const perLine = Math.max(8, Math.floor(((width * 11) / fontSize) * 0.95));
  return text.split('\n').reduce((n, part) => n + Math.max(1, Math.ceil(part.length / perLine)), 0);
}

/**
 * A PO no modelo da editora, igual à PO-070 da Nicola: a editora e "PRINTING ORDER" no topo, To/From,
 * Date e Order No., a tabela com o preço em amarelo, o valor por fórmula, o total e as condições. O
 * conteúdo vem de src/core/newOrder.ts (orderSheet), que o Novo pedido lê de volta igual.
 */
export async function buildOrderFile(po: OrderSheet): Promise<ArrayBuffer> {
  const wb = await newWorkbook();
  wb.creator = 'No Porto';
  const ws = wb.addWorksheet(po.name, {
    pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.7, right: 0.7, top: 0.75, bottom: 0.75, header: 0.3, footer: 0.3 } },
  });
  const widths = [23.7, 23.7, 48.4, 11.4, 20.7, 10.4, 12.1, 14, 17.1, 48, 26];
  ws.columns = widths.map((width) => ({ width }));
  po.rows.forEach((cells, r) => {
    const row = ws.getRow(r + 1);
    cells.forEach((cell, c) => {
      if (cell === null) return;
      const target = row.getCell(c + 1);
      if (typeof cell === 'object' && 'date' in cell) target.value = new Date(`${cell.date}T00:00:00Z`);
      else if (typeof cell === 'object') target.value = { formula: cell.formula, result: cell.result };
      else target.value = cell;
    });
  });
  const thin = { style: 'thin' as const };
  const border = { top: thin, left: thin, bottom: thin, right: thin };
  const center = { horizontal: 'center' as const, vertical: 'middle' as const, wrapText: true };
  for (let r = 1; r <= po.totalRow; r++) {
    for (let c = 1; c <= 11; c++) ws.getCell(r, c).border = border;
  }
  // O topo: a editora e o título, cada um numa faixa mesclada.
  ws.mergeCells(1, 1, 2, 11);
  ws.mergeCells(3, 1, 3, 11);
  ws.getCell('A1').font = { name: 'Calibri', size: 26, bold: true };
  ws.getCell('A1').alignment = center;
  ws.getCell('A3').font = { name: 'Calibri', size: 22, bold: true, italic: true, color: { argb: 'FF0C0C0C' } };
  ws.getCell('A3').alignment = center;
  for (const r of [4, 5]) {
    for (let c = 1; c <= 11; c++) ws.getCell(r, c).font = { name: 'Calibri', size: 14 };
    ws.getCell(r, 1).alignment = { horizontal: 'right', vertical: 'middle' };
    ws.getCell(r, 2).alignment = { vertical: 'middle' };
    ws.getCell(r, 10).alignment = { horizontal: 'center', vertical: 'middle' };
  }
  ws.getCell('K4').numFmt = 'yyyy/mm/dd';
  ws.getCell('K5').alignment = { horizontal: 'right', vertical: 'middle' };
  [24.75, 18, 28.5, 18.75, 18.75, 49.5].forEach((h, i) => (ws.getRow(i + 1).height = h));
  for (let c = 1; c <= 11; c++) {
    const head = ws.getCell(6, c);
    head.font = { name: 'Calibri', size: 16, bold: true };
    head.alignment = center;
  }
  // As linhas dos produtos, com o estilo de cada coluna da PO-070.
  const styles: { size: number; font?: string; align?: 'center' | 'right'; wrap?: boolean; numFmt?: string; fill?: string }[] = [
    { size: 13, align: 'center' },
    { size: 12, wrap: true },
    { size: 13, wrap: true },
    { size: 10, font: 'Arial', align: 'center' },
    { size: 12, align: 'center', numFmt: '@' },
    { size: 12, align: 'center', numFmt: '0' },
    { size: 12, align: 'right', numFmt: '#,##0' },
    { size: 12, align: 'right', numFmt: '\\$#,##0.0000', fill: 'FFFFFF00' },
    { size: 12, align: 'right', numFmt: '\\$#,##0.00' },
    { size: 12, wrap: true },
    { size: 10, font: 'Arial', align: 'center', numFmt: 'dd\\-mmm\\-yyyy' },
  ];
  for (let r = po.firstLine; r <= po.lastLine; r++) {
    styles.forEach((s, i) => {
      const cell = ws.getCell(r, i + 1);
      cell.font = { name: s.font ?? 'Calibri', size: s.size };
      cell.alignment = { horizontal: s.align, vertical: 'middle', wrapText: s.wrap || s.align === 'center' };
      if (s.numFmt) cell.numFmt = s.numFmt;
      if (s.fill) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: s.fill } };
    });
    const text = (c: number) => String(ws.getCell(r, c).value ?? '');
    const lines = Math.max(linesNeeded(text(2), widths[1]!, 12), linesNeeded(text(3), widths[2]!, 13), linesNeeded(text(10), widths[9]!, 12));
    ws.getRow(r).height = Math.max(24, lines * 17);
  }
  // O total, em cinza, e as condições embaixo.
  ws.mergeCells(po.totalRow, 1, po.totalRow, 5);
  for (let c = 1; c <= 11; c++) {
    const cell = ws.getCell(po.totalRow, c);
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9D9D9' } };
    cell.font = { name: 'Calibri', size: 11, bold: true };
    cell.alignment = { horizontal: c === 1 ? 'center' : 'right', vertical: 'middle' };
  }
  ws.getCell(po.totalRow, 7).numFmt = '#,##0';
  ws.getCell(po.totalRow, 9).numFmt = '\\$#,##0.00';
  ws.mergeCells(po.termsRow, 1, po.termsRow, 11);
  ws.getCell(po.termsRow, 1).font = { name: 'Calibri', size: 9 };
  ws.getCell(po.termsRow, 1).alignment = { vertical: 'top', wrapText: true };
  ws.getRow(po.termsRow).height = 48;
  ws.autoFilter = { from: { row: 6, column: 1 }, to: { row: po.lastLine, column: 11 } };
  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}
