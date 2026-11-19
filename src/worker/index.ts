import { handleApi } from './api';
import type { Env } from './env';
import { syncNoPrelo } from './noPrelo';

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
