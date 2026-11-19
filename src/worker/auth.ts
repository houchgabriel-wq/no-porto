// Sessão por cookie. O banco guarda só o hash do token (SPEC.md, seção 4).

import type { Role } from '../core/roles';
import { isExpired, sessionExpiry, shouldRenew } from '../core/sessions';
import { newSessionToken, sha256 } from './crypto';
import type { Env } from './env';

const COOKIE = 'nporto_sessao';

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  mustChangePassword: boolean;
  /** Aprova as solicitações de embarque (o Gabriel; decidido em 19/11/2026). */
  approvesBookings: boolean;
}

export interface Session {
  user: SessionUser;
  tokenHash: string;
  /** Cookie renovado, quando a validade foi estendida neste pedido. */
  setCookie?: string;
}

function cookieFor(token: string, expires: Date): string {
  return `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Expires=${expires.toUTCString()}`;
}

export function clearedCookie(): string {
  return `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

function readToken(request: Request): string | null {
  const header = request.headers.get('cookie') ?? '';
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === COOKIE) return rest.join('=') || null;
  }
  return null;
}

/** Cria a sessão e devolve o cabeçalho Set-Cookie. */
export async function createSession(env: Env, userId: string, now: Date): Promise<string> {
  const token = newSessionToken();
  const expires = sessionExpiry(now);
  await env.DB.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
    .bind(await sha256(token), userId, now.toISOString(), expires.toISOString())
    .run();
  return cookieFor(token, expires);
}

interface SessionRow {
  token_hash: string;
  expires_at: string;
  id: string;
  name: string;
  email: string;
  role: Role;
  must_change_password: number;
  approves_bookings: number;
}

export async function loadSession(env: Env, request: Request, now: Date): Promise<Session | null> {
  const token = readToken(request);
  if (!token) return null;
  const tokenHash = await sha256(token);
  const row = await env.DB.prepare(
    `SELECT s.token_hash, s.expires_at, u.id, u.name, u.email, u.role, u.must_change_password, u.approves_bookings
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ? AND u.active = 1`,
  )
    .bind(tokenHash)
    .first<SessionRow>();
  if (!row) return null;
  if (isExpired(row.expires_at, now)) {
    await endSession(env, tokenHash);
    return null;
  }

  const session: Session = {
    tokenHash,
    user: {
      id: row.id,
      name: row.name,
      email: row.email,
      role: row.role,
      mustChangePassword: row.must_change_password === 1,
      approvesBookings: row.approves_bookings === 1,
    },
  };
  if (shouldRenew(row.expires_at, now)) {
    const expires = sessionExpiry(now);
    await env.DB.prepare('UPDATE sessions SET expires_at = ? WHERE token_hash = ?')
      .bind(expires.toISOString(), tokenHash)
      .run();
    session.setCookie = cookieFor(token, expires);
  }
  return session;
}

export async function endSession(env: Env, tokenHash: string): Promise<void> {
  await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(tokenHash).run();
}

/** Encerra as sessões do usuário, menos a indicada (a de quem está trocando a própria senha). */
export async function endUserSessions(env: Env, userId: string, keepTokenHash: string | null = null): Promise<void> {
  await env.DB.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash IS NOT ?')
    .bind(userId, keepTokenHash)
    .run();
}
