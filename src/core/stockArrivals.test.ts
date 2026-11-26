import { describe, expect, it } from 'vitest';
import { stockArrivals, type ArrivedInvoice } from './stockArrivals';

const invoice = (over: Partial<ArrivedInvoice> = {}): ArrivedInvoice => ({
  id: 'inv-1',
  number: '2026-47B',
  ref: '2026-10-13 (2)',
  supplier: 'Miyi',
  bill: 'ROECHN26101769',
  arrivedAt: '2026-11-25',
  container: 'YMLU5432079',
  containerKind: '40NOR',
  cartons: 2497,
  ...over,
});

describe('chegadas para o No Estoque', () => {
  it('cada invoice que chegou vai com os seus itens: código de barras, título, quantidade e peças por caixa', () => {
    const out = stockArrivals(
      [invoice(), invoice({ id: 'inv-2', number: '108', bill: null, supplier: null, container: '', containerKind: '', cartons: null })],
      [
        { invoiceId: 'inv-1', isbn: '978-65-5547-866-2', title: 'Coleção Minhas Primeiras 101 Palavras', description: 'Coleção 101 Palavras', quantity: 12000, piecesPerCarton: 20 },
        { invoiceId: 'inv-1', isbn: '8573261234', title: 'Livro antigo', description: '', quantity: 500, piecesPerCarton: 0 },
        { invoiceId: 'inv-2', isbn: null, title: ' ', description: 'Ecobag', quantity: 300, piecesPerCarton: null },
      ],
    );
    expect(out).toEqual([
      {
        id: 'inv-1',
        arrivedAt: '2026-11-25',
        supplier: 'Miyi',
        invoice: '2026-47B',
        ref: '2026-10-13 (2)',
        bill: 'ROECHN26101769',
        container: 'YMLU5432079',
        containerKind: '40NOR',
        cartons: 2497,
        items: [
          { barcode: '9786555478662', title: 'Coleção Minhas Primeiras 101 Palavras', quantity: 12000, piecesPerCarton: 20 },
          // O ISBN-10 vira o código de barras de 13 dígitos; caixa zerada não conta.
          { barcode: '9788573261233', title: 'Livro antigo', quantity: 500, piecesPerCarton: null },
        ],
      },
      { id: 'inv-2', arrivedAt: '2026-11-25', supplier: '', invoice: '108', ref: '2026-10-13 (2)', bill: null, container: '', containerKind: '', cartons: null, items: [{ barcode: null, title: 'Ecobag', quantity: 300, piecesPerCarton: null }] },
    ]);
  });
});
