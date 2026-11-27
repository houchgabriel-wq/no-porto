-- Produção no Brasil (pedido do Gabriel em 27/11/2026; SPEC.md, seção 3): as gráficas do Brasil, os orçamentos
-- com as propostas de cada gráfica, os pedidos fechados e as entregas no estoque. Só acrescenta tabelas, que o
-- código no ar não usa. Reais sem ponto flutuante: o preço por exemplar com quatro casas, como inteiro.

-- As gráficas do Brasil, separadas dos fornecedores de fora.
CREATE TABLE printers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id)
);

-- O orçamento de um produto, pedido a uma ou mais gráficas.
CREATE TABLE br_quotes (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  isbn TEXT,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  specification TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'aberto' CHECK (status IN ('aberto', 'fechado', 'cancelado')),
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id),
  closed_at TEXT,
  closed_by TEXT REFERENCES users(id)
);

-- A proposta de cada gráfica (a mesma gráfica pode ter mais de uma, com outra tiragem).
CREATE TABLE br_offers (
  id TEXT PRIMARY KEY,
  quote_id TEXT NOT NULL REFERENCES br_quotes(id),
  printer_id TEXT NOT NULL REFERENCES printers(id),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_price_e4 INTEGER NOT NULL CHECK (unit_price_e4 > 0),
  lead_days INTEGER CHECK (lead_days IS NULL OR lead_days >= 0),
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id)
);
CREATE INDEX br_offers_quote ON br_offers (quote_id);

-- O pedido fechado com a gráfica: um por orçamento. O dia em que ficou entregue sai das entregas.
CREATE TABLE br_orders (
  id TEXT PRIMARY KEY,
  quote_id TEXT REFERENCES br_quotes(id),
  offer_id TEXT REFERENCES br_offers(id),
  printer_id TEXT NOT NULL REFERENCES printers(id),
  title TEXT NOT NULL,
  isbn TEXT,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_price_e4 INTEGER NOT NULL CHECK (unit_price_e4 > 0),
  ordered_at TEXT NOT NULL,
  due_at TEXT,
  specification TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id)
);
CREATE UNIQUE INDEX br_orders_quote ON br_orders (quote_id);

-- As entregas da gráfica no estoque, em uma ou mais partes. is_last: a gráfica disse que é a última.
CREATE TABLE br_deliveries (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES br_orders(id),
  delivered_at TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  is_last INTEGER NOT NULL DEFAULT 0,
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id)
);
CREATE INDEX br_deliveries_order ON br_deliveries (order_id);
