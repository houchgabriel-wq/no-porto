// Perfis e permissões (SPEC.md, seção 4). A interface usa estas regras para esconder controles;
// o servidor usa as mesmas para recusar o que o perfil não pode fazer.

export const ROLES = ['admin', 'editor', 'consulta', 'leitor', 'embarques', 'vendas', 'agente'] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  admin: 'Administrador',
  editor: 'Editor',
  consulta: 'Consulta',
  leitor: 'Leitor',
  embarques: 'Embarques',
  vendas: 'Vendas',
  agente: 'Agente de cargas',
};

export type Action =
  | 'view' // entrar e ver os produtos a caminho, com a previsão de chegada (toda a equipe, inclusive Vendas; o Agente, que é de fora, não)
  | 'view_shipments' // a tela de embarques completa: fornecedor, invoice, BL e quantidades (Vendas não vê)
  | 'view_all' // painel, produção e fichas de produto (o perfil Embarques não vê)
  | 'view_suppliers' // a tela Fornecedores e a ficha de cada fornecedor (só admin e editor: decidido em 19/11/2026)
  | 'view_history' // a lista do histórico (o perfil Embarques vê, sem valores: pedido em 18/11/2026)
  | 'see_year_totals' // o recebido por ano, no topo do histórico (o perfil Embarques não vê)
  | 'see_values' // preços, totais, câmbio e pagamentos (leitor e Embarques não veem: decidido em 17/11/2026)
  | 'edit' // cadastrar e alterar POs, itens, invoices, BLs, pagamentos e fornecedores
  | 'import' // carga de planilha
  | 'delete' // exclusões
  | 'manage_users'
  | 'full_copy' // baixar a cópia completa (admin; Editor e Consulta pedidos pelo Gabriel em 19/11/2026)
  | 'view_bookings' // ver todas as solicitações de embarque, com os valores (só admin e editor: decidido em 19/11/2026)
  | 'request_bookings' // pedir containers e cancelar as próprias solicitações (só o Agente, que só vê as dele)
  | 'decide_bookings' // aprovar e recusar: além do perfil, só quem tem a marca de aprovador (o Gabriel)
  | 'view_stock' // a aba Previsão de estoque e o cartão dela no painel (decidido em 20/11/2026)
  | 'load_stock'; // carregar a curva ABC da semana (admin e editor: decidido em 20/11/2026)

const TEAM = ['admin', 'editor', 'consulta', 'leitor', 'embarques', 'vendas'] as const;

const PERMISSIONS: Record<Action, readonly Role[]> = {
  view: TEAM,
  view_shipments: ['admin', 'editor', 'consulta', 'leitor', 'embarques'],
  view_all: ['admin', 'editor', 'consulta', 'leitor'],
  view_suppliers: ['admin', 'editor'],
  view_history: ['admin', 'editor', 'consulta', 'leitor', 'embarques'],
  see_year_totals: ['admin', 'editor', 'consulta', 'leitor'],
  see_values: ['admin', 'editor', 'consulta'],
  edit: ['admin', 'editor'],
  import: ['admin'],
  delete: ['admin'],
  manage_users: ['admin'],
  full_copy: ['admin', 'editor', 'consulta'],
  view_bookings: ['admin', 'editor'],
  request_bookings: ['agente'],
  decide_bookings: ['admin'],
  view_stock: ['admin', 'editor', 'consulta', 'leitor'],
  load_stock: ['admin', 'editor'],
};

export function can(role: Role, action: Action): boolean {
  return PERMISSIONS[action].includes(role);
}

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}
