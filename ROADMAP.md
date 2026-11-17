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

- [ ] **Marco 4: histórico e produtos.**
  Carga da aba Entregues, com a lista de conferência das datas. Ficha do produto com todas as compras e preços.
  *Teste do Gabriel:* procurar alguns títulos que ele conhece e conferir quantidades e preços.

- [ ] **Marco 5: painel e acabamento.**
  Painel de valores, baixar .xlsx em todas as listas, tema escuro, celular, acessibilidade. A partir daqui a planilha sai de uso.
  *Teste do Gabriel:* conferir os números do painel e usar o app por uma semana no lugar da planilha.

## Depois

Sem prazo: ligação com o No Prelo pelo ISBN, custo final em reais por exemplar, previsão de embarque nas POs.
