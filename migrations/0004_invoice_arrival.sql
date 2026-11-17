-- Chegada na invoice sem BL (SPEC.md, seção 3). Na planilha, as invoices 108 e 101 do Kaushik não
-- têm BL, mas têm chegada prevista. Quando a invoice está num BL, valem a chegada prevista e a
-- chegada real do BL; estas colunas só contam para invoice sem BL.
ALTER TABLE invoices ADD COLUMN eta TEXT;
ALTER TABLE invoices ADD COLUMN arrived_at TEXT;
CREATE INDEX invoices_number ON invoices(number COLLATE NOCASE);
