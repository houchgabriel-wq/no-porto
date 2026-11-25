// A migração 0016 tira das observações o container que o Novo embarque escrevia ("Container YMLU5449045").
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { expect, it } from 'vitest';

const dir = fileURLToPath(new URL('../../migrations', import.meta.url).href);
const files = readdirSync(dir)
  .filter((f) => f.endsWith('.sql'))
  .sort();
const target = '0016_invoice_units.sql';

it('o container das observações vai para o campo; a observação que era só isso fica vazia', () => {
  const db = new DatabaseSync(':memory:');
  for (const f of files.filter((f) => f < target)) db.exec(readFileSync(join(dir, f), 'utf8'));
  const add = db.prepare("INSERT INTO invoices (id, number, notes, created_at) VALUES (?, ?, ?, '2026-11-20')");
  add.run('a', 'A1', 'Container YMLU5449045');
  add.run('b', 'B1', 'Container MSCU1234567 · pago metade');
  add.run('c', 'C1', 'Container sem número');
  add.run('d', 'D1', '');
  add.run('e', 'E1', 'Container YMLU54490451');
  db.exec(`BEGIN; ${readFileSync(join(dir, target), 'utf8')} COMMIT;`);
  expect(db.prepare('SELECT id, container, notes, container_cartons FROM invoices ORDER BY id').all()).toEqual([
    { id: 'a', container: 'YMLU5449045', notes: '', container_cartons: null },
    { id: 'b', container: 'MSCU1234567', notes: 'Container MSCU1234567 · pago metade', container_cartons: null },
    { id: 'c', container: '', notes: 'Container sem número', container_cartons: null },
    { id: 'd', container: '', notes: '', container_cartons: null },
    { id: 'e', container: '', notes: 'Container YMLU54490451', container_cartons: null },
  ]);
  // O D1 recusa padrões de LIKE e GLOB com mais de 50 bytes.
  for (const m of readFileSync(join(dir, target), 'utf8').matchAll(/(?:GLOB|LIKE)\s+'([^']*)'/g)) expect(m[1]!.length, m[1]).toBeLessThanOrEqual(50);
});
