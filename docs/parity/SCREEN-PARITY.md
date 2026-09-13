# Paridade de Telas

_Gerado por `node scripts/parity.mjs` em 2026-09-13 a partir de docs/reference/SYSTEM-INVENTORY.md (455 telas) e do código deste repositório. Legenda de status: NÃO INICIADO · MAPEADO · EM IMPLEMENTAÇÃO · IMPLEMENTADO · TESTADO (coberto por teste automatizado) · BLOQUEADO · NÃO APLICÁVEL · MELHORADO (comportamento intencionalmente diferente/superior, ver observação) · UNIFICADO (tela absorvida como aba/filtro/ação de uma área unificada — ver docs/UX-ARCHITECTURE.md; a rota antiga redireciona)._

Resumo: 417/455 (91.6%) telas implementadas ou melhoradas. TESTADO: 116 · IMPLEMENTADO: 228 · MELHORADO: 19 · UNIFICADO: 54 · EM IMPLEMENTAÇÃO: 7 · MAPEADO: 6 · BLOQUEADO: 0 · NÃO INICIADO: 25 · NÃO APLICÁVEL: 0

| ID | Módulo | Tela (referência) | Rota referência | Tipo | Nossa rota | Área unificada (nova UX) | Status | Observação |
|---|---|---|---|---|---|---|---|---|
| SCR-001 | Painel de Controle | Previsão de Receitas x Despesas | `/admin/home` | Página | `/` | — | TESTADO | Painel com previsto x realizado, custo por centro, resultado operacional e alertas (e2e + integração) |
| SCR-002 | Dashboards | Indicadores Financeiros | `/admin/financial-dashboard` | Dashboard | `/dashboards/financeiro` | `/financeiro?tab=visao-geral` | UNIFICADO | UNIFICADO: aba da área /financeiro (rota antiga redireciona) |
| SCR-003 | Dashboards | Indicadores Pecuária de Corte | `/admin/livestock-dashboard` | Dashboard | `/dashboards/pecuaria` | `/pecuaria?tab=visao-geral` | TESTADO | UNIFICADO: aba da área /pecuaria (rota antiga redireciona) |
| SCR-004 | Cadastros Base › Pessoas | Funcionários | `/admin/employees` | Listagem | `/cadastros/people?is_employee=true` | — | MELHORADO | Cadastro único de pessoas com papéis (funcionário/fornecedor/cliente/proprietário/transportadora) + perfil de funcionário; evita duplicidade da referência |
| SCR-005 | Cadastros Base › Pessoas | Usuários | `/admin/users` | Listagem | `/admin/usuarios` | `/configuracoes?tab=usuarios&sub=usuarios` | TESTADO | Sem limite de licença por usuário (referência bloqueava 'limite de usuários'); vínculo perfil × fazendas; UNIFICADO: aba da área /configuracoes (rota antiga redireciona) |
| SCR-006 | Administrativo › Estoque | Documento Fiscal | `/admin/invoices` | Listagem | `/estoque/documentos-fiscais` | `/estoque?tab=recebimentos&sub=fiscais` | TESTADO | Importação de XML NF-e, itens, estoque e títulos em transação única; UNIFICADO: aba da área /estoque (rota antiga redireciona) |
| SCR-007 | Administrativo › Estoque | DFe Recebidas | `/admin/dfe` | Listagem | `/estoque/dfe` | `/estoque?tab=recebimentos&sub=dfe` | EM IMPLEMENTAÇÃO | Fila de DFe e manifestação registradas localmente; consulta automática à SEFAZ (certificado A1) não integrada; UNIFICADO: aba da área /estoque (rota antiga redireciona) |
| SCR-008 | Administrativo › Estoque > Fábrica | Formulação | `/admin/foods` | Listagem | `/estoque/formulacoes` | `/estoque?tab=fabrica&sub=formulas` | UNIFICADO | UNIFICADO: aba da área /estoque (rota antiga redireciona) |
| SCR-009 | Financeiro | Contas a Pagar | `/admin/expenses` | Listagem | `/financeiro/contas-a-pagar` | `/financeiro?tab=contas&sub=pagar` | TESTADO | UNIFICADO: aba da área /financeiro (rota antiga redireciona) |
| SCR-010 | Financeiro | Conta a Receber | `/admin/incomes` | Listagem | `/financeiro/contas-a-receber` | `/financeiro?tab=contas&sub=receber` | TESTADO | UNIFICADO: aba da área /financeiro (rota antiga redireciona) |
| SCR-011 | Financeiro | Movimento Caixa/Bancário | `/admin/movements` | Listagem | `/financeiro/movimentos` | `/financeiro?tab=caixa&sub=extrato` | TESTADO | UNIFICADO: aba da área /financeiro (rota antiga redireciona) |
| SCR-012 | Financeiro › Conciliação | Importar OFX | `/admin/ofx-imports` | Listagem | `/financeiro/ofx` | `/financeiro?tab=caixa&sub=conciliacao` | TESTADO | Parser OFX com teste unitário; conciliação por vínculo ou criação de movimento; UNIFICADO: aba da área /financeiro (rota antiga redireciona) |
| SCR-013 | Financeiro › Conciliação | Meses Conciliados | `/admin/ofx-report` | Relatório | `/financeiro/ofx/relatorio` | `/financeiro?tab=caixa&sub=historico` | UNIFICADO | UNIFICADO: aba da área /financeiro (rota antiga redireciona) |
| SCR-014 | Gestão Fiscal › NFe | NFe | `/admin/nfe` | Listagem | `/fiscal` | — | NÃO INICIADO | Emissão de NF-e exige certificado digital e homologação SEFAZ — fora do escopo desta entrega |
| SCR-015 | Gestão Fiscal | NFSe Recebidas | `/admin/nfses` | Listagem | `/fiscal` | — | NÃO INICIADO | Consulta de NFS-e recebidas depende de integração municipal |
| SCR-016 | Dashboards | Livro Caixa Digital | `/admin/cash-book-dashboard` | Dashboard | `/dashboards/livro-caixa` | `/fiscal?tab=livro-caixa` | UNIFICADO | UNIFICADO: aba da área /fiscal (rota antiga redireciona) |
| SCR-017 | Dashboards | Indicadores Suprimentos | `/admin/supply-dashboard` | Dashboard | `/dashboards/suprimentos` | `/compras?tab=visao-geral` | UNIFICADO | UNIFICADO: aba da área /compras (rota antiga redireciona) |
| SCR-018 | Dashboards | Indicadores de Depreciações | `/admin/depreciation-dashboard` | Dashboard | `/dashboards/depreciacoes` | `/frota?tab=equipamentos&sub=depreciacao` | UNIFICADO | UNIFICADO: aba da área /frota (rota antiga redireciona) |
| SCR-019 | Dashboards | Dashboard de Ativos | `/admin/assets-dashboard` | Dashboard | `/dashboards/ativos` | `/frota?tab=visao-geral` | UNIFICADO | UNIFICADO: aba da área /frota (rota antiga redireciona) |
| SCR-020 | Dashboards | Análise de Usuários | `/admin/user-analysis-dashboard` | Dashboard | `/dashboards/usuarios` | `/configuracoes?tab=usuarios&sub=atividade` | UNIFICADO | UNIFICADO: aba da área /configuracoes (rota antiga redireciona) |
| SCR-021 | Dashboards | Pluviômetro | `/admin/rainfall-dashboard` | Dashboard | `/dashboards/pluviometria` | `/configuracoes?tab=empresa&sub=pluviometria` | UNIFICADO | UNIFICADO: aba da área /configuracoes (rota antiga redireciona) |
| SCR-022 | Dashboards | Lotação de Currais | `/admin/feedlot-dashboard` | Dashboard | `/dashboards/confinamento` | `/confinamento?tab=currais&view=lotacao` | UNIFICADO | UNIFICADO: aba da área /confinamento (rota antiga redireciona) |
| SCR-023 | Dashboards | Custos do Confinamento | `/admin/feedlot-cost-dashboard` | Dashboard | `/dashboards/confinamento-custos` | `/confinamento?tab=desempenho` | UNIFICADO | UNIFICADO: aba da área /confinamento (rota antiga redireciona) |
| SCR-024 | Dashboards | Desempenho de Lotes | `/admin/feedlot-performance-dashboard` | Dashboard | `/dashboards/confinamento-desempenho` | `/confinamento?tab=desempenho` | UNIFICADO | UNIFICADO: aba da área /confinamento (rota antiga redireciona) |
| SCR-025 | Dashboards | Dashboard Estoque de Nutrição | `/admin/nutrition-stock-dashboard` | Dashboard | `/dashboards/estoque-nutricao` | `/confinamento?tab=desempenho&view=nutricao` | UNIFICADO | UNIFICADO: aba da área /confinamento (rota antiga redireciona) |
| SCR-026 | Dashboards | Dashboard Consumo vs Fornecido | `/admin/feed-consumption-dashboard` | Dashboard | `/dashboards/consumo-racao` | `/confinamento?tab=desempenho` | UNIFICADO | UNIFICADO: aba da área /confinamento (rota antiga redireciona) |
| SCR-027 | Cadastros Base › Estrutura | Centro de Custo | `/admin/costcenters` | Listagem | `/cadastros/cost_centers` | — | TESTADO | Árvore hierárquica com 'criar descendente' |
| SCR-028 | Cadastros Base › Estrutura | Fazendas | `/admin/farms` | Listagem | `/cadastros/farms` | — | IMPLEMENTADO |  |
| SCR-029 | Cadastros Base › Estrutura | Safras | `/admin/harvests` | Listagem | `/cadastros/harvests` | — | IMPLEMENTADO |  |
| SCR-030 | Cadastros Base › Estrutura > Produtos | Endereçamentos | `/admin/addressings` | Relatório | `/cadastros/addressings` | — | IMPLEMENTADO |  |
| SCR-031 | Cadastros Base › Estrutura > Produtos | Produtos | `/admin/products` | Listagem | `/cadastros/products` | — | TESTADO |  |
| SCR-032 | Cadastros Base › Estrutura > Produtos | Armazém | `/admin/warehouses` | Listagem | `/cadastros/warehouses` | — | IMPLEMENTADO |  |
| SCR-033 | Cadastros Base › Estrutura > Produtos | Saldo Inicial | `/admin/openingbalances` | Listagem | `/estoque/estoque-inicial` | `/configuracoes?tab=implantacao&sub=estoque` | TESTADO | UNIFICADO: aba da área /configuracoes (rota antiga redireciona) |
| SCR-034 | Cadastros Base › Estrutura > Rateios | Rateio - Categoria Financeira | `/admin/apportionments` | Listagem | `/cadastros/apportionment_categories` | — | IMPLEMENTADO |  |
| SCR-035 | Cadastros Base › Pessoas | Perfil Usuário | `/admin/roles` | Listagem | `/admin/perfis` | `/configuracoes?tab=usuarios&sub=perfis` | TESTADO | Árvore de permissões por recurso × ação; autorização aplicada no servidor; UNIFICADO: aba da área /configuracoes (rota antiga redireciona) |
| SCR-036 | Cadastros Base › Pessoas | Pessoas | `/admin/people` | Listagem | `/cadastros/people` | — | IMPLEMENTADO |  |
| SCR-037 | Cadastros Base › Pessoas | Proprietários | `/admin/proprietaries` | Listagem | `/cadastros/people?is_proprietary=true` | — | MELHORADO | Papel no cadastro único de pessoas |
| SCR-038 | Cadastros Base › Pessoas | Fornecedores | `/admin/providers` | Listagem | `/cadastros/people?is_provider=true` | — | MELHORADO | Papel no cadastro único de pessoas |
| SCR-039 | Cadastros Base › Pessoas | Clientes | `/admin/clients` | Listagem | `/cadastros/people?is_client=true` | — | MELHORADO | Papel no cadastro único de pessoas |
| SCR-040 | Cadastros Base › Pessoas | Autorizadores | `/admin/authorizers` | Listagem | `/cadastros/authorizers` | — | TESTADO |  |
| SCR-041 | Cadastros Base › Financeiros | Contas Bancárias | `/admin/accounts` | Listagem | `/cadastros/bank_accounts` | — | TESTADO |  |
| SCR-042 | Cadastros Base › Financeiros | Saldo Inicial | `/admin/open-movements` | Listagem | `/financeiro/saldo-inicial` | `/configuracoes?tab=implantacao&sub=financeiro` | UNIFICADO | UNIFICADO: aba da área /configuracoes (rota antiga redireciona) |
| SCR-043 | Cadastros Base › Financeiros | Categoria Financeira | `/admin/financialcategories` | Listagem | `/cadastros/financial_categories` | — | TESTADO |  |
| SCR-044 | Cadastros Base › Fiscais | Emissor NFe | `/admin/issue` | Listagem | `/fiscal` | — | NÃO INICIADO | Emissor NF-e (certificado) — gap fiscal |
| SCR-045 | Cadastros Base › Fiscais | Sincronização DFe | `/admin/issue-dfe-sync-time` | Listagem | `/fiscal` | — | NÃO INICIADO | Depende do emissor/SEFAZ |
| SCR-046 | Cadastros Base › Fiscais | Sincronização NFS-e | `/admin/issue-nfse-sync-time` | Listagem | `/fiscal` | — | NÃO INICIADO | Depende de integração municipal |
| SCR-047 | Cadastros Base › Fiscais | Regras Fiscais | `/admin/tax-rules` | Listagem | `/cadastros/tax_rules` | — | IMPLEMENTADO |  |
| SCR-048 | Cadastros Base › Fiscais | Contadores | `/admin/contador` | Listagem | `/cadastros/people` | — | MAPEADO | Contador é uma pessoa com papel; envio de arquivos ao contador não implementado |
| SCR-049 | Cadastros Base › Fiscais | Natureza de Operaçao | `/admin/natureoperations` | Listagem | `/cadastros/nature_operations` | — | IMPLEMENTADO |  |
| SCR-050 | Cadastros Base › Fiscais | Informações Complementares | `/admin/additional-info` | Listagem | `/cadastros/additional_infos` | — | IMPLEMENTADO |  |
| SCR-051 | Cadastros Base › Fiscais | Planos de Contas | `/admin/plan-accounts` | Listagem | `/cadastros/chart_accounts` | — | IMPLEMENTADO |  |
| SCR-052 | Cadastros Base › Agrícolas | Operação | `/admin/operations` | Listagem | `/cadastros/operations` | — | IMPLEMENTADO |  |
| SCR-053 | Cadastros Base › Agrícolas | Atividades | `/admin/activities` | Listagem | `/cadastros/activities` | — | IMPLEMENTADO |  |
| SCR-054 | Cadastros Base › Pecuários | Parâmetros de Peso | `/admin/parameter-weights` | Listagem | `/cadastros/weight_parameters` | — | IMPLEMENTADO |  |
| SCR-055 | Cadastros Base › Pecuários | Forragem | `/admin/fodder` | Listagem | `/cadastros/fodders` | — | IMPLEMENTADO |  |
| SCR-056 | Cadastros Base › Pecuários | Animais | `/admin/animals` | Listagem | `/pecuaria/animais` | `/pecuaria?tab=rebanho&sub=animais` | TESTADO | UNIFICADO: aba da área /pecuaria (rota antiga redireciona) |
| SCR-057 | Cadastros Base › Pecuários | Custo Retroativo | `/admin/animal-retroactive-costs` | Listagem | — | — | NÃO INICIADO | Custo retroativo de animais: coluna existe no custeio por lote, tela de lançamento não construída |
| SCR-058 | Cadastros Base › Pecuários | Módulos de Pastejo | `/admin/grazing` | Listagem | `/cadastros/grazing_modules` | — | IMPLEMENTADO |  |
| SCR-059 | Cadastros Base › Pecuários | Cochos | `/admin/troughs` | Listagem | `/cadastros/troughs` | — | IMPLEMENTADO |  |
| SCR-060 | Cadastros Base › Pecuários | Lotes de Animais | `/admin/batches` | Listagem | `/cadastros/batches` | — | IMPLEMENTADO |  |
| SCR-061 | Cadastros Base › Pecuários | Lote/Módulo | `/admin/batch-grazing` | Listagem | `/pecuaria/transferencias/lote-modulo-area` | `/pecuaria?tab=rebanho&sub=transferencias&action=lote-local` | UNIFICADO | Lote/Módulo e Lote/Área unificados em uma transferência com histórico; UNIFICADO: aba da área /pecuaria (rota antiga redireciona) |
| SCR-062 | Cadastros Base › Pecuários | Lote/Área | `/admin/batch-area` | Listagem | `/pecuaria/transferencias/lote-modulo-area` | `/pecuaria?tab=rebanho&sub=transferencias&action=lote-local` | UNIFICADO | Unificado com Lote/Módulo; UNIFICADO: aba da área /pecuaria (rota antiga redireciona) |
| SCR-063 | Cadastros Base › Bens/Ativos | Inventário | `/admin/equipments` | Listagem | `/cadastros/equipments` | — | TESTADO |  |
| SCR-064 | Cadastros Base › Bens/Ativos | Depreciação Mensal | `/admin/depreciations` | Listagem | `/frota/depreciacoes` | `/frota?tab=equipamentos&sub=depreciacao` | TESTADO | UNIFICADO: aba da área /frota (rota antiga redireciona) |
| SCR-065 | Cadastros Base › Bens/Ativos | Previsão de Depreciação | `/admin/depreciation-forecast` | Página | `/frota/previsao-depreciacao` | `/frota?tab=equipamentos&sub=depreciacao` | TESTADO | UNIFICADO: aba da área /frota (rota antiga redireciona) |
| SCR-066 | Cadastros Base › Gerais | Fiscais | `/admin/tenant-parameters` | Formulário | `/admin/parametros` | `/configuracoes?tab=empresa&sub=parametros` | UNIFICADO | UNIFICADO: aba da área /configuracoes (rota antiga redireciona) |
| SCR-067 | Administrativo › Suprimentos | SLA Status | `/admin/supply-status` | Listagem | `/suprimentos/sla` | `/configuracoes?tab=compras&sub=sla` | UNIFICADO | UNIFICADO: aba da área /configuracoes (rota antiga redireciona) |
| SCR-068 | Administrativo › Suprimentos | Meus Processos | `/admin/my-proccesses` | Listagem | `/suprimentos/mine` | `/compras?tab=processos&scope=mine` | TESTADO | UNIFICADO: aba da área /compras (rota antiga redireciona) |
| SCR-069 | Administrativo › Suprimentos | Solicitação | `/admin/request-purchase` | Listagem | `/suprimentos/request` | `/compras?tab=processos&stage=request` | TESTADO | UNIFICADO: aba da área /compras (rota antiga redireciona) |
| SCR-070 | Administrativo › Suprimentos | Rejeitados/Cancelados | `/admin/rejected-requests` | Listagem | `/suprimentos/rejected` | `/compras?tab=processos&stage=rejected` | UNIFICADO | UNIFICADO: aba da área /compras (rota antiga redireciona) |
| SCR-071 | Administrativo › Suprimentos | Cotações | `/admin/request-quotation` | Listagem | `/suprimentos/quotation` | `/compras?tab=processos&stage=quotation` | TESTADO | UNIFICADO: aba da área /compras (rota antiga redireciona) |
| SCR-072 | Administrativo › Suprimentos | Autorização | `/admin/request-authorization` | Listagem | `/suprimentos/authorization` | `/compras?tab=processos&stage=authorization` | TESTADO | UNIFICADO: aba da área /compras (rota antiga redireciona) |
| SCR-073 | Administrativo › Suprimentos | Compras | `/admin/request-buy` | Listagem | `/suprimentos/buy` | `/compras?tab=processos&stage=buy` | TESTADO | UNIFICADO: aba da área /compras (rota antiga redireciona) |
| SCR-074 | Administrativo › Suprimentos | Recebimentos | `/admin/request-receipts` | Listagem | `/suprimentos/receipts` | `/compras?tab=processos&stage=receipts` | TESTADO | UNIFICADO: aba da área /compras (rota antiga redireciona) |
| SCR-075 | Administrativo › Estoque | Entrada/Insumos | `/admin/input-entries` | Listagem | `/estoque/entradas` | `/estoque?tab=recebimentos&sub=manuais` | TESTADO | UNIFICADO: aba da área /estoque (rota antiga redireciona) |
| SCR-076 | Administrativo › Estoque | Aprovação de Notas Fiscais | `/admin/dfe-drafts` | Listagem | `/estoque/aprovacao-notas` | `/estoque?tab=recebimentos&sub=conferencia` | UNIFICADO | UNIFICADO: aba da área /estoque (rota antiga redireciona) |
| SCR-077 | Administrativo › Estoque | Perfis de Lançamento por Fornecedor | `/admin/provider-launch-profiles` | Listagem | `/cadastros/provider_launch_profiles` | — | IMPLEMENTADO |  |
| SCR-078 | Administrativo › Estoque | Baixa de Estoque | `/admin/stock-writeoffs` | Listagem | `/estoque/baixas` | `/estoque?tab=operacoes&sub=diretas` | UNIFICADO | UNIFICADO: aba da área /estoque (rota antiga redireciona) |
| SCR-079 | Administrativo › Estoque | Requisição do Estoque | `/admin/requisitions` | Listagem | `/estoque/requisicoes` | `/estoque?tab=operacoes&sub=requisicoes` | TESTADO | UNIFICADO: aba da área /estoque (rota antiga redireciona) |
| SCR-080 | Administrativo › Estoque | Devolução do Estoque | `/admin/devolution` | Listagem | `/estoque/devolucoes` | `/estoque?tab=operacoes&sub=devolucoes` | TESTADO | UNIFICADO: aba da área /estoque (rota antiga redireciona) |
| SCR-081 | Administrativo › Estoque | Correção de Estoque | `/admin/stock-corrections` | Listagem | `/estoque/correcoes` | `/estoque?tab=estoque&sub=ajustes` | UNIFICADO | UNIFICADO: aba da área /estoque (rota antiga redireciona) |
| SCR-082 | Administrativo › Estoque | Transferência de Armazém | `/admin/warehouse-transfer` | Listagem | `/estoque/transferencias?kind=warehouse` | `/estoque?tab=operacoes&sub=transferencias` | TESTADO | UNIFICADO: aba da área /estoque (rota antiga redireciona) |
| SCR-083 | Administrativo › Estoque | Transferência de Armazém entre Fazendas | `/admin/warehouse-transfer-between-farms` | Listagem | `/estoque/transferencias?kind=farm` | `/estoque?tab=operacoes&sub=transferencias&kind=farm` | TESTADO | UNIFICADO: aba da área /estoque (rota antiga redireciona) |
| SCR-084 | Administrativo › Estoque | Saldo Estoque | `/admin/stocks` | Listagem | `/estoque/saldo` | `/estoque?tab=estoque&sub=saldo` | TESTADO | UNIFICADO: aba da área /estoque (rota antiga redireciona) |
| SCR-085 | Administrativo › Estoque > Fábrica | Batida | `/admin/food-beats` | Listagem | `/estoque/batidas` | `/estoque?tab=fabrica&sub=producoes` | UNIFICADO | UNIFICADO: aba da área /estoque (rota antiga redireciona) |
| SCR-086 | Administrativo › Gestão Pessoal | Eventos | `/admin/events` | Listagem | `/cadastros/hr_events` | — | IMPLEMENTADO |  |
| SCR-087 | Administrativo › Gestão Pessoal | Funções | `/admin/functions` | Listagem | `/cadastros/job_functions` | — | IMPLEMENTADO |  |
| SCR-088 | Administrativo › Gestão Pessoal | Equipes | `/admin/teams` | Listagem | `/cadastros/teams` | — | IMPLEMENTADO |  |
| SCR-089 | Administrativo › Gestão Pessoal | Registro/Faltas | `/admin/absences` | Listagem | `/cadastros/absences` | — | TESTADO |  |
| SCR-090 | Administrativo › Gestão Pessoal | Adiant. Salarial | `/admin/advances` | Listagem | `/gestao-pessoal/adiantamentos` | `/pessoas?tab=folha&sub=adiantamentos` | TESTADO | UNIFICADO: aba da área /pessoas (rota antiga redireciona) |
| SCR-091 | Administrativo › Gestão Pessoal | Registro/Eventos | `/admin/bonuses` | Listagem | `/cadastros/bonuses` | — | IMPLEMENTADO |  |
| SCR-092 | Administrativo › Gestão Pessoal | Funcionário x Eventos | `/admin/employeeevents` | Listagem | `/cadastros/employee_events` | — | IMPLEMENTADO |  |
| SCR-093 | Administrativo › Gestão Pessoal | Apuração Mensal | `/admin/earnings` | Listagem | `/gestao-pessoal/apuracao` | `/pessoas?tab=folha&sub=apuracao` | TESTADO | UNIFICADO: aba da área /pessoas (rota antiga redireciona) |
| SCR-094 | Administrativo › Gestão Documentos | Tipos de Documento | `/admin/document-types` | Listagem | `/cadastros/document_types` | — | IMPLEMENTADO |  |
| SCR-095 | Administrativo › Gestão Documentos | Gestão de Documentos | `/admin/document-managements` | Listagem | `/cadastros/documents` | — | IMPLEMENTADO | Arquivos via Supabase Storage pendentes de projeto Supabase |
| SCR-096 | Operacional › Pecuária | Gestão Animais | `/admin/animals-management` | Listagem | `/pecuaria/animais` | `/pecuaria?tab=rebanho&sub=animais` | TESTADO | UNIFICADO: aba da área /pecuaria (rota antiga redireciona) |
| SCR-097 | Operacional › Pecuária | Inventariado Animais | `/admin/inventoried-animals` | Listagem | — | — | NÃO INICIADO | Inventário físico de animais (conferência) não construído |
| SCR-098 | Operacional › Pecuária | Planejamento Pecuário | `/admin/planning-livestock` | Listagem | `/cadastros/livestock_plannings` | — | IMPLEMENTADO |  |
| SCR-099 | Operacional › Pecuária > Transferências | Evolução de Rebanho | `/admin/evolution-animals` | Listagem | `/pecuaria/transferencias/evolucao` | `/pecuaria?tab=rebanho&sub=reclassificacoes` | UNIFICADO | UNIFICADO: aba da área /pecuaria (rota antiga redireciona) |
| SCR-100 | Operacional › Pecuária > Transferências | Agrupar Lotes | `/admin/grouper-batches` | Listagem | `/pecuaria/transferencias/agrupar-lotes` | `/pecuaria?tab=rebanho&sub=transferencias&action=agrupar` | UNIFICADO | UNIFICADO: aba da área /pecuaria (rota antiga redireciona) |
| SCR-101 | Operacional › Pecuária > Movimentações | Venda de Animais | `/admin/movement-sales` | Listagem | `/pecuaria/movimentacoes/sale` | `/pecuaria?tab=movimentacoes&type=sale` | TESTADO | UNIFICADO: aba da área /pecuaria (rota antiga redireciona) |
| SCR-102 | Operacional › Pecuária > Movimentações | Compra de Animais | `/admin/movement-purchases` | Listagem | `/pecuaria/movimentacoes/purchase` | `/pecuaria?tab=movimentacoes&type=purchase` | TESTADO | UNIFICADO: aba da área /pecuaria (rota antiga redireciona) |
| SCR-103 | Operacional › Pecuária > Movimentações | Nascimentos | `/admin/birth-animals` | Listagem | `/pecuaria/movimentacoes/birth` | `/pecuaria?tab=movimentacoes&type=birth` | UNIFICADO | UNIFICADO: aba da área /pecuaria (rota antiga redireciona) |
| SCR-104 | Operacional › Pecuária > Movimentações | Mortes | `/admin/death-animals` | Listagem | `/pecuaria/movimentacoes/death` | `/pecuaria?tab=movimentacoes&type=death` | UNIFICADO | UNIFICADO: aba da área /pecuaria (rota antiga redireciona) |
| SCR-105 | Operacional › Pecuária > Movimentações | Perdas | `/admin/loss-animals` | Listagem | `/pecuaria/movimentacoes/loss` | `/pecuaria?tab=movimentacoes&type=loss` | UNIFICADO | UNIFICADO: aba da área /pecuaria (rota antiga redireciona) |
| SCR-106 | Operacional › Pecuária > Manejo | Processamentos | `/admin/processing` | Listagem | `/pecuaria/processamentos` | `/pecuaria?tab=rebanho&sub=animais&processing=1` | TESTADO | UNIFICADO: aba da área /pecuaria (rota antiga redireciona) |
| SCR-107 | Operacional › Pecuária > Manejo | Pré-Lotes | `/admin/purchase-lots` | Listagem | `/pecuaria/processamentos` | `/pecuaria?tab=rebanho&sub=animais&processing=1` | MAPEADO | Pré-lotes representados pelos lotes por contagem (herd_lots) da compra; sem tela própria; UNIFICADO: aba da área /pecuaria (rota antiga redireciona) |
| SCR-108 | Operacional › Pecuária > Manejo | Pesagens | `/admin/weighings` | Listagem | `/pecuaria/pesagens` | `/pecuaria?tab=manejos&type=weighing` | TESTADO | UNIFICADO: aba da área /pecuaria (rota antiga redireciona) |
| SCR-109 | Operacional › Pecuária > Manejo | Nutrição | `/admin/nutritions` | Listagem | `/pecuaria/manejo/nutrition` | `/pecuaria?tab=manejos&type=nutrition` | UNIFICADO | UNIFICADO: aba da área /pecuaria (rota antiga redireciona) |
| SCR-110 | Operacional › Pecuária > Manejo | Sanitários | `/admin/sanitaries` | Listagem | `/pecuaria/manejo/sanitary` | `/pecuaria?tab=manejos&type=sanitary` | TESTADO | UNIFICADO: aba da área /pecuaria (rota antiga redireciona) |
| SCR-111 | Operacional › Pecuária > Manejo | Desmama | `/admin/weanings` | Listagem | `/pecuaria/manejo/weaning` | `/pecuaria?tab=manejos&type=weaning` | UNIFICADO | UNIFICADO: aba da área /pecuaria (rota antiga redireciona) |
| SCR-112 | Operacional › Pecuária > Manejo | Apartações | `/admin/separations` | Listagem | `/pecuaria/manejo/separation` | `/pecuaria?tab=manejos&type=separation` | UNIFICADO | UNIFICADO: aba da área /pecuaria (rota antiga redireciona) |
| SCR-113 | Operacional › Pecuária > Manejo | Localizar Animal | `/admin/locate-animals` | Página | `/pecuaria/localizar` | `/pecuaria?tab=rebanho&sub=animais&locate=1` | UNIFICADO | UNIFICADO: aba da área /pecuaria (rota antiga redireciona) |
| SCR-114 | Operacional › Pecuária > Manejo | Pastagem | `/admin/pastures` | Listagem | `/pecuaria/manejo/pasture` | `/pecuaria?tab=manejos&type=pasture` | UNIFICADO | UNIFICADO: aba da área /pecuaria (rota antiga redireciona) |
| SCR-115 | Operacional › Pecuária > Manejo > Reprodução | Gerenciamento Reprodutivo Avançado | `/admin/advanced-reproductive` | Listagem | `/pecuaria/reproducao` | — | IMPLEMENTADO |  |
| SCR-116 | Operacional › Pecuária > Manejo > Reprodução | Estações de Monta | `/admin/breeding-seasons` | Listagem | `/cadastros/breeding_seasons` | — | IMPLEMENTADO |  |
| SCR-117 | Operacional › Pecuária > Manejo > Reprodução | Lotes/Reprodução | `/admin/breeding-batch` | Listagem | `/pecuaria/reproducao/acasalamentos` | `/pecuaria/reproducao?tab=acasalamentos` | MAPEADO | Lotes de reprodução por estação: filtro por lote no picker de matrizes; sem entidade própria; UNIFICADO: aba da área /pecuaria/reproducao (rota antiga redireciona) |
| SCR-118 | Operacional › Pecuária > Manejo > Reprodução | Touros/Sêmen/Embrião | `/admin/bull-seed-season` | Listagem | `/cadastros/breeding_sires` | — | IMPLEMENTADO |  |
| SCR-119 | Operacional › Pecuária > Manejo > Reprodução | Protocolos/Estação | `/admin/protocols-season` | Listagem | `/cadastros/breeding_protocols` | — | IMPLEMENTADO |  |
| SCR-120 | Operacional › Pecuária > Manejo > Reprodução | Acasalamento | `/admin/breeding-matings` | Listagem | `/pecuaria/reproducao/acasalamentos` | `/pecuaria/reproducao?tab=acasalamentos` | UNIFICADO | UNIFICADO: aba da área /pecuaria/reproducao (rota antiga redireciona) |
| SCR-121 | Operacional › Pecuária > Confinamento > Cadastros | Pátio | `/admin/feedlot-yards` | Listagem | `/cadastros/feedlot_yards` | — | IMPLEMENTADO |  |
| SCR-122 | Operacional › Pecuária > Confinamento > Cadastros | Setores | `/admin/feedlot-sectors` | Listagem | `/cadastros/feedlot_sectors` | — | IMPLEMENTADO |  |
| SCR-123 | Operacional › Pecuária > Confinamento > Cadastros | Curral | `/admin/feedlot-corrals` | Listagem | `/cadastros/feedlot_corrals` | — | IMPLEMENTADO |  |
| SCR-124 | Operacional › Pecuária > Confinamento > Nutrição | Dietas | `/admin/diets` | Listagem | `/cadastros/diets` | — | IMPLEMENTADO |  |
| SCR-125 | Operacional › Pecuária > Confinamento > Nutrição | Fases/Regras de Troca | `/admin/feeding-phases` | Listagem | `/cadastros/feeding_phases` | — | IMPLEMENTADO |  |
| SCR-126 | Operacional › Pecuária > Confinamento > Nutrição | Batelada | `/admin/diet-beats` | Listagem | `/confinamento/bateladas` | `/confinamento?tab=hoje&sub=producao` | UNIFICADO | UNIFICADO: aba da área /confinamento (rota antiga redireciona) |
| SCR-127 | Operacional › Pecuária > Confinamento > Nutrição | Trato Diário | `/admin/diet-beat-supplies` | Listagem | `/confinamento/trato` | `/confinamento?tab=hoje&sub=trato` | UNIFICADO | UNIFICADO: aba da área /confinamento (rota antiga redireciona) |
| SCR-128 | Operacional › Pecuária > Confinamento > Nutrição | Leitura de Cocho | `/admin/trough-readings` | Listagem | `/confinamento/leitura-cocho` | `/confinamento?tab=hoje&sub=cocho` | UNIFICADO | UNIFICADO: aba da área /confinamento (rota antiga redireciona) |
| SCR-129 | Operacional › Pecuária > Confinamento | Mapa de Confinamento | `/admin/feedlot-map` | Página | `/confinamento/mapa` | `/confinamento?tab=currais&view=mapa` | UNIFICADO | UNIFICADO: aba da área /confinamento (rota antiga redireciona) |
| SCR-130 | Operacional | Pluviometria | `/admin/rainfalls` | Listagem | `/cadastros/rainfalls` | — | IMPLEMENTADO |  |
| SCR-131 | Operacional › Vendas | Orçamentos | `/admin/budgets` | Listagem | `/vendas/budgets` | `/vendas?tab=budgets` | TESTADO | UNIFICADO: aba da área /vendas (rota antiga redireciona) |
| SCR-132 | Operacional › Vendas | Pedidos | `/admin/orders` | Listagem | `/vendas/orders` | `/vendas?tab=orders` | TESTADO | UNIFICADO: aba da área /vendas (rota antiga redireciona) |
| SCR-133 | Operacional › Vendas | Vendas | `/admin/sales` | Listagem | `/vendas/sales` | `/vendas?tab=sales` | TESTADO | UNIFICADO: aba da área /vendas (rota antiga redireciona) |
| SCR-134 | Operacional › Ordens de Serviço | Minhas Ordens de Serviço | `/admin/my-service-orders` | Listagem | `/os?mine=1` | `/os?scope=mine` | UNIFICADO | UNIFICADO: aba da área /os (rota antiga redireciona) |
| SCR-135 | Operacional › Ordens de Serviço | Ordem de Serviço | `/admin/service-orders` | Listagem | `/os` | — | IMPLEMENTADO |  |
| SCR-136 | Operacional › Ordens de Serviço | Monitoramento de Ordens de Serviço | `/admin/monitoring-service-orders` | Listagem | `/os/monitoramento` | `/os?late=1` | UNIFICADO | UNIFICADO: aba da área /os (rota antiga redireciona) |
| SCR-137 | Operacional › Ordens de Serviço | Avaliação de Ordens de Serviço | `/admin/rating-service-orders` | Listagem | `/os` | — | MELHORADO | Avaliação feita no detalhe da OS finalizada (sem tela separada) |
| SCR-138 | Financeiro | Análise do Fluxo Bancário | `/admin/cash-flow` | Relatório | `/financeiro/fluxo` | `/financeiro?tab=caixa&sub=fluxo` | TESTADO | UNIFICADO: aba da área /financeiro (rota antiga redireciona) |
| SCR-139 | Financeiro | Gestão Contratos | `/admin/contracts` | Listagem | `/cadastros/contracts` | — | IMPLEMENTADO |  |
| SCR-140 | Financeiro | Previsão Orçamentária Anual | `/admin/budget-plannings` | Listagem | `/financeiro/previsao-orcamentaria` | `/financeiro?tab=planejamento` | UNIFICADO | UNIFICADO: aba da área /financeiro (rota antiga redireciona) |
| SCR-141 | Financeiro | Congelamento Financeiro | `/admin/financial-freezes` | Listagem | `/cadastros/financial_freezes` | — | TESTADO | Congelamento aplicado no servidor (PERIOD_FROZEN) para títulos, baixas e movimentos |
| SCR-142 | Financeiro | Planilha de Movimentos | `/admin/movement-sheets` | Listagem | — | — | NÃO INICIADO | Planilha de movimentos (importação em massa) não construída; exportação disponível |
| SCR-143 | Gestão de Frota | Manutenções | `/admin/maintenances` | Listagem | `/frota/manutencoes` | `/frota?tab=manutencoes` | UNIFICADO | UNIFICADO: aba da área /frota (rota antiga redireciona) |
| SCR-144 | Gestão de Frota | Abastecimentos | `/admin/supplies` | Listagem | `/frota/abastecimentos` | `/frota?tab=abastecimentos` | TESTADO | UNIFICADO: aba da área /frota (rota antiga redireciona) |
| SCR-145 | Gestão de Frota | Manutenções Preventivas | `/admin/maintenance-preventives` | Listagem | `/cadastros/preventive_maintenances` | — | IMPLEMENTADO | Alertas em /frota/alertas |
| SCR-146 | Gestão de Frota | Revisões Agendadas | `/admin/scheduled-reviews` | Listagem | `/cadastros/scheduled_reviews` | — | IMPLEMENTADO | Alertas em /frota/alertas |
| SCR-147 | Gestão de Frota | Transferência de Máquinas | `/admin/equipment-transfer` | Listagem | `/frota/transferencias` | `/frota?tab=equipamentos&sub=transferencias` | UNIFICADO | UNIFICADO: aba da área /frota (rota antiga redireciona) |
| SCR-148 | Gestão Fiscal › NFe | Arquivos XML | `/admin/xml` | Página | `/estoque/documentos-fiscais/new` | — | IMPLEMENTADO | Importação do XML NF-e no lançamento do documento |
| SCR-149 | Gestão Fiscal › MDFe | MDFe | `/admin/mdfe` | Listagem | `/fiscal` | — | NÃO INICIADO | MDF-e depende de emissão fiscal |
| SCR-150 | Gestão Fiscal › MDFe | MDFe | `/admin/mdfe/create` | Cadastro (novo) | `/fiscal/new` | — | NÃO INICIADO | MDF-e depende de emissão fiscal |
| SCR-151 | Gestão Fiscal | LCDPR - Livro Caixa Digital do Produtor Rural | `/admin/cash-book` | Listagem | `/dashboards/livro-caixa` | `/fiscal?tab=livro-caixa` | EM IMPLEMENTAÇÃO | Dados do livro caixa capturados (contas 'livro caixa', dedutibilidade); geração do arquivo LCDPR não implementada; UNIFICADO: aba da área /fiscal (rota antiga redireciona) |
| SCR-152 | Gestão Fiscal | SPED Fiscal - EFD ICMS/IPI | `/admin/sped-fiscal` | Listagem | `/fiscal` | — | NÃO INICIADO | SPED EFD ICMS/IPI depende de emissão fiscal |
| SCR-153 | Gestão Fiscal | Partida Dobrada | `/admin/double-entry-accountings` | Listagem | `/fiscal/partida-dobrada` | `/fiscal?tab=partida-dobrada` | UNIFICADO | UNIFICADO: aba da área /fiscal (rota antiga redireciona) |
| SCR-154 | Relatórios › Bens/Ativo | Relatório Inventário Patrimonial | `/admin/equipment-report` | Relatório | `/relatorios/equipment` | — | IMPLEMENTADO |  |
| SCR-155 | Relatórios › Bens/Ativo | Relatorio de Depreciação Acumulada | `/admin/accumulated-depreciation-report` | Relatório | `/relatorios/accumulated_depreciation` | — | IMPLEMENTADO |  |
| SCR-156 | Relatórios › Pecuária | Composição Rebanho | `/admin/herd-composition-report` | Relatório | `/relatorios/herd_composition` | — | IMPLEMENTADO |  |
| SCR-157 | Relatórios › Pecuária | Custeio/Área Pecuária | `/admin/costing-livestock-area-report` | Relatório | `/relatorios/costing_livestock_area` | — | IMPLEMENTADO |  |
| SCR-158 | Relatórios › Pecuária | Relatório Pesagem/Animal | `/admin/weighing-batch-report` | Relatório | `/relatorios/weighing_animal` | — | IMPLEMENTADO |  |
| SCR-159 | Relatórios › Pecuária | Relatório Pesagem/Lote | `/admin/accumulated-weighing-batch-report` | Relatório | `/relatorios/weighing_batch` | — | IMPLEMENTADO |  |
| SCR-160 | Relatórios › Pecuária | Relatório de Pesagem do Confinamento | `/admin/feedlot-weighing-performance-report` | Relatório | `/relatorios/feedlot_weighing` | — | IMPLEMENTADO |  |
| SCR-161 | Relatórios › Pecuária | Relatório Nutrição: Consumo / Lote | `/admin/nutrition-report` | Relatório | `/relatorios/nutrition_batch` | — | IMPLEMENTADO |  |
| SCR-162 | Relatórios › Pecuária | Relatório Sanitário/lote | `/admin/sanitaries-batch-report` | Relatório | `/relatorios/sanitary_batch` | — | IMPLEMENTADO |  |
| SCR-163 | Relatórios › Pecuária | Relatório Manejo/lote | `/admin/management-batch-report` | Relatório | `/relatorios/management_batch` | — | IMPLEMENTADO |  |
| SCR-164 | Relatórios › Pecuária | Relatório Animais/Categoria | `/admin/category-animal-report` | Relatório | `/relatorios/category_animal` | — | IMPLEMENTADO |  |
| SCR-165 | Relatórios › Pecuária | Transferência Lote/Módulo/Área | `/admin/report-transfer-batch-grazing-area` | Relatório | `/relatorios/transfer_batch_area` | — | IMPLEMENTADO |  |
| SCR-166 | Relatórios › Pecuária | Estoque de Rebanho | `/admin/animals-report` | Relatório | `/relatorios/animals` | — | IMPLEMENTADO |  |
| SCR-167 | Relatórios › Pecuária | Relatório Aplicação/Manejo da Pecuária | `/admin/application-management-report` | Relatório | `/relatorios/application_management` | — | IMPLEMENTADO |  |
| SCR-168 | Relatórios › Pecuária | Relatório de Movimentação de Rebanho | `/admin/animal-movements-report` | Relatório | `/relatorios/animal_movements` | — | IMPLEMENTADO |  |
| SCR-169 | Relatórios › Pecuária | Relatório Desmama | `/admin/weaning-report` | Relatório | `/relatorios/weaning` | — | IMPLEMENTADO |  |
| SCR-170 | Relatórios › Pecuária | Relatório Nascimentos | `/admin/birth-report` | Relatório | `/relatorios/birth` | — | IMPLEMENTADO |  |
| SCR-171 | Relatórios › Pecuária | Relatório Mortes | `/admin/death-animals-report` | Relatório | `/relatorios/death` | — | IMPLEMENTADO |  |
| SCR-172 | Relatórios › Pecuária | Relatório Ficha Animal | `/admin/animal-record-report` | Relatório | `/relatorios/animal_record` | — | IMPLEMENTADO |  |
| SCR-173 | Relatórios › Pecuária | Relatório Vacas Prenhas | `/admin/pregnant-cows-report` | Relatório | `/relatorios/pregnant_cows` | — | IMPLEMENTADO |  |
| SCR-174 | Relatórios › Pecuária | Relatório Vendas de Animais | `/admin/animals-sales/report` | Relatório | `/relatorios/animal_sales` | — | IMPLEMENTADO |  |
| SCR-175 | Relatórios › Pecuária | Relatório Compras de Animais | `/admin/animals-purchases/report` | Relatório | `/relatorios/animal_purchases` | — | IMPLEMENTADO |  |
| SCR-176 | Relatórios › Pecuária | Relatório Evolução de Rebanho | `/admin/evolution-animals-report` | Relatório | `/relatorios/herd_evolution` | — | IMPLEMENTADO |  |
| SCR-177 | Relatórios › Pecuária | Relatório Identificação/SISBOV | `/admin/identification-animals-sisbovs-report` | Relatório | `/relatorios/sisbov_identification` | — | IMPLEMENTADO |  |
| SCR-178 | Relatórios › Pecuária | Relatório Mortes/SISBOV | `/admin/death-animals-sisbovs-report` | Relatório | `/relatorios/sisbov_death` | — | IMPLEMENTADO |  |
| SCR-179 | Relatórios › Pecuária | Relatório Nascimentos/SISBOV | `/admin/birth-animals-sisbovs-report` | Relatório | `/relatorios/sisbov_birth` | — | IMPLEMENTADO |  |
| SCR-180 | Relatórios › Pecuária | Relatório Custo/Lote | `/admin/costing-batch-report` | Relatório | `/relatorios/costing_batch` | — | IMPLEMENTADO |  |
| SCR-181 | Relatórios › Pecuária | Relatório Custo/Módulo | `/admin/costing-grazing-report` | Relatório | `/relatorios/costing_module` | — | IMPLEMENTADO |  |
| SCR-182 | Relatórios › Pecuária | Relatório Custo/Animal | `/admin/costing-animal-report` | Relatório | `/relatorios/costing_animal` | — | IMPLEMENTADO |  |
| SCR-183 | Relatórios › Pecuária | Relatório Custo Total de Reprodução | `/admin/total-cost-of-reproduction-report` | Relatório | `/relatorios/reproduction_cost` | — | IMPLEMENTADO |  |
| SCR-184 | Relatórios › Pecuária | Relatório de Performance Animal Individual | `/admin/batch-profitability-report` | Relatório | `/relatorios/batch_profitability` | — | IMPLEMENTADO |  |
| SCR-185 | Relatórios › Pecuária | Relatório Histórico Reprodutivo das Matrizes | `/admin/reproductive-history-report` | Relatório | `/relatorios/reproductive_history` | — | IMPLEMENTADO |  |
| SCR-186 | Relatórios › Pecuária | Registro Genealógico | `/admin/animal-family-tree-report` | Relatório | `/relatorios/family_tree` | — | IMPLEMENTADO |  |
| SCR-187 | Relatórios › Pecuária | Relatório de Eficiência de Reprodução de Touros | `/admin/bull-reproductive-efficiency-report` | Relatório | `/relatorios/bull_efficiency` | — | IMPLEMENTADO |  |
| SCR-188 | Relatórios › Pecuária | Relatório de Análise de Movimentação Lote | `/admin/animal-movement-analysis-report` | Relatório | `/relatorios/batch_movement_analysis` | — | IMPLEMENTADO |  |
| SCR-189 | Relatórios › Pecuária | Relatório de Produtividade De Receptora | `/admin/receiver-cow-productivity-report` | Relatório | `/relatorios/receiver_productivity` | — | IMPLEMENTADO |  |
| SCR-190 | Relatórios › Pecuária | Relatório de Animais por Lote com Visualização Detalhada ou Geral | `/admin/animals-per-batch-report` | Relatório | `/relatorios/animals_per_batch` | — | IMPLEMENTADO |  |
| SCR-191 | Relatórios › Pecuária | Relatório Histórico de Animais/Lote | `/admin/animal-batch-history-report` | Relatório | `/relatorios/animal_batch_history` | — | IMPLEMENTADO |  |
| SCR-192 | Relatórios › Pecuária | Relatório Controle de Lotes Ativos no Confinamento | `/admin/feedlot-batch-control-report` | Relatório | `/relatorios/feedlot_batch_control` | — | IMPLEMENTADO |  |
| SCR-193 | Relatórios › Pecuária | Relatório de Cosnumo/Planejado | `/admin/feedlot-planned-consumption-report` | Relatório | `/relatorios/feedlot_planned_consumption` | — | IMPLEMENTADO |  |
| SCR-194 | Relatórios › Pecuária | Relatório Operacional Diário com Resumo das Atividades do Confinamento | `/admin/feedlot-summary-activity-report` | Relatório | `/relatorios/feedlot_activity` | — | IMPLEMENTADO |  |
| SCR-195 | Relatórios | Relatório de Pluviometria | `/admin/rainfall-report` | Relatório | `/relatorios/rainfall` | — | IMPLEMENTADO |  |
| SCR-196 | Relatórios › Financeiro | Agenda de Recebimentos | `/admin/receipt-schedule-report` | Relatório | `/relatorios/receipt_schedule` | — | IMPLEMENTADO |  |
| SCR-197 | Relatórios › Financeiro | Contas a Pagar | `/admin/expenses-report` | Relatório | `/relatorios/payables` | — | IMPLEMENTADO |  |
| SCR-198 | Relatórios › Financeiro | Contas Pagas | `/admin/paid-expenses-report` | Relatório | `/relatorios/paid` | — | TESTADO |  |
| SCR-199 | Relatórios › Financeiro | Contas a Receber | `/admin/incomes-report` | Relatório | `/relatorios/receivables` | — | IMPLEMENTADO |  |
| SCR-200 | Relatórios › Financeiro | Contas Recebidas | `/admin/paid-incomes-report` | Relatório | `/relatorios/received` | — | IMPLEMENTADO |  |
| SCR-201 | Relatórios › Financeiro | Relatório de Juros Recebidos | `/admin/received-interest-report` | Relatório | `/relatorios/received_interest` | — | IMPLEMENTADO |  |
| SCR-202 | Relatórios › Financeiro | Relatório de Juros Pagos | `/admin/paid-interest-report` | Relatório | `/relatorios/paid_interest` | — | IMPLEMENTADO |  |
| SCR-203 | Relatórios › Financeiro | Extrato Financeiro | `/admin/bank-statement-report` | Relatório | `/relatorios/bank_statement` | — | TESTADO |  |
| SCR-204 | Relatórios › Financeiro | Razão Contábil | `/admin/ledger-report` | Relatório | `/relatorios/ledger` | — | IMPLEMENTADO |  |
| SCR-205 | Relatórios › Financeiro | Razão Categoria | `/admin/ledger-category-report` | Relatório | `/relatorios/ledger_category` | — | IMPLEMENTADO |  |
| SCR-206 | Relatórios › Financeiro | Recebimento Previsto X Realizado | `/admin/rec-prev-real-report` | Relatório | `/relatorios/rec_prev_real` | — | IMPLEMENTADO |  |
| SCR-207 | Relatórios › Financeiro | Pagamento Previsto X Realizado | `/admin/pag-prev-real-report` | Relatório | `/relatorios/pag_prev_real` | — | IMPLEMENTADO |  |
| SCR-208 | Relatórios › Financeiro | Previsto x Realizado Anual | `/admin/budget-planning-predicted-report` | Relatório | `/relatorios/budget_predicted` | — | IMPLEMENTADO |  |
| SCR-209 | Relatórios › Financeiro | Acesse mais e melhor crédito! | `/admin/cash-flow-by-category-report` | Relatório | `/relatorios/cash_flow_category` | — | IMPLEMENTADO |  |
| SCR-210 | Relatórios › Financeiro | Acesse mais e melhor crédito! | `/admin/cash-flow-forecast-report` | Relatório | `/relatorios/cash_flow_forecast` | — | IMPLEMENTADO |  |
| SCR-211 | Relatórios › Financeiro | Movimentação Bancária/Financeira | `/admin/financial-movement-report` | Relatório | `/relatorios/financial_movement` | — | IMPLEMENTADO |  |
| SCR-212 | Relatórios › Financeiro | Fiscal/Não Fiscal | `/admin/fiscal-difference-report` | Relatório | `/relatorios/fiscal_difference` | — | IMPLEMENTADO |  |
| SCR-213 | Relatórios › Financeiro | Custo de Produção por Período | `/admin/income-statement` | Relatório | `/relatorios/income_statement` | — | IMPLEMENTADO |  |
| SCR-214 | Relatórios › Financeiro | Custo de Produção por Mês | `/admin/accumulated-income-statement` | Relatório | `/relatorios/accumulated_income_statement` | — | IMPLEMENTADO |  |
| SCR-215 | Relatórios › Financeiro | Acesse mais e melhor crédito! | `/admin/dre` | Relatório | `/relatorios/dre` | — | IMPLEMENTADO |  |
| SCR-216 | Relatórios › Financeiro | Acesse mais e melhor crédito! | `/admin/dre-annual` | Relatório | `/relatorios/dre_annual` | — | IMPLEMENTADO |  |
| SCR-217 | Relatórios › Financeiro | Acesse mais e melhor crédito! | `/admin/receipt-cashflow-report` | Relatório | `/relatorios/receipt_cashflow` | — | IMPLEMENTADO |  |
| SCR-218 | Relatórios › Financeiro | Relatório de Estoque/Financeiro | `/admin/cashflow-product-report` | Relatório | `/relatorios/cashflow_product` | — | IMPLEMENTADO |  |
| SCR-219 | Relatórios › Financeiro | Acesse mais e melhor crédito! | `/admin/cost-center-report` | Relatório | `/relatorios/cost_center` | — | IMPLEMENTADO |  |
| SCR-220 | Relatórios › Financeiro | Relatório de Apuração de Custos por Conta e Centro de Custo | `/admin/cost-calculation-report` | Relatório | `/relatorios/cost_calculation` | — | IMPLEMENTADO |  |
| SCR-221 | Relatórios › Financeiro | Relatório Financiamentos | `/admin/financings-report` | Relatório | `/relatorios/financings` | — | IMPLEMENTADO |  |
| SCR-222 | Relatórios › Financeiro | Títulos de Adiantamento | `/admin/advance-titles-report` | Relatório | `/relatorios/advance_titles` | — | IMPLEMENTADO |  |
| SCR-223 | Relatórios › Financeiro | Relatório de Conciliação de Contas Consolidadas | `/admin/account-reconciliation-report` | Relatório | `/relatorios/account_reconciliation` | — | IMPLEMENTADO |  |
| SCR-224 | Relatórios › Financeiro | Acesse mais e melhor crédito! | `/admin/cost-centers-unified-report` | Relatório | `/relatorios/cost_centers_unified` | — | IMPLEMENTADO |  |
| SCR-225 | Relatórios › Financeiro | Relatório de Contas Tributárias e Não Tributárias | `/admin/tax-accounts` | Relatório | `/relatorios/tax_accounts` | — | EM IMPLEMENTAÇÃO | API /financial/tax-accounts pronta; sem tela dedicada (usar Contas a Pagar com filtro tributo) |
| SCR-226 | Relatórios › Financeiro | Relatório Consolidado de Contas a Pagar e Receber | `/admin/accounts-payable-receivable-report` | Relatório | `/relatorios/payable_receivable` | — | IMPLEMENTADO |  |
| SCR-227 | Relatórios › Financeiro | Relatório de Saldo Devedor/Fornecedor | `/admin/provider-balance-report` | Relatório | `/relatorios/provider_balance` | — | IMPLEMENTADO |  |
| SCR-228 | Relatórios › Estoque | Relatório Movimentação Estoque | `/admin/stock-movement-report` | Relatório | `/relatorios/stock_movement` | — | IMPLEMENTADO |  |
| SCR-229 | Relatórios › Estoque | Relatório de Requisição/Saída | `/admin/requisitions-report` | Relatório | `/relatorios/requisitions` | — | IMPLEMENTADO |  |
| SCR-230 | Relatórios › Estoque | Relatório Baixa Estoque | `/admin/stock-writeoffs-report` | Relatório | `/relatorios/stock_writeoffs` | — | IMPLEMENTADO |  |
| SCR-231 | Relatórios › Estoque | Relatório DFe | `/admin/dfe-report` | Relatório | `/relatorios/dfe` | — | IMPLEMENTADO |  |
| SCR-232 | Relatórios › Estoque | Relatório Custo Produção Batida | `/admin/food-beat-report` | Relatório | `/relatorios/feed_batch_cost` | — | IMPLEMENTADO |  |
| SCR-233 | Relatórios › Estoque | Relatório de Curva ABC | `/admin/stocks-abc-report` | Relatório | `/relatorios/stocks_abc` | — | IMPLEMENTADO |  |
| SCR-234 | Relatórios › Estoque | Relatório Recebimentos | `/admin/receipts-report` | Relatório | `/relatorios/receipts` | — | IMPLEMENTADO |  |
| SCR-235 | Relatórios › Estoque | Relatório Estoque Consolidado | `/admin/stocks-consolidated-report` | Relatório | `/relatorios/stocks_consolidated` | — | TESTADO |  |
| SCR-236 | Relatórios › Estoque | Relatório de Lote/Fornecedor | `/admin/stocks-lot-provider` | Página | `/relatorios/stocks_lot_provider` | — | IMPLEMENTADO |  |
| SCR-237 | Relatórios › Estoque | Saída de Produtos x Centro de Custo | `/admin/products-exit-cost-center-report` | Relatório | `/relatorios/exits_cost_center` | — | IMPLEMENTADO |  |
| SCR-238 | Relatórios › Suprimentos | Relatório de Suprimentos | `/admin/supplies-report` | Relatório | `/relatorios/supplies` | — | IMPLEMENTADO |  |
| SCR-239 | Relatórios › Suprimentos | Relatório Savings | `/admin/savings-report` | Relatório | `/relatorios/savings` | — | IMPLEMENTADO |  |
| SCR-240 | Relatórios › Suprimentos | Relatório ANS | `/admin/ans-report` | Relatório | `/relatorios/ans` | — | IMPLEMENTADO |  |
| SCR-241 | Relatórios › Suprimentos | Relatório de Orçamentos/Fornecedores | `/admin/request-quotation-report` | Relatório | `/relatorios/quotations` | — | IMPLEMENTADO |  |
| SCR-242 | Relatórios › Suprimentos | Relatório Produtos x Previsão de entrega | `/admin/request-purchase-forecast-report` | Relatório | `/relatorios/purchase_forecast` | — | IMPLEMENTADO |  |
| SCR-243 | Relatórios › Suprimentos | Relatório de Status de SLA | `/admin/supply-status-report` | Relatório | `/relatorios/supply_sla` | — | IMPLEMENTADO |  |
| SCR-244 | Relatórios › Suprimentos | Relatório Gerencial de Solicitações | `/admin/request-purchase-management-report` | Relatório | `/relatorios/purchase_management` | — | IMPLEMENTADO |  |
| SCR-245 | Relatórios › Vendas | Relatório de Vendas/Cliente | `/admin/sales-report` | Relatório | `/relatorios/sales_client` | — | IMPLEMENTADO |  |
| SCR-246 | Relatórios › Vendas | Relatório de Vendas/Produto | `/admin/sales-product-report` | Relatório | `/relatorios/sales_product` | — | IMPLEMENTADO |  |
| SCR-247 | Relatórios › Vendas | Relatório de Vendas por Cliente/Produto | `/admin/sales-client-report` | Relatório | `/relatorios/sales_client_product` | — | IMPLEMENTADO |  |
| SCR-248 | Relatórios › Vendas | Relatório Vendas/Funcionários | `/admin/sales-employee-report` | Relatório | `/relatorios/sales_employee` | — | IMPLEMENTADO |  |
| SCR-249 | Relatórios › Vendas | Relatório de Curva ABC | `/admin/sales-abc-report` | Relatório | `/api/sales/abc` | — | EM IMPLEMENTAÇÃO | API pronta (curva ABC de vendas); sem tela dedicada |
| SCR-250 | Relatórios › Gestão Pessoal | Cálculo Mensal | `/admin/monthly-calculation` | Relatório | `/relatorios/monthly_calculation` | — | IMPLEMENTADO |  |
| SCR-251 | Relatórios › Gestão Pessoal | Relatório de Aniversariantes | `/admin/birthdays-report` | Relatório | `/relatorios/birthdays` | — | IMPLEMENTADO |  |
| SCR-252 | Relatórios › Gestão Pessoal | Relatório de Horas Logadas | `/admin/logged-hours-report` | Relatório | `/relatorios/logged_hours` | — | IMPLEMENTADO |  |
| SCR-253 | Relatórios › Gestão Pessoal | Relatório de Funcionários Ativos | `/admin/active-employees` | Relatório | `/relatorios/active_employees` | — | IMPLEMENTADO |  |
| SCR-254 | Relatórios › Gestão Pessoal | Relatório de Adiantamento Salarial | `/admin/advances/report` | Relatório | `/relatorios/advances` | — | IMPLEMENTADO |  |
| SCR-255 | Relatórios › Gestão Fiscal | Relatórios Lançamento Contábil | `/admin/double-entry-accounting-report` | Relatório | `/relatorios/journal_entries` | — | IMPLEMENTADO |  |
| SCR-256 | Relatórios › Gestão Fiscal | Relatório NF-e | `/admin/nfe-report` | Relatório | `/relatorios/` | — | NÃO INICIADO | Depende de emissão de NF-e |
| SCR-257 | Relatórios › Gestão Fiscal | Relatório de Faturamento | `/admin/nfe-product-report` | Relatório | `/relatorios/nfe_product` | — | EM IMPLEMENTAÇÃO | Faturamento por produto calculado a partir das vendas confirmadas (sem NF-e emitida) |
| SCR-258 | Relatórios › Gestão Fiscal | Relatório de Conferência do Livro Caixa | `/admin/cash-book-report` | Relatório | `/relatorios/cash_book` | — | IMPLEMENTADO |  |
| SCR-259 | Relatórios › Gestão de Frotas | Relatório Máquinas | `/admin/equipment-machines-report` | Relatório | `/relatorios/machines` | — | IMPLEMENTADO |  |
| SCR-260 | Relatórios › Gestão de Frotas | Relatório Máquinas - Abastecimentos | `/admin/equipment-machines-supply-report` | Relatório | `/relatorios/machine_supplies` | — | IMPLEMENTADO |  |
| SCR-261 | Relatórios › Gestão de Frotas | Relatório Máquinas - Manutenções | `/admin/equipment-machines-maintenance-report` | Relatório | `/relatorios/machine_maintenances` | — | IMPLEMENTADO |  |
| SCR-262 | Integrações | Integração Domínio | `/admin/integration-dominios` | Listagem | `/integracoes/exportacoes` | `/configuracoes?tab=integracoes&sub=exportacoes` | NÃO INICIADO | Integração contábil Domínio não construída; exportação CSV/XLSX disponível; UNIFICADO: aba da área /configuracoes (rota antiga redireciona) |
| SCR-263 | Integrações | Integração CTA Smart | `/admin/integration-cta-smart` | Listagem | `/frota/abastecimentos` | `/frota?tab=abastecimentos` | NÃO INICIADO | Campo 'origem' preparado (cta_smart); importação automática não construída; UNIFICADO: aba da área /frota (rota antiga redireciona) |
| SCR-264 | Integrações | CTA Smart - Abastecimentos Importados | `/admin/cta-smart-supplies` | Listagem | `/frota/abastecimentos` | `/frota?tab=abastecimentos` | NÃO INICIADO | Idem CTA Smart; UNIFICADO: aba da área /frota (rota antiga redireciona) |
| SCR-265 | Integrações › Exportações/CSV | Exportar CSV - Contas Pagas/Recebidas | `/admin/financial-export` | Página | `/integracoes/exportacoes` | `/configuracoes?tab=integracoes&sub=exportacoes` | UNIFICADO | UNIFICADO: aba da área /configuracoes (rota antiga redireciona) |
| SCR-266 | Cadastros Base › Pessoas | Funcionários | `/admin/employees/report` | Relatório | `/integracoes/exportacoes` | `/configuracoes?tab=integracoes&sub=exportacoes` | UNIFICADO | UNIFICADO: aba da área /configuracoes (rota antiga redireciona) |
| SCR-267 | Cadastros Base › Pessoas | Funcionários | `/admin/employees/create` | Cadastro (novo) | `/cadastros/people/new?is_employee=true` | — | MELHORADO | Cadastro único de pessoas com papéis (funcionário/fornecedor/cliente/proprietário/transportadora) + perfil de funcionário; evita duplicidade da referência |
| SCR-268 | Cadastros Base › Pessoas | Funcionários | `/admin/employees/2658` | Detalhe | `/cadastros/people/[id]?is_employee=true` | — | MELHORADO | Cadastro único de pessoas com papéis (funcionário/fornecedor/cliente/proprietário/transportadora) + perfil de funcionário; evita duplicidade da referência |
| SCR-269 | Cadastros Base › Pessoas | Funcionários | `/admin/employees/2658/edit` | Cadastro (edição) | `/cadastros/people/[id]?is_employee=true` | — | MELHORADO | Cadastro único de pessoas com papéis (funcionário/fornecedor/cliente/proprietário/transportadora) + perfil de funcionário; evita duplicidade da referência |
| SCR-270 | Cadastros Base › Pessoas | Você já atingiu o limite de usuários. Contate o Administrador. | `/admin/users/create` | Cadastro (novo) | `/admin/usuarios/new` | — | TESTADO | Sem limite de licença por usuário (referência bloqueava 'limite de usuários'); vínculo perfil × fazendas |
| SCR-271 | Cadastros Base › Pessoas | Usuários | `/admin/users/1086` | Detalhe | `/admin/usuarios/[id]` | — | TESTADO | Sem limite de licença por usuário (referência bloqueava 'limite de usuários'); vínculo perfil × fazendas |
| SCR-272 | Cadastros Base › Pessoas | Usuários | `/admin/users/1086/edit` | Cadastro (edição) | `/admin/usuarios/[id]` | — | TESTADO | Sem limite de licença por usuário (referência bloqueava 'limite de usuários'); vínculo perfil × fazendas |
| SCR-273 | Administrativo › Estoque | Documento Fiscal | `/admin/invoices/create` | Cadastro (novo) | `/estoque/documentos-fiscais/new` | — | TESTADO | Importação de XML NF-e, itens, estoque e títulos em transação única |
| SCR-274 | Administrativo › Estoque | Consulte os documentos | `/admin/dfe/create` | Cadastro (novo) | `/estoque/dfe/new` | — | EM IMPLEMENTAÇÃO | Fila de DFe e manifestação registradas localmente; consulta automática à SEFAZ (certificado A1) não integrada |
| SCR-275 | Administrativo › Estoque > Fábrica | Formulação | `/admin/foods/create` | Cadastro (novo) | `/estoque/formulacoes/new` | — | IMPLEMENTADO |  |
| SCR-276 | Financeiro | Contas a Pagar | `/admin/expenses/create` | Cadastro (novo) | `/financeiro/contas-a-pagar/new` | — | TESTADO |  |
| SCR-277 | Financeiro | Contas a Pagar | `/admin/expenses/152422` | Detalhe | `/financeiro/contas-a-pagar/[id]` | — | TESTADO |  |
| SCR-278 | Financeiro | Contas a Pagar | `/admin/expenses/152422/edit` | Cadastro (edição) | `/financeiro/contas-a-pagar/[id]/edit` | — | TESTADO |  |
| SCR-279 | Financeiro | Conta a Receber | `/admin/incomes/create` | Cadastro (novo) | `/financeiro/contas-a-receber/new` | — | TESTADO |  |
| SCR-280 | Financeiro | Conta a Receber | `/admin/incomes/21909` | Detalhe | `/financeiro/contas-a-receber/[id]` | — | TESTADO |  |
| SCR-281 | Financeiro | Conta a Receber | `/admin/incomes/21909/edit` | Cadastro (edição) | `/financeiro/contas-a-receber/[id]/edit` | — | TESTADO |  |
| SCR-282 | Financeiro | Movimento Caixa/Bancário | `/admin/movements/create` | Cadastro (novo) | `/financeiro/movimentos/new` | — | TESTADO |  |
| SCR-283 | Financeiro | Movimento Caixa/Bancário | `/admin/movements/280312` | Detalhe | `/financeiro/movimentos/[id]` | — | TESTADO |  |
| SCR-284 | Financeiro | Movimento Caixa/Bancário | `/admin/movements/280312/edit` | Cadastro (edição) | `/financeiro/movimentos/[id]` | — | TESTADO | documentos transacionais são imutáveis após confirmação: correção via cancelamento/estorno (MELHORADO) |
| SCR-285 | Financeiro › Conciliação | Importar OFX | `/admin/ofx-imports/create` | Cadastro (novo) | `/financeiro/ofx/new` | — | TESTADO | Parser OFX com teste unitário; conciliação por vínculo ou criação de movimento |
| SCR-286 | Financeiro › Conciliação | Importar OFX | `/admin/ofx-imports/548` | Detalhe | `/financeiro/ofx/[id]` | — | TESTADO | Parser OFX com teste unitário; conciliação por vínculo ou criação de movimento |
| SCR-287 | Financeiro › Conciliação | Importar OFX | `/admin/ofx-imports/548/edit` | Cadastro (edição) | `/financeiro/ofx/[id]` | — | TESTADO | Parser OFX com teste unitário; conciliação por vínculo ou criação de movimento; documentos transacionais são imutáveis após confirmação: correção via cancelamento/estorno (MELHORADO) |
| SCR-288 | Gestão Fiscal › NFe | NFe | `/admin/nfe/create` | Cadastro (novo) | `/fiscal/new` | — | NÃO INICIADO | Emissão de NF-e exige certificado digital e homologação SEFAZ — fora do escopo desta entrega |
| SCR-289 | Gestão Fiscal | Consulte os documentos | `/admin/nfses/create` | Cadastro (novo) | `/fiscal/new` | — | NÃO INICIADO | Consulta de NFS-e recebidas depende de integração municipal |
| SCR-290 | Cadastros Base › Estrutura | Centro de custo | `/admin/costcenters/2` | Detalhe | `/cadastros/cost_centers/[id]` | — | TESTADO | Árvore hierárquica com 'criar descendente' |
| SCR-291 | Cadastros Base › Estrutura | Centro de Custo | `/admin/costcenters/1317/edit` | Cadastro (edição) | `/cadastros/cost_centers/[id]` | — | TESTADO | Árvore hierárquica com 'criar descendente' |
| SCR-292 | Cadastros Base › Estrutura | Fazenda | `/admin/farms/create` | Cadastro (novo) | `/cadastros/farms/new` | — | IMPLEMENTADO |  |
| SCR-293 | Cadastros Base › Estrutura | Fazendas | `/admin/farms/80` | Detalhe | `/cadastros/farms/[id]` | — | IMPLEMENTADO |  |
| SCR-294 | Cadastros Base › Estrutura | Fazenda | `/admin/farms/80/edit` | Cadastro (edição) | `/cadastros/farms/[id]` | — | IMPLEMENTADO |  |
| SCR-295 | Cadastros Base › Estrutura | Safras | `/admin/harvests/create` | Cadastro (novo) | `/cadastros/harvests/new` | — | IMPLEMENTADO |  |
| SCR-296 | Cadastros Base › Estrutura | Safras | `/admin/harvests/425` | Detalhe | `/cadastros/harvests/[id]` | — | IMPLEMENTADO |  |
| SCR-297 | Cadastros Base › Estrutura | Safras | `/admin/harvests/425/edit` | Cadastro (edição) | `/cadastros/harvests/[id]` | — | IMPLEMENTADO |  |
| SCR-298 | Cadastros Base › Estrutura > Produtos | Endereçamento - Setor | `/admin/addressings/create` | Cadastro (novo) | `/cadastros/addressings/new` | — | IMPLEMENTADO |  |
| SCR-299 | Cadastros Base › Estrutura > Produtos | Endereçamento - Setor | `/admin/addressings/1` | Detalhe | `/cadastros/addressings/[id]` | — | IMPLEMENTADO |  |
| SCR-300 | Cadastros Base › Estrutura > Produtos | Endereçamento - Setor | `/admin/addressings/1/edit` | Cadastro (edição) | `/cadastros/addressings/[id]` | — | IMPLEMENTADO |  |
| SCR-301 | Cadastros Base › Estrutura > Produtos | Produtos | `/admin/products/report` | Relatório | `/integracoes/exportacoes` | `/configuracoes?tab=integracoes&sub=exportacoes` | UNIFICADO | UNIFICADO: aba da área /configuracoes (rota antiga redireciona) |
| SCR-302 | Cadastros Base › Estrutura > Produtos | Produtos | `/admin/products/create` | Cadastro (novo) | `/cadastros/products/new` | — | TESTADO |  |
| SCR-303 | Cadastros Base › Estrutura > Produtos | Produtos | `/admin/products/9036` | Detalhe | `/cadastros/products/[id]` | — | TESTADO |  |
| SCR-304 | Cadastros Base › Estrutura > Produtos | Produtos | `/admin/products/9036/edit` | Cadastro (edição) | `/cadastros/products/[id]` | — | TESTADO |  |
| SCR-305 | Cadastros Base › Estrutura > Produtos | Armazém | `/admin/warehouses/create` | Cadastro (novo) | `/cadastros/warehouses/new` | — | IMPLEMENTADO |  |
| SCR-306 | Cadastros Base › Estrutura > Produtos | Armazém | `/admin/warehouses/733` | Detalhe | `/cadastros/warehouses/[id]` | — | IMPLEMENTADO |  |
| SCR-307 | Cadastros Base › Estrutura > Produtos | Armazém | `/admin/warehouses/733/edit` | Cadastro (edição) | `/cadastros/warehouses/[id]` | — | IMPLEMENTADO |  |
| SCR-308 | Cadastros Base › Estrutura > Produtos | Saldo Inicial | `/admin/openingbalances/create` | Cadastro (novo) | `/estoque/estoque-inicial/new` | — | TESTADO |  |
| SCR-309 | Cadastros Base › Estrutura > Produtos | Saldo Inicial | `/admin/openingbalances/16877` | Detalhe | `/estoque/estoque-inicial/[id]` | — | TESTADO |  |
| SCR-310 | Cadastros Base › Estrutura > Produtos | Saldo Inicial | `/admin/openingbalances/16877/edit` | Cadastro (edição) | `/estoque/estoque-inicial/[id]` | — | TESTADO | documentos transacionais são imutáveis após confirmação: correção via cancelamento/estorno (MELHORADO) |
| SCR-311 | Cadastros Base › Estrutura > Rateios | Saldo Inicial | `/admin/apportionments/create` | Cadastro (novo) | `/cadastros/apportionment_categories/new` | — | IMPLEMENTADO |  |
| SCR-312 | Cadastros Base › Pessoas | Perfil Usuário | `/admin/roles/create` | Cadastro (novo) | `/admin/perfis/new` | — | TESTADO | Árvore de permissões por recurso × ação; autorização aplicada no servidor |
| SCR-313 | Cadastros Base › Pessoas | Perfil Usuário | `/admin/roles/361` | Detalhe | `/admin/perfis/[id]` | — | TESTADO | Árvore de permissões por recurso × ação; autorização aplicada no servidor |
| SCR-314 | Cadastros Base › Pessoas | Perfil Usuário | `/admin/roles/361/edit` | Cadastro (edição) | `/admin/perfis/[id]` | — | TESTADO | Árvore de permissões por recurso × ação; autorização aplicada no servidor |
| SCR-315 | Cadastros Base › Pessoas | Inscrições Estaduais | `/admin/people/create` | Cadastro (novo) | `/cadastros/people/new` | — | IMPLEMENTADO |  |
| SCR-316 | Cadastros Base › Pessoas | Pessoas | `/admin/people/28907` | Detalhe | `/cadastros/people/[id]` | — | IMPLEMENTADO |  |
| SCR-317 | Cadastros Base › Pessoas | Inscrições Estaduais | `/admin/people/28907/edit` | Cadastro (edição) | `/cadastros/people/[id]` | — | IMPLEMENTADO |  |
| SCR-318 | Cadastros Base › Pessoas | Proprietários | `/admin/proprietaries/report` | Relatório | `/integracoes/exportacoes` | `/configuracoes?tab=integracoes&sub=exportacoes` | UNIFICADO | UNIFICADO: aba da área /configuracoes (rota antiga redireciona) |
| SCR-319 | Cadastros Base › Pessoas | Inscrições Estaduais | `/admin/proprietaries/create` | Cadastro (novo) | `/cadastros/people/new?is_proprietary=true` | — | MELHORADO | Papel no cadastro único de pessoas |
| SCR-320 | Cadastros Base › Pessoas | Proprietários | `/admin/proprietaries/56` | Detalhe | `/cadastros/people/[id]?is_proprietary=true` | — | MELHORADO | Papel no cadastro único de pessoas |
| SCR-321 | Cadastros Base › Pessoas | Inscrições Estaduais | `/admin/proprietaries/56/edit` | Cadastro (edição) | `/cadastros/people/[id]?is_proprietary=true` | — | MELHORADO | Papel no cadastro único de pessoas |
| SCR-322 | Cadastros Base › Pessoas | Fornecedores | `/admin/providers/report` | Relatório | `/integracoes/exportacoes` | `/configuracoes?tab=integracoes&sub=exportacoes` | UNIFICADO | UNIFICADO: aba da área /configuracoes (rota antiga redireciona) |
| SCR-323 | Cadastros Base › Pessoas | Fornecedores | `/admin/providers/create` | Cadastro (novo) | `/cadastros/people/new?is_provider=true` | — | MELHORADO | Papel no cadastro único de pessoas |
| SCR-324 | Cadastros Base › Pessoas | Fornecedores | `/admin/providers/22911` | Detalhe | `/cadastros/people/[id]?is_provider=true` | — | MELHORADO | Papel no cadastro único de pessoas |
| SCR-325 | Cadastros Base › Pessoas | Fornecedores | `/admin/providers/22911/edit` | Cadastro (edição) | `/cadastros/people/[id]?is_provider=true` | — | MELHORADO | Papel no cadastro único de pessoas |
| SCR-326 | Cadastros Base › Pessoas | Clientes | `/admin/clients/report` | Relatório | `/integracoes/exportacoes` | `/configuracoes?tab=integracoes&sub=exportacoes` | UNIFICADO | UNIFICADO: aba da área /configuracoes (rota antiga redireciona) |
| SCR-327 | Cadastros Base › Pessoas | Inscrições Estaduais | `/admin/clients/create` | Cadastro (novo) | `/cadastros/people/new?is_client=true` | — | MELHORADO | Papel no cadastro único de pessoas |
| SCR-328 | Cadastros Base › Pessoas | Clientes | `/admin/clients/627` | Detalhe | `/cadastros/people/[id]?is_client=true` | — | MELHORADO | Papel no cadastro único de pessoas |
| SCR-329 | Cadastros Base › Pessoas | Inscrições Estaduais | `/admin/clients/627/edit` | Cadastro (edição) | `/cadastros/people/[id]?is_client=true` | — | MELHORADO | Papel no cadastro único de pessoas |
| SCR-330 | Cadastros Base › Pessoas | Regras de Autorização | `/admin/authorizers/create` | Cadastro (novo) | `/cadastros/authorizers/new` | — | TESTADO |  |
| SCR-331 | Cadastros Base › Pessoas | Autorizadores | `/admin/authorizers/433` | Detalhe | `/cadastros/authorizers/[id]` | — | TESTADO |  |
| SCR-332 | Cadastros Base › Pessoas | Regras de Autorização | `/admin/authorizers/433/edit` | Cadastro (edição) | `/cadastros/authorizers/[id]` | — | TESTADO |  |
| SCR-333 | Cadastros Base › Financeiros | Conta Bancaria | `/admin/accounts/create` | Cadastro (novo) | `/cadastros/bank_accounts/new` | — | TESTADO |  |
| SCR-334 | Cadastros Base › Financeiros | Contas Bancárias | `/admin/accounts/524` | Detalhe | `/cadastros/bank_accounts/[id]` | — | TESTADO |  |
| SCR-335 | Cadastros Base › Financeiros | Contas Bancárias | `/admin/accounts/524/edit` | Cadastro (edição) | `/cadastros/bank_accounts/[id]` | — | TESTADO |  |
| SCR-336 | Cadastros Base › Financeiros | Saldo Inicial- Contas | `/admin/open-movements/create` | Cadastro (novo) | `/financeiro/saldo-inicial/new` | — | IMPLEMENTADO |  |
| SCR-337 | Cadastros Base › Financeiros | Categoria Financeira | `/admin/financialcategories/325` | Detalhe | `/cadastros/financial_categories/[id]` | — | TESTADO |  |
| SCR-338 | Cadastros Base › Financeiros | Categoria Financeira | `/admin/financialcategories/9664/edit` | Cadastro (edição) | `/cadastros/financial_categories/[id]` | — | TESTADO |  |
| SCR-339 | Cadastros Base › Fiscais | Você já atingiu o limite de emissores. | `/admin/issue/create` | Cadastro (novo) | `/fiscal/new` | — | NÃO INICIADO | Emissor NF-e (certificado) — gap fiscal |
| SCR-340 | Cadastros Base › Fiscais | Inscrições Estaduais | `/admin/issue/8/edit` | Cadastro (edição) | `/fiscal/[id]` | — | NÃO INICIADO | Emissor NF-e (certificado) — gap fiscal; documentos transacionais são imutáveis após confirmação: correção via cancelamento/estorno (MELHORADO) |
| SCR-341 | Cadastros Base › Fiscais | Sincronização DFe | `/admin/issue-dfe-sync-time/create` | Cadastro (novo) | `/fiscal/new` | — | NÃO INICIADO | Depende do emissor/SEFAZ |
| SCR-342 | Cadastros Base › Fiscais | Sincronização NFS-e | `/admin/issue-nfse-sync-time/create` | Cadastro (novo) | `/fiscal/new` | — | NÃO INICIADO | Depende de integração municipal |
| SCR-343 | Cadastros Base › Fiscais | Regras Fiscais | `/admin/tax-rules/create` | Cadastro (novo) | `/cadastros/tax_rules/new` | — | IMPLEMENTADO |  |
| SCR-344 | Cadastros Base › Fiscais | Novo Contador | `/admin/contador/create` | Cadastro (novo) | `/cadastros/people/new` | — | MAPEADO | Contador é uma pessoa com papel; envio de arquivos ao contador não implementado |
| SCR-345 | Cadastros Base › Fiscais | Natureza de Operaçao | `/admin/natureoperations/create` | Cadastro (novo) | `/cadastros/nature_operations/new` | — | IMPLEMENTADO |  |
| SCR-346 | Cadastros Base › Fiscais | Natureza de Operação | `/admin/natureoperations/10527/edit` | Cadastro (edição) | `/cadastros/nature_operations/[id]` | — | IMPLEMENTADO |  |
| SCR-347 | Cadastros Base › Fiscais | Informações Complementares | `/admin/additional-info/create` | Cadastro (novo) | `/cadastros/additional_infos/new` | — | IMPLEMENTADO |  |
| SCR-348 | Cadastros Base › Fiscais | Plano de Contas | `/admin/plan-accounts/report` | Relatório | `/integracoes/exportacoes` | `/configuracoes?tab=integracoes&sub=exportacoes` | UNIFICADO | UNIFICADO: aba da área /configuracoes (rota antiga redireciona) |
| SCR-349 | Cadastros Base › Fiscais | Planos de Contas | `/admin/plan-accounts/create` | Cadastro (novo) | `/cadastros/chart_accounts/new` | — | IMPLEMENTADO |  |
| SCR-350 | Cadastros Base › Fiscais | Planos de Contas | `/admin/plan-accounts/19156` | Detalhe | `/cadastros/chart_accounts/[id]` | — | IMPLEMENTADO |  |
| SCR-351 | Cadastros Base › Fiscais | Planos de Contas | `/admin/plan-accounts/19156/edit` | Cadastro (edição) | `/cadastros/chart_accounts/[id]` | — | IMPLEMENTADO |  |
| SCR-352 | Cadastros Base › Agrícolas | Operação | `/admin/operations/create` | Cadastro (novo) | `/cadastros/operations/new` | — | IMPLEMENTADO |  |
| SCR-353 | Cadastros Base › Agrícolas | Operação | `/admin/operations/101` | Detalhe | `/cadastros/operations/[id]` | — | IMPLEMENTADO |  |
| SCR-354 | Cadastros Base › Agrícolas | Operação | `/admin/operations/101/edit` | Cadastro (edição) | `/cadastros/operations/[id]` | — | IMPLEMENTADO |  |
| SCR-355 | Cadastros Base › Agrícolas | Atividades | `/admin/activities/create` | Cadastro (novo) | `/cadastros/activities/new` | — | IMPLEMENTADO |  |
| SCR-356 | Cadastros Base › Agrícolas | Atividades | `/admin/activities/716` | Detalhe | `/cadastros/activities/[id]` | — | IMPLEMENTADO |  |
| SCR-357 | Cadastros Base › Agrícolas | Atividades | `/admin/activities/716/edit` | Cadastro (edição) | `/cadastros/activities/[id]` | — | IMPLEMENTADO |  |
| SCR-358 | Cadastros Base › Pecuários | Parâmetro de Peso | `/admin/parameter-weights/create` | Cadastro (novo) | `/cadastros/weight_parameters/new` | — | IMPLEMENTADO |  |
| SCR-359 | Cadastros Base › Pecuários | Forragem | `/admin/fodder/create` | Cadastro (novo) | `/cadastros/fodders/new` | — | IMPLEMENTADO |  |
| SCR-360 | Cadastros Base › Pecuários | Forragem | `/admin/fodder/13` | Detalhe | `/cadastros/fodders/[id]` | — | IMPLEMENTADO |  |
| SCR-361 | Cadastros Base › Pecuários | Forragem | `/admin/fodder/13/edit` | Cadastro (edição) | `/cadastros/fodders/[id]` | — | IMPLEMENTADO |  |
| SCR-362 | Cadastros Base › Pecuários | Informações do Animal | `/admin/animals/create` | Cadastro (novo) | `/pecuaria/animais/new` | — | TESTADO |  |
| SCR-363 | Cadastros Base › Pecuários | Tipos de Identificação | `/admin/animals/108942` | Detalhe | `/pecuaria/animais/[id]` | — | TESTADO |  |
| SCR-364 | Cadastros Base › Pecuários | Informações do Animal | `/admin/animals/108942/edit` | Cadastro (edição) | `/pecuaria/animais/[id]` | — | TESTADO | documentos transacionais são imutáveis após confirmação: correção via cancelamento/estorno (MELHORADO) |
| SCR-365 | Cadastros Base › Pecuários | Módulo Pastejo | `/admin/grazing/create` | Cadastro (novo) | `/cadastros/grazing_modules/new` | — | IMPLEMENTADO |  |
| SCR-366 | Cadastros Base › Pecuários | Cochos | `/admin/troughs/create` | Cadastro (novo) | `/cadastros/troughs/new` | — | IMPLEMENTADO |  |
| SCR-367 | Cadastros Base › Pecuários | Cochos | `/admin/troughs/353/edit` | Cadastro (edição) | `/cadastros/troughs/[id]` | — | IMPLEMENTADO |  |
| SCR-368 | Cadastros Base › Pecuários | Lote de Animais | `/admin/batches/create` | Cadastro (novo) | `/cadastros/batches/new` | — | IMPLEMENTADO |  |
| SCR-369 | Cadastros Base › Pecuários | Lote/Módulo | `/admin/batch-grazing/create` | Cadastro (novo) | `/pecuaria/transferencias/lote-modulo-area/new` | — | MELHORADO | Lote/Módulo e Lote/Área unificados em uma transferência com histórico |
| SCR-370 | Cadastros Base › Pecuários | Lote/Área | `/admin/batch-area/create` | Cadastro (novo) | `/pecuaria/transferencias/lote-modulo-area/new` | — | MELHORADO | Unificado com Lote/Módulo |
| SCR-371 | Cadastros Base › Bens/Ativos | Inventário | `/admin/equipments/create` | Cadastro (novo) | `/cadastros/equipments/new` | — | TESTADO |  |
| SCR-372 | Administrativo › Suprimentos | SLA Status | `/admin/supply-status/89/edit` | Cadastro (edição) | `/suprimentos/sla/[id]` | — | IMPLEMENTADO |  |
| SCR-373 | Administrativo › Suprimentos | Solicitação | `/admin/request-purchase/create` | Cadastro (novo) | `/suprimentos/request/new` | — | TESTADO |  |
| SCR-374 | Administrativo › Estoque | Nova Entrada / Insumos | `/admin/input-entries/create` | Cadastro (novo) | `/estoque/entradas/new` | — | TESTADO |  |
| SCR-375 | Administrativo › Estoque | Novo Perfil de Lançamento | `/admin/provider-launch-profiles/create` | Cadastro (novo) | `/cadastros/provider_launch_profiles/new` | — | IMPLEMENTADO |  |
| SCR-376 | Administrativo › Estoque | Baixa de Estoque | `/admin/stock-writeoffs/create` | Cadastro (novo) | `/estoque/baixas/new` | — | IMPLEMENTADO |  |
| SCR-377 | Administrativo › Estoque | Requisição do Estoque | `/admin/requisitions/create` | Cadastro (novo) | `/estoque/requisicoes/new` | — | TESTADO |  |
| SCR-378 | Administrativo › Estoque | Devolução do Estoque | `/admin/devolution/create` | Cadastro (novo) | `/estoque/devolucoes/new` | — | TESTADO |  |
| SCR-379 | Administrativo › Estoque | Transferência de Armazém | `/admin/warehouse-transfer/create` | Cadastro (novo) | `/estoque/transferencias/new?kind=warehouse` | — | TESTADO |  |
| SCR-380 | Administrativo › Estoque | Transferência de Armazém entre Fazendas | `/admin/warehouse-transfer-between-farms/create` | Cadastro (novo) | `/estoque/transferencias/new?kind=farm` | — | TESTADO |  |
| SCR-381 | Administrativo › Estoque | Saldo Estoque | `/admin/stocks/report` | Relatório | `/relatorios/stocks_consolidated` | — | TESTADO |  |
| SCR-382 | Administrativo › Estoque > Fábrica | Batida | `/admin/food-beats/create` | Cadastro (novo) | `/estoque/batidas/new` | — | IMPLEMENTADO |  |
| SCR-383 | Administrativo › Gestão Pessoal | Eventos | `/admin/events/create` | Cadastro (novo) | `/cadastros/hr_events/new` | — | IMPLEMENTADO |  |
| SCR-384 | Administrativo › Gestão Pessoal | Eventos | `/admin/events/183` | Detalhe | `/cadastros/hr_events/[id]` | — | IMPLEMENTADO |  |
| SCR-385 | Administrativo › Gestão Pessoal | Eventos | `/admin/events/183/edit` | Cadastro (edição) | `/cadastros/hr_events/[id]` | — | IMPLEMENTADO |  |
| SCR-386 | Administrativo › Gestão Pessoal | Funções | `/admin/functions/create` | Cadastro (novo) | `/cadastros/job_functions/new` | — | IMPLEMENTADO |  |
| SCR-387 | Administrativo › Gestão Pessoal | Funções | `/admin/functions/7` | Detalhe | `/cadastros/job_functions/[id]` | — | IMPLEMENTADO |  |
| SCR-388 | Administrativo › Gestão Pessoal | Funções | `/admin/functions/7/edit` | Cadastro (edição) | `/cadastros/job_functions/[id]` | — | IMPLEMENTADO |  |
| SCR-389 | Administrativo › Gestão Pessoal | Equipes | `/admin/teams/report` | Relatório | `/integracoes/exportacoes` | `/configuracoes?tab=integracoes&sub=exportacoes` | UNIFICADO | UNIFICADO: aba da área /configuracoes (rota antiga redireciona) |
| SCR-390 | Administrativo › Gestão Pessoal | Equipes | `/admin/teams/create` | Cadastro (novo) | `/cadastros/teams/new` | — | IMPLEMENTADO |  |
| SCR-391 | Administrativo › Gestão Pessoal | Registro/Faltas | `/admin/absences/create` | Cadastro (novo) | `/cadastros/absences/new` | — | TESTADO |  |
| SCR-392 | Administrativo › Gestão Pessoal | Rateio do Adiantamento | `/admin/advances/create` | Cadastro (novo) | `/gestao-pessoal/adiantamentos/new` | — | TESTADO |  |
| SCR-393 | Administrativo › Gestão Pessoal | Registro/Eventos | `/admin/bonuses/create` | Cadastro (novo) | `/cadastros/bonuses/new` | — | IMPLEMENTADO |  |
| SCR-394 | Administrativo › Gestão Pessoal | Funcionário X Eventos | `/admin/employeeevents/report` | Relatório | `/integracoes/exportacoes` | `/configuracoes?tab=integracoes&sub=exportacoes` | UNIFICADO | UNIFICADO: aba da área /configuracoes (rota antiga redireciona) |
| SCR-395 | Administrativo › Gestão Pessoal | Funcionário x Eventos | `/admin/employeeevents/create` | Cadastro (novo) | `/cadastros/employee_events/new` | — | IMPLEMENTADO |  |
| SCR-396 | Administrativo › Gestão Documentos | Tipo de Documento | `/admin/document-types/create` | Cadastro (novo) | `/cadastros/document_types/new` | — | IMPLEMENTADO |  |
| SCR-397 | Administrativo › Gestão Documentos | Tipo de Documento | `/admin/document-types/35` | Detalhe | `/cadastros/document_types/[id]` | — | IMPLEMENTADO |  |
| SCR-398 | Administrativo › Gestão Documentos | Tipo de Documento | `/admin/document-types/35/edit` | Cadastro (edição) | `/cadastros/document_types/[id]` | — | IMPLEMENTADO |  |
| SCR-399 | Administrativo › Gestão Documentos | Gestão de Documentos | `/admin/document-managements/create` | Cadastro (novo) | `/cadastros/documents/new` | — | IMPLEMENTADO | Arquivos via Supabase Storage pendentes de projeto Supabase |
| SCR-400 | Operacional › Pecuária | Informações do Animal | `/admin/animals-management/create` | Cadastro (novo) | `/pecuaria/animais/new` | — | TESTADO |  |
| SCR-401 | Operacional › Pecuária | Tipos de Identificação | `/admin/animals-management/108942` | Detalhe | `/pecuaria/animais/[id]` | — | TESTADO |  |
| SCR-402 | Operacional › Pecuária | Informações do Animal | `/admin/animals-management/108942/edit` | Cadastro (edição) | `/pecuaria/animais/[id]` | — | TESTADO | documentos transacionais são imutáveis após confirmação: correção via cancelamento/estorno (MELHORADO) |
| SCR-403 | Operacional › Pecuária | Planejamento Pecuário | `/admin/planning-livestock/create` | Cadastro (novo) | `/cadastros/livestock_plannings/new` | — | IMPLEMENTADO |  |
| SCR-404 | Operacional › Pecuária > Movimentações | Venda de Animais | `/admin/movement-sales/create` | Cadastro (novo) | `/pecuaria/movimentacoes/sale/new` | — | TESTADO |  |
| SCR-405 | Operacional › Pecuária > Movimentações | Compra de Animais | `/admin/movement-purchases/create` | Cadastro (novo) | `/pecuaria/movimentacoes/purchase/new` | — | TESTADO |  |
| SCR-406 | Operacional › Pecuária > Movimentações | Tipos de Identificação | `/admin/birth-animals/create` | Cadastro (novo) | `/pecuaria/movimentacoes/birth/new` | — | IMPLEMENTADO |  |
| SCR-407 | Operacional › Pecuária > Movimentações | Mortes | `/admin/death-animals/create` | Cadastro (novo) | `/pecuaria/movimentacoes/death/new` | — | IMPLEMENTADO |  |
| SCR-408 | Operacional › Pecuária > Movimentações | Perdas | `/admin/loss-animals/create` | Cadastro (novo) | `/pecuaria/movimentacoes/loss/new` | — | IMPLEMENTADO |  |
| SCR-409 | Operacional › Pecuária > Manejo | Pré-Lote | `/admin/purchase-lots/create` | Cadastro (novo) | `/pecuaria/processamentos/new` | — | MAPEADO | Pré-lotes representados pelos lotes por contagem (herd_lots) da compra; sem tela própria |
| SCR-410 | Operacional › Pecuária > Manejo | Pesagem | `/admin/weighings/create` | Cadastro (novo) | `/pecuaria/pesagens/new` | — | TESTADO |  |
| SCR-411 | Operacional › Pecuária > Manejo | Pesagem | `/admin/weighings/2223` | Detalhe | `/pecuaria/pesagens/[id]` | — | TESTADO |  |
| SCR-412 | Operacional › Pecuária > Manejo | Pesagem | `/admin/weighings/2223/edit` | Cadastro (edição) | `/pecuaria/pesagens/[id]` | — | TESTADO | documentos transacionais são imutáveis após confirmação: correção via cancelamento/estorno (MELHORADO) |
| SCR-413 | Operacional › Pecuária > Manejo | Nutrição | `/admin/nutritions/create` | Cadastro (novo) | `/pecuaria/manejo/nutrition/new` | — | IMPLEMENTADO |  |
| SCR-414 | Operacional › Pecuária > Manejo | Sanitário | `/admin/sanitaries/create` | Cadastro (novo) | `/pecuaria/manejo/sanitary/new` | — | TESTADO |  |
| SCR-415 | Operacional › Pecuária > Manejo | Desmama | `/admin/weanings/create` | Cadastro (novo) | `/pecuaria/manejo/weaning/new` | — | IMPLEMENTADO |  |
| SCR-416 | Operacional › Pecuária > Manejo | Apartação | `/admin/separations/create` | Cadastro (novo) | `/pecuaria/manejo/separation/new` | — | IMPLEMENTADO |  |
| SCR-417 | Operacional › Pecuária > Manejo | Pastagem | `/admin/pastures/create` | Cadastro (novo) | `/pecuaria/manejo/pasture/new` | — | IMPLEMENTADO |  |
| SCR-418 | Operacional › Pecuária > Manejo | Pastagem | `/admin/pastures/288` | Detalhe | `/pecuaria/manejo/pasture/[id]` | — | IMPLEMENTADO |  |
| SCR-419 | Operacional › Pecuária > Manejo | Pastagem | `/admin/pastures/288/edit` | Cadastro (edição) | `/pecuaria/manejo/pasture/[id]` | — | IMPLEMENTADO | documentos transacionais são imutáveis após confirmação: correção via cancelamento/estorno (MELHORADO) |
| SCR-420 | Operacional › Pecuária > Manejo > Reprodução | Estação de Monta | `/admin/breeding-seasons/create` | Cadastro (novo) | `/cadastros/breeding_seasons/new` | — | IMPLEMENTADO |  |
| SCR-421 | Operacional › Pecuária > Manejo > Reprodução | Lotes | `/admin/breeding-batch/create` | Cadastro (novo) | `/pecuaria/reproducao/acasalamentos/new` | — | MAPEADO | Lotes de reprodução por estação: filtro por lote no picker de matrizes; sem entidade própria |
| SCR-422 | Operacional › Pecuária > Manejo > Reprodução | Animais | `/admin/bull-seed-season/create` | Cadastro (novo) | `/cadastros/breeding_sires/new` | — | IMPLEMENTADO |  |
| SCR-423 | Operacional › Pecuária > Manejo > Reprodução | Produtos | `/admin/protocols-season/create` | Cadastro (novo) | `/cadastros/breeding_protocols/new` | — | IMPLEMENTADO |  |
| SCR-424 | Operacional › Pecuária > Manejo > Reprodução | Monta Natural | `/admin/breeding-matings/create` | Cadastro (novo) | `/pecuaria/reproducao/acasalamentos/new` | — | IMPLEMENTADO |  |
| SCR-425 | Operacional › Pecuária > Confinamento > Cadastros | Pátio | `/admin/feedlot-yards/create` | Cadastro (novo) | `/cadastros/feedlot_yards/new` | — | IMPLEMENTADO |  |
| SCR-426 | Operacional › Pecuária > Confinamento > Cadastros | Setores | `/admin/feedlot-sectors/create` | Cadastro (novo) | `/cadastros/feedlot_sectors/new` | — | IMPLEMENTADO |  |
| SCR-427 | Operacional › Pecuária > Confinamento > Cadastros | Curral | `/admin/feedlot-corrals/create` | Cadastro (novo) | `/cadastros/feedlot_corrals/new` | — | IMPLEMENTADO |  |
| SCR-428 | Operacional › Pecuária > Confinamento > Nutrição | Dieta | `/admin/diets/create` | Cadastro (novo) | `/cadastros/diets/new` | — | IMPLEMENTADO |  |
| SCR-429 | Operacional › Pecuária > Confinamento > Nutrição | Fases/Regras de Troca | `/admin/feeding-phases/create` | Cadastro (novo) | `/cadastros/feeding_phases/new` | — | IMPLEMENTADO |  |
| SCR-430 | Operacional › Pecuária > Confinamento > Nutrição | Novo Batelada | `/admin/diet-beats/create` | Cadastro (novo) | `/confinamento/bateladas/new` | — | IMPLEMENTADO |  |
| SCR-431 | Operacional › Pecuária > Confinamento > Nutrição | Fornecimento de Trato | `/admin/diet-beat-supplies/create` | Cadastro (novo) | `/confinamento/trato/new` | — | IMPLEMENTADO |  |
| SCR-432 | Operacional › Pecuária > Confinamento > Nutrição | Nova Leitura de Cocho | `/admin/trough-readings/create` | Cadastro (novo) | `/confinamento/leitura-cocho/new` | — | IMPLEMENTADO |  |
| SCR-433 | Operacional | Pluviometria | `/admin/rainfalls/create` | Cadastro (novo) | `/cadastros/rainfalls/new` | — | IMPLEMENTADO |  |
| SCR-434 | Operacional › Vendas | Orçamentos | `/admin/budgets/create` | Cadastro (novo) | `/vendas/budgets/new` | — | TESTADO |  |
| SCR-435 | Operacional › Vendas | Pedidos | `/admin/orders/create` | Cadastro (novo) | `/vendas/orders/new` | — | TESTADO |  |
| SCR-436 | Operacional › Vendas | Vendas | `/admin/sales/create` | Cadastro (novo) | `/vendas/sales/new` | — | TESTADO |  |
| SCR-437 | Operacional › Ordens de Serviço | Identificação da OS | `/admin/service-orders/create` | Cadastro (novo) | `/os/new` | — | IMPLEMENTADO |  |
| SCR-438 | Financeiro | Gestão de Contrato | `/admin/contracts/create` | Cadastro (novo) | `/cadastros/contracts/new` | — | IMPLEMENTADO |  |
| SCR-439 | Financeiro | Categorias | `/admin/budget-plannings/create` | Cadastro (novo) | `/financeiro/previsao-orcamentaria/new` | — | IMPLEMENTADO |  |
| SCR-440 | Financeiro | Congelamento Financeiro | `/admin/financial-freezes/create` | Cadastro (novo) | `/cadastros/financial_freezes/new` | — | TESTADO | Congelamento aplicado no servidor (PERIOD_FROZEN) para títulos, baixas e movimentos |
| SCR-441 | Gestão de Frota | Manutenções | `/admin/maintenances/create` | Cadastro (novo) | `/frota/manutencoes/new` | — | IMPLEMENTADO |  |
| SCR-442 | Gestão de Frota | Abastecimentos | `/admin/supplies/create` | Cadastro (novo) | `/frota/abastecimentos/new` | — | TESTADO |  |
| SCR-443 | Gestão de Frota | Manutenções Preventivas | `/admin/maintenance-preventives/create` | Cadastro (novo) | `/cadastros/preventive_maintenances/new` | — | IMPLEMENTADO | Alertas em /frota/alertas |
| SCR-444 | Gestão de Frota | Transferência de Máquinas | `/admin/equipment-transfer/create` | Cadastro (novo) | `/frota/transferencias/new` | — | IMPLEMENTADO |  |
| SCR-445 | Gestão Fiscal | LCDPR - Livro Caixa Digital do Produtor Rural | `/admin/cash-book/create` | Cadastro (novo) | `/dashboards/livro-caixa/new` | — | EM IMPLEMENTAÇÃO | Dados do livro caixa capturados (contas 'livro caixa', dedutibilidade); geração do arquivo LCDPR não implementada |
| SCR-446 | Gestão Fiscal | SPED Fiscal - EFD ICMS/IPI | `/admin/sped-fiscal/create` | Cadastro (novo) | `/fiscal/new` | — | NÃO INICIADO | SPED EFD ICMS/IPI depende de emissão fiscal |
| SCR-447 | Gestão Fiscal | Partida Dobrada | `/admin/double-entry-accountings/create` | Cadastro (novo) | `/fiscal/partida-dobrada/new` | — | IMPLEMENTADO |  |
| SCR-448 | Integrações | Integração Domínio | `/admin/integration-dominios/create` | Cadastro (novo) | `/integracoes/exportacoes/new` | — | NÃO INICIADO | Integração contábil Domínio não construída; exportação CSV/XLSX disponível |
| SCR-449 | Cadastros Base › Estrutura | Fazendas | `/admin/farms/80/kml-export` | Página | — | — | NÃO INICIADO | Mapa/KML da fazenda (georreferenciamento) não construído |
| SCR-450 | Cadastros Base › Estrutura | Fazendas | `/admin/farms/80/map-print` | Página | — | — | NÃO INICIADO | Mapa/KML da fazenda (georreferenciamento) não construído |
| SCR-451 | Administrativo › Suprimentos | Informação do Pedido | `/admin/request-purchase/11105` | Detalhe | `/suprimentos/request/[id]` | — | TESTADO |  |
| SCR-452 | Administrativo › Suprimentos | Informação do Pedido | `/admin/request-purchase/12095` | Detalhe | `/suprimentos/request/[id]` | — | TESTADO |  |
| SCR-453 | Administrativo › Suprimentos | Informação do Pedido | `/admin/request-purchase/14142` | Detalhe | `/suprimentos/request/[id]` | — | TESTADO |  |
| SCR-454 | Administrativo › Suprimentos | Informação do Pedido | `/admin/request-authorization/15471/second` | Listagem | `/suprimentos/authorization/[id]` | — | TESTADO |  |
| SCR-455 | Financeiro | Movimento Caixa/Bancário | `/admin/movements/245221` | Detalhe | `/financeiro/movimentos/[id]` | — | TESTADO |  |
