// Rotas da API (SPEC.md, seção 8). Toda rota confere sessão e perfil antes de ler ou gravar.

import { z } from 'zod';
import { lastAdminProblem, normalizeEmail, passwordProblem } from '../core/accounts';
import { can, ROLES, type Role } from '../core/roles';
import { loginBlocked, loginWindowStart } from '../core/sessions';
import { clearedCookie, createSession, endSession, endUserSessions, loadSession, type Session } from './auth';
import { hashPassword, newTempPassword, timingSafeEqual, verifyPassword, type PasswordHash } from './crypto';
import type { Env } from './env';
import { checkMutation, error, HttpError, json, readBody } from './http';
import { routeOrders } from './orders';
import { routeShipments } from './shipments';

// ---------- Esquemas de entrada ----------

const name = z
  .string({ error: 'Informe o nome.' })
  .trim()
  .min(1, 'Informe o nome.')
  .max(100, 'O nome pode ter no máximo 100 caracteres.');
const email = z
  .string({ error: 'Informe o e-mail.' })
  .trim()
  .max(200, 'E-mail longo demais.')
  .pipe(z.email('E-mail inválido.'))
  .transform(normalizeEmail);
// Teto folgado só para não processar textos gigantes; a regra de tamanho da senha nova fica em accounts.ts.
const password = z.string({ error: 'Informe a senha.' }).max(1000, 'Senha longa demais.');
const role = z.enum(ROLES, { error: 'Perfil inválido.' });

const setupBody = z.object({ token: z.string({ error: 'Informe o código de instalação.' }).max(1000, 'Código longo demais.'), name, email, password });
const loginBody = z.object({ email: z.string({ error: 'Informe o e-mail.' }).max(200, 'E-mail longo demais.'), password });
const passwordBody = z.object({ current: password.optional(), password });
const createUserBody = z.object({ name, email, role });
const updateUserBody = z
  .object({ name, email, role, active: z.boolean({ error: 'Valor inválido.' }) })
  .partial()
  .refine((b) => Object.keys(b).length > 0, 'Nada para alterar.');

// ---------- Banco ----------

interface UserRow {
  id: string;
  name: string;
  email: string;
  role: Role;
  password_hash: string;
  password_salt: string;
  password_iterations: number;
  must_change_password: number;
  active: number;
  created_at: string;
  last_login_at: string | null;
}

const PUBLIC_USER_COLUMNS = 'id, name, email, role, must_change_password, active, created_at, last_login_at';

/** O que a tela de usuários vê. Nunca inclui hash nem sal. */
function publicUser(row: Pick<UserRow, 'id' | 'name' | 'email' | 'role' | 'must_change_password' | 'active' | 'created_at' | 'last_login_at'>) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    mustChangePassword: row.must_change_password === 1,
    active: row.active === 1,
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at,
  };
}

function storedHash(row: UserRow): PasswordHash {
  return { hash: row.password_hash, salt: row.password_salt, iterations: row.password_iterations };
}

async function countUsers(env: Env): Promise<number> {
  const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM users').first<{ n: number }>();
  return row?.n ?? 0;
}

async function findUserByEmail(env: Env, address: string): Promise<UserRow | null> {
  return env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(address).first<UserRow>();
}

async function findUser(env: Env, id: string): Promise<UserRow | null> {
  return env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(id).first<UserRow>();
}

async function emailTaken(env: Env, address: string, exceptId = ''): Promise<boolean> {
  const row = await env.DB.prepare('SELECT id FROM users WHERE email = ? AND id <> ?').bind(address, exceptId).first();
  return row !== null;
}

// Usado quando o e-mail não existe, para o login levar o mesmo tempo nos dois casos.
let dummyHash: Promise<PasswordHash> | null = null;

// ---------- Limite de tentativas ----------

/** As tentativas do primeiro acesso entram na mesma tabela, com este marcador no lugar do e-mail. */
const SETUP_ATTEMPT = '#setup';

