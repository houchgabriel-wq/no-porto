-- A nota fiscal do embarque (pedido do Gabriel em 27/11/2026; SPEC.md, seção 3): o PDF (o DANFE) e o XML da NF-e,
-- guardados como os outros arquivos do embarque (no próprio banco, em partes de até 1 MB, em base64; no máximo
-- 5 MB). Cada container tem a sua nota (as "filhotes"); quando o BL tem mais de um container, há também a nota
-- master, com o embarque todo, que fica no BL. Um PDF e um XML de cada: anexar de novo substitui. Os arquivos vão
-- inteiros para o No Estoque, que lê os dois.
-- Só acrescenta: o código que estava no ar continua funcionando até o novo subir.
CREATE TABLE fiscal_documents (
  id TEXT PRIMARY KEY,
  -- A nota do container (a invoice) ou a master (o BL): uma das duas.
  invoice_id TEXT REFERENCES invoices(id),
  bill_of_lading_id TEXT REFERENCES bills_of_lading(id),
  kind TEXT NOT NULL CHECK (kind IN ('pdf', 'xml')),
  name TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size INTEGER NOT NULL,
  -- A chave de acesso: a do XML, lida pelo servidor, ou a impressa no PDF, lida pelo navegador (vazia quando não
  -- deu para ler). O número, a série, o dia da emissão e a situação (autorizada, sem_protocolo, nao_autorizada ou
  -- homologacao) são do XML; no PDF, ficam vazios.
  nfe_key TEXT,
  nfe_number TEXT,
  nfe_series TEXT,
  nfe_issued_at TEXT,
  nfe_status TEXT,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id),
  CHECK ((invoice_id IS NULL) <> (bill_of_lading_id IS NULL)),
  UNIQUE (invoice_id, kind),
  UNIQUE (bill_of_lading_id, kind)
);

CREATE TABLE fiscal_document_parts (
  document_id TEXT NOT NULL REFERENCES fiscal_documents(id),
  seq INTEGER NOT NULL,
  data TEXT NOT NULL,
  PRIMARY KEY (document_id, seq)
);
