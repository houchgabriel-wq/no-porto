import { describe, expect, it } from 'vitest';
import type { Item } from './items';
import { shipPlanText } from './shipPlan';
import {
  checkSheetPatch,
  fieldMark,
  isItemCodeHeader,
  ITEM_CODE_HEADER,
  itemCode,
  parseUpdateRows,
  readItemCode,
  sheetValues,
  type UpdateSheetReport,
} from './updateSheet';

const HEADER = ['PO', 'Fornecedor', 'Produto', 'ISBN', 'Quantidade', 'pcs/ctn', '$ unitário', '$ total', 'Aprovação do arquivo', 'Programação de envio', 'Observações', ITEM_CODE_HEADER];
type Col = 'PO' | 'Produto' | 'Quantidade' | '$ unitário' | 'Aprovação do arquivo' | 'Programação de envio' | 'Observações' | 'Código';

const ORDERS = [
  { id: 'o53', code: 'PO-053' },
  { id: 'o61', code: 'PO-061' },
];

function item(over: Partial<Item>): Item {
  return {
    id: 'a',
    productId: 'p',
    isbn: '9786560950856',
    description: 'Livro Café com Aristóteles',
    supplierId: 's',
    purchaseOrderId: 'o53',
    invoiceId: null,
    status: 'producao',
    quantity: 60_000,
    piecesPerCarton: 40,
    unitPriceMicros: 575_000,
    notes: '',
    fileApprovedAt: null,
    shipPlan: [],
    createdAt: '2026-11-01T12:00:00.000Z',
    updatedAt: '2026-11-01T12:00:00.000Z',
    ...over,
  };
}

/** A linha como volta da planilha baixada (números como texto, do jeito que a leitura devolve). */
function sheetRow(i: Item, edits: Partial<Record<Col, string>> = {}): string[] {
  const values: Record<Col, string> = {
    PO: ORDERS.find((o) => o.id === i.purchaseOrderId)?.code ?? 'Sem PO',
    Produto: i.description,
    Quantidade: String(i.quantity),
    '$ unitário': i.unitPriceMicros == null ? '' : String(i.unitPriceMicros / 1_000_000),
    'Aprovação do arquivo': i.fileApprovedAt ? i.fileApprovedAt.split('-').reverse().join('/') : '',
    'Programação de envio': shipPlanText(i.shipPlan ?? []),
    Observações: i.notes,
    Código: itemCode(i),
    ...edits,
  };
  return [values.PO, 'Claire', values.Produto, i.isbn ?? '', values.Quantidade, '40', values['$ unitário'], '', values['Aprovação do arquivo'], values['Programação de envio'], values.Observações, values.Código];
}

function parse(rows: string[][], items: Item[]): UpdateSheetReport {
  const report = parseUpdateRows([HEADER, ...rows], items, ORDERS);
  if ('error' in report) throw new Error(report.error);
  return report;
}

const cafe = item({ id: 'cafe', shipPlan: [{ month: '2026-12', quantity: 20_000 }], notes: 'Capa dura' });
const alice = item({ id: 'alice', description: 'Coleção Alice', isbn: '9786583970527', purchaseOrderId: 'o61', quantity: 8_000, unitPriceMicros: 1_750_000 });
const sara = item({ id: 'sara', description: 'Livro da Sara', isbn: null, purchaseOrderId: null, quantity: 1_000, unitPriceMicros: null, fileApprovedAt: '2026-10-02' });

describe('código do item', () => {
  it('leva o id e a marca dos três campos, e volta igual', () => {
    const code = itemCode(cafe);
    expect(code).toMatch(/^cafe\.[0-9a-z]{18}$/);
    const v = sheetValues(cafe);
    expect(readItemCode(code)).toEqual({ id: 'cafe', marks: { fileApprovedAt: fieldMark('fileApprovedAt', v), shipPlan: fieldMark('shipPlan', v), notes: fieldMark('notes', v) } });
    expect(readItemCode(`  ${code.toUpperCase().replace('CAFE', 'cafe')} `)?.id).toBe('cafe');
  });

  it('a marca muda quando o campo muda', () => {
    expect(itemCode(cafe)).not.toBe(itemCode({ ...cafe, notes: 'Capa mole' }));
    expect(itemCode(cafe)).not.toBe(itemCode({ ...cafe, shipPlan: [{ month: '2026-12', quantity: 20_001 }] }));
    expect(itemCode(cafe)).toBe(itemCode({ ...cafe, notes: '  Capa dura\r\n' }));
  });

  it('código cortado ou mexido não vale', () => {
    const code = itemCode(cafe);
    for (const text of ['', 'cafe', code.slice(0, -1), `${code}0`, `.${code.split('.')[1]}`, `ca fe.${code.split('.')[1]}`]) expect(readItemCode(text), text).toBeNull();
  });

  it('acha a coluna com ou sem o "(não altere)"', () => {
    expect(isItemCodeHeader(ITEM_CODE_HEADER)).toBe(true);
    expect(isItemCodeHeader('codigo do item')).toBe(true);
    expect(isItemCodeHeader('Código')).toBe(false);
  });
});

