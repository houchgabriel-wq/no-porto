// O texto de um PDF, para ler o BL: as unidades (pedido do Gabriel em 25/11/2026) e a data, para a
// chegada prevista (26/11/2026). O pdf.js, da Mozilla, só é carregado quando precisa. PDF escaneado (só
// imagem) não tem texto: as unidades e a data ficam vazias.

import { readBillDate, type BillDate, type PdfItem } from '../core/billArrival';
import { readBillUnits, type BillUnit } from '../core/billUnits';

/** O que o pdf.js entrega de cada pedaço de texto: o texto, a posição (transform[4] e [5]) e a largura. */
interface TextPiece {
  str: string;
  transform: number[];
  width: number;
}

/** Os pedaços de texto de uma página, com a posição, para achar o que está embaixo de cada rótulo. */
export function pdfItems(page: number, pieces: readonly TextPiece[]): PdfItem[] {
  return pieces.filter((p) => p.str.trim()).map((p) => ({ text: p.str, page, x: p.transform[4] ?? 0, y: p.transform[5] ?? 0, width: p.width }));
}

/** O texto corrido do PDF (para as unidades) e os pedaços com a posição (para a data). */
export async function readPdf(data: ArrayBuffer): Promise<{ text: string; items: PdfItem[] }> {
  const pdfjs = await import('pdfjs-dist');
  const { default: workerSrc } = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
  pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(data), isEvalSupported: false }).promise;
  try {
    const pages: string[] = [];
    const items: PdfItem[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const content = await (await doc.getPage(n)).getTextContent();
      const pieces = content.items.filter((it) => 'str' in it);
      pages.push(pieces.map((it) => `${it.str}${it.hasEOL ? '\n' : ''}`).join(''));
      items.push(...pdfItems(n, pieces));
    }
    return { text: pages.join('\n'), items };
  } finally {
    await doc.destroy();
  }
}

export interface BillRead {
  /** As unidades (container, lacre, tipo, caixas, peso e cubagem). */
  units: BillUnit[];
  /** A data do BL, para a chegada prevista. */
  date: BillDate | null;
}

/** O que dá para ler do PDF do BL: as unidades e a data. */
export async function readBillPdf(data: ArrayBuffer): Promise<BillRead> {
  const { text, items } = await readPdf(data);
  return { units: readBillUnits(text), date: readBillDate(items) };
}
