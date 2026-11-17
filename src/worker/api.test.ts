import { beforeEach, describe, expect, it } from 'vitest';
import { handleApi } from './api';
import type { Env } from './env';
import { createTestD1 } from './test-d1';

const ORIGIN = 'https://noporto.exemplo';
const now = new Date('2026-11-17T12:00:00Z');

let env: Env;

beforeEach(() => {
  env = { DB: createTestD1(), SETUP_TOKEN: 'codigo-secreto' } as Env;
});

interface Options {
  body?: unknown;
  cookie?: string;
  origin?: string | null;
  ip?: string;
  at?: Date;
}

async function call(method: string, path: string, opts: Options = {}) {
  const headers: Record<string, string> = { 'cf-connecting-ip': opts.ip ?? '10.0.0.1' };
  if (opts.cookie) headers.cookie = opts.cookie;
  if (method !== 'GET') {
    if (opts.origin !== null) headers.origin = opts.origin ?? ORIGIN;
    headers['content-type'] = 'application/json';
  }
  const res = await handleApi(
    new Request(`${ORIGIN}${path}`, {
      method,
      headers,
      body: method === 'GET' ? undefined : JSON.stringify(opts.body ?? {}),
    }),
    env,
    opts.at ?? now,
  );
  const setCookie = res.headers.get('set-cookie');
  return {
    status: res.status,
    data: (await res.json()) as any,
    cookie: setCookie ? setCookie.split(';')[0]! : undefined,
    setCookie,
  };
}

const ADMIN = { name: 'Gabriel', email: 'gabriel@grupo.exemplo', password: 'senha-do-gabriel' };

async function setupAdmin() {
  const res = await call('POST', '/api/setup', { body: { token: 'codigo-secreto', ...ADMIN } });
  expect(res.status).toBe(201);
  return res.cookie!;
}

/** Cria um usuário pelo admin, entra com a senha temporária e define a senha definitiva. */
async function createAndActivate(adminCookie: string, role: 'editor' | 'leitor', email: string) {
  const created = await call('POST', '/api/users', { cookie: adminCookie, body: { name: role, email, role } });
  expect(created.status).toBe(201);
  const login = await call('POST', '/api/login', { body: { email, password: created.data.tempPassword } });
  const done = await call('POST', '/api/password', { cookie: login.cookie, body: { password: `senha-${role}-123` } });
  expect(done.status).toBe(200);
  return { id: created.data.user.id as string, cookie: login.cookie! };
}

describe('primeiro acesso', () => {
  it('fica disponível só enquanto não há usuários', async () => {
    expect((await call('GET', '/api/setup')).data).toEqual({ available: true, configured: true });
    await setupAdmin();
    expect((await call('GET', '/api/setup')).data.available).toBe(false);
  });

  it('cria o admin com sessão aberta e sem troca obrigatória', async () => {
    const cookie = await setupAdmin();
    const me = await call('GET', '/api/me', { cookie });
    expect(me.data.user).toMatchObject({ name: 'Gabriel', role: 'admin', mustChangePassword: false });
  });

  it('exige o código de instalação correto', async () => {
    const res = await call('POST', '/api/setup', { body: { token: 'errado', ...ADMIN } });
    expect(res.status).toBe(403);
    expect((await call('GET', '/api/setup')).data.available).toBe(true);
  });

  it('não funciona sem o código cadastrado no Cloudflare', async () => {
    env.SETUP_TOKEN = undefined;
    expect((await call('GET', '/api/setup')).data.configured).toBe(false);
    expect((await call('POST', '/api/setup', { body: { token: '', ...ADMIN } })).status).toBe(503);
  });

  it('só acontece uma vez', async () => {
    await setupAdmin();
    const again = await call('POST', '/api/setup', { body: { token: 'codigo-secreto', ...ADMIN, email: 'outro@grupo.exemplo' } });
    expect(again.status).toBe(409);
  });

  it('confere a senha mínima', async () => {
    const res = await call('POST', '/api/setup', { body: { token: 'codigo-secreto', ...ADMIN, password: 'curta' } });
    expect(res.status).toBe(400);
    expect(res.data.error).toMatch(/10 caracteres/);
  });

  it('bloqueia depois de muitos códigos errados', async () => {
    for (let i = 0; i < 5; i++) await call('POST', '/api/setup', { body: { token: 'errado', ...ADMIN } });
    const res = await call('POST', '/api/setup', { body: { token: 'codigo-secreto', ...ADMIN } });
    expect(res.status).toBe(429);
  });
});

