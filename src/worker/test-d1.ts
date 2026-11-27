// D1 de teste: SQLite em memória (node:sqlite) com as migrações do app.
// Só para os testes; cobre prepare/bind/first/all/run e batch.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

type Value = string | number | null;

export function createTestD1(): D1Database {
  const sqlite = new DatabaseSync(':memory:');
  // Confere as chaves estrangeiras, como o D1 da Cloudflare.
  sqlite.exec('PRAGMA foreign_keys = ON');
  const dir = fileURLToPath(new URL('../../migrations', import.meta.url).href);
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    sqlite.exec(readFileSync(join(dir, file), 'utf8'));
  }

  // Conta as consultas como a Cloudflare conta o limite por pedido: um lote (batch) vale uma.
  const counter = { queries: 0, inBatch: false };
  const count = () => {
    if (!counter.inBatch) counter.queries++;
  };
  const statement = (sql: string, args: Value[] = []) => {
    const stmt = {
      bind: (...values: Value[]) => statement(sql, values),
      first: async <T>() => {
        count();
        return (sqlite.prepare(sql).get(...args) as T | undefined) ?? null;
      },
      all: async <T>() => {
        count();
        return { results: sqlite.prepare(sql).all(...args) as T[], success: true, meta: {} };
      },
      run: async () => {
        count();
        const result = sqlite.prepare(sql).run(...args);
        return { success: true, meta: { changes: Number(result.changes) } };
      },
      raw: async () => [],
    };
    return stmt;
  };

  const db = {
    prepare: (sql: string) => statement(sql),
    batch: async (stmts: ReturnType<typeof statement>[]) => {
      count();
      counter.inBatch = true;
      try {
        const out = [];
        for (const s of stmts) out.push(await s.all());
        return out;
      } finally {
        counter.inBatch = false;
      }
    },
    /** Quantas consultas já foram feitas (para os testes do limite por pedido). */
    get queries() {
      return counter.queries;
    },
    exec: async (sql: string) => {
      sqlite.exec(sql);
      return { count: 0, duration: 0 };
    },
    dump: async () => new ArrayBuffer(0),
  };
  return db as unknown as D1Database;
}
