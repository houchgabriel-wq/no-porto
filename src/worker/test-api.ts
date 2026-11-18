// Ajudantes para os testes da API: pedidos com cookie e origem, e contas prontas.

import { expect } from 'vitest';
import { handleApi } from './api';
import type { Env } from './env';
import { createTestD1 } from './test-d1';

export const ORIGIN = 'https://noporto.exemplo';

export interface CallOptions {
  body?: unknown;
  cookie?: string;
  at?: Date;
}

export function testApp(now = new Date('2026-11-17T12:00:00Z')) {
  const env = { DB: createTestD1(), SETUP_TOKEN: 'codigo-secreto' } as unknown as Env;

  async function call(method: string, path: string, opts: CallOptions = {}) {
    const headers: Record<string, string> = { 'cf-connecting-ip': '10.0.0.1' };
    if (opts.cookie) headers.cookie = opts.cookie;
    if (method !== 'GET') {
      headers.origin = ORIGIN;
      headers['content-type'] = 'application/json';
    }
    const res = await handleApi(
      new Request(`${ORIGIN}${path}`, { method, headers, body: method === 'GET' ? undefined : JSON.stringify(opts.body ?? {}) }),
      env,
      opts.at ?? now,
    );
    const setCookie = res.headers.get('set-cookie');
    return { status: res.status, data: (await res.json()) as any, cookie: setCookie ? setCookie.split(';')[0]! : undefined };
  }

  /** A resposta como veio (para arquivos, que não são JSON). */
  async function raw(method: string, path: string, opts: CallOptions = {}) {
    const headers: Record<string, string> = { 'cf-connecting-ip': '10.0.0.1' };
    if (opts.cookie) headers.cookie = opts.cookie;
    return handleApi(new Request(`${ORIGIN}${path}`, { method, headers }), env, opts.at ?? now);
  }

  /** Cria o admin, um editor e um leitor, já com senha definitiva. */
  async function accounts() {
    const setup = await call('POST', '/api/setup', {
      body: { token: 'codigo-secreto', name: 'Gabriel', email: 'gabriel@grupo.exemplo', password: 'senha-do-gabriel' },
    });
    expect(setup.status).toBe(201);
    const admin = { id: setup.data.user.id as string, cookie: setup.cookie! };

    async function make(role: 'editor' | 'leitor' | 'consulta' | 'embarques' | 'vendas', name: string) {
      const email = `${role}@grupo.exemplo`;
      const created = await call('POST', '/api/users', { cookie: admin.cookie, body: { name, email, role } });
      const login = await call('POST', '/api/login', { body: { email, password: created.data.tempPassword } });
      await call('POST', '/api/password', { cookie: login.cookie, body: { password: `senha-${role}-123` } });
      return { id: created.data.user.id as string, cookie: login.cookie! };
    }
    return {
      admin,
      editor: await make('editor', 'Bia Editora'),
      leitor: await make('leitor', 'Leo Leitor'),
      consulta: await make('consulta', 'Cris Consulta'),
      embarques: await make('embarques', 'Edu Embarques'),
      vendas: await make('vendas', 'Vera Vendas'),
    };
  }

  return { env, call, raw, accounts };
}
