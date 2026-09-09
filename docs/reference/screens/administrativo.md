# Telas — Administrativo

Detalhamento tela a tela (sistema de referência). Legenda: **R** = obrigatório observado (atributo required/asterisco), tipo = tipo do controle HTML observado; "Opções" mostra amostra (até 8) das opções de listas.

## SCR-006 · Documento Fiscal

- **Rota:** `/admin/invoices`
- **Módulo:** Administrativo > Estoque > Doc. Fiscal/Entrada
- **Tipo:** Listagem
- **Finalidade:** Doc. Fiscal/Entrada (listagem)
- **Botões/Ações (cabeçalho):** Saiba +; Adicionar Novo → `/admin/invoices/create`

**Filtros (GET)** — botões: Filtrar

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `search` | Doc. Fiscal | text |  |
| `farm_id` | Fazenda | select | Todas, Fazenda Maira, Fazenda São Paulo |
| `start_date` | Dt. Início | text (data) |  |
| `end_date` | Dt. Fim | text (data) |  |
| `provider` | Fornecedor | select | (lista dinâmica de cadastro — 39 registros; valores omitidos por privacidade) … (39) |
| `product` | Produto | select |  |
| `proprietary_id` | Proprietário Gestor | select | (lista dinâmica de cadastro — 1 registros; valores omitidos por privacidade) |
| `integration` | Emissão | select | Todas, ⚠️ Manual, ✅ Automática |
| `vl_total` | Vlr Título | text |  |

**Tabela** (N. Registros: 0) — linhas na amostra: 1

- Colunas: Código | Documento Fiscal | Série | Fornecedor | Vl. Total | Dt. Emissão | Dt. Entrega | Emissão | Ação

## SCR-007 · DFe Recebidas

- **Rota:** `/admin/dfe`
- **Módulo:** Administrativo > Estoque > DFe Recebidas
- **Tipo:** Listagem
- **Finalidade:** DFe Recebidas (listagem)
- **Botões/Ações (cabeçalho):** Saiba +; Manifestar; Lançar Despesa em Lote; Buscar DFe → `/admin/dfe/create`
- **Modais:** Manifestar Documento

**Filtros (GET)** — botões: Filtrar

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `issue_id` | Selecione o Emissor | select | (lista dinâmica de cadastro — 1 registros; valores omitidos por privacidade) |
| `search` | Pesquisar por nome, CPF/CNPJ, IE | text |  |
| `start_date` | Dt. Início | text (data) |  |
| `end_date` | Dt. Fim | text (data) |  |
| `launched` | Lançada | select | Lançada, Não Lançada |
| `status` | Manifesto | select | Todos, Sem Manifestação, Ciência de operação, Confirmação, Desconhecimento, Operação não realizada |
| `pagination_quantity` | Qtd. de Registros | select | 10 Registros, 20 Registros, 30 Registros, 50 Registros, 80 Registros, 100 Registros, 200 Registros |
| `is_personal` | Pessoal | select | (lista dinâmica de cadastro — 2 registros; valores omitidos por privacidade) |
| `is_shipment` | Remessa | select | Sim, Não |

**Tabela** (N. Registros: 0) — linhas na amostra: 1

- Colunas: (seleção) | (seleção) | Fornecedor | IE Fornecedor | IE Destinatário | Número NFe | Valor | Dt. Emissão | Manifesto | Prazo Manifesto | Lançada | Ação

**Formulário POST `/admin/dfe/manifestar`** (modal modal-acao)

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `evento` | Selecione o Evento | select | R |  | Ciência de operação, Confirmação, Desconhecimento, Operação não realizada |  |
| `justificativa` | Informe uma justificativa para este evento com mais de 15 caracteres | text |  |  |  |  |

## SCR-008 · Formulação

- **Rota:** `/admin/foods`
- **Módulo:** Administrativo > Estoque > Fábrica > Formulação
- **Tipo:** Listagem
- **Finalidade:** Formulação (listagem)
- **Botões/Ações (cabeçalho):** Adicionar Novo → `/admin/foods/create`
- **Modais:** Importar

**Filtros (GET)** — botões: Filtrar

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `product_id` | Produto | select | Dieta Adaptação, Dieta Crescimento, Dieta Engorda |
| `user_id` | Responsável | select | (lista dinâmica de cadastro — 1 registros; valores omitidos por privacidade) |
| `start_date` | Dt. Inicio | text |  |
| `end_date` | Dt. Final | text |  |

**Tabela** (N. Registros: 0) — linhas na amostra: 1

- Colunas: Código | Data | Produto | Responsável | Ação

**Formulário POST `/admin/equipments/import`** (modal modalImport) — botões: Importar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `file` |  | file | R |  |  |  |

## SCR-067 · SLA Status

- **Rota:** `/admin/supply-status`
- **Módulo:** Administrativo > Suprimentos > Parâmetros SLA
- **Tipo:** Listagem
- **Finalidade:** Parâmetros SLA (listagem)

**Tabela** (N. Registros: 11) — linhas na amostra: 11

- Colunas: # | Status | Max. Horas | Ação
- Ações por linha: Editar
- Links por linha: `/admin/supply-status/{id}/edit`

## SCR-068 · Meus Processos

- **Rota:** `/admin/my-proccesses`
- **Módulo:** Administrativo > Suprimentos > Meus Processos
- **Tipo:** Listagem
- **Finalidade:** Meus Processos (listagem)
- **Modais:** Voltar Etapa da Solicitação

**Tabela** (N. Registros: 1) — linhas na amostra: 1

- Colunas: (seleção) | Código | Dt. Pedido | Descrição/Chamado | Duração | Solicitante | Responsável Atual | Fazenda | Cot. Recebidas | Ação
- Ações por linha: Visualizar, Relatório SLA, Acusar ciência, Voltar Etapa
- Links por linha: `/admin/request-purchase/{id}`, `/admin/supply-status-report?id=15471`, `/admin/request-authorization/{id}/second`

**Formulário POST `/admin/my-proccesses`** (modal changeStatusModal) — botões: Salvar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `code` | Código | text |  |  |  |  |
| `date` | Dt. Pedido | text |  |  |  |  |
| `duration` | Duração | text |  |  |  |  |
| `requester` | Solicitante | text |  |  |  |  |
| `farm` | Fazenda | text |  |  |  |  |
| `statusOld` | Status Atual | text |  |  |  |  |
| `status` | Mudar para Status | select | R |  |  |  |
| `justify` | Justificativa | textarea | R |  |  |  |

## SCR-069 · Solicitação

- **Rota:** `/admin/request-purchase`
- **Módulo:** Administrativo > Suprimentos > Solicitação
- **Tipo:** Listagem
- **Finalidade:** Solicitação (listagem)
- **Botões/Ações (cabeçalho):** Saiba +; Adicionar Novo → `/admin/request-purchase/create`
- **Modais:** Voltar Etapa da Solicitação

**Filtros (GET)** — botões: Filtrar

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `search` | Pesquisar por descrição/chamado/código | text |  |
| `status` | Status | select | Solicitação, Cotação em Andamento, Aguardando Aprovação, Aguardando Ciência, Pedido Não Aprovado, Aguardando a Compra, Compra Efetuada, Compra Recebida … (11) |
| `type` | Tipo | select | Produto, Serviço, Adiantamento, Reembolso, Diária, Empreita, Compra Efetuada, Frete … (11) |
| `start_date` | Pedido / Dt. Início | text |  |
| `end_date` | Pedido / Dt. Fim | text |  |

**Tabela** (N. Registros: 0) — linhas na amostra: 1

- Colunas: (seleção) | Código | Dt. Pedido | Descrição/Chamado | Duração | Solicitante | Responsável Atual | Fazenda | Ação

**Formulário POST `/admin/request-purchase`** (modal changeStatusModal) — botões: Salvar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `code` | Código | text |  |  |  |  |
| `date` | Dt. Pedido | text |  |  |  |  |
| `duration` | Duração | text |  |  |  |  |
| `requester` | Solicitante | text |  |  |  |  |
| `farm` | Fazenda | text |  |  |  |  |
| `statusOld` | Status Atual | text |  |  |  |  |
| `status` | Mudar para Status | select | R |  |  |  |
| `justify` | Justificativa | textarea | R |  |  |  |

## SCR-070 · Rejeitados/Cancelados

- **Rota:** `/admin/rejected-requests`
- **Módulo:** Administrativo > Suprimentos > Rejeitados/Cancelados
- **Tipo:** Listagem
- **Finalidade:** Rejeitados/Cancelados (listagem)

**Filtros (GET)** — botões: Filtrar

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `search` | Pesquisar por descrição/chamado/código | text |  |
| `type` | Tipo | select | Produto, Serviço, Adiantamento, Reembolso, Diária, Empreita, Compra Efetuada, Frete … (11) |
| `start_date` | Pedido / Dt. Início | text |  |
| `end_date` | Pedido / Dt. Fim | text |  |

**Tabela** (N. Registros: 0) — linhas na amostra: 1

- Colunas: (seleção) | Código | Dt. Pedido | Descrição/Chamado | Duração | Solicitante | Responsável Atual | Fazenda | Ação

## SCR-071 · Cotações

- **Rota:** `/admin/request-quotation`
- **Módulo:** Administrativo > Suprimentos > Cotações
- **Tipo:** Listagem
- **Finalidade:** Cotações (listagem)
- **Botões/Ações (cabeçalho):** Saiba +
- **Modais:** Voltar Etapa da Solicitação
- **Paginação:** sim (server-side, seletor de quantidade 10–200)

**Filtros (GET)** — botões: Filtrar

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `search` | Pesquisar por descrição/chamado/código | text |  |
| `status` | Status | select | Solicitação, Cotação em Andamento |
| `type` | Tipo | select | Produto, Serviço, Adiantamento, Reembolso, Diária, Empreita, Compra Efetuada, Frete … (11) |
| `farm` | Fazenda | select | Fazenda Maira, Fazenda São Paulo |
| `user` | Solicitante | select | (lista dinâmica de cadastro — 14 registros; valores omitidos por privacidade) … (14) |
| `priority` | Prioridade | select | Baixa, Média, Alta |
| `start_date` | Pedido / Dt. Início | text |  |
| `end_date` | Pedido / Dt. Fim | text |  |
| `responsible` | Responsável Atual | select | (lista dinâmica de cadastro — 14 registros; valores omitidos por privacidade) … (14) |

**Tabela** (N. Registros: 12) — linhas na amostra: 10

- Colunas: (seleção) | Código | Dt. Pedido | Descrição/Chamado | Duração | Solicitante | Resp. Atual | Fazenda | Cot. Recebidas | Refazer | Ação
- Ações por linha: Visualizar, Relatório SLA, Transferir Responsável
- Links por linha: `/admin/request-purchase/{id}`, `/admin/supply-status-report?id=15190`, `/admin/request-purchase/{id}/change`

**Formulário POST `/admin/request-quotation`** (modal changeStatusModal) — botões: Salvar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `code` | Código | text |  |  |  |  |
| `date` | Dt. Pedido | text |  |  |  |  |
| `duration` | Duração | text |  |  |  |  |
| `requester` | Solicitante | text |  |  |  |  |
| `farm` | Fazenda | text |  |  |  |  |
| `statusOld` | Status Atual | text |  |  |  |  |
| `status` | Mudar para Status | select | R |  |  |  |
| `justify` | Justificativa | textarea | R |  |  |  |

## SCR-072 · Autorização

- **Rota:** `/admin/request-authorization`
- **Módulo:** Administrativo > Suprimentos > Autorização
- **Tipo:** Listagem
- **Finalidade:** Autorização (listagem)
- **Botões/Ações (cabeçalho):** Saiba +
- **Modais:** Voltar Etapa da Solicitação

**Filtros (GET)** — botões: Filtrar

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `search` | Pesquisar por descrição/chamado/código | text |  |
| `status` | Status | select | Aguardando Aprovação, Aguardando Ciência, Analisar Processo |
| `type` | Tipo | select | Produto, Serviço, Adiantamento, Reembolso, Diária, Empreita, Compra Efetuada, Frete … (11) |
| `start_date` | Pedido / Dt. Início | text |  |
| `endDate` | Pedido / Dt. Fim | text |  |

**Tabela** (N. Registros: 1) — linhas na amostra: 1

