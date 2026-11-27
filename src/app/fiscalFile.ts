// A nota fiscal escolhida no navegador (pedido do Gabriel em 27/11/2026): o PDF (o DANFE), de que o pdf.js tira a
// chave de acesso impressa, e o XML da NF-e, lido antes de ir (src/core/nfe.ts). Escolhem-se os dois de uma vez, ou
// um só; cada um é reconhecido pela extensão. O arquivo que não serve não vai, com a explicação.

import { readNfe } from '../core/nfe';
import { MAX_FILE_BYTES, toBase64 } from './fileUpload';

export type FiscalKind = 'pdf' | 'xml';

/** Um arquivo da nota pronto para ir ao servidor. */
export interface FiscalUpload {
  kind: FiscalKind;
  name: string;
  contentType: string;
  data: string;
  /** A chave de acesso: a impressa no PDF ou a do XML; null quando o PDF não tem texto (escaneado). */
  key: string | null;
}

/** O tipo do arquivo pela extensão (o navegador nem sempre informa o tipo do XML); null se não serve. */
export function fiscalKindOf(file: Pick<File, 'name' | 'type'>): FiscalKind | null {
  if (/\.pdf$/i.test(file.name) || file.type === 'application/pdf') return 'pdf';
  if (/\.xml$/i.test(file.name) || file.type === 'application/xml' || file.type === 'text/xml') return 'xml';
  return null;
}

/** Lê a chave impressa no DANFE (na tela, pelo pdf.js: readDanfeKey, em src/app/pdfText.ts); null quando não dá. */
export type PdfKeyReader = (file: File) => Promise<string | null>;

/** Os arquivos escolhidos (um PDF e um XML, em qualquer ordem, ou um só), prontos para ir; ou o erro. */
export async function prepareFiscalFiles(files: readonly File[], readPdfKey: PdfKeyReader): Promise<{ uploads: FiscalUpload[] } | { error: string }> {
  if (files.length === 0) return { uploads: [] };
  if (files.length > 2) return { error: 'Escolha no máximo dois arquivos: o PDF da nota e o XML.' };
  const kinds = files.map(fiscalKindOf);
  if (kinds.some((k) => k === null)) return { error: 'Envie o PDF da nota (o DANFE) e o XML (o arquivo .xml).' };
  if (kinds.length === 2 && kinds[0] === kinds[1]) return { error: `Escolha um PDF e um XML: vieram dois arquivos ${kinds[0] === 'pdf' ? 'em PDF' : 'XML'}.` };
  const big = files.find((f) => f.size > MAX_FILE_BYTES);
  if (big) return { error: `O arquivo ${big.name} passa de 5 MB.` };
  const uploads: FiscalUpload[] = [];
  for (const [n, file] of files.entries()) {
    const kind = kinds[n]!;
    if (kind === 'xml') {
      const read = readNfe(await file.text());
      if (!read.ok) return { error: `${read.error} (${file.name})` };
      uploads.push({ kind, name: file.name, contentType: 'application/xml', data: await toBase64(file), key: read.nfe.key });
    } else {
      // O PDF que não abre vai sem a chave: o servidor confere o arquivo.
      const key = await readPdfKey(file).catch(() => null);
      uploads.push({ kind, name: file.name, contentType: 'application/pdf', data: await toBase64(file), key });
    }
  }
  // O XML primeiro: se ele não servir no servidor, o PDF não fica sozinho por engano.
  return { uploads: uploads.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'xml' ? -1 : 1)) };
}
