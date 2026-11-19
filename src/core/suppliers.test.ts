import { describe, expect, it } from 'vitest';
import { mergedSupplierNotes, receivedInYear, SUPPLIER_NOTES_MAX, supplierSummaries, type SupplierSumRow } from './suppliers';

const suppliers = [
  { id: 's1', name: 'Sara', notes: '' },
  { id: 's2', name: 'Claire', notes: 'Fábrica em Shenzhen' },
  { id: 's3', name: 'Lilian', notes: '' },
];
const row = (over: Partial<SupplierSumRow>): SupplierSumRow => ({ supplierId: 's1', status: 'producao', year: null, items: 1, quantity: 1000, valueCents: 50_000, lastArrival: null, ...over });
const rows = [
  row({ items: 10, quantity: 100_000, valueCents: 5_000_000 }),
  row({ status: 'embarcado', items: 2, quantity: 20_000, valueCents: 1_000_000 }),
  row({ status: 'entregue', year: '2026', items: 5, quantity: 50_000, valueCents: 2_000_000, lastArrival: '2026-11-08' }),
  row({ status: 'entregue', year: '2025', items: 3, quantity: 30_000, valueCents: 900_000, lastArrival: '2025-12-01' }),
  row({ status: 'entregue', year: null, items: 1, quantity: 1000, valueCents: 100 }),
  row({ supplierId: 's2', items: 20, quantity: 300_000, valueCents: 17_000_000 }),
  row({ supplierId: null, items: 1, quantity: 8000, valueCents: 0 }),
];

describe('resumo por fornecedor', () => {
  it('soma produção, mar e entregue, e o entregue por ano', () => {
    const [claire, sara] = supplierSummaries(rows, suppliers, true);
    expect(claire).toMatchObject({ name: 'Claire', notes: 'Fábrica em Shenzhen', production: { items: 20, valueCents: 17_000_000 } });
    expect(sara).toMatchObject({
      name: 'Sara',
      production: { items: 10, quantity: 100_000, valueCents: 5_000_000 },
      atSea: { items: 2, quantity: 20_000, valueCents: 1_000_000 },
      delivered: { items: 9, quantity: 81_000, valueCents: 2_900_100 },
      lastArrival: '2026-11-08',
    });
    expect(sara!.byYear.map((y) => [y.year, y.items])).toEqual([
      ['2026', 5],
      ['2025', 3],
      ['sem-data', 1],
    ]);
  });

  it('inclui "Sem fornecedor" e os fornecedores sem itens', () => {
    const names = supplierSummaries(rows, suppliers, true).map((s) => s.name);
    expect(names).toEqual(['Claire', 'Sara', 'Sem fornecedor', 'Lilian']);
  });

  it('para o leitor, sem valores', () => {
    const [claire] = supplierSummaries(rows, suppliers, false);
    expect(claire!.production).toEqual({ items: 20, quantity: 300_000 });
    expect(JSON.stringify(supplierSummaries(rows, suppliers, false))).not.toContain('valueCents');
  });

  it('recebido num ano, somando todos', () => {
    const all = supplierSummaries(rows, suppliers, true);
    expect(receivedInYear(all, '2026', true)).toEqual({ items: 5, quantity: 50_000, valueCents: 2_000_000 });
    expect(receivedInYear(all, '2024', false)).toEqual({ items: 0, quantity: 0 });
  });
});

describe('juntar fornecedores', () => {
  it('soma as observações e guarda o nome antigo', () => {
    expect(mergedSupplierNotes({ notes: 'Contato: Ricky' }, { name: 'Lilian', notes: 'Paga em 30 dias' })).toBe('Contato: Ricky\n\nPaga em 30 dias\n\nTambém aparecia como Lilian.');
  });
  it('sem observações, fica só o nome antigo; observação repetida aparece uma vez', () => {
    expect(mergedSupplierNotes({ notes: '' }, { name: 'Lilian', notes: '  ' })).toBe('Também aparecia como Lilian.');
    expect(mergedSupplierNotes({ notes: 'FOB' }, { name: 'Lilian', notes: 'FOB' })).toBe('FOB\n\nTambém aparecia como Lilian.');
  });
  it('não passa do limite das observações', () => {
    const notes = mergedSupplierNotes({ notes: 'a'.repeat(1500) }, { name: 'Lilian', notes: 'b'.repeat(1500) });
    expect(notes).toHaveLength(SUPPLIER_NOTES_MAX);
    expect(notes.endsWith('…')).toBe(true);
  });
});
