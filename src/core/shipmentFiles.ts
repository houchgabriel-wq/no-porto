// Novo embarque com vários containers (SPEC.md, seção 3): cada container tem uma invoice e uma
// packing list. A invoice dá o que foi faturado (quantidade e preço); a packing list, as peças por
// caixa. O app junta os arquivos de cada container e as duas listas de cada um.

import { sameProduct } from './allocation';
import type { DocumentLine, DocumentNote, ShipmentFile } from './documents';
import { formatQuantity } from './money';

export interface MergedLines {
  lines: DocumentLine[];
  warnings: DocumentNote[];
}

/**
 * Junta a invoice e a packing list de um container: as linhas são as da invoice, com as peças por
 * caixa da packing list. Quantidades diferentes viram aviso (vale a da invoice). Sem invoice, valem
 * as linhas da packing list, sem preço (fica o preço da produção).
 */
export function mergePackingList(invoice: readonly DocumentLine[] | null, packing: readonly DocumentLine[] | null): MergedLines {
  if (!invoice) return { lines: (packing ?? []).map((l) => ({ ...l, unitPriceMicros: null })), warnings: [] };
  if (!packing || packing === invoice) return { lines: invoice.map((l) => ({ ...l })), warnings: [] };
  const warnings: DocumentNote[] = [];
  const used = new Set<number>();
  const lines = invoice.map((line) => {
    // A linha do mesmo produto, de preferência com a mesma quantidade.
    const candidates = packing.map((p, i) => ({ p, i })).filter(({ p, i }) => !used.has(i) && sameProduct(line, p));
    const match = candidates.find(({ p }) => p.quantity === line.quantity) ?? candidates[0];
    if (!match) {
      warnings.push({ row: line.row, message: `"${line.description}" não está na packing list: fica sem peças por caixa.` });
      return { ...line };
    }
    used.add(match.i);
    if (match.p.quantity !== line.quantity) {
      warnings.push({
        row: line.row,
        message: `"${line.description}": a invoice tem ${formatQuantity(line.quantity)} e a packing list, ${formatQuantity(match.p.quantity)}. Vale a invoice.`,
      });
    }
    return { ...line, piecesPerCarton: line.piecesPerCarton ?? match.p.piecesPerCarton };
  });
  packing.forEach((p, i) => {
    if (!used.has(i)) warnings.push({ row: p.row, message: `"${p.description}" está na packing list (linha ${p.row}) e não na invoice: fica de fora.` });
  });
  return { lines, warnings };
}

export interface ContainerFiles {
  invoice: ShipmentFile | null;
  packing: ShipmentFile | null;
}

/** Palavras do nome do arquivo que identificam o container ("ctnr04", "56th"). */
function nameTokens(fileName: string): Set<string> {
  const ignore = new Set(['pi', 'pl', 'ci', 'final', 'invoice', 'packing', 'list', 'proforma', 'commercial', 'xlsx', 'xls', 'pls', 'pay', 'to', 'my', 'account', 'shipment', 'draft', 'for', 'and']);
  return new Set(
    fileName
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 1 && !ignore.has(t)),
  );
}

/** Quanto a packing list parece ser do mesmo container que a invoice. */
function pairScore(invoice: ShipmentFile, packing: ShipmentFile): number {
  let score = 0;
  if (invoice.container && invoice.container === packing.container) score += 100;
  if (invoice.number && packing.number && packing.number.includes(invoice.number)) score += 50;
  const inv = invoice.invoice?.lines ?? [];
  for (const p of packing.packing?.lines ?? []) if (inv.some((l) => l.quantity === p.quantity && sameProduct(l, p))) score += 3;
  const a = nameTokens(invoice.fileName);
  const b = nameTokens(packing.fileName);
  // Os tokens em comum só contam se não forem comuns a todos os arquivos (como "56th").
  for (const t of a) if (b.has(t) && /\d/.test(t)) score += 2;
  return score;
}

/**
 * Agrupa os arquivos por container: um arquivo com invoice e packing list é um container; os outros
 * são pareados (mesmo container, mesmo número de invoice, as mesmas linhas, o mesmo "CTNR04" no nome).
 * Arquivo sem par vira um container sozinho.
 */
export function pairShipmentFiles(files: readonly ShipmentFile[]): ContainerFiles[] {
  const result: ContainerFiles[] = [];
  const invoices: ShipmentFile[] = [];
  const packings: ShipmentFile[] = [];
  for (const f of files) {
    if (f.invoice && f.packing) result.push({ invoice: f, packing: f });
    else if (f.invoice) invoices.push(f);
    else packings.push(f);
  }
  const pairs = invoices.flatMap((inv) => packings.map((pl) => ({ inv, pl, score: pairScore(inv, pl) }))).filter((p) => p.score > 0);
  pairs.sort((a, b) => b.score - a.score);
  const taken = new Set<ShipmentFile>();
  const byInvoice = new Map<ShipmentFile, ShipmentFile>();
  for (const { inv, pl } of pairs) {
    if (taken.has(inv) || taken.has(pl)) continue;
    taken.add(inv).add(pl);
    byInvoice.set(inv, pl);
  }
  for (const inv of invoices) result.push({ invoice: inv, packing: byInvoice.get(inv) ?? null });
  for (const pl of packings) if (!taken.has(pl)) result.push({ invoice: null, packing: pl });
  return result;
}
