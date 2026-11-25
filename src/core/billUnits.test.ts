import { describe, expect, it } from 'vitest';
import { cartonsOf, formatVolume, formatWeight, matchUnits, packingTotals, readBillUnits, unitDifference, unitSummary, type BillUnit } from './billUnits';
import { parseShipmentFile } from './documents';

// O texto do HBL do 57º embarque da Miyi (B/L ROECHN26112871), como o pdf.js tira do PDF.
const HBL = `Marks & Nos.Container/Seal No. Quantity/Kinds of Packages Description of Goods(If Dangerous Goods,See Clause 20) Gross Weight KGS Measurement
Booking No. B/L No.
B226053710001 B226053710002 ROECHN26112871
5441CARTONS BOOKS
40NOR*2
49470.000KGS 114.07CBM
YMLU5432079/YMAX802369/40NOR/2497CARTONS/24430.000KGS/57.840CBM
YMLU5468929/YMAX802240/40NOR/2944CARTONS/25040.000KGS/56.230CBM
Total Number of containers And / or Packages(in words) SAY:FIVE THOUSAND FOUR HUNDRED FORTY ONE`;

const U1: BillUnit = { container: 'YMLU5432079', seal: 'YMAX802369', kind: '40NOR', cartons: 2497, weightGrams: 24_430_000, volumeLiters: 57_840 };
const U2: BillUnit = { container: 'YMLU5468929', seal: 'YMAX802240', kind: '40NOR', cartons: 2944, weightGrams: 25_040_000, volumeLiters: 56_230 };

describe('unidades do BL', () => {
  it('lê uma unidade por linha: container, lacre, tipo, caixas, peso e cubagem', () => {
    expect(readBillUnits(HBL)).toEqual([U1, U2]);
    // Espaços em volta das barras, milhar com vírgula e outros nomes de embalagem também servem.
    expect(readBillUnits('TCNU 1234567 / SL998877 / 40HC / 1,200 CTNS / 20,150.500 KGS / 61.5 CBM')).toEqual([
      { container: 'TCNU1234567', seal: 'SL998877', kind: '40HC', cartons: 1200, weightGrams: 20_150_500, volumeLiters: 61_500 },
    ]);
    // O total do BL ("5441CARTONS ... 49470.000KGS") não é unidade; sem as linhas, nenhuma.
    expect(readBillUnits('5441CARTONS BOOKS 49470.000KGS 114.07CBM')).toEqual([]);
  });

  it('caixas e peso da packing list: a soma das linhas, ou as peças por caixa', () => {
    expect(packingTotals([
      { quantity: 6000, piecesPerCarton: 40, cartons: 150, grossWeightGrams: 1_680_000 },
      { quantity: 5000, piecesPerCarton: 12, cartons: 417, grossWeightGrams: 4_211_700 },
    ])).toEqual({ cartons: 567, weightGrams: 5_891_700 });
    // Sem a coluna das caixas, pelas peças por caixa (a caixa de sobra conta); sem o peso de alguma linha, sem peso.
    expect(packingTotals([
      { quantity: 5090, piecesPerCarton: 60, grossWeightGrams: 1_000_000 },
      { quantity: 3000, piecesPerCarton: 40 },
    ])).toEqual({ cartons: 85 + 75, weightGrams: null });
    expect(cartonsOf([{ quantity: 7500, piecesPerCarton: 16 }])).toBe(469);
    expect(cartonsOf([{ quantity: 7500, piecesPerCarton: null }])).toBeNull();
  });

  it('liga pelo número do container e, sem ele, pelas caixas e pelo peso', () => {
    const units = [U1, U2];
    const m = matchUnits(
      [
        { key: 'a', container: 'ymlu 5468929', cartons: 2944, weightGrams: 25_040_000 },
        { key: 'b', container: null, cartons: 2497, weightGrams: 24_430_400 },
      ],
      units,
    );
    expect([m.get('a')?.unit.container, m.get('a')?.by, m.get('b')?.unit.container, m.get('b')?.by]).toEqual(['YMLU5468929', 'container', 'YMLU5432079', 'medidas']);
  });

  it('não liga quando não dá para ter certeza', () => {
    // Duas unidades iguais: a escolha fica com a pessoa.
    const twin = { ...U1, container: 'YMLU0000001' };
    expect(matchUnits([{ key: 'a', container: null, cartons: 2497, weightGrams: 24_430_000 }], [U1, twin]).size).toBe(0);
    // O container informado não está no BL: não liga pelas medidas.
    expect(matchUnits([{ key: 'a', container: 'ABCU1234567', cartons: 2497, weightGrams: 24_430_000 }], [U1]).size).toBe(0);
    // Sem caixas nem peso, não há o que comparar; peso muito diferente, também não.
    expect(matchUnits([{ key: 'a', container: null, cartons: null, weightGrams: null }], [U1]).size).toBe(0);
    expect(matchUnits([{ key: 'a', container: null, cartons: null, weightGrams: 20_000_000 }], [U1]).size).toBe(0);
    // Uma unidade, dois containers que servem: nenhum fica com ela.
    expect(matchUnits([{ key: 'a', container: null, cartons: 2497, weightGrams: null }, { key: 'b', container: null, cartons: 2497, weightGrams: null }], [U1]).size).toBe(0);
  });

  it('avisa quando a packing list e o BL não batem', () => {
    expect(unitDifference({ cartons: 2497, weightGrams: 24_430_000 }, U1)).toBeNull();
    expect(unitDifference({ cartons: 2500, weightGrams: 24_430_000 }, U1)).toBe('A packing list tem 2.500 caixas e 24.430 kg; o BL, 2.497 caixas e 24.430 kg. Confira.');
  });

  it('a unidade numa linha', () => {
    expect(unitSummary(U1)).toBe('YMLU5432079 · lacre YMAX802369 · 40NOR · 2.497 caixas · 24.430 kg · 57,84 m³');
    expect(formatWeight(24_430_500)).toBe('24.430,5 kg');
    expect(formatVolume(114_070)).toBe('114,07 m³');
    expect(unitSummary({ container: 'YMLU5432079', seal: '', kind: '', cartons: null, weightGrams: null, volumeLiters: null })).toBe('YMLU5432079');
  });
});

