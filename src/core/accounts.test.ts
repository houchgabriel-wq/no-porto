import { describe, expect, it } from 'vitest';
import {
  lastAdminProblem,
  normalizeEmail,
  passwordProblem,
  TEMP_PASSWORD_LENGTH,
  tempPasswordFromBytes,
} from './accounts';

describe('passwordProblem', () => {
  it('exige 10 caracteres, sem regra de composição', () => {
    expect(passwordProblem('curta')).toMatch(/10 caracteres/);
    expect(passwordProblem('123456789')).not.toBeNull();
    expect(passwordProblem('aaaaaaaaaa')).toBeNull();
    expect(passwordProblem('frase longa com espaços')).toBeNull();
  });

  it('conta caracteres, não bytes', () => {
    expect(passwordProblem('ççççççççç')).not.toBeNull();
    expect(passwordProblem('çççççççççç')).toBeNull();
  });

  it('recusa senha gigante', () => {
    expect(passwordProblem('a'.repeat(201))).toMatch(/no máximo/);
  });
});

describe('normalizeEmail', () => {
  it('tira espaços e passa para minúsculas', () => {
    expect(normalizeEmail('  Gabriel@IBC.com.br ')).toBe('gabriel@ibc.com.br');
  });
});

describe('tempPasswordFromBytes', () => {
  it('gera 12 caracteres sem letras ambíguas', () => {
    const bytes = new Uint8Array(64).map((_, i) => i * 7);
    const pw = tempPasswordFromBytes(bytes)!;
    expect(pw).toHaveLength(TEMP_PASSWORD_LENGTH);
    expect(pw).not.toMatch(/[0O1lI]/);
  });

  it('descarta bytes que causariam viés', () => {
    // 55 letras: o limite é 220; bytes de 220 para cima são descartados.
    const bytes = new Uint8Array([255, 220, ...new Array(12).fill(0)]);
    expect(tempPasswordFromBytes(bytes)).toBe('a'.repeat(12));
  });

  it('devolve null se faltarem bytes', () => {
    expect(tempPasswordFromBytes(new Uint8Array(5))).toBeNull();
  });
});

describe('lastAdminProblem', () => {
  const users = [
    { id: 'a', role: 'admin' as const, active: true },
    { id: 'e', role: 'editor' as const, active: true },
    { id: 'x', role: 'admin' as const, active: false },
  ];

  it('recusa desativar o último admin ativo', () => {
    expect(lastAdminProblem(users, 'a', { active: false })).toMatch(/desativar/);
  });

  it('recusa rebaixar o último admin ativo', () => {
    expect(lastAdminProblem(users, 'a', { role: 'editor' })).toMatch(/perfil/);
  });

  it('admin desativado não conta', () => {
    expect(lastAdminProblem(users, 'a', { role: 'leitor' })).not.toBeNull();
  });

  it('com outro admin ativo, pode', () => {
    const two = [...users, { id: 'b', role: 'admin' as const, active: true }];
    expect(lastAdminProblem(two, 'a', { active: false })).toBeNull();
  });

  it('mudar outra pessoa não esbarra na regra', () => {
    expect(lastAdminProblem(users, 'e', { active: false })).toBeNull();
    expect(lastAdminProblem(users, 'e', { role: 'admin' })).toBeNull();
  });
});
