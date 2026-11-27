// Nomes da curva ABC no embarque (pedido do Gabriel em 27/11/2026): o fornecedor escreve na invoice um nome
// que nem sempre é o do título como a editora cadastra. Ao importar um embarque, vale o título da curva ABC
// carregada (a do sistema de vendas), achado pelo ISBN. Sem ISBN, ou com um ISBN que não está na curva,
// fica o nome da invoice.

import { toIsbn13 } from './isbn';
import type { CurveRow } from './stockCurve';

/** O tamanho máximo do nome do produto no No Porto. */
const NAME_MAX = 300;

/** Os títulos da curva pelo código de barras (o ISBN-13), com os espaços acertados. */
export function curveTitles(rows: readonly Pick<CurveRow, 'isbn' | 'title'>[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const r of rows) {
    const title = r.title.replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);
    if (title && !map.has(r.isbn)) map.set(r.isbn, title);
  }
  return map;
}

/** O título da curva para o ISBN (o ISBN-10 vira ISBN-13); null sem ISBN ou fora da curva. */
export function curveTitleFor(isbn: string | null | undefined, titles: ReadonlyMap<string, string>): string | null {
  if (!isbn) return null;
  return titles.get(toIsbn13(isbn)) ?? null;
}
