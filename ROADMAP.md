# Roteiro

Cada marco termina com o sistema funcionando no ar e algo que o Gabriel consegue testar.

- [x] **Marco 0: especificação.** Decisões, propostas e pendências registradas no repositório (17/11/2026).

- [x] **Marco 1: base, login e usuários.**
  Projeto criado a partir do No Prelo (Worker, React, D1, testes, CI), primeiro acesso, login, usuários com os perfis admin, editor e leitor. Publicação automática no Cloudflare.
  *Teste do Gabriel:* criar o admin, um editor e um leitor e entrar com cada um.
  *Fechado em 17/11/2026:* no ar no Cloudflare; o Gabriel fez o primeiro acesso.

- [x] **Marco 2: POs em produção.**
  Fornecedores, produtos e POs com itens. Tabela com busca e filtros. Carga da aba Produção.
  *Teste do Gabriel:* conferir se o total em produção por fornecedor bate com a planilha.
  *Pronto para o teste em 17/11/2026:* tela Produção com os totais por fornecedor, busca, filtros, agrupamento por PO, ficha do item e Baixar .xlsx; carga da aba Produção pelo admin; painel só com a produção, por enquanto. Com a planilha de 17/11/2026, a carga dá 524 itens, 4.796.377 exemplares e US$ 3.042.056,46.
  *Fechado em 17/11/2026:* no ar; o Gabriel fez a carga e conferiu os totais. A pedido dele, o preço tem no máximo três casas e uma PO tem um fornecedor só (migração `0003`). Na planilha ajustada: 524 itens em 44 POs, 4.796.377 exemplares, sem POs com dois fornecedores; o total do sistema fica US$ 6,53 acima da soma da planilha por causa de três preços arredondados.

- [ ] **Marco 3: embarques e chegadas.**
  BLs (número e chegada prevista) com suas invoices; embarcar itens da PO (inteiros ou em parte); marcar entregue; lista de chegadas com atraso. Pagamentos por invoice com câmbio. Carga da aba Embarques.
  *Teste do Gabriel:* embarcar itens de uma PO real e conferir os embarques do mês com a planilha.
  *Pronto para o teste em 17/11/2026:* aba Embarques agrupada pela chegada (atrasados primeiro), ficha do embarque com "Chegou hoje", itens e pagamentos com câmbio; marcar itens na Produção e embarcar (inteiros ou em parte); painel com em produção, no mar, a pagar e próximas chegadas; carga da aba Embarques pelo admin (199 itens, US$ 1.157.134,50, com a planilha de 17/11/2026).

- [ ] **Marco 4: histórico e produtos.**
  Carga da aba Entregues, com a lista de conferência das datas. Ficha do produto com todas as compras e preços.
  *Teste do Gabriel:* procurar alguns títulos que ele conhece e conferir quantidades e preços.
  *Pronto para o teste em 17/11/2026:* aba Histórico com os anos em destaque, busca, filtros e Baixar .xlsx; ficha do produto com todas as compras e a variação do preço; carga da aba Entregues pelo admin, com o ano da chegada deduzido (3.991 itens, e cada ano bate com o subtotal da aba).

- [ ] **Marco 5: painel e acabamento.**
  Painel de valores, baixar .xlsx em todas as listas, tema escuro, celular, acessibilidade. A partir daqui a planilha sai de uso.
  *Teste do Gabriel:* conferir os números do painel e usar o app por uma semana no lugar da planilha.
  *Pronto para o teste em 17/11/2026:* tela Fornecedores (com recebido por ano, nome e observações), recebido no ano no painel, Baixar .xlsx em todas as listas, cópia completa no formato da planilha (admin), revisão de acessibilidade sem violações e abas que rolam no celular.

- [ ] **Marco 6: documentos dos fornecedores.**
  Novo pedido pelo Excel da PO; novo embarque pela invoice ou packing list, tirando da produção do mesmo fornecedor, a mais antiga primeiro; registrar a chegada de cada invoice.
  *Teste do Gabriel:* cadastrar a próxima PO pelo arquivo, registrar o próximo embarque pela invoice do fornecedor e marcar a chegada do próximo container.
  *Pronto para o teste em 17/11/2026:* carga completa da planilha (as três abas de uma vez, com a opção de apagar antes para começar do zero); lidos sem erro os arquivos reais da PO-062 (Claire), PO-064 (Sara) e PO-065 (Nicola) e as invoices CTNR04 da Claire, HSC20260920 da Nicola e GN-509 da Brijbasi.

