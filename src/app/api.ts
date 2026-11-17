// Chamadas à API. Erros viram ApiError com a mensagem em português vinda do servidor.

import type { Role } from '../core/roles';

export interface Me {
  id: string;
  name: string;
  email: string;
  role: Role;
  mustChangePassword: boolean;
}

export interface UserSummary {
  id: string;
  name: string;
  email: string;
  role: Role;
  mustChangePassword: boolean;
  active: boolean;
  createdAt: string;
  lastLoginAt: string | null;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Avisado quando a sessão cai no meio do uso, para voltar à tela de entrada. */
let onUnauthorized: () => void = () => {};
export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: method === 'GET' ? {} : { 'content-type': 'application/json' },
      body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
    });
  } catch {
    throw new ApiError(0, 'Sem conexão com o servidor. Confira a internet e tente de novo.');
  }
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) {
    if (res.status === 401 && path !== '/api/login') onUnauthorized();
    throw new ApiError(res.status, data.error ?? 'Erro inesperado. Tente de novo.');
  }
  return data as T;
}

export const api = {
  setupStatus: () => request<{ available: boolean; configured: boolean }>('GET', '/api/setup'),
  setup: (body: { token: string; name: string; email: string; password: string }) =>
    request<{ user: Me }>('POST', '/api/setup', body),
  login: (email: string, password: string) => request<{ user: Me }>('POST', '/api/login', { email, password }),
  logout: () => request<{ ok: true }>('POST', '/api/logout'),
  me: () => request<{ user: Me }>('GET', '/api/me'),
  changePassword: (password: string, current?: string) =>
    request<{ user: Me }>('POST', '/api/password', { password, current }),
  users: () => request<{ users: UserSummary[] }>('GET', '/api/users'),
  createUser: (body: { name: string; email: string; role: Role }) =>
    request<{ user: UserSummary; tempPassword: string }>('POST', '/api/users', body),
  updateUser: (id: string, body: Partial<{ name: string; email: string; role: Role; active: boolean }>) =>
    request<{ user: UserSummary }>('PATCH', `/api/users/${encodeURIComponent(id)}`, body),
  resetPassword: (id: string) =>
    request<{ tempPassword: string }>('POST', `/api/users/${encodeURIComponent(id)}/reset-password`),
};
