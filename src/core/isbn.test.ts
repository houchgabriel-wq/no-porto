import { describe, expect, it } from 'vitest';
import { isbnDigits, isbnProblem } from './isbn';

describe('ISBN', () => {
  it('aceita ISBN-13 com ou sem hífens, e vazio', () => {
    expect(isbnProblem('978-85-359-0277-8')).toBeNull();
    expect(isbnProblem('9788535902778')).toBeNull();
    expect(isbnProblem(' 978 85 359 0277 8 ')).toBeNull();
    expect(isbnProblem('')).toBeNull();
  });

  it('aceita ISBN-10, inclusive com X no fim', () => {
    expect(isbnProblem('85-359-0277-5')).toBeNull();
    expect(isbnProblem('0-8044-2957-X')).toBeNull();
    expect(isbnProblem('080442957x')).toBeNull();
  });

  it('recusa dígito verificador errado, tamanho errado e letras', () => {
    expect(isbnProblem('978-85-359-0277-9')).toMatch(/último dígito/);
    expect(isbnProblem('85-359-0277-4')).toMatch(/último dígito/);
    expect(isbnProblem('978853590277')).toMatch(/13 dígitos/);
    expect(isbnProblem('ISBN 978-85')).toMatch(/só números/);
    expect(isbnProblem('1234567890123')).toMatch(/último dígito/);
  });

  it('tira hífens e espaços para comparar', () => {
    expect(isbnDigits('978-85 359')).toBe('97885359');
  });
});
