import { describe, expect, it } from 'vitest';
import { parseShipmentRows, shipmentKey, summarizeShipments, type ShipmentImportReport } from './importShipments';

// Linhas como saem da aba Embarques de 17/11/2026, já em texto.
const HEADER = ['Ref. embarque', 'Produto', 'ISBN', 'pcs/ctn', 'Quantidade', '$ unitário', '$ total', 'Fornecedor', 'Chegada', 'Pagamento', 'Invoice', 'BL'];
const rows = [
  HEADER,
  [' 2026-09-25 (1)', 'Cartilha Mágica 01 - Alfabeto', '9786561267106', '40', '9440', '0.33', '3115.2', 'Sara', '20/11/2026', 'pago', '2026-46A', 'ROECHN26093881'],
  [' 2026-09-25 (2)', 'Patrulha Canina Colorindo com Adesivos 05', '9786561266987', '100', '10000', '0.25', '2500', 'Sara', '20/11/2026', 'pago', '2026-46B', 'ROECHN26093881'],
  // A ref. virou data no Google Planilhas.
  ['26/10/2026', 'Bluey Aquabook 01', '', '', '5000', '0.52', '2600', 'Sara', '10/12/2026', 'Pago', '2026W-1A', 'ROECHN26102718'],
  // Invoice sem BL (Kaushik).
  ['', 'Livro do Kaushik', '', '', '2000', '0.4', '800', 'Kaushik', '21/11/2026', 'Pago', '108', ''],
  ['', 'Sem invoice', '', '', '100', '1', '100', 'Sara', '', '', '', ''],
  ['-', '', '', '', '', '', '0', '', '', '', '', ''],
  ['', '', '', '', '1918496', '', '1157134.5', '', '', '', '', ''],
];

function parse(): ShipmentImportReport {
  const r = parseShipmentRows(rows);
  if ('error' in r) throw new Error(r.error);
  return r;
}

describe('carga da aba Embarques', () => {
  it('lê invoice, ref., BL, chegada e pagamento', () => {
    const { items } = parse();
    expect(items).toHaveLength(4);
    expect(items[0]).toMatchObject({
      row: 2,
      description: 'Cartilha Mágica 01 - Alfabeto',
      supplier: 'Sara',
      quantity: 9440,
      unitPriceMicros: 330_000,
      invoice: '2026-46A',
      ref: '2026-09-25 (1)',
      bill: 'ROECHN26093881',
      eta: '2026-11-20',
      paid: true,
    });
  });

  it('a ref. que virou data volta para AAAA-MM-DD', () => {
    expect(parse().items[2]!.ref).toBe('2026-10-26');
  });

  it('invoice sem BL entra, com aviso; a chegada fica na invoice', () => {
    const { items, warnings } = parse();
    expect(items[3]).toMatchObject({ invoice: '108', bill: null, eta: '2026-11-21' });
    expect(warnings.some((w) => w.row === 5 && w.message.includes('sem BL'))).toBe(true);
  });

  it('sem invoice não entra; linhas vazias e a de soma são ignoradas', () => {
    const { skipped } = parse();
    expect(skipped).toEqual([
      { row: 6, message: '"Sem invoice": sem invoice.' },
      { row: 8, message: 'Linha sem produto.' },
    ]);
  });

  it('precisa da coluna Invoice', () => {
    expect(parseShipmentRows([['Produto', 'Quantidade'], ['Livro', '10']])).toEqual({ error: expect.stringContaining('Invoice') });
  });
});

describe('resumo e repetição', () => {
  it('resume por invoice e conta os BLs', () => {
    const s = summarizeShipments(parse().items);
    expect(s.invoices.map((i) => [i.invoice, i.bill, i.items, i.valueCents])).toEqual([
      ['2026-46A', 'ROECHN26093881', 1, 311_520],
      ['2026-46B', 'ROECHN26093881', 1, 250_000],
      ['2026W-1A', 'ROECHN26102718', 1, 260_000],
      ['108', null, 1, 80_000],
    ]);
    expect(s.bills).toBe(2);
    expect(s.total).toEqual({ items: 4, quantity: 26_440, valueCents: 901_520 });
  });

  it('a chave junta invoice, produto, quantidade e preço', () => {
    expect(shipmentKey(parse().items[0]!)).toBe('2026-46A|9786561267106|cartilha magica 01 - alfabeto|9440|330000');
  });
});
