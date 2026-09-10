# Banco de dados

Schema `erp` em PostgreSQL 16 / Supabase. Migrations em `supabase/migrations/000N_*.sql`, aplicadas em ordem pelo runner `packages/db` (tabela `public.erp_migrations`). Total: 171 tabelas.

| Migration | Conteúdo |
|---|---|
| 0001_foundation | organizations, users, members, roles/permissions, farms, audit_logs, notifications, idempotency_keys, sequências `erp.next_code(org, entidade)`, trigger de auditoria `erp.audit_row` |
| 0002_registries | cadastros base (produtos, pessoas, categorias, contas, plano de contas, equipamentos, animais…) |
| 0003_stock_supply | armazéns, `stock_movements` (ledger), `stock_balances` (cache), documentos de estoque, formulações/batidas, DFe, solicitações de compra/cotações/eventos/SLA |
| 0004_financial | `financial_titles`, `title_apportionments`, `title_settlements`, `bank_movements`, OFX, previsão orçamentária, congelamentos, view `v_bank_account_balances` |
| 0005_sales_fleet_hr | vendas (orçamento/pedido/venda), manutenções, abastecimentos, depreciações, RH (eventos, faltas, adiantamentos, apuração), ordens de serviço, documentos |
| 0006_livestock | animais, identificações, lotes por contagem (`herd_lots`), movimentações, pesagens, manejos, reprodução, confinamento (pátios/setores/currais/dietas/bateladas/trato/cocho) |
| 0007_rls | RLS em todas as tabelas para o papel `erp_app` (sem bypass) via `current_setting('app.org_id')`; tabelas-filho por join no pai; linhas compartilhadas (`organization_id is null`) somente leitura |

## Invariantes garantidas por trigger
- `apply_stock_movement`: recalcula saldo e custo médio ponderado; saída maior que o saldo → `INSUFFICIENT_STOCK`.
- `refresh_title_status`: soma baixas confirmadas, atualiza `paid_amount/balance/status`; baixa acima do saldo → `PAYMENT_EXCEEDS_BALANCE`.
- `assert_period_open`: bloqueia lançamentos em períodos congelados (`PERIOD_FROZEN`), escopo organização ou fazenda.
- `audit_row`: grava antes/depois em `audit_logs` para tabelas auditadas.
- Códigos sequenciais por organização e entidade (`next_code`) com `unique (organization_id, …, code)`.

## Convenções
- `uuid` PK, `organization_id` em toda tabela de tenant, `farm_id` onde há escopo de fazenda, `deleted_at` (soft delete) em cadastros, `created_by/updated_at`.
- Dinheiro/quantidades: `numeric(18,2)` / `numeric(18,4)`; custos unitários `numeric(18,6)`.
- Datas: `date`; instantes: `timestamptz`.
- Documentos transacionais têm `status` (`confirmed/cancelled/…`) e nunca são apagados.

## Operação
- Aplicar: `DATABASE_URL=… pnpm db:migrate` (ou `node apps/api/dist/migrate.js` no pre-deploy do Railway).
- Seed de referência (unidades, tipos de título, plano de contas, categorias…) e organização demo: `pnpm db:seed`.
- Reset (somente dev): `ALLOW_DB_RESET=1 pnpm db:reset`.
- Supabase: os mesmos arquivos podem ser aplicados via `supabase db push` ou pelo MCP `apply_migration`; o papel `erp_app` deve existir com senha própria (não usar `postgres` na API).
