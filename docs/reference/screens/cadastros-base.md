# Telas — Cadastros Base

Detalhamento tela a tela (sistema de referência). Legenda: **R** = obrigatório observado (atributo required/asterisco), tipo = tipo do controle HTML observado; "Opções" mostra amostra (até 8) das opções de listas.

## SCR-004 · Funcionários

- **Rota:** `/admin/employees`
- **Módulo:** Cadastros Base > Pessoas > Funcionários
- **Tipo:** Listagem
- **Finalidade:** Funcionários (listagem)
- **Botões/Ações (cabeçalho):** Saiba +; fas fa-print → `/admin/employees/report`; Importar → `#` (modal #modalImportEmployeesXls); Exportar → `/admin/employees/export`; Adicionar Novo → `/admin/employees/create`
- **Modais:** Importar

**Filtros (GET)** — botões: Filtrar

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `search` | Pesquisar por nome ou CPF/CNPJ | text |  |
| `start_date` | Dt. Início | text (data) |  |
| `end_date` | Dt. Fim | text (data) |  |
| `is_enabled` | Ativo | select | Sim, Não |

**Tabela** (N. Registros: 1) — linhas na amostra: 1

- Colunas: Nome | CPF | Email | Celular | Cargo | Dt. Criação | Ação
- Ações por linha: Visualizar, Editar, Excluir
- Links por linha: `/admin/employees/{id}`, `/admin/employees/{id}/edit`

**Formulário POST `/admin/employees/import`** (modal modalImportEmployeesXls)

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `file` |  | file |  |  |  |  |

## SCR-005 · Usuários

- **Rota:** `/admin/users`
- **Módulo:** Cadastros Base > Pessoas > Usuários
- **Tipo:** Listagem
- **Finalidade:** Usuários (listagem)
- **Botões/Ações (cabeçalho):** Saiba +; Importar → `#` (modal #modalImport); Exportar → `/admin/users/export`; Adicionar Novo → `/admin/users/create`
- **Modais:** Importar
- **Paginação:** sim (server-side, seletor de quantidade 10–200)

**Filtros (GET)** — botões: Filtrar

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `search` | Pesquisar por nome/email | text |  |
| `role` | Perfil de Usuário | select | (lista dinâmica de cadastro — 5 registros; valores omitidos por privacidade) |
| `is_online` | Status | select | Todos, Online, Offline |
| `last_activity` | Último Acesso | select | Todos, Mais de 1 dia, Mais de 1 semana, Mais de 1 quinzena, Mais de 1 mês, Mais de 1 trimestre, Mais de 1 semestre, Mais de 1 ano |

**Tabela** (N. Registros: 14) — linhas na amostra: 10

- Colunas: # | Nome | Telefone | Email | Perfil de Usuário | Dt. Criação | Última Ativ. | Dt. Últ. Sessão | Ação
- Ações por linha: Visualizar, Editar, Excluir
- Links por linha: `https://api.whatsapp.com/send?phone=5563984879640`, `/cdn-cgi/l/email-protection`, `/admin/users/{id}`, `/admin/users/{id}/edit`

**Formulário POST `/admin/users/import`** (modal modalImport) — botões: Importar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `file` |  | file | R |  |  |  |

## SCR-027 · Centro de Custo

- **Rota:** `/admin/costcenters`
- **Módulo:** Cadastros Base > Estrutura > Centros de Custo
- **Tipo:** Listagem
- **Finalidade:** Centros de Custo (listagem)
- **Botões/Ações (cabeçalho):** Saiba +

**Tabela** — linhas na amostra: 10

- Colunas: Código | Classe | Condição | Descrição | Ativo | Ação
- Ações por linha: Visualizar, Cria descendente
- Links por linha: `/admin/costcenters/{id}`, `/admin/costcenters/create?parent_id=2`

## SCR-028 · Fazendas

- **Rota:** `/admin/farms`
- **Módulo:** Cadastros Base > Estrutura > Fazendas
- **Tipo:** Listagem
- **Finalidade:** Fazendas (listagem)
- **Botões/Ações (cabeçalho):** Saiba +; Adicionar Novo → `/admin/farms/create`

**Filtros (GET)** — botões: Filtrar

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `search` | Pesquisar por nome | text |  |
| `tenant` | Contratante | select | (lista dinâmica de cadastro — 1 registros; valores omitidos por privacidade) |
| `start_date` | Dt. Inicio | text |  |
| `end_date` | Dt. Fim | text |  |
| `enabled` | Ativo | select | Todas, Sim, Não |
| `country` | Pais | select | 906 - Bermudas Sim, 132 - Afeganistão, 7560 - África do Sul, 175 - Albânia, República da, 230 - Alemanha, 370 - Andorra Sim, 400 - Angola, 418 - Anguilla Sim … (245) |
| `state` | Estado | select | Todos |

**Tabela** (N. Registros: 2) — linhas na amostra: 33

- Colunas: Nome | Área Total | Cidade | Contratante | Ativo | Ação
- Ações por linha: Visualizar, Adicionar Área, Adicionar Multiplas Áreas, Editar, Excluir
- Links por linha: `/admin/farms/{id}`, `/admin/areas/create?farm=80`, `/admin/areas-multiple/create?farm=80`, `/admin/farms/{id}/edit`

## SCR-029 · Safras

- **Rota:** `/admin/harvests`
- **Módulo:** Cadastros Base > Estrutura > Safras
- **Tipo:** Listagem
- **Finalidade:** Safras (listagem)
- **Botões/Ações (cabeçalho):** Saiba +; Adicionar Novo → `/admin/harvests/create`

**Tabela** (N. Registros: 5) — linhas na amostra: 5

- Colunas: Descrição | Dt. Início | Dt. Fim | Ativo | Ação
- Ações por linha: Visualizar, Editar, Excluir
- Links por linha: `/admin/harvests/{id}`, `/admin/harvests/{id}/edit`

## SCR-030 · Endereçamentos

- **Rota:** `/admin/addressings`
- **Módulo:** Cadastros Base > Estrutura > Produtos > Endereçamentos
- **Tipo:** Relatório
- **Finalidade:** Endereçamentos (relatório)
- **Botões/Ações (cabeçalho):** Adicionar Novo → `/admin/addressings/create`
- **Cards/Seções:** Endereçamentos

**Tabela** (N. Registros: 2) — linhas na amostra: 8

- Colunas: Descrição | Tipo | Ação
- Ações por linha: Visualizar, Cria descendente, Editar, Excluir
- Links por linha: `/admin/addressings/{id}`, `/admin/addressings/create?parent_id=1`, `/admin/addressings/{id}/edit`

## SCR-031 · Produtos

- **Rota:** `/admin/products`
- **Módulo:** Cadastros Base > Estrutura > Produtos > Produtos
- **Tipo:** Listagem
- **Finalidade:** Produtos (listagem)
- **Botões/Ações (cabeçalho):** Agrupar; Saiba +; fas fa-print → `/admin/products/report`; Importar → `#` (modal #modalImport); Exportar → `/admin/products/export`; Adicionar Novo → `/admin/products/create`
- **Modais:** Importar; Agrupar Produtos
- **Paginação:** sim (server-side, seletor de quantidade 10–200)

**Filtros (GET)** — botões: Filtrar

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `search` | Pesquisar por nome/código/princípio ativo | text |  |
| `group` | Grupo | select | Insumos Agrícola, Insumos Gerais, Insumos Industrialização, Insumos Pecuária, Máquinas/Equipamentos/Veículos, Produção, Produtos Exportação |
| `category` | Categoria | select |  |
| `kind` | Classe | select |  |
| `lot` | Lote | select | Não, Sim |
| `equipment` | Máq/Implementos | select | Não, Sim |
| `pagination_quantity` | Qtd. de Registros | select | 10 Registros, 20 Registros, 30 Registros, 50 Registros, 80 Registros, 100 Registros, 200 Registros |

**Tabela** (N. Registros: 5629) — linhas na amostra: 10

- Colunas: # | Código | Descrição | Grupo | Categoria | Classe | NCM | Estoque min. | Ativo | Ação
- Ações por linha: Visualizar, Editar, Excluir
- Links por linha: `/admin/products/{id}`, `/admin/products/{id}/edit`

**Formulário POST `/admin/products/import`** (modal modalImport) — botões: Importar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `file` |  | file | R |  |  |  |

- Mensagens/alertas: Selecione o produto quer irá ser o principal.

## SCR-032 · Armazém

- **Rota:** `/admin/warehouses`
- **Módulo:** Cadastros Base > Estrutura > Produtos > Armazéns
- **Tipo:** Listagem
- **Finalidade:** Armazéns (listagem)
- **Botões/Ações (cabeçalho):** Saiba +; Adicionar Novo → `/admin/warehouses/create`

**Tabela** (N. Registros: 1) — linhas na amostra: 1

- Colunas: Sigla | Descrição | Tipo | Ativo | Ação
- Ações por linha: Visualizar, Editar, Excluir
- Links por linha: `/admin/warehouses/{id}`, `/admin/warehouses/{id}/edit`

## SCR-033 · Saldo Inicial

- **Rota:** `/admin/openingbalances`
- **Módulo:** Cadastros Base > Estrutura > Produtos > Estoques Iniciais
- **Tipo:** Listagem
- **Finalidade:** Estoques Iniciais (listagem)
- **Botões/Ações (cabeçalho):** Saiba +; Importar → `#` (modal #modalImport); Exportar → `/admin/openingbalances/export`; Adicionar Novo → `/admin/openingbalances/create`
- **Modais:** Importar

**Filtros (GET)** — botões: Filtrar

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `search` | Pesquisar por produto ou lote | text |  |
| `product` | Produto | select |  |
| `warehouse` | Armazém | select | BARRACAO |

**Tabela** (N. Registros: 3) — linhas na amostra: 3

- Colunas: Produto | Un. Medida | Armazém | Quantidade | Dt. Movimento | Lote Fornecedor | Classificação | Ação
- Ações por linha: Visualizar, Editar, Excluir
- Links por linha: `/admin/openingbalances/{id}`, `/admin/openingbalances/{id}/edit`

**Formulário POST `/admin/openingbalances/import`** (modal modalImport) — botões: Importar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `file` |  | file | R |  |  |  |

## SCR-034 · Rateio - Categoria Financeira

- **Rota:** `/admin/apportionments`
- **Módulo:** Cadastros Base > Estrutura > Rateios > Categorias
- **Tipo:** Listagem
- **Finalidade:** Categorias (listagem)
- **Botões/Ações (cabeçalho):** Saiba +; Adicionar Novo → `/admin/apportionments/create`

**Tabela** (N. Registros: 0) — linhas na amostra: 1

- Colunas: Categoria Financeira | Ação

## SCR-035 · Perfil Usuário

- **Rota:** `/admin/roles`
- **Módulo:** Cadastros Base > Pessoas > Perfil Usuário
- **Tipo:** Listagem
- **Finalidade:** Perfil Usuário (listagem)
- **Botões/Ações (cabeçalho):** Saiba +; Adicionar Novo → `/admin/roles/create`

**Tabela** (N. Registros: 5) — linhas na amostra: 5

- Colunas: Descrição | Nome | Dt. Criação | Dt. Atualização | Ação
- Ações por linha: Visualizar, Editar, Excluir
- Links por linha: `/admin/roles/{id}`, `/admin/roles/{id}/edit`

## SCR-036 · Pessoas

- **Rota:** `/admin/people`
- **Módulo:** Cadastros Base > Pessoas > Pessoas Unificado
- **Tipo:** Listagem
- **Finalidade:** Pessoas Unificado (listagem)
- **Botões/Ações (cabeçalho):** Adicionar Novo → `/admin/people/create`
- **Paginação:** sim (server-side, seletor de quantidade 10–200)

**Filtros (GET)** — botões: Filtrar

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `search` | Pesquisar por nome, email ou CPF/CNPJ | text |  |
| `entity` | Tipo | select | Todas, Fornecedor, Funcionário, Proprietário, Cliente, Usuário |

**Tabela** (N. Registros: 50) — linhas na amostra: 15

- Colunas: Nome | CPF | Email | Entidades | Ação
- Ações por linha: Visualizar, Editar
- Links por linha: `/admin/people/{id}`, `/admin/people/{id}/edit`

## SCR-037 · Proprietários

- **Rota:** `/admin/proprietaries`
- **Módulo:** Cadastros Base > Pessoas > Proprietários
- **Tipo:** Listagem
- **Finalidade:** Proprietários (listagem)
- **Botões/Ações (cabeçalho):** Saiba +; fas fa-print → `/admin/proprietaries/report`; Importar → `#` (modal #modalImport); Exportar → `/admin/proprietaries/export`; Adicionar Novo → `/admin/proprietaries/create`
- **Modais:** Importar

**Tabela** (N. Registros: 1) — linhas na amostra: 1

- Colunas: Nome | CPF/CNPJ | Email | Telefone | Dt. Criação | Ação
- Ações por linha: Visualizar, Editar, Excluir
- Links por linha: `/cdn-cgi/l/email-protection`, `/admin/proprietaries/{id}`, `/admin/proprietaries/{id}/edit`

**Formulário POST `/admin/proprietaries/import`** (modal modalImport) — botões: Importar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `file` |  | file | R |  |  |  |

## SCR-038 · Fornecedores

- **Rota:** `/admin/providers`
- **Módulo:** Cadastros Base > Pessoas > Fornecedores
- **Tipo:** Listagem
- **Finalidade:** Fornecedores (listagem)
- **Botões/Ações (cabeçalho):** Saiba +; fas fa-print → `/admin/providers/report`; Importar → `#` (modal #modalImport); Exportar → `/admin/providers/export`; Adicionar Novo → `/admin/providers/create`
- **Modais:** Importar
- **Paginação:** sim (server-side, seletor de quantidade 10–200)

**Filtros (GET)** — botões: Filtrar

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `nickname` | Nome Completo/Razão Social | text |  |
| `name` | Nome Social/Fantasia | text |  |
| `nif` | CPF/CNPJ | text |  |
| `type` | Tipo | select | Fornecedor, Funcionário, Terceirizado, Transportador, Comissionado, Inseminador |
| `start_date` | Dt. Início | text (data) |  |
| `end_date` | Dt. Fim | text (data) |  |

**Tabela** (N. Registros: 41) — linhas na amostra: 10

- Colunas: Nome Fantasia/Apelido | CPF/CNPJ | Email | Celular | Tipo | Dt. Criação | Ação
- Ações por linha: Visualizar, Editar, Excluir
- Links por linha: `/admin/providers/{id}`, `/admin/providers/{id}/edit`

**Formulário POST `/admin/providers/import`** (modal modalImport) — botões: Importar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `file` |  | file | R |  |  |  |

## SCR-039 · Clientes

- **Rota:** `/admin/clients`
- **Módulo:** Cadastros Base > Pessoas > Clientes
- **Tipo:** Listagem
- **Finalidade:** Clientes (listagem)
- **Botões/Ações (cabeçalho):** Saiba +; fas fa-print → `/admin/clients/report`; Importar → `#` (modal #modalImport); Exportar → `/admin/clients/export`; Adicionar Novo → `/admin/clients/create`
- **Modais:** Importar

**Filtros (GET)** — botões: Filtrar

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `search` | Pesquisar por nome ou CPF/CNPJ | text |  |
| `start_date` | Dt. Início | text (data) |  |
| `end_date` | Dt. Fim | text (data) |  |

**Tabela** (N. Registros: 7) — linhas na amostra: 7

- Colunas: Nome Fantasia | CPF/CNPJ | Email | Celular | Dt. Criação | Ação
- Ações por linha: Visualizar, Editar, Excluir
- Links por linha: `/cdn-cgi/l/email-protection`, `/admin/clients/{id}`, `/admin/clients/{id}/edit`

**Formulário POST `/admin/clients/import`** (modal modalImport) — botões: Importar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `file` |  | file | R |  |  |  |

## SCR-040 · Autorizadores

- **Rota:** `/admin/authorizers`
- **Módulo:** Cadastros Base > Pessoas > Autorizadores
- **Tipo:** Listagem
- **Finalidade:** Autorizadores (listagem)
- **Botões/Ações (cabeçalho):** Saiba +; Adicionar Novo → `/admin/authorizers/create`

**Filtros (GET)** — botões: Filtrar

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `search` | Buscar | text |  |

**Tabela** (N. Registros: 3) — linhas na amostra: 3

- Colunas: Autorizador | Dt. Cadastro | Valor | Ativo | Autorizador Condicional | Ação
- Ações por linha: Visualizar, Editar, Excluir
- Links por linha: `/admin/authorizers/{id}`, `/admin/authorizers/{id}/edit`

## SCR-041 · Contas Bancárias

- **Rota:** `/admin/accounts`
- **Módulo:** Cadastros Base > Financeiros > Contas Bancárias
- **Tipo:** Listagem
- **Finalidade:** Contas Bancárias (listagem)
- **Botões/Ações (cabeçalho):** Saiba +; Adicionar Novo → `/admin/accounts/create`

**Tabela** (N. Registros: 6) — linhas na amostra: 6

- Colunas: Descrição | Banco | Agência | Conta | Proprietário | Limite | Saldo | Ativo | Boleto | Ação
- Ações por linha: Visualizar, Editar, Excluir
- Links por linha: `/admin/accounts/{id}`, `/admin/accounts/{id}/edit`

## SCR-042 · Saldo Inicial

- **Rota:** `/admin/open-movements`
- **Módulo:** Cadastros Base > Financeiros > Saldo Inicial
- **Tipo:** Listagem
- **Finalidade:** Saldo Inicial (listagem)
- **Botões/Ações (cabeçalho):** Saiba +; Simular Crédito (modal #simulateCreditModal); Adicionar Novo → `/admin/open-movements/create`

**Filtros (GET)** — botões: Filtrar

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `account` | Conta Bancária | select | CXF - 000 - Caixa Fazenda - 01, CXF1 - 000 - Caixa Fazenda - 02, CXF - 000 - Caixa Fazenda - 03, CXF - 000 - INVESTIMENTO 1, 0013 - 56, BB - BB Principal |
| `start_date` | Dt. Início | text |  |
| `end_date` | Dt. Fim | text |  |
| `proprietary_id` | Proprietário Gestor | select | (lista dinâmica de cadastro — 1 registros; valores omitidos por privacidade) |

**Tabela** — linhas na amostra: 1

- Colunas: # | Dt. Mov. | Sigla | Agência | Conta | Gestor | Nº Documento. | E/S | Juros | V. Total(R$) | Ação

## SCR-043 · Categoria Financeira

- **Rota:** `/admin/financialcategories`
- **Módulo:** Cadastros Base > Financeiros > Categorias Financeiras
- **Tipo:** Listagem
- **Finalidade:** Categorias Financeiras (listagem)
- **Botões/Ações (cabeçalho):** Saiba +; fas fa-print → `/admin/financial-category-report`
- **Paginação:** sim (server-side, seletor de quantidade 10–200)

**Filtros (GET)** — botões: Filtrar

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `search` | Pesquisar por nome ou código | text |  |
| `type` | Tipo Categoria | select | Saidas, Entradas, Ambas |
| `grouper` | Agrupador | select | Receita Bruta - RB, Custo Operacional Efetivo - COE, Custo Operacional Total - COT, Custo Total - CT, Investimentos - I, Financiamentos Empréstimos Aportes_FEA, Movimentação Interna_MI, Outras Receitas Operacionais_ ORO … (14) |
| `classification` | Classificação | select | Não Classificado, CAPEX, OPEX |
| `start_date` | Dt. Ini. | text (data) |  |
| `end_date` | Dt. Fim | text (data) |  |

**Tabela** — linhas na amostra: 10

- Colunas: Código | Classe | Tipo | Agrupador | Classificação | Descrição | Dt. Atualização | Ativo | Dedutível | Ação
- Ações por linha: Visualizar, Cria descendente
- Links por linha: `/admin/financialcategories/{id}`, `/admin/financialcategories/create?parent_id=325`

## SCR-044 · Emissor NFe

- **Rota:** `/admin/issue`
- **Módulo:** Cadastros Base > Fiscais > Emissores NFe
- **Tipo:** Listagem
- **Finalidade:** Emissores NFe (listagem)
- **Botões/Ações (cabeçalho):** Saiba +; Adicionar Novo → `/admin/issue/create`

**Tabela** (N. Registros: 2) — linhas na amostra: 2

- Colunas: Razão Social | CPF/CNPJ | Ambiente | Rua | Número | Bairro | Cidade | Ativo | Ação
- Ações por linha: Editar, Certificado, Excluir
- Links por linha: `/admin/issue/{id}/edit`, `/admin/issue/certificado/{id}`

## SCR-045 · Sincronização DFe

- **Rota:** `/admin/issue-dfe-sync-time`
- **Módulo:** Cadastros Base > Fiscais > Sinc. DFe
- **Tipo:** Listagem
- **Finalidade:** Sinc. DFe (listagem)
- **Botões/Ações (cabeçalho):** Adicionar Novo → `/admin/issue-dfe-sync-time/create`

**Tabela** (N. Registros: 0) — linhas na amostra: 1

- Colunas: Emissor | Hora da Sincronização | Última Sincronização | Ação

## SCR-046 · Sincronização NFS-e

- **Rota:** `/admin/issue-nfse-sync-time`
- **Módulo:** Cadastros Base > Fiscais > Sinc. NFS-e
- **Tipo:** Listagem
- **Finalidade:** Sinc. NFS-e (listagem)
- **Botões/Ações (cabeçalho):** Adicionar Novo → `/admin/issue-nfse-sync-time/create`

**Tabela** (N. Registros: 0) — linhas na amostra: 1

- Colunas: Emissor | Hora da Sincronização | Última Sincronização | Ação

## SCR-047 · Regras Fiscais

- **Rota:** `/admin/tax-rules`
- **Módulo:** Cadastros Base > Fiscais > Regras Fiscais
- **Tipo:** Listagem
- **Finalidade:** Regras Fiscais (listagem)
- **Botões/Ações (cabeçalho):** Adicionar Novo → `/admin/tax-rules/create`

**Tabela** (N. Registros: 0) — linhas na amostra: 1

- Colunas: Descrição | Ativo | Ação

## SCR-048 · Contadores

- **Rota:** `/admin/contador`
- **Módulo:** Cadastros Base > Fiscais > Contador
- **Tipo:** Listagem
- **Finalidade:** Contador (listagem)
- **Botões/Ações (cabeçalho):** Saiba +; Adicionar Novo → `/admin/contador/create`

**Tabela** (N. Registros: 0) — linhas na amostra: 1

- Colunas: Razão Social | CPF/CNPJ | Insc. Estadual | Email | Ação

## SCR-049 · Natureza de Operaçao

- **Rota:** `/admin/natureoperations`
- **Módulo:** Cadastros Base > Fiscais > Natureza Op.
- **Tipo:** Listagem
- **Finalidade:** Natureza Op. (listagem)
- **Botões/Ações (cabeçalho):** Saiba +; Adicionar Novo → `/admin/natureoperations/create`
- **Paginação:** sim (server-side, seletor de quantidade 10–200)

**Filtros (GET)** — botões: Filtrar

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `search` | Pesquisar por código, descrição | text |  |
| `type` | Tipo | select | Ambos, Saída, Entrada |
| `is_active` | Ativo | select | Todos, Sim, Não |

**Tabela** (N. Registros: 1009) — linhas na amostra: 10

- Colunas: Código | Descrição | Tipo | CFOP saída | CFOP entrada | Ativo | Ação
- Ações por linha: Editar, Excluir
- Links por linha: `/admin/natureoperations/{id}/edit`

## SCR-050 · Informações Complementares

- **Rota:** `/admin/additional-info`
- **Módulo:** Cadastros Base > Fiscais > Info. Complementares
- **Tipo:** Listagem
- **Finalidade:** Info. Complementares (listagem)
- **Botões/Ações (cabeçalho):** Adicionar Novo → `/admin/additional-info/create`

**Tabela** (N. Registros: 0) — linhas na amostra: 1

- Colunas: Descrição | Ativo | Ação

## SCR-051 · Planos de Contas

- **Rota:** `/admin/plan-accounts`
- **Módulo:** Cadastros Base > Fiscais > Plano de Contas
- **Tipo:** Listagem
- **Finalidade:** Plano de Contas (listagem)
- **Botões/Ações (cabeçalho):** Saiba +; fas fa-print → `/admin/plan-accounts/report`; Importar → `#` (modal #modalImport); Exportar → `/admin/plan-accounts/export`; Adicionar Novo → `/admin/plan-accounts/create`
- **Modais:** Importar
- **Paginação:** sim (server-side, seletor de quantidade 10–200)

**Filtros (GET)** — botões: Filtrar

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `search` | Pesquisar por nome ou código | text |  |
| `condition` | Condição | select | Débito, Crédito, Ambos |
| `start_date` | Dt. Ini. | text (data) |  |
| `end_date` | Dt. Fim | text (data) |  |

**Tabela** (N. Registros: 126) — linhas na amostra: 30

- Colunas: Código | Classe | Condição | Descrição | Ação
- Ações por linha: Visualizar, Editar, Excluir
- Links por linha: `/admin/plan-accounts/{id}`, `/admin/plan-accounts/{id}/edit`

**Formulário POST `/admin/plan-accounts/import`** (modal modalImport) — botões: Importar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `file` |  | file | R |  |  |  |

## SCR-052 · Operação

- **Rota:** `/admin/operations`
- **Módulo:** Cadastros Base > Agrícolas > Operações
- **Tipo:** Listagem
- **Finalidade:** Operações (listagem)
- **Botões/Ações (cabeçalho):** Adicionar Novo → `/admin/operations/create`
- **Paginação:** sim (server-side, seletor de quantidade 10–200)

**Tabela** (N. Registros: 19) — linhas na amostra: 10

- Colunas: Nome | Agrupador | Ordem | Ativo | Ação
- Ações por linha: Visualizar, Editar, Excluir
- Links por linha: `/admin/operations/{id}`, `/admin/operations/{id}/edit`

## SCR-053 · Atividades

- **Rota:** `/admin/activities`
- **Módulo:** Cadastros Base > Agrícolas > Atividades
- **Tipo:** Listagem
- **Finalidade:** Atividades (listagem)
- **Botões/Ações (cabeçalho):** Adicionar Novo → `/admin/activities/create`
- **Paginação:** sim (server-side, seletor de quantidade 10–200)

**Filtros (GET)** — botões: Filtrar

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `search` | Pesquisar por atividade | text |  |
| `operation` | Operação | select | Abertura Áreas de Produção, Armazenagem, Colheita, Conservação do Solo, Construção Instalações, Identificação Animal, Manutenção Culturas Perenes, Manutenção Instalações … (19) |

**Tabela** (N. Registros: 156) — linhas na amostra: 10

- Colunas: Operação | Atividade | Vl. Hectare | Ativo | Ação
- Ações por linha: Visualizar, Editar, Excluir
- Links por linha: `/admin/activities/{id}`, `/admin/activities/{id}/edit`

## SCR-054 · Parâmetros de Peso

- **Rota:** `/admin/parameter-weights`
- **Módulo:** Cadastros Base > Pecuários > Parâmetros/Peso
- **Tipo:** Listagem
- **Finalidade:** Parâmetros/Peso (listagem)
- **Botões/Ações (cabeçalho):** Adicionar Novo → `/admin/parameter-weights/create`

**Tabela** (N. Registros: 0) — linhas na amostra: 1

- Colunas: Código | Descrição | Data | Responsável | Variação de Peso | Ação

## SCR-055 · Forragem

- **Rota:** `/admin/fodder`
- **Módulo:** Cadastros Base > Pecuários > Forragem
- **Tipo:** Listagem
- **Finalidade:** Forragem (listagem)
- **Botões/Ações (cabeçalho):** Adicionar Novo → `/admin/fodder/create`

**Tabela** (N. Registros: 7) — linhas na amostra: 7

- Colunas: Descrição | Ativo | Ação
- Ações por linha: Visualizar, Editar, Excluir
- Links por linha: `/admin/fodder/{id}`, `/admin/fodder/{id}/edit`

## SCR-056 · Animais

- **Rota:** `/admin/animals`
- **Módulo:** Cadastros Base > Pecuários > Rebanho
- **Tipo:** Listagem
- **Finalidade:** Rebanho (listagem)
- **Botões/Ações (cabeçalho):** Importar → `#` (modal #modalImport); Exportar → `/admin/animals/export`; Adicionar Novo → `/admin/animals/create`; Filtrar; Limpar → `/admin/animals`; text-light → `#`; Visualizar → `/admin/animals/108942`; Editar → `/admin/animals/108942/edit`; Excluir; text-light → `#`; Visualizar → `/admin/animals/108943`; Editar → `/admin/animals/108943/edit`; Excluir; text-light → `#`; Visualizar → `/admin/animals/108944`; Editar → `/admin/animals/108944/edit`; Excluir; text-light → `#`; Visualizar → `/admin/animals/108945`; Editar → `/admin/animals/108945/edit`; Excluir; text-light → `#`; Visualizar → `/admin/animals/108946`; Editar → `/admin/animals/108946/edit`; Excluir; text-light → `#`; Visualizar → `/admin/animals/108947`; Editar → `/admin/animals/108947/edit`; Excluir; text-light → `#`; Visualizar → `/admin/animals/108948`; Editar → `/admin/animals/108948/edit`; Excluir; text-light → `#`; Visualizar → `/admin/animals/108949`; Editar → `/admin/animals/108949/edit`; Excluir; text-light → `#`; Visualizar → `/admin/animals/108950`; Editar → `/admin/animals/108950/edit`; Excluir; text-light → `#`; Visualizar → `/admin/animals/108951`; Editar → `/admin/animals/108951/edit`; Excluir; 2 → `/admin/animals?page=2`; 3 → `/admin/animals?page=3`; 4 → `/admin/animals?page=4`; 5 → `/admin/animals?page=5`; 6 → `/admin/animals?page=6`; 7 → `/admin/animals?page=7`; 8 → `/admin/animals?page=8`; 9 → `/admin/animals?page=9`; 10 → `/admin/animals?page=10`; 46 → `/admin/animals?page=46`; 47 → `/admin/animals?page=47`; › → `/admin/animals?page=2`
- **Modais:** Importar; Confirme a exclusão
- **Paginação:** sim (server-side, seletor de quantidade 10–200)

**Filtros (GET)** — botões: Filtrar

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `search` | Pesquisar Id Animal | text |  |
| `category_id` | Categoria | select | Fêmeas > 36 meses, Fêmeas 25 a 36 meses, Fêmeas 13 a 24 meses, Fêmeas 0 a 12 meses, Machos 0 a 12 meses, Machos 13 a 24 meses, Machos 25 a 36 meses, Machos > 36 meses … (9) |
| `batch` | Lote | select | Sem lote |
| `proprietary_id` | Proprietário Gestor | select | (lista dinâmica de cadastro — 1 registros; valores omitidos por privacidade) |

**Tabela** (N. Registros: 465) — linhas na amostra: 10

- Colunas: Tipo | Tipo de Identif. | Identificação | Categoria | Lote | Área/Módulo | Peso Atual (Kg) | Ação
- Ações por linha: Visualizar, Editar, Excluir
- Links por linha: `/admin/animals/{id}`, `/admin/animals/{id}/edit`

**Formulário POST `/admin/animals/import`** (modal modalImport) — botões: Importar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `file` |  | file | R |  |  |  |

## SCR-057 · Custo Retroativo

- **Rota:** `/admin/animal-retroactive-costs`
- **Módulo:** Cadastros Base > Pecuários > Custo Retroativo
- **Tipo:** Listagem
- **Finalidade:** Custo Retroativo (listagem)
- **Botões/Ações (cabeçalho):** Importar → `#` (modal #modalImport)
- **Modais:** Importar
- **Paginação:** sim (server-side, seletor de quantidade 10–200)

**Filtros (GET)** — botões: Filtrar

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `identification` | Identificação | text |  |

**Tabela** (N. Registros: 465) — linhas na amostra: 10

- Colunas: Identificação | Categoria | Data de Entrada | Custo Retroativo
- Ações por linha: Salvar

**Formulário PUT `/admin/animal-retroactive-costs/108942`** — botões: Salvar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `retroactive_cost` |  | text (moeda) |  |  |  |  |

**Formulário PUT `/admin/animal-retroactive-costs/108943`** — botões: Salvar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `retroactive_cost` |  | text (moeda) |  |  |  |  |

**Formulário PUT `/admin/animal-retroactive-costs/108944`** — botões: Salvar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `retroactive_cost` |  | text (moeda) |  |  |  |  |

**Formulário PUT `/admin/animal-retroactive-costs/108945`** — botões: Salvar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `retroactive_cost` |  | text (moeda) |  |  |  |  |

**Formulário PUT `/admin/animal-retroactive-costs/108946`** — botões: Salvar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `retroactive_cost` |  | text (moeda) |  |  |  |  |

**Formulário PUT `/admin/animal-retroactive-costs/108947`** — botões: Salvar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `retroactive_cost` |  | text (moeda) |  |  |  |  |

**Formulário PUT `/admin/animal-retroactive-costs/108948`** — botões: Salvar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `retroactive_cost` |  | text (moeda) |  |  |  |  |

**Formulário PUT `/admin/animal-retroactive-costs/108949`** — botões: Salvar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `retroactive_cost` |  | text (moeda) |  |  |  |  |

**Formulário PUT `/admin/animal-retroactive-costs/108950`** — botões: Salvar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `retroactive_cost` |  | text (moeda) |  |  |  |  |

**Formulário PUT `/admin/animal-retroactive-costs/108951`** — botões: Salvar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `retroactive_cost` |  | text (moeda) |  |  |  |  |

**Formulário POST `/admin/animal-retroactive-costs/import`** (modal modalImport) — botões: Importar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `file` |  | file | R |  |  |  |

## SCR-058 · Módulos de Pastejo

- **Rota:** `/admin/grazing`
- **Módulo:** Cadastros Base > Pecuários > Módulo Pastejo
- **Tipo:** Listagem
- **Finalidade:** Módulo Pastejo (listagem)
- **Botões/Ações (cabeçalho):** Adicionar Novo → `/admin/grazing/create`

**Tabela** — linhas na amostra: 1

- Colunas: Código | Nome | Data | Áreas | Total da Área (ha) | Forragem | Ação

## SCR-059 · Cochos

- **Rota:** `/admin/troughs`
- **Módulo:** Cadastros Base > Pecuários > Cochos
- **Tipo:** Listagem
- **Finalidade:** Cochos (listagem)
- **Botões/Ações (cabeçalho):** Adicionar Novo → `/admin/troughs/create`

**Filtros (GET)** — botões: Filtrar

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `search` | Pesquisar por descrição | text |  |

**Tabela** (N. Registros: 1) — linhas na amostra: 1

- Colunas: Código | Descrição | Tipo | Área (cm) | Ativo | Área | Módulo | Curral | Ação
- Ações por linha: Editar, Excluir
- Links por linha: `/admin/troughs/{id}/edit`

## SCR-060 · Lotes de Animais

- **Rota:** `/admin/batches`
- **Módulo:** Cadastros Base > Pecuários > Lotes Animais
- **Tipo:** Listagem
- **Finalidade:** Lotes Animais (listagem)
- **Botões/Ações (cabeçalho):** Importar → `#` (modal #modalImport); Adicionar Novo → `/admin/batches/create`
- **Modais:** Importar

**Filtros (GET)** — botões: Filtrar

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `search` | Pesquisar por descrição | text |  |

**Tabela** (N. Registros: 0 | Total de Animais: 0) — linhas na amostra: 1

- Colunas: Código | Descrição | Total de Animais | Status | Ação

**Formulário POST `/admin/batches/import`** (modal modalImport) — botões: Importar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `file` |  | file | R |  |  |  |

## SCR-061 · Lote/Módulo

- **Rota:** `/admin/batch-grazing`
- **Módulo:** Cadastros Base > Pecuários > Lote/Módulo
- **Tipo:** Listagem
- **Finalidade:** Lote/Módulo (listagem)
- **Botões/Ações (cabeçalho):** Adicionar Novo → `/admin/batch-grazing/create`

**Filtros (GET)** — botões: Filtrar

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `batch_id` | Lote | select |  |
| `grazing_id` | Módulo | select |  |

**Tabela** (N. Registros: 0) — linhas na amostra: 1

- Colunas: Código | Módulo | QTD. Animais | QTD. UA | Hectares | Ação

## SCR-062 · Lote/Área

- **Rota:** `/admin/batch-area`
- **Módulo:** Cadastros Base > Pecuários > Lote/Área
- **Tipo:** Listagem
- **Finalidade:** Lote/Área (listagem)
- **Botões/Ações (cabeçalho):** Adicionar Novo → `/admin/batch-area/create`

**Filtros (GET)** — botões: Filtrar

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `batch_id` | Lote | select |  |
| `area_id` | Área | select | 01, 02, 03, 04, 05, 06, 07, 08 … (10) |

**Tabela** (N. Registros: 0) — linhas na amostra: 1

- Colunas: Código | Área | QTD. Animais | QTD. UA | Hectares | Ação

## SCR-063 · Inventário

- **Rota:** `/admin/equipments`
- **Módulo:** Cadastros Base > Bens/Ativos > Inventário
- **Tipo:** Listagem
- **Finalidade:** Inventário (listagem)
- **Botões/Ações (cabeçalho):** Saiba +; Importar → `#` (modal #modalImport); Exportar → `/admin/equipments/export`; Adicionar Novo → `/admin/equipments/create`
- **Modais:** Importar

**Filtros (GET)** — botões: Filtrar

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `search` | Bens/Ativos | text |  |
| `family` | Família | select | Construções e Instalações, Culturas Perenes, Equipamentos Agrícolas, Imóveis Rurais e Urbanos, Implementos Agrícolas, Máquinas Agrícolas, Móveis e Equipamentos, Veículos Automotores |
| `start_date` | Dt. Início | text (data) |  |
| `end_date` | Dt. Fim | text (data) |  |
| `proprietary` | Proprietário Gestor | select | (lista dinâmica de cadastro — 1 registros; valores omitidos por privacidade) |
| `equipment_type` | Tipo | select | Próprio, Terceirizado |

**Tabela** (N. Registros: 0) — linhas na amostra: 1

- Colunas: Código | Bem imobilizado | Família | Patrimônio | Status | Dt. Criação | Ação

**Formulário POST `/admin/equipments/import`** (modal modalImport) — botões: Importar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `file` |  | file | R |  |  |  |

## SCR-064 · Depreciação Mensal

- **Rota:** `/admin/depreciations`
- **Módulo:** Cadastros Base > Bens/Ativos > Depreciação Mensal
- **Tipo:** Listagem
- **Finalidade:** Depreciação Mensal (listagem)
- **Botões/Ações (cabeçalho):** Safra (modal #updateDepreciationHarvestModal); Saiba +
- **Modais:** Gerar Depreciação; Safra

**Filtros (GET)** — botões: Filtrar

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `equipment` | Bem imobilizado | select |  |
| `year` | Ano | select | 2026, 2025, 2024, 2023, 2022, 2021, 2020, 2019 … (17) |
| `month` | Mês | select | Janeiro, Fevereiro, Março, Abril, Maio, Junho, Julho, Agosto … (12) |
| `harvest` | Safra | select | Safra 1, TESTE, Safra 2024/2025, Safra 2023/2024, Safra 2023/2024 |

**Filtros (GET)** — botões: Gerar

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `year` | Ano | select | 2026, 2025, 2024, 2023, 2022, 2021, 2020, 2019 … (17) |
| `month` | Mês | select | Janeiro, Fevereiro, Março, Abril, Maio, Junho, Julho, Agosto … (12) |

**Tabela** (N. Registros: 0) — linhas na amostra: 1

- Colunas: (seleção) | Bem imobilizado | Dt. Ativação | Vl.p/depreciar | Dt. Processamento | Mês | Ano | Safra | Vl. Dep. Mês | Sd. á Depreciar

**Formulário POST `/admin/depreciations`** (modal updateDepreciationHarvestModal) — botões: Salvar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `harvest_id` | Safra | select |  |  | Nenhuma, Safra 1, TESTE, Safra 2024/2025, Safra 2023/2024, Safra 2023/2024 |  |

## SCR-065 · Previsão de Depreciação

- **Rota:** `/admin/depreciation-forecast`
- **Módulo:** Cadastros Base > Bens/Ativos > Prev. Depreciação
- **Tipo:** Página
- **Finalidade:** Prev. Depreciação (página)

**Filtros (GET)** — botões: Filtrar

| Campo | Label | Tipo | Opções |
|---|---|---|---|
| `equipment_id` | Bem imobilizado | select |  |
| `forecast_time` | Tempo de Previsão | select | 3 meses, 6 meses, 9 meses, 12 meses, 15 meses, 18 meses, 21 meses, 24 meses … (16) |

## SCR-066 · Fiscais

- **Rota:** `/admin/tenant-parameters`
- **Módulo:** Cadastros Base > Gerais > Parametrizações
- **Tipo:** Formulário
- **Finalidade:** Parametrizações (formulário)

**Formulário PUT `/admin/tenant-parameters`** — botões: Salvar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `parameters[calc_icms_desonerado]` | Cálculo e dedução de ICMS desonerado | select | R |  | Sim, Não |  |
| `parameters[financial_freeze_scope]` | Abrangência do congelamento financeiro | select | R |  | Por contratante (todas as fazendas), Por fazenda |  |

## SCR-266 · Funcionários

- **Rota:** `/admin/employees/report`
- **Módulo:** Cadastros Base > Pessoas > Funcionários
- **Tipo:** Relatório
- **Finalidade:** Funcionários (relatório)
- **Cards/Seções:** 

## SCR-267 · Funcionários

- **Rota:** `/admin/employees/create`
- **Módulo:** Cadastros Base > Pessoas > Funcionários
- **Tipo:** Cadastro (novo)
- **Finalidade:** Funcionários (cadastro (novo))
- **Botões/Ações (cabeçalho):** Voltar → `/admin/employees`

**Formulário POST `/admin/employees`** — botões: Salvar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `nif` | CPF | text | R |  |  |  |
| `name` | Nome | text | R | 70 |  |  |
| `email` | Email | email |  |  |  |  |
| `phone` | Telefone | text |  |  |  |  |
| `office` | Cargo | text |  |  |  |  |
| `commission` | Comissão(%) | text |  |  |  |  |
| `address` | Endereço | text | R |  |  |  |
| `city_id` | Cidade | select | R |  |  |  |
| `vl_time_productive` | Vl. Hora | text (moeda) |  |  |  |  |
| `base_salary` | Salário Base | text (moeda) |  |  |  |  |
| `goal_salary` | Salário Meta | text (moeda) |  |  |  |  |
| `function_id` | Função | select | R |  | AJUDANDE DE CONZINHA, AJUDANTE GERAL, ANALISTA ADMINISTRATIVO GERAL, ANALISTA ADMINISTRATIVO PLENO, ANALISTA ADMINISTRATIVO SÊNIOR, ANALISTA DE COMPRAS, ANALISTA DE RH PLENO, ANALISTA DEPARTAMENTO DE PESSOAL … (208) |  |
| `center_id` | Centro de Custo | select |  |  | Administração, Estoque Insumos, Estoque Produção, Parque Máquinas, Soja, Soja Precoce, Soja Super Precoce, Terminação - Corte |  |
| `birthday` | Dt. Nascimento | text (data) | R |  |  |  |
| `is_enabled` | Ativo | select | R |  | Sim, Não |  |
| `create_user` | Criar Usuário | select | R |  | (lista dinâmica de cadastro — 2 registros; valores omitidos por privacidade) |  |
| `role` | Perfil de Usuário | select |  |  | (lista dinâmica de cadastro — 5 registros; valores omitidos por privacidade) |  |
| `bank_id` | Banco | select |  |  | 001-Banco do Brasil S.A., 003-Banco da Amazônia S.A., 004-Banco do Nordeste do Brasil S.A., 007-Banco Nacional de Desenvolvimento Econômico e Social - BNDES, 010-CREDICOAMO Crédito Rural Cooperativa, 011-Credit Suisse Hedging-Griffo Corretora de Valores S.A., 012-Banco Inbursa S.A., 014-Natixis Brasil S.A. Banco Múltiplo … (168) |  |
| `account_type` | Tipo | select |  |  | Corrente, Poupança |  |
| `agency` | Agência | text |  | 13 |  |  |
| `account` | Conta | text |  | 18 |  |  |
| `pix_type` | Tipo chave Pix | select |  |  | CPF/CNPJ, Telefone, Email, Aleatória |  |
| `pix` | Pix | text |  |  |  |  |

## SCR-268 · Funcionários

- **Rota:** `/admin/employees/2658`
- **Módulo:** Cadastros Base > Pessoas > Funcionários
- **Tipo:** Detalhe
- **Finalidade:** Funcionários (detalhe)
- **Botões/Ações (cabeçalho):** Voltar → `/admin/employees`

## SCR-269 · Funcionários

- **Rota:** `/admin/employees/2658/edit`
- **Módulo:** Cadastros Base > Pessoas > Funcionários
- **Tipo:** Cadastro (edição)
- **Finalidade:** Funcionários (cadastro (edição))
- **Botões/Ações (cabeçalho):** Voltar → `/admin/employees`

**Formulário PUT `/admin/employees/2658`** — botões: Salvar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `nif` | CPF | text | R |  |  |  |
| `name` | Nome | text | R | 70 |  |  |
| `email` | Email | email |  |  |  |  |
| `phone` | Telefone | text |  |  |  |  |
| `office` | Cargo | text |  |  |  |  |
| `commission` | Comissão(%) | text |  |  |  |  |
| `address` | Endereço | text | R |  |  |  |
| `city_id` | Cidade | select | R |  | Itamaraju - BA |  |
| `vl_time_productive` | Vl. Hora | text (moeda) |  |  |  |  |
| `base_salary` | Salário Base | text (moeda) |  |  |  |  |
| `goal_salary` | Salário Meta | text (moeda) |  |  |  |  |
| `function_id` | Função | select | R |  | AJUDANDE DE CONZINHA, AJUDANTE GERAL, ANALISTA ADMINISTRATIVO GERAL, ANALISTA ADMINISTRATIVO PLENO, ANALISTA ADMINISTRATIVO SÊNIOR, ANALISTA DE COMPRAS, ANALISTA DE RH PLENO, ANALISTA DEPARTAMENTO DE PESSOAL … (208) |  |
| `center_id` | Centro de Custo | select |  |  | Administração, Estoque Insumos, Estoque Produção, Parque Máquinas, Soja, Soja Precoce, Soja Super Precoce, Terminação - Corte |  |
| `birthday` | Dt. Nascimento | text (data) | R |  |  |  |
| `is_enabled` | Ativo | select | R |  | Sim, Não |  |
| `bank_id` | Banco | select |  |  | 001-Banco do Brasil S.A., 003-Banco da Amazônia S.A., 004-Banco do Nordeste do Brasil S.A., 007-Banco Nacional de Desenvolvimento Econômico e Social - BNDES, 010-CREDICOAMO Crédito Rural Cooperativa, 011-Credit Suisse Hedging-Griffo Corretora de Valores S.A., 012-Banco Inbursa S.A., 014-Natixis Brasil S.A. Banco Múltiplo … (168) |  |
| `account_type` | Tipo | select |  |  | Corrente, Poupança |  |
| `agency` | Agência | text |  | 13 |  |  |
| `account` | Conta | text |  | 18 |  |  |
| `pix_type` | Tipo chave Pix | select |  |  | CPF/CNPJ, Telefone, Email, Aleatória |  |
| `pix` | Pix | text |  |  |  |  |

## SCR-270 · Você já atingiu o limite de usuários. Contate o Administrador.

- **Rota:** `/admin/users/create`
- **Módulo:** Cadastros Base > Pessoas > Usuários
- **Tipo:** Cadastro (novo)
- **Finalidade:** Usuários (cadastro (novo))
- **Acesso:** restrito para o usuário auditado ("Acesso Restrito!")

## SCR-271 · Usuários

- **Rota:** `/admin/users/1086`
- **Módulo:** Cadastros Base > Pessoas > Usuários
- **Tipo:** Detalhe
- **Finalidade:** Usuários (detalhe)
- **Botões/Ações (cabeçalho):** Voltar → `/admin/users`

## SCR-272 · Usuários

- **Rota:** `/admin/users/1086/edit`
- **Módulo:** Cadastros Base > Pessoas > Usuários
- **Tipo:** Cadastro (edição)
- **Finalidade:** Usuários (cadastro (edição))
- **Botões/Ações (cabeçalho):** Voltar → `/admin/users`

**Formulário PUT `/admin/users/1086`** — botões: Salvar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `nif` | CPF/CNPJ | text | R |  |  |  |
| `name` | Nome | text | R | 70 |  |  |
| `email` | Email | email | R |  |  |  |
| `phone` | Telefone | text | R |  |  |  |
| `city_id` | Cidade | select | R |  | Gurupi - TO |  |
| `address` | Endereço | text | R |  |  |  |
| `is_active` | Ativo | select | R |  | Sim, Não |  |
| `is_purchasing_assistant` | Conferente de Compras? | select | R |  | Não, Sim | Se marcado como "Sim", este usuário passa a ser o responsável por conferir/finalizar as solicitações de compra autorizadas na fazenda em que atua. |
| `roles[]` | Perfil de Usuário | select (múltiplo) | R |  | (lista dinâmica de cadastro — 5 registros; valores omitidos por privacidade) |  |
| `farms[]` | Fazendas | select (múltiplo) |  |  | Fazenda Maira, Fazenda São Paulo |  |
| `bosses[]` | Encarregados | select (múltiplo) |  |  | (lista dinâmica de cadastro — 3 registros; valores omitidos por privacidade) | Usuários responsáveis por autorizar as solicitações de compra deste usuário. Ao enviar uma solicitação para autorização, apenas os autorizadores cadastrados aqu |

## SCR-290 · Centro de custo

- **Rota:** `/admin/costcenters/2`
- **Módulo:** Cadastros Base > Estrutura > Centros de Custo
- **Tipo:** Detalhe
- **Finalidade:** Centros de Custo (detalhe)
- **Botões/Ações (cabeçalho):** Voltar → `/admin/costcenters`

## SCR-291 · Centro de Custo

- **Rota:** `/admin/costcenters/1317/edit`
- **Módulo:** Cadastros Base > Estrutura > Centros de Custo
- **Tipo:** Cadastro (edição)
- **Finalidade:** Centros de Custo (cadastro (edição))
- **Botões/Ações (cabeçalho):** Voltar → `/admin/costcenters`

**Formulário PUT `/admin/costcenters/1317`** — botões: Salvar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `condition` | Condição Normal | select | R |  | Despesa, Receita, Ambos |  |
| `description` | Descrição | text | R | 40 |  |  |
| `is_enabled` | Ativo | select | R |  | Sim, Não |  |
| `allow_pointing` | Apontamento | select | R |  | Sim, Não |  |
| `type` | Tipo | select | R |  | Produtivo, Rateado |  |
| `parent_id` | Antecessor | select |  |  | Não Contém, 1.01 - Administração |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |

## SCR-292 · Fazenda

- **Rota:** `/admin/farms/create`
- **Módulo:** Cadastros Base > Estrutura > Fazendas
- **Tipo:** Cadastro (novo)
- **Finalidade:** Fazendas (cadastro (novo))
- **Botões/Ações (cabeçalho):** Importar arquivo KML (modal #modalImportKml); Voltar → `/admin/farms`
- **Modais:** Importar arquivo KML

**Tabela** — linhas na amostra: 6

- Colunas: # | Código | Classe | Condição | Descrição

**Formulário POST `/admin/farms`** — botões: Salvar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `description` | Nome | text | R | 80 |  |  |
| `nif` | CPF/CNPJ | tel |  |  |  |  |
| `phone` | Telefone | text | R |  |  |  |
| `state_registration` | Insc. Estadual | text |  | 14 |  |  |
| `car` | CAR | text |  | 50 |  |  |
| `exploration_type` | Tipo de Exploração do Imóvel: | select | R |  | Exploração individual (Imóvel próprio), Condomínio, Imóvel arrendado, Parceria, Comodato, Outros |  |
| `nirf` | NIRF | text | R | 14 |  |  |
| `ccir` | CCIR | text | R | 14 |  |  |
| `cafir` | CAFIR | text | R | 8 |  |  |
| `caepf` | CAEPF | text | R | 14 |  |  |
| `image` |  | file |  |  |  |  |
| `country_id` | Pais | select | R |  | Bermudas Sim, Afeganistão, África do Sul, Albânia, República da, Alemanha, Andorra Sim, Angola, Anguilla Sim … (245) |  |
| `zip_code` | CEP | text | R |  |  |  |
| `city_id` | Cidade | select | R |  |  |  |
| `descriptive` | Local/Endereço | text | R | 80 |  |  |
| `number` | Número | text |  |  |  |  |
| `district` | Bairro | text | R |  |  |  |
| `latitude_longitude` | Latitude/Longitude | text |  |  |  |  |
| `coin` | Moeda | select | R |  | Real |  |
| `total_area` | Área Total (ha) | text (moeda) | R |  |  |  |
| `value_ha` | Vl. ha (terra nua) | text (moeda) | R |  |  |  |
| `rate` | Tx. Rem. Capital (%)/Ano | text | R |  |  |  |
| `is_enabled` | Ativo | select | R |  | Sim, Não |  |
| `use_cash_book` | Usa no Livro Caixa | select | R |  | Sim, Não | Se a fazenda será utilizada para o Livro Caixa, marque esta opção como "Sim". Fazendas marcadas como "Não" não aparecerão nas movimentações do Livro Caixa. |
| `has_simplified_purchase_flow` | Fluxo Simplificado de Suprimentos | select | R |  | Sim, Não | Se marcado como "Sim", solicitações de suprimentos desta fazenda pulam a etapa de "Aguardando Ciência" (encarregado), indicado para fazendas com quantidade limi |
| `note` | Observação | textarea |  |  |  |  |
| `centers[]` |  | checkbox |  |  |  |  |
| `centers[]` |  | checkbox |  |  |  |  |
| `centers[]` |  | checkbox |  |  |  |  |
| `centers[]` |  | checkbox |  |  |  |  |
| `centers[]` |  | checkbox |  |  |  |  |
| `centers[]` |  | checkbox |  |  |  |  |
| `kml_file` |  | file |  |  |  |  |

- Mensagens/alertas: ATENÇÃO: Para cadastrar a fazenda, crie o perimetro no mapa e, em seguida, informe os campos do cadastro.

## SCR-293 · Fazendas

- **Rota:** `/admin/farms/80`
- **Módulo:** Cadastros Base > Estrutura > Fazendas
- **Tipo:** Detalhe
- **Finalidade:** Fazendas (detalhe)
- **Botões/Ações (cabeçalho):** Exportar KML → `/admin/farms/80/kml-export`; Imprimir mapa → `/admin/farms/80/map-print`; Voltar → `/admin/farms`

**Tabela** — linhas na amostra: 6

- Colunas: Código | Classe | Condição | Descrição

## SCR-294 · Fazenda

- **Rota:** `/admin/farms/80/edit`
- **Módulo:** Cadastros Base > Estrutura > Fazendas
- **Tipo:** Cadastro (edição)
- **Finalidade:** Fazendas (cadastro (edição))
- **Botões/Ações (cabeçalho):** Importar arquivo KML (modal #modalImportKml); Voltar → `/admin/farms`
- **Modais:** Importar arquivo KML

**Tabela** — linhas na amostra: 6

- Colunas: # | Código | Classe | Condição | Descrição

**Formulário PUT `/admin/farms/80`** — botões: Salvar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `description` | Nome | text | R | 80 |  |  |
| `nif` | CPF/CNPJ | tel |  |  |  |  |
| `phone` | Telefone | text | R |  |  |  |
| `state_registration` | Insc. Estadual | text |  | 14 |  |  |
| `car` | CAR | text |  | 50 |  |  |
| `exploration_type` | Tipo de Exploração do Imóvel: | select | R |  | Exploração individual (Imóvel próprio), Condomínio, Imóvel arrendado, Parceria, Comodato, Outros |  |
| `nirf` | NIRF | text | R | 14 |  |  |
| `ccir` | CCIR | text | R | 14 |  |  |
| `cafir` | CAFIR | text | R | 8 |  |  |
| `caepf` | CAEPF | text | R | 14 |  |  |
| `image` |  | file |  |  |  |  |
| `country_id` | Pais | select | R |  | Bermudas Sim, Afeganistão, África do Sul, Albânia, República da, Alemanha, Andorra Sim, Angola, Anguilla Sim … (245) |  |
| `zip_code` | CEP | text | R |  |  |  |
| `city_id` | Cidade | select | R |  | Porto Nacional - TO |  |
| `descriptive` | Local/Endereço | text | R | 80 |  |  |
| `number` | Número | text |  |  |  |  |
| `district` | Bairro | text | R |  |  |  |
| `latitude_longitude` | Latitude/Longitude | text |  |  |  |  |
| `coin` | Moeda | select | R |  | Real |  |
| `total_area` | Área Total (ha) | text (moeda) | R |  |  |  |
| `value_ha` | Vl. ha (terra nua) | text (moeda) | R |  |  |  |
| `rate` | Tx. Rem. Capital (%)/Ano | text | R |  |  |  |
| `is_enabled` | Ativo | select | R |  | Sim, Não |  |
| `use_cash_book` | Usa no Livro Caixa | select | R |  | Sim, Não | Se a fazenda será utilizada para o Livro Caixa, marque esta opção como "Sim". Fazendas marcadas como "Não" não aparecerão nas movimentações do Livro Caixa. |
| `has_simplified_purchase_flow` | Fluxo Simplificado de Suprimentos | select | R |  | Sim, Não | Se marcado como "Sim", solicitações de suprimentos desta fazenda pulam a etapa de "Aguardando Ciência" (encarregado), indicado para fazendas com quantidade limi |
| `note` | Observação | textarea |  |  |  |  |
| `centers[]` |  | checkbox |  |  |  |  |
| `centers[]` |  | checkbox |  |  |  |  |
| `centers[]` |  | checkbox |  |  |  |  |
| `centers[]` |  | checkbox |  |  |  |  |
| `centers[]` |  | checkbox |  |  |  |  |
| `centers[]` |  | checkbox |  |  |  |  |
| `kml_file` |  | file |  |  |  |  |

- Mensagens/alertas: ATENÇÃO: Para cadastrar a fazenda, crie o perimetro no mapa e, em seguida, informe os campos do cadastro.

## SCR-295 · Safras

- **Rota:** `/admin/harvests/create`
- **Módulo:** Cadastros Base > Estrutura > Safras
- **Tipo:** Cadastro (novo)
- **Finalidade:** Safras (cadastro (novo))
- **Botões/Ações (cabeçalho):** Voltar → `/admin/harvests`

**Formulário POST `/admin/harvests`** — botões: Salvar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `description` | Descrição | text | R | 100 |  |  |
| `is_enabled` | Ativo | select | R |  | Sim, Não |  |
| `start_date` | Dt. Início | text (data) | R |  |  |  |
| `end_date` | Dt. Fim | text (data) | R |  |  |  |
| `herd_control` | Controle de Rebanho | select | R |  | Individual |  |
| `auto_evolution` | Evolução de Rebanho | select | R |  | Habilitado, Desabilitado |  |
| `first_month` | Primeiro Semestre | select | R |  | Janeiro, Fevereiro, Março, Abril, Maio, Junho |  |
| `second_month` | Segundo Semestre | select | R |  | Julho, Agosto, Setembro, Outubro, Novembro, Dezembro |  |

## SCR-296 · Safras

- **Rota:** `/admin/harvests/425`
- **Módulo:** Cadastros Base > Estrutura > Safras
- **Tipo:** Detalhe
- **Finalidade:** Safras (detalhe)
- **Botões/Ações (cabeçalho):** Voltar → `/admin/harvests`

**Tabela** — linhas na amostra: 26

- Colunas: Semana | Cor | 1º dia | 7º dia

**Tabela** — linhas na amostra: 26

- Colunas: Semana | Cor | 1º dia | 7º dia

## SCR-297 · Safras

- **Rota:** `/admin/harvests/425/edit`
- **Módulo:** Cadastros Base > Estrutura > Safras
- **Tipo:** Cadastro (edição)
- **Finalidade:** Safras (cadastro (edição))
- **Botões/Ações (cabeçalho):** Voltar → `/admin/harvests`

**Formulário PUT `/admin/harvests/425`** — botões: Salvar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `description` | Descrição | text | R | 100 |  |  |
| `is_enabled` | Ativo | select | R |  | Sim, Não |  |
| `start_date` | Dt. Início | text (data) | R |  |  |  |
| `end_date` | Dt. Fim | text (data) | R |  |  |  |
| `herd_control` | Controle de Rebanho | select | R |  | Individual |  |
| `auto_evolution` | Evolução de Rebanho | select | R |  | Habilitado, Desabilitado |  |
| `first_month` | Primeiro Semestre | select | R |  | Janeiro, Fevereiro, Março, Abril, Maio, Junho |  |
| `second_month` | Segundo Semestre | select | R |  | Julho, Agosto, Setembro, Outubro, Novembro, Dezembro |  |

## SCR-298 · Endereçamento - Setor

- **Rota:** `/admin/addressings/create`
- **Módulo:** Cadastros Base > Estrutura > Produtos > Endereçamentos
- **Tipo:** Cadastro (novo)
- **Finalidade:** Endereçamentos (cadastro (novo))
- **Botões/Ações (cabeçalho):** Voltar → `/admin/addressings`

**Formulário POST `/admin/addressings`** — botões: Salvar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `description` | Descrição | text | R | 100 |  |  |
| `parent_id` | Endereçamento Pai | select |  |  |  |  |

## SCR-299 · Endereçamento - Setor

- **Rota:** `/admin/addressings/1`
- **Módulo:** Cadastros Base > Estrutura > Produtos > Endereçamentos
- **Tipo:** Detalhe
- **Finalidade:** Endereçamentos (detalhe)
- **Botões/Ações (cabeçalho):** Voltar → `/admin/warehouses`

## SCR-300 · Endereçamento - Setor

- **Rota:** `/admin/addressings/1/edit`
- **Módulo:** Cadastros Base > Estrutura > Produtos > Endereçamentos
- **Tipo:** Cadastro (edição)
- **Finalidade:** Endereçamentos (cadastro (edição))
- **Botões/Ações (cabeçalho):** Voltar → `/admin/addressings`

**Formulário PUT `/admin/addressings/1`** — botões: Salvar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `description` | Descrição | text | R | 100 |  |  |
| `parent_id` | Endereçamento Pai | select |  |  |  |  |

## SCR-301 · Produtos

- **Rota:** `/admin/products/report`
- **Módulo:** Cadastros Base > Estrutura > Produtos > Produtos
- **Tipo:** Relatório
- **Finalidade:** Produtos (relatório)
- **Cards/Seções:** 

## SCR-302 · Produtos

- **Rota:** `/admin/products/create`
- **Módulo:** Cadastros Base > Estrutura > Produtos > Produtos
- **Tipo:** Cadastro (novo)
- **Finalidade:** Produtos (cadastro (novo))
- **Abas:** Embalagens
- **Botões/Ações (cabeçalho):** Voltar → `/admin/products`

**Formulário POST `/admin/products`** — botões: Salvar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `description` | Descrição | text | R | 120 |  | Nome do produto que está sendo cadastrado |
| `ncm_id` | Ncm | select |  |  |  | NCM (Nomenclatura Comum do Mercosul): código utilizado para classificar o produto conforme a tabela do Mercosul. \n \n Essencial para emissão de notas fiscais e |
| `measurement_id` | 1ª. Un.Medida | select | R |  | @, %, °C, °F, 1000 un, 1000UN, BAG, Balde … (59) |  |
| `second_measurement_id` | 2ª. Un.Medida | select |  |  | @, %, °C, °F, 1000 un, 1000UN, BAG, Balde … (59) |  |
| `factor_type` | Tipo | select |  |  | Multiplica, Divide | Quando converte de uma unidade maior para uma menor, você multiplica pelo fator de conversão. \n Quando converte de uma unidade menor para uma maior, você divid |
| `factor` | Fator conversão | text (moeda) |  |  |  | Fator usado para fazer a conversão do campo anterior |
| `group_id` | Grupo | select | R |  | Insumos Agrícola, Insumos Gerais, Insumos Industrialização, Insumos Pecuária, Máquinas/Equipamentos/Veículos, Produção, Produtos Exportação |  |
| `category_id` | Categoria | select | R |  |  |  |
| `kind_id` | Classe | select | R |  |  |  |
| `cultivation_id` | Variedade | select |  |  | Soja - 1823, Soja - Bonus, Soja - Bonus, CANA DE AÇUCAR - ERLAM - CANA DE AÇUCAR, Soja - Extrema, Soja - Monsoy 8606, PLANTAÇÃO DE MORANGO - ERLAM - MORANGO DE MESA, Banana - Nanica … (14) |  |
| `quality` | Qualidade | select |  |  | 1 |  |
| `has_lot` | Cont. Lote | select |  |  | Sim, Não | Indica que o produto possui data de validade \n \n Ao ativar, o sistema controlará os lotes e alertará sobre vencimentos próximos |
| `control_stock` | Controla Estoque | select | R |  | Sim, Não | Permite gerenciar o produto no estoque e faz o cálculo do preço médio do produto automaticamente |
| `min_stock` | Estoque minimo | text (moeda) |  |  |  | Quantidade mínima desejada em estoque \n \n O sistema emitirá um alerta quando o estoque atingir ou ficar abaixo desse valor \n \n Caso não queira ter um estoqu |
| `last_purchase_date` | Dt. Ult. Compra | date |  |  |  |  |
| `average_cost` | Pc. Médio | text (moeda) |  |  |  |  |
| `las_price` | Vl. Referência | text (moeda) | R |  |  | Valor de mercado do produto que está sendo cadastrado. \n \n Exemplo: 1 Un de Pá Tramontina → R$ 45,00 |
| `is_enabled` | Ativo | select | R |  | Sim, Não |  |
| `allow_pointing` | Apontamento | select | R |  | Não, Sim | Se marcado como sim, permite que o produto seja utilizado na aba de apontamentos |
| `financial_category_id` | Cat. Financeira - Custo | select |  |  | 2.01.001.0001 - Energia Elétrica, 2.01.001.0002 - Telefone/Internet, 2.01.001.0003 - Aluguéis, 2.01.001.0004 - Água/Esgoto, 2.01.001.0005 - Brindes/Cortesias, 2.01.001.0006 - Viagens/Diárias, 2.01.001.0007 - Treinamento Mão de Obra, 2.01.001.0008 - Softwares … (209) | Categoria financeira utilizada para classificação de custos de produção. Obrigatório quando o produto controla estoque. |
| `default_cost_center_id` | Centro de Custo Padrão | select |  |  | Administração, Estoque Insumos, Estoque Produção, Parque Máquinas, Soja, Soja Precoce, Soja Super Precoce, Terminação - Corte |  |
| `default_warehouse_id` | Armazém Padrão | select |  |  | BARRACAO |  |
| `active_principle` | Princípio Ativo | text |  | 50 |  |  |
| `withdrawal_period_days` | Período de Carência (dias) | text |  |  |  | Dias que o animal deve aguardar após receber este produto antes de ser vendido/abatido, devido a resíduos químicos. |
| `is_equipment` | Adiciona ao Inventário | select | R |  | Sim, Não | Cadastra produto automaticamente no inventário da fazenda |
| `addressing_id` | Endereçamento | select |  |  | Setor 01, — Corredor 01, — — Prateleira A, — — — Nível 01, — — — Nível 02, Setor 2, — Corredor 2A, — — Prateleira A |  |
| `is_fiscal` | Emitir NFe. | select | R |  | Não, Sim |  |
| `tax_rule_id` | Regra Fiscal | select |  |  |  |  |
| `cfop_saida_interno` | CFOP Saída Interno | text |  |  |  |  |
| `cfop_saida_externo` | CFOP Saída Externo | text |  |  |  |  |
| `cbenef` | Código de Benefício Fiscal | text |  |  |  |  |
| `cst_csosn` | CST/CSOSN Padrão | select | R |  | 00 - Tributa integralmente, 10 - Tributada e com cobrança do ICMS por substituição tributária, 20 - Com redução da Base de Calculo, 30 - Isenta / não tributada e com cobrança do ICMS por substituição tributária, 40 - Isenta, 41 - Não tributada, 50 - Com suspensão, 51 - Com diferimento … (21) |  |
| `cst_pis` | CST/COFINS Padrão | select | R |  | 01 - Operação Tributável - Base de Cálculo = Valor da Operação Alíquota Normal (Cumulativo/Não Cumulativo), 02 - Operação Tributável - Base de Calculo = Valor da Operação (Alíquota Diferenciada), 03 - Operação Tributável - Base de Calculo = Quantidade Vendida x Alíquota por Unidade de Produto;, 04 - Operação Tributável - Tributação Monofásica - (Alíquota Zero);, 06 - Operação Tributável - Alíquota Zero;, 07 - Operação Isenta da contribuição;, 08 - Operação Sem Incidência da contribuição;, 09 - Operação com suspensão da contribuição; … (32) |  |
| `cst_cofins` | CST/PIS | select | R |  | 01 - Operação Tributável - Base de Cálculo = Valor da Operação Alíquota Normal (Cumulativo/Não Cumulativo), 02 - Operação Tributável - Base de Calculo = Valor da Operação (Alíquota Diferenciada), 03 - Operação Tributável - Base de Calculo = Quantidade Vendida x Alíquota por Unidade de Produto;, 04 - Operação Tributável - Tributação Monofásica - (Alíquota Zero);, 06 - Operação Tributável - Alíquota Zero;, 07 - Operação Isenta da contribuição;, 08 - Operação Sem Incidência da contribuição;, 09 - Operação com suspensão da contribuição; … (32) |  |
| `cst_ipi` | CST/IPI | select | R |  | 00 - Entrada com Recuperação de Crédito, 01 - Entrada Tributável com Alíquota Zero, 02 - Entrada Isenta, 03 - Entrada Não Tributada, 04 - Entrada Imune, 05 - Entrada com Suspensão, 49 - Outras Operações de Entrada, 50 - Saída Tributada … (14) |  |
| `cenq_ipi` | Código Enquadramento IPI | select | R |  | 001 - Imunidade - Livros, jornais, periódicos e o papel destinado à sua impressão - Art. 18 Inciso I do Decreto 7.212/2010, 002 - Imunidade - Produtos industrializados destinados ao exterior - Art. 18 Inciso II do Decreto 7.212/2010, 003 - Imunidade - Ouro, definido em lei como ativo financeiro ou instrumento cambial - Art. 18 Inciso III do Decreto 7.212/2010, 004 - Imunidade - Energia elétrica, derivados de petróleo, combustíveis e minerais do País - Art. 18 Inciso IV do Decreto 7.212/2010, 005 - Imunidade - Exportação de produtos nacionais - sem saída do território brasileiro - venda para empresa sediada no exterior - atividades de pesquisa ou lavra de jazidas de petróleo e de gás natural- Art. 19 Inciso I do Decreto 7.212/2010, 006 - Imunidade - Exportação de produtos nacionais - sem saída do território brasileiro - venda para empresa sediada no exterior - incorporados a produto final exportado para o Brasil - Art. 19 Inciso II do Decreto 7.212/2010, 007 - Imunidade - Exportação de produtos nacionais - sem saída do território brasileiro - venda para órgão ou entidade de governo estrangeiro ou organismo internacional de que o Brasil seja membro,para ser entregue, no País, à ordem do comprador - Art. 19 Inciso III do Decreto 7.212/2010, 101 - Suspensão - Óleo de menta em bruto, produzido por lavradores - Art. 43 Inciso I do Decreto 7.212/2010 … (132) |  |
| `perc_icms` | %ICMS | text | R |  |  |  |
| `perc_pis` | %PIS | text | R |  |  |  |
| `perc_cofins` | %COFINS | text | R |  |  |  |
| `perc_ipi` | %IPI | text |  |  |  |  |
| `cest` | CEST | text |  | 10 |  |  |
| `barcode` | Código de barras | text |  | 13 |  |  |
| `modality_bc` | Modalidade determinação da BC do ICMS | select | R |  | 0 - Margem Valor Agregado (%), 1 - Pauta (Valor), 2 - Preço Tabelado Máx. (valor), 3 - Valor da operação |  |
| `percent_reduction` | Percentual da Redução de Base de Cálculo | text | R |  |  |  |
| `reference` | Cod. Produto | text |  | 30 |  |  |
| `origem` | Origem | select | R |  | 0 - NACIONAL, 1 - ESTRANGEIRA - IMPORTAÇÃO DIRETA, 2 - ESTRANGEIRA - ADQUIRIDA NO MERCADO INTERNO, 3 - NACIONAL, MERCADORIA OU BEM COM CONTEÚDO DE IMPORTAÇÃO SUPERIOR A 40%, 4 - NACIONAL, CUJA PRODUÇÃO TENHA SIDO FEITA EM CONFORMIDADE COM OS PROCESSOS PRODUTIVOS BÁSICOS DE QUE TRATAM O DECRETO-LEI Nº 288/67, E AS LEIS NºS 8.248/91, 8.387/91, 10.176/01 E 11 . 4 8 4 / 0 7, 5 - NACIONAL, MERCADORIA OU BEM COM CONTEÚDO DE IMPORTAÇÃO INFERIOR OU IGUAL A 40%, 6 - ESTRANGEIRA - IMPORTAÇÃO DIRETA, SEM SIMILAR NACIONAL, CONSTANTE EM LISTA DE RESOLUÇÃO CAMEX, 7 - ESTRANGEIRA - ADQUIRIDA NO MERCADO INTERNO, SEM SIMILAR NACIONAL, CONSTANTE EM LISTA DE RESOLUÇÃO CAMEX … (9) |  |
| `cst_csosn_exp` | CST/CSOSN Exportação | select |  |  | 00 - Tributa integralmente, 10 - Tributada e com cobrança do ICMS por substituição tributária, 20 - Com redução da Base de Calculo, 30 - Isenta / não tributada e com cobrança do ICMS por substituição tributária, 40 - Isenta, 41 - Não tributada, 50 - Com suspensão, 51 - Com diferimento … (21) |  |
| `c_class_trib` | Código Classificação Tributária | text |  | 6 |  | Código de 6 dígitos que classifica o produto para tributação do IBS e CBS. Consulte a tabela oficial da Receita Federal. |
| `cst_ibs_cbs` | CST IBS/CBS | select |  |  | 000 - Tributação integral, 010 - Tributação com alíquotas uniformes, 011 - Tributação com alíquotas uniformes reduzidas, 200 - Alíquota reduzida, 220 - Alíquota fixa, 221 - Alíquota fixa proporcional, 222 - Redução de Base de Cálculo, 400 - Isenção … (18) | Código de Situação Tributária para IBS e CBS |
| `perc_ibs_uf` | % IBS UF (Estadual) | text |  |  |  | Alíquota do IBS de competência estadual. Ex: 17,50 |
| `perc_ibs_mun` | % IBS Município (Municipal) | text |  |  |  | Alíquota do IBS de competência municipal. Ex: 2,50 |
| `perc_reducao_aliq_ibs_uf` | % Redução Alíq. IBS UF | text |  |  |  | Percentual de redução da alíquota do IBS UF |
| `perc_reducao_aliq_ibs_mun` | % Redução Alíq. IBS Mun | text |  |  |  | Percentual de redução da alíquota do IBS Municipal |
| `perc_dif_ibs_uf` | % Diferimento IBS UF | text |  |  |  | Percentual do diferimento do IBS estadual (postergação do pagamento) |
| `perc_dif_ibs_mun` | % Diferimento IBS Município | text |  |  |  | Percentual do diferimento do IBS municipal (postergação do pagamento) |
| `perc_cbs` | % CBS (Federal) | text |  |  |  | Alíquota da CBS (substitui PIS e COFINS). Ex: 9,25 |
| `perc_reducao_aliq_cbs` | % Redução Alíquota CBS | text |  |  |  | Percentual de redução da alíquota CBS |
| `perc_dif_cbs` | % Diferimento CBS | text |  |  |  | Percentual do diferimento da CBS (postergação do pagamento) |
| `cst_is` | CST IS | text |  | 3 |  | Código de Situação Tributária do Imposto Seletivo (3 dígitos) |
| `perc_is` | % Imposto Seletivo | text |  |  |  | Alíquota do Imposto Seletivo em percentual |
| `perc_is_espec` | Alíq. Específica IS (R$) | text (moeda) |  |  |  | Alíquota específica do IS por valor unitário (ex: R$ 1,50 por litro) |
| `ad_rem_ibs` | Alíq. Ad Rem IBS (R$/un) | text (moeda) |  |  |  | Alíquota ad rem (por unidade) do IBS em operações monofásicas |
| `ad_rem_cbs` | Alíq. Ad Rem CBS (R$/un) | text (moeda) |  |  |  | Alíquota ad rem (por unidade) da CBS em operações monofásicas |
| `tp_cred_pres_ibs_zfm` | Crédito Presumido ZFM | select |  |  | Não se aplica, 0 - Sem Crédito Presumido, 1 - Bens de consumo final (55%), 2 - Bens de capital (75%), 3 - Bens intermediários (90,25%), 4 - Bens de informática e outros (100%) | Classificação para crédito presumido de IBS em operações com Zona Franca de Manaus |
| `ind_doacao` | Operação de Doação | select |  |  | Não, Sim - Operação de doação | Indica se a operação é de doação, orientando apuração de débitos/estornos |
| `package_id[]` | Embalagem | select |  |  |  |  |

## SCR-303 · Produtos

- **Rota:** `/admin/products/9036`
- **Módulo:** Cadastros Base > Estrutura > Produtos > Produtos
- **Tipo:** Detalhe
- **Finalidade:** Produtos (detalhe)
- **Botões/Ações (cabeçalho):** Voltar → `/admin/products`

## SCR-304 · Produtos

- **Rota:** `/admin/products/9036/edit`
- **Módulo:** Cadastros Base > Estrutura > Produtos > Produtos
- **Tipo:** Cadastro (edição)
- **Finalidade:** Produtos (cadastro (edição))
- **Abas:** Embalagens
- **Botões/Ações (cabeçalho):** Voltar → `/admin/products`

**Formulário PUT `/admin/products/9036`** — botões: Salvar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `description` | Descrição | text | R | 120 |  | Nome do produto que está sendo cadastrado |
| `ncm_id` | Ncm | select |  |  | 40114000 - PNEUM.D/BORRACHA P/MOTOCICLETAS,NOVOS | NCM (Nomenclatura Comum do Mercosul): código utilizado para classificar o produto conforme a tabela do Mercosul. \n \n Essencial para emissão de notas fiscais e |
| `measurement_id` | 1ª. Un.Medida | select | R |  | @, %, °C, °F, 1000 un, 1000UN, BAG, Balde … (59) |  |
| `second_measurement_id` | 2ª. Un.Medida | select |  |  | @, %, °C, °F, 1000 un, 1000UN, BAG, Balde … (59) |  |
| `factor_type` | Tipo | select |  |  | Multiplica, Divide | Quando converte de uma unidade maior para uma menor, você multiplica pelo fator de conversão. \n Quando converte de uma unidade menor para uma maior, você divid |
| `factor` | Fator conversão | text (moeda) |  |  |  | Fator usado para fazer a conversão do campo anterior |
| `group_id` | Grupo | select | R |  | Insumos Agrícola, Insumos Gerais, Insumos Industrialização, Insumos Pecuária, Máquinas/Equipamentos/Veículos, Produção, Produtos Exportação |  |
| `category_id` | Categoria | select | R |  | Equipamentos de Irrigação, Máquinas/Veículos/Implementos/Equipamentos, Peças |  |
| `kind_id` | Classe | select | R |  | Peças_Máq/Implementos/Veículos, Peças/Equipamentos |  |
| `cultivation_id` | Variedade | select |  |  | Soja - 1823, Soja - Bonus, Soja - Bonus, CANA DE AÇUCAR - ERLAM - CANA DE AÇUCAR, Soja - Extrema, Soja - Monsoy 8606, PLANTAÇÃO DE MORANGO - ERLAM - MORANGO DE MESA, Banana - Nanica … (14) |  |
| `quality` | Qualidade | select |  |  | 1 |  |
| `has_lot` | Cont. Lote | select |  |  | Sim, Não | Indica que o produto possui data de validade \n \n Ao ativar, o sistema controlará os lotes e alertará sobre vencimentos próximos |
| `control_stock` | Controla Estoque | select | R |  | Sim, Não | Permite gerenciar o produto no estoque e faz o cálculo do preço médio do produto automaticamente |
| `min_stock` | Estoque minimo | text (moeda) |  |  |  | Quantidade mínima desejada em estoque \n \n O sistema emitirá um alerta quando o estoque atingir ou ficar abaixo desse valor \n \n Caso não queira ter um estoqu |
| `last_purchase_date` | Dt. Ult. Compra | date |  |  |  |  |
| `average_cost` | Pc. Médio | text (moeda) |  |  |  |  |
| `las_price` | Vl. Referência | text (moeda) | R |  |  | Valor de mercado do produto que está sendo cadastrado. \n \n Exemplo: 1 Un de Pá Tramontina → R$ 45,00 |
| `is_enabled` | Ativo | select | R |  | Sim, Não |  |
| `allow_pointing` | Apontamento | select | R |  | Não, Sim | Se marcado como sim, permite que o produto seja utilizado na aba de apontamentos |
| `financial_category_id` | Cat. Financeira - Custo | select |  |  | 2.01.001.0001 - Energia Elétrica, 2.01.001.0002 - Telefone/Internet, 2.01.001.0003 - Aluguéis, 2.01.001.0004 - Água/Esgoto, 2.01.001.0005 - Brindes/Cortesias, 2.01.001.0006 - Viagens/Diárias, 2.01.001.0007 - Treinamento Mão de Obra, 2.01.001.0008 - Softwares … (209) | Categoria financeira utilizada para classificação de custos de produção. Obrigatório quando o produto controla estoque. |
| `default_cost_center_id` | Centro de Custo Padrão | select |  |  | Administração, Estoque Insumos, Estoque Produção, Parque Máquinas, Soja, Soja Precoce, Soja Super Precoce, Terminação - Corte |  |
| `default_warehouse_id` | Armazém Padrão | select |  |  | BARRACAO |  |
| `active_principle` | Princípio Ativo | text |  | 50 |  |  |
| `withdrawal_period_days` | Período de Carência (dias) | text |  |  |  | Dias que o animal deve aguardar após receber este produto antes de ser vendido/abatido, devido a resíduos químicos. |
| `is_equipment` | Adiciona ao Inventário | select | R |  | Sim, Não | Cadastra produto automaticamente no inventário da fazenda |
| `addressing_id` | Endereçamento | select |  |  | Setor 01, — Corredor 01, — — Prateleira A, — — — Nível 01, — — — Nível 02, Setor 2, — Corredor 2A, — — Prateleira A |  |
| `is_fiscal` | Emitir NFe. | select | R |  | Não, Sim |  |
| `tax_rule_id` | Regra Fiscal | select |  |  |  |  |
| `cfop_saida_interno` | CFOP Saída Interno | text |  |  |  |  |
| `cfop_saida_externo` | CFOP Saída Externo | text |  |  |  |  |
| `cbenef` | Código de Benefício Fiscal | text |  |  |  |  |
| `cst_csosn` | CST/CSOSN Padrão | select | R |  | 00 - Tributa integralmente, 10 - Tributada e com cobrança do ICMS por substituição tributária, 20 - Com redução da Base de Calculo, 30 - Isenta / não tributada e com cobrança do ICMS por substituição tributária, 40 - Isenta, 41 - Não tributada, 50 - Com suspensão, 51 - Com diferimento … (21) |  |
| `cst_pis` | CST/COFINS Padrão | select | R |  | 01 - Operação Tributável - Base de Cálculo = Valor da Operação Alíquota Normal (Cumulativo/Não Cumulativo), 02 - Operação Tributável - Base de Calculo = Valor da Operação (Alíquota Diferenciada), 03 - Operação Tributável - Base de Calculo = Quantidade Vendida x Alíquota por Unidade de Produto;, 04 - Operação Tributável - Tributação Monofásica - (Alíquota Zero);, 06 - Operação Tributável - Alíquota Zero;, 07 - Operação Isenta da contribuição;, 08 - Operação Sem Incidência da contribuição;, 09 - Operação com suspensão da contribuição; … (32) |  |
| `cst_cofins` | CST/PIS | select | R |  | 01 - Operação Tributável - Base de Cálculo = Valor da Operação Alíquota Normal (Cumulativo/Não Cumulativo), 02 - Operação Tributável - Base de Calculo = Valor da Operação (Alíquota Diferenciada), 03 - Operação Tributável - Base de Calculo = Quantidade Vendida x Alíquota por Unidade de Produto;, 04 - Operação Tributável - Tributação Monofásica - (Alíquota Zero);, 06 - Operação Tributável - Alíquota Zero;, 07 - Operação Isenta da contribuição;, 08 - Operação Sem Incidência da contribuição;, 09 - Operação com suspensão da contribuição; … (32) |  |
| `cst_ipi` | CST/IPI | select | R |  | 00 - Entrada com Recuperação de Crédito, 01 - Entrada Tributável com Alíquota Zero, 02 - Entrada Isenta, 03 - Entrada Não Tributada, 04 - Entrada Imune, 05 - Entrada com Suspensão, 49 - Outras Operações de Entrada, 50 - Saída Tributada … (14) |  |
| `cenq_ipi` | Código Enquadramento IPI | select | R |  | 001 - Imunidade - Livros, jornais, periódicos e o papel destinado à sua impressão - Art. 18 Inciso I do Decreto 7.212/2010, 002 - Imunidade - Produtos industrializados destinados ao exterior - Art. 18 Inciso II do Decreto 7.212/2010, 003 - Imunidade - Ouro, definido em lei como ativo financeiro ou instrumento cambial - Art. 18 Inciso III do Decreto 7.212/2010, 004 - Imunidade - Energia elétrica, derivados de petróleo, combustíveis e minerais do País - Art. 18 Inciso IV do Decreto 7.212/2010, 005 - Imunidade - Exportação de produtos nacionais - sem saída do território brasileiro - venda para empresa sediada no exterior - atividades de pesquisa ou lavra de jazidas de petróleo e de gás natural- Art. 19 Inciso I do Decreto 7.212/2010, 006 - Imunidade - Exportação de produtos nacionais - sem saída do território brasileiro - venda para empresa sediada no exterior - incorporados a produto final exportado para o Brasil - Art. 19 Inciso II do Decreto 7.212/2010, 007 - Imunidade - Exportação de produtos nacionais - sem saída do território brasileiro - venda para órgão ou entidade de governo estrangeiro ou organismo internacional de que o Brasil seja membro,para ser entregue, no País, à ordem do comprador - Art. 19 Inciso III do Decreto 7.212/2010, 101 - Suspensão - Óleo de menta em bruto, produzido por lavradores - Art. 43 Inciso I do Decreto 7.212/2010 … (132) |  |
| `perc_icms` | %ICMS | text | R |  |  |  |
| `perc_pis` | %PIS | text | R |  |  |  |
| `perc_cofins` | %COFINS | text | R |  |  |  |
| `perc_ipi` | %IPI | text |  |  |  |  |
| `cest` | CEST | text |  | 10 |  |  |
| `barcode` | Código de barras | text |  | 13 |  |  |
| `modality_bc` | Modalidade determinação da BC do ICMS | select | R |  | 0 - Margem Valor Agregado (%), 1 - Pauta (Valor), 2 - Preço Tabelado Máx. (valor), 3 - Valor da operação |  |
| `percent_reduction` | Percentual da Redução de Base de Cálculo | text | R |  |  |  |
| `reference` | Cod. Produto | text |  | 30 |  |  |
| `origem` | Origem | select | R |  | 0 - NACIONAL, 1 - ESTRANGEIRA - IMPORTAÇÃO DIRETA, 2 - ESTRANGEIRA - ADQUIRIDA NO MERCADO INTERNO, 3 - NACIONAL, MERCADORIA OU BEM COM CONTEÚDO DE IMPORTAÇÃO SUPERIOR A 40%, 4 - NACIONAL, CUJA PRODUÇÃO TENHA SIDO FEITA EM CONFORMIDADE COM OS PROCESSOS PRODUTIVOS BÁSICOS DE QUE TRATAM O DECRETO-LEI Nº 288/67, E AS LEIS NºS 8.248/91, 8.387/91, 10.176/01 E 11 . 4 8 4 / 0 7, 5 - NACIONAL, MERCADORIA OU BEM COM CONTEÚDO DE IMPORTAÇÃO INFERIOR OU IGUAL A 40%, 6 - ESTRANGEIRA - IMPORTAÇÃO DIRETA, SEM SIMILAR NACIONAL, CONSTANTE EM LISTA DE RESOLUÇÃO CAMEX, 7 - ESTRANGEIRA - ADQUIRIDA NO MERCADO INTERNO, SEM SIMILAR NACIONAL, CONSTANTE EM LISTA DE RESOLUÇÃO CAMEX … (9) |  |
| `cst_csosn_exp` | CST/CSOSN Exportação | select |  |  | 00 - Tributa integralmente, 10 - Tributada e com cobrança do ICMS por substituição tributária, 20 - Com redução da Base de Calculo, 30 - Isenta / não tributada e com cobrança do ICMS por substituição tributária, 40 - Isenta, 41 - Não tributada, 50 - Com suspensão, 51 - Com diferimento … (21) |  |
| `c_class_trib` | Código Classificação Tributária | text |  | 6 |  | Código de 6 dígitos que classifica o produto para tributação do IBS e CBS. Consulte a tabela oficial da Receita Federal. |
| `cst_ibs_cbs` | CST IBS/CBS | select |  |  | 000 - Tributação integral, 010 - Tributação com alíquotas uniformes, 011 - Tributação com alíquotas uniformes reduzidas, 200 - Alíquota reduzida, 220 - Alíquota fixa, 221 - Alíquota fixa proporcional, 222 - Redução de Base de Cálculo, 400 - Isenção … (18) | Código de Situação Tributária para IBS e CBS |
| `perc_ibs_uf` | % IBS UF (Estadual) | text |  |  |  | Alíquota do IBS de competência estadual. Ex: 17,50 |
| `perc_ibs_mun` | % IBS Município (Municipal) | text |  |  |  | Alíquota do IBS de competência municipal. Ex: 2,50 |
| `perc_reducao_aliq_ibs_uf` | % Redução Alíq. IBS UF | text |  |  |  | Percentual de redução da alíquota do IBS UF |
| `perc_reducao_aliq_ibs_mun` | % Redução Alíq. IBS Mun | text |  |  |  | Percentual de redução da alíquota do IBS Municipal |
| `perc_dif_ibs_uf` | % Diferimento IBS UF | text |  |  |  | Percentual do diferimento do IBS estadual (postergação do pagamento) |
| `perc_dif_ibs_mun` | % Diferimento IBS Município | text |  |  |  | Percentual do diferimento do IBS municipal (postergação do pagamento) |
| `perc_cbs` | % CBS (Federal) | text |  |  |  | Alíquota da CBS (substitui PIS e COFINS). Ex: 9,25 |
| `perc_reducao_aliq_cbs` | % Redução Alíquota CBS | text |  |  |  | Percentual de redução da alíquota CBS |
| `perc_dif_cbs` | % Diferimento CBS | text |  |  |  | Percentual do diferimento da CBS (postergação do pagamento) |
| `cst_is` | CST IS | text |  | 3 |  | Código de Situação Tributária do Imposto Seletivo (3 dígitos) |
| `perc_is` | % Imposto Seletivo | text |  |  |  | Alíquota do Imposto Seletivo em percentual |
| `perc_is_espec` | Alíq. Específica IS (R$) | text (moeda) |  |  |  | Alíquota específica do IS por valor unitário (ex: R$ 1,50 por litro) |
| `ad_rem_ibs` | Alíq. Ad Rem IBS (R$/un) | text (moeda) |  |  |  | Alíquota ad rem (por unidade) do IBS em operações monofásicas |
| `ad_rem_cbs` | Alíq. Ad Rem CBS (R$/un) | text (moeda) |  |  |  | Alíquota ad rem (por unidade) da CBS em operações monofásicas |
| `tp_cred_pres_ibs_zfm` | Crédito Presumido ZFM | select |  |  | Não se aplica, 0 - Sem Crédito Presumido, 1 - Bens de consumo final (55%), 2 - Bens de capital (75%), 3 - Bens intermediários (90,25%), 4 - Bens de informática e outros (100%) | Classificação para crédito presumido de IBS em operações com Zona Franca de Manaus |
| `ind_doacao` | Operação de Doação | select |  |  | Não, Sim - Operação de doação | Indica se a operação é de doação, orientando apuração de débitos/estornos |
| `package_id[]` | Embalagem | select |  |  |  |  |

## SCR-305 · Armazém

- **Rota:** `/admin/warehouses/create`
- **Módulo:** Cadastros Base > Estrutura > Produtos > Armazéns
- **Tipo:** Cadastro (novo)
- **Finalidade:** Armazéns (cadastro (novo))
- **Botões/Ações (cabeçalho):** Voltar → `/admin/warehouses`

**Formulário POST `/admin/warehouses`** — botões: Salvar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `initials` | Sigla | text | R | 6 |  |  |
| `description` | Descrição | text | R | 100 |  |  |
| `type` | Tipo | select | R |  | Insumos, Produção, Formulação |  |
| `is_active` | Ativo | select | R |  | Sim, Não |  |

## SCR-306 · Armazém

- **Rota:** `/admin/warehouses/733`
- **Módulo:** Cadastros Base > Estrutura > Produtos > Armazéns
- **Tipo:** Detalhe
- **Finalidade:** Armazéns (detalhe)
- **Botões/Ações (cabeçalho):** Voltar → `/admin/warehouses`

## SCR-307 · Armazém

- **Rota:** `/admin/warehouses/733/edit`
- **Módulo:** Cadastros Base > Estrutura > Produtos > Armazéns
- **Tipo:** Cadastro (edição)
- **Finalidade:** Armazéns (cadastro (edição))
- **Botões/Ações (cabeçalho):** Voltar → `/admin/warehouses`

**Formulário PUT `/admin/warehouses/733`** — botões: Salvar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `initials` | Sigla | text | R | 6 |  |  |
| `description` | Descrição | text | R | 100 |  |  |
| `type` | Tipo | select | R |  | Insumos, Produção, Formulação |  |
| `is_active` | Ativo | select | R |  | Sim, Não |  |

## SCR-308 · Saldo Inicial

- **Rota:** `/admin/openingbalances/create`
- **Módulo:** Cadastros Base > Estrutura > Produtos > Estoques Iniciais
- **Tipo:** Cadastro (novo)
- **Finalidade:** Estoques Iniciais (cadastro (novo))
- **Botões/Ações (cabeçalho):** Voltar → `/admin/openingbalances`
- **Modais:** Produto

**Formulário POST `/admin/openingbalances`** — botões: Salvar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `product_id` | Produto | select | R |  |  |  |
| `um` | Unidade de Medida | text |  |  |  |  |
| `warehouse_id` | Armazém | select | R |  | BARRACAO |  |
| `quantity` | Qtde. Total | text (moeda) | R |  |  |  |
| `amount` | Vl. Unit. | text (moeda) | R |  |  |  |
| `total_amount` | Valor Total | text (moeda) | R |  |  |  |
| `average_cost` | Custo Médio Unit | text (moeda) | R |  |  |  |
| `provider_lot` | Lote Fornecedor | text |  | 15 |  |  |
| `expiration_date` | Data de Validade | date |  |  |  |  |
| `cultivation_id` | Classificação | select |  |  | Nanica, CANA DE AÇUCAR, Pionner 2022, Pionner 2024, Pionner 2022, Pionner 2024, MORANGO DE MESA, 1823 … (14) |  |
| `drink` | Bebida | select |  |  | EXT. MOLE, MOLE, DURO +, DURO, DURO/VERDE, DURO/SUJO, DURO/FRTD, DURO/1 RIADA … (21) |  |

**Formulário POST `/admin/openingbalances/create`** (modal newProductModal) — botões: Salvar

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

## SCR-309 · Saldo Inicial

- **Rota:** `/admin/openingbalances/16877`
- **Módulo:** Cadastros Base > Estrutura > Produtos > Estoques Iniciais
- **Tipo:** Detalhe
- **Finalidade:** Estoques Iniciais (detalhe)
- **Botões/Ações (cabeçalho):** Voltar → `/admin/openingbalances`

## SCR-310 · Saldo Inicial

- **Rota:** `/admin/openingbalances/16877/edit`
- **Módulo:** Cadastros Base > Estrutura > Produtos > Estoques Iniciais
- **Tipo:** Cadastro (edição)
- **Finalidade:** Estoques Iniciais (cadastro (edição))
- **Botões/Ações (cabeçalho):** Voltar → `/admin/openingbalances`

**Formulário PUT `/admin/openingbalances/16877`** — botões: Salvar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `product_id` | Produto | select | R |  | PROMILL |  |
| `um` | Unidade de Medida | text |  |  |  |  |
| `warehouse_id` | Armazém | select | R |  | BARRACAO |  |
| `quantity` | Qtde. Total | text (moeda) | R |  |  |  |
| `amount` | Vl. Unit. | text (moeda) | R |  |  |  |
| `total_amount` | Valor Total | text (moeda) | R |  |  |  |
| `average_cost` | Custo Médio Unit | text (moeda) | R |  |  |  |
| `provider_lot` | Lote Fornecedor | text |  | 15 |  |  |
| `expiration_date` | Data de Validade | date |  |  |  |  |
| `cultivation_id` | Classificação | select |  |  | Nanica, CANA DE AÇUCAR, Pionner 2022, Pionner 2024, Pionner 2022, Pionner 2024, MORANGO DE MESA, 1823 … (14) |  |
| `drink` | Bebida | select |  |  | EXT. MOLE, MOLE, DURO +, DURO, DURO/VERDE, DURO/SUJO, DURO/FRTD, DURO/1 RIADA … (21) |  |

## SCR-311 · Saldo Inicial

- **Rota:** `/admin/apportionments/create`
- **Módulo:** Cadastros Base > Estrutura > Rateios > Categorias
- **Tipo:** Cadastro (novo)
- **Finalidade:** Categorias (cadastro (novo))
- **Botões/Ações (cabeçalho):** Voltar → `/admin/openingbalances`

**Formulário PUT `/admin/openingbalances/16877`** — botões: Salvar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `product_id` | Produto | select | R |  | PROMILL |  |
| `um` | Unidade de Medida | text |  |  |  |  |
| `warehouse_id` | Armazém | select | R |  | BARRACAO |  |
| `quantity` | Qtde. Total | text (moeda) | R |  |  |  |
| `amount` | Vl. Unit. | text (moeda) | R |  |  |  |
| `total_amount` | Valor Total | text (moeda) | R |  |  |  |
| `average_cost` | Custo Médio Unit | text (moeda) | R |  |  |  |
| `provider_lot` | Lote Fornecedor | text |  | 15 |  |  |
| `expiration_date` | Data de Validade | date |  |  |  |  |
| `cultivation_id` | Classificação | select |  |  | Nanica, CANA DE AÇUCAR, Pionner 2022, Pionner 2024, Pionner 2022, Pionner 2024, MORANGO DE MESA, 1823 … (14) |  |
| `drink` | Bebida | select |  |  | EXT. MOLE, MOLE, DURO +, DURO, DURO/VERDE, DURO/SUJO, DURO/FRTD, DURO/1 RIADA … (21) |  |

## SCR-312 · Perfil Usuário

- **Rota:** `/admin/roles/create`
- **Módulo:** Cadastros Base > Pessoas > Perfil Usuário
- **Tipo:** Cadastro (novo)
- **Finalidade:** Perfil Usuário (cadastro (novo))
- **Botões/Ações (cabeçalho):** Voltar → `/admin/roles`

**Formulário POST `/admin/roles`** — botões: Salvar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `name` | Nome | text | R | 15 |  |  |
| `description` | Descrição | text | R | 40 |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |

## SCR-313 · Perfil Usuário

- **Rota:** `/admin/roles/361`
- **Módulo:** Cadastros Base > Pessoas > Perfil Usuário
- **Tipo:** Detalhe
- **Finalidade:** Perfil Usuário (detalhe)
- **Botões/Ações (cabeçalho):** Voltar → `/admin/roles`

## SCR-314 · Perfil Usuário

- **Rota:** `/admin/roles/361/edit`
- **Módulo:** Cadastros Base > Pessoas > Perfil Usuário
- **Tipo:** Cadastro (edição)
- **Finalidade:** Perfil Usuário (cadastro (edição))
- **Botões/Ações (cabeçalho):** Voltar → `/admin/roles`

**Formulário PUT `/admin/roles/361`** — botões: Salvar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `name` | Nome | text | R | 15 |  |  |
| `description` | Descrição | text | R | 40 |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |
| `permissions[]` | Visualizar | checkbox |  |  |  |  |

## SCR-315 · Inscrições Estaduais

- **Rota:** `/admin/people/create`
- **Módulo:** Cadastros Base > Pessoas > Pessoas Unificado
- **Tipo:** Cadastro (novo)
- **Finalidade:** Pessoas Unificado (cadastro (novo))
- **Abas:** Conta | Filiais | Vendedores
- **Botões/Ações (cabeçalho):** Voltar → `/admin/people`; Proprietario (modal #collapse-proprietary); Funcionário (modal #collapse-employee); Fornecedor (modal #collapse-provider); Cliente (modal #collapse-client); Usuário (modal #collapse-users)

**Tabela** — linhas na amostra: 1

- Colunas: (seleção) | Insc. Estadual

**Tabela** — linhas na amostra: 1

- Colunas: (seleção) | Fazenda | Percentual

**Tabela** — linhas na amostra: 1

- Colunas: (seleção) | Insc. Estadual

**Formulário POST `/admin/people`** — botões: Salvar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `nif` | CPF/CNPJ | text | R |  |  |  |
| `name` | Nome Social/Fantasia | text | R | 70 |  |  |
| `nickname` | Nome Completo/Razão Social | text | R | 70 |  |  |
| `email` | Email | email |  |  |  |  |
| `phone` | Telefone | text |  |  |  |  |
| `city_id` | Cidade | select | R |  |  |  |
| `zip_code` | CEP | text |  |  |  |  |
| `address` | Endereço | text | R |  |  |  |
| `number` | Número | text | R | 60 |  |  |
| `district` | Bairro | text | R | 60 |  |  |
| `proprietary_is_enabled` | Ativo | select | R |  | (lista dinâmica de cadastro — 2 registros; valores omitidos por privacidade) |  |
| `proprietary_numbers[]` |  | text |  |  |  |  |
| `proprietary_farms[]` |  | select |  |  | (lista dinâmica de cadastro — 2 registros; valores omitidos por privacidade) |  |
| `proprietary_percentages[]` |  | text |  |  |  |  |
| `employee_is_enabled` | Ativo | select | R |  | Sim, Não |  |
| `employee_office` | Cargo | text |  |  |  |  |
| `employee_function_id` | Função | select |  |  | AJUDANDE DE CONZINHA, AJUDANTE GERAL, ANALISTA ADMINISTRATIVO GERAL, ANALISTA ADMINISTRATIVO PLENO, ANALISTA ADMINISTRATIVO SÊNIOR, ANALISTA DE COMPRAS, ANALISTA DE RH PLENO, ANALISTA DEPARTAMENTO DE PESSOAL … (208) |  |
| `employee_commission` | Comissão(%) | text |  |  |  |  |
| `employee_vl_time_productive` | Vl. Hora | text (moeda) |  |  |  |  |
| `employee_base_salary` | Salário Base | text (moeda) |  |  |  |  |
| `employee_goal_salary` | Salário Meta | text (moeda) |  |  |  |  |
| `employee_center_id` | Centro de Custo | select |  |  | Administração, Estoque Insumos, Estoque Produção, Parque Máquinas, Soja, Soja Precoce, Soja Super Precoce, Terminação - Corte |  |
| `employee_birthday` | Dt. Nascimento | text (data) |  |  |  |  |
| `employee_bank_id` | Banco | select |  |  | 001-Banco do Brasil S.A., 003-Banco da Amazônia S.A., 004-Banco do Nordeste do Brasil S.A., 007-Banco Nacional de Desenvolvimento Econômico e Social - BNDES, 010-CREDICOAMO Crédito Rural Cooperativa, 011-Credit Suisse Hedging-Griffo Corretora de Valores S.A., 012-Banco Inbursa S.A., 014-Natixis Brasil S.A. Banco Múltiplo … (168) |  |
| `employee_account_type` | Tipo | select |  |  | Corrente, Poupança |  |
| `employee_agency` | Agência | text |  | 13 |  |  |
| `employee_account` | Conta | text |  | 18 |  |  |
| `employee_pix_type` | Tipo chave Pix | select |  |  | CPF/CNPJ, Telefone, Email, Aleatória |  |
| `employee_pix` | Pix | text |  |  |  |  |
| `provider_is_enabled` | Ativo | select | R |  | Sim, Não |  |
| `provider_type` | Tipo | select |  |  | Fornecedor, Funcionário, Terceirizado, Transportador, Comissionado, Inseminador |  |
| `provider_commission` | % Comissão | text |  |  |  |  |
| `provider_hour_value` | Vl. Hora | text (moeda) |  |  |  |  |
| `provider_state_registration` | Insc. Estadual | text |  | 20 |  |  |
| `provider_city_registration` | Insc. Municipal | text |  | 20 |  |  |
| `provider_contact` | Contato | text |  |  |  |  |
| `provider_contact_phone` | Tel. do contato | text |  |  |  |  |
| `provider_bank_id` | Banco | select |  |  | 001-Banco do Brasil S.A., 003-Banco da Amazônia S.A., 004-Banco do Nordeste do Brasil S.A., 007-Banco Nacional de Desenvolvimento Econômico e Social - BNDES, 010-CREDICOAMO Crédito Rural Cooperativa, 011-Credit Suisse Hedging-Griffo Corretora de Valores S.A., 012-Banco Inbursa S.A., 014-Natixis Brasil S.A. Banco Múltiplo … (168) |  |
| `provider_account_type` | Tipo | select |  |  | Corrente, Poupança |  |
| `provider_agency` | Agência | text |  | 13 |  |  |
| `provider_account` | Conta | text |  | 18 |  |  |
| `provider_pix_type` | Tipo chave Pix | select |  |  | CPF/CNPJ, Telefone, Email, Aleatória |  |
| `provider_pix` | Pix | text |  |  |  |  |
| `branch_nif[]` | CPF/CNPJ | text |  |  |  |  |
| `branch_state_registration[]` | Insc. Estadual | text |  | 20 |  |  |
| `branch_zip_code[]` | CEP | text |  |  |  |  |
| `branch_address[]` | Endereço | text |  |  |  |  |
| `branch_city_id[]` | Cidade | select |  |  |  |  |
| `seller_name[]` | Nome | text |  |  |  |  |
| `seller_email[]` | Email | email |  |  |  |  |
| `seller_phone[]` | Telefone | text |  |  |  |  |
| `client_is_enabled` | Ativo | select | R |  | Sim, Não |  |
| `client_cellphone` | Celular | text |  |  |  |  |
| `client_contact` | Contato | text |  |  |  |  |
| `client_contact_phone` | Tel. do contato | text |  |  |  |  |
| `client_city_registration` | Insc. Municipal | text |  | 20 |  |  |
| `client_final_costumer` | Consumidor Final | select |  |  | Não, Sim |  |
| `client_taxpayer` | Contribuinte | select |  |  | Sim, Não |  |
| `client_code_country` | Pais | select |  |  | 132 - Afeganistão, 7560 - África do Sul, 175 - Albânia, República da, 230 - Alemanha, 370 - Andorra Sim, 400 - Angola, 418 - Anguilla Sim, 434 - Antigua e Barbuda Sim … (239) |  |
| `client_id_abroad` | ID estrangeiro | text |  | 20 |  |  |
| `client_farm_name` | Nome da Fazenda | text |  | 100 |  |  |
| `client_state_registrations[]` |  | text |  |  |  |  |
| `user_is_active` | Ativo | select |  |  | Sim, Não |  |
| `user_is_purchasing_assistant` | Conferente de Compras? | select |  |  | Não, Sim |  |
| `user_password` | Senha | password |  |  |  |  |
| `user_password_confirmation` | Confirmar Senha | password |  |  |  |  |
| `user_roles[]` | Perfil de Usuário | select (múltiplo) |  |  | (lista dinâmica de cadastro — 5 registros; valores omitidos por privacidade) |  |
| `user_farms[]` | Fazenda | select (múltiplo) |  |  | Fazenda Maira, Fazenda São Paulo |  |
| `user_bosses[]` | Encarregados | select (múltiplo) |  |  | (lista dinâmica de cadastro — 3 registros; valores omitidos por privacidade) |  |

## SCR-316 · Pessoas

- **Rota:** `/admin/people/28907`
- **Módulo:** Cadastros Base > Pessoas > Pessoas Unificado
- **Tipo:** Detalhe
- **Finalidade:** Pessoas Unificado (detalhe)
- **Botões/Ações (cabeçalho):** Voltar → `/admin/people`

## SCR-317 · Inscrições Estaduais

- **Rota:** `/admin/people/28907/edit`
- **Módulo:** Cadastros Base > Pessoas > Pessoas Unificado
- **Tipo:** Cadastro (edição)
- **Finalidade:** Pessoas Unificado (cadastro (edição))
- **Abas:** Conta | Filiais | Vendedores
- **Botões/Ações (cabeçalho):** Voltar → `/admin/people`; Proprietario (modal #collapse-proprietary); Funcionário (modal #collapse-employee); Fornecedor (modal #collapse-provider); Cliente (modal #collapse-client); Usuário (modal #collapse-users)

**Tabela** — linhas na amostra: 1

- Colunas: (seleção) | Insc. Estadual

**Tabela** — linhas na amostra: 1

- Colunas: (seleção) | Fazenda | Percentual

**Tabela** — linhas na amostra: 1

- Colunas: (seleção) | Insc. Estadual

**Formulário PUT `/admin/people/28907`** — botões: Salvar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `nif` | CPF/CNPJ | text | R |  |  |  |
| `name` | Nome Social/Fantasia | text | R | 70 |  |  |
| `nickname` | Nome Completo/Razão Social | text | R | 70 |  |  |
| `email` | Email | email |  |  |  |  |
| `phone` | Telefone | text |  |  |  |  |
| `city_id` | Cidade | select | R |  | Franca |  |
| `zip_code` | CEP | text |  |  |  |  |
| `address` | Endereço | text | R |  |  |  |
| `number` | Número | text | R | 60 |  |  |
| `district` | Bairro | text | R | 60 |  |  |
| `proprietary_is_enabled` | Ativo | select | R |  | (lista dinâmica de cadastro — 2 registros; valores omitidos por privacidade) |  |
| `proprietary_numbers[]` |  | text |  |  |  |  |
| `proprietary_farms[]` |  | select |  |  | (lista dinâmica de cadastro — 2 registros; valores omitidos por privacidade) |  |
| `proprietary_percentages[]` |  | text |  |  |  |  |
| `employee_is_enabled` | Ativo | select | R |  | Sim, Não |  |
| `employee_office` | Cargo | text |  |  |  |  |
| `employee_function_id` | Função | select |  |  | AJUDANDE DE CONZINHA, AJUDANTE GERAL, ANALISTA ADMINISTRATIVO GERAL, ANALISTA ADMINISTRATIVO PLENO, ANALISTA ADMINISTRATIVO SÊNIOR, ANALISTA DE COMPRAS, ANALISTA DE RH PLENO, ANALISTA DEPARTAMENTO DE PESSOAL … (208) |  |
| `employee_commission` | Comissão(%) | text |  |  |  |  |
| `employee_vl_time_productive` | Vl. Hora | text (moeda) |  |  |  |  |
| `employee_base_salary` | Salário Base | text (moeda) |  |  |  |  |
| `employee_goal_salary` | Salário Meta | text (moeda) |  |  |  |  |
| `employee_center_id` | Centro de Custo | select |  |  | Administração, Estoque Insumos, Estoque Produção, Parque Máquinas, Soja, Soja Precoce, Soja Super Precoce, Terminação - Corte |  |
| `employee_birthday` | Dt. Nascimento | text (data) |  |  |  |  |
| `employee_bank_id` | Banco | select |  |  | 001-Banco do Brasil S.A., 003-Banco da Amazônia S.A., 004-Banco do Nordeste do Brasil S.A., 007-Banco Nacional de Desenvolvimento Econômico e Social - BNDES, 010-CREDICOAMO Crédito Rural Cooperativa, 011-Credit Suisse Hedging-Griffo Corretora de Valores S.A., 012-Banco Inbursa S.A., 014-Natixis Brasil S.A. Banco Múltiplo … (168) |  |
| `employee_account_type` | Tipo | select |  |  | Corrente, Poupança |  |
| `employee_agency` | Agência | text |  | 13 |  |  |
| `employee_account` | Conta | text |  | 18 |  |  |
| `employee_pix_type` | Tipo chave Pix | select |  |  | CPF/CNPJ, Telefone, Email, Aleatória |  |
| `employee_pix` | Pix | text |  |  |  |  |
| `provider_is_enabled` | Ativo | select | R |  | Sim, Não |  |
| `provider_type` | Tipo | select |  |  | Fornecedor, Funcionário, Terceirizado, Transportador, Comissionado, Inseminador |  |
| `provider_commission` | % Comissão | text |  |  |  |  |
| `provider_hour_value` | Vl. Hora | text (moeda) |  |  |  |  |
| `provider_state_registration` | Insc. Estadual | text |  | 20 |  |  |
| `provider_city_registration` | Insc. Municipal | text |  | 20 |  |  |
| `provider_contact` | Contato | text |  |  |  |  |
| `provider_contact_phone` | Tel. do contato | text |  |  |  |  |
| `provider_bank_id` | Banco | select |  |  | 001-Banco do Brasil S.A., 003-Banco da Amazônia S.A., 004-Banco do Nordeste do Brasil S.A., 007-Banco Nacional de Desenvolvimento Econômico e Social - BNDES, 010-CREDICOAMO Crédito Rural Cooperativa, 011-Credit Suisse Hedging-Griffo Corretora de Valores S.A., 012-Banco Inbursa S.A., 014-Natixis Brasil S.A. Banco Múltiplo … (168) |  |
| `provider_account_type` | Tipo | select |  |  | Corrente, Poupança |  |
| `provider_agency` | Agência | text |  | 13 |  |  |
| `provider_account` | Conta | text |  | 18 |  |  |
| `provider_pix_type` | Tipo chave Pix | select |  |  | CPF/CNPJ, Telefone, Email, Aleatória |  |
| `provider_pix` | Pix | text |  |  |  |  |
| `branch_nif[]` | CPF/CNPJ | text |  |  |  |  |
| `branch_state_registration[]` | Insc. Estadual | text |  | 20 |  |  |
| `branch_zip_code[]` | CEP | text |  |  |  |  |
| `branch_address[]` | Endereço | text |  |  |  |  |
| `branch_city_id[]` | Cidade | select |  |  |  |  |
| `seller_name[]` | Nome | text |  |  |  |  |
| `seller_email[]` | Email | email |  |  |  |  |
| `seller_phone[]` | Telefone | text |  |  |  |  |
| `client_is_enabled` | Ativo | select | R |  | Sim, Não |  |
| `client_cellphone` | Celular | text |  |  |  |  |
| `client_contact` | Contato | text |  |  |  |  |
| `client_contact_phone` | Tel. do contato | text |  |  |  |  |
| `client_city_registration` | Insc. Municipal | text |  | 20 |  |  |
| `client_final_costumer` | Consumidor Final | select |  |  | Não, Sim |  |
| `client_taxpayer` | Contribuinte | select |  |  | Sim, Não |  |
| `client_code_country` | Pais | select |  |  | 132 - Afeganistão, 7560 - África do Sul, 175 - Albânia, República da, 230 - Alemanha, 370 - Andorra Sim, 400 - Angola, 418 - Anguilla Sim, 434 - Antigua e Barbuda Sim … (239) |  |
| `client_id_abroad` | ID estrangeiro | text |  | 20 |  |  |
| `client_farm_name` | Nome da Fazenda | text |  | 100 |  |  |
| `client_state_registrations[]` |  | text |  |  |  |  |
| `user_is_active` | Ativo | select |  |  | Sim, Não |  |
| `user_is_purchasing_assistant` | Conferente de Compras? | select |  |  | Não, Sim |  |
| `user_roles[]` | Perfil de Usuário | select (múltiplo) |  |  | (lista dinâmica de cadastro — 5 registros; valores omitidos por privacidade) |  |
| `user_farms[]` | Fazenda | select (múltiplo) |  |  | Fazenda Maira, Fazenda São Paulo |  |
| `user_bosses[]` | Encarregados | select (múltiplo) |  |  | (lista dinâmica de cadastro — 3 registros; valores omitidos por privacidade) |  |

## SCR-318 · Proprietários

- **Rota:** `/admin/proprietaries/report`
- **Módulo:** Cadastros Base > Pessoas > Proprietários
- **Tipo:** Relatório
- **Finalidade:** Proprietários (relatório)
- **Cards/Seções:** 

## SCR-319 · Inscrições Estaduais

- **Rota:** `/admin/proprietaries/create`
- **Módulo:** Cadastros Base > Pessoas > Proprietários
- **Tipo:** Cadastro (novo)
- **Finalidade:** Proprietários (cadastro (novo))
- **Botões/Ações (cabeçalho):** Voltar → `/admin/proprietaries`

**Tabela** — linhas na amostra: 1

- Colunas: (seleção) | Insc. Estadual

**Tabela** — linhas na amostra: 1

- Colunas: (seleção) | Fazenda | Percentual

**Formulário POST `/admin/proprietaries`** — botões: Salvar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `nif` | CPF/CNPJ | text | R |  |  |  |
| `name` | Nome | text | R | 70 |  |  |
| `is_enabled` | Ativo | select | R |  | Sim, Não |  |
| `phone` | Telefone | text | R |  |  |  |
| `email` | Email | email | R |  |  |  |
| `city_id` | Cidade | select | R |  |  |  |
| `address` | Endereço | text | R |  |  |  |
| `numbers[]` |  | text |  |  |  |  |
| `farms[]` |  | select | R |  | Fazenda Maira, Fazenda São Paulo |  |
| `percentages[]` |  | text | R |  |  |  |

## SCR-320 · Proprietários

- **Rota:** `/admin/proprietaries/56`
- **Módulo:** Cadastros Base > Pessoas > Proprietários
- **Tipo:** Detalhe
- **Finalidade:** Proprietários (detalhe)
- **Botões/Ações (cabeçalho):** Voltar → `/admin/proprietaries`

## SCR-321 · Inscrições Estaduais

- **Rota:** `/admin/proprietaries/56/edit`
- **Módulo:** Cadastros Base > Pessoas > Proprietários
- **Tipo:** Cadastro (edição)
- **Finalidade:** Proprietários (cadastro (edição))
- **Botões/Ações (cabeçalho):** Voltar → `/admin/proprietaries`

**Tabela** — linhas na amostra: 1

- Colunas: (seleção) | Insc. Estadual

**Tabela** — linhas na amostra: 2

- Colunas: (seleção) | Fazenda | Percentual

**Formulário PUT `/admin/proprietaries/56`** — botões: Salvar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `nif` | CPF/CNPJ | text | R |  |  |  |
| `name` | Nome | text | R | 70 |  |  |
| `is_enabled` | Ativo | select | R |  | Sim, Não |  |
| `phone` | Telefone | text | R |  |  |  |
| `email` | Email | email | R |  |  |  |
| `city_id` | Cidade | select | R |  | Pium - TO |  |
| `address` | Endereço | text | R |  |  |  |
| `numbers[]` |  | text |  |  |  |  |
| `farms[]` |  | select | R |  | Fazenda Maira, Fazenda São Paulo |  |
| `percentages[]` |  | text | R |  |  |  |
| `farms[]` |  | select | R |  | Fazenda Maira, Fazenda São Paulo |  |
| `percentages[]` |  | text | R |  |  |  |

## SCR-322 · Fornecedores

- **Rota:** `/admin/providers/report`
- **Módulo:** Cadastros Base > Pessoas > Fornecedores
- **Tipo:** Relatório
- **Finalidade:** Fornecedores (relatório)
- **Cards/Seções:** 

## SCR-323 · Fornecedores

- **Rota:** `/admin/providers/create`
- **Módulo:** Cadastros Base > Pessoas > Fornecedores
- **Tipo:** Cadastro (novo)
- **Finalidade:** Fornecedores (cadastro (novo))
- **Abas:** Conta | Filiais | Vendedores
- **Botões/Ações (cabeçalho):** Voltar → `/admin/providers`
- **Modais:** Acesse mais e melhor crédito!

**Formulário POST `/admin/providers`** — botões: Salvar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `nif` | CPF/CNPJ | text | R |  |  |  |
| `nickname` | Nome Completo/Razão Social | text | R | 60 |  |  |
| `name` | Nome Social/Fantasia | text | R | 80 |  |  |
| `state_registration` | Insc. Estadual | text |  | 20 |  |  |
| `city_registration` | Insc. Municipal | text |  | 20 |  |  |
| `type` | Tipo | select | R |  | Fornecedor, Funcionário, Terceirizado, Transportador, Comissionado, Inseminador |  |
| `commission` | % Comissão | text |  |  |  |  |
| `hour_value` | Vl. Hora | text (moeda) |  |  |  |  |
| `email` | Email | email |  |  |  |  |
| `phone` | Telefone | text | R |  |  |  |
| `cellphone` | Celular | text |  |  |  |  |
| `zip_code` | CEP | text |  |  |  |  |
| `address` | Endereço | text | R |  |  |  |
| `city_id` | Cidade | select | R |  |  |  |
| `contact` | Contato | text |  |  |  |  |
| `contact_phone` | Tel. do contato | text |  |  |  |  |
| `is_enabled` | Ativo | select | R |  | Sim, Não |  |
| `default_cost_center_id` | Centro de Custo Padrão | select |  |  | Administração, Estoque Insumos, Estoque Produção, Parque Máquinas, Soja, Soja Precoce, Soja Super Precoce, Terminação - Corte |  |
| `bank_id` | Banco | select |  |  | 001-Banco do Brasil S.A., 003-Banco da Amazônia S.A., 004-Banco do Nordeste do Brasil S.A., 007-Banco Nacional de Desenvolvimento Econômico e Social - BNDES, 010-CREDICOAMO Crédito Rural Cooperativa, 011-Credit Suisse Hedging-Griffo Corretora de Valores S.A., 012-Banco Inbursa S.A., 014-Natixis Brasil S.A. Banco Múltiplo … (168) |  |
| `account_type` | Tipo | select |  |  | Corrente, Poupança |  |
| `agency` | Agência | text |  | 13 |  |  |
| `account` | Conta | text |  | 18 |  |  |
| `pix_type` | Tipo chave Pix | select |  |  | CPF/CNPJ, Telefone, Email, Aleatória |  |
| `pix` | Pix | text |  |  |  |  |
| `branch_name[]` | Nome | text |  | 100 |  |  |
| `branch_nif[]` | CPF/CNPJ | text |  |  |  |  |
| `branch_state_registration[]` | Insc. Estadual | text |  | 40 |  |  |
| `branch_zip_code[]` | CEP | text |  |  |  |  |
| `branch_city_id[]` | Cidade | select |  |  |  |  |
| `branch_address[]` | Endereço | text |  |  |  |  |
| `seller_name[]` | Nome | text |  |  |  |  |
| `seller_email[]` | Email | email |  |  |  |  |
| `seller_phone[]` | Telefone | text |  |  |  |  |

- Mensagens/alertas: Não dependa só do Plano Safra, acesse mais e melhor crédito! Na Creditares te conectamos a vários financiadores simultan

## SCR-324 · Fornecedores

- **Rota:** `/admin/providers/22911`
- **Módulo:** Cadastros Base > Pessoas > Fornecedores
- **Tipo:** Detalhe
- **Finalidade:** Fornecedores (detalhe)
- **Botões/Ações (cabeçalho):** Voltar → `/admin/providers`

## SCR-325 · Fornecedores

- **Rota:** `/admin/providers/22911/edit`
- **Módulo:** Cadastros Base > Pessoas > Fornecedores
- **Tipo:** Cadastro (edição)
- **Finalidade:** Fornecedores (cadastro (edição))
- **Abas:** Conta | Filiais | Vendedores
- **Botões/Ações (cabeçalho):** Voltar → `/admin/providers`
- **Modais:** Acesse mais e melhor crédito!

**Formulário PUT `/admin/providers/22911`** — botões: Salvar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `nif` | CPF/CNPJ | text | R |  |  |  |
| `nickname` | Nome Completo/Razão Social | text | R | 60 |  |  |
| `name` | Nome Social/Fantasia | text | R | 80 |  |  |
| `state_registration` | Insc. Estadual | text |  | 20 |  |  |
| `city_registration` | Insc. Municipal | text |  | 20 |  |  |
| `type` | Tipo | select | R |  | Fornecedor, Funcionário, Terceirizado, Transportador, Comissionado, Inseminador |  |
| `commission` | % Comissão | text |  |  |  |  |
| `hour_value` | Vl. Hora | text (moeda) |  |  |  |  |
| `email` | Email | email |  |  |  |  |
| `phone` | Telefone | text | R |  |  |  |
| `cellphone` | Celular | text |  |  |  |  |
| `zip_code` | CEP | text |  |  |  |  |
| `address` | Endereço | text | R |  |  |  |
| `city_id` | Cidade | select | R |  | Franca - SP |  |
| `contact` | Contato | text |  |  |  |  |
| `contact_phone` | Tel. do contato | text |  |  |  |  |
| `is_enabled` | Ativo | select | R |  | Sim, Não |  |
| `default_cost_center_id` | Centro de Custo Padrão | select |  |  | Administração, Estoque Insumos, Estoque Produção, Parque Máquinas, Soja, Soja Precoce, Soja Super Precoce, Terminação - Corte |  |
| `bank_id` | Banco | select |  |  | 001-Banco do Brasil S.A., 003-Banco da Amazônia S.A., 004-Banco do Nordeste do Brasil S.A., 007-Banco Nacional de Desenvolvimento Econômico e Social - BNDES, 010-CREDICOAMO Crédito Rural Cooperativa, 011-Credit Suisse Hedging-Griffo Corretora de Valores S.A., 012-Banco Inbursa S.A., 014-Natixis Brasil S.A. Banco Múltiplo … (168) |  |
| `account_type` | Tipo | select |  |  | Corrente, Poupança |  |
| `agency` | Agência | text |  | 13 |  |  |
| `account` | Conta | text |  | 18 |  |  |
| `pix_type` | Tipo chave Pix | select |  |  | CPF/CNPJ, Telefone, Email, Aleatória |  |
| `pix` | Pix | text |  |  |  |  |
| `branch_name[]` | Nome | text |  | 100 |  |  |
| `branch_nif[]` | CPF/CNPJ | text |  |  |  |  |
| `branch_state_registration[]` | Insc. Estadual | text |  | 40 |  |  |
| `branch_zip_code[]` | CEP | text |  |  |  |  |
| `branch_city_id[]` | Cidade | select |  |  |  |  |
| `branch_address[]` | Endereço | text |  |  |  |  |
| `seller_name[]` | Nome | text |  |  |  |  |
| `seller_email[]` | Email | email |  |  |  |  |
| `seller_phone[]` | Telefone | text |  |  |  |  |

- Mensagens/alertas: Não dependa só do Plano Safra, acesse mais e melhor crédito! Na Creditares te conectamos a vários financiadores simultan

## SCR-326 · Clientes

- **Rota:** `/admin/clients/report`
- **Módulo:** Cadastros Base > Pessoas > Clientes
- **Tipo:** Relatório
- **Finalidade:** Clientes (relatório)
- **Cards/Seções:** 

## SCR-327 · Inscrições Estaduais

- **Rota:** `/admin/clients/create`
- **Módulo:** Cadastros Base > Pessoas > Clientes
- **Tipo:** Cadastro (novo)
- **Finalidade:** Clientes (cadastro (novo))
- **Botões/Ações (cabeçalho):** Voltar → `/admin/clients`

**Tabela** — linhas na amostra: 1

- Colunas: (seleção) | Insc. Estadual

**Formulário POST `/admin/clients`** — botões: Salvar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `nif` | CPF/CNPJ | text | R |  |  |  |
| `nickname` | Razão Social | text | R | 60 |  |  |
| `name` | Nome Fantasia | text | R | 30 |  |  |
| `email` | Email | email | R | 60 |  |  |
| `city_registration` | Insc. Municipal | text |  | 20 |  |  |
| `phone` | Telefone | text | R |  |  |  |
| `cellphone` | Celular | text |  |  |  |  |
| `contact` | Contato | text |  |  |  |  |
| `contact_phone` | Tel. do contato | text |  |  |  |  |
| `zip_code` | CEP | text | R |  |  |  |
| `address` | Endereço | text | R | 60 |  |  |
| `number` | Número | text | R | 60 |  |  |
| `district` | Bairro | text | R | 60 |  |  |
| `city_id` | Cidade | select | R |  |  |  |
| `is_enabled` | Ativo | select | R |  | Sim, Não |  |
| `final_costumer` | Consumidor Final | select | R |  | Não, Sim |  |
| `taxpayer` | Contribuinte | select | R |  | Sim, Não |  |
| `code_country` | Pais | select | R |  | 132 - Afeganistão, 7560 - África do Sul, 175 - Albânia, República da, 230 - Alemanha, 370 - Andorra Sim, 400 - Angola, 418 - Anguilla Sim, 434 - Antigua e Barbuda Sim … (239) |  |
| `id_abroad` | ID estrangeiro | text |  | 20 |  |  |
| `farm_name` | Nome da Fazenda | text |  | 100 |  |  |
| `state_registrations[]` |  | text |  |  |  |  |

## SCR-328 · Clientes

- **Rota:** `/admin/clients/627`
- **Módulo:** Cadastros Base > Pessoas > Clientes
- **Tipo:** Detalhe
- **Finalidade:** Clientes (detalhe)
- **Botões/Ações (cabeçalho):** Voltar → `/admin/clients`

## SCR-329 · Inscrições Estaduais

- **Rota:** `/admin/clients/627/edit`
- **Módulo:** Cadastros Base > Pessoas > Clientes
- **Tipo:** Cadastro (edição)
- **Finalidade:** Clientes (cadastro (edição))
- **Botões/Ações (cabeçalho):** Voltar → `/admin/clients`

**Tabela** — linhas na amostra: 1

- Colunas: (seleção) | Insc. Estadual

**Formulário PUT `/admin/clients/627`** — botões: Salvar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `nif` | CPF/CNPJ | text | R |  |  |  |
| `nickname` | Razão Social | text | R | 60 |  |  |
| `name` | Nome Fantasia | text | R | 30 |  |  |
| `email` | Email | email | R | 60 |  |  |
| `city_registration` | Insc. Municipal | text |  | 20 |  |  |
| `phone` | Telefone | text | R |  |  |  |
| `cellphone` | Celular | text |  |  |  |  |
| `contact` | Contato | text |  |  |  |  |
| `contact_phone` | Tel. do contato | text |  |  |  |  |
| `zip_code` | CEP | text | R |  |  |  |
| `address` | Endereço | text | R | 60 |  |  |
| `number` | Número | text | R | 60 |  |  |
| `district` | Bairro | text | R | 60 |  |  |
| `city_id` | Cidade | select | R |  | Palmas - TO |  |
| `is_enabled` | Ativo | select | R |  | Sim, Não |  |
| `final_costumer` | Consumidor Final | select | R |  | Não, Sim |  |
| `taxpayer` | Contribuinte | select | R |  | Sim, Não |  |
| `code_country` | Pais | select | R |  | 132 - Afeganistão, 7560 - África do Sul, 175 - Albânia, República da, 230 - Alemanha, 370 - Andorra Sim, 400 - Angola, 418 - Anguilla Sim, 434 - Antigua e Barbuda Sim … (239) |  |
| `id_abroad` | ID estrangeiro | text |  | 20 |  |  |
| `farm_name` | Nome da Fazenda | text |  | 100 |  |  |
| `state_registrations[]` |  | text |  |  |  |  |

## SCR-330 · Regras de Autorização

- **Rota:** `/admin/authorizers/create`
- **Módulo:** Cadastros Base > Pessoas > Autorizadores
- **Tipo:** Cadastro (novo)
- **Finalidade:** Autorizadores (cadastro (novo))
- **Botões/Ações (cabeçalho):** Voltar → `/admin/authorizers`

**Tabela** — linhas na amostra: 1

- Colunas: (seleção) | Fazenda | Nível

**Formulário POST `/admin/authorizers`** — botões: Salvar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `user_id` | Usuário | select | R |  | (lista dinâmica de cadastro — 14 registros; valores omitidos por privacidade) … (14) |  |
| `max_value` | Até | text (moeda) | R |  |  |  |
| `is_active` | Ativo | select | R |  | Sim, Não |  |
| `is_conditional` | Autorizador Condicional | select | R |  | (lista dinâmica de cadastro — 2 registros; valores omitidos por privacidade) | Se marcado como "Sim", este autorizador só será acionado quando as regras de autorização definidas abaixo forem atendidas (ex: fazenda, tipo de solicitação, val |
| `expense_organizer` | Ordenador de Despesas? | select | R |  | Não, Sim | Se marcado como "Sim", este autorizador terá acesso ao bloco de Rateio ao aprovar a solicitação, podendo definir a classificação (CAPEX/OPEX), centro de custo e |
| `number_quotes` | Quantidade Mínima de cotações | number | R |  |  |  |
| `last_update` | Data de Criação | text |  |  |  |  |
| `auth` | Responsável | text |  |  |  |  |
| `rules[0][type]` | Tipo | select |  |  | Tipo de Chamado |  |
| `rules[0][value]` | Valor | select |  |  | Todos, Produto, Serviço, Adiantamento, Reembolso, Diária, Empreita, Compra Efetuada … (12) |  |
| `rules[0][apply_on]` | Aplica | select |  |  | Antes da Cotação, Depois da Cotação |  |
| `farms[]` |  | select | R |  | Fazenda Maira, Fazenda São Paulo |  |
| `levels[]` |  | select | R |  | 1, 2, 3, 4 | Define a ordem de aprovação deste autorizador para a fazenda selecionada. Quando o valor da solicitação ultrapassa o limite do nível atual, ela é escalada autom |

## SCR-331 · Autorizadores

- **Rota:** `/admin/authorizers/433`
- **Módulo:** Cadastros Base > Pessoas > Autorizadores
- **Tipo:** Detalhe
- **Finalidade:** Autorizadores (detalhe)
- **Botões/Ações (cabeçalho):** Voltar → `/admin/authorizers`

## SCR-332 · Regras de Autorização

- **Rota:** `/admin/authorizers/433/edit`
- **Módulo:** Cadastros Base > Pessoas > Autorizadores
- **Tipo:** Cadastro (edição)
- **Finalidade:** Autorizadores (cadastro (edição))
- **Botões/Ações (cabeçalho):** Voltar → `/admin/authorizers`

**Tabela** — linhas na amostra: 1

- Colunas: (seleção) | Fazenda | Nível

**Formulário PUT `/admin/authorizers/433`** — botões: Salvar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `user_id` | Usuário | select | R |  | (lista dinâmica de cadastro — 14 registros; valores omitidos por privacidade) … (14) |  |
| `max_value` | Até | text (moeda) | R |  |  |  |
| `is_active` | Ativo | select | R |  | Sim, Não |  |
| `is_conditional` | Autorizador Condicional | select | R |  | (lista dinâmica de cadastro — 2 registros; valores omitidos por privacidade) | Se marcado como "Sim", este autorizador só será acionado quando as regras de autorização definidas abaixo forem atendidas (ex: fazenda, tipo de solicitação, val |
| `expense_organizer` | Ordenador de Despesas? | select | R |  | Não, Sim | Se marcado como "Sim", este autorizador terá acesso ao bloco de Rateio ao aprovar a solicitação, podendo definir a classificação (CAPEX/OPEX), centro de custo e |
| `number_quotes` | Quantidade Mínima de cotações | number | R |  |  |  |
| `last_update` | Última atualização | text |  |  |  |  |
| `auth` | Responsável | text |  |  |  |  |
| `rules[0][type]` | Tipo | select |  |  | Tipo de Chamado |  |
| `rules[0][value]` | Valor | select |  |  | Todos, Produto, Serviço, Adiantamento, Reembolso, Diária, Empreita, Compra Efetuada … (12) |  |
| `rules[0][apply_on]` | Aplica | select |  |  | Antes da Cotação, Depois da Cotação |  |
| `farms[]` |  | select | R |  | Fazenda Maira, Fazenda São Paulo |  |
| `levels[]` |  | select | R |  | 1, 2, 3, 4 | Define a ordem de aprovação deste autorizador para a fazenda selecionada. Quando o valor da solicitação ultrapassa o limite do nível atual, ela é escalada autom |

## SCR-333 · Conta Bancaria

- **Rota:** `/admin/accounts/create`
- **Módulo:** Cadastros Base > Financeiros > Contas Bancárias
- **Tipo:** Cadastro (novo)
- **Finalidade:** Contas Bancárias (cadastro (novo))
- **Botões/Ações (cabeçalho):** Voltar → `/admin/accounts`

**Formulário POST `/admin/accounts`** — botões: Salvar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `bank` | Banco | select | R |  | 001-Banco do Brasil S.A., 003-Banco da Amazônia S.A., 004-Banco do Nordeste do Brasil S.A., 007-Banco Nacional de Desenvolvimento Econômico e Social - BNDES, 010-CREDICOAMO Crédito Rural Cooperativa, 011-Credit Suisse Hedging-Griffo Corretora de Valores S.A., 012-Banco Inbursa S.A., 014-Natixis Brasil S.A. Banco Múltiplo … (168) |  |
| `agency` | Agência | text | R | 6 |  |  |
| `account` | Conta | text | R | 20 |  |  |
| `use_cash_book` | Usa no Livro Caixa | select | R |  | Sim, Não | Indica se a conta deve ser considerada no livro caixa. \n Contas que não são usadas no livro caixa geralmente são contas de controle ou contas que não represent |
| `type` | Tipo | select | R |  | Conta Corrente, Conta Poupança, Aplicação Financeira, Caixa Interno (Espécie) |  |
| `code` | Sigla | text | R | 4 |  | Sigla para fins de organização e identificação da conta \n \n Exemplo: BB, CX... |
| `description` | Descrição | text | R | 40 |  |  |
| `is_ticket` | Emite Boleto | select | R |  | Sim, Não | Indica se a conta emite boleto ou não. \n Se sim, os campos de contrato, convênio e tipo de boleto se tornam obrigatórios. \n Lista de bancos que permitem emiss |
| `proprietaries[]` | Proprietários | select (múltiplo) |  |  | (lista dinâmica de cadastro — 1 registros; valores omitidos por privacidade) |  |
| `limit` | Limite | text (moeda) | R |  |  |  |
| `is_enabled` | Ativo | select | R |  | Sim, Não |  |
| `bank_contract` | Carteira | tel |  | 8 |  |  |
| `bank_agreement` | Convênio/Cod. Beneficiário | tel |  | 8 |  |  |
| `type_cnab` | Tipo do boleto | select |  |  | CNAB 240, CNAB 400 | CNAB 240 e 400 são formatos de arquivos padronizados pela FEBRABAN para troca de informações entre empresas e bancos, principalmente em relação a cobranças e pa |
| `investment_account_id` | Conta Investimento Vinculada | select |  |  | 000 - INVESTIMENTO 1 | Conta de investimento vinculada à conta principal |
| `farms[]` | Fazendas | select (múltiplo) |  |  | Fazenda Maira, Fazenda São Paulo |  |

## SCR-334 · Contas Bancárias

- **Rota:** `/admin/accounts/524`
- **Módulo:** Cadastros Base > Financeiros > Contas Bancárias
- **Tipo:** Detalhe
- **Finalidade:** Contas Bancárias (detalhe)
- **Botões/Ações (cabeçalho):** Voltar → `/admin/accounts`

## SCR-335 · Contas Bancárias

- **Rota:** `/admin/accounts/524/edit`
- **Módulo:** Cadastros Base > Financeiros > Contas Bancárias
- **Tipo:** Cadastro (edição)
- **Finalidade:** Contas Bancárias (cadastro (edição))
- **Botões/Ações (cabeçalho):** Voltar → `/admin/accounts`

**Formulário PUT `/admin/accounts/524`** — botões: Salvar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `bank` | Banco | select | R |  | 001-Banco do Brasil S.A., 003-Banco da Amazônia S.A., 004-Banco do Nordeste do Brasil S.A., 007-Banco Nacional de Desenvolvimento Econômico e Social - BNDES, 010-CREDICOAMO Crédito Rural Cooperativa, 011-Credit Suisse Hedging-Griffo Corretora de Valores S.A., 012-Banco Inbursa S.A., 014-Natixis Brasil S.A. Banco Múltiplo … (169) |  |
| `agency` | Agência | text | R | 6 |  |  |
| `account` | Conta | text | R | 20 |  |  |
| `use_cash_book` | Usa no Livro Caixa | select | R |  | Sim, Não | Indica se a conta deve ser considerada no livro caixa. \n Contas que não são usadas no livro caixa geralmente são contas de controle ou contas que não represent |
| `type` | Tipo | select | R |  | Conta Corrente, Conta Poupança, Aplicação Financeira, Caixa Interno (Espécie) |  |
| `code` | Sigla | text | R | 4 |  | Sigla para fins de organização e identificação da conta \n \n Exemplo: BB, CX... |
| `description` | Descrição | text | R | 40 |  |  |
| `is_ticket` | Emite Boleto | select | R |  | Sim, Não | Indica se a conta emite boleto ou não. \n Se sim, os campos de contrato, convênio e tipo de boleto se tornam obrigatórios. \n Lista de bancos que permitem emiss |
| `proprietaries[]` | Proprietários | select (múltiplo) |  |  | (lista dinâmica de cadastro — 1 registros; valores omitidos por privacidade) |  |
| `limit` | Limite | text (moeda) | R |  |  |  |
| `is_enabled` | Ativo | select | R |  | Sim, Não |  |
| `bank_contract` | Carteira | tel |  | 8 |  |  |
| `bank_agreement` | Convênio/Cod. Beneficiário | tel |  | 8 |  |  |
| `type_cnab` | Tipo do boleto | select |  |  | CNAB 240, CNAB 400 | CNAB 240 e 400 são formatos de arquivos padronizados pela FEBRABAN para troca de informações entre empresas e bancos, principalmente em relação a cobranças e pa |
| `investment_account_id` | Conta Investimento Vinculada | select |  |  | 000 - INVESTIMENTO 1 | Conta de investimento vinculada à conta principal |
| `farms[]` | Fazendas | select (múltiplo) |  |  | Fazenda Maira, Fazenda São Paulo |  |

## SCR-336 · Saldo Inicial- Contas

- **Rota:** `/admin/open-movements/create`
- **Módulo:** Cadastros Base > Financeiros > Saldo Inicial
- **Tipo:** Cadastro (novo)
- **Finalidade:** Saldo Inicial (cadastro (novo))
- **Botões/Ações (cabeçalho):** Voltar → `/admin/open-movements`

**Tabela** — linhas na amostra: 1

- Colunas: (seleção) | Categoria | Centro de Custo | Valor
- Totalizador: Total 0

**Formulário POST `/admin/open-movements`**

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `account_id` | Conta Bancária | select | R |  | CXF - 000 - Caixa Fazenda - 01, CXF1 - 000 - Caixa Fazenda - 02, CXF - 000 - Caixa Fazenda - 03, CXF - 000 - INVESTIMENTO 1, 0013 - 56, BB - BB Principal |  |
| `type` | Tipo | select | R |  | Entrada |  |
| `type_category` | Tp. Categoria | select | R |  | Saldo Inicial |  |
| `proprietary_id` | Proprietário Gestor | select | R |  | (lista dinâmica de cadastro — 1 registros; valores omitidos por privacidade) |  |
| `date` | Dt. Movimento | text | R |  |  |  |
| `value` | Valor R$ | text | R |  |  |  |
| `interest` | Juros R$ | text (moeda) |  |  |  |  |
| `document` | Documento | text |  | 100 |  |  |
| `note` | Histórico | text |  | 40 |  |  |
| `categories[]` |  | select |  |  |  |  |
| `centers[]` |  | select | R |  | Administração, Estoque Insumos, Estoque Produção, Parque Máquinas, Soja, Soja Precoce, Soja Super Precoce, Terminação - Corte |  |
| `category_values[]` |  | text (moeda) | R |  |  |  |

## SCR-337 · Categoria Financeira

- **Rota:** `/admin/financialcategories/325`
- **Módulo:** Cadastros Base > Financeiros > Categorias Financeiras
- **Tipo:** Detalhe
- **Finalidade:** Categorias Financeiras (detalhe)
- **Botões/Ações (cabeçalho):** Voltar → `/admin/financialcategories`

## SCR-338 · Categoria Financeira

- **Rota:** `/admin/financialcategories/9664/edit`
- **Módulo:** Cadastros Base > Financeiros > Categorias Financeiras
- **Tipo:** Cadastro (edição)
- **Finalidade:** Categorias Financeiras (cadastro (edição))
- **Botões/Ações (cabeçalho):** Voltar → `/admin/financialcategories`

**Formulário PUT `/admin/financialcategories/9664`** — botões: Salvar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `description` | Descrição | text | R | 120 |  |  |
| `is_enabled` | Ativo | select | R |  | Sim, Não |  |
| `deductible` | Dedutível | select | R |  | Sim, Não |  |
| `type_id` | Tipo Categoria | select | R |  | Saidas, Entradas, Ambas |  |
| `classification` | Classificação | select | R |  | Não Classificado, CAPEX, OPEX |  |
| `grouper_id` | Agrupador | select (múltiplo) |  |  | Receita Bruta - RB, Custo Operacional Efetivo - COE, Custo Operacional Total - COT, Custo Total - CT, Investimentos - I, Financiamentos Empréstimos Aportes_FEA, Movimentação Interna_MI, Outras Receitas Operacionais_ ORO … (14) |  |
| `centers[]` | Centro de Custo | select (múltiplo) |  |  | Administração, Agricultura, Fruticultura, Hortifrutigranjeiro, Pecuária de Corte, Pecuária de Leite, Ovinocultura de Corte, Caprinocultura … (23) |  |
| `parent_id` | Antecessor | select | R |  | Não Contém, 1.01.003 - RECEITAS DA PECUÁRIA |  |

## SCR-339 · Você já atingiu o limite de emissores.

- **Rota:** `/admin/issue/create`
- **Módulo:** Cadastros Base > Fiscais > Emissores NFe
- **Tipo:** Cadastro (novo)
- **Finalidade:** Emissores NFe (cadastro (novo))
- **Acesso:** restrito para o usuário auditado ("Acesso Restrito!")

## SCR-340 · Inscrições Estaduais

- **Rota:** `/admin/issue/8/edit`
- **Módulo:** Cadastros Base > Fiscais > Emissores NFe
- **Tipo:** Cadastro (edição)
- **Finalidade:** Emissores NFe (cadastro (edição))
- **Botões/Ações (cabeçalho):** Voltar → `/admin/issue`

**Tabela** — linhas na amostra: 1

- Colunas: (seleção) | Insc. Estadual

**Tabela** — linhas na amostra: 1

- Colunas: (seleção) | Núm. série NFe | Último Número NFe

**Formulário PUT `/admin/issue/8`** — botões: Salvar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `image` |  | file |  |  |  |  |
| `cpf_cnpj` | CPF/CNPJ | text | R |  |  |  |
| `razao_social` | Razão Social | text | R | 80 |  |  |
| `is_enabled` | Ativo | select | R |  | Sim, Não |  |
| `nome_fantasia` | Nome Fantasia | text | R | 80 |  |  |
| `email` | Email | email | R |  |  |  |
| `cep` | CEP | text | R |  |  |  |
| `telefone` | Telefone | text | R |  |  |  |
| `cidade_id` | Cidade | select | R |  | Dianópolis - TO |  |
| `rua` | Rua | text | R |  |  |  |
| `numero` | Número | text | R |  |  |  |
| `bairro` | Bairro | text | R |  |  |  |
| `issues_nfe` | Emite NFe? | select | R |  | Sim, Não |  |
| `ultimo_numero_cte` | Último Número CTe | text | R |  |  |  |
| `ultimo_numero_mdfe` | Último Número MDFe | text | R |  |  |  |
| `numero_serie_cte` | Núm. série CTe | text | R |  |  |  |
| `numero_serie_mdfe` | Núm. série MDFe | text | R |  |  |  |
| `ambiente` | Ambiente | select | R |  | Produção, Homologação |  |
| `regime` | Regime | select | R |  | Simples, Normal |  |
| `aut_xml` | Aut. XML (CNPJ) | text |  |  |  |  |
| `cnae` | CNAE | text |  | 7 |  |  |
| `sped_profile` | Perfil de Apresentação (SPED) | select |  |  | A, B, C |  |
| `farms[]` | Fazendas | select (múltiplo) |  |  | Fazenda Maira, Fazenda São Paulo |  |
| `numbers[]` |  | text | R |  |  |  |
| `nfe_series_numero[]` |  | text | R |  |  |  |
| `nfe_series_ultimo[]` |  | text | R |  |  |  |

## SCR-341 · Sincronização DFe

- **Rota:** `/admin/issue-dfe-sync-time/create`
- **Módulo:** Cadastros Base > Fiscais > Sinc. DFe
- **Tipo:** Cadastro (novo)
- **Finalidade:** Sinc. DFe (cadastro (novo))
- **Botões/Ações (cabeçalho):** Voltar → `/admin/issue-dfe-sync-time`

**Formulário POST `/admin/issue-dfe-sync-time`** — botões: Salvar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `issue_id` | Emissor | select | R |  | AGRO365 SERV. E COM. LTDA |  |
| `sync_hour` | Hora da Sincronização | select | R |  | 19:00, 20:00, 21:00, 22:00, 23:00, 00:00, 01:00, 02:00 … (13) |  |

## SCR-342 · Sincronização NFS-e

- **Rota:** `/admin/issue-nfse-sync-time/create`
- **Módulo:** Cadastros Base > Fiscais > Sinc. NFS-e
- **Tipo:** Cadastro (novo)
- **Finalidade:** Sinc. NFS-e (cadastro (novo))
- **Botões/Ações (cabeçalho):** Voltar → `/admin/issue-nfse-sync-time`

**Formulário POST `/admin/issue-nfse-sync-time`** — botões: Salvar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `issue_id` | Emissor | select | R |  | AGRO365 SERV. E COM. LTDA |  |
| `sync_hour` | Hora da Sincronização | select | R |  | 19:00, 20:00, 21:00, 22:00, 23:00, 00:00, 01:00, 02:00 … (13) |  |

## SCR-343 · Regras Fiscais

- **Rota:** `/admin/tax-rules/create`
- **Módulo:** Cadastros Base > Fiscais > Regras Fiscais
- **Tipo:** Cadastro (novo)
- **Finalidade:** Regras Fiscais (cadastro (novo))
- **Botões/Ações (cabeçalho):** Voltar → `/admin/tax-rules`

**Formulário POST `/admin/tax-rules`** — botões: Salvar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `name` | Descrição | text | R | 100 |  |  |
| `is_enabled` | Ativo | select | R |  | Sim, Não |  |
| `cbenef` | Código de Benefício Fiscal | text |  |  |  |  |
| `cfop_saida_interno` | CFOP Saída Interno | text | R |  |  |  |
| `cfop_saida_externo` | CFOP Saída Externo | text | R |  |  |  |
| `cst_csosn` | CST/CSOSN Padrão | select | R |  | 00 - Tributa integralmente, 10 - Tributada e com cobrança do ICMS por substituição tributária, 20 - Com redução da Base de Calculo, 30 - Isenta / não tributada e com cobrança do ICMS por substituição tributária, 40 - Isenta, 41 - Não tributada, 50 - Com suspensão, 51 - Com diferimento … (21) |  |
| `cst_pis` | CST/COFINS Padrão | select | R |  | 01 - Operação Tributável - Base de Cálculo = Valor da Operação Alíquota Normal (Cumulativo/Não Cumulativo), 02 - Operação Tributável - Base de Calculo = Valor da Operação (Alíquota Diferenciada), 03 - Operação Tributável - Base de Calculo = Quantidade Vendida x Alíquota por Unidade de Produto;, 04 - Operação Tributável - Tributação Monofásica - (Alíquota Zero);, 06 - Operação Tributável - Alíquota Zero;, 07 - Operação Isenta da contribuição;, 08 - Operação Sem Incidência da contribuição;, 09 - Operação com suspensão da contribuição; … (32) |  |
| `cst_cofins` | CST/PIS | select | R |  | 01 - Operação Tributável - Base de Cálculo = Valor da Operação Alíquota Normal (Cumulativo/Não Cumulativo), 02 - Operação Tributável - Base de Calculo = Valor da Operação (Alíquota Diferenciada), 03 - Operação Tributável - Base de Calculo = Quantidade Vendida x Alíquota por Unidade de Produto;, 04 - Operação Tributável - Tributação Monofásica - (Alíquota Zero);, 06 - Operação Tributável - Alíquota Zero;, 07 - Operação Isenta da contribuição;, 08 - Operação Sem Incidência da contribuição;, 09 - Operação com suspensão da contribuição; … (32) |  |
| `cst_ipi` | CST/IPI | select | R |  | 00 - Entrada com Recuperação de Crédito, 01 - Entrada Tributável com Alíquota Zero, 02 - Entrada Isenta, 03 - Entrada Não Tributada, 04 - Entrada Imune, 05 - Entrada com Suspensão, 49 - Outras Operações de Entrada, 50 - Saída Tributada … (14) |  |
| `cenq_ipi` | Código Enquadramento IPI | select | R |  | 001 - Imunidade - Livros, jornais, periódicos e o papel destinado à sua impressão - Art. 18 Inciso I do Decreto 7.212/2010, 002 - Imunidade - Produtos industrializados destinados ao exterior - Art. 18 Inciso II do Decreto 7.212/2010, 003 - Imunidade - Ouro, definido em lei como ativo financeiro ou instrumento cambial - Art. 18 Inciso III do Decreto 7.212/2010, 004 - Imunidade - Energia elétrica, derivados de petróleo, combustíveis e minerais do País - Art. 18 Inciso IV do Decreto 7.212/2010, 005 - Imunidade - Exportação de produtos nacionais - sem saída do território brasileiro - venda para empresa sediada no exterior - atividades de pesquisa ou lavra de jazidas de petróleo e de gás natural- Art. 19 Inciso I do Decreto 7.212/2010, 006 - Imunidade - Exportação de produtos nacionais - sem saída do território brasileiro - venda para empresa sediada no exterior - incorporados a produto final exportado para o Brasil - Art. 19 Inciso II do Decreto 7.212/2010, 007 - Imunidade - Exportação de produtos nacionais - sem saída do território brasileiro - venda para órgão ou entidade de governo estrangeiro ou organismo internacional de que o Brasil seja membro,para ser entregue, no País, à ordem do comprador - Art. 19 Inciso III do Decreto 7.212/2010, 101 - Suspensão - Óleo de menta em bruto, produzido por lavradores - Art. 43 Inciso I do Decreto 7.212/2010 … (132) |  |
| `perc_icms` | %ICMS | text | R |  |  |  |
| `perc_pis` | %PIS | text | R |  |  |  |
| `perc_cofins` | %COFINS | text | R |  |  |  |
| `perc_ipi` | %IPI | text |  |  |  |  |
| `cest` | CEST | text |  | 10 |  |  |
| `percent_reduction` | Perc. Redução de BC | text | R |  |  |  |
| `modality_bc` | Modalidade da BC do ICMS | select | R |  | 0 - Margem Valor Agregado (%), 1 - Pauta (Valor), 2 - Preço Tabelado Máx. (valor), 3 - Valor da operação |  |
| `origem` | Origem | select | R |  | 0 - NACIONAL, 1 - ESTRANGEIRA - IMPORTAÇÃO DIRETA, 2 - ESTRANGEIRA - ADQUIRIDA NO MERCADO INTERNO, 3 - NACIONAL, MERCADORIA OU BEM COM CONTEÚDO DE IMPORTAÇÃO SUPERIOR A 40%, 4 - NACIONAL, CUJA PRODUÇÃO TENHA SIDO FEITA EM CONFORMIDADE COM OS PROCESSOS PRODUTIVOS BÁSICOS DE QUE TRATAM O DECRETO-LEI Nº 288/67, E AS LEIS NºS 8.248/91, 8.387/91, 10.176/01 E 11 . 4 8 4 / 0 7, 5 - NACIONAL, MERCADORIA OU BEM COM CONTEÚDO DE IMPORTAÇÃO INFERIOR OU IGUAL A 40%, 6 - ESTRANGEIRA - IMPORTAÇÃO DIRETA, SEM SIMILAR NACIONAL, CONSTANTE EM LISTA DE RESOLUÇÃO CAMEX, 7 - ESTRANGEIRA - ADQUIRIDA NO MERCADO INTERNO, SEM SIMILAR NACIONAL, CONSTANTE EM LISTA DE RESOLUÇÃO CAMEX … (9) |  |
| `cst_csosn_exp` | CST/CSOSN Exportação | select |  |  | 00 - Tributa integralmente, 10 - Tributada e com cobrança do ICMS por substituição tributária, 20 - Com redução da Base de Calculo, 30 - Isenta / não tributada e com cobrança do ICMS por substituição tributária, 40 - Isenta, 41 - Não tributada, 50 - Com suspensão, 51 - Com diferimento … (21) |  |
| `c_class_trib` | Código Classificação Tributária | text |  | 6 |  |  |
| `cst_ibs_cbs` | CST IBS/CBS | select |  |  | 000 - Tributação integral, 010 - Tributação com alíquotas uniformes, 011 - Tributação com alíquotas uniformes reduzidas, 200 - Alíquota reduzida, 220 - Alíquota fixa, 221 - Alíquota fixa proporcional, 222 - Redução de Base de Cálculo, 400 - Isenção … (18) |  |
| `perc_ibs_uf` | % IBS UF | text |  |  |  |  |
| `perc_ibs_mun` | % IBS Município | text |  |  |  |  |
| `perc_reducao_aliq_ibs_uf` | % Redução IBS UF | text |  |  |  |  |
| `perc_reducao_aliq_ibs_mun` | % Redução IBS Mun | text |  |  |  |  |
| `perc_dif_ibs_uf` | % Diferimento IBS UF | text |  |  |  |  |
| `perc_dif_ibs_mun` | % Diferimento IBS Município | text |  |  |  |  |
| `perc_cbs` | % CBS | text |  |  |  |  |
| `perc_reducao_aliq_cbs` | % Redução CBS | text |  |  |  |  |
| `perc_dif_cbs` | % Diferimento CBS | text |  |  |  |  |
| `cst_is` | CST IS | text |  | 3 |  |  |
| `perc_is` | % Imposto Seletivo | text |  |  |  |  |
| `perc_is_espec` | Alíq. Específica IS (R$) | text (moeda) |  |  |  |  |
| `ad_rem_ibs` | Alíq. Ad Rem IBS (R$/un) | text (moeda) |  |  |  |  |
| `ad_rem_cbs` | Alíq. Ad Rem CBS (R$/un) | text (moeda) |  |  |  |  |
| `tp_cred_pres_ibs_zfm` | Crédito Presumido ZFM | select |  |  | Não se aplica, 0 - Sem Crédito Presumido, 1 - Bens de consumo final (55%), 2 - Bens de capital (75%), 3 - Bens intermediários (90,25%), 4 - Bens de informática (100%) |  |
| `ind_doacao` | Operação de Doação | select |  |  | Não, Sim |  |

## SCR-344 · Novo Contador

- **Rota:** `/admin/contador/create`
- **Módulo:** Cadastros Base > Fiscais > Contador
- **Tipo:** Cadastro (novo)
- **Finalidade:** Contador (cadastro (novo))
- **Botões/Ações (cabeçalho):** Voltar → `/admin/contador`

**Formulário POST `/admin/contador`** — botões: Salvar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `cnpj` | CPF/CNPJ | text | R |  |  |  |
| `razao_social` | Razão Social | text | R | 80 |  |  |
| `nome_fantasia` | Nome Fantasia | text | R | 80 |  |  |
| `ie` | Insc. Estadual | text | R | 80 |  |  |
| `email` | Email | email | R |  |  |  |
| `fone` | Telefone | text | R |  |  |  |
| `cep` | CEP | text | R |  |  |  |
| `rua` | Rua | text | R |  |  |  |
| `numero` | Número | text | R |  |  |  |
| `bairro` | Bairro | text | R |  |  |  |
| `cidade_id` | Cidade | select | R |  |  |  |
| `auto_send` | Envio automático do XML | select | R |  | Sim, Não | Se marcado como sim, os XML das DFe serão enviadas automaticamentes ao email do contador |
| `issue[]` | Emissor | select (múltiplo) |  |  | AGRO365 SERV. E COM. LTDA |  |

## SCR-345 · Natureza de Operaçao

- **Rota:** `/admin/natureoperations/create`
- **Módulo:** Cadastros Base > Fiscais > Natureza Op.
- **Tipo:** Cadastro (novo)
- **Finalidade:** Natureza Op. (cadastro (novo))
- **Botões/Ações (cabeçalho):** Voltar → `/admin/natureoperations`

**Formulário POST `/admin/natureoperations`** — botões: Salvar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `descricao` | Descrição | text | R | 60 |  |  |
| `tipo` | Tipo | select | R |  | Saída, Entrada |  |
| `cfop_saida_interno` | CFOP saída interno | text | R | 4 |  |  |
| `cfop_saida_externo` | CFOP saída externo | text | R | 4 |  |  |
| `cfop_entrada_interno` | CFOP entrada interno | text | R | 4 |  |  |
| `cfop_entrada_externo` | CFOP entrada externo | text | R | 4 |  |  |
| `cfop_saida_exportacao` | CFOP saída exportação | text |  | 4 |  |  |
| `cfop_entrada_exportacao` | CFOP entrada exportação | text |  | 4 |  |  |
| `ativo` | Ativo | select | R |  | Sim, Não |  |
| `sobrescreve_cfop_produto` | Sobrescreve CFOP do produto | select | R |  | Não, Sim |  |
| `overwrite_product` | Sobrescrever Informações do produto | select | R |  | Não, Sim |  |
| `generate_financial` | Não gerar financeiro | checkbox |  |  |  |  |
| `automatic_calculation` | Cálculo ICMS automático | checkbox |  |  |  |  |
| `tax_rule_id` | Regra Fiscal | select |  |  |  |  |
| `cst_csosn` | CST/CSOSN Padrão | select | R |  | 00 - Tributa integralmente, 10 - Tributada e com cobrança do ICMS por substituição tributária, 20 - Com redução da Base de Calculo, 30 - Isenta / não tributada e com cobrança do ICMS por substituição tributária, 40 - Isenta, 41 - Não tributada, 50 - Com suspensão, 51 - Com diferimento … (21) |  |
| `cst_pis` | CST/COFINS Padrão | select | R |  | 01 - Operação Tributável - Base de Cálculo = Valor da Operação Alíquota Normal (Cumulativo/Não Cumulativo), 02 - Operação Tributável - Base de Calculo = Valor da Operação (Alíquota Diferenciada), 03 - Operação Tributável - Base de Calculo = Quantidade Vendida x Alíquota por Unidade de Produto;, 04 - Operação Tributável - Tributação Monofásica - (Alíquota Zero);, 06 - Operação Tributável - Alíquota Zero;, 07 - Operação Isenta da contribuição;, 08 - Operação Sem Incidência da contribuição;, 09 - Operação com suspensão da contribuição; … (32) |  |
| `cst_cofins` | CST/PIS | select | R |  | 01 - Operação Tributável - Base de Cálculo = Valor da Operação Alíquota Normal (Cumulativo/Não Cumulativo), 02 - Operação Tributável - Base de Calculo = Valor da Operação (Alíquota Diferenciada), 03 - Operação Tributável - Base de Calculo = Quantidade Vendida x Alíquota por Unidade de Produto;, 04 - Operação Tributável - Tributação Monofásica - (Alíquota Zero);, 06 - Operação Tributável - Alíquota Zero;, 07 - Operação Isenta da contribuição;, 08 - Operação Sem Incidência da contribuição;, 09 - Operação com suspensão da contribuição; … (32) |  |
| `cst_ipi` | CST/IPI | select | R |  | 00 - Entrada com Recuperação de Crédito, 01 - Entrada Tributável com Alíquota Zero, 02 - Entrada Isenta, 03 - Entrada Não Tributada, 04 - Entrada Imune, 05 - Entrada com Suspensão, 49 - Outras Operações de Entrada, 50 - Saída Tributada … (14) |  |
| `cenq_ipi` | Código Enquadramento IPI | select | R |  | 001 - Imunidade - Livros, jornais, periódicos e o papel destinado à sua impressão - Art. 18 Inciso I do Decreto 7.212/2010, 002 - Imunidade - Produtos industrializados destinados ao exterior - Art. 18 Inciso II do Decreto 7.212/2010, 003 - Imunidade - Ouro, definido em lei como ativo financeiro ou instrumento cambial - Art. 18 Inciso III do Decreto 7.212/2010, 004 - Imunidade - Energia elétrica, derivados de petróleo, combustíveis e minerais do País - Art. 18 Inciso IV do Decreto 7.212/2010, 005 - Imunidade - Exportação de produtos nacionais - sem saída do território brasileiro - venda para empresa sediada no exterior - atividades de pesquisa ou lavra de jazidas de petróleo e de gás natural- Art. 19 Inciso I do Decreto 7.212/2010, 006 - Imunidade - Exportação de produtos nacionais - sem saída do território brasileiro - venda para empresa sediada no exterior - incorporados a produto final exportado para o Brasil - Art. 19 Inciso II do Decreto 7.212/2010, 007 - Imunidade - Exportação de produtos nacionais - sem saída do território brasileiro - venda para órgão ou entidade de governo estrangeiro ou organismo internacional de que o Brasil seja membro,para ser entregue, no País, à ordem do comprador - Art. 19 Inciso III do Decreto 7.212/2010, 101 - Suspensão - Óleo de menta em bruto, produzido por lavradores - Art. 43 Inciso I do Decreto 7.212/2010 … (132) |  |
| `perc_icms` | %ICMS | text | R |  |  |  |
| `perc_pis` | %PIS | text | R |  |  |  |
| `perc_cofins` | %COFINS | text | R |  |  |  |
| `perc_ipi` | %IPI | text |  |  |  |  |
| `cest` | CEST | text |  | 10 |  |  |
| `percent_reduction` | Perc. Redução de BC | text | R |  |  |  |
| `modality_bc` | Modalidade da BC do ICMS | select | R |  | 0 - Margem Valor Agregado (%), 1 - Pauta (Valor), 2 - Preço Tabelado Máx. (valor), 3 - Valor da operação |  |
| `origem` | Origem | select | R |  | 0 - NACIONAL, 1 - ESTRANGEIRA - IMPORTAÇÃO DIRETA, 2 - ESTRANGEIRA - ADQUIRIDA NO MERCADO INTERNO, 3 - NACIONAL, MERCADORIA OU BEM COM CONTEÚDO DE IMPORTAÇÃO SUPERIOR A 40%, 4 - NACIONAL, CUJA PRODUÇÃO TENHA SIDO FEITA EM CONFORMIDADE COM OS PROCESSOS PRODUTIVOS BÁSICOS DE QUE TRATAM O DECRETO-LEI Nº 288/67, E AS LEIS NºS 8.248/91, 8.387/91, 10.176/01 E 11 . 4 8 4 / 0 7, 5 - NACIONAL, MERCADORIA OU BEM COM CONTEÚDO DE IMPORTAÇÃO INFERIOR OU IGUAL A 40%, 6 - ESTRANGEIRA - IMPORTAÇÃO DIRETA, SEM SIMILAR NACIONAL, CONSTANTE EM LISTA DE RESOLUÇÃO CAMEX, 7 - ESTRANGEIRA - ADQUIRIDA NO MERCADO INTERNO, SEM SIMILAR NACIONAL, CONSTANTE EM LISTA DE RESOLUÇÃO CAMEX … (9) |  |
| `cst_csosn_exp` | CST/CSOSN Exportação | select |  |  | 00 - Tributa integralmente, 10 - Tributada e com cobrança do ICMS por substituição tributária, 20 - Com redução da Base de Calculo, 30 - Isenta / não tributada e com cobrança do ICMS por substituição tributária, 40 - Isenta, 41 - Não tributada, 50 - Com suspensão, 51 - Com diferimento … (21) |  |
| `additional_info_id` | Info. Complementares | select |  |  |  |  |
| `c_class_trib` | Código Classificação Tributária | text |  |  |  |  |
| `cst_ibs_cbs` | CST IBS/CBS | select |  |  | 000 - Tributação integral, 010 - Tributação com alíquotas uniformes, 011 - Tributação com alíquotas uniformes reduzidas, 200 - Alíquota reduzida, 220 - Alíquota fixa, 221 - Alíquota fixa proporcional, 222 - Redução de Base de Cálculo, 400 - Isenção … (18) |  |
| `perc_ibs_uf` | % IBS UF | text |  |  |  |  |
| `perc_ibs_mun` | % IBS Município | text |  |  |  |  |
| `perc_reducao_aliq_ibs_uf` | % Redução IBS UF | text |  |  |  |  |
| `perc_reducao_aliq_ibs_mun` | % Redução IBS Mun | text |  |  |  |  |
| `perc_dif_ibs_uf` | % Diferimento IBS UF | text |  |  |  |  |
| `perc_dif_ibs_mun` | % Diferimento IBS Município | text |  |  |  |  |
| `perc_cbs` | % CBS | text |  |  |  |  |
| `perc_reducao_aliq_cbs` | % Redução CBS | text |  |  |  |  |
| `perc_dif_cbs` | % Diferimento CBS | text |  |  |  |  |
| `cst_is` | CST IS | text |  |  |  |  |
| `perc_is` | % Imposto Seletivo | text |  |  |  |  |
| `perc_is_espec` | Alíq. Específica IS (R$) | text (moeda) |  |  |  |  |
| `ad_rem_ibs` | Alíq. Ad Rem IBS (R$/un) | text (moeda) |  |  |  |  |
| `ad_rem_cbs` | Alíq. Ad Rem CBS (R$/un) | text (moeda) |  |  |  |  |
| `tp_cred_pres_ibs_zfm` | Crédito Presumido ZFM | select |  |  | Não se aplica, 0 - Sem Crédito Presumido, 1 - Bens de consumo final (55%), 2 - Bens de capital (75%), 3 - Bens intermediários (90,25%), 4 - Bens de informática (100%) |  |
| `ind_doacao` | Operação de Doação | select |  |  | Não, Sim |  |

## SCR-346 · Natureza de Operação

- **Rota:** `/admin/natureoperations/10527/edit`
- **Módulo:** Cadastros Base > Fiscais > Natureza Op.
- **Tipo:** Cadastro (edição)
- **Finalidade:** Natureza Op. (cadastro (edição))
- **Botões/Ações (cabeçalho):** Voltar → `/admin/natureoperations`

**Formulário PUT `/admin/natureoperations/10527`** — botões: Salvar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `descricao` | Descrição | text | R | 60 |  |  |
| `tipo` | Tipo | select | R |  | Saída, Entrada |  |
| `cfop_saida_interno` | CFOP saída interno | text | R | 4 |  |  |
| `cfop_saida_externo` | CFOP saída externo | text | R | 4 |  |  |
| `cfop_entrada_interno` | CFOP entrada interno | text | R | 4 |  |  |
| `cfop_entrada_externo` | CFOP entrada externo | text | R | 4 |  |  |
| `cfop_saida_exportacao` | CFOP saída exportação | text |  | 4 |  |  |
| `cfop_entrada_exportacao` | CFOP entrada exportação | text |  | 4 |  |  |
| `ativo` | Ativo | select | R |  | Sim, Não |  |
| `sobrescreve_cfop_produto` | Sobrescreve CFOP do produto | select | R |  | Não, Sim |  |
| `overwrite_product` | Sobrescrever Informações do produto | select | R |  | Não, Sim |  |
| `generate_financial` | Não gerar financeiro | checkbox |  |  |  |  |
| `automatic_calculation` | Cálculo ICMS automático | checkbox |  |  |  |  |
| `tax_rule_id` | Regra Fiscal | select |  |  |  |  |
| `cst_csosn` | CST/CSOSN Padrão | select | R |  | 00 - Tributa integralmente, 10 - Tributada e com cobrança do ICMS por substituição tributária, 20 - Com redução da Base de Calculo, 30 - Isenta / não tributada e com cobrança do ICMS por substituição tributária, 40 - Isenta, 41 - Não tributada, 50 - Com suspensão, 51 - Com diferimento … (21) |  |
| `cst_pis` | CST/COFINS Padrão | select | R |  | 01 - Operação Tributável - Base de Cálculo = Valor da Operação Alíquota Normal (Cumulativo/Não Cumulativo), 02 - Operação Tributável - Base de Calculo = Valor da Operação (Alíquota Diferenciada), 03 - Operação Tributável - Base de Calculo = Quantidade Vendida x Alíquota por Unidade de Produto;, 04 - Operação Tributável - Tributação Monofásica - (Alíquota Zero);, 06 - Operação Tributável - Alíquota Zero;, 07 - Operação Isenta da contribuição;, 08 - Operação Sem Incidência da contribuição;, 09 - Operação com suspensão da contribuição; … (32) |  |
| `cst_cofins` | CST/PIS | select | R |  | 01 - Operação Tributável - Base de Cálculo = Valor da Operação Alíquota Normal (Cumulativo/Não Cumulativo), 02 - Operação Tributável - Base de Calculo = Valor da Operação (Alíquota Diferenciada), 03 - Operação Tributável - Base de Calculo = Quantidade Vendida x Alíquota por Unidade de Produto;, 04 - Operação Tributável - Tributação Monofásica - (Alíquota Zero);, 06 - Operação Tributável - Alíquota Zero;, 07 - Operação Isenta da contribuição;, 08 - Operação Sem Incidência da contribuição;, 09 - Operação com suspensão da contribuição; … (32) |  |
| `cst_ipi` | CST/IPI | select | R |  | 00 - Entrada com Recuperação de Crédito, 01 - Entrada Tributável com Alíquota Zero, 02 - Entrada Isenta, 03 - Entrada Não Tributada, 04 - Entrada Imune, 05 - Entrada com Suspensão, 49 - Outras Operações de Entrada, 50 - Saída Tributada … (14) |  |
| `cenq_ipi` | Código Enquadramento IPI | select | R |  | 001 - Imunidade - Livros, jornais, periódicos e o papel destinado à sua impressão - Art. 18 Inciso I do Decreto 7.212/2010, 002 - Imunidade - Produtos industrializados destinados ao exterior - Art. 18 Inciso II do Decreto 7.212/2010, 003 - Imunidade - Ouro, definido em lei como ativo financeiro ou instrumento cambial - Art. 18 Inciso III do Decreto 7.212/2010, 004 - Imunidade - Energia elétrica, derivados de petróleo, combustíveis e minerais do País - Art. 18 Inciso IV do Decreto 7.212/2010, 005 - Imunidade - Exportação de produtos nacionais - sem saída do território brasileiro - venda para empresa sediada no exterior - atividades de pesquisa ou lavra de jazidas de petróleo e de gás natural- Art. 19 Inciso I do Decreto 7.212/2010, 006 - Imunidade - Exportação de produtos nacionais - sem saída do território brasileiro - venda para empresa sediada no exterior - incorporados a produto final exportado para o Brasil - Art. 19 Inciso II do Decreto 7.212/2010, 007 - Imunidade - Exportação de produtos nacionais - sem saída do território brasileiro - venda para órgão ou entidade de governo estrangeiro ou organismo internacional de que o Brasil seja membro,para ser entregue, no País, à ordem do comprador - Art. 19 Inciso III do Decreto 7.212/2010, 101 - Suspensão - Óleo de menta em bruto, produzido por lavradores - Art. 43 Inciso I do Decreto 7.212/2010 … (132) |  |
| `perc_icms` | %ICMS | text | R |  |  |  |
| `perc_pis` | %PIS | text | R |  |  |  |
| `perc_cofins` | %COFINS | text | R |  |  |  |
| `perc_ipi` | %IPI | text |  |  |  |  |
| `cest` | CEST | text |  | 10 |  |  |
| `percent_reduction` | Perc. Redução de BC | text | R |  |  |  |
| `modality_bc` | Modalidade da BC do ICMS | select | R |  | 0 - Margem Valor Agregado (%), 1 - Pauta (Valor), 2 - Preço Tabelado Máx. (valor), 3 - Valor da operação |  |
| `origem` | Origem | select | R |  | 0 - NACIONAL, 1 - ESTRANGEIRA - IMPORTAÇÃO DIRETA, 2 - ESTRANGEIRA - ADQUIRIDA NO MERCADO INTERNO, 3 - NACIONAL, MERCADORIA OU BEM COM CONTEÚDO DE IMPORTAÇÃO SUPERIOR A 40%, 4 - NACIONAL, CUJA PRODUÇÃO TENHA SIDO FEITA EM CONFORMIDADE COM OS PROCESSOS PRODUTIVOS BÁSICOS DE QUE TRATAM O DECRETO-LEI Nº 288/67, E AS LEIS NºS 8.248/91, 8.387/91, 10.176/01 E 11 . 4 8 4 / 0 7, 5 - NACIONAL, MERCADORIA OU BEM COM CONTEÚDO DE IMPORTAÇÃO INFERIOR OU IGUAL A 40%, 6 - ESTRANGEIRA - IMPORTAÇÃO DIRETA, SEM SIMILAR NACIONAL, CONSTANTE EM LISTA DE RESOLUÇÃO CAMEX, 7 - ESTRANGEIRA - ADQUIRIDA NO MERCADO INTERNO, SEM SIMILAR NACIONAL, CONSTANTE EM LISTA DE RESOLUÇÃO CAMEX … (9) |  |
| `cst_csosn_exp` | CST/CSOSN Exportação | select |  |  | 00 - Tributa integralmente, 10 - Tributada e com cobrança do ICMS por substituição tributária, 20 - Com redução da Base de Calculo, 30 - Isenta / não tributada e com cobrança do ICMS por substituição tributária, 40 - Isenta, 41 - Não tributada, 50 - Com suspensão, 51 - Com diferimento … (21) |  |
| `additional_info_id` | Info. Complementares | select |  |  |  |  |
| `c_class_trib` | Código Classificação Tributária | text |  |  |  |  |
| `cst_ibs_cbs` | CST IBS/CBS | select |  |  | 000 - Tributação integral, 010 - Tributação com alíquotas uniformes, 011 - Tributação com alíquotas uniformes reduzidas, 200 - Alíquota reduzida, 220 - Alíquota fixa, 221 - Alíquota fixa proporcional, 222 - Redução de Base de Cálculo, 400 - Isenção … (18) |  |
| `perc_ibs_uf` | % IBS UF | text |  |  |  |  |
| `perc_ibs_mun` | % IBS Município | text |  |  |  |  |
| `perc_reducao_aliq_ibs_uf` | % Redução IBS UF | text |  |  |  |  |
| `perc_reducao_aliq_ibs_mun` | % Redução IBS Mun | text |  |  |  |  |
| `perc_dif_ibs_uf` | % Diferimento IBS UF | text |  |  |  |  |
| `perc_dif_ibs_mun` | % Diferimento IBS Município | text |  |  |  |  |
| `perc_cbs` | % CBS | text |  |  |  |  |
| `perc_reducao_aliq_cbs` | % Redução CBS | text |  |  |  |  |
| `perc_dif_cbs` | % Diferimento CBS | text |  |  |  |  |
| `cst_is` | CST IS | text |  |  |  |  |
| `perc_is` | % Imposto Seletivo | text |  |  |  |  |
| `perc_is_espec` | Alíq. Específica IS (R$) | text (moeda) |  |  |  |  |
| `ad_rem_ibs` | Alíq. Ad Rem IBS (R$/un) | text (moeda) |  |  |  |  |
| `ad_rem_cbs` | Alíq. Ad Rem CBS (R$/un) | text (moeda) |  |  |  |  |
| `tp_cred_pres_ibs_zfm` | Crédito Presumido ZFM | select |  |  | Não se aplica, 0 - Sem Crédito Presumido, 1 - Bens de consumo final (55%), 2 - Bens de capital (75%), 3 - Bens intermediários (90,25%), 4 - Bens de informática (100%) |  |
| `ind_doacao` | Operação de Doação | select |  |  | Não, Sim |  |

## SCR-347 · Informações Complementares

- **Rota:** `/admin/additional-info/create`
- **Módulo:** Cadastros Base > Fiscais > Info. Complementares
- **Tipo:** Cadastro (novo)
- **Finalidade:** Info. Complementares (cadastro (novo))
- **Botões/Ações (cabeçalho):** Voltar → `/admin/additional-info`

**Formulário POST `/admin/additional-info`** — botões: Salvar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `description` | Descrição | text | R | 100 |  |  |
| `is_active` | Ativo | select | R |  | Sim, Não |  |
| `info` | Informações Complementares | textarea |  | 1000 |  |  |

## SCR-348 · Plano de Contas

- **Rota:** `/admin/plan-accounts/report`
- **Módulo:** Cadastros Base > Fiscais > Plano de Contas
- **Tipo:** Relatório
- **Finalidade:** Plano de Contas (relatório)
- **Cards/Seções:** 

## SCR-349 · Planos de Contas

- **Rota:** `/admin/plan-accounts/create`
- **Módulo:** Cadastros Base > Fiscais > Plano de Contas
- **Tipo:** Cadastro (novo)
- **Finalidade:** Plano de Contas (cadastro (novo))
- **Botões/Ações (cabeçalho):** Voltar → `/admin/plan-accounts`

**Formulário POST `/admin/plan-accounts`** — botões: Salvar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `code` | Código | text | R | 20 |  |  |
| `description` | Descrição | text | R | 80 |  |  |
| `condition` | Condição | select | R |  | Débito, Crédito, Ambos |  |
| `class` | Classe | select | R |  | Sintética, Analítica |  |
| `is_enabled` | Ativo | select | R |  | Sim, Não |  |
| `type` | Tipo | select |  |  | CAPEX (Capital Expenditure), OPEX (Operational Expenditure) |  |
| `parent_id` | Antecessor | select |  |  | Não Contém, 1 - ATIVO, 1.1 - Ativo Circulante, 1.1.1 - Disponibilidades, 1.1.1.01 - Caixa, 1.1.1.02 - Bancos, 1.1.1.03 - Cheques Recebidos, 1.1.2 - Valores a receber … (5880) |  |

## SCR-350 · Planos de Contas

- **Rota:** `/admin/plan-accounts/19156`
- **Módulo:** Cadastros Base > Fiscais > Plano de Contas
- **Tipo:** Detalhe
- **Finalidade:** Plano de Contas (detalhe)
- **Botões/Ações (cabeçalho):** Voltar → `/admin/plan-accounts`

## SCR-351 · Planos de Contas

- **Rota:** `/admin/plan-accounts/19156/edit`
- **Módulo:** Cadastros Base > Fiscais > Plano de Contas
- **Tipo:** Cadastro (edição)
- **Finalidade:** Plano de Contas (cadastro (edição))
- **Botões/Ações (cabeçalho):** Voltar → `/admin/plan-accounts`

**Formulário PUT `/admin/plan-accounts/19156`** — botões: Salvar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `code` | Código | text | R | 20 |  |  |
| `description` | Descrição | text | R | 80 |  |  |
| `condition` | Condição | select | R |  | Débito, Crédito, Ambos |  |
| `class` | Classe | select | R |  | Sintética, Analítica |  |
| `is_enabled` | Ativo | select | R |  | Sim, Não |  |
| `type` | Tipo | select |  |  | CAPEX (Capital Expenditure), OPEX (Operational Expenditure) |  |
| `parent_id` | Antecessor | select |  |  | Não Contém, 1.1.1 - Disponibilidades |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |
| `categories[]` |  | checkbox |  |  |  |  |

## SCR-352 · Operação

- **Rota:** `/admin/operations/create`
- **Módulo:** Cadastros Base > Agrícolas > Operações
- **Tipo:** Cadastro (novo)
- **Finalidade:** Operações (cadastro (novo))
- **Botões/Ações (cabeçalho):** Voltar → `/admin/operations`

**Formulário POST `/admin/operations`** — botões: Salvar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `name` | Nome | text | R | 30 |  |  |
| `order` | Ordem | text | R | 2 |  |  |
| `grouper_id` | Agrupador | select |  |  | Custo Operacional Efetivo - COE, Custo Operacional Total - COT, Custo Total - CT, Depreciações - D, Distribuição dos Lucros_DL, Financiamentos Empréstimos Aportes_FEA, Investimentos - I, Movimentação Interna_MI … (14) |  |
| `description` | Descrição | text |  | 50 |  |  |
| `use` | Uso | select | R |  | Ambos, Agricultura, Pecuária |  |
| `is_enabled` | Ativo | select | R |  | Sim, Não |  |

## SCR-353 · Operação

- **Rota:** `/admin/operations/101`
- **Módulo:** Cadastros Base > Agrícolas > Operações
- **Tipo:** Detalhe
- **Finalidade:** Operações (detalhe)
- **Botões/Ações (cabeçalho):** Voltar → `/admin/operations`

## SCR-354 · Operação

- **Rota:** `/admin/operations/101/edit`
- **Módulo:** Cadastros Base > Agrícolas > Operações
- **Tipo:** Cadastro (edição)
- **Finalidade:** Operações (cadastro (edição))
- **Botões/Ações (cabeçalho):** Voltar → `/admin/operations`

**Formulário PUT `/admin/operations/101`** — botões: Salvar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `name` | Nome | text | R | 30 |  |  |
| `order` | Ordem | text | R | 2 |  |  |
| `grouper_id` | Agrupador | select |  |  | Custo Operacional Efetivo - COE, Custo Operacional Total - COT, Custo Total - CT, Depreciações - D, Distribuição dos Lucros_DL, Financiamentos Empréstimos Aportes_FEA, Investimentos - I, Movimentação Interna_MI … (14) |  |
| `description` | Descrição | text |  | 50 |  |  |
| `use` | Uso | select | R |  | Ambos, Agricultura, Pecuária |  |
| `is_enabled` | Ativo | select | R |  | Sim, Não |  |

## SCR-355 · Atividades

- **Rota:** `/admin/activities/create`
- **Módulo:** Cadastros Base > Agrícolas > Atividades
- **Tipo:** Cadastro (novo)
- **Finalidade:** Atividades (cadastro (novo))
- **Botões/Ações (cabeçalho):** Voltar → `/admin/activities`

**Formulário POST `/admin/activities`** — botões: Salvar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `name` | Nome | text | R | 30 |  |  |
| `is_enabled` | Ativo | select | R |  | Sim, Não |  |
| `vl_hectare` | Vl. Hectare | text (moeda) | R |  |  |  |
| `description` | Descrição | text |  | 50 |  |  |
| `use` | Uso | select | R |  | Ambos, Agricultura, Fruticultura, Pecuária de Corte |  |
| `type` | Tipo | select | R |  | Custeio, Investimento, Á Definir |  |
| `operations[]` | Operações | select (múltiplo) |  |  | Preparo do Solo, Plantio, Tratos Culturais, Tratos Fitossanitários, Colheita, Pós Colheita, Armazenagem, Conservação do Solo … (19) |  |

## SCR-356 · Atividades

- **Rota:** `/admin/activities/716`
- **Módulo:** Cadastros Base > Agrícolas > Atividades
- **Tipo:** Detalhe
- **Finalidade:** Atividades (detalhe)
- **Botões/Ações (cabeçalho):** Voltar → `/admin/activities`

## SCR-357 · Atividades

- **Rota:** `/admin/activities/716/edit`
- **Módulo:** Cadastros Base > Agrícolas > Atividades
- **Tipo:** Cadastro (edição)
- **Finalidade:** Atividades (cadastro (edição))
- **Botões/Ações (cabeçalho):** Voltar → `/admin/activities`

**Formulário PUT `/admin/activities/716`** — botões: Salvar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `name` | Nome | text | R | 30 |  |  |
| `is_enabled` | Ativo | select | R |  | Sim, Não |  |
| `vl_hectare` | Vl. Hectare | text (moeda) | R |  |  |  |
| `description` | Descrição | text |  | 50 |  |  |
| `use` | Uso | select | R |  | Ambos, Agricultura, Fruticultura, Pecuária de Corte |  |
| `type` | Tipo | select | R |  | Custeio, Investimento, Á Definir |  |
| `operations[]` | Operações | select (múltiplo) |  |  | Preparo do Solo, Conservação do Solo, Plantio, Tratos Culturais, Tratos Fitossanitários, Colheita, Pós Colheita, Armazenagem … (19) |  |

## SCR-358 · Parâmetro de Peso

- **Rota:** `/admin/parameter-weights/create`
- **Módulo:** Cadastros Base > Pecuários > Parâmetros/Peso
- **Tipo:** Cadastro (novo)
- **Finalidade:** Parâmetros/Peso (cadastro (novo))
- **Botões/Ações (cabeçalho):** Voltar → `/admin/parameter-weights`

**Formulário POST `/admin/parameter-weights`** — botões: Salvar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `code` | Código | text | R |  |  |  |
| `date` | Data | text (data) | R |  |  |  |
| `user_name` | Responsável | text | R |  |  |  |
| `description` | Descrição | text | R | 40 |  |  |
| `initial_weight` | Peso Inicial | text (moeda) | R |  |  |  |
| `final_weight` | Peso Final | text (moeda) | R |  |  |  |

## SCR-359 · Forragem

- **Rota:** `/admin/fodder/create`
- **Módulo:** Cadastros Base > Pecuários > Forragem
- **Tipo:** Cadastro (novo)
- **Finalidade:** Forragem (cadastro (novo))
- **Botões/Ações (cabeçalho):** Voltar → `/admin/fodder`

**Formulário POST `/admin/fodder`** — botões: Salvar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `description` | Descrição | text | R | 100 |  |  |
| `is_enabled` | Ativo | select | R |  | Sim, Não |  |

## SCR-360 · Forragem

- **Rota:** `/admin/fodder/13`
- **Módulo:** Cadastros Base > Pecuários > Forragem
- **Tipo:** Detalhe
- **Finalidade:** Forragem (detalhe)
- **Botões/Ações (cabeçalho):** Voltar → `/admin/fodder`

## SCR-361 · Forragem

- **Rota:** `/admin/fodder/13/edit`
- **Módulo:** Cadastros Base > Pecuários > Forragem
- **Tipo:** Cadastro (edição)
- **Finalidade:** Forragem (cadastro (edição))
- **Botões/Ações (cabeçalho):** Voltar → `/admin/fodder`

**Formulário PUT `/admin/fodder/13`** — botões: Salvar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `description` | Descrição | text | R | 100 |  |  |
| `is_enabled` | Ativo | select | R |  | Sim, Não |  |

## SCR-362 · Informações do Animal

- **Rota:** `/admin/animals/create`
- **Módulo:** Cadastros Base > Pecuários > Rebanho
- **Tipo:** Cadastro (novo)
- **Finalidade:** Rebanho (cadastro (novo))
- **Botões/Ações (cabeçalho):** Voltar → `/admin/animals`

**Tabela** — linhas na amostra: 1

- Colunas: (seleção) | Tipo de Identif. | Identificação

**Formulário POST `/admin/animals`** — botões: Salvar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `photo` |  | file |  |  |  |  |
| `specie_id` | Espécie | select | R |  | Bovinos de Corte |  |
| `category_id` | Categoria | select | R |  |  |  |
| `entry_date` | Data de Entrada | text (data) | R |  |  |  |
| `type` | Tipo de Cadastro | select |  |  | Individual, Sem Identificação |  |
| `quantity` | Quantidade | number |  |  |  |  |
| `category_matrice_id` | Estágio Reprodutivo | select |  |  | Lactação, Multípara, Novilha, Nulípara, Primípara, Secundípara, Solteira |  |
| `reproductive_status` | Status Reprodutivo | select |  |  | Prenha, Vazia, Parida |  |
| `breed_id` | Raça | select | R |  | Aberdeen Angus, Akaushi, Anelorado, Bonsmara, Braford, Brahman, Brangus, Caracu … (36) |  |
| `birth_date` | Data de nascimento | text (data) |  |  |  |  |
| `weight` | Peso (Kg) | text (moeda) | R |  |  |  |
| `price_kilo_alive` | Preço do Kg vivo | text (moeda) | R |  |  |  |
| `price_arroba_alive` | Preço da @ vivo | text (moeda) |  |  |  |  |
| `value_unitary` | Valor Unitário | text (moeda) |  |  |  |  |
| `unity_animal_ua` | Unidade animal (UA) | text (moeda) |  |  |  |  |
| `mother` | ID Mãe | text |  |  |  |  |
| `father` | ID Pai | text |  |  |  |  |
| `fur_description` | Descrição Pelagem | text |  | 100 |  |  |
| `birth_forecast` | Previsão de Parto | text (data) |  |  |  |  |
| `proprietary_id` | Proprietário Gestor | select |  |  | (lista dinâmica de cadastro — 1 registros; valores omitidos por privacidade) |  |
| `provider_id` | Origem do Animal | select |  |  | (lista dinâmica de cadastro — 39 registros; valores omitidos por privacidade) … (39) |  |
| `note` | Observação | textarea |  | 191 |  |  |
| `vl_acquisition` | Vl. Aquisição/Vl.Construção | text (moeda) |  |  |  |  |
| `depreciation_type` | Tipo de Depreciação | select |  |  | C/Vl. Residual, S/Vl. Residual |  |
| `residual` | Residual(%) | text |  |  |  |  |
| `life_bens` | Vida útil(anos) | text (moeda) |  |  |  |  |
| `depreciation` | Depreciação(%) | text |  |  |  |  |
| `vl_residual` | Vl. Residual | text (moeda) |  |  |  |  |
| `vl_depreciate` | Vl. p/Depreciação | text (moeda) |  |  |  |  |
| `vl_depreciated` | Vl. Depreciado | text |  |  |  |  |
| `sd_depreciate` | Sd. Á depreciar | text |  |  |  |  |
| `id_animals[]` |  | select | R |  | (lista dinâmica de cadastro — 8 registros; valores omitidos por privacidade) |  |
| `identification[]` |  | text | R |  |  |  |
| `child[category_id]` | Categoria | select |  |  |  |  |
| `child[date]` | Dt. Nascimento | text (data) |  |  |  |  |
| `child[weight]` | Peso (Kg) | text (moeda) |  |  |  |  |
| `child[id_animal]` | Tipo Identificação | select |  |  | (lista dinâmica de cadastro — 8 registros; valores omitidos por privacidade) |  |
| `child[identification]` | Identificação | text |  |  |  |  |

## SCR-363 · Tipos de Identificação

- **Rota:** `/admin/animals/108942`
- **Módulo:** Cadastros Base > Pecuários > Rebanho
- **Tipo:** Detalhe
- **Finalidade:** Rebanho (detalhe)
- **Botões/Ações (cabeçalho):** Voltar → `/admin/animals`

**Tabela** — linhas na amostra: 1

- Colunas: Tipo de Identif. | Identificação

## SCR-364 · Informações do Animal

- **Rota:** `/admin/animals/108942/edit`
- **Módulo:** Cadastros Base > Pecuários > Rebanho
- **Tipo:** Cadastro (edição)
- **Finalidade:** Rebanho (cadastro (edição))
- **Botões/Ações (cabeçalho):** Voltar → `/admin/animals`

**Tabela** — linhas na amostra: 1

- Colunas: (seleção) | Tipo de Identif. | Identificação

**Formulário PUT `/admin/animals/108942`** — botões: Salvar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `photo` |  | file |  |  |  |  |
| `specie_id` | Espécie | select | R |  | Bovinos de Corte |  |
| `category_id` | Categoria | select | R |  |  |  |
| `entry_date` | Data de Entrada | text (data) | R |  |  |  |
| `type` | Tipo de Cadastro | select |  |  | Individual, Sem Identificação |  |
| `quantity` | Quantidade | number |  |  |  |  |
| `category_matrice_id` | Estágio Reprodutivo | select |  |  | Lactação, Multípara, Novilha, Nulípara, Primípara, Secundípara, Solteira |  |
| `reproductive_status` | Status Reprodutivo | select |  |  | Prenha, Vazia, Parida |  |
| `breed_id` | Raça | select | R |  | Aberdeen Angus, Akaushi, Anelorado, Bonsmara, Braford, Brahman, Brangus, Caracu … (36) |  |
| `birth_date` | Data de nascimento | text (data) |  |  |  |  |
| `weight` | Peso (Kg) | text (moeda) | R |  |  |  |
| `price_kilo_alive` | Preço do Kg vivo | text (moeda) | R |  |  |  |
| `price_arroba_alive` | Preço da @ vivo | text (moeda) |  |  |  |  |
| `value_unitary` | Valor Unitário | text (moeda) |  |  |  |  |
| `unity_animal_ua` | Unidade animal (UA) | text (moeda) |  |  |  |  |
| `mother` | ID Mãe | text |  |  |  |  |
| `father` | ID Pai | text |  |  |  |  |
| `fur_description` | Descrição Pelagem | text |  | 100 |  |  |
| `birth_forecast` | Previsão de Parto | text (data) |  |  |  |  |
| `proprietary_id` | Proprietário Gestor | select |  |  | (lista dinâmica de cadastro — 1 registros; valores omitidos por privacidade) |  |
| `provider_id` | Origem do Animal | select |  |  | (lista dinâmica de cadastro — 39 registros; valores omitidos por privacidade) … (39) |  |
| `note` | Observação | textarea |  | 191 |  |  |
| `vl_acquisition` | Vl. Aquisição/Vl.Construção | text (moeda) |  |  |  |  |
| `depreciation_type` | Tipo de Depreciação | select |  |  | C/Vl. Residual, S/Vl. Residual |  |
| `residual` | Residual(%) | text |  |  |  |  |
| `life_bens` | Vida útil(anos) | text (moeda) |  |  |  |  |
| `depreciation` | Depreciação(%) | text |  |  |  |  |
| `vl_residual` | Vl. Residual | text (moeda) |  |  |  |  |
| `vl_depreciate` | Vl. p/Depreciação | text (moeda) |  |  |  |  |
| `vl_depreciated` | Vl. Depreciado | text |  |  |  |  |
| `sd_depreciate` | Sd. Á depreciar | text |  |  |  |  |
| `id_animals[]` |  | select | R |  | (lista dinâmica de cadastro — 8 registros; valores omitidos por privacidade) |  |
| `identification[]` |  | text | R |  |  |  |

## SCR-365 · Módulo Pastejo

- **Rota:** `/admin/grazing/create`
- **Módulo:** Cadastros Base > Pecuários > Módulo Pastejo
- **Tipo:** Cadastro (novo)
- **Finalidade:** Módulo Pastejo (cadastro (novo))
- **Botões/Ações (cabeçalho):** Voltar → `/admin/grazing`

**Tabela**

- Colunas: Área | Área Total(ha) | Carga Animal (UA/ ha) | Ação

**Formulário POST `/admin/grazing`** — botões: Salvar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `code` | Código | text | R |  |  |  |
| `date` | Data de cadastro | text | R |  |  |  |
| `user_name` | Responsável | text | R |  |  |  |
| `description` | Descrição | text | R | 100 |  |  |
| `fodder_id` | Forragem | select | R |  | Brachiaria, ewdw, Marandu, Mombaça, Mombaça, Quicuio, Zuri |  |
| `areas_sum` | Área Módulo (ha) | text |  |  |  |  |
| `color` | Cor do Módulo | select | R |  | Branco, Azul, Preto, Verde, Amarelo, Vermelho, Cinza, Cinza Claro … (14) |  |
| `control_productivity` | Controla Produtividade | select | R |  | Não, Sim | Define se produtividade do módulo será controlada/gerenciada |

## SCR-366 · Cochos

- **Rota:** `/admin/troughs/create`
- **Módulo:** Cadastros Base > Pecuários > Cochos
- **Tipo:** Cadastro (novo)
- **Finalidade:** Cochos (cadastro (novo))
- **Botões/Ações (cabeçalho):** Voltar → `/admin/troughs`

**Formulário POST `/admin/troughs`** — botões: Salvar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `code` | Código | text | R |  |  |  |
| `type` | Tipo | select | R |  | Coberto, Descoberto |  |
| `description` | Descrição | text | R | 200 |  |  |
| `total_area` | Área(Cm) | text | R |  |  |  |
| `grazing_id` | Módulo Pastejo | select |  |  |  |  |
| `area_id` | Área | select |  |  | 01 (1 cochos), 02 (0 cochos), 03 (0 cochos), 04 (0 cochos), 05 (0 cochos), 06 (0 cochos), 07 (0 cochos), 08 (0 cochos) … (10) |  |
| `feedlot_corral_id` | Curral | select |  |  |  |  |
| `is_enabled` | Ativo | select | R |  | Sim, Não |  |

## SCR-367 · Cochos

- **Rota:** `/admin/troughs/353/edit`
- **Módulo:** Cadastros Base > Pecuários > Cochos
- **Tipo:** Cadastro (edição)
- **Finalidade:** Cochos (cadastro (edição))
- **Botões/Ações (cabeçalho):** Voltar → `/admin/troughs`

**Formulário PUT `/admin/troughs/353`** — botões: Salvar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `code` | Código | text | R |  |  |  |
| `type` | Tipo | select | R |  | Coberto, Descoberto |  |
| `description` | Descrição | text | R | 200 |  |  |
| `total_area` | Área(Cm) | text | R |  |  |  |
| `grazing_id` | Módulo Pastejo | select |  |  |  |  |
| `area_id` | Área | select |  |  | 01 (1 cochos), 02 (0 cochos), 03 (0 cochos), 04 (0 cochos), 05 (0 cochos), 06 (0 cochos), 07 (0 cochos), 08 (0 cochos) … (10) |  |
| `feedlot_corral_id` | Curral | select |  |  |  |  |
| `is_enabled` | Ativo | select | R |  | Sim, Não |  |

## SCR-368 · Lote de Animais

- **Rota:** `/admin/batches/create`
- **Módulo:** Cadastros Base > Pecuários > Lotes Animais
- **Tipo:** Cadastro (novo)
- **Finalidade:** Lotes Animais (cadastro (novo))
- **Botões/Ações (cabeçalho):** Voltar → `/admin/batches`

**Formulário POST `/admin/batches`** — botões: Salvar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `code` | Código | text | R |  |  |  |
| `date` | Data | text | R |  |  |  |
| `user_name` | Responsável | text | R |  |  |  |
| `parameter_weight_id` | Peso | select |  |  |  |  |
| `specie_id` | Espécie | select | R |  | Bovinos de Corte |  |
| `categories[]` | Categoria | select (múltiplo) | R |  |  |  |
| `description` | Descrição | text | R | 200 |  |  |
| `animals[]` | Selecione os Animais (identificação)Marcar todos Desmarcar todos | select (múltiplo) |  |  | (lista dinâmica de cadastro — 0 registros; valores omitidos por privacidade) |  |

## SCR-369 · Lote/Módulo

- **Rota:** `/admin/batch-grazing/create`
- **Módulo:** Cadastros Base > Pecuários > Lote/Módulo
- **Tipo:** Cadastro (novo)
- **Finalidade:** Lote/Módulo (cadastro (novo))
- **Botões/Ações (cabeçalho):** Voltar → `/admin/batch-grazing`

**Formulário POST `/admin/batch-grazing`** — botões: Salvar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `code` | Código | text | R |  |  |  |
| `date` | Data | text | R |  |  |  |
| `user_name` | Responsável | text | R |  |  |  |
| `grazing_id` | Módulo | select | R |  |  |  |
| `batches[]` | Lote | select (múltiplo) | R |  |  |  |
| `hectares` | Hectares | text | R |  |  |  |
| `animals_quantity` | Quant/Animais | text | R |  |  |  |
| `ua_quantity` | Quant/UA | text | R |  |  |  |
| `ua_capacity` | Taxa Lotação/UA | text | R |  |  |  |

## SCR-370 · Lote/Área

- **Rota:** `/admin/batch-area/create`
- **Módulo:** Cadastros Base > Pecuários > Lote/Área
- **Tipo:** Cadastro (novo)
- **Finalidade:** Lote/Área (cadastro (novo))
- **Botões/Ações (cabeçalho):** Voltar → `/admin/batch-area`

**Formulário POST `/admin/batch-area`** — botões: Salvar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `code` | Código | text | R |  |  |  |
| `date` | Data | text (data) | R |  |  |  |
| `user_name` | Responsável | text | R |  |  |  |
| `area_id` | Área | select | R |  | 01, 02, 03, 04, 05, 06, 07, 08 … (10) |  |
| `batches[]` | Lote | select (múltiplo) | R |  |  |  |
| `hectares` | Hectares | text | R |  |  |  |
| `total_ua_ha` | UA/Suporte | text | R |  |  |  |
| `animals_quantity` | Quant/Animais | text | R |  |  |  |
| `ua_quantity` | Quant/UA | text | R |  |  |  |
| `ua_capacity` | Taxa Lotação/UA | text | R |  |  |  |

## SCR-371 · Inventário

- **Rota:** `/admin/equipments/create`
- **Módulo:** Cadastros Base > Bens/Ativos > Inventário
- **Tipo:** Cadastro (novo)
- **Finalidade:** Inventário (cadastro (novo))
- **Botões/Ações (cabeçalho):** Voltar → `/admin/equipments`

**Formulário POST `/admin/equipments`** — botões: Salvar

| Campo | Label | Tipo | Obrig. | Máx | Opções | Ajuda observada |
|---|---|---|---|---|---|---|
| `image` | Imagem | file |  |  |  |  |
| `code` | Código | text | R | 15 |  |  |
| `description` | Descrição | text | R | 60 |  |  |
| `family_equipment_id` | Familia Bem | select | R |  | Construções e Instalações, Culturas Perenes, Equipamentos Agrícolas, Imóveis Rurais e Urbanos, Implementos Agrícolas, Máquinas Agrícolas, Móveis e Equipamentos, Veículos Automotores |  |
| `equipment_type` | Tipo | select |  |  | Próprio, Terceirizado |  |
| `proprietary_id` | Proprietário Gestor | select |  |  | (lista dinâmica de cadastro — 1 registros; valores omitidos por privacidade) |  |
| `vl_time_productive` | Vl Hora/Km | text (moeda) | R |  |  |  |
| `hour_meter` | Horímetro/Km | text |  |  |  |  |
| `year_mod` | Ano/Mod | text | R |  |  |  |
| `brand` | Marca | text |  |  |  |  |
| `patrimony` | Patrimônio | text |  | 40 |  |  |
| `chassi` | Chassi | text |  | 17 |  |  |
| `renavam` | RENAVAM | text |  | 11 |  |  |
| `serie` | Série | text |  | 40 |  |  |
| `plate` | Placa | text |  | 10 |  |  |
| `uf` | UF | select |  |  | AC, AL, AM, AP, BA, CE, DF, ES … (27) |  |
| `color` | Cor | text |  | 10 |  |  |
| `model` | Modelo | text |  | 30 |  |  |
| `has_depreciation` | Tem Depreciação | select | R |  | Sim, Não |  |
| `vl_acquisition` | Vl. Aquisição/Vl.Construção | text (moeda) | R |  |  |  |
| `depreciation_type` | Tipo de Depreciação | select | R |  | C/Vl. Residual, S/Vl. Residual |  |
| `residual` | Residual(%) | text |  |  |  |  |
| `life_bens` | Vida útil(anos) | text (moeda) | R |  |  |  |
| `depreciation` | Depreciação(%) | text | R |  |  |  |
| `vl_residual` | Vl. Residual | text (moeda) |  |  |  |  |
| `vl_depreciate` | Vl. p/Depreciação | text (moeda) | R |  |  |  |
| `vl_depreciated` | Vl. Depreciado | text |  |  |  |  |
| `sd_depreciate` | Sd. Á depreciar | text |  |  |  |  |
| `current_value` | Valor Atual | text |  |  |  |  |
| `status` | Status | select | R |  | Ativo, Inativo |  |
| `dt_acquisition` | Dt. Aquisição | text (data) |  |  |  |  |
| `provider_id` | Fornecedor | select |  |  | (lista dinâmica de cadastro — 41 registros; valores omitidos por privacidade) … (41) |  |
| `product_id` | Produtos | select |  |  | 5W30 MOBIL SUPER GMDEXOS2, ABRAC RSF 14MM K 89X101MM, ACABAMENTO P/REG.3/4 C-44 ROSE GOLD RO7150 CLIC, ADITIVO, ADITIVO COOL-GARD 2 20/80 20L, ADITIVO CX.C/12, ADITIVO P/RADIADOR, ADITIVO RADIADOR ROSA … (236) |  |
| `use_fiscal` | Usa Fiscal | select | R |  | Não, Sim |  |
| `features[]` | Listar em funcionalidades | select (múltiplo) |  |  | (lista dinâmica de cadastro — 4 registros; valores omitidos por privacidade) |  |
| `specification` | Especificação | textarea |  | 200 |  |  |
| `rntrc` | RNTRC | text |  | 14 |  |  |
| `type` | Tipo | select |  |  | CICLOMOTO, MOTONETA, MOTOCICLO, TRICICLO, AUTOMÓVEL, MICRO-ÔNIBUS, ÔNIBUS, REBOQUE … (20) |  |
| `body_type` | Tipo de Carroceria | select |  |  | NAO APLICAVEL, ABERTA, FECHADA/BAU, GRANELEIRA, PORTA CONTAINER |  |
| `wheel_type` | Tipo de Rodado | select |  |  | TRUCK, TOCO, CAVALO MECANICO, VAN, UTILITARIO, OUTROS |  |
| `tara` | Tara | text (moeda) |  |  |  |  |
| `capacity` | Capacidade | text (moeda) |  |  |  |  |
| `owner_name` | Nome do Proprietário | text |  |  |  |  |
| `owner_type` | Pessoa | select | R |  | (lista dinâmica de cadastro — 2 registros; valores omitidos por privacidade) |  |
| `owner_document` | CPF/CNPJ do Proprietário | text |  |  |  |  |
| `owner_ie` | I.E do Proprietário | text |  |  |  |  |
| `owner_uf` | UF do Proprietário | select |  |  | (lista dinâmica de cadastro — 27 registros; valores omitidos por privacidade) … (27) |  |
| `owner_tp` | Tipo do Proprietário | select |  |  | (lista dinâmica de cadastro — 3 registros; valores omitidos por privacidade) |  |
| `attachments[0][name]` | Descrição | text |  |  |  |  |
| `attachments[0][file]` |  | file |  |  |  |  |
| `center_ids[]` | Centro de Custo | select |  |  | 1.01.001.0001 - Administração, 1.01.002.0001 - Estoque Insumos, 1.01.002.0002 - Estoque Produção, 1.01.003.0001 - Parque Máquinas, 1.02.006.0001 - Soja, 1.02.006.0002 - Soja Precoce, 1.02.006.0003 - Soja Super Precoce, 1.05.003.0001 - Terminação - Corte |  |
| `center_percentages[]` | Percentual (%) | text (moeda) |  |  |  |  |

## SCR-449 · Fazendas

- **Rota:** `/admin/farms/80/kml-export`
- **Módulo:** Cadastros Base > Estrutura > Fazendas
- **Tipo:** Página
- **Finalidade:** Fazendas (página)

## SCR-450 · Fazendas

- **Rota:** `/admin/farms/80/map-print`
- **Módulo:** Cadastros Base > Estrutura > Fazendas
- **Tipo:** Página
- **Finalidade:** Fazendas (página)

