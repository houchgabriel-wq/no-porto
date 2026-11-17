# No Porto: especificação

Software do Grupo On Line para acompanhar a impressão e a importação dos livros: o que está em produção nos fornecedores, o que está embarcado e quando chega, quanto está pago e a pagar, e o histórico de tudo o que já foi importado. Roda online, com login por usuário, como o No Prelo.

Este documento registra o que foi combinado com o Gabriel até 17/11/2026 (respostas da segunda rodada no mesmo dia). Cada item está marcado como **decidido** (escolha dele) ou **proposta** (sugestão ainda não confirmada). Propostas podem mudar sem cerimônia; decisões só mudam se ele pedir.

## 1. Origem

Hoje o controle é a planilha `status_importações`, no Google Drive do Gabriel, com as abas:

| Aba | Conteúdo em 17/11/2026 |
| --- | --- |
| Produção | 525 itens em fabricação, agrupados em 57 POs (PO-003 a PO-067), todos "Não Pago"; cerca de US$ 6,1 milhões |
| Embarques | 205 itens no mar, em 23 invoices e 11 BLs, com ref. do embarque, chegada prevista e pagamento; cerca de US$ 2,3 milhões |
| Entregues | cerca de 4.000 itens já recebidos, em 260 embarques, desde 2023 |
| cute, Sheet1 | listas avulsas; não entram no sistema (decidido em 17/11/2026) |

Colunas comuns: ref. do embarque, produto, ISBN, peças por caixa, quantidade, preço unitário (US$), total (US$), fornecedor. Fornecedores atuais: Sara, Claire, Nicola, Sally, Kaushik, Ricky; no histórico também Apurv, XACT, Lilian, Jean, Alligator e Mohinder.

O que a planilha mostra sobre a relação entre os dados (conferido em 17/11/2026): a planilha tem POs com itens de mais de um fornecedor (a PO-063 tem Sara e Claire; a PO-067, Sara e Nicola), o que o Gabriel decidiu que não pode acontecer (seção 2); cada invoice é de um fornecedor e está num BL só; cada BL é de um fornecedor e tem uma chegada só; um BL junta várias invoices (por exemplo, `2026-47A`, `47B` e `47C` no mesmo BL); a ref. do embarque quase sempre corresponde a uma invoice.

## 2. Decisões

