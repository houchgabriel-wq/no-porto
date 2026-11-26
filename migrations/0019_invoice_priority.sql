-- Prioridade de cada container no desembaraço e no transporte do porto até o estoque (pedido do Gabriel em
-- 26/11/2026): quando e quem marcou. Sem a marca (as invoices de antes), o container segue a ordem de sempre.
ALTER TABLE invoices ADD COLUMN priority_at TEXT;
ALTER TABLE invoices ADD COLUMN priority_by TEXT REFERENCES users(id);
