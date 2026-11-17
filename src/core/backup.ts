// Lembrete da cópia completa (pedido do Gabriel em 17/11/2026), como no No Prelo: o painel do admin
// avisa quando faz um mês (ou nunca) que a cópia foi baixada, contada no navegador.

import { daysBetween } from './shipments';

export const BACKUP_REMINDER_DAYS = 30;

/** Está na hora de baixar a cópia? `last` e `today` em AAAA-MM-DD. */
export function backupDue(last: string | null, today: string): boolean {
  return last === null || daysBetween(last, today) >= BACKUP_REMINDER_DAYS;
}

/** Nome do arquivo da cópia: no-porto-copia-AAAA-MM-DD.xlsx. */
export function backupFileName(today: string): string {
  return `no-porto-copia-${today}.xlsx`;
}