describe('login', () => {
  beforeEach(setupAdmin);

  it('entra com e-mail em qualquer caixa e grava cookie seguro', async () => {
    const res = await call('POST', '/api/login', { body: { email: ' GABRIEL@grupo.exemplo ', password: ADMIN.password } });
    expect(res.status).toBe(200);
    expect(res.setCookie).toMatch(/HttpOnly/);
    expect(res.setCookie).toMatch(/Secure/);
    expect(res.setCookie).toMatch(/SameSite=Lax/);
    expect((await call('GET', '/api/me', { cookie: res.cookie })).status).toBe(200);
  });

  it('mesma mensagem para e-mail inexistente e senha errada', async () => {
    const wrongPassword = await call('POST', '/api/login', { body: { email: ADMIN.email, password: 'errada-errada' } });
    const unknown = await call('POST', '/api/login', { body: { email: 'ninguem@grupo.exemplo', password: 'errada-errada' } });
    expect(wrongPassword.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrongPassword.data.error).toBe(unknown.data.error);
  });

  it('bloqueia o e-mail depois de 5 falhas e libera depois de 15 minutos', async () => {
    for (let i = 0; i < 5; i++) {
      await call('POST', '/api/login', { body: { email: ADMIN.email, password: 'errada-errada' } });
    }
    const blocked = await call('POST', '/api/login', { body: { email: ADMIN.email, password: ADMIN.password } });
    expect(blocked.status).toBe(429);
    const later = new Date(now.getTime() + 16 * 60 * 1000);
    const ok = await call('POST', '/api/login', { body: { email: ADMIN.email, password: ADMIN.password }, at: later });
    expect(ok.status).toBe(200);
  });

  it('bloqueia o endereço de rede depois de 20 falhas em e-mails diferentes', async () => {
    for (let i = 0; i < 20; i++) {
      await call('POST', '/api/login', { body: { email: `x${i}@grupo.exemplo`, password: 'errada-errada' } });
    }
    const blocked = await call('POST', '/api/login', { body: { email: ADMIN.email, password: ADMIN.password } });
    expect(blocked.status).toBe(429);
    const otherIp = await call('POST', '/api/login', { body: { email: ADMIN.email, password: ADMIN.password }, ip: '10.0.0.2' });
    expect(otherIp.status).toBe(200);
  });

  it('sair encerra a sessão no servidor', async () => {
    const { cookie } = await call('POST', '/api/login', { body: { email: ADMIN.email, password: ADMIN.password } });
    expect((await call('POST', '/api/logout', { cookie })).status).toBe(200);
    expect((await call('GET', '/api/me', { cookie })).status).toBe(401);
  });

  it('sessão vence em 30 dias sem uso', async () => {
    const { cookie } = await call('POST', '/api/login', { body: { email: ADMIN.email, password: ADMIN.password } });
    const later = new Date(now.getTime() + 31 * 24 * 60 * 60 * 1000);
    expect((await call('GET', '/api/me', { cookie, at: later })).status).toBe(401);
  });

  it('sessão é renovada com o uso', async () => {
    const { cookie } = await call('POST', '/api/login', { body: { email: ADMIN.email, password: ADMIN.password } });
    const day20 = new Date(now.getTime() + 20 * 24 * 60 * 60 * 1000);
    const renewed = await call('GET', '/api/me', { cookie, at: day20 });
    expect(renewed.setCookie).toMatch(/Expires=/);
    const day45 = new Date(now.getTime() + 45 * 24 * 60 * 60 * 1000);
    expect((await call('GET', '/api/me', { cookie, at: day45 })).status).toBe(200);
  });

  it('cookie inventado não entra', async () => {
    expect((await call('GET', '/api/me', { cookie: 'np_sessao=inventado' })).status).toBe(401);
    expect((await call('GET', '/api/me')).status).toBe(401);
  });
});