describe('57º embarque da Miyi: packing list e BL', () => {
  // A packing list do container 1, como a planilha chega (o número do container no cabeçalho).
  const header = ['ITEM', 'PO', 'Description for products', 'No. of Cartons', 'Qty per Ctn', '', 'Total Qty    per title', 'NW (kgs)', 'Total NW', 'GW (kgs)', 'Total GW', 'Carton Size (cm)', '', '', '', '', 'Total Meas (cbm)', '1× 45RI\n\nContainer NO.:YMLU5432079\n\n\nSeal NO.'];
  const line = (name: string, cartons: number, perCtn: number, qty: number, totalGw: string) => [name, '', '15,1x23cm', String(cartons), String(perCtn), 'pcs', String(qty), '', '', '', totalGw, '', '', '', '', '', '', ''];
  const rows = [
    ['Guangzhou Miyi Printing Co., Ltd.'],
    ['PACKING LIST'],
    header,
    line('Livro Cartas a Milena - Franz Kafka - Camelot', 150, 40, 6000, '1680'),
    line('Box Biblioteca Machado de Assis Volume 01', 417, 12, 5000, '4211.7'),
    line('Box Biblioteca Machado de Assis Volume 02', 108, 14, 1500, '831.6'),
    line('Dos Delitos e das Penas', 139, 36, 5000, '1459.5'),
    line('Curso Básico de Desenho - Mangá', 139, 36, 5000, '1223.2'),
    line('Bluey Hora de Dormir 01', 50, 80, 4000, '570'),
    line('Livro A Revolução dos Bichos', 50, 60, 3000, '465.00000000000006'),
    line('Livro Cartas a Milena - Série Ouro', 150, 20, 3000, '1110'),
    line('Livro Plantas e Alimentos que Curam', 100, 40, 4000, '1070'),
    line('Livro Segunda Guerra História Ilustrada', 75, 40, 3000, '735'),
    line('Livro Bhagavad Gita', 25, 80, 2000, '265'),
    line('Crime e Castigo Série Ouro', 469, 16, 7500, '5309.000000000001'),
    line('Box Biblioteca Dostoiévski Série Ouro', 625, 4, 2500, '5500'),
    ['', '', '', '2497', '', '', '51500', '', '23431.2', '', '24430', '', '', '', '', '', '57.8399', ''],
  ];

  it('a packing list traz o container, as caixas e o peso, que batem com a unidade do BL', () => {
    const file = parseShipmentFile([{ name: 'PL', rows }], 'PL-CTNR01_57th_shipment.xlsx');
    if ('error' in file) throw new Error(file.error);
    expect(file.container).toBe('YMLU5432079');
    const totals = packingTotals(file.packing!.lines);
    expect(totals).toEqual({ cartons: 2497, weightGrams: 24_430_000 });
    const m = matchUnits([{ key: 'ctnr01', container: file.container, ...totals }], readBillUnits(HBL));
    expect(m.get('ctnr01')).toEqual({ unit: U1, by: 'container' });
    expect(unitDifference(totals, U1)).toBeNull();
    // Sem o número no cabeçalho, as caixas e o peso bastam.
    const noNumber = rows.map((r) => (r === header ? header.map((h) => (h.includes('Container') ? '1× 45RI' : h)) : r));
    const other = parseShipmentFile([{ name: 'PL', rows: noNumber }], 'PL.xlsx');
    if ('error' in other) throw new Error(other.error);
    expect(other.container).toBeNull();
    expect(matchUnits([{ key: 'x', container: null, ...packingTotals(other.packing!.lines) }], [U1, U2]).get('x')).toEqual({ unit: U1, by: 'medidas' });
  });
});
