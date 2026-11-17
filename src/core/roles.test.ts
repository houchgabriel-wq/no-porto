import { describe, expect, it } from 'vitest';
import { can, isRole } from './roles';

describe('can', () => {
  it('todos os perfis veem', () => {
    for (const role of ['admin', 'editor', 'leitor'] as const) expect(can(role, 'view')).toBe(true);
  });

  it('o leitor não vê valores', () => {
    expect(can('admin', 'see_values')).toBe(true);
    expect(can('editor', 'see_values')).toBe(true);
    expect(can('leitor', 'see_values')).toBe(false);
  });

  it('admin e editor alteram; o leitor só acompanha', () => {
    expect(can('admin', 'edit')).toBe(true);
    expect(can('editor', 'edit')).toBe(true);
    expect(can('leitor', 'edit')).toBe(false);
  });

  it('só o admin faz a carga, exclui e cuida dos usuários', () => {
    for (const action of ['import', 'delete', 'manage_users'] as const) {
      expect(can('admin', action)).toBe(true);
      expect(can('editor', action)).toBe(false);
      expect(can('leitor', action)).toBe(false);
    }
  });
});

describe('perfis', () => {
  it('aceita só os três perfis', () => {
    expect(isRole('admin')).toBe(true);
    expect(isRole('editor')).toBe(true);
    expect(isRole('leitor')).toBe(true);
    expect(isRole('gerente_redacao')).toBe(false);
    expect(isRole(undefined)).toBe(false);
  });
});
