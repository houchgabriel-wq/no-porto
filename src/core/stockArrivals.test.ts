import { describe, expect, it } from 'vitest';
import { forStock, stockArrivals, type ArrivedFiscalFile, type ArrivedInvoice } from './stockArrivals';

const invoice = (over: Partial<ArrivedInvoice> = {}): ArrivedInvoice => ({
  id: 'inv-1',
  number: '2026-47B',
  ref: '2026-10-13 (2)',
  supplier: 'Miyi',
  billId: 'bl-1',
  bill: 'ROECHN26101769',
  eta: '2026-11-20',
  arrivedAt: '2026-11-25',
  container: 'YMLU5432079',
  containerKind: '40NOR',
  cartons: 2497,
  weightGrams: 24_430_000,
  volumeLiters: 57_840,
  ...over,
});

describe('chegadas para o No Estoque', () => {
  it('cada invoice que chegou vai com os seus itens: código de barras, título, quantidade e peças por caixa', () => {
    const out = stockArrivals(
      [invoice(), invoice({ id: 'inv-2', number: '108', billId: null, bill: null, supplier: null, arrivedAt: null, container: '', containerKind: '', cartons: null, weightGrams: null, volumeLiters: null })],
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
        eta: '2026-11-20',
        supplier: 'Miyi',
        invoice: '2026-47B',
        ref: '2026-10-13 (2)',
        bill: 'ROECHN26101769',
        container: 'YMLU5432079',
        containerKind: '40NOR',
        cartons: 2497,
        weightGrams: 24_430_000,
        volumeLiters: 57_840,
        items: [
          { barcode: '9786555478662', title: 'Coleção Minhas Primeiras 101 Palavras', quantity: 12000, piecesPerCarton: 20 },
          // O ISBN-10 vira o código de barras de 13 dígitos; caixa zerada não conta.
          { barcode: '9788573261233', title: 'Livro antigo', quantity: 500, piecesPerCarton: null },
        ],
        fiscalNote: null,
        masterFiscalNote: null,
      },
      {
        id: 'inv-2',
        arrivedAt: null,
        eta: '2026-11-20',
        supplier: '',
        invoice: '108',
        ref: '2026-10-13 (2)',
        bill: null,
        container: '',
        containerKind: '',
        cartons: null,
        weightGrams: null,
        volumeLiters: null,
        items: [{ barcode: null, title: 'Ecobag', quantity: 300, piecesPerCarton: null }],
        fiscalNote: null,
        masterFiscalNote: null,
      },
    ]);
  });

  it('a nota do container e a master do BL, com o que foi lido do XML; o conteúdo vem à parte', () => {
    const K1 = '35261212345678000195550010000123451000123459';
    const MASTER = '35261212345678000195550010000123001000123007';
    const file = (over: Partial<ArrivedFiscalFile>): ArrivedFiscalFile => ({
      id: 'f',
      invoiceId: null,
      billId: null,
      kind: 'xml',
      name: 'nfe.xml',
      contentType: 'application/xml',
      size: 40_000,
      key: null,
      number: null,
      series: null,
      issuedAt: null,
      ...over,
    });
    const fiscal = [
      file({ id: 'x1', invoiceId: 'inv-1', key: K1, number: '12345', series: '1', issuedAt: '2026-12-05' }),
      file({ id: 'p1', invoiceId: 'inv-1', kind: 'pdf', name: 'DANFE 12345.pdf', contentType: 'application/pdf', size: 120_000, key: K1 }),
      // A master só com o PDF: o número e a série saem da chave lida nele.
      file({ id: 'pm', billId: 'bl-1', kind: 'pdf', name: 'DANFE master.pdf', contentType: 'application/pdf', size: 150_000, key: MASTER }),
    ];
    const [a, b, c] = stockArrivals([invoice(), invoice({ id: 'inv-2', number: '2026-47C' }), invoice({ id: 'inv-3', billId: null, bill: null })], [], fiscal);
    expect(a!.fiscalNote).toEqual({
      key: K1,
      number: '12345',
      series: '1',
      issuedAt: '2026-12-05',
      pdf: { id: 'p1', name: 'DANFE 12345.pdf', contentType: 'application/pdf', size: 120_000 },
      xml: { id: 'x1', name: 'nfe.xml', contentType: 'application/xml', size: 40_000 },
    });
    const master = { key: MASTER, number: '12300', series: '1', issuedAt: null, pdf: { id: 'pm', name: 'DANFE master.pdf', contentType: 'application/pdf', size: 150_000 }, xml: null };
    expect(a!.masterFiscalNote).toEqual(master);
    // O outro container do BL vai com a mesma master e sem nota própria; a invoice sem BL, sem as duas.
    expect([b!.fiscalNote, b!.masterFiscalNote]).toEqual([null, master]);
    expect([c!.fiscalNote, c!.masterFiscalNote]).toEqual([null, null]);
  });

  it('vão os containers em liberação, como na tela Embarques, e os que chegaram a partir do dia pedido', () => {
    const today = '2026-11-26';
    // Em liberação: a previsão passou e a chegada não foi registrada.
    expect(forStock({ eta: '2026-11-25', arrivedAt: null }, '2026-11-26', today)).toBe(true);
    // A caminho (chega hoje ou depois) e sem previsão: ainda não.
    expect(forStock({ eta: '2026-11-26', arrivedAt: null }, '2026-11-26', today)).toBe(false);
    expect(forStock({ eta: null, arrivedAt: null }, '2026-11-26', today)).toBe(false);
    // Chegou: só a partir do dia pedido (o histórico não vai).
    expect(forStock({ eta: '2026-11-20', arrivedAt: '2026-11-26' }, '2026-11-26', today)).toBe(true);
    expect(forStock({ eta: '2026-11-20', arrivedAt: '2026-11-25' }, '2026-11-26', today)).toBe(false);
  });
});
