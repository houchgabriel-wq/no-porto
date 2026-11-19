import { describe, expect, it } from 'vitest';
import { can, isRole, ROLES } from './roles';

const TEAM = ['admin', 'editor', 'consulta', 'leitor', 'embarques', 'vendas'] as const;

describe('can', () => {
  it('toda a equipe entra e acompanha os embarques; o Agente, que é de fora, não', () => {
    for (const role of TEAM) expect(can(role, 'view')).toBe(true);
    expect(can('agente', 'view')).toBe(false);
  });

  it('o perfil Embarques não vê painel, produção, fornecedores nem fichas de produto', () => {
    for (const role of ['admin', 'editor', 'consulta', 'leitor'] as const) expect(can(role, 'view_all')).toBe(true);
    expect(can('embarques', 'view_all')).toBe(false);
    expect(can('vendas', 'view_all')).toBe(false);
  });

  it('Vendas só vê a lista de produtos a caminho: sem a tela de embarques completa, histórico e valores', () => {
    for (const action of ['view_shipments', 'view_all', 'view_history', 'see_year_totals', 'see_values', 'edit', 'import', 'delete', 'manage_users', 'view_bookings', 'request_bookings', 'decide_bookings'] as const) {
      expect(can('vendas', action)).toBe(false);
    }
    for (const role of ['admin', 'editor', 'consulta', 'leitor', 'embarques'] as const) expect(can(role, 'view_shipments')).toBe(true);
  });

  it('o perfil Embarques vê o histórico, sem o recebido por ano', () => {
    for (const role of ['admin', 'editor', 'consulta', 'leitor', 'embarques'] as const) expect(can(role, 'view_history')).toBe(true);
    for (const role of ['admin', 'editor', 'consulta', 'leitor'] as const) expect(can(role, 'see_year_totals')).toBe(true);
    expect(can('embarques', 'see_year_totals')).toBe(false);
  });

  it('leitor e Embarques não veem valores; Consulta vê', () => {
    for (const role of ['admin', 'editor', 'consulta'] as const) expect(can(role, 'see_values')).toBe(true);
    for (const role of ['leitor', 'embarques', 'vendas', 'agente'] as const) expect(can(role, 'see_values')).toBe(false);
  });

  it('só admin e editor alteram', () => {
    for (const role of ['admin', 'editor'] as const) expect(can(role, 'edit')).toBe(true);
    for (const role of ['consulta', 'leitor', 'embarques', 'vendas', 'agente'] as const) expect(can(role, 'edit')).toBe(false);
  });

  it('só o admin faz a carga, exclui e cuida dos usuários', () => {
    for (const action of ['import', 'delete', 'manage_users'] as const) {
      expect(can('admin', action)).toBe(true);
      for (const role of ['editor', 'consulta', 'leitor', 'embarques', 'vendas', 'agente'] as const) expect(can(role, action)).toBe(false);
    }
  });
});

describe('cópia completa', () => {
  it('admin, Editor e Consulta baixam; os outros perfis não', () => {
    for (const role of ['admin', 'editor', 'consulta'] as const) expect(can(role, 'full_copy')).toBe(true);
    for (const role of ['leitor', 'embarques', 'vendas', 'agente'] as const) expect(can(role, 'full_copy'), role).toBe(false);
  });
});

describe('solicitações de embarque', () => {
  it('o Agente pede containers e não vê mais nada do app', () => {
    expect(can('agente', 'request_bookings')).toBe(true);
    for (const action of ['view', 'view_shipments', 'view_all', 'view_history', 'see_year_totals', 'see_values', 'edit', 'import', 'delete', 'manage_users', 'view_bookings', 'decide_bookings'] as const) {
      expect(can('agente', action), action).toBe(false);
    }
  });

  it('admin, editor e Consulta veem todas as solicitações; ninguém da equipe pede', () => {
    for (const role of ['admin', 'editor', 'consulta'] as const) expect(can(role, 'view_bookings')).toBe(true);
    for (const role of ['leitor', 'embarques', 'vendas', 'agente'] as const) expect(can(role, 'view_bookings')).toBe(false);
    for (const role of TEAM) expect(can(role, 'request_bookings')).toBe(false);
  });

  it('decidir é coisa de admin (e, além do perfil, da marca de aprovador)', () => {
    expect(can('admin', 'decide_bookings')).toBe(true);
    for (const role of ['editor', 'consulta', 'leitor', 'embarques', 'vendas', 'agente'] as const) expect(can(role, 'decide_bookings')).toBe(false);
  });
});

describe('perfis', () => {
  it('aceita só os sete perfis', () => {
    expect(ROLES).toEqual(['admin', 'editor', 'consulta', 'leitor', 'embarques', 'vendas', 'agente']);
    for (const role of ROLES) expect(isRole(role)).toBe(true);
    expect(isRole('gerente_redacao')).toBe(false);
    expect(isRole(undefined)).toBe(false);
  });
});
