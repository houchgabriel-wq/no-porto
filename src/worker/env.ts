export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  /** Código pedido na tela de primeiro acesso. Segredo no painel do Cloudflare. */
  SETUP_TOKEN?: string;
}