| Tema | Decisão |
| --- | --- |
| Nome | No Porto (17/11/2026) |
| Domínio | `editoraonline.com.br`, como o No Prelo; o DNS é da equipe de TI (17/11/2026) |
| Onde mora | Repositório próprio (`houchgabriel-wq/no-porto`), separado do No Prelo, com login próprio (17/11/2026) |
| Base técnica | A mesma do No Prelo e do `mytrainer`: Cloudflare Workers, D1, React com Vite, Vitest |
| Hospedagem | Cloudflare, na conta pessoal do Gabriel |
| Planilha | O sistema substitui a planilha: carga única de produção, embarques e histórico; depois disso, tudo é atualizado no sistema, que exporta .xlsx quando precisar (17/11/2026) |
| Quem usa | Gabriel e a equipe interna; alguns editam, outros só consultam (17/11/2026) |
| Primeira versão | Painel de valores, embarques e chegadas, histórico por produto e POs em produção, os quatro (17/11/2026) |
| BL | Um BL pode ter vários containers. Registra-se o número do BL e a chegada prevista; os containers não são cadastrados. A data de saída, pedida na primeira rodada, ficou de fora: vale a chegada prevista no lugar dela (17/11/2026) |
| Pagamento | Por invoice, com a taxa de câmbio do pagamento (17/11/2026) |
| Pagamentos antigos | O que a planilha marca como "pago" entra como pago, sem data e sem câmbio, por enquanto (17/11/2026) |
| Preço unitário | No máximo três casas decimais (17/11/2026). Na carga, o que tem mais casas é arredondado na terceira (meio para cima), com aviso; os preços já cadastrados foram arredondados pela migração `0003`, com registro no histórico de cada item |
| Uma PO, um fornecedor | Uma PO não pode ter itens de fornecedores diferentes (17/11/2026). A ficha do item recusa a mistura, com a explicação. Proposta para os casos que já existem: o dono da PO é o fornecedor com mais itens nela (no empate, o do item mais antigo); os itens de outro fornecedor ficam "Sem PO", com a PO original nas observações ("PO na planilha: PO-063 (a PO é de Sara)"), para alguém acertar o número. A carga faz o mesmo, e a migração `0003` aplicou a regra aos itens já cadastrados (10 itens da Claire na PO-063 e 1 da Nicola na PO-067, na planilha de 17/11/2026) |
| Cópia completa | O admin baixa, pelo menu, a cópia de tudo no formato da planilha; o painel do admin lembra quando faz um mês (ou nunca) que ela foi baixada naquele navegador, com o botão "Baixar agora", como no No Prelo (17/11/2026) |
| Ordem das abas | Painel, Embarques, Produção, Histórico e Fornecedores (17/11/2026) |
| Documentos dos fornecedores | Três atalhos (17/11/2026): **novo pedido** (o Excel da PO entra na produção), **novo embarque** (a invoice ou packing list tira os produtos da produção e põe nos embarques) e **container entregue** (indica-se qual invoice chegou em qual dia, e os itens vão para o histórico) |
| Ordem de saída da produção | No novo embarque, a produção mais antiga sai antes, e sempre do mesmo fornecedor que mandou o embarque: um embarque da Claire nunca tira produção da Sara (17/11/2026) |
| Moeda | Todos os preços são em dólar. Os "R$" das PO-067 e PO-068 da Nicola eram erro de digitação; o Gabriel corrige na planilha (17/11/2026) |
| Previsão de embarque | A coluna "jun / aug / oct" da Produção é a previsão de embarque, mas fica de fora (17/11/2026) |
| Histórico | Entra tudo da aba Entregues, desde 2023 (17/11/2026) |
| Valores e leitor | O leitor não vê preços nem valores (17/11/2026) |
| Ligação com o No Prelo | Interessa: um livro aprovado na gráfica do No Prelo vira item de PO pelo ISBN. Fica para depois da primeira versão (17/11/2026) |
| Primeiro administrador | O próprio Gabriel |

## 3. Fluxo (proposta)

Cada item de pedido passa por três situações, como as etapas do No Prelo:

1. **Em produção**: o item faz parte de uma PO num fornecedor e ainda não embarcou.
2. **Embarcado**: o item está numa invoice, que está num BL com chegada prevista.
3. **Entregue**: o BL chegou à editora; a data de chegada fica registrada.

Embarcar não exige redigitar: na tela Produção, marcam-se os itens (ou parte da quantidade de um item) e escolhe-se a invoice, que pode ser uma a caminho do mesmo fornecedor ou uma nova (número, ref., BL e chegada prevista). Quando só parte da quantidade embarca, o item se divide em dois: a parte embarcada e o saldo, que continua em produção, com a mesma PO e o mesmo preço. Um item embarcado pode voltar para a produção enquanto não chegou.

Regras do embarque (feitas no marco 3):

- Uma invoice tem um fornecedor só (como na planilha): os itens marcados precisam ser do mesmo fornecedor, e o fornecedor de um item embarcado não muda.
- Invoice sem BL (como as 108 e 101 do Kaushik) tem a sua própria chegada prevista e chegada real. Quando a invoice está num BL, valem as do BL (migração `0004`).
- Registrar a chegada (no BL, ou na invoice sem BL) leva os itens para "entregue"; apagar a data volta para "embarcado".
- Os embarques que chegaram ficam na tela por 60 dias; depois disso, só no histórico (marco 4).
- Previsão vencida sem chegada registrada aparece como "Em liberação · previsão há N dias", em âmbar, e não como atraso: segundo o Gabriel (17/11/2026), em geral o contêiner está em liberação no porto.
- A invoice é identificada pelo fornecedor, pelo número e pelo BL: o mesmo número aparece em dois embarques (HSC20260411, da Nicola: um BL chegou em agosto, outro está a caminho).
- A chegada registrada na própria invoice vale mais que a do BL: no histórico, os containers de um mesmo BL chegaram em dias diferentes. Um BL sem chegada própria conta como chegado quando todas as suas invoices chegaram.

