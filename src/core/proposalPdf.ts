// O PDF da proposta da gráfica (pedido do Gabriel em 27/11/2026): ao anexar o arquivo que a gráfica mandou, o sistema
// lê a gráfica, o número, a data, a validade, o pagamento e o prazo, os itens (com a especificação, a quantidade e o
// preço) e, quando a proposta é com o papel nosso, as linhas de papel (a parte, o papel e o peso em kg), para o custo
// sair pela tabela de papéis. Cada gráfica escreve de um jeito: o leitor conhece o da Grafilar (a tabela com
// quantidade, descrição, unitário e total) e o da Assahi (o item com a capa e os miolos em kg e o "Total R$ ... Unit"),
// e tenta o genérico (quantidade, descrição e os dois preços na mesma linha). O que ele lê é conferido na tela antes
// de gravar. Recebe o texto que o pdf.js tira do PDF (src/app/pdfText.ts), uma linha por linha do arquivo.

import { parseBrlUnitPrice, parseKgGrams, type PaperBy, type PaperPart } from './brazil';
import { searchKey } from './items';
import { parseScaled } from './money';

export interface ProposalItemRead {
  /** O nome do item, como a gráfica escreveu, sem as repetições ("Box BOX - BOX - Curso" vira "Box - Curso"). */
  description: string;
  /** A especificação do item: formato, papel, cores e acabamento. */
  specification: string;
  quantity: number;
  /** Preço por unidade, em reais × 10.000. */
  unitPriceE4: number;
  /** O total do item no PDF, em centavos, para conferir; null quando não veio. */
  totalCents: number | null;
}

export interface ProposalPaperRead {
  part: PaperPart;
  /** O nome do papel como a gráfica escreveu ("Offwhite Rot Forn 60g"). */
  paperName: string;
  grams: number;
  /** O item da proposta (o índice em items) a que a linha de papel pertence. */
  item: number;
}

export type ProposalLayout = 'grafilar' | 'assahi' | 'generico';

export interface ProposalRead {
  layout: ProposalLayout;
  /** A gráfica que o texto diz que mandou; null quando não deu para saber. */
  printerName: string | null;
  proposalNumber: string;
  proposalDate: string | null;
  validDays: number | null;
  paymentTerms: string;
  leadDays: number | null;
  /** Papel nosso quando as linhas de papel dizem "fornecido pelo cliente". */
  paperBy: PaperBy;
  items: ProposalItemRead[];
  papers: ProposalPaperRead[];
  /** O que o leitor não conseguiu ler ou precisa ser conferido. */
  warnings: string[];
}

