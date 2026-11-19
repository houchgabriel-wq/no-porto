import { describe, expect, it } from 'vitest';
import { findContainer, findIsbn, lotsFromComment, parseInvoiceDocument, parseOrderDocument, parseQuantity, parseShipmentFile } from './documents';

const pad = (row: string[], n = 11) => [...row, ...Array(Math.max(0, n - row.length)).fill('')];

// Modelo da PO da editora (PO-064 da Sara), sem o número da PO preenchido.
const PO = [
  pad(['IBC - INSTITUTO BRASILEIRO DE CULTURA LTDA']),
  pad(['PRINTING ORDER']),
  pad(['To:', 'Sara', '', '', '', '', '', '', '', ' Date', '2026-11-09']),
  pad(['From:', 'GABRIEL', '', '', '', '', '', '', '', 'Order No.:', '']),
  ['Reference', 'Name', 'Specifications', 'Shrink wrap?', 'ISBN', 'pcs/ctn', 'Quantity', 'Unit Price\n($ USD)', 'Amount\n($ USD)', 'Comments', 'Estimated Shipping Date'],
  ['1', 'Caligráfia Mágica - Nova Cartilha 02', '20,5x27,5', 'POLYBAG', '978-65-6126-058-9', '40', '30,000', '$0.4200', '$12,600.00', 'RUSH', '15-Dec-2026'],
  ['2', 'Livro 7 Minutos com Deus', 'spec', 'yes', '', '48', '10,000', '$0.4200', '$4,200.00', 'asap', 'asap'],
  ['3', 'Livro com ISBN errado', 'spec', 'yes', '978-65-6126-058-0', '', '1,000', '', '', '', ''],
  pad(['TOTAL', 'TOTAL', 'TOTAL', 'TOTAL', 'TOTAL', '', '41,000', '', '$16,800.00']),
  pad(['1. Payment term: 100% on shipping']),
];

describe('parseQuantity', () => {
  it('lê inteiros com separador de milhar ou ,0 no fim', () => {
    expect(parseQuantity('30,000')).toBe(30000);
    expect(parseQuantity('1.250.000')).toBe(1250000);
    expect(parseQuantity('8680.0')).toBe(8680);
    expect(parseQuantity('9878')).toBe(9878);
  });
  it('recusa o que não é quantidade', () => {
    expect(parseQuantity('')).toBeNull();
    expect(parseQuantity('0')).toBeNull();
    expect(parseQuantity('1,5')).toBeNull();
    expect(parseQuantity('set')).toBeNull();
  });
});

describe('findIsbn', () => {
  it('acha o ISBN no meio do texto e confere o dígito', () => {
    expect(findIsbn('Coleção Alice - Atlantis Editora\n978-65-83970-52-7')).toBe('9786583970527');
    expect(findIsbn('ISBN : 978-65-5547-558-6')).toBe('9786555475586');
    expect(findIsbn('978-65-83970-52-0')).toBeNull();
    expect(findIsbn('sem isbn')).toBeNull();
  });
});