describe('atualizar pela planilha', () => {
  it('só entra o que mudou na planilha, com o antes e o depois', () => {
    const report = parse(
      [
        sheetRow(cafe, { 'Aprovação do arquivo': '05/12/2026', 'Programação de envio': 'dez/2026: 20.000; fev/2027: 20.000' }),
        sheetRow(alice),
        sheetRow(sara, { Observações: 'Esperar a prova de cor', 'Aprovação do arquivo': '' }),
      ],
      [cafe, alice, sara],
    );
    expect(report.unchanged).toBe(1);
    expect(report.problems).toEqual([]);
    expect(report.warnings).toEqual([]);
    expect(report.fields).toEqual(['fileApprovedAt', 'shipPlan', 'notes']);
    expect(report.updates).toEqual([
      {
        row: 2,
        id: 'cafe',
        description: 'Livro Café com Aristóteles',
        orderCode: 'PO-053',
        changes: [
          { field: 'fileApprovedAt', from: '', to: '05/12/2026' },
          { field: 'shipPlan', from: 'dez/2026: 20.000', to: 'dez/2026: 20.000; fev/2027: 20.000' },
        ],
        patch: {
          fileApprovedAt: '2026-12-05',
          shipPlan: [
            { month: '2026-12', quantity: 20_000 },
            { month: '2027-02', quantity: 20_000 },
          ],
        },
        marks: { fileApprovedAt: readItemCode(itemCode(cafe))!.marks.fileApprovedAt, shipPlan: readItemCode(itemCode(cafe))!.marks.shipPlan },
      },
      {
        row: 4,
        id: 'sara',
        description: 'Livro da Sara',
        orderCode: null,
        changes: [
          { field: 'fileApprovedAt', from: '02/10/2026', to: '' },
          { field: 'notes', from: '', to: 'Esperar a prova de cor' },
        ],
        patch: { fileApprovedAt: null, notes: 'Esperar a prova de cor' },
        marks: { fileApprovedAt: readItemCode(itemCode(sara))!.marks.fileApprovedAt, notes: readItemCode(itemCode(sara))!.marks.notes },
      },
    ]);
  });

  it('o que mudou no app depois do download, e não na planilha, não volta atrás', () => {
    // Na planilha, como estava no download; no app, outra pessoa mudou as observações e parte embarcou.
    const rows = [sheetRow(cafe)];
    const now = { ...cafe, notes: 'Capa dura, com verniz', quantity: 40_000, shipPlan: [] };
    const report = parse(rows, [now]);
    expect(report.updates).toEqual([]);
    expect(report.unchanged).toBe(1);
    expect(report.problems).toEqual([]);
  });

  it('mudou na planilha e no app: a linha não entra, para não desfazer a mudança do app', () => {
    const rows = [sheetRow(cafe, { Observações: 'Capa mole', 'Aprovação do arquivo': '01/12/2026' })];
    const now = { ...cafe, notes: 'Capa dura, com verniz' };
    const report = parse(rows, [now]);
    expect(report.updates).toEqual([]);
    expect(report.problems).toEqual([
      {
        row: 2,
        message:
          '"Livro Café com Aristóteles": as observações mudaram no app depois que a planilha foi baixada. Para não desfazer essa mudança, a linha não entra: confira na ficha do item ou baixe a lista de novo.',
      },
    ]);
  });

  it('o app já está como a planilha: nada a gravar', () => {
    const report = parse([sheetRow(cafe, { Observações: 'Capa dura, com verniz' })], [{ ...cafe, notes: 'Capa dura, com verniz' }]);
    expect(report.updates).toEqual([]);
    expect(report.unchanged).toBe(1);
  });

  it('o mês digitado que a planilha transformou em data vale para o item inteiro', () => {
    const report = parse([sheetRow(alice, { 'Programação de envio': '01/03/2027' })], [alice]);
    expect(report.updates[0]?.patch).toEqual({ shipPlan: [{ month: '2027-03', quantity: 8_000 }] });
  });

  it('data, programação e observações que não valem não entram, e dizem por quê', () => {
    const report = parse(
      [
        sheetRow(cafe, { 'Aprovação do arquivo': '31/02/2026' }),
        sheetRow(alice, { 'Programação de envio': 'dez/2026: 5.000; fev/2027: 5.000' }),
        sheetRow(sara, { 'Programação de envio': 'dezembro', Observações: 'x'.repeat(2001) }),
      ],
      [cafe, alice, sara],
    );
    expect(report.updates).toEqual([]);
    expect(report.problems).toEqual([
      { row: 2, message: '"Livro Café com Aristóteles": a aprovação do arquivo "31/02/2026" não é uma data (escreva como 05/12/2026).' },
      { row: 3, message: '"Coleção Alice": a programação de envio soma 10.000 exemplares, mais que os 8.000 do item.' },
      {
        row: 4,
        message:
          '"Livro da Sara": na programação de envio, "dezembro" não é um embarque. Escreva como "dez/2026: 20.000; fev/2027: 20.000". As observações passam de 2.000 caracteres.',
      },
    ]);
  });

  it('a programação mudada na planilha vale para a quantidade de agora do item', () => {
    // Parte embarcou depois do download: sobraram 30.000; a programação nova de 40.000 não cabe mais.
    const rows = [sheetRow(cafe, { 'Programação de envio': 'jan/2027: 40.000' })];
    const report = parse(rows, [{ ...cafe, quantity: 30_000 }]);
    expect(report.problems[0]?.message).toBe('"Livro Café com Aristóteles": a programação de envio soma 40.000 exemplares, mais que os 30.000 do item.');
  });

  it('linhas sem código, com código mexido, repetido, de item que não existe ou que já embarcou', () => {
    const shipped = item({ id: 'foi', description: 'Livro embarcado', status: 'embarcado', invoiceId: 'v1' });
    const report = parse(
      [
        sheetRow(cafe, { Código: '' }),
        ['', '', '', '', '120000', '', '', '', '', '', '', ''],
        sheetRow(alice, { Código: 'alice.123' }),
        sheetRow(sara, { Observações: 'a' }),
        sheetRow(sara, { Observações: 'b' }),
        sheetRow(item({ id: 'sumiu', description: 'Livro excluído' })),
        sheetRow(shipped, { Observações: 'x' }),
        HEADER,
      ],
      [cafe, alice, sara, shipped],
    );
    expect(report.updates).toEqual([]);
    expect(report.problems).toEqual([
      { row: 2, message: '"Livro Café com Aristóteles": sem o código do item, a linha não entra. Item novo entra pelo Novo item ou pelo Novo pedido.' },
      { row: 4, message: 'O código do item "alice.123" não está inteiro. Não mude essa coluna; se precisar, baixe a lista de novo.' },
      { row: 5, message: 'O mesmo código do item está nas linhas 5 e 6. Deixe uma linha só para cada item.' },
      { row: 6, message: 'O mesmo código do item está nas linhas 5 e 6. Deixe uma linha só para cada item.' },
      { row: 7, message: '"Livro excluído": o item deste código não está mais no app (pode ter sido excluído).' },
      { row: 8, message: '"Livro embarcado" já embarcou; a planilha só atualiza o que está em produção. Se precisar, mude na ficha do item.' },
    ]);
  });

  it('código fora do lugar (a planilha ordenada só em parte) não entra', () => {
    // Os códigos ficaram onde estavam e as linhas mudaram de ordem.
    const a = sheetRow(cafe, { Observações: 'Nota do café' });
    const b = sheetRow(alice, { Observações: 'Nota da Alice' });
    [a[11], b[11]] = [b[11]!, a[11]!];
    const report = parse([a, b], [cafe, alice]);
    expect(report.updates).toEqual([]);
    expect(report.problems.map((p) => p.message)).toEqual([
      'A linha tem "Livro Café com Aristóteles" (PO-053), mas o código é de "Coleção Alice" (PO-061). Se a planilha foi ordenada só em parte, os códigos saíram do lugar: baixe a lista de novo. Produto e PO só mudam na ficha do item.',
      'A linha tem "Coleção Alice" (PO-061), mas o código é de "Livro Café com Aristóteles" (PO-053). Se a planilha foi ordenada só em parte, os códigos saíram do lugar: baixe a lista de novo. Produto e PO só mudam na ficha do item.',
    ]);
  });

  it('o mesmo produto em outra PO também é outra linha', () => {
    const reprint = item({ id: 'cafe2', purchaseOrderId: 'o61' });
    const a = sheetRow(cafe);
    a[0] = 'PO-061';
    expect(parse([a], [cafe, reprint]).problems).toHaveLength(1);
    expect(parse([sheetRow(cafe, { Produto: '' })], [cafe]).problems[0]?.message).toMatch(/^A linha está sem o produto, mas o código é de "Livro Café com Aristóteles" \(PO-053\)\./);
    // Maiúsculas, acentos e espaços a mais no nome não contam.
    expect(parse([sheetRow(cafe, { Produto: '  livro cafe COM aristóteles ' })], [cafe]).problems).toEqual([]);
  });

  it('quantidade e preço mudados na planilha não entram, com aviso; o resto da linha entra', () => {
    const report = parse([sheetRow(alice, { Quantidade: '9.000', '$ unitário': '1.8', Observações: 'Mais 1.000' }), sheetRow(cafe, { Quantidade: '60.000' })], [alice, cafe]);
    expect(report.updates.map((u) => u.patch)).toEqual([{ notes: 'Mais 1.000' }]);
    expect(report.warnings).toEqual([
      {
        row: 2,
        message: '"Coleção Alice": a quantidade da planilha (9.000) não é a do app (8.000) e o preço da planilha (US$ 1,80) não é o do app (US$ 1,75). Quantidade e preço só mudam na ficha do item.',
      },
    ]);
  });

  it('observações com quebra de linha do Windows e espaços nas pontas não contam como mudança', () => {
    const notes = item({ id: 'n', notes: 'Linha 1\nLinha 2' });
    expect(parse([sheetRow(notes, { Observações: ' Linha 1\r\nLinha 2 ' })], [notes]).unchanged).toBe(1);
  });

  it('lê só as colunas que estão na planilha', () => {
    const rows = [
      ['Produto', 'PO', 'Observações', 'Código do item'],
      [cafe.description, 'PO-053', 'Nova nota', itemCode(cafe)],
    ];
    const report = parseUpdateRows(rows, [cafe], ORDERS);
    expect(report).toMatchObject({ fields: ['notes'], updates: [{ patch: { notes: 'Nova nota' } }], problems: [], warnings: [] });
  });

  it('sem o código, sem o produto ou sem as três colunas, explica o que falta', () => {
    expect(parseUpdateRows([['PO', 'Produto', 'Quantidade', 'Observações']], [cafe], ORDERS)).toEqual({
      error: 'Não achei a coluna "Código do item". Baixe a lista pelo "Baixar .xlsx" da Produção (ela traz o código de cada item), mude nela o que precisar e envie de novo.',
    });
    expect(parseUpdateRows([['PO', 'Observações', ITEM_CODE_HEADER]], [cafe], ORDERS)).toEqual({ error: 'A planilha precisa da coluna "Produto", para conferir que cada código está na linha certa.' });
    expect(parseUpdateRows([['Produto', 'Quantidade', ITEM_CODE_HEADER]], [cafe], ORDERS)).toEqual({
      error: 'A planilha não tem as colunas Aprovação do arquivo, Programação de envio nem Observações: não há o que atualizar.',
    });
    expect(parseUpdateRows([HEADER, ['', '', '', '', '', '', '', '', '', '', '', '']], [cafe], ORDERS)).toEqual({ error: 'A planilha não tem itens com o código do item.' });
  });
});

