-- A packing list de cada container (pedido do Gabriel em 26/11/2026): ela dá as peças por caixa de cada
-- item, que o No Estoque usa para montar a entrada. Fica anotado o arquivo, quando e quem registrou; as
-- invoices anteriores ficam sem a anotação (não se sabe se tiveram packing list).
ALTER TABLE invoices ADD COLUMN packing_list_name TEXT NOT NULL DEFAULT '';
ALTER TABLE invoices ADD COLUMN packing_list_at TEXT;
ALTER TABLE invoices ADD COLUMN packing_list_by TEXT REFERENCES users(id);
