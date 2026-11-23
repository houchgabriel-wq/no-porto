// Chamadas à API. Erros viram ApiError com a mensagem em português vinda do servidor.

import type { DocumentLine } from '../core/documents';
import type { SalesArrival } from '../core/shippedItems';
import type { ImportedItem } from '../core/importProduction';
import type { ImportedShipmentItem } from '../core/importShipments';
import type { ImportedHistoryItem } from '../core/importHistory';
import type { InvoiceInfo } from '../core/history';
import type { Amount, SupplierSummary } from '../core/suppliers';
import type { CopyInput } from '../core/fullCopy';
import type { Bill, Invoice, Payment } from '../core/shipments';
import type { Item, PurchaseOrder, Supplier } from '../core/items';
import type { Role } from '../core/roles';
import type { BookingRequest, ContainerType, NewBookingLine } from '../core/bookings';
import type { ShipPlan } from '../core/shipPlan';
import type { SheetUpdate } from '../core/updateSheet';
import type { ProductSummary } from '../core/productLookup';
import type { CurveInfo, CurveRow } from '../core/stockCurve';
import type { ForecastSummary, TitleHolding } from '../core/stockForecast';

export interface Me {
  id: string;
  name: string;
  email: string;
  role: Role;
  mustChangePassword: boolean;
  /** Aprova as solicitações de embarque (o Gabriel). */
  approvesBookings: boolean;
}

/** A aba Previsão de estoque: a curva carregada e o que o No Porto tem de cada título (a tela calcula). */
export interface StockData {
  today: string;
  curve: CurveInfo | null;
  rows: CurveRow[];
  holdings: TitleHolding[];
}

export interface UserSummary {
  id: string;
  name: string;
  email: string;
  role: Role;
  mustChangePassword: boolean;
  active: boolean;
  createdAt: string;
  lastLoginAt: string | null;
  approvesBookings: boolean;
}

/** Solicitações de embarque (GET /api/bookings): o Agente recebe só as dele; a equipe, todas. */
export interface BookingsData {
  /** Hoje (AAAA-MM-DD) no fuso de São Paulo, calculado no servidor. */
  today: string;
  requests: BookingRequest[];
  /** Só id e nome, para o formulário do agente. */
  suppliers: Supplier[];
  /** Quem vê pode aprovar e recusar (o Gabriel). */
  canDecide: boolean;
}

export interface NewBooking {
  /** Número de referência, dado pelo agente (obrigatório: 23/11/2026). */
  reference: string;
  /** Referência IBC, opcional (23/11/2026). */
  ibcReference: string;
  /** Prontidão do container e previsão de chegada (AAAA-MM-DD), obrigatórias desde 23/11/2026. */
  readyDate: string;
  arrivalDate: string;
  supplierId: string;
  departurePort: string;
  departureDate: string;
  notes: string;
  lines: NewBookingLine[];
}

/** Tudo o que as telas usam (GET /api/data). */
export interface ProductionData {
  /** Hoje (AAAA-MM-DD) no fuso de São Paulo, calculado no servidor. */
  today: string;
  suppliers: Supplier[];
  orders: PurchaseOrder[];
  /** Em produção, embarcados e os que chegaram nos últimos 60 dias. */
  items: Item[];
  bills: Bill[];
  invoices: Invoice[];
  /** Vazio para quem não vê valores. */
  payments: Payment[];
  /** O perfil vê preços e valores? (o leitor não vê) */
  seeValues: boolean;
}

/** Campos de um item, como o formulário manda: fornecedor e PO pelo nome e código. */
export interface ItemInput {
  description: string;
  isbn: string | null;
  supplier: string | null;
  orderCode: string | null;
  quantity: number;
  piecesPerCarton: number | null;
  unitPriceMicros: number | null;
  notes: string;
  /** Especificação do produto nesta compra; ausente para não mexer na que existe. */
  specification?: string;
  /** Aprovação do arquivo (AAAA-MM-DD ou null). */
  fileApprovedAt?: string | null;
  /** Programação de envio: até três embarques (mês e quantidade). */
  shipPlan?: ShipPlan;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Avisado quando a sessão cai no meio do uso, para voltar à tela de entrada. */
let onUnauthorized: () => void = () => {};
export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: method === 'GET' ? {} : { 'content-type': 'application/json' },
      body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
    });
  } catch {
    throw new ApiError(0, 'Sem conexão com o servidor. Confira a internet e tente de novo.');
  }
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) {
    if (res.status === 401 && path !== '/api/login') onUnauthorized();
    throw new ApiError(res.status, data.error ?? 'Erro inesperado. Tente de novo.');
  }
  return data as T;
}

