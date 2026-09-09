# Árvore de Navegação do Sistema de Referência

Estrutura REAL observada na sidebar (usuário com perfil administrativo), capturada em 09/09/2026.

```
Painel de Controle  -> /admin/home
Dashboards
  Financeiros  -> /admin/financial-dashboard
  Livro Caixa  -> /admin/cash-book-dashboard
  Suprimentos  -> /admin/supply-dashboard
  Pecuária de Corte  -> /admin/livestock-dashboard
  Depreciações  -> /admin/depreciation-dashboard
  Ativos  -> /admin/assets-dashboard
  Análise de Usuários  -> /admin/user-analysis-dashboard
  Pluviometria  -> /admin/rainfall-dashboard
  Lotação de Currais  -> /admin/feedlot-dashboard
  Custos do Confinamento  -> /admin/feedlot-cost-dashboard
  Desempenho de Lotes  -> /admin/feedlot-performance-dashboard
  Estoque Nutrição  -> /admin/nutrition-stock-dashboard
  Consumo de Ração  -> /admin/feed-consumption-dashboard
Cadastros Base
  Estrutura
    Centros de Custo  -> /admin/costcenters
    Fazendas  -> /admin/farms
    Safras  -> /admin/harvests
    Produtos
      Endereçamentos  -> /admin/addressings
      Produtos  -> /admin/products
      Armazéns  -> /admin/warehouses
      Estoques Iniciais  -> /admin/openingbalances
    Rateios
      Categorias  -> /admin/apportionments
  Pessoas
    Perfil Usuário  -> /admin/roles
    Pessoas Unificado  -> /admin/people
    Proprietários  -> /admin/proprietaries
    Funcionários  -> /admin/employees
    Fornecedores  -> /admin/providers
    Clientes  -> /admin/clients
    Usuários  -> /admin/users
    Autorizadores  -> /admin/authorizers
  Financeiros
    Contas Bancárias  -> /admin/accounts
    Saldo Inicial  -> /admin/open-movements
    Categorias Financeiras  -> /admin/financialcategories
  Fiscais
    Emissores NFe  -> /admin/issue
    Sinc. DFe  -> /admin/issue-dfe-sync-time
    Sinc. NFS-e  -> /admin/issue-nfse-sync-time
    Regras Fiscais  -> /admin/tax-rules
    Contador  -> /admin/contador
    Natureza Op.  -> /admin/natureoperations
    Info. Complementares  -> /admin/additional-info
    Plano de Contas  -> /admin/plan-accounts
  Agrícolas
    Operações  -> /admin/operations
    Atividades  -> /admin/activities
  Pecuários
    Parâmetros/Peso  -> /admin/parameter-weights
    Forragem  -> /admin/fodder
    Rebanho  -> /admin/animals
    Custo Retroativo  -> /admin/animal-retroactive-costs
    Módulo Pastejo  -> /admin/grazing
    Cochos  -> /admin/troughs
    Lotes Animais  -> /admin/batches
    Lote/Módulo  -> /admin/batch-grazing
    Lote/Área  -> /admin/batch-area
  Bens/Ativos
    Inventário  -> /admin/equipments
    Depreciação Mensal  -> /admin/depreciations
    Prev. Depreciação  -> /admin/depreciation-forecast
  Gerais
    Parametrizações  -> /admin/tenant-parameters
Administrativo
  Suprimentos
    Parâmetros SLA  -> /admin/supply-status
    Meus Processos  -> /admin/my-proccesses
    Solicitação  -> /admin/request-purchase
    Rejeitados/Cancelados  -> /admin/rejected-requests
    Cotações  -> /admin/request-quotation
    Autorização  -> /admin/request-authorization
    Compras  -> /admin/request-buy
    Recebimentos  -> /admin/request-receipts
  Estoque
    Doc. Fiscal/Entrada  -> /admin/invoices
    Entrada/Insumos  -> /admin/input-entries
    DFe Recebidas  -> /admin/dfe
    Aprovação de Notas  -> /admin/dfe-drafts
    Perfis de Lançamento  -> /admin/provider-launch-profiles
    Baixa de Estoque  -> /admin/stock-writeoffs
    Requisição/Saída  -> /admin/requisitions
    Devolução/Entrada  -> /admin/devolution
    Correção de Estoque  -> /admin/stock-corrections
    Trans. Armazém  -> /admin/warehouse-transfer
    Trans. Fazendas  -> /admin/warehouse-transfer-between-farms
    Saldo Estoque  -> /admin/stocks
    Fábrica
      Formulação  -> /admin/foods
      Batida  -> /admin/food-beats
  Gestão Pessoal
    Eventos  -> /admin/events
    Funções  -> /admin/functions
    Equipes  -> /admin/teams
    Registro/Faltas  -> /admin/absences
    Adiant. Salarial  -> /admin/advances
    Registro/Eventos  -> /admin/bonuses
    Funcionário X Eventos  -> /admin/employeeevents
    Apuração Mensal  -> /admin/earnings
  Gestão Documentos
    Tipo Documento  -> /admin/document-types
    Documentos  -> /admin/document-managements
Operacional
  Pecuária
    Gestão Animais  -> /admin/animals-management
    Inventariado  -> /admin/inventoried-animals
    Planejamento  -> /admin/planning-livestock
    Transferências
      Evolução/Rebanho  -> /admin/evolution-animals
      Animais/Lote  -> /admin/change-batch-animals
      Agrupar/Lotes  -> /admin/grouper-batches
      Lote/Módulo/Área  -> /admin/change-batch-module-areas
      Lote/Fazenda  -> /admin/change-batch-farms
      Animal/Fazenda  -> /admin/change-animal-farms
    Movimentações
      Vendas  -> /admin/movement-sales
      Compras  -> /admin/movement-purchases
      Nascimentos  -> /admin/birth-animals
      Mortes  -> /admin/death-animals
      Perdas  -> /admin/loss-animals
    Manejo
      Processamentos  -> /admin/processing
      Pré-Lotes  -> /admin/purchase-lots
      Pesagem  -> /admin/weighings
      Nutrição  -> /admin/nutritions
      Sanitário  -> /admin/sanitaries
      Desmama  -> /admin/weanings
      Apartação  -> /admin/separations
      Localiza Animal  -> /admin/locate-animals
      Pastagem  -> /admin/pastures
      Reprodução
        Gerenciamento Avançado  -> /admin/advanced-reproductive
        Estação de Monta  -> /admin/breeding-seasons
        Lotes/Reprodução  -> /admin/breeding-batch
        Touros/Sêmen/Embrião  -> /admin/bull-seed-season
        Protocolos/Estação  -> /admin/protocols-season
        Acasalamento  -> /admin/breeding-matings
    Confinamento
      Cadastros
        Pátios  -> /admin/feedlot-yards
        Setores  -> /admin/feedlot-sectors
        Currais  -> /admin/feedlot-corrals
      Nutrição
        Dieta  -> /admin/diets
        Fases/Regras Troca  -> /admin/feeding-phases
        Batelada  -> /admin/diet-beats
        Trato Diário  -> /admin/diet-beat-supplies
        Leitura de Cocho  -> /admin/trough-readings
      Mapa  -> /admin/feedlot-map
  Pluviometria  -> /admin/rainfalls
  Vendas
    Orçamentos  -> /admin/budgets
    Pedidos  -> /admin/orders
    Vendas  -> /admin/sales
  Ordens de Serviço
    Minhas OS  -> /admin/my-service-orders
    Lista de OS  -> /admin/service-orders
    Monitoramento  -> /admin/monitoring-service-orders
    Avaliações  -> /admin/rating-service-orders
Financeiro
  Contas a Pagar  -> /admin/expenses
  Contas a Receber  -> /admin/incomes
  Mov. Caixa/Bancário  -> /admin/movements
  Fluxo Bancário  -> /admin/cash-flow
  Conciliação
    Importação OFX  -> /admin/ofx-imports
    Meses Conciliados  -> /admin/ofx-report
  Gestão Contratos  -> /admin/contracts
  Prev. Orçamentária  -> /admin/budget-plannings
  Congelamentos Financeiros  -> /admin/financial-freezes
  Import. Mov. Bancários  -> /admin/movement-sheets
Gestão de Frota
  Manutenções  -> /admin/maintenances
  Abastecimentos  -> /admin/supplies
  Manutenções Preventivas  -> /admin/maintenance-preventives
  Revisões Agendadas  -> /admin/scheduled-reviews
  Transferência Máquinas  -> /admin/equipment-transfer
Gestão Fiscal
  NFe
    NFe Emitidas  -> /admin/nfe
    Aprovação de Notas  -> /admin/dfe-drafts
    Arquivos XML  -> /admin/xml
  MDFe
    Lista de MDFe  -> /admin/mdfe
    Nova MDFe  -> /admin/mdfe/create
  NFSe Recebidas  -> /admin/nfses
  LCDPR  -> /admin/cash-book
  SPED Fiscal  -> /admin/sped-fiscal
  Partida Dobrada  -> /admin/double-entry-accountings
Relatórios
  Bens/Ativo
    Inventário  -> /admin/equipment-report
    Depreciação Acumulada  -> /admin/accumulated-depreciation-report
  Pecuária
    Composição Rebanho  -> /admin/herd-composition-report
    Custeio/Área Pecuária  -> /admin/costing-livestock-area-report
    Pesagem/Animal  -> /admin/weighing-batch-report
    Pesagem/Lote  -> /admin/accumulated-weighing-batch-report
    Pesagem Confinamento  -> /admin/feedlot-weighing-performance-report
    Nutrição Consumo/Lote  -> /admin/nutrition-report
    Sanitário/Lote  -> /admin/sanitaries-batch-report
    Manejo/Lote  -> /admin/management-batch-report
    Estq. Animais/Categoria  -> /admin/category-animal-report
    Transf/Lote/Módulo/Área  -> /admin/report-transfer-batch-grazing-area
    Estoque/Rebanho  -> /admin/animals-report
    Aplicação/Manejo  -> /admin/application-management-report
    Movimentação/Rebanho  -> /admin/animal-movements-report
    Desmamas  -> /admin/weaning-report
    Nascimentos  -> /admin/birth-report
    Mortes  -> /admin/death-animals-report
    Ficha Animal  -> /admin/animal-record-report
    Vacas Prenhas  -> /admin/pregnant-cows-report
    Vendas/Animais  -> /admin/animals-sales/report
    Compras/Animais  -> /admin/animals-purchases/report
    Evolução/Rebanho  -> /admin/evolution-animals-report
    Identificação/SISBOV  -> /admin/identification-animals-sisbovs-report
    Mortes/SISBOV  -> /admin/death-animals-sisbovs-report
    Nascimentos/SISBOV  -> /admin/birth-animals-sisbovs-report
    Custeio/Lote  -> /admin/costing-batch-report
    Custeio/Módulo  -> /admin/costing-grazing-report
    Custeio/Animal  -> /admin/costing-animal-report
    Custo Total/Reprodução  -> /admin/total-cost-of-reproduction-report
    Performance Animal  -> /admin/batch-profitability-report
    Histórico Reprodutivo  -> /admin/reproductive-history-report
    Registro Genealógico  -> /admin/animal-family-tree-report
    Eficiencia Reprodutiva Touro  -> /admin/bull-reproductive-efficiency-report
    Análise Mov. Lote  -> /admin/animal-movement-analysis-report
    Prod. Receptora  -> /admin/receiver-cow-productivity-report
    Animais por Lote  -> /admin/animals-per-batch-report
    Histórico de Animais/Lote  -> /admin/animal-batch-history-report
    Lotes Confinamento  -> /admin/feedlot-batch-control-report
    Consumo/Planejado  -> /admin/feedlot-planned-consumption-report
    Atividades/Confinamento  -> /admin/feedlot-summary-activity-report
  Pluviometria  -> /admin/rainfall-report
  Financeiro
    Agenda/Pagamentos  -> /admin/payment-schedule-report
    Agenda/Recebimentos  -> /admin/receipt-schedule-report
    C. à Pagar  -> /admin/expenses-report
    C. Pagas  -> /admin/paid-expenses-report
    C. à Receber  -> /admin/incomes-report
    C. Recebidas  -> /admin/paid-incomes-report
    Juros Recebidos  -> /admin/received-interest-report
    Juros Pagos  -> /admin/paid-interest-report
    Extrato Fin.  -> /admin/bank-statement-report
    Livro Razão  -> /admin/ledger-report
    Razão Categoria  -> /admin/ledger-category-report
    Rec. Prev. X Real  -> /admin/rec-prev-real-report
    Pag. Prev. X Real  -> /admin/pag-prev-real-report
    Prev. x Reali. Anual  -> /admin/budget-planning-predicted-report
    Fluxo de Caixa Mensal  -> /admin/cash-flow-by-category-report
    Fluxo de Caixa Mensal Previsto  -> /admin/cash-flow-forecast-report
    Movimento Bancário  -> /admin/financial-movement-report
    Fiscal/Não Fiscal  -> /admin/fiscal-difference-report
    Custo de Produção  -> /admin/income-statement
    Custo de Produção Acumulado  -> /admin/accumulated-income-statement
    DRE  -> /admin/dre
    DRE Anual  -> /admin/dre-annual
    Fluxo Mensal de Pagamento  -> /admin/payment-cashflow-report
    Fluxo Mensal de Recebimento  -> /admin/receipt-cashflow-report
    Estoque Financeiro  -> /admin/cashflow-product-report
    Centro de Custo  -> /admin/cost-center-report
    Apuração de Custo  -> /admin/cost-calculation-report
    Financiamentos  -> /admin/financings-report
    Adiantamento  -> /admin/advance-titles-report
    Conciliação de Contas  -> /admin/account-reconciliation-report
    Centro de Custo/Unificado  -> /admin/cost-centers-unified-report
    Contas Tributárias  -> /admin/tax-accounts
    Consolidado Pagar/Receber  -> /admin/accounts-payable-receivable-report
    Saldo Devedor/Fornecedor  -> /admin/provider-balance-report
  Estoque
    Mov. Estoque  -> /admin/stock-movement-report
    Requisição/Saída  -> /admin/requisitions-report
    Baixas Estoque  -> /admin/stock-writeoffs-report
    DFe/Lançadas  -> /admin/dfe-report
    Custo Produção Batida  -> /admin/food-beat-report
    Curva ABC/Estoque  -> /admin/stocks-abc-report
    Recebimentos  -> /admin/receipts-report
    Estoque Consolidado  -> /admin/stocks-consolidated-report
    Lote/Fornecedor  -> /admin/stocks-lot-provider
    Saídas x Centro Custo  -> /admin/products-exit-cost-center-report
  Suprimentos
    Suprimentos  -> /admin/supplies-report
    Savings  -> /admin/savings-report
    ANS  -> /admin/ans-report
    Orçamentos  -> /admin/request-quotation-report
    Produtos x Prev. Entrega  -> /admin/request-purchase-forecast-report
    Relatório SLA  -> /admin/supply-status-report
    Gerencial de Solicitações  -> /admin/request-purchase-management-report
  Vendas
    Vendas/Cliente  -> /admin/sales-report
    Vendas/Produto  -> /admin/sales-product-report
    Cliente/Produto  -> /admin/sales-client-report
    Vendas/Funcionário  -> /admin/sales-employee-report
    Curva ABC  -> /admin/sales-abc-report
  Gestão Pessoal
    Apuração Mensal  -> /admin/monthly-calculation
    Aniversariantes  -> /admin/birthdays-report
    Horas Logadas  -> /admin/logged-hours-report
    Funcionários Ativos  -> /admin/active-employees
    Adiant. Salarial  -> /admin/advances/report
  Gestão Fiscal
    Partida Dobrada  -> /admin/double-entry-accounting-report
    NFe/Emitidas  -> /admin/nfe-report
    Faturamento  -> /admin/nfe-product-report
    Livro Caixa  -> /admin/cash-book-report
  Gestão de Frotas
    Máquinas  -> /admin/equipment-machines-report
    Abastecimentos  -> /admin/equipment-machines-supply-report
    Manutenções  -> /admin/equipment-machines-maintenance-report
Integrações
  Software Domínio  -> /admin/integration-dominios
  CTA Smart - Configuração  -> /admin/integration-cta-smart
  CTA Smart - Abastecimentos  -> /admin/cta-smart-supplies
  Export./Domínio
    Movimento Bancário  -> /admin/export-dominio-data
    Folha Salarial  -> /admin/export-earnings-dominio
    C. Pagar/Receber  -> /admin/export-expenses-incomes-dominio
    NFSe  -> /admin/export-nfs-dominio
  Exportações/CSV
    Exportações/CSV  -> /admin/financial-export
```

## Barra superior

- Atalhos externos: Embrapa, Insumos, Clima, Controle (Agrofit), Cotações (IMEA), Crédito (modal de simulação), Pgto/Agro365.
- Seletor de fazenda ativa (troca o contexto de dados: `change-farm/{id}`).
- Sino de notificações com contador, lista de notificações (processamentos pendentes, compras pendentes há N dias, aniversariantes, transferências de lote a processar) e "Marcar todas como lidas".
- Menu do usuário: Perfil, Sair.
- Módulo "Favoritos" no menu lateral: atalhos configuráveis pelo usuário.