Documentos dos fornecedores (feitos depois do marco 5; decisão de 17/11/2026, na seção 2):

- **Novo pedido** (Produção): o Excel da PO, no modelo da editora ("PRINTING ORDER"). O fornecedor vem do campo "To:" (reconhecido sem diferença de maiúsculas: "NICOLA" é a Nicola), a PO do campo "Order No." ou, vazio, do nome do arquivo ("PO-064 (SARA).xlsx"), a data do campo "Date"; os comentários de cada linha viram observações do item. Antes de gravar, a pessoa confere e pode corrigir PO, fornecedor e data. Uma PO que já tem itens não entra de novo (para acrescentar, Novo item).
- **Novo embarque** (Embarques): a invoice ou packing list em Excel. A leitura acha o cabeçalho pelos nomes das colunas (Name, Title ou Description of goods; Quantity ou Qty; Unit Price ou Rate; ISBN; Order No.), aceita o ISBN numa coluna, junto do nome ou na linha de baixo, e, quando o arquivo tem packing list e invoice em abas separadas, usa a que tem preço. Funciona com os modelos da Claire (Miyi), da Nicola (Hunan Splendid) e da Brijbasi. O fornecedor é sugerido pelo nome no cabeçalho do arquivo ou, sem isso, pelo que tem esses produtos em produção; o número da invoice vem do cabeçalho. BL e chegada prevista são digitados (o BL costuma vir em PDF). A prévia mostra de qual PO sai cada linha. Proposta: o preço da invoice vale para a parte embarcada (é o que será pago); o que a invoice traz e não está na produção do fornecedor entra embarcado assim mesmo, sem PO, com a observação "Não estava na produção da Claire. Confira."; a PO citada na linha da invoice aparece na prévia, mas a ordem de saída segue a regra da mais antiga primeiro. A mesma invoice do mesmo fornecedor não entra duas vezes.
- **Registrar chegada** (Embarques): marcam-se as invoices a caminho (agrupadas por BL) e o dia; os itens delas vão para "entregue" e aparecem no Histórico. Cada invoice de um BL pode chegar num dia diferente.

Pagamento é registrado na invoice, à parte da situação dos itens: data, valor em dólar e taxa de câmbio; o valor em reais é calculado. Uma invoice pode ter mais de um pagamento (na planilha há casos como "Pago 2/3"); a situação dela é a pagar, paga em parte ou paga, conforme a soma dos pagamentos e o total dos itens. O pagamento antigo da planilha (sem valor) quita a invoice. Admin e editor registram pagamentos; só o admin exclui. "A pagar", no painel e na tela Embarques, é a soma do que falta nas invoices.

## 4. Perfis e permissões (proposta, menos o leitor sem valores, que é decidido)

| Ação | Admin | Editor | Leitor |
| --- | --- | --- | --- |
| Ver painel, POs, embarques e histórico | sim | sim | sim |
| Ver preços, valores e pagamentos | sim | sim | **não** (decidido) |
| Cadastrar e alterar POs, itens, invoices e BLs | sim | sim | não |
| Registrar pagamentos | sim | sim | não |
| Cadastrar fornecedores | sim | sim | não |
| Carga de planilha e exclusões | sim | não | não |
| Usuários | sim | não | não |

