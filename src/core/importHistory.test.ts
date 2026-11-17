import { describe, expect, it } from 'vitest';
import { chooseYear, parseArrivalText, parseHistoryRows, summarizeHistory, yearHint, type HistoryImportReport } from './importHistory';

describe('texto da chegada', () => {
  it('lê os formatos da planilha', () => {
    expect(parseArrivalText('chegada 19/04')).toEqual({ kind: 'chegada', day: 19, month: 4, year: null });
    expect(parseArrivalText('Chegada 10-08')).toEqual({ kind: 'chegada', day: 10, month: 8, year: null });
    expect(parseArrivalText('chegada 11/9')).toEqual({ kind: 'chegada', day: 11, month: 9, year: null });
    expect(parseArrivalText('Previsão chegada 12-01-24')).toEqual({ kind: 'previsao', day: 12, month: 1, year: 2024 });
    expect(parseArrivalText('recebido 25/06/24')).toEqual({ kind: 'chegada', day: 25, month: 6, year: 2024 });
    expect(parseArrivalText('entrgue 28-11')).toMatchObject({ kind: 'chegada', day: 28, month: 11 });
    expect(parseArrivalText('porto 24/01')).toMatchObject({ kind: 'porto' });
    expect(parseArrivalText('embarque 21/12')).toMatchObject({ kind: 'saida' });
    expect(parseArrivalText('saída 25/04')).toMatchObject({ kind: 'saida' });
    expect(parseArrivalText('pago')).toBeNull();
    expect(parseArrivalText('chegada 32/13')).toBeNull();
  });
});

describe('pista do ano', () => {
  it('pelo BL (ano e mês do embarque)', () => {
    expect(yearHint('', '', 'ROECHN25071889')).toEqual({ from: '2025-07', source: 'BL ROECHN25071889' });
  });

  it('pela invoice ou pela ref.', () => {
    expect(yearHint('', 'WWW20241210_1', '')).toEqual({ from: '2024-12', source: 'invoice WWW20241210_1' });
    expect(yearHint('', '2025-10A', '')).toEqual({ from: '2025-10', source: 'invoice 2025-10A' });
    expect(yearHint('23-1089', '', '')).toEqual({ from: '2023-01', source: 'ref. 23-1089' });
    expect(yearHint('24/049', '', '')).toMatchObject({ from: '2024-01' });
    expect(yearHint('SSL23/0573CT', '', '')).toMatchObject({ from: '2023-01' });
    expect(yearHint('IM24/00106', '', '')).toMatchObject({ from: '2024-01' });
    expect(yearHint('SS2024/0002', '', '')).toMatchObject({ from: '2024-01' });
    expect(yearHint('GN/23-24/232', '', '')).toMatchObject({ from: '2023-01' });
    expect(yearHint('GN-505', '', '')).toBeNull();
    expect(yearHint('33rd shipment (2)', '', '')).toBeNull();
  });

  it('escolhe o ano a partir do embarque: dezembro de 2024 e chegada em 25/01 é 2025', () => {
    expect(chooseYear(25, 1, { from: '2024-12', source: '' }, null)).toBe(2025);
    expect(chooseYear(29, 8, { from: '2025-07', source: '' }, null)).toBe(2025);
    expect(chooseYear(22, 5, { from: '2023-01', source: '' }, null)).toBe(2023);
  });

  it('nunca no futuro', () => {
    expect(chooseYear(21, 3, null, '2026-11-08', '2026-11-17')).toBe(2026);
    expect(chooseYear(20, 12, { from: '2026-10', source: '' }, null, '2026-11-17')).toBe(2025);
  });

  it('sem pista, pela linha anterior', () => {
    expect(chooseYear(10, 1, null, '2024-12-20')).toBe(2025);
    expect(chooseYear(15, 12, null, '2024-12-20')).toBe(2024);
    expect(chooseYear(15, 12, null, null)).toBeNull();
  });
});

// Linhas como na aba Entregues de 17/11/2026 (o cabeçalho deslocado é o da planilha).
const HEADER = ['Ref. embarque', 'Produto', 'ISBN', 'pcs/ctn', 'Quantidade', '$ unitário', '$ total', 'Fornecedor', 'Fornecedor', 'Chegada na Editora', '', ''];
const rows = [
  HEADER,
  ['23-1089', 'Escolinha Divertida Extra - Alfabeto', '', '', '10000', '0.75', '7500', 'Sara', 'Chegada dia 22/05', '', '', ''],
  ['-', 'Livro A', '', '', '1000', '0.5', '500', 'Kaushik', 'entrega 21/02', 'pago', 'Export/268/24-25', ''],
  ['-', 'Livro B', '', '', '2000', '0.5', '1000', 'Sara', 'chegada 21/02', 'Pago', '', ''],
  ['-', 'Livro C', '', '', '3000', '0.5', '1500', 'Sara', 'chegada 21/02', 'Pago', '', ''],
  ['00414-1124SS (1)', 'Livro D', '', '', '500', '1', '500', 'Sara', 'previsão 10/01', 'chegada 25/01', 'WWW20241210_1', 'ROECHN24121311'],
  ['GN-505', 'Livro E', '', '', '100', '1', '100', 'Apurv', 'embarque 25/12', 'pago', '', ''],
  ['HSC20260718', 'Livro F', '', '', '100', '1', '100', 'Nicola', '08/11/2026', 'Pago', 'HSC20260718', 'ROECHN26093050'],
  ['GN-572', 'Livro G', '', '', '100', '1', '100', 'Apurv', '', 'Pago 2/3', '', ''],
  ['2862 ctn4', ' ', '9786584956254', '', '3000', '2.4', '7200', 'Claire', 'chegada 21/03', 'Pago', '', ''],
  ['', '', '', '', '1918496', '', '1157134.5', '', '', '', '', ''],
];

