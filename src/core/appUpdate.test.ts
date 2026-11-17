import { describe, expect, it } from 'vitest';
import { isNewVersion, showUpdateNotice, UPDATE_SNOOZE_MS } from './appUpdate';

describe('aviso de versão nova', () => {
  it('reconhece a versão nova pelo version.json', () => {
    expect(isNewVersion('a1', { build: 'b2' })).toBe(true);
    expect(isNewVersion('a1', { build: 'a1' })).toBe(false);
    // Sem o arquivo (o site devolve a página) ou com conteúdo estranho, não avisa.
    expect(isNewVersion('a1', null)).toBe(false);
    expect(isNewVersion('a1', '<!doctype html>')).toBe(false);
    expect(isNewVersion('a1', { build: '' })).toBe(false);
    expect(isNewVersion('a1', { build: 2 })).toBe(false);
  });

  it('espera o fim da tarefa e respeita o "Depois" por uma hora', () => {
    const now = 1_000_000;
    expect(showUpdateNotice({ available: true, snoozedUntil: null, now, busy: false })).toBe(true);
    expect(showUpdateNotice({ available: false, snoozedUntil: null, now, busy: false })).toBe(false);
    expect(showUpdateNotice({ available: true, snoozedUntil: null, now, busy: true })).toBe(false);
    expect(showUpdateNotice({ available: true, snoozedUntil: now + UPDATE_SNOOZE_MS, now, busy: false })).toBe(false);
    expect(showUpdateNotice({ available: true, snoozedUntil: now + UPDATE_SNOOZE_MS, now: now + UPDATE_SNOOZE_MS, busy: false })).toBe(true);
  });
});
