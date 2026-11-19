-- Data de aprovação do arquivo e programação de envio de cada item (pedidos do Gabriel em 19/11/2026).
-- A aprovação é um dia (AAAA-MM-DD). A programação são até três embarques, cada um com o mês e a
-- quantidade, guardados como lista JSON: [{"month":"2026-12","quantity":20000}, ...]. Quando parte do
-- item embarca, a parte embarcada leva o que estava programado para antes.
ALTER TABLE order_items ADD COLUMN file_approved_at TEXT;
ALTER TABLE order_items ADD COLUMN ship_plan TEXT NOT NULL DEFAULT '[]';