- Colunas: (seleção) | Código | Dt. Pedido | Descrição/Chamado | Duração | Solicitante | Fazenda | Responsável Atual | Ação
- Links por linha: `/admin/request-authorization/{id}/second`

**Formulário POST `/admin/request-authorization`** (modal changeStatusModal) — botões: Salvar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `code` | Código | text |  |  |  |  |
| `date` | Dt. Pedido | text |  |  |  |  |
| `duration` | Duração | text |  |  |  |  |
| `requester` | Solicitante | text |  |  |  |  |
| `farm` | Fazenda | text |  |  |  |  |
| `statusOld` | Status Atual | text |  |  |  |  |
| `status` | Mudar para Status | select | R |  |  |  |
| `justify` | Justificativa | textarea | R |  |  |  |

## SCR-073 · Compras

- **Rota:** `/admin/request-buy`
- **Módulo:** Administrativo > Suprimentos > Compras
- **Tipo:** Listagem
- **Finalidade:** Compras (listagem)
- **Botões/Ações (cabeçalho):** Transferir Responsável em Lote; Saiba +
- **Modais:** Voltar Etapa da Solicitação
- **Paginação:** sim (server-side, seletor de quantidade 10–200)

**Filtros (GET)** — botões: Filtrar

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `search` | Pesquisar por descrição/chamado/código | text |  |
| `status` | Status | select | Solicitação, Cotação em Andamento, Aguardando Aprovação, Aguardando Ciência, Pedido Não Aprovado, Aguardando a Compra, Compra Efetuada, Compra Recebida … (11) |
| `type` | Tipo | select | Produto, Serviço, Adiantamento, Reembolso, Diária, Empreita, Compra Efetuada, Frete … (11) |
| `farm` | Fazenda | select | Fazenda Maira, Fazenda São Paulo |
| `user` | Solicitante | select | (lista dinâmica de cadastro — 14 registros; valores omitidos por privacidade) … (14) |
| `priority` | Prioridade | select | Baixa, Média, Alta |
| `start_date` | Pedido / Dt. Início | text |  |
| `end_date` | Pedido / Dt. Fim | text |  |
| `responsible` | Responsável Atual | select | (lista dinâmica de cadastro — 14 registros; valores omitidos por privacidade) … (14) |

**Tabela** (N. Registros: 19) — linhas na amostra: 10

- Colunas: (seleção) | (seleção) | Código | Dt. Pedido | Descrição/Chamado | Duração | Solicitante | Responsável Atual | Fazenda | Ação
- Ações por linha: Enviar pedido de compras., Visualizar, Relatório SLA, Transferir Responsável, Download Arquivo
- Links por linha: `/admin/request-buy/{id}/whatsapp`, `/admin/request-buy/{id}/email`, `/admin/request-purchase/{id}`, `/admin/supply-status-report?id=22157`, `/admin/request-purchase/{id}/change`, `/admin/request-buy/pedido_orcamento_fazenda_maira_key6a9561ac7bf73/order`

**Formulário POST `/admin/request-buy`** (modal changeStatusModal) — botões: Salvar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `code` | Código | text |  |  |  |  |
| `date` | Dt. Pedido | text |  |  |  |  |
| `duration` | Duração | text |  |  |  |  |
| `requester` | Solicitante | text |  |  |  |  |
| `farm` | Fazenda | text |  |  |  |  |
| `statusOld` | Status Atual | text |  |  |  |  |
| `status` | Mudar para Status | select | R |  |  |  |
| `justify` | Justificativa | textarea | R |  |  |  |

## SCR-074 · Recebimentos

- **Rota:** `/admin/request-receipts`
- **Módulo:** Administrativo > Suprimentos > Recebimentos
- **Tipo:** Listagem
- **Finalidade:** Recebimentos (listagem)
- **Botões/Ações (cabeçalho):** Saiba +
- **Modais:** Voltar Etapa da Solicitação
- **Paginação:** sim (server-side, seletor de quantidade 10–200)

**Filtros (GET)** — botões: Filtrar

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `search` | Pesquisar por descrição/chamado/código | text |  |
| `status` | Status | select | Solicitação, Cotação em Andamento, Aguardando Aprovação, Aguardando Ciência, Pedido Não Aprovado, Aguardando a Compra, Compra Efetuada, Compra Recebida … (11) |
| `start_date` | Pedido / Dt. Início | text |  |
| `end_date` | Pedido / Dt. Fim | text |  |
| `user` | Solicitante | select | (lista dinâmica de cadastro — 13 registros; valores omitidos por privacidade) … (13) |
| `farm_id` | Fazenda | select | Fazenda Maira, Fazenda São Paulo |
| `type` | Tipo | select | Produto, Serviço, Adiantamento, Reembolso, Diária, Empreita, Compra Efetuada, Frete … (11) |
| `responsible` | Responsável Atual | select | (lista dinâmica de cadastro — 13 registros; valores omitidos por privacidade) … (13) |

**Tabela** (N. Registros: 19) — linhas na amostra: 10

- Colunas: (seleção) | Código | Tipo | Dt. Pedido | Descrição/Chamado | Nº NFe | Duração | Solicitante | Resp. Atual | Fazenda | Dt. Atualização | Lançado | Ação
- Ações por linha: Visualizar, Relatório SLA, Transferir Responsável
- Links por linha: `/admin/request-purchase/{id}`, `/admin/supply-status-report?id=15190`, `/admin/request-purchase/{id}/change`

**Formulário POST `/admin/request-receipts`** (modal changeStatusModal) — botões: Salvar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `code` | Código | text |  |  |  |  |
| `date` | Dt. Pedido | text |  |  |  |  |
| `duration` | Duração | text |  |  |  |  |
| `requester` | Solicitante | text |  |  |  |  |
| `farm` | Fazenda | text |  |  |  |  |
| `statusOld` | Status Atual | text |  |  |  |  |
| `status` | Mudar para Status | select | R |  |  |  |
| `justify` | Justificativa | textarea | R |  |  |  |

## SCR-075 · Entrada/Insumos

- **Rota:** `/admin/input-entries`
- **Módulo:** Administrativo > Estoque > Entrada/Insumos
- **Tipo:** Listagem
- **Finalidade:** Entrada/Insumos (listagem)
- **Botões/Ações (cabeçalho):** Adicionar Novo → `/admin/input-entries/create`

**Filtros (GET)** — botões: Filtrar

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `farm_id` | Fazenda | select | Todas, Fazenda Maira, Fazenda São Paulo |
| `proprietary_id` | Proprietário Gestor | select | (lista dinâmica de cadastro — 2 registros; valores omitidos por privacidade) |
| `start_date` | Data Inicial | text |  |
| `end_date` | Data Final | text |  |

**Tabela** (Registros: 0) — linhas na amostra: 1

- Colunas: Código | Data | Fazenda | Responsável | Produtos | Vl. Total | Ações

## SCR-076 · Aprovação de Notas Fiscais

- **Rota:** `/admin/dfe-drafts`
- **Módulo:** Administrativo > Estoque > Aprovação de Notas
- **Tipo:** Listagem
- **Finalidade:** Aprovação de Notas (listagem)
- **Botões/Ações (cabeçalho):** DFe Recebidas → `/admin/dfe`

**Filtros (GET)** — botões: Filtrar

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `search` | Buscar por fornecedor ou nº da nota | text |  |

**Tabela** — linhas na amostra: 1

- Colunas: (seleção) | Nota / Fornecedor | Valor | Lançamento | Situação | Ação

- Mensagens/alertas: 0 nota(s) selecionada(s) — total 0,00 Limpar seleção Aprovar selecionadas

## SCR-077 · Perfis de Lançamento por Fornecedor

- **Rota:** `/admin/provider-launch-profiles`
- **Módulo:** Administrativo > Estoque > Perfis de Lançamento
- **Tipo:** Listagem
- **Finalidade:** Perfis de Lançamento (listagem)
- **Botões/Ações (cabeçalho):** Adicionar Novo → `/admin/provider-launch-profiles/create`

**Filtros (GET)** — botões: Filtrar

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `search` | Buscar por fornecedor ou CPF/CNPJ | text |  |
| `destination` | Tipo de lançamento | select | Nota de Produto, Nota de Despesa, Nota de Animal |

**Tabela** — linhas na amostra: 1

- Colunas: Fornecedor | Lançar como | Rateio padrão | Tipo de título | Ação

## SCR-078 · Baixa de Estoque

- **Rota:** `/admin/stock-writeoffs`
- **Módulo:** Administrativo > Estoque > Baixa de Estoque
- **Tipo:** Listagem
- **Finalidade:** Baixa de Estoque (listagem)
- **Botões/Ações (cabeçalho):** Saiba +; Adicionar Novo → `/admin/stock-writeoffs/create`

**Filtros (GET)** — botões: Filtrar

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `start_date` | Dt. Início | text |  |
| `end_date` | Dt. Fim | text |  |

**Tabela** (N. Registros: 0) — linhas na amostra: 1

- Colunas: Código | Responsável | Armazém | Dt. Emissão | Ação

## SCR-079 · Requisição do Estoque

