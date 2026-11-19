-- Solicitações de embarque (SPEC.md, seções 2 e 3; pedido do Gabriel em 19/11/2026): o agente de
-- cargas pede, por fornecedor, os containers de cada tipo, a saída e o valor de cada container, e só o
-- Gabriel aprova. Entram o perfil "agente" e a marca de quem aprova as solicitações. Como nas migrações
-- 0006 e 0007, a tabela de usuários é refeita com os mesmos dados (o SQLite não muda a regra CHECK de
-- uma coluna); as chaves das outras tabelas continuam valendo, porque o nome volta a ser "users".
PRAGMA defer_foreign_keys = true;

CREATE TABLE users_new (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  role TEXT NOT NULL CHECK (role IN ('admin', 'editor', 'consulta', 'leitor', 'embarques', 'vendas', 'agente')),
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  password_iterations INTEGER NOT NULL,
  must_change_password INTEGER NOT NULL DEFAULT 1,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  last_login_at TEXT,
  approves_bookings INTEGER NOT NULL DEFAULT 0
);

INSERT INTO users_new (id, name, email, role, password_hash, password_salt, password_iterations, must_change_password, active, created_at, last_login_at)
SELECT id, name, email, role, password_hash, password_salt, password_iterations, must_change_password, active, created_at, last_login_at FROM users;

DROP TABLE users;
ALTER TABLE users_new RENAME TO users;

PRAGMA defer_foreign_keys = false;

-- Quem aprova é o Gabriel (decidido em 19/11/2026): a conta do primeiro acesso, o admin mais antigo.
UPDATE users SET approves_bookings = 1
 WHERE id = (SELECT id FROM users WHERE role = 'admin' ORDER BY created_at, id LIMIT 1);

-- Uma solicitação por fornecedor e saída. O nome do fornecedor fica guardado como estava no pedido:
-- se o admin apagar tudo para começar do zero, a solicitação continua, sem a ligação com o fornecedor.
CREATE TABLE booking_requests (
  id TEXT PRIMARY KEY,
  supplier_id TEXT REFERENCES suppliers(id),
  supplier_name TEXT NOT NULL,
  departure_port TEXT NOT NULL,
  departure_date TEXT NOT NULL,     -- saída prevista (AAAA-MM-DD)
  notes TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'aguardando' CHECK (status IN ('aguardando', 'aprovada', 'recusada', 'cancelada')),
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id),
  decided_at TEXT,                  -- quando foi aprovada, recusada ou cancelada
  decided_by TEXT REFERENCES users(id),
  decision_note TEXT NOT NULL DEFAULT ''   -- motivo da recusa ou observação da aprovação
);
CREATE INDEX booking_requests_status ON booking_requests(status, departure_date);
CREATE INDEX booking_requests_created_by ON booking_requests(created_by);
CREATE INDEX booking_requests_supplier ON booking_requests(supplier_id);

-- Containers de cada tipo, com o valor de cada um em centavos de dólar. A quantidade aprovada pode ser
-- menor que a pedida; fica vazia enquanto a solicitação não é aprovada.
CREATE TABLE booking_request_lines (
  request_id TEXT NOT NULL REFERENCES booking_requests(id),
  container_type TEXT NOT NULL CHECK (container_type IN ('20', '40', '40HC')),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  approved_quantity INTEGER CHECK (approved_quantity >= 0 AND approved_quantity <= quantity),
  price_cents INTEGER NOT NULL CHECK (price_cents > 0),
  PRIMARY KEY (request_id, container_type)
);