O servidor tira preços, totais, câmbio e pagamentos das respostas para o leitor; não basta esconder na tela. No painel, o leitor vê quantidades (exemplares, itens, embarques) no lugar de valores.

## 5. Telas (proposta)

- **Painel**: valor em produção, no mar e a pagar, em destaque; os mesmos valores por fornecedor; chegadas das próximas semanas; BLs atrasados (chegada prevista no passado sem entrega registrada); POs abertas há mais tempo.
- **Produção** (feita no marco 2): os itens em produção, com o total e um cartão por fornecedor em destaque (o cartão filtra a lista), busca, filtros por fornecedor e PO, "Agrupar por PO" com o subtotal de cada PO, tabela ordenável (cartões no celular), ficha do item e Baixar .xlsx. Fornecedor e PO são digitados na ficha, com sugestão dos que existem; os novos são criados ao salvar.
- **POs**: lista de POs com fornecedores, data, número de itens, valor e quanto já embarcou. A ficha da PO mostra os itens e permite embarcar os marcados. (No marco 2, as POs aparecem agrupadas na tela Produção; a ficha da PO com o embarque vem no marco 3.)
- **Embarques** (feita no marco 3, e é também a lista de chegadas): no topo, o valor no mar, os embarques a caminho, os atrasados e o que falta pagar. Os embarques (cada BL com suas invoices; a invoice sem BL sozinha) vêm agrupados pela chegada: atrasados, nesta semana, na próxima, depois, sem previsão e, recolhidos, os que chegaram nos últimos 60 dias. Cada cartão mostra fornecedor, previsão, as invoices com valor e situação de pagamento. A ficha do embarque altera o número do BL e as datas, tem "Chegou hoje", e mostra cada invoice com os itens (cada um pode voltar para a produção) e os pagamentos.
- **Embarques por item** (pedido pelo Gabriel em 17/11/2026): na tela Embarques, os botões "Por embarque" (os cartões por chegada) e "Por item" trocam a visão; o app lembra a escolha naquele navegador. "Por item" é como a Produção: o total no mar e um cartão por fornecedor (que filtra), busca por produto, ISBN, PO, invoice, ref., BL e fornecedor, filtros por fornecedor e por embarque, "Agrupar por embarque" (ligado no começo, cada BL ou invoice sem BL com fornecedores, invoices, totais e a situação da chegada), tabela ordenável com embarque, fornecedor, chegada (em âmbar quando em liberação), quantidade, preço e total, e cartões no celular. Clicar no item abre a ficha.
- **Painel** (atualizado no marco 3): em produção, no mar e a pagar em destaque; próximas chegadas com os atrasos; produção por fornecedor e as POs maiores.
- **Histórico** (feita no marco 4): tudo o que chegou desde 2023. No topo, um cartão por ano de chegada (e "Sem data"), que filtra; busca por produto, ISBN, invoice, ref., BL e fornecedor; filtros por fornecedor e ano; a tabela vai da chegada mais recente para a mais antiga, 200 linhas por vez; Baixar .xlsx do que está filtrado. O texto original da chegada aparece ao passar o mouse sobre a data. Os dados são carregados ao abrir a tela.
- **Ficha do produto** (feita no marco 4), aberta pelo Histórico ou pela ficha do item ("Todas as compras deste produto"): todas as compras do produto (em produção, embarcadas e entregues), com data, situação, fornecedor, PO ou invoice, quantidade, preço e total; e, para quem vê valores, o último preço, o menor e o maior e quanto o preço variou da primeira para a última compra. O produto é reconhecido pelo ISBN (ou, sem ISBN, pelo nome).
- **Fornecedores** (feita no marco 5): tabela com o que cada fornecedor tem em produção e no mar, o recebido no ano e desde 2023, e a última chegada; as somas são feitas no banco. A ficha do fornecedor traz o recebido por ano, leva aos itens em produção e deixa o editor corrigir o nome e anotar observações (contato, prazos). O painel ganhou o "Recebido no ano".
- **Novo pedido, Novo embarque e Registrar chegada** (feitos depois do marco 5, seção 3): botões na Produção (Novo pedido) e nos Embarques (Novo embarque e Registrar chegada), para admin e editor. Cada um mostra o que foi lido e o que vai acontecer antes de gravar.
- Todas as listas com busca, filtros e **Baixar .xlsx** (Produção, Embarques, Histórico e Fornecedores).
- **Cópia completa** (feita no marco 5; o lembrete mensal é decisão de 17/11/2026, na seção 2): no menu do admin, "Baixar cópia completa" gera uma planilha com as abas Produção, Embarques e Entregues, nas mesmas colunas da `status_importações`. Serve para guardar fora da Cloudflare e volta pela própria carga do sistema (há teste de ida e volta). Os Embarques baixados pela tela usam o mesmo formato.
- **Cores dos fornecedores**: espaçadas pelo ângulo áureo, começando pelos que têm mais itens, para os principais nunca ficarem parecidos.
- **Acessibilidade** (revisão do marco 5): auditoria automática (axe-core, WCAG 2.2 AA) em 50 telas e janelas, nos dois temas, no computador e no celular, sem violações. A única marcação que sobra é um alvo de toque coberto pelo menu do usuário aberto no celular, que é o próprio menu por cima da tela. Tudo funciona pelo teclado: entrar, navegar pelas abas, abrir e fechar as fichas (o foco volta para onde estava); as tabelas que rolam por dentro recebem foco. No celular, as abas rolam de lado com a aba atual à vista.

