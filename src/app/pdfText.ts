// O texto de um PDF, para ler as unidades do BL (pedido do Gabriel em 25/11/2026). O pdf.js, da Mozilla,
// só é carregado quando precisa. PDF escaneado (só imagem) não tem texto: as unidades ficam vazias.

import { readBillUnits, type BillUnit } from '../core/billUnits';

export async function pdfText(data: ArrayBuffer): Promise<string> {
  const pdfjs = await import('pdfjs-dist');
  const { default: workerSrc } = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
  pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(data), isEvalSupported: false }).promise;
  try {
    const pages: string[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const content = await (await doc.getPage(n)).getTextContent();
      pages.push(content.items.map((it) => ('str' in it ? `${it.str}${it.hasEOL ? '\n' : ''}` : '')).join(''));
    }
    return pages.join('\n');
  } finally {
    await doc.destroy();
  }
}

/** As unidades escritas no PDF do BL (container, lacre, tipo, caixas, peso e cubagem). */
export async function billUnitsFromPdf(data: ArrayBuffer): Promise<BillUnit[]> {
  return readBillUnits(await pdfText(data));
}
