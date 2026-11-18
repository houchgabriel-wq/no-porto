-- Especificação do produto (SPEC.md, seção 3; pedido do Gabriel em 18/11/2026): o texto da coluna
-- "Specifications" da PO (formato, papel, acabamento), guardado em cada item, como foi pedido naquela
-- compra. A ficha do produto mostra a última especificação de verdade (as reimpressões dizem só
-- "REPRINT — same specs as last order").
ALTER TABLE order_items ADD COLUMN specification TEXT NOT NULL DEFAULT '';
