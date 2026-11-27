// Ligação com o No Estoque (decidida pelo Gabriel em 24/11/2026; SPEC.md, seção 8): o No Estoque, que
// cuida do estoque físico de Jandira, busca aqui os containers para montar as entradas previstas: os em
// liberação, como na tela Embarques (pedido do Gabriel em 26/11/2026), e os que chegaram a partir do dia
// pedido (para o container que chega não sumir de lá antes de ser guardado). Cada invoice vai com a
// previsão, a chegada, o container (a unidade do BL, com as caixas, o peso e o volume) e os itens da
// packing list (código de barras, título, quantidade e peças por caixa). Sem preço nem total: nada de
// valores sai pela ligação, a não ser os arquivos da nota fiscal (pedido do Gabriel em 27/11/2026): a nota
// do container e a master do BL vão com o nome e o que o No Porto leu do XML, e o No Estoque busca o PDF e
// o XML inteiros, porque lê os dois por completo.

import { keyNumber, keySeries } from './nfe';
import { toIsbn13 } from './isbn';
import { arrivalState } from './shipments';

/** Uma chegada como o No Estoque recebe: uma invoice (um container). */
export interface StockArrival {
  /** A invoice no No Porto. */
  id: string;
  /** Dia da chegada (AAAA-MM-DD): o da invoice ou, sem ele, o do BL; null em liberação. */
  arrivedAt: string | null;
  /** Chegada prevista: a do BL ou, sem BL, a da invoice (como em arrivalOf). */
  eta: string | null;
  supplier: string;
  invoice: string;
  ref: string;
  bill: string | null;
  /** Número do container (a unidade do BL); vazio quando não informado. */
  container: string;
  containerKind: string;
  cartons: number | null;
  /** Peso bruto do container, em gramas (a unidade do BL). */
  weightGrams: number | null;
  /** Cubagem do container, em litros (m³ × 1000). */
  volumeLiters: number | null;
  items: StockArrivalItem[];
  /** A nota fiscal do container (desde 27/11/2026); null sem o PDF e sem o XML. */
  fiscalNote: StockFiscalNote | null;
  /** A nota master do BL, com o embarque todo (o BL com mais de um container); null sem ela. */
  masterFiscalNote: StockFiscalNote | null;
}

/** Uma nota fiscal: o PDF (o DANFE) e o XML da NF-e, com o que o No Porto leu deles. */
export interface StockFiscalNote {
  /** A chave de acesso (44 dígitos): a do XML ou, sem ele, a lida no PDF; null quando não se sabe. */
  key: string | null;
  /** O número da nota, sem os zeros à esquerda: o do XML ou, sem ele, o da chave. */
  number: string | null;
  /** A série: a do XML ou, sem ele, a da chave. */
  series: string | null;
  /** O dia da emissão (AAAA-MM-DD), do XML. */
  issuedAt: string | null;
  pdf: StockFiscalFile | null;
  xml: StockFiscalFile | null;
}

/** Um arquivo da nota, sem o conteúdo: o No Estoque busca o arquivo inteiro com fiscalFile(id). */
export interface StockFiscalFile {
  /** O arquivo no No Porto. Muda quando o arquivo é trocado. */
  id: string;
  name: string;
  /** application/pdf ou application/xml. */
  contentType: string;
  /** O tamanho, em bytes. */
  size: number;
}

/** O arquivo inteiro da nota, que a porta entrega em fiscalFile(id). */
export interface StockFiscalFileContent extends StockFiscalFile {
  data: Uint8Array;
}

export interface StockArrivalItem {
  /** O código de barras: o ISBN-13, sem hífens (o ISBN-10 vira ISBN-13); null sem ISBN. */
  barcode: string | null;
  title: string;
  quantity: number;
  piecesPerCarton: number | null;
}