describe('proteção dos pedidos que alteram dados', () => {
  it('recusa origem de outro site', async () => {
    const res = await call('POST', '/api/login', { body: { email: 'a@b.c', password: 'x' }, origin: 'https://outro.exemplo' });
    expect(res.status).toBe(403);
  });

  it('recusa pedido sem origem', async () => {
    const res = await call('POST', '/api/login', { body: { email: 'a@b.c', password: 'x' }, origin: null });
    expect(res.status).toBe(403);
  });

  it('recusa conteúdo que não é JSON', async () => {
    const res = await handleApi(
      new Request(`${ORIGIN}/api/login`, {
        method: 'POST',
        headers: { origin: ORIGIN, 'content-type': 'application/x-www-form-urlencoded' },
        body: 'email=a&password=b',
      }),
      env,
      now,
    );
    expect(res.status).toBe(415);
  });
});

describe('senha temporária', () => {
  it('obriga a troca antes de usar o sistema', async () => {
    const admin = await setupAdmin();
    const created = await call('POST', '/api/users', {
      cookie: admin,
      body: { name: 'Ana', email: 'ana@grupo.exemplo', role: 'admin' },
    });
    const login = await call('POST', '/api/login', { body: { email: 'ana@grupo.exemplo', password: created.data.tempPassword } });
    expect(login.data.user.mustChangePassword).toBe(true);
    expect((await call('GET', '/api/users', { cookie: login.cookie })).status).toBe(403);
    expect((await call('GET', '/api/me', { cookie: login.cookie })).status).toBe(200);

    const same = await call('POST', '/api/password', { cookie: login.cookie, body: { password: created.data.tempPassword } });
    expect(same.status).toBe(400);

    const ok = await call('POST', '/api/password', { cookie: login.cookie, body: { password: 'senha-nova-da-ana' } });
    expect(ok.status).toBe(200);
    expect((await call('GET', '/api/users', { cookie: login.cookie })).status).toBe(200);
  });
});

describe('trocar a própria senha', () => {
  it('exige a senha atual e encerra as outras sessões', async () => {
    const first = await setupAdmin();
    const second = (await call('POST', '/api/login', { body: { email: ADMIN.email, password: ADMIN.password } })).cookie;

    const wrong = await call('POST', '/api/password', { cookie: first, body: { current: 'errada', password: 'nova-senha-123' } });
    expect(wrong.status).toBe(400);

    const ok = await call('POST', '/api/password', {
      cookie: first,
      body: { current: ADMIN.password, password: 'nova-senha-123' },
    });
    expect(ok.status).toBe(200);
    expect((await call('GET', '/api/me', { cookie: first })).status).toBe(200);
    expect((await call('GET', '/api/me', { cookie: second })).status).toBe(401);

    const old = await call('POST', '/api/login', { body: { email: ADMIN.email, password: ADMIN.password } });
    expect(old.status).toBe(401);
  });
});

