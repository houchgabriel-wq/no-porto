// Regras de contas: senha, e-mail, senha temporária e a garantia de sempre haver um admin ativo
// (SPEC.md, seção 4).

import type { Role } from './roles';

export const PASSWORD_MIN_LENGTH = 10;
/** Teto só para não aceitar textos gigantes; não é regra de composição. */
export const PASSWORD_MAX_LENGTH = 200;

/** Devolve a mensagem de erro, ou null se a senha serve. */
export function passwordProblem(password: string): string | null {
  if ([...password].length < PASSWORD_MIN_LENGTH) {
    return `A senha precisa ter pelo menos ${PASSWORD_MIN_LENGTH} caracteres.`;
  }
  if ([...password].length > PASSWORD_MAX_LENGTH) {
    return `A senha pode ter no máximo ${PASSWORD_MAX_LENGTH} caracteres.`;
  }
  return null;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

// Sem letras e números que se confundem (0/O, 1/l/I), porque o admin repassa a senha à pessoa.
const TEMP_ALPHABET = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const TEMP_PASSWORD_LENGTH = 12;

/**
 * Monta a senha temporária a partir de bytes aleatórios (o chamador fornece, para a regra
 * continuar pura). Descarta bytes que causariam viés na escolha das letras.
 */
export function tempPasswordFromBytes(bytes: Uint8Array): string | null {
  const limit = 256 - (256 % TEMP_ALPHABET.length);
  let out = '';
  for (const b of bytes) {
    if (b >= limit) continue;
    out += TEMP_ALPHABET[b % TEMP_ALPHABET.length];
    if (out.length === TEMP_PASSWORD_LENGTH) return out;
  }
  return null;
}

export interface AccountState {
  id: string;
  role: Role;
  active: boolean;
}

/**
 * Confere se a mudança deixaria o sistema sem admin ativo. Devolve a mensagem de erro, ou null.
 */
export function lastAdminProblem(
  users: readonly AccountState[],
  targetId: string,
  change: { role?: Role; active?: boolean },
): string | null {
  const after = users.map((u) => (u.id === targetId ? { ...u, ...change } : u));
  const activeAdmins = after.filter((u) => u.role === 'admin' && u.active).length;
  if (activeAdmins > 0) return null;
  return change.active === false
    ? 'Não é possível desativar o último admin ativo.'
    : 'Não é possível tirar o perfil de admin do último admin ativo.';
}
