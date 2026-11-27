// O PDF da proposta da gráfica (27/11/2026): o texto que o pdf.js tira das propostas reais da Grafilar (117.627, o kit do
// Curso Básico de Desenho com o avulso do Mangá, papel da gráfica) e da Assahi (103896.04, Meditações, papel nosso),
// sem os telefones e os nomes de pessoas.
import { describe, expect, it } from 'vitest';
import { matchItemsToProducts, matchPaper, matchPrinter, paperDisplayName, parseCount, productsFromItems, readProposal, specificationFromItems } from './proposalPdf';

const GRAFILAR = `Warning: UnknownErrorException: Ensure that the \`standardFontDataUrl\` API parameter is provided.
Warning: UnknownErrorException: Ensure that the \`standardFontDataUrl\` API parameter is provided.
Warning: UnknownErrorException: Ensure that the \`standardFontDataUrl\` API parameter is provided.
Warning: UnknownErrorException: Ensure that the \`standardFontDataUrl\` API parameter is provided.
À
Editora On Line
Prezado(s) senhor(es),
Conforme solicitado, encaminhamos abaixo nossa proposta:
Quantidade Descrição Unitário Valor Total
15.000 Box BOX - BOX - Curso Básico de Desenho, Form. 292 x 416
mm, 1 Lâmina em Cartão Triplex C1S LD 250 g/m2, 4x0 cores,
Refile Inicial, BOPP Fosco Frente, Corte e Vinco, Refile Final,
Shrink Individual, CTP Incluso, Manuseio dos boxes + Inser dos
livros + Shrink Ind, Verniz Reserva Frente, Faca Especial -
Cálculo 350.670
R$ 3,46 R$ 51.900,00
15.000 x 3 Livro PUR Curso Básico de Desenho - Básico /Mangá/Rosto .
.___________________________________________
15.000 Unds Cada Modelo : Sendo 15.000 Para os Kites
Somente o Mangá = 15.000 unds + 2.000 Enviado
Separadamente em Caixas
Básico =15.000 undfs
Mangá = 15.000 unds + 2.000 Enviado Separadamente em
Caixas
Rosto =15.000 undfs
____________________________________________,
Form.Aberto 302 x 230 mm, Form.Fechado 151 x 230 mm, Capa.,
formato 455 x 230 mm em Cartão Triplex C1S LD 230 g/m2,
Orelhas: 70 x 70 mm, 4x0 cores, Miolo. 160 págs. em Lux Cream
LD 60 g/m2, 1x1 cores, Refile Inicial(Miolo., Capa.),
Dobrado(Miolo.), BOPP Fosco Frente(Capa.), Refile
Intermediário(Capa.), Alceado Pur - Lombada Quadrada, Dobra
de Orelhas, Refile Final, Paletizar, CTP Incluso(Capa.), Verniz
Reserva Frente (Capa) (Capa.), Encaixotados (Caixa Coletiva
Fornecida Pela Editor, CTP Incluso(Miolo.) - Cálculo 350.671
R$ 3,29 R$ 148.050,00
São Manuel, 24 de novembro de 2026 Proposta nº 117.627
continua...
...continuação
São Manuel, 24 de novembro de 2026 Proposta nº 117.627
2.000 Livro PUR Curso Básico de Desenho Mangá .
.___________________________________________
15.000 Unds Cada Modelo : Sendo 15.000 Para os Kites
Somente o Mangá = 15.000 unds + 2.000 Enviado
Separadamente em Caixas
Básico =15.000 undfs
Mangá = 15.000 unds + 2.000 Enviado Separadamente em
Caixas
Rosto =15.000 undfs
____________________________________________,
Form.Aberto 302 x 230 mm, Form.Fechado 151 x 230 mm, Capa.,
formato 315 x 230 mm em Cartão Triplex C1S LD 230 g/m2, 4x0
cores, Miolo. 160 págs. em Lux Cream LD 60 g/m2, 1x1 cores,
Refile Inicial(Capa., Miolo.), BOPP Fosco Frente(Capa.), Refile
Intermediário(Capa.), Dobrado(Miolo.), Alceado Pur - Lombada
Quadrada, Refile Final, Paletizar, CTP Incluso(Capa.), Verniz
Reserva Frente (Capa) (Capa.), Encaixotados (Caixa Coletiva
Fornecida Pela Editor, CTP Incluso(Miolo.) - Cálculo 350.700
R$ 3,29 R$ 6.580,00
Cond. Pagto: 30 DDL Validade: 10 dias
Vendedor: Gil Imposto: ISENTO
Programação Entrega: a combinar
Obs.:
continua...
...continuação
São Manuel, 24 de novembro de 2026 Proposta nº 117.627
A Grafilar não se responsabiliza pelo conteúdo, por erros de arquivos ou artes, quando fornecidos pelo cliente, ou`;

