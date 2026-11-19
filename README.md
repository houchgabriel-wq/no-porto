# No Porto

Software do Grupo On Line para acompanhar a impressão e a importação dos livros: POs em produção nos fornecedores, BLs e invoices embarcados, chegadas, pagamentos e o histórico de importação desde 2023. Substitui a planilha `status_importações`. Online, com login por usuário. É o irmão do No Prelo.

## Documentos

- [`SPEC.md`](SPEC.md): o que o sistema faz, o que já foi decidido e o que ainda é proposta ou pendência.
- [`ROADMAP.md`](ROADMAP.md): os marcos de construção, em ordem.
- [`CLAUDE.md`](CLAUDE.md): instruções que o Claude Code lê ao abrir este repositório.

## Base técnica

Cloudflare Workers, D1, React, TypeScript e Vite, no mesmo padrão do No Prelo e do `mytrainer`. As skills de design ficam em `.claude/skills/`.

## Rodar no computador

Precisa de Node 24 (ou 22.5 em diante).

```
npm install
cp .dev.vars.example .dev.vars     # e troque o código de instalação
npm run db:migrate:local
npm run dev                        # abre em http://localhost:5173
```

Com o banco vazio, a primeira tela é a de primeiro acesso: informe o `SETUP_TOKEN` do `.dev.vars` e crie o admin.

Antes de enviar mudanças: `npm run typecheck`, `npm test` e `npm run build`. O GitHub roda os três a cada push.

## Publicar no Cloudflare (passos do Gabriel, uma vez só)

1. No painel do Cloudflare, em **Workers e Pages → Criar aplicativo → Importar um repositório**, escolha este repositório. O nome do projeto precisa ser `no-porto`, igual ao `name` do `wrangler.jsonc`.
2. Em **Configurações de build**, use `npm run build` como comando de build e `npm run deploy` como comando de deploy. A branch de produção é `main`.
3. Depois do primeiro deploy (que cria o banco `no-porto`), vá em **Worker → Configurações → Variáveis e segredos** e cadastre o segredo `SETUP_TOKEN` com um código que só você conheça. Cadastre ali, não nas variáveis de **Build**, que só existem durante o build.
4. Abra `https://no-porto.<sua-conta>.workers.dev`, informe o código e crie a sua conta de admin.

A partir daí, cada push em `main` publica sozinho. O `SETUP_TOKEN` só serve enquanto não existe nenhum usuário; depois pode ficar lá sem risco.

### Se uma mudança não aparecer no site

1. Em **Worker → Deployments**, veja se a publicação do último push em `main` rodou e se deu erro.
2. Em **Configurações → Build**, confira se a branch de produção é `main` e se o comando de deploy é `npm run deploy`. Só esse comando aplica as migrações novas do banco; sem elas, as telas novas dão erro ao carregar.
3. Trocar a branch de produção no painel não publica de novo sozinho: a publicação seguinte acontece no próximo push em `main` (ou em **Deployments → Tentar de novo**).

O endereço próprio é **noporto.editoraonline.com.br**. Como o DNS do domínio está na HostGator, e Worker só aceita domínio próprio com o DNS na Cloudflare, ele passa por uma porta de entrada no Cloudflare Pages (pasta `portal/`), como no No Prelo. O passo a passo (criar o projeto Pages, ligar o domínio e o CNAME na HostGator) está em [`portal/README.md`](portal/README.md).

## Cópia de segurança

No menu do admin (e de quem tem os perfis Editor ou Consulta), **Baixar cópia completa** gera uma planilha com as abas Produção, Embarques e Entregues, nas mesmas colunas da `status_importações`. Guarde uma cópia de tempos em tempos fora da Cloudflare (no Drive, por exemplo). Se um dia for preciso, ela volta pela **Carga completa da planilha**, no mesmo menu, que pode apagar o que está no app antes de carregar (pede para digitar APAGAR).

## Atualizar a produção pela planilha

Na tela **Produção**, o **Baixar .xlsx** gera a lista dos itens com a coluna **Código do item** no fim. Mude na planilha a aprovação do arquivo, a programação de envio (como "dez/2026: 20.000; fev/2027: 20.000") ou as observações e envie o arquivo em **Atualizar pela planilha** (admin e editor). Antes de gravar, o app mostra só os itens que mudaram, com o antes e o depois, e as linhas que não entram, com o motivo. Não mexa na coluna do código e, ao ordenar, ordene a planilha inteira. Quantidade, preço, PO e o resto só mudam na ficha do item. A **Carga da planilha** é só para a `status_importações` e recusa essa lista, para não duplicar os itens.

## Ligação com o No Prelo

Todo dia às 6h40 (Brasília), o No Porto busca no No Prelo a "Data de aprovação" da gráfica e preenche a **Aprovação do arquivo** dos itens com o mesmo ISBN e a mesma PO (a "ordem de impressão" no No Prelo). Enquanto vem do No Prelo, a data só muda lá. O admin pode buscar fora do horário, pelo menu, em **Buscar aprovações no No Prelo**.

Os dois Workers falam por uma ligação interna da Cloudflare (service binding), sem senha nem token: não há nada para cadastrar no painel. Na primeira publicação, o No Prelo precisa ir ao ar antes do No Porto, porque é ele que tem a porta (`NoPortoApi`).
