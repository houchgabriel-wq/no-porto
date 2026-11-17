-- Dois perfis novos (SPEC.md, seção 4; pedido do Gabriel em 17/11/2026): "consulta" vê tudo, com
-- valores, e não altera nada; "embarques" vê só os produtos embarcados, sem valores. O SQLite não muda
-- a regra (CHECK) de uma coluna: a tabela de usuários é refeita com os mesmos dados. As chaves das
-- outras tabelas (sessões, itens, pagamentos) continuam valendo, porque o nome da tabela volta a ser
-- "users" antes do fim da migração.
PRAGMA defer_foreign_keys = true;

CREATE TABLE users_new (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  role TEXT NOT NULL CHECK (role IN ('admin', 'editor', 'consulta', 'leitor', 'embarques')),
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  password_iterations INTEGER NOT NULL,
  must_change_password INTEGER NOT NULL DEFAULT 1,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  last_login_at TEXT
);

INSERT INTO users_new (id, name, email, role, password_hash, password_salt, password_iterations, must_change_password, active, created_at, last_login_at)
SELECT id, name, email, role, password_hash, password_salt, password_iterations, must_change_password, active, created_at, last_login_at FROM users;

DROP TABLE users;
ALTER TABLE users_new RENAME TO users;

PRAGMA defer_foreign_keys = false;
