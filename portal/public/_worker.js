// Porta de entrada do No Porto (pedido do Gabriel em 18/11/2026): um projeto do Cloudflare Pages que
// recebe o endereço noporto.editoraonline.com.br e repassa cada pedido, inteiro e sem mudanças, ao
// Worker do No Porto, pela ligação interna NO_PORTO (service binding). Assim o domínio próprio
// funciona com um CNAME na HostGator, sem levar o DNS para a Cloudflare. É o mesmo arranjo do
// No Prelo. Configuração em portal/README.md.

export default {
  async fetch(request, env) {
    if (!env.NO_PORTO) {
      return new Response('A porta de entrada está sem a ligação com o No Porto (NO_PORTO). Veja portal/README.md.', {
        status: 503,
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      });
    }
    // O pedido segue com o endereço original: o Worker vê noporto.editoraonline.com.br, e o login e a
    // conferência de origem dos formulários funcionam como no endereço da Cloudflare.
    return env.NO_PORTO.fetch(request);
  },
};
