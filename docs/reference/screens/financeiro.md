# Telas — Financeiro

Detalhamento tela a tela (sistema de referência). Legenda: **R** = obrigatório observado (atributo required/asterisco), tipo = tipo do controle HTML observado; "Opções" mostra amostra (até 8) das opções de listas.

## SCR-009 · Contas a Pagar

- **Rota:** `/admin/expenses`
- **Módulo:** Financeiro > Contas a Pagar
- **Tipo:** Listagem
- **Finalidade:** Contas a Pagar (listagem)
- **Botões/Ações (cabeçalho):** Saiba +; Simular Crédito (modal #simulateCreditModal); Baixar Contas; Excluir Contas; Importar → `#` (modal #modalImport); Exportar → `/admin/expenses/export`; Adicionar Novo → `/admin/expenses/create`
- **Modais:** Cancelar Baixa; Rateio Financeiro da Fatura; Recorrências; Acesse mais e melhor crédito!; Baixar Contas; Importar

**Filtros (GET)** — botões: Filtrar

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `provider_id` | Fornecedor | select | (lista dinâmica de cadastro — 41 registros; valores omitidos por privacidade) … (41) |
| `proprietary_id` | Proprietário Gestor | select | (lista dinâmica de cadastro — 1 registros; valores omitidos por privacidade) |
| `type_note` | Tipo Nota | select | NF-e, CT-e, NFS-e, NFC-e, DANF-e, DARF, DARE, GRU |
| `number` | Nº Título | text |  |
| `status` | Status | select | Á vencer, Vencida, Baixa Parcial, Baixada, Adiantamento/Pendente, Adiantamento/Baixado, Fatura/Pendente, Fatura/Baixado |
| `start_date` | Dt. Venc. Inicio | text (data) |  |
| `end_date` | Dt. Venc. Fim | text (data) |  |
| `start_emission_date` | Dt. Emissão Inicio | text (data) |  |
| `end_emission_date` | Dt. Emissão Fim | text (data) |  |
| `start_write_off_date` | Dt. Baixa/Inicio | text (data) |  |
| `end_write_off_date` | Dt. Baixa/Fim | text (data) |  |
| `amount` | Vlr Título | text |  |
| `note` | Histórico | text |  |
| `farm_id` | Fazenda | select | Fazenda Maira, Fazenda São Paulo |
| `pagination_quantity` | Qtd. de Registros | select | 20 Registros, 30 Registros, 50 Registros, 80 Registros, 100 Registros, Todos |
| `category_id` | Categoria | select | Todas |
| `center_id` | Centro de Custo | select | Todos, Administração, Estoque Insumos, Estoque Produção, Parque Máquinas, Soja, Soja Precoce, Soja Super Precoce … (9) |
| `account_id` | Conta Bancária | select | Todas, CXF - 000 - Caixa Fazenda - 01, CXF1 - 000 - Caixa Fazenda - 02, CXF - 000 - Caixa Fazenda - 03, CXF - 000 - INVESTIMENTO 1, 0013 - 56, BB - BB Principal |
| `type_id` | Tipo de Título | select | Ad. Cliente, Ad.Fornecedor, Ad.Funcionario, Boleto, Cartão de Crédito, Cheque, Contrato, Cupom Fiscal … (23) |
| `payment_type` | Tipo de Lançamento | select | Parcela Única, Parcelada, Recorrente, Adiantamento, Fatura |
| `product` | Produto/Categoria Animal | text |  |
| `harvest_id` | Safra | select | Todas, Safra 1, TESTE, Safra 2024/2025, Safra 2023/2024, Safra 2023/2024 |

**Filtros (GET)** — botões: Confirmar

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `amount` | Valor (R$) | text |  |
| `categories[]` |  | select |  |
| `plan_accounts[]` |  | select |  |
| `centers[]` |  | select | Administração, Estoque Insumos, Estoque Produção, Parque Máquinas, Soja, Soja Precoce, Soja Super Precoce, Terminação - Corte |
| `category_percent_values[]` |  | text |  |
| `category_values[]` |  | text |  |

**Tabela** (N. Registros: 4) — linhas na amostra: 4

- Colunas: (seleção) | (seleção) | # | Código | Nº Título | Gestor | Tipo | Fornecedor | Parcela | Dt. Venc. | Dt. Emissão | Dt. Baixa | Dedutível | Valor | Saldo | Ação
- Ações por linha: Visualizar, Documentos, Gerar Recibo, Baixar, Duplicar, Editar, Excluir
- Links por linha: `/admin/expenses/{id}`, `/admin/expenses/{id}/documents/create`, `/admin/expense-receipt/{id}`, `/admin/expenses/{id}/writeoff`, `/admin/expenses/{id}/duplicate`, `/admin/expenses/{id}/edit`
- Totalizador: Total 3.000,00 2.250,00

**Formulário POST `/admin/expenses`** (modal newWritteOfModal) — botões: Baixar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `banking_movement` | Tipo de baixa | select |  |  | Movimento Bancário, Baixa Cruzada |  |
| `account_id` | Conta Bancária | select | R |  | CXF - 000 - Caixa Fazenda - 01, CXF1 - 000 - Caixa Fazenda - 02, CXF - 000 - Caixa Fazenda - 03, CXF - 000 - INVESTIMENTO 1, 0013 - 56, BB - BB Principal |  |
| `date_movement` | Data Movimento | date | R |  |  |  |
| `writeoff_type` | Tipo Movimento | select | R |  | Movimento Bancário Separado, Único Movimento Bancário |  |
| `provider_client_title` | Fornecedor c/ Saldo | select |  |  | (lista dinâmica de cadastro — 0 registros; valores omitidos por privacidade) |  |
| `title` | Título | select |  |  |  |  |
| `title_balance` | Saldo do Título | text (moeda) |  |  |  |  |
| `writeoff_note` | Histórico | textarea |  |  |  |  |
| `amount` | Valor Baixado R$ | text (moeda) | R |  |  |  |
| `discount` | Desconto R$ | text (moeda) |  |  |  |  |
| `penalty` | Multa R$ | text (moeda) |  |  |  |  |
| `interest` | Juros R$ | text (moeda) |  |  |  |  |
| `increase` | Acréscimo R$ | text (moeda) |  |  |  |  |
| `foreign_amount` | Valor em Moeda Estrangeira | text (moeda) |  |  |  |  |
| `ptax_rate` | Cotação PTAX do Dia R$ | text (moeda) |  |  |  |  |
| `ptax_value` | Acréscimo/Desconto Cambial R$ (calculado) | text (moeda) |  |  |  |  |
| `net_value` | Valor Líquido R$ | text (moeda) | R |  |  |  |
| `description` |  | text |  | 50 |  |  |
| `file` |  | file |  |  |  |  |
| `date_file` |  | date |  |  |  |  |

**Formulário POST `/admin/expenses/import`** (modal modalImport) — botões: Importar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `file` |  | file | R |  |  |  |

- Mensagens/alertas: Não dependa só do Plano Safra, acesse mais e melhor crédito! Na Creditares te conectamos a vários financiadores simultan

## SCR-010 · Conta a Receber

- **Rota:** `/admin/incomes`
- **Módulo:** Financeiro > Contas a Receber
- **Tipo:** Listagem
- **Finalidade:** Contas a Receber (listagem)
- **Botões/Ações (cabeçalho):** Saiba +; Baixar Contas; Excluir Contas; Gerar Boleto; Importar → `#` (modal #modalImport); Exportar → `/admin/incomes/export`; Adicionar Novo → `/admin/incomes/create`
- **Modais:** Gerar Boletos; Baixar Contas; Cancelar Baixa; Importar

**Filtros (GET)** — botões: Filtrar

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `number` | Nº Título | text |  |
| `nfe` | NFe | text |  |
| `client` | Cliente | select | (lista dinâmica de cadastro — 8 registros; valores omitidos por privacidade) |
| `start_date` | Dt. Venc. Inicio | text (data) |  |
| `end_date` | Dt. Venc. Fim | text (data) |  |
| `start_emission_date` | Dt. Emissão Inicio | text (data) |  |
| `end_emission_date` | Dt. Emissão Fim | text (data) |  |
| `start_write_off_date` | Dt. Baixa/Inicio | text (data) |  |
| `end_write_off_date` | Dt. Baixa/Fim | text (data) |  |
| `note` | Histórico | text |  |
| `status` | Status | select | Á vencer, Vencida, Baixa Parcial, Baixada, Adiantamento/Pendente, Adiantamento/Baixado |
| `amount` | Vlr Título | text |  |
| `proprietary_id` | Proprietário Gestor | select | (lista dinâmica de cadastro — 1 registros; valores omitidos por privacidade) |
| `farm_id` | Fazenda | select | Fazenda Maira, Fazenda São Paulo |
| `pagination_quantity` | Qtd. de Registros | select | 10 Registros, 30 Registros, 50 Registros, 80 Registros, 100 Registros, Todos |
| `category_id` | Categoria | select | Todas |
| `center_id` | Centro de Custo | select | Todos, Administração, Estoque Insumos, Estoque Produção, Parque Máquinas, Soja, Soja Precoce, Soja Super Precoce … (9) |
| `account_id` | Conta Bancária | select | Todas, CXF - 000 - Caixa Fazenda - 03, CXF - 000 - Caixa Fazenda - 01, CXF1 - 000 - Caixa Fazenda - 02, CXF - 000 - INVESTIMENTO 1, 0013 - 56, BB - BB Principal |
| `harvest_id` | Safra | select | Todas, Safra 1, TESTE, Safra 2024/2025, Safra 2023/2024, Safra 2023/2024 |

**Tabela** (N. Registros: 1) — linhas na amostra: 1

- Colunas: (seleção) | (seleção) | # | Código | Nº Título | NFe | Gestor | Tipo | Cliente | Dt. Venc. | Dt. Emissão | Dt. Baixa | Dedutível | Valor | Saldo | Ação
- Ações por linha: Visualizar, Documentos, Editar, Duplicar, Baixar, Gerar Boleto, Gerar Recibo, Excluir
- Links por linha: `/admin/incomes/{id}`, `/admin/incomes/{id}/documents/create`, `/admin/incomes/{id}/edit`, `/admin/incomes/{id}/duplicate`, `/admin/incomes/{id}/writeoff`, `/admin/incomes/{id}/tickets/create`, `/admin/income-receipt/{id}`
- Totalizador: Total 317.522,00 317.522,00

**Formulário POST `/admin/incomes`** (modal ticketModal) — botões: Gerar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `account_id` | Conta Bancária | select | R |  | 0013 - 56 |  |
| `proprietary_name` | Titular | text | R |  |  |  |
| `number` | Nº boleto | number | R |  |  |  |
| `instructions` | Instruções do Boleto | textarea | R |  |  |  |

**Formulário POST `/admin/incomes`** (modal newWritteOfModal) — botões: Baixar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `banking_movement` | Tipo de baixa | select |  |  | Movimento Bancário, Baixa Cruzada |  |
| `account_id` | Conta Bancária | select | R |  | CXF - 000 - Caixa Fazenda - 03, CXF - 000 - Caixa Fazenda - 01, CXF1 - 000 - Caixa Fazenda - 02, CXF - 000 - INVESTIMENTO 1, 0013 - 56, BB - BB Principal |  |
| `date_movement` | Data Movimento | date | R |  |  |  |
| `writeoff_type` | Tipo Movimento | select | R |  | Movimento Bancário Separado, Único Movimento Bancário |  |
| `provider_client_title` | Cliente c/ Saldo | select |  |  | (lista dinâmica de cadastro — 0 registros; valores omitidos por privacidade) |  |
| `title` | Título | select |  |  |  |  |
| `title_balance` | Saldo do Título | text (moeda) |  |  |  |  |
| `writeoff_note` | Histórico | textarea |  |  |  |  |
| `amount` | Valor Baixado R$ | text (moeda) | R |  |  |  |
| `discount` | Desconto R$ | text (moeda) |  |  |  |  |
| `penalty` | Multa R$ | text (moeda) |  |  |  |  |
| `interest` | Juros R$ | text (moeda) |  |  |  |  |
| `increase` | Acréscimo R$ | text (moeda) |  |  |  |  |
| `foreign_amount` | Valor em Moeda Estrangeira | text (moeda) |  |  |  |  |
| `ptax_rate` | Cotação PTAX do Dia R$ | text (moeda) |  |  |  |  |
| `ptax_value` | Acréscimo/Desconto Cambial R$ (calculado) | text (moeda) |  |  |  |  |
| `net_value` | Valor Líquido R$ | text (moeda) | R |  |  |  |
| `description` |  | text |  | 50 |  |  |
| `file` |  | file |  |  |  |  |
| `date_file` |  | date |  |  |  |  |

**Formulário POST `/admin/incomes/import`** (modal modalImport) — botões: Importar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `file` |  | file | R |  |  |  |

## SCR-011 · Movimento Caixa/Bancário

- **Rota:** `/admin/movements`
- **Módulo:** Financeiro > Mov. Caixa/Bancário
- **Tipo:** Listagem
- **Finalidade:** Mov. Caixa/Bancário (listagem)
- **Botões/Ações (cabeçalho):** Saiba +; Simular Crédito (modal #simulateCreditModal); Importar → `#` (modal #modalImport); Exportar → `/admin/movements/export`; Adicionar Novo → `/admin/movements/create`
- **Modais:** Acesse mais e melhor crédito!; Importar
- **Paginação:** sim (server-side, seletor de quantidade 10–200)

**Filtros (GET)** — botões: Filtrar

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `account` | Conta Bancária | select | CXF - 000 - Caixa Fazenda - 01, CXF1 - 000 - Caixa Fazenda - 02, CXF - 000 - Caixa Fazenda - 03, CXF - 000 - INVESTIMENTO 1, 0013 - 56, BB - BB Principal |
| `start_date` | Dt. Início | text |  |
| `end_date` | Dt. Fim | text |  |
| `start_value` | Valor Inicial | text |  |
| `end_value` | Valor Final | text |  |
| `proprietary_id` | Proprietário Gestor | select | (lista dinâmica de cadastro — 1 registros; valores omitidos por privacidade) |
| `harvest_id` | Safra | select | Safra 1, TESTE, Safra 2024/2025, Safra 2023/2024, Safra 2023/2024 |
| `client_id` | Cliente | select | (lista dinâmica de cadastro — 8 registros; valores omitidos por privacidade) |
| `provider_id` | Fornecedor | select | (lista dinâmica de cadastro — 41 registros; valores omitidos por privacidade) … (41) |
| `type_movement` | Tipo Mov. (E/S) | select | Ambas, Entrada, Saída |
| `type_category` | Filtro Tipo Cat. | select | Entrada, Saída, Trans. Interna, Financiamento/Empréstimo |
| `category` | Categoria | select |  |
| `pagination_quantity` | Qtd. de Registros | select | 10 Registros, 30 Registros, 50 Registros, 80 Registros, 100 Registros, 200 Registros |

**Tabela** (N. Registros: 99) — linhas na amostra: 10

- Colunas: # | Código | Dt. Mov. | Sigla | Agência | Conta | Gestor | Nº Documento. | E/S | Juros | Dedutível | V. Total(R$) | Ação
- Ações por linha: Visualizar, Imprimir Comprovante, Documentos, Editar, Excluir
- Links por linha: `/admin/movements/{id}`, `/admin/movements/{id}/receipt`, `/admin/movements/{id}/documents/create`, `/admin/movements/{id}/edit`
- Totalizador: Total 100,00 96.260,57

**Formulário POST `/admin/movements/import`** (modal modalImport) — botões: Importar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `file` |  | file | R |  |  |  |

- Mensagens/alertas: Não dependa só do Plano Safra, acesse mais e melhor crédito! Na Creditares te conectamos a vários financiadores simultan

## SCR-012 · Importar OFX

- **Rota:** `/admin/ofx-imports`
- **Módulo:** Financeiro > Conciliação > Importação OFX
- **Tipo:** Listagem
- **Finalidade:** Importação OFX (listagem)
- **Botões/Ações (cabeçalho):** Saiba +; Adicionar Novo → `/admin/ofx-imports/create`

**Filtros (GET)** — botões: Filtrar

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `description` | Descrição | text |  |
| `account_id` | Conta Bancária | select | Todas, CXF - 000 - Caixa Fazenda - 01, CXF1 - 000 - Caixa Fazenda - 02, CXF - 000 - Caixa Fazenda - 03, 0013 - 56 |
| `start_date` | Data Inicial | text (data) |  |
| `end_date` | Data final | text (data) |  |

**Tabela** (N. Registros: 2) — linhas na amostra: 2

- Colunas: Código | Descrição | Conta | Data Inicial | Data final | Ação
- Ações por linha: Visualizar, Editar, Conciliar, Excluir
- Links por linha: `/admin/ofx-imports/{id}`, `/admin/ofx-imports/{id}/edit`, `/admin/ofx-imports/{id}/reconciliation`

## SCR-013 · Meses Conciliados

- **Rota:** `/admin/ofx-report`
- **Módulo:** Financeiro > Conciliação > Meses Conciliados
- **Tipo:** Relatório
- **Finalidade:** Meses Conciliados (relatório)
- **Cards/Seções:** 

## SCR-138 · Análise do Fluxo Bancário

- **Rota:** `/admin/cash-flow`
- **Módulo:** Financeiro > Fluxo Bancário
- **Tipo:** Relatório
- **Finalidade:** Fluxo Bancário (relatório)
- **Botões/Ações (cabeçalho):** Simular Crédito (modal #simulateCreditModal)
- **Modais:** Movimentações da Data; Acesse mais e melhor crédito!; Acesse mais e melhor crédito!
- **Cards/Seções:** Análise do Fluxo Bancário

**Filtros (GET)** — botões: Filtrar

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `accounts[]` | Conta Bancária | select (múltiplo) | CXF - 000 - Caixa Fazenda - 01, CXF1 - 000 - Caixa Fazenda - 02, CXF - 000 - Caixa Fazenda - 03, CXF - 000 - INVESTIMENTO 1, 0013 - 56, BB - BB Principal |
| `period` | Periodicidade | select | Diário, Mensal, Anual |
| `type` | Tipo | select | Sintético, Analítico |
| `start_date` | Dt. Início | text |  |
| `end_date` | Dt. Fim | text |  |

- Mensagens/alertas: Não dependa só do Plano Safra, acesse mais e melhor crédito! Na Creditares te conectamos a vários financiadores simultan | Não dependa só do Plano Safra, acesse mais e melhor crédito! Na Creditares te conectamos a vários financiadores simultan

## SCR-139 · Gestão Contratos

- **Rota:** `/admin/contracts`
- **Módulo:** Financeiro > Gestão Contratos
- **Tipo:** Listagem
- **Finalidade:** Gestão Contratos (listagem)
- **Botões/Ações (cabeçalho):** Adicionar Novo → `/admin/contracts/create`

**Filtros (GET)** — botões: Filtrar

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `provider_id` | Fornecedor | select | (lista dinâmica de cadastro — 39 registros; valores omitidos por privacidade) … (39) |
| `employee_id` | Responsável | select | (lista dinâmica de cadastro — 0 registros; valores omitidos por privacidade) |

**Tabela** (N. Registros: 0) — linhas na amostra: 1

- Colunas: Código | Data de vencimento | Fornecedor | Quantidade | Ação

## SCR-140 · Previsão Orçamentária Anual

- **Rota:** `/admin/budget-plannings`
- **Módulo:** Financeiro > Prev. Orçamentária
- **Tipo:** Listagem
- **Finalidade:** Prev. Orçamentária (listagem)
- **Botões/Ações (cabeçalho):** Importar → `#` (modal #modalImport); Adicionar Novo → `/admin/budget-plannings/create`
- **Modais:** Importar

**Tabela** (N. Registros:: 0) — linhas na amostra: 1

- Colunas: Código | Data | Responsável | Ano | Ação

**Formulário POST `/admin/budget-plannings/import`** (modal modalImport) — botões: Importar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `file` |  | file | R |  |  |  |
| `year` | Ano | number | R |  |  |  |

## SCR-141 · Congelamento Financeiro

- **Rota:** `/admin/financial-freezes`
- **Módulo:** Financeiro > Congelamentos Financeiros
- **Tipo:** Listagem
- **Finalidade:** Congelamentos Financeiros (listagem)
- **Botões/Ações (cabeçalho):** Adicionar Novo → `/admin/financial-freezes/create`

**Filtros (GET)** — botões: Filtrar

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `month` | Mês | select | Todos, Janeiro, Fevereiro, Março, Abril, Maio, Junho, Julho … (13) |
| `year` | Ano | text |  |

**Tabela** (N. Registros: 0) — linhas na amostra: 1

- Colunas: Mês | Ano | Fazenda | Responsável | Congelado? | Dt. Criação | Dt. Atualização | Ação

## SCR-142 · Planilha de Movimentos

- **Rota:** `/admin/movement-sheets`
- **Módulo:** Financeiro > Import. Mov. Bancários
- **Tipo:** Listagem
- **Finalidade:** Import. Mov. Bancários (listagem)
- **Botões/Ações (cabeçalho):** Importar → `#` (modal #modalImport)
- **Modais:** Importar

**Filtros (GET)** — botões: Filtrar

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `start_date` | Dt. Início | text |  |
| `end_date` | Dt. Fim | text |  |

**Tabela** (N. Registros: 0) — linhas na amostra: 1

- Colunas: Código | Responsável | Dt. Emissão | Ação

**Formulário POST `/admin/movement-sheets/import`** (modal modalImport) — botões: Importar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `file` |  | file | R |  |  |  |

## SCR-276 · Contas a Pagar

- **Rota:** `/admin/expenses/create`
- **Módulo:** Financeiro > Contas a Pagar
- **Tipo:** Cadastro (novo)
- **Finalidade:** Contas a Pagar (cadastro (novo))
- **Botões/Ações (cabeçalho):** Voltar → `/admin/expenses`
- **Modais:** Novo Fornecedor; newBranchModal; installmentModal

**Filtros (GET)** — botões: Confirmar Parcelas

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `total_amount` | Valor Total | text |  |
| `qtd_installments` | Nª Parcelas | number |  |
| `first_installment` | Venc. 1ª. PC | text (data) |  |
| `installment_mode` | Por Intervalo (dias) | radio |  |
| `installment_mode` | Dia Fixo do Mês | radio |  |
| `int_installments` | Int. Parcelas (dias) | number |  |
| `due_day` | Dia de Vencimento | number |  |
| `has_input` | Possui entrada | select | Sim, Não |
| `input_value` | Valor entrada | text |  |
| `input_date` | Data entrada | text (data) |  |
| `all_files[]` | Escolher arquivo | file |  |

**Tabela** — linhas na amostra: 1

- Colunas: (seleção) | Categoria | Conta Contábil | Centro de Custo | Área | Safra | Porcentagem | Valor (R$)

**Formulário POST `/admin/expenses/xml`**

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `arquivo` |  | file |  |  |  |  |

**Formulário POST `/admin/expenses`** — botões: Salvar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `farm_id` | Fazenda | select | R |  | Fazenda Maira, Fazenda São Paulo |  |
| `number` | Nº Título | text | R | 15 |  |  |
| `type_id` | Tipo de Título | select | R |  | Boleto, Duplicata, Cheque, Nota Fiscal - NFe, Recibo, Ad.Fornecedor, Ad.Funcionario, Cupom Fiscal … (23) |  |
| `proprietary_id` | Proprietário Gestor | select |  |  | (lista dinâmica de cadastro — 1 registros; valores omitidos por privacidade) |  |
| `payment_type` | Tipo Lançamento | select | R |  | Parcela Única, Parcelada, Recorrente, Adiantamento, Fatura |  |
| `recurrence_type` | Recorrência | select |  |  | Semanal, Mensal, Trimestral, Anual |  |
| `classification` | Classificação | select | R |  | Não Classificado, CAPEX, OPEX | CAPEX: Investimentos de longo prazo, como aquisição de bens que serão usados por mais de um ano (equipamentos, prédios, etc.). \n OPEX: Despesas operacionais re |
| `type_note` | Tipo Nota | select |  |  | NF-e, CT-e, NFS-e, NFC-e, DANF-e, DARF, DARE, GRU |  |
| `fiscal_document` | Dedutível | select | R |  | Não, Sim | Indica se este documento fiscal pode ser utilizado para dedução de tributos |
| `amount` | Vlr Título | text (moeda) | R |  |  | Valor total do título (bruto), sem descontos. \n Multa, juros e acréscimos por atraso não são informados aqui — eles só são calculados no momento da baixa/pagam |
| `dt_emission` | Dt. Emissão | text | R |  |  |  |
| `due_date` | Dt. Vencimento | text | R |  |  |  |
| `discount` | Desconto | text (moeda) |  |  |  | Desconto concedido sobre o valor do título (ex: desconto comercial ou por pagamento antecipado). \n É subtraído do Valor do Título para compor o Valor Líquido. |
| `net_value_display` | Valor Líquido | text (moeda) |  |  |  | Valor Líquido = Valor do Título − Desconto. \n Campo apenas informativo, calculado automaticamente. Não é enviado ao salvar o título. |
| `is_taxation` | É tributo? | select | R |  | Não, Sim |  |
| `provider_id` | Fornecedor | select | R |  | (lista dinâmica de cadastro — 41 registros; valores omitidos por privacidade) … (41) |  |
| `branch_id` | Filial | select |  |  |  |  |
| `appropriation` | Apropriação | select | R |  | Direta, Indireta | Esta opção define se a apropriação da conta será feita após o cadastro da mesma \n \n Se estiver marcada com direta, será feita a apropriação após o cadastro, c |
| `appropriation_type` | Tipo Apropriação | select |  |  | Indireta, Pecuária, Área, Manutenção, Abastecimento | Esta opção define o tipo de apropriação da conta \n \n Área: A apropriação será feita por área, onde será necessário selecionar a área para cada rateio cadastra |
| `note` | Histórico | textarea | R | 1500 |  | A identificação/nome da conta que está sendo cadastrada |
| `aprop_area_id[]` | Área | select |  |  | 01, 02, 03, 04, 05, 06, 07, 08 … (10) |  |
| `aprop_grazing_id[]` | Módulo | select |  |  |  |  |
| `aprop_batch_id[]` | Lote | select |  |  |  |  |
| `aprop_animal_id[]` | Animal | select |  |  | (lista dinâmica de cadastro — 0 registros; valores omitidos por privacidade) |  |
| `aprop_operation_id[]` | Operação | select |  |  | Preparo do Solo, Conservação do Solo, Plantio, Tratos Culturais, Tratos Fitossanitários, Colheita, Pós Colheita, Armazenagem … (19) |  |
| `aprop_activity_id[]` | Atividade | select |  |  |  |  |
| `aprop_value[]` | Valor (R$) | text (moeda) |  |  |  |  |
| `aprop_cultivation_id[]` | Cultura | select |  |  | Soja - 1823, Soja - Bonus, Soja - Bonus, CANA DE AÇUCAR - ERLAM - CANA DE AÇUCAR, Soja - Extrema, Soja - Monsoy 8606, PLANTAÇÃO DE MORANGO - ERLAM - MORANGO DE MESA, Banana - Nanica … (14) |  |
| `aprop_agri_area_id[]` | Área | select |  |  | 01, 02, 03, 04, 05, 06, 07, 08 … (10) |  |
| `aprop_agri_operation_id[]` | Operação | select |  |  | Preparo do Solo, Conservação do Solo, Plantio, Tratos Culturais, Tratos Fitossanitários, Colheita, Pós Colheita, Armazenagem … (19) |  |
| `aprop_agri_activity_id[]` | Atividade | select |  |  |  |  |
| `aprop_agri_value[]` | Valor (R$) | text (moeda) |  |  |  |  |
| `aprop_equipment_id[]` | Equipamento / Veículo | select |  |  | A 73F VALTRA/CABINADO, ADUBADEIRA DE ARRASTE KAMAQ, ADUBADEIRA HIDRÁULICA, BALANÇA, BALANÇA, BALANÇA BONIVA ELETRONICA RETANGULAR FIXA KM-3-N COIMMA, BALANÇA DIGITAL SUSPENSA 3000 KG BIV, BATEDEIRA DE PIMENTA … (132) |  |
| `aprop_hour_meter[]` | Horímetro Atual (h) | text |  |  |  |  |
| `aprop_mileage[]` | Km Atual | text |  |  |  |  |
| `aprop_manut_value[]` | Valor (R$) | text (moeda) |  |  |  |  |
| `aprop_abastec_equipment_id[]` | Equipamento / Veículo | select |  |  | A 73F VALTRA/CABINADO, ADUBADEIRA DE ARRASTE KAMAQ, ADUBADEIRA HIDRÁULICA, BALANÇA, BALANÇA, BALANÇA BONIVA ELETRONICA RETANGULAR FIXA KM-3-N COIMMA, BALANÇA DIGITAL SUSPENSA 3000 KG BIV, BATEDEIRA DE PIMENTA … (132) |  |
| `aprop_abastec_hour_meter[]` | Horímetro Atual (h) | text |  |  |  |  |
| `aprop_abastec_product_id[]` | Produto | select |  |  | 5W30 MOBIL SUPER GMDEXOS2, ABRAC RSF 14MM K 89X101MM, ACABAMENTO P/REG.3/4 C-44 ROSE GOLD RO7150 CLIC, ADITIVO, ADITIVO COOL-GARD 2 20/80 20L, ADITIVO CX.C/12, ADITIVO P/RADIADOR, ADITIVO RADIADOR ROSA … (236) |  |
| `aprop_abastec_measurement_id[]` | Un. Medida | select |  |  |  |  |
| `aprop_abastec_quantity[]` | Quantidade | text (moeda) |  |  |  |  |
| `aprop_abastec_value[]` | Valor Total (R$) | text (moeda) |  |  |  |  |
| `categories[]` |  | select | R |  |  |  |
| `plan_accounts[]` |  | select |  |  |  |  |
| `centers[]` |  | select | R |  | Administração, Estoque Insumos, Estoque Produção, Parque Máquinas, Soja, Soja Precoce, Soja Super Precoce, Terminação - Corte |  |
| `area_id[]` | Área | select |  |  |  |  |
| `harvest_id[]` |  | select |  |  | Safra 1, TESTE, Safra 2024/2025, Safra 2023/2024, Safra 2023/2024 |  |
| `category_percent_values[]` |  | text (moeda) | R |  |  |  |
| `category_values[]` |  | text (moeda) | R |  |  |  |
| `automatic_writeoff` | Baixa automática | select |  |  | Não, Sim |  |
| `account_id` | Conta Bancária | select |  |  | 000 - Caixa Fazenda - 01, 000 - Caixa Fazenda - 02, 000 - Caixa Fazenda - 03, 000 - INVESTIMENTO 1, 56, BB Principal |  |
| `balance_account` | Saldo da Conta | text (moeda) |  |  |  |  |
| `movement_date` | Data do Movimento | text (data) |  |  |  |  |

**Formulário POST `/admin/expenses/create`** (modal newProviderModal) — botões: Salvar

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

**Formulário POST `/admin/expenses/create`** (modal newBranchModal) — botões: Salvar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `name` | Nome | text | R | 100 |  |  |
| `nif` | CPF/CNPJ | text | R |  |  |  |
| `state_registration` | Insc. Estadual | text |  | 20 |  |  |
| `zip_code` | CEP | text | R |  |  |  |
| `city_id` | Cidade | select | R |  |  |  |
| `address` | Endereço | text | R |  |  |  |

## SCR-277 · Contas a Pagar

- **Rota:** `/admin/expenses/152422`
- **Módulo:** Financeiro > Contas a Pagar
- **Tipo:** Detalhe
- **Finalidade:** Contas a Pagar (detalhe)
- **Botões/Ações (cabeçalho):** Voltar → `/admin/expenses`

**Tabela** — linhas na amostra: 1

- Colunas: Categoria | Centro de Custo | Valor | Percentual
- Totalizador: Total: R$ 750,00 100,00%

## SCR-278 · Contas a Pagar

- **Rota:** `/admin/expenses/152422/edit`
- **Módulo:** Financeiro > Contas a Pagar
- **Tipo:** Cadastro (edição)
- **Finalidade:** Contas a Pagar (cadastro (edição))
- **Botões/Ações (cabeçalho):** Voltar → `/admin/expenses`
- **Modais:** Novo Fornecedor; newBranchModal

**Tabela** — linhas na amostra: 1

- Colunas: (seleção) | Categoria | Conta Contábil | Centro de Custo | Safra | Porcentagem | Valor (R$)

**Formulário PUT `/admin/expenses/152422`** — botões: Salvar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `farm_id` | Fazenda | select | R |  | Fazenda Maira, Fazenda São Paulo |  |
| `number` | Nº Título | text | R | 15 |  |  |
| `type_id` | Tipo de Título | select | R |  | Boleto, Duplicata, Cheque, Nota Fiscal - NFe, Recibo, Ad.Fornecedor, Ad.Funcionario, Cupom Fiscal … (23) |  |
| `proprietary_id` | Proprietário Gestor | select |  |  | (lista dinâmica de cadastro — 1 registros; valores omitidos por privacidade) |  |
| `classification` | Classificação | select | R |  | Não Classificado, CAPEX, OPEX | CAPEX: Investimentos de longo prazo, como aquisição de bens que serão usados por mais de um ano (equipamentos, prédios, etc.). \n OPEX: Despesas operacionais re |
| `type_note` | Tipo Nota | select |  |  | NF-e, CT-e, NFS-e, NFC-e, DANF-e, DARF, DARE, GRU |  |
| `fiscal_document` | Dedutível | select | R |  | Não, Sim | Indica se este documento fiscal pode ser utilizado para dedução de tributos |
| `amount` | Vlr Título | text (moeda) | R |  |  | Valor total do título (bruto), sem descontos. \n Multa, juros e acréscimos por atraso não são informados aqui — eles só são calculados no momento da baixa/pagam |
| `dt_emission` | Dt. Emissão | text | R |  |  |  |
| `due_date` | Dt. Vencimento | text | R |  |  |  |
| `discount` | Desconto | text (moeda) |  |  |  | Desconto concedido sobre o valor do título (ex: desconto comercial ou por pagamento antecipado). \n É subtraído do Valor do Título para compor o Valor Líquido. |
| `net_value_display` | Valor Líquido | text (moeda) |  |  |  | Valor Líquido = Valor do Título − Desconto. \n Campo apenas informativo, calculado automaticamente. Não é enviado ao salvar o título. |
| `is_taxation` | É tributo? | select | R |  | Não, Sim |  |
| `provider_id` | Fornecedor | select | R |  | (lista dinâmica de cadastro — 41 registros; valores omitidos por privacidade) … (41) |  |
| `branch_id` | Filial | select |  |  |  |  |
| `appropriation` | Apropriação | select | R |  | Direta, Indireta | Esta opção define se a apropriação da conta será feita após o cadastro da mesma \n \n Se estiver marcada com direta, será feita a apropriação após o cadastro, c |
| `appropriation_type` | Tipo Apropriação | select |  |  | Indireta, Pecuária, Área, Manutenção, Abastecimento |  |
| `note` | Histórico | textarea | R | 1500 |  | A identificação/nome da conta que está sendo cadastrada |
| `categories[]` |  | select | R |  | Frutas para Revenda |  |
| `plan_accounts[]` |  | select |  |  |  |  |
| `centers[]` |  | select | R |  | Administração, Estoque Insumos, Estoque Produção, Parque Máquinas, Soja, Soja Precoce, Soja Super Precoce, Terminação - Corte |  |
| `harvest_id[]` |  | select |  |  | Safra 1, TESTE, Safra 2024/2025, Safra 2023/2024, Safra 2023/2024 |  |
| `category_percent_values[]` |  | text (moeda) | R |  |  |  |
| `category_values[]` |  | text (moeda) |  |  |  |  |

**Formulário POST `/admin/expenses/152422/edit`** (modal newProviderModal) — botões: Salvar

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

**Formulário POST `/admin/expenses/152422/edit`** (modal newBranchModal) — botões: Salvar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `name` | Nome | text | R | 100 |  |  |
| `nif` | CPF/CNPJ | text | R |  |  |  |
| `state_registration` | Insc. Estadual | text |  | 20 |  |  |
| `zip_code` | CEP | text | R |  |  |  |
| `city_id` | Cidade | select | R |  |  |  |
| `address` | Endereço | text | R |  |  |  |

## SCR-279 · Conta a Receber

- **Rota:** `/admin/incomes/create`
- **Módulo:** Financeiro > Contas a Receber
- **Tipo:** Cadastro (novo)
- **Finalidade:** Contas a Receber (cadastro (novo))
- **Botões/Ações (cabeçalho):** Voltar → `/admin/incomes`
- **Modais:** Novo Cliente; installmentModal

**Filtros (GET)** — botões: Confirmar Parcelas

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `total_amount` | Valor Total | text |  |
| `qtd_installments` | Nª Parcelas | number |  |
| `first_installment` | Venc. 1ª. PC | text (data) |  |
| `installment_mode` | Por Intervalo (dias) | radio |  |
| `installment_mode` | Dia Fixo do Mês | radio |  |
| `int_installments` | Int. Parcelas (dias) | number |  |
| `due_day` | Dia de Vencimento | number |  |
| `has_input` | Possui entrada | select | Sim, Não |
| `input_value` | Valor entrada | text |  |
| `input_date` | Data entrada | text (data) |  |
| `all_files[]` | Escolher arquivo | file |  |

**Tabela** — linhas na amostra: 1

- Colunas: (seleção) | Categoria | Conta Contábil | Centro de Custo | Safra | Porcentagem | Valor (R$)

**Formulário POST `/admin/incomes/xml`**

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `arquivo` |  | file |  |  |  |  |

**Formulário POST `/admin/incomes`** — botões: Salvar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `farm_id` | Fazenda | select | R |  | Fazenda Maira, Fazenda São Paulo |  |
| `number` | Nº Título | text | R | 15 |  |  |
| `type_id` | Tipo de Título | select | R |  | Boleto, Duplicata, Cheque, Nota Fiscal - NFe, Recibo, Ad.Fornecedor, Ad.Funcionario, Cupom Fiscal … (23) |  |
| `proprietary_id` | Proprietário Gestor | select |  |  | (lista dinâmica de cadastro — 1 registros; valores omitidos por privacidade) |  |
| `payment_type` | Tipo de pagamento | select | R |  | Parcela Única, Parcelada, Adiantamento |  |
| `fiscal_document` | Dedutível | select | R |  | Não, Sim | Indica se este documento fiscal pode ser utilizado para dedução de tributos |
| `amount` | Vlr Título | text (moeda) | R |  |  | Valor total do título (bruto), sem descontos. \n Multa, juros e acréscimos por atraso não são informados aqui — eles só são calculados no momento da baixa/receb |
| `dt_emission` | Dt. Emissão | text | R |  |  |  |
| `due_date` | Dt. Vencimento | text | R |  |  |  |
| `discount` | Desconto | text (moeda) |  |  |  | Desconto concedido sobre o valor do título (ex: desconto comercial ou por pagamento antecipado). \n É subtraído do Valor do Título para compor o Valor Líquido. |
| `net_value_display` | Valor Líquido | text (moeda) |  |  |  | Valor Líquido = Valor do Título − Desconto. \n Campo apenas informativo, calculado automaticamente. Não é enviado ao salvar o título. |
| `client_id` | Cliente | select | R |  | (lista dinâmica de cadastro — 8 registros; valores omitidos por privacidade) |  |
| `note` | Histórico | textarea | R | 800 |  | A identificação/nome da conta que está sendo cadastrada |
| `categories[]` |  | select | R |  |  |  |
| `plan_accounts[]` |  | select |  |  |  |  |
| `centers[]` |  | select | R |  | Administração, Estoque Insumos, Estoque Produção, Parque Máquinas, Soja, Soja Precoce, Soja Super Precoce, Terminação - Corte |  |
| `harvest_id[]` |  | select |  |  | Safra 1, TESTE, Safra 2024/2025, Safra 2023/2024, Safra 2023/2024 |  |
| `category_percent_values[]` |  | text (moeda) | R |  |  |  |
| `category_values[]` |  | text (moeda) | R |  |  |  |
| `automatic_writeoff` | Baixa automática | select |  |  | Não, Sim |  |
| `account_id` | Conta Bancária | select |  |  | 000 - Caixa Fazenda - 01, 000 - Caixa Fazenda - 02, 000 - Caixa Fazenda - 03, 000 - INVESTIMENTO 1, 56, BB Principal |  |
| `balance_account` | Saldo da Conta | text (moeda) |  |  |  |  |
| `movement_date` | Data do Movimento | text (data) |  |  |  |  |

**Formulário POST `/admin/clients`** (modal newClientModal) — botões: Salvar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `nif` | CPF/CNPJ | text | R |  |  |  |
| `nickname` | Razão Social | text | R | 50 |  |  |
| `name` | Nome Fantasia | text | R | 30 |  |  |
| `email` | Email | email | R |  |  |  |
| `city_registration` | Insc. Municipal | text |  | 20 |  |  |
| `phone` | Telefone | text | R |  |  |  |
| `cellphone` | Celular | text |  |  |  |  |
| `contact` | Contato | text |  |  |  |  |
| `contact_phone` | Tel. do contato | text |  |  |  |  |
| `zip_code` | CEP | text |  |  |  |  |
| `address` | Endereço | text | R | 60 |  |  |
| `number` | Número | text | R |  |  |  |
| `district` | Bairro | text | R |  |  |  |
| `city_id` | Cidade | select | R |  |  |  |
| `is_enabled` | Ativo | select | R |  | Sim, Não |  |
| `final_costumer` | Consumidor Final | select | R |  | Não, Sim |  |
| `taxpayer` | Contribuinte | select | R |  | Sim, Não |  |
| `id_abroad` | ID estrangeiro | text |  |  |  |  |
| `farm_name` | Nome da Fazenda | text |  | 100 |  |  |
| `state_registrations[]` |  | text |  |  |  |  |

## SCR-280 · Conta a Receber

- **Rota:** `/admin/incomes/21909`
- **Módulo:** Financeiro > Contas a Receber
- **Tipo:** Detalhe
- **Finalidade:** Contas a Receber (detalhe)
- **Botões/Ações (cabeçalho):** Voltar → `/admin/incomes`

**Tabela** — linhas na amostra: 1

- Colunas: Categoria | Centro de Custo | Valor | Percentual
- Totalizador: Total: R$ 317.522,00 100,00%

## SCR-281 · Conta a Receber

- **Rota:** `/admin/incomes/21909/edit`
- **Módulo:** Financeiro > Contas a Receber
- **Tipo:** Cadastro (edição)
- **Finalidade:** Contas a Receber (cadastro (edição))
- **Botões/Ações (cabeçalho):** Voltar → `/admin/incomes`
- **Modais:** Novo Cliente

**Tabela** — linhas na amostra: 1

- Colunas: (seleção) | Categoria | Conta Contábil | Centro de Custo | Safra | Porcentagem | Valor (R$)

**Formulário PUT `/admin/incomes/21909`** — botões: Salvar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `farm_id` | Fazenda | select | R |  | Fazenda Maira, Fazenda São Paulo |  |
| `number` | Nº Título | text | R | 15 |  |  |
| `type_id` | Tipo de Título | select | R |  | Boleto, Duplicata, Cheque, Nota Fiscal - NFe, Recibo, Ad.Fornecedor, Ad.Funcionario, Cupom Fiscal … (23) |  |
| `proprietary_id` | Proprietário Gestor | select |  |  | (lista dinâmica de cadastro — 1 registros; valores omitidos por privacidade) |  |
| `fiscal_document` | Dedutível | select | R |  | Não, Sim | Indica se este documento fiscal pode ser utilizado para dedução de tributos |
| `amount` | Vlr Título | text (moeda) | R |  |  | Valor total do título (bruto), sem descontos. \n Multa, juros e acréscimos por atraso não são informados aqui — eles só são calculados no momento da baixa/receb |
| `dt_emission` | Dt. Emissão | text | R |  |  |  |
| `due_date` | Dt. Vencimento | text | R |  |  |  |
| `discount` | Desconto | text (moeda) |  |  |  | Desconto concedido sobre o valor do título (ex: desconto comercial ou por pagamento antecipado). \n É subtraído do Valor do Título para compor o Valor Líquido. |
| `net_value_display` | Valor Líquido | text (moeda) |  |  |  | Valor Líquido = Valor do Título − Desconto. \n Campo apenas informativo, calculado automaticamente. Não é enviado ao salvar o título. |
| `client_id` | Cliente | select |  |  | (lista dinâmica de cadastro — 8 registros; valores omitidos por privacidade) |  |
| `note` | Histórico | text | R | 800 |  | A identificação/nome da conta que está sendo cadastrada |
| `categories[]` |  | select | R |  | Venda de Boi Gordo |  |
| `plan_accounts[]` |  | select |  |  |  |  |
| `centers[]` |  | select | R |  | Administração, Estoque Insumos, Estoque Produção, Parque Máquinas, Soja, Soja Precoce, Soja Super Precoce, Terminação - Corte |  |
| `harvest_id[]` |  | select |  |  | Safra 1, TESTE, Safra 2024/2025, Safra 2023/2024, Safra 2023/2024 |  |
| `category_percent_values[]` |  | text (moeda) | R |  |  |  |
| `category_values[]` |  | text (moeda) | R |  |  |  |

**Formulário POST `/admin/clients`** (modal newClientModal) — botões: Salvar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `nif` | CPF/CNPJ | text | R |  |  |  |
| `nickname` | Razão Social | text | R | 50 |  |  |
| `name` | Nome Fantasia | text | R | 30 |  |  |
| `email` | Email | email | R |  |  |  |
| `city_registration` | Insc. Municipal | text |  | 20 |  |  |
| `phone` | Telefone | text | R |  |  |  |
| `cellphone` | Celular | text |  |  |  |  |
| `contact` | Contato | text |  |  |  |  |
| `contact_phone` | Tel. do contato | text |  |  |  |  |
| `zip_code` | CEP | text |  |  |  |  |
| `address` | Endereço | text | R | 60 |  |  |
| `number` | Número | text | R |  |  |  |
| `district` | Bairro | text | R |  |  |  |
| `city_id` | Cidade | select | R |  |  |  |
| `is_enabled` | Ativo | select | R |  | Sim, Não |  |
| `final_costumer` | Consumidor Final | select | R |  | Não, Sim |  |
| `taxpayer` | Contribuinte | select | R |  | Sim, Não |  |
| `id_abroad` | ID estrangeiro | text |  |  |  |  |
| `farm_name` | Nome da Fazenda | text |  | 100 |  |  |
| `state_registrations[]` |  | text |  |  |  |  |

## SCR-282 · Movimento Caixa/Bancário

- **Rota:** `/admin/movements/create`
- **Módulo:** Financeiro > Mov. Caixa/Bancário
- **Tipo:** Cadastro (novo)
- **Finalidade:** Mov. Caixa/Bancário (cadastro (novo))
- **Botões/Ações (cabeçalho):** Voltar → `/admin/movements`
- **Modais:** Novo Fornecedor; Novo Cliente

**Tabela** — linhas na amostra: 1

- Colunas: (seleção) | Categoria | Conta Contábil | Centro de Custo | Safra | Porcentagem | Valor (R$)

**Formulário POST `/admin/movements`** — botões: Salvar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `code` | Código | text |  |  |  |  |
| `date` | Dt. Movimento | text | R |  |  |  |
| `type` | Tipo | select | R |  | Entrada, Saída |  |
| `type_category` | Tp. Categoria | select | R |  | Entrada, Saída, Trans. Interna, Financiamento/Empréstimo, Devolução de Cheque |  |
| `account_id` | Conta Bancária | select | R |  | CXF - 000 - Caixa Fazenda - 01, CXF1 - 000 - Caixa Fazenda - 02, CXF - 000 - Caixa Fazenda - 03, CXF - 000 - INVESTIMENTO 1, 0013 - 56, BB - BB Principal |  |
| `farm_id` | Fazenda | select |  |  | Fazenda Maira, Fazenda São Paulo |  |
| `proprietary_id` | Proprietário Gestor | select | R |  | (lista dinâmica de cadastro — 1 registros; valores omitidos por privacidade) |  |
| `destination_account_id` | Conta Destino | select |  |  | CXF - 000 - Caixa Fazenda - 01, CXF1 - 000 - Caixa Fazenda - 02, CXF - 000 - Caixa Fazenda - 03, CXF - 000 - INVESTIMENTO 1, 0013 - 56, BB - BB Principal |  |
| `value` | Valor R$ | text (moeda) | R |  |  |  |
| `interest` | Juros R$ | text (moeda) |  |  |  |  |
| `document` | Documento | text |  | 100 |  | Identificação do documento que está sendo cadastrado \n \n Exemplo: Recibo, Fatura, etc... |
| `generates_obligation` | Gera Obrigação | select | R |  | Não, Sim |  |
| `fiscal_document` | Dedutível | select | R |  | Não, Sim | Indica se este documento fiscal pode ser utilizado para dedução de tributos |
| `note` | Histórico | textarea |  | 600 |  |  |
| `client_id` | Cliente | select |  |  | (lista dinâmica de cadastro — 8 registros; valores omitidos por privacidade) |  |
| `provider_id` | Fornecedor | select |  |  | (lista dinâmica de cadastro — 41 registros; valores omitidos por privacidade) … (41) |  |
| `categories[]` |  | select | R |  |  |  |
| `plan_accounts[]` |  | select |  |  |  |  |
| `centers[]` |  | select | R |  | Administração, Estoque Insumos, Estoque Produção, Parque Máquinas, Soja, Soja Precoce, Soja Super Precoce, Terminação - Corte |  |
| `harvest_id[]` |  | select |  |  | Safra 1, TESTE, Safra 2024/2025, Safra 2023/2024, Safra 2023/2024 |  |
| `category_percent_values[]` |  | text (moeda) | R |  |  |  |
| `category_values[]` |  | text (moeda) | R |  |  |  |

**Formulário POST `/admin/movements/create`** (modal newProviderModal) — botões: Salvar

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

**Formulário POST `/admin/clients`** (modal newClientModal) — botões: Salvar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `nif` | CPF/CNPJ | text | R |  |  |  |
| `nickname` | Razão Social | text | R | 50 |  |  |
| `name` | Nome Fantasia | text | R | 30 |  |  |
| `email` | Email | email | R |  |  |  |
| `city_registration` | Insc. Municipal | text |  | 20 |  |  |
| `phone` | Telefone | text | R |  |  |  |
| `cellphone` | Celular | text |  |  |  |  |
| `contact` | Contato | text |  |  |  |  |
| `contact_phone` | Tel. do contato | text |  |  |  |  |
| `zip_code` | CEP | text |  |  |  |  |
| `address` | Endereço | text | R | 60 |  |  |
| `number` | Número | text | R |  |  |  |
| `district` | Bairro | text | R |  |  |  |
| `city_id` | Cidade | select | R |  |  |  |
| `is_enabled` | Ativo | select | R |  | Sim, Não |  |
| `final_costumer` | Consumidor Final | select | R |  | Não, Sim |  |
| `taxpayer` | Contribuinte | select | R |  | Sim, Não |  |
| `id_abroad` | ID estrangeiro | text |  |  |  |  |
| `farm_name` | Nome da Fazenda | text |  | 100 |  |  |
| `state_registrations[]` |  | text |  |  |  |  |

## SCR-283 · Movimento Caixa/Bancário

- **Rota:** `/admin/movements/280312`
- **Módulo:** Financeiro > Mov. Caixa/Bancário
- **Tipo:** Detalhe
- **Finalidade:** Mov. Caixa/Bancário (detalhe)
- **Botões/Ações (cabeçalho):** Voltar → `/admin/movements`

**Tabela** — linhas na amostra: 1

- Colunas: Categoria | Conta Contábil | Centro de Custo | Valor | Percentual
- Totalizador: Total: R$ 100.000,00 100,00%

## SCR-284 · Movimento Caixa/Bancário

- **Rota:** `/admin/movements/280312/edit`
- **Módulo:** Financeiro > Mov. Caixa/Bancário
- **Tipo:** Cadastro (edição)
- **Finalidade:** Mov. Caixa/Bancário (cadastro (edição))
- **Botões/Ações (cabeçalho):** Voltar → `/admin/movements`

**Tabela** — linhas na amostra: 1

- Colunas: (seleção) | Categoria | Conta Contábil | Centro de Custo | Safra | Porcentagem | Valor (R$)

**Formulário PUT `/admin/movements/280312`** — botões: Salvar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `code` | Código | text |  |  |  |  |
| `date` | Dt. Movimento | text | R |  |  |  |
| `type` | Tipo | select | R |  | Entrada, Saída |  |
| `type_category` | Tp. Categoria | select | R |  | Entrada, Saída, Trans. Interna, Financiamento/Empréstimo, Devolução de Cheque |  |
| `account_id` | Conta Bancária | select | R |  | CXF - 000 - Caixa Fazenda - 01, CXF1 - 000 - Caixa Fazenda - 02, CXF - 000 - Caixa Fazenda - 03, CXF - 000 - INVESTIMENTO 1, 0013 - 56, BB - BB Principal |  |
| `farm_id` | Fazenda | select |  |  | Fazenda Maira, Fazenda São Paulo |  |
| `proprietary_id` | Proprietário Gestor | select | R |  | (lista dinâmica de cadastro — 1 registros; valores omitidos por privacidade) |  |
| `destination_account_id` | Conta Destino | select |  |  | CXF - 000 - Caixa Fazenda - 01, CXF1 - 000 - Caixa Fazenda - 02, CXF - 000 - Caixa Fazenda - 03, CXF - 000 - INVESTIMENTO 1, 0013 - 56, BB - BB Principal |  |
| `value` | Valor R$ | text (moeda) | R |  |  |  |
| `interest` | Juros R$ | text (moeda) |  |  |  |  |
| `document` | Documento | text |  | 100 |  | Identificação do documento que está sendo cadastrado \n \n Exemplo: Recibo, Fatura, etc... |
| `generates_obligation` | Gera Obrigação | select | R |  | Não, Sim |  |
| `fiscal_document` | Dedutível | select | R |  | Não, Sim | Indica se este documento fiscal pode ser utilizado para dedução de tributos |
| `note` | Histórico | textarea |  | 600 |  |  |
| `client_id` | Cliente | select |  |  | (lista dinâmica de cadastro — 8 registros; valores omitidos por privacidade) |  |
| `provider_id` | Fornecedor | select |  |  | (lista dinâmica de cadastro — 41 registros; valores omitidos por privacidade) … (41) |  |
| `categories[]` |  | select | R |  | Empréstimo Investimento |  |
| `plan_accounts[]` |  | select |  |  |  |  |
| `centers[]` |  | select | R |  | Administração, Estoque Insumos, Estoque Produção, Parque Máquinas, Soja, Soja Precoce, Soja Super Precoce, Terminação - Corte |  |
| `harvest_id[]` |  | select |  |  | Safra 1, TESTE, Safra 2024/2025, Safra 2023/2024, Safra 2023/2024 |  |
| `category_percent_values[]` |  | text (moeda) | R |  |  |  |
| `category_values[]` |  | text (moeda) | R |  |  |  |

## SCR-285 · Importar OFX

- **Rota:** `/admin/ofx-imports/create`
- **Módulo:** Financeiro > Conciliação > Importação OFX
- **Tipo:** Cadastro (novo)
- **Finalidade:** Importação OFX (cadastro (novo))
- **Botões/Ações (cabeçalho):** Voltar → `/admin/ofx-imports`

**Formulário POST `/admin/ofx-imports`** — botões: Salvar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `code` | Código | text | R |  |  |  |
| `description` | Descrição | text | R |  |  |  |
| `start_date` | Data Inicial | text | R |  |  |  |
| `end_date` | Data final | text | R |  |  |  |
| `account_id` | Conta Bancária | select | R |  | 000 - 000 - Caixa Fazenda - 01 - AG: 0000 - CT: 000000-0, 000 - 000 - Caixa Fazenda - 02 - AG: 0000 - CT: 000000-0, 000 - 000 - Caixa Fazenda - 03 - AG: 0000 - CT: 000000-0, 001 - 56 - AG: 67890 - CT: 6-8 |  |
| `ofx_file` | Arquivo | file | R |  |  |  |

## SCR-286 · Importar OFX

- **Rota:** `/admin/ofx-imports/548`
- **Módulo:** Financeiro > Conciliação > Importação OFX
- **Tipo:** Detalhe
- **Finalidade:** Importação OFX (detalhe)
- **Botões/Ações (cabeçalho):** Voltar → `/admin/ofx-imports`

## SCR-287 · Importar OFX

- **Rota:** `/admin/ofx-imports/548/edit`
- **Módulo:** Financeiro > Conciliação > Importação OFX
- **Tipo:** Cadastro (edição)
- **Finalidade:** Importação OFX (cadastro (edição))
- **Botões/Ações (cabeçalho):** Voltar → `/admin/ofx-imports`

**Formulário PUT `/admin/ofx-imports/548`** — botões: Salvar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `code` | Código | text | R |  |  |  |
| `description` | Descrição | text | R |  |  |  |
| `start_date` | Data Inicial | text | R |  |  |  |
| `end_date` | Data final | text | R |  |  |  |
| `account_id` | Conta Bancária | select | R |  | (lista dinâmica de cadastro — 5 registros; valores omitidos por privacidade) |  |
| `ofx_file` | Arquivo | file |  |  |  |  |

## SCR-438 · Gestão de Contrato

- **Rota:** `/admin/contracts/create`
- **Módulo:** Financeiro > Gestão Contratos
- **Tipo:** Cadastro (novo)
- **Finalidade:** Gestão Contratos (cadastro (novo))
- **Abas:** Insumos
- **Botões/Ações (cabeçalho):** Voltar → `/admin/contracts`

**Formulário POST `/admin/contracts`** — botões: Salvar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `code` | Código | text |  |  |  |  |
| `number` | Nº Contrato | text | R |  |  |  |
| `date` | Data | text (data) | R |  |  |  |
| `expiration_date` | Data de vencimento | text (data) | R |  |  |  |
| `employee_id` | Responsável | select | R |  | (lista dinâmica de cadastro — 0 registros; valores omitidos por privacidade) |  |
| `provider_id` | Fornecedor | select | R |  | (lista dinâmica de cadastro — 39 registros; valores omitidos por privacidade) … (39) |  |
| `quantity` | Quantidade Sc. | text (moeda) | R |  |  |  |
| `unit_value_sc` | Vl. Unit/Saca | text (moeda) | R |  |  |  |
| `amount` | Valor (R$) | text (moeda) | R |  |  |  |
| `installments` | Parcelas | number | R |  |  |  |
| `input_warehouse_id[]` | Armazém | select | R |  | BARRACAO |  |
| `input_product_id[]` | Produto | select | R |  | Soja Bônus, Soja 1823, Milho 2022, Milho 2024, Glifosato, OLEO ATF 1000 FORT OIL, FLUIDO FREIO, PARAFUSO 3/4X5 … (2492) |  |
| `input_quantity[]` | Quantidade | text (moeda) | R |  |  |  |

## SCR-439 · Categorias

- **Rota:** `/admin/budget-plannings/create`
- **Módulo:** Financeiro > Prev. Orçamentária
- **Tipo:** Cadastro (novo)
- **Finalidade:** Prev. Orçamentária (cadastro (novo))
- **Botões/Ações (cabeçalho):** Voltar → `/admin/budget-plannings`

**Tabela** — linhas na amostra: 293

- Colunas: Conta Financeira | Valor Ano Anterior | Valor Anual | Jan | Fev | Mar | Abr | Mai | Jun | Jul | Ago | Set | Out | Nov | Dez

**Formulário POST `/admin/budget-plannings`** — botões: Salvar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `code` | Código | text |  |  |  |  |
| `date` | Data | text | R |  |  |  |
| `user_id` | Responsável | select | R |  | (lista dinâmica de cadastro — 1 registros; valores omitidos por privacidade) |  |
| `year` | Ano | number | R |  |  |  |
| `categories[0][0][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[0][0][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[0][0][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[0][0][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[0][0][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[0][0][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[0][0][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[0][0][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[0][0][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[0][0][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[0][0][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[0][0][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[0][1][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[0][1][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[0][1][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[0][1][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[0][1][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[0][1][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[0][1][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[0][1][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[0][1][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[0][1][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[0][1][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[0][1][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[0][2][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[0][2][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[0][2][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[0][2][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[0][2][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[0][2][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[0][2][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[0][2][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[0][2][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[0][2][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[0][2][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[0][2][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[0][3][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[0][3][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[0][3][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[0][3][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[0][3][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[0][3][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[0][3][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[0][3][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[0][3][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[0][3][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[0][3][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[0][3][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[0][4][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[0][4][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[0][4][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[0][4][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[0][4][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[0][4][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[0][4][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[0][4][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[0][4][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[0][4][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[0][4][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[0][4][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[0][5][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[0][5][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[0][5][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[0][5][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[0][5][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[0][5][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[0][5][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[0][5][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[0][5][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[0][5][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[0][5][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[0][5][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[0][6][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[0][6][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[0][6][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[0][6][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[0][6][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[0][6][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[0][6][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[0][6][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[0][6][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[0][6][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[0][6][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[0][6][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[0][7][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[0][7][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[0][7][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[0][7][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[0][7][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[0][7][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[0][7][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[0][7][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[0][7][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[0][7][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[0][7][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[0][7][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[0][8][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[0][8][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[0][8][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[0][8][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[0][8][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[0][8][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[0][8][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[0][8][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[0][8][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[0][8][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[0][8][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[0][8][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[0][9][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[0][9][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[0][9][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[0][9][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[0][9][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[0][9][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[0][9][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[0][9][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[0][9][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[0][9][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[0][9][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[0][9][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[1][0][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[1][0][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[1][0][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[1][0][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[1][0][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[1][0][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[1][0][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[1][0][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[1][0][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[1][0][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[1][0][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[1][0][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[1][1][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[1][1][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[1][1][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[1][1][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[1][1][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[1][1][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[1][1][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[1][1][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[1][1][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[1][1][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[1][1][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[1][1][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[1][2][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[1][2][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[1][2][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[1][2][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[1][2][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[1][2][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[1][2][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[1][2][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[1][2][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[1][2][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[1][2][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[1][2][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[2][0][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[2][0][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[2][0][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[2][0][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[2][0][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[2][0][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[2][0][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[2][0][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[2][0][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[2][0][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[2][0][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[2][0][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[2][1][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[2][1][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[2][1][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[2][1][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[2][1][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[2][1][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[2][1][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[2][1][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[2][1][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[2][1][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[2][1][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[2][1][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[2][2][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[2][2][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[2][2][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[2][2][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[2][2][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[2][2][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[2][2][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[2][2][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[2][2][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[2][2][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[2][2][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[2][2][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[2][3][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[2][3][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[2][3][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[2][3][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[2][3][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[2][3][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[2][3][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[2][3][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[2][3][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[2][3][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[2][3][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[2][3][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[2][4][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[2][4][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[2][4][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[2][4][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[2][4][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[2][4][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[2][4][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[2][4][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[2][4][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[2][4][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[2][4][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[2][4][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[2][5][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[2][5][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[2][5][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[2][5][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[2][5][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[2][5][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[2][5][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[2][5][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[2][5][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[2][5][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[2][5][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[2][5][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[2][6][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[2][6][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[2][6][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[2][6][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[2][6][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[2][6][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[2][6][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[2][6][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[2][6][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[2][6][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[2][6][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[2][6][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[3][0][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[3][0][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[3][0][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[3][0][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[3][0][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[3][0][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[3][0][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[3][0][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[3][0][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[3][0][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[3][0][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[3][0][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[3][1][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[3][1][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[3][1][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[3][1][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[3][1][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[3][1][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[3][1][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[3][1][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[3][1][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[3][1][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[3][1][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[3][1][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[3][2][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[3][2][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[3][2][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[3][2][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[3][2][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[3][2][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[3][2][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[3][2][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[3][2][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[3][2][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[3][2][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[3][2][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[3][3][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[3][3][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[3][3][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[3][3][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[3][3][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[3][3][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[3][3][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[3][3][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[3][3][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[3][3][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[3][3][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[3][3][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[3][4][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[3][4][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[3][4][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[3][4][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[3][4][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[3][4][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[3][4][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[3][4][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[3][4][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[3][4][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[3][4][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[3][4][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[3][5][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[3][5][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[3][5][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[3][5][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[3][5][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[3][5][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[3][5][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[3][5][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[3][5][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[3][5][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[3][5][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[3][5][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[3][6][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[3][6][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[3][6][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[3][6][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[3][6][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[3][6][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[3][6][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[3][6][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[3][6][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[3][6][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[3][6][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[3][6][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[3][7][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[3][7][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[3][7][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[3][7][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[3][7][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[3][7][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[3][7][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[3][7][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[3][7][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[3][7][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[3][7][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[3][7][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[4][0][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[4][0][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[4][0][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[4][0][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[4][0][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[4][0][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[4][0][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[4][0][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[4][0][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[4][0][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[4][0][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[4][0][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[4][1][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[4][1][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[4][1][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[4][1][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[4][1][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[4][1][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[4][1][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[4][1][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[4][1][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[4][1][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[4][1][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[4][1][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[5][0][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[5][0][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[5][0][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[5][0][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[5][0][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[5][0][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[5][0][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[5][0][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[5][0][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[5][0][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[5][0][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[5][0][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[5][1][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[5][1][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[5][1][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[5][1][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[5][1][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[5][1][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[5][1][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[5][1][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[5][1][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[5][1][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[5][1][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[5][1][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[6][0][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[6][0][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[6][0][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[6][0][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[6][0][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[6][0][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[6][0][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[6][0][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[6][0][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[6][0][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[6][0][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[6][0][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[7][0][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[7][0][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[7][0][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[7][0][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[7][0][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[7][0][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[7][0][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[7][0][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[7][0][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[7][0][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[7][0][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[7][0][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[7][1][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[7][1][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[7][1][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[7][1][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[7][1][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[7][1][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[7][1][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[7][1][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[7][1][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[7][1][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[7][1][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[7][1][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[7][2][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[7][2][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[7][2][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[7][2][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[7][2][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[7][2][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[7][2][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[7][2][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[7][2][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[7][2][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[7][2][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[7][2][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[7][3][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[7][3][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[7][3][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[7][3][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[7][3][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[7][3][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[7][3][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[7][3][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[7][3][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[7][3][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[7][3][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[7][3][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][0][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][0][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][0][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][0][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][0][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][0][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][0][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][0][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][0][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][0][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][0][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][0][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][1][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][1][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][1][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][1][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][1][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][1][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][1][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][1][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][1][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][1][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][1][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][1][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][2][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][2][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][2][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][2][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][2][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][2][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][2][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][2][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][2][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][2][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][2][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][2][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][3][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][3][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][3][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][3][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][3][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][3][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][3][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][3][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][3][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][3][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][3][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][3][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][4][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][4][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][4][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][4][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][4][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][4][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][4][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][4][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][4][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][4][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][4][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][4][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][5][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][5][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][5][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][5][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][5][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][5][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][5][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][5][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][5][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][5][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][5][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][5][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][6][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][6][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][6][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][6][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][6][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][6][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][6][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][6][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][6][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][6][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][6][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][6][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][7][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][7][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][7][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][7][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][7][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][7][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][7][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][7][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][7][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][7][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][7][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][7][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][8][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][8][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][8][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][8][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][8][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][8][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][8][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][8][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][8][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][8][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][8][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][8][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][9][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][9][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][9][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][9][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][9][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][9][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][9][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][9][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][9][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][9][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][9][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][9][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][10][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][10][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][10][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][10][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][10][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][10][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][10][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][10][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][10][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][10][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][10][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][10][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][11][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][11][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][11][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][11][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][11][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][11][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][11][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][11][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][11][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][11][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][11][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][11][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][12][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][12][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][12][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][12][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][12][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][12][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][12][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][12][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][12][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][12][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][12][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][12][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][13][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][13][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][13][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][13][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][13][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][13][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][13][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][13][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][13][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][13][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][13][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][13][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][14][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][14][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][14][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][14][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][14][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][14][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][14][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][14][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][14][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][14][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][14][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][14][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][15][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][15][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][15][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][15][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][15][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][15][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][15][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][15][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][15][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][15][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][15][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][15][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][16][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][16][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][16][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][16][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][16][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][16][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][16][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][16][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][16][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][16][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][16][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[8][16][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[9][0][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[9][0][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[9][0][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[9][0][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[9][0][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[9][0][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[9][0][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[9][0][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[9][0][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[9][0][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[9][0][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[9][0][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[9][1][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[9][1][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[9][1][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[9][1][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[9][1][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[9][1][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[9][1][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[9][1][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[9][1][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[9][1][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[9][1][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[9][1][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[9][2][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[9][2][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[9][2][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[9][2][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[9][2][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[9][2][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[9][2][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[9][2][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[9][2][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[9][2][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[9][2][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[9][2][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[10][0][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[10][0][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[10][0][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[10][0][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[10][0][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[10][0][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[10][0][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[10][0][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[10][0][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[10][0][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[10][0][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[10][0][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[10][1][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[10][1][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[10][1][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[10][1][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[10][1][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[10][1][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[10][1][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[10][1][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[10][1][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[10][1][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[10][1][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[10][1][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[10][2][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[10][2][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[10][2][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[10][2][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[10][2][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[10][2][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[10][2][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[10][2][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[10][2][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[10][2][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[10][2][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[10][2][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[10][3][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[10][3][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[10][3][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[10][3][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[10][3][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[10][3][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[10][3][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[10][3][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[10][3][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[10][3][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[10][3][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[10][3][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[10][4][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[10][4][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[10][4][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[10][4][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[10][4][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[10][4][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[10][4][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[10][4][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[10][4][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[10][4][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[10][4][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[10][4][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[11][0][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[11][0][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[11][0][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[11][0][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[11][0][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[11][0][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[11][0][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[11][0][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[11][0][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[11][0][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[11][0][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[11][0][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[11][1][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[11][1][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[11][1][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[11][1][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[11][1][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[11][1][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[11][1][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[11][1][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[11][1][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[11][1][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[11][1][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[11][1][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[11][2][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[11][2][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[11][2][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[11][2][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[11][2][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[11][2][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[11][2][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[11][2][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[11][2][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[11][2][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[11][2][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[11][2][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[11][3][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[11][3][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[11][3][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[11][3][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[11][3][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[11][3][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[11][3][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[11][3][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[11][3][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[11][3][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[11][3][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[11][3][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[11][4][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[11][4][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[11][4][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[11][4][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[11][4][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[11][4][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[11][4][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[11][4][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[11][4][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[11][4][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[11][4][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[11][4][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[11][5][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[11][5][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[11][5][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[11][5][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[11][5][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[11][5][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[11][5][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[11][5][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[11][5][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[11][5][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[11][5][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[11][5][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[11][6][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[11][6][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[11][6][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[11][6][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[11][6][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[11][6][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[11][6][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[11][6][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[11][6][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[11][6][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[11][6][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[11][6][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[12][0][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[12][0][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[12][0][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[12][0][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[12][0][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[12][0][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[12][0][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[12][0][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[12][0][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[12][0][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[12][0][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[12][0][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[12][1][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[12][1][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[12][1][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[12][1][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[12][1][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[12][1][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[12][1][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[12][1][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[12][1][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[12][1][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[12][1][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[12][1][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[12][2][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[12][2][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[12][2][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[12][2][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[12][2][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[12][2][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[12][2][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[12][2][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[12][2][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[12][2][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[12][2][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[12][2][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[12][3][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[12][3][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[12][3][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[12][3][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[12][3][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[12][3][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[12][3][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[12][3][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[12][3][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[12][3][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[12][3][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[12][3][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[12][4][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[12][4][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[12][4][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[12][4][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[12][4][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[12][4][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[12][4][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[12][4][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[12][4][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[12][4][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[12][4][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[12][4][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[13][0][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[13][0][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[13][0][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[13][0][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[13][0][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[13][0][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[13][0][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[13][0][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[13][0][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[13][0][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[13][0][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[13][0][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[13][1][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[13][1][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[13][1][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[13][1][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[13][1][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[13][1][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[13][1][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[13][1][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[13][1][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[13][1][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[13][1][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[13][1][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[13][2][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[13][2][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[13][2][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[13][2][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[13][2][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[13][2][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[13][2][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[13][2][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[13][2][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[13][2][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[13][2][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[13][2][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[14][0][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[14][0][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[14][0][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[14][0][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[14][0][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[14][0][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[14][0][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[14][0][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[14][0][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[14][0][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[14][0][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[14][0][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[14][1][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[14][1][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[14][1][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[14][1][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[14][1][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[14][1][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[14][1][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[14][1][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[14][1][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[14][1][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[14][1][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[14][1][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[15][0][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[15][0][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[15][0][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[15][0][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[15][0][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[15][0][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[15][0][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[15][0][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[15][0][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[15][0][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[15][0][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[15][0][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[15][1][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[15][1][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[15][1][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[15][1][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[15][1][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[15][1][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[15][1][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[15][1][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[15][1][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[15][1][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[15][1][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[15][1][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[15][2][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[15][2][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[15][2][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[15][2][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[15][2][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[15][2][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[15][2][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[15][2][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[15][2][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[15][2][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[15][2][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[15][2][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[15][3][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[15][3][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[15][3][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[15][3][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[15][3][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[15][3][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[15][3][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[15][3][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[15][3][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[15][3][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[15][3][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[15][3][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[15][4][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[15][4][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[15][4][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[15][4][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[15][4][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[15][4][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[15][4][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[15][4][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[15][4][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[15][4][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[15][4][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[15][4][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[15][5][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[15][5][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[15][5][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[15][5][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[15][5][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[15][5][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[15][5][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[15][5][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[15][5][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[15][5][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[15][5][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[15][5][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[15][6][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[15][6][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[15][6][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[15][6][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[15][6][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[15][6][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[15][6][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[15][6][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[15][6][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[15][6][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[15][6][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[15][6][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[15][7][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[15][7][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[15][7][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[15][7][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[15][7][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[15][7][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[15][7][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[15][7][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[15][7][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[15][7][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[15][7][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[15][7][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[15][8][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[15][8][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[15][8][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[15][8][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[15][8][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[15][8][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[15][8][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[15][8][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[15][8][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[15][8][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[15][8][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[15][8][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[16][0][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[16][0][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[16][0][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[16][0][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[16][0][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[16][0][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[16][0][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[16][0][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[16][0][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[16][0][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[16][0][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[16][0][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[16][1][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[16][1][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[16][1][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[16][1][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[16][1][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[16][1][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[16][1][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[16][1][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[16][1][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[16][1][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[16][1][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[16][1][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[16][2][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[16][2][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[16][2][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[16][2][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[16][2][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[16][2][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[16][2][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[16][2][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[16][2][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[16][2][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[16][2][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[16][2][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[16][3][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[16][3][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[16][3][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[16][3][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[16][3][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[16][3][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[16][3][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[16][3][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[16][3][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[16][3][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[16][3][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[16][3][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[16][4][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[16][4][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[16][4][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[16][4][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[16][4][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[16][4][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[16][4][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[16][4][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[16][4][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[16][4][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[16][4][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[16][4][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[16][5][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[16][5][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[16][5][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[16][5][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[16][5][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[16][5][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[16][5][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[16][5][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[16][5][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[16][5][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[16][5][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[16][5][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[16][6][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[16][6][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[16][6][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[16][6][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[16][6][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[16][6][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[16][6][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[16][6][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[16][6][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[16][6][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[16][6][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[16][6][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[17][0][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[17][0][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[17][0][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[17][0][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[17][0][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[17][0][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[17][0][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[17][0][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[17][0][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[17][0][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[17][0][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[17][0][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[17][1][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[17][1][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[17][1][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[17][1][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[17][1][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[17][1][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[17][1][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[17][1][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[17][1][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[17][1][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[17][1][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[17][1][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[17][2][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[17][2][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[17][2][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[17][2][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[17][2][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[17][2][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[17][2][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[17][2][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[17][2][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[17][2][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[17][2][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[17][2][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[17][3][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[17][3][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[17][3][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[17][3][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[17][3][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[17][3][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[17][3][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[17][3][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[17][3][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[17][3][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[17][3][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[17][3][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[17][4][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[17][4][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[17][4][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[17][4][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[17][4][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[17][4][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[17][4][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[17][4][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[17][4][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[17][4][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[17][4][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[17][4][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[17][5][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[17][5][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[17][5][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[17][5][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[17][5][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[17][5][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[17][5][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[17][5][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[17][5][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[17][5][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[17][5][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[17][5][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[17][6][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[17][6][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[17][6][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[17][6][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[17][6][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[17][6][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[17][6][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[17][6][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[17][6][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[17][6][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[17][6][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[17][6][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[17][7][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[17][7][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[17][7][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[17][7][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[17][7][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[17][7][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[17][7][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[17][7][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[17][7][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[17][7][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[17][7][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[17][7][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[18][0][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[18][0][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[18][0][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[18][0][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[18][0][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[18][0][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[18][0][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[18][0][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[18][0][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[18][0][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[18][0][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[18][0][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[18][1][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[18][1][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[18][1][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[18][1][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[18][1][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[18][1][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[18][1][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[18][1][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[18][1][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[18][1][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[18][1][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[18][1][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[18][2][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[18][2][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[18][2][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[18][2][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[18][2][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[18][2][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[18][2][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[18][2][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[18][2][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[18][2][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[18][2][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[18][2][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[18][3][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[18][3][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[18][3][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[18][3][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[18][3][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[18][3][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[18][3][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[18][3][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[18][3][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[18][3][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[18][3][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[18][3][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[18][4][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[18][4][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[18][4][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[18][4][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[18][4][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[18][4][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[18][4][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[18][4][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[18][4][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[18][4][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[18][4][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[18][4][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[19][0][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[19][0][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[19][0][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[19][0][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[19][0][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[19][0][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[19][0][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[19][0][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[19][0][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[19][0][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[19][0][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[19][0][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[19][1][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[19][1][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[19][1][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[19][1][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[19][1][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[19][1][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[19][1][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[19][1][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[19][1][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[19][1][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[19][1][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[19][1][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[19][2][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[19][2][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[19][2][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[19][2][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[19][2][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[19][2][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[19][2][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[19][2][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[19][2][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[19][2][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[19][2][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[19][2][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[19][3][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[19][3][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[19][3][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[19][3][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[19][3][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[19][3][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[19][3][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[19][3][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[19][3][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[19][3][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[19][3][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[19][3][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[19][4][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[19][4][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[19][4][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[19][4][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[19][4][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[19][4][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[19][4][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[19][4][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[19][4][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[19][4][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[19][4][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[19][4][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[19][5][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[19][5][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[19][5][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[19][5][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[19][5][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[19][5][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[19][5][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[19][5][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[19][5][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[19][5][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[19][5][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[19][5][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[19][6][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[19][6][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[19][6][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[19][6][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[19][6][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[19][6][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[19][6][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[19][6][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[19][6][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[19][6][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[19][6][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[19][6][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[19][7][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[19][7][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[19][7][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[19][7][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[19][7][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[19][7][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[19][7][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[19][7][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[19][7][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[19][7][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[19][7][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[19][7][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[19][8][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[19][8][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[19][8][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[19][8][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[19][8][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[19][8][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[19][8][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[19][8][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[19][8][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[19][8][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[19][8][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[19][8][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[19][9][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[19][9][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[19][9][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[19][9][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[19][9][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[19][9][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[19][9][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[19][9][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[19][9][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[19][9][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[19][9][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[19][9][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[19][10][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[19][10][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[19][10][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[19][10][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[19][10][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[19][10][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[19][10][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[19][10][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[19][10][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[19][10][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[19][10][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[19][10][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][0][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][0][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][0][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][0][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][0][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][0][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][0][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][0][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][0][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][0][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][0][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][0][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][1][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][1][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][1][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][1][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][1][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][1][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][1][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][1][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][1][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][1][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][1][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][1][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][2][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][2][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][2][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][2][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][2][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][2][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][2][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][2][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][2][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][2][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][2][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][2][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][3][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][3][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][3][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][3][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][3][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][3][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][3][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][3][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][3][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][3][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][3][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][3][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][4][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][4][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][4][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][4][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][4][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][4][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][4][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][4][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][4][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][4][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][4][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][4][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][5][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][5][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][5][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][5][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][5][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][5][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][5][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][5][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][5][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][5][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][5][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][5][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][6][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][6][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][6][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][6][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][6][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][6][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][6][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][6][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][6][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][6][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][6][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][6][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][7][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][7][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][7][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][7][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][7][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][7][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][7][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][7][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][7][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][7][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][7][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][7][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][8][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][8][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][8][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][8][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][8][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][8][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][8][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][8][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][8][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][8][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][8][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][8][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][9][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][9][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][9][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][9][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][9][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][9][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][9][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][9][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][9][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][9][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][9][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][9][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][10][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][10][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][10][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][10][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][10][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][10][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][10][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][10][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][10][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][10][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][10][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][10][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][11][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][11][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][11][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][11][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][11][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][11][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][11][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][11][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][11][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][11][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][11][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][11][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][12][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][12][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][12][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][12][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][12][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][12][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][12][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][12][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][12][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][12][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][12][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][12][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][13][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][13][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][13][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][13][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][13][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][13][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][13][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][13][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][13][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][13][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][13][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][13][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][14][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][14][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][14][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][14][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][14][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][14][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][14][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][14][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][14][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][14][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][14][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][14][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][15][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][15][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][15][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][15][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][15][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][15][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][15][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][15][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][15][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][15][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][15][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][15][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][16][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][16][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][16][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][16][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][16][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][16][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][16][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][16][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][16][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][16][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][16][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][16][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][17][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][17][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][17][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][17][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][17][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][17][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][17][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][17][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][17][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][17][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][17][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][17][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][18][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][18][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][18][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][18][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][18][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][18][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][18][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][18][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][18][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][18][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][18][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[20][18][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[21][0][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[21][0][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[21][0][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[21][0][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[21][0][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[21][0][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[21][0][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[21][0][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[21][0][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[21][0][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[21][0][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[21][0][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[22][0][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[22][0][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[22][0][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[22][0][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[22][0][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[22][0][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[22][0][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[22][0][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[22][0][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[22][0][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[22][0][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[22][0][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[22][1][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[22][1][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[22][1][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[22][1][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[22][1][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[22][1][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[22][1][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[22][1][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[22][1][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[22][1][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[22][1][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[22][1][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[22][2][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[22][2][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[22][2][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[22][2][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[22][2][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[22][2][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[22][2][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[22][2][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[22][2][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[22][2][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[22][2][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[22][2][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[22][3][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[22][3][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[22][3][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[22][3][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[22][3][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[22][3][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[22][3][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[22][3][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[22][3][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[22][3][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[22][3][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[22][3][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[23][0][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[23][0][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[23][0][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[23][0][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[23][0][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[23][0][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[23][0][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[23][0][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[23][0][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[23][0][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[23][0][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[23][0][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[23][1][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[23][1][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[23][1][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[23][1][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[23][1][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[23][1][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[23][1][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[23][1][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[23][1][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[23][1][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[23][1][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[23][1][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[24][0][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[24][0][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[24][0][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[24][0][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[24][0][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[24][0][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[24][0][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[24][0][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[24][0][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[24][0][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[24][0][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[24][0][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[24][1][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[24][1][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[24][1][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[24][1][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[24][1][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[24][1][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[24][1][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[24][1][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[24][1][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[24][1][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[24][1][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[24][1][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[24][2][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[24][2][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[24][2][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[24][2][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[24][2][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[24][2][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[24][2][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[24][2][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[24][2][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[24][2][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[24][2][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[24][2][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[25][0][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[25][0][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[25][0][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[25][0][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[25][0][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[25][0][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[25][0][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[25][0][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[25][0][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[25][0][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[25][0][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[25][0][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[25][1][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[25][1][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[25][1][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[25][1][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[25][1][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[25][1][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[25][1][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[25][1][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[25][1][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[25][1][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[25][1][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[25][1][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[25][2][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[25][2][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[25][2][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[25][2][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[25][2][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[25][2][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[25][2][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[25][2][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[25][2][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[25][2][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[25][2][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[25][2][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[25][3][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[25][3][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[25][3][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[25][3][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[25][3][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[25][3][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[25][3][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[25][3][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[25][3][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[25][3][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[25][3][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[25][3][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[26][0][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[26][0][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[26][0][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[26][0][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[26][0][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[26][0][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[26][0][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[26][0][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[26][0][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[26][0][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[26][0][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[26][0][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[26][1][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[26][1][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[26][1][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[26][1][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[26][1][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[26][1][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[26][1][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[26][1][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[26][1][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[26][1][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[26][1][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[26][1][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[26][2][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[26][2][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[26][2][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[26][2][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[26][2][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[26][2][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[26][2][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[26][2][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[26][2][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[26][2][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[26][2][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[26][2][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[26][3][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[26][3][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[26][3][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[26][3][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[26][3][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[26][3][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[26][3][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[26][3][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[26][3][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[26][3][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[26][3][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[26][3][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[26][4][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[26][4][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[26][4][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[26][4][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[26][4][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[26][4][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[26][4][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[26][4][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[26][4][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[26][4][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[26][4][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[26][4][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[26][5][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[26][5][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[26][5][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[26][5][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[26][5][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[26][5][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[26][5][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[26][5][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[26][5][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[26][5][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[26][5][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[26][5][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[26][6][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[26][6][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[26][6][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[26][6][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[26][6][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[26][6][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[26][6][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[26][6][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[26][6][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[26][6][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[26][6][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[26][6][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[26][7][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[26][7][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[26][7][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[26][7][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[26][7][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[26][7][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[26][7][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[26][7][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[26][7][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[26][7][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[26][7][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[26][7][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[26][8][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[26][8][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[26][8][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[26][8][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[26][8][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[26][8][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[26][8][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[26][8][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[26][8][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[26][8][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[26][8][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[26][8][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[27][0][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[27][0][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[27][0][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[27][0][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[27][0][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[27][0][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[27][0][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[27][0][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[27][0][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[27][0][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[27][0][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[27][0][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[27][1][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[27][1][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[27][1][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[27][1][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[27][1][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[27][1][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[27][1][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[27][1][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[27][1][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[27][1][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[27][1][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[27][1][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[27][2][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[27][2][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[27][2][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[27][2][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[27][2][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[27][2][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[27][2][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[27][2][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[27][2][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[27][2][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[27][2][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[27][2][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[28][0][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[28][0][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[28][0][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[28][0][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[28][0][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[28][0][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[28][0][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[28][0][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[28][0][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[28][0][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[28][0][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[28][0][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[28][1][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[28][1][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[28][1][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[28][1][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[28][1][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[28][1][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[28][1][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[28][1][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[28][1][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[28][1][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[28][1][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[28][1][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[29][0][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[29][0][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[29][0][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[29][0][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[29][0][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[29][0][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[29][0][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[29][0][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[29][0][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[29][0][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[29][0][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[29][0][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[29][1][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[29][1][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[29][1][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[29][1][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[29][1][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[29][1][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[29][1][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[29][1][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[29][1][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[29][1][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[29][1][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[29][1][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[29][2][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[29][2][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[29][2][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[29][2][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[29][2][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[29][2][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[29][2][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[29][2][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[29][2][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[29][2][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[29][2][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[29][2][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[29][3][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[29][3][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[29][3][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[29][3][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[29][3][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[29][3][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[29][3][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[29][3][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[29][3][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[29][3][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[29][3][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[29][3][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[29][4][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[29][4][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[29][4][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[29][4][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[29][4][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[29][4][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[29][4][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[29][4][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[29][4][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[29][4][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[29][4][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[29][4][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[29][5][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[29][5][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[29][5][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[29][5][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[29][5][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[29][5][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[29][5][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[29][5][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[29][5][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[29][5][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[29][5][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[29][5][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[29][6][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[29][6][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[29][6][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[29][6][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[29][6][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[29][6][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[29][6][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[29][6][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[29][6][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[29][6][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[29][6][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[29][6][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[29][7][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[29][7][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[29][7][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[29][7][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[29][7][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[29][7][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[29][7][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[29][7][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[29][7][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[29][7][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[29][7][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[29][7][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[29][8][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[29][8][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[29][8][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[29][8][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[29][8][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[29][8][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[29][8][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[29][8][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[29][8][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[29][8][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[29][8][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[29][8][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[29][9][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[29][9][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[29][9][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[29][9][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[29][9][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[29][9][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[29][9][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[29][9][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[29][9][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[29][9][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[29][9][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[29][9][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[29][10][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[29][10][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[29][10][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[29][10][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[29][10][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[29][10][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[29][10][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[29][10][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[29][10][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[29][10][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[29][10][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[29][10][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[30][0][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[30][0][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[30][0][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[30][0][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[30][0][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[30][0][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[30][0][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[30][0][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[30][0][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[30][0][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[30][0][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[30][0][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[30][1][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[30][1][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[30][1][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[30][1][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[30][1][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[30][1][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[30][1][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[30][1][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[30][1][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[30][1][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[30][1][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[30][1][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[30][2][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[30][2][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[30][2][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[30][2][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[30][2][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[30][2][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[30][2][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[30][2][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[30][2][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[30][2][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[30][2][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[30][2][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[30][3][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[30][3][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[30][3][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[30][3][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[30][3][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[30][3][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[30][3][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[30][3][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[30][3][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[30][3][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[30][3][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[30][3][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[30][4][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[30][4][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[30][4][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[30][4][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[30][4][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[30][4][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[30][4][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[30][4][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[30][4][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[30][4][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[30][4][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[30][4][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[31][0][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[31][0][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[31][0][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[31][0][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[31][0][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[31][0][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[31][0][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[31][0][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[31][0][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[31][0][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[31][0][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[31][0][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[31][1][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[31][1][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[31][1][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[31][1][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[31][1][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[31][1][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[31][1][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[31][1][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[31][1][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[31][1][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[31][1][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[31][1][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[31][2][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[31][2][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[31][2][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[31][2][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[31][2][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[31][2][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[31][2][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[31][2][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[31][2][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[31][2][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[31][2][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[31][2][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[31][3][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[31][3][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[31][3][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[31][3][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[31][3][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[31][3][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[31][3][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[31][3][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[31][3][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[31][3][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[31][3][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[31][3][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[31][4][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[31][4][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[31][4][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[31][4][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[31][4][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[31][4][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[31][4][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[31][4][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[31][4][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[31][4][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[31][4][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[31][4][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[31][5][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[31][5][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[31][5][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[31][5][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[31][5][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[31][5][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[31][5][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[31][5][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[31][5][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[31][5][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[31][5][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[31][5][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[32][0][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[32][0][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[32][0][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[32][0][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[32][0][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[32][0][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[32][0][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[32][0][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[32][0][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[32][0][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[32][0][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[32][0][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[32][1][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[32][1][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[32][1][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[32][1][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[32][1][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[32][1][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[32][1][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[32][1][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[32][1][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[32][1][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[32][1][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[32][1][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[32][2][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[32][2][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[32][2][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[32][2][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[32][2][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[32][2][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[32][2][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[32][2][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[32][2][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[32][2][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[32][2][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[32][2][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[32][3][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[32][3][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[32][3][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[32][3][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[32][3][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[32][3][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[32][3][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[32][3][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[32][3][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[32][3][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[32][3][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[32][3][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[32][4][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[32][4][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[32][4][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[32][4][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[32][4][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[32][4][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[32][4][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[32][4][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[32][4][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[32][4][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[32][4][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[32][4][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[32][5][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[32][5][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[32][5][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[32][5][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[32][5][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[32][5][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[32][5][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[32][5][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[32][5][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[32][5][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[32][5][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[32][5][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[32][6][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[32][6][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[32][6][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[32][6][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[32][6][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[32][6][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[32][6][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[32][6][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[32][6][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[32][6][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[32][6][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[32][6][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[32][7][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[32][7][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[32][7][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[32][7][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[32][7][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[32][7][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[32][7][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[32][7][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[32][7][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[32][7][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[32][7][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[32][7][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[33][0][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[33][0][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[33][0][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[33][0][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[33][0][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[33][0][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[33][0][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[33][0][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[33][0][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[33][0][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[33][0][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[33][0][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[33][1][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[33][1][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[33][1][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[33][1][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[33][1][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[33][1][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[33][1][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[33][1][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[33][1][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[33][1][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[33][1][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[33][1][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[33][2][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[33][2][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[33][2][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[33][2][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[33][2][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[33][2][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[33][2][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[33][2][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[33][2][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[33][2][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[33][2][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[33][2][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[34][0][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[34][0][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[34][0][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[34][0][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[34][0][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[34][0][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[34][0][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[34][0][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[34][0][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[34][0][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[34][0][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[34][0][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[35][0][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[35][0][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[35][0][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[35][0][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[35][0][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[35][0][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[35][0][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[35][0][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[35][0][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[35][0][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[35][0][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[35][0][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[36][0][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[36][0][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[36][0][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[36][0][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[36][0][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[36][0][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[36][0][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[36][0][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[36][0][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[36][0][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[36][0][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[36][0][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[36][1][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[36][1][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[36][1][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[36][1][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[36][1][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[36][1][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[36][1][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[36][1][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[36][1][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[36][1][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[36][1][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[36][1][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[36][2][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[36][2][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[36][2][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[36][2][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[36][2][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[36][2][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[36][2][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[36][2][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[36][2][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[36][2][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[36][2][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[36][2][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[36][3][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[36][3][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[36][3][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[36][3][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[36][3][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[36][3][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[36][3][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[36][3][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[36][3][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[36][3][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[36][3][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[36][3][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[36][4][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[36][4][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[36][4][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[36][4][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[36][4][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[36][4][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[36][4][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[36][4][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[36][4][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[36][4][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[36][4][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[36][4][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[37][0][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[37][0][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[37][0][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[37][0][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[37][0][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[37][0][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[37][0][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[37][0][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[37][0][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[37][0][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[37][0][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[37][0][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[37][1][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[37][1][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[37][1][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[37][1][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[37][1][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[37][1][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[37][1][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[37][1][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[37][1][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[37][1][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[37][1][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[37][1][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[38][0][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[38][0][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[38][0][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[38][0][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[38][0][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[38][0][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[38][0][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[38][0][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[38][0][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[38][0][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[38][0][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[38][0][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[38][1][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[38][1][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[38][1][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[38][1][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[38][1][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[38][1][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[38][1][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[38][1][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[38][1][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[38][1][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[38][1][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[38][1][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[39][0][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[39][0][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[39][0][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[39][0][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[39][0][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[39][0][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[39][0][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[39][0][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[39][0][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[39][0][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[39][0][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[39][0][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[39][1][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[39][1][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[39][1][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[39][1][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[39][1][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[39][1][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[39][1][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[39][1][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[39][1][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[39][1][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[39][1][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[39][1][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[39][2][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[39][2][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[39][2][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[39][2][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[39][2][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[39][2][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[39][2][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[39][2][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[39][2][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[39][2][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[39][2][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[39][2][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[39][3][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[39][3][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[39][3][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[39][3][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[39][3][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[39][3][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[39][3][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[39][3][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[39][3][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[39][3][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[39][3][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[39][3][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[40][0][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[40][0][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[40][0][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[40][0][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[40][0][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[40][0][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[40][0][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[40][0][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[40][0][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[40][0][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[40][0][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[40][0][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[40][1][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[40][1][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[40][1][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[40][1][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[40][1][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[40][1][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[40][1][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[40][1][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[40][1][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[40][1][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[40][1][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[40][1][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[40][2][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[40][2][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[40][2][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[40][2][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[40][2][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[40][2][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[40][2][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[40][2][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[40][2][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[40][2][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[40][2][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[40][2][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[40][3][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[40][3][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[40][3][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[40][3][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[40][3][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[40][3][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[40][3][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[40][3][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[40][3][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[40][3][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[40][3][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[40][3][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[41][0][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[41][0][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[41][0][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[41][0][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[41][0][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[41][0][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[41][0][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[41][0][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[41][0][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[41][0][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[41][0][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[41][0][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[41][1][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[41][1][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[41][1][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[41][1][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[41][1][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[41][1][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[41][1][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[41][1][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[41][1][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[41][1][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[41][1][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[41][1][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[41][2][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[41][2][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[41][2][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[41][2][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[41][2][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[41][2][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[41][2][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[41][2][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[41][2][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[41][2][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[41][2][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[41][2][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[41][3][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[41][3][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[41][3][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[41][3][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[41][3][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[41][3][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[41][3][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[41][3][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[41][3][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[41][3][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[41][3][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[41][3][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[41][4][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[41][4][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[41][4][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[41][4][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[41][4][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[41][4][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[41][4][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[41][4][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[41][4][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[41][4][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[41][4][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[41][4][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[41][5][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[41][5][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[41][5][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[41][5][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[41][5][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[41][5][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[41][5][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[41][5][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[41][5][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[41][5][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[41][5][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[41][5][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[41][6][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[41][6][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[41][6][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[41][6][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[41][6][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[41][6][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[41][6][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[41][6][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[41][6][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[41][6][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[41][6][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[41][6][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[42][0][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[42][0][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[42][0][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[42][0][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[42][0][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[42][0][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[42][0][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[42][0][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[42][0][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[42][0][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[42][0][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[42][0][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[42][1][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[42][1][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[42][1][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[42][1][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[42][1][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[42][1][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[42][1][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[42][1][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[42][1][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[42][1][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[42][1][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[42][1][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[42][2][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[42][2][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[42][2][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[42][2][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[42][2][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[42][2][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[42][2][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[42][2][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[42][2][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[42][2][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[42][2][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[42][2][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[42][3][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[42][3][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[42][3][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[42][3][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[42][3][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[42][3][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[42][3][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[42][3][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[42][3][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[42][3][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[42][3][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[42][3][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[43][0][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[43][0][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[43][0][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[43][0][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[43][0][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[43][0][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[43][0][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[43][0][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[43][0][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[43][0][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[43][0][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[43][0][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[43][1][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[43][1][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[43][1][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[43][1][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[43][1][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[43][1][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[43][1][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[43][1][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[43][1][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[43][1][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[43][1][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[43][1][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[43][2][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[43][2][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[43][2][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[43][2][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[43][2][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[43][2][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[43][2][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[43][2][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[43][2][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[43][2][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[43][2][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[43][2][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[43][3][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[43][3][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[43][3][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[43][3][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[43][3][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[43][3][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[43][3][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[43][3][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[43][3][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[43][3][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[43][3][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[43][3][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[43][4][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[43][4][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[43][4][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[43][4][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[43][4][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[43][4][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[43][4][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[43][4][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[43][4][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[43][4][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[43][4][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[43][4][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[44][0][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[44][0][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[44][0][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[44][0][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[44][0][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[44][0][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[44][0][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[44][0][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[44][0][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[44][0][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[44][0][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[44][0][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[44][1][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[44][1][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[44][1][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[44][1][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[44][1][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[44][1][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[44][1][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[44][1][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[44][1][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[44][1][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[44][1][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[44][1][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[44][2][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[44][2][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[44][2][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[44][2][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[44][2][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[44][2][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[44][2][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[44][2][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[44][2][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[44][2][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[44][2][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[44][2][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[44][3][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[44][3][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[44][3][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[44][3][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[44][3][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[44][3][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[44][3][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[44][3][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[44][3][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[44][3][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[44][3][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[44][3][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[44][4][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[44][4][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[44][4][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[44][4][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[44][4][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[44][4][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[44][4][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[44][4][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[44][4][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[44][4][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[44][4][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[44][4][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[44][5][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[44][5][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[44][5][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[44][5][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[44][5][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[44][5][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[44][5][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[44][5][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[44][5][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[44][5][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[44][5][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[44][5][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[44][6][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[44][6][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[44][6][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[44][6][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[44][6][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[44][6][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[44][6][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[44][6][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[44][6][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[44][6][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[44][6][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[44][6][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[44][7][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[44][7][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[44][7][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[44][7][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[44][7][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[44][7][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[44][7][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[44][7][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[44][7][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[44][7][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[44][7][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[44][7][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[44][8][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[44][8][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[44][8][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[44][8][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[44][8][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[44][8][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[44][8][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[44][8][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[44][8][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[44][8][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[44][8][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[44][8][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[45][0][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[45][0][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[45][0][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[45][0][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[45][0][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[45][0][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[45][0][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[45][0][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[45][0][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[45][0][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[45][0][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[45][0][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[45][1][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[45][1][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[45][1][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[45][1][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[45][1][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[45][1][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[45][1][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[45][1][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[45][1][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[45][1][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[45][1][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[45][1][12][value]` |  | text (moeda) |  |  |  |  |
| `categories[46][0][1][value]` |  | text (moeda) |  |  |  |  |
| `categories[46][0][2][value]` |  | text (moeda) |  |  |  |  |
| `categories[46][0][3][value]` |  | text (moeda) |  |  |  |  |
| `categories[46][0][4][value]` |  | text (moeda) |  |  |  |  |
| `categories[46][0][5][value]` |  | text (moeda) |  |  |  |  |
| `categories[46][0][6][value]` |  | text (moeda) |  |  |  |  |
| `categories[46][0][7][value]` |  | text (moeda) |  |  |  |  |
| `categories[46][0][8][value]` |  | text (moeda) |  |  |  |  |
| `categories[46][0][9][value]` |  | text (moeda) |  |  |  |  |
| `categories[46][0][10][value]` |  | text (moeda) |  |  |  |  |
| `categories[46][0][11][value]` |  | text (moeda) |  |  |  |  |
| `categories[46][0][12][value]` |  | text (moeda) |  |  |  |  |

## SCR-440 · Congelamento Financeiro

- **Rota:** `/admin/financial-freezes/create`
- **Módulo:** Financeiro > Congelamentos Financeiros
- **Tipo:** Cadastro (novo)
- **Finalidade:** Congelamentos Financeiros (cadastro (novo))
- **Botões/Ações (cabeçalho):** Voltar → `/admin/financial-freezes`

**Formulário POST `/admin/financial-freezes`** — botões: Salvar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `user_name` | Responsável | text | R |  |  |  |
| `month` | Mês | select | R |  | Janeiro, Fevereiro, Março, Abril, Maio, Junho, Julho, Agosto … (12) |  |
| `year` | Ano | text | R | 4 |  |  |
| `is_frozen` | Congelado? | select | R |  | Sim, Não |  |

## SCR-455 · Movimento Caixa/Bancário

- **Rota:** `/admin/movements/245221`
- **Módulo:** Financeiro > Mov. Caixa/Bancário
- **Tipo:** Detalhe
- **Finalidade:** Mov. Caixa/Bancário (detalhe)
- **Botões/Ações (cabeçalho):** Voltar → `/admin/movements`

**Tabela** — linhas na amostra: 1

- Colunas: Categoria | Conta Contábil | Centro de Custo | Valor | Percentual
- Totalizador: Total: R$ 100.000,00 100,00%