const ASSAHI = `Itu 24/11/2026
À ON LINE EDITORA
Prezado Cliente
Vimos através desta apresentar nossa proposta orçamentária para a confecção de material conforme especificado abaixo:
Ítem(s) solicitado(s) do orçamento 103896.
103896.04 20.000 Livro Fresado Hot melt - MEDITAÇÕES
CAPA* 707 KG: 23x46,7cm, 4x0 cores, Escala Europa em Triplex LD 230g fornecido pelo cliente = 3534 fl 77x113cm. CTP
INCLUSO. Prova Digital.
MIOLO * 2463 KG: 96 pgs, 15,1x23cm, 1 cor em Offwhite Rot Forn 60g fornecido pelo cliente = 2463,44 kg 96cm. CTP INCLUSO.
MIOLO * 846 KG: 32 pgs, 15,1x23cm, 1 cor em Offwhite Rot Forn 60g fornecido pelo cliente = 846,81 kg 66cm. CTP INCLUSO.
Lombada:6mm, Hot-Melt, Alceado, Trilateral, Dobra orelha, Laminacao Fosca, Nº Lado(s) 1, Verniz Uv Localizado, palets, fret -
Alphaville, sedex.
Total R$ : 23.600,00 Unit: R$ 1,18 Pgto: 30 dias
OBS: ORÇAMENTO P/ IMPRESSÃO ROTATIVA. Validade Proposta : 15 dias* Condição Fornecimento: A entrega do
material está sujeita a uma variação de até 5% para mais ou para menos
da quantidade contratada, será faturada a quantidade entregue,
prevalecendo o preço unitário.
Na aprovação do orçamento: Retornar o mesmo c/ item(ns) assinado.
***Grande São Paulo frete incluso p/ entrega em 1 (um) endereço***.Contato Direto
Autorizo a confecção dos ítens acima assinalados,
Atenciosamente,
Assahi IBC - INSTITUTO BRASILEIRO DE CULTURA LTDA
`;

