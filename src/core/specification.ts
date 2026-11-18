// Especificação do produto (SPEC.md, seção 3): o texto técnico da PO (formato, papel, acabamento).
// Cada item guarda a especificação daquela compra; a do produto é a última que descreve o produto de
// fato, porque as reimpressões só dizem "REPRINT — same specs as last order".

/** Tamanho máximo guardado. */
export const SPECIFICATION_MAX = 4000;

/** Texto limpo, mantendo as quebras de linha (cada linha da especificação é uma informação). */
export function cleanSpecification(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.replace(/[ \t ]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, SPECIFICATION_MAX);
}

/** A especificação só remete à compra anterior ("REPRINT — same specs as last order")? */
export function isReprintSpecification(text: string): boolean {
  return /^\s*re-?print\b/i.test(text) || /\bsame spec/i.test(text) || /^\s*reimpress/i.test(text);
}

export interface SpecificationSource {
  specification: string;
  createdAt: string;
  orderCode: string | null;
}

/** A última especificação de verdade do produto, com a PO de onde veio; null se não há. */
export function latestSpecification(items: readonly SpecificationSource[]): SpecificationSource | null {
  const real = items.filter((i) => i.specification.trim() !== '' && !isReprintSpecification(i.specification));
  if (real.length === 0) return null;
  return [...real].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]!;
}
