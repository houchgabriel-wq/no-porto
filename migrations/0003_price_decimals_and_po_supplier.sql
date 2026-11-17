-- Decisões do Gabriel em 17/11/2026 (SPEC.md, seção 2), aplicadas aos itens já cadastrados:
-- 1. O preço unitário tem no máximo três casas decimais: arredonda (meio para cima) o que tem mais.
-- 2. Uma PO tem um fornecedor só: o dono da PO é o fornecedor com mais itens nela (no empate, o do item
--    cadastrado primeiro); os itens de outro fornecedor saem da PO e ficam "Sem PO", com a PO original
--    nas observações, para alguém acertar o número.
-- Cada mudança entra no histórico do item em nome do primeiro admin.

-- 1. Preço com três casas
INSERT INTO events (id, entity, entity_id, user_id, type, detail, created_at)
SELECT lower(hex(randomblob(16))), 'item', i.id, a.id, 'changed',
       json_object('changes', json_array(json_object('field', 'Preço unitário', 'from', i.unit_price_micros, 'to', ((i.unit_price_micros + 500) / 1000) * 1000)),
                   'reason', 'Preço com no máximo três casas decimais'),
       strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  FROM order_items i
  JOIN (SELECT id FROM users WHERE role = 'admin' ORDER BY created_at LIMIT 1) a
 WHERE i.unit_price_micros IS NOT NULL AND i.unit_price_micros % 1000 <> 0;

UPDATE order_items
   SET unit_price_micros = ((unit_price_micros + 500) / 1000) * 1000
 WHERE unit_price_micros IS NOT NULL AND unit_price_micros % 1000 <> 0;

-- 2. Uma PO, um fornecedor
CREATE TABLE _po_owner AS
WITH counts AS (
  SELECT purchase_order_id AS po, supplier_id AS s, COUNT(*) AS n, MIN(created_at || printf('%012d', rowid)) AS first
    FROM order_items
   WHERE deleted_at IS NULL AND purchase_order_id IS NOT NULL AND supplier_id IS NOT NULL
   GROUP BY purchase_order_id, supplier_id
)
SELECT c.po, c.s
  FROM counts c
 WHERE NOT EXISTS (SELECT 1 FROM counts d WHERE d.po = c.po AND (d.n > c.n OR (d.n = c.n AND d.first < c.first)));

CREATE TABLE _moved AS
SELECT i.id, o.code, s.name AS owner
  FROM order_items i
  JOIN _po_owner w ON w.po = i.purchase_order_id
  JOIN purchase_orders o ON o.id = i.purchase_order_id
  JOIN suppliers s ON s.id = w.s
 WHERE i.deleted_at IS NULL AND i.supplier_id IS NOT NULL AND i.supplier_id <> w.s;

INSERT INTO events (id, entity, entity_id, user_id, type, detail, created_at)
SELECT lower(hex(randomblob(16))), 'item', m.id, a.id, 'changed',
       json_object('changes', json_array(json_object('field', 'PO', 'from', m.code, 'to', NULL)),
                   'reason', 'A ' || m.code || ' é de ' || m.owner || '; uma PO tem um fornecedor só'),
       strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  FROM _moved m
  JOIN (SELECT id FROM users WHERE role = 'admin' ORDER BY created_at LIMIT 1) a;

UPDATE order_items
   SET notes = CASE WHEN notes = '' THEN '' ELSE notes || char(10) END
               || 'PO na planilha: ' || (SELECT code FROM _moved m WHERE m.id = order_items.id)
               || ' (a PO é de ' || (SELECT owner FROM _moved m WHERE m.id = order_items.id) || ')',
       purchase_order_id = NULL,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
 WHERE id IN (SELECT id FROM _moved);

DROP TABLE _moved;
DROP TABLE _po_owner;