## 6. Regras de negócio (proposta)

Em `src/core`, com teste, como no No Prelo:

- Total do item = quantidade × preço unitário, conferido na carga (a planilha tem totais digitados).
- Situação do item, atraso do BL, saldo da PO e situação de pagamento da invoice.
- Valores do painel: somas por situação, fornecedor e mês de chegada.
- Valor em reais de um pagamento = valor em dólar × taxa de câmbio daquele pagamento.
- ISBN: mesmas regras do No Prelo (ISBN-13 ou ISBN-10, dígito verificador conferido). Produto sem ISBN é aceito, identificado pelo título.
- Dólar guardado em centavos e preço unitário em milionésimos de dólar, sempre com no máximo três casas (0,575 é guardado como 575.000), para não errar arredondamento. Taxa de câmbio com quatro casas.
- Uma PO, um fornecedor: o dono da PO e a recusa de item de outro fornecedor.
- Nos números em destaque (painel e totais por fornecedor), dólares inteiros, como US$ 3.042.056, para dar para comparar com a planilha; na tabela e na ficha, com centavos.
- Permissões, inclusive o que o leitor não pode ver.

## 7. Carga da planilha (proposta)

- **Produção**: cada linha vira um item em produção; a coluna sem título com "PO-0xx" dá a PO. Casos encontrados na planilha de 17/11/2026 e como entram:
  - Sem PO (71 linhas): entram sem PO e aparecem no grupo "Sem PO". Texto que não é código de PO nessa coluna (como "6k dec + 6k apr + 6k july") vai para as observações do item.
  - Sem preço (8 linhas, com total 0): entram sem preço e contam como "sem preço" nos totais.
  - Preço escrito com "R$" (6 linhas da Nicola, PO-067 e PO-068, como "R$2,06"): era erro de digitação, o preço é em dólar. Enquanto a planilha não é corrigida, essas linhas entram sem preço, com o texto original nas observações; o preço pode ser acertado na ficha do item.
  - ISBN com hífens: vale, sem os hífens. ISBN como "TBC", "new" ou com o dígito verificador errado: o item entra sem ISBN e o texto original vai para as observações.
  - Sem fornecedor (1 linha): entra como "Sem fornecedor", para corrigir na tela.
  - Peças por caixa que não são um número (como "24\n14"): ficam em branco, com o texto original nas observações.
  - Preço com mais de três casas (3 linhas, como 0,653924268502582 e 0,6539): arredondado na terceira casa (0,654), com aviso. Por isso o total do sistema fica US$ 6,53 acima da soma da planilha de 17/11/2026, até os preços serem arredondados lá também.
  - Item cuja PO é de outro fornecedor: entra sem PO, com a PO original nas observações (veja "Uma PO, um fornecedor" na seção 2).
  - Produtos diferentes com o mesmo ISBN (na PO-053, o box "Coleção Estratégia" e "O Livro dos Cinco Anéis"): entram os dois; ficam ligados ao mesmo produto até alguém corrigir o ISBN na ficha.
  - A linha de soma no fim da aba (produto "]") é ignorada.
  - Conferido com a planilha de 17/11/2026: 524 itens em 43 POs, 4.796.377 exemplares e US$ 3.042.056,46, iguais à linha de soma da aba.
