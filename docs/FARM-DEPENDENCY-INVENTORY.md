# Inventário — dependência estrutural de "Fazenda"

> **Documento gerado.** Não edite à mão: `node scripts/farm-inventory.mjs`.

O núcleo do ERP precisa deixar de depender do nicho agro: **Fazenda → Empresa**
(`docs/MULTI-COMPANY-CONTRACT.md`, `docs/DOMAIN-NAMING-STANDARD.md`). Este inventário mede a superfície real
antes de qualquer renomeação — localizar/substituir em massa aqui quebraria contrato de API, RLS e dados.

Total medido: **1483** ocorrências em 11 superfícies · 49 tabelas com coluna de empresa.

## Por superfície

| Superfície | Ocorrências | Catraca | Observação |
| --- | ---: | --- | --- |
| Schema (migrations) | 268 | sim | não pode crescer |
| API — código | 63 | sim | não pode crescer |
| API — testes | 240 | sim | não pode crescer |
| Núcleo neutro de nicho (plataforma) | 0 | sim | zerado: o catálogo do produto saiu da plataforma (mecanismo puro) |
| Pacotes compartilhados | 31 | sim | não pode crescer |
| Web — código | 18 | sim | não pode crescer |
| Web — navegação/rotas | 7 | sim | não pode crescer |
| Web — testes ponta a ponta | 73 | sim | não pode crescer |
| Scripts e gates | 13 | sim | não pode crescer |
| Documentação ativa | 257 | não | documentação: acompanha a migração |
| Documentação histórica (referência externa) | 513 | não | histórico externo: preservado, fora da catraca |

## Por símbolo (o que precisa migrar)

| Símbolo atual | Natureza | Ocorrências | Destino canônico |
| --- | --- | ---: | --- |
| `farm_id` | dado | 498 | `empresa_id` |
| `farms` | dado | 99 | `erp.empresas` |
| `member_farms` | dado | 58 | `member_empresas` |
| `ctx_farmId` | contrato | 28 | `empresaSelecionada` |
| `farmIds` | contrato | 1 | `empresasPermitidas` |
| `x_farm_id` | contrato | 62 | `X-Empresa-Id` |
| `farmScope` | contrato | 6 | `escopoEmpresa` |
| `allowedFarms` | contrato | 6 | `escopoEmpresa (@erp/plataforma)` |
| `farms` | contrato | 63 | `/empresas` |
| `fazenda` | texto | 662 | `Empresa (i18n: termos.empresa)` |

`dado` = exige migration e backfill · `contrato` = quebra clientes se mudar sem compatibilidade · `texto` = rótulo, resolvido por i18n.

## Tabelas com coluna de empresa

As 49 tabelas abaixo carregam o escopo de empresa e migram juntas em PRE-BASE2-03.

| Tabela | Coluna(s) |
| --- | --- |
| `erp.animal_handlings` | `farm_id` |
| `erp.animal_movements` | `empresa_destino_id` · `farm_id` · `destination_farm_id` |
| `erp.animal_retroactive_costs` | `farm_id` |
| `erp.animals` | `farm_id` |
| `erp.areas` | `farm_id` |
| `erp.authorizer_empresas` | `farm_id` |
| `erp.bank_account_empresas` | `farm_id` |
| `erp.bank_movements` | `farm_id` |
| `erp.batches` | `farm_id` |
| `erp.breeding_seasons` | `farm_id` |
| `erp.budget_plannings` | `farm_id` |
| `erp.contracts` | `farm_id` |
| `erp.devolutions` | `farm_id` |
| `erp.dfe_documents` | `farm_id` |
| `erp.diet_batches` | `farm_id` |
| `erp.documents` | `farm_id` |
| `erp.earnings` | `farm_id` |
| `erp.empresa_cost_centers` | `farm_id` |
| `erp.equipment_transfers` | `empresa_origem_id` · `empresa_destino_id` · `origin_farm_id` · `destination_farm_id` |
| `erp.equipments` | `farm_id` |
| `erp.feed_batches` | `farm_id` |
| `erp.feed_deliveries` | `farm_id` |
| `erp.feedlot_yards` | `farm_id` |
| `erp.financial_freezes` | `farm_id` |
| `erp.financial_titles` | `farm_id` |
| `erp.fuel_supplies` | `farm_id` |
| `erp.grazing_modules` | `farm_id` |
| `erp.herd_lots` | `farm_id` |
| `erp.input_entries` | `farm_id` |
| `erp.invoices` | `farm_id` |
| `erp.journal_entries` | `farm_id` |
| `erp.livestock_plannings` | `farm_id` |
| `erp.maintenances` | `farm_id` |
| `erp.opening_balances` | `farm_id` |
| `erp.processings` | `farm_id` |
| `erp.proprietary_empresas` | `farm_id` |
| `erp.purchase_requests` | `farm_id` |
| `erp.rainfalls` | `farm_id` |
| `erp.requisitions` | `farm_id` |
| `erp.salary_advances` | `farm_id` |
| `erp.sales_documents` | `farm_id` |
| `erp.service_orders` | `farm_id` |
| `erp.stock_corrections` | `farm_id` |
| `erp.stock_movements` | `farm_id` |
| `erp.stock_writeoffs` | `farm_id` |
| `erp.trough_readings` | `farm_id` |
| `erp.warehouse_transfers` | `empresa_origem_id` · `empresa_destino_id` · `origin_farm_id` · `destination_farm_id` |
| `erp.warehouses` | `farm_id` |
| `erp.weighings` | `farm_id` |

