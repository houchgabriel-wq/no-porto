-- Pedidos, embarques e pagamentos (SPEC.md, seções 3 e 8). Todas as tabelas do fluxo entram de uma
-- vez, para as cargas da Produção, dos Embarques e dos Entregues usarem o mesmo modelo.
-- Dinheiro sem ponto flutuante: dólar em centavos, preço unitário em milionésimos de dólar e câmbio
-- multiplicado por 10.000 (quatro casas).

CREATE TABLE suppliers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

-- Produto reconhecido pelo ISBN; sem ISBN, pelo título normalizado (title_key).
CREATE TABLE products (
  id TEXT PRIMARY KEY,
  isbn TEXT UNIQUE,
  title TEXT NOT NULL,
  title_key TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX products_title_key ON products(title_key) WHERE isbn IS NULL;

-- A PO é o número do pedido da editora; pode juntar itens de mais de um fornecedor (a PO-063 tem
-- Sara e Claire), por isso o fornecedor fica no item.
CREATE TABLE purchase_orders (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE COLLATE NOCASE,
  ordered_at TEXT,
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE bills_of_lading (
  id TEXT PRIMARY KEY,
  number TEXT NOT NULL UNIQUE COLLATE NOCASE,
  supplier_id TEXT REFERENCES suppliers(id),
  eta TEXT,          -- chegada prevista (AAAA-MM-DD)
  arrived_at TEXT,   -- chegada real (AAAA-MM-DD)
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE invoices (
  id TEXT PRIMARY KEY,
  number TEXT NOT NULL,
  ref TEXT NOT NULL DEFAULT '',
  supplier_id TEXT REFERENCES suppliers(id),
  bill_of_lading_id TEXT REFERENCES bills_of_lading(id),
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX invoices_bl ON invoices(bill_of_lading_id);

-- Pagamento por invoice. Os antigos, vindos da planilha, entram sem data, valor e câmbio.
CREATE TABLE payments (
  id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL REFERENCES invoices(id),
  paid_at TEXT,
  amount_cents INTEGER,
  exchange_rate_e4 INTEGER,
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id)
);
CREATE INDEX payments_invoice ON payments(invoice_id);

CREATE TABLE order_items (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id),
  description TEXT NOT NULL,          -- o nome como está na linha da planilha ou no cadastro
  supplier_id TEXT REFERENCES suppliers(id),
  purchase_order_id TEXT REFERENCES purchase_orders(id),
  invoice_id TEXT REFERENCES invoices(id),
  status TEXT NOT NULL CHECK (status IN ('producao', 'embarcado', 'entregue')),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  pieces_per_carton INTEGER,
  unit_price_micros INTEGER,          -- sem preço: NULL
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id),
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL REFERENCES users(id),
  deleted_at TEXT
);
CREATE INDEX order_items_status ON order_items(status) WHERE deleted_at IS NULL;
CREATE INDEX order_items_po ON order_items(purchase_order_id);
CREATE INDEX order_items_product ON order_items(product_id);
CREATE INDEX order_items_invoice ON order_items(invoice_id);

-- Histórico automático de mudanças (quem, quando, o quê).
CREATE TABLE events (
  id TEXT PRIMARY KEY,
  entity TEXT NOT NULL,     -- item, order, supplier
  entity_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id),
  type TEXT NOT NULL,       -- created, changed, deleted, imported
  detail TEXT NOT NULL,     -- JSON com o que mudou
  created_at TEXT NOT NULL
);
CREATE INDEX events_entity ON events(entity, entity_id, created_at);