async function failureCounts(env: Env, address: string, ip: string, now: Date) {
  const since = loginWindowStart(now).toISOString();
  const byEmail = await env.DB.prepare('SELECT COUNT(*) AS n FROM login_attempts WHERE email = ? AND attempted_at > ?')
    .bind(address, since)
    .first<{ n: number }>();
  const byIp = await env.DB.prepare('SELECT COUNT(*) AS n FROM login_attempts WHERE ip = ? AND attempted_at > ?')
    .bind(ip, since)
    .first<{ n: number }>();
  return { email: byEmail?.n ?? 0, ip: byIp?.n ?? 0 };
}

async function recordFailure(env: Env, address: string, ip: string, now: Date): Promise<void> {
  await env.DB.prepare('INSERT INTO login_attempts (email, ip, attempted_at) VALUES (?, ?, ?)')
    .bind(address, ip, now.toISOString())
    .run();
  // Limpeza: o que saiu da janela não serve mais.
  await env.DB.prepare('DELETE FROM login_attempts WHERE attempted_at <= ?')
    .bind(loginWindowStart(now).toISOString())
    .run();
}

const TOO_MANY = 'Muitas tentativas seguidas. Espere 15 minutos e tente de novo.';

function clientIp(request: Request): string {
  return request.headers.get('cf-connecting-ip') ?? 'desconhecido';
}

// ---------- Rotas públicas ----------

async function getSetup(env: Env): Promise<Response> {
  return json({ available: (await countUsers(env)) === 0, configured: Boolean(env.SETUP_TOKEN) });
}

async function postSetup(request: Request, env: Env, now: Date): Promise<Response> {
  checkMutation(request);
  const body = await readBody(request, setupBody);
  if (!env.SETUP_TOKEN) {
    return error(503, 'O código de instalação ainda não foi cadastrado no Cloudflare.');
  }
  if ((await countUsers(env)) > 0) return error(409, 'O primeiro acesso já foi feito. Entre com seu e-mail e senha.');

  const ip = clientIp(request);
  if (loginBlocked(await failureCounts(env, SETUP_ATTEMPT, ip, now))) return error(429, TOO_MANY);
  if (!timingSafeEqual(body.token.trim(), env.SETUP_TOKEN)) {
    await recordFailure(env, SETUP_ATTEMPT, ip, now);
    return error(403, 'Código de instalação incorreto.');
  }
  const problem = passwordProblem(body.password);
  if (problem) return error(400, problem);

  const hash = await hashPassword(body.password);
  const id = crypto.randomUUID();
  // Só grava se a tabela ainda estiver vazia, para dois pedidos simultâneos não criarem dois admins.
  const result = await env.DB.prepare(
    `INSERT INTO users (id, name, email, role, password_hash, password_salt, password_iterations,
                        must_change_password, active, created_at, last_login_at)
     SELECT ?, ?, ?, 'admin', ?, ?, ?, 0, 1, ?, ?
      WHERE NOT EXISTS (SELECT 1 FROM users)`,
  )
    .bind(id, body.name, body.email, hash.hash, hash.salt, hash.iterations, now.toISOString(), now.toISOString())
    .run();
  if (!result.meta.changes) return error(409, 'O primeiro acesso já foi feito. Entre com seu e-mail e senha.');

  const cookie = await createSession(env, id, now);
  const user = { id, name: body.name, email: body.email, role: 'admin' as const, mustChangePassword: false };
  return json({ user }, 201, { 'set-cookie': cookie });
}

async function postLogin(request: Request, env: Env, now: Date): Promise<Response> {
  checkMutation(request);
  const body = await readBody(request, loginBody);
  const address = normalizeEmail(body.email);
  const ip = clientIp(request);

  if (loginBlocked(await failureCounts(env, address, ip, now))) return error(429, TOO_MANY);

  const row = await findUserByEmail(env, address);
  dummyHash ??= hashPassword('senha-que-ninguem-usa');
  const ok = await verifyPassword(body.password, row ? storedHash(row) : await dummyHash);
  if (!row || !ok || row.active !== 1) {
    await recordFailure(env, address, ip, now);
    return error(401, 'E-mail ou senha incorretos.');
  }

  await env.DB.prepare('DELETE FROM login_attempts WHERE email = ?').bind(address).run();
  await env.DB.prepare('DELETE FROM sessions WHERE expires_at <= ?').bind(now.toISOString()).run();
  await env.DB.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').bind(now.toISOString(), row.id).run();
  const cookie = await createSession(env, row.id, now);
  const user = {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    mustChangePassword: row.must_change_password === 1,
  };
  return json({ user }, 200, { 'set-cookie': cookie });
}

