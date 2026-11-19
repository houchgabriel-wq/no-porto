// Fornecedores (SPEC.md, seção 5): o que cada um tem em produção, no mar e o que já entregou, no
// total e por ano de chegada. As somas vêm do banco agrupadas por fornecedor, situação e ano; aqui
// elas viram o resumo de cada fornecedor. O leitor recebe só itens e exemplares.

import { NO_SUPPLIER, type ItemStatus } from './items';

/** Uma linha da soma feita no banco. */
export interface SupplierSumRow {
  supplierId: string | null;
  status: ItemStatus;
  /** Ano de chegada (só para os entregues); null para os outros e para os entregues sem data. */
  year: string | null;
  items: number;
  quantity: number;
  valueCents: number;
  lastArrival: string | null;
}

export interface Amount {
  items: number;
  quantity: number;
  /** Ausente para quem não vê valores. */
  valueCents?: number;
}

export interface SupplierSummary {
  supplierId: string | null;
  name: string;
  notes: string;
  production: Amount;
  atSea: Amount;
  delivered: Amount;
  /** Entregue por ano de chegada, do mais recente para o mais antigo ("sem-data" no fim). */
  byYear: (Amount & { year: string })[];
  lastArrival: string | null;
}

function empty(seeValues: boolean): Amount {
  return seeValues ? { items: 0, quantity: 0, valueCents: 0 } : { items: 0, quantity: 0 };
}

function add(a: Amount, r: SupplierSumRow) {
  a.items += r.items;
  a.quantity += r.quantity;
  if (a.valueCents !== undefined) a.valueCents += r.valueCents;
}

export function supplierSummaries(rows: readonly SupplierSumRow[], suppliers: readonly { id: string; name: string; notes: string }[], seeValues: boolean): SupplierSummary[] {
  const byId = new Map<string | null, SupplierSummary>();
  const get = (id: string | null) => {
    let s = byId.get(id);
    if (!s) {
      const info = suppliers.find((x) => x.id === id);
      s = { supplierId: id, name: info?.name ?? NO_SUPPLIER, notes: info?.notes ?? '', production: empty(seeValues), atSea: empty(seeValues), delivered: empty(seeValues), byYear: [], lastArrival: null };
      byId.set(id, s);
    }
    return s;
  };
  // Fornecedores cadastrados aparecem mesmo sem itens.
  for (const s of suppliers) get(s.id);
  for (const r of rows) {
    const s = get(r.supplierId);
    if (r.status === 'producao') add(s.production, r);
    else if (r.status === 'embarcado') add(s.atSea, r);
    else {
      add(s.delivered, r);
      const year = r.year ?? 'sem-data';
      let y = s.byYear.find((x) => x.year === year);
      if (!y) {
        y = { year, ...empty(seeValues) };
        s.byYear.push(y);
      }
      add(y, r);
      if (r.lastArrival && (!s.lastArrival || r.lastArrival > s.lastArrival)) s.lastArrival = r.lastArrival;
    }
  }
  const size = (a: Amount) => a.valueCents ?? a.quantity;
  for (const s of byId.values()) s.byYear.sort((a, b) => (a.year === 'sem-data' ? 1 : b.year === 'sem-data' ? -1 : b.year.localeCompare(a.year)));
  // Quem tem mais em aberto (produção + mar) primeiro; depois, quem mais entregou.
  return [...byId.values()].sort(
    (a, b) =>
      size(b.production) + size(b.atSea) - (size(a.production) + size(a.atSea)) ||
      b.production.items + b.atSea.items - (a.production.items + a.atSea.items) ||
      size(b.delivered) - size(a.delivered) ||
      a.name.localeCompare(b.name, 'pt-BR'),
  );
}

/** Quanto chegou num ano, somando todos os fornecedores. */
export function receivedInYear(summaries: readonly SupplierSummary[], year: string, seeValues: boolean): Amount {
  const total = empty(seeValues);
  for (const s of summaries) {
    const y = s.byYear.find((x) => x.year === year);
    if (y) {
      total.items += y.items;
      total.quantity += y.quantity;
      if (total.valueCents !== undefined) total.valueCents += y.valueCents ?? 0;
    }
  }
  return total;
}

/** Tamanho máximo das observações de um fornecedor (o mesmo limite da ficha). */
export const SUPPLIER_NOTES_MAX = 2000;

/**
 * Juntar dois fornecedores que são a mesma empresa (pedido pelo Gabriel em 19/11/2026: Ricky e
 * Lilian): as observações do que fica e as do que sai, mais uma linha dizendo o nome antigo, para
 * quem procurar por ele saber onde foi parar. Cabe no limite das observações.
 */
export function mergedSupplierNotes(keep: { notes: string }, gone: { name: string; notes: string }): string {
  const parts = [keep.notes.trim(), gone.notes.trim()].filter((p, i, all) => p !== '' && all.indexOf(p) === i);
  parts.push(`Também aparecia como ${gone.name}.`);
  const text = parts.join('\n\n');
  return text.length <= SUPPLIER_NOTES_MAX ? text : `${text.slice(0, SUPPLIER_NOTES_MAX - 1)}…`;
}
