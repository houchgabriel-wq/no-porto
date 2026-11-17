import { describe, expect, it } from 'vitest';
import type { DocumentLine, ShipmentFile } from './documents';
import { combinePackingLines, mergePackingList, pairShipmentFiles, piecesLabel } from './shipmentFiles';

const ALICE = '9786583970527';
const ODISSEIA = '9786583970213';
const line = (over: Partial<DocumentLine>): DocumentLine => ({ row: 7, description: 'Coleção Alice', isbn: ALICE, quantity: 1000, piecesPerCarton: null, unitPriceMicros: null, orderCode: null, notes: '', ...over });

describe('mergePackingList', () => {
  it('as linhas da invoice com as peças por caixa da packing list', () => {
    const invoice = [line({ unitPriceMicros: 1_750_000 }), line({ row: 8, description: 'A Odisseia', isbn: ODISSEIA, quantity: 500, unitPriceMicros: 1_120_000 })];
    const packing = [line({ row: 13, description: 'A ODISSEIA', isbn: ODISSEIA, quantity: 500, piecesPerCarton: 26 }), line({ row: 12, quantity: 1000, piecesPerCarton: 22 })];
    expect(mergePackingList(invoice, packing)).toEqual({
      lines: [
        { ...invoice[0], piecesPerCarton: 22 },
        { ...invoice[1], piecesPerCarton: 26 },
      ],
      warnings: [],
    });
  });

  it('avisa quantidade diferente, produto que falta numa das listas', () => {
    const invoice = [line({ quantity: 1000 }), line({ row: 8, description: 'A Odisseia', isbn: ODISSEIA })];
    const packing = [line({ row: 12, quantity: 990, piecesPerCarton: 22 }), line({ row: 14, description: 'Outro', isbn: null, piecesPerCarton: 10 })];
    const { lines, warnings } = mergePackingList(invoice, packing);
    expect(lines.map((l) => [l.quantity, l.piecesPerCarton])).toEqual([
      [1000, 22],
      [1000, null],
    ]);
    expect(warnings.map((w) => w.message)).toEqual([
      '"Coleção Alice": a invoice tem 1.000 e a packing list, 990. Vale a invoice.',
      '"A Odisseia" não está na packing list: fica sem peças por caixa.',
      '"Outro" está na packing list (linha 14) e não na invoice: fica de fora.',
    ]);
  });

  it('só a packing list: as linhas dela, sem preço', () => {
    expect(mergePackingList(null, [line({ piecesPerCarton: 22, unitPriceMicros: 9 })]).lines).toEqual([line({ piecesPerCarton: 22 })]);
  });
});

