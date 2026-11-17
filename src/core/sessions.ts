// Validade da sessão e limite de tentativas de login (SPEC.md, seção 4).

const DAY_MS = 24 * 60 * 60 * 1000;

export const SESSION_DAYS = 30;
/** A validade só é renovada depois de um dia de uso, para não gravar no banco a cada pedido. */
const RENEW_AFTER_MS = DAY_MS;

export function sessionExpiry(now: Date): Date {
  return new Date(now.getTime() + SESSION_DAYS * DAY_MS);
}

export function isExpired(expiresAt: string, now: Date): boolean {
  return Date.parse(expiresAt) <= now.getTime();
}

/** Renova quando já passou mais de um dia desde a última renovação. */
export function shouldRenew(expiresAt: string, now: Date): boolean {
  return Date.parse(expiresAt) - now.getTime() < SESSION_DAYS * DAY_MS - RENEW_AFTER_MS;
}

export const LOGIN_WINDOW_MINUTES = 15;
export const LOGIN_MAX_FAILURES_PER_EMAIL = 5;
export const LOGIN_MAX_FAILURES_PER_IP = 20;

export function loginWindowStart(now: Date): Date {
  return new Date(now.getTime() - LOGIN_WINDOW_MINUTES * 60 * 1000);
}

/** Bloqueia novas tentativas depois de muitas falhas recentes no mesmo e-mail ou endereço. */
export function loginBlocked(failures: { email: number; ip: number }): boolean {
  return failures.email >= LOGIN_MAX_FAILURES_PER_EMAIL || failures.ip >= LOGIN_MAX_FAILURES_PER_IP;
}
