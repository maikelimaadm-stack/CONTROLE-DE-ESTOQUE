# Matriz de escopo empresarial dos painéis

Uma linha por BLOCO de painel (`apps/api/src/routes/dashboards.ts`). O módulo do bloco é o da permissão da
rota, exceto onde a coluna diz outra coisa: o painel inicial combina áreas e por isso cada bloco fixa o módulo
da própria fonte (`{{escopo:coluna|modulo}}`). O gate `apps/api/test/unit/report-scope.test.ts` reexecuta esta
verificação de forma estrutural a cada `pnpm test`: toda fonte com coluna de empresa precisa de predicado
PRÓPRIO — ou de uma herança sólida, que é só uma destas duas: a tabela vizinha não tem coluna de empresa, ou a
igualdade da junção é entre as próprias colunas de empresa (`a.farm_id = b.farm_id`). Junção por chave de
negócio entre duas tabelas que têm `farm_id` (`fd.batch_id = b.id`) não recorta nada e não conta como herança.
Exceção de organização é declarada com motivo.

A contagem é por OCORRÊNCIA, não por tabela: ler a mesma tabela duas vezes com o MESMO alias — uma recortada,
outra não — passava pelo gate, porque o alias já estava marcado como protegido pela primeira leitura. Hoje o
gate exige tantos predicados quantas forem as ocorrências de quem se protege pelo predicado próprio.

