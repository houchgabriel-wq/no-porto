-- Arquivo do BL (SPEC.md, seção 3): o PDF ou a imagem do BL, anexado no novo embarque ou depois, na
-- ficha do embarque. Fica no próprio banco, em partes de até 1 MB (em base64), porque o D1 limita o
-- tamanho de cada valor; o arquivo tem no máximo 5 MB. Um arquivo por BL: anexar de novo substitui.
CREATE TABLE bill_documents (
  id TEXT PRIMARY KEY,
  bill_of_lading_id TEXT NOT NULL UNIQUE REFERENCES bills_of_lading(id),
  name TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id)
);

CREATE TABLE bill_document_parts (
  document_id TEXT NOT NULL REFERENCES bill_documents(id),
  seq INTEGER NOT NULL,
  data TEXT NOT NULL,
  PRIMARY KEY (document_id, seq)
);
