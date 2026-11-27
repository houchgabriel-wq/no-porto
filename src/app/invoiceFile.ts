// A invoice guardada com os nomes novos (pedido do Gabriel em 27/11/2026): abre o .xlsx, que é um pacote zip,
// troca as células dos nomes na aba da invoice (src/core/invoiceNames.ts) e fecha o pacote de novo; o resto do
// arquivo fica como veio. O .xls (Excel antigo) não é um pacote e fica como veio. A biblioteca do zip vem com a
// SheetJS, carregada só aqui.

import { replaceCellTexts, sheetPartPath } from '../core/invoiceNames';

const bytes = (data: ArrayLike<number>) => (data instanceof Uint8Array ? data : Uint8Array.from(data));

/**
 * O arquivo com os nomes trocados nas células pedidas ("A9" → texto) da aba `sheet`. Devolve null quando não há
 * o que trocar ou não dá: arquivo que não é .xlsx, aba ou células não achadas.
 */
export async function invoiceWithNames(file: ArrayBuffer, sheet: string, texts: ReadonlyMap<string, string>): Promise<{ data: Uint8Array; replaced: number } | null> {
  if (texts.size === 0) return null;
  const head = new Uint8Array(file, 0, Math.min(2, file.byteLength));
  // "PK": o começo de todo zip.
  if (head[0] !== 0x50 || head[1] !== 0x4b) return null;
  const { CFB } = await import('xlsx');
  const zip = CFB.read(new Uint8Array(file), { type: 'array' });
  const text = (path: string): string | null => {
    const entry = CFB.find(zip, `/${path}`);
    return entry?.content ? new TextDecoder().decode(bytes(entry.content)) : null;
  };
  const workbook = text('xl/workbook.xml');
  const rels = text('xl/_rels/workbook.xml.rels');
  const path = workbook && rels ? sheetPartPath(workbook, rels, sheet) : null;
  const entry = path ? CFB.find(zip, `/${path}`) : null;
  if (!entry?.content) return null;
  const { xml, replaced } = replaceCellTexts(new TextDecoder().decode(bytes(entry.content)), texts);
  if (!replaced.length) return null;
  const content = new TextEncoder().encode(xml);
  entry.content = content;
  entry.size = content.length;
  return { data: bytes(CFB.write(zip, { fileType: 'zip', type: 'array', compression: true })), replaced: replaced.length };
}
