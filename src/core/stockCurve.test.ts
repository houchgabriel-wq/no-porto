// Leitura da planilha da curva ABC (20/11/2026), com o cabeçalho da planilha real de 19/11/2026.
import { describe, expect, it } from 'vitest';
import { barcodeKey, curveDateFromName, quantityValue, readStockCurve, type CurveRead } from './stockCurve';

const HEADER = [
  'Produto',
  'Descrição',
  'Codigo Barras',
  'Valor Total',
  'Percentual',
  'Perc. Acumulativo',
  'Classe',
  'Estoque Atual',
  'Vendidos no período',
  'Média Mensal',
  'Estoque para 12 Meses',
  'Diferença de Estoque',
  'Vendas 1 mês',
  'Vendas 3 meses',
  'Vendas 6 meses',
  'Vendas 9 meses',
  'Vendas 12 meses',
  'Qtde Comprada',
];

/** Uma linha como sai da planilha: código, nome, código de barras, classe, estoque e vendas de 1, 3, 6, 9 e 12 meses. */
const line = (code: string, title: string, barcode: string, abc: string, stock: string, sales: string[]) => [
  code,
  title,
  barcode,
  '2847481.11',
  '0.047985',
  '0.048',
  abc,
  stock,
  '156550',
  '52183',
  '626196',
  '-584296',
  ...sales,
  '130001',
];

const read = (rows: string[][]) => readStockCurve(rows) as CurveRead;