describe('usuários', () => {
  let admin: string;
  beforeEach(async () => {
    admin = await setupAdmin();
  });

  it('admin cria usuário e recebe a senha temporária uma vez', async () => {
    const res = await call('POST', '/api/users', {
      cookie: admin,
      body: { name: 'Bia', email: 'Bia@Grupo.exemplo', role: 'editor' },
    });
    expect(res.status).toBe(201);
    expect(res.data.tempPassword).toHaveLength(12);
    expect(res.data.user).toMatchObject({ email: 'bia@grupo.exemplo', role: 'editor', mustChangePassword: true, active: true });

    const list = await call('GET', '/api/users', { cookie: admin });
    expect(list.data.users).toHaveLength(2);
    expect(JSON.stringify(list.data)).not.toMatch(/hash|salt/);
  });

  it('recusa e-mail repetido e dados inválidos', async () => {
    const dup = await call('POST', '/api/users', { cookie: admin, body: { name: 'G', email: ADMIN.email, role: 'leitor' } });
    expect(dup.status).toBe(409);
    const badRole = await call('POST', '/api/users', { cookie: admin, body: { name: 'X', email: 'x@grupo.exemplo', role: 'dono' } });
    expect(badRole.status).toBe(400);
    const badEmail = await call('POST', '/api/users', { cookie: admin, body: { name: 'X', email: 'sem-arroba', role: 'leitor' } });
    expect(badEmail.status).toBe(400);
    expect(badEmail.data.error).toBe('E-mail inválido.');
    const noName = await call('POST', '/api/users', { cookie: admin, body: { name: '  ', email: 'x@grupo.exemplo', role: 'leitor' } });
    expect(noName.data.error).toBe('Informe o nome.');
  });

  it('editor e leitor não gerenciam usuários', async () => {
    const editor = await createAndActivate(admin, 'editor', 'editor@grupo.exemplo');
    const leitor = await createAndActivate(admin, 'leitor', 'leitor@grupo.exemplo');
    for (const cookie of [editor.cookie, leitor.cookie]) {
      expect((await call('GET', '/api/users', { cookie })).status).toBe(403);
      expect((await call('POST', '/api/users', { cookie, body: { name: 'X', email: 'x@grupo.exemplo', role: 'admin' } })).status).toBe(403);
      expect((await call('PATCH', `/api/users/${editor.id}`, { cookie, body: { role: 'admin' } })).status).toBe(403);
      expect((await call('POST', `/api/users/${editor.id}/reset-password`, { cookie })).status).toBe(403);
    }
  });

  it('mudar perfil vale no pedido seguinte', async () => {
    const editor = await createAndActivate(admin, 'editor', 'editor@grupo.exemplo');
    const res = await call('PATCH', `/api/users/${editor.id}`, { cookie: admin, body: { role: 'admin' } });
    expect(res.data.user.role).toBe('admin');
    expect((await call('GET', '/api/users', { cookie: editor.cookie })).status).toBe(200);
  });

  it('desativar encerra as sessões e impede o login', async () => {
    const editor = await createAndActivate(admin, 'editor', 'editor@grupo.exemplo');
    const res = await call('PATCH', `/api/users/${editor.id}`, { cookie: admin, body: { active: false } });
    expect(res.data.user.active).toBe(false);
    expect((await call('GET', '/api/me', { cookie: editor.cookie })).status).toBe(401);
    const login = await call('POST', '/api/login', { body: { email: 'editor@grupo.exemplo', password: 'senha-editor-123' } });
    expect(login.status).toBe(401);

    await call('PATCH', `/api/users/${editor.id}`, { cookie: admin, body: { active: true } });
    const back = await call('POST', '/api/login', { body: { email: 'editor@grupo.exemplo', password: 'senha-editor-123' } });
    expect(back.status).toBe(200);
  });

  it('admin não desativa nem rebaixa a si mesmo', async () => {
    const me = (await call('GET', '/api/me', { cookie: admin })).data.user;
    expect((await call('PATCH', `/api/users/${me.id}`, { cookie: admin, body: { active: false } })).status).toBe(400);
    expect((await call('PATCH', `/api/users/${me.id}`, { cookie: admin, body: { role: 'leitor' } })).status).toBe(400);
    const rename = await call('PATCH', `/api/users/${me.id}`, { cookie: admin, body: { name: 'Gabriel H.' } });
    expect(rename.data.user.name).toBe('Gabriel H.');
  });

  it('um admin rebaixa outro, e o rebaixado perde o acesso na hora', async () => {
    const other = await createAndActivate(admin, 'editor', 'outro@grupo.exemplo');
    await call('PATCH', `/api/users/${other.id}`, { cookie: admin, body: { role: 'admin' } });
    const me = (await call('GET', '/api/me', { cookie: admin })).data.user;
    expect((await call('PATCH', `/api/users/${me.id}`, { cookie: other.cookie, body: { role: 'editor' } })).status).toBe(200);
    expect((await call('GET', '/api/users', { cookie: admin })).status).toBe(403);
    // O outro admin, agora o único, não pode se rebaixar nem se desativar.
    expect((await call('PATCH', `/api/users/${other.id}`, { cookie: other.cookie, body: { role: 'leitor' } })).status).toBe(400);
    expect((await call('PATCH', `/api/users/${other.id}`, { cookie: other.cookie, body: { active: false } })).status).toBe(400);
  });

  it('recusa e-mail de outro usuário na edição', async () => {
    const editor = await createAndActivate(admin, 'editor', 'editor@grupo.exemplo');
    const res = await call('PATCH', `/api/users/${editor.id}`, { cookie: admin, body: { email: ADMIN.email } });
    expect(res.status).toBe(409);
  });

  it('redefinir senha gera temporária e encerra as sessões', async () => {
    const editor = await createAndActivate(admin, 'editor', 'editor@grupo.exemplo');
    const res = await call('POST', `/api/users/${editor.id}/reset-password`, { cookie: admin });
    expect(res.status).toBe(200);
    expect((await call('GET', '/api/me', { cookie: editor.cookie })).status).toBe(401);
    const login = await call('POST', '/api/login', { body: { email: 'editor@grupo.exemplo', password: res.data.tempPassword } });
    expect(login.data.user.mustChangePassword).toBe(true);
  });

  it('admin não redefine a própria senha por aqui', async () => {
    const me = (await call('GET', '/api/me', { cookie: admin })).data.user;
    expect((await call('POST', `/api/users/${me.id}/reset-password`, { cookie: admin })).status).toBe(400);
  });

  it('usuário inexistente dá 404', async () => {
    expect((await call('PATCH', '/api/users/nao-existe', { cookie: admin, body: { name: 'X' } })).status).toBe(404);
  });
});

