import { describe, expect, it } from 'vitest';
import { isExpired, loginBlocked, loginWindowStart, sessionExpiry, shouldRenew } from './sessions';

const now = new Date('2026-10-10T12:00:00Z');

describe('sessão', () => {
  it('vale 30 dias', () => {
    expect(sessionExpiry(now).toISOString()).toBe('2026-11-09T12:00:00.000Z');
  });

  it('expira na data marcada', () => {
    expect(isExpired('2026-10-10T12:00:00.000Z', now)).toBe(true);
    expect(isExpired('2026-10-10T12:00:01.000Z', now)).toBe(false);
  });

  it('renova só depois de um dia de uso', () => {
    expect(shouldRenew(sessionExpiry(now).toISOString(), now)).toBe(false);
    expect(shouldRenew('2026-11-08T13:00:00.000Z', now)).toBe(false);
    expect(shouldRenew('2026-11-08T11:00:00.000Z', now)).toBe(true);
  });
});

describe('limite de tentativas', () => {
  it('janela de 15 minutos', () => {
    expect(loginWindowStart(now).toISOString()).toBe('2026-10-10T11:45:00.000Z');
  });

  it('bloqueia com 5 falhas no e-mail ou 20 no endereço', () => {
    expect(loginBlocked({ email: 4, ip: 19 })).toBe(false);
    expect(loginBlocked({ email: 5, ip: 0 })).toBe(true);
    expect(loginBlocked({ email: 0, ip: 20 })).toBe(true);
  });
});