export const api = {
  setupStatus: () => request<{ available: boolean; configured: boolean }>('GET', '/api/setup'),
  setup: (body: { token: string; name: string; email: string; password: string }) =>
    request<{ user: Me }>('POST', '/api/setup', body),
  login: (email: string, password: string) => request<{ user: Me }>('POST', '/api/login', { email, password }),
  logout: () => request<{ ok: true }>('POST', '/api/logout'),
  me: () => request<{ user: Me }>('GET', '/api/me'),
  changePassword: (password: string, current?: string) =>
    request<{ user: Me }>('POST', '/api/password', { password, current }),
  users: () => request<{ users: UserSummary[] }>('GET', '/api/users'),
  createUser: (body: { name: string; email: string; role: Role }) =>
    request<{ user: UserSummary; tempPassword: string }>('POST', '/api/users', body),
  updateUser: (id: string, body: Partial<{ name: string; email: string; role: Role; active: boolean }>) =>
    request<{ user: UserSummary }>('PATCH', `/api/users/${encodeURIComponent(id)}`, body),
  resetPassword: (id: string) =>
    request<{ tempPassword: string }>('POST', `/api/users/${encodeURIComponent(id)}/reset-password`),
  production: () => request<ProductionData>('GET', '/api/data'),
  ship: (body: { lines: { itemId: string; quantity: number }[]; invoiceId?: string; newInvoice?: { number: string; ref: string; bill: string | null; eta: string | null } }) =>
    request<{ invoiceId: string; shipped: number }>('POST', '/api/ship', body),
  unship: (itemId: string) => request<{ ok: true }>('POST', `/api/items/${encodeURIComponent(itemId)}/unship`),
  updateBill: (id: string, body: Partial<{ number: string; eta: string | null; arrivedAt: string | null; notes: string }>) =>
    request<{ ok: true }>('PATCH', `/api/bills/${encodeURIComponent(id)}`, body),
  updateInvoice: (id: string, body: Partial<{ number: string; ref: string; bill: string | null; eta: string | null; arrivedAt: string | null; notes: string }>) =>
    request<{ ok: true }>('PATCH', `/api/invoices/${encodeURIComponent(id)}`, body),
  addPayment: (invoiceId: string, body: { paidAt: string | null; amountCents: number; exchangeRateE4: number | null; notes: string }) =>
    request<{ id: string }>('POST', `/api/invoices/${encodeURIComponent(invoiceId)}/payments`, body),
  deletePayment: (id: string) => request<{ ok: true }>('DELETE', `/api/payments/${encodeURIComponent(id)}`),
  createOrder: (body: { code: string; supplier: string; orderedAt: string | null; items: Omit<DocumentLine, 'orderCode'>[] }) =>
    request<{ orderId: string; inserted: number }>('POST', '/api/orders', body),
  receiveShipment: (body: { bill: string | null; eta: string | null; invoices: { supplierId: string; number: string; ref: string; container: string; lines: DocumentLine[] }[] }) =>
    request<{ billId: string | null; invoiceIds: string[]; taken: number; extra: number }>('POST', '/api/shipments', body),
  putBillDocument: (billId: string, body: { name: string; contentType: string; data: string }) =>
    request<{ document: { name: string; size: number } }>('PUT', `/api/bills/${encodeURIComponent(billId)}/document`, body),
  deleteBillDocument: (billId: string) => request<{ ok: true }>('DELETE', `/api/bills/${encodeURIComponent(billId)}/document`),
  deleteInvoice: (id: string) => request<{ back: number; merged: number; removed: number; billRemoved: boolean }>('DELETE', `/api/invoices/${encodeURIComponent(id)}`),
  deleteBill: (id: string) => request<{ back: number; merged: number; removed: number; invoices: number }>('DELETE', `/api/bills/${encodeURIComponent(id)}`),
  itemSpecification: (id: string) =>
    request<{ specification: string; latest: { specification: string; createdAt: string; orderCode: string | null } | null }>('GET', `/api/items/${encodeURIComponent(id)}/specification`),
  /** PO já cadastrada: guarda a especificação e a programação de envio do arquivo nos itens dela. */
  saveOrderDetails: (code: string, items: { description: string; isbn: string | null; quantity: number; specification: string; shipPlan: ShipPlan }[]) =>
    request<{ updated: number; items: number; planned: number; kept: number; notFit: number }>('POST', `/api/orders/${encodeURIComponent(code)}/specifications`, { items }),
  registerArrival: (invoiceIds: string[], arrivedAt: string) => request<{ invoices: number }>('POST', '/api/arrivals', { invoiceIds, arrivedAt }),
  reset: (confirm: string) => request<{ items: number }>('POST', '/api/reset', { confirm }),
  importShipments: (items: ImportedShipmentItem[]) => request<{ inserted: number; skipped: number }>('POST', '/api/import/shipments', { items }),
  sales: () => request<{ today: string; rows: SalesArrival[] }>('GET', '/api/sales'),
  history: () => request<{ items: Item[]; invoices: InvoiceInfo[]; suppliers: Supplier[]; seeValues: boolean }>('GET', '/api/history'),
  /** Terminal de consulta do painel: o resumo de cada produto (só quantidades). */
  lookup: () => request<{ products: ProductSummary[] }>('GET', '/api/lookup'),
  product: (id: string) =>
    request<{
      product: { id: string; isbn: string | null; title: string };
      items: Item[];
      invoices: InvoiceInfo[];
      orders: { id: string; code: string }[];
      specification: { specification: string; createdAt: string; orderCode: string | null } | null;
      seeValues: boolean;
    }>(
      'GET',
      `/api/products/${encodeURIComponent(id)}`,
    ),
  importHistory: (items: ImportedHistoryItem[]) => request<{ inserted: number; skipped: number }>('POST', '/api/import/history', { items }),
  suppliers: () => request<{ suppliers: SupplierSummary[]; seeValues: boolean }>('GET', '/api/suppliers'),
  /** Busca agora as aprovações do arquivo no No Prelo (admin). */
  syncNoPrelo: () => request<{ updated: number; approvals: number }>('POST', '/api/noprelo/sync'),
  /** O recebido no ano corrente, para o painel (admin, editor, Consulta e leitor). */
  received: () => request<{ year: string; amount: Amount; seeValues: boolean }>('GET', '/api/received'),
  fullCopy: () => request<CopyInput>('GET', '/api/export'),
  updateSupplier: (id: string, body: Partial<{ name: string; notes: string }>) =>
    request<{ supplier: { id: string; name: string; notes: string } }>('PATCH', `/api/suppliers/${encodeURIComponent(id)}`, body),
  mergeSupplier: (id: string, into: string) =>
    request<{ supplier: { id: string; name: string; notes: string }; moved: { items: number; invoices: number } }>('POST', `/api/suppliers/${encodeURIComponent(id)}/merge`, { into }),
  createItem: (body: ItemInput) => request<{ item: Item }>('POST', '/api/items', body),
  updateItem: (id: string, body: Partial<ItemInput>) => request<{ item: Item }>('PATCH', `/api/items/${encodeURIComponent(id)}`, body),
  deleteItem: (id: string) => request<{ ok: true }>('DELETE', `/api/items/${encodeURIComponent(id)}`),
  importProduction: (items: ImportedItem[]) => request<{ inserted: number; skipped: number; withoutOrder: string[] }>('POST', '/api/import/production', { items }),
  /** Atualizar pela planilha: os campos que mudaram em cada item, com a marca do download. */
  updateItemsFromSheet: (items: ({ id: string; row: number; marks: SheetUpdate['marks'] } & SheetUpdate['patch'])[]) =>
    request<{ updated: number; skipped: { row: number; message: string }[] }>('PATCH', '/api/items', { items }),
  /** Previsão de estoque (admin, editor, Consulta e leitor). */
  stock: () => request<StockData>('GET', '/api/stock'),
  /** Os números do cartão do painel. */
  stockSummary: () => request<{ today: string; curve: CurveInfo | null; summary: ForecastSummary | null }>('GET', '/api/stock/summary'),
  /** Carrega a curva ABC da semana (admin e editor); substitui a anterior. */
  loadStockCurve: (body: { stockDate: string; fileName: string; rows: CurveRow[] }) => request<{ stockDate: string; rowCount: number }>('POST', '/api/stock', body),
  bookings: () => request<BookingsData>('GET', '/api/bookings'),
  createBooking: (body: NewBooking) => request<{ request: BookingRequest }>('POST', '/api/bookings', body),
  cancelBooking: (id: string) => request<{ request: BookingRequest }>('POST', `/api/bookings/${encodeURIComponent(id)}/cancel`),
  /** Corrige o número de referência e as datas (o agente nas dele, admin e editor em qualquer uma). */
  updateBookingDetails: (id: string, body: Partial<{ reference: string; ibcReference: string; readyDate: string; arrivalDate: string }>) =>
    request<{ request: BookingRequest }>('PATCH', `/api/bookings/${encodeURIComponent(id)}`, body),
  /** Marca que a solicitação aprovada embarcou (ou desfaz): ela muda de aba, entre Pré e Pós-embarque. */
  markBookingShipped: (id: string, shippedAt: string) => request<{ request: BookingRequest }>('POST', `/api/bookings/${encodeURIComponent(id)}/shipped`, { shippedAt }),
  unmarkBookingShipped: (id: string) => request<{ request: BookingRequest }>('POST', `/api/bookings/${encodeURIComponent(id)}/unship`, {}),
  approveBooking: (id: string, body: { lines: { containerType: ContainerType; approvedQuantity: number }[]; note: string }) =>
    request<{ request: BookingRequest }>('POST', `/api/bookings/${encodeURIComponent(id)}/approve`, body),
  refuseBooking: (id: string, note: string) => request<{ request: BookingRequest }>('POST', `/api/bookings/${encodeURIComponent(id)}/refuse`, { note }),
};
