-- Previsão de estoque (pedido do Gabriel em 20/11/2026): a curva ABC carregada por último, inteira. Cada
-- carga substitui a anterior. Os títulos ficam juntos, em JSON (o código de barras, o nome, o código do
-- produto, a classe, o estoque e as vendas de 1, 3, 6, 9 e 12 meses), porque a curva só é lida inteira:
-- a previsão é calculada a cada consulta, com o que está embarcado e em produção naquele momento.
CREATE TABLE stock_curves (
  id TEXT PRIMARY KEY,
  stock_date TEXT NOT NULL,          -- data do estoque (AAAA-MM-DD), informada na carga
  file_name TEXT NOT NULL DEFAULT '',
  row_count INTEGER NOT NULL,
  rows_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id)
);
