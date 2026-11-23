// Solicitações de embarque (SPEC.md, seção 3): o agente de cargas pede, por fornecedor, quantos
// containers de cada tipo vão sair, de onde, quando e quanto custa cada um; o Gabriel aprova (podendo
// aprovar menos containers que o pedido) ou recusa com o motivo. Só depois da aprovação o agente reserva.

import { searchKey } from './items';
import { parseMoneyCents } from './money';
import { can, type Role } from './roles';
import { daysBetween, parseDate } from './shipments';

/** Tipos de container (o tipo importa: decidido pelo Gabriel em 19/11/2026). */
export const CONTAINER_TYPES = ['20', '40', '40HC'] as const;
export type ContainerType = (typeof CONTAINER_TYPES)[number];

export const CONTAINER_LABELS: Record<ContainerType, string> = { '20': "20'", '40': "40'", '40HC': "40' HC" };

export const BOOKING_STATUSES = ['aguardando', 'aprovada', 'recusada', 'cancelada'] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

export const BOOKING_STATUS_LABELS: Record<BookingStatus, string> = {
  aguardando: 'Aguardando aprovação',
  aprovada: 'Aprovada',
  recusada: 'Recusada',
  cancelada: 'Cancelada',
};

/** Teto de containers de um tipo numa solicitação: mais que isso é erro de digitação. */
export const MAX_CONTAINERS = 99;
/** Teto do valor de um container (US$ 100.000,00), também contra erro de digitação. */
export const MAX_PRICE_CENTS = 10_000_000;
/** Piso do valor de um container (US$ 100,00): abaixo disso, é "2,85" digitado no lugar de "2.850". */
export const MIN_PRICE_CENTS = 10_000;
/** Tamanho máximo do número de referência que o agente dá à solicitação. */
export const REFERENCE_MAX = 40;
/** A saída pode ter passado há no máximo 90 dias (pedido registrado atrasado) e estar a no máximo um ano. */
const MAX_DAYS_BEFORE = 90;
const MAX_DAYS_AFTER = 366;

export interface BookingLine {
  containerType: ContainerType;
  /** Containers pedidos pelo agente. */
  quantity: number;
  /** Containers aprovados; null enquanto a solicitação não foi aprovada. */
  approvedQuantity: number | null;
  /** Valor de cada container, em centavos de dólar. */
  priceCents: number;
}

export interface Person {
  id: string;
  name: string;
}

export interface BookingRequest {
  id: string;
  /**
   * Número de referência, dado pelo agente de cargas (obrigatório nas novas, decidido em 23/11/2026);
   * vazio nas solicitações anteriores, até alguém preencher.
   */
  reference: string;
  /** null só quando o fornecedor deixou de existir (o admin apagou tudo para começar do zero). */
  supplierId: string | null;
  supplierName: string;
  departurePort: string;
  /** Saída prevista (AAAA-MM-DD). */
  departureDate: string;
  notes: string;
  status: BookingStatus;
  createdAt: string;
  createdBy: Person;
  /** Quando foi aprovada, recusada ou cancelada, e por quem. */
  decidedAt: string | null;
  decidedBy: Person | null;
  /** Motivo da recusa ou observação da aprovação. */
  decisionNote: string;
  lines: BookingLine[];
}

export interface NewBookingLine {
  containerType: ContainerType;
  quantity: number;
  priceCents: number;
}

