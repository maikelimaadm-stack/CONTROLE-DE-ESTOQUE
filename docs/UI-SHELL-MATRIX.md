# Matriz do App Shell (gerada de `apps/web/nav.registry.mjs`)

Gerada por `apps/web/scripts/shell-matrix.mjs (node apps/web/scripts/shell-matrix.mjs)` (derivação idêntica à do mega-menu: grupos = áreas, itens = sub-áreas ou a
própria área, grupo Ações = `type:"action"`). Colunas: módulo · grupo do mega-menu · destino · rota canônica ·
permissão (qualquer uma libera) · aparece na busca global · favoritável · `openTab` (identidade da aba) ·
disponibilidade responsiva (1024–1920: sempre acessível — módulos que não cabem ficam em **Mais**).

| Módulo | Grupo | Destino | Rota canônica | Permissão | Busca | Favorito | openTab (aba) | Responsivo |
|---|---|---|---|---|---|---|---|---|
| Início | (módulo) | Início | `/` | dashboard.home.view | sim | sim | aba do módulo Início | barra ou **Mais** |
| Compras | (módulo) | Compras | `/compras` | união das áreas | sim | sim | aba do módulo Compras | barra ou **Mais** |
| Compras | Visão Geral | Visão Geral | `/compras?tab=visao-geral` | dashboard.supply.view | sim | sim | aba do módulo Compras | barra ou **Mais** |
| Compras | Processos | Processos | `/compras?tab=processos` | purchase_requests.view \| purchase_quotations.view \| purchase_authorization.view \| purchase_buy.view \| purchase_receipts.view \| rejected_requests.view | sim | sim | aba do módulo Compras | barra ou **Mais** |
| Compras | Ações | Nova solicitação de compra | `/suprimentos/new` | purchase_requests.create | sim | não | aba própria (/suprimentos/new) | barra ou **Mais** |
| Estoque | (módulo) | Estoque | `/estoque` | união das áreas | sim | sim | aba do módulo Estoque | barra ou **Mais** |
| Estoque | Visão Geral | Visão Geral | `/estoque?tab=visao-geral` | stocks.view | sim | sim | aba do módulo Estoque | barra ou **Mais** |
| Estoque | Estoque | Saldo | `/estoque?tab=estoque&sub=saldo` | stocks.view | sim | sim | aba do módulo Estoque | barra ou **Mais** |
| Estoque | Estoque | Movimentações | `/estoque?tab=estoque&sub=ledger` | stocks.view | sim | sim | aba do módulo Estoque | barra ou **Mais** |
| Estoque | Estoque | Ajustes de estoque | `/estoque?tab=estoque&sub=ajustes` | stock_corrections.view | sim | sim | aba do módulo Estoque | barra ou **Mais** |
| Estoque | Recebimentos | Documentos fiscais | `/estoque?tab=recebimentos&sub=fiscais` | invoices.view | sim | sim | aba do módulo Estoque | barra ou **Mais** |
| Estoque | Recebimentos | Entradas manuais | `/estoque?tab=recebimentos&sub=manuais` | input_entries.view | sim | sim | aba do módulo Estoque | barra ou **Mais** |
| Estoque | Recebimentos | DFe / XML recebidos | `/estoque?tab=recebimentos&sub=dfe` | dfe.view | sim | sim | aba do módulo Estoque | barra ou **Mais** |
| Estoque | Recebimentos | Em conferência | `/estoque?tab=recebimentos&sub=conferencia` | dfe_drafts.view | sim | sim | aba do módulo Estoque | barra ou **Mais** |
| Estoque | Operações | Requisições | `/estoque?tab=operacoes&sub=requisicoes` | requisitions.view | sim | sim | aba do módulo Estoque | barra ou **Mais** |
| Estoque | Operações | Saídas diretas | `/estoque?tab=operacoes&sub=diretas` | stock_writeoffs.view | sim | sim | aba do módulo Estoque | barra ou **Mais** |
| Estoque | Operações | Transferências | `/estoque?tab=operacoes&sub=transferencias` | warehouse_transfers.view \| farm_transfers.view | sim | sim | aba do módulo Estoque | barra ou **Mais** |
| Estoque | Operações | Devoluções | `/estoque?tab=operacoes&sub=devolucoes` | devolutions.view | sim | sim | aba do módulo Estoque | barra ou **Mais** |
| Estoque | Fábrica de Ração | Fórmulas | `/estoque?tab=fabrica&sub=formulas` | feed_formulas.view | sim | sim | aba do módulo Estoque | barra ou **Mais** |
| Estoque | Fábrica de Ração | Produções | `/estoque?tab=fabrica&sub=producoes` | feed_batches.view | sim | sim | aba do módulo Estoque | barra ou **Mais** |
| Estoque | Fábrica de Ração | Consumo de matéria-prima | `/estoque?tab=fabrica&sub=consumo` | stocks.view | sim | sim | aba do módulo Estoque | barra ou **Mais** |
| Estoque | Fábrica de Ração | Custos (produto acabado) | `/estoque?tab=fabrica&sub=custos` | stocks.view | sim | sim | aba do módulo Estoque | barra ou **Mais** |
| Estoque | Ações | Nova entrada manual | `/estoque/entradas/new` | input_entries.create | sim | não | aba própria (/estoque/entradas/new) | barra ou **Mais** |
| Estoque | Ações | Novo documento fiscal / importar XML | `/estoque/documentos-fiscais/new` | invoices.create | sim | não | aba própria (/estoque/documentos-fiscais/new) | barra ou **Mais** |
| Estoque | Ações | Nova requisição | `/estoque/requisicoes/new` | requisitions.create | sim | não | aba própria (/estoque/requisicoes/new) | barra ou **Mais** |
| Estoque | Ações | Nova saída direta | `/estoque/baixas/new` | stock_writeoffs.create | sim | não | aba própria (/estoque/baixas/new) | barra ou **Mais** |
| Estoque | Ações | Transferência entre armazéns | `/estoque/transferencias/new?kind=warehouse` | warehouse_transfers.create | sim | não | aba própria (/estoque/transferencias/new) | barra ou **Mais** |
| Estoque | Ações | Transferência entre fazendas | `/estoque/transferencias/new?kind=farm` | farm_transfers.create | sim | não | aba própria (/estoque/transferencias/new) | barra ou **Mais** |
| Estoque | Ações | Nova produção de ração | `/estoque/batidas/new` | feed_batches.create | sim | não | aba própria (/estoque/batidas/new) | barra ou **Mais** |
| Financeiro | (módulo) | Financeiro | `/financeiro` | união das áreas | sim | sim | aba do módulo Financeiro | barra ou **Mais** |
| Financeiro | Visão Geral | Visão Geral | `/financeiro?tab=visao-geral` | dashboard.financial.view | sim | sim | aba do módulo Financeiro | barra ou **Mais** |
| Financeiro | Contas | A Pagar | `/financeiro?tab=contas&sub=pagar` | payables.view | sim | sim | aba do módulo Financeiro | barra ou **Mais** |
| Financeiro | Contas | A Receber | `/financeiro?tab=contas&sub=receber` | receivables.view | sim | sim | aba do módulo Financeiro | barra ou **Mais** |
| Financeiro | Contas | Compromissos (contratos) | `/financeiro?tab=contas&sub=contratos` | contracts.view | sim | sim | aba do módulo Financeiro | barra ou **Mais** |
| Financeiro | Caixa e Bancos | Extrato | `/financeiro?tab=caixa&sub=extrato` | bank_movements.view | sim | sim | aba do módulo Financeiro | barra ou **Mais** |
| Financeiro | Caixa e Bancos | Fluxo de Caixa | `/financeiro?tab=caixa&sub=fluxo` | cash_flow.view | sim | sim | aba do módulo Financeiro | barra ou **Mais** |
| Financeiro | Caixa e Bancos | Conciliação (OFX) | `/financeiro?tab=caixa&sub=conciliacao` | ofx_imports.view | sim | sim | aba do módulo Financeiro | barra ou **Mais** |
| Financeiro | Caixa e Bancos | Meses conciliados | `/financeiro?tab=caixa&sub=historico` | ofx_report.view | sim | sim | aba do módulo Financeiro | barra ou **Mais** |
| Financeiro | Caixa e Bancos | Contas Bancárias | `/financeiro?tab=caixa&sub=bancos` | bank_accounts.view | sim | sim | aba do módulo Financeiro | barra ou **Mais** |
| Financeiro | Planejamento | Planejamento | `/financeiro?tab=planejamento` | budget_plannings.view | sim | sim | aba do módulo Financeiro | barra ou **Mais** |
| Financeiro | Ações | Nova despesa (conta a pagar) | `/financeiro/contas-a-pagar/new` | payables.create | sim | não | aba própria (/financeiro/contas-a-pagar/new) | barra ou **Mais** |
| Financeiro | Ações | Nova receita (conta a receber) | `/financeiro/contas-a-receber/new` | receivables.create | sim | não | aba própria (/financeiro/contas-a-receber/new) | barra ou **Mais** |
| Financeiro | Ações | Novo movimento bancário | `/financeiro/movimentos/new` | bank_movements.create | sim | não | aba própria (/financeiro/movimentos/new) | barra ou **Mais** |
| Vendas | (módulo) | Vendas | `/vendas` | união das áreas | sim | sim | aba do módulo Vendas | barra ou **Mais** |
| Vendas | Orçamentos | Orçamentos | `/vendas?tab=budgets` | budgets.view | sim | sim | aba do módulo Vendas | barra ou **Mais** |
| Vendas | Pedidos | Pedidos | `/vendas?tab=orders` | orders.view | sim | sim | aba do módulo Vendas | barra ou **Mais** |
| Vendas | Vendas | Vendas | `/vendas?tab=sales` | sales.view | sim | sim | aba do módulo Vendas | barra ou **Mais** |
| Vendas | Ações | Novo orçamento | `/vendas/budgets/new` | budgets.create | sim | não | aba própria (/vendas/budgets/new) | barra ou **Mais** |
| Vendas | Ações | Novo pedido | `/vendas/orders/new` | orders.create | sim | não | aba própria (/vendas/orders/new) | barra ou **Mais** |
| Vendas | Ações | Nova venda | `/vendas/sales/new` | sales.create | sim | não | aba própria (/vendas/sales/new) | barra ou **Mais** |
| Pecuária | (módulo) | Pecuária | `/pecuaria` | união das áreas | sim | sim | aba do módulo Pecuária | barra ou **Mais** |
| Pecuária | Visão Geral | Visão Geral | `/pecuaria?tab=visao-geral` | dashboard.livestock.view | sim | sim | aba do módulo Pecuária | barra ou **Mais** |
| Pecuária | Rebanho | Animais | `/pecuaria?tab=rebanho&sub=animais` | animals.view \| animals_management.view \| locate_animals.view \| processings.view | sim | sim | aba do módulo Pecuária | barra ou **Mais** |
| Pecuária | Rebanho | Lotes | `/pecuaria?tab=rebanho&sub=lotes` | batches.view | sim | sim | aba do módulo Pecuária | barra ou **Mais** |
| Pecuária | Rebanho | Reclassificações | `/pecuaria?tab=rebanho&sub=reclassificacoes` | herd_evolution.view | sim | sim | aba do módulo Pecuária | barra ou **Mais** |
| Pecuária | Rebanho | Transferências (histórico) | `/pecuaria?tab=rebanho&sub=transferencias` | animal_batch_transfer.view \| batch_grouping.view \| batch_module_area_transfer.view \| batch_farm_transfer.view | sim | sim | aba do módulo Pecuária | barra ou **Mais** |
| Pecuária | Movimentações | Movimentações | `/pecuaria?tab=movimentacoes` | animal_sales.view \| animal_purchases.view \| animal_births.view \| animal_deaths.view \| animal_losses.view | sim | sim | aba do módulo Pecuária | barra ou **Mais** |
| Pecuária | Manejos | Manejos | `/pecuaria?tab=manejos` | weighings.view \| nutritions.view \| sanitaries.view \| weanings.view \| separations.view \| pastures.view | sim | sim | aba do módulo Pecuária | barra ou **Mais** |
| Pecuária | Pecuária | Reprodução | `/pecuaria/reproducao` | advanced_reproductive.view \| breeding_seasons.view \| matings.view | sim | sim | aba do módulo Pecuária | barra ou **Mais** |
| Pecuária | Pecuária | Visão Geral | `/pecuaria/reproducao?tab=visao-geral` | advanced_reproductive.view | sim | sim | aba do módulo Pecuária | barra ou **Mais** |
| Pecuária | Pecuária | Estações de Monta | `/pecuaria/reproducao?tab=estacoes` | breeding_seasons.view | sim | sim | aba do módulo Pecuária | barra ou **Mais** |
| Pecuária | Pecuária | Acasalamentos e Diagnósticos | `/pecuaria/reproducao?tab=acasalamentos` | matings.view | sim | sim | aba do módulo Pecuária | barra ou **Mais** |
| Pecuária | Ações | Cadastrar animal | `/pecuaria/animais/new` | animals.create | sim | não | aba própria (/pecuaria/animais/new) | barra ou **Mais** |
| Pecuária | Ações | Nova pesagem | `/pecuaria/pesagens/new` | weighings.create | sim | não | aba própria (/pecuaria/pesagens/new) | barra ou **Mais** |
| Pecuária | Ações | Novo manejo sanitário | `/pecuaria/manejo/sanitary/new` | sanitaries.create | sim | não | aba própria (/pecuaria/manejo/sanitary/new) | barra ou **Mais** |
| Pecuária | Ações | Novo manejo de nutrição | `/pecuaria/manejo/nutrition/new` | nutritions.create | sim | não | aba própria (/pecuaria/manejo/nutrition/new) | barra ou **Mais** |
| Pecuária | Ações | Nova compra de animais | `/pecuaria/movimentacoes/purchase/new` | animal_purchases.create | sim | não | aba própria (/pecuaria/movimentacoes/purchase/new) | barra ou **Mais** |
| Pecuária | Ações | Nova venda de animais | `/pecuaria/movimentacoes/sale/new` | animal_sales.create | sim | não | aba própria (/pecuaria/movimentacoes/sale/new) | barra ou **Mais** |
| Pecuária | Ações | Registrar nascimento | `/pecuaria/movimentacoes/birth/new` | animal_births.create | sim | não | aba própria (/pecuaria/movimentacoes/birth/new) | barra ou **Mais** |
| Pecuária | Ações | Registrar morte | `/pecuaria/movimentacoes/death/new` | animal_deaths.create | sim | não | aba própria (/pecuaria/movimentacoes/death/new) | barra ou **Mais** |
| Confinamento | (módulo) | Confinamento | `/confinamento` | união das áreas | sim | sim | aba do módulo Confinamento | barra ou **Mais** |
| Confinamento | Hoje | Produção (bateladas) | `/confinamento?tab=hoje&sub=producao` | diet_batches.view | sim | sim | aba do módulo Confinamento | barra ou **Mais** |
| Confinamento | Hoje | Trato | `/confinamento?tab=hoje&sub=trato` | feed_deliveries.view | sim | sim | aba do módulo Confinamento | barra ou **Mais** |
| Confinamento | Hoje | Leitura de Cocho | `/confinamento?tab=hoje&sub=cocho` | trough_readings.view | sim | sim | aba do módulo Confinamento | barra ou **Mais** |
| Confinamento | Currais | Currais | `/confinamento?tab=currais` | feedlot_yards.view \| feedlot_sectors.view \| feedlot_corrals.view \| feedlot_map.view \| dashboard.feedlot.view | sim | sim | aba do módulo Confinamento | barra ou **Mais** |
| Confinamento | Dietas | Dietas | `/confinamento?tab=dietas` | diets.view \| feeding_phases.view | sim | sim | aba do módulo Confinamento | barra ou **Mais** |
| Confinamento | Desempenho | Desempenho | `/confinamento?tab=desempenho` | dashboard.feedlot_performance.view \| dashboard.feedlot_cost.view \| dashboard.feed_consumption.view \| dashboard.nutrition_stock.view | sim | sim | aba do módulo Confinamento | barra ou **Mais** |
| Frota e Ativos | (módulo) | Frota e Ativos | `/frota` | união das áreas | sim | sim | aba do módulo Frota e Ativos | barra ou **Mais** |
| Frota e Ativos | Visão Geral | Visão Geral | `/frota?tab=visao-geral` | dashboard.assets.view | sim | sim | aba do módulo Frota e Ativos | barra ou **Mais** |
| Frota e Ativos | Equipamentos | Inventário | `/frota?tab=equipamentos&sub=inventario` | equipments.view | sim | sim | aba do módulo Frota e Ativos | barra ou **Mais** |
| Frota e Ativos | Equipamentos | Transferências (histórico) | `/frota?tab=equipamentos&sub=transferencias` | equipment_transfers.view | sim | sim | aba do módulo Frota e Ativos | barra ou **Mais** |
| Frota e Ativos | Equipamentos | Depreciação / Patrimônio | `/frota?tab=equipamentos&sub=depreciacao` | depreciations.view \| depreciation_forecast.view \| dashboard.depreciation.view | sim | sim | aba do módulo Frota e Ativos | barra ou **Mais** |
| Frota e Ativos | Abastecimentos | Abastecimentos | `/frota?tab=abastecimentos` | fuel_supplies.view | sim | sim | aba do módulo Frota e Ativos | barra ou **Mais** |
| Frota e Ativos | Manutenções | Manutenções | `/frota?tab=manutencoes` | maintenances.view \| preventive_maintenances.view \| scheduled_reviews.view | sim | sim | aba do módulo Frota e Ativos | barra ou **Mais** |
| Frota e Ativos | Ações | Nova máquina / equipamento | `/cadastros/equipments/new` | equipments.create | sim | não | aba própria (/cadastros/equipments/new) | barra ou **Mais** |
| Frota e Ativos | Ações | Novo abastecimento | `/frota/abastecimentos/new` | fuel_supplies.create | sim | não | aba própria (/frota/abastecimentos/new) | barra ou **Mais** |
| Frota e Ativos | Ações | Nova manutenção | `/frota/manutencoes/new` | maintenances.create | sim | não | aba própria (/frota/manutencoes/new) | barra ou **Mais** |
| Frota e Ativos | Ações | Novo plano preventivo | `/cadastros/preventive_maintenances/new` | preventive_maintenances.create | sim | não | aba própria (/cadastros/preventive_maintenances/new) | barra ou **Mais** |
| Frota e Ativos | Ações | Agendar revisão | `/cadastros/scheduled_reviews/new` | scheduled_reviews.create | sim | não | aba própria (/cadastros/scheduled_reviews/new) | barra ou **Mais** |
| Pessoas e RH | (módulo) | Pessoas e RH | `/pessoas` | união das áreas | sim | sim | aba do módulo Pessoas e RH | barra ou **Mais** |
| Pessoas e RH | Pessoas | Pessoas | `/pessoas?tab=pessoas` | people.view \| employees.view \| clients.view \| providers.view \| proprietaries.view | sim | sim | aba do módulo Pessoas e RH | barra ou **Mais** |
| Pessoas e RH | Ocorrências | Faltas | `/pessoas?tab=ocorrencias&sub=faltas` | absences.view | sim | sim | aba do módulo Pessoas e RH | barra ou **Mais** |
| Pessoas e RH | Ocorrências | Bonificações / eventos | `/pessoas?tab=ocorrencias&sub=eventos` | bonuses.view | sim | sim | aba do módulo Pessoas e RH | barra ou **Mais** |
| Pessoas e RH | Folha | Adiantamentos | `/pessoas?tab=folha&sub=adiantamentos` | salary_advances.view | sim | sim | aba do módulo Pessoas e RH | barra ou **Mais** |
| Pessoas e RH | Folha | Apuração Mensal | `/pessoas?tab=folha&sub=apuracao` | earnings.view | sim | sim | aba do módulo Pessoas e RH | barra ou **Mais** |
| Pessoas e RH | Ações | Nova pessoa | `/cadastros/people/new` | people.create | sim | não | aba própria (/cadastros/people/new) | barra ou **Mais** |
| Pessoas e RH | Ações | Novo funcionário | `/cadastros/people/new?is_employee=true` | employees.create \| people.create | sim | não | aba própria (/cadastros/people/new) | barra ou **Mais** |
| Pessoas e RH | Ações | Registrar falta | `/cadastros/absences/new` | absences.create | sim | não | aba própria (/cadastros/absences/new) | barra ou **Mais** |
| Pessoas e RH | Ações | Registrar bonificação / evento | `/cadastros/bonuses/new` | bonuses.create | sim | não | aba própria (/cadastros/bonuses/new) | barra ou **Mais** |
| Ordens de Serviço | (módulo) | Ordens de Serviço | `/os` | service_orders.view | sim | sim | aba do módulo Ordens de Serviço | barra ou **Mais** |
| Ordens de Serviço | Ordens de Serviço | Ordens de Serviço | `/os` | service_orders.view | sim | sim | aba do módulo Ordens de Serviço | barra ou **Mais** |
| Ordens de Serviço | Ações | Nova ordem de serviço | `/os/new` | service_orders.create | sim | não | aba própria (/os/new) | barra ou **Mais** |
| Fiscal | (módulo) | Fiscal | `/fiscal` | união das áreas | sim | sim | aba do módulo Fiscal | barra ou **Mais** |
| Fiscal | Documentos de entrada | Documentos de entrada | `/fiscal?tab=documentos` | invoices.view | sim | sim | aba do módulo Fiscal | barra ou **Mais** |
| Fiscal | Partida dobrada | Partida dobrada | `/fiscal?tab=partida-dobrada` | journal_entries.view | sim | sim | aba do módulo Fiscal | barra ou **Mais** |
| Fiscal | Livro Caixa | Livro Caixa | `/fiscal?tab=livro-caixa` | dashboard.cash_book.view \| report.cash_book.view | sim | sim | aba do módulo Fiscal | barra ou **Mais** |
| Relatórios | (módulo) | Relatórios | `/relatorios` | report.stock_movement.view \| saved_reports.view | sim | sim | aba do módulo Relatórios | barra ou **Mais** |
| Relatórios | Relatórios | Relatórios | `/relatorios` | report.stock_movement.view \| saved_reports.view | sim | sim | aba do módulo Relatórios | barra ou **Mais** |
| Relatórios | Ações | Novo relatório personalizado | `/relatorios/personalizados/novo` | saved_reports.create | sim | não | aba própria (/relatorios/personalizados/novo) | barra ou **Mais** |
| Configurações | (módulo) | Configurações | `/configuracoes` | união das áreas | sim | sim | aba do módulo Configurações | barra ou **Mais** |
| Configurações | Empresa e Fazendas | Fazendas | `/configuracoes?tab=empresa&sub=farms` | farms.view | sim | sim | aba do módulo Configurações | barra ou **Mais** |
| Configurações | Empresa e Fazendas | Centros de Custo | `/configuracoes?tab=empresa&sub=cost-centers` | cost_centers.view | sim | sim | aba do módulo Configurações | barra ou **Mais** |
| Configurações | Empresa e Fazendas | Safras | `/configuracoes?tab=empresa&sub=harvests` | harvests.view | sim | sim | aba do módulo Configurações | barra ou **Mais** |
| Configurações | Empresa e Fazendas | Pluviometria | `/configuracoes?tab=empresa&sub=rainfalls` | rainfalls.view | sim | sim | aba do módulo Configurações | barra ou **Mais** |
| Configurações | Empresa e Fazendas | Indicadores de chuva | `/configuracoes?tab=empresa&sub=pluviometria` | dashboard.rainfall.view | sim | sim | aba do módulo Configurações | barra ou **Mais** |
| Configurações | Empresa e Fazendas | Parâmetros | `/configuracoes?tab=empresa&sub=parametros` | tenant_parameters.edit | sim | sim | aba do módulo Configurações | barra ou **Mais** |
| Configurações | Produtos e Classificações | Produtos | `/configuracoes?tab=produtos&sub=products` | products.view | sim | sim | aba do módulo Configurações | barra ou **Mais** |
| Configurações | Produtos e Classificações | Grupos / Categorias / Classes | `/configuracoes?tab=produtos&sub=product-groups` | products.view | sim | sim | aba do módulo Configurações | barra ou **Mais** |
| Configurações | Produtos e Classificações | Unidades de Medida | `/configuracoes?tab=produtos&sub=measurement-units` | products.view | sim | sim | aba do módulo Configurações | barra ou **Mais** |
| Configurações | Produtos e Classificações | Variedades / Culturas | `/configuracoes?tab=produtos&sub=cultivations` | products.view | sim | sim | aba do módulo Configurações | barra ou **Mais** |
| Configurações | Produtos e Classificações | Armazéns | `/configuracoes?tab=produtos&sub=warehouses` | warehouses.view | sim | sim | aba do módulo Configurações | barra ou **Mais** |
| Configurações | Produtos e Classificações | Endereçamentos | `/configuracoes?tab=produtos&sub=addressings` | addressings.view | sim | sim | aba do módulo Configurações | barra ou **Mais** |
| Configurações | Produtos e Classificações | Perfis de Lançamento (NF-e) | `/configuracoes?tab=produtos&sub=provider-launch-profiles` | provider_launch_profiles.view | sim | sim | aba do módulo Configurações | barra ou **Mais** |
| Configurações | Produtos e Classificações | Categorias de Rateio | `/configuracoes?tab=produtos&sub=apportionment-categories` | apportionments.view | sim | sim | aba do módulo Configurações | barra ou **Mais** |
| Configurações | Compras | SLA por etapa | `/configuracoes?tab=compras&sub=sla` | supply_sla.view | sim | sim | aba do módulo Configurações | barra ou **Mais** |
| Configurações | Compras | Autorizadores | `/configuracoes?tab=compras&sub=authorizers` | authorizers.view | sim | sim | aba do módulo Configurações | barra ou **Mais** |
| Configurações | Financeiro | Categorias Financeiras | `/configuracoes?tab=financeiro&sub=financial-categories` | financial_categories.view | sim | sim | aba do módulo Configurações | barra ou **Mais** |
| Configurações | Financeiro | Tipos de Título | `/configuracoes?tab=financeiro&sub=title-types` | payables.view | sim | sim | aba do módulo Configurações | barra ou **Mais** |
| Configurações | Financeiro | Formas de Pagamento | `/configuracoes?tab=financeiro&sub=payment-methods` | sales.view | sim | sim | aba do módulo Configurações | barra ou **Mais** |
| Configurações | Financeiro | Congelamentos | `/configuracoes?tab=financeiro&sub=financial-freezes` | financial_freezes.view | sim | sim | aba do módulo Configurações | barra ou **Mais** |
| Configurações | Financeiro | Plano de Contas | `/configuracoes?tab=financeiro&sub=chart-accounts` | chart_accounts.view | sim | sim | aba do módulo Configurações | barra ou **Mais** |
| Configurações | Pecuária | Espécies / Categorias / Raças | `/configuracoes?tab=pecuaria&sub=animal-categories` | animals.view | sim | sim | aba do módulo Configurações | barra ou **Mais** |
| Configurações | Pecuária | Tipos de Identificação | `/configuracoes?tab=pecuaria&sub=identification-types` | animals.view | sim | sim | aba do módulo Configurações | barra ou **Mais** |
| Configurações | Pecuária | Parâmetros de Peso | `/configuracoes?tab=pecuaria&sub=weight-parameters` | weight_parameters.view | sim | sim | aba do módulo Configurações | barra ou **Mais** |
| Configurações | Pecuária | Forragens | `/configuracoes?tab=pecuaria&sub=fodders` | fodders.view | sim | sim | aba do módulo Configurações | barra ou **Mais** |
| Configurações | Pecuária | Módulos de Pastejo | `/configuracoes?tab=pecuaria&sub=grazing-modules` | grazing_modules.view | sim | sim | aba do módulo Configurações | barra ou **Mais** |
| Configurações | Pecuária | Áreas / Piquetes | `/configuracoes?tab=pecuaria&sub=areas` | batch_area.view | sim | sim | aba do módulo Configurações | barra ou **Mais** |
| Configurações | Pecuária | Cochos | `/configuracoes?tab=pecuaria&sub=troughs` | troughs.view | sim | sim | aba do módulo Configurações | barra ou **Mais** |
| Configurações | Pecuária | Planejamento Pecuário | `/configuracoes?tab=pecuaria&sub=livestock-plannings` | livestock_plannings.view | sim | sim | aba do módulo Configurações | barra ou **Mais** |
| Configurações | Pecuária | Operações | `/configuracoes?tab=pecuaria&sub=operations` | operations.view | sim | sim | aba do módulo Configurações | barra ou **Mais** |
| Configurações | Pecuária | Atividades | `/configuracoes?tab=pecuaria&sub=activities` | activities.view | sim | sim | aba do módulo Configurações | barra ou **Mais** |
| Configurações | Pecuária | Reprodutores (touros / sêmen / embrião) | `/configuracoes?tab=pecuaria&sub=breeding-sires` | breeding_sires.view | sim | sim | aba do módulo Configurações | barra ou **Mais** |
| Configurações | Pecuária | Protocolos reprodutivos | `/configuracoes?tab=pecuaria&sub=breeding-protocols` | breeding_protocols.view | sim | sim | aba do módulo Configurações | barra ou **Mais** |
| Configurações | Frota | Famílias de Bens | `/configuracoes?tab=frota&sub=equipment-families` | equipments.view | sim | sim | aba do módulo Configurações | barra ou **Mais** |
| Configurações | RH | Tipos de Evento | `/configuracoes?tab=rh&sub=hr-events` | hr_events.view | sim | sim | aba do módulo Configurações | barra ou **Mais** |
| Configurações | RH | Funções | `/configuracoes?tab=rh&sub=job-functions` | job_functions.view | sim | sim | aba do módulo Configurações | barra ou **Mais** |
| Configurações | RH | Equipes | `/configuracoes?tab=rh&sub=teams` | teams.view | sim | sim | aba do módulo Configurações | barra ou **Mais** |
| Configurações | Fiscal e Documentos | Capacidades fiscais (status) | `/configuracoes?tab=fiscal&sub=capacidades` | — | sim | sim | aba do módulo Configurações | barra ou **Mais** |
| Configurações | Fiscal e Documentos | Regras Fiscais | `/configuracoes?tab=fiscal&sub=tax-rules` | tax_rules.view | sim | sim | aba do módulo Configurações | barra ou **Mais** |
| Configurações | Fiscal e Documentos | Naturezas de Operação | `/configuracoes?tab=fiscal&sub=nature-operations` | nature_operations.view | sim | sim | aba do módulo Configurações | barra ou **Mais** |
| Configurações | Fiscal e Documentos | Informações Complementares | `/configuracoes?tab=fiscal&sub=additional-infos` | additional_infos.view | sim | sim | aba do módulo Configurações | barra ou **Mais** |
| Configurações | Fiscal e Documentos | Tipos de Documento | `/configuracoes?tab=fiscal&sub=document-types` | document_types.view | sim | sim | aba do módulo Configurações | barra ou **Mais** |
| Configurações | Fiscal e Documentos | Biblioteca de Documentos | `/configuracoes?tab=fiscal&sub=documents` | documents.view | sim | sim | aba do módulo Configurações | barra ou **Mais** |
| Configurações | Implantação (saldos iniciais) | Saldos iniciais de estoque | `/configuracoes?tab=implantacao&sub=estoque` | opening_balances.view | sim | sim | aba do módulo Configurações | barra ou **Mais** |
| Configurações | Implantação (saldos iniciais) | Saldos iniciais bancários | `/configuracoes?tab=implantacao&sub=financeiro` | opening_movements.view | sim | sim | aba do módulo Configurações | barra ou **Mais** |
| Configurações | Usuários e Permissões | Usuários | `/configuracoes?tab=usuarios&sub=usuarios` | users.view | sim | sim | aba do módulo Configurações | barra ou **Mais** |
| Configurações | Usuários e Permissões | Perfis e Permissões | `/configuracoes?tab=usuarios&sub=perfis` | roles.view | sim | sim | aba do módulo Configurações | barra ou **Mais** |
| Configurações | Usuários e Permissões | Atividade dos usuários | `/configuracoes?tab=usuarios&sub=atividade` | dashboard.user_analysis.view | sim | sim | aba do módulo Configurações | barra ou **Mais** |
| Configurações | Integrações | Configurações (NF-e / DFe / NFS-e / Domínio) | `/configuracoes?tab=integracoes&sub=integrations` | integration.dominio.view | sim | sim | aba do módulo Configurações | barra ou **Mais** |
| Configurações | Integrações | Exportações CSV / XLSX | `/configuracoes?tab=integracoes&sub=exportacoes` | integration.csv_export.view | sim | sim | aba do módulo Configurações | barra ou **Mais** |
| Configurações | Auditoria | Auditoria | `/configuracoes?tab=auditoria` | audit_logs.view | sim | sim | aba do módulo Configurações | barra ou **Mais** |

Total: 161 destinos · 13 módulos. Menu, mega-menu, busca (`searchNav`), favoritos e abas convergem a este mesmo universo (nenhuma árvore paralela).