## Arquivos mais acoplados

Ordem de ataque sugerida: quem concentra mais ocorrências define o risco da migração.

| Arquivo | Superfície | Ocorrências |
| --- | --- | ---: |
| `docs/reference/screens/relatorios.md` | Documentação histórica (referência externa) | 170 |
| `docs/reference/screens/cadastros-base.md` | Documentação histórica (referência externa) | 97 |
| `supabase/migrations/0014_company_physical_migration.sql` | Schema (migrations) | 96 |
| `docs/reference/screens/financeiro.md` | Documentação histórica (referência externa) | 78 |
| `docs/DASHBOARD-SCOPE-MATRIX.md` | Documentação ativa | 73 |
| `apps/api/test/integration/api.test.ts` | API — testes | 66 |
| `docs/reference/screens/administrativo.md` | Documentação histórica (referência externa) | 61 |
| `apps/api/test/integration/farm-scope.test.ts` | API — testes | 58 |
| `supabase/migrations/0006_livestock.sql` | Schema (migrations) | 36 |
| `docs/reference/REPORTS.md` | Documentação histórica (referência externa) | 34 |
| `supabase/migrations/0003_stock_supply.sql` | Schema (migrations) | 31 |
| `supabase/migrations/0002_registries.sql` | Schema (migrations) | 28 |
| `docs/MULTI-COMPANY-CONTRACT.md` | Documentação ativa | 25 |
| `docs/parity/SCREEN-PARITY.md` | Documentação ativa | 24 |
| `supabase/migrations/0005_sales_fleet_hr.sql` | Schema (migrations) | 21 |
| `supabase/migrations/0011_company_permissions.sql` | Schema (migrations) | 21 |
| `apps/api/test/unit/farm-scope-guard.test.ts` | API — testes | 20 |
| `docs/DOMAIN-NAMING-STANDARD.md` | Documentação ativa | 19 |
| `docs/parity/ACTION-PARITY.md` | Documentação ativa | 18 |
| `docs/reference/screens/dashboards.md` | Documentação histórica (referência externa) | 18 |
| `supabase/migrations/0004_financial.sql` | Schema (migrations) | 17 |
| `apps/web/e2e/acesso-empresa.spec.ts` | Web — testes ponta a ponta | 16 |
| `apps/web/e2e/record-open.spec.ts` | Web — testes ponta a ponta | 15 |
| `apps/api/test/integration/plataforma.test.ts` | API — testes | 14 |
| `docs/reference/SYSTEM-INVENTORY.md` | Documentação histórica (referência externa) | 14 |

## Como esta catraca funciona

`node scripts/farm-inventory.mjs --check` roda no `lint` e falha se qualquer superfície com catraca crescer
em relação a `scripts/farm-inventory.baseline.json`. Para crescer de propósito (camada de compatibilidade,
por exemplo), regenere o baseline no MESMO commit: a intenção fica visível na revisão.
