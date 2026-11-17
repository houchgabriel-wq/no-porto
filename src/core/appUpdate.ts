// Aviso de versão nova (pedido do Gabriel em 30/10/2026). Cada publicação grava um identificador no
// version.json do site; o aplicativo aberto compara com o seu e, quando muda, oferece atualizar a
// página. "Depois" esconde o aviso por uma hora, e ele nunca aparece no meio de uma tarefa.

/** De quanto em quanto tempo o aplicativo aberto confere se saiu versão nova. */
export const UPDATE_CHECK_MS = 5 * 60 * 1000;
/** Quanto tempo o "Depois" esconde o aviso. */
export const UPDATE_SNOOZE_MS = 60 * 60 * 1000;

/** O version.json publicado é de outra versão? Resposta estranha (sem o campo) não conta. */
export function isNewVersion(current: string, published: unknown): boolean {
  if (typeof published !== 'object' || published === null) return false;
  const build = (published as { build?: unknown }).build;
  return typeof build === 'string' && build !== '' && build !== current;
}

/**
 * Mostra o aviso quando há versão nova, o "Depois" já venceu e a pessoa não está no meio de uma
 * tarefa (janela aberta, item sendo arrastado, campo em edição, itens selecionados).
 */
export function showUpdateNotice(s: { available: boolean; snoozedUntil: number | null; now: number; busy: boolean }): boolean {
  if (!s.available || s.busy) return false;
  return s.snoozedUntil === null || s.now >= s.snoozedUntil;
}