describe('parseOrderDocument', () => {
  it('lê fornecedor, data, itens e tira a PO do nome do arquivo', () => {
    const doc = parseOrderDocument([{ name: 'SARA', rows: PO }], 'PO-064 (SARA).xlsx');
    if ('error' in doc) throw new Error(doc.error);
    expect(doc.code).toBe('PO-064');
    expect(doc.supplier).toBe('Sara');
    expect(doc.orderedAt).toBe('2026-11-09');
    expect(doc.lines).toHaveLength(3);
    expect(doc.lines[0]).toMatchObject({ row: 6, description: 'Caligráfia Mágica - Nova Cartilha 02', isbn: '9786561260589', quantity: 30000, piecesPerCarton: 40, unitPriceMicros: 420_000, notes: 'RUSH' });
    expect(doc.lines[1]).toMatchObject({ isbn: null, quantity: 10000, specification: 'spec' });
    expect(doc.lines[0]!.specification).toBe('20,5x27,5');
    expect(doc.lines[2]).toMatchObject({ isbn: null, unitPriceMicros: null });
    expect(doc.warnings).toEqual([
      { row: 7, message: 'Data de envio "asap" não reconhecida; o item entra sem programação de envio.' },
      { row: 8, message: expect.stringContaining('ISBN "978-65-6126-058-0" não serve') },
    ]);
    // "Estimated Shipping Date": o item inteiro no mês da data.
    expect(doc.lines.map((l) => l.shipPlan)).toEqual([[{ month: '2026-12', quantity: 30000 }], [], []]);
  });

  it('data de envio da PO-070 da Nicola: a data da coluna e os lotes do comentário', () => {
    // A coluna de envio vem como data do Excel, que a leitura passa para dia/mês/ano.
    const head = PO.slice(0, 5);
    const row = (n: number, name: string, quantity: string, comment: string, ship: string) => [String(n), name, 'spec', 'YES', '', '12', quantity, '1.28', '', comment, ship];
    const rows = [
      ...head,
      row(1, 'Biblioteca Estoica', '5000', 'New order: RUSH – ship by 16-Dec-2026 (out of stock).', '16/12/2026'),
      row(2, 'Sobre a Brevidade da Vida', '30000', 'Ship in 2 lots: 15,000 pcs by 16-Dec-2026 / 15,000 pcs by 01-Mar-2027 – same unit price for total quantity.', '16/12/2026'),
      row(3, 'Memórias Póstumas de Brás Cubas', '5000', 'Please ship FIRST the lot already in production (PO-056 – 5,000 pcs) by 01-Dec-2026.\nNew order: RUSH – ship by 16-Dec-2026 (out of stock).', '16/12/2026'),
      row(4, 'A Arte da Guerra', '10000', 'New order: ship by 06-Jan-2027.', '06/01/2027'),
      row(5, 'Livro com lotes que não somam', '9000', 'Ship in 2 lots: 5,000 pcs by 16-Dec-2026 / 5,000 pcs by 01-Mar-2027', '16/12/2026'),
      row(6, 'Livro com lotes e sem a data na coluna', '3000', 'Ship in 3 lots: 1,000 pcs by Dec 2026 / 1,000 pcs by 15-Jan-2027 / 1,000 pcs by 01/03/2027', ''),
      pad(['TOTAL', 'TOTAL']),
    ];
    const doc = parseOrderDocument([{ name: 'NICOLA', rows }], 'PO-070_nicola.xlsx');
    if ('error' in doc) throw new Error(doc.error);
    expect(doc.lines.map((l) => [l.description, l.shipPlan])).toEqual([
      ['Biblioteca Estoica', [{ month: '2026-12', quantity: 5000 }]],
      [
        'Sobre a Brevidade da Vida',
        [
          { month: '2026-12', quantity: 15000 },
          { month: '2027-03', quantity: 15000 },
        ],
      ],
      // O lote da PO-056 é de outra PO: vale a data da coluna, com o item inteiro.
      ['Memórias Póstumas de Brás Cubas', [{ month: '2026-12', quantity: 5000 }]],
      ['A Arte da Guerra', [{ month: '2027-01', quantity: 10000 }]],
      ['Livro com lotes que não somam', [{ month: '2026-12', quantity: 9000 }]],
      [
        'Livro com lotes e sem a data na coluna',
        [
          { month: '2026-12', quantity: 1000 },
          { month: '2027-01', quantity: 1000 },
          { month: '2027-03', quantity: 1000 },
        ],
      ],
    ]);
    expect(doc.warnings).toEqual([{ row: 10, message: 'Os lotes do comentário somam 10.000 exemplares, e a linha tem 9.000; vale a data de envio da coluna.' }]);
    // O comentário continua nas observações do item.
    expect(doc.lines[1]!.notes).toMatch(/^Ship in 2 lots/);
  });

  it('prefere o número da PO escrito no documento', () => {
    const rows = PO.map((r) => (r[9] === 'Order No.:' ? pad(['From:', 'GABRIEL', '', '', '', '', '', '', '', 'Order No.:', 'PO-65']) : r));
    const doc = parseOrderDocument([{ name: 'x', rows }], 'pedido.xlsx');
    expect('error' in doc ? null : doc.code).toBe('PO-065');
  });

  it('avisa quando não acha a tabela', () => {
    expect(parseOrderDocument([{ name: 'x', rows: [['oi']] }], 'x.xlsx')).toEqual({ error: expect.stringContaining('Não achei os itens') });
  });
});

