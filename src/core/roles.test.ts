import { describe, expect, it } from 'vitest';
import { can, isRole, ROLES } from './roles';

describe('can', () => {
  it('todos os perfis entram e acompanham os embarques', () => {
    for (const role of ROLES) expect(can(role, 'view')).toBe(true);
  });

  it('o perfil Embarques não vê painel, produção, fornecedores nem fichas de produto', () => {
    for (const role of ['admin', 'editor', 'consulta', 'leitor'] as const) expect(can(role, 'view_all')).toBe(true);
    expect(can('embarques', 'view_all')).toBe(false);
  });

  it('o perfil Embarques vê o histórico, sem o recebido por ano', () => {
    for (const role of ROLES) expect(can(role, 'view_history')).toBe(true);
    for (const role of ['admin', 'editor', 'consulta', 'leitor'] as const) expect(can(role, 'see_year_totals')).toBe(true);
    expect(can('embarques', 'see_year_totals')).toBe(false);
  });

  it('leitor e Embarques não veem valores; Consulta vê', () => {
    for (const role of ['admin', 'editor', 'consulta'] as const) expect(can(role, 'see_values')).toBe(true);
    for (const role of ['leitor', 'embarques'] as const) expect(can(role, 'see_values')).toBe(false);
  });

  it('só admin e editor alteram', () => {
    for (const role of ['admin', 'editor'] as const) expect(can(role, 'edit')).toBe(true);
    for (const role of ['consulta', 'leitor', 'embarques'] as const) expect(can(role, 'edit')).toBe(false);
  });

  it('só o admin faz a carga, exclui e cuida dos usuários', () => {
    for (const action of ['import', 'delete', 'manage_users'] as const) {
      expect(can('admin', action)).toBe(true);
      for (const role of ['editor', 'consulta', 'leitor', 'embarques'] as const) expect(can(role, action)).toBe(false);
    }
  });
});

describe('perfis', () => {
  it('aceita só os cinco perfis', () => {
    for (const role of ['admin', 'editor', 'consulta', 'leitor', 'embarques']) expect(isRole(role)).toBe(true);
    expect(isRole('gerente_redacao')).toBe(false);
    expect(isRole(undefined)).toBe(false);
  });
});
