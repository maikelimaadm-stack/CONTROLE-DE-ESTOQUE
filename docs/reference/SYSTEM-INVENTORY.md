# Inventário do Sistema de Referência

Fonte: navegação autenticada somente-leitura (HTTP GET) em 455 páginas em 09/09/2026. Cada tela tem uma seção detalhada em `docs/reference/screens/<módulo>.md` (campos, colunas, filtros, ações, abas e modais).

Totais: 455 telas · 468 formulários · 9157 campos · 229 tabelas · 666 permissões.

Rotas conhecidas mas NÃO capturadas (efeito colateral ou POST): `change-batch-animals`, `change-batch-module-areas`, `change-batch-farms`, `change-animal-farms` (telas de transferência acionadas via modal na listagem), `payment-schedule-report`, `payment-cashflow-report` (bloqueadas pelo filtro conservador do crawler por conter "payment"), exportações Domínio (`export-*-dominio`, geram arquivo). Estão registradas como NÃO CONFIRMADO na paridade.

| ID | Módulo | Submódulo | Tela | Rota | Tipo | Ações (cabeçalho) | Filtros | Colunas | Campos (form) | Relacionamentos (links) |
|---|---|---|---|---|---|---|---|---|---|---|
| SCR-001 | Painel de Controle |  | Previsão de Receitas x Despesas | `/admin/home` | Página |  | 0 | 0 | 0 |  |
| SCR-002 | Dashboards |  | Indicadores Financeiros | `/admin/financial-dashboard` | Dashboard |  | 5 | 7 | 0 |  |
| SCR-003 | Dashboards |  | Indicadores Pecuária de Corte | `/admin/livestock-dashboard` | Dashboard |  | 4 | 0 | 0 |  |
| SCR-004 | Cadastros Base | Pessoas | Funcionários | `/admin/employees` | Listagem | Saiba +, fas fa-print, Importar, Exportar, Adicionar Novo, Visualizar, Editar, Excluir | 4 | 7 | 1 |  |
| SCR-005 | Cadastros Base | Pessoas | Usuários | `/admin/users` | Listagem | Saiba +, Importar, Exportar, Adicionar Novo, Visualizar, Editar, Excluir | 4 | 9 | 1 | https://api.whatsapp.com/send?phone=5563984879640, /cdn-cgi/l/email-protection |
| SCR-006 | Administrativo | Estoque | Documento Fiscal | `/admin/invoices` | Listagem | Saiba +, Adicionar Novo | 9 | 9 | 0 |  |
| SCR-007 | Administrativo | Estoque | DFe Recebidas | `/admin/dfe` | Listagem | Saiba +, Manifestar, Lançar Despesa em Lote, Buscar DFe | 9 | 12 | 2 |  |
| SCR-008 | Administrativo | Estoque > Fábrica | Formulação | `/admin/foods` | Listagem | Adicionar Novo | 4 | 5 | 1 |  |
| SCR-009 | Financeiro |  | Contas a Pagar | `/admin/expenses` | Listagem | Saiba +, Simular Crédito, Baixar Contas, Excluir Contas, Importar, Exportar, Adicionar Novo, Visualizar, Documentos, Gerar Recibo, Baixar, Duplicar, Editar, Excluir | 28 | 16 | 21 | /admin/expense-receipt/{id} |
| SCR-010 | Financeiro |  | Conta a Receber | `/admin/incomes` | Listagem | Saiba +, Baixar Contas, Excluir Contas, Gerar Boleto, Importar, Exportar, Adicionar Novo, Visualizar, Documentos, Editar, Duplicar, Baixar, Gerar Recibo, Excluir | 19 | 16 | 25 | /admin/income-receipt/{id} |
| SCR-011 | Financeiro |  | Movimento Caixa/Bancário | `/admin/movements` | Listagem | Saiba +, Simular Crédito, Importar, Exportar, Adicionar Novo, Visualizar, Imprimir Comprovante, Documentos, Editar, Excluir | 13 | 13 | 1 |  |
| SCR-012 | Financeiro | Conciliação | Importar OFX | `/admin/ofx-imports` | Listagem | Saiba +, Adicionar Novo, Visualizar, Editar, Conciliar, Excluir | 4 | 6 | 0 |  |
| SCR-013 | Financeiro | Conciliação | Meses Conciliados | `/admin/ofx-report` | Relatório |  | 0 | 0 | 0 |  |
| SCR-014 | Gestão Fiscal | NFe | NFe | `/admin/nfe` | Listagem | Saiba +, Adicionar Novo | 9 | 11 | 0 |  |
| SCR-015 | Gestão Fiscal |  | NFSe Recebidas | `/admin/nfses` | Listagem | Buscar DFe | 8 | 10 | 0 |  |
| SCR-016 | Dashboards |  | Livro Caixa Digital | `/admin/cash-book-dashboard` | Dashboard |  | 3 | 0 | 0 |  |
| SCR-017 | Dashboards |  | Indicadores Suprimentos | `/admin/supply-dashboard` | Dashboard | Filtrar | 4 | 0 | 0 |  |
| SCR-018 | Dashboards |  | Indicadores de Depreciações | `/admin/depreciation-dashboard` | Dashboard |  | 3 | 0 | 0 |  |
| SCR-019 | Dashboards |  | Dashboard de Ativos | `/admin/assets-dashboard` | Dashboard |  | 5 | 0 | 0 |  |
| SCR-020 | Dashboards |  | Análise de Usuários | `/admin/user-analysis-dashboard` | Dashboard |  | 2 | 4 | 0 |  |
| SCR-021 | Dashboards |  | Pluviômetro | `/admin/rainfall-dashboard` | Dashboard |  | 4 | 0 | 0 |  |
| SCR-022 | Dashboards |  | Lotação de Currais | `/admin/feedlot-dashboard` | Dashboard |  | 2 | 0 | 0 |  |
| SCR-023 | Dashboards |  | Custos do Confinamento | `/admin/feedlot-cost-dashboard` | Dashboard |  | 4 | 0 | 0 |  |
| SCR-024 | Dashboards |  | Desempenho de Lotes | `/admin/feedlot-performance-dashboard` | Dashboard |  | 3 | 11 | 0 |  |
| SCR-025 | Dashboards |  | Dashboard Estoque de Nutrição | `/admin/nutrition-stock-dashboard` | Dashboard |  | 1 | 0 | 0 |  |
| SCR-026 | Dashboards |  | Dashboard Consumo vs Fornecido | `/admin/feed-consumption-dashboard` | Dashboard |  | 3 | 0 | 0 |  |
| SCR-027 | Cadastros Base | Estrutura | Centro de Custo | `/admin/costcenters` | Listagem | Saiba +, Visualizar, Cria descendente | 0 | 6 | 0 |  |
| SCR-028 | Cadastros Base | Estrutura | Fazendas | `/admin/farms` | Listagem | Saiba +, Adicionar Novo, Visualizar, Adicionar Área, Adicionar Multiplas Áreas, Editar, Excluir | 7 | 6 | 0 | /admin/areas/create?farm=80, /admin/areas-multiple/create?farm=80 |
| SCR-029 | Cadastros Base | Estrutura | Safras | `/admin/harvests` | Listagem | Saiba +, Adicionar Novo, Visualizar, Editar, Excluir | 0 | 5 | 0 |  |
| SCR-030 | Cadastros Base | Estrutura > Produtos | Endereçamentos | `/admin/addressings` | Relatório | Adicionar Novo, Visualizar, Cria descendente, Editar, Excluir | 0 | 3 | 0 |  |
| SCR-031 | Cadastros Base | Estrutura > Produtos | Produtos | `/admin/products` | Listagem | Agrupar, Saiba +, fas fa-print, Importar, Exportar, Adicionar Novo, Visualizar, Editar, Excluir | 7 | 10 | 1 |  |
| SCR-032 | Cadastros Base | Estrutura > Produtos | Armazém | `/admin/warehouses` | Listagem | Saiba +, Adicionar Novo, Visualizar, Editar, Excluir | 0 | 5 | 0 |  |
| SCR-033 | Cadastros Base | Estrutura > Produtos | Saldo Inicial | `/admin/openingbalances` | Listagem | Saiba +, Importar, Exportar, Adicionar Novo, Visualizar, Editar, Excluir | 3 | 8 | 1 |  |
| SCR-034 | Cadastros Base | Estrutura > Rateios | Rateio - Categoria Financeira | `/admin/apportionments` | Listagem | Saiba +, Adicionar Novo | 0 | 2 | 0 |  |
| SCR-035 | Cadastros Base | Pessoas | Perfil Usuário | `/admin/roles` | Listagem | Saiba +, Adicionar Novo, Visualizar, Editar, Excluir | 0 | 5 | 0 |  |
| SCR-036 | Cadastros Base | Pessoas | Pessoas | `/admin/people` | Listagem | Adicionar Novo, Visualizar, Editar | 2 | 5 | 0 |  |
| SCR-037 | Cadastros Base | Pessoas | Proprietários | `/admin/proprietaries` | Listagem | Saiba +, fas fa-print, Importar, Exportar, Adicionar Novo, Visualizar, Editar, Excluir | 0 | 6 | 1 | /cdn-cgi/l/email-protection |
| SCR-038 | Cadastros Base | Pessoas | Fornecedores | `/admin/providers` | Listagem | Saiba +, fas fa-print, Importar, Exportar, Adicionar Novo, Visualizar, Editar, Excluir | 6 | 7 | 1 |  |
| SCR-039 | Cadastros Base | Pessoas | Clientes | `/admin/clients` | Listagem | Saiba +, fas fa-print, Importar, Exportar, Adicionar Novo, Visualizar, Editar, Excluir | 3 | 6 | 1 | /cdn-cgi/l/email-protection |
| SCR-040 | Cadastros Base | Pessoas | Autorizadores | `/admin/authorizers` | Listagem | Saiba +, Adicionar Novo, Visualizar, Editar, Excluir | 1 | 6 | 0 |  |
| SCR-041 | Cadastros Base | Financeiros | Contas Bancárias | `/admin/accounts` | Listagem | Saiba +, Adicionar Novo, Visualizar, Editar, Excluir | 0 | 10 | 0 |  |
| SCR-042 | Cadastros Base | Financeiros | Saldo Inicial | `/admin/open-movements` | Listagem | Saiba +, Simular Crédito, Adicionar Novo | 4 | 11 | 0 |  |
| SCR-043 | Cadastros Base | Financeiros | Categoria Financeira | `/admin/financialcategories` | Listagem | Saiba +, fas fa-print, Visualizar, Cria descendente | 6 | 10 | 0 |  |
| SCR-044 | Cadastros Base | Fiscais | Emissor NFe | `/admin/issue` | Listagem | Saiba +, Adicionar Novo, Editar, Certificado, Excluir | 0 | 9 | 0 |  |
| SCR-045 | Cadastros Base | Fiscais | Sincronização DFe | `/admin/issue-dfe-sync-time` | Listagem | Adicionar Novo | 0 | 4 | 0 |  |
| SCR-046 | Cadastros Base | Fiscais | Sincronização NFS-e | `/admin/issue-nfse-sync-time` | Listagem | Adicionar Novo | 0 | 4 | 0 |  |
| SCR-047 | Cadastros Base | Fiscais | Regras Fiscais | `/admin/tax-rules` | Listagem | Adicionar Novo | 0 | 3 | 0 |  |
| SCR-048 | Cadastros Base | Fiscais | Contadores | `/admin/contador` | Listagem | Saiba +, Adicionar Novo | 0 | 5 | 0 |  |
| SCR-049 | Cadastros Base | Fiscais | Natureza de Operaçao | `/admin/natureoperations` | Listagem | Saiba +, Adicionar Novo, Editar, Excluir | 3 | 7 | 0 |  |
| SCR-050 | Cadastros Base | Fiscais | Informações Complementares | `/admin/additional-info` | Listagem | Adicionar Novo | 0 | 3 | 0 |  |
| SCR-051 | Cadastros Base | Fiscais | Planos de Contas | `/admin/plan-accounts` | Listagem | Saiba +, fas fa-print, Importar, Exportar, Adicionar Novo, Visualizar, Editar, Excluir | 4 | 5 | 1 |  |
| SCR-052 | Cadastros Base | Agrícolas | Operação | `/admin/operations` | Listagem | Adicionar Novo, Visualizar, Editar, Excluir | 0 | 5 | 0 |  |
| SCR-053 | Cadastros Base | Agrícolas | Atividades | `/admin/activities` | Listagem | Adicionar Novo, Visualizar, Editar, Excluir | 2 | 5 | 0 |  |
| SCR-054 | Cadastros Base | Pecuários | Parâmetros de Peso | `/admin/parameter-weights` | Listagem | Adicionar Novo | 0 | 6 | 0 |  |
| SCR-055 | Cadastros Base | Pecuários | Forragem | `/admin/fodder` | Listagem | Adicionar Novo, Visualizar, Editar, Excluir | 0 | 3 | 0 |  |
| SCR-056 | Cadastros Base | Pecuários | Animais | `/admin/animals` | Listagem | Importar, Exportar, Adicionar Novo, Filtrar, Limpar, text-light, Visualizar, Editar, Excluir, 2, 3, 4, 5, 6, 7, 8, 9, 10, 46, 47, › | 4 | 8 | 1 |  |
| SCR-057 | Cadastros Base | Pecuários | Custo Retroativo | `/admin/animal-retroactive-costs` | Listagem | Importar, Salvar | 1 | 4 | 11 |  |
| SCR-058 | Cadastros Base | Pecuários | Módulos de Pastejo | `/admin/grazing` | Listagem | Adicionar Novo | 0 | 7 | 0 |  |
| SCR-059 | Cadastros Base | Pecuários | Cochos | `/admin/troughs` | Listagem | Adicionar Novo, Editar, Excluir | 1 | 9 | 0 |  |
| SCR-060 | Cadastros Base | Pecuários | Lotes de Animais | `/admin/batches` | Listagem | Importar, Adicionar Novo | 1 | 5 | 1 |  |
| SCR-061 | Cadastros Base | Pecuários | Lote/Módulo | `/admin/batch-grazing` | Listagem | Adicionar Novo | 2 | 6 | 0 |  |
| SCR-062 | Cadastros Base | Pecuários | Lote/Área | `/admin/batch-area` | Listagem | Adicionar Novo | 2 | 6 | 0 |  |
| SCR-063 | Cadastros Base | Bens/Ativos | Inventário | `/admin/equipments` | Listagem | Saiba +, Importar, Exportar, Adicionar Novo | 6 | 7 | 1 |  |
| SCR-064 | Cadastros Base | Bens/Ativos | Depreciação Mensal | `/admin/depreciations` | Listagem | Safra, Saiba + | 6 | 10 | 1 |  |
| SCR-065 | Cadastros Base | Bens/Ativos | Previsão de Depreciação | `/admin/depreciation-forecast` | Página |  | 2 | 0 | 0 |  |
| SCR-066 | Cadastros Base | Gerais | Fiscais | `/admin/tenant-parameters` | Formulário |  | 0 | 0 | 2 |  |
| SCR-067 | Administrativo | Suprimentos | SLA Status | `/admin/supply-status` | Listagem | Editar | 0 | 4 | 0 |  |
| SCR-068 | Administrativo | Suprimentos | Meus Processos | `/admin/my-proccesses` | Listagem | Visualizar, Relatório SLA, Acusar ciência, Voltar Etapa | 0 | 10 | 8 | /admin/request-purchase/{id}, /admin/supply-status-report?id=15471, /admin/request-authorization/{id}/second |
| SCR-069 | Administrativo | Suprimentos | Solicitação | `/admin/request-purchase` | Listagem | Saiba +, Adicionar Novo | 5 | 9 | 8 |  |
| SCR-070 | Administrativo | Suprimentos | Rejeitados/Cancelados | `/admin/rejected-requests` | Listagem |  | 4 | 9 | 0 |  |
| SCR-071 | Administrativo | Suprimentos | Cotações | `/admin/request-quotation` | Listagem | Saiba +, Visualizar, Relatório SLA, Transferir Responsável | 9 | 11 | 8 | /admin/request-purchase/{id}, /admin/supply-status-report?id=15190, /admin/request-purchase/{id}/change |
| SCR-072 | Administrativo | Suprimentos | Autorização | `/admin/request-authorization` | Listagem | Saiba + | 5 | 9 | 8 |  |
| SCR-073 | Administrativo | Suprimentos | Compras | `/admin/request-buy` | Listagem | Transferir Responsável em Lote, Saiba +, Enviar pedido de compras., Visualizar, Relatório SLA, Transferir Responsável, Download Arquivo | 9 | 10 | 8 | /admin/request-purchase/{id}, /admin/supply-status-report?id=22157, /admin/request-purchase/{id}/change |
| SCR-074 | Administrativo | Suprimentos | Recebimentos | `/admin/request-receipts` | Listagem | Saiba +, Visualizar, Relatório SLA, Transferir Responsável | 8 | 13 | 8 | /admin/request-purchase/{id}, /admin/supply-status-report?id=15190, /admin/request-purchase/{id}/change |
| SCR-075 | Administrativo | Estoque | Entrada/Insumos | `/admin/input-entries` | Listagem | Adicionar Novo | 4 | 7 | 0 |  |
| SCR-076 | Administrativo | Estoque | Aprovação de Notas Fiscais | `/admin/dfe-drafts` | Listagem | DFe Recebidas | 1 | 6 | 0 |  |
| SCR-077 | Administrativo | Estoque | Perfis de Lançamento por Fornecedor | `/admin/provider-launch-profiles` | Listagem | Adicionar Novo | 2 | 5 | 0 |  |
| SCR-078 | Administrativo | Estoque | Baixa de Estoque | `/admin/stock-writeoffs` | Listagem | Saiba +, Adicionar Novo | 2 | 5 | 0 |  |
| SCR-079 | Administrativo | Estoque | Requisição do Estoque | `/admin/requisitions` | Listagem | Saiba +, Importar, Adicionar Novo | 6 | 7 | 2 |  |
| SCR-080 | Administrativo | Estoque | Devolução do Estoque | `/admin/devolution` | Listagem | Saiba +, Importar, Adicionar Novo | 6 | 6 | 2 |  |
| SCR-081 | Administrativo | Estoque | Correção de Estoque | `/admin/stock-corrections` | Listagem | Importar | 2 | 4 | 1 |  |
| SCR-082 | Administrativo | Estoque | Transferência de Armazém | `/admin/warehouse-transfer` | Listagem | Saiba +, Adicionar Novo | 5 | 9 | 0 |  |
| SCR-083 | Administrativo | Estoque | Transferência de Armazém entre Fazendas | `/admin/warehouse-transfer-between-farms` | Listagem | Saiba +, Adicionar Novo | 5 | 11 | 0 |  |
| SCR-084 | Administrativo | Estoque | Saldo Estoque | `/admin/stocks` | Listagem | Agrupar, fas fa-print, Exportar, Visualizar | 3 | 9 | 0 | /admin/stock?farm=132&product=584968&warehouse=733 |
| SCR-085 | Administrativo | Estoque > Fábrica | Batida | `/admin/food-beats` | Listagem | Adicionar Novo | 4 | 9 | 1 |  |
| SCR-086 | Administrativo | Gestão Pessoal | Eventos | `/admin/events` | Listagem | Saiba +, Adicionar Novo, Visualizar, Editar, Excluir | 3 | 6 | 0 |  |
| SCR-087 | Administrativo | Gestão Pessoal | Funções | `/admin/functions` | Listagem | Saiba +, Adicionar Novo, Visualizar, Editar, Excluir | 1 | 3 | 0 |  |
| SCR-088 | Administrativo | Gestão Pessoal | Equipes | `/admin/teams` | Listagem | Saiba +, fas fa-print, Adicionar Novo | 0 | 4 | 0 |  |
| SCR-089 | Administrativo | Gestão Pessoal | Registro/Faltas | `/admin/absences` | Listagem | Saiba +, Adicionar Novo | 0 | 4 | 0 |  |
| SCR-090 | Administrativo | Gestão Pessoal | Adiant. Salarial | `/admin/advances` | Listagem | Saiba +, fas fa-print, Adicionar Novo | 0 | 4 | 0 |  |
| SCR-091 | Administrativo | Gestão Pessoal | Registro/Eventos | `/admin/bonuses` | Listagem | Saiba +, Adicionar Novo | 0 | 5 | 0 |  |
| SCR-092 | Administrativo | Gestão Pessoal | Funcionário x Eventos | `/admin/employeeevents` | Listagem | Saiba +, fas fa-print, Importar, Adicionar Novo | 0 | 4 | 1 |  |
| SCR-093 | Administrativo | Gestão Pessoal | Apuração Mensal | `/admin/earnings` | Listagem | Saiba +, Apuração Mensal (Grade), Importar, Gerar financeiro | 6 | 7 | 1 |  |
| SCR-094 | Administrativo | Gestão Documentos | Tipos de Documento | `/admin/document-types` | Listagem | Saiba +, Adicionar Novo, Visualizar, Cria descendente, Editar, Excluir | 0 | 5 | 0 |  |
| SCR-095 | Administrativo | Gestão Documentos | Gestão de Documentos | `/admin/document-managements` | Listagem | Saiba +, Adicionar Novo | 3 | 5 | 0 |  |
| SCR-096 | Operacional | Pecuária | Gestão Animais | `/admin/animals-management` | Listagem | Transferir de Lote, Realizar Pesagem, Realizar Sanitário, Status Reprodutivo, Importar, Exportar, Adicionar Novo, Filtrar, Limpar, text-light, Visualizar, Editar, Excluir, 2, 3, 4, 5, 6, 7, 8, 9, 10, 23, 24, › | 8 | 8 | 1 |  |
| SCR-097 | Operacional | Pecuária | Inventariado Animais | `/admin/inventoried-animals` | Listagem | Importar | 0 | 6 | 1 |  |
| SCR-098 | Operacional | Pecuária | Planejamento Pecuário | `/admin/planning-livestock` | Listagem | Adicionar Novo | 0 | 7 | 0 |  |
| SCR-099 | Operacional | Pecuária > Transferências | Evolução de Rebanho | `/admin/evolution-animals` | Listagem |  | 3 | 5 | 0 |  |
| SCR-100 | Operacional | Pecuária > Transferências | Agrupar Lotes | `/admin/grouper-batches` | Listagem | Agrupar, Novo Lote | 1 | 4 | 6 |  |
| SCR-101 | Operacional | Pecuária > Movimentações | Venda de Animais | `/admin/movement-sales` | Listagem | Adicionar Novo | 5 | 10 | 0 |  |
| SCR-102 | Operacional | Pecuária > Movimentações | Compra de Animais | `/admin/movement-purchases` | Listagem | Adicionar Novo | 4 | 9 | 0 |  |
| SCR-103 | Operacional | Pecuária > Movimentações | Nascimentos | `/admin/birth-animals` | Listagem | Importar, Adicionar Novo | 4 | 8 | 1 |  |
| SCR-104 | Operacional | Pecuária > Movimentações | Mortes | `/admin/death-animals` | Listagem | Adicionar Novo | 4 | 5 | 0 |  |
| SCR-105 | Operacional | Pecuária > Movimentações | Perdas | `/admin/loss-animals` | Listagem | Adicionar Novo | 4 | 6 | 0 |  |
| SCR-106 | Operacional | Pecuária > Manejo | Processamentos | `/admin/processing` | Listagem | Processar | 4 | 8 | 0 |  |
| SCR-107 | Operacional | Pecuária > Manejo | Pré-Lotes | `/admin/purchase-lots` | Listagem | Adicionar Novo | 0 | 7 | 0 |  |
| SCR-108 | Operacional | Pecuária > Manejo | Pesagens | `/admin/weighings` | Listagem | Importar, Adicionar Novo, Visualizar, Relatório Individual, Exportar Excel, Editar, Excluir | 3 | 10 | 1 |  |
| SCR-109 | Operacional | Pecuária > Manejo | Nutrição | `/admin/nutritions` | Listagem | Adicionar Novo | 4 | 8 | 1 |  |
| SCR-110 | Operacional | Pecuária > Manejo | Sanitários | `/admin/sanitaries` | Listagem | Adicionar Novo | 2 | 4 | 0 |  |
| SCR-111 | Operacional | Pecuária > Manejo | Desmama | `/admin/weanings` | Listagem | Adicionar Novo | 1 | 4 | 0 |  |
| SCR-112 | Operacional | Pecuária > Manejo | Apartações | `/admin/separations` | Listagem | Adicionar Novo | 1 | 7 | 0 |  |
| SCR-113 | Operacional | Pecuária > Manejo | Localizar Animal | `/admin/locate-animals` | Página |  | 1 | 0 | 0 |  |
| SCR-114 | Operacional | Pecuária > Manejo | Pastagem | `/admin/pastures` | Listagem | Adicionar Novo, Visualizar, Finalizar, Excluir | 3 | 7 | 0 |  |
| SCR-115 | Operacional | Pecuária > Manejo > Reprodução | Gerenciamento Reprodutivo Avançado | `/admin/advanced-reproductive` | Listagem | Adicionar Novo Acasalamento | 6 | 6 | 0 |  |
| SCR-116 | Operacional | Pecuária > Manejo > Reprodução | Estações de Monta | `/admin/breeding-seasons` | Listagem | Saiba +, Adicionar Novo | 1 | 7 | 0 |  |
| SCR-117 | Operacional | Pecuária > Manejo > Reprodução | Lotes/Reprodução | `/admin/breeding-batch` | Listagem | Adicionar Novo | 2 | 5 | 0 |  |
| SCR-118 | Operacional | Pecuária > Manejo > Reprodução | Touros/Sêmen/Embrião | `/admin/bull-seed-season` | Listagem | Adicionar Novo | 2 | 5 | 0 |  |
| SCR-119 | Operacional | Pecuária > Manejo > Reprodução | Protocolos/Estação | `/admin/protocols-season` | Listagem | Adicionar Novo | 2 | 6 | 0 |  |
| SCR-120 | Operacional | Pecuária > Manejo > Reprodução | Acasalamento | `/admin/breeding-matings` | Listagem | Adicionar Novo | 2 | 7 | 0 |  |
| SCR-121 | Operacional | Pecuária > Confinamento > Cadastros | Pátio | `/admin/feedlot-yards` | Listagem | Adicionar Novo | 3 | 6 | 0 |  |
| SCR-122 | Operacional | Pecuária > Confinamento > Cadastros | Setores | `/admin/feedlot-sectors` | Listagem | Adicionar Novo | 4 | 7 | 0 |  |
| SCR-123 | Operacional | Pecuária > Confinamento > Cadastros | Curral | `/admin/feedlot-corrals` | Listagem | Adicionar Novo | 5 | 11 | 0 |  |
| SCR-124 | Operacional | Pecuária > Confinamento > Nutrição | Dietas | `/admin/diets` | Listagem | Adicionar Novo | 3 | 7 | 1 |  |
| SCR-125 | Operacional | Pecuária > Confinamento > Nutrição | Fases/Regras de Troca | `/admin/feeding-phases` | Listagem | Adicionar Novo | 3 | 6 | 0 |  |
| SCR-126 | Operacional | Pecuária > Confinamento > Nutrição | Batelada | `/admin/diet-beats` | Listagem | Adicionar Novo | 3 | 6 | 0 |  |
| SCR-127 | Operacional | Pecuária > Confinamento > Nutrição | Trato Diário | `/admin/diet-beat-supplies` | Listagem | Adicionar Novo | 2 | 7 | 0 |  |
| SCR-128 | Operacional | Pecuária > Confinamento > Nutrição | Leitura de Cocho | `/admin/trough-readings` | Listagem | Adicionar Novo | 2 | 4 | 0 |  |
| SCR-129 | Operacional | Pecuária > Confinamento | Mapa de Confinamento | `/admin/feedlot-map` | Página |  | 0 | 0 | 0 |  |
| SCR-130 | Operacional |  | Pluviometria | `/admin/rainfalls` | Listagem | Importar, Adicionar Novo | 2 | 5 | 1 |  |
| SCR-131 | Operacional | Vendas | Orçamentos | `/admin/budgets` | Listagem | Adicionar Novo | 6 | 7 | 0 |  |
| SCR-132 | Operacional | Vendas | Pedidos | `/admin/orders` | Listagem | Adicionar Novo | 6 | 7 | 0 |  |
| SCR-133 | Operacional | Vendas | Vendas | `/admin/sales` | Listagem | Adicionar Novo | 6 | 9 | 0 |  |
| SCR-134 | Operacional | Ordens de Serviço | Minhas Ordens de Serviço | `/admin/my-service-orders` | Listagem |  | 4 | 7 | 0 |  |
| SCR-135 | Operacional | Ordens de Serviço | Ordem de Serviço | `/admin/service-orders` | Listagem | Adicionar novo | 4 | 7 | 0 |  |
| SCR-136 | Operacional | Ordens de Serviço | Monitoramento de Ordens de Serviço | `/admin/monitoring-service-orders` | Listagem |  | 4 | 7 | 0 |  |
| SCR-137 | Operacional | Ordens de Serviço | Avaliação de Ordens de Serviço | `/admin/rating-service-orders` | Listagem |  | 4 | 7 | 0 |  |
| SCR-138 | Financeiro |  | Análise do Fluxo Bancário | `/admin/cash-flow` | Relatório | Simular Crédito | 5 | 0 | 0 |  |
| SCR-139 | Financeiro |  | Gestão Contratos | `/admin/contracts` | Listagem | Adicionar Novo | 2 | 5 | 0 |  |
| SCR-140 | Financeiro |  | Previsão Orçamentária Anual | `/admin/budget-plannings` | Listagem | Importar, Adicionar Novo | 0 | 5 | 2 |  |
| SCR-141 | Financeiro |  | Congelamento Financeiro | `/admin/financial-freezes` | Listagem | Adicionar Novo | 2 | 8 | 0 |  |
| SCR-142 | Financeiro |  | Planilha de Movimentos | `/admin/movement-sheets` | Listagem | Importar | 2 | 4 | 1 |  |
| SCR-143 | Gestão de Frota |  | Manutenções | `/admin/maintenances` | Listagem | Adicionar Novo | 3 | 5 | 0 |  |
| SCR-144 | Gestão de Frota |  | Abastecimentos | `/admin/supplies` | Listagem | Adicionar Novo | 3 | 5 | 1 |  |
| SCR-145 | Gestão de Frota |  | Manutenções Preventivas | `/admin/maintenance-preventives` | Listagem | Adicionar Novo | 3 | 5 | 0 |  |
| SCR-146 | Gestão de Frota |  | Revisões Agendadas | `/admin/scheduled-reviews` | Listagem |  | 0 | 4 | 0 |  |
| SCR-147 | Gestão de Frota |  | Transferência de Máquinas | `/admin/equipment-transfer` | Listagem | Adicionar Novo | 2 | 7 | 0 |  |
| SCR-148 | Gestão Fiscal | NFe | Arquivos XML | `/admin/xml` | Página | Saiba + | 6 | 0 | 0 |  |
| SCR-149 | Gestão Fiscal | MDFe | MDFe | `/admin/mdfe` | Listagem | Saiba +, Consultar não encerrados, Adicionar Novo | 11 | 10 | 0 |  |
| SCR-150 | Gestão Fiscal | MDFe | MDFe | `/admin/mdfe/create` | Cadastro (novo) | Voltar | 0 | 35 | 63 |  |
| SCR-151 | Gestão Fiscal |  | LCDPR - Livro Caixa Digital do Produtor Rural | `/admin/cash-book` | Listagem | Adicionar Novo | 0 | 4 | 0 |  |
| SCR-152 | Gestão Fiscal |  | SPED Fiscal - EFD ICMS/IPI | `/admin/sped-fiscal` | Listagem | Adicionar Novo | 0 | 5 | 0 |  |
| SCR-153 | Gestão Fiscal |  | Partida Dobrada | `/admin/double-entry-accountings` | Listagem | Adicionar Novo | 6 | 7 | 0 |  |
| SCR-154 | Relatórios | Bens/Ativo | Relatório Inventário Patrimonial | `/admin/equipment-report` | Relatório |  | 5 | 0 | 0 |  |
| SCR-155 | Relatórios | Bens/Ativo | Relatorio de Depreciação Acumulada | `/admin/accumulated-depreciation-report` | Relatório |  | 4 | 0 | 0 |  |
| SCR-156 | Relatórios | Pecuária | Composição Rebanho | `/admin/herd-composition-report` | Relatório |  | 14 | 0 | 0 |  |
| SCR-157 | Relatórios | Pecuária | Custeio/Área Pecuária | `/admin/costing-livestock-area-report` | Relatório |  | 5 | 0 | 0 |  |
| SCR-158 | Relatórios | Pecuária | Relatório Pesagem/Animal | `/admin/weighing-batch-report` | Relatório |  | 6 | 0 | 0 |  |
| SCR-159 | Relatórios | Pecuária | Relatório Pesagem/Lote | `/admin/accumulated-weighing-batch-report` | Relatório |  | 6 | 0 | 0 |  |
| SCR-160 | Relatórios | Pecuária | Relatório de Pesagem do Confinamento | `/admin/feedlot-weighing-performance-report` | Relatório |  | 5 | 0 | 0 |  |
| SCR-161 | Relatórios | Pecuária | Relatório Nutrição: Consumo / Lote | `/admin/nutrition-report` | Relatório |  | 5 | 0 | 0 |  |
| SCR-162 | Relatórios | Pecuária | Relatório Sanitário/lote | `/admin/sanitaries-batch-report` | Relatório |  | 8 | 0 | 0 |  |
| SCR-163 | Relatórios | Pecuária | Relatório Manejo/lote | `/admin/management-batch-report` | Relatório |  | 4 | 0 | 0 |  |
| SCR-164 | Relatórios | Pecuária | Relatório Animais/Categoria | `/admin/category-animal-report` | Relatório |  | 5 | 0 | 0 |  |
| SCR-165 | Relatórios | Pecuária | Transferência Lote/Módulo/Área | `/admin/report-transfer-batch-grazing-area` | Relatório |  | 3 | 0 | 0 |  |
| SCR-166 | Relatórios | Pecuária | Estoque de Rebanho | `/admin/animals-report` | Relatório |  | 3 | 0 | 0 |  |
| SCR-167 | Relatórios | Pecuária | Relatório Aplicação/Manejo da Pecuária | `/admin/application-management-report` | Relatório |  | 4 | 0 | 0 |  |
| SCR-168 | Relatórios | Pecuária | Relatório de Movimentação de Rebanho | `/admin/animal-movements-report` | Relatório |  | 3 | 0 | 0 |  |
| SCR-169 | Relatórios | Pecuária | Relatório Desmama | `/admin/weaning-report` | Relatório |  | 3 | 0 | 0 |  |
| SCR-170 | Relatórios | Pecuária | Relatório Nascimentos | `/admin/birth-report` | Relatório |  | 4 | 0 | 0 |  |
| SCR-171 | Relatórios | Pecuária | Relatório Mortes | `/admin/death-animals-report` | Relatório |  | 3 | 0 | 0 |  |
| SCR-172 | Relatórios | Pecuária | Relatório Ficha Animal | `/admin/animal-record-report` | Relatório |  | 3 | 0 | 0 |  |
| SCR-173 | Relatórios | Pecuária | Relatório Vacas Prenhas | `/admin/pregnant-cows-report` | Relatório |  | 7 | 0 | 0 |  |
| SCR-174 | Relatórios | Pecuária | Relatório Vendas de Animais | `/admin/animals-sales/report` | Relatório |  | 6 | 0 | 0 |  |
| SCR-175 | Relatórios | Pecuária | Relatório Compras de Animais | `/admin/animals-purchases/report` | Relatório |  | 5 | 0 | 0 |  |
| SCR-176 | Relatórios | Pecuária | Relatório Evolução de Rebanho | `/admin/evolution-animals-report` | Relatório |  | 3 | 0 | 0 |  |
| SCR-177 | Relatórios | Pecuária | Relatório Identificação/SISBOV | `/admin/identification-animals-sisbovs-report` | Relatório |  | 4 | 0 | 0 |  |
| SCR-178 | Relatórios | Pecuária | Relatório Mortes/SISBOV | `/admin/death-animals-sisbovs-report` | Relatório |  | 2 | 0 | 0 |  |
| SCR-179 | Relatórios | Pecuária | Relatório Nascimentos/SISBOV | `/admin/birth-animals-sisbovs-report` | Relatório |  | 2 | 0 | 0 |  |
| SCR-180 | Relatórios | Pecuária | Relatório Custo/Lote | `/admin/costing-batch-report` | Relatório |  | 5 | 0 | 0 |  |
| SCR-181 | Relatórios | Pecuária | Relatório Custo/Módulo | `/admin/costing-grazing-report` | Relatório |  | 4 | 0 | 0 |  |
| SCR-182 | Relatórios | Pecuária | Relatório Custo/Animal | `/admin/costing-animal-report` | Relatório |  | 4 | 0 | 0 |  |
| SCR-183 | Relatórios | Pecuária | Relatório Custo Total de Reprodução | `/admin/total-cost-of-reproduction-report` | Relatório |  | 3 | 0 | 0 |  |
| SCR-184 | Relatórios | Pecuária | Relatório de Performance Animal Individual | `/admin/batch-profitability-report` | Relatório |  | 5 | 0 | 0 |  |
| SCR-185 | Relatórios | Pecuária | Relatório Histórico Reprodutivo das Matrizes | `/admin/reproductive-history-report` | Relatório |  | 5 | 0 | 0 |  |
| SCR-186 | Relatórios | Pecuária | Registro Genealógico | `/admin/animal-family-tree-report` | Relatório |  | 1 | 0 | 0 |  |
| SCR-187 | Relatórios | Pecuária | Relatório de Eficiência de Reprodução de Touros | `/admin/bull-reproductive-efficiency-report` | Relatório |  | 4 | 0 | 0 |  |
| SCR-188 | Relatórios | Pecuária | Relatório de Análise de Movimentação Lote | `/admin/animal-movement-analysis-report` | Relatório |  | 4 | 0 | 0 |  |
| SCR-189 | Relatórios | Pecuária | Relatório de Produtividade De Receptora | `/admin/receiver-cow-productivity-report` | Relatório |  | 4 | 0 | 0 |  |
| SCR-190 | Relatórios | Pecuária | Relatório de Animais por Lote com Visualização Detalhada ou Geral | `/admin/animals-per-batch-report` | Relatório |  | 3 | 0 | 0 |  |
| SCR-191 | Relatórios | Pecuária | Relatório Histórico de Animais/Lote | `/admin/animal-batch-history-report` | Relatório |  | 6 | 0 | 0 |  |
| SCR-192 | Relatórios | Pecuária | Relatório Controle de Lotes Ativos no Confinamento | `/admin/feedlot-batch-control-report` | Relatório |  | 6 | 0 | 0 |  |
| SCR-193 | Relatórios | Pecuária | Relatório de Cosnumo/Planejado | `/admin/feedlot-planned-consumption-report` | Relatório |  | 6 | 0 | 0 |  |
| SCR-194 | Relatórios | Pecuária | Relatório Operacional Diário com Resumo das Atividades do Confinamento | `/admin/feedlot-summary-activity-report` | Relatório |  | 4 | 0 | 0 |  |
| SCR-195 | Relatórios |  | Relatório de Pluviometria | `/admin/rainfall-report` | Relatório |  | 4 | 0 | 0 |  |
| SCR-196 | Relatórios | Financeiro | Agenda de Recebimentos | `/admin/receipt-schedule-report` | Relatório |  | 8 | 0 | 0 |  |
| SCR-197 | Relatórios | Financeiro | Contas a Pagar | `/admin/expenses-report` | Relatório |  | 15 | 0 | 0 |  |
| SCR-198 | Relatórios | Financeiro | Contas Pagas | `/admin/paid-expenses-report` | Relatório |  | 16 | 0 | 0 |  |
| SCR-199 | Relatórios | Financeiro | Contas a Receber | `/admin/incomes-report` | Relatório |  | 14 | 0 | 0 |  |
| SCR-200 | Relatórios | Financeiro | Contas Recebidas | `/admin/paid-incomes-report` | Relatório |  | 14 | 0 | 0 |  |
| SCR-201 | Relatórios | Financeiro | Relatório de Juros Recebidos | `/admin/received-interest-report` | Relatório |  | 6 | 0 | 0 |  |
| SCR-202 | Relatórios | Financeiro | Relatório de Juros Pagos | `/admin/paid-interest-report` | Relatório |  | 6 | 0 | 0 |  |
| SCR-203 | Relatórios | Financeiro | Extrato Financeiro | `/admin/bank-statement-report` | Relatório |  | 9 | 0 | 0 |  |
| SCR-204 | Relatórios | Financeiro | Razão Contábil | `/admin/ledger-report` | Relatório |  | 9 | 0 | 0 |  |
| SCR-205 | Relatórios | Financeiro | Razão Categoria | `/admin/ledger-category-report` | Relatório |  | 9 | 0 | 0 |  |
| SCR-206 | Relatórios | Financeiro | Recebimento Previsto X Realizado | `/admin/rec-prev-real-report` | Relatório |  | 9 | 0 | 0 |  |
| SCR-207 | Relatórios | Financeiro | Pagamento Previsto X Realizado | `/admin/pag-prev-real-report` | Relatório |  | 9 | 0 | 0 |  |
| SCR-208 | Relatórios | Financeiro | Previsto x Realizado Anual | `/admin/budget-planning-predicted-report` | Relatório |  | 3 | 0 | 0 |  |
| SCR-209 | Relatórios | Financeiro | Acesse mais e melhor crédito! | `/admin/cash-flow-by-category-report` | Relatório |  | 11 | 0 | 0 |  |
| SCR-210 | Relatórios | Financeiro | Acesse mais e melhor crédito! | `/admin/cash-flow-forecast-report` | Relatório |  | 8 | 0 | 0 |  |
| SCR-211 | Relatórios | Financeiro | Movimentação Bancária/Financeira | `/admin/financial-movement-report` | Relatório |  | 10 | 0 | 0 |  |
| SCR-212 | Relatórios | Financeiro | Fiscal/Não Fiscal | `/admin/fiscal-difference-report` | Relatório |  | 9 | 0 | 0 |  |
| SCR-213 | Relatórios | Financeiro | Custo de Produção por Período | `/admin/income-statement` | Relatório |  | 12 | 0 | 0 |  |
| SCR-214 | Relatórios | Financeiro | Custo de Produção por Mês | `/admin/accumulated-income-statement` | Relatório |  | 12 | 0 | 0 |  |
| SCR-215 | Relatórios | Financeiro | Acesse mais e melhor crédito! | `/admin/dre` | Relatório |  | 6 | 0 | 0 |  |
| SCR-216 | Relatórios | Financeiro | Acesse mais e melhor crédito! | `/admin/dre-annual` | Relatório |  | 6 | 0 | 0 |  |
| SCR-217 | Relatórios | Financeiro | Acesse mais e melhor crédito! | `/admin/receipt-cashflow-report` | Relatório |  | 8 | 0 | 0 |  |
| SCR-218 | Relatórios | Financeiro | Relatório de Estoque/Financeiro | `/admin/cashflow-product-report` | Relatório |  | 3 | 0 | 0 |  |
| SCR-219 | Relatórios | Financeiro | Acesse mais e melhor crédito! | `/admin/cost-center-report` | Relatório |  | 8 | 0 | 0 |  |
| SCR-220 | Relatórios | Financeiro | Relatório de Apuração de Custos por Conta e Centro de Custo | `/admin/cost-calculation-report` | Relatório |  | 7 | 0 | 0 |  |
| SCR-221 | Relatórios | Financeiro | Relatório Financiamentos | `/admin/financings-report` | Relatório |  | 3 | 0 | 0 |  |
| SCR-222 | Relatórios | Financeiro | Títulos de Adiantamento | `/admin/advance-titles-report` | Relatório |  | 10 | 0 | 0 |  |
| SCR-223 | Relatórios | Financeiro | Relatório de Conciliação de Contas Consolidadas | `/admin/account-reconciliation-report` | Relatório |  | 8 | 0 | 0 |  |
| SCR-224 | Relatórios | Financeiro | Acesse mais e melhor crédito! | `/admin/cost-centers-unified-report` | Relatório |  | 5 | 0 | 0 |  |
| SCR-225 | Relatórios | Financeiro | Relatório de Contas Tributárias e Não Tributárias | `/admin/tax-accounts` | Relatório |  | 6 | 0 | 0 |  |
| SCR-226 | Relatórios | Financeiro | Relatório Consolidado de Contas a Pagar e Receber | `/admin/accounts-payable-receivable-report` | Relatório |  | 11 | 0 | 0 |  |
| SCR-227 | Relatórios | Financeiro | Relatório de Saldo Devedor/Fornecedor | `/admin/provider-balance-report` | Relatório |  | 6 | 0 | 0 |  |
| SCR-228 | Relatórios | Estoque | Relatório Movimentação Estoque | `/admin/stock-movement-report` | Relatório |  | 5 | 0 | 0 |  |
| SCR-229 | Relatórios | Estoque | Relatório de Requisição/Saída | `/admin/requisitions-report` | Relatório |  | 5 | 0 | 0 |  |
| SCR-230 | Relatórios | Estoque | Relatório Baixa Estoque | `/admin/stock-writeoffs-report` | Relatório |  | 4 | 0 | 0 |  |
| SCR-231 | Relatórios | Estoque | Relatório DFe | `/admin/dfe-report` | Relatório |  | 7 | 0 | 0 |  |
| SCR-232 | Relatórios | Estoque | Relatório Custo Produção Batida | `/admin/food-beat-report` | Relatório |  | 3 | 0 | 0 |  |
| SCR-233 | Relatórios | Estoque | Relatório de Curva ABC | `/admin/stocks-abc-report` | Relatório |  | 3 | 0 | 0 |  |
| SCR-234 | Relatórios | Estoque | Relatório Recebimentos | `/admin/receipts-report` | Relatório |  | 6 | 0 | 0 |  |
| SCR-235 | Relatórios | Estoque | Relatório Estoque Consolidado | `/admin/stocks-consolidated-report` | Relatório |  | 8 | 0 | 0 |  |
| SCR-236 | Relatórios | Estoque | Relatório de Lote/Fornecedor | `/admin/stocks-lot-provider` | Página |  | 4 | 0 | 0 |  |
| SCR-237 | Relatórios | Estoque | Saída de Produtos x Centro de Custo | `/admin/products-exit-cost-center-report` | Relatório |  | 6 | 0 | 0 |  |
| SCR-238 | Relatórios | Suprimentos | Relatório de Suprimentos | `/admin/supplies-report` | Relatório |  | 9 | 0 | 0 |  |
| SCR-239 | Relatórios | Suprimentos | Relatório Savings | `/admin/savings-report` | Relatório |  | 6 | 0 | 0 |  |
| SCR-240 | Relatórios | Suprimentos | Relatório ANS | `/admin/ans-report` | Relatório |  | 3 | 0 | 0 |  |
| SCR-241 | Relatórios | Suprimentos | Relatório de Orçamentos/Fornecedores | `/admin/request-quotation-report` | Relatório |  | 5 | 0 | 0 |  |
| SCR-242 | Relatórios | Suprimentos | Relatório Produtos x Previsão de entrega | `/admin/request-purchase-forecast-report` | Relatório |  | 11 | 0 | 0 |  |
| SCR-243 | Relatórios | Suprimentos | Relatório de Status de SLA | `/admin/supply-status-report` | Relatório |  | 3 | 0 | 0 |  |
| SCR-244 | Relatórios | Suprimentos | Relatório Gerencial de Solicitações | `/admin/request-purchase-management-report` | Relatório |  | 6 | 0 | 0 |  |
| SCR-245 | Relatórios | Vendas | Relatório de Vendas/Cliente | `/admin/sales-report` | Relatório |  | 5 | 0 | 0 |  |
| SCR-246 | Relatórios | Vendas | Relatório de Vendas/Produto | `/admin/sales-product-report` | Relatório |  | 4 | 0 | 0 |  |
| SCR-247 | Relatórios | Vendas | Relatório de Vendas por Cliente/Produto | `/admin/sales-client-report` | Relatório |  | 5 | 0 | 0 |  |
| SCR-248 | Relatórios | Vendas | Relatório Vendas/Funcionários | `/admin/sales-employee-report` | Relatório |  | 4 | 0 | 0 |  |
| SCR-249 | Relatórios | Vendas | Relatório de Curva ABC | `/admin/sales-abc-report` | Relatório |  | 4 | 0 | 0 |  |
| SCR-250 | Relatórios | Gestão Pessoal | Cálculo Mensal | `/admin/monthly-calculation` | Relatório |  | 5 | 0 | 0 |  |
| SCR-251 | Relatórios | Gestão Pessoal | Relatório de Aniversariantes | `/admin/birthdays-report` | Relatório |  | 1 | 0 | 0 |  |
| SCR-252 | Relatórios | Gestão Pessoal | Relatório de Horas Logadas | `/admin/logged-hours-report` | Relatório |  | 4 | 0 | 0 |  |
| SCR-253 | Relatórios | Gestão Pessoal | Relatório de Funcionários Ativos | `/admin/active-employees` | Relatório |  | 4 | 0 | 0 |  |
| SCR-254 | Relatórios | Gestão Pessoal | Relatório de Adiantamento Salarial | `/admin/advances/report` | Relatório |  | 4 | 0 | 0 |  |
| SCR-255 | Relatórios | Gestão Fiscal | Relatórios Lançamento Contábil | `/admin/double-entry-accounting-report` | Relatório |  | 5 | 0 | 0 |  |
| SCR-256 | Relatórios | Gestão Fiscal | Relatório NF-e | `/admin/nfe-report` | Relatório |  | 9 | 0 | 0 |  |
| SCR-257 | Relatórios | Gestão Fiscal | Relatório de Faturamento | `/admin/nfe-product-report` | Relatório |  | 7 | 0 | 0 |  |
| SCR-258 | Relatórios | Gestão Fiscal | Relatório de Conferência do Livro Caixa | `/admin/cash-book-report` | Relatório |  | 4 | 0 | 0 |  |
| SCR-259 | Relatórios | Gestão de Frotas | Relatório Máquinas | `/admin/equipment-machines-report` | Relatório |  | 0 | 0 | 7 |  |
| SCR-260 | Relatórios | Gestão de Frotas | Relatório Máquinas - Abastecimentos | `/admin/equipment-machines-supply-report` | Relatório |  | 7 | 0 | 0 |  |
| SCR-261 | Relatórios | Gestão de Frotas | Relatório Máquinas - Manutenções | `/admin/equipment-machines-maintenance-report` | Relatório |  | 7 | 0 | 0 |  |
| SCR-262 | Integrações |  | Integração Domínio | `/admin/integration-dominios` | Listagem | Adicionar Novo | 0 | 4 | 0 |  |
| SCR-263 | Integrações |  | Integração CTA Smart | `/admin/integration-cta-smart` | Listagem | Abastecimentos Importados | 0 | 9 | 3 |  |
| SCR-264 | Integrações |  | CTA Smart - Abastecimentos Importados | `/admin/cta-smart-supplies` | Listagem | Configuração, Sincronizar Agora | 3 | 9 | 1 |  |
| SCR-265 | Integrações | Exportações/CSV | Exportar CSV - Contas Pagas/Recebidas | `/admin/financial-export` | Página |  | 2 | 0 | 0 |  |
| SCR-266 | Cadastros Base | Pessoas | Funcionários | `/admin/employees/report` | Relatório |  | 0 | 0 | 0 |  |
| SCR-267 | Cadastros Base | Pessoas | Funcionários | `/admin/employees/create` | Cadastro (novo) | Voltar | 0 | 0 | 23 |  |
| SCR-268 | Cadastros Base | Pessoas | Funcionários | `/admin/employees/2658` | Detalhe | Voltar | 0 | 0 | 0 |  |
| SCR-269 | Cadastros Base | Pessoas | Funcionários | `/admin/employees/2658/edit` | Cadastro (edição) | Voltar | 0 | 0 | 21 |  |
| SCR-270 | Cadastros Base | Pessoas | Você já atingiu o limite de usuários. Contate o Administrador. | `/admin/users/create` | Cadastro (novo) |  | 0 | 0 | 0 |  |
| SCR-271 | Cadastros Base | Pessoas | Usuários | `/admin/users/1086` | Detalhe | Voltar | 0 | 0 | 0 |  |
| SCR-272 | Cadastros Base | Pessoas | Usuários | `/admin/users/1086/edit` | Cadastro (edição) | Voltar | 0 | 0 | 11 |  |
| SCR-273 | Administrativo | Estoque | Documento Fiscal | `/admin/invoices/create` | Cadastro (novo) | Voltar | 0 | 10 | 142 |  |
| SCR-274 | Administrativo | Estoque | Consulte os documentos | `/admin/dfe/create` | Cadastro (novo) | Voltar | 0 | 4 | 0 |  |
| SCR-275 | Administrativo | Estoque > Fábrica | Formulação | `/admin/foods/create` | Cadastro (novo) | Voltar | 0 | 0 | 12 |  |
| SCR-276 | Financeiro |  | Contas a Pagar | `/admin/expenses/create` | Cadastro (novo) | Voltar | 11 | 8 | 75 |  |
| SCR-277 | Financeiro |  | Contas a Pagar | `/admin/expenses/152422` | Detalhe | Voltar | 0 | 4 | 0 |  |
| SCR-278 | Financeiro |  | Contas a Pagar | `/admin/expenses/152422/edit` | Cadastro (edição) | Voltar | 0 | 7 | 45 |  |
| SCR-279 | Financeiro |  | Conta a Receber | `/admin/incomes/create` | Cadastro (novo) | Voltar | 11 | 7 | 44 |  |
| SCR-280 | Financeiro |  | Conta a Receber | `/admin/incomes/21909` | Detalhe | Voltar | 0 | 4 | 0 |  |
| SCR-281 | Financeiro |  | Conta a Receber | `/admin/incomes/21909/edit` | Cadastro (edição) | Voltar | 0 | 7 | 38 |  |
| SCR-282 | Financeiro |  | Movimento Caixa/Bancário | `/admin/movements/create` | Cadastro (novo) | Voltar | 0 | 7 | 57 |  |
| SCR-283 | Financeiro |  | Movimento Caixa/Bancário | `/admin/movements/280312` | Detalhe | Voltar | 0 | 5 | 0 |  |
| SCR-284 | Financeiro |  | Movimento Caixa/Bancário | `/admin/movements/280312/edit` | Cadastro (edição) | Voltar | 0 | 7 | 22 |  |
| SCR-285 | Financeiro | Conciliação | Importar OFX | `/admin/ofx-imports/create` | Cadastro (novo) | Voltar | 0 | 0 | 6 |  |
| SCR-286 | Financeiro | Conciliação | Importar OFX | `/admin/ofx-imports/548` | Detalhe | Voltar | 0 | 0 | 0 |  |
| SCR-287 | Financeiro | Conciliação | Importar OFX | `/admin/ofx-imports/548/edit` | Cadastro (edição) | Voltar | 0 | 0 | 6 |  |
| SCR-288 | Gestão Fiscal | NFe | NFe | `/admin/nfe/create` | Cadastro (novo) | Voltar, Dados Fiscais | 52 | 9 | 140 |  |
| SCR-289 | Gestão Fiscal |  | Consulte os documentos | `/admin/nfses/create` | Cadastro (novo) | Voltar | 0 | 0 | 0 |  |
| SCR-290 | Cadastros Base | Estrutura | Centro de custo | `/admin/costcenters/2` | Detalhe | Voltar | 0 | 0 | 0 |  |
| SCR-291 | Cadastros Base | Estrutura | Centro de Custo | `/admin/costcenters/1317/edit` | Cadastro (edição) | Voltar | 0 | 0 | 292 |  |
| SCR-292 | Cadastros Base | Estrutura | Fazenda | `/admin/farms/create` | Cadastro (novo) | Importar arquivo KML, Voltar | 0 | 5 | 33 |  |
| SCR-293 | Cadastros Base | Estrutura | Fazendas | `/admin/farms/80` | Detalhe | Exportar KML, Imprimir mapa, Voltar | 0 | 4 | 0 |  |
| SCR-294 | Cadastros Base | Estrutura | Fazenda | `/admin/farms/80/edit` | Cadastro (edição) | Importar arquivo KML, Voltar | 0 | 5 | 33 |  |
| SCR-295 | Cadastros Base | Estrutura | Safras | `/admin/harvests/create` | Cadastro (novo) | Voltar | 0 | 0 | 8 |  |
| SCR-296 | Cadastros Base | Estrutura | Safras | `/admin/harvests/425` | Detalhe | Voltar | 0 | 8 | 0 |  |
| SCR-297 | Cadastros Base | Estrutura | Safras | `/admin/harvests/425/edit` | Cadastro (edição) | Voltar | 0 | 0 | 8 |  |
| SCR-298 | Cadastros Base | Estrutura > Produtos | Endereçamento - Setor | `/admin/addressings/create` | Cadastro (novo) | Voltar | 0 | 0 | 2 |  |
| SCR-299 | Cadastros Base | Estrutura > Produtos | Endereçamento - Setor | `/admin/addressings/1` | Detalhe | Voltar | 0 | 0 | 0 |  |
| SCR-300 | Cadastros Base | Estrutura > Produtos | Endereçamento - Setor | `/admin/addressings/1/edit` | Cadastro (edição) | Voltar | 0 | 0 | 2 |  |
| SCR-301 | Cadastros Base | Estrutura > Produtos | Produtos | `/admin/products/report` | Relatório |  | 0 | 0 | 0 |  |
| SCR-302 | Cadastros Base | Estrutura > Produtos | Produtos | `/admin/products/create` | Cadastro (novo) | Voltar | 0 | 0 | 66 |  |
| SCR-303 | Cadastros Base | Estrutura > Produtos | Produtos | `/admin/products/9036` | Detalhe | Voltar | 0 | 0 | 0 |  |
| SCR-304 | Cadastros Base | Estrutura > Produtos | Produtos | `/admin/products/9036/edit` | Cadastro (edição) | Voltar | 0 | 0 | 66 |  |
| SCR-305 | Cadastros Base | Estrutura > Produtos | Armazém | `/admin/warehouses/create` | Cadastro (novo) | Voltar | 0 | 0 | 4 |  |
| SCR-306 | Cadastros Base | Estrutura > Produtos | Armazém | `/admin/warehouses/733` | Detalhe | Voltar | 0 | 0 | 0 |  |
| SCR-307 | Cadastros Base | Estrutura > Produtos | Armazém | `/admin/warehouses/733/edit` | Cadastro (edição) | Voltar | 0 | 0 | 4 |  |
| SCR-308 | Cadastros Base | Estrutura > Produtos | Saldo Inicial | `/admin/openingbalances/create` | Cadastro (novo) | Voltar | 0 | 0 | 31 |  |
| SCR-309 | Cadastros Base | Estrutura > Produtos | Saldo Inicial | `/admin/openingbalances/16877` | Detalhe | Voltar | 0 | 0 | 0 |  |
| SCR-310 | Cadastros Base | Estrutura > Produtos | Saldo Inicial | `/admin/openingbalances/16877/edit` | Cadastro (edição) | Voltar | 0 | 0 | 11 |  |
| SCR-311 | Cadastros Base | Estrutura > Rateios | Saldo Inicial | `/admin/apportionments/create` | Cadastro (novo) | Voltar | 0 | 0 | 11 |  |
| SCR-312 | Cadastros Base | Pessoas | Perfil Usuário | `/admin/roles/create` | Cadastro (novo) | Voltar | 0 | 0 | 668 |  |
| SCR-313 | Cadastros Base | Pessoas | Perfil Usuário | `/admin/roles/361` | Detalhe | Voltar | 0 | 0 | 0 |  |
| SCR-314 | Cadastros Base | Pessoas | Perfil Usuário | `/admin/roles/361/edit` | Cadastro (edição) | Voltar | 0 | 0 | 668 |  |
| SCR-315 | Cadastros Base | Pessoas | Inscrições Estaduais | `/admin/people/create` | Cadastro (novo) | Voltar, Proprietario, Funcionário, Fornecedor, Cliente, Usuário | 0 | 7 | 69 |  |
| SCR-316 | Cadastros Base | Pessoas | Pessoas | `/admin/people/28907` | Detalhe | Voltar | 0 | 0 | 0 |  |
| SCR-317 | Cadastros Base | Pessoas | Inscrições Estaduais | `/admin/people/28907/edit` | Cadastro (edição) | Voltar, Proprietario, Funcionário, Fornecedor, Cliente, Usuário | 0 | 7 | 67 |  |
| SCR-318 | Cadastros Base | Pessoas | Proprietários | `/admin/proprietaries/report` | Relatório |  | 0 | 0 | 0 |  |
| SCR-319 | Cadastros Base | Pessoas | Inscrições Estaduais | `/admin/proprietaries/create` | Cadastro (novo) | Voltar | 0 | 5 | 10 |  |
| SCR-320 | Cadastros Base | Pessoas | Proprietários | `/admin/proprietaries/56` | Detalhe | Voltar | 0 | 0 | 0 |  |
| SCR-321 | Cadastros Base | Pessoas | Inscrições Estaduais | `/admin/proprietaries/56/edit` | Cadastro (edição) | Voltar | 0 | 5 | 12 |  |
| SCR-322 | Cadastros Base | Pessoas | Fornecedores | `/admin/providers/report` | Relatório |  | 0 | 0 | 0 |  |
| SCR-323 | Cadastros Base | Pessoas | Fornecedores | `/admin/providers/create` | Cadastro (novo) | Voltar | 0 | 0 | 33 |  |
| SCR-324 | Cadastros Base | Pessoas | Fornecedores | `/admin/providers/22911` | Detalhe | Voltar | 0 | 0 | 0 |  |
| SCR-325 | Cadastros Base | Pessoas | Fornecedores | `/admin/providers/22911/edit` | Cadastro (edição) | Voltar | 0 | 0 | 33 |  |
| SCR-326 | Cadastros Base | Pessoas | Clientes | `/admin/clients/report` | Relatório |  | 0 | 0 | 0 |  |
| SCR-327 | Cadastros Base | Pessoas | Inscrições Estaduais | `/admin/clients/create` | Cadastro (novo) | Voltar | 0 | 2 | 21 |  |
| SCR-328 | Cadastros Base | Pessoas | Clientes | `/admin/clients/627` | Detalhe | Voltar | 0 | 0 | 0 |  |
| SCR-329 | Cadastros Base | Pessoas | Inscrições Estaduais | `/admin/clients/627/edit` | Cadastro (edição) | Voltar | 0 | 2 | 21 |  |
| SCR-330 | Cadastros Base | Pessoas | Regras de Autorização | `/admin/authorizers/create` | Cadastro (novo) | Voltar | 0 | 3 | 13 |  |
| SCR-331 | Cadastros Base | Pessoas | Autorizadores | `/admin/authorizers/433` | Detalhe | Voltar | 0 | 0 | 0 |  |
| SCR-332 | Cadastros Base | Pessoas | Regras de Autorização | `/admin/authorizers/433/edit` | Cadastro (edição) | Voltar | 0 | 3 | 13 |  |
| SCR-333 | Cadastros Base | Financeiros | Conta Bancaria | `/admin/accounts/create` | Cadastro (novo) | Voltar | 0 | 0 | 16 |  |
| SCR-334 | Cadastros Base | Financeiros | Contas Bancárias | `/admin/accounts/524` | Detalhe | Voltar | 0 | 0 | 0 |  |
| SCR-335 | Cadastros Base | Financeiros | Contas Bancárias | `/admin/accounts/524/edit` | Cadastro (edição) | Voltar | 0 | 0 | 16 |  |
| SCR-336 | Cadastros Base | Financeiros | Saldo Inicial- Contas | `/admin/open-movements/create` | Cadastro (novo) | Voltar | 0 | 4 | 12 |  |
| SCR-337 | Cadastros Base | Financeiros | Categoria Financeira | `/admin/financialcategories/325` | Detalhe | Voltar | 0 | 0 | 0 |  |
| SCR-338 | Cadastros Base | Financeiros | Categoria Financeira | `/admin/financialcategories/9664/edit` | Cadastro (edição) | Voltar | 0 | 0 | 8 |  |
| SCR-339 | Cadastros Base | Fiscais | Você já atingiu o limite de emissores. | `/admin/issue/create` | Cadastro (novo) |  | 0 | 0 | 0 |  |
| SCR-340 | Cadastros Base | Fiscais | Inscrições Estaduais | `/admin/issue/8/edit` | Cadastro (edição) | Voltar | 0 | 5 | 26 |  |
| SCR-341 | Cadastros Base | Fiscais | Sincronização DFe | `/admin/issue-dfe-sync-time/create` | Cadastro (novo) | Voltar | 0 | 0 | 2 |  |
| SCR-342 | Cadastros Base | Fiscais | Sincronização NFS-e | `/admin/issue-nfse-sync-time/create` | Cadastro (novo) | Voltar | 0 | 0 | 2 |  |
| SCR-343 | Cadastros Base | Fiscais | Regras Fiscais | `/admin/tax-rules/create` | Cadastro (novo) | Voltar | 0 | 0 | 37 |  |
| SCR-344 | Cadastros Base | Fiscais | Novo Contador | `/admin/contador/create` | Cadastro (novo) | Voltar | 0 | 0 | 13 |  |
| SCR-345 | Cadastros Base | Fiscais | Natureza de Operaçao | `/admin/natureoperations/create` | Cadastro (novo) | Voltar | 0 | 0 | 47 |  |
| SCR-346 | Cadastros Base | Fiscais | Natureza de Operação | `/admin/natureoperations/10527/edit` | Cadastro (edição) | Voltar | 0 | 0 | 47 |  |
| SCR-347 | Cadastros Base | Fiscais | Informações Complementares | `/admin/additional-info/create` | Cadastro (novo) | Voltar | 0 | 0 | 3 |  |
| SCR-348 | Cadastros Base | Fiscais | Plano de Contas | `/admin/plan-accounts/report` | Relatório |  | 0 | 0 | 0 |  |
| SCR-349 | Cadastros Base | Fiscais | Planos de Contas | `/admin/plan-accounts/create` | Cadastro (novo) | Voltar | 0 | 0 | 7 |  |
| SCR-350 | Cadastros Base | Fiscais | Planos de Contas | `/admin/plan-accounts/19156` | Detalhe | Voltar | 0 | 0 | 0 |  |
| SCR-351 | Cadastros Base | Fiscais | Planos de Contas | `/admin/plan-accounts/19156/edit` | Cadastro (edição) | Voltar | 0 | 0 | 253 |  |
| SCR-352 | Cadastros Base | Agrícolas | Operação | `/admin/operations/create` | Cadastro (novo) | Voltar | 0 | 0 | 6 |  |
| SCR-353 | Cadastros Base | Agrícolas | Operação | `/admin/operations/101` | Detalhe | Voltar | 0 | 0 | 0 |  |
| SCR-354 | Cadastros Base | Agrícolas | Operação | `/admin/operations/101/edit` | Cadastro (edição) | Voltar | 0 | 0 | 6 |  |
| SCR-355 | Cadastros Base | Agrícolas | Atividades | `/admin/activities/create` | Cadastro (novo) | Voltar | 0 | 0 | 7 |  |
| SCR-356 | Cadastros Base | Agrícolas | Atividades | `/admin/activities/716` | Detalhe | Voltar | 0 | 0 | 0 |  |
| SCR-357 | Cadastros Base | Agrícolas | Atividades | `/admin/activities/716/edit` | Cadastro (edição) | Voltar | 0 | 0 | 7 |  |
| SCR-358 | Cadastros Base | Pecuários | Parâmetro de Peso | `/admin/parameter-weights/create` | Cadastro (novo) | Voltar | 0 | 0 | 6 |  |
| SCR-359 | Cadastros Base | Pecuários | Forragem | `/admin/fodder/create` | Cadastro (novo) | Voltar | 0 | 0 | 2 |  |
| SCR-360 | Cadastros Base | Pecuários | Forragem | `/admin/fodder/13` | Detalhe | Voltar | 0 | 0 | 0 |  |
| SCR-361 | Cadastros Base | Pecuários | Forragem | `/admin/fodder/13/edit` | Cadastro (edição) | Voltar | 0 | 0 | 2 |  |
| SCR-362 | Cadastros Base | Pecuários | Informações do Animal | `/admin/animals/create` | Cadastro (novo) | Voltar | 0 | 3 | 38 |  |
| SCR-363 | Cadastros Base | Pecuários | Tipos de Identificação | `/admin/animals/108942` | Detalhe | Voltar | 0 | 2 | 0 |  |
| SCR-364 | Cadastros Base | Pecuários | Informações do Animal | `/admin/animals/108942/edit` | Cadastro (edição) | Voltar | 0 | 3 | 33 |  |
| SCR-365 | Cadastros Base | Pecuários | Módulo Pastejo | `/admin/grazing/create` | Cadastro (novo) | Voltar | 0 | 4 | 8 |  |
| SCR-366 | Cadastros Base | Pecuários | Cochos | `/admin/troughs/create` | Cadastro (novo) | Voltar | 0 | 0 | 8 |  |
| SCR-367 | Cadastros Base | Pecuários | Cochos | `/admin/troughs/353/edit` | Cadastro (edição) | Voltar | 0 | 0 | 8 |  |
| SCR-368 | Cadastros Base | Pecuários | Lote de Animais | `/admin/batches/create` | Cadastro (novo) | Voltar | 0 | 0 | 8 |  |
| SCR-369 | Cadastros Base | Pecuários | Lote/Módulo | `/admin/batch-grazing/create` | Cadastro (novo) | Voltar | 0 | 0 | 9 |  |
| SCR-370 | Cadastros Base | Pecuários | Lote/Área | `/admin/batch-area/create` | Cadastro (novo) | Voltar | 0 | 0 | 10 |  |
| SCR-371 | Cadastros Base | Bens/Ativos | Inventário | `/admin/equipments/create` | Cadastro (novo) | Voltar | 0 | 0 | 52 |  |
| SCR-372 | Administrativo | Suprimentos | SLA Status | `/admin/supply-status/89/edit` | Cadastro (edição) | Voltar | 0 | 0 | 1 |  |
| SCR-373 | Administrativo | Suprimentos | Solicitação | `/admin/request-purchase/create` | Cadastro (novo) | Voltar | 0 | 0 | 51 |  |
| SCR-374 | Administrativo | Estoque | Nova Entrada / Insumos | `/admin/input-entries/create` | Cadastro (novo) | Voltar | 0 | 0 | 45 |  |
| SCR-375 | Administrativo | Estoque | Novo Perfil de Lançamento | `/admin/provider-launch-profiles/create` | Cadastro (novo) |  | 0 | 4 | 6 |  |
| SCR-376 | Administrativo | Estoque | Baixa de Estoque | `/admin/stock-writeoffs/create` | Cadastro (novo) | Voltar | 0 | 7 | 16 |  |
| SCR-377 | Administrativo | Estoque | Requisição do Estoque | `/admin/requisitions/create` | Cadastro (novo) | Voltar | 0 | 0 | 16 |  |
| SCR-378 | Administrativo | Estoque | Devolução do Estoque | `/admin/devolution/create` | Cadastro (novo) | Voltar | 0 | 0 | 12 |  |
| SCR-379 | Administrativo | Estoque | Transferência de Armazém | `/admin/warehouse-transfer/create` | Cadastro (novo) | Voltar | 0 | 8 | 14 |  |
| SCR-380 | Administrativo | Estoque | Transferência de Armazém entre Fazendas | `/admin/warehouse-transfer-between-farms/create` | Cadastro (novo) | Voltar | 0 | 18 | 30 |  |
| SCR-381 | Administrativo | Estoque | Saldo Estoque | `/admin/stocks/report` | Relatório |  | 0 | 0 | 0 |  |
| SCR-382 | Administrativo | Estoque > Fábrica | Batida | `/admin/food-beats/create` | Cadastro (novo) | Voltar | 0 | 0 | 14 |  |
| SCR-383 | Administrativo | Gestão Pessoal | Eventos | `/admin/events/create` | Cadastro (novo) | Voltar | 0 | 0 | 7 |  |
| SCR-384 | Administrativo | Gestão Pessoal | Eventos | `/admin/events/183` | Detalhe | Voltar | 0 | 0 | 0 |  |
| SCR-385 | Administrativo | Gestão Pessoal | Eventos | `/admin/events/183/edit` | Cadastro (edição) | Voltar | 0 | 0 | 7 |  |
| SCR-386 | Administrativo | Gestão Pessoal | Funções | `/admin/functions/create` | Cadastro (novo) | Voltar | 0 | 0 | 7 |  |
| SCR-387 | Administrativo | Gestão Pessoal | Funções | `/admin/functions/7` | Detalhe | Voltar | 0 | 0 | 0 |  |
| SCR-388 | Administrativo | Gestão Pessoal | Funções | `/admin/functions/7/edit` | Cadastro (edição) | Voltar | 0 | 0 | 7 |  |
| SCR-389 | Administrativo | Gestão Pessoal | Equipes | `/admin/teams/report` | Relatório |  | 0 | 0 | 0 |  |
| SCR-390 | Administrativo | Gestão Pessoal | Equipes | `/admin/teams/create` | Cadastro (novo) | Voltar | 0 | 4 | 7 |  |
| SCR-391 | Administrativo | Gestão Pessoal | Registro/Faltas | `/admin/absences/create` | Cadastro (novo) | Voltar | 0 | 0 | 5 |  |
| SCR-392 | Administrativo | Gestão Pessoal | Rateio do Adiantamento | `/admin/advances/create` | Cadastro (novo) | Voltar | 0 | 9 | 24 |  |
| SCR-393 | Administrativo | Gestão Pessoal | Registro/Eventos | `/admin/bonuses/create` | Cadastro (novo) | Voltar | 0 | 0 | 4 |  |
| SCR-394 | Administrativo | Gestão Pessoal | Funcionário X Eventos | `/admin/employeeevents/report` | Relatório |  | 0 | 0 | 0 |  |
| SCR-395 | Administrativo | Gestão Pessoal | Funcionário x Eventos | `/admin/employeeevents/create` | Cadastro (novo) | Voltar | 0 | 6 | 8 |  |
| SCR-396 | Administrativo | Gestão Documentos | Tipo de Documento | `/admin/document-types/create` | Cadastro (novo) | Voltar | 0 | 0 | 4 |  |
| SCR-397 | Administrativo | Gestão Documentos | Tipo de Documento | `/admin/document-types/35` | Detalhe | Voltar | 0 | 0 | 0 |  |
| SCR-398 | Administrativo | Gestão Documentos | Tipo de Documento | `/admin/document-types/35/edit` | Cadastro (edição) | Voltar | 0 | 0 | 4 |  |
| SCR-399 | Administrativo | Gestão Documentos | Gestão de Documentos | `/admin/document-managements/create` | Cadastro (novo) | Voltar | 0 | 0 | 8 |  |
| SCR-400 | Operacional | Pecuária | Informações do Animal | `/admin/animals-management/create` | Cadastro (novo) | Voltar | 0 | 3 | 38 |  |
| SCR-401 | Operacional | Pecuária | Tipos de Identificação | `/admin/animals-management/108942` | Detalhe | Voltar | 0 | 2 | 0 |  |
| SCR-402 | Operacional | Pecuária | Informações do Animal | `/admin/animals-management/108942/edit` | Cadastro (edição) | Voltar | 0 | 3 | 33 |  |
| SCR-403 | Operacional | Pecuária | Planejamento Pecuário | `/admin/planning-livestock/create` | Cadastro (novo) | Voltar | 0 | 0 | 14 |  |
| SCR-404 | Operacional | Pecuária > Movimentações | Venda de Animais | `/admin/movement-sales/create` | Cadastro (novo) | Voltar | 0 | 15 | 60 |  |
| SCR-405 | Operacional | Pecuária > Movimentações | Compra de Animais | `/admin/movement-purchases/create` | Cadastro (novo) | Voltar | 0 | 9 | 56 |  |
| SCR-406 | Operacional | Pecuária > Movimentações | Tipos de Identificação | `/admin/birth-animals/create` | Cadastro (novo) | Voltar | 0 | 3 | 32 |  |
| SCR-407 | Operacional | Pecuária > Movimentações | Mortes | `/admin/death-animals/create` | Cadastro (novo) | Voltar | 0 | 0 | 8 |  |
| SCR-408 | Operacional | Pecuária > Movimentações | Perdas | `/admin/loss-animals/create` | Cadastro (novo) | Voltar | 0 | 0 | 7 |  |
| SCR-409 | Operacional | Pecuária > Manejo | Pré-Lote | `/admin/purchase-lots/create` | Cadastro (novo) | Voltar, Importar planilha | 0 | 3 | 9 |  |
| SCR-410 | Operacional | Pecuária > Manejo | Pesagem | `/admin/weighings/create` | Cadastro (novo) | Voltar | 0 | 0 | 26 |  |
| SCR-411 | Operacional | Pecuária > Manejo | Pesagem | `/admin/weighings/2223` | Detalhe | Voltar | 0 | 6 | 0 |  |
| SCR-412 | Operacional | Pecuária > Manejo | Pesagem | `/admin/weighings/2223/edit` | Cadastro (edição) | Voltar | 0 | 0 | 18 |  |
| SCR-413 | Operacional | Pecuária > Manejo | Nutrição | `/admin/nutritions/create` | Cadastro (novo) | Voltar | 0 | 3 | 21 |  |
| SCR-414 | Operacional | Pecuária > Manejo | Sanitário | `/admin/sanitaries/create` | Cadastro (novo) | Voltar | 0 | 0 | 21 |  |
| SCR-415 | Operacional | Pecuária > Manejo | Desmama | `/admin/weanings/create` | Cadastro (novo) | Voltar | 0 | 0 | 7 |  |
| SCR-416 | Operacional | Pecuária > Manejo | Apartação | `/admin/separations/create` | Cadastro (novo) | Voltar | 0 | 0 | 4 |  |
| SCR-417 | Operacional | Pecuária > Manejo | Pastagem | `/admin/pastures/create` | Cadastro (novo) | Voltar | 0 | 0 | 57 |  |
| SCR-418 | Operacional | Pecuária > Manejo | Pastagem | `/admin/pastures/288` | Detalhe | Voltar | 0 | 43 | 0 |  |
| SCR-419 | Operacional | Pecuária > Manejo | Pastagem | `/admin/pastures/288/edit` | Cadastro (edição) | Voltar | 0 | 0 | 38 |  |
| SCR-420 | Operacional | Pecuária > Manejo > Reprodução | Estação de Monta | `/admin/breeding-seasons/create` | Cadastro (novo) | Voltar | 0 | 0 | 8 |  |
| SCR-421 | Operacional | Pecuária > Manejo > Reprodução | Lotes | `/admin/breeding-batch/create` | Cadastro (novo) | Voltar | 0 | 0 | 6 |  |
| SCR-422 | Operacional | Pecuária > Manejo > Reprodução | Animais | `/admin/bull-seed-season/create` | Cadastro (novo) | Voltar | 0 | 0 | 11 |  |
| SCR-423 | Operacional | Pecuária > Manejo > Reprodução | Produtos | `/admin/protocols-season/create` | Cadastro (novo) | Voltar | 0 | 0 | 15 |  |
| SCR-424 | Operacional | Pecuária > Manejo > Reprodução | Monta Natural | `/admin/breeding-matings/create` | Cadastro (novo) | Voltar | 0 | 12 | 45 |  |
| SCR-425 | Operacional | Pecuária > Confinamento > Cadastros | Pátio | `/admin/feedlot-yards/create` | Cadastro (novo) | Voltar | 0 | 0 | 7 |  |
| SCR-426 | Operacional | Pecuária > Confinamento > Cadastros | Setores | `/admin/feedlot-sectors/create` | Cadastro (novo) | Voltar | 0 | 0 | 8 |  |
| SCR-427 | Operacional | Pecuária > Confinamento > Cadastros | Curral | `/admin/feedlot-corrals/create` | Cadastro (novo) | Cancelar | 0 | 0 | 38 |  |
| SCR-428 | Operacional | Pecuária > Confinamento > Nutrição | Dieta | `/admin/diets/create` | Cadastro (novo) | Voltar, Adicionar Ingrediente | 0 | 7 | 18 |  |
| SCR-429 | Operacional | Pecuária > Confinamento > Nutrição | Fases/Regras de Troca | `/admin/feeding-phases/create` | Cadastro (novo) | Voltar | 0 | 0 | 10 |  |
| SCR-430 | Operacional | Pecuária > Confinamento > Nutrição | Novo Batelada | `/admin/diet-beats/create` | Cadastro (novo) | Voltar | 0 | 0 | 6 |  |
| SCR-431 | Operacional | Pecuária > Confinamento > Nutrição | Fornecimento de Trato | `/admin/diet-beat-supplies/create` | Cadastro (novo) | Voltar | 0 | 0 | 2 |  |
| SCR-432 | Operacional | Pecuária > Confinamento > Nutrição | Nova Leitura de Cocho | `/admin/trough-readings/create` | Cadastro (novo) | Voltar | 0 | 0 | 2 |  |
| SCR-433 | Operacional |  | Pluviometria | `/admin/rainfalls/create` | Cadastro (novo) | Voltar | 0 | 0 | 4 |  |
| SCR-434 | Operacional | Vendas | Orçamentos | `/admin/budgets/create` | Cadastro (novo) | Voltar | 0 | 3 | 67 |  |
| SCR-435 | Operacional | Vendas | Pedidos | `/admin/orders/create` | Cadastro (novo) | Voltar | 0 | 3 | 63 |  |
| SCR-436 | Operacional | Vendas | Vendas | `/admin/sales/create` | Cadastro (novo) | Voltar | 0 | 0 | 26 |  |
| SCR-437 | Operacional | Ordens de Serviço | Identificação da OS | `/admin/service-orders/create` | Cadastro (novo) | Voltar | 0 | 0 | 41 |  |
| SCR-438 | Financeiro |  | Gestão de Contrato | `/admin/contracts/create` | Cadastro (novo) | Voltar | 0 | 0 | 13 |  |
| SCR-439 | Financeiro |  | Categorias | `/admin/budget-plannings/create` | Cadastro (novo) | Voltar | 0 | 15 | 2956 |  |
| SCR-440 | Financeiro |  | Congelamento Financeiro | `/admin/financial-freezes/create` | Cadastro (novo) | Voltar | 0 | 0 | 4 |  |
| SCR-441 | Gestão de Frota |  | Manutenções | `/admin/maintenances/create` | Cadastro (novo) | Voltar | 0 | 0 | 23 |  |
| SCR-442 | Gestão de Frota |  | Abastecimentos | `/admin/supplies/create` | Cadastro (novo) | Voltar | 0 | 0 | 18 |  |
| SCR-443 | Gestão de Frota |  | Manutenções Preventivas | `/admin/maintenance-preventives/create` | Cadastro (novo) | Voltar | 0 | 0 | 8 |  |
| SCR-444 | Gestão de Frota |  | Transferência de Máquinas | `/admin/equipment-transfer/create` | Cadastro (novo) | Voltar | 0 | 0 | 8 |  |
| SCR-445 | Gestão Fiscal |  | LCDPR - Livro Caixa Digital do Produtor Rural | `/admin/cash-book/create` | Cadastro (novo) | Voltar | 0 | 0 | 8 |  |
| SCR-446 | Gestão Fiscal |  | SPED Fiscal - EFD ICMS/IPI | `/admin/sped-fiscal/create` | Cadastro (novo) | Voltar | 0 | 0 | 4 |  |
| SCR-447 | Gestão Fiscal |  | Partida Dobrada | `/admin/double-entry-accountings/create` | Cadastro (novo) | Voltar | 0 | 0 | 11 |  |
| SCR-448 | Integrações |  | Integração Domínio | `/admin/integration-dominios/create` | Cadastro (novo) | Voltar | 0 | 0 | 4 |  |
| SCR-449 | Cadastros Base | Estrutura | Fazendas | `/admin/farms/80/kml-export` | Página |  | 0 | 0 | 0 |  |
| SCR-450 | Cadastros Base | Estrutura | Fazendas | `/admin/farms/80/map-print` | Página |  | 0 | 0 | 0 |  |
| SCR-451 | Administrativo | Suprimentos | Informação do Pedido | `/admin/request-purchase/11105` | Detalhe | Voltar | 0 | 8 | 0 |  |
| SCR-452 | Administrativo | Suprimentos | Informação do Pedido | `/admin/request-purchase/12095` | Detalhe | Voltar | 0 | 10 | 0 |  |
| SCR-453 | Administrativo | Suprimentos | Informação do Pedido | `/admin/request-purchase/14142` | Detalhe | Voltar | 0 | 5 | 0 |  |
| SCR-454 | Administrativo | Suprimentos | Informação do Pedido | `/admin/request-authorization/15471/second` | Listagem | Voltar | 0 | 4 | 4 |  |
| SCR-455 | Financeiro |  | Movimento Caixa/Bancário | `/admin/movements/245221` | Detalhe | Voltar | 0 | 5 | 0 |  |
