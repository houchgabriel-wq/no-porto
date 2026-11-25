-- Unidades do BL (pedido do Gabriel em 25/11/2026): o transporte do porto até o estoque é agendado por
-- unidade (container). Cada invoice guarda a unidade em que veio, lida do BL e ligada pela packing list.
ALTER TABLE invoices ADD COLUMN container TEXT NOT NULL DEFAULT '';        -- número do container (YMLU5432079)
ALTER TABLE invoices ADD COLUMN container_seal TEXT NOT NULL DEFAULT '';   -- lacre
ALTER TABLE invoices ADD COLUMN container_kind TEXT NOT NULL DEFAULT '';   -- tipo, como no BL (40NOR, 40HC)
ALTER TABLE invoices ADD COLUMN container_cartons INTEGER;                 -- caixas
ALTER TABLE invoices ADD COLUMN container_weight_grams INTEGER;            -- peso bruto, em gramas
ALTER TABLE invoices ADD COLUMN container_volume_liters INTEGER;           -- cubagem, em litros (m³ × 1000)

-- O Novo embarque guardava o container nas observações ("Container YMLU5449045"): ele passa para o campo,
-- e a observação que era só isso fica vazia. (O D1 só aceita padrões de GLOB de até 50 bytes.)
UPDATE invoices SET container = substr(notes, 11, 11)
 WHERE container = '' AND substr(notes, 1, 10) = 'Container '
   AND substr(notes, 11, 4) GLOB '[A-Z][A-Z][A-Z][A-Z]'
   AND substr(notes, 15, 7) GLOB '[0-9][0-9][0-9][0-9][0-9][0-9][0-9]'
   AND (length(notes) = 21 OR substr(notes, 22, 1) NOT GLOB '[0-9A-Za-z]');
UPDATE invoices SET notes = '' WHERE container <> '' AND notes = 'Container ' || container;
