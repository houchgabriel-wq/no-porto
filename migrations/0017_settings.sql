-- Configurações da editora, uma linha por chave. A primeira é o prazo, em dias, da data do BL até a
-- chegada prevista (pedido do Gabriel em 26/11/2026): 35 por padrão, que vale enquanto não há a linha.
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL REFERENCES users(id)
);
