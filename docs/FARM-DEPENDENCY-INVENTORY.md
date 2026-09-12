# Inventário — dependência estrutural de "Fazenda"

> **Documento gerado.** Não edite à mão: `node scripts/farm-inventory.mjs`.

O núcleo do ERP precisa deixar de depender do nicho agro: **Fazenda → Empresa**
(`docs/MULTI-COMPANY-CONTRACT.md`, `docs/DOMAIN-NAMING-STANDARD.md`). Este inventário mede a superfície real
antes de qualquer renomeação — localizar/substituir em massa aqui quebraria contrato de API, RLS e dados.

Total medido: **2681** ocorrências em 11 superfícies · 50 tabelas com coluna de empresa.

## Por superfície

| Superfície | Ocorrências | Catraca | Observação |
| --- | ---: | --- | --- |
| Schema (migrations) | 148 | sim | não pode crescer |
| API — código | 993 | sim | não pode crescer |
| API — testes | 245 | sim | não pode crescer |
| Núcleo neutro de nicho (plataforma) | 0 | sim | zerado: o catálogo do produto saiu da plataforma (mecanismo puro) |
| Pacotes compartilhados | 103 | sim | não pode crescer |
| Web — código | 425 | sim | não pode crescer |
| Web — navegação/rotas | 13 | sim | não pode crescer |
| Web — testes ponta a ponta | 57 | sim | não pode crescer |
| Scripts e gates | 5 | sim | não pode crescer |
| Documentação ativa | 179 | não | documentação: acompanha a migração |
| Documentação histórica (referência externa) | 513 | não | histórico externo: preservado, fora da catraca |

## Por símbolo (o que precisa migrar)

| Símbolo atual | Natureza | Ocorrências | Destino canônico |
| --- | --- | ---: | --- |
| `farm_id` | dado | 1106 | `empresa_id` |
| `farms` | dado | 107 | `erp.empresas` |
| `member_farms` | dado | 33 | `member_empresas` |
| `ctx_farmId` | contrato | 159 | `empresaSelecionada` |
| `farmIds` | contrato | 111 | `empresasPermitidas` |
| `x_farm_id` | contrato | 39 | `X-Empresa-Id` |
| `farmScope` | contrato | 43 | `escopoEmpresa` |
| `allowedFarms` | contrato | 122 | `escopoEmpresa (@erp/plataforma)` |
| `farms` | contrato | 109 | `/empresas` |
| `fazenda` | texto | 852 | `Empresa (i18n: termos.empresa)` |

`dado` = exige migration e backfill · `contrato` = quebra clientes se mudar sem compatibilidade · `texto` = rótulo, resolvido por i18n.

## Tabelas com coluna de empresa

As 50 tabelas abaixo carregam o escopo de empresa e migram juntas em PRE-BASE2-03.

| Tabela | Coluna(s) |
| --- | --- |
| `erp.animal_handlings` | `farm_id` |
| `erp.animal_movements` | `farm_id` · `destination_farm_id` |
| `erp.animal_retroactive_costs` | `farm_id` |
| `erp.animals` | `farm_id` |
| `erp.areas` | `farm_id` |
| `erp.authorizer_farms` | `farm_id` |
| `erp.bank_account_farms` | `farm_id` |
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
| `erp.equipment_transfers` | `origin_farm_id` · `destination_farm_id` |
| `erp.equipments` | `farm_id` |
| `erp.farm_cost_centers` | `farm_id` |
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
| `erp.member_farms` | `farm_id` |
| `erp.opening_balances` | `farm_id` |
| `erp.processings` | `farm_id` |
| `erp.proprietary_farms` | `farm_id` |
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
| `erp.warehouse_transfers` | `origin_farm_id` · `destination_farm_id` |
| `erp.warehouses` | `farm_id` |
| `erp.weighings` | `farm_id` |

## Arquivos mais acoplados

Ordem de ataque sugerida: quem concentra mais ocorrências define o risco da migração.

| Arquivo | Superfície | Ocorrências |
| --- | --- | ---: |
| `apps/api/src/routes/livestock.ts` | API — código | 175 |
| `apps/api/src/routes/stock.ts` | API — código | 174 |
| `docs/reference/screens/relatorios.md` | Documentação histórica (referência externa) | 170 |
| `apps/api/src/routes/fleet-hr.ts` | API — código | 131 |
| `apps/api/src/routes/reports.ts` | API — código | 111 |
| `docs/reference/screens/cadastros-base.md` | Documentação histórica (referência externa) | 97 |
| `apps/api/src/routes/financial.ts` | API — código | 96 |
| `docs/reference/screens/financeiro.md` | Documentação histórica (referência externa) | 78 |
| `apps/api/src/routes/dashboards.ts` | API — código | 68 |
| `apps/api/test/integration/api.test.ts` | API — testes | 67 |
| `docs/reference/screens/administrativo.md` | Documentação histórica (referência externa) | 61 |
| `apps/api/test/integration/farm-scope.test.ts` | API — testes | 60 |
| `apps/api/src/lib/context.ts` | API — código | 45 |
| `apps/api/src/routes/resources.ts` | API — código | 45 |
| `packages/domain/src/resources/registries.ts` | Pacotes compartilhados | 45 |
| `supabase/migrations/0006_livestock.sql` | Schema (migrations) | 36 |
| `packages/db/src/seed.ts` | Pacotes compartilhados | 35 |
| `docs/reference/REPORTS.md` | Documentação histórica (referência externa) | 34 |
| `apps/api/test/unit/empresa-bridge.test.ts` | API — testes | 33 |
| `supabase/migrations/0003_stock_supply.sql` | Schema (migrations) | 31 |
| `apps/api/src/routes/supply.ts` | API — código | 30 |
| `apps/api/test/unit/farm-scope-guard.test.ts` | API — testes | 30 |
| `apps/api/src/routes/sales.ts` | API — código | 29 |
| `docs/AUTHORIZATION.md` | Documentação ativa | 29 |
| `supabase/migrations/0002_registries.sql` | Schema (migrations) | 28 |

## Como esta catraca funciona

`node scripts/farm-inventory.mjs --check` roda no `lint` e falha se qualquer superfície com catraca crescer
em relação a `scripts/farm-inventory.baseline.json`. Para crescer de propósito (camada de compatibilidade,
por exemplo), regenere o baseline no MESMO commit: a intenção fica visível na revisão.
