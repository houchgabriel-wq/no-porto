import { describe, expect, it } from 'vitest';
import { columnName, invoiceNameChanges, nameCellText, replaceCellTexts, sheetPartPath } from './invoiceNames';

describe('nomes novos na invoice guardada', () => {
  it('a letra da coluna', () => {
    expect([0, 1, 25, 26, 27, 701, 702].map(columnName)).toEqual(['A', 'B', 'Z', 'AA', 'AB', 'ZZ', 'AAA']);
  });

  it('o texto da célula: o nome novo, e o ISBN que vinha junto continua onde estava', () => {
    expect(nameCellText('Livro Cartas a Milena - Camelot', 'Cartas a Milena - Franz Kafka - Camelot Editora')).toBe('Cartas a Milena - Franz Kafka - Camelot Editora');
    expect(nameCellText('Coleção Alice\n978-65-83970-52-7', 'Coleção Alice no País das Maravilhas')).toBe('Coleção Alice no País das Maravilhas\n978-65-83970-52-7');
    expect(nameCellText('Coleção Alice ISBN: 9786583970527', 'Coleção Alice no País das Maravilhas')).toBe('Coleção Alice no País das Maravilhas ISBN: 9786583970527');
    expect(nameCellText('ISBN 978-65-83970-52-7 - Coleção Alice', 'Coleção Alice no País das Maravilhas')).toBe('ISBN 978-65-83970-52-7 Coleção Alice no País das Maravilhas');
  });

  it('as células a trocar: só as linhas com nome novo, diferente do da invoice', () => {
    const lines = [
      { row: 9, description: 'Livro Cartas a Milena - Camelot' },
      { row: 10, description: 'Box Bluey' },
      { row: 11, description: 'Dos Delitos e das Penas' },
      { row: 13, description: 'Coleção Alice', nameCell: 'Coleção Alice\n978-65-83970-52-7' },
    ];
    const changes = invoiceNameChanges(lines, ['Cartas a Milena - Franz Kafka - Camelot Editora', null, 'Dos Delitos e das Penas', 'Coleção Alice no País das Maravilhas'], 0);
    expect([...changes]).toEqual([
      ['A9', 'Cartas a Milena - Franz Kafka - Camelot Editora'],
      ['A13', 'Coleção Alice no País das Maravilhas\n978-65-83970-52-7'],
    ]);
    expect([...invoiceNameChanges(lines.slice(0, 1), ['Outro nome'], 27).keys()]).toEqual(['AB9']);
  });

  it('acha o arquivo da aba pelo nome, com caminho relativo ou absoluto', () => {
    const workbook =
      '<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
      '<sheet name="PL" sheetId="1" r:id="rId1"/><sheet name="CI &amp; PL" sheetId="2" r:id="rId2"/><sheet sheetId="3" name="Outra" r:id="rId9"/></sheets></workbook>';
    const rels =
      '<Relationships><Relationship Id="rId1" Type="worksheet" Target="worksheets/sheet1.xml"/>' +
      '<Relationship Target="/xl/worksheets/sheet2.xml" Type="worksheet" Id="rId2"/></Relationships>';
    expect(sheetPartPath(workbook, rels, 'PL')).toBe('xl/worksheets/sheet1.xml');
    expect(sheetPartPath(workbook, rels, 'CI & PL')).toBe('xl/worksheets/sheet2.xml');
    expect(sheetPartPath(workbook, rels, 'Outra')).toBeNull();
    expect(sheetPartPath(workbook, rels, 'Não existe')).toBeNull();
  });

  it('troca só as células pedidas, com o mesmo estilo, e deixa o resto da aba como estava', () => {
    const sheet =
      '<worksheet><cols><col min="1" max="1" width="40"/></cols><sheetData>' +
      '<row r="9"><c r="A9" s="13" t="s"><v>13</v></c><c r="B9" s="36"><v>9786585168663</v></c><c r="E9" s="16"><f>C9*D9</f><v>2640</v></c></row>' +
      '<row r="10"><c r="A10" s="17"/><c r="B10" t="s"><v>14</v></c></row>' +
      '<row r="11"><c r="A11" t="str" s="2"><f>B11</f><v>Velho</v></c></row>' +
      '</sheetData><conditionalFormatting><cfRule type="x"/></conditionalFormatting></worksheet>';
    const texts = new Map([
      ['A9', 'Cartas a Milena - Franz Kafka & Cia <Camelot>'],
      ['A10', 'Box Bluey'],
      ['A11', 'Nome novo'],
      ['A12', 'Linha que não existe'],
    ]);
    const { xml, replaced } = replaceCellTexts(sheet, texts);
    expect(replaced).toEqual(['A9', 'A10', 'A11']);
    expect(xml).toBe(
      '<worksheet><cols><col min="1" max="1" width="40"/></cols><sheetData>' +
        '<row r="9"><c r="A9" s="13" t="inlineStr"><is><t xml:space="preserve">Cartas a Milena - Franz Kafka &amp; Cia &lt;Camelot&gt;</t></is></c><c r="B9" s="36"><v>9786585168663</v></c><c r="E9" s="16"><f>C9*D9</f><v>2640</v></c></row>' +
        '<row r="10"><c r="A10" s="17" t="inlineStr"><is><t xml:space="preserve">Box Bluey</t></is></c><c r="B10" t="s"><v>14</v></c></row>' +
        '<row r="11"><c r="A11" s="2" t="inlineStr"><is><t xml:space="preserve">Nome novo</t></is></c></row>' +
        '</sheetData><conditionalFormatting><cfRule type="x"/></conditionalFormatting></worksheet>',
    );
  });

  it('aceita as tags com prefixo (x:c), que alguns programas escrevem', () => {
    const sheet = '<x:sheetData><x:row r="9"><x:c r="A9" s="1" t="s"><x:v>3</x:v></x:c><x:c r="B9"><x:v>1</x:v></x:c></x:row></x:sheetData>';
    expect(replaceCellTexts(sheet, new Map([['A9', 'Novo']])).xml).toBe(
      '<x:sheetData><x:row r="9"><x:c r="A9" s="1" t="inlineStr"><x:is><x:t xml:space="preserve">Novo</x:t></x:is></x:c><x:c r="B9"><x:v>1</x:v></x:c></x:row></x:sheetData>',
    );
  });
});