// ---------- Rotas de quem está logado ----------

async function postLogout(request: Request, env: Env, session: Session): Promise<Response> {
  checkMutation(request);
  await endSession(env, session.tokenHash);
  return json({ ok: true }, 200, { 'set-cookie': clearedCookie() });
}

async function postPassword(request: Request, env: Env, session: Session): Promise<Response> {
  checkMutation(request);
  const body = await readBody(request, passwordBody);
  const row = await findUser(env, session.user.id);
  if (!row) return error(401, 'Sessão encerrada. Entre de novo.');

  // Quem entrou com senha temporária acabou de digitá-la; nos outros casos, a atual é obrigatória.
  if (!session.user.mustChangePassword) {
    if (!body.current || !(await verifyPassword(body.current, storedHash(row)))) {
      return error(400, 'Senha atual incorreta.');
    }
  }
  const problem = passwordProblem(body.password);
  if (problem) return error(400, problem);
  if (await verifyPassword(body.password, storedHash(row))) {
    return error(400, 'A nova senha precisa ser diferente da atual.');
  }

  const hash = await hashPassword(body.password);
  await env.DB.prepare(
    `UPDATE users SET password_hash = ?, password_salt = ?, password_iterations = ?, must_change_password = 0
      WHERE id = ?`,
  )
    .bind(hash.hash, hash.salt, hash.iterations, row.id)
    .run();
  await endUserSessions(env, row.id, session.tokenHash);
  return json({ user: { ...session.user, mustChangePassword: false } });
}

// ---------- Usuários (admin) ----------

async function listUsers(env: Env): Promise<Response> {
  const { results } = await env.DB.prepare(`SELECT ${PUBLIC_USER_COLUMNS} FROM users ORDER BY name COLLATE NOCASE`).all<UserRow>();
  return json({ users: results.map(publicUser) });
}

