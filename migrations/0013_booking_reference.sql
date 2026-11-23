-- Número de referência da solicitação de embarque (pedido do Gabriel em 23/11/2026): quem preenche é o
-- agente de cargas, obrigatório nas solicitações novas; o agente corrige nas dele, e admin e editor em
-- qualquer uma. As que já existem ficam sem número até alguém preencher na ficha.
ALTER TABLE booking_requests ADD COLUMN reference TEXT NOT NULL DEFAULT '';