- Cada item guarda a descrição como está na linha, e o produto é reconhecido pelo ISBN (ou, sem ISBN, pelo título). Assim, os nomes diferentes que o mesmo ISBN tem ao longo dos anos ficam preservados, e a ficha do produto junta todas as compras.
- Mandar a mesma planilha de novo não repete itens: um item igual (mesma PO, ISBN, nome do produto, quantidade e preço) já cadastrado é pulado. Linhas iguais dentro da mesma planilha entram todas.
- **Carga completa** (pedida pelo Gabriel em 17/11/2026, para começar do zero): no menu do admin, "Carga completa da planilha" lê as abas Produção, Embarques e Entregues do mesmo arquivo (a `status_importações` ou a cópia completa baixada do app), mostra o resumo de cada uma e grava nessa ordem. Quando o app já tem dados, a janela oferece apagar tudo antes (fornecedores, produtos, POs, itens, BLs, invoices, pagamentos e o histórico de alterações; os usuários ficam), com o botão para baixar a cópia completa antes e a palavra APAGAR para confirmar. Sem apagar, a carga pula o que já está igual, mas um item que mudou de aba na planilha fica duplicado: por isso a carga serve para começar, não para manter o app em dia. A tela inicial vazia leva à carga completa. As cargas de uma aba só continuam em cada tela.
- A carga é feita na tela Produção, pelo admin, em "Carga da planilha": o navegador lê a aba, mostra o resumo por fornecedor, as linhas com aviso e as que não entram, e só grava depois da confirmação, em partes de 500 itens.
- **Embarques** (feita no marco 3): cada linha vira um item embarcado, sem PO (a aba não tem a coluna); invoice e BL criam as invoices e os BLs; "Chegada" é a chegada prevista do BL, ou da invoice quando não há BL; "Pago" vira um pagamento sem data e sem câmbio, um por invoice. A ref. que o Google Planilhas transformou em data volta para AAAA-MM-DD. Mandar de novo não repete itens (mesma invoice, produto, quantidade e preço). Conferido com a planilha de 17/11/2026: 199 itens, 1.918.496 exemplares e US$ 1.157.134,50 em 23 invoices e 11 BLs, iguais à linha de soma; dois ISBNs com erro (linhas 132 e 177) entram sem ISBN, com aviso.
- **Entregues** (feita no marco 4): cada linha vira um item entregue. As colunas são lidas pela posição, porque o cabeçalho da aba está deslocado. A chegada está como texto sem ano ("chegada 29/08", "chegou 18/04", "Entregue 10-10", "porto 24/01") ou como data. O ano sai, nesta ordem: do ano escrito na célula; do bloco do ano na própria aba (as linhas 2024, 2025 e 2026 separam os anos de chegada; conferido em 17/11/2026, as 240 datas com ano escrito caem todas no bloco certo); do BL ou da invoice (ano e mês do embarque); do ano da ref.; e da ordem das linhas. Nunca cai no futuro. O texto original e de onde veio o ano ficam anotados na invoice.
  - "embarque" e "saída" são datas de embarque: o item entra sem data de chegada. Quando a coluna do pagamento traz a chegada ("chegada 25/01") e a da chegada traz a previsão, vale a chegada.
  - Sem invoice, vale a ref. como número da invoice; sem as duas, um bloco de linhas seguidas com a mesma chegada e o mesmo fornecedor ("Planilha, linha 719").
  - Item sem nome, mas com ISBN e quantidade (linhas 815, 1511 e 3045), entra como "Produto sem nome (ISBN …)", com aviso.
  - Os itens sem data (120: só data de embarque, ou nenhuma) entram como entregues, no grupo "Sem data".
  - Conferido com a planilha de 17/11/2026: 3.991 itens em 338 invoices e 24.125.502 exemplares; cada ano (2023: 3.818.977; 2024: 5.331.682; 2025: 7.773.076, contando os sem data; 2026: 7.201.767) bate com o subtotal da aba. O valor fica US$ 552 abaixo da soma dos subtotais, por totais digitados que não batem com quantidade × preço.