describe('caixa de sobra na packing list', () => {
  // Embarque 2026W-3C da Sara: a packing list separa a caixa de sobra numa linha à parte.
  const BLUEY = '9786555477146';
  const pl = [
    line({ row: 8, description: 'Bluey Hora do Banho 01', isbn: BLUEY, quantity: 5040, piecesPerCarton: 60 }),
    line({ row: 9, description: 'Bluey Hora do Banho 01', isbn: BLUEY, quantity: 50, piecesPerCarton: 50 }),
    line({ row: 12, description: 'Bluey Aquabook 02', isbn: ODISSEIA, quantity: 18720, piecesPerCarton: 60 }),
  ];

  it('junta as linhas do mesmo produto, com a caixa padrão da maioria e a sobra à parte', () => {
    expect(combinePackingLines(pl).map((l) => [l.row, l.quantity, l.piecesPerCarton, l.extraCartons ?? null])).toEqual([
      [8, 5090, 60, [{ cartons: 1, pieces: 50 }]],
      [12, 18720, 60, null],
    ]);
  });

  it('com a invoice de 5.090, não há aviso; só a packing list também dá um item só', () => {
    const invoice = [line({ row: 18, description: 'Bluey Hora do Banho 01', isbn: BLUEY, quantity: 5090, unitPriceMicros: 500_000 }), line({ row: 20, description: 'Bluey Aquabook 02', isbn: ODISSEIA, quantity: 18720 })];
    const merged = mergePackingList(invoice, pl);
    expect(merged.warnings).toEqual([]);
    expect(merged.lines.map((l) => [l.quantity, l.piecesPerCarton, piecesLabel(l)])).toEqual([
      [5090, 60, '60 (+1 cx de 50)'],
      [18720, 60, '60'],
    ]);
    expect(mergePackingList(null, pl).lines.map((l) => [l.quantity, l.piecesPerCarton])).toEqual([
      [5090, 60],
      [18720, 60],
    ]);
  });

  it('invoice com o produto em duas linhas (duas POs): compara a soma', () => {
    const invoice = [
      line({ row: 18, description: 'Bluey Hora do Banho 01', isbn: BLUEY, quantity: 3000, orderCode: 'PO-050' }),
      line({ row: 19, description: 'Bluey Hora do Banho 01', isbn: BLUEY, quantity: 2090, orderCode: 'PO-060' }),
    ];
    const merged = mergePackingList(invoice, pl.slice(0, 2));
    expect(merged.warnings).toEqual([]);
    expect(merged.lines.map((l) => [l.quantity, l.piecesPerCarton, l.extraCartons ?? null])).toEqual([
      [3000, 60, [{ cartons: 1, pieces: 50 }]],
      [2090, 60, null],
    ]);
    const short = mergePackingList([invoice[0]!], pl.slice(0, 2));
    expect(short.warnings.map((w) => w.message)).toEqual(['"Bluey Hora do Banho 01": a invoice tem 3.000 e a packing list, 5.090. Vale a invoice.']);
  });
});

describe('pairShipmentFiles', () => {
  const file = (fileName: string, kind: 'invoice' | 'packing' | 'ambos', lines: DocumentLine[], over: Partial<ShipmentFile> = {}): ShipmentFile => {
    const doc = { sheet: 'x', number: null, lines, warnings: [], headerText: '' };
    return { fileName, invoice: kind !== 'packing' ? doc : null, packing: kind !== 'invoice' ? doc : null, number: null, container: null, headerText: fileName, ...over };
  };

  it('pareia invoice e packing list pelas linhas e pelo nome do arquivo; arquivo com as duas é um container', () => {
    const pi4 = file('Final PI-CTNR04_56th shipment.xlsx', 'invoice', [line({ quantity: 9878 })]);
    const pi5 = file('Final PI-CTNR05_56th shipment.xlsx', 'invoice', [line({ quantity: 4000 })]);
    const pl5 = file('PL-CTNR05_56th shipment.xlsx', 'packing', [line({ quantity: 4000 })]);
    const pl4 = file('PL-CTNR04_56th shipment.xlsx', 'packing', [line({ quantity: 9878 })]);
    const gn = file('GN-509.xlsx', 'ambos', [line({})]);
    const sozinho = file('PL-outro.xlsx', 'packing', [line({ isbn: ODISSEIA, description: 'A Odisseia' })]);
    const pairs = pairShipmentFiles([pi4, pl5, gn, pl4, pi5, sozinho]);
    expect(pairs.map((p) => [p.invoice?.fileName ?? null, p.packing?.fileName ?? null])).toEqual([
      ['GN-509.xlsx', 'GN-509.xlsx'],
      ['Final PI-CTNR04_56th shipment.xlsx', 'PL-CTNR04_56th shipment.xlsx'],
      ['Final PI-CTNR05_56th shipment.xlsx', 'PL-CTNR05_56th shipment.xlsx'],
      [null, 'PL-outro.xlsx'],
    ]);
  });

  it('o mesmo container nos dois arquivos decide', () => {
    const a = file('a.xlsx', 'invoice', [line({})], { container: 'YMLU5449045' });
    const b = file('b.xlsx', 'invoice', [line({})], { container: 'YMLU5443875' });
    const pb = file('c.xlsx', 'packing', [line({})], { container: 'YMLU5443875' });
    expect(pairShipmentFiles([a, b, pb]).map((p) => [p.invoice?.fileName, p.packing?.fileName ?? null])).toEqual([
      ['a.xlsx', null],
      ['b.xlsx', 'c.xlsx'],
    ]);
  });
});