describe('lotes no comentário da PO', () => {
  it('só valem quando o comentário fala em lotes e eles somam a quantidade da linha', () => {
    expect(lotsFromComment('Ship in 2 lots: 7,000 pcs by 16-Dec-2026 / 7,000 pcs by 01-Mar-2027', 14000)).toEqual({
      plan: [
        { month: '2026-12', quantity: 7000 },
        { month: '2027-03', quantity: 7000 },
      ],
    });
    // Dois lotes no mesmo mês viram um embarque só.
    expect(lotsFromComment('Ship in 2 lots: 1,000 pcs by 01-Dec-2026 / 1,000 pcs by 20-Dec-2026', 2000)).toEqual({ plan: [{ month: '2026-12', quantity: 2000 }] });
    expect(lotsFromComment('New order: RUSH – ship by 16-Dec-2026 (out of stock).', 3000)).toBeNull();
    expect(lotsFromComment('Please ship FIRST the lot already in production (PO-056 – 5,000 pcs) by 01-Dec-2026.', 5000)).toBeNull();
    expect(lotsFromComment('Ship in 2 lots, dates to be confirmed', 2000)).toEqual({ error: 'o comentário fala em lotes, mas não deu para ler a quantidade e a data de cada um' });
    expect(lotsFromComment('Ship in 4 lots: 1 pcs by Jan 2027 / 1 pcs by Feb 2027 / 1 pcs by Mar 2027 / 1 pcs by Apr 2027', 4)).toEqual({ error: 'no máximo 3 embarques na programação de envio' });
  });
});

describe('parseInvoiceDocument', () => {
  it('invoice da Claire: ISBN junto do nome, PO na linha e número no cabeçalho', () => {
    const rows = [
      ['Guangzhou Miyi Printing Co., Ltd.'],
      ['Proforma Invoice'],
      pad(['To:IBC - Instituto Brasileiro de Cultura LTDA /Gabriel', '', '', '', '', '', 'DATE:26 Oct. 2026']),
      pad(['From: Guangzhou Miyi Printing Co., Ltd. /Claire & ivy', '', '', '', '', '', '', '', 'Invoice No.:126062009-2']),
      ['Name', 'NCM', 'Order NO.', 'Specifications', 'Quantity', 'Qty. Unit', 'FOB shenzhen\n Unit Price\n($ USD)', 'Amount\n($ USD)', 'Comments'],
      ['Coleção Alice - Atlantis Editora\n978-65-83970-52-7', '4901', '126062009-2\nPO-024', 'Box', '9878', 'set', '1.75', '17286.5', ''],
      ['A ODISSEIA\n978-65-83970-21-3', '4901', '126082402-1\nPO-050', 'spec', '10000', 'pcs', '1.12', '11200', ''],
      pad(['TOTAL AMOUNT USD', '', '', '', '19878', '', '', '28486.5']),
    ];
    const doc = parseInvoiceDocument([{ name: 'Plan1', rows }], 'Final PI-CTNR04.xlsx');
    if ('error' in doc) throw new Error(doc.error);
    expect(doc.number).toBe('126062009-2');
    expect(doc.lines.map((l) => [l.description, l.isbn, l.quantity, l.unitPriceMicros, l.orderCode])).toEqual([
      ['Coleção Alice - Atlantis Editora', '9786583970527', 9878, 1_750_000, 'PO-024'],
      ['A ODISSEIA', '9786583970213', 10000, 1_120_000, 'PO-050'],
    ]);
    expect(doc.headerText).toContain('Claire & ivy');
  });

  it('packing list e invoice em abas: vale a com preço, ISBN na linha de baixo, número embaixo do rótulo', () => {
    const packing = [
      pad(['Invoice No: ', 'GN/22-23/509', '', '', '', 'Dated : ', '15.02.2023']),
      pad(['MARKS/', 'NO.OF', 'Qty. in', '   FULL DESCRIPTION OF GOODS', '', '', '', 'QTY.', 'UNIT OF']),
      pad(["NO'S", 'Cartons', 'each Ctn', '', '', '', '', 'In Pcs', 'MEASURE']),
      pad(['', '217', '40', 'Aprendendo E Se Divertindo - Cores', '', '', '', '8680', 'Pieces']),
      pad(['', '', '', 'ISBN 978-65-5547-502-9']),
    ];
    const invoice = [
      pad([' COMMERCIAL INVOICE ']),
      pad(['SHIPPER/EXPORTER', '', '', '', 'INVOICE NO. ', '', 'DATE']),
      pad(['BRIJBASI ART PRESS LTD', '', '', '', 'GN/22-23/509', '', '15.02.2023']),
      pad(['MARKS/', 'NO.OF', '   FULL DESCRIPTION OF GOODS', '', '', 'HSN', 'QTY. InPkt / ', 'Rate', 'Amount ']),
      pad(['', '', 'ACTIVITY / COLOURING BOOKS']),
      pad(['1--2833', '2833', 'Aprendendo E Se Divertindo - Cores', '', '', '4901', '8680.0', '0.43', '3732.4']),
      pad(['', 'Carton', 'ISBN 978-65-5547-502-9']),
      pad(['', '', 'Edicao : 02']),
    ];
    const doc = parseInvoiceDocument(
      [
        { name: 'packing', rows: packing },
        { name: 'BUYER', rows: invoice },
      ],
      'GN-509.xlsx',
    );
    if ('error' in doc) throw new Error(doc.error);
    expect(doc.sheet).toBe('BUYER');
    expect(doc.number).toBe('GN/22-23/509');
    expect(doc.lines).toEqual([expect.objectContaining({ description: 'Aprendendo E Se Divertindo - Cores', isbn: '9786555475029', quantity: 8680, unitPriceMicros: 430_000 })]);
  });

  it('invoice da Nicola: título, ISBN em coluna e preço arredondado com aviso', () => {
    const rows = [
      pad(['HUNAN SPLENDID CULTURE CO.,LTD']),
      pad(['', '', '', '', '', '', 'INVOICE NO:', 'HSC20260920']),
      pad(['Item', 'TITLE', 'ISBN', 'DESCRIPTION & SPECIFICATION', 'QTY', 'UNIT PRICE FOB SHENZHEN(without Pallet)', 'AMOUNT', 'CBM']),
      pad(['1', 'Livro Noites Brancas - Série Ouro', '9786584956933', '15,1x23cm', '30000', '0.653924268502582', '19617.73']),
      pad(['', '', '', 'In total:', '30000', '', '19617.73']),
    ];
    const doc = parseInvoiceDocument([{ name: 'PI', rows }], 'PI-HSC20260920-HUNAN.xlsx');
    if ('error' in doc) throw new Error(doc.error);
    expect(doc.number).toBe('HSC20260920');
    expect(doc.lines).toEqual([expect.objectContaining({ description: 'Livro Noites Brancas - Série Ouro', isbn: '9786584956933', quantity: 30000, unitPriceMicros: 654_000 })]);
    expect(doc.warnings[0]!.message).toContain('arredondado');
  });
});