- Linhas sem fornecedor e sem produto (subtotais) são ignoradas. As abas cute e Sheet1 ficam de fora.
- Antes de gravar, a carga mostra um resumo (itens por aba, total em dólar por aba, linhas descartadas e por quê) para o Gabriel comparar com a planilha.

## 8. Base técnica

Igual à seção 9 do `SPEC.md` do No Prelo (`houchgabriel-wq/projectmanagement`), inclusive segurança e publicação automática a cada push em `main`. Login, usuários e sessão vêm do No Prelo, simplificados para os perfis admin, editor e leitor.

```
migrations/        migrações do D1, numeradas (0001_init.sql, ...)
src/app/           interface React
src/core/          regras de negócio puras, cada uma com teste
src/worker/        API, login e acesso ao banco
```

Segredo previsto: só o `SETUP_TOKEN`, pedido na tela de primeiro acesso. Fica no painel do Cloudflare.

Dependências: `npm audit` aponta, desde novembro de 2026, uma falha do `picomatch` (GHSA-fc5q-39xc-vjpf) sem versão corrigida. Ele só entra no Vite e no Vitest, ferramentas de build e de teste; não vai para o site nem para o Worker. O `npm audit fix --force` rebaixaria o Vite, então fica como está até sair a correção. O `exceljs` traz pacotes antigos (`glob`, `rimraf`, `fstream`) que só avisam na instalação e não rodam no navegador.

### Modelo de dados (proposta)

```
suppliers        id, name, notes
products         id, isbn (único quando existe), title
purchase_orders  id, code ("PO-063"), ordered_at, notes    (sem fornecedor: ele fica no item)
bills_of_lading  id, number ("ROECHN26101769"), supplier_id, eta, arrived_at, notes
invoices         id, number ("2026-47B"), ref ("2026-10-13 (2)"), supplier_id, bill_of_lading_id, notes
payments         id, invoice_id, paid_at, amount_cents, exchange_rate, notes
order_items      id, product_id, description, supplier_id, purchase_order_id, invoice_id, status
                 (producao | embarcado | entregue), quantity, pieces_per_carton,
                 unit_price_micros, notes
events           histórico automático de mudanças (entity, entity_id, type, detail), como no No Prelo
users, sessions, login_attempts   como no No Prelo
```

## 9. Direção visual

A mesma do No Prelo, para os dois sistemas parecerem da mesma casa: limpa e moderna, com mais cor, painel com destaque e cartões com hierarquia. Parte das variáveis de cor e da tipografia do No Prelo, com outra cor de destaque para distinguir os dois.

## 10. Pendências

Nenhuma no momento.

## 11. Depois da primeira versão

- Ligação com o No Prelo pelo ISBN.
- Custo final em reais por exemplar (frete, impostos, despachante), se o Gabriel quiser.
- Previsão de embarque nas POs.
