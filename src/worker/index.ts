import { WorkerEntrypoint } from 'cloudflare:workers';
import type { StockArrival, StockFiscalFileContent } from '../core/stockArrivals';
import { handleApi } from './api';
import type { Env } from './env';
import { arrivalsSince, fiscalFileContent } from './noEstoque';
import { syncNoPrelo } from './noPrelo';

/**
 * A porta interna do No Estoque (SPEC.md, seção 8): o Worker "no-estoque", na mesma conta da Cloudflare,
 * busca aqui os containers em liberação e os que chegaram a partir de um dia, para montar as entradas
 * previstas. A porta não tem endereço na internet: só um Worker da conta com a ligação no wrangler.jsonc
 * dele alcança. Só lê, e não manda valores, a não ser os arquivos da nota fiscal, que o No Estoque lê por
 * inteiro (27/11/2026). Mudou o formato? O No Estoque precisa mudar junto; acrescentar não quebra o que ele lê.
 */
export class NoEstoqueApi extends WorkerEntrypoint<Env> {
  async arrivals(since: string): Promise<StockArrival[]> {
    return arrivalsSince(this.env, since, new Date());
  }

  /** O PDF ou o XML da nota fiscal, inteiro, pelo id que veio em fiscalNote ou masterFiscalNote (27/11/2026). */
  async fiscalFile(id: string): Promise<StockFiscalFileContent | null> {
    return fiscalFileContent(this.env, id);
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
