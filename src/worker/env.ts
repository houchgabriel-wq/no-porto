import type { NoPreloApproval } from '../core/noPrelo';

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  /** Código pedido na tela de primeiro acesso. Segredo no painel do Cloudflare. */
  SETUP_TOKEN?: string;
  /**
   * A ligação interna com o No Prelo (19/11/2026): a porta NoPortoApi do Worker "no-prelo", na mesma conta
   * da Cloudflare. Ausente no servidor local e nos testes.
   */
  NOPRELO?: { fileApprovals(): Promise<NoPreloApproval[]> };
}
