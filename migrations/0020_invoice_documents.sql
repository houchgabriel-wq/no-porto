-- Os arquivos de cada container (pedido do Gabriel em 27/11/2026): a invoice e a packing list, guardadas
-- como o arquivo do BL (no próprio banco, em partes de até 1 MB, em base64; no máximo 5 MB), para baixar
-- quando precisar. Um arquivo de cada tipo por invoice: anexar de novo substitui.
CREATE TABLE invoice_documents (
  id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL REFERENCES invoices(id),
  kind TEXT NOT NULL CHECK (kind IN ('invoice', 'packing')),
  name TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id),
  UNIQUE (invoice_id, kind)
);

CREATE TABLE invoice_document_parts (
  document_id TEXT NOT NULL REFERENCES invoice_documents(id),
  seq INTEGER NOT NULL,
  data TEXT NOT NULL,
  PRIMARY KEY (document_id, seq)
);
