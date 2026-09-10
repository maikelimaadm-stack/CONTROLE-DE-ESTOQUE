# Paridade de Regras de Negócio

Referência: `docs/reference/BUSINESS-RULES.md` (RN-001…RN-050). Status conforme legenda de `docs/parity/SCREEN-PARITY.md`. "Onde" indica o ponto de aplicação no nosso código.

| Regra | Status | Onde | Observação |
|---|---|---|---|
| RN-001 fluxo de compras (11 status) | TESTADO | `packages/domain/src/supply-workflow.ts`, `apps/api/src/routes/supply.ts`; teste unitário e integração/e2e | Transições explícitas; `back_step`, `review` |
| RN-002 SLA por status | IMPLEMENTADO | `supply_status_sla`, `slaStatus()`, listagens e relatório `supply_sla`/`ans` | |
| RN-003 autorizador (valor, ativo, cotações mín., níveis) | TESTADO | `authorizerCanApprove()`; aprovação | Mínimo de cotações só para produto (MELHORADO: serviços não cotam) |
| RN-004 justificativa obrigatória | IMPLEMENTADO | UI exige em reprovar/cancelar/analisar; API grava evento | |
| RN-005 recebimento exige doc. fiscal | IMPLEMENTADO | `mark_received` valida `invoice_id` para produto | |
| RN-006 transferência de responsável | TESTADO | `/transfer`, `/transfer-batch` | |
| RN-007/008 rateio obrigatório = 100% | TESTADO | `normalizeApportionment()` (APPORTIONMENT_MISMATCH) | Tolerância 0,01 |
| RN-009 parcelamento | TESTADO | `buildInstallments()` (intervalo/dia fixo/entrada; INSTALLMENTS_MISMATCH) | |
| RN-010 status de título | TESTADO | `displayTitleStatus()` | |
| RN-011 baixa ↔ movimento; cancelar baixa | TESTADO | `settle()`, trigger `refresh_title_status`, `/settlements/:sid/cancel` | Baixa > saldo bloqueada no banco |
| RN-012 baixa em lote | TESTADO | `/settle-batch` (movimento único/separado) | |
| RN-013 congelamento | TESTADO | `assert_period_open` (PERIOD_FROZEN), escopo por parâmetro | |
| RN-014 transferência interna | TESTADO | `createBankMovement` com conta destino | |
| RN-015 saldo inicial único | IMPLEMENTADO | `/financial/opening-movements` (DUPLICATE_DOCUMENT) | |
| RN-016 OFX | TESTADO | parser unitário + conciliação | |
| RN-017 custo médio ponderado | TESTADO | trigger `apply_stock_movement`, `stock.ts` | |
| RN-018 categoria financeira p/ produto com estoque | IMPLEMENTADO | validação no CRUD de produtos | |
| RN-019 lote/validade | IMPLEMENTADO | `has_lot`, `provider_lot/expiration_date` no ledger | |
| RN-020 estoque mínimo → alerta | IMPLEMENTADO | painel + notificações | |
| RN-021 saída sem saldo bloqueada | TESTADO | INSUFFICIENT_STOCK (trigger) — RECOMENDADO adotado | Parâmetro `allow_negative_stock` previsto, padrão bloqueado |
| RN-022 entrada gera banco/título | TESTADO | `input-entries` | |
| RN-023 NF-e XML | TESTADO | `parseNfeXml` (web) + `/stock/invoices` | |
| RN-024 transferência entre fazendas | TESTADO | dois lançamentos na mesma transação | |
| RN-025 formulação/batida | IMPLEMENTADO | `/stock/feed-batches` | |
| RN-026 orçamento→pedido→venda | TESTADO | `/sales/*/convert` | |
| RN-027 venda gera receber | TESTADO | `confirmSale()` | |
| RN-028 venda baixa estoque | TESTADO | itens com armazém | RECOMENDADO |
| RN-029 manutenção | IMPLEMENTADO | `/fleet/maintenances` (peças do estoque + serviço) | |
| RN-030 abastecimento | TESTADO | `/fleet/fuel-supplies` | Origem CTA Smart apenas como campo |
| RN-031 depreciação | TESTADO | `monthlyDepreciation()`, `/assets/depreciations/run` idempotente | |
| RN-032 preventivas/alertas | IMPLEMENTADO | `/fleet/alerts` | |
| RN-033/034 folha | TESTADO | `/hr/earnings/calculate` | |
| RN-035 OS | IMPLEMENTADO | `/service-orders/:id/status|rate` | Baixa de insumos ao finalizar |
| RN-036 identificações | TESTADO | `animal_identifications` | |
| RN-037 processamento | TESTADO | `/livestock/processings/:id/process` | |
| RN-038 GMD | TESTADO | `gmd()` | |
| RN-039 manejo com estoque/carência | TESTADO | `/livestock/handlings` | |
| RN-040 evolução por idade | IMPLEMENTADO | `evolveCategory()`, `/livestock/evolution/run` | |
| RN-041 desmama/apartação | IMPLEMENTADO | `new_batch_id/new_category_id` | |
| RN-042 transferência entre fazendas (pecuária) | IMPLEMENTADO | `/transfers/to-farm` + `/process` | |
| RN-043 reprodução | IMPLEMENTADO | matings/diagnosis | |
| RN-044 confinamento | IMPLEMENTADO | diet-batches/deliveries/trough-readings/map | |
| RN-045 custeio | IMPLEMENTADO | relatórios `costing_*` | Custo retroativo: coluna prevista, tela NÃO INICIADA |
| RN-046 perfis/permissões | TESTADO | catálogo 773 chaves, RLS, testes de negação | |
| RN-047 fazendas permitidas/chefes | IMPLEMENTADO | `member_farms`, `user_bosses` | |
| RN-048 notificações | TESTADO | `/admin/notifications/refresh` | |
| RN-049 favoritos | IMPLEMENTADO | `/admin/favorites` | |
| RN-050 limite de licença | NÃO APLICÁVEL | — | Decisão #8 |
