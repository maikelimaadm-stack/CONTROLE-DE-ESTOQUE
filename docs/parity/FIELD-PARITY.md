# Paridade de Campos

_Gerado por `node scripts/parity.mjs` em 2026-09-11 a partir de docs/reference/SYSTEM-INVENTORY.md (455 telas) e do código deste repositório. Legenda de status: NÃO INICIADO · MAPEADO · EM IMPLEMENTAÇÃO · IMPLEMENTADO · TESTADO (coberto por teste automatizado) · BLOQUEADO · NÃO APLICÁVEL · MELHORADO (comportamento intencionalmente diferente/superior, ver observação) · UNIFICADO (tela absorvida como aba/filtro/ação de uma área unificada — ver docs/UX-ARCHITECTURE.md; a rota antiga redireciona)._

Comparação quantitativa por tela: campos de formulário / filtros / colunas observados na referência × campos declarados no nosso código (registro declarativo de cadastros em packages/domain/src/resources ou `<Field>` nas páginas). A comparação nome-a-nome está em docs/reference/screens/*.md (referência) e nos próprios registries (nosso). Diferenças intencionais: campos de marketing/licença omitidos; campos calculados exibidos no detalhe e não no formulário.

| ID | Tela | Nossa rota | Ref.: campos form | Ref.: filtros | Ref.: colunas | Nosso: campos (form/filtros) | Status |
|---|---|---|---|---|---|---|---|
| SCR-002 | Indicadores Financeiros | `/dashboards/financeiro` | 0 | 5 | 7 | — | UNIFICADO |
| SCR-003 | Indicadores Pecuária de Corte | `/dashboards/pecuaria` | 0 | 4 | 0 | — | TESTADO |
| SCR-004 | Funcionários | `/cadastros/people?is_employee=true` | 1 | 4 | 7 | 5 | MELHORADO |
| SCR-005 | Usuários | `/admin/usuarios` | 1 | 4 | 9 | — | TESTADO |
| SCR-006 | Documento Fiscal | `/estoque/documentos-fiscais` | 0 | 9 | 9 | — | TESTADO |
| SCR-007 | DFe Recebidas | `/estoque/dfe` | 2 | 9 | 12 | — | EM IMPLEMENTAÇÃO |
| SCR-008 | Formulação | `/estoque/formulacoes` | 1 | 4 | 5 | — | UNIFICADO |
| SCR-009 | Contas a Pagar | `/financeiro/contas-a-pagar` | 21 | 28 | 16 | — | TESTADO |
| SCR-010 | Conta a Receber | `/financeiro/contas-a-receber` | 25 | 19 | 16 | — | TESTADO |
| SCR-011 | Movimento Caixa/Bancário | `/financeiro/movimentos` | 1 | 13 | 13 | — | TESTADO |
| SCR-012 | Importar OFX | `/financeiro/ofx` | 0 | 4 | 6 | — | TESTADO |
| SCR-014 | NFe | `/fiscal` | 0 | 9 | 11 | 0 | NÃO INICIADO |
| SCR-015 | NFSe Recebidas | `/fiscal` | 0 | 8 | 10 | 0 | NÃO INICIADO |
| SCR-016 | Livro Caixa Digital | `/dashboards/livro-caixa` | 0 | 3 | 0 | — | UNIFICADO |
| SCR-017 | Indicadores Suprimentos | `/dashboards/suprimentos` | 0 | 4 | 0 | — | UNIFICADO |
| SCR-018 | Indicadores de Depreciações | `/dashboards/depreciacoes` | 0 | 3 | 0 | — | UNIFICADO |
| SCR-019 | Dashboard de Ativos | `/dashboards/ativos` | 0 | 5 | 0 | — | UNIFICADO |
| SCR-020 | Análise de Usuários | `/dashboards/usuarios` | 0 | 2 | 4 | — | UNIFICADO |
| SCR-021 | Pluviômetro | `/dashboards/pluviometria` | 0 | 4 | 0 | — | UNIFICADO |
| SCR-022 | Lotação de Currais | `/dashboards/confinamento` | 0 | 2 | 0 | — | UNIFICADO |
| SCR-023 | Custos do Confinamento | `/dashboards/confinamento-custos` | 0 | 4 | 0 | — | UNIFICADO |
| SCR-024 | Desempenho de Lotes | `/dashboards/confinamento-desempenho` | 0 | 3 | 11 | — | UNIFICADO |
| SCR-025 | Dashboard Estoque de Nutrição | `/dashboards/estoque-nutricao` | 0 | 1 | 0 | — | UNIFICADO |
| SCR-026 | Dashboard Consumo vs Fornecido | `/dashboards/consumo-racao` | 0 | 3 | 0 | — | UNIFICADO |
| SCR-027 | Centro de Custo | `/cadastros/cost_centers` | 0 | 0 | 6 | 1 | TESTADO |
| SCR-028 | Fazendas | `/cadastros/farms` | 0 | 7 | 6 | 1 | IMPLEMENTADO |
| SCR-029 | Safras | `/cadastros/harvests` | 0 | 0 | 5 | 1 | IMPLEMENTADO |
| SCR-030 | Endereçamentos | `/cadastros/addressings` | 0 | 0 | 3 | 0 | IMPLEMENTADO |
| SCR-031 | Produtos | `/cadastros/products` | 1 | 7 | 10 | 6 | TESTADO |
| SCR-032 | Armazém | `/cadastros/warehouses` | 0 | 0 | 5 | 3 | IMPLEMENTADO |
| SCR-033 | Saldo Inicial | `/estoque/estoque-inicial` | 1 | 3 | 8 | — | TESTADO |
| SCR-034 | Rateio - Categoria Financeira | `/cadastros/apportionment_categories` | 0 | 0 | 2 | 1 | IMPLEMENTADO |
| SCR-035 | Perfil Usuário | `/admin/perfis` | 0 | 0 | 5 | — | TESTADO |
| SCR-036 | Pessoas | `/cadastros/people` | 0 | 2 | 5 | 5 | IMPLEMENTADO |
| SCR-037 | Proprietários | `/cadastros/people?is_proprietary=true` | 1 | 0 | 6 | 5 | MELHORADO |
| SCR-038 | Fornecedores | `/cadastros/people?is_provider=true` | 1 | 6 | 7 | 5 | MELHORADO |
| SCR-039 | Clientes | `/cadastros/people?is_client=true` | 1 | 3 | 6 | 5 | MELHORADO |
| SCR-040 | Autorizadores | `/cadastros/authorizers` | 0 | 1 | 6 | 1 | TESTADO |
| SCR-041 | Contas Bancárias | `/cadastros/bank_accounts` | 0 | 0 | 10 | 2 | TESTADO |
| SCR-042 | Saldo Inicial | `/financeiro/saldo-inicial` | 0 | 4 | 11 | — | UNIFICADO |
| SCR-043 | Categoria Financeira | `/cadastros/financial_categories` | 0 | 6 | 10 | 2 | TESTADO |
| SCR-044 | Emissor NFe | `/fiscal` | 0 | 0 | 9 | 0 | NÃO INICIADO |
| SCR-045 | Sincronização DFe | `/fiscal` | 0 | 0 | 4 | 0 | NÃO INICIADO |
| SCR-046 | Sincronização NFS-e | `/fiscal` | 0 | 0 | 4 | 0 | NÃO INICIADO |
| SCR-047 | Regras Fiscais | `/cadastros/tax_rules` | 0 | 0 | 3 | 1 | IMPLEMENTADO |
| SCR-048 | Contadores | `/cadastros/people` | 0 | 0 | 5 | 5 | MAPEADO |
| SCR-049 | Natureza de Operaçao | `/cadastros/nature_operations` | 0 | 3 | 7 | 2 | IMPLEMENTADO |
| SCR-050 | Informações Complementares | `/cadastros/additional_infos` | 0 | 0 | 3 | 1 | IMPLEMENTADO |
| SCR-051 | Planos de Contas | `/cadastros/chart_accounts` | 1 | 4 | 5 | 1 | IMPLEMENTADO |
| SCR-052 | Operação | `/cadastros/operations` | 0 | 0 | 5 | 1 | IMPLEMENTADO |
| SCR-053 | Atividades | `/cadastros/activities` | 0 | 2 | 5 | 1 | IMPLEMENTADO |
| SCR-054 | Parâmetros de Peso | `/cadastros/weight_parameters` | 0 | 0 | 6 | 0 | IMPLEMENTADO |
| SCR-055 | Forragem | `/cadastros/fodders` | 0 | 0 | 3 | 1 | IMPLEMENTADO |
| SCR-056 | Animais | `/pecuaria/animais` | 1 | 4 | 8 | — | TESTADO |
| SCR-057 | Custo Retroativo | — | 11 | 1 | 4 | — | NÃO INICIADO |
| SCR-058 | Módulos de Pastejo | `/cadastros/grazing_modules` | 0 | 0 | 7 | 1 | IMPLEMENTADO |
| SCR-059 | Cochos | `/cadastros/troughs` | 0 | 1 | 9 | 2 | IMPLEMENTADO |
| SCR-060 | Lotes de Animais | `/cadastros/batches` | 1 | 1 | 5 | 3 | IMPLEMENTADO |
| SCR-061 | Lote/Módulo | `/pecuaria/transferencias/lote-modulo-area` | 0 | 2 | 6 | — | UNIFICADO |
| SCR-062 | Lote/Área | `/pecuaria/transferencias/lote-modulo-area` | 0 | 2 | 6 | — | UNIFICADO |
| SCR-063 | Inventário | `/cadastros/equipments` | 1 | 6 | 7 | 3 | TESTADO |
| SCR-064 | Depreciação Mensal | `/frota/depreciacoes` | 1 | 6 | 10 | — | TESTADO |
| SCR-065 | Previsão de Depreciação | `/frota/previsao-depreciacao` | 0 | 2 | 0 | — | TESTADO |
| SCR-066 | Fiscais | `/admin/parametros` | 2 | 0 | 0 | — | UNIFICADO |
| SCR-067 | SLA Status | `/suprimentos/sla` | 0 | 0 | 4 | — | UNIFICADO |
| SCR-068 | Meus Processos | `/suprimentos/mine` | 8 | 0 | 10 | — | TESTADO |
| SCR-069 | Solicitação | `/suprimentos/request` | 8 | 5 | 9 | — | TESTADO |
| SCR-070 | Rejeitados/Cancelados | `/suprimentos/rejected` | 0 | 4 | 9 | — | UNIFICADO |
| SCR-071 | Cotações | `/suprimentos/quotation` | 8 | 9 | 11 | — | TESTADO |
| SCR-072 | Autorização | `/suprimentos/authorization` | 8 | 5 | 9 | — | TESTADO |
| SCR-073 | Compras | `/suprimentos/buy` | 8 | 9 | 10 | — | TESTADO |
| SCR-074 | Recebimentos | `/suprimentos/receipts` | 8 | 8 | 13 | — | TESTADO |
| SCR-075 | Entrada/Insumos | `/estoque/entradas` | 0 | 4 | 7 | — | TESTADO |
| SCR-076 | Aprovação de Notas Fiscais | `/estoque/aprovacao-notas` | 0 | 1 | 6 | — | UNIFICADO |
| SCR-077 | Perfis de Lançamento por Fornecedor | `/cadastros/provider_launch_profiles` | 0 | 2 | 5 | 0 | IMPLEMENTADO |
| SCR-078 | Baixa de Estoque | `/estoque/baixas` | 0 | 2 | 5 | — | UNIFICADO |
| SCR-079 | Requisição do Estoque | `/estoque/requisicoes` | 2 | 6 | 7 | — | TESTADO |
| SCR-080 | Devolução do Estoque | `/estoque/devolucoes` | 2 | 6 | 6 | — | TESTADO |
| SCR-081 | Correção de Estoque | `/estoque/correcoes` | 1 | 2 | 4 | — | UNIFICADO |
| SCR-082 | Transferência de Armazém | `/estoque/transferencias?kind=warehouse` | 0 | 5 | 9 | — | TESTADO |
| SCR-083 | Transferência de Armazém entre Fazendas | `/estoque/transferencias?kind=farm` | 0 | 5 | 11 | — | TESTADO |
| SCR-084 | Saldo Estoque | `/estoque/saldo` | 0 | 3 | 9 | — | TESTADO |
| SCR-085 | Batida | `/estoque/batidas` | 1 | 4 | 9 | — | UNIFICADO |
| SCR-086 | Eventos | `/cadastros/hr_events` | 0 | 3 | 6 | 1 | IMPLEMENTADO |
| SCR-087 | Funções | `/cadastros/job_functions` | 0 | 1 | 3 | 1 | IMPLEMENTADO |
| SCR-088 | Equipes | `/cadastros/teams` | 0 | 0 | 4 | 1 | IMPLEMENTADO |
| SCR-089 | Registro/Faltas | `/cadastros/absences` | 0 | 0 | 4 | 2 | TESTADO |
| SCR-090 | Adiant. Salarial | `/gestao-pessoal/adiantamentos` | 0 | 0 | 4 | — | TESTADO |
| SCR-091 | Registro/Eventos | `/cadastros/bonuses` | 0 | 0 | 5 | 2 | IMPLEMENTADO |
| SCR-092 | Funcionário x Eventos | `/cadastros/employee_events` | 1 | 0 | 4 | 3 | IMPLEMENTADO |
| SCR-093 | Apuração Mensal | `/gestao-pessoal/apuracao` | 1 | 6 | 7 | — | TESTADO |
| SCR-094 | Tipos de Documento | `/cadastros/document_types` | 0 | 0 | 5 | 1 | IMPLEMENTADO |
| SCR-095 | Gestão de Documentos | `/cadastros/documents` | 0 | 3 | 5 | 4 | IMPLEMENTADO |
| SCR-096 | Gestão Animais | `/pecuaria/animais` | 1 | 8 | 8 | — | TESTADO |
| SCR-097 | Inventariado Animais | — | 1 | 0 | 6 | — | NÃO INICIADO |
| SCR-098 | Planejamento Pecuário | `/cadastros/livestock_plannings` | 0 | 0 | 7 | 1 | IMPLEMENTADO |
| SCR-099 | Evolução de Rebanho | `/pecuaria/transferencias/evolucao` | 0 | 3 | 5 | — | UNIFICADO |
| SCR-100 | Agrupar Lotes | `/pecuaria/transferencias/agrupar-lotes` | 6 | 1 | 4 | — | UNIFICADO |
| SCR-101 | Venda de Animais | `/pecuaria/movimentacoes/sale` | 0 | 5 | 10 | — | TESTADO |
| SCR-102 | Compra de Animais | `/pecuaria/movimentacoes/purchase` | 0 | 4 | 9 | — | TESTADO |
| SCR-103 | Nascimentos | `/pecuaria/movimentacoes/birth` | 1 | 4 | 8 | — | UNIFICADO |
| SCR-104 | Mortes | `/pecuaria/movimentacoes/death` | 0 | 4 | 5 | — | UNIFICADO |
| SCR-105 | Perdas | `/pecuaria/movimentacoes/loss` | 0 | 4 | 6 | — | UNIFICADO |
| SCR-106 | Processamentos | `/pecuaria/processamentos` | 0 | 4 | 8 | — | TESTADO |
| SCR-107 | Pré-Lotes | `/pecuaria/processamentos` | 0 | 0 | 7 | — | MAPEADO |
| SCR-108 | Pesagens | `/pecuaria/pesagens` | 1 | 3 | 10 | — | TESTADO |
| SCR-109 | Nutrição | `/pecuaria/manejo/nutrition` | 1 | 4 | 8 | — | UNIFICADO |
| SCR-110 | Sanitários | `/pecuaria/manejo/sanitary` | 0 | 2 | 4 | — | TESTADO |
| SCR-111 | Desmama | `/pecuaria/manejo/weaning` | 0 | 1 | 4 | — | UNIFICADO |
| SCR-112 | Apartações | `/pecuaria/manejo/separation` | 0 | 1 | 7 | — | UNIFICADO |
| SCR-113 | Localizar Animal | `/pecuaria/localizar` | 0 | 1 | 0 | — | UNIFICADO |
| SCR-114 | Pastagem | `/pecuaria/manejo/pasture` | 0 | 3 | 7 | — | UNIFICADO |
| SCR-115 | Gerenciamento Reprodutivo Avançado | `/pecuaria/reproducao` | 0 | 6 | 6 | 0 | IMPLEMENTADO |
| SCR-116 | Estações de Monta | `/cadastros/breeding_seasons` | 0 | 1 | 7 | 2 | IMPLEMENTADO |
| SCR-117 | Lotes/Reprodução | `/pecuaria/reproducao/acasalamentos` | 0 | 2 | 5 | — | MAPEADO |
| SCR-118 | Touros/Sêmen/Embrião | `/cadastros/breeding_sires` | 0 | 2 | 5 | 2 | IMPLEMENTADO |
| SCR-119 | Protocolos/Estação | `/cadastros/breeding_protocols` | 0 | 2 | 6 | 1 | IMPLEMENTADO |
| SCR-120 | Acasalamento | `/pecuaria/reproducao/acasalamentos` | 0 | 2 | 7 | — | UNIFICADO |
| SCR-121 | Pátio | `/cadastros/feedlot_yards` | 0 | 3 | 6 | 2 | IMPLEMENTADO |
| SCR-122 | Setores | `/cadastros/feedlot_sectors` | 0 | 4 | 7 | 2 | IMPLEMENTADO |
| SCR-123 | Curral | `/cadastros/feedlot_corrals` | 0 | 5 | 11 | 2 | IMPLEMENTADO |
| SCR-124 | Dietas | `/cadastros/diets` | 1 | 3 | 7 | 1 | IMPLEMENTADO |
| SCR-125 | Fases/Regras de Troca | `/cadastros/feeding_phases` | 0 | 3 | 6 | 1 | IMPLEMENTADO |
| SCR-126 | Batelada | `/confinamento/bateladas` | 0 | 3 | 6 | — | UNIFICADO |
| SCR-127 | Trato Diário | `/confinamento/trato` | 0 | 2 | 7 | — | UNIFICADO |
| SCR-128 | Leitura de Cocho | `/confinamento/leitura-cocho` | 0 | 2 | 4 | — | UNIFICADO |
| SCR-130 | Pluviometria | `/cadastros/rainfalls` | 1 | 2 | 5 | 2 | IMPLEMENTADO |
| SCR-131 | Orçamentos | `/vendas/budgets` | 0 | 6 | 7 | — | TESTADO |
| SCR-132 | Pedidos | `/vendas/orders` | 0 | 6 | 7 | — | TESTADO |
| SCR-133 | Vendas | `/vendas/sales` | 0 | 6 | 9 | — | TESTADO |
| SCR-134 | Minhas Ordens de Serviço | `/os?mine=1` | 0 | 4 | 7 | 0 | UNIFICADO |
| SCR-135 | Ordem de Serviço | `/os` | 0 | 4 | 7 | 0 | IMPLEMENTADO |
| SCR-136 | Monitoramento de Ordens de Serviço | `/os/monitoramento` | 0 | 4 | 7 | — | UNIFICADO |
| SCR-137 | Avaliação de Ordens de Serviço | `/os` | 0 | 4 | 7 | 0 | MELHORADO |
| SCR-138 | Análise do Fluxo Bancário | `/financeiro/fluxo` | 0 | 5 | 0 | — | TESTADO |
| SCR-139 | Gestão Contratos | `/cadastros/contracts` | 0 | 2 | 5 | 2 | IMPLEMENTADO |
| SCR-140 | Previsão Orçamentária Anual | `/financeiro/previsao-orcamentaria` | 2 | 0 | 5 | — | UNIFICADO |
| SCR-141 | Congelamento Financeiro | `/cadastros/financial_freezes` | 0 | 2 | 8 | 0 | TESTADO |
| SCR-142 | Planilha de Movimentos | — | 1 | 2 | 4 | — | NÃO INICIADO |
| SCR-143 | Manutenções | `/frota/manutencoes` | 0 | 3 | 5 | — | UNIFICADO |
| SCR-144 | Abastecimentos | `/frota/abastecimentos` | 1 | 3 | 5 | — | TESTADO |
| SCR-145 | Manutenções Preventivas | `/cadastros/preventive_maintenances` | 0 | 3 | 5 | 2 | IMPLEMENTADO |
| SCR-146 | Revisões Agendadas | `/cadastros/scheduled_reviews` | 0 | 0 | 4 | 2 | IMPLEMENTADO |
| SCR-147 | Transferência de Máquinas | `/frota/transferencias` | 0 | 2 | 7 | — | UNIFICADO |
| SCR-148 | Arquivos XML | `/estoque/documentos-fiscais/new` | 0 | 6 | 0 | 18 | IMPLEMENTADO |
| SCR-149 | MDFe | `/fiscal` | 0 | 11 | 10 | 0 | NÃO INICIADO |
| SCR-150 | MDFe | `/fiscal/new` | 63 | 0 | 35 | — | NÃO INICIADO |
| SCR-151 | LCDPR - Livro Caixa Digital do Produtor Rural | `/dashboards/livro-caixa` | 0 | 0 | 4 | — | EM IMPLEMENTAÇÃO |
| SCR-152 | SPED Fiscal - EFD ICMS/IPI | `/fiscal` | 0 | 0 | 5 | 0 | NÃO INICIADO |
| SCR-153 | Partida Dobrada | `/fiscal/partida-dobrada` | 0 | 6 | 7 | — | UNIFICADO |
| SCR-154 | Relatório Inventário Patrimonial | `/relatorios/equipment` | 0 | 5 | 0 | — | IMPLEMENTADO |
| SCR-155 | Relatorio de Depreciação Acumulada | `/relatorios/accumulated_depreciation` | 0 | 4 | 0 | — | IMPLEMENTADO |
| SCR-156 | Composição Rebanho | `/relatorios/herd_composition` | 0 | 14 | 0 | — | IMPLEMENTADO |
| SCR-157 | Custeio/Área Pecuária | `/relatorios/costing_livestock_area` | 0 | 5 | 0 | — | IMPLEMENTADO |
| SCR-158 | Relatório Pesagem/Animal | `/relatorios/weighing_animal` | 0 | 6 | 0 | — | IMPLEMENTADO |
| SCR-159 | Relatório Pesagem/Lote | `/relatorios/weighing_batch` | 0 | 6 | 0 | — | IMPLEMENTADO |
| SCR-160 | Relatório de Pesagem do Confinamento | `/relatorios/feedlot_weighing` | 0 | 5 | 0 | — | IMPLEMENTADO |
| SCR-161 | Relatório Nutrição: Consumo / Lote | `/relatorios/nutrition_batch` | 0 | 5 | 0 | — | IMPLEMENTADO |
| SCR-162 | Relatório Sanitário/lote | `/relatorios/sanitary_batch` | 0 | 8 | 0 | — | IMPLEMENTADO |
| SCR-163 | Relatório Manejo/lote | `/relatorios/management_batch` | 0 | 4 | 0 | — | IMPLEMENTADO |
| SCR-164 | Relatório Animais/Categoria | `/relatorios/category_animal` | 0 | 5 | 0 | — | IMPLEMENTADO |
| SCR-165 | Transferência Lote/Módulo/Área | `/relatorios/transfer_batch_area` | 0 | 3 | 0 | — | IMPLEMENTADO |
| SCR-166 | Estoque de Rebanho | `/relatorios/animals` | 0 | 3 | 0 | — | IMPLEMENTADO |
| SCR-167 | Relatório Aplicação/Manejo da Pecuária | `/relatorios/application_management` | 0 | 4 | 0 | — | IMPLEMENTADO |
| SCR-168 | Relatório de Movimentação de Rebanho | `/relatorios/animal_movements` | 0 | 3 | 0 | — | IMPLEMENTADO |
| SCR-169 | Relatório Desmama | `/relatorios/weaning` | 0 | 3 | 0 | 0 | IMPLEMENTADO |
| SCR-170 | Relatório Nascimentos | `/relatorios/birth` | 0 | 4 | 0 | 0 | IMPLEMENTADO |
| SCR-171 | Relatório Mortes | `/relatorios/death` | 0 | 3 | 0 | 0 | IMPLEMENTADO |
| SCR-172 | Relatório Ficha Animal | `/relatorios/animal_record` | 0 | 3 | 0 | — | IMPLEMENTADO |
| SCR-173 | Relatório Vacas Prenhas | `/relatorios/pregnant_cows` | 0 | 7 | 0 | — | IMPLEMENTADO |
| SCR-174 | Relatório Vendas de Animais | `/relatorios/animal_sales` | 0 | 6 | 0 | — | IMPLEMENTADO |
| SCR-175 | Relatório Compras de Animais | `/relatorios/animal_purchases` | 0 | 5 | 0 | — | IMPLEMENTADO |
| SCR-176 | Relatório Evolução de Rebanho | `/relatorios/herd_evolution` | 0 | 3 | 0 | — | IMPLEMENTADO |
| SCR-177 | Relatório Identificação/SISBOV | `/relatorios/sisbov_identification` | 0 | 4 | 0 | — | IMPLEMENTADO |
| SCR-178 | Relatório Mortes/SISBOV | `/relatorios/sisbov_death` | 0 | 2 | 0 | — | IMPLEMENTADO |
| SCR-179 | Relatório Nascimentos/SISBOV | `/relatorios/sisbov_birth` | 0 | 2 | 0 | — | IMPLEMENTADO |
| SCR-180 | Relatório Custo/Lote | `/relatorios/costing_batch` | 0 | 5 | 0 | — | IMPLEMENTADO |
| SCR-181 | Relatório Custo/Módulo | `/relatorios/costing_module` | 0 | 4 | 0 | — | IMPLEMENTADO |
| SCR-182 | Relatório Custo/Animal | `/relatorios/costing_animal` | 0 | 4 | 0 | — | IMPLEMENTADO |
| SCR-183 | Relatório Custo Total de Reprodução | `/relatorios/reproduction_cost` | 0 | 3 | 0 | — | IMPLEMENTADO |
| SCR-184 | Relatório de Performance Animal Individual | `/relatorios/batch_profitability` | 0 | 5 | 0 | — | IMPLEMENTADO |
| SCR-185 | Relatório Histórico Reprodutivo das Matrizes | `/relatorios/reproductive_history` | 0 | 5 | 0 | — | IMPLEMENTADO |
| SCR-186 | Registro Genealógico | `/relatorios/family_tree` | 0 | 1 | 0 | — | IMPLEMENTADO |
| SCR-187 | Relatório de Eficiência de Reprodução de Touros | `/relatorios/bull_efficiency` | 0 | 4 | 0 | — | IMPLEMENTADO |
| SCR-188 | Relatório de Análise de Movimentação Lote | `/relatorios/batch_movement_analysis` | 0 | 4 | 0 | — | IMPLEMENTADO |
| SCR-189 | Relatório de Produtividade De Receptora | `/relatorios/receiver_productivity` | 0 | 4 | 0 | — | IMPLEMENTADO |
| SCR-190 | Relatório de Animais por Lote com Visualização Detalhada ou Geral | `/relatorios/animals_per_batch` | 0 | 3 | 0 | — | IMPLEMENTADO |
| SCR-191 | Relatório Histórico de Animais/Lote | `/relatorios/animal_batch_history` | 0 | 6 | 0 | — | IMPLEMENTADO |
| SCR-192 | Relatório Controle de Lotes Ativos no Confinamento | `/relatorios/feedlot_batch_control` | 0 | 6 | 0 | — | IMPLEMENTADO |
| SCR-193 | Relatório de Cosnumo/Planejado | `/relatorios/feedlot_planned_consumption` | 0 | 6 | 0 | — | IMPLEMENTADO |
| SCR-194 | Relatório Operacional Diário com Resumo das Atividades do Confinamento | `/relatorios/feedlot_activity` | 0 | 4 | 0 | — | IMPLEMENTADO |
| SCR-195 | Relatório de Pluviometria | `/relatorios/rainfall` | 0 | 4 | 0 | — | IMPLEMENTADO |
| SCR-196 | Agenda de Recebimentos | `/relatorios/receipt_schedule` | 0 | 8 | 0 | — | IMPLEMENTADO |
| SCR-197 | Contas a Pagar | `/relatorios/payables` | 0 | 15 | 0 | — | IMPLEMENTADO |
| SCR-198 | Contas Pagas | `/relatorios/paid` | 0 | 16 | 0 | — | TESTADO |
| SCR-199 | Contas a Receber | `/relatorios/receivables` | 0 | 14 | 0 | — | IMPLEMENTADO |
| SCR-200 | Contas Recebidas | `/relatorios/received` | 0 | 14 | 0 | — | IMPLEMENTADO |
| SCR-201 | Relatório de Juros Recebidos | `/relatorios/received_interest` | 0 | 6 | 0 | — | IMPLEMENTADO |
| SCR-202 | Relatório de Juros Pagos | `/relatorios/paid_interest` | 0 | 6 | 0 | — | IMPLEMENTADO |
| SCR-203 | Extrato Financeiro | `/relatorios/bank_statement` | 0 | 9 | 0 | — | TESTADO |
| SCR-204 | Razão Contábil | `/relatorios/ledger` | 0 | 9 | 0 | — | IMPLEMENTADO |
| SCR-205 | Razão Categoria | `/relatorios/ledger_category` | 0 | 9 | 0 | — | IMPLEMENTADO |
| SCR-206 | Recebimento Previsto X Realizado | `/relatorios/rec_prev_real` | 0 | 9 | 0 | — | IMPLEMENTADO |
| SCR-207 | Pagamento Previsto X Realizado | `/relatorios/pag_prev_real` | 0 | 9 | 0 | — | IMPLEMENTADO |
| SCR-208 | Previsto x Realizado Anual | `/relatorios/budget_predicted` | 0 | 3 | 0 | — | IMPLEMENTADO |
| SCR-209 | Acesse mais e melhor crédito! | `/relatorios/cash_flow_category` | 0 | 11 | 0 | — | IMPLEMENTADO |
| SCR-210 | Acesse mais e melhor crédito! | `/relatorios/cash_flow_forecast` | 0 | 8 | 0 | — | IMPLEMENTADO |
| SCR-211 | Movimentação Bancária/Financeira | `/relatorios/financial_movement` | 0 | 10 | 0 | — | IMPLEMENTADO |
| SCR-212 | Fiscal/Não Fiscal | `/relatorios/fiscal_difference` | 0 | 9 | 0 | — | IMPLEMENTADO |
| SCR-213 | Custo de Produção por Período | `/relatorios/income_statement` | 0 | 12 | 0 | — | IMPLEMENTADO |
| SCR-214 | Custo de Produção por Mês | `/relatorios/accumulated_income_statement` | 0 | 12 | 0 | — | IMPLEMENTADO |
| SCR-215 | Acesse mais e melhor crédito! | `/relatorios/dre` | 0 | 6 | 0 | — | IMPLEMENTADO |
| SCR-216 | Acesse mais e melhor crédito! | `/relatorios/dre_annual` | 0 | 6 | 0 | — | IMPLEMENTADO |
| SCR-217 | Acesse mais e melhor crédito! | `/relatorios/receipt_cashflow` | 0 | 8 | 0 | — | IMPLEMENTADO |
| SCR-218 | Relatório de Estoque/Financeiro | `/relatorios/cashflow_product` | 0 | 3 | 0 | — | IMPLEMENTADO |
| SCR-219 | Acesse mais e melhor crédito! | `/relatorios/cost_center` | 0 | 8 | 0 | — | IMPLEMENTADO |
| SCR-220 | Relatório de Apuração de Custos por Conta e Centro de Custo | `/relatorios/cost_calculation` | 0 | 7 | 0 | — | IMPLEMENTADO |
| SCR-221 | Relatório Financiamentos | `/relatorios/financings` | 0 | 3 | 0 | — | IMPLEMENTADO |
| SCR-222 | Títulos de Adiantamento | `/relatorios/advance_titles` | 0 | 10 | 0 | — | IMPLEMENTADO |
| SCR-223 | Relatório de Conciliação de Contas Consolidadas | `/relatorios/account_reconciliation` | 0 | 8 | 0 | — | IMPLEMENTADO |
| SCR-224 | Acesse mais e melhor crédito! | `/relatorios/cost_centers_unified` | 0 | 5 | 0 | — | IMPLEMENTADO |
| SCR-225 | Relatório de Contas Tributárias e Não Tributárias | `/relatorios/tax_accounts` | 0 | 6 | 0 | — | EM IMPLEMENTAÇÃO |
| SCR-226 | Relatório Consolidado de Contas a Pagar e Receber | `/relatorios/payable_receivable` | 0 | 11 | 0 | — | IMPLEMENTADO |
| SCR-227 | Relatório de Saldo Devedor/Fornecedor | `/relatorios/provider_balance` | 0 | 6 | 0 | — | IMPLEMENTADO |
| SCR-228 | Relatório Movimentação Estoque | `/relatorios/stock_movement` | 0 | 5 | 0 | — | IMPLEMENTADO |
| SCR-229 | Relatório de Requisição/Saída | `/relatorios/requisitions` | 0 | 5 | 0 | — | IMPLEMENTADO |
| SCR-230 | Relatório Baixa Estoque | `/relatorios/stock_writeoffs` | 0 | 4 | 0 | — | IMPLEMENTADO |
| SCR-231 | Relatório DFe | `/relatorios/dfe` | 0 | 7 | 0 | — | IMPLEMENTADO |
| SCR-232 | Relatório Custo Produção Batida | `/relatorios/feed_batch_cost` | 0 | 3 | 0 | — | IMPLEMENTADO |
| SCR-233 | Relatório de Curva ABC | `/relatorios/stocks_abc` | 0 | 3 | 0 | — | IMPLEMENTADO |
| SCR-234 | Relatório Recebimentos | `/relatorios/receipts` | 0 | 6 | 0 | 0 | IMPLEMENTADO |
| SCR-235 | Relatório Estoque Consolidado | `/relatorios/stocks_consolidated` | 0 | 8 | 0 | — | TESTADO |
| SCR-236 | Relatório de Lote/Fornecedor | `/relatorios/stocks_lot_provider` | 0 | 4 | 0 | — | IMPLEMENTADO |
| SCR-237 | Saída de Produtos x Centro de Custo | `/relatorios/exits_cost_center` | 0 | 6 | 0 | — | IMPLEMENTADO |
| SCR-238 | Relatório de Suprimentos | `/relatorios/supplies` | 0 | 9 | 0 | — | IMPLEMENTADO |
| SCR-239 | Relatório Savings | `/relatorios/savings` | 0 | 6 | 0 | — | IMPLEMENTADO |
| SCR-240 | Relatório ANS | `/relatorios/ans` | 0 | 3 | 0 | — | IMPLEMENTADO |
| SCR-241 | Relatório de Orçamentos/Fornecedores | `/relatorios/quotations` | 0 | 5 | 0 | — | IMPLEMENTADO |
| SCR-242 | Relatório Produtos x Previsão de entrega | `/relatorios/purchase_forecast` | 0 | 11 | 0 | — | IMPLEMENTADO |
| SCR-243 | Relatório de Status de SLA | `/relatorios/supply_sla` | 0 | 3 | 0 | — | IMPLEMENTADO |
| SCR-244 | Relatório Gerencial de Solicitações | `/relatorios/purchase_management` | 0 | 6 | 0 | — | IMPLEMENTADO |
| SCR-245 | Relatório de Vendas/Cliente | `/relatorios/sales_client` | 0 | 5 | 0 | — | IMPLEMENTADO |
| SCR-246 | Relatório de Vendas/Produto | `/relatorios/sales_product` | 0 | 4 | 0 | — | IMPLEMENTADO |
| SCR-247 | Relatório de Vendas por Cliente/Produto | `/relatorios/sales_client_product` | 0 | 5 | 0 | — | IMPLEMENTADO |
| SCR-248 | Relatório Vendas/Funcionários | `/relatorios/sales_employee` | 0 | 4 | 0 | — | IMPLEMENTADO |
| SCR-249 | Relatório de Curva ABC | `/api/sales/abc` | 0 | 4 | 0 | — | EM IMPLEMENTAÇÃO |
| SCR-250 | Cálculo Mensal | `/relatorios/monthly_calculation` | 0 | 5 | 0 | — | IMPLEMENTADO |
| SCR-251 | Relatório de Aniversariantes | `/relatorios/birthdays` | 0 | 1 | 0 | — | IMPLEMENTADO |
| SCR-252 | Relatório de Horas Logadas | `/relatorios/logged_hours` | 0 | 4 | 0 | — | IMPLEMENTADO |
| SCR-253 | Relatório de Funcionários Ativos | `/relatorios/active_employees` | 0 | 4 | 0 | — | IMPLEMENTADO |
| SCR-254 | Relatório de Adiantamento Salarial | `/relatorios/advances` | 0 | 4 | 0 | — | IMPLEMENTADO |
| SCR-255 | Relatórios Lançamento Contábil | `/relatorios/journal_entries` | 0 | 5 | 0 | — | IMPLEMENTADO |
| SCR-256 | Relatório NF-e | `/relatorios/` | 0 | 9 | 0 | — | NÃO INICIADO |
| SCR-257 | Relatório de Faturamento | `/relatorios/nfe_product` | 0 | 7 | 0 | — | EM IMPLEMENTAÇÃO |
| SCR-258 | Relatório de Conferência do Livro Caixa | `/relatorios/cash_book` | 0 | 4 | 0 | — | IMPLEMENTADO |
| SCR-259 | Relatório Máquinas | `/relatorios/machines` | 7 | 0 | 0 | — | IMPLEMENTADO |
| SCR-260 | Relatório Máquinas - Abastecimentos | `/relatorios/machine_supplies` | 0 | 7 | 0 | — | IMPLEMENTADO |
| SCR-261 | Relatório Máquinas - Manutenções | `/relatorios/machine_maintenances` | 0 | 7 | 0 | — | IMPLEMENTADO |
| SCR-262 | Integração Domínio | `/integracoes/exportacoes` | 0 | 0 | 4 | — | NÃO INICIADO |
| SCR-263 | Integração CTA Smart | `/frota/abastecimentos` | 3 | 0 | 9 | — | NÃO INICIADO |
| SCR-264 | CTA Smart - Abastecimentos Importados | `/frota/abastecimentos` | 1 | 3 | 9 | — | NÃO INICIADO |
| SCR-265 | Exportar CSV - Contas Pagas/Recebidas | `/integracoes/exportacoes` | 0 | 2 | 0 | — | UNIFICADO |
| SCR-267 | Funcionários | `/cadastros/people/new?is_employee=true` | 23 | 0 | 0 | 29 | MELHORADO |
| SCR-269 | Funcionários | `/cadastros/people/[id]?is_employee=true` | 21 | 0 | 0 | 29 | MELHORADO |
| SCR-272 | Usuários | `/admin/usuarios/[id]` | 11 | 0 | 0 | — | TESTADO |
| SCR-273 | Documento Fiscal | `/estoque/documentos-fiscais/new` | 142 | 0 | 10 | 18 | TESTADO |
| SCR-274 | Consulte os documentos | `/estoque/dfe/new` | 0 | 0 | 4 | — | EM IMPLEMENTAÇÃO |
| SCR-275 | Formulação | `/estoque/formulacoes/new` | 12 | 0 | 0 | — | IMPLEMENTADO |
| SCR-276 | Contas a Pagar | `/financeiro/contas-a-pagar/new` | 75 | 11 | 8 | 0 | TESTADO |
| SCR-277 | Contas a Pagar | `/financeiro/contas-a-pagar/[id]` | 0 | 0 | 4 | 0 | TESTADO |
| SCR-278 | Contas a Pagar | `/financeiro/contas-a-pagar/[id]/edit` | 45 | 0 | 7 | 0 | TESTADO |
| SCR-279 | Conta a Receber | `/financeiro/contas-a-receber/new` | 44 | 11 | 7 | 0 | TESTADO |
| SCR-280 | Conta a Receber | `/financeiro/contas-a-receber/[id]` | 0 | 0 | 4 | 0 | TESTADO |
| SCR-281 | Conta a Receber | `/financeiro/contas-a-receber/[id]/edit` | 38 | 0 | 7 | 0 | TESTADO |
| SCR-282 | Movimento Caixa/Bancário | `/financeiro/movimentos/new` | 57 | 0 | 7 | 14 | TESTADO |
| SCR-283 | Movimento Caixa/Bancário | `/financeiro/movimentos/[id]` | 0 | 0 | 5 | 0 | TESTADO |
| SCR-284 | Movimento Caixa/Bancário | `/financeiro/movimentos/[id]` | 22 | 0 | 7 | 0 | TESTADO |
| SCR-285 | Importar OFX | `/financeiro/ofx/new` | 6 | 0 | 0 | — | TESTADO |
| SCR-287 | Importar OFX | `/financeiro/ofx/[id]` | 6 | 0 | 0 | 3 | TESTADO |
| SCR-288 | NFe | `/fiscal/new` | 140 | 52 | 9 | — | NÃO INICIADO |
| SCR-291 | Centro de Custo | `/cadastros/cost_centers/[id]` | 292 | 0 | 0 | 6 | TESTADO |
| SCR-292 | Fazenda | `/cadastros/farms/new` | 33 | 0 | 5 | 15 | IMPLEMENTADO |
| SCR-293 | Fazendas | `/cadastros/farms/[id]` | 0 | 0 | 4 | 15 | IMPLEMENTADO |
| SCR-294 | Fazenda | `/cadastros/farms/[id]` | 33 | 0 | 5 | 15 | IMPLEMENTADO |
| SCR-295 | Safras | `/cadastros/harvests/new` | 8 | 0 | 0 | 9 | IMPLEMENTADO |
| SCR-296 | Safras | `/cadastros/harvests/[id]` | 0 | 0 | 8 | 9 | IMPLEMENTADO |
| SCR-297 | Safras | `/cadastros/harvests/[id]` | 8 | 0 | 0 | 9 | IMPLEMENTADO |
| SCR-298 | Endereçamento - Setor | `/cadastros/addressings/new` | 2 | 0 | 0 | 2 | IMPLEMENTADO |
| SCR-300 | Endereçamento - Setor | `/cadastros/addressings/[id]` | 2 | 0 | 0 | 2 | IMPLEMENTADO |
| SCR-302 | Produtos | `/cadastros/products/new` | 66 | 0 | 0 | 32 | TESTADO |
| SCR-304 | Produtos | `/cadastros/products/[id]` | 66 | 0 | 0 | 32 | TESTADO |
| SCR-305 | Armazém | `/cadastros/warehouses/new` | 4 | 0 | 0 | 5 | IMPLEMENTADO |
| SCR-307 | Armazém | `/cadastros/warehouses/[id]` | 4 | 0 | 0 | 5 | IMPLEMENTADO |
| SCR-308 | Saldo Inicial | `/estoque/estoque-inicial/new` | 31 | 0 | 0 | — | TESTADO |
| SCR-310 | Saldo Inicial | `/estoque/estoque-inicial/[id]` | 11 | 0 | 0 | — | TESTADO |
| SCR-311 | Saldo Inicial | `/cadastros/apportionment_categories/new` | 11 | 0 | 0 | 2 | IMPLEMENTADO |
| SCR-312 | Perfil Usuário | `/admin/perfis/new` | 668 | 0 | 0 | — | TESTADO |
| SCR-314 | Perfil Usuário | `/admin/perfis/[id]` | 668 | 0 | 0 | 3 | TESTADO |
| SCR-315 | Inscrições Estaduais | `/cadastros/people/new` | 69 | 0 | 7 | 29 | IMPLEMENTADO |
| SCR-317 | Inscrições Estaduais | `/cadastros/people/[id]` | 67 | 0 | 7 | 29 | IMPLEMENTADO |
| SCR-319 | Inscrições Estaduais | `/cadastros/people/new?is_proprietary=true` | 10 | 0 | 5 | 29 | MELHORADO |
| SCR-321 | Inscrições Estaduais | `/cadastros/people/[id]?is_proprietary=true` | 12 | 0 | 5 | 29 | MELHORADO |
| SCR-323 | Fornecedores | `/cadastros/people/new?is_provider=true` | 33 | 0 | 0 | 29 | MELHORADO |
| SCR-325 | Fornecedores | `/cadastros/people/[id]?is_provider=true` | 33 | 0 | 0 | 29 | MELHORADO |
| SCR-327 | Inscrições Estaduais | `/cadastros/people/new?is_client=true` | 21 | 0 | 2 | 29 | MELHORADO |
| SCR-329 | Inscrições Estaduais | `/cadastros/people/[id]?is_client=true` | 21 | 0 | 2 | 29 | MELHORADO |
| SCR-330 | Regras de Autorização | `/cadastros/authorizers/new` | 13 | 0 | 3 | 8 | TESTADO |
| SCR-332 | Regras de Autorização | `/cadastros/authorizers/[id]` | 13 | 0 | 3 | 8 | TESTADO |
| SCR-333 | Conta Bancaria | `/cadastros/bank_accounts/new` | 16 | 0 | 0 | 15 | TESTADO |
| SCR-335 | Contas Bancárias | `/cadastros/bank_accounts/[id]` | 16 | 0 | 0 | 15 | TESTADO |
| SCR-336 | Saldo Inicial- Contas | `/financeiro/saldo-inicial/new` | 12 | 0 | 4 | — | IMPLEMENTADO |
| SCR-338 | Categoria Financeira | `/cadastros/financial_categories/[id]` | 8 | 0 | 0 | 8 | TESTADO |
| SCR-340 | Inscrições Estaduais | `/fiscal/[id]` | 26 | 0 | 5 | — | NÃO INICIADO |
| SCR-341 | Sincronização DFe | `/fiscal/new` | 2 | 0 | 0 | — | NÃO INICIADO |
| SCR-342 | Sincronização NFS-e | `/fiscal/new` | 2 | 0 | 0 | — | NÃO INICIADO |
| SCR-343 | Regras Fiscais | `/cadastros/tax_rules/new` | 37 | 0 | 0 | 20 | IMPLEMENTADO |
| SCR-344 | Novo Contador | `/cadastros/people/new` | 13 | 0 | 0 | 29 | MAPEADO |
| SCR-345 | Natureza de Operaçao | `/cadastros/nature_operations/new` | 47 | 0 | 0 | 16 | IMPLEMENTADO |
| SCR-346 | Natureza de Operação | `/cadastros/nature_operations/[id]` | 47 | 0 | 0 | 16 | IMPLEMENTADO |
| SCR-347 | Informações Complementares | `/cadastros/additional_infos/new` | 3 | 0 | 0 | 3 | IMPLEMENTADO |
| SCR-349 | Planos de Contas | `/cadastros/chart_accounts/new` | 7 | 0 | 0 | 7 | IMPLEMENTADO |
| SCR-351 | Planos de Contas | `/cadastros/chart_accounts/[id]` | 253 | 0 | 0 | 7 | IMPLEMENTADO |
| SCR-352 | Operação | `/cadastros/operations/new` | 6 | 0 | 0 | 6 | IMPLEMENTADO |
| SCR-354 | Operação | `/cadastros/operations/[id]` | 6 | 0 | 0 | 6 | IMPLEMENTADO |
| SCR-355 | Atividades | `/cadastros/activities/new` | 7 | 0 | 0 | 6 | IMPLEMENTADO |
| SCR-357 | Atividades | `/cadastros/activities/[id]` | 7 | 0 | 0 | 6 | IMPLEMENTADO |
| SCR-358 | Parâmetro de Peso | `/cadastros/weight_parameters/new` | 6 | 0 | 0 | 6 | IMPLEMENTADO |
| SCR-359 | Forragem | `/cadastros/fodders/new` | 2 | 0 | 0 | 2 | IMPLEMENTADO |
| SCR-361 | Forragem | `/cadastros/fodders/[id]` | 2 | 0 | 0 | 2 | IMPLEMENTADO |
| SCR-362 | Informações do Animal | `/pecuaria/animais/new` | 38 | 0 | 3 | 14 | TESTADO |
| SCR-363 | Tipos de Identificação | `/pecuaria/animais/[id]` | 0 | 0 | 2 | 0 | TESTADO |
| SCR-364 | Informações do Animal | `/pecuaria/animais/[id]` | 33 | 0 | 3 | 0 | TESTADO |
| SCR-365 | Módulo Pastejo | `/cadastros/grazing_modules/new` | 8 | 0 | 4 | 8 | IMPLEMENTADO |
| SCR-366 | Cochos | `/cadastros/troughs/new` | 8 | 0 | 0 | 8 | IMPLEMENTADO |
| SCR-367 | Cochos | `/cadastros/troughs/[id]` | 8 | 0 | 0 | 8 | IMPLEMENTADO |
| SCR-368 | Lote de Animais | `/cadastros/batches/new` | 8 | 0 | 0 | 16 | IMPLEMENTADO |
| SCR-369 | Lote/Módulo | `/pecuaria/transferencias/lote-modulo-area/new` | 9 | 0 | 0 | — | MELHORADO |
| SCR-370 | Lote/Área | `/pecuaria/transferencias/lote-modulo-area/new` | 10 | 0 | 0 | — | MELHORADO |
| SCR-371 | Inventário | `/cadastros/equipments/new` | 52 | 0 | 0 | 35 | TESTADO |
| SCR-372 | SLA Status | `/suprimentos/sla/[id]` | 1 | 0 | 0 | — | IMPLEMENTADO |
| SCR-373 | Solicitação | `/suprimentos/request/new` | 51 | 0 | 0 | — | TESTADO |
| SCR-374 | Nova Entrada / Insumos | `/estoque/entradas/new` | 45 | 0 | 0 | 8 | TESTADO |
| SCR-375 | Novo Perfil de Lançamento | `/cadastros/provider_launch_profiles/new` | 6 | 0 | 4 | 3 | IMPLEMENTADO |
| SCR-376 | Baixa de Estoque | `/estoque/baixas/new` | 16 | 0 | 7 | 7 | IMPLEMENTADO |
| SCR-377 | Requisição do Estoque | `/estoque/requisicoes/new` | 16 | 0 | 0 | 6 | TESTADO |
| SCR-378 | Devolução do Estoque | `/estoque/devolucoes/new` | 12 | 0 | 0 | 4 | TESTADO |
| SCR-379 | Transferência de Armazém | `/estoque/transferencias/new?kind=warehouse` | 14 | 0 | 8 | 10 | TESTADO |
| SCR-380 | Transferência de Armazém entre Fazendas | `/estoque/transferencias/new?kind=farm` | 30 | 0 | 18 | 10 | TESTADO |
| SCR-382 | Batida | `/estoque/batidas/new` | 14 | 0 | 0 | 7 | IMPLEMENTADO |
| SCR-383 | Eventos | `/cadastros/hr_events/new` | 7 | 0 | 0 | 7 | IMPLEMENTADO |
| SCR-385 | Eventos | `/cadastros/hr_events/[id]` | 7 | 0 | 0 | 7 | IMPLEMENTADO |
| SCR-386 | Funções | `/cadastros/job_functions/new` | 7 | 0 | 0 | 7 | IMPLEMENTADO |
| SCR-388 | Funções | `/cadastros/job_functions/[id]` | 7 | 0 | 0 | 7 | IMPLEMENTADO |
| SCR-390 | Equipes | `/cadastros/teams/new` | 7 | 0 | 4 | 4 | IMPLEMENTADO |
| SCR-391 | Registro/Faltas | `/cadastros/absences/new` | 5 | 0 | 0 | 5 | TESTADO |
| SCR-392 | Rateio do Adiantamento | `/gestao-pessoal/adiantamentos/new` | 24 | 0 | 9 | — | TESTADO |
| SCR-393 | Registro/Eventos | `/cadastros/bonuses/new` | 4 | 0 | 0 | 6 | IMPLEMENTADO |
| SCR-395 | Funcionário x Eventos | `/cadastros/employee_events/new` | 8 | 0 | 6 | 4 | IMPLEMENTADO |
| SCR-396 | Tipo de Documento | `/cadastros/document_types/new` | 4 | 0 | 0 | 4 | IMPLEMENTADO |
| SCR-398 | Tipo de Documento | `/cadastros/document_types/[id]` | 4 | 0 | 0 | 4 | IMPLEMENTADO |
| SCR-399 | Gestão de Documentos | `/cadastros/documents/new` | 8 | 0 | 0 | 7 | IMPLEMENTADO |
| SCR-400 | Informações do Animal | `/pecuaria/animais/new` | 38 | 0 | 3 | 14 | TESTADO |
| SCR-401 | Tipos de Identificação | `/pecuaria/animais/[id]` | 0 | 0 | 2 | 0 | TESTADO |
| SCR-402 | Informações do Animal | `/pecuaria/animais/[id]` | 33 | 0 | 3 | 0 | TESTADO |
| SCR-403 | Planejamento Pecuário | `/cadastros/livestock_plannings/new` | 14 | 0 | 0 | 6 | IMPLEMENTADO |
| SCR-404 | Venda de Animais | `/pecuaria/movimentacoes/sale/new` | 60 | 0 | 15 | — | TESTADO |
| SCR-405 | Compra de Animais | `/pecuaria/movimentacoes/purchase/new` | 56 | 0 | 9 | — | TESTADO |
| SCR-406 | Tipos de Identificação | `/pecuaria/movimentacoes/birth/new` | 32 | 0 | 3 | — | IMPLEMENTADO |
| SCR-407 | Mortes | `/pecuaria/movimentacoes/death/new` | 8 | 0 | 0 | — | IMPLEMENTADO |
| SCR-408 | Perdas | `/pecuaria/movimentacoes/loss/new` | 7 | 0 | 0 | — | IMPLEMENTADO |
| SCR-409 | Pré-Lote | `/pecuaria/processamentos/new` | 9 | 0 | 3 | — | MAPEADO |
| SCR-410 | Pesagem | `/pecuaria/pesagens/new` | 26 | 0 | 0 | 5 | TESTADO |
| SCR-411 | Pesagem | `/pecuaria/pesagens/[id]` | 0 | 0 | 6 | — | TESTADO |
| SCR-412 | Pesagem | `/pecuaria/pesagens/[id]` | 18 | 0 | 0 | — | TESTADO |
| SCR-413 | Nutrição | `/pecuaria/manejo/nutrition/new` | 21 | 0 | 3 | — | IMPLEMENTADO |
| SCR-414 | Sanitário | `/pecuaria/manejo/sanitary/new` | 21 | 0 | 0 | — | TESTADO |
| SCR-415 | Desmama | `/pecuaria/manejo/weaning/new` | 7 | 0 | 0 | — | IMPLEMENTADO |
| SCR-416 | Apartação | `/pecuaria/manejo/separation/new` | 4 | 0 | 0 | — | IMPLEMENTADO |
| SCR-417 | Pastagem | `/pecuaria/manejo/pasture/new` | 57 | 0 | 0 | — | IMPLEMENTADO |
| SCR-418 | Pastagem | `/pecuaria/manejo/pasture/[id]` | 0 | 0 | 43 | — | IMPLEMENTADO |
| SCR-419 | Pastagem | `/pecuaria/manejo/pasture/[id]` | 38 | 0 | 0 | — | IMPLEMENTADO |
| SCR-420 | Estação de Monta | `/cadastros/breeding_seasons/new` | 8 | 0 | 0 | 6 | IMPLEMENTADO |
| SCR-421 | Lotes | `/pecuaria/reproducao/acasalamentos/new` | 6 | 0 | 0 | — | MAPEADO |
| SCR-422 | Animais | `/cadastros/breeding_sires/new` | 11 | 0 | 0 | 6 | IMPLEMENTADO |
| SCR-423 | Produtos | `/cadastros/breeding_protocols/new` | 15 | 0 | 0 | 4 | IMPLEMENTADO |
| SCR-424 | Monta Natural | `/pecuaria/reproducao/acasalamentos/new` | 45 | 0 | 12 | — | IMPLEMENTADO |
| SCR-425 | Pátio | `/cadastros/feedlot_yards/new` | 7 | 0 | 0 | 4 | IMPLEMENTADO |
| SCR-426 | Setores | `/cadastros/feedlot_sectors/new` | 8 | 0 | 0 | 4 | IMPLEMENTADO |
| SCR-427 | Curral | `/cadastros/feedlot_corrals/new` | 38 | 0 | 0 | 6 | IMPLEMENTADO |
| SCR-428 | Dieta | `/cadastros/diets/new` | 18 | 0 | 7 | 6 | IMPLEMENTADO |
| SCR-429 | Fases/Regras de Troca | `/cadastros/feeding_phases/new` | 10 | 0 | 0 | 6 | IMPLEMENTADO |
| SCR-430 | Novo Batelada | `/confinamento/bateladas/new` | 6 | 0 | 0 | — | IMPLEMENTADO |
| SCR-431 | Fornecimento de Trato | `/confinamento/trato/new` | 2 | 0 | 0 | — | IMPLEMENTADO |
| SCR-432 | Nova Leitura de Cocho | `/confinamento/leitura-cocho/new` | 2 | 0 | 0 | — | IMPLEMENTADO |
| SCR-433 | Pluviometria | `/cadastros/rainfalls/new` | 4 | 0 | 0 | 4 | IMPLEMENTADO |
| SCR-434 | Orçamentos | `/vendas/budgets/new` | 67 | 0 | 3 | 16 | TESTADO |
| SCR-435 | Pedidos | `/vendas/orders/new` | 63 | 0 | 3 | 16 | TESTADO |
| SCR-436 | Vendas | `/vendas/sales/new` | 26 | 0 | 0 | 16 | TESTADO |
| SCR-437 | Identificação da OS | `/os/new` | 41 | 0 | 0 | 11 | IMPLEMENTADO |
| SCR-438 | Gestão de Contrato | `/cadastros/contracts/new` | 13 | 0 | 0 | 12 | IMPLEMENTADO |
| SCR-439 | Categorias | `/financeiro/previsao-orcamentaria/new` | 2956 | 0 | 15 | — | IMPLEMENTADO |
| SCR-440 | Congelamento Financeiro | `/cadastros/financial_freezes/new` | 4 | 0 | 0 | 4 | TESTADO |
| SCR-441 | Manutenções | `/frota/manutencoes/new` | 23 | 0 | 0 | 12 | IMPLEMENTADO |
| SCR-442 | Abastecimentos | `/frota/abastecimentos/new` | 18 | 0 | 0 | 14 | TESTADO |
| SCR-443 | Manutenções Preventivas | `/cadastros/preventive_maintenances/new` | 8 | 0 | 0 | 7 | IMPLEMENTADO |
| SCR-444 | Transferência de Máquinas | `/frota/transferencias/new` | 8 | 0 | 0 | — | IMPLEMENTADO |
| SCR-445 | LCDPR - Livro Caixa Digital do Produtor Rural | `/dashboards/livro-caixa/new` | 8 | 0 | 0 | — | EM IMPLEMENTAÇÃO |
| SCR-446 | SPED Fiscal - EFD ICMS/IPI | `/fiscal/new` | 4 | 0 | 0 | — | NÃO INICIADO |
| SCR-447 | Partida Dobrada | `/fiscal/partida-dobrada/new` | 11 | 0 | 0 | — | IMPLEMENTADO |
| SCR-448 | Integração Domínio | `/integracoes/exportacoes/new` | 4 | 0 | 0 | — | NÃO INICIADO |
| SCR-451 | Informação do Pedido | `/suprimentos/request/[id]` | 0 | 0 | 8 | — | TESTADO |
| SCR-452 | Informação do Pedido | `/suprimentos/request/[id]` | 0 | 0 | 10 | — | TESTADO |
| SCR-453 | Informação do Pedido | `/suprimentos/request/[id]` | 0 | 0 | 5 | — | TESTADO |
| SCR-454 | Informação do Pedido | `/suprimentos/authorization/[id]` | 4 | 0 | 4 | — | TESTADO |
| SCR-455 | Movimento Caixa/Bancário | `/financeiro/movimentos/[id]` | 0 | 0 | 5 | 0 | TESTADO |
