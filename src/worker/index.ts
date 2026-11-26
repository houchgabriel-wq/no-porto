import { WorkerEntrypoint } from 'cloudflare:workers';
import type { StockArrival } from '../core/stockArrivals';
import { handleApi } from './api';
import type { Env } from './env';
import { arrivalsSince } from './noEstoque';
import { syncNoPrelo } from './noPrelo';

/**
 * A porta interna do No Estoque (SPEC.md, seção 8): o Worker "no-estoque", na mesma conta da Cloudflare,
 * busca aqui as chegadas de container a partir de um dia, para montar as entradas previstas. A porta não
 * tem endereço na internet: só um Worker da conta com a ligação no wrangler.jsonc dele alcança. Só lê, e
 * não manda valores. Mudou o formato? O No Estoque precisa mudar junto.
 */
export class NoEstoqueApi extends WorkerEntrypoint<Env> {
  async arrivals(since: string): Promise<StockArrival[]> {
    return arrivalsSince(this.env, since);
  }
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) return handleApi(request, env);
    return env.ASSETS.fetch(request);
  },
  // Uma vez por dia, de manhã (wrangler.jsonc): as aprovações do arquivo cadastradas no No Prelo.
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(
      syncNoPrelo(env, new Date(controller.scheduledTime)).then(
        (r) => console.log(`No Prelo: ${r.approvals} aprovações lidas, ${r.updated} itens atualizados.`),
        (e: unknown) => console.error(`No Prelo: ${e instanceof Error ? e.message : 'falha na busca.'}`),
      ),
    );
  },
} satisfies ExportedHandler<Env>;