describe('a proposta da Grafilar (a tabela com quantidade, descrição, unitário e total)', () => {
  const read = readProposal(GRAFILAR);

  it('a gráfica, o número, a data, a validade, o pagamento e o papel da gráfica', () => {
    expect(read).toMatchObject({
      layout: 'grafilar',
      printerName: 'Grafilar',
      proposalNumber: '117.627',
      proposalDate: '2026-11-24',
      validDays: 10,
      paymentTerms: '30 DDL',
      leadDays: null,
      paperBy: 'grafica',
      papers: [],
      warnings: [],
    });
  });

  it('os itens: o box, os 3 livros do "15.000 x 3" (um para cada modelo) e o avulso do Mangá, com a especificação', () => {
    expect(read.items.map((i) => [i.description, i.quantity, i.unitPriceE4, i.totalCents])).toEqual([
      ['Box - Curso Básico de Desenho', 15_000, 34_600, 5_190_000],
      ['Livro PUR Curso Básico de Desenho - Básico', 15_000, 32_900, 4_935_000],
      ['Livro PUR Curso Básico de Desenho - Mangá', 15_000, 32_900, 4_935_000],
      ['Livro PUR Curso Básico de Desenho - Rosto', 15_000, 32_900, 4_935_000],
      ['Livro PUR Curso Básico de Desenho Mangá', 2_000, 32_900, 658_000],
    ]);
    expect(read.items[0]!.specification).toBe(
      'Form. 292 x 416 mm, 1 Lâmina em Cartão Triplex C1S LD 250 g/m2, 4x0 cores, Refile Inicial, BOPP Fosco Frente, Corte e Vinco, Refile Final, Shrink Individual, CTP Incluso, Manuseio dos boxes + Inser dos livros + Shrink Ind, Verniz Reserva Frente, Faca Especial',
    );
    // A especificação do livro é a que vem depois dos traços, sem as observações da gráfica nem o "Cálculo".
    expect(read.items[1]!.specification).toMatch(/^Form\.Aberto 302 x 230 mm, Form\.Fechado 151 x 230 mm, Capa\., formato 455 x 230 mm em Cartão Triplex C1S LD 230 g\/m2,.*CTP Incluso\(Miolo\.\)$/);
    expect(read.items[4]!.specification).toContain('formato 315 x 230 mm');
  });

  it('casa os itens com os produtos do orçamento: o box, os livros de dentro do box e o avulso pela quantidade', () => {
    const products = [
      { title: 'Box Curso Básico de Desenho', quantity: 15_000 },
      { title: 'Curso Básico de Desenho - Básico', quantity: 15_000 },
      { title: 'Curso Básico de Desenho - Mangá', quantity: 15_000 },
      { title: 'Curso Básico de Desenho - Rosto', quantity: 15_000 },
      { title: 'Curso Básico de Desenho - Mangá (avulso)', quantity: 2_000 },
    ];
    expect(matchItemsToProducts(read.items, products)).toEqual([0, 1, 2, 3, 4]);
    // Num orçamento de um produto só, tudo vai para ele.
    expect(matchItemsToProducts(read.items, [products[0]!])).toEqual([0, 0, 0, 0, 0]);
  });

  it('a especificação do orçamento: as iguais viram um parágrafo só, e o limite não corta um parágrafo no meio', () => {
    const spec = specificationFromItems(read.items);
    const paragraphs = spec.split('\n\n');
    expect(paragraphs.map((p) => p.slice(0, p.indexOf(':')))).toEqual([
      'Box - Curso Básico de Desenho',
      'Livro PUR Curso Básico de Desenho - Básico, Mangá e Rosto',
      'Livro PUR Curso Básico de Desenho Mangá',
    ]);
    expect(spec.length).toBeLessThanOrEqual(2000);
    // Com pouco espaço, ficam só os parágrafos inteiros que cabem.
    expect(specificationFromItems(read.items, 500).split('\n\n')).toHaveLength(1);
    expect(specificationFromItems([{ description: 'A', specification: 'palavra '.repeat(50) }], 40)).toBe('A: palavra palavra palavra palavra…');
  });

  it('os produtos de um orçamento novo: os livros com a quantidade do box vão dentro dele; o avulso, não', () => {
    expect(productsFromItems(read.items)).toEqual([
      { title: 'Box - Curso Básico de Desenho', quantity: 15_000, inBox: false },
      { title: 'Curso Básico de Desenho - Básico', quantity: 15_000, inBox: true },
      { title: 'Curso Básico de Desenho - Mangá', quantity: 15_000, inBox: true },
      { title: 'Curso Básico de Desenho - Rosto', quantity: 15_000, inBox: true },
      { title: 'Curso Básico de Desenho Mangá', quantity: 2_000, inBox: false },
    ]);
  });
});

