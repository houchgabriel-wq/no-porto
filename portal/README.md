# Porta de entrada: noporto.editoraonline.com.br

O No Porto roda num Worker da Cloudflare, e Worker só aceita domínio próprio com o DNS do domínio na
Cloudflare. O DNS do editoraonline.com.br está na HostGator, então o domínio próprio passa por esta porta
de entrada: um projeto do **Cloudflare Pages**, que aceita subdomínio só com um CNAME no DNS de fora, e
que repassa cada pedido ao Worker `no-porto` por uma ligação interna. O aplicativo, o banco e os arquivos
dos BLs continuam no Worker; o endereço `workers.dev` continua funcionando. É o mesmo arranjo do No Prelo
(`noprelo.editoraonline.com.br`).

Custo: cada acesso conta duas vezes no limite gratuito de pedidos da Cloudflare (uma aqui, outra no
Worker).

## Configurar (uma vez)

1. **Criar o projeto.** No painel da Cloudflare: Workers & Pages → Create → Pages → Connect to Git →
   repositório `no-porto`, ramo de produção `main`.
2. **Ajustes de build:**
   - Nome do projeto: `noporto` (vira `noporto.pages.dev`; se o nome estiver tomado, a Cloudflare sugere
     outro, e o CNAME do passo 5 usa o que ela der).
   - Framework preset: None.
   - Build command: em branco.
   - Build output directory: `public`.
   - Root directory (em "Advanced"): `portal`.
   - Build watch paths (se aparecer): incluir só `portal/*`, para não montar a porta de entrada a cada
     mudança no aplicativo.
3. **Salvar e publicar.** A ligação `NO_PORTO` com o Worker `no-porto` vem do `wrangler.toml` desta pasta.
   Abra o endereço `….pages.dev` que a Cloudflare mostrar: deve aparecer a tela de entrada do No Porto.
   Se aparecer "A porta de entrada está sem a ligação com o No Porto (NO_PORTO)", veja "Se faltar a
   ligação", abaixo.
4. **Domínio.** No projeto Pages: Custom domains → Set up a custom domain → `noporto.editoraonline.com.br`.
   A Cloudflare mostra o CNAME a criar.
5. **CNAME na HostGator.** No cPanel: Zone Editor → editoraonline.com.br → adicionar registro **CNAME**,
   nome `noporto`, destino `noporto.pages.dev` (ou o endereço do passo 3).
6. **Esperar.** Quando o domínio aparecer como **Active** no projeto Pages (o certificado do https sai
   sozinho), o endereço novo funciona.

## Se faltar a ligação

Na primeira configuração (18/11/2026) aconteceu o mesmo que no No Prelo: a porta de entrada foi
publicada, mas sem a ligação com o Worker. A causa provável é o projeto Pages ler a raiz do repositório,
e não esta pasta: o registro da publicação (Deployments → a publicação → Build log) mostra "Found
wrangler.json… Skipping file", que é o arquivo do aplicativo principal, e não o `wrangler.toml` daqui.

O que resolveu no No Prelo foi criar a ligação pelo painel: no projeto Pages, Settings → Bindings (em
algumas versões, Settings → Functions → Service bindings) → Add → Service binding, com Variable name
`NO_PORTO` e Service `no-porto`, em Production; depois, uma nova publicação (Deployments → a última →
Retry deployment), porque a ligação só vale para publicações feitas depois dela. Assim a ligação fica no
painel e não depende de onde o projeto lê a configuração.

O outro caminho é apontar o projeto para esta pasta (Root directory `portal`, Build output directory
`public`); aí o registro mostra "Found wrangler.toml" e a ligação vem do arquivo. Se o painel recusar a
ligação dizendo que ela vem de um arquivo de configuração, é este o caso.

## Depois

- Cada pessoa entra de novo uma vez no endereço novo (o login fica guardado por endereço).
- O lembrete da cópia completa conta por navegador e por endereço: no endereço novo, ele aparece até a
  primeira cópia baixada ali.
- Se um dia o DNS for para a Cloudflare, dá para ligar o domínio direto no Worker e apagar este projeto.
