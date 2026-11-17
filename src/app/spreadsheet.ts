// Planilhas: lê a aba da planilha de importação que a pessoa envia e gera as planilhas para baixar.
// A biblioteca de planilhas é grande, por isso só é carregada quando alguém usa uma destas funções.

import type { Workbook, Worksheet } from 'exceljs';
import { IMPORT_MAX_ROWS } from '../core/importProduction';

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

/**
 * Lê uma aba da planilha como texto, linha a linha. Sem a aba pedida, devolve o nome das abas que
 * existem, para a mensagem de erro.
 */
export async function readSheetRows(file: ArrayBuffer, sheetName: string): Promise<{ rows: string[][] } | { missing: string[] }> {
  const wb = await newWorkbook();
  try {
    await wb.xlsx.load(file);
  } catch {
    throw new Error('Não foi possível ler o arquivo. Envie uma planilha .xlsx (no Google Planilhas: Arquivo → Fazer download → Microsoft Excel).');
  }
  const want = sheetName.normalize('NFC').toLowerCase();
  const sheet = wb.worksheets.find((w) => w.name.normalize('NFC').trim().toLowerCase() === want);
  if (!sheet) return { missing: wb.worksheets.map((w) => w.name) };
  const cols = Math.min(sheet.columnCount, 40);
  const last = Math.min(sheet.rowCount, IMPORT_MAX_ROWS);
  const rows: string[][] = [];
  for (let r = 1; r <= last; r++) {
    const row: string[] = [];
    for (let c = 1; c <= cols; c++) row.push(cellText(sheet, r, c));
    rows.push(row);
  }
  return { rows };
}

export interface ExportColumn<T> {
  header: string;
  width: number;
  value: (row: T) => string | number | null;
  /** Formato de número do Excel, como '#,##0.00'. */
  numFmt?: string;
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
  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}
