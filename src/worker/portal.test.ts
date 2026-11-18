import { describe, expect, it } from 'vitest';

// A porta de entrada é JavaScript puro, publicado no Cloudflare Pages (portal/README.md).
const portalPath = '../../portal/public/_worker.js';
const portal = (await import(/* @vite-ignore */ portalPath)) as {
  default: { fetch: (request: Request, env: { NO_PORTO?: { fetch: (request: Request) => Promise<Response> } }) => Promise<Response> };
};

describe('porta de entrada (noporto.editoraonline.com.br)', () => {
  it('repassa o pedido inteiro ao Worker, com o endereço original', async () => {
    const seen: Request[] = [];
    const env = { NO_PORTO: { fetch: async (r: Request) => (seen.push(r), new Response('ok', { status: 201 })) } };
    const request = new Request('https://noporto.editoraonline.com.br/api/shipments?x=1', {
      method: 'POST',
      body: '{}',
      headers: { origin: 'https://noporto.editoraonline.com.br', 'content-type': 'application/json' },
    });
    const res = await portal.default.fetch(request, env);
    expect(res.status).toBe(201);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toBe(request);
  });

  it('sem a ligação com o Worker, avisa em vez de quebrar', async () => {
    const res = await portal.default.fetch(new Request('https://noporto.editoraonline.com.br/'), {});
    expect(res.status).toBe(503);
    expect(await res.text()).toMatch(/NO_PORTO/);
  });
});