const MONTHS = ['janeiro', 'fevereiro', 'marco', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

const pad = (n: number) => String(n).padStart(2, '0');

/** A quantidade escrita com ponto de milhar ("15.000", "2.000", "500") → número; null se não for. */
export function parseCount(text: string): number | null {
  const t = text.trim();
  if (!/^\d{1,3}(?:\.\d{3})+$|^\d+$/.test(t)) return null;
  const n = Number(t.replace(/\./g, ''));
  return n > 0 ? n : null;
}

/** Reais com centavos ("51.900,00", "R$ 6.580,00") → centavos; null se não for. */
function parseCents(text: string): number | null {
  return parseScaled(text.replace(/^R\$\s*/i, '').trim(), 2);
}

/** A data da proposta: "24 de novembro de 2026" ou "24/11/2026", a primeira que aparece. */
function readDate(text: string): string | null {
  const long = /(\d{1,2})\s+de\s+([a-zç]+)\s+de\s+(\d{4})/i.exec(searchKey(text));
  const short = /\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/.exec(text);
  const candidates: { at: number; iso: string }[] = [];
  if (long) {
    const month = MONTHS.indexOf(long[2]!);
    if (month >= 0) candidates.push({ at: searchKey(text).indexOf(long[0]), iso: `${long[3]}-${pad(month + 1)}-${pad(Number(long[1]))}` });
  }
  if (short && Number(short[2]) >= 1 && Number(short[2]) <= 12) candidates.push({ at: searchKey(text).indexOf(searchKey(short[0])), iso: `${short[3]}-${pad(Number(short[2]))}-${pad(Number(short[1]))}` });
  candidates.sort((a, b) => a.at - b.at);
  const iso = candidates[0]?.iso ?? null;
  return iso && !Number.isNaN(Date.parse(`${iso}T00:00:00Z`)) ? iso : null;
}

/** O texto depois de um rótulo, até o fim da linha ou até o próximo rótulo conhecido. */
function afterLabel(text: string, label: RegExp): string | null {
  const m = label.exec(text);
  if (!m) return null;
  const rest = text.slice(m.index + m[0].length).split('\n')[0]!;
  const stop = /\s+(?:Validade|Imposto|Vendedor|Prazo|Frete|Total|Unit|Obs)\b/i.exec(rest);
  const value = (stop ? rest.slice(0, stop.index) : rest).replace(/^[\s:]+/, '').trim();
  return value || null;
}

/** As palavras que identificam uma gráfica pelo nome ("Assahi Gráfica e Editora" → "assahi"). */
const GENERIC_NAME_WORDS = new Set(['grafica', 'graficas', 'editora', 'industria', 'comercio', 'ltda', 'eireli', 'servicos', 'impressao', 'impressos', 'papel', 'artes', 'graficos', 'grupo', 'brasil', 'cia']);
function nameWords(name: string): string[] {
  return searchKey(name)
    .split(' ')
    .filter((w) => w.length >= 4 && !GENERIC_NAME_WORDS.has(w));
}

/** A gráfica que o texto diz que mandou: a que assina as condições, a que assina a carta ou uma "Gráfica X". */
function guessPrinter(text: string): string | null {
  const terms = /\bA[ \t]+([A-ZÀ-Ú][\wÀ-ú]+(?:[ \t]+[A-ZÀ-Ú][\wÀ-ú]+)?)[ \t]+n[ãa]o[ \t]+se[ \t]+responsabiliza/.exec(text);
  if (terms) return terms[1]!;
  const signed = /Atenciosamente,?[ \t]*\n[ \t]*([A-ZÀ-Ú][\wÀ-ú]+)/.exec(text);
  if (signed) return signed[1]!;
  const named = /\bGr[áa]fica[ \t]+([A-ZÀ-Ú][\wÀ-ú]+(?:[ \t]+[A-ZÀ-Ú][\wÀ-ú]+){0,2})/.exec(text);
  if (!named) return null;
  // Sem o "Ltda", o "Editora" e o que mais vier depois do nome.
  const words = named[1]!.split(/[ \t]+/);
  const end = words.findIndex((w) => GENERIC_NAME_WORDS.has(searchKey(w)) || /^(?:me|s\/?a|epp)$/i.test(w));
  const name = (end >= 0 ? words.slice(0, end) : words).join(' ');
  return name ? `Gráfica ${name}` : null;
}

/**
 * A gráfica cadastrada que aparece no texto (pelas palavras do nome, como "Assahi" em "Assahi Gráfica e Editora"); se
 * nenhuma aparece, null.
 */
export function matchPrinter<T extends { id: string; name: string }>(text: string, printers: readonly T[]): T | null {
  const words = new Set(searchKey(text).split(' '));
  let best: { printer: T; score: number } | null = null;
  for (const p of printers) {
    const own = nameWords(p.name);
    const score = own.filter((w) => words.has(w)).length;
    if (score === 0) continue;
    if (!best || score > best.score || (score === best.score && p.name.length > best.printer.name.length)) best = { printer: p, score };
  }
  return best?.printer ?? null;
}

/** Tira do nome as palavras repetidas ("Box BOX - BOX - Curso" → "Box - Curso") e a pontuação solta no fim. */
function cleanName(name: string): string {
  return name
    .replace(/\b(\p{L}+)\b(?:\s*-?\s*\b\1\b)+/giu, '$1')
    .replace(/[\s.,;:-]+$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Tira o "- Cálculo 350.670" que a Grafilar põe no fim da especificação. */
function cleanSpecification(spec: string): string {
  return spec
    .replace(/\s*-?\s*C[áa]lculo\s+[\d.]+\s*$/i, '')
    .replace(/\s+/g, ' ')
    .replace(/^[\s.,;:_-]+|[\s,;:_-]+$/g, '')
    .trim();
}

/** Os preços no fim de uma linha: "R$ 3,46 R$ 51.900,00". */
const PRICE_PAIR = /R\$\s*([\d.,]+)\s+R\$\s*([\d.,]+)\s*$/;

/** Linhas que não fazem parte dos itens: o cabeçalho que se repete em cada página e o "continua". */
function isPageLine(line: string): boolean {
  return /^\.{0,3}\s*continua(?:[çc][ãa]o)?\.{0,3}$/i.test(line.trim()) || /Proposta\s*n[ºo°]/i.test(line);
}

/** Monta o item: o nome (até a primeira vírgula) e a especificação (o resto, ou o que vem depois do último traço). */
function itemFrom(quantityText: string, models: number, lines: string[], unitText: string, totalText: string, warnings: string[]): ProposalItemRead[] {
  const quantity = parseCount(quantityText);
  const unitPriceE4 = parseBrlUnitPrice(unitText);
  const totalCents = parseCents(totalText);
  const first = lines[0] ?? '';
  const comma = first.indexOf(',');
  const description = cleanName(comma >= 0 ? first.slice(0, comma) : first);
  const rest = [comma >= 0 ? first.slice(comma + 1) : '', ...lines.slice(1)].join('\n');
  // Depois de uma linha de traços vem a especificação; antes dela, as observações da gráfica.
  const blocks = rest.split(/\n?[._]*_{5,}[._,]*\n?/);
  const specification = cleanSpecification((blocks.at(-1) ?? '').replace(/\n/g, ' '));
  if (!quantity || !unitPriceE4) {
    warnings.push(`Não consegui ler a quantidade ou o preço de "${description}". Confira o item.`);
    return [];
  }
  const all = quantity * models;
  let unit = unitPriceE4;
  if (totalCents !== null && Math.abs(Math.round((all * unitPriceE4) / 100) - totalCents) > 1) {
    unit = Math.round((totalCents * 100) / all);
    warnings.push(`O total de "${description}" não confere com a quantidade vezes o preço: usei o preço que dá o total.`);
  }
  // "15.000 x 3 Livro ... - Básico /Mangá/Rosto": um item para cada modelo, com 15.000 cada.
  if (models > 1) {
    const dash = description.lastIndexOf(' - ');
    const names = dash >= 0 ? description.slice(dash + 3).split('/').map((n) => n.trim()).filter(Boolean) : [];
    if (names.length === models) {
      const base = description.slice(0, dash);
      return names.map((n) => ({ description: `${base} - ${n}`, specification, quantity, unitPriceE4: unit, totalCents: Math.round((quantity * unit) / 100) }));
    }
    warnings.push(`"${description}" vale para ${models} modelos, mas não deu para separar os nomes: ficou um item só, com ${all.toLocaleString('pt-BR')}.`);
  }
  return [{ description, specification, quantity: all, unitPriceE4: unit, totalCents }];
}

/** A Grafilar: a tabela "Quantidade Descrição Unitário Valor Total"; os preços vêm no fim de cada item. */
function readGrafilar(lines: string[], warnings: string[]): ProposalItemRead[] {
  const start = lines.findIndex((l) => /^Quantidade\s+Descri[çc][ãa]o\s+Unit[áa]rio\s+Valor\s+Total/i.test(l.trim()));
  const items: ProposalItemRead[] = [];
  let current: { quantity: string; models: number; lines: string[] } | null = null;
  for (const raw of lines.slice(start + 1)) {
    const line = raw.trim();
    if (!line || isPageLine(line)) continue;
    if (!current && /^(Cond\.?\s*Pagto|Condi[çc][ãa]o|Validade|Obs\.?:|Vendedor|Programa[çc][ãa]o)/i.test(line)) break;
    const price = PRICE_PAIR.exec(line);
    if (current) {
      const text = price ? line.slice(0, price.index).trim() : line;
      if (text) current.lines.push(text);
      if (price) {
        items.push(...itemFrom(current.quantity, current.models, current.lines, price[1]!, price[2]!, warnings));
        current = null;
      }
      continue;
    }
    const begin = /^(\d{1,3}(?:\.\d{3})*|\d+)(?:\s*x\s*(\d+))?\s+(\S.*)$/i.exec(line);
    if (!begin) continue;
    const text = price ? begin[3]!.slice(0, begin[3]!.length - price[0].length).trim() : begin[3]!;
    current = { quantity: begin[1]!, models: Number(begin[2] ?? 1), lines: [text] };
    if (price) {
      items.push(...itemFrom(current.quantity, current.models, current.lines, price[1]!, price[2]!, warnings));
      current = null;
    }
  }
  return items;
}

/** A Assahi: "103896.04 20.000 Livro ...", as linhas de capa e miolo com os kg e o "Total R$ : ... Unit: R$ ...". */
function readAssahi(lines: string[], warnings: string[], papers: ProposalPaperRead[]): { items: ProposalItemRead[]; number: string; ours: boolean } {
  const items: ProposalItemRead[] = [];
  let number = '';
  let ours = false;
  let current: { quantity: number; description: string; spec: string[] } | null = null;
  for (const raw of lines) {
    const line = raw.trim();
    const begin = /^(\d{4,}\.\d{2})\s+(\d{1,3}(?:\.\d{3})*|\d+)\s+(\S.*)$/.exec(line);
    if (begin) {
      number ||= begin[1]!;
      current = { quantity: parseCount(begin[2]!) ?? 0, description: cleanName(begin[3]!), spec: [] };
      continue;
    }
    if (!current) continue;
    const total = /Total\s*R\$\s*:?\s*([\d.,]+)/i.exec(line);
    if (total) {
      const totalCents = parseCents(total[1]!);
      const unitText = /Unit\.?\s*:?\s*R\$\s*([\d.,]+)/i.exec(line)?.[1];
      let unitPriceE4 = unitText ? parseBrlUnitPrice(unitText) : null;
      if (current.quantity > 0 && totalCents !== null && (unitPriceE4 === null || Math.abs(Math.round((current.quantity * unitPriceE4) / 100) - totalCents) > 1)) {
        if (unitPriceE4 !== null) warnings.push(`O total de "${current.description}" não confere com a quantidade vezes o preço: usei o preço que dá o total.`);
        unitPriceE4 = Math.round((totalCents * 100) / current.quantity);
      }
      if (current.quantity > 0 && unitPriceE4) {
        items.push({ description: current.description, specification: cleanSpecification(current.spec.join(' ')), quantity: current.quantity, unitPriceE4, totalCents });
      } else {
        warnings.push(`Não consegui ler a quantidade ou o preço de "${current.description}". Confira o item.`);
      }
      current = null;
      continue;
    }
    current.spec.push(line);
    // "CAPA* 707 KG: ... em Triplex LD 230g fornecido pelo cliente = 3534 fl ..." e "MIOLO * 2463 KG: ... = 2463,44 kg 96cm".
    const paper = /^([A-ZÀ-Ú]+)\s*\*\s*([\d.,]+)\s*KG\s*:(.*)$/i.exec(line);
    if (paper && /fornecid[oa]\s+pelo\s+cliente/i.test(paper[3]!)) {
      ours = true;
      const name = /\bem\s+(.+?)\s+fornecid[oa]\s+pelo\s+cliente/i.exec(paper[3]!)?.[1] ?? '';
      const precise = /=\s*([\d.,]+)\s*kg\b/i.exec(paper[3]!)?.[1];
      const grams = parseKgGrams(precise ?? paper[2]!);
      const part: PaperPart = /^capa$/i.test(paper[1]!) ? 'capa' : /^miolo$/i.test(paper[1]!) ? 'miolo' : 'outro';
      if (grams && name) papers.push({ part, paperName: name.trim(), grams, item: items.length });
      else warnings.push(`Não consegui ler o papel ou o peso da linha "${line.slice(0, 40)}…".`);
    }
  }
  return { items, number, ours };
}

/** O genérico: a quantidade, a descrição e os dois preços (unitário e total) na mesma linha. */
function readGeneric(lines: string[], warnings: string[]): ProposalItemRead[] {
  const items: ProposalItemRead[] = [];
  for (const raw of lines) {
    const m = /^(\d{1,3}(?:\.\d{3})*|\d+)\s+(\S.*?)\s+R\$\s*([\d.,]+)\s+R\$\s*([\d.,]+)\s*$/.exec(raw.trim());
    if (m) items.push(...itemFrom(m[1]!, 1, [m[2]!], m[3]!, m[4]!, warnings));
  }
  return items;
}

/** Lê o texto do PDF da proposta. Nunca falha: o que não deu para ler fica vazio, com o aviso. */
export function readProposal(text: string): ProposalRead {
  const lines = text.split('\n');
  const warnings: string[] = [];
  const papers: ProposalPaperRead[] = [];
  let layout: ProposalLayout = 'generico';
  let items: ProposalItemRead[];
  let number = /Proposta\s*n[ºo°.]*\s*:?\s*([\d][\d./-]*\d)/i.exec(text)?.[1] ?? /Or[çc]amento\s*n[ºo°.]*\s*:?\s*([\d][\d./-]*\d)/i.exec(text)?.[1] ?? '';
  let ours = false;
  if (lines.some((l) => /^Quantidade\s+Descri[çc][ãa]o\s+Unit[áa]rio\s+Valor\s+Total/i.test(l.trim()))) {
    layout = 'grafilar';
    items = readGrafilar(lines, warnings);
  } else if (lines.some((l) => /^\d{4,}\.\d{2}\s+(\d{1,3}(?:\.\d{3})*|\d+)\s+\S/.test(l.trim())) && /Total\s*R\$/i.test(text)) {
    layout = 'assahi';
    const read = readAssahi(lines, warnings, papers);
    items = read.items;
    number ||= read.number;
    ours = read.ours;
  } else {
    items = readGeneric(lines, warnings);
  }
  if (items.length === 0) warnings.push('Não consegui ler os itens da proposta: preencha os itens à mão.');
  const validity = /Validade(?:\s+(?:da\s+)?Proposta)?\s*:?\s*(\d{1,3})\s*dias/i.exec(text);
  const lead = /Prazo(?:\s+de)?(?:\s+(?:entrega|produ[çc][ãa]o))?\s*:?\s*(\d{1,3})\s*dias/i.exec(text);
  const payment = afterLabel(text, /(?:Cond\.?\s*(?:de\s*)?Pagto|Condi[çc][ãa]o\s+de\s+pagamento|Pgto|Pagamento)\s*:/i) ?? '';
  return {
    layout,
    printerName: guessPrinter(text),
    proposalNumber: number,
    proposalDate: readDate(text),
    validDays: validity ? Number(validity[1]) : null,
    paymentTerms: payment.slice(0, 100),
    leadDays: lead ? Number(lead[1]) : null,
    paperBy: ours ? 'editora' : 'grafica',
    items,
    papers,
    warnings,
  };
}

/** O nome do papel para a tabela: sem o "Forn" e com o espaço antes do "g" ("Offwhite Rot Forn 60g" → "Offwhite Rot 60 g"). */
export function paperDisplayName(name: string): string {
  return name
    .replace(/\bforn(?:ecido)?\.?(?=\s|$)/gi, '')
    .replace(/(\d)\s*g(?:\/m[2²])?\b/gi, '$1 g')
    .replace(/\s+/g, ' ')
    .trim();
}

/** As palavras e a gramatura de um nome de papel, para casar com a tabela. */
function paperKey(name: string): { grammage: string | null; words: string[] } {
  const key = searchKey(paperDisplayName(name));
  const grammage = /(\d+)\s*g\b/.exec(key)?.[1] ?? null;
  const words = key
    .replace(/\d+\s*g\b/g, ' ')
    .split(' ')
    .filter((w) => w.length >= 2 && !/^\d+$/.test(w));
  return { grammage, words };
}

/**
 * O papel da tabela com o mesmo nome: a mesma gramatura e o maior número de palavras iguais ("Offwhite Rot Forn 60g"
 * acha "Offwhite Rot 60 g"); null quando nenhum serve.
 */
export function matchPaper<T extends { id: string; name: string }>(name: string, papers: readonly T[]): T | null {
  const want = paperKey(name);
  let best: { paper: T; score: number } | null = null;
  for (const p of papers) {
    const have = paperKey(p.name);
    if (want.grammage !== have.grammage) continue;
    const score = want.words.filter((w) => have.words.includes(w)).length;
    if (score === 0 || (want.grammage === null && score < 2)) continue;
    if (!best || score > best.score) best = { paper: p, score };
  }
  return best?.paper ?? null;
}

/** Palavras que não ajudam a achar o produto pelo nome. */
const PRODUCT_STOPWORDS = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'em', 'para', 'com', 'livro', 'pur', 'fresado', 'hot', 'melt', 'kit', 'und', 'unds']);
function productWords(text: string): string[] {
  return [...new Set(searchKey(text.replace(/\([^)]*\)/g, ' ')).split(' '))].filter((w) => w.length >= 2 && !PRODUCT_STOPWORDS.has(w));
}
const segments = (text: string) => text.split(/\s+-\s+/).map((s) => searchKey(s.replace(/\([^)]*\)/g, ' ')));

