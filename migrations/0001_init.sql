-- Estrutura inicial do No Porto: contas, sessões e limite de tentativas (SPEC.md, seção 8).
-- Datas em texto ISO 8601 (UTC). Ids em texto (UUID).

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  role TEXT NOT NULL CHECK (role IN ('admin', 'editor', 'leitor')),
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  password_iterations INTEGER NOT NULL,
  must_change_password INTEGER NOT NULL DEFAULT 1,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  last_login_at TEXT
);

-- Só o hash do token fica no banco; o token em si vive no cookie.
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX sessions_user ON sessions(user_id);

-- Tentativas de login que falharam, para o limite por e-mail e por endereço de rede.
CREATE TABLE login_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL,
  ip TEXT,
  attempted_at TEXT NOT NULL
);
CREATE INDEX login_attempts_email ON login_attempts(email, attempted_at);
CREATE INDEX login_attempts_ip ON login_attempts(ip, attempted_at);
