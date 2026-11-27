-- Orçamento com vários produtos (pedido do Gabriel em 27/11/2026; SPEC.md, seção 3): o orçamento passa a ter um ou mais
-- produtos (cada ISBN, como o box e os 3 livros que vão dentro dele, e o avulso); os itens e o papel da proposta se ligam
-- a eles, o pedido guarda os produtos com a quantidade e o custo de cada um, e as entregas são de cada produto.
-- Só acrescenta: o código que estava no ar continua funcionando até o novo subir. O que já existe vira um produto só:
-- cada orçamento, com o produto dele; cada pedido, com o produto dele; e as entregas ficam com esse produto.

CREATE TABLE br_quote_products (
  id TEXT PRIMARY KEY,
  quote_id TEXT NOT NULL REFERENCES br_quotes(id),
  seq INTEGER NOT NULL,
  title TEXT NOT NULL,
  isbn TEXT,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  -- Vai dentro do box: não conta no estoque do livro nem tem entrega própria.
  in_box INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX br_quote_products_quote ON br_quote_products (quote_id);
INSERT INTO br_quote_products (id, quote_id, seq, title, isbn, quantity, in_box)
  SELECT id || '-p1', id, 0, title, isbn, quantity, 0 FROM br_quotes;

-- O item da proposta cobra um produto do orçamento e traz a especificação que a gráfica escreveu.
ALTER TABLE br_offer_items ADD COLUMN product_id TEXT REFERENCES br_quote_products(id);
ALTER TABLE br_offer_items ADD COLUMN specification TEXT NOT NULL DEFAULT '';
UPDATE br_offer_items SET product_id = (SELECT o.quote_id || '-p1' FROM br_offers o WHERE o.id = br_offer_items.offer_id);

-- O papel nosso pode ser de um produto; sem produto, é da proposta toda.
ALTER TABLE br_offer_papers ADD COLUMN product_id TEXT REFERENCES br_quote_products(id);

-- Os produtos do pedido: a quantidade da proposta escolhida e o custo de cada um (itens e papel nosso), em centavos.
CREATE TABLE br_order_products (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES br_orders(id),
  product_id TEXT REFERENCES br_quote_products(id),
  seq INTEGER NOT NULL,
  title TEXT NOT NULL,
  isbn TEXT,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  in_box INTEGER NOT NULL DEFAULT 0,
  cost_cents INTEGER NOT NULL DEFAULT 0 CHECK (cost_cents >= 0)
);
CREATE INDEX br_order_products_order ON br_order_products (order_id);
INSERT INTO br_order_products (id, order_id, product_id, seq, title, isbn, quantity, in_box, cost_cents)
  SELECT id || '-p1', id, CASE WHEN quote_id IS NULL THEN NULL ELSE quote_id || '-p1' END, 0, title, isbn, quantity, 0, printer_cents + paper_cents
    FROM br_orders;

-- A entrega é de um produto do pedido; as registradas juntas (o kit e o avulso no mesmo dia) têm o mesmo grupo.
ALTER TABLE br_deliveries ADD COLUMN product_id TEXT REFERENCES br_order_products(id);
ALTER TABLE br_deliveries ADD COLUMN group_id TEXT;
UPDATE br_deliveries SET product_id = order_id || '-p1', group_id = id;