- [ ] **Marco 7: solicitações de embarque.**
  O agente de cargas cadastra o que cada fornecedor pede para um embarque (fornecedor, containers de cada tipo, saída e valor de cada container) e só o Gabriel aprova ou recusa; aviso no painel.
  *Teste do Gabriel:* criar a conta do agente em Usuários (perfil Agente de cargas), pedir que ele cadastre a próxima solicitação real, aprovar ou recusar pelo No Porto e conferir com o agente que ele viu a resposta.
  *Pronto para o teste em 19/11/2026:* perfil Agente de cargas, que vê só as próprias solicitações (o servidor recusa todo o resto); aba Solicitações para admin, editor e Consulta, com o contador das que aguardam; aviso no topo do painel; ficha com os containers e a situação do fornecedor (produção, mar, última chegada e outras solicitações); aprovar, podendo aprovar menos que o pedido, ou recusar com o motivo, só pela conta do Gabriel (migração `0009`); o agente cancela enquanto aguarda. Auditoria de acessibilidade sem violações em 40 telas e janelas, nos dois temas, no computador e no celular.

- [x] **Marco 8: previsão de estoque.**
  Carga semanal da curva ABC; cobertura, sugestão de reimpressão e aviso de embarque de cada título, cruzando a curva com o que está embarcado e em produção; cartão no painel.
  *Teste do Gabriel:* carregar a curva da semana, conferir alguns títulos que ele conhece (cobertura, sugestão e prazo de embarque) e baixar a planilha.
  *Pronto para o teste em 20/11/2026:* aba Estoque (admin, editor, Consulta e leitor) com os quatro cartões que filtram, busca, classe, só importados, ordem, tabela com as colunas de 3 e de 6 meses, ficha de cada título com o porquê de cada número, lista do que está no No Porto e não está na curva e Baixar .xlsx; carga da curva por admin e editor, com a data do estoque lida do nome do arquivo (migração `0012`); cartão no painel. Com a curva de 19/11/2026: 2.457 títulos, um de fora (conteúdo digital) e dois códigos somados. Auditoria de acessibilidade sem violações na aba, na ficha, na carga e no painel, nos dois temas, no computador e no celular.
  *Fechado em 20/11/2026:* no ar; o Gabriel carregou a curva e conferiu os títulos.

- [x] **Ligação com o No Estoque.**
  A chegada de um container vira uma entrada prevista no No Estoque (decidido pelo Gabriel em 24/11/2026): a porta interna `NoEstoqueApi` entrega as chegadas a partir de um dia, com os itens da packing list e sem valores (SPEC, seção 8).
  *Teste do Gabriel:* registrar a chegada de um container e ver a entrada prevista nas Chegadas do No Estoque.
  *Pronto para o teste em 26/11/2026:* a porta e os testes; chamada de outro Worker pela ligação interna, no simulador da Cloudflare, com o banco local, sem nenhum valor na resposta.
  *Testada em 26/11/2026:* as chegadas apareceram no No Estoque de teste; depois do teste, o Gabriel pediu os containers em liberação.
  *Ajustada em 26/11/2026:* também os containers em liberação (pedido do Gabriel), com a previsão, o peso e o volume do container.
  *Fechado em 26/11/2026:* no ar; o Gabriel conferiu os containers em liberação nas Chegadas do No Estoque de teste.
  *Nota fiscal, pronta para o teste em 27/11/2026 (pedido do Gabriel):* a ficha do embarque guarda a nota fiscal de cada container e, no BL com mais de um container, a nota master, com o PDF e o XML (migração `0024`); o XML é lido (o número, a série, o dia e a situação na Sefaz), e a ficha avisa do PDF de outra nota e da nota repetida. A porta manda as duas notas em cada chegada e entrega o PDF e o XML inteiros pelo método novo `fiscalFile` (SPEC, seção 8); o No Estoque precisa passar a ler os campos novos. No Histórico e na ficha do produto, a invoice abre a ficha do embarque, com os arquivos, também depois dos 60 dias. Conferido no navegador com notas de teste (o PDF e o XML de dois containers e da master, o XML de um CT-e recusado, o PDF de outra nota avisado) e com um BL que chegou em agosto, aberto pelo Histórico. Quem vê valores baixa; leitor e Embarques não veem as notas. Auditoria de acessibilidade sem violações, nos dois temas, no computador e no celular.
  *Teste do Gabriel:* anexar a nota de cada container e a master de um BL com dois containers, conferir o número e o dia na ficha e, com o No Estoque ajustado, ver as notas na entrada prevista de lá.