- **Rota:** `/admin/requisitions`
- **Módulo:** Administrativo > Estoque > Requisição/Saída
- **Tipo:** Listagem
- **Finalidade:** Requisição/Saída (listagem)
- **Botões/Ações (cabeçalho):** Saiba +; Importar → `#` (modal #modalImport); Adicionar Novo → `/admin/requisitions/create`
- **Modais:** Importar Documento Assinado; Importar

**Filtros (GET)** — botões: Filtrar

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `product` | Produto | select | Caroco Algodão, DECTOMAX INJETAVEL 500ML, PROMILL, SORGO GRÃO |
| `warehouse` | Armazém | select | BARRACAO |
| `center` |  | select | Administração, Estoque Insumos, Estoque Produção, Parque Máquinas, Soja, Soja Precoce, Soja Super Precoce, Terminação - Corte |
| `harvest` | Safra | select | Safra 1, TESTE, Safra 2024/2025, Safra 2023/2024, Safra 2023/2024 |
| `start_date` | Dt. Início | text |  |
| `end_date` | Dt. Fim | text |  |

**Tabela** (N. Registros: 0) — linhas na amostra: 1

- Colunas: (seleção) | Código | Dt. Emissão | Solicitante | Usuário | Itens | Status

**Formulário POST `/admin/requisitions`** (modal modalImportDocument) — botões: Importar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `file` |  | file | R |  |  |  |

**Formulário POST `/admin/requisitions-import`** (modal modalImport) — botões: Importar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `file` |  | file | R |  |  |  |

## SCR-080 · Devolução do Estoque

- **Rota:** `/admin/devolution`
- **Módulo:** Administrativo > Estoque > Devolução/Entrada
- **Tipo:** Listagem
- **Finalidade:** Devolução/Entrada (listagem)
- **Botões/Ações (cabeçalho):** Saiba +; Importar → `#` (modal #modalImport); Adicionar Novo → `/admin/devolution/create`
- **Modais:** Importar Documento Assinado; Importar

**Filtros (GET)** — botões: Filtrar

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `product` | Produto | select | aaaaa1, aaaaa2, aaaaa3, aaaaa4, ABRACADEIRA 13/19, adubo, ALICATE ACO TEMPERADO UNIVERSAL ISOLADO, ALTERNADOR ESTACIONADO … (113) |
| `warehouse` | Armazém | select | BARRACAO |
| `center[]` |  | select | Administração, Estoque Insumos, Estoque Produção, Parque Máquinas, Soja, Soja Precoce, Soja Super Precoce, Terminação - Corte |
| `harvest` | Safra | select | Safra 1, TESTE, Safra 2024/2025, Safra 2023/2024, Safra 2023/2024 |
| `start_date` | Dt. Início | text |  |
| `end_date` | Dt. Fim | text |  |

**Tabela** (N. Registros: 0) — linhas na amostra: 1

- Colunas: (seleção) | Código | Dt. Emissão | Usuário | Itens | Status

**Formulário POST `/admin/devolution`** (modal modalImportDocument) — botões: Importar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `file` |  | file | R |  |  |  |

**Formulário POST `/admin/devolutions-import`** (modal modalImport) — botões: Importar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `file` |  | file | R |  |  |  |

## SCR-081 · Correção de Estoque

- **Rota:** `/admin/stock-corrections`
- **Módulo:** Administrativo > Estoque > Correção de Estoque
- **Tipo:** Listagem
- **Finalidade:** Correção de Estoque (listagem)
- **Botões/Ações (cabeçalho):** Importar → `#` (modal #modalImport)
- **Modais:** Importar

**Filtros (GET)** — botões: Filtrar

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `start_date` | Dt. Início | text |  |
| `end_date` | Dt. Fim | text |  |

**Tabela** (N. Registros: 0) — linhas na amostra: 1

- Colunas: Código | Responsável | Dt. Emissão | Ação

**Formulário POST `/admin/stock-corrections/import`** (modal modalImport) — botões: Importar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `file` |  | file | R |  |  |  |

## SCR-082 · Transferência de Armazém

- **Rota:** `/admin/warehouse-transfer`
- **Módulo:** Administrativo > Estoque > Trans. Armazém
- **Tipo:** Listagem
- **Finalidade:** Trans. Armazém (listagem)
- **Botões/Ações (cabeçalho):** Saiba +; Adicionar Novo → `/admin/warehouse-transfer/create`

**Filtros (GET)** — botões: Filtrar

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `product` | Produto | select | Milho Grão, Soja Bônus, Soja em grãos, Milho 2024, Glifosato, FILTRO DE OLEO, BUCHA DE PARAFUSO, APONTADOR AVENGERS COPO C 36 … (113) |
| `warehouse` | Armazém | select | BARRACAO |
| `harvest` | Safra | select | Safra 1, TESTE, Safra 2024/2025, Safra 2023/2024, Safra 2023/2024 |
| `start_date` | Dt. Início | text |  |
| `end_date` | Dt. Fim | text |  |

**Tabela** (N. Registros: 0) — linhas na amostra: 1

- Colunas: Código | Produto | Quantidade | Un. Medida | Armazém | Armazém Destino | Usuário | Dt. Emissão | Ação

## SCR-083 · Transferência de Armazém entre Fazendas

- **Rota:** `/admin/warehouse-transfer-between-farms`
- **Módulo:** Administrativo > Estoque > Trans. Fazendas
- **Tipo:** Listagem
- **Finalidade:** Trans. Fazendas (listagem)
- **Botões/Ações (cabeçalho):** Saiba +; Adicionar Novo → `/admin/warehouse-transfer-between-farms/create`

**Filtros (GET)** — botões: Filtrar

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `product` | Produto | select | Milho Grão, Soja Bônus, Soja em grãos, Milho 2024, Glifosato, FILTRO DE OLEO, BUCHA DE PARAFUSO, APONTADOR AVENGERS COPO C 36 … (113) |
| `farm` | Fazenda | select | Fazenda Maira, Fazenda São Paulo |
| `warehouse` | Armazém | select | BARRACAO |
| `start_date` | Dt. Início | text |  |
| `end_date` | Dt. Fim | text |  |

**Tabela** (N. Registros: 0) — linhas na amostra: 1

- Colunas: Código | Produto | Quantidade | Un. Medida | Fazenda | Armazém | Fazenda Destino | Armazém Destino | Usuário | Dt. Emissão | Ação

## SCR-084 · Saldo Estoque

- **Rota:** `/admin/stocks`
- **Módulo:** Administrativo > Estoque > Saldo Estoque
- **Tipo:** Listagem
- **Finalidade:** Saldo Estoque (listagem)
- **Botões/Ações (cabeçalho):** Agrupar; fas fa-print → `/admin/stocks/report`; Exportar → `/admin/stocks/export`
- **Modais:** Agrupar Produtos

**Filtros (GET)** — botões: Filtrar

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `search` | Pesquisar por produto/lote/princípio ativo | text |  |
| `product` | Produto | select |  |
| `warehouse` | Armazém | select | BARRACAO |

**Tabela** (N. Registros: 4) — linhas na amostra: 4

- Colunas: # | Produto | NCM | Armazém | Qtde. Total | Custo médio unid | Valor Total | Dt. Criação | Ação
- Ações por linha: Visualizar
- Links por linha: `/admin/stock?farm=132&product=584968&warehouse=733`

- Mensagens/alertas: Selecione o produto quer irá ser o principal.

## SCR-085 · Batida

- **Rota:** `/admin/food-beats`
- **Módulo:** Administrativo > Estoque > Fábrica > Batida
- **Tipo:** Listagem
- **Finalidade:** Batida (listagem)
- **Botões/Ações (cabeçalho):** Adicionar Novo → `/admin/food-beats/create`
- **Modais:** Importar

**Filtros (GET)** — botões: Filtrar

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `product_id` | Produto | select | Dieta Adaptação, Dieta Crescimento, Dieta Engorda |
| `user_id` | Responsável | select | (lista dinâmica de cadastro — 2 registros; valores omitidos por privacidade) |
| `start_date` | Dt. Inicio | text |  |
| `end_date` | Dt. Final | text |  |

**Tabela** (N. Registros: 0) — linhas na amostra: 1

- Colunas: Código | Data | Responsável | Armazém | Produto | Lote | Quantidade | Vl. Total | Ação

**Formulário POST `/admin/equipments/import`** (modal modalImport) — botões: Importar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `file` |  | file | R |  |  |  |

## SCR-086 · Eventos

- **Rota:** `/admin/events`
- **Módulo:** Administrativo > Gestão Pessoal > Eventos
- **Tipo:** Listagem
- **Finalidade:** Eventos (listagem)
- **Botões/Ações (cabeçalho):** Saiba +; Adicionar Novo → `/admin/events/create`
- **Paginação:** sim (server-side, seletor de quantidade 10–200)

**Filtros (GET)** — botões: Filtrar

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `search` | Pesquisar por descrição | text |  |
| `start_date` | Dt. Início | text (data) |  |
| `end_date` | Dt. Fim | text (data) |  |

**Tabela** (N. Registros: 214) — linhas na amostra: 10

- Colunas: Nome | Tipo | Método | Ativo | Condição | Ação
- Ações por linha: Visualizar, Editar, Excluir
- Links por linha: `/admin/events/{id}`, `/admin/events/{id}/edit`

## SCR-087 · Funções

- **Rota:** `/admin/functions`
- **Módulo:** Administrativo > Gestão Pessoal > Funções
- **Tipo:** Listagem
- **Finalidade:** Funções (listagem)
- **Botões/Ações (cabeçalho):** Saiba +; Adicionar Novo → `/admin/functions/create`
- **Paginação:** sim (server-side, seletor de quantidade 10–200)

**Filtros (GET)** — botões: Filtrar

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `search` | Pesquisar por descrição | text |  |

**Tabela** (N. Registros:: 208) — linhas na amostra: 10

- Colunas: Descrição | Ativo | Ação
- Ações por linha: Visualizar, Editar, Excluir
- Links por linha: `/admin/functions/{id}`, `/admin/functions/{id}/edit`

## SCR-088 · Equipes

- **Rota:** `/admin/teams`
- **Módulo:** Administrativo > Gestão Pessoal > Equipes
- **Tipo:** Listagem
- **Finalidade:** Equipes (listagem)
- **Botões/Ações (cabeçalho):** Saiba +; fas fa-print → `/admin/teams/report`; Adicionar Novo → `/admin/teams/create`

**Tabela** (N. Registros: 0) — linhas na amostra: 1

- Colunas: Nome | Encarregado | Dt. Criação | Ação

## SCR-089 · Registro/Faltas

- **Rota:** `/admin/absences`
- **Módulo:** Administrativo > Gestão Pessoal > Registro/Faltas
- **Tipo:** Listagem
- **Finalidade:** Registro/Faltas (listagem)
- **Botões/Ações (cabeçalho):** Saiba +; Adicionar Novo → `/admin/absences/create`

**Tabela** (N. Registros:: 0) — linhas na amostra: 1

- Colunas: Data | Funcionário | Valor | Ação

## SCR-090 · Adiant. Salarial

- **Rota:** `/admin/advances`
- **Módulo:** Administrativo > Gestão Pessoal > Adiant. Salarial
- **Tipo:** Listagem
- **Finalidade:** Adiant. Salarial (listagem)
- **Botões/Ações (cabeçalho):** Saiba +; fas fa-print → `/admin/advances/report`; Adicionar Novo → `/admin/advances/create`

**Tabela** (N. Registros:: 0) — linhas na amostra: 1

- Colunas: Data | Funcionário | Valor | Ação

## SCR-091 · Registro/Eventos

- **Rota:** `/admin/bonuses`
- **Módulo:** Administrativo > Gestão Pessoal > Registro/Eventos
- **Tipo:** Listagem
- **Finalidade:** Registro/Eventos (listagem)
- **Botões/Ações (cabeçalho):** Saiba +; Adicionar Novo → `/admin/bonuses/create`

**Tabela** (N. Registros:: 0) — linhas na amostra: 1

- Colunas: Data | Funcionário | Evento | Valor | Ação

## SCR-092 · Funcionário x Eventos

- **Rota:** `/admin/employeeevents`
- **Módulo:** Administrativo > Gestão Pessoal > Funcionário X Eventos
- **Tipo:** Listagem
- **Finalidade:** Funcionário X Eventos (listagem)
- **Botões/Ações (cabeçalho):** Saiba +; fas fa-print → `/admin/employeeevents/report`; Importar → `#` (modal #modalImport); Adicionar Novo → `/admin/employeeevents/create`
- **Modais:** Importar

**Tabela** (N. Registros: 0) — linhas na amostra: 1

- Colunas: Nome | CPF | Função | Ação

**Formulário POST `/admin/employeeevents-import`** (modal modalImport) — botões: Importar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `file` |  | file | R |  |  |  |

## SCR-093 · Apuração Mensal

- **Rota:** `/admin/earnings`
- **Módulo:** Administrativo > Gestão Pessoal > Apuração Mensal
- **Tipo:** Listagem
- **Finalidade:** Apuração Mensal (listagem)
- **Botões/Ações (cabeçalho):** Saiba +; Apuração Mensal (Grade) → `/admin/earnings-grid?month=8&year=2026&type=N`; Importar → `#` (modal #modalImport); Gerar financeiro (modal #exampleModal)
- **Modais:** Importar

**Filtros (GET)** — botões: Filtrar

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `search` | Pesquisar por CPF ou Nome | text |  |
| `function` | Função | select | AJUDANDE DE CONZINHA, AJUDANTE GERAL, ANALISTA ADMINISTRATIVO GERAL, ANALISTA ADMINISTRATIVO PLENO, ANALISTA ADMINISTRATIVO SÊNIOR, ANALISTA DE COMPRAS, ANALISTA DE RH PLENO, ANALISTA DEPARTAMENTO DE PESSOAL … (208) |
| `year` | Ano | select | 2026, 2025 |
| `month` | Mês | select | Janeiro, Fevereiro, Março, Abril, Maio, Junho, Julho, Agosto … (12) |
| `type` | Tipo | select | Folha Normal, Adiantamento 13º, 13º Salário |
| `pagination_quantity` | Qtd. de Registros | select | 10 Registros, 30 Registros, 50 Registros, 80 Registros, 100 Registros, 200 Registros |

**Tabela** (N. Registros: 0) — linhas na amostra: 1

- Colunas: # | Nome | CPF | Função | Dt. Apontamento | Lançado ? | Ação

**Formulário POST `/admin/earnings-import`** (modal modalImport) — botões: Importar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `file` |  | file | R |  |  |  |

## SCR-094 · Tipos de Documento

- **Rota:** `/admin/document-types`
- **Módulo:** Administrativo > Gestão Documentos > Tipo Documento
- **Tipo:** Listagem
- **Finalidade:** Tipo Documento (listagem)
- **Botões/Ações (cabeçalho):** Saiba +; Adicionar Novo → `/admin/document-types/create`

**Tabela** — linhas na amostra: 2

- Colunas: Código | Nome | Ordem | Ativo | Ação
- Ações por linha: Visualizar, Cria descendente, Editar, Excluir
- Links por linha: `/admin/document-types/{id}`, `/admin/document-types/create?parent_id=35`, `/admin/document-types/{id}/edit`

## SCR-095 · Gestão de Documentos

- **Rota:** `/admin/document-managements`
- **Módulo:** Administrativo > Gestão Documentos > Documentos
- **Tipo:** Listagem
- **Finalidade:** Documentos (listagem)
- **Botões/Ações (cabeçalho):** Saiba +; Adicionar Novo → `/admin/document-managements/create`

**Filtros (GET)** — botões: Filtrar

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `document_type_id` | Tipo de Documento | select | FICHA DE ENTREGA DE EPI - INTS, ASOS |
| `start_date` | Dt. Validade Início | text |  |
| `end_date` | Dt. Validade Fim | text |  |

**Tabela** (N. Registros: 0) — linhas na amostra: 1

- Colunas: Código | Nome | Tipo de Documento | Data de Validade | Ação

## SCR-273 · Documento Fiscal

- **Rota:** `/admin/invoices/create`
- **Módulo:** Administrativo > Estoque > Doc. Fiscal/Entrada
- **Tipo:** Cadastro (novo)
- **Finalidade:** Doc. Fiscal/Entrada (cadastro (novo))
- **Botões/Ações (cabeçalho):** Voltar → `/admin/invoices`
- **Modais:** newBranchModal; Novo Fornecedor; Produto

**Tabela**

- Colunas: Parcela | Vencimento | Valor
- Totalizador: Total

**Tabela** — linhas na amostra: 1

- Colunas: (seleção) | Categoria | Conta Contábil | Centro de Custo | Safra | (%) | Valor
- Totalizador: Total 0 0

**Formulário POST `/admin/invoices/xml`**

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `file` |  | file |  |  |  |  |

**Formulário POST `/admin/invoices`** — botões: Salvar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `selected_farm_id` | Fazenda | select | R |  | Fazenda Maira, Fazenda São Paulo |  |
| `number` | Documento Fiscal | text | R | 15 |  | Campo onde se informa o número da NFe, localizado acima da série no documento |
| `series` | Série | text | R | 3 |  |  |
| `provider_id` | Fornecedor | select | R |  | (lista dinâmica de cadastro — 39 registros; valores omitidos por privacidade) … (39) |  |
| `branch_id` | Filial | select |  |  |  |  |
| `proprietary_id` | Proprietário Gestor | select | R |  | (lista dinâmica de cadastro — 1 registros; valores omitidos por privacidade) |  |
| `state_registration` | Insc. Estadual | select |  |  |  |  |
| `harvest_id` | Safra | select |  |  | Safra 2024/2025, TESTE, Safra 1 |  |
| `dt_emission` | Dt. Emissão | text (data) | R |  |  |  |
| `delivery_date` | Dt. Entrega | text (data) |  |  |  |  |
| `state_id` | UF | select | R |  | AC, AL, AP, AM, BA, CE, DF, ES … (27) |  |
| `type` | Tipo Nota | select | R |  | NF-e, CT-e, NFS-e, NFC-e, DANF-e, DARF, DARE, GRU |  |
| `type_id` | Tipo de Título | select | R |  | Boleto, Duplicata, Cheque, Nota Fiscal - NFe, Recibo, Ad.Fornecedor, Ad.Funcionario, Cupom Fiscal … (23) |  |
| `classification` | Classificação | select | R |  | Não Classificado, CAPEX, OPEX | CAPEX: Investimentos de longo prazo, como aquisição de bens que serão usados por mais de um ano (equipamentos, prédios, etc.). \n OPEX: Despesas operacionais re |
| `apportionment_type` | Tipo Rateio | select | R |  | Por Valor, Por Produto | RATEIO/VALOR: O rateio por valor deve ser utilizado quando todos os produtos da NF-e serão apropriados em somente um categoria financeira, contábil e centro de  |
| `note` | Observações | textarea |  |  |  |  |
| `Produto do XML` | Produto do XML | text |  |  |  |  |
| `product_id[]` | Produto | select | R |  |  |  |
| `measurement_id[]` | Un. Medida | select | R |  |  |  |
| `quantity[]` | Qtd. | text (moeda) | R |  |  |  |
| `amount[]` | Vl.Unit | text (moeda) | R |  |  |  |
| `discount[]` | Desconto | text (moeda) | R |  |  |  |
| `total_amount[]` | V. Total(R$) | text (moeda) | R |  |  |  |
| `generate_stocks[]` | Gera estoque | select | R |  | Sim, Não | Define se o produto será adicionado ao estoque |
| `warehouse_id[]` | Armazém | select |  |  | BARRACAO |  |
| `appropriation_type[]` | Tipo Apropriação | select |  |  | Pecuária, Manutenção, Abastecimento |  |
| `ipi[]` | IPI ($) | text (moeda) | R |  |  |  |
| `icms[]` | ICMS ($) | text (moeda) | R |  |  |  |
| `provider_lot[]` | Lt. Fornecedor | text |  | 15 |  |  |
| `shelf_life[]` | Validade | text (data) |  | 15 |  |  |
| `cultivations[]` | Classificação | select |  |  | Nanica, CANA DE AÇUCAR, Pionner 2022, Pionner 2024, Pionner 2022, Pionner 2024, MORANGO DE MESA, 1823 … (14) |  |
| `item_categories[]` | Categoria Financeira | select |  |  |  |  |
| `item_centers[]` | Centro de Custo | select |  |  | Administração, Estoque Insumos, Estoque Produção, Parque Máquinas, Soja, Soja Precoce, Soja Super Precoce, Terminação - Corte |  |
| `is_equipment[]` | Adiciona ao inventário | select | R |  | Não, Sim |  |
| `impurity[]` | Impurezas(%) | text |  |  |  |  |
| `pau[]` | PAU (%) | text |  |  |  |  |
| `fund_p_10[]` | Fundo P-10(%) | text |  |  |  |  |
| `gpi_p_15[]` | GPI P-15(%) | text |  |  |  |  |
| `p_17[]` | P-17(%) | text |  |  |  |  |
| `p_15[]` | P-15/16(%) | text |  |  |  |  |
| `p_14[]` | P-14(%) | text |  |  |  |  |
| `p_13[]` | Fundo P-13(%) | text |  |  |  |  |
| `grooming[]` | Catação(%) | text |  |  |  |  |
| `utilizations[]` | Aproveitamento(%) | text |  |  |  |  |
| `drinks[]` | Bebida | select |  |  | EXT. MOLE, MOLE, DURO +, DURO, DURO/VERDE, DURO/SUJO, DURO/FRTD, DURO/1 RIADA … (21) |  |
| `colors[]` | Cor ou Aspecto | select |  |  | BRANCO, PRETO, VERDE, CHUVADO CLARO, CHUVADO MÉDIO, CHUVADO ESCURO, BARRENTO |  |
| `equipment_family_equipment_id[]` | Familia Bem | select |  |  | Construções e Instalações, Culturas Perenes, Equipamentos Agrícolas, Imóveis Rurais e Urbanos, Implementos Agrícolas, Máquinas Agrícolas, Móveis e Equipamentos, Veículos Automotores |  |
| `equipment_proprietary_id[]` | Proprietário Gestor | select |  |  | (lista dinâmica de cadastro — 1 registros; valores omitidos por privacidade) |  |
| `equipment_equipment_type[]` | Tipo | select |  |  | Próprio, Terceirizado |  |
| `equipment_vl_time_productive[]` | Vl Hora/Km | text (moeda) |  |  |  |  |
| `equipment_hour_meter[]` | Horímetro/Km | text |  |  |  |  |
| `equipment_year_mod[]` | Ano/Mod | text |  |  |  |  |
| `equipment_brand[]` | Marca | text |  |  |  |  |
| `equipment_patrimony[]` | Patrimônio | text |  | 40 |  |  |
| `equipment_chassi[]` | Chassi | text |  | 17 |  |  |
| `equipment_renavam[]` | RENAVAM | text |  | 11 |  |  |
| `equipment_serie[]` | Série | text |  | 40 |  |  |
| `equipment_plate[]` | Placa | text |  | 10 |  |  |
| `equipment_uf[]` | UF | select |  |  | AC, AL, AP, AM, BA, CE, DF, ES … (27) |  |
| `equipment_color[]` | Cor | text |  | 10 |  |  |
| `equipment_model[]` | Modelo | text |  | 30 |  |  |
| `equipment_has_depreciation[]` | Tem Depreciação | select |  |  | Sim, Não |  |
| `equipment_vl_acquisition[]` | Vl. Aquisição/Vl.Construção | text (moeda) |  |  |  |  |
| `equipment_depreciation_type[]` | Tipo de Depreciação | select |  |  | C/Vl. Residual, S/Vl. Residual |  |
| `equipment_residual[]` | Residual(%) | text |  |  |  |  |
| `equipment_life_bens[]` | Vida útil(anos) | text (moeda) |  |  |  |  |
| `equipment_depreciation[]` | Depreciação(%) | text |  |  |  |  |
| `equipment_vl_residual[]` | Vl. Residual | text (moeda) |  |  |  |  |
| `equipment_vl_depreciate[]` | Vl. p/Depreciação | text (moeda) |  |  |  |  |
| `equipment_vl_depreciated[]` | Vl. Depreciado | text |  |  |  |  |
| `equipment_sd_depreciate[]` | Sd. Á depreciar | text |  |  |  |  |
| `equipment_current_value[]` | Valor Atual | text |  |  |  |  |
| `equipment_dt_acquisition[]` | Dt. Aquisição | text (data) |  |  |  |  |
| `equipment_status[]` | Status | select |  |  | Ativo, Inativo |  |
| `equipment_specification[]` | Especificação | textarea |  | 200 |  |  |
| `vl_items` | Vl. Itens | text (moeda) | R |  |  |  |
| `vl_ipi` | IPI | text (moeda) |  |  |  |  |
| `vl_discount` | Desconto | text (moeda) |  |  |  |  |
| `vl_freight` | Frete | text (moeda) |  |  |  |  |
| `vl_safe` | Seguro | text (moeda) |  |  |  |  |
| `vl_expense` | Vl. Despesa | text (moeda) |  |  |  |  |
| `vl_total` | Vl. Total | text (moeda) | R |  |  |  |
| `conveyor` | Transportador | text |  | 40 |  |  |
| `has_input` | Possui entrada ? | select |  |  | Sim, Não |  |
| `input_date` | Data entrada | text (data) |  |  |  |  |
| `input_value` | Valor entrada | text (moeda) |  |  |  |  |
| `qtd_installments` | Nª Parcelas | number |  |  |  |  |
| `first_installment` | Venc. 1ª. PC | text (data) |  |  |  |  |
| `int_installments` | Int. Parcelas (dias) | number |  |  |  |  |
| `categories[]` |  | select | R |  |  |  |
| `plan_accounts[]` |  | select |  |  |  |  |
| `centers[]` |  | select | R |  | Administração, Estoque Insumos, Estoque Produção, Parque Máquinas, Soja, Soja Precoce, Soja Super Precoce, Terminação - Corte |  |
| `category_harvest_id[]` |  | select |  |  | Safra 2024/2025, TESTE, Safra 1 |  |
| `category_percent_values[]` |  | text (moeda) |  |  |  |  |
| `category_values[]` |  | text (moeda) |  |  |  |  |
| `automatic_writeoff` | Baixa automática | select |  |  | Não, Sim |  |
| `account_id` | Conta Bancária | select |  |  | 000 - Caixa Fazenda - 01, 000 - Caixa Fazenda - 02, 000 - Caixa Fazenda - 03, 000 - INVESTIMENTO 1, 56, BB Principal |  |
| `balance` | Saldo | text (moeda) |  |  |  |  |
| `movement_date` | Data do Movimento | text (data) |  |  |  |  |

**Formulário POST `/admin/invoices/create`** (modal newBranchModal) — botões: Salvar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `name` | Nome | text | R | 100 |  |  |
| `nif` | CPF/CNPJ | text | R |  |  |  |
| `state_registration` | Insc. Estadual | text |  | 20 |  |  |
| `zip_code` | CEP | text | R |  |  |  |
| `city_id` | Cidade | select | R |  |  |  |
| `address` | Endereço | text | R |  |  |  |

**Formulário POST `/admin/invoices/create`** (modal newProviderModal) — botões: Salvar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `nif` | CPF/CNPJ | text | R |  |  |  |
| `nickname` | Nome Completo/Razão Social | text | R | 60 |  |  |
| `name` | Nome Social/Fantasia | text | R | 80 |  |  |
| `state_registration` | Insc. Estadual | text |  | 20 |  |  |
| `city_registration` | Insc. Municipal | text |  | 20 |  |  |
| `type` | Tipo | select | R |  | Fornecedor, Funcionário, Terceirizado, Transportador, Comissionado, Inseminador |  |
| `email` | Email | email |  |  |  |  |
| `phone` | Telefone | text | R |  |  |  |
| `cellphone` | Celular | text |  |  |  |  |
| `zip_code` | CEP | text |  |  |  |  |
| `address` | Endereço | text | R |  |  |  |
| `city_id` | Cidade | select | R |  |  |  |
| `contact` | Contato | text |  |  |  |  |
| `contact_phone` | Tel. do contato | text |  |  |  |  |
| `is_enabled` | Ativo | select | R |  | Sim, Não |  |

**Formulário POST `/admin/invoices/create`** (modal newProductModal) — botões: Salvar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `description` | Descrição | text | R |  |  |  |
| `ncm_id` | Ncm | select |  |  |  |  |
| `measurement_id` | 1ª. Un.Medida | select | R |  | @, %, °C, °F, 1000 un, 1000UN, BAG, Balde … (59) |  |
| `second_measurement_id` | 2ª. Un.Medida | select |  |  | @, %, °C, °F, 1000 un, 1000UN, BAG, Balde … (59) |  |
| `factor_type` | Tipo | select |  |  | Multiplica, Divide |  |
| `factor` | Fator conversão | text (moeda) |  |  |  |  |
| `group_id` | Grupo | select | R |  | Insumos Agrícola, Insumos Gerais, Insumos Industrialização, Insumos Pecuária, Máquinas/Equipamentos/Veículos, Produção, Produtos Exportação |  |
| `category_id` | Cat. Produtos | select | R |  |  |  |
| `kind_id` | Classe | select | R |  |  |  |
| `cultivation_id` | Variedade | select |  |  | Soja - 1823, Soja - Bonus, Soja - Bonus, CANA DE AÇUCAR - ERLAM - CANA DE AÇUCAR, Soja - Extrema, Soja - Monsoy 8606, PLANTAÇÃO DE MORANGO - ERLAM - MORANGO DE MESA, Banana - Nanica … (14) |  |
| `quality` | Qualidade | select |  |  | 1 |  |
| `has_lot` | Cont. Lote | select | R |  | Sim, Não |  |
| `control_stock` | Controla Estoque | select | R |  | Sim, Não |  |
| `min_stock` | Estoque minimo | text (moeda) |  |  |  |  |
| `las_price` | Vl. Referência (R$) | text (moeda) |  |  |  |  |
| `active_principle` | Princípio Ativo | text |  | 50 |  |  |
| `is_enabled` | Ativo | select | R |  | Sim, Não |  |
| `allow_pointing` | Apontamento | select | R |  | Não, Sim |  |
| `financial_category_id` | Cat. Financeira - Custo | select |  |  | 2.01.001.0001 - Energia Elétrica, 2.01.001.0002 - Telefone/Internet, 2.01.001.0003 - Aluguéis, 2.01.001.0004 - Água/Esgoto, 2.01.001.0005 - Brindes/Cortesias, 2.01.001.0006 - Viagens/Diárias, 2.01.001.0007 - Treinamento Mão de Obra, 2.01.001.0008 - Softwares … (209) | Categoria financeira utilizada para classificação de custos de produção. Obrigatório quando o produto controla estoque. |
| `default_warehouse_id` | Armazém Padrão | select |  |  | BARRACAO |  |
| `default_cost_center_id` | Centro de Custo Padrão | select |  |  | Administração, Estoque Insumos, Estoque Produção, Parque Máquinas, Soja, Soja Precoce, Soja Super Precoce, Terminação - Corte |  |

## SCR-274 · Consulte os documentos

- **Rota:** `/admin/dfe/create`
- **Módulo:** Administrativo > Estoque > DFe Recebidas
- **Tipo:** Cadastro (novo)
- **Finalidade:** DFe Recebidas (cadastro (novo))
- **Botões/Ações (cabeçalho):** Voltar → `/admin/invoices/create`

**Tabela** (N. Registros novos: 0)

- Colunas: Razão Social | CPF/CNPJ | Valor | Chave NFe

## SCR-275 · Formulação

- **Rota:** `/admin/foods/create`
- **Módulo:** Administrativo > Estoque > Fábrica > Formulação
- **Tipo:** Cadastro (novo)
- **Finalidade:** Formulação (cadastro (novo))
- **Abas:** Matéria Prima
- **Botões/Ações (cabeçalho):** Voltar → `/admin/foods`

**Formulário POST `/admin/foods`** — botões: Salvar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `code` | Código | text |  |  |  |  |
| `user_name` | Responsável | text | R |  |  |  |
| `date` | Data | text | R |  |  |  |
| `is_enabled` | Ativo | select | R |  | Sim, Não |  |
| `product_id` | Produto | select | R |  | Dieta Adaptação, Dieta Crescimento, Dieta Engorda |  |
| `quantity` | Quantidade Referência | text (moeda) | R |  |  | Esta é a medida padrão da fórmula. Se a fórmula foi criada para 1kg, mas você vai produzir 10kg, o sistema multiplicará os insumos por 10 automaticamente. |
| `measurement_id` | Unidade de Medida | select | R |  |  |  |
| `type` | Tipo | select | R |  | Porcentagem, Unidade |  |
| `feedstock_product_id[]` | Matéria Prima | select | R |  | Bagaço de Cana, CAFE, CALCÁRIO CALCÍTRICO, CALCITE, CASCA DE SOJA PELETIZADA (GRANEL), Dieta Adaptação, Dieta Crescimento, Dieta Engorda … (28) |  |
| `measurements[]` | Unidade de Medida | select | R |  |  |  |
| `percentage[]` | Quantidade (%) | text (moeda) | R |  |  |  |
| `total` | Total (%) | text |  |  |  |  |

## SCR-372 · SLA Status

- **Rota:** `/admin/supply-status/89/edit`
- **Módulo:** Administrativo > Suprimentos > Parâmetros SLA
- **Tipo:** Cadastro (edição)
- **Finalidade:** Parâmetros SLA (cadastro (edição))
- **Botões/Ações (cabeçalho):** Voltar → `/admin/supply-status`

**Formulário PUT `/admin/supply-status/89`** — botões: Salvar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `max_hours` | Max. Horas | number | R |  |  |  |

## SCR-373 · Solicitação

- **Rota:** `/admin/request-purchase/create`
- **Módulo:** Administrativo > Suprimentos > Solicitação
- **Tipo:** Cadastro (novo)
- **Finalidade:** Solicitação (cadastro (novo))
- **Botões/Ações (cabeçalho):** Voltar → `/admin/request-purchase`
- **Modais:** Produto

**Formulário POST `/admin/request-purchase`** — botões: Salvar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `code` | Código | text |  |  |  |  |
| `responsible` | Solicitação | text |  |  |  |  |
| `request_date` | Data do Pedido | text (data) |  |  |  |  |
| `priority` | Prioridade | select | R |  | Baixa, Média, Alta |  |
| `type` | Tipo | select | R |  | Produto, Serviço, Adiantamento, Reembolso, Diária, Empreita, Compra Efetuada, Frete … (11) |  |
| `authorizer_id` | Encarregado | select | R |  | (lista dinâmica de cadastro — 0 registros; valores omitidos por privacidade) |  |
| `product_id[]` | Produto | select |  |  |  |  |
| `quantity[]` | Qtd. | text (moeda) | R |  |  |  |
| `descriptions[]` | Descrição | text | R | 60 |  |  |
| `reference_value[]` | Valor Referência | text (moeda) |  |  |  | Valor máximo/ideal que a fazenda pretende pagar por este item. Será exibido para o autorizador na aprovação da cotação. |
| `description_services[]` | Descrição | textarea | R |  |  |  |
| `quantity_services[]` | Quantidade | text | R |  |  |  |
| `observation_services[]` | Observações | text |  | 90 |  |  |
| `description_advances[]` | Descrição | textarea | R |  |  |  |
| `amount_advances[]` | Valor | text (moeda) | R |  |  |  |
| `description_refunds[]` | Descrição | textarea | R |  |  |  |
| `amount_refunds[]` | Valor | text (moeda) | R |  |  |  |
| `nif_daily[]` | CPF | text | R |  |  |  |
| `name_daily[]` | Nome | text | R |  |  |  |
| `phone_daily[]` | Telefone | text | R |  |  |  |
| `daily_quantity_daily[]` | Quantidade de Diárias | text | R |  |  |  |
| `service_description_daily[]` | Descrição do Serviço | text | R | 200 |  |  |
| `service_description_contracts[]` | Descrição de serviços | text | R |  |  |  |
| `amount_contracts[]` | Valor | text (moeda) | R |  |  |  |
| `product_finished[]` | Produto | select |  |  |  |  |
| `description_finished[]` | Descrição | text | R |  |  |  |
| `amount_finished[]` | Valor | text (moeda) | R |  |  |  |
| `justification` | Justificativa | textarea | R |  |  |  |
| `description` | Descrição/Chamado | textarea | R |  |  |  |
| `observation` | Observações | textarea |  |  |  |  |
| `attachments[0][name]` | Descrição | text |  |  |  |  |
| `attachments[0][file]` |  | file |  |  |  |  |

**Formulário POST `/admin/request-purchase/create`** (modal newProductModal) — botões: Salvar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `description` | Descrição | text | R |  |  |  |
| `ncm_id` | Ncm | select |  |  |  |  |
| `measurement_id` | 1ª. Un.Medida | select | R |  | @, %, °C, °F, 1000 un, 1000UN, BAG, Balde … (59) |  |
| `second_measurement_id` | 2ª. Un.Medida | select |  |  | @, %, °C, °F, 1000 un, 1000UN, BAG, Balde … (59) |  |
| `factor_type` | Tipo | select |  |  | Multiplica, Divide |  |
| `factor` | Fator conversão | text (moeda) |  |  |  |  |
| `group_id` | Grupo | select | R |  | Insumos Agrícola, Insumos Gerais, Insumos Industrialização, Insumos Pecuária, Máquinas/Equipamentos/Veículos, Produção, Produtos Exportação |  |
| `category_id` | Cat. Produtos | select | R |  |  |  |
| `kind_id` | Classe | select | R |  |  |  |
| `cultivation_id` | Variedade | select |  |  | Soja - 1823, Soja - Bonus, Soja - Bonus, CANA DE AÇUCAR - ERLAM - CANA DE AÇUCAR, Soja - Extrema, Soja - Monsoy 8606, PLANTAÇÃO DE MORANGO - ERLAM - MORANGO DE MESA, Banana - Nanica … (14) |  |
| `quality` | Qualidade | select |  |  | 1 |  |
| `has_lot` | Cont. Lote | select | R |  | Sim, Não |  |
| `control_stock` | Controla Estoque | select | R |  | Sim, Não |  |
| `min_stock` | Estoque minimo | text (moeda) |  |  |  |  |
| `las_price` | Vl. Referência (R$) | text (moeda) |  |  |  |  |
| `active_principle` | Princípio Ativo | text |  | 50 |  |  |
| `is_enabled` | Ativo | select | R |  | Sim, Não |  |
| `allow_pointing` | Apontamento | select | R |  | Não, Sim |  |
| `financial_category_id` | Cat. Financeira - Custo | select |  |  | 2.01.001.0001 - Energia Elétrica, 2.01.001.0002 - Telefone/Internet, 2.01.001.0003 - Aluguéis, 2.01.001.0004 - Água/Esgoto, 2.01.001.0005 - Brindes/Cortesias, 2.01.001.0006 - Viagens/Diárias, 2.01.001.0007 - Treinamento Mão de Obra, 2.01.001.0008 - Softwares … (209) | Categoria financeira utilizada para classificação de custos de produção. Obrigatório quando o produto controla estoque. |

## SCR-374 · Nova Entrada / Insumos

- **Rota:** `/admin/input-entries/create`
- **Módulo:** Administrativo > Estoque > Entrada/Insumos
- **Tipo:** Cadastro (novo)
- **Finalidade:** Entrada/Insumos (cadastro (novo))
- **Botões/Ações (cabeçalho):** Voltar → `/admin/input-entries`
- **Modais:** Produto

**Formulário POST `/admin/input-entries`** — botões: Salvar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `code` | Código | text |  |  |  |  |
| `date` | Data | text | R |  |  |  |
| `selected_farm_id` | Fazenda | select | R |  | Fazenda Maira, Fazenda São Paulo |  |
| `harvest_id` | Safra | select |  |  | Safra 1, Safra 2023/2024, Safra 2023/2024, Safra 2024/2025, TESTE |  |
| `proprietary_id` | Proprietário Gestor | select |  |  | (lista dinâmica de cadastro — 1 registros; valores omitidos por privacidade) |  |
| `note` | Observação | textarea |  |  |  |  |
| `product_id[]` | Produto | select | R |  |  |  |
| `measurement_id[]` | Unidade de Medida | select | R |  |  |  |
| `quantity[]` | Quantidade | text (moeda) | R |  |  |  |
| `unit_value[]` | Vl. Unitário | text (moeda) | R |  |  |  |
| `total_value[]` | Vl. Total | text (moeda) | R |  |  |  |
| `generate_stock[]` | Gera Estoque | select | R |  | Sim, Não |  |
| `warehouse_id[]` | Armazém | select | R |  | BARRACAO |  |
| `appropriation_type[]` | Tipo Apropriação | select |  |  | Pecuária, Manutenção, Abastecimento |  |
| `provider_lot[]` | Lote Fornecedor | text |  | 30 |  |  |
| `shelf_life[]` | Validade | text (data) |  |  |  |  |
| `cultivation_id[]` | Classificação | select |  |  | Nanica, CANA DE AÇUCAR, Pionner 2022, Pionner 2024, Pionner 2022, Pionner 2024, MORANGO DE MESA, 1823 … (14) |  |
| `item_category_id[]` | Categoria Financeira | select | R |  |  |  |
| `item_center_id[]` | Centro de Custo | select | R |  | Centro Custo/Apropriar, Confinamento, Cria, Engorda, Escritório Central, Recria, Soja |  |
| `total_amount` | Vl. Total | text (moeda) | R |  |  |  |
| `automatic_writeoff` | Gerar Movimento Bancário | select |  |  | Não, Sim |  |
| `account_id` | Conta Bancária | select |  |  | 000 - Caixa Fazenda - 01, 000 - Caixa Fazenda - 02, 000 - Caixa Fazenda - 03, 000 - INVESTIMENTO 1, 56, BB Principal |  |
| `balance` | Saldo | text (moeda) |  |  |  |  |
| `movement_date` | Data do Movimento | text (data) |  |  |  |  |

**Formulário POST `/admin/input-entries/create`** (modal newProductModal) — botões: Salvar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `description` | Descrição | text | R |  |  |  |
| `ncm_id` | Ncm | select |  |  |  |  |
| `measurement_id` | 1ª. Un.Medida | select | R |  | @, %, °C, °F, 1000 un, 1000UN, BAG, Balde … (59) |  |
| `second_measurement_id` | 2ª. Un.Medida | select |  |  | @, %, °C, °F, 1000 un, 1000UN, BAG, Balde … (59) |  |
| `factor_type` | Tipo | select |  |  | Multiplica, Divide |  |
| `factor` | Fator conversão | text (moeda) |  |  |  |  |
| `group_id` | Grupo | select | R |  | Insumos Agrícola, Insumos Gerais, Insumos Industrialização, Insumos Pecuária, Máquinas/Equipamentos/Veículos, Produção, Produtos Exportação |  |
| `category_id` | Cat. Produtos | select | R |  |  |  |
| `kind_id` | Classe | select | R |  |  |  |
| `cultivation_id` | Variedade | select |  |  | Soja - 1823, Soja - Bonus, Soja - Bonus, CANA DE AÇUCAR - ERLAM - CANA DE AÇUCAR, Soja - Extrema, Soja - Monsoy 8606, PLANTAÇÃO DE MORANGO - ERLAM - MORANGO DE MESA, Banana - Nanica … (14) |  |
| `quality` | Qualidade | select |  |  | 1 |  |
| `has_lot` | Cont. Lote | select | R |  | Sim, Não |  |
| `control_stock` | Controla Estoque | select | R |  | Sim, Não |  |
| `min_stock` | Estoque minimo | text (moeda) |  |  |  |  |
| `las_price` | Vl. Referência (R$) | text (moeda) |  |  |  |  |
| `active_principle` | Princípio Ativo | text |  | 50 |  |  |
| `is_enabled` | Ativo | select | R |  | Sim, Não |  |
| `allow_pointing` | Apontamento | select | R |  | Não, Sim |  |
| `financial_category_id` | Cat. Financeira - Custo | select |  |  | 2.01.001.0001 - Energia Elétrica, 2.01.001.0002 - Telefone/Internet, 2.01.001.0003 - Aluguéis, 2.01.001.0004 - Água/Esgoto, 2.01.001.0005 - Brindes/Cortesias, 2.01.001.0006 - Viagens/Diárias, 2.01.001.0007 - Treinamento Mão de Obra, 2.01.001.0008 - Softwares … (209) | Categoria financeira utilizada para classificação de custos de produção. Obrigatório quando o produto controla estoque. |
| `default_warehouse_id` | Armazém Padrão | select |  |  | BARRACAO |  |
| `default_cost_center_id` | Centro de Custo Padrão | select |  |  | Centro Custo/Apropriar, Confinamento, Cria, Engorda, Escritório Central, Recria, Soja |  |

## SCR-375 · Novo Perfil de Lançamento

- **Rota:** `/admin/provider-launch-profiles/create`
- **Módulo:** Administrativo > Estoque > Perfis de Lançamento
- **Tipo:** Cadastro (novo)
- **Finalidade:** Perfis de Lançamento (cadastro (novo))

**Tabela** — linhas na amostra: 1

- Colunas: (seleção) | Categoria | Centro de Custo | Percentual (%)

**Formulário POST `/admin/provider-launch-profiles`** — botões: Salvar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `provider_id` | Fornecedor | select | R |  | (lista dinâmica de cadastro — 41 registros; valores omitidos por privacidade) … (41) |  |
| `default_destination` | Lançar sempre como | select | R |  | Nota de Produto, Nota de Despesa, Nota de Animal |  |
| `default_type_id` | Tipo de título padrão | select |  |  | Ad. Cliente, Ad.Fornecedor, Ad.Funcionario, Boleto, Cartão de Crédito, Cheque, Contrato, Cupom Fiscal … (23) |  |
| `categories[]` |  | select |  |  | 13º Salário, Adiantamento de Crédito de Produto, Aditivos Concentrados, Adubos Foliares, Adubos Formulados, Adubos Orgânicos, Ágio Arroba Bezerro, Ágio Arroba Boi Magro … (286) |  |
| `centers[]` |  | select |  |  | Administração, Estoque Insumos, Estoque Produção, Parque Máquinas, Soja, Soja Precoce, Soja Super Precoce, Terminação - Corte |  |
| `percents[]` |  | text (moeda) |  |  |  |  |

- Mensagens/alertas: As notas deste fornecedor continuam passando pela tela de aprovação. O perfil apenas evita o preenchimento manual — a au

## SCR-376 · Baixa de Estoque

- **Rota:** `/admin/stock-writeoffs/create`
- **Módulo:** Administrativo > Estoque > Baixa de Estoque
- **Tipo:** Cadastro (novo)
- **Finalidade:** Baixa de Estoque (cadastro (novo))
- **Botões/Ações (cabeçalho):** Voltar → `/admin/stock-writeoffs`

**Tabela** — linhas na amostra: 1

- Colunas: (seleção) | Produto | Un. Medida | Estoque | Qtd. | Vl.Unit | Vl. Total

**Formulário POST `/admin/stock-writeoffs`** — botões: Salvar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `code` | Código | text | R |  |  |  |
| `user_name` | Usuário | text | R |  |  |  |
| `date` | Dt. Criação | text | R |  |  |  |
| `type` | Motivo da Baixa | select | R |  | Perda, Deterioração, Roubo, Avaria, Inventário, Contabilização, Furto, Prazo de Validade … (13) |  |
| `type_note` | Motivo/Observação da Baixa | textarea |  |  |  |  |
| `center` | Centro de Custo | select | R |  | Todos, Administração, Estoque Insumos, Estoque Produção, Parque Máquinas, Soja, Soja Precoce, Soja Super Precoce … (9) |  |
| `warehouse_id` | Armazém | select | R |  | BARRACAO |  |
| `justification` | Justificativa | text | R |  |  |  |
| `products[]` |  | select | R |  |  |  |
| `um[]` |  | text | R |  |  |  |
| `stock[]` |  | text |  |  |  |  |
| `quantity[]` |  | text | R |  |  |  |
| `value[]` |  | text (moeda) | R |  |  |  |
| `amount[]` |  | text (moeda) | R |  |  |  |
| `attachments[0][name]` | Descrição | text |  |  |  |  |
| `attachments[0][file]` |  | file |  |  |  |  |

## SCR-377 · Requisição do Estoque

- **Rota:** `/admin/requisitions/create`
- **Módulo:** Administrativo > Estoque > Requisição/Saída
- **Tipo:** Cadastro (novo)
- **Finalidade:** Requisição/Saída (cadastro (novo))
- **Abas:** Itens
- **Botões/Ações (cabeçalho):** Voltar → `/admin/requisitions`

**Formulário POST `/admin/requisitions`** — botões: Salvar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `code` | Código | text | R |  |  |  |
| `user` | Usuário | text | R |  |  |  |
| `date` | Data | text | R |  |  |  |
| `classification` | Classificação | select | R |  | Não Classificado, CAPEX, OPEX | CAPEX: Investimentos de longo prazo, como aquisição de bens que serão usados por mais de um ano (equipamentos, prédios, etc.). \n OPEX: Despesas operacionais re |
| `requester` | Requisitante | select | R |  | Pedro Mário, ERLAM ANDRADE DE SOUSA AURELIANO |  |
| `area_id` | Área | select |  |  | 01, 02, 03, 04, 05, 06, 07, 08 … (10) |  |
| `harvest_id` | Safra | select |  |  | Safra 1, TESTE, Safra 2024/2025, Safra 2023/2024, Safra 2023/2024 |  |
| `warehouses[]` | Armazém | select | R |  | BARRACAO |  |
| `stock_id[]` | Produto | select | R |  |  |  |
| `um[]` | Un. Medida | text | R |  |  |  |
| `qtd_stock[]` | Estoque | text |  |  |  |  |
| `quantity[]` | Qtd. | text | R |  |  |  |
| `value[]` | Vl.Unit | text (moeda) | R |  |  |  |
| `amount[]` | Vl. Total | text (moeda) | R |  |  |  |
| `centers[]` | Centro de custo | select |  |  | Administração, Estoque Insumos, Estoque Produção, Parque Máquinas, Soja, Soja Precoce, Soja Super Precoce, Terminação - Corte |  |
| `addressing[]` | Endereçamento | text |  |  |  |  |

## SCR-378 · Devolução do Estoque

- **Rota:** `/admin/devolution/create`
- **Módulo:** Administrativo > Estoque > Devolução/Entrada
- **Tipo:** Cadastro (novo)
- **Finalidade:** Devolução/Entrada (cadastro (novo))
- **Abas:** Itens
- **Botões/Ações (cabeçalho):** Voltar → `/admin/devolution`

**Formulário POST `/admin/devolution`** — botões: Salvar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `code` | Código | text | R |  |  |  |
| `user` | Usuário | text | R |  |  |  |
| `date` | Data | text | R |  |  |  |
| `requester` | Responsável Devolução | select | R |  | (lista dinâmica de cadastro — 0 registros; valores omitidos por privacidade) |  |
| `harvest_id` | Safra | select |  |  | Safra 1, TESTE, Safra 2024/2025, Safra 2023/2024, Safra 2023/2024 |  |
| `warehouses[]` | Armazém | select | R |  | BARRACAO |  |
| `stock_id[]` | Produto | select | R |  |  |  |
| `um[]` | Un. Medida | text | R |  |  |  |
| `quantity[]` | Qtd. | text | R |  |  |  |
| `value[]` | Vl.Unit | text (moeda) | R |  |  |  |
| `amount[]` | Vl. Total | text (moeda) | R |  |  |  |
| `centers[]` | Centro de custo | select |  |  | Administração, Estoque Insumos, Estoque Produção, Parque Máquinas, Soja, Soja Precoce, Soja Super Precoce, Terminação - Corte |  |

## SCR-379 · Transferência de Armazém

- **Rota:** `/admin/warehouse-transfer/create`
- **Módulo:** Administrativo > Estoque > Trans. Armazém
- **Tipo:** Cadastro (novo)
- **Finalidade:** Trans. Armazém (cadastro (novo))
- **Botões/Ações (cabeçalho):** Voltar → `/admin/warehouse-transfer`

**Tabela** — linhas na amostra: 1

- Colunas: (seleção) | Produto | Estoque | Un. Medida | Qtd. | Vl.Unit | Vl. Total | Centro de custo

**Formulário POST `/admin/warehouse-transfer`** — botões: Salvar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `code` | Código | text | R |  |  |  |
| `user` | Usuário | text | R |  |  |  |
| `date` | Dt. Criação | text | R |  |  |  |
| `type` | Tipo Movimentação | select | R |  | Transferência |  |
| `warehouse_id` | Armazém | select | R |  | BARRACAO |  |
| `warehouse_out_id` | Armazém Destino | select | R |  | BARRACAO |  |
| `harvest_id` | Safra | select |  |  | Safra 1, TESTE, Safra 2024/2025, Safra 2023/2024, Safra 2023/2024 |  |
| `stock_id[]` |  | select | R |  |  |  |
| `qnt_stock[]` | Estoque | text (moeda) |  |  |  |  |
| `um[]` |  | text | R |  |  |  |
| `quantity[]` |  | text (moeda) | R |  |  |  |
| `value[]` |  | text (moeda) | R |  |  |  |
| `amount[]` |  | text (moeda) | R |  |  |  |
| `centers[]` | Centro de custo | select | R |  | Administração, Estoque Insumos, Estoque Produção, Parque Máquinas, Soja, Soja Precoce, Soja Super Precoce, Terminação - Corte |  |

## SCR-380 · Transferência de Armazém entre Fazendas

- **Rota:** `/admin/warehouse-transfer-between-farms/create`
- **Módulo:** Administrativo > Estoque > Trans. Fazendas
- **Tipo:** Cadastro (novo)
- **Finalidade:** Trans. Fazendas (cadastro (novo))
- **Botões/Ações (cabeçalho):** Voltar → `/admin/warehouse-transfer-between-farms`

**Tabela** — linhas na amostra: 1

- Colunas: (seleção) | Produto | Estoque | Un. Medida | Qtd.

**Tabela**

- Colunas: Parcela | Vencimento | Valor
- Totalizador: Total

**Tabela** — linhas na amostra: 1

- Colunas: (seleção) | Categoria | Centro de Custo | (%) | Valor
- Totalizador: Total 0 0

**Tabela** — linhas na amostra: 1

- Colunas: (seleção) | Categoria | Centro de Custo | (%) | Valor
- Totalizador: Total 0 0

**Formulário POST `/admin/warehouse-transfer-between-farms`** — botões: Salvar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `code` | Código | text | R |  |  |  |
| `user` | Usuário | text | R |  |  |  |
| `created` | Dt. Criação | text | R |  |  |  |
| `type` | Tipo Movimentação | select | R |  | Transferência |  |
| `has_financial` | Gerar financeiro? | select | R |  | Não, Sim |  |
| `vl_total` | Valor | text (moeda) |  |  |  |  |
| `farm_id` | Fazenda | text | R |  |  |  |
| `farm_out_id` | Fazenda Destino | select | R |  | Fazenda Maira |  |
| `warehouse_id` | Armazém | select | R |  | BARRACAO |  |
| `warehouse_out_id` | Armazém Destino | select | R |  |  |  |
| `stock_id[]` |  | select | R |  |  |  |
| `qnt_stock[]` |  | text (moeda) |  |  |  |  |
| `um[]` |  | text | R |  |  |  |
| `quantity[]` |  | text (moeda) | R |  |  |  |
| `financial_proprietary_id` | Proprietário Gestor | select |  |  | (lista dinâmica de cadastro — 1 registros; valores omitidos por privacidade) |  |
| `has_input` | Possui entrada ? | select |  |  | Sim, Não |  |
| `input_date` | Data entrada | text (data) |  |  |  |  |
| `input_value` | Valor entrada | text (moeda) |  |  |  |  |
| `qtd_installments` | Nª Parcelas | number |  |  |  |  |
| `first_installment` | Venc. 1ª. PC | text (data) |  |  |  |  |
| `int_installments` | Int. Parcelas (dias) | number |  |  |  |  |
| `fiscal_document` | Dedutível | select |  |  | Não, Sim |  |
| `income_categories[]` |  | select |  |  |  |  |
| `income_centers[]` |  | select |  |  | Administração, Estoque Insumos, Estoque Produção, Parque Máquinas, Soja, Soja Precoce, Soja Super Precoce, Terminação - Corte |  |
| `income_category_percent[]` |  | text (moeda) |  |  |  |  |
| `income_category_values[]` |  | text (moeda) |  |  |  |  |
| `expense_categories[]` |  | select |  |  |  |  |
| `expense_centers[]` |  | select |  |  |  |  |
| `expense_category_percent[]` |  | text (moeda) |  |  |  |  |
| `expense_category_values[]` |  | text (moeda) |  |  |  |  |

## SCR-381 · Saldo Estoque

- **Rota:** `/admin/stocks/report`
- **Módulo:** Administrativo > Estoque > Saldo Estoque
- **Tipo:** Relatório
- **Finalidade:** Saldo Estoque (relatório)
- **Cards/Seções:** 

## SCR-382 · Batida

- **Rota:** `/admin/food-beats/create`
- **Módulo:** Administrativo > Estoque > Fábrica > Batida
- **Tipo:** Cadastro (novo)
- **Finalidade:** Batida (cadastro (novo))
- **Abas:** Matéria Prima
- **Botões/Ações (cabeçalho):** Voltar → `/admin/food-beats`

**Formulário POST `/admin/food-beats`** — botões: Salvar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `code` | Código | text |  |  |  |  |
| `user_name` | Responsável | text | R |  |  |  |
| `date` | Data | text | R |  |  |  |
| `food_beat_type` | Tipo Batida | select | R |  | Formulação, Estoque |  |
| `warehouse_id` | Armazém Destino | select | R |  |  |  |
| `food_id` | Produto | select |  |  |  |  |
| `product_id` | Produto | select |  |  | Dieta Adaptação, Dieta Crescimento, Dieta Engorda |  |
| `product_quantity` | Quantidade Referência | text |  |  |  |  |
| `measurement` | Unidade de Medida | text |  |  |  |  |
| `type-name` | Tipo | text |  |  |  |  |
| `quantity` | Quantidade Produzida | text (moeda) | R |  |  |  |
| `provider_lot` | Lt. Fornecedor | text |  | 15 |  |  |
| `shelf_life` | Validade | text (data) |  | 15 |  |  |
| `vl_total` | Vl. Total | text (moeda) |  |  |  |  |

## SCR-383 · Eventos

- **Rota:** `/admin/events/create`
- **Módulo:** Administrativo > Gestão Pessoal > Eventos
- **Tipo:** Cadastro (novo)
- **Finalidade:** Eventos (cadastro (novo))
- **Botões/Ações (cabeçalho):** Voltar → `/admin/events`

**Formulário POST `/admin/events`** — botões: Salvar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `name` | Nome | text | R | 100 |  |  |
| `type` | Tipo | select | R |  | Semanal, Quinzenal, Mensal, Trimestral, Semestral, Anual |  |
| `method` | Método | select | R |  | Informado, Fixo |  |
| `condition` | Estado | select | R |  | Soma, Diminui |  |
| `is_enabled` | Ativo | select | R |  | Sim, Não |  |
| `is_quick_entry` | Entrada Rápida (Grade) | select | R |  | Sim, Não |  |
| `quick_entry_order` | Ordem | text |  |  |  |  |

## SCR-384 · Eventos

- **Rota:** `/admin/events/183`
- **Módulo:** Administrativo > Gestão Pessoal > Eventos
- **Tipo:** Detalhe
- **Finalidade:** Eventos (detalhe)
- **Botões/Ações (cabeçalho):** Voltar → `/admin/events`

## SCR-385 · Eventos

- **Rota:** `/admin/events/183/edit`
- **Módulo:** Administrativo > Gestão Pessoal > Eventos
- **Tipo:** Cadastro (edição)
- **Finalidade:** Eventos (cadastro (edição))
- **Botões/Ações (cabeçalho):** Voltar → `/admin/events`

**Formulário PUT `/admin/events/183`** — botões: Salvar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `name` | Nome | text | R | 100 |  |  |
| `type` | Tipo | select | R |  | Semanal, Quinzenal, Mensal, Trimestral, Semestral, Anual |  |
| `method` | Método | select | R |  | Informado, Fixo |  |
| `condition` | Estado | select | R |  | Soma, Diminui |  |
| `is_enabled` | Ativo | select | R |  | Sim, Não |  |
| `is_quick_entry` | Entrada Rápida (Grade) | select | R |  | Sim, Não |  |
| `quick_entry_order` | Ordem | text |  |  |  |  |

## SCR-386 · Funções

- **Rota:** `/admin/functions/create`
- **Módulo:** Administrativo > Gestão Pessoal > Funções
- **Tipo:** Cadastro (novo)
- **Finalidade:** Funções (cadastro (novo))
- **Botões/Ações (cabeçalho):** Voltar → `/admin/functions`

**Formulário POST `/admin/functions`** — botões: Salvar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `name` | Nome | text | R | 100 |  |  |
| `cbo_id` | Cbo | select | R |  |  |  |
| `base_salary` | Salário Base | text (moeda) | R |  |  |  |
| `monthly_hours` | Horas Mensais | number | R |  |  |  |
| `vl_time_productive` | Vl. Hora | text (moeda) | R |  |  |  |
| `is_enabled` | Ativo | select | R |  | Sim, Não |  |
| `description` | Descrição | text | R | 100 |  |  |

## SCR-387 · Funções

- **Rota:** `/admin/functions/7`
- **Módulo:** Administrativo > Gestão Pessoal > Funções
- **Tipo:** Detalhe
- **Finalidade:** Funções (detalhe)
- **Botões/Ações (cabeçalho):** Voltar → `/admin/functions`

## SCR-388 · Funções

- **Rota:** `/admin/functions/7/edit`
- **Módulo:** Administrativo > Gestão Pessoal > Funções
- **Tipo:** Cadastro (edição)
- **Finalidade:** Funções (cadastro (edição))
- **Botões/Ações (cabeçalho):** Voltar → `/admin/functions`

**Formulário PUT `/admin/functions/7`** — botões: Salvar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `name` | Nome | text | R | 100 |  |  |
| `cbo_id` | Cbo | select | R |  | 5135-05 - Ajudante de cozinha |  |
| `base_salary` | Salário Base | text (moeda) | R |  |  |  |
| `monthly_hours` | Horas Mensais | number | R |  |  |  |
| `vl_time_productive` | Vl. Hora | text (moeda) | R |  |  |  |
| `is_enabled` | Ativo | select | R |  | Sim, Não |  |
| `description` | Descrição | text | R | 100 |  |  |

## SCR-389 · Equipes

- **Rota:** `/admin/teams/report`
- **Módulo:** Administrativo > Gestão Pessoal > Equipes
- **Tipo:** Relatório
- **Finalidade:** Equipes (relatório)
- **Cards/Seções:** 

## SCR-390 · Equipes

- **Rota:** `/admin/teams/create`
- **Módulo:** Administrativo > Gestão Pessoal > Equipes
- **Tipo:** Cadastro (novo)
- **Finalidade:** Equipes (cadastro (novo))
- **Botões/Ações (cabeçalho):** Voltar → `/admin/teams`

**Tabela** — linhas na amostra: 1

- Colunas: (seleção) | Tipo | Fornecedor | Ativo

**Formulário POST `/admin/teams`** — botões: Salvar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `name` | Nome | text | R | 30 |  |  |
| `employee_id` | Encarregado | select | R |  | (lista dinâmica de cadastro — 0 registros; valores omitidos por privacidade) |  |
| `description` | Descrição | text |  | 40 |  |  |
| `is_enabled` | Ativo | select | R |  | Sim, Não |  |
| `provider_type[]` |  | select | R |  | Funcionário, Terceirizado |  |
| `team_provider_id[]` |  | select | R |  |  |  |
| `team_is_enabled[]` |  | select | R |  | Sim, Não |  |

## SCR-391 · Registro/Faltas

- **Rota:** `/admin/absences/create`
- **Módulo:** Administrativo > Gestão Pessoal > Registro/Faltas
- **Tipo:** Cadastro (novo)
- **Finalidade:** Registro/Faltas (cadastro (novo))
- **Botões/Ações (cabeçalho):** Voltar → `/admin/absences`

**Formulário POST `/admin/absences`** — botões: Salvar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `date` | Data | text | R |  |  |  |
| `employee_id` | Funcionário | select | R |  | (lista dinâmica de cadastro — 0 registros; valores omitidos por privacidade) |  |
| `event_id` | Evento | select | R |  | DIAS DE FALTA - DSR, DIAS FALTAS, FALTA, FALTA, HORAS FALTAS PARCIAL |  |
| `period` | Período | select |  |  | Matutino, Vespertino, Integral |  |
| `amount` | Valor | text (moeda) | R |  |  |  |

## SCR-392 · Rateio do Adiantamento

- **Rota:** `/admin/advances/create`
- **Módulo:** Administrativo > Gestão Pessoal > Adiant. Salarial
- **Tipo:** Cadastro (novo)
- **Finalidade:** Adiant. Salarial (cadastro (novo))
- **Botões/Ações (cabeçalho):** Voltar → `/admin/advances`

**Tabela**

- Colunas: Parcela | Vencimento | Valor
- Totalizador: Total

**Tabela** — linhas na amostra: 1

- Colunas: (seleção) | Categoria | Conta Contábil | Centro de Custo | (%) | Valor
- Totalizador: Total 0 0

**Formulário POST `/admin/advances`** — botões: Salvar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `date` | Data | text | R |  |  |  |
| `employee_id` | Funcionário | select | R |  | (lista dinâmica de cadastro — 0 registros; valores omitidos por privacidade) |  |
| `event_id` | Evento | select | R |  | ADIANTAMENTO DE FÉRIAS, ADIANTAMENTO DE SALÁRIO |  |
| `total` | Valor | text (moeda) | R |  |  |  |
| `has_financial` | Gerar financeiro? | select | R |  | Não, Sim |  |
| `installments[0][month]` |  | text | R |  |  |  |
| `installments[0][value]` |  | text (moeda) | R |  |  |  |
| `financial_number` | Nº Título | text |  | 15 |  |  |
| `financial_type_id` | Tipo | select |  |  | Ad. Cliente, Ad.Fornecedor, Ad.Funcionario, Boleto, Cartão de Crédito, Cheque, Contrato, Cupom Fiscal … (23) |  |
| `financial_proprietary_id` | Proprietário Gestor | select |  |  | (lista dinâmica de cadastro — 1 registros; valores omitidos por privacidade) |  |
| `financial_provider_id` | Fornecedor | select |  |  | (lista dinâmica de cadastro — 41 registros; valores omitidos por privacidade) … (41) |  |
| `financial_note` | Histórico | textarea |  | 1000 |  |  |
| `has_input` | Possui entrada ? | select |  |  | Sim, Não |  |
| `input_date` | Data entrada | text (data) |  |  |  |  |
| `input_value` | Valor entrada | text (moeda) |  |  |  |  |
| `qtd_installments` | Nª Parcelas | number |  |  |  |  |
| `first_installment` | Venc. 1ª. PC | text (data) |  |  |  |  |
| `int_installments` | Int. Parcelas (dias) | number |  |  |  |  |
| `fiscal_document` | Dedutível | select |  |  | Não, Sim |  |
| `categories[]` |  | select |  |  |  |  |
| `plan_accounts[]` |  | select |  |  |  |  |
| `centers[]` |  | select |  |  | Administração, Estoque Insumos, Estoque Produção, Parque Máquinas, Soja, Soja Precoce, Soja Super Precoce, Terminação - Corte |  |
| `category_percent_values[]` |  | text (moeda) | R |  |  |  |
| `category_values[]` |  | text (moeda) |  |  |  |  |

## SCR-393 · Registro/Eventos

- **Rota:** `/admin/bonuses/create`
- **Módulo:** Administrativo > Gestão Pessoal > Registro/Eventos
- **Tipo:** Cadastro (novo)
- **Finalidade:** Registro/Eventos (cadastro (novo))
- **Botões/Ações (cabeçalho):** Voltar → `/admin/bonuses`

**Formulário POST `/admin/bonuses`** — botões: Salvar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `date` | Data | text | R |  |  |  |
| `employee_id` | Funcionário | select | R |  | (lista dinâmica de cadastro — 0 registros; valores omitidos por privacidade) |  |
| `event_id` | Evento | select | R |  | 1/3 Férias em dobro, 1/3 FERIAS PROPORC. RESCISÃO, 1/3 S/ ABONO, 13 SAL COMPLEMENTAR, 13 SALARIO, 13 SALARIO ADIANTADO, 13 SALARIO INTEGRAL RESCISÃO, 13° salário - 2 parcela … (124) |  |
| `amount` | Valor | text (moeda) | R |  |  |  |

## SCR-394 · Funcionário X Eventos

- **Rota:** `/admin/employeeevents/report`
- **Módulo:** Administrativo > Gestão Pessoal > Funcionário X Eventos
- **Tipo:** Relatório
- **Finalidade:** Funcionário X Eventos (relatório)
- **Cards/Seções:** 

## SCR-395 · Funcionário x Eventos

- **Rota:** `/admin/employeeevents/create`
- **Módulo:** Administrativo > Gestão Pessoal > Funcionário X Eventos
- **Tipo:** Cadastro (novo)
- **Finalidade:** Funcionário X Eventos (cadastro (novo))
- **Botões/Ações (cabeçalho):** Voltar → `/admin/employeeevents`

**Tabela** — linhas na amostra: 1

- Colunas: (seleção) | Evento | Condição | Valor | Método | Ativo

**Formulário POST `/admin/employeeevents`** — botões: Salvar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `employee_id` | Funcionário | select | R |  | (lista dinâmica de cadastro — 0 registros; valores omitidos por privacidade) |  |
| `cpf` | CPF/CNPJ | text |  |  |  |  |
| `function` | Função | text |  |  |  |  |
| `event_id[]` |  | select | R |  | 1/3 Férias em dobro, 1/3 FERIAS PROPORC. RESCISÃO, 1/3 S/ ABONO, 13 SAL COMPLEMENTAR, 13 SALARIO, 13 SALARIO ADIANTADO, 13 SALARIO INTEGRAL RESCISÃO, 13° salário - 2 parcela … (176) |  |
| `condition[]` | Condição | select | R |  | Soma, Diminui |  |
| `value[]` | Valor | text (moeda) | R |  |  |  |
| `method[]` | Método | select | R |  | Informado, Fixo |  |
| `is_enabled[]` | Ativo | select | R |  | Sim, Não |  |

## SCR-396 · Tipo de Documento

- **Rota:** `/admin/document-types/create`
- **Módulo:** Administrativo > Gestão Documentos > Tipo Documento
- **Tipo:** Cadastro (novo)
- **Finalidade:** Tipo Documento (cadastro (novo))
- **Botões/Ações (cabeçalho):** Voltar → `/admin/document-types`

**Formulário POST `/admin/document-types`** — botões: Salvar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `name` | Nome | text | R | 60 |  |  |
| `order` | Ordem | number | R |  |  |  |
| `is_enabled` | Ativo | select | R |  | Sim, Não |  |
| `parent_id` | Antecessor | select |  |  | Não Contém, 1 - Pessoa Física, 1.01 - CAR, 2 - Pessoa Jurídica, 2 - Pessoa Jurídica, 1 - doc 01, 3 - NFe, 4 - Contrato de Compra … (63) |  |

## SCR-397 · Tipo de Documento

- **Rota:** `/admin/document-types/35`
- **Módulo:** Administrativo > Gestão Documentos > Tipo Documento
- **Tipo:** Detalhe
- **Finalidade:** Tipo Documento (detalhe)
- **Botões/Ações (cabeçalho):** Voltar → `/admin/accounting-groupers`

## SCR-398 · Tipo de Documento

- **Rota:** `/admin/document-types/35/edit`
- **Módulo:** Administrativo > Gestão Documentos > Tipo Documento
- **Tipo:** Cadastro (edição)
- **Finalidade:** Tipo Documento (cadastro (edição))
- **Botões/Ações (cabeçalho):** Voltar → `/admin/document-types`

**Formulário PUT `/admin/document-types/35`** — botões: Salvar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `name` | Nome | text | R | 60 |  |  |
| `order` | Ordem | number | R |  |  |  |
| `is_enabled` | Ativo | select | R |  | Sim, Não |  |
| `parent_id` | Antecessor | select |  |  | Não Contém, 1 - Pessoa Física, 1.01 - CAR, 2 - Pessoa Jurídica, 2 - Pessoa Jurídica, 1 - doc 01, 3 - NFe, 4 - Contrato de Compra … (63) |  |

## SCR-399 · Gestão de Documentos

- **Rota:** `/admin/document-managements/create`
- **Módulo:** Administrativo > Gestão Documentos > Documentos
- **Tipo:** Cadastro (novo)
- **Finalidade:** Documentos (cadastro (novo))
- **Botões/Ações (cabeçalho):** Voltar → `/admin/document-managements`

**Formulário POST `/admin/document-managements`** — botões: Salvar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `code` | Código | text |  |  |  |  |
| `document_type_id` | Tipo de Documento | select | R |  | FICHA DE ENTREGA DE EPI - INTS, ASOS |  |
| `description` | Descrição | text | R |  |  |  |
| `validity` | Data de Validade | text (data) |  |  |  |  |
| `alert_days` | Dias de Alerta | number |  |  |  |  |
| `observation` | Observação | textarea |  | 200 |  |  |
| `attachments[0][name]` | Descrição | text | R |  |  |  |
| `attachments[0][file]` |  | file | R |  |  |  |

## SCR-451 · Informação do Pedido

- **Rota:** `/admin/request-purchase/11105`
- **Módulo:** Administrativo > Suprimentos > Solicitação
- **Tipo:** Detalhe
- **Finalidade:** Solicitação (detalhe)
- **Botões/Ações (cabeçalho):** Voltar → `/admin/farms/80/map-print`

**Tabela** — linhas na amostra: 3

- Colunas: Data | Responsável | Status | Tempo Gasto | Descrição/Justificativa

**Tabela** — linhas na amostra: 1

- Colunas: Código | Responsável Atual | Status Atual

## SCR-452 · Informação do Pedido

- **Rota:** `/admin/request-purchase/12095`
- **Módulo:** Administrativo > Suprimentos > Solicitação
- **Tipo:** Detalhe
- **Finalidade:** Solicitação (detalhe)
- **Botões/Ações (cabeçalho):** Voltar → `/admin/request-purchase/11105`

**Tabela** — linhas na amostra: 1

- Colunas: Autorizado | Autorizador | Dt. Autorização | Justificativa Final

**Tabela** — linhas na amostra: 1

- Colunas: Observação

**Tabela** — linhas na amostra: 3

- Colunas: Data | Responsável | Status | Tempo Gasto | Descrição/Justificativa

## SCR-453 · Informação do Pedido

- **Rota:** `/admin/request-purchase/14142`
- **Módulo:** Administrativo > Suprimentos > Solicitação
- **Tipo:** Detalhe
- **Finalidade:** Solicitação (detalhe)
- **Botões/Ações (cabeçalho):** Voltar → `/admin/request-purchase/12095`

**Tabela** — linhas na amostra: 1

- Colunas: Data | Responsável | Status | Tempo Gasto | Descrição/Justificativa

## SCR-454 · Informação do Pedido

- **Rota:** `/admin/request-authorization/15471/second`
- **Módulo:** Administrativo > Suprimentos > Autorização
- **Tipo:** Listagem
- **Finalidade:** Autorização (listagem)
- **Botões/Ações (cabeçalho):** Voltar → `/admin/request-purchase/14142`
- **Modais:** Enviar para Autorização; Transferir Responsável

**Tabela** — linhas na amostra: 1

- Colunas: Data | Responsável | Status | Descrição/Justificativa

**Formulário PUT `/admin/request-authorization/15471/second`** (modal finishModal) — botões: Salvar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `justify` | Comentário/Justificativa | textarea | R | 300 |  |  |
| `authorizer_id` | Autorizador | select | R |  | (lista dinâmica de cadastro — 1 registros; valores omitidos por privacidade) |  |

**Formulário PUT `/admin/request-authorization/15471/change`** (modal transferModal) — botões: Salvar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `justify` | Comentário/Justificativa | textarea | R | 300 |  |  |
| `responsible_id` | Autorizador | select | R |  | (lista dinâmica de cadastro — 0 registros; valores omitidos por privacidade) |  |

