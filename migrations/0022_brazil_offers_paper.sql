-- Produção no Brasil, propostas com itens, papel e PDF (pedido do Gabriel em 27/11/2026, antes de ir ao ar): a
-- proposta da gráfica lista os itens que ela cobra (o kit tem o box e os livros), diz se o papel é da gráfica
-- (incluído no preço) ou nosso (a editora compra e manda: capa e miolo em kg, pelo preço por kg da tabela de
-- papéis) e guarda o PDF. As tabelas da 0021 ainda não tinham uso no código publicado nem dados: as que mudam
-- saem e voltam com a forma nova. As gráficas ficam.

DROP TABLE IF EXISTS br_deliveries;
DROP TABLE IF EXISTS br_orders;
DROP TABLE IF EXISTS br_offers;
DROP TABLE IF EXISTS br_quotes;

-- A tabela de papéis: o preço por kg do papel que a editora compra (reais × 10.000).
CREATE TABLE papers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  price_per_kg_e4 INTEGER NOT NULL CHECK (price_per_kg_e4 > 0),
  notes TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL REFERENCES users(id)
);

-- O orçamento de um produto (ou de um kit), pedido a uma ou mais gráficas.
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

-- A proposta de uma gráfica: quantos produtos prontos ela entrega, de quem é o papel, prazo e condições.
CREATE TABLE br_offers (
  id TEXT PRIMARY KEY,
  quote_id TEXT NOT NULL REFERENCES br_quotes(id),
  printer_id TEXT NOT NULL REFERENCES printers(id),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  paper_by TEXT NOT NULL CHECK (paper_by IN ('grafica', 'editora')),
  lead_days INTEGER CHECK (lead_days IS NULL OR lead_days >= 0),
  proposal_number TEXT NOT NULL DEFAULT '',
  proposal_date TEXT,
  valid_days INTEGER CHECK (valid_days IS NULL OR valid_days >= 0),
  payment_terms TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id)
);
CREATE INDEX br_offers_quote ON br_offers (quote_id);

-- O que a gráfica cobra, item por item (o box, os livros do kit), com o preço por unidade (reais × 10.000).
CREATE TABLE br_offer_items (
  id TEXT PRIMARY KEY,
  offer_id TEXT NOT NULL REFERENCES br_offers(id),
  seq INTEGER NOT NULL,
  description TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_price_e4 INTEGER NOT NULL CHECK (unit_price_e4 > 0)
);
CREATE INDEX br_offer_items_offer ON br_offer_items (offer_id);

-- O papel nosso que a proposta consome: a parte, o papel, o peso em gramas e o preço por kg usado (o da tabela,
-- que dá para ajustar na proposta; o nome fica guardado como estava).
CREATE TABLE br_offer_papers (
  id TEXT PRIMARY KEY,
  offer_id TEXT NOT NULL REFERENCES br_offers(id),
  seq INTEGER NOT NULL,
  part TEXT NOT NULL CHECK (part IN ('capa', 'miolo', 'outro')),
  paper_id TEXT REFERENCES papers(id),
  paper_name TEXT NOT NULL,
  grams INTEGER NOT NULL CHECK (grams > 0),
  price_per_kg_e4 INTEGER NOT NULL CHECK (price_per_kg_e4 > 0)
);
CREATE INDEX br_offer_papers_offer ON br_offer_papers (offer_id);

-- O PDF da proposta, em partes de 1 MB em base64, como os arquivos do embarque.
CREATE TABLE br_offer_documents (
  id TEXT PRIMARY KEY,
  offer_id TEXT NOT NULL UNIQUE REFERENCES br_offers(id),
  name TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id)
);
CREATE TABLE br_offer_document_parts (
  document_id TEXT NOT NULL REFERENCES br_offer_documents(id),
  seq INTEGER NOT NULL,
  data TEXT NOT NULL,
  PRIMARY KEY (document_id, seq)
);

-- O pedido fechado com a gráfica: um por orçamento, com o que a gráfica cobra e o papel nosso, em centavos.
CREATE TABLE br_orders (
  id TEXT PRIMARY KEY,
  quote_id TEXT REFERENCES br_quotes(id),
  offer_id TEXT REFERENCES br_offers(id),
  printer_id TEXT NOT NULL REFERENCES printers(id),
  title TEXT NOT NULL,
  isbn TEXT,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  printer_cents INTEGER NOT NULL CHECK (printer_cents >= 0),
  paper_cents INTEGER NOT NULL DEFAULT 0 CHECK (paper_cents >= 0),
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
