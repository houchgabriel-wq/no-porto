// A migração 0009 roda sobre um banco com usuários e sessões: refaz a tabela de usuários (perfil
// Agente) sem perder ninguém e marca como aprovador o admin do primeiro acesso.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { expect, it } from 'vitest';

const dir = fileURLToPath(new URL('../../migrations', import.meta.url).href);
const files = readdirSync(dir)
  .filter((f) => f.endsWith('.sql'))
  .sort();
const target = '0009_booking_requests.sql';

it('mantém usuários e sessões e marca o admin mais antigo como aprovador', () => {
  const db = new DatabaseSync(':memory:');
  for (const f of files.filter((f) => f < target)) db.exec(readFileSync(join(dir, f), 'utf8'));

  const user = db.prepare(
    `INSERT INTO users (id, name, email, role, password_hash, password_salt, password_iterations, must_change_password, active, created_at)
     VALUES (?, ?, ?, ?, 'h', 's', 1, 0, 1, ?)`,
  );
  // Um editor criado antes não conta: o aprovador é o primeiro admin.
  user.run('leo', 'Leonardo', 'leo@grupo.exemplo', 'editor', '2026-11-17T08:00:00Z');
  user.run('gabriel', 'Gabriel', 'gabriel@grupo.exemplo', 'admin', '2026-11-17T09:00:00Z');
  user.run('marcelo', 'Marcelo', 'marcelo@grupo.exemplo', 'admin', '2026-11-17T10:00:00Z');
  db.prepare("INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES ('t', 'gabriel', '2026-11-18', '2026-12-18')").run();

  // O D1 aplica cada migração numa transação; as chaves adiadas são conferidas no fim dela.
  db.exec(`BEGIN; ${readFileSync(join(dir, target), 'utf8')} COMMIT;`);

  expect(db.prepare('SELECT id, role, approves_bookings FROM users ORDER BY created_at').all()).toEqual([
    { id: 'leo', role: 'editor', approves_bookings: 0 },
    { id: 'gabriel', role: 'admin', approves_bookings: 1 },
    { id: 'marcelo', role: 'admin', approves_bookings: 0 },
  ]);
  expect(db.prepare('SELECT user_id FROM sessions').all()).toEqual([{ user_id: 'gabriel' }]);
  expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  // O perfil novo passa a ser aceito.
  user.run('ana', 'Ana', 'ana@agente.exemplo', 'agente', '2026-11-19T10:00:00Z');
  expect(() => user.run('x', 'X', 'x@x.exemplo', 'dono', '2026-11-19T10:00:00Z')).toThrow();
});