describe('parseShipmentFile', () => {
  // Packing list da Claire: o nome e o ISBN na coluna ITEM, a descrição técnica ao lado, peças por
  // caixa em "Qty per Ctn", quantidade em "Total Qty per title", o container no cabeçalho e a linha de
  // soma sem a palavra TOTAL.
  const PL = [
    pad(['Guangzhou Miyi Printing Co., Ltd.']),
    pad(['PACKING LIST']),
    pad(['ITEM', 'PO', 'Description for products', 'No. of Cartons', 'Qty per Ctn', '', 'Total Qty    per title', 'NW (kgs)', '', '', '', '1× 45RI\n\nContainer NO.:\nYMLU5449045\n\nSeal NO.']),
    pad(['Coleção Alice - Atlantis Editora\n978-65-83970-52-7', '126062009-2\nPO-024', 'Box:C1S 400gsm', '449', '22', 'set', '9878', '13.9']),
    pad(['A ODISSEIA\n978-65-83970-21-3', '', '15,1x23cm', '385', '26', 'pcs', '10000', '12.2']),
    pad(['', '', '', '834', '', '', '19878', '']),
  ];

  it('packing list: peças por caixa, nome na coluna ITEM e o número do container', () => {
    const f = parseShipmentFile([{ name: 'PL', rows: PL }], 'PL-CTNR04_56th shipment.xlsx');
    if ('error' in f) throw new Error(f.error);
    expect(f.invoice).toBeNull();
    expect(f.container).toBe('YMLU5449045');
    expect(f.packing!.lines.map((l) => [l.description, l.isbn, l.quantity, l.piecesPerCarton])).toEqual([
      ['Coleção Alice - Atlantis Editora', '9786583970527', 9878, 22],
      ['A ODISSEIA', '9786583970213', 10000, 26],
    ]);
    expect(f.packing!.warnings).toEqual([]);
  });

  it('um arquivo com as duas abas é invoice e packing list ao mesmo tempo', () => {
    const invoice = [
      pad(['', '', '', '', '', '', 'INVOICE NO:', 'HSC1']),
      pad(['P.O NO.(INV)', 'Customer', 'TITLE', 'ISBN', 'UNIT PRICE', 'QTY.', 'CTN QTY.', 'AMOUNT']),
      pad(['', '', '', '', '(USD)', '(copies)', '', '(USD)']),
      pad(['PO-051', 'IBC', 'A ODISSEIA', '978-65-83970-21-3', '1.12', '10000', '385', '11200']),
    ];
    const packing = [
      pad(['TOTAL', '', '', '', 'TOTAL', 'TOTAL']),
      pad(['P.O NO.(INV)', 'Customer', 'TITLE', 'ISBN', 'PER CTN.', 'QTY.', 'CTN QTY.']),
      pad(['', '', '', '', '(copies)', '(copies)']),
      pad(['PO-051', 'IBC', 'A ODISSEIA', '978-65-83970-21-3', '26', '10000', '385']),
    ];
    const f = parseShipmentFile(
      [
        { name: 'PL', rows: packing },
        { name: 'CI', rows: invoice },
      ],
      'draft PL&CI.xlsx',
    );
    if ('error' in f) throw new Error(f.error);
    expect(f.number).toBe('HSC1');
    expect(f.invoice!.sheet).toBe('CI');
    expect(f.invoice!.lines[0]).toMatchObject({ quantity: 10000, unitPriceMicros: 1_120_000, orderCode: 'PO-051' });
    expect(f.packing!.sheet).toBe('PL');
    expect(f.packing!.lines[0]).toMatchObject({ quantity: 10000, piecesPerCarton: 26 });
  });

  it('cabeçalho em duas linhas: "Qty. in" + "each Ctn" são as peças por caixa', () => {
    const rows = [
      pad(['MARKS/', 'NO.OF', 'Qty. in', '   FULL DESCRIPTION OF GOODS', '', '', '', 'QTY.']),
      pad(["NO'S", 'Cartons', 'each Ctn', '', '', '', '', 'In Pcs']),
      pad(['', '217', '40', 'Aprendendo E Se Divertindo - Cores', '', '', '', '8680']),
    ];
    const f = parseShipmentFile([{ name: 'packing', rows }], 'GN.xlsx');
    if ('error' in f) throw new Error(f.error);
    expect(f.packing!.lines[0]).toMatchObject({ quantity: 8680, piecesPerCarton: 40 });
  });

  it('findContainer', () => {
    expect(findContainer('Container NO.: YMLU 5449045')).toBe('YMLU5449045');
    expect(findContainer('sem container')).toBeNull();
  });
});

