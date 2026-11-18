// Perfis e permissões (SPEC.md, seção 4). A interface usa estas regras para esconder controles;
// o servidor usa as mesmas para recusar o que o perfil não pode fazer.

export const ROLES = ['admin', 'editor', 'consulta', 'leitor', 'embarques'] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  admin: 'Administrador',
  editor: 'Editor',
  consulta: 'Consulta',
  leitor: 'Leitor',
  embarques: 'Embarques',
};

export type Action =
  | 'view' // entrar e acompanhar os embarques a caminho
  | 'view_all' // painel, produção, fornecedores e fichas de produto (o perfil Embarques não vê)
  | 'view_history' // a lista do histórico (o perfil Embarques vê, sem valores: pedido em 18/11/2026)
  | 'see_year_totals' // o recebido por ano, no topo do histórico (o perfil Embarques não vê)
  | 'see_values' // preços, totais, câmbio e pagamentos (leitor e Embarques não veem: decidido em 17/11/2026)
  | 'edit' // cadastrar e alterar POs, itens, invoices, BLs, pagamentos e fornecedores
  | 'import' // carga de planilha
  | 'delete' // exclusões
  | 'manage_users';

const PERMISSIONS: Record<Action, readonly Role[]> = {
  view: ROLES,
  view_all: ['admin', 'editor', 'consulta', 'leitor'],
  view_history: ROLES,
  see_year_totals: ['admin', 'editor', 'consulta', 'leitor'],
  see_values: ['admin', 'editor', 'consulta'],
  edit: ['admin', 'editor'],
  import: ['admin'],
  delete: ['admin'],
  manage_users: ['admin'],
};

export function can(role: Role, action: Action): boolean {
  return PERMISSIONS[action].includes(role);
}

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}
