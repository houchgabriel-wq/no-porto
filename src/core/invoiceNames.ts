// Nomes novos no arquivo da invoice guardado (pedido do Gabriel em 27/11/2026): no Novo embarque, o arquivo da
// invoice fica guardado com os nomes que foram gravados (o da curva ABC ou o que a pessoa escreveu na prévia),
// no lugar dos que o fornecedor escreveu. Só as células dos nomes mudam. O .xlsx é um pacote de arquivos XML:
// na aba da invoice, cada célula trocada recebe o texto novo escrito nela mesma, com o mesmo estilo; o resto
// (formato, logotipo, fórmulas, as outras abas) fica como veio. Aqui ficam as regras sobre o texto e o XML;
// abrir e fechar o pacote fica em src/app/invoiceFile.ts.

/** A letra da coluna da planilha: 0 → A, 25 → Z, 26 → AA. */
export function columnName(index: number): string {
  let n = index + 1;
  let name = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    name = String.fromCharCode(65 + r) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
}

/** O ISBN escrito junto do nome, com o rótulo "ISBN" que vier antes dele ("ISBN: 978-65-5547-502-9"). */
const ISBN_WITH_LABEL = /(?:\bISBN\b\s*:?\s*)?97[89][\d\s-]{9,19}\d/i;

/**
 * O texto novo da célula do nome. Se a célula trazia o ISBN junto do nome, ele continua como estava, antes ou
 * depois do nome, na linha de baixo ou separado por espaço, como era.
 */
export function nameCellText(cell: string, newName: string): string {
  const m = ISBN_WITH_LABEL.exec(cell);
  if (!m) return newName;
  const isbn = m[0].trim();
  const isbnFirst = cell.slice(0, m.index).trim() === '' && cell.slice(m.index + m[0].length).trim() !== '';
  const sep = cell.includes('\n') ? '\n' : ' ';
  return isbnFirst ? `${isbn}${sep}${newName}` : `${newName}${sep}${isbn}`;
}

/** As células a trocar: a referência ("A9") e o texto novo de cada linha cujo nome mudou. */
export function invoiceNameChanges(
  lines: readonly { row: number; description: string; nameCell?: string }[],
  /** O nome gravado de cada linha, na ordem das linhas; null mantém o da invoice. */
  names: readonly (string | null | undefined)[],
  /** A coluna dos nomes (0 é a coluna A). */
  column: number,
): Map<string, string> {
  const texts = new Map<string, string>();
  lines.forEach((line, i) => {
    const name = names[i];
    if (!name || name === line.description) return;
    texts.set(`${columnName(column)}${line.row}`, line.nameCell ? nameCellText(line.nameCell, name) : name);
  });
  return texts;
}

function attribute(attrs: string, name: string): string | null {
  const m = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`).exec(attrs);
  return m ? (m[1] ?? m[2] ?? '') : null;
}

function unescapeXml(text: string): string {
  return text.replace(/&(#x[\da-f]+|#\d+|lt|gt|quot|apos|amp);/gi, (_, e: string) => {
    const k = e.toLowerCase();
    if (k.startsWith('#x')) return String.fromCodePoint(parseInt(k.slice(2), 16));
    if (k.startsWith('#')) return String.fromCodePoint(parseInt(k.slice(1), 10));
    return { lt: '<', gt: '>', quot: '"', apos: "'", amp: '&' }[k]!;
  });
}

/** Texto para dentro do XML: &, < e > escapados, sem os caracteres de controle que o XML não aceita. */
function xmlText(text: string): string {
  return text
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * O arquivo da aba dentro do pacote ("xl/worksheets/sheet1.xml"), pelo nome da aba: em xl/workbook.xml, a aba
 * aponta para uma ligação (r:id); em xl/_rels/workbook.xml.rels, a ligação aponta para o arquivo.
 */
export function sheetPartPath(workbookXml: string, relsXml: string, sheetName: string): string | null {
  for (const m of workbookXml.matchAll(/<(?:[\w.-]+:)?sheet(\s[^>]*?)\/?>/g)) {
    const attrs = m[1]!;
    const name = attribute(attrs, 'name');
    if (name === null || unescapeXml(name) !== sheetName) continue;
    const rid = /(?:^|\s)[\w.-]+:id\s*=\s*"([^"]*)"/.exec(attrs)?.[1];
    if (!rid) return null;
    for (const r of relsXml.matchAll(/<(?:[\w.-]+:)?Relationship(\s[^>]*?)\/?>/g)) {
      if (attribute(r[1]!, 'Id') !== rid) continue;
      const target = attribute(r[1]!, 'Target');
      if (!target) return null;
      const parts = (target.startsWith('/') ? target.slice(1) : `xl/${target}`).split('/');
      const path: string[] = [];
      for (const p of parts) {
        if (p === '..') path.pop();
        else if (p && p !== '.') path.push(p);
      }
      return path.join('/');
    }
    return null;
  }
  return null;
}

/**
 * Troca o texto das células pedidas ("A9" → texto) pelo texto escrito na própria célula (inlineStr), com o mesmo
 * estilo. As outras células, as fórmulas e o resto da aba ficam como estão. Devolve o XML novo e as células
 * trocadas (uma célula sem a referência escrita, o que o Excel não faz, fica como está).
 */
export function replaceCellTexts(sheetXml: string, texts: ReadonlyMap<string, string>): { xml: string; replaced: string[] } {
  const replaced: string[] = [];
  const xml = sheetXml.replace(/<((?:[\w.-]+:)?)c((?:\s[^>]*?)?)(\/>|>[\s\S]*?<\/\1c>)/g, (whole, prefix: string, attrs: string) => {
    const ref = attribute(attrs, 'r')?.toUpperCase();
    const text = ref ? texts.get(ref) : undefined;
    if (!ref || text === undefined) return whole;
    replaced.push(ref);
    const kept = attrs.replace(/\s+t\s*=\s*(?:"[^"]*"|'[^']*')/, '');
    return `<${prefix}c${kept} t="inlineStr"><${prefix}is><${prefix}t xml:space="preserve">${xmlText(text)}</${prefix}t></${prefix}is></${prefix}c>`;
  });
  return { xml, replaced };
}
