# Matriz de Permissões do Sistema de Referência

666 chaves de permissão observadas na tela "Perfil Usuário > Adicionar Novo" (checkboxes agrupados em árvore que espelha o menu). Padrão dominante: `<recurso>_view|create|edit|delete` + ações especiais (ex.: `dfe_manifest`, `request-purchases_transfer`, `weighing_stock`).

| Grupo | Chave | Rótulo |
|---|---|---|
| Painel de Controle > Tradução | `tradutor_view` | Visualizar |
| Painel de Controle > Mapa | `maps_view` | Visualizar |
| Painel de Controle > Prev. Receitas x Despesas | `forecast_financila` | Visualizar |
| Painel de Controle > Custo de Produção - Período/Realizado | `coe_view` | Visualizar |
| Painel de Controle > Resultado Operacional (R$) | `operacional_result` | Visualizar |
| Painel de Controle > Prev. Receitas x Despesas | `cashflow_expected` | Visualizar |
| Painel de Controle > Real. Receitas x Despesas | `cashflow_done` | Visualizar |
| Dashboards > Financeiros | `financial_dashboard_view` | Visualizar |
| Dashboards > Livro Caixa | `cash_book_dashboard_view` | Visualizar |
| Dashboards > Suprimentos | `supply_dashboard_view` | Visualizar |
| Dashboards > Pecuária de Corte | `livestock_dashboard_view` | Visualizar |
| Dashboards > Depreciações | `depreciation_dashboard_view` | Visualizar |
| Dashboards > Ativos | `assets_dashboard_view` | Visualizar |
| Dashboards > Análise de Usuários | `user_analysis_dashboard_view` | Visualizar |
| Dashboards > Pluviometria | `rainfall_dashboard_view` | Visualizar |
| Dashboards > Lotação de Currais | `feedlot_dashboard_view` | Visualizar |
| Dashboards > Custos do Confinamento | `feedlot_cost_dashboard_view` | Visualizar |
| Dashboards > Desempenho de Lotes | `feedlot_performance_dashboard_view` | Visualizar |
| Dashboards > Estoque Nutrição | `nutrition-stock-dashboard_view` | Visualizar |
| Dashboards > Consumo de Ração | `feed-consumption-dashboard_view` | Visualizar |
| Cadastros Base > Estrutura > Centros de Custo | `costcenters_view` | Visualizar |
| Cadastros Base > Estrutura > Centros de Custo | `costcenters_create` | Criar |
| Cadastros Base > Estrutura > Centros de Custo | `costcenters_edit` | Editar |
| Cadastros Base > Estrutura > Centros de Custo | `costcenters_delete` | Deletar |
| Cadastros Base > Estrutura > Fazendas | `farms_view` | Visualizar |
| Cadastros Base > Estrutura > Fazendas | `farms_create` | Criar |
| Cadastros Base > Estrutura > Fazendas | `farms_edit` | Editar |
| Cadastros Base > Estrutura > Fazendas | `farms_delete` | Deletar |
| Cadastros Base > Estrutura > Fazendas | `import_kml` | Importar KML |
| Cadastros Base > Estrutura > Safras | `harvests_view` | Visualizar |
| Cadastros Base > Estrutura > Safras | `harvests_create` | Criar |
| Cadastros Base > Estrutura > Safras | `harvests_edit` | Editar |
| Cadastros Base > Estrutura > Safras | `harvests_delete` | Deletar |
| Cadastros Base > Estrutura > Produtos > Endereçamentos | `addressings_view` | Visualizar |
| Cadastros Base > Estrutura > Produtos > Endereçamentos | `addressings_create` | Criar |
| Cadastros Base > Estrutura > Produtos > Endereçamentos | `addressings_edit` | Editar |
| Cadastros Base > Estrutura > Produtos > Endereçamentos | `addressings_delete` | Deletar |
| Cadastros Base > Estrutura > Produtos > Produtos | `products_view` | Visualizar |
| Cadastros Base > Estrutura > Produtos > Produtos | `products_create` | Criar |
| Cadastros Base > Estrutura > Produtos > Produtos | `products_edit` | Editar |
| Cadastros Base > Estrutura > Produtos > Produtos | `products_delete` | Deletar |
| Cadastros Base > Estrutura > Produtos > Armazéns | `warehouses_view` | Visualizar |
| Cadastros Base > Estrutura > Produtos > Armazéns | `warehouses_create` | Criar |
| Cadastros Base > Estrutura > Produtos > Armazéns | `warehouses_edit` | Editar |
| Cadastros Base > Estrutura > Produtos > Armazéns | `warehouses_delete` | Deletar |
| Cadastros Base > Estrutura > Produtos > Estoques Iniciais | `openingbalances_view` | Visualizar |
| Cadastros Base > Estrutura > Produtos > Estoques Iniciais | `openingbalances_create` | Criar |
| Cadastros Base > Estrutura > Produtos > Estoques Iniciais | `openingbalances_edit` | Editar |
| Cadastros Base > Estrutura > Produtos > Estoques Iniciais | `openingbalances_delete` | Deletar |
| Cadastros Base > Estrutura > Rateios > Categorias | `apportionments_view` | Visualizar |
| Cadastros Base > Estrutura > Rateios > Categorias | `apportionments_create` | Criar |
| Cadastros Base > Estrutura > Rateios > Categorias | `apportionments_edit` | Editar |
| Cadastros Base > Estrutura > Rateios > Categorias | `apportionments_delete` | Deletar |
| Cadastros Base > Pessoas > Perfil Usuário | `roles_tenant_view` | Visualizar |
| Cadastros Base > Pessoas > Perfil Usuário | `roles_tenant_create` | Criar |
| Cadastros Base > Pessoas > Perfil Usuário | `roles_tenant_edit` | Editar |
| Cadastros Base > Pessoas > Perfil Usuário | `roles_tenant_delete` | Deletar |
| Cadastros Base > Pessoas > Pessoas Unificado | `people_view` | Visualizar |
| Cadastros Base > Pessoas > Pessoas Unificado | `people_create` | Criar |
| Cadastros Base > Pessoas > Pessoas Unificado | `people_edit` | Editar |
| Cadastros Base > Pessoas > Pessoas Unificado | `people_delete` | Deletar |
| Cadastros Base > Pessoas > Proprietários | `proprietaries_view` | Visualizar |
| Cadastros Base > Pessoas > Proprietários | `proprietaries_create` | Criar |
| Cadastros Base > Pessoas > Proprietários | `proprietaries_edit` | Editar |
| Cadastros Base > Pessoas > Proprietários | `proprietaries_delete` | Deletar |
| Cadastros Base > Pessoas > Funcionários | `employees_view` | Visualizar |
| Cadastros Base > Pessoas > Funcionários | `employees_create` | Criar |
| Cadastros Base > Pessoas > Funcionários | `employees_edit` | Editar |
| Cadastros Base > Pessoas > Funcionários | `employees_delete` | Deletar |
| Cadastros Base > Pessoas > Fornecedores | `providers_view` | Visualizar |
| Cadastros Base > Pessoas > Fornecedores | `providers_create` | Criar |
| Cadastros Base > Pessoas > Fornecedores | `providers_edit` | Editar |
| Cadastros Base > Pessoas > Fornecedores | `providers_delete` | Deletar |
| Cadastros Base > Pessoas > Clientes | `clients_view` | Visualizar |
| Cadastros Base > Pessoas > Clientes | `clients_create` | Criar |
| Cadastros Base > Pessoas > Clientes | `clients_edit` | Editar |
| Cadastros Base > Pessoas > Clientes | `clients_delete` | Deletar |
| Cadastros Base > Pessoas > Usuários | `users_view` | Visualizar |
| Cadastros Base > Pessoas > Usuários | `users_create` | Criar |
| Cadastros Base > Pessoas > Usuários | `users_edit` | Editar |
| Cadastros Base > Pessoas > Usuários | `users_delete` | Deletar |
| Cadastros Base > Pessoas > Autorizadores | `request-authorizers_view` | Visualizar |
| Cadastros Base > Pessoas > Autorizadores | `request-authorizers_create` | Criar |
| Cadastros Base > Pessoas > Autorizadores | `request-authorizers_edit` | Editar |
| Cadastros Base > Pessoas > Autorizadores | `request-authorizers_delete` | Deletar |
| Cadastros Base > Financeiros > Contas Bancárias | `accounts_view` | Visualizar |
| Cadastros Base > Financeiros > Contas Bancárias | `accounts_create` | Criar |
| Cadastros Base > Financeiros > Contas Bancárias | `accounts_edit` | Editar |
| Cadastros Base > Financeiros > Contas Bancárias | `accounts_delete` | Deletar |
| Cadastros Base > Financeiros > Saldo Inicial | `open-movements_view` | Visualizar |
| Cadastros Base > Financeiros > Saldo Inicial | `open-movements_create` | Criar |
| Cadastros Base > Financeiros > Saldo Inicial | `open-movements_edit` | Editar |
| Cadastros Base > Financeiros > Saldo Inicial | `open-movements_delete` | Deletar |
| Cadastros Base > Financeiros > Categorias Financeiras | `financialcategories_view` | Visualizar |
| Cadastros Base > Financeiros > Categorias Financeiras | `financialcategories_create` | Criar |
| Cadastros Base > Financeiros > Categorias Financeiras | `financialcategories_edit` | Editar |
| Cadastros Base > Financeiros > Categorias Financeiras | `financialcategories_delete` | Deletar |
| Cadastros Base > Fiscais > Emissores NFe | `issue_view` | Visualizar |
| Cadastros Base > Fiscais > Emissores NFe | `issue_create` | Criar |
| Cadastros Base > Fiscais > Emissores NFe | `issue_edit` | Editar |
| Cadastros Base > Fiscais > Emissores NFe | `issue_delete` | Deletar |
| Cadastros Base > Fiscais > Sinc. DFe | `issue-dfe-sync-time_view` | Visualizar |
| Cadastros Base > Fiscais > Sinc. DFe | `issue-dfe-sync-time_create` | Criar |
| Cadastros Base > Fiscais > Sinc. DFe | `issue-dfe-sync-time_edit` | Editar |
| Cadastros Base > Fiscais > Sinc. DFe | `issue-dfe-sync-time_delete` | Deletar |
| Cadastros Base > Fiscais > Sinc. NFS-e | `issue-nfse-sync-time_view` | Visualizar |
| Cadastros Base > Fiscais > Sinc. NFS-e | `issue-nfse-sync-time_create` | Criar |
| Cadastros Base > Fiscais > Sinc. NFS-e | `issue-nfse-sync-time_edit` | Editar |
| Cadastros Base > Fiscais > Sinc. NFS-e | `issue-nfse-sync-time_delete` | Deletar |
| Cadastros Base > Fiscais > Regras Fiscais | `tax-rules_view` | Visualizar |
| Cadastros Base > Fiscais > Regras Fiscais | `tax-rules_create` | Criar |
| Cadastros Base > Fiscais > Regras Fiscais | `tax-rules_edit` | Editar |
| Cadastros Base > Fiscais > Regras Fiscais | `tax-rules_delete` | Deletar |
| Cadastros Base > Fiscais > Contador | `ctdr_view` | Visualizar |
| Cadastros Base > Fiscais > Contador | `ctdr_create` | Criar |
| Cadastros Base > Fiscais > Contador | `ctdr_edit` | Editar |
| Cadastros Base > Fiscais > Contador | `ctdr_delete` | Deletar |
| Cadastros Base > Fiscais > Natureza Op. | `natop_view` | Visualizar |
| Cadastros Base > Fiscais > Natureza Op. | `natop_create` | Criar |
| Cadastros Base > Fiscais > Natureza Op. | `natop_edit` | Editar |
| Cadastros Base > Fiscais > Natureza Op. | `natop_delete` | Deletar |
| Cadastros Base > Fiscais > Info. Complementares | `additional-info_view` | Visualizar |
| Cadastros Base > Fiscais > Info. Complementares | `additional-info_create` | Criar |
| Cadastros Base > Fiscais > Info. Complementares | `additional-info_edit` | Editar |
| Cadastros Base > Fiscais > Info. Complementares | `additional-info_delete` | Deletar |
| Cadastros Base > Fiscais > Plano de Contas | `plan-accounts_view` | Visualizar |
| Cadastros Base > Fiscais > Plano de Contas | `plan-accounts_create` | Criar |
| Cadastros Base > Fiscais > Plano de Contas | `plan-accounts_edit` | Editar |
| Cadastros Base > Fiscais > Plano de Contas | `plan-accounts_delete` | Deletar |
| Cadastros Base > Agrícolas > Operações | `operations_view` | Visualizar |
| Cadastros Base > Agrícolas > Operações | `operations_create` | Criar |
| Cadastros Base > Agrícolas > Operações | `operations_edit` | Editar |
| Cadastros Base > Agrícolas > Operações | `operations_delete` | Deletar |
| Cadastros Base > Agrícolas > Atividades | `activities_view` | Visualizar |
| Cadastros Base > Agrícolas > Atividades | `activities_create` | Criar |
| Cadastros Base > Agrícolas > Atividades | `activities_edit` | Editar |
| Cadastros Base > Agrícolas > Atividades | `activities_delete` | Deletar |
| Cadastros Base > Pecuários > Parâmetros/Peso | `parameter-weight_view` | Visualizar |
| Cadastros Base > Pecuários > Parâmetros/Peso | `parameter-weight_create` | Criar |
| Cadastros Base > Pecuários > Parâmetros/Peso | `parameter-weight_edit` | Editar |
| Cadastros Base > Pecuários > Parâmetros/Peso | `parameter-weight_delete` | Deletar |
| Cadastros Base > Pecuários > Forragem | `fodder_view` | Visualizar |
| Cadastros Base > Pecuários > Forragem | `fodder_create` | Criar |
| Cadastros Base > Pecuários > Forragem | `fodder_edit` | Editar |
| Cadastros Base > Pecuários > Forragem | `fodder_delete` | Deletar |
| Cadastros Base > Pecuários > Rebanho | `animals_view` | Visualizar |
| Cadastros Base > Pecuários > Rebanho | `animals_create` | Criar |
| Cadastros Base > Pecuários > Rebanho | `animals_edit` | Editar |
| Cadastros Base > Pecuários > Rebanho | `animals_delete` | Deletar |
| Cadastros Base > Pecuários > Custo Retroativo | `animal-retroactive-costs_view` | Visualizar |
| Cadastros Base > Pecuários > Custo Retroativo | `animal-retroactive-costs_edit` | Editar |
| Cadastros Base > Pecuários > Custo Retroativo | `animal-retroactive-costs_create` | Importar |
| Cadastros Base > Pecuários > Módulo Pastejo | `grazing_view` | Visualizar |
| Cadastros Base > Pecuários > Módulo Pastejo | `grazing_create` | Criar |
| Cadastros Base > Pecuários > Módulo Pastejo | `grazing_edit` | Editar |
| Cadastros Base > Pecuários > Módulo Pastejo | `grazing_delete` | Deletar |
| Cadastros Base > Pecuários > Cochos | `troughs_view` | Visualizar |
| Cadastros Base > Pecuários > Cochos | `troughs_create` | Criar |
| Cadastros Base > Pecuários > Cochos | `troughs_edit` | Editar |
| Cadastros Base > Pecuários > Cochos | `troughs_delete` | Deletar |
| Cadastros Base > Pecuários > Lotes Animais | `batch_view` | Visualizar |
| Cadastros Base > Pecuários > Lotes Animais | `batch_create` | Criar |
| Cadastros Base > Pecuários > Lotes Animais | `batch_edit` | Editar |
| Cadastros Base > Pecuários > Lotes Animais | `batch_delete` | Deletar |
| Cadastros Base > Pecuários > Lote/Módulo | `batch_grazing_view` | Visualizar |
| Cadastros Base > Pecuários > Lote/Módulo | `batch_grazing_create` | Criar |
| Cadastros Base > Pecuários > Lote/Módulo | `batch_grazing_edit` | Editar |
| Cadastros Base > Pecuários > Lote/Módulo | `batch_grazing_delete` | Deletar |
| Cadastros Base > Pecuários > Lote/Área | `batch_area_view` | Visualizar |
| Cadastros Base > Pecuários > Lote/Área | `batch_area_create` | Criar |
| Cadastros Base > Pecuários > Lote/Área | `batch_area_edit` | Editar |
| Cadastros Base > Pecuários > Lote/Área | `batch_area_delete` | Deletar |
| Cadastros Base > Bens/Ativos > Inventário | `equipments_view` | Visualizar |
| Cadastros Base > Bens/Ativos > Inventário | `equipments_create` | Criar |
| Cadastros Base > Bens/Ativos > Inventário | `equipments_edit` | Editar |
| Cadastros Base > Bens/Ativos > Inventário | `equipments_delete` | Deletar |
| Cadastros Base > Bens/Ativos > Depreciação Mensal | `depreciations_view` | Visualizar |
| Cadastros Base > Bens/Ativos > Depreciação Mensal | `depreciations_create` | Criar |
| Cadastros Base > Bens/Ativos > Depreciação Mensal | `depreciations_edit` | Editar |
| Cadastros Base > Bens/Ativos > Depreciação Mensal | `depreciations_delete` | Deletar |
| Cadastros Base > Bens/Ativos > Prev. Depreciação | `depreciation-forecast_view` | Visualizar |
| Cadastros Base > Gerais > Parametrizações | `tenant-parameters_edit` | Editar |
| Administrativo > Suprimentos > Parâmetros SLA | `supply-status-sla_view` | Visualizar |
| Administrativo > Suprimentos > Parâmetros SLA | `supply-status-sla_edit` | Editar |
| Administrativo > Suprimentos > Meus Processos | `request-purchases_view` | Visualizar |
| Administrativo > Suprimentos > Solicitação | `request-purchases_view` | Visualizar |
| Administrativo > Suprimentos > Solicitação | `request-purchases_create` | Criar |
| Administrativo > Suprimentos > Solicitação | `request-purchases_edit` | Editar |
| Administrativo > Suprimentos > Solicitação | `request-purchases_delete` | Deletar |
| Administrativo > Suprimentos > Solicitação | `request-purchases_transfer` | Transferir Qualquer Responsável |
| Administrativo > Suprimentos > Rejeitados/Cancelados | `rejected-requests_view` | Visualizar |
| Administrativo > Suprimentos > Cotações | `request-quotation_view` | Visualizar |
| Administrativo > Suprimentos > Cotações | `request-quotation_create` | Criar |
| Administrativo > Suprimentos > Cotações | `request-quotation_edit` | Editar |
| Administrativo > Suprimentos > Cotações | `request-quotation_delete` | Deletar |
| Administrativo > Suprimentos > Autorização | `request-authorization_view` | Visualizar |
| Administrativo > Suprimentos > Autorização | `request-authorization_edit` | Autorizar/Ciência |
| Administrativo > Suprimentos > Compras | `request-buy_view` | Visualizar |
| Administrativo > Suprimentos > Compras | `request-buy_edit` | Informar Status |
| Administrativo > Suprimentos > Recebimentos | `request-receipts_view` | Visualizar |
| Administrativo > Suprimentos > Recebimentos | `request-receipts_edit` | Confirmar Recebimento |
| Administrativo > Suprimentos > Recebimentos | `request-purchases_financial` | Gerar Financeiro/Finalizar Pedido |
| Administrativo > Estoque > Doc. Fiscal/Entrada | `invoices_view` | Visualizar |
| Administrativo > Estoque > Doc. Fiscal/Entrada | `invoices_create` | Criar |
| Administrativo > Estoque > Doc. Fiscal/Entrada | `invoices_edit` | Editar |
| Administrativo > Estoque > Doc. Fiscal/Entrada | `invoices_delete` | Deletar |
| Administrativo > Estoque > Doc. Fiscal/Entrada > Documentos | `invoicedocument_view` | Visualizar |
| Administrativo > Estoque > Doc. Fiscal/Entrada > Documentos | `invoicedocument_create` | Criar |
| Administrativo > Estoque > Doc. Fiscal/Entrada > Documentos | `invoicedocument_edit` | Editar |
| Administrativo > Estoque > Doc. Fiscal/Entrada > Documentos | `invoicedocument_delete` | Deletar |
| Administrativo > Estoque > Entrada/Insumos | `input_entries_view` | Visualizar |
| Administrativo > Estoque > Entrada/Insumos | `input_entries_create` | Criar |
| Administrativo > Estoque > Entrada/Insumos | `input_entries_edit` | Editar |
| Administrativo > Estoque > Entrada/Insumos | `input_entries_delete` | Deletar |
| Administrativo > Estoque > DFe Recebidas | `dfe_view` | Visualizar |
| Administrativo > Estoque > DFe Recebidas | `dfe_create` | Buscar DFe |
| Administrativo > Estoque > DFe Recebidas | `dfe_manifest` | Manifestar |
| Administrativo > Estoque > DFe Recebidas | `dfe_launch` | Lançar DFe |
| Administrativo > Estoque > DFe Recebidas | `dfe_danfe` | Gerar DANFE |
| Administrativo > Estoque > DFe Recebidas | `dfe_xml` | Baixar XML |
| Administrativo > Estoque > Aprovação de Notas | `dfe-drafts_view` | Visualizar |
| Administrativo > Estoque > Aprovação de Notas | `dfe-drafts_approve` | Aprovar e Lançar |
| Administrativo > Estoque > Aprovação de Notas | `dfe-drafts_ignore` | Ignorar/Reprocessar |
| Administrativo > Estoque > Perfis de Lançamento | `provider-launch-profiles_view` | Visualizar |
| Administrativo > Estoque > Perfis de Lançamento | `provider-launch-profiles_create` | Criar |
| Administrativo > Estoque > Perfis de Lançamento | `provider-launch-profiles_edit` | Editar |
| Administrativo > Estoque > Perfis de Lançamento | `provider-launch-profiles_delete` | Deletar |
| Administrativo > Estoque > Baixa de Estoque | `stock-writeoffs_view` | Visualizar |
| Administrativo > Estoque > Baixa de Estoque | `stock-writeoffs_create` | Criar |
| Administrativo > Estoque > Baixa de Estoque | `stock-writeoffs_delete` | Deletar |
| Administrativo > Estoque > Requisição/Saída | `requisitions_view` | Visualizar |
| Administrativo > Estoque > Requisição/Saída | `requisitions_create` | Criar |
| Administrativo > Estoque > Requisição/Saída | `requisitions_edit` | Editar |
| Administrativo > Estoque > Requisição/Saída | `requisitions_delete` | Deletar |
| Administrativo > Estoque > Devolução/Entrada | `devolution_view` | Visualizar |
| Administrativo > Estoque > Devolução/Entrada | `devolution_create` | Criar |
| Administrativo > Estoque > Devolução/Entrada | `devolution_edit` | Editar |
| Administrativo > Estoque > Devolução/Entrada | `devolution_delete` | Deletar |
| Administrativo > Estoque > Correção de Estoque | `stock-corrections_view` | Visualizar |
| Administrativo > Estoque > Correção de Estoque | `stock-corrections_create` | Criar |
| Administrativo > Estoque > Correção de Estoque | `stock-corrections_delete` | Deletar |
| Administrativo > Estoque > Trans. Armazém | `warehouse-transfer_view` | Visualizar |
| Administrativo > Estoque > Trans. Armazém | `warehouse-transfer_create` | Criar |
| Administrativo > Estoque > Trans. Armazém | `warehouse-transfer_edit` | Editar |
| Administrativo > Estoque > Trans. Armazém | `warehouse-transfer_delete` | Deletar |
| Administrativo > Estoque > Trans. Fazendas | `warehouse-transfer-farm_view` | Visualizar |
| Administrativo > Estoque > Trans. Fazendas | `warehouse-transfer-farm_create` | Criar |
| Administrativo > Estoque > Trans. Fazendas | `warehouse-transfer-farm_delete` | Deletar |
| Administrativo > Estoque > Saldo Estoque | `stocks_view` | Visualizar |
| Administrativo > Estoque > Fábrica > Formulação | `food_view` | Visualizar |
| Administrativo > Estoque > Fábrica > Formulação | `food_create` | Criar |
| Administrativo > Estoque > Fábrica > Formulação | `food_edit` | Editar |
| Administrativo > Estoque > Fábrica > Formulação | `food_delete` | Deletar |
| Administrativo > Estoque > Fábrica > Batida | `food-beat_view` | Visualizar |
| Administrativo > Estoque > Fábrica > Batida | `food-beat_create` | Criar |
| Administrativo > Estoque > Fábrica > Batida | `food-beat_edit` | Editar |
| Administrativo > Estoque > Fábrica > Batida | `food-beat_delete` | Deletar |
| Administrativo > Gestão Pessoal > Eventos | `events_view` | Visualizar |
| Administrativo > Gestão Pessoal > Eventos | `events_create` | Criar |
| Administrativo > Gestão Pessoal > Eventos | `events_edit` | Editar |
| Administrativo > Gestão Pessoal > Eventos | `events_delete` | Deletar |
| Administrativo > Gestão Pessoal > Funções | `functions_view` | Visualizar |
| Administrativo > Gestão Pessoal > Funções | `functions_create` | Criar |
| Administrativo > Gestão Pessoal > Funções | `functions_edit` | Editar |
| Administrativo > Gestão Pessoal > Funções | `functions_delete` | Deletar |
| Administrativo > Gestão Pessoal > Equipes | `teams_view` | Visualizar |
| Administrativo > Gestão Pessoal > Equipes | `teams_create` | Criar |
| Administrativo > Gestão Pessoal > Equipes | `teams_edit` | Editar |
| Administrativo > Gestão Pessoal > Equipes | `teams_delete` | Deletar |
| Administrativo > Gestão Pessoal > Registro/Faltas | `absences_view` | Visualizar |
| Administrativo > Gestão Pessoal > Registro/Faltas | `absences_create` | Criar |
| Administrativo > Gestão Pessoal > Registro/Faltas | `absences_edit` | Editar |
| Administrativo > Gestão Pessoal > Registro/Faltas | `absences_delete` | Deletar |
| Administrativo > Gestão Pessoal > Adiant. Salarial | `advances_view` | Visualizar |
| Administrativo > Gestão Pessoal > Adiant. Salarial | `advances_create` | Criar |
| Administrativo > Gestão Pessoal > Adiant. Salarial | `advances_edit` | Editar |
| Administrativo > Gestão Pessoal > Adiant. Salarial | `advances_delete` | Deletar |
| Administrativo > Gestão Pessoal > Registro/Eventos | `bonuses_view` | Visualizar |
| Administrativo > Gestão Pessoal > Registro/Eventos | `bonuses_create` | Criar |
| Administrativo > Gestão Pessoal > Registro/Eventos | `bonuses_edit` | Editar |
| Administrativo > Gestão Pessoal > Registro/Eventos | `bonuses_delete` | Deletar |
| Administrativo > Gestão Pessoal > Funcionário X Eventos | `employeeevents_view` | Visualizar |
| Administrativo > Gestão Pessoal > Funcionário X Eventos | `employeeevents_create` | Criar |
| Administrativo > Gestão Pessoal > Funcionário X Eventos | `employeeevents_edit` | Editar |
| Administrativo > Gestão Pessoal > Funcionário X Eventos | `employeeevents_delete` | Deletar |
| Administrativo > Gestão Pessoal > Apuração Mensal | `earnings_view` | Visualizar |
| Administrativo > Gestão Pessoal > Apuração Mensal | `earnings_create` | Criar |
| Administrativo > Gestão Pessoal > Apuração Mensal | `earnings_edit` | Editar |
| Administrativo > Gestão Pessoal > Apuração Mensal | `earnings_delete` | Deletar |
| Administrativo > Gestão Documentos > Tipo Documento | `document-types_view` | Visualizar |
| Administrativo > Gestão Documentos > Tipo Documento | `document-types_create` | Criar |
| Administrativo > Gestão Documentos > Tipo Documento | `document-types_edit` | Editar |
| Administrativo > Gestão Documentos > Tipo Documento | `document-types_delete` | Deletar |
| Administrativo > Gestão Documentos > Documentos | `document-managements_view` | Visualizar |
| Administrativo > Gestão Documentos > Documentos | `document-managements_create` | Criar |
| Administrativo > Gestão Documentos > Documentos | `document-managements_edit` | Editar |
| Administrativo > Gestão Documentos > Documentos | `document-managements_delete` | Deletar |
| Operacional > Pecuária > Gestão Animais | `animals-management_view` | Visualizar |
| Operacional > Pecuária > Gestão Animais | `animals-management_create` | Criar |
| Operacional > Pecuária > Gestão Animais | `animals-management_edit` | Editar |
| Operacional > Pecuária > Gestão Animais | `animals-management_delete` | Deletar |
| Operacional > Pecuária > Inventariado | `inventoried-animals_view` | Visualizar |
| Operacional > Pecuária > Inventariado | `inventoried-animals_create` | Criar |
| Operacional > Pecuária > Inventariado | `inventoried-animals_delete` | Deletar |
| Operacional > Pecuária > Planejamento | `planning-livestock_view` | Visualizar |
| Operacional > Pecuária > Planejamento | `planning-livestock_create` | Criar |
| Operacional > Pecuária > Planejamento | `planning-livestock_edit` | Editar |
| Operacional > Pecuária > Planejamento | `planning-livestock_delete` | Deletar |
| Operacional > Pecuária > Transferências > Evolução/Rebanho | `evolutions_view` | Visualizar |
| Operacional > Pecuária > Transferências > Animais/Lote | `transference_animal_batch` | Transferir |
| Operacional > Pecuária > Transferências > Agrupar/Lotes | `grouper_batches` | Agrupar |
| Operacional > Pecuária > Transferências > Lote/Módulo/Área | `transfer_batch_module_area` | Transferir |
| Operacional > Pecuária > Transferências > Lote/Fazenda | `transfer_batch_farm` | Transferir |
| Operacional > Pecuária > Transferências > Animal/Fazenda | `transfer_animal_farm` | Transferir |
| Operacional > Pecuária > Movimentações > Vendas | `mov_sale_view` | Visualizar |
| Operacional > Pecuária > Movimentações > Vendas | `mov_sale_create` | Criar |
| Operacional > Pecuária > Movimentações > Vendas | `mov_sale_edit` | Editar |
| Operacional > Pecuária > Movimentações > Vendas | `mov_sale_delete` | Deletar |
| Operacional > Pecuária > Movimentações > Compras | `mov_purchase_view` | Visualizar |
| Operacional > Pecuária > Movimentações > Compras | `mov_purchase_create` | Criar |
| Operacional > Pecuária > Movimentações > Compras | `mov_purchase_edit` | Editar |
| Operacional > Pecuária > Movimentações > Compras | `mov_purchase_delete` | Deletar |
| Operacional > Pecuária > Movimentações > Nascimentos | `birth_animals_view` | Visualizar |
| Operacional > Pecuária > Movimentações > Nascimentos | `birth_animals_create` | Criar |
| Operacional > Pecuária > Movimentações > Nascimentos | `birth_animals_edit` | Editar |
| Operacional > Pecuária > Movimentações > Nascimentos | `birth_animals_delete` | Deletar |
| Operacional > Pecuária > Movimentações > Mortes | `death_animals_view` | Visualizar |
| Operacional > Pecuária > Movimentações > Mortes | `death_animals_create` | Criar |
| Operacional > Pecuária > Movimentações > Mortes | `death_animals_edit` | Editar |
| Operacional > Pecuária > Movimentações > Mortes | `death_animals_delete` | Deletar |
| Operacional > Pecuária > Movimentações > Perdas | `loss_animals_view` | Visualizar |
| Operacional > Pecuária > Movimentações > Perdas | `loss_animals_create` | Criar |
| Operacional > Pecuária > Movimentações > Perdas | `loss_animals_edit` | Editar |
| Operacional > Pecuária > Movimentações > Perdas | `loss_animals_delete` | Deletar |
| Operacional > Pecuária > Manejo > Processamentos | `processing_view` | Visualizar |
| Operacional > Pecuária > Manejo > Processamentos | `processing_create` | Processar |
| Operacional > Pecuária > Manejo > Processamentos | `processing_delete` | Cancelar |
| Operacional > Pecuária > Manejo > Pré-Lotes | `purchase_lot_view` | Visualizar |
| Operacional > Pecuária > Manejo > Pré-Lotes | `purchase_lot_create` | Criar |
| Operacional > Pecuária > Manejo > Pré-Lotes | `purchase_lot_edit` | Editar |
| Operacional > Pecuária > Manejo > Pré-Lotes | `purchase_lot_delete` | Deletar |
| Operacional > Pecuária > Manejo > Pesagem | `weighing_view` | Visualizar |
| Operacional > Pecuária > Manejo > Pesagem | `weighing_create` | Criar |
| Operacional > Pecuária > Manejo > Pesagem | `weighing_edit` | Editar |
| Operacional > Pecuária > Manejo > Pesagem | `weighing_delete` | Deletar |
| Operacional > Pecuária > Manejo > Pesagem | `weighing_stock` | Pesagem Estoque |
| Operacional > Pecuária > Manejo > Nutrição | `nutrition_view` | Visualizar |
| Operacional > Pecuária > Manejo > Nutrição | `nutrition_create` | Criar |
| Operacional > Pecuária > Manejo > Nutrição | `nutrition_edit` | Editar |
| Operacional > Pecuária > Manejo > Nutrição | `nutrition_delete` | Deletar |
| Operacional > Pecuária > Manejo > Sanitário | `sanitary_view` | Visualizar |
| Operacional > Pecuária > Manejo > Sanitário | `sanitary_create` | Criar |
| Operacional > Pecuária > Manejo > Sanitário | `sanitary_edit` | Editar |
| Operacional > Pecuária > Manejo > Sanitário | `sanitary_delete` | Deletar |
| Operacional > Pecuária > Manejo > Desmama | `weaning_view` | Visualizar |
| Operacional > Pecuária > Manejo > Desmama | `weaning_create` | Criar |
| Operacional > Pecuária > Manejo > Desmama | `weaning_edit` | Editar |
| Operacional > Pecuária > Manejo > Desmama | `weaning_delete` | Deletar |
| Operacional > Pecuária > Manejo > Apartação | `separation_view` | Visualizar |
| Operacional > Pecuária > Manejo > Apartação | `separation_create` | Criar |
| Operacional > Pecuária > Manejo > Apartação | `separation_edit` | Editar |
| Operacional > Pecuária > Manejo > Apartação | `separation_delete` | Deletar |
| Operacional > Pecuária > Manejo > Localiza Animal | `find-animal_view` | Visualizar |
| Operacional > Pecuária > Manejo > Localiza Animal | `find-animal_create` | Criar |
| Operacional > Pecuária > Manejo > Localiza Animal | `find-animal_edit` | Editar |
| Operacional > Pecuária > Manejo > Localiza Animal | `find-animal_delete` | Deletar |
| Operacional > Pecuária > Manejo > Pastagem | `pastures_view` | Visualizar |
| Operacional > Pecuária > Manejo > Pastagem | `pastures_create` | Criar |
| Operacional > Pecuária > Manejo > Pastagem | `pastures_edit` | Editar |
| Operacional > Pecuária > Manejo > Pastagem | `pastures_delete` | Deletar |
| Operacional > Pecuária > Manejo > Reprodução > Gerenciamento Avançado | `advanced-reproductive_view` | Visualizar |
| Operacional > Pecuária > Manejo > Reprodução > Estação de Monta | `breeding-seasons_view` | Visualizar |
| Operacional > Pecuária > Manejo > Reprodução > Estação de Monta | `breeding-seasons_create` | Criar |
| Operacional > Pecuária > Manejo > Reprodução > Estação de Monta | `breeding-seasons_edit` | Editar |
| Operacional > Pecuária > Manejo > Reprodução > Estação de Monta | `breeding-seasons_delete` | Deletar |
| Operacional > Pecuária > Manejo > Reprodução > Lotes/Reprodução | `breeding-batch_view` | Visualizar |
| Operacional > Pecuária > Manejo > Reprodução > Lotes/Reprodução | `breeding-batch_create` | Criar |
| Operacional > Pecuária > Manejo > Reprodução > Lotes/Reprodução | `breeding-batch_edit` | Editar |
| Operacional > Pecuária > Manejo > Reprodução > Lotes/Reprodução | `breeding-batch_delete` | Deletar |
| Operacional > Pecuária > Manejo > Reprodução > Touros/Sêmen/Embrião | `bull-seed-season_view` | Visualizar |
| Operacional > Pecuária > Manejo > Reprodução > Touros/Sêmen/Embrião | `bull-seed-season_create` | Criar |
| Operacional > Pecuária > Manejo > Reprodução > Touros/Sêmen/Embrião | `bull-seed-season_edit` | Editar |
| Operacional > Pecuária > Manejo > Reprodução > Touros/Sêmen/Embrião | `bull-seed-season_delete` | Deletar |
| Operacional > Pecuária > Manejo > Reprodução > Protocolos/Estação | `protocols-season_view` | Visualizar |
| Operacional > Pecuária > Manejo > Reprodução > Protocolos/Estação | `protocols-season_create` | Criar |
| Operacional > Pecuária > Manejo > Reprodução > Protocolos/Estação | `protocols-season_edit` | Editar |
| Operacional > Pecuária > Manejo > Reprodução > Protocolos/Estação | `protocols-season_delete` | Deletar |
| Operacional > Pecuária > Manejo > Reprodução > Acasalamento | `breeding-matings_view` | Visualizar |
| Operacional > Pecuária > Manejo > Reprodução > Acasalamento | `breeding-matings_create` | Criar |
| Operacional > Pecuária > Manejo > Reprodução > Acasalamento | `breeding-matings_edit` | Editar |
| Operacional > Pecuária > Manejo > Reprodução > Acasalamento | `breeding-matings_delete` | Deletar |
| Operacional > Pecuária > Manejo > Reprodução > Acasalamento > Diagnóstico de Gestação | `pregnancy-diagnosis_view` | Visualizar |
| Operacional > Pecuária > Manejo > Reprodução > Acasalamento > Diagnóstico de Gestação | `pregnancy-diagnosis_create` | Criar |
| Operacional > Pecuária > Manejo > Reprodução > Acasalamento > Diagnóstico de Gestação | `pregnancy-diagnosis_edit` | Editar |
| Operacional > Pecuária > Manejo > Reprodução > Acasalamento > Diagnóstico de Gestação | `pregnancy-diagnosis_delete` | Deletar |
| Operacional > Pecuária > Confinamento > Cadastros > Pátios | `feedlot-yards_view` | Visualizar |
| Operacional > Pecuária > Confinamento > Cadastros > Pátios | `feedlot-yards_create` | Criar |
| Operacional > Pecuária > Confinamento > Cadastros > Pátios | `feedlot-yards_edit` | Editar |
| Operacional > Pecuária > Confinamento > Cadastros > Pátios | `feedlot-yards_delete` | Deletar |
| Operacional > Pecuária > Confinamento > Cadastros > Setores | `feedlot-sectors_view` | Visualizar |
| Operacional > Pecuária > Confinamento > Cadastros > Setores | `feedlot-sectors_create` | Criar |
| Operacional > Pecuária > Confinamento > Cadastros > Setores | `feedlot-sectors_edit` | Editar |
| Operacional > Pecuária > Confinamento > Cadastros > Setores | `feedlot-sectors_delete` | Deletar |
| Operacional > Pecuária > Confinamento > Cadastros > Currais | `feedlot-corrals_view` | Visualizar |
| Operacional > Pecuária > Confinamento > Cadastros > Currais | `feedlot-corrals_create` | Criar |
| Operacional > Pecuária > Confinamento > Cadastros > Currais | `feedlot-corrals_edit` | Editar |
| Operacional > Pecuária > Confinamento > Cadastros > Currais | `feedlot-corrals_delete` | Deletar |
| Operacional > Pecuária > Confinamento > Nutrição > Dieta | `diets_view` | Visualizar |
| Operacional > Pecuária > Confinamento > Nutrição > Dieta | `diets_create` | Criar |
| Operacional > Pecuária > Confinamento > Nutrição > Dieta | `diets_edit` | Editar |
| Operacional > Pecuária > Confinamento > Nutrição > Dieta | `diets_delete` | Deletar |
| Operacional > Pecuária > Confinamento > Nutrição > Fases/Regras Troca | `feeding-phases_view` | Visualizar |
| Operacional > Pecuária > Confinamento > Nutrição > Fases/Regras Troca | `feeding-phases_create` | Criar |
| Operacional > Pecuária > Confinamento > Nutrição > Fases/Regras Troca | `feeding-phases_edit` | Editar |
| Operacional > Pecuária > Confinamento > Nutrição > Fases/Regras Troca | `feeding-phases_delete` | Deletar |
| Operacional > Pecuária > Confinamento > Nutrição > Batelada | `diet-beats_view` | Visualizar |
| Operacional > Pecuária > Confinamento > Nutrição > Batelada | `diet-beats_create` | Criar |
| Operacional > Pecuária > Confinamento > Nutrição > Batelada | `diet-beats_edit` | Editar |
| Operacional > Pecuária > Confinamento > Nutrição > Batelada | `diet-beats_delete` | Deletar |
| Operacional > Pecuária > Confinamento > Nutrição > Trato Diário | `diet-beat-supplies_view` | Visualizar |
| Operacional > Pecuária > Confinamento > Nutrição > Trato Diário | `diet-beat-supplies_create` | Criar |
| Operacional > Pecuária > Confinamento > Nutrição > Trato Diário | `diet-beat-supplies_edit` | Editar |
| Operacional > Pecuária > Confinamento > Nutrição > Trato Diário | `diet-beat-supplies_delete` | Deletar |
| Operacional > Pecuária > Confinamento > Nutrição > Leitura de Cocho | `trough-readings_view` | Visualizar |
| Operacional > Pecuária > Confinamento > Nutrição > Leitura de Cocho | `trough-readings_create` | Criar |
| Operacional > Pecuária > Confinamento > Nutrição > Leitura de Cocho | `trough-readings_edit` | Editar |
| Operacional > Pecuária > Confinamento > Nutrição > Leitura de Cocho | `trough-readings_delete` | Deletar |
| Operacional > Pecuária > Confinamento > Mapa | `feedlot-map_view` | Visualizar |
| Operacional > Pluviometria | `rainfall_view` | Visualizar |
| Operacional > Pluviometria | `rainfall_create` | Criar |
| Operacional > Pluviometria | `rainfall_edit` | Editar |
| Operacional > Pluviometria | `rainfall_delete` | Deletar |
| Operacional > Vendas > Orçamentos | `budgets_view` | Visualizar |
| Operacional > Vendas > Orçamentos | `budgets_create` | Criar |
| Operacional > Vendas > Orçamentos | `budgets_edit` | Editar |
| Operacional > Vendas > Orçamentos | `budgets_delete` | Deletar |
| Operacional > Vendas > Pedidos | `orders_view` | Visualizar |
| Operacional > Vendas > Pedidos | `orders_create` | Criar |
| Operacional > Vendas > Pedidos | `orders_edit` | Editar |
| Operacional > Vendas > Pedidos | `orders_delete` | Deletar |
| Operacional > Vendas > Vendas | `sales_view` | Visualizar |
| Operacional > Vendas > Vendas | `sales_create` | Criar |
| Operacional > Vendas > Vendas | `sales_edit` | Editar |
| Operacional > Vendas > Vendas | `sales_delete` | Deletar |
| Operacional > Ordens de Serviço > Minhas OS | `my-service-orders_view` | Visualizar |
| Operacional > Ordens de Serviço > Minhas OS | `my-service-orders_edit` | Executar |
| Operacional > Ordens de Serviço > Lista de OS | `service-orders_view` | Visualizar |
| Operacional > Ordens de Serviço > Lista de OS | `service-orders_create` | Criar |
| Operacional > Ordens de Serviço > Lista de OS | `service-orders_edit` | Editar |
| Operacional > Ordens de Serviço > Lista de OS | `service-orders_delete` | Deletar |
| Operacional > Ordens de Serviço > Monitoramento | `monitoring-service-orders_view` | Visualizar |
| Operacional > Ordens de Serviço > Avaliações | `rating-service-orders_view` | Visualizar |
| Operacional > Ordens de Serviço > Avaliações | `rating-service-orders_edit` | Avaliar |
| Financeiro > Contas a Pagar | `expenses_view` | Visualizar |
| Financeiro > Contas a Pagar | `expenses_create` | Criar |
| Financeiro > Contas a Pagar | `expenses_edit` | Editar |
| Financeiro > Contas a Pagar | `expenses_delete` | Deletar |
| Financeiro > Contas a Pagar > Documentos | `expensedocument_view` | Visualizar |
| Financeiro > Contas a Pagar > Documentos | `expensedocument_create` | Criar |
| Financeiro > Contas a Pagar > Documentos | `expensedocument_edit` | Editar |
| Financeiro > Contas a Pagar > Documentos | `expensedocument_delete` | Deletar |
| Financeiro > Contas a Receber | `incomes_view` | Visualizar |
| Financeiro > Contas a Receber | `incomes_create` | Criar |
| Financeiro > Contas a Receber | `incomes_edit` | Editar |
| Financeiro > Contas a Receber | `incomes_delete` | Deletar |
| Financeiro > Contas a Receber > Documentos | `incomedocument_view` | Visualizar |
| Financeiro > Contas a Receber > Documentos | `incomedocument_create` | Criar |
| Financeiro > Contas a Receber > Documentos | `incomedocument_edit` | Editar |
| Financeiro > Contas a Receber > Documentos | `incomedocument_delete` | Deletar |
| Financeiro > Mov. Caixa/Bancário | `movements_view` | Visualizar |
| Financeiro > Mov. Caixa/Bancário | `movements_create` | Criar |
| Financeiro > Mov. Caixa/Bancário | `movements_delete` | Excluir |
| Financeiro > Mov. Caixa/Bancário > Documentos | `movementdocument_view` | Visualizar |
| Financeiro > Mov. Caixa/Bancário > Documentos | `movementdocument_create` | Criar |
| Financeiro > Mov. Caixa/Bancário > Documentos | `movementdocument_edit` | Editar |
| Financeiro > Mov. Caixa/Bancário > Documentos | `movementdocument_delete` | Deletar |
| Financeiro > Fluxo Bancário | `cashflow_view` | Visualizar |
| Financeiro > Conciliação > Importação OFX | `import_ofx_view` | Visualizar |
| Financeiro > Conciliação > Importação OFX | `import_ofx_create` | Criar |
| Financeiro > Conciliação > Importação OFX | `import_ofx_edit` | Editar |
| Financeiro > Conciliação > Importação OFX | `import_ofx_delete` | Deletar |
| Financeiro > Conciliação > Meses Conciliados | `import_ofx` | Importar OFX |
| Financeiro > Gestão Contratos | `contracts_view` | Visualizar |
| Financeiro > Gestão Contratos | `contracts_create` | Criar |
| Financeiro > Gestão Contratos | `contracts_receipt` | Recebimentos |
| Financeiro > Gestão Contratos | `contracts_shippings` | Remessas |
| Financeiro > Gestão Contratos | `contracts_payments` | Pagamentos |
| Financeiro > Gestão Contratos | `contracts_edit` | Editar |
| Financeiro > Gestão Contratos | `contracts_delete` | Deletar |
| Financeiro > Prev. Orçamentária | `budget-plannings_view` | Visualizar |
| Financeiro > Prev. Orçamentária | `budget-plannings_create` | Criar |
| Financeiro > Prev. Orçamentária | `budget-plannings_edit` | Editar |
| Financeiro > Prev. Orçamentária | `budget-plannings_delete` | Deletar |
| Financeiro > Congelamentos Financeiros | `financial-freeze_view` | Visualizar |
| Financeiro > Congelamentos Financeiros | `financial-freeze_create` | Criar |
| Financeiro > Congelamentos Financeiros | `financial-freeze_edit` | Editar |
| Financeiro > Congelamentos Financeiros | `financial-freeze_delete` | Deletar |
| Financeiro > Import. Mov. Bancários | `movement-sheets_view` | Visualizar |
| Financeiro > Import. Mov. Bancários | `movement-sheets_create` | Criar |
| Gestão de Frota > Manutenções | `maintenances_view` | Visualizar |
| Gestão de Frota > Manutenções | `maintenances_create` | Criar |
| Gestão de Frota > Manutenções | `maintenances_edit` | Editar |
| Gestão de Frota > Manutenções | `maintenances_delete` | Deletar |
| Gestão de Frota > Abastecimentos | `appropriation-supplies_view` | Visualizar |
| Gestão de Frota > Abastecimentos | `appropriation-supplies_create` | Criar |
| Gestão de Frota > Abastecimentos | `appropriation-supplies_edit` | Editar |
| Gestão de Frota > Abastecimentos | `appropriation-supplies_delete` | Deletar |
| Gestão de Frota > Manutenções Preventivas | `maintenance-preventives_view` | Visualizar |
| Gestão de Frota > Manutenções Preventivas | `maintenance-preventives_create` | Criar |
| Gestão de Frota > Manutenções Preventivas | `maintenance-preventives_edit` | Editar |
| Gestão de Frota > Manutenções Preventivas | `maintenance-preventives_delete` | Deletar |
| Gestão de Frota > Revisões Agendadas | `scheduled-reviews_view` | Visualizar |
| Gestão de Frota > Transferência Máquinas | `equipment-transfer_view` | Visualizar |
| Gestão de Frota > Transferência Máquinas | `equipment-transfer_create` | Criar |
| Gestão de Frota > Transferência Máquinas | `equipment-transfer_delete` | Cancelar |
| Gestão Fiscal > NFe > NFe Emitidas | `nfe_view` | Visualizar |
| Gestão Fiscal > NFe > NFe Emitidas | `nfe_create` | Criar |
| Gestão Fiscal > NFe > NFe Emitidas | `nfe_edit` | Editar |
| Gestão Fiscal > NFe > NFe Emitidas | `nfe_delete` | Deletar |
| Gestão Fiscal > NFe > NFe Emitidas | `generates_financial` | Gera Financeiro |
| Gestão Fiscal > NFe > Aprovação de Notas | `dfe-drafts_fiscal_view` | Visualizar |
| Gestão Fiscal > NFe > Aprovação de Notas | `dfe-drafts_fiscal_approve` | Aprovar e Lançar |
| Gestão Fiscal > NFe > Aprovação de Notas | `dfe-drafts_fiscal_ignore` | Ignorar/Reprocessar |
| Gestão Fiscal > NFe > Arquivos XML | `xml_view` | Visualizar |
| Gestão Fiscal > MDFe > Lista de MDFe | `mdfe_view` | Visualizar |
| Gestão Fiscal > MDFe > Lista de MDFe | `mdfe_edit` | Editar |
| Gestão Fiscal > MDFe > Lista de MDFe | `mdfe_delete` | Deletar |
| Gestão Fiscal > MDFe > Nova MDFe | `mdfe_create` | Criar |
| Gestão Fiscal > NFSe Recebidas | `nfse_view` | Visualizar |
| Gestão Fiscal > NFSe Recebidas | `nfse_create` | Buscar |
| Gestão Fiscal > NFSe Recebidas | `nfse_launch` | Lançar |
| Gestão Fiscal > NFSe Recebidas | `nfse_danfe` | Gerar DANFE |
| Gestão Fiscal > NFSe Recebidas | `nfse_xml` | Baixar XML |
| Gestão Fiscal > LCDPR | `cash-book_view` | Visualizar |
| Gestão Fiscal > LCDPR | `cash-book_create` | Criar |
| Gestão Fiscal > LCDPR | `cash-book_delete` | Deletar |
| Gestão Fiscal > SPED Fiscal | `sped-fiscal_view` | Visualizar |
| Gestão Fiscal > SPED Fiscal | `sped-fiscal_create` | Criar |
| Gestão Fiscal > SPED Fiscal | `sped-fiscal_delete` | Deletar |
| Gestão Fiscal > Partida Dobrada | `double-entry-accountings_view` | Visualizar |
| Gestão Fiscal > Partida Dobrada | `double-entry-accountings_create` | Criar |
| Gestão Fiscal > Partida Dobrada | `double-entry-accountings_edit` | Editar |
| Gestão Fiscal > Partida Dobrada | `double-entry-accountings_delete` | Deletar |
| Relatórios > Bens/Ativo > Inventário | `equipments_report` | Visualizar |
| Relatórios > Bens/Ativo > Depreciação Acumulada | `accumulateddepreciationreport_view` | Visualizar |
| Relatórios > Pecuária > Composição Rebanho | `herd-composition-report_view` | Visualizar |
| Relatórios > Pecuária > Custeio/Área Pecuária | `cust-area-pec-report_view` | Visualizar |
| Relatórios > Pecuária > Pesagem/Animal | `weighing-batch-report_view` | Visualizar |
| Relatórios > Pecuária > Pesagem/Lote | `accumulated-weighing-batch-report_view` | Visualizar |
| Relatórios > Pecuária > Pesagem Confinamento | `feedlot-weighing-performance-report_view` | Visualizar |
| Relatórios > Pecuária > Nutrição Consumo/Lote | `nutrition_report` | Visualizar |
| Relatórios > Pecuária > Sanitário/Lote | `sanitaries-batch-report_view` | Visualizar |
| Relatórios > Pecuária > Manejo/Lote | `management-batch-report_view` | Visualizar |
| Relatórios > Pecuária > Estq. Animais/Categoria | `category-animal-report_view` | Visualizar |
| Relatórios > Pecuária > Transf/Lote/Módulo/Área | `transfer-batch-module-area-report_view` | Visualizar |
| Relatórios > Pecuária > Estoque/Rebanho | `animals-report_view` | Visualizar |
| Relatórios > Pecuária > Aplicação/Manejo | `application-management-report_view` | Visualizar |
| Relatórios > Pecuária > Movimentação/Rebanho | `animal-movements-report_view` | Visualizar |
| Relatórios > Pecuária > Desmamas | `weaning-report_view` | Visualizar |
| Relatórios > Pecuária > Nascimentos | `birth-report_view` | Visualizar |
| Relatórios > Pecuária > Mortes | `death-animals-report_view` | Visualizar |
| Relatórios > Pecuária > Ficha Animal | `animal-record-report_view` | Visualizar |
| Relatórios > Pecuária > Vacas Prenhas | `pregnant-cows-report_view` | Visualizar |
| Relatórios > Pecuária > Vendas/Animais | `animals-sales-report_view` | Visualizar |
| Relatórios > Pecuária > Compras/Animais | `animals-purchases-report_view` | Visualizar |
| Relatórios > Pecuária > Evolução/Rebanho | `evolution-animal-report_view` | Visualizar |
| Relatórios > Pecuária > Identificação/SISBOV | `identification-animals-sisbovs-report_view` | Visualizar |
| Relatórios > Pecuária > Mortes/SISBOV | `death-animals-sisbovs-report_view` | Visualizar |
| Relatórios > Pecuária > Nascimentos/SISBOV | `birth-animals-sisbovs-report_view` | Visualizar |
| Relatórios > Pecuária > Custeio/Lote | `costing-batch-report_view` | Visualizar |
| Relatórios > Pecuária > Custeio/Módulo | `costing-grazing-report_view` | Visualizar |
| Relatórios > Pecuária > Custeio/Animal | `costing-animal-report_view` | Visualizar |
| Relatórios > Pecuária > Custo Total/Reprodução | `total-cost-of-reproduction-report_view` | Visualizar |
| Relatórios > Pecuária > Performance Animal | `batch-profitability-report_view` | Visualizar |
| Relatórios > Pecuária > Histórico Reprodutivo | `reproductive-history-report_view` | Visualizar |
| Relatórios > Pecuária > Registro Genealógico | `animal-family-tree-report_view` | Visualizar |
| Relatórios > Pecuária > Eficiencia Reprodutiva Touro | `bull-reproductive-efficiency-report_view` | Visualizar |
| Relatórios > Pecuária > Análise Mov. Lote | `animal-movement-analysis-report_view` | Visualizar |
| Relatórios > Pecuária > Prod. Receptora | `receiver-cow-productivity-report_view` | Visualizar |
| Relatórios > Pecuária > Animais por Lote | `animals-per-batch-report_view` | Visualizar |
| Relatórios > Pecuária > Histórico de Animais/Lote | `animal-batch-history-report_view` | Visualizar |
| Relatórios > Pecuária > Lotes Confinamento | `feedlot-batch-control-report_view` | Visualizar |
| Relatórios > Pecuária > Consumo/Planejado | `feedlot-planned-consumption-report_view` | Visualizar |
| Relatórios > Pecuária > Atividades/Confinamento | `feedlot-summary-activity-report_view` | Visualizar |
| Relatórios > Pluviometria | `rainfall-report_view` | Visualizar |
| Relatórios > Financeiro > Agenda/Pagamentos | `payment-schedule_view` | Visualizar |
| Relatórios > Financeiro > Agenda/Recebimentos | `receipt-schedule_view` | Visualizar |
| Relatórios > Financeiro > C. à Pagar | `expenses_report` | Visualizar |
| Relatórios > Financeiro > C. Pagas | `expenses_paid_report` | Visualizar |
| Relatórios > Financeiro > C. à Receber | `incomes_report` | Visualizar |
| Relatórios > Financeiro > C. Recebidas | `incomes_paid_report` | Visualizar |
| Relatórios > Financeiro > Juros Recebidos | `received_interest_report` | Visualizar |
| Relatórios > Financeiro > Juros Pagos | `paid_interest_report` | Visualizar |
| Relatórios > Financeiro > Extrato Fin. | `movements_report` | Visualizar |
| Relatórios > Financeiro > Livro Razão | `ledger_report` | Visualizar |
| Relatórios > Financeiro > Razão Categoria | `ledger_caregory_report` | Visualizar |
| Relatórios > Financeiro > Rec. Prev. X Real | `rec_prev_report` | Visualizar |
| Relatórios > Financeiro > Pag. Prev. X Real | `pag_prev_report` | Visualizar |
| Relatórios > Financeiro > Prev. x Reali. Anual | `budget-planning-predicted_view` | Visualizar |
| Relatórios > Financeiro > Fluxo de Caixa Mensal | `cashflow_by_category_report` | Visualizar |
| Relatórios > Financeiro > Fluxo de Caixa Mensal Previsto | `cashflow_forecast_report` | Visualizar |
| Relatórios > Financeiro > Movimento Bancário | `financial-movement-report_view` | Visualizar |
| Relatórios > Financeiro > Fiscal/Não Fiscal | `fiscal-difference-report_view` | Visualizar |
| Relatórios > Financeiro > Custo de Produção | `incomestatement_view` | Visualizar |
| Relatórios > Financeiro > Custo de Produção Acumulado | `accumulatedincomestatement_view` | Visualizar |
| Relatórios > Financeiro > DRE | `dre_view` | Visualizar |
| Relatórios > Financeiro > DRE Anual | `dre_annual_view` | Visualizar |
| Relatórios > Financeiro > Fluxo Mensal de Pagamento | `monthly-payment-flow_view` | Visualizar |
| Relatórios > Financeiro > Fluxo Mensal de Recebimento | `monthly-receipt-flow_view` | Visualizar |
| Relatórios > Financeiro > Estoque Financeiro | `cashflow_product_report` | Visualizar |
| Relatórios > Financeiro > Centro de Custo | `cost_centers_report` | Visualizar |
| Relatórios > Financeiro > Apuração de Custo | `cost_calculation_report` | Visualizar |
| Relatórios > Financeiro > Financiamentos | `financings_report` | Visualizar |
| Relatórios > Financeiro > Adiantamento | `advance-titles_report` | Visualizar |
| Relatórios > Financeiro > Conciliação de Contas | `account-reconciliation_report` | Visualizar |
| Relatórios > Financeiro > Centro de Custo/Unificado | `cost_centers_unified_report` | Visualizar |
| Relatórios > Financeiro > Contas Tributárias | `tax_accounts_report` | Visualizar |
| Relatórios > Financeiro > Consolidado Pagar/Receber | `accounts_payable_receivable_report` | Visualizar |
| Relatórios > Financeiro > Saldo Devedor/Fornecedor | `provider_balance_report` | Visualizar |
| Relatórios > Estoque > Mov. Estoque | `stock_movement_report` | Visualizar |
| Relatórios > Estoque > Requisição/Saída | `requisitions_report` | Visualizar |
| Relatórios > Estoque > Baixas Estoque | `stock_writeoffs_report` | Visualizar |
| Relatórios > Estoque > DFe/Lançadas | `dfe_report` | Visualizar |
| Relatórios > Estoque > Custo Produção Batida | `food-beat_report` | Visualizar |
| Relatórios > Estoque > Curva ABC/Estoque | `stocks-abc_report` | Visualizar |
| Relatórios > Estoque > Recebimentos | `receipts_report` | Visualizar |
| Relatórios > Estoque > Estoque Consolidado | `stocks-consolidated_report` | Visualizar |
| Relatórios > Estoque > Lote/Fornecedor | `stocks-lot-provider_report` | Visualizar |
| Relatórios > Estoque > Saídas x Centro Custo | `products-exit-cost-center_report` | Visualizar |
| Relatórios > Suprimentos > Suprimentos | `supplies_view` | Visualizar |
| Relatórios > Suprimentos > Savings | `savings_view` | Visualizar |
| Relatórios > Suprimentos > ANS | `ans_report_view` | Visualizar |
| Relatórios > Suprimentos > Orçamentos | `request-quotation_report_view` | Visualizar |
| Relatórios > Suprimentos > Produtos x Prev. Entrega | `request-purchase-forecast-report_report_view` | Visualizar |
| Relatórios > Suprimentos > Relatório SLA | `status-sla_report_view` | Relatório |
| Relatórios > Suprimentos > Gerencial de Solicitações | `request-purchase-management_report_view` | Visualizar |
| Relatórios > Vendas > Vendas/Cliente | `sales_report` | Visualizar |
| Relatórios > Vendas > Vendas/Produto | `sales-products_report` | Visualizar |
| Relatórios > Vendas > Cliente/Produto | `sale-clients_report` | Visualizar |
| Relatórios > Vendas > Vendas/Funcionário | `sale-employees_report` | Visualizar |
| Relatórios > Vendas > Curva ABC | `sales-abc_report` | Visualizar |
| Relatórios > Gestão Pessoal > Apuração Mensal | `earnings_view` | Visualizar |
| Relatórios > Gestão Pessoal > Aniversariantes | `birthdays_view` | Visualizar |
| Relatórios > Gestão Pessoal > Horas Logadas | `logged-hours_view` | Visualizar |
| Relatórios > Gestão Pessoal > Funcionários Ativos | `active-employees_view` | Visualizar |
| Relatórios > Gestão Pessoal > Adiant. Salarial | `advances_report` | Visualizar |
| Relatórios > Gestão Fiscal > Partida Dobrada | `double-entry-accountings_report` | Visualizar |
| Relatórios > Gestão Fiscal > NFe/Emitidas | `nfe_report` | Visualizar |
| Relatórios > Gestão Fiscal > Faturamento | `nfe_product_report` | Visualizar |
| Relatórios > Gestão Fiscal > Livro Caixa | `cash-book-report_view` | Visualizar |
| Relatórios > Gestão de Frotas > Máquinas | `machinesreport_view` | Visualizar |
| Relatórios > Gestão de Frotas > Abastecimentos | `machines-supply_view` | Visualizar |
| Relatórios > Gestão de Frotas > Manutenções | `machines-maintenance_view` | Visualizar |
| Integrações > Software Domínio | `integration_dominios_view` | Visualizar |
| Integrações > Software Domínio | `integration_dominios_create` | Criar |
| Integrações > Software Domínio | `integration_dominios_edit` | Editar |
| Integrações > Software Domínio | `integration_dominios_delete` | Deletar |
| Integrações > CTA Smart - Configuração | `integration_cta_smart_view` | Visualizar |
| Integrações > CTA Smart - Configuração | `integration_cta_smart_edit` | Editar |
| Integrações > CTA Smart - Abastecimentos | `cta_smart_supplies_view` | Visualizar |
| Integrações > CTA Smart - Abastecimentos | `cta_smart_supplies_edit` | Editar |
| Integrações > Export./Domínio > Movimento Bancário | `export_movements_dominios_view` | Movimento Bancário |
| Integrações > Export./Domínio > Folha Salarial | `export_payments_dominio_view` | Folha Salarial |
| Integrações > Export./Domínio > C. Pagar/Receber | `export_expenses_incomes_dominio_view` | Contas Pagar/Receber |
| Integrações > Export./Domínio > NFSe | `export_nfs_dominio_view` | NFS-e |
| Integrações > Exportações/CSV > Exportações/CSV | `financial_export` | Contas Pagas/Recebidas |