describe('conferência no servidor', () => {
  const marks = readItemCode(itemCode(cafe))!.marks;
  const current = { ...sheetValues(cafe), quantity: cafe.quantity };

  it('grava o que mudou quando o app está como no download', () => {
    expect(checkSheetPatch(current, { notes: ' Capa mole ', fileApprovedAt: '2026-12-05' }, marks)).toEqual({
      next: { fileApprovedAt: '2026-12-05', shipPlan: cafe.shipPlan, notes: 'Capa mole' },
      changed: ['fileApprovedAt', 'notes'],
    });
    // Mandar o que já está gravado não muda nada, nem quando o app mudou depois do download (a mesma
    // planilha mandada de novo depois de uma falha no meio da gravação).
    expect(checkSheetPatch(current, { notes: 'Capa dura' }, marks)).toMatchObject({ changed: [] });
    expect(checkSheetPatch({ ...current, notes: 'Capa mole' }, { notes: 'Capa mole' }, marks)).toMatchObject({ changed: [] });
  });

  it('recusa o campo que mudou no app desde o download', () => {
    const now = { ...current, shipPlan: [{ month: '2027-01', quantity: 20_000 }] };
    expect(checkSheetPatch(now, { shipPlan: [{ month: '2027-02', quantity: 20_000 }], notes: 'x' }, marks)).toEqual({ conflict: ['shipPlan'] });
    // Sem a marca do campo, também não grava.
    expect(checkSheetPatch(current, { notes: 'x' }, {})).toEqual({ conflict: ['notes'] });
    // Mudança no app num campo que a planilha não mexe não atrapalha.
    expect(checkSheetPatch({ ...now }, { notes: 'x' }, marks)).toMatchObject({ changed: ['notes'] });
  });

  it('a programação precisa caber na quantidade de agora', () => {
    expect(checkSheetPatch({ ...current, quantity: 30_000 }, { shipPlan: [{ month: '2027-01', quantity: 40_000 }] }, marks)).toEqual({
      problem: 'A programação de envio soma 40.000 exemplares, mais que os 30.000 do item.',
    });
  });
});
