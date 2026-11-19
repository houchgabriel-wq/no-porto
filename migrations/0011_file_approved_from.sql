-- Ligação com o No Prelo (decidida pelo Gabriel em 19/11/2026): a aprovação do arquivo de um item pode
-- vir da "Data de aprovação" da gráfica no No Prelo, pelo ISBN e pela PO (a ordem de impressão de lá).
-- Esta coluna diz de onde veio a data: 'noprelo', ou NULL quando foi digitada ou veio de planilha.
-- Enquanto vem do No Prelo, ela só muda lá.
ALTER TABLE order_items ADD COLUMN file_approved_from TEXT;
