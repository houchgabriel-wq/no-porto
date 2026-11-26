import { describe, expect, it } from 'vitest';
import type { DocumentLine } from './documents';
import { cartonsText, missingPieces, packingPlan, type PackingItem } from './packingList';

const line = (row: number, over: Partial<DocumentLine>): DocumentLine => ({
  row,
  description: '',
  isbn: null,
  quantity: 0,
  piecesPerCarton: null,
  unitPriceMicros: null,
  orderCode: null,
  notes: '',
  specification: '',
  ...over,
});

const item = (id: string, over: Partial<PackingItem>): PackingItem => ({ id, isbn: null, description: '', quantity: 0, piecesPerCarton: null, ...over });

describe('packing list de um container já registrado', () => {
  const items = [
    item('a', { description: 'Cartas a Milena', isbn: '9786585168304', quantity: 6000, piecesPerCarton: 40 }),
    // O mesmo livro de duas POs: duas linhas no container, uma na packing list.
    item('b1', { description: 'Box Machado de Assis', isbn: '9786585168311', quantity: 3000 }),
    item('b2', { description: 'Box Machado de Assis', isbn: '9786585168311', quantity: 2000 }),
    // Sem ISBN: pelo nome, sem acento nem maiúscula.
    item('c', { description: 'Ecobag Leitura', quantity: 500, piecesPerCarton: 100 }),
    item('d', { description: 'Marcador de página', quantity: 1000 }),
  ];

  it('as peças por caixa de cada item, pelo ISBN ou pelo nome, e o que muda', () => {
    const plan = packingPlan(items, [
      line(7, { description: 'Letters to Milena', isbn: '9786585168304', quantity: 6000, piecesPerCarton: 48, cartons: 125, grossWeightGrams: 1_500_000 }),
      // A caixa de sobra numa linha à parte: vale a caixa padrão (12), e as caixas contam as duas linhas.
      line(8, { description: 'Box Machado', isbn: '9786585168311', quantity: 4992, piecesPerCarton: 12, cartons: 416, grossWeightGrams: 4_000_000 }),
      line(9, { description: 'Box Machado', isbn: '9786585168311', quantity: 8, piecesPerCarton: 8, cartons: 1, grossWeightGrams: 10_000 }),
      line(10, { description: 'ECOBAG LEITURA', quantity: 500, piecesPerCarton: 100, cartons: 5, grossWeightGrams: 50_000 }),
      line(11, { description: 'Pôster de brinde', quantity: 200, piecesPerCarton: 50, cartons: 4, grossWeightGrams: 8_000 }),
    ]);
    expect(plan.rows.map((r) => [r.itemId, r.from, r.to, r.found])).toEqual([
      ['a', 40, 48, true],
      ['b1', null, 12, true],
      ['b2', null, 12, true],
      ['c', 100, 100, true],
      ['d', null, null, false],
    ]);
    // Só o que muda vai para a gravação: o igual e o que não está na packing list ficam como estão.
    expect(plan.changes).toEqual([
      { itemId: 'a', piecesPerCarton: 48 },
      { itemId: 'b1', piecesPerCarton: 12 },
      { itemId: 'b2', piecesPerCarton: 12 },
    ]);
    expect(plan.warnings).toEqual([
      '"Marcador de página" não está na packing list: as peças por caixa ficam como estão.',
      '"Pôster de brinde" está na packing list (linha 11) e não neste container: fica de fora.',
    ]);
    // As caixas e o peso da packing list inteira, com a linha que não é do container.
    expect([plan.cartons, plan.weightGrams]).toEqual([551, 5_568_000]);
  });

  it('quantidade diferente vira aviso, somando os itens do mesmo produto; linha sem peças por caixa não muda nada', () => {
    const plan = packingPlan(items.slice(1, 3), [line(3, { description: 'Box Machado', isbn: '9786585168311', quantity: 4800, piecesPerCarton: 12 })]);
    expect(plan.warnings).toEqual(['"Box Machado de Assis": o container tem 5.000 e a packing list, 4.800. A quantidade não muda.']);
    // Sem a coluna de caixas, as caixas saem da quantidade e das peças por caixa; sem o peso de todas, nada.
    expect([plan.cartons, plan.weightGrams]).toEqual([400, null]);
    const without = packingPlan([items[0]!], [line(3, { description: 'Cartas a Milena', isbn: '9786585168304', quantity: 6000 })]);
    expect(without.changes).toEqual([]);
    expect(without.warnings).toEqual(['"Cartas a Milena": a packing list não traz as peças por caixa. Ficam como estão.']);
  });

  it('resumo das caixas e os itens que faltam', () => {
    expect(cartonsText(6000, 48)).toBe('6.000 ex. em 125 caixas de 48');
    expect(cartonsText(4999, 12)).toBe('4.999 ex. em 417 caixas de 12');
    expect(cartonsText(40, 48)).toBe('40 ex. em 1 caixa de 48');
    expect(cartonsText(1000, null)).toBe('1.000 ex.');
    expect(missingPieces(items)).toBe(3);
  });
});
