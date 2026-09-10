# Paridade de Relatórios

_Gerado por `node scripts/parity.mjs` em 2026-09-10 a partir de docs/reference/SYSTEM-INVENTORY.md (455 telas) e do código deste repositório. Legenda de status: NÃO INICIADO · MAPEADO · EM IMPLEMENTAÇÃO · IMPLEMENTADO · TESTADO (coberto por teste automatizado) · BLOQUEADO · NÃO APLICÁVEL · MELHORADO (comportamento intencionalmente diferente/superior, ver observação)._

Referência: 120 telas de relatório (docs/reference/REPORTS.md). Nosso runner genérico (`/relatorios/[key]`) possui 107 relatórios com filtros server-side, totais, CSV e XLSX. Cobertura: 116/120 (96.7%).

| ID | Relatório (referência) | Módulo | Nosso relatório | Status | Observação |
|---|---|---|---|---|---|
| SCR-013 | Meses Conciliados | Conciliação | `/financeiro/ofx/relatorio` | IMPLEMENTADO |  |
| SCR-030 | Endereçamentos | Estrutura > Produtos | `/cadastros/addressings` | IMPLEMENTADO |  |
| SCR-138 | Análise do Fluxo Bancário | Financeiro | `/financeiro/fluxo` | TESTADO |  |
| SCR-154 | Relatório Inventário Patrimonial | Bens/Ativo | `/relatorios/equipment` | IMPLEMENTADO |  |
| SCR-155 | Relatorio de Depreciação Acumulada | Bens/Ativo | `/relatorios/accumulated_depreciation` | IMPLEMENTADO |  |
| SCR-156 | Composição Rebanho | Pecuária | `/relatorios/herd_composition` | IMPLEMENTADO |  |
| SCR-157 | Custeio/Área Pecuária | Pecuária | `/relatorios/costing_livestock_area` | IMPLEMENTADO |  |
| SCR-158 | Relatório Pesagem/Animal | Pecuária | `/relatorios/weighing_animal` | IMPLEMENTADO |  |
| SCR-159 | Relatório Pesagem/Lote | Pecuária | `/relatorios/weighing_batch` | IMPLEMENTADO |  |
| SCR-160 | Relatório de Pesagem do Confinamento | Pecuária | `/relatorios/feedlot_weighing` | IMPLEMENTADO |  |
| SCR-161 | Relatório Nutrição: Consumo / Lote | Pecuária | `/relatorios/nutrition_batch` | IMPLEMENTADO |  |
| SCR-162 | Relatório Sanitário/lote | Pecuária | `/relatorios/sanitary_batch` | IMPLEMENTADO |  |
| SCR-163 | Relatório Manejo/lote | Pecuária | `/relatorios/management_batch` | IMPLEMENTADO |  |
| SCR-164 | Relatório Animais/Categoria | Pecuária | `/relatorios/category_animal` | IMPLEMENTADO |  |
| SCR-165 | Transferência Lote/Módulo/Área | Pecuária | `/relatorios/transfer_batch_area` | IMPLEMENTADO |  |
| SCR-166 | Estoque de Rebanho | Pecuária | `/relatorios/animals` | IMPLEMENTADO |  |
| SCR-167 | Relatório Aplicação/Manejo da Pecuária | Pecuária | `/relatorios/application_management` | IMPLEMENTADO |  |
| SCR-168 | Relatório de Movimentação de Rebanho | Pecuária | `/relatorios/animal_movements` | IMPLEMENTADO |  |
| SCR-169 | Relatório Desmama | Pecuária | `/relatorios/weaning` | IMPLEMENTADO |  |
| SCR-170 | Relatório Nascimentos | Pecuária | `/relatorios/birth` | IMPLEMENTADO |  |
| SCR-171 | Relatório Mortes | Pecuária | `/relatorios/death` | IMPLEMENTADO |  |
| SCR-172 | Relatório Ficha Animal | Pecuária | `/relatorios/animal_record` | IMPLEMENTADO |  |
| SCR-173 | Relatório Vacas Prenhas | Pecuária | `/relatorios/pregnant_cows` | IMPLEMENTADO |  |
| SCR-174 | Relatório Vendas de Animais | Pecuária | `/relatorios/animal_sales` | IMPLEMENTADO |  |
| SCR-175 | Relatório Compras de Animais | Pecuária | `/relatorios/animal_purchases` | IMPLEMENTADO |  |
| SCR-176 | Relatório Evolução de Rebanho | Pecuária | `/relatorios/herd_evolution` | IMPLEMENTADO |  |
| SCR-177 | Relatório Identificação/SISBOV | Pecuária | `/relatorios/sisbov_identification` | IMPLEMENTADO |  |
| SCR-178 | Relatório Mortes/SISBOV | Pecuária | `/relatorios/sisbov_death` | IMPLEMENTADO |  |
| SCR-179 | Relatório Nascimentos/SISBOV | Pecuária | `/relatorios/sisbov_birth` | IMPLEMENTADO |  |
| SCR-180 | Relatório Custo/Lote | Pecuária | `/relatorios/costing_batch` | IMPLEMENTADO |  |
| SCR-181 | Relatório Custo/Módulo | Pecuária | `/relatorios/costing_module` | IMPLEMENTADO |  |
| SCR-182 | Relatório Custo/Animal | Pecuária | `/relatorios/costing_animal` | IMPLEMENTADO |  |
| SCR-183 | Relatório Custo Total de Reprodução | Pecuária | `/relatorios/reproduction_cost` | IMPLEMENTADO |  |
| SCR-184 | Relatório de Performance Animal Individual | Pecuária | `/relatorios/batch_profitability` | IMPLEMENTADO |  |
| SCR-185 | Relatório Histórico Reprodutivo das Matrizes | Pecuária | `/relatorios/reproductive_history` | IMPLEMENTADO |  |
| SCR-186 | Registro Genealógico | Pecuária | `/relatorios/family_tree` | IMPLEMENTADO |  |
| SCR-187 | Relatório de Eficiência de Reprodução de Touros | Pecuária | `/relatorios/bull_efficiency` | IMPLEMENTADO |  |
| SCR-188 | Relatório de Análise de Movimentação Lote | Pecuária | `/relatorios/batch_movement_analysis` | IMPLEMENTADO |  |
| SCR-189 | Relatório de Produtividade De Receptora | Pecuária | `/relatorios/receiver_productivity` | IMPLEMENTADO |  |
| SCR-190 | Relatório de Animais por Lote com Visualização Detalhada ou Geral | Pecuária | `/relatorios/animals_per_batch` | IMPLEMENTADO |  |
| SCR-191 | Relatório Histórico de Animais/Lote | Pecuária | `/relatorios/animal_batch_history` | IMPLEMENTADO |  |
| SCR-192 | Relatório Controle de Lotes Ativos no Confinamento | Pecuária | `/relatorios/feedlot_batch_control` | IMPLEMENTADO |  |
| SCR-193 | Relatório de Cosnumo/Planejado | Pecuária | `/relatorios/feedlot_planned_consumption` | IMPLEMENTADO |  |
| SCR-194 | Relatório Operacional Diário com Resumo das Atividades do Confinamento | Pecuária | `/relatorios/feedlot_activity` | IMPLEMENTADO |  |
| SCR-195 | Relatório de Pluviometria | Relatórios | `/relatorios/rainfall` | IMPLEMENTADO |  |
| SCR-196 | Agenda de Recebimentos | Financeiro | `/relatorios/receipt_schedule` | IMPLEMENTADO |  |
| SCR-197 | Contas a Pagar | Financeiro | `/relatorios/payables` | IMPLEMENTADO |  |
| SCR-198 | Contas Pagas | Financeiro | `/relatorios/paid` | TESTADO |  |
| SCR-199 | Contas a Receber | Financeiro | `/relatorios/receivables` | IMPLEMENTADO |  |
| SCR-200 | Contas Recebidas | Financeiro | `/relatorios/received` | IMPLEMENTADO |  |
| SCR-201 | Relatório de Juros Recebidos | Financeiro | `/relatorios/received_interest` | IMPLEMENTADO |  |
| SCR-202 | Relatório de Juros Pagos | Financeiro | `/relatorios/paid_interest` | IMPLEMENTADO |  |
| SCR-203 | Extrato Financeiro | Financeiro | `/relatorios/bank_statement` | TESTADO |  |
| SCR-204 | Razão Contábil | Financeiro | `/relatorios/ledger` | IMPLEMENTADO |  |
| SCR-205 | Razão Categoria | Financeiro | `/relatorios/ledger_category` | IMPLEMENTADO |  |
| SCR-206 | Recebimento Previsto X Realizado | Financeiro | `/relatorios/rec_prev_real` | IMPLEMENTADO |  |
| SCR-207 | Pagamento Previsto X Realizado | Financeiro | `/relatorios/pag_prev_real` | IMPLEMENTADO |  |
| SCR-208 | Previsto x Realizado Anual | Financeiro | `/relatorios/budget_predicted` | IMPLEMENTADO |  |
| SCR-209 | Acesse mais e melhor crédito! | Financeiro | `/relatorios/cash_flow_category` | IMPLEMENTADO |  |
| SCR-210 | Acesse mais e melhor crédito! | Financeiro | `/relatorios/cash_flow_forecast` | IMPLEMENTADO |  |
| SCR-211 | Movimentação Bancária/Financeira | Financeiro | `/relatorios/financial_movement` | IMPLEMENTADO |  |
| SCR-212 | Fiscal/Não Fiscal | Financeiro | `/relatorios/fiscal_difference` | IMPLEMENTADO |  |
| SCR-213 | Custo de Produção por Período | Financeiro | `/relatorios/income_statement` | IMPLEMENTADO |  |
| SCR-214 | Custo de Produção por Mês | Financeiro | `/relatorios/accumulated_income_statement` | IMPLEMENTADO |  |
| SCR-215 | Acesse mais e melhor crédito! | Financeiro | `/relatorios/dre` | IMPLEMENTADO |  |
| SCR-216 | Acesse mais e melhor crédito! | Financeiro | `/relatorios/dre_annual` | IMPLEMENTADO |  |
| SCR-217 | Acesse mais e melhor crédito! | Financeiro | `/relatorios/receipt_cashflow` | IMPLEMENTADO |  |
| SCR-218 | Relatório de Estoque/Financeiro | Financeiro | `/relatorios/cashflow_product` | IMPLEMENTADO |  |
| SCR-219 | Acesse mais e melhor crédito! | Financeiro | `/relatorios/cost_center` | IMPLEMENTADO |  |
| SCR-220 | Relatório de Apuração de Custos por Conta e Centro de Custo | Financeiro | `/relatorios/cost_calculation` | IMPLEMENTADO |  |
| SCR-221 | Relatório Financiamentos | Financeiro | `/relatorios/financings` | IMPLEMENTADO |  |
| SCR-222 | Títulos de Adiantamento | Financeiro | `/relatorios/advance_titles` | IMPLEMENTADO |  |
| SCR-223 | Relatório de Conciliação de Contas Consolidadas | Financeiro | `/relatorios/account_reconciliation` | IMPLEMENTADO |  |
| SCR-224 | Acesse mais e melhor crédito! | Financeiro | `/relatorios/cost_centers_unified` | IMPLEMENTADO |  |
| SCR-225 | Relatório de Contas Tributárias e Não Tributárias | Financeiro | `/relatorios/tax_accounts` | EM IMPLEMENTAÇÃO | API /financial/tax-accounts pronta; sem tela dedicada (usar Contas a Pagar com filtro tributo) |
| SCR-226 | Relatório Consolidado de Contas a Pagar e Receber | Financeiro | `/relatorios/payable_receivable` | IMPLEMENTADO |  |
| SCR-227 | Relatório de Saldo Devedor/Fornecedor | Financeiro | `/relatorios/provider_balance` | IMPLEMENTADO |  |
| SCR-228 | Relatório Movimentação Estoque | Estoque | `/relatorios/stock_movement` | IMPLEMENTADO |  |
| SCR-229 | Relatório de Requisição/Saída | Estoque | `/relatorios/requisitions` | IMPLEMENTADO |  |
| SCR-230 | Relatório Baixa Estoque | Estoque | `/relatorios/stock_writeoffs` | IMPLEMENTADO |  |
| SCR-231 | Relatório DFe | Estoque | `/relatorios/dfe` | IMPLEMENTADO |  |
| SCR-232 | Relatório Custo Produção Batida | Estoque | `/relatorios/feed_batch_cost` | IMPLEMENTADO |  |
| SCR-233 | Relatório de Curva ABC | Estoque | `/relatorios/stocks_abc` | IMPLEMENTADO |  |
| SCR-234 | Relatório Recebimentos | Estoque | `/relatorios/receipts` | IMPLEMENTADO |  |
| SCR-235 | Relatório Estoque Consolidado | Estoque | `/relatorios/stocks_consolidated` | TESTADO |  |
| SCR-236 | Relatório de Lote/Fornecedor | Estoque | `/relatorios/stocks_lot_provider` | IMPLEMENTADO |  |
| SCR-237 | Saída de Produtos x Centro de Custo | Estoque | `/relatorios/exits_cost_center` | IMPLEMENTADO |  |
| SCR-238 | Relatório de Suprimentos | Suprimentos | `/relatorios/supplies` | IMPLEMENTADO |  |
| SCR-239 | Relatório Savings | Suprimentos | `/relatorios/savings` | IMPLEMENTADO |  |
| SCR-240 | Relatório ANS | Suprimentos | `/relatorios/ans` | IMPLEMENTADO |  |
| SCR-241 | Relatório de Orçamentos/Fornecedores | Suprimentos | `/relatorios/quotations` | IMPLEMENTADO |  |
| SCR-242 | Relatório Produtos x Previsão de entrega | Suprimentos | `/relatorios/purchase_forecast` | IMPLEMENTADO |  |
| SCR-243 | Relatório de Status de SLA | Suprimentos | `/relatorios/supply_sla` | IMPLEMENTADO |  |
| SCR-244 | Relatório Gerencial de Solicitações | Suprimentos | `/relatorios/purchase_management` | IMPLEMENTADO |  |
| SCR-245 | Relatório de Vendas/Cliente | Vendas | `/relatorios/sales_client` | IMPLEMENTADO |  |
| SCR-246 | Relatório de Vendas/Produto | Vendas | `/relatorios/sales_product` | IMPLEMENTADO |  |
| SCR-247 | Relatório de Vendas por Cliente/Produto | Vendas | `/relatorios/sales_client_product` | IMPLEMENTADO |  |
| SCR-248 | Relatório Vendas/Funcionários | Vendas | `/relatorios/sales_employee` | IMPLEMENTADO |  |
| SCR-249 | Relatório de Curva ABC | Vendas | `/api/sales/abc` | EM IMPLEMENTAÇÃO | API pronta (curva ABC de vendas); sem tela dedicada |
| SCR-250 | Cálculo Mensal | Gestão Pessoal | `/relatorios/monthly_calculation` | IMPLEMENTADO |  |
| SCR-251 | Relatório de Aniversariantes | Gestão Pessoal | `/relatorios/birthdays` | IMPLEMENTADO |  |
| SCR-252 | Relatório de Horas Logadas | Gestão Pessoal | `/relatorios/logged_hours` | IMPLEMENTADO |  |
| SCR-253 | Relatório de Funcionários Ativos | Gestão Pessoal | `/relatorios/active_employees` | IMPLEMENTADO |  |
| SCR-254 | Relatório de Adiantamento Salarial | Gestão Pessoal | `/relatorios/advances` | IMPLEMENTADO |  |
| SCR-255 | Relatórios Lançamento Contábil | Gestão Fiscal | `/relatorios/journal_entries` | IMPLEMENTADO |  |
| SCR-256 | Relatório NF-e | Gestão Fiscal | `/relatorios/` | NÃO INICIADO | Depende de emissão de NF-e |
| SCR-257 | Relatório de Faturamento | Gestão Fiscal | `/relatorios/nfe_product` | EM IMPLEMENTAÇÃO | Faturamento por produto calculado a partir das vendas confirmadas (sem NF-e emitida) |
| SCR-258 | Relatório de Conferência do Livro Caixa | Gestão Fiscal | `/relatorios/cash_book` | IMPLEMENTADO |  |
| SCR-259 | Relatório Máquinas | Gestão de Frotas | `/relatorios/machines` | IMPLEMENTADO |  |
| SCR-260 | Relatório Máquinas - Abastecimentos | Gestão de Frotas | `/relatorios/machine_supplies` | IMPLEMENTADO |  |
| SCR-261 | Relatório Máquinas - Manutenções | Gestão de Frotas | `/relatorios/machine_maintenances` | IMPLEMENTADO |  |
| SCR-266 | Funcionários | Pessoas | `/integracoes/exportacoes` | IMPLEMENTADO |  |
| SCR-301 | Produtos | Estrutura > Produtos | `/integracoes/exportacoes` | IMPLEMENTADO |  |
| SCR-318 | Proprietários | Pessoas | `/integracoes/exportacoes` | IMPLEMENTADO |  |
| SCR-322 | Fornecedores | Pessoas | `/integracoes/exportacoes` | IMPLEMENTADO |  |
| SCR-326 | Clientes | Pessoas | `/integracoes/exportacoes` | IMPLEMENTADO |  |
| SCR-348 | Plano de Contas | Fiscais | `/integracoes/exportacoes` | IMPLEMENTADO |  |
| SCR-381 | Saldo Estoque | Estoque | `/relatorios/stocks_consolidated` | TESTADO |  |
| SCR-389 | Equipes | Gestão Pessoal | `/integracoes/exportacoes` | IMPLEMENTADO |  |
| SCR-394 | Funcionário X Eventos | Gestão Pessoal | `/integracoes/exportacoes` | IMPLEMENTADO |  |

## Relatórios nossos sem equivalente direto

- `payment_schedule`
- `payment_cashflow`
