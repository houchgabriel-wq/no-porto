import { describe, expect, it } from 'vitest';
import { curveTitleFor, curveTitles } from './curveNames';

describe('nomes da curva ABC no embarque', () => {
  const titles = curveTitles([
    { isbn: '9786561266086', title: 'Patrulha Canina Meu Livro de Atividades e Diversão 01 - Vermelho' },
    { isbn: '9788573261233', title: '  Livro   antigo ' },
    // Código repetido: vale o primeiro.
    { isbn: '9786561266086', title: 'Outro nome' },
    { isbn: '7891234567895', title: 'Revista do mês' },
    { isbn: '9786561266093', title: ' ' },
  ]);

  it('o título da curva pelo ISBN, com os espaços acertados', () => {
    expect(curveTitleFor('9786561266086', titles)).toBe('Patrulha Canina Meu Livro de Atividades e Diversão 01 - Vermelho');
    // O ISBN-10 da invoice acha o ISBN-13 da curva.
    expect(curveTitleFor('8573261234', titles)).toBe('Livro antigo');
  });

  it('sem ISBN, fora da curva ou com o título vazio na curva, nada (fica o nome da invoice)', () => {
    expect(curveTitleFor(null, titles)).toBeNull();
    expect(curveTitleFor('', titles)).toBeNull();
    expect(curveTitleFor('9786583970527', titles)).toBeNull();
    expect(curveTitleFor('9786561266093', titles)).toBeNull();
    expect(titles.size).toBe(3);
  });
});
