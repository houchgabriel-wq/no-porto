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

Para usar um endereço do `editoraonline.com.br` (por exemplo, `noporto.editoraonline.com.br`), a TI cria o registro no DNS e o domínio é ligado ao Worker em **Configurações → Domínios e rotas**, como no No Prelo.

## Cópia de segurança

No menu do admin, **Baixar cópia completa** gera uma planilha com as abas Produção, Embarques e Entregues, nas mesmas colunas da `status_importações`. Guarde uma cópia de tempos em tempos fora da Cloudflare (no Drive, por exemplo). Se um dia for preciso, ela volta pela **Carga completa da planilha**, no mesmo menu, que pode apagar o que está no app antes de carregar (pede para digitar APAGAR).
