# No Porto

Software do Grupo On Line para acompanhar a impressão e a importação dos livros: POs em produção nos fornecedores, BLs e invoices embarcados, chegadas, pagamentos e o histórico de importação desde 2023. Online, com login por usuário. O dono do projeto é o Gabriel. É o irmão do No Prelo (`houchgabriel-wq/projectmanagement`), que acompanha o desenvolvimento dos livros.

## Antes de qualquer coisa

1. Leia `SPEC.md` inteiro. Ele separa o que é **decidido** pelo Gabriel do que é **proposta**. Não reabra decisões; propostas podem ser ajustadas, avisando o que mudou.
2. Leia `ROADMAP.md` e trabalhe no primeiro marco ainda aberto.

As pendências da seção 10 do `SPEC.md` são perguntas para o Gabriel. Quando uma delas travar o trabalho, pergunte; não decida por ele.

## Idioma

Português do Brasil em tudo o que uma pessoa lê: interface, mensagens de erro, documentação, comentários de código e mensagens de commit. Identificadores de código (variáveis, tabelas, rotas) em inglês. Converse com o Gabriel em português.

## Base técnica

Cloudflare Workers (TypeScript), D1, React com Vite, Vitest. Mesmo padrão do No Prelo e do `mytrainer`, do mesmo dono. Detalhes na seção 8 do `SPEC.md`.

```
migrations/        migrações do D1, numeradas (0001_init.sql, ...)
src/app/           interface React
src/core/          regras de negócio puras, cada uma com teste
src/worker/        API, login e acesso ao banco
```

Comandos:

```
npm run dev               servidor local
npm run typecheck         confere os tipos
npm test                  testes
npm run build             build de produção
npm run db:migrate:local  aplica as migrações no banco local
npm run deploy            publica (quem roda é o Cloudflare, a cada push em main)
```

## Regras de trabalho

- **Permissão se verifica no servidor.** Toda rota confere o perfil antes de ler ou gravar. A interface só esconde o que o perfil não pode usar.
- **Leitor não vê valores.** Preços, totais, câmbio e pagamentos saem das respostas da API para o leitor; esconder na tela não basta.
- **Dinheiro sem ponto flutuante.** Dólar em centavos, preço unitário em milionésimos de dólar, câmbio com quatro casas guardado como inteiro.
- **Segredos fora do repositório.** Nada de senha, token ou `.dev.vars` em commit. Segredos ficam no painel do Cloudflare.
- **Senhas:** só hash com sal, nunca em texto, nunca em log.
- **Regra de negócio mora em `src/core`**, sem depender de banco nem de navegador, e tem teste. Situação dos itens, atraso, saldo da PO, situação de pagamento, somas do painel e permissões são regras de negócio.
- **Migrações só para frente.** Nunca editar uma migração já publicada; criar a próxima.
- **Antes de dizer que terminou:** `npm run typecheck`, `npm test` e `npm run build` passando, e a tela conferida no navegador nos temas claro e escuro e em largura de celular.
- **Commits pequenos**, um assunto por commit. Depois que a publicação automática estiver ligada, tudo o que entra em `main` vai ao ar: só envie para `main` o que passou nas conferências acima, e use branch com pull request para mudanças maiores.

## Design

A direção visual é a do No Prelo (seção 9 do `SPEC.md`): limpa e moderna, com mais cor, painel com destaque e cartões com hierarquia, com outra cor de destaque para distinguir os dois sistemas. Use as skills de design de `.claude/skills` (`ui-ux-pro-max` e as demais) ao construir ou alterar telas. Quando uma recomendação das skills contrariar o `SPEC.md`, vale o `SPEC.md`.

## Atualize a documentação junto com o código

Ao fechar um marco, marque no `ROADMAP.md`. Quando o Gabriel responder uma pendência ou confirmar uma proposta, mova o item para as decisões no `SPEC.md`.