async function createUser(request: Request, env: Env, now: Date): Promise<Response> {
  checkMutation(request);
  const body = await readBody(request, createUserBody);
  if (await emailTaken(env, body.email)) return error(409, 'Já existe um usuário com este e-mail.');

  const tempPassword = newTempPassword();
  const hash = await hashPassword(tempPassword);
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO users (id, name, email, role, password_hash, password_salt, password_iterations,
                        must_change_password, active, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1, ?)`,
  )
    .bind(id, body.name, body.email, body.role, hash.hash, hash.salt, hash.iterations, now.toISOString())
    .run();
  const row = (await findUser(env, id))!;
  return json({ user: publicUser(row), tempPassword }, 201);
}

async function updateUser(request: Request, env: Env, session: Session, id: string): Promise<Response> {
  checkMutation(request);
  const body = await readBody(request, updateUserBody);
  const row = await findUser(env, id);
  if (!row) return error(404, 'Usuário não encontrado.');

  // Evita que o admin se tranque para fora no meio da sessão.
  if (id === session.user.id) {
    if (body.active === false) return error(400, 'Você não pode desativar a própria conta.');
    if (body.role && body.role !== row.role) return error(400, 'Você não pode mudar o próprio perfil.');
  }
  if (body.email && (await emailTaken(env, body.email, id))) {
    return error(409, 'Já existe um usuário com este e-mail.');
  }
  if (body.role !== undefined || body.active !== undefined) {
    const { results } = await env.DB.prepare('SELECT id, role, active FROM users').all<Pick<UserRow, 'id' | 'role' | 'active'>>();
    const accounts = results.map((u) => ({ id: u.id, role: u.role, active: u.active === 1 }));
    const problem = lastAdminProblem(accounts, id, { role: body.role, active: body.active });
    if (problem) return error(400, problem);
  }

  const next = {
    name: body.name ?? row.name,
    email: body.email ?? row.email,
    role: body.role ?? row.role,
    active: body.active === undefined ? row.active : body.active ? 1 : 0,
  };
  await env.DB.prepare('UPDATE users SET name = ?, email = ?, role = ?, active = ? WHERE id = ?')
    .bind(next.name, next.email, next.role, next.active, id)
    .run();
  if (next.active === 0) await endUserSessions(env, id);
  return json({ user: publicUser((await findUser(env, id))!) });
}

async function resetPassword(request: Request, env: Env, session: Session, id: string): Promise<Response> {
  checkMutation(request);
  if (id === session.user.id) return error(400, 'Para a sua própria senha, use "Trocar senha".');
  const row = await findUser(env, id);
  if (!row) return error(404, 'Usuário não encontrado.');

  const tempPassword = newTempPassword();
  const hash = await hashPassword(tempPassword);
  await env.DB.prepare(
    `UPDATE users SET password_hash = ?, password_salt = ?, password_iterations = ?, must_change_password = 1
      WHERE id = ?`,
  )
    .bind(hash.hash, hash.salt, hash.iterations, id)
    .run();
  await endUserSessions(env, id);
  return json({ tempPassword });
}

// ---------- Roteador ----------

/** Rotas liberadas para quem ainda precisa trocar a senha temporária. */
const ALLOWED_BEFORE_PASSWORD_CHANGE = new Set(['GET /api/me', 'POST /api/password', 'POST /api/logout']);

export async function handleApi(request: Request, env: Env, now = new Date()): Promise<Response> {
  try {
    const response = await route(request, env, now);
    return response;
  } catch (e) {
    if (e instanceof HttpError) return error(e.status, e.message);
    console.error('Erro na API', e);
    return error(500, 'Erro inesperado no servidor. Tente de novo.');
  }
}

async function route(request: Request, env: Env, now: Date): Promise<Response> {
  const path = new URL(request.url).pathname.replace(/\/+$/, '');
  const key = `${request.method} ${path}`;

  if (key === 'GET /api/setup') return getSetup(env);
  if (key === 'POST /api/setup') return postSetup(request, env, now);
  if (key === 'POST /api/login') return postLogin(request, env, now);

  const session = await loadSession(env, request, now);
  if (!session) {
    // Sair sem sessão válida não é erro: só limpa o cookie.
    if (key === 'POST /api/logout') return json({ ok: true }, 200, { 'set-cookie': clearedCookie() });
    return error(401, 'Sessão encerrada. Entre de novo.');
  }
  const response = await routeLoggedIn(request, env, session, key, path, now);
  if (session.setCookie && !response.headers.has('set-cookie')) response.headers.set('set-cookie', session.setCookie);
  return response;
}

async function routeLoggedIn(
  request: Request,
  env: Env,
  session: Session,
  key: string,
  path: string,
  now: Date,
): Promise<Response> {
  if (session.user.mustChangePassword && !ALLOWED_BEFORE_PASSWORD_CHANGE.has(key)) {
    return error(403, 'Defina sua senha antes de continuar.');
  }

  if (key === 'GET /api/me') return json({ user: session.user });
  if (key === 'POST /api/logout') return postLogout(request, env, session);
  if (key === 'POST /api/password') return postPassword(request, env, session);

  if (path === '/api/users' || path.startsWith('/api/users/')) {
    if (!can(session.user.role, 'manage_users')) return error(403, 'Seu perfil não pode gerenciar usuários.');
    if (key === 'GET /api/users') return listUsers(env);
    if (key === 'POST /api/users') return createUser(request, env, now);
    const match = /^\/api\/users\/([^/]+)(\/reset-password)?$/.exec(path);
    if (match) {
      const id = decodeURIComponent(match[1]!);
      if (!match[2] && request.method === 'PATCH') return updateUser(request, env, session, id);
      if (match[2] && request.method === 'POST') return resetPassword(request, env, session, id);
    }
  }

  const orders = await routeOrders(request, env, session, key, path, now);
  if (orders) return orders;
  const shipments = await routeShipments(request, env, session, key, path, now);
  if (shipments) return shipments;

  return error(404, 'Rota não encontrada.');
}
