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
 * Junta as linhas da packing list que são do mesmo produto (a Sara põe a caixa de sobra numa linha
 * à parte: 5.040 em caixas de 60 e 50 numa caixa de 50). A quantidade é a soma; as peças por caixa
 * são as da linha com mais exemplares (a caixa padrão), e as outras caixas ficam como sobra, para a
 * prévia.
 */
export function combinePackingLines(packing: readonly DocumentLine[]): DocumentLine[] {
  const groups: DocumentLine[][] = [];
  for (const line of packing) {
    const group = groups.find((g) => sameProduct(g[0]!, line));
    if (group) group.push(line);
    else groups.push([line]);
  }
  return groups.map((group) => {
    if (group.length === 1) return { ...group[0]! };
    const standard = [...group].sort((a, b) => b.quantity - a.quantity).find((l) => l.piecesPerCarton !== null) ?? group[0]!;
    const extraCartons = group
      .filter((l) => l !== standard && l.piecesPerCarton !== null && l.piecesPerCarton !== standard.piecesPerCarton)
      .map((l) => ({ cartons: Math.ceil(l.quantity / l.piecesPerCarton!), pieces: l.piecesPerCarton! }));
    return {
      ...group[0]!,
      isbn: group.find((l) => l.isbn)?.isbn ?? null,
      quantity: group.reduce((s, l) => s + l.quantity, 0),
      piecesPerCarton: standard.piecesPerCarton,
      ...(extraCartons.length ? { extraCartons } : {}),
    };
  });
}

/**
 * Junta a invoice e a packing list de um container: as linhas são as da invoice, com as peças por
 * caixa da packing list (já com as linhas do mesmo produto somadas). Quantidade diferente, somando as
 * linhas do produto nas duas listas, vira aviso (vale a da invoice). Sem invoice, valem as linhas da
 * packing list, sem preço (fica o preço da produção).
 */
export function mergePackingList(invoice: readonly DocumentLine[] | null, packing: readonly DocumentLine[] | null): MergedLines {
  if (!invoice) return { lines: combinePackingLines(packing ?? []).map((l) => ({ ...l, unitPriceMicros: null })), warnings: [] };
  if (!packing || packing === invoice) return { lines: invoice.map((l) => ({ ...l })), warnings: [] };
  const pl = combinePackingLines(packing);
  const warnings: DocumentNote[] = [];
  const used = new Set<number>();
  const lines = invoice.map((line) => {
    const i = pl.findIndex((p) => sameProduct(line, p));
    if (i < 0) {
      warnings.push({ row: line.row, message: `"${line.description}" não está na packing list: fica sem peças por caixa.` });
      return { ...line };
    }
    // A sobra aparece uma vez só, na primeira linha do produto na invoice.
    const first = !used.has(i);
    used.add(i);
    const p = pl[i]!;
    return { ...line, piecesPerCarton: line.piecesPerCarton ?? p.piecesPerCarton, ...(first && p.extraCartons ? { extraCartons: p.extraCartons } : {}) };
  });
  pl.forEach((p, i) => {
    if (!used.has(i)) {
      warnings.push({ row: p.row, message: `"${p.description}" está na packing list (linha ${p.row}) e não na invoice: fica de fora.` });
      return;
    }
    const same = invoice.filter((l) => sameProduct(l, p));
    const total = same.reduce((s, l) => s + l.quantity, 0);
    if (total !== p.quantity) {
      warnings.push({
        row: same[0]!.row,
        message: `"${same[0]!.description}": a invoice tem ${formatQuantity(total)} e a packing list, ${formatQuantity(p.quantity)}. Vale a invoice.`,
      });
    }
  });
  return { lines, warnings: warnings.sort((a, b) => a.row - b.row) };
}

/** Peças por caixa para a prévia: "60" ou, com sobra, "60 (+1 cx de 50)". */
export function piecesLabel(line: Pick<DocumentLine, 'piecesPerCarton' | 'extraCartons'>): string {
  if (line.piecesPerCarton === null) return '—';
  const extra = (line.extraCartons ?? []).map((e) => `+${e.cartons} cx de ${formatQuantity(e.pieces)}`).join(', ');
  return extra ? `${formatQuantity(line.piecesPerCarton)} (${extra})` : formatQuantity(line.piecesPerCarton);
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
