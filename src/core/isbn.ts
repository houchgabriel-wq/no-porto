// ISBN do produto, com as mesmas regras do No Prelo: ISBN-13, ou ISBN-10 para livros antigos, sempre
// com o dígito verificador conferido.

export const ISBN_MAX = 20;

/** Só os dígitos (e o X final do ISBN-10), sem hífens nem espaços. */
export function isbnDigits(value: string): string {
  return value.replace(/[\s-]/g, '').toUpperCase();
}

function valid13(d: string): boolean {
  if (!/^97[89]\d{10}$/.test(d)) return false;
  const sum = [...d.slice(0, 12)].reduce((acc, c, i) => acc + Number(c) * (i % 2 === 0 ? 1 : 3), 0);
  return (10 - (sum % 10)) % 10 === Number(d[12]);
}

function valid10(d: string): boolean {
  if (!/^\d{9}[\dX]$/.test(d)) return false;
  const sum = [...d].reduce((acc, c, i) => acc + (c === 'X' ? 10 : Number(c)) * (10 - i), 0);
  return sum % 11 === 0;
}

/**
 * O mesmo livro em ISBN-13: o ISBN-10 válido vira 978 + os nove primeiros dígitos + o novo dígito
 * verificador; qualquer outro texto volta só com os dígitos. Serve para casar o ISBN antigo de um
 * produto com o código de barras da curva ABC, que tem 13 dígitos.
 */
export function toIsbn13(value: string): string {
  const d = isbnDigits(value);
  if (d.length !== 10 || !valid10(d)) return d;
  const core = `978${d.slice(0, 9)}`;
  const sum = [...core].reduce((acc, c, i) => acc + Number(c) * (i % 2 === 0 ? 1 : 3), 0);
  return core + String((10 - (sum % 10)) % 10);
}

/** Devolve a mensagem de erro, ou null se o ISBN serve (vazio também serve: o campo é opcional). */
export function isbnProblem(value: string): string | null {
  const text = value.trim();
  if (!text) return null;
  if (text.length > ISBN_MAX || !/^[\d\s-]+[\dXx]?$/.test(text)) return 'O ISBN deve ter só números e hífens.';
  const d = isbnDigits(text);
  if (d.length === 13) return valid13(d) ? null : 'ISBN inválido: confira os números (o último dígito não confere).';
  if (d.length === 10) return valid10(d) ? null : 'ISBN inválido: confira os números (o último dígito não confere).';
  return 'O ISBN tem 13 dígitos (ou 10, nos livros antigos).';
}