- [ ] **Marco 9: produção no Brasil.**
  Os orçamentos com as gráficas do Brasil (várias propostas por produto, fechar com uma), a produção até a entrega no estoque, em uma ou mais entregas, e a visão junto com a importação no painel, no terminal de consulta e na previsão de estoque (decidido pelo Gabriel em 27/11/2026; SPEC, seções 2 e 3).
  Em duas partes: primeiro a sub-aba Brasil em Produção, com orçamentos, propostas, pedidos e entregas; depois a visão junto com a importação.
  *Teste do Gabriel:* o Marcelo cadastra os próximos orçamentos com as propostas das gráficas, fecha um, registra as entregas, e o Gabriel confere tudo junto com a importação.
  *Primeira parte pronta para o teste em 27/11/2026:* Produção › Brasil com o resumo, os orçamentos e as propostas das gráficas, com os itens (o kit com o box e os livros), o papel da gráfica ou o nosso (pela tabela de papéis, com o preço por kg ajustável), o custo por unidade e o PDF (a de menor custo em destaque); fechar com uma, os pedidos em produção e as entregas em partes (migrações `0021` e `0022`). Conferido com as propostas reais da Assahi (103896.04, papel nosso) e da Grafilar (117.627, kit). O leitor vê sem os valores; Embarques, Vendas e o Agente de cargas são recusados. Auditoria de acessibilidade sem violações na sub-aba e nas janelas, nos dois temas, no computador e no celular.
  *Segunda parte pronta para o teste em 27/11/2026:* a produção no Brasil junto com a importação, pelo ISBN. No painel, o bloco Produção no Brasil no destaque (o que falta entregar, em reais) e a lista das próximas entregas das gráficas; no terminal de consulta, o número Produção no Brasil, as entregas na última chegada e o que só é feito no Brasil; na previsão de estoque, a coluna Brasil, que conta como o embarcado na cobertura, na reimpressão e no prazo do embarque; na ficha do produto, os pedidos no Brasil, com o custo por exemplar para quem vê valores. Conferido com a curva ABC real e três pedidos de teste (Meditações na Assahi, com uma entrega depois da curva; 365 Hábitos e Noites Brancas, só no Brasil). Os atalhos do painel para a produção de um fornecedor voltam a abrir a Importação. O leitor vê sem os valores; auditoria de acessibilidade sem violações, nos dois temas, no computador e no celular.
  *Orçamento com vários livros e o PDF da proposta, prontos para o teste em 27/11/2026 (pedido do Gabriel):* o orçamento com vários produtos (o box Curso Básico de Desenho, os 3 livros dentro dele e o avulso do Mangá), a proposta ligada aos produtos, com o custo por kit separado do avulso, e as entregas de cada produto; o que vai dentro do box não conta no estoque. Ao subir o PDF da gráfica, o sistema lê a gráfica, os itens com a especificação, as quantidades, os preços e o papel nosso, com o preço da tabela de papéis; o orçamento novo pode começar pelo PDF. Conferido com as propostas reais da Grafilar (117.627) e da Assahi (103896.04): R$ 13,33 por kit e R$ 3,29 o avulso; R$ 2,6722 por livro com o papel nosso (migração `0023`). Auditoria de acessibilidade sem violações, nos dois temas, no computador e no celular.

## Depois

Sem prazo: o resto da ligação com o No Prelo pelo ISBN (a aprovação do arquivo já vem de lá, desde 19/11/2026), custo final em reais por exemplar, conferência das solicitações com os embarques (avisar de embarque sem aprovação ou com mais containers que o aprovado).