/**
 * Para cada item lido, o produto do orçamento que ele cobra (o índice em products, ou -1). Pelo nome (as palavras
 * raras valem mais, e o modelo depois do traço, como "Mangá", vale muito), pela quantidade igual e pelo box (o item do
 * box vai para o produto do box, e o livro não). Primeiro um item para cada produto; os que sobram vão para o produto
 * que mais se parece.
 */
export function matchItemsToProducts(items: readonly Pick<ProposalItemRead, 'description' | 'quantity'>[], products: readonly { title: string; quantity: number }[]): number[] {
  if (products.length === 1) return items.map(() => 0);
  const words = products.map((p) => productWords(p.title));
  const df = new Map<string, number>();
  for (const ws of words) for (const w of ws) df.set(w, (df.get(w) ?? 0) + 1);
  const idf = (w: string) => Math.log(1 + products.length / (df.get(w) ?? products.length));
  const score = (item: Pick<ProposalItemRead, 'description' | 'quantity'>, n: number) => {
    const iw = productWords(item.description);
    let s = iw.filter((w) => words[n]!.includes(w)).reduce((t, w) => t + idf(w), 0);
    if (s === 0) return 0;
    const model = segments(item.description);
    if (model.length > 1 && segments(products[n]!.title).slice(1).includes(model.at(-1)!)) s += 5;
    if (item.quantity === products[n]!.quantity) s += 2;
    if (iw.includes('box') !== words[n]!.includes('box')) s -= 3;
    return s;
  };
  const pairs: { item: number; product: number; score: number }[] = [];
  items.forEach((item, i) => products.forEach((_, n) => pairs.push({ item: i, product: n, score: score(item, n) })));
  pairs.sort((a, b) => b.score - a.score);
  const result = items.map(() => -1);
  const used = new Set<number>();
  for (const p of pairs) {
    if (p.score <= 0 || result[p.item] !== -1 || used.has(p.product)) continue;
    result[p.item] = p.product;
    used.add(p.product);
  }
  for (const p of pairs) if (p.score > 0 && result[p.item] === -1) result[p.item] = p.product;
  return result;
}