/** O número de referência como fica gravado: sem espaços sobrando. */
export function normalizeReference(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** O que impede o número de referência de ser gravado, ou null. */
export function referenceProblem(text: string): string | null {
  const reference = normalizeReference(text);
  if (!reference) return 'Informe o número de referência.';
  if (reference.length > REFERENCE_MAX) return `O número de referência pode ter no máximo ${REFERENCE_MAX} caracteres.`;
  return null;
}

/** O que impede a solicitação de ser gravada, ou null. `today` é o dia em São Paulo (AAAA-MM-DD). */
export function bookingProblem(
  input: { reference: string; departurePort: string; departureDate: string; lines: readonly NewBookingLine[] },
  today: string,
): string | null {
  const reference = referenceProblem(input.reference);
  if (reference) return reference;
  if (!input.departurePort.trim()) return 'Informe o porto de saída.';
  if (parseDate(input.departureDate) !== input.departureDate) return 'Informe a data de saída.';
  const days = daysBetween(today, input.departureDate);
  if (days < -MAX_DAYS_BEFORE || days > MAX_DAYS_AFTER) return 'A data de saída parece errada. Confira o dia e o ano.';
  if (input.lines.length === 0) return 'Informe pelo menos um tipo de container.';
  const seen = new Set<ContainerType>();
  for (const line of input.lines) {
    const label = CONTAINER_LABELS[line.containerType];
    if (seen.has(line.containerType)) return `O container ${label} aparece duas vezes. Junte as quantidades numa linha só.`;
    seen.add(line.containerType);
    if (!Number.isInteger(line.quantity) || line.quantity < 1) return `Informe quantos containers de ${label}.`;
    if (line.quantity > MAX_CONTAINERS) return `No máximo ${MAX_CONTAINERS} containers de cada tipo.`;
    if (!Number.isInteger(line.priceCents) || line.priceCents <= 0) return `Informe o valor de cada container de ${label}.`;
    if (line.priceCents < MIN_PRICE_CENTS) return `O valor de cada container de ${label} está abaixo de US$ 100,00. Confira.`;
    if (line.priceCents > MAX_PRICE_CENTS) return `O valor de cada container de ${label} passa de US$ 100.000,00. Confira.`;
  }
  return null;
}

/**
 * Valor de um container digitado no formulário → centavos de dólar; null se não for um valor.
 * Segue a regra do valor em dólar digitado (parseMoneyCents): "2.850" e "2,850" são US$ 2.850,00.
 */
export function parseContainerPrice(text: string): number | null {
  return parseMoneyCents(text);
}

/** O que impede a aprovação com estas quantidades, ou null. Pode aprovar menos que o pedido, nunca mais. */
export function approvalProblem(
  lines: readonly Pick<BookingLine, 'containerType' | 'quantity'>[],
  approved: readonly { containerType: ContainerType; approvedQuantity: number }[],
): string | null {
  if (approved.length !== lines.length || !lines.every((l) => approved.some((a) => a.containerType === l.containerType))) {
    return 'Informe quantos containers de cada tipo pedido são aprovados.';
  }
  let total = 0;
  for (const a of approved) {
    const line = lines.find((l) => l.containerType === a.containerType)!;
    const label = CONTAINER_LABELS[a.containerType];
    if (!Number.isInteger(a.approvedQuantity) || a.approvedQuantity < 0) return `Quantidade aprovada inválida para o container ${label}.`;
    if (a.approvedQuantity > line.quantity) {
      return `${line.quantity === 1 ? 'Foi pedido 1 container' : `Foram pedidos ${line.quantity} containers`} de ${label}: aprove no máximo isso.`;
    }
    total += a.approvedQuantity;
  }
  if (total === 0) return 'Aprove pelo menos um container, ou recuse a solicitação.';
  return null;
}

/** As linhas na ordem dos tipos (20', 40', 40' HC), qualquer que seja a ordem em que foram digitadas. */
export function sortedLines<T extends { containerType: ContainerType }>(lines: readonly T[]): T[] {
  return [...lines].sort((a, b) => CONTAINER_TYPES.indexOf(a.containerType) - CONTAINER_TYPES.indexOf(b.containerType));
}

type Which = 'pedido' | 'aprovado';

function amount(line: Pick<BookingLine, 'quantity' | 'approvedQuantity'>, which: Which): number {
  return which === 'aprovado' ? (line.approvedQuantity ?? 0) : line.quantity;
}

/** "2 × 40' HC + 1 × 20'": o pedido ou o aprovado. */
export function containersText(lines: readonly Pick<BookingLine, 'containerType' | 'quantity' | 'approvedQuantity'>[], which: Which = 'pedido'): string {
  const parts = sortedLines(lines)
    .map((l) => ({ n: amount(l, which), label: CONTAINER_LABELS[l.containerType] }))
    .filter((p) => p.n > 0)
    .map((p) => `${p.n} × ${p.label}`);
  return parts.length ? parts.join(' + ') : 'Nenhum container';
}

export function containerCount(lines: readonly Pick<BookingLine, 'quantity' | 'approvedQuantity'>[], which: Which = 'pedido'): number {
  return lines.reduce((sum, l) => sum + amount(l, which), 0);
}

/** Valor total em centavos: containers × valor de cada um, do pedido ou do aprovado. */
export function bookingTotalCents(lines: readonly Pick<BookingLine, 'quantity' | 'approvedQuantity' | 'priceCents'>[], which: Which = 'pedido'): number {
  return lines.reduce((sum, l) => sum + amount(l, which) * l.priceCents, 0);
}

/** A aprovação ficou abaixo do pedido? */
export function approvedLess(request: Pick<BookingRequest, 'status' | 'lines'>): boolean {
  return request.status === 'aprovada' && request.lines.some((l) => (l.approvedQuantity ?? 0) < l.quantity);
}

/** "Saída em 12 dias", "Saída amanhã", "Saída hoje", "Saída ontem", "Saída há 3 dias". */
export function departureText(date: string, today: string): string {
  const days = daysBetween(today, date);
  if (days === 0) return 'Saída hoje';
  if (days === 1) return 'Saída amanhã';
  if (days > 1) return `Saída em ${days} dias`;
  if (days === -1) return 'Saída ontem';
  return `Saída há ${-days} dias`;
}

/** Quem aprova e recusa: só o admin com a marca de aprovador, o Gabriel (decidido em 19/11/2026). */
export function canDecideBookings(user: { role: Role; approvesBookings: boolean }): boolean {
  return can(user.role, 'decide_bookings') && user.approvesBookings;
}

/** O agente cancela a própria solicitação enquanto ela aguarda a aprovação. */
export function canCancelBooking(request: Pick<BookingRequest, 'status' | 'createdBy'>, user: { id: string; role: Role }): boolean {
  return can(user.role, 'request_bookings') && request.createdBy.id === user.id && request.status === 'aguardando';
}

/**
 * Quem corrige o número de referência (decidido em 23/11/2026): o agente, nas próprias solicitações, e
 * admin e editor, em qualquer uma, em qualquer situação (as antigas não têm número).
 */
export function canEditBookingReference(request: Pick<BookingRequest, 'createdBy'>, user: { id: string; role: Role }): boolean {
  if (can(user.role, 'request_bookings')) return request.createdBy.id === user.id;
  return can(user.role, 'view_bookings');
}

export function pendingCount(requests: readonly Pick<BookingRequest, 'status'>[]): number {
  return requests.filter((r) => r.status === 'aguardando').length;
}

/**
 * Ordem da lista: as que aguardam primeiro, da saída mais próxima para a mais distante (é o que tem
 * pressa); depois as decididas, da decisão mais recente para a mais antiga.
 */
export function sortBookings<T extends Pick<BookingRequest, 'status' | 'departureDate' | 'createdAt' | 'decidedAt'>>(requests: readonly T[]): T[] {
  return [...requests].sort((a, b) => {
    const pa = a.status === 'aguardando' ? 0 : 1;
    const pb = b.status === 'aguardando' ? 0 : 1;
    if (pa !== pb) return pa - pb;
    if (pa === 0) return a.departureDate.localeCompare(b.departureDate) || a.createdAt.localeCompare(b.createdAt);
    return (b.decidedAt ?? b.createdAt).localeCompare(a.decidedAt ?? a.createdAt);
  });
}

/** As solicitações por situação, na ordem de BOOKING_STATUSES, só as situações que têm alguma. */
export function groupBookings<T extends Pick<BookingRequest, 'status' | 'departureDate' | 'createdAt' | 'decidedAt'>>(requests: readonly T[]): { status: BookingStatus; requests: T[] }[] {
  const sorted = sortBookings(requests);
  return BOOKING_STATUSES.map((status) => ({ status, requests: sorted.filter((r) => r.status === status) })).filter((g) => g.requests.length > 0);
}

/** A solicitação tem todas as palavras da busca (fornecedor, porto, containers, quem pediu, observações)? */
export function matchesBooking(request: BookingRequest, query: string): boolean {
  const words = searchKey(query).split(' ').filter(Boolean);
  if (!words.length) return true;
  const hay = searchKey(
    [request.reference, request.supplierName, request.departurePort, containersText(request.lines), request.createdBy.name, request.notes, request.decisionNote, BOOKING_STATUS_LABELS[request.status]].join(' '),
  );
  return words.every((w) => hay.includes(w));
}

/** Portos já usados, do mais usado para o menos usado (sugestões no formulário). */
export function portSuggestions(requests: readonly Pick<BookingRequest, 'departurePort' | 'createdAt'>[]): string[] {
  const byKey = new Map<string, { port: string; count: number; last: string }>();
  for (const r of requests) {
    const key = searchKey(r.departurePort);
    if (!key) continue;
    const seen = byKey.get(key);
    if (!seen) byKey.set(key, { port: r.departurePort, count: 1, last: r.createdAt });
    else {
      seen.count++;
      // Vale a grafia mais recente.
      if (r.createdAt > seen.last) {
        seen.last = r.createdAt;
        seen.port = r.departurePort;
      }
    }
  }
  return [...byKey.values()].sort((a, b) => b.count - a.count || b.last.localeCompare(a.last)).map((p) => p.port);
}

/** As outras solicitações do mesmo fornecedor, da mais recente para a mais antiga (contexto da aprovação). */
export function otherBookingsOfSupplier<T extends Pick<BookingRequest, 'id' | 'supplierId' | 'createdAt'>>(requests: readonly T[], request: T, limit = 4): T[] {
  if (!request.supplierId) return [];
  return requests
    .filter((r) => r.id !== request.id && r.supplierId === request.supplierId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit);
}
