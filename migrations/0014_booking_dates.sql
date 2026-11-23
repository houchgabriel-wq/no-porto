-- Prontidão do container e previsão de chegada da solicitação de embarque (pedido do Gabriel em
-- 23/11/2026): o agente informa as duas ao pedir (obrigatórias nas solicitações novas) e corrige depois,
-- como o número de referência. As solicitações que já existem ficam sem as datas até alguém preencher.
ALTER TABLE booking_requests ADD COLUMN ready_date TEXT;     -- prontidão do container (AAAA-MM-DD)
ALTER TABLE booking_requests ADD COLUMN arrival_date TEXT;   -- previsão de chegada (AAAA-MM-DD)