describe('invoice da Sara (Win Win Win)', () => {
  it('preço na coluna "UNIT" e número depois dos dois-pontos largos', () => {
    const rows = [
      pad(['WIN WIN WIN INTERNATIONAL TRADING COMPANY LIMITED']),
      // "Invoice NO：" mesclada de D a F: as células mescladas repetem o texto.
      pad(['TO:', '', '', 'Invoice NO：   ', 'Invoice NO：   ', 'Invoice NO：   ', '2026W-3C']),
      pad(['', '', '', 'Country of Acquisition：', '', '', 'China']),
      pad(['Title', 'ISBN', 'G/W', 'N/W', 'Quantity', 'UNIT', 'Amount']),
      pad(['Bluey Hora do Banho 01', '9786555477146', '275.71', '241.77', '5090', '0.5', '2545']),
      pad(['Total', '', '', '', '5090', '', '2545']),
    ];
    const doc = parseInvoiceDocument([{ name: 'INVOICE', rows }], 'ROECHN26111889_CI_2026W-3C.xlsx');
    if ('error' in doc) throw new Error(doc.error);
    expect(doc.number).toBe('2026W-3C');
    expect(doc.lines).toEqual([expect.objectContaining({ description: 'Bluey Hora do Banho 01', quantity: 5090, unitPriceMicros: 500_000 })]);
  });
});
