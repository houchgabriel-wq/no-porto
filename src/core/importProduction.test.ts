import { describe, expect, it } from 'vitest';
import { importKey, newImportItems, parseProductionRows, separateMixedOrders, summarizeImport, type ImportReport } from './importProduction';

// Linhas como saem da planilha status_importações de 17/11/2026, já em texto (a primeira coluna e a
// coluna da PO não têm título).
const HEADER = ['', 'Produto', 'ISBN', 'pcs/ctn', 'Quantidade', '$ unitário', '$ total', 'Fornecedor', 'Embarque', 'Pagamento', '', ''];
const rows = [
  HEADER,
  ['-', 'Livro Café com Aristóteles', '9786560950856', '', '6000', '0.575', '3450', 'Claire', 'Em produção', 'Não Pago', '', ''],
  ['-', 'Maleta Divertida - LOL Surprise', '9786561260039', '40', '4800', '0.88', '4224', 'Sara', 'Em produção', 'Não Pago', 'PO-046', ''],
  ['-', 'Patrulha Canina Brincando de Banho', '978-65-6126-423-5', '', '8000', '', '0', '', 'Em produção', 'Não Pago', '', ''],
  ['-', 'Floresta Encantada Maletinha Divertida 01', '978-65-6126-000-8', '', '8000', '0.87', '6960', 'Sara', 'Em produção', 'Não Pago', '6k dec + 6k apr + 6k july', ''],
  ['', 'O Príncipe - Luxo - Nova Leitura', 'new', '', '15000', '0.47', '7050', 'Claire', 'Em produção', 'Não Pago', 'PO-052', ''],
  ['', 'Biblioteca Machado de Assis Volume 02 - Box com 3 Livros', '9786554700238', '24\n14', '3000', '1.314', '3942', 'Claire', 'Em produção', 'Não Pago', 'PO-047', ''],
  ['', '12 Board Books Boxset - Title 1 (TBC)', '', '', '5000', 'R$2,06', 'R$10.300,00', 'Nicola', 'Em produção', 'Não Pago', 'PO-067', ''],
  // ISBN com o último dígito trocado de propósito (o certo é 978-65-83970-09-1).
  ['', 'Livro Alice no Pais das\nMaravilhas', '978-65-83970-09-2', '', '50000', '0.7', '35000', 'Nicola', 'Em produção', 'Não Pago', 'PO-057', ''],
  ['', '', '', '', '', '', '', '', '', '', '', ''],
  ['', ']', '', '', '4796377', '', '3042056.462', '', '', '', '', ''],
];

function parse(): ImportReport {
  const r = parseProductionRows(rows);
  if ('error' in r) throw new Error(r.error);
  return r;
}

describe('carga da aba Produção', () => {
  it('lê os itens com PO, ISBN, preço e fornecedor', () => {
    const { items } = parse();
    expect(items).toHaveLength(8);
    expect(items[1]).toEqual({
      row: 3,
      description: 'Maleta Divertida - LOL Surprise',
      isbn: '9786561260039',
      supplier: 'Sara',
      orderCode: 'PO-046',
      quantity: 4800,
      piecesPerCarton: 40,
      unitPriceMicros: 880_000,
      notes: '',
    });
  });

  it('item sem PO entra sem PO; texto que não é PO vai para as observações', () => {
    const { items } = parse();
    expect(items[0]!.orderCode).toBeNull();
    expect(items[3]!.orderCode).toBeNull();
    expect(items[3]!.notes).toBe('Observação da planilha: 6k dec + 6k apr + 6k july');
  });

  it('ISBN com hífens vale; "new" e dígito errado entram sem ISBN, com o texto nas observações', () => {
    const { items, warnings } = parse();
    expect(items[2]!.isbn).toBe('9786561264235');
    expect(items[4]!.isbn).toBeNull();
    expect(items[4]!.notes).toBe('ISBN informado na planilha: new');
    // 978-65-83970-09-2: o dígito verificador não confere.
    expect(items[7]!.isbn).toBeNull();
    expect(warnings.some((w) => w.row === 9 && w.message.includes('ISBN'))).toBe(true);
  });

  it('sem fornecedor e sem preço entram, com aviso', () => {
    const { items, warnings } = parse();
    expect(items[2]).toMatchObject({ supplier: null, unitPriceMicros: null });
    expect(warnings.filter((w) => w.row === 4).map((w) => w.message)).toEqual([
      '"Patrulha Canina Brincando de Banho": sem fornecedor; entra como "Sem fornecedor".',
      '"Patrulha Canina Brincando de Banho": sem preço.',
    ]);
  });

  it('preço em reais entra sem preço em dólar, com o preço original nas observações', () => {
    const { items, warnings } = parse();
    expect(items[6]).toMatchObject({ unitPriceMicros: null, notes: 'Preço na planilha: R$2,06', orderCode: 'PO-067' });
    expect(warnings.some((w) => w.message.includes('preço em reais'))).toBe(true);
  });

  it('peças por caixa que não são número ficam em branco, com o texto nas observações', () => {
    const { items } = parse();
    expect(items[5]!.piecesPerCarton).toBeNull();
    expect(items[5]!.notes).toBe('Peças por caixa na planilha: 24\n14');
  });

  it('descrição numa linha só', () => {
    expect(parse().items[7]!.description).toBe('Livro Alice no Pais das Maravilhas');
  });

  it('ignora a linha de soma e as linhas vazias', () => {
    const { skipped } = parse();
    expect(skipped).toEqual([{ row: 11, message: 'Linha de soma ou sem produto ("]").' }]);
  });

  it('avisa quando o total digitado não bate com quantidade × preço', () => {
    const r = parseProductionRows([HEADER, ['', 'Livro X', '', '', '1000', '0.5', '600', 'Sara', '', '', '', '']]);
    if ('error' in r) throw new Error(r.error);
    expect(r.warnings[0]!.message).toContain('não bate');
  });

  it('arredonda o preço para três casas, com aviso', () => {
    const r = parseProductionRows([HEADER, ['', 'Livro Noites Brancas - Série Ouro', '', '', '30000', '0.653924268502582', '19617.72806', 'Claire', '', '', 'PO-050', '']]);
    if ('error' in r) throw new Error(r.error);
    expect(r.items[0]!.unitPriceMicros).toBe(654_000);
    expect(r.warnings.map((w) => w.message)).toEqual(['"Livro Noites Brancas - Série Ouro": preço 0.653924268502582 arredondado para três casas.']);
  });

  it('recusa quantidade inválida', () => {
    const r = parseProductionRows([HEADER, ['', 'Livro X', '', '', '1000,5', '0.5', '', 'Sara', '', '', '', '']]);
    if ('error' in r) throw new Error(r.error);
    expect(r.items).toHaveLength(0);
    expect(r.skipped[0]!.message).toContain('quantidade inválida');
  });

  it('avisa quando não acha o cabeçalho', () => {
    expect(parseProductionRows([['a', 'b'], ['1', '2']])).toEqual({ error: expect.stringContaining('cabeçalho') });
  });
});

