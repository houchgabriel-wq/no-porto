// O PDF da proposta da gráfica lido no navegador (pedido do Gabriel em 27/11/2026): o texto sai pelo pdf.js, o mesmo do
// BL (src/app/pdfText.ts), e a leitura é a de src/core/proposalPdf.ts. Imagem (PNG, JPG) e PDF escaneado não têm
// texto: o arquivo é anexado do mesmo jeito, e a proposta é preenchida à mão.

import { readProposal, type ProposalRead } from '../core/proposalPdf';

/** O arquivo da proposta com o que foi lido dele. */
export interface ProposalFile {
  file: File;
  read: ProposalRead;
  /** O texto do PDF, para achar a gráfica cadastrada pelo nome. */
  text: string;
}

/** Lê o PDF da proposta; null quando o arquivo não é PDF ou não tem texto (escaneado). */
export async function readProposalFile(file: File): Promise<ProposalFile | null> {
  if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') return null;
  const { readPdf } = await import('./pdfText');
  const { text } = await readPdf(await file.arrayBuffer());
  if (!text.trim()) return null;
  return { file, read: readProposal(text), text };
}
