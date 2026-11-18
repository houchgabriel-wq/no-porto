// Cópia completa (SPEC.md, seção 5): tudo o que está no sistema, nas mesmas abas e colunas da
// planilha status_importações (Produção, Embarques e Entregues), para guardar fora da Cloudflare e,
// se preciso, voltar pela própria carga do sistema.

import { invoiceTotal, paymentSummary, type Bill, type Invoice, type Payment } from './shipments';
import type { Item, PurchaseOrder, Supplier } from './items';

/** Célula da cópia: texto, número, data (AAAA-MM-DD, vira data no Excel) ou vazio. */
export type CopyCell = string | number | { date: string } | null;

// A última coluna, Especificação, não existe na status_importações: guarda a especificação do produto
// e volta pela carga.
export const PRODUCTION_HEADER = ['', 'Produto', 'ISBN', 'pcs/ctn', 'Quantidade', '$ unitário', '$ total', 'Fornecedor', 'Embarque', 'Pagamento', '', 'Observações', 'Especificação'];
export const SHIPMENTS_HEADER = ['Ref. embarque', 'Produto', 'ISBN', 'pcs/ctn', 'Quantidade', '$ unitário', '$ total', 'Fornecedor', 'Chegada', 'Pagamento', 'Invoice', 'BL', 'Observações', 'Especificação'];
export const DELIVERED_HEADER = ['Ref. embarque', 'Produto', 'ISBN', 'pcs/ctn', 'Quantidade', '$ unitário', '$ total', 'Fornecedor', 'Chegada na editora', 'Pagamento', 'Invoice', 'BL', 'Observações', 'Especificação'];

export interface CopyInput {
  items: readonly Item[];
  invoices: readonly Invoice[];
  bills: readonly Bill[];
  payments: readonly Payment[];
  orders: readonly PurchaseOrder[];
  suppliers: readonly Supplier[];
}

export interface CopySheets {
  production: CopyCell[][];
  shipments: CopyCell[][];
  delivered: CopyCell[][];
}

const dollars = (micros: number | null | undefined) => (micros == null ? null : micros / 1_000_000);
const cents = (c: number | null | undefined) => (c == null ? null : c / 100);

/** Monta as linhas das três abas, na ordem da planilha (POs; embarques por invoice; entregues por chegada). */
/** `seeValues` falso (o leitor): a coluna do pagamento sai vazia, porque ele não recebe os pagamentos. */
export function copySheets(input: CopyInput, seeValues = true): CopySheets {
  const supplierName = new Map(input.suppliers.map((s) => [s.id, s.name]));
  const orderCode = new Map(input.orders.map((o) => [o.id, o.code]));
  const invoices = new Map(input.invoices.map((v) => [v.id, v]));
  const bills = new Map(input.bills.map((b) => [b.id, b]));
  const byInvoice = new Map<string, Item[]>();
  for (const item of input.items) if (item.invoiceId) byInvoice.set(item.invoiceId, [...(byInvoice.get(item.invoiceId) ?? []), item]);
  const paymentText = (invoiceId: string) => {
    if (!seeValues) return null;
    const status = paymentSummary(
      invoiceTotal(byInvoice.get(invoiceId) ?? []),
      input.payments.filter((p) => p.invoiceId === invoiceId),
    ).status;
    // "Pago" volta como pago na carga; o parcial fica escrito de outro jeito para não virar pago.
    return status === 'pago' ? 'Pago' : status === 'parcial' ? 'Parcial' : 'A pagar';
  };
  const common = (i: Item): CopyCell[] => [
    i.description,
    i.isbn,
    i.piecesPerCarton,
    i.quantity,
    dollars(i.unitPriceMicros),
    cents(i.totalCents ?? (i.unitPriceMicros == null ? null : Math.round((i.quantity * i.unitPriceMicros) / 10_000))),
    i.supplierId ? (supplierName.get(i.supplierId) ?? '') : '',
  ];

  const production = input.items
    .filter((i) => i.status === 'producao')
    .sort((a, b) => (orderCode.get(a.purchaseOrderId ?? '') ?? 'ZZZ').localeCompare(orderCode.get(b.purchaseOrderId ?? '') ?? 'ZZZ', 'pt-BR', { numeric: true }))
    .map((i): CopyCell[] => ['-', ...common(i), 'Em produção', 'Não Pago', i.purchaseOrderId ? (orderCode.get(i.purchaseOrderId) ?? '') : '', i.notes || null, i.specification || null]);

  const shipRow = (i: Item, date: string | null): CopyCell[] => {
    const v = invoices.get(i.invoiceId!)!;
    const bill = v.billId ? bills.get(v.billId) : undefined;
    return [v.ref || v.number, ...common(i), date ? { date } : null, paymentText(v.id), v.number, bill?.number ?? null, [v.notes, i.notes].filter(Boolean).join(' · ') || null, i.specification || null];
  };
  const arrival = (v: Invoice) => {
    const bill = v.billId ? bills.get(v.billId) : undefined;
    return { eta: bill ? bill.eta : v.eta, arrivedAt: v.arrivedAt ?? bill?.arrivedAt ?? null };
  };
  const withInvoice = input.items.filter((i) => i.invoiceId && invoices.has(i.invoiceId));
  const shipments = withInvoice
    .filter((i) => i.status === 'embarcado')
    .sort((a, b) => (arrival(invoices.get(a.invoiceId!)!).eta ?? '').localeCompare(arrival(invoices.get(b.invoiceId!)!).eta ?? '') || a.invoiceId!.localeCompare(b.invoiceId!))
    .map((i) => shipRow(i, arrival(invoices.get(i.invoiceId!)!).eta));
  const delivered = withInvoice
    .filter((i) => i.status === 'entregue')
    .sort((a, b) => (arrival(invoices.get(a.invoiceId!)!).arrivedAt ?? '9999').localeCompare(arrival(invoices.get(b.invoiceId!)!).arrivedAt ?? '9999') || a.invoiceId!.localeCompare(b.invoiceId!))
    .map((i) => shipRow(i, arrival(invoices.get(i.invoiceId!)!).arrivedAt));
  return { production, shipments, delivered };
}
