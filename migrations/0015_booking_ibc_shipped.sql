-- Solicitações de embarque (pedidos do Gabriel em 23/11/2026): a referência IBC, opcional, embaixo do
-- número de referência; e quando a solicitação aprovada embarcou (marcado pelo agente, por admin ou por
-- editor), que a leva da aba Pré-embarque para a Pós-embarque.
ALTER TABLE booking_requests ADD COLUMN ibc_reference TEXT NOT NULL DEFAULT '';
ALTER TABLE booking_requests ADD COLUMN shipped_at TEXT;                        -- dia em que embarcou (AAAA-MM-DD)
ALTER TABLE booking_requests ADD COLUMN shipped_by TEXT REFERENCES users(id);   -- quem marcou