/** Uma invoice em liberação ou que chegou, como sai do banco. */
export interface ArrivedInvoice {
  id: string;
  number: string;
  ref: string;
  supplier: string | null;
  /** O BL: o id (para a nota master) e o número. */
  billId: string | null;
  bill: string | null;
  eta: string | null;
  arrivedAt: string | null;
  container: string;
  containerKind: string;
  cartons: number | null;
  weightGrams: number | null;
  volumeLiters: number | null;
}

/**
 * Vai para o No Estoque: o container em liberação (a previsão passou e a chegada não foi registrada,
 * pela mesma regra da tela Embarques) e o que chegou a partir do dia pedido.
 */
export function forStock(v: Pick<ArrivedInvoice, 'eta' | 'arrivedAt'>, since: string, today: string): boolean {
  const state = arrivalState(v.eta, v.arrivedAt, today);
  return state.kind === 'liberacao' || (state.kind === 'chegou' && state.on >= since);
}

/** Um item de uma invoice que chegou, como sai do banco. */
export interface ArrivedItem {
  invoiceId: string;
  isbn: string | null;
  title: string;
  description: string;
  quantity: number;
  piecesPerCarton: number | null;
}

/** Um arquivo da nota fiscal, como sai do banco: o do container (invoiceId) ou o da master (billId). */
export interface ArrivedFiscalFile {
  id: string;
  invoiceId: string | null;
  billId: string | null;
  kind: 'pdf' | 'xml';
  name: string;
  contentType: string;
  size: number;
  key: string | null;
  number: string | null;
  series: string | null;
  issuedAt: string | null;
}

/** A nota com os seus arquivos (o PDF e o XML); null sem nenhum. */
function stockNote(files: readonly ArrivedFiscalFile[]): StockFiscalNote | null {
  const pdf = files.find((f) => f.kind === 'pdf');
  const xml = files.find((f) => f.kind === 'xml');
  if (!pdf && !xml) return null;
  const file = (f: ArrivedFiscalFile | undefined): StockFiscalFile | null => (f ? { id: f.id, name: f.name, contentType: f.contentType, size: f.size } : null);
  const key = xml?.key ?? pdf?.key ?? null;
  return {
    key,
    number: xml?.number ?? (key ? keyNumber(key) : null),
    series: xml?.series ?? (key ? keySeries(key) : null),
    issuedAt: xml?.issuedAt ?? null,
    pdf: file(pdf),
    xml: file(xml),
  };
}

/** As chegadas, na ordem das invoices, cada uma com os seus itens, a nota do container e a master do BL. */
export function stockArrivals(invoices: readonly ArrivedInvoice[], items: readonly ArrivedItem[], fiscal: readonly ArrivedFiscalFile[] = []): StockArrival[] {
  const byInvoice = new Map<string, StockArrivalItem[]>();
  for (const i of items) {
    const list = byInvoice.get(i.invoiceId) ?? [];
    list.push({
      barcode: i.isbn?.trim() ? toIsbn13(i.isbn) : null,
      title: i.title.trim() || i.description.trim(),
      quantity: i.quantity,
      piecesPerCarton: i.piecesPerCarton && i.piecesPerCarton > 0 ? i.piecesPerCarton : null,
    });
    byInvoice.set(i.invoiceId, list);
  }
  return invoices.map((v) => ({
    id: v.id,
    arrivedAt: v.arrivedAt,
    eta: v.eta,
    supplier: v.supplier ?? '',
    invoice: v.number,
    ref: v.ref,
    bill: v.bill,
    container: v.container,
    containerKind: v.containerKind,
    cartons: v.cartons,
    weightGrams: v.weightGrams,
    volumeLiters: v.volumeLiters,
    items: byInvoice.get(v.id) ?? [],
    fiscalNote: stockNote(fiscal.filter((f) => f.invoiceId === v.id)),
    masterFiscalNote: v.billId ? stockNote(fiscal.filter((f) => f.billId === v.billId)) : null,
  }));
}
