import { describe, expect, it } from 'vitest';
import { parseOrderDocument } from './documents';
import {
  cellText,
  newOrderProblem,
  nextOrderCode,
  orderFileName,
  orderItems,
  orderSender,
  orderSheet,
  orderSheetName,
  orderTotals,
  poCatalog,
  PO_TERMS,
  SHRINK_WRAP_DEFAULT,
  type CatalogItem,
  type NewOrder,
  type NewOrderLine,
} from './newOrder';

const line = (over: Partial<NewOrderLine> = {}): NewOrderLine => ({
  description: 'Sobre a Brevidade da Vida',
  isbn: '9786587817668',
  specification: '15,1x23,0\nfront and back cover with 10cm flap\ncover = C1S 250gsm',
  shrinkWrap: SHRINK_WRAP_DEFAULT,
  piecesPerCarton: 70,
  quantity: 30_000,
  unitPriceMicros: 270_000,
  comment: '',
  shipDate: '2026-12-16',
  ...over,
});

const order = (over: Partial<NewOrder> = {}): NewOrder => ({
  code: 'PO-071',
  supplier: 'Nicola',
  date: '2026-11-24',
  from: 'GABRIEL',
  lines: [line()],
  ...over,
});

describe('número, remetente e nome do arquivo', () => {
  it('sugere o número seguinte ao maior que existe', () => {
    expect(nextOrderCode(['PO-070', 'PO-56', 'po 103', 'sem número'])).toBe('PO-104');
    expect(nextOrderCode([])).toBe('PO-001');
    expect(nextOrderCode(['PO-999'])).toBe('PO-1000');
  });

  it('o "From:" é o primeiro nome de quem cria, em maiúsculas', () => {
    expect(orderSender('Gabriel Houch')).toBe('GABRIEL');
    expect(orderSender('  marcelo  lima ')).toBe('MARCELO');
  });

  it('aba e arquivo com o fornecedor em maiúsculas, sem o que o Excel não aceita', () => {
    expect(orderSheetName('Claire (Miyi)')).toBe('CLAIRE (MIYI)');
    expect(orderSheetName('A/B: gráfica*?')).toBe('A B GRÁFICA');
    expect(orderSheetName('x'.repeat(40))).toHaveLength(31);
    expect(orderFileName({ code: 'po 71', supplier: 'Nicola' })).toBe('PO-071 (NICOLA).xlsx');
  });
});

describe('o que impede a PO', () => {
  it('confere o cabeçalho e cada produto', () => {
    const used = ['PO-070'];
    expect(newOrderProblem(order(), used)).toBeNull();
    const cases: [Partial<NewOrder>, string][] = [
      [{ supplier: ' ' }, 'Informe o fornecedor.'],
      [{ code: 'PO' }, 'Informe o número da PO, como PO-071.'],
      [{ code: 'po 70' }, 'A PO-070 já existe. Use outro número.'],
      [{ date: '2026-02-30' }, 'Informe a data da PO.'],
      [{ lines: [] }, 'Acrescente pelo menos um produto.'],
      [{ lines: [line(), line({ description: '  ' })] }, 'Produto 2: informe o nome do produto.'],
      [{ lines: [line({ quantity: 0 })] }, 'Produto 1: informe a quantidade.'],
      [{ lines: [line({ quantity: 2.5 })] }, 'Produto 1: informe a quantidade.'],
      [{ lines: [line({ piecesPerCarton: 0 })] }, 'Produto 1: peças por caixa inválidas.'],
      [{ lines: [line({ unitPriceMicros: 275_500 })] }, 'Produto 1: o preço precisa ser maior que zero, com no máximo três casas decimais.'],
      [{ lines: [line({ shipDate: '16/12/2026' })] }, 'Produto 1: data de envio inválida.'],
    ];
    for (const [over, message] of cases) expect(newOrderProblem(order(over), used), message).toBe(message);
    expect(newOrderProblem(order({ lines: [line({ isbn: '9786587817669' })] }), used)).toMatch(/^Produto 1: /);
  });

  it('sem preço, sem caixa e sem data de envio pode (o fornecedor cota)', () => {
    expect(newOrderProblem(order({ lines: [line({ unitPriceMicros: null, piecesPerCarton: null, shipDate: null, isbn: null })] }), [])).toBeNull();
  });

  it('lotes do comentário precisam somar a quantidade', () => {
    const lots = 'Ship in 2 lots: 15,000 pcs by 16-Dec-2026 / 10,000 pcs by 01-Mar-2027';
    expect(newOrderProblem(order({ lines: [line({ comment: lots })] }), [])).toBe('Produto 1: os lotes do comentário somam 25.000 exemplares, e a linha tem 30.000.');
  });
});