describe('a proposta da Assahi (o item com a capa e os miolos em kg, papel nosso)', () => {
  const read = readProposal(ASSAHI);

  it('a gráfica, o número, a data, a validade, o pagamento e o papel nosso', () => {
    expect(read).toMatchObject({
      layout: 'assahi',
      printerName: 'Assahi',
      proposalNumber: '103896.04',
      proposalDate: '2026-11-24',
      validDays: 15,
      paymentTerms: '30 dias',
      leadDays: null,
      paperBy: 'editora',
      warnings: [],
    });
  });

  it('o item, com a especificação, e o preço que bate com o total', () => {
    expect(read.items).toHaveLength(1);
    expect(read.items[0]).toMatchObject({ description: 'Livro Fresado Hot melt - MEDITAÇÕES', quantity: 20_000, unitPriceE4: 11_800, totalCents: 2_360_000 });
    expect(read.items[0]!.specification).toMatch(/^CAPA\* 707 KG: 23x46,7cm, 4x0 cores.*Alphaville, sedex\.$/);
  });

  it('o papel nosso: a capa de Triplex e os dois miolos de Offwhite, com o peso exato quando a linha traz', () => {
    expect(read.papers).toEqual([
      { part: 'capa', paperName: 'Triplex LD 230g', grams: 707_000, item: 0 },
      { part: 'miolo', paperName: 'Offwhite Rot Forn 60g', grams: 2_463_440, item: 0 },
      { part: 'miolo', paperName: 'Offwhite Rot Forn 60g', grams: 846_810, item: 0 },
    ]);
  });

  it('o "fornecidos pelo cliente" das condições da Grafilar não vira papel nosso', () => {
    expect(readProposal(GRAFILAR).paperBy).toBe('grafica');
  });
});

describe('casar com o cadastro', () => {
  it('a gráfica cadastrada pelo nome, sem as palavras genéricas', () => {
    const printers = [
      { id: 'a', name: 'Assahi Gráfica e Editora' },
      { id: 'g', name: 'Grafilar' },
      { id: 's', name: 'Gráfica Santa Marta' },
    ];
    expect(matchPrinter(ASSAHI, printers)?.id).toBe('a');
    expect(matchPrinter(GRAFILAR, printers)?.id).toBe('g');
    expect(matchPrinter('Proposta da Gráfica Exklusiva', printers)).toBeNull();
  });

  it('o papel da tabela pela gramatura e pelas palavras; o nome para cadastrar sem o "Forn"', () => {
    const papers = [
      { id: 't', name: 'Triplex LD 230 g' },
      { id: 'o', name: 'Offwhite Rot 60 g' },
      { id: 'o75', name: 'Offwhite Rot 75 g' },
      { id: 'c', name: 'Cartão Triplex C1S 250 g' },
    ];
    expect(matchPaper('Triplex LD 230g', papers)?.id).toBe('t');
    expect(matchPaper('Offwhite Rot Forn 60g', papers)?.id).toBe('o');
    expect(matchPaper('Pólen Soft 80g', papers)).toBeNull();
    expect([paperDisplayName('Offwhite Rot Forn 60g'), paperDisplayName('Triplex LD 230g'), paperDisplayName('Cartão Triplex C1S LD 250 g/m2')]).toEqual([
      'Offwhite Rot 60 g',
      'Triplex LD 230 g',
      'Cartão Triplex C1S LD 250 g',
    ]);
  });

  it('a quantidade com ponto de milhar', () => {
    expect(['15.000', '2.000', '500', '1.234.567'].map(parseCount)).toEqual([15_000, 2_000, 500, 1_234_567]);
    expect(['15,5', '', '0', '1.23'].map(parseCount)).toEqual([null, null, null, null]);
  });
});

describe('outros formatos', () => {
  it('o genérico: a quantidade, a descrição e os dois preços na mesma linha', () => {
    const read = readProposal('Gráfica Exemplo Ltda\nOrçamento nº 4521\n10.000 Livro Cartas a Milena, 14 x 21 cm R$ 2,85 R$ 28.500,00\nValidade: 7 dias\nPrazo de entrega: 20 dias úteis');
    expect(read).toMatchObject({ layout: 'generico', printerName: 'Gráfica Exemplo', proposalNumber: '4521', validDays: 7, leadDays: 20, paperBy: 'grafica' });
    expect(read.items).toEqual([{ description: 'Livro Cartas a Milena', specification: '14 x 21 cm', quantity: 10_000, unitPriceE4: 28_500, totalCents: 2_850_000 }]);
  });

  it('o PDF sem nada que se pareça com uma proposta avisa e fica vazio', () => {
    const read = readProposal('Boleto bancário\nVencimento 10/12/2026');
    expect(read.items).toEqual([]);
    expect(read.warnings).toEqual(['Não consegui ler os itens da proposta: preencha os itens à mão.']);
    expect(read.proposalDate).toBe('2026-12-10');
  });
});