/**
 * Os produtos de um orçamento novo a partir dos itens lidos: o nome e a quantidade de cada um. Com um item de box, os
 * outros itens com a mesma quantidade dele vão dentro do box; os demais (o avulso) ficam fora.
 */
export function productsFromItems(items: readonly Pick<ProposalItemRead, 'description' | 'quantity'>[]): { title: string; quantity: number; inBox: boolean }[] {
  const box = items.find((i) => productWords(i.description).includes('box'));
  return items.map((i) => ({
    title: i.description.replace(/^Livro\s+(?:PUR\s+|Fresado\s+Hot\s+melt\s+-\s+)?/i, '').trim() || i.description,
    quantity: i.quantity,
    inBox: !!box && i !== box && i.quantity === box.quantity,
  }));
}

/** Junta nomes do mesmo jeito ("Livro X - Básico", "Livro X - Mangá" → "Livro X - Básico e Mangá"); senão, com ";". */
function joinNames(names: readonly string[]): string {
  if (names.length === 1) return names[0]!;
  const dash = names.map((n) => n.lastIndexOf(' - '));
  const base = names[0]!.slice(0, Math.max(0, dash[0]!));
  if (dash.every((d) => d > 0) && names.every((n, k) => n.slice(0, dash[k]) === base)) {
    const models = names.map((n, k) => n.slice(dash[k]! + 3));
    return `${base} - ${models.slice(0, -1).join(', ')} e ${models.at(-1)}`;
  }
  return names.join('; ');
}

/**
 * A especificação do orçamento a partir dos itens lidos: um parágrafo por especificação diferente, com os itens que a
 * usam (os 3 livros iguais do kit viram um parágrafo só), até o limite, sem cortar um parágrafo no meio.
 */
export function specificationFromItems(items: readonly Pick<ProposalItemRead, 'description' | 'specification'>[], max = 2000): string {
  const bySpec = new Map<string, string[]>();
  for (const i of items) if (i.specification) bySpec.set(i.specification, [...(bySpec.get(i.specification) ?? []), i.description]);
  let out = '';
  for (const [spec, names] of bySpec) {
    const paragraph = `${joinNames(names)}: ${spec}`;
    const next = out ? `${out}\n\n${paragraph}` : paragraph;
    if (next.length > max) {
      if (!out) out = `${paragraph.slice(0, paragraph.lastIndexOf(' ', max - 1))}…`;
      break;
    }
    out = next;
  }
  return out;
}
