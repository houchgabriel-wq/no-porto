// Ligação com o No Prelo (decidida pelo Gabriel em 19/11/2026): quando o gerente de diagramação cadastra
// no No Prelo a "Data de aprovação" da gráfica, ela vira a "Aprovação do arquivo" do item do No Porto.
// O livro e o item se casam só pelo ISBN e pela PO (a "ordem de impressão" do No Prelo); sem a PO, não
// se casa. Vale a data do No Prelo: ela substitui a do No Porto, e enquanto vier de lá, só muda lá.

import { isbnDigits, isbnProblem } from './isbn';
import { normalizeOrderCode } from './items';
import { parseDate } from './shipments';

/** Uma aprovação como o No Prelo manda (o livro do quadro ou o registro do histórico da gráfica). */
export interface NoPreloApproval {
  isbn: string;
  /** A ordem de impressão: a PO, como "PO-070" (texto livre no No Prelo). */
  printOrder: string;
  /** A "Data de aprovação" da gráfica (AAAA-MM-DD). */
  approvedAt: string;
  title: string;
  printer: string;
}

/** O que a ligação precisa saber de cada item do No Porto. */
export interface ApprovalTarget {
  id: string;
  isbn: string | null;
  orderCode: string | null;
  fileApprovedAt: string | null;
  /** 'noprelo' quando a data atual veio do No Prelo. */
  fileApprovedFrom: string | null;
}

/** O que muda num item: a data (com a anterior, para o histórico) e de onde ela vem. */
export interface ApprovalChange {
  itemId: string;
  from: string | null;
  to: string | null;
  source: 'noprelo' | null;
}

export const NO_PRELO = 'noprelo';

/** A mensagem de quem tenta mudar no No Porto a aprovação que veio do No Prelo. */
export const NO_PRELO_LOCKED = 'A aprovação do arquivo deste item vem do No Prelo (a data de aprovação da gráfica). Para mudar, altere no No Prelo.';

/** A PO escrita na ordem de impressão ("PO-070", "po 70", "PO-070 lote 2"); null sem PO. */
export function orderFromPrintOrder(text: string): string | null {
  const m = /PO[\s-]*(\d{1,6})/i.exec(text);
  return m ? normalizeOrderCode(`PO-${m[1]}`) : null;
}

/** A chave do casamento: o ISBN (só os números, válido) e a PO; null quando falta um dos dois. */
export function approvalKey(isbn: string | null, order: string | null): string | null {
  if (!isbn || !order || isbnProblem(isbn) !== null) return null;
  return `${isbnDigits(isbn)}|${order.toUpperCase()}`;
}

/**
 * As mudanças nos itens: cada item com o ISBN e a PO de uma aprovação do No Prelo passa a ter a data
 * dela (a mais antiga, quando o mesmo livro e a mesma PO aparecem mais de uma vez, como no quadro e no
 * histórico ou em dois lotes: o arquivo é aprovado uma vez). O item que vinha do No Prelo e não tem mais
 * aprovação lá fica com a data, mas volta a poder ser mudado no No Porto.
 */
export function approvalChanges(approvals: readonly NoPreloApproval[], items: readonly ApprovalTarget[]): ApprovalChange[] {
  const dates = new Map<string, string>();
  for (const a of approvals) {
    const key = approvalKey(a.isbn.trim(), orderFromPrintOrder(a.printOrder));
    const day = a.approvedAt.trim();
    if (!key || parseDate(day) !== day) continue;
    const known = dates.get(key);
    if (!known || day < known) dates.set(key, day);
  }
  const changes: ApprovalChange[] = [];
  for (const item of items) {
    const key = approvalKey(item.isbn, item.orderCode);
    const day = key ? dates.get(key) : undefined;
    if (day) {
      if (item.fileApprovedAt !== day || item.fileApprovedFrom !== NO_PRELO) changes.push({ itemId: item.id, from: item.fileApprovedAt, to: day, source: NO_PRELO });
    } else if (item.fileApprovedFrom === NO_PRELO) {
      changes.push({ itemId: item.id, from: item.fileApprovedAt, to: item.fileApprovedAt, source: null });
    }
  }
  return changes;
}