| Endpoint | Permissão | Bloco | Fonte principal | Empresa derivada de | Escopo aplicado |
| --- | --- | --- | --- | --- | --- |
| /dashboards/home | dashboard.home.view (organização) | forecast | financial_titles | farm_id | `{{escopo:farm_id\|financeiro}}` |
| /dashboards/home | dashboard.home.view | prodCost | title_apportionments → financial_titles | t.farm_id | `{{escopo:t.farm_id\|financeiro}}` |
| /dashboards/home | dashboard.home.view | result | title_settlements → financial_titles; stock_movements | t.farm_id; m.farm_id | `{{escopo:t.farm_id\|financeiro}}` + `{{escopo:m.farm_id\|estoque}}` |
| /dashboards/home | dashboard.home.view | alerts | financial_titles; stock_balances → warehouses; purchase_requests; processings | farm_id; w.farm_id | um marcador por bloco, com o módulo da fonte (financeiro, estoque, compras, pecuaria) |
| /dashboards/financial | dashboard.financial.view (financeiro) | byCenter | title_apportionments → financial_titles | t.farm_id | `{{escopo:t.farm_id}}` |
| /dashboards/financial | dashboard.financial.view | invByCat | title_apportionments → financial_titles | t.farm_id | `{{escopo:t.farm_id}}` |
| /dashboards/financial | dashboard.financial.view | overdue | financial_titles | farm_id | `{{escopo:farm_id}}` |
| /dashboards/financial | dashboard.financial.view | upcoming | financial_titles | farm_id | `{{escopo:farm_id}}` |
| /dashboards/financial | dashboard.financial.view + bank_accounts.view | bank_balances | v_bank_account_balances | **não tem empresa** | ORGANIZAÇÃO: bloco só montado com `bank_accounts.view`; sem ela vem vazio e `banks_escopo: "restrito"` |
| /dashboards/financial | dashboard.financial.view | monthly | title_settlements → financial_titles | t.farm_id | `{{escopo:t.farm_id}}` |
| /dashboards/cash-book | dashboard.cash_book.view (financeiro) | r | bank_movements | m.farm_id (nullable) | `{{escopo_nulo:m.farm_id}}` |
| /dashboards/supply | dashboard.supply.view (compras) | byStatus, byType | purchase_requests | farm_id | `{{escopo:farm_id}}` |
| /dashboards/supply | dashboard.supply.view | leadTime, topProviders, sla | purchase_request_events / quotations → purchase_requests | r.farm_id | `{{escopo:r.farm_id}}` |
| /dashboards/livestock | dashboard.livestock.view (pecuaria) | herd | animals (`on` do left join); herd_lots (subconsulta escalar); herd_lots (`exists` do HAVING) | a.farm_id; h.farm_id; h.farm_id | TRÊS marcadores, um por OCORRÊNCIA — `erp.herd_lots` é lida duas vezes com o mesmo alias `h` e cada leitura responde pela própria empresa (o `exists` do HAVING decide a EXISTÊNCIA da linha: sem recorte, a categoria em que só a outra empresa tem rebanho aparecia zerada) |
| /dashboards/livestock | dashboard.livestock.view | movements | animal_movements | farm_id | `{{escopo:farm_id}}` |
| /dashboards/livestock | dashboard.livestock.view | gmd | weighing_items → weighings | w.farm_id | `{{escopo:w.farm_id}}` |
| /dashboards/livestock | dashboard.livestock.view | repro | matings → animals (matriz) | a.farm_id | `{{escopo:a.farm_id}}` |
| /dashboards/livestock | dashboard.livestock.view | costs | animal_handlings; feed_deliveries | h.farm_id; d.farm_id | dois marcadores, um por fonte |
| /dashboards/depreciation | dashboard.depreciation.view (frota_ativos) | monthly, byFamily | depreciations → equipments | e.farm_id | `{{escopo:e.farm_id}}` |
| /dashboards/assets | dashboard.assets.view (frota_ativos) | summary, byStatus | equipments | farm_id | `{{escopo:farm_id}}` |
| /dashboards/assets | dashboard.assets.view | byFarm | equipments → farms | e.farm_id | `{{escopo:e.farm_id}}` |
| /dashboards/assets | dashboard.assets.view | fleet | fuel_supplies; maintenances | farm_id | um marcador por subconsulta |
| /dashboards/user-analysis | dashboard.user_analysis.view (organização) | r, byEntity | audit_logs | **não tem empresa** | ORGANIZAÇÃO: auditoria de usuários, sem coluna de empresa (exceção declarada no gate) |
| /dashboards/rainfall | dashboard.rainfall.view (pecuaria) | r, prev | rainfalls | r.farm_id | `{{escopo:r.farm_id}}` |
| /dashboards/feedlot | dashboard.feedlot.view (confinamento) | r | feedlot_corrals → sectors → yards | y.farm_id | `{{escopo:y.farm_id}}`; ocupação (animals/batches) é derivada do curral — exceção declarada com motivo |
| /dashboards/feedlot-cost | dashboard.feedlot_cost.view (confinamento) | r | batches + feed_deliveries + animals | b.farm_id, fd.farm_id, a.farm_id | `{{escopo:b.farm_id}}` no lote, `{{escopo:a.farm_id}}` na subconsulta de animais e `{{escopo:fd.farm_id}}` no `on` do `left join` do trato (no `where` viraria `inner join`) |
| /dashboards/feedlot-performance | dashboard.feedlot_performance.view (confinamento) | r | batches + animals | b.farm_id, a.farm_id | `{{escopo:b.farm_id}}` no lote e `{{escopo:a.farm_id}}` no `on` do `left join` dos animais |
| /dashboards/nutrition-stock | dashboard.nutrition_stock.view (estoque) | r | stock_balances → warehouses; stock_movements (consumo 30d) | w.farm_id; m.farm_id | `{{escopo:w.farm_id}}` no saldo **e** `{{escopo:m.farm_id}}` no consumo |
| /dashboards/feed-consumption | dashboard.feed_consumption.view (confinamento) | daily | feed_deliveries | farm_id | `{{escopo:farm_id}}` |
| /dashboards/feed-consumption | dashboard.feed_consumption.view | byDiet | feed_deliveries → diets | fd.farm_id | `{{escopo:fd.farm_id}}` |

## Prova de comportamento

`apps/api/test/integration/relatorio-escopo.test.ts` grava um valor SENTINELA por empresa e confere que
nenhum valor exclusivo da empresa não autorizada aparece nos painéis (financeiro, inicial, compras e caixa),
nem em linha, nem em total. O bloco de saldos bancários é verificado nos dois sentidos: vazio e sinalizado
para quem não tem a capacidade de organização, preenchido para quem tem.
