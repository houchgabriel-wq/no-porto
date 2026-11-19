-- Data de aprovação do arquivo e programação de envio de cada item (pedido do Gabriel em 19/11/2026):
-- duas datas (AAAA-MM-DD), vazias até alguém preencher na ficha do item. A parte que embarca leva as
-- duas datas do item, como a especificação.
ALTER TABLE order_items ADD COLUMN file_approved_at TEXT;
ALTER TABLE order_items ADD COLUMN ship_planned_at TEXT;