describe('rotas', () => {
  it('rota desconhecida dá 404 para quem está logado', async () => {
    const cookie = await setupAdmin();
    expect((await call('GET', '/api/nada', { cookie })).status).toBe(404);
  });

  it('respostas não ficam em cache', async () => {
    const res = await handleApi(new Request(`${ORIGIN}/api/setup`), env, now);
    expect(res.headers.get('cache-control')).toBe('no-store');
  });
});

describe('limites e cabeçalhos', () => {
  it('respostas da API trazem os cabeçalhos de segurança', async () => {
    const res = await handleApi(new Request(`${ORIGIN}/api/setup`), env, now);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('x-frame-options')).toBe('DENY');
    expect(res.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
  });

  it('recusa senha gigante no login, sem contar como tentativa', async () => {
    const res = await call('POST', '/api/login', { body: { email: 'x@grupo.exemplo', password: 'a'.repeat(1001) } });
    expect(res.status).toBe(400);
    const { results } = await env.DB.prepare('SELECT COUNT(*) AS n FROM login_attempts').all<{ n: number }>();
    expect(results[0]!.n).toBe(0);
  });

  it('recusa corpo grande demais', async () => {
    const body = JSON.stringify({ email: 'x@grupo.exemplo', password: 'x', extra: 'a'.repeat(2_100_000) });
    const res = await handleApi(
      new Request(`${ORIGIN}/api/login`, { method: 'POST', headers: { origin: ORIGIN, 'content-type': 'application/json' }, body }),
      env,
      now,
    );
    expect(res.status).toBe(413);
  });
});