describe('leitura da curva ABC', () => {
  it('lê cada título com o estoque e as vendas de cada período, sem os valores em dinheiro; a linha do total fica de fora', () => {
    const result = read([
      HEADER,
      line('33667', '365 Hábitos Simples e Poderosos - Paulo Houch - Camelot Editora', '9786560950702', 'A', '41900', ['32643', '113422', '245531', '384523', '486774']),
      line('31856', 'Revista Pôster Bandeira do Brasil Projetos Escolares 01', '7898084025476', 'C', '2860', ['0', '1', '2', '2', '2']),
      ['', '', '', '59.376.790,20', '', '', '', '', '', '', '', '', '', '', '', '', '', ''],
    ]);
    expect(result).toEqual({
      rows: [
        {
          isbn: '9786560950702',
          title: '365 Hábitos Simples e Poderosos - Paulo Houch - Camelot Editora',
          code: '33667',
          abcClass: 'A',
          stock: 41900,
          sales: { m1: 32643, m3: 113422, m6: 245531, m9: 384523, m12: 486774 },
        },
        {
          isbn: '7898084025476',
          title: 'Revista Pôster Bandeira do Brasil Projetos Escolares 01',
          code: '31856',
          abcClass: 'C',
          stock: 2860,
          sales: { m1: 0, m3: 1, m6: 2, m9: 2, m12: 2 },
        },
      ],
      ignored: [],
      merged: [],
      negativeStock: 0,
      negativeSales: 0,
    });
  });

  it('soma o mesmo código em duas linhas e descarta o que não tem código de barras, com o motivo', () => {
    const result = read([
      HEADER,
      line('25266', 'BATMAN GUARDIÃO DA CIDADE DE GOTHAM ED 01', '9788543230382', 'C', '2824', ['5', '7', '13', '28', '30']),
      line('23143', 'CONTEUDO DE REVISTA DIGITAL', '600402', 'A', '0', ['10', '24', '71', '93', '100']),
      line('25316', 'Batman Guardião Da Cidade De Gotham Ed 01', '978-85-43230-38-2', 'C', '2043', ['4', '15', '26', '31', '44']),
      line('1', 'Livro sem código', '', 'C', '5', ['1', '1', '1', '1', '1']),
      line('2', 'Estoque escrito errado', '9786580921232', 'A', 'muito', ['1', '1', '1', '1', '1']),
    ]);
    expect(result.rows).toEqual([
      {
        isbn: '9788543230382',
        title: 'BATMAN GUARDIÃO DA CIDADE DE GOTHAM ED 01',
        code: '25266, 25316',
        abcClass: 'C',
        stock: 4867,
        sales: { m1: 9, m3: 22, m6: 39, m9: 59, m12: 74 },
      },
    ]);
    expect(result.merged).toEqual([{ isbn: '9788543230382', title: 'BATMAN GUARDIÃO DA CIDADE DE GOTHAM ED 01', lines: 2 }]);
    expect(result.ignored).toEqual([
      { row: 3, text: 'CONTEUDO DE REVISTA DIGITAL', reason: 'o código 600402 não é ISBN nem código de barras' },
      { row: 5, text: 'Livro sem código', reason: 'sem código de barras' },
      { row: 6, text: 'Estoque escrito errado', reason: '"Estoque Atual" não é um número' },
    ]);
  });

  it('acha o cabeçalho abaixo de um título; aceita só as colunas obrigatórias; estoque ou venda negativos contam como zero', () => {
    const result = read([
      ['Curva ABC de produtos', '', '', '', ''],
      [],
      ['Código de barras', 'Título', 'Estoque', 'Vendas 3 meses', 'Vendas 6 meses'],
      ['85-359-0277-5', 'Livro antigo', '-12', '300', '600'],
      ['9786560950702', 'Devolução maior que a venda', '50', '-10', '600'],
    ]);
    expect(result.rows).toEqual([
      { isbn: '9788535902778', title: 'Livro antigo', code: '', abcClass: '', stock: 0, sales: { m1: null, m3: 300, m6: 600, m9: null, m12: null } },
      { isbn: '9786560950702', title: 'Devolução maior que a venda', code: '', abcClass: '', stock: 50, sales: { m1: null, m3: 0, m6: 600, m9: null, m12: null } },
    ]);
    expect([result.negativeStock, result.negativeSales]).toEqual([1, 1]);
  });

  it('sem as colunas, diz quais faltam', () => {
    expect(readStockCurve([['Produto', 'Descrição', 'Codigo Barras', 'Estoque Atual', 'Vendas 1 mês']])).toEqual({
      error: 'A planilha não parece a curva ABC: faltam as colunas "Vendas 3 meses", "Vendas 6 meses".',
    });
  });

  it('código de barras: ISBN-13, ISBN-10 (vira ISBN-13), outros códigos de barras; o resto não serve', () => {
    expect(barcodeKey('978-65-60950-70-2')).toBe('9786560950702');
    expect(barcodeKey('85-359-0277-5')).toBe('9788535902778');
    expect(barcodeKey('7898084025476')).toBe('7898084025476');
    expect(barcodeKey('12345678')).toBe('12345678');
    expect(barcodeKey('600402')).toBeNull();
    expect(barcodeKey('85-359-0277-4')).toBeNull();
    expect(barcodeKey('ISBN')).toBeNull();
  });

  it('quantidades: inteiro, com ponto ou vírgula de milhar, vazio é zero; texto não é número', () => {
    expect(quantityValue('41900')).toBe(41900);
    expect(quantityValue('41.900')).toBe(41900);
    expect(quantityValue('41,900')).toBe(41900);
    expect(quantityValue('12,6')).toBe(13);
    expect(quantityValue('')).toBe(0);
    expect(quantityValue('-5')).toBe(-5);
    expect(quantityValue('muito')).toBeNull();
  });

  it('a data do estoque vem do nome do arquivo ou da aba, sem passar de hoje', () => {
    const today = '2026-11-20';
    expect(curveDateFromName(['curva_abc_19-11.xlsx'], today)).toBe('2026-11-19');
    expect(curveDateFromName(['planilha.xlsx', 'curva abc 19-11'], today)).toBe('2026-11-19');
    expect(curveDateFromName(['curva 30.11.xlsx'], today)).toBe('2025-11-30');
    expect(curveDateFromName(['curva 18/11/26.xlsx'], today)).toBe('2026-11-18');
    expect(curveDateFromName(['curva 2026-11-17.xlsx'], today)).toBe('2026-11-17');
    expect(curveDateFromName(['curva 32-13.xlsx', 'curva.xlsx'], today)).toBeNull();
    expect(curveDateFromName(['curva 01-12-2026.xlsx'], today)).toBeNull();
  });
});