function parse(): HistoryImportReport {
  const r = parseHistoryRows(rows, '2026-11-17');
  if ('error' in r) throw new Error(r.error);
  return r;
}

describe('carga da aba Entregues', () => {
  it('deduz o ano e guarda o texto original', () => {
    const { items } = parse();
    expect(items[0]).toMatchObject({ invoice: '23-1089', ref: '23-1089', arrivedAt: '2023-05-22', arrivalNote: 'Chegada na planilha: "Chegada dia 22/05" (ano pela ref. 23-1089)' });
  });

  it('sem invoice nem ref., agrupa as linhas seguidas com a mesma chegada e o mesmo fornecedor', () => {
    const { items } = parse();
    expect(items[1]!.invoice).toBe('Export/268/24-25');
    expect(items[2]!.invoice).toBe('Planilha, linha 4');
    expect(items[3]!.invoice).toBe('Planilha, linha 4');
    // Sem pista do ano: vale a linha anterior (21/02, depois de 2024-02-21).
    expect(items[2]!.arrivedAt).toBe('2024-02-21');
  });

  it('quando a coluna do pagamento traz a chegada, ela vale no lugar da previsão', () => {
    const d = parse().items[4]!;
    expect(d.arrivedAt).toBe('2025-01-25');
    expect(d.paid).toBe(false);
    expect(d.notes).toContain('previsão 10/01');
  });

  it('data de embarque não vira chegada', () => {
    const e = parse().items[5]!;
    expect(e.arrivedAt).toBeNull();
    expect(e.arrivalNote).toBe('Na planilha só há a data de embarque: "embarque 25/12"');
  });

  it('data de verdade, pagamento e "Pago 2/3"', () => {
    const { items, warnings } = parse();
    expect(items[6]).toMatchObject({ arrivedAt: '2026-11-08', paid: true, invoice: 'HSC20260718', bill: 'ROECHN26093050' });
    expect(items[7]).toMatchObject({ arrivedAt: null, paid: true, notes: 'Pagamento na planilha: Pago 2/3' });
    expect(warnings.some((w) => w.row === 9 && w.message.includes('sem data de chegada'))).toBe(true);
  });

  it('ignora a linha de soma', () => {
    expect(parse().skipped).toEqual([{ row: 11, message: 'Linha sem produto.' }]);
  });

  it('item sem nome, mas com ISBN e quantidade, entra com nome provisório', () => {
    const { items, warnings } = parse();
    expect(items[8]).toMatchObject({ description: 'Produto sem nome (ISBN 9786584956254)', quantity: 3000 });
    expect(warnings.some((w) => w.row === 10 && w.message.includes('nome provisório'))).toBe(true);
  });

  it('resume por ano de chegada', () => {
    const s = summarizeHistory(parse().items);
    expect(s.byYear.map((r) => [r.year, r.items])).toEqual([
      ['2023', 1],
      ['2024', 3],
      ['2025', 1],
      ['2026', 2],
      ['Sem data', 2],
    ]);
    expect(s.withoutDate).toBe(2);
    expect(s.invoices).toBe(8);
  });

  it('os separadores de ano da aba definem o ano da chegada; o bloco antes do primeiro é o ano anterior', () => {
    const r = parseHistoryRows(
      [
        HEADER,
        ['GN-505', 'Antes do separador', '', '', '100', '1', '100', 'Apurv', 'chegou 18/04', 'pago', '', ''],
        ['2024', '2024', '', '', '', '', '', '', '', '', '', ''],
        ['23-1224IM', 'Ref. de 2023, chegou em 2024', '', '', '100', '1', '100', 'Sara', 'chegada 05/01', 'pago', '', ''],
        ['2025', '2025', '', '', '', '', '', '', '', '', '', ''],
        ['X', 'Bloco 2025', '', '', '100', '1', '100', 'Sara', 'chegada 30/12', 'pago', '', 'ROECHN24110223'],
      ],
      '2026-11-17',
    );
    if ('error' in r) throw new Error(r.error);
    expect(r.items.map((i) => i.arrivedAt)).toEqual(['2023-04-18', '2024-01-05', '2025-12-30']);
    expect(r.items[1]!.arrivalNote).toBe('Chegada na planilha: "chegada 05/01" (ano pelo bloco 2024 da planilha)');
    expect(r.skipped).toEqual([]);
  });

  it('recusa aba com outra disposição de colunas', () => {
    expect(parseHistoryRows([['Quantidade', 'Produto'], ['1', 'x']])).toEqual({ error: expect.stringContaining('coluna B') });
  });
});
