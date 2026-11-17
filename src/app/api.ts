// Chamadas à API. Erros viram ApiError com a mensagem em português vinda do servidor.

import type { DocumentLine } from '../core/documents';
import type { ImportedItem } from '../core/importProduction';
import type { ImportedShipmentItem } from '../core/importShipments';
import type { ImportedHistoryItem } from '../core/importHistory';
import type { InvoiceInfo } from '../core/history';
import type { SupplierSummary } from '../core/suppliers';
import type { CopyInput } from '../core/fullCopy';
import type { Bill, Invoice, Payment } from '../core/shipments';
import type { Item, PurchaseOrder, Supplier } from '../core/items';
import type { Role } from '../core/roles';

export interface Me {
  id: string;
  name: string;
  email: string;
  role: Role;
  mustChangePassword: boolean;
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
  registerArrival: (invoiceIds: string[], arrivedAt: string) => request<{ invoices: number }>('POST', '/api/arrivals', { invoiceIds, arrivedAt }),
  reset: (confirm: string) => request<{ items: number }>('POST', '/api/reset', { confirm }),
  importShipments: (items: ImportedShipmentItem[]) => request<{ inserted: number; skipped: number }>('POST', '/api/import/shipments', { items }),
  history: () => request<{ items: Item[]; invoices: InvoiceInfo[]; seeValues: boolean }>('GET', '/api/history'),
  product: (id: string) =>
    request<{ product: { id: string; isbn: string | null; title: string }; items: Item[]; invoices: InvoiceInfo[]; orders: { id: string; code: string }[]; seeValues: boolean }>(
      'GET',
      `/api/products/${encodeURIComponent(id)}`,
    ),
  importHistory: (items: ImportedHistoryItem[]) => request<{ inserted: number; skipped: number }>('POST', '/api/import/history', { items }),
  suppliers: () => request<{ suppliers: SupplierSummary[]; seeValues: boolean }>('GET', '/api/suppliers'),
  fullCopy: () => request<CopyInput>('GET', '/api/export'),
  updateSupplier: (id: string, body: Partial<{ name: string; notes: string }>) =>
    request<{ supplier: { id: string; name: string; notes: string } }>('PATCH', `/api/suppliers/${encodeURIComponent(id)}`, body),
  createItem: (body: ItemInput) => request<{ item: Item }>('POST', '/api/items', body),
  updateItem: (id: string, body: Partial<ItemInput>) => request<{ item: Item }>('PATCH', `/api/items/${encodeURIComponent(id)}`, body),
  deleteItem: (id: string) => request<{ ok: true }>('DELETE', `/api/items/${encodeURIComponent(id)}`),
  importProduction: (items: ImportedItem[]) => request<{ inserted: number; skipped: number; withoutOrder: string[] }>('POST', '/api/import/production', { items }),
};