describe('uma PO, um fornecedor, na carga', () => {
  const row = (r: number, supplier: string, orderCode: string | null) => ({ row: r, description: `Livro ${r}`, supplier, orderCode, notes: '' });

  it('o item de outro fornecedor entra sem PO, com a PO da planilha nas observações', () => {
    const { items, moved } = separateMixedOrders([row(2, 'Sara', 'PO-063'), row(3, 'Claire', 'PO-063'), row(4, 'Sara', 'PO-063')], new Map());
    expect(items.map((i) => i.orderCode)).toEqual(['PO-063', null, 'PO-063']);
    expect(items[1]!.notes).toBe('PO na planilha: PO-063 (a PO é de Sara)');
    expect(moved).toEqual([{ row: 3, message: '"Livro 3": a PO-063 é de Sara e este item é de Claire; entra sem PO.' }]);
  });

  it('PO já cadastrada: vale o fornecedor dela', () => {
    const { items } = separateMixedOrders([row(2, 'Claire', 'PO-063'), row(3, 'claire', 'PO-063')], new Map([['PO-063', 'Sara']]));
    expect(items.map((i) => i.orderCode)).toEqual([null, null]);
  });

  it('a leitura da aba já separa as POs com dois fornecedores', () => {
    const r = parseProductionRows([
      HEADER,
      ['', 'Livro A', '', '', '1000', '0.5', '500', 'Sara', '', '', 'PO-067', ''],
      ['', 'Livro B', '', '', '1000', '0.5', '500', 'Sara', '', '', 'PO-067', ''],
      ['', 'Livro C', '', '', '1000', '0.5', '500', 'Nicola', '', '', 'PO-067', ''],
    ]);
    if ('error' in r) throw new Error(r.error);
    expect(r.items.map((i) => i.orderCode)).toEqual(['PO-067', 'PO-067', null]);
    expect(r.warnings[0]!.row).toBe(4);
  });
});

describe('resumo da carga', () => {
  it('por fornecedor e no total, com os itens sem preço à parte', () => {
    const s = summarizeImport(parse().items);
    expect(s.total).toEqual({ supplier: 'Total', items: 8, quantity: 6000 + 4800 + 8000 + 8000 + 15000 + 3000 + 5000 + 50000, valueCents: 345_000 + 422_400 + 696_000 + 705_000 + 394_200 + 3_500_000, unpriced: 2 });
    expect(s.bySupplier.map((r) => r.supplier)).toEqual(['Nicola', 'Claire', 'Sara', 'Sem fornecedor']);
    expect(s.orders).toBe(5);
  });

  it('a chave de repetição junta PO, ISBN, nome do produto, quantidade e preço', () => {
    const [a] = parse().items;
    expect(importKey(a!)).toBe('|9786560950856|livro cafe com aristoteles|6000|575000');
    expect(importKey({ ...a!, isbn: null, description: 'Café  com Aristóteles' })).toBe('||cafe com aristoteles|6000|575000');
  });

  it('produtos diferentes com o mesmo ISBN não são repetição', () => {
    const box = { orderCode: 'PO-053', isbn: '9786597585427', description: 'Coleção Estratégia - Da Vinci - Box com 3 Livros', quantity: 10000, unitPriceMicros: null };
    const book = { ...box, description: 'O Livro dos Cinco Anéis - Da Vinci' };
    expect(newImportItems([box, book], [])).toEqual([0, 1]);
  });

  it('linhas iguais na planilha entram todas; o que já existe é pulado uma vez por item cadastrado', () => {
    const x = { orderCode: 'PO-001', isbn: null, description: 'Livro', quantity: 100, unitPriceMicros: 1 };
    expect(newImportItems([x, x], [])).toEqual([0, 1]);
    expect(newImportItems([x, x], [importKey(x)])).toEqual([1]);
    expect(newImportItems([x, x], [importKey(x), importKey(x)])).toEqual([]);
  });
});