describe('a planilha e os itens', () => {
  const lots = 'Ship in 2 lots: 15,000 pcs by 16-Dec-2026 / 15,000 pcs by 01-Mar-2027';
  const po = order({
    lines: [
      line({ comment: lots }),
      line({ description: 'O Senhor Sapo e o Acerto na Mosca', isbn: '9786561267892', piecesPerCarton: null, quantity: 10_000, unitPriceMicros: 250_000, comment: 'New order: RUSH – ship by 16-Dec-2026 (new title).' }),
      line({ description: 'Livro novo, sem preço ainda', isbn: null, specification: '', piecesPerCarton: null, quantity: 3_000, unitPriceMicros: null, shipDate: null, shrinkWrap: 'blister' }),
    ],
  });

  it('no modelo da editora: topo, cabeçalho, linhas, total e condições', () => {
    const sheet = orderSheet(po);
    expect(sheet.name).toBe('NICOLA');
    expect(sheet.rows.map((r) => r.length)).toEqual(sheet.rows.map(() => 11));
    expect(sheet.rows[0]![0]).toBe('IBC - INSTITUTO BRASILEIRO DE CULTURA LTDA');
    expect(sheet.rows[2]![0]).toBe('PRINTING ORDER');
    expect(sheet.rows[3]).toEqual(['To:', 'Nicola', null, null, null, null, null, null, null, 'Date', { date: '2026-11-24' }]);
    expect(sheet.rows[4]![0]).toBe('From:');
    expect(sheet.rows[4]!.slice(9)).toEqual(['Order No.:', 'PO-071']);
    expect(sheet.rows[5]![1]).toBe('Name');
    expect([sheet.firstLine, sheet.lastLine, sheet.totalRow, sheet.termsRow]).toEqual([7, 9, 10, 11]);
    expect(sheet.rows[6]!.slice(0, 9)).toEqual([1, 'Sobre a Brevidade da Vida', line().specification, 'YES', '9786587817668', 70, 30_000, 0.27, { formula: 'G7*H7', result: 8100 }]);
    expect(sheet.rows[8]![7]).toBeNull();
    expect(sheet.rows[8]![8]).toEqual({ formula: 'G9*H9', result: 0 });
    expect(sheet.rows[8]![10]).toBeNull();
    expect(sheet.rows[9]![0]).toBe('TOTAL');
    expect(sheet.rows[9]![6]).toEqual({ formula: 'SUM(G7:G9)', result: 43_000 });
    expect(sheet.rows[9]![8]).toEqual({ formula: 'SUM(I7:I9)', result: 10_600 });
    expect(sheet.rows[10]![0]).toBe(PO_TERMS);
  });

  it('o Novo pedido lê do arquivo gerado a mesma PO que o sistema grava', () => {
    const sheet = orderSheet(po);
    const read = parseOrderDocument([{ name: sheet.name, rows: sheet.rows.map((r) => r.map(cellText)) }], orderFileName(po));
    if ('error' in read) throw new Error(read.error);
    expect(read.warnings).toEqual([]);
    expect([read.code, read.supplier, read.orderedAt]).toEqual(['PO-071', 'Nicola', '2026-11-24']);
    const items = orderItems(po);
    expect(read.lines.map(({ orderCode: _orderCode, ...l }) => l)).toEqual(items);
    // Os lotes do comentário viram a programação; sem lotes, o mês do envio; sem data, nada.
    expect(items.map((i) => i.shipPlan)).toEqual([
      [
        { month: '2026-12', quantity: 15_000 },
        { month: '2027-03', quantity: 15_000 },
      ],
      [{ month: '2026-12', quantity: 10_000 }],
      [],
    ]);
  });

  it('total de exemplares e valor', () => {
    expect(orderTotals(po.lines)).toEqual({ quantity: 43_000, cents: 1_060_000 });
    expect(orderTotals([{ quantity: 0, unitPriceMicros: 1_000_000 }])).toEqual({ quantity: 0, cents: 0 });
  });
});

describe('catálogo de produtos', () => {
  const item = (over: Partial<CatalogItem>): CatalogItem => ({
    productId: 'p1',
    isbn: '9786587817668',
    description: 'Sobre a Brevidade da Vida',
    orderCode: 'PO-056',
    supplierName: 'Nicola',
    createdAt: '2026-06-01T10:00:00Z',
    unitPriceMicros: 260_000,
    piecesPerCarton: 70,
    specification: '15,1x23,0 cover 250gsm',
    ...over,
  });

  it('a última compra de cada produto, os títulos da curva que faltam, em ordem de nome', () => {
    const list = poCatalog(
      [
        item({}),
        // A reimpressão mais nova: sem preço, sem caixa e com a especificação que só remete à anterior.
        item({ orderCode: 'PO-070', createdAt: '2026-11-09T10:00:00Z', unitPriceMicros: null, piecesPerCarton: null, specification: 'REPRINT — same specs as last order', description: 'Sobre a  Brevidade da Vida (edição especial)' }),
        item({ productId: 'p2', isbn: null, description: 'Agenda sem ISBN', orderCode: null, supplierName: 'Sara', unitPriceMicros: 1_100_000, specification: '' }),
      ],
      [
        { isbn: '9786587817668', title: 'SOBRE A BREVIDADE DA VIDA - CURVA' },
        { isbn: '9786583195050', title: 'Mulheres com Deus' },
      ],
    );
    expect(list.map((e) => [e.title, e.source])).toEqual([
      ['Agenda sem ISBN', 'sistema'],
      ['Mulheres com Deus', 'curva'],
      ['Sobre a Brevidade da Vida (edição especial)', 'sistema'],
    ]);
    expect(list[2]!.last).toEqual({
      orderCode: 'PO-070',
      supplierName: 'Nicola',
      createdAt: '2026-11-09T10:00:00Z',
      unitPriceMicros: 260_000,
      piecesPerCarton: 70,
      specification: '15,1x23,0 cover 250gsm',
    });
    expect(list[1]!.last).toBeNull();
    expect(list[0]!.last?.specification).toBe('');
  });
});
