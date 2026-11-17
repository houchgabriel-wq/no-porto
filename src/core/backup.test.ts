import { describe, expect, it } from 'vitest';
import { backupDue, backupFileName } from './backup';

describe('lembrete da cópia completa', () => {
  it('lembra quando nunca foi baixada ou quando faz 30 dias', () => {
    expect(backupDue(null, '2026-11-17')).toBe(true);
    expect(backupDue('2026-10-18', '2026-11-17')).toBe(true);
    expect(backupDue('2026-10-19', '2026-11-17')).toBe(false);
    expect(backupDue('2026-11-17', '2026-11-17')).toBe(false);
  });

  it('nome do arquivo com a data', () => {
    expect(backupFileName('2026-11-17')).toBe('no-porto-copia-2026-11-17.xlsx');
  });
});
