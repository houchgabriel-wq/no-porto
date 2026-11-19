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

## Depois

Sem prazo: ligação com o No Prelo pelo ISBN, custo final em reais por exemplar, conferência das solicitações com os embarques (avisar de embarque sem aprovação ou com mais containers que o aprovado).
