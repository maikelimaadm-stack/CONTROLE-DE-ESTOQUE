<!-- GERADO por apps/api/test/unit/report-scope.test.ts — rode com UPDATE_REPORT_MATRIX=1 para atualizar -->
# Matriz de escopo empresarial dos relatórios

Uma linha por relatório do catálogo (`apps/api/src/routes/reports.ts`). `Estratégia` diz, para cada fonte
com coluna de empresa: **predicado** (recorte próprio), **junção** (recorte herdado de uma fonte já
recortada) ou **derivado** (declarado na definição, com justificativa). Nenhuma linha fica sem auditoria.

| Relatório | Permissão | Módulo | Fontes de empresa (estratégia) | Situação |
| --- | --- | --- | --- | --- |
| stock_movement | report.stock_movement | estoque | stock_movements (predicado), warehouses (junção) | OK |
| stocks_consolidated | report.stocks_consolidated | estoque | warehouses (predicado) | OK |
| stocks_lot_provider | report.stocks_lot_provider | estoque | warehouses (predicado) | OK |
| requisitions | report.requisitions | estoque | requisitions (predicado) | OK |
| exits_cost_center | report.exits_cost_center | estoque | stock_movements (predicado) | OK |
| stock_writeoffs | report.stock_writeoffs | estoque | stock_writeoffs (predicado) | OK |
| receipts | report.receipts | estoque | invoices (predicado) | OK |
| stocks_abc | report.stocks_abc | estoque | warehouses (predicado) | OK |
| feed_batch_cost | report.feed_batch_cost | estoque | feed_batches (predicado) | OK |
| dfe | report.dfe | estoque | sem fonte de empresa | OK |
| payables | report.payables | financeiro | financial_titles (predicado) | OK |
| paid | report.paid | financeiro | financial_titles (predicado) | OK |
| receivables | report.receivables | financeiro | financial_titles (predicado) | OK |
| received | report.received | financeiro | financial_titles (predicado) | OK |
| payment_schedule | report.payment_schedule | financeiro | financial_titles (predicado) | OK |
| receipt_schedule | report.receipt_schedule | financeiro | financial_titles (predicado) | OK |
| paid_interest | report.paid_interest | financeiro | financial_titles (predicado) | OK |
| received_interest | report.received_interest | financeiro | financial_titles (predicado) | OK |
| bank_statement | report.bank_statement | organização | bank_movements (junção) | ORGANIZAÇÃO JUSTIFICADO |
| financial_movement | report.financial_movement | financeiro | bank_movements (predicado) | OK |
| ledger_category | report.ledger_category | financeiro | financial_titles (predicado) | OK |
| ledger | report.ledger | financeiro | bank_movements (predicado) | OK |
| cash_flow_category | report.cash_flow_category | financeiro | bank_movements (predicado) | OK |
| cash_flow_forecast | report.cash_flow_forecast | financeiro | financial_titles (predicado) | OK |
| payment_cashflow | report.payment_cashflow | financeiro | financial_titles (predicado) | OK |
| receipt_cashflow | report.receipt_cashflow | financeiro | financial_titles (predicado) | OK |
| pag_prev_real | report.pag_prev_real | financeiro | budget_plannings (predicado), financial_titles (predicado) | OK |
| rec_prev_real | report.rec_prev_real | financeiro | budget_plannings (predicado), financial_titles (predicado) | OK |
| budget_predicted | report.budget_predicted | financeiro | budget_plannings (predicado), financial_titles (predicado) | OK |
| dre | report.dre | financeiro | financial_titles (predicado) | OK |
| dre_annual | report.dre_annual | financeiro | financial_titles (predicado) | OK |
| income_statement | report.income_statement | financeiro | financial_titles (predicado), stock_movements (predicado) | OK |
| cost_center | report.cost_center | financeiro | financial_titles (predicado) | OK |
| provider_balance | report.provider_balance | financeiro | financial_titles (predicado) | OK |
| payable_receivable | report.payable_receivable | financeiro | financial_titles (predicado) | OK |
| advance_titles | report.advance_titles | financeiro | financial_titles (predicado) | OK |
| fiscal_difference | report.fiscal_difference | financeiro | financial_titles (predicado) | OK |
| account_reconciliation | report.account_reconciliation | financeiro | bank_movements (predicado) | OK |
| cost_centers_unified | report.cost_centers_unified | financeiro | financial_titles (predicado), stock_movements (predicado) | OK |
| cashflow_product | report.cashflow_product | financeiro | stock_movements (predicado) | OK |
| supplies | report.supplies | compras | purchase_requests (predicado) | OK |
| savings | report.savings | compras | purchase_requests (predicado) | OK |
| supply_sla | report.supply_sla | compras | purchase_requests (predicado) | OK |
| quotations | report.quotations | compras | purchase_requests (predicado) | OK |
| purchase_management | report.purchase_management | compras | purchase_requests (predicado) | OK |
| purchase_forecast | report.purchase_forecast | compras | purchase_requests (predicado) | OK |
| sales_client | report.sales_client | vendas | sales_documents (predicado) | OK |
| sales_product | report.sales_product | vendas | sales_documents (predicado) | OK |
| sales_client_product | report.sales_client_product | vendas | sales_documents (predicado) | OK |
| sales_employee | report.sales_employee | vendas | sales_documents (predicado) | OK |
| herd_composition | report.herd_composition | pecuaria | animals (predicado), herd_lots (predicado) | OK |
| animals | report.animals | pecuaria | animals (predicado), batches (junção) | OK |
| animals_per_batch | report.animals_per_batch | pecuaria | animals (junção), herd_lots (junção), batches (predicado), grazing_modules (junção), areas (junção) | OK |
| category_animal | report.category_animal | pecuaria | animal_movements (predicado), animals (derivado) | OK |
| animal_movements | report.animal_movements | pecuaria | animal_movements (predicado) | OK |
| birth | report.birth | pecuaria | animal_movements (predicado), animals (derivado) | OK |
| death | report.death | pecuaria | animal_movements (predicado), animals (derivado) | OK |
| animal_sales | report.animal_sales | pecuaria | animal_movements (predicado), animals (derivado) | OK |
| animal_purchases | report.animal_purchases | pecuaria | animal_movements (predicado), animals (derivado) | OK |
| weaning | report.weaning | pecuaria | animal_handlings (predicado) | OK |
| weighing_animal | report.weighing_animal | pecuaria | weighings (predicado), batches (junção) | OK |
| weighing_batch | report.weighing_batch | pecuaria | weighings (predicado), batches (junção) | OK |
| feedlot_weighing | report.feedlot_weighing | confinamento | batches (predicado), animals (junção) | OK |
| nutrition_batch | report.nutrition_batch | pecuaria | animal_handlings (predicado), batches (junção) | OK |
| sanitary_batch | report.sanitary_batch | pecuaria | animal_handlings (predicado), batches (junção) | OK |
| management_batch | report.management_batch | pecuaria | animal_handlings (predicado), batches (junção) | OK |
| application_management | report.application_management | pecuaria | animal_handlings (predicado) | OK |
| pregnant_cows | report.pregnant_cows | pecuaria | animals (predicado), batches (junção) | OK |
| reproductive_history | report.reproductive_history | pecuaria | breeding_seasons (predicado) | OK |
| bull_efficiency | report.bull_efficiency | pecuaria | sem fonte de empresa | OK |
| family_tree | report.family_tree | pecuaria | animals (predicado) | OK |
| animal_record | report.animal_record | pecuaria | animal_handlings (derivado), animals (predicado) | OK |
| costing_batch | report.costing_batch | pecuaria | animals (junção), herd_lots (junção), animal_handlings (junção), feed_deliveries (junção), animal_retroactive_costs (junção), batches (predicado) | OK |
| costing_module | report.costing_module | pecuaria | batches (junção), animal_handlings (junção), grazing_modules (predicado) | OK |
| costing_animal | report.costing_animal | pecuaria | animal_handlings (derivado), animals (predicado), batches (junção) | OK |
| costing_livestock_area | report.costing_livestock_area | pecuaria | financial_titles (derivado), areas (predicado) | OK |
| batch_profitability | report.batch_profitability | pecuaria | animal_handlings (junção), batches (predicado), animals (junção) | OK |
| herd_evolution | report.herd_evolution | pecuaria | animal_movements (predicado) | OK |
| transfer_batch_area | report.transfer_batch_area | pecuaria | animal_movements (predicado), batches (junção), grazing_modules (junção), areas (junção) | OK |
| animal_batch_history | report.animal_batch_history | pecuaria | animal_movements (predicado), batches (junção) | OK |
| batch_movement_analysis | report.batch_movement_analysis | pecuaria | animal_movements (junção), animals (junção), batches (predicado) | OK |
| receiver_productivity | report.receiver_productivity | pecuaria | sem fonte de empresa | OK |
| reproduction_cost | report.reproduction_cost | pecuaria | breeding_seasons (predicado) | OK |
| sisbov_identification | report.sisbov_identification | pecuaria | animals (predicado) | OK |
| sisbov_birth | report.sisbov_birth | pecuaria | animals (predicado) | OK |
| sisbov_death | report.sisbov_death | pecuaria | animals (predicado) | OK |
| feedlot_batch_control | report.feedlot_batch_control | confinamento | animals (junção), feed_deliveries (junção), batches (predicado) | OK |
| feedlot_planned_consumption | report.feedlot_planned_consumption | confinamento | trough_readings (junção), feed_deliveries (predicado) | OK |
| feedlot_activity | report.feedlot_activity | confinamento | diet_batches (predicado), feed_deliveries (predicado), trough_readings (predicado) | OK |
| equipment | report.equipment | frota_ativos | equipments (predicado) | OK |
| accumulated_depreciation | report.accumulated_depreciation | frota_ativos | equipments (predicado) | OK |
| machines | report.machines | frota_ativos | fuel_supplies (junção), equipments (predicado) | OK |
| machine_supplies | report.machine_supplies | frota_ativos | fuel_supplies (predicado), equipments (junção) | OK |
| machine_maintenances | report.machine_maintenances | frota_ativos | maintenances (predicado), equipments (derivado) | OK |
| monthly_calculation | report.monthly_calculation | pessoas_rh | earnings (predicado) | OK |
| birthdays | report.birthdays | pessoas_rh | sem fonte de empresa | OK |
| active_employees | report.active_employees | pessoas_rh | sem fonte de empresa | OK |
| advances | report.advances | pessoas_rh | salary_advances (predicado), financial_titles (junção) | OK |
| logged_hours | report.logged_hours | pessoas_rh | sem fonte de empresa | OK |
| rainfall | report.rainfall | pecuaria | rainfalls (predicado) | OK |
| journal_entries | report.journal_entries | fiscal | journal_entries (predicado) | OK |
| cash_book | report.cash_book | fiscal | bank_movements (predicado) | OK |
| nfe_product | report.nfe_product | fiscal | sales_documents (predicado) | OK |
| financings | report.financings | financeiro | bank_movements (predicado) | OK |
| cost_calculation | report.cost_calculation | financeiro | financial_titles (predicado), stock_movements (predicado) | OK |
| accumulated_income_statement | report.accumulated_income_statement | financeiro | financial_titles (predicado), stock_movements (predicado) | OK |
| ans | report.ans | compras | purchase_requests (predicado) | OK |
