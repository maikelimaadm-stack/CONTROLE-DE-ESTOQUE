# Banco de dados

Schema `erp` em PostgreSQL 16 / Supabase. Migrations em `supabase/migrations/000N_*.sql`, aplicadas em ordem pelo runner `packages/db` (tabela `public.erp_migrations`). Total: 181 tabelas (`node scripts/data-dictionary.mjs`).

| Migration | Conteúdo |
|---|---|
| 0001_foundation | organizations, users, members, roles/permissions, farms, audit_logs, notifications, idempotency_keys, sequências `erp.next_code(org, entidade)`, trigger de auditoria `erp.audit_row` |
| 0002_registries | cadastros base (produtos, pessoas, categorias, contas, plano de contas, equipamentos, animais…) |
| 0003_stock_supply | armazéns, `stock_movements` (ledger), `stock_balances` (cache), documentos de estoque, formulações/batidas, DFe, solicitações de compra/cotações/eventos/SLA |
| 0004_financial | `financial_titles`, `title_apportionments`, `title_settlements`, `bank_movements`, OFX, previsão orçamentária, congelamentos, view `v_bank_account_balances` |
| 0005_sales_fleet_hr | vendas (orçamento/pedido/venda), manutenções, abastecimentos, depreciações, RH (eventos, faltas, adiantamentos, apuração), ordens de serviço, documentos |
| 0006_livestock | animais, identificações, lotes por contagem (`herd_lots`), movimentações, pesagens, manejos, reprodução, confinamento (pátios/setores/currais/dietas/bateladas/trato/cocho) |
| 0007_rls | RLS em todas as tabelas para o papel `erp_app` (sem bypass) via `current_setting('app.org_id')`; tabelas-filho por join no pai; linhas compartilhadas (`organization_id is null`) somente leitura |
| 0008_screen_preferences | personalização de telas: preferências de listagem, layout de formulário e filtros por (organização, usuário, módulo, tela) |
| 0009_attachments | `erp.attachment_blobs` — conteúdo do anexo no próprio banco (`bytea`), sem storage externo; `erp.attachments` (0001) continua sendo o índice |
| 0010_platform_foundation | fundação de plataforma (PRE-BASE2-01): preferência de idioma e `erp.global_records` (ID Global) |
| 0011_company_permissions | permissões por EMPRESA e MÓDULO (PRE-BASE2-02): catálogo `erp.modulos_escopo_empresa`, `erp.membro_escopos_empresa` (modo por módulo), `erp.membro_empresas`, `erp.tem_acesso_empresa(org,usuario,modulo,empresa)` e a unicidade composta `erp.farms (organization_id, id)` |
| 0012_notification_scope | escopo empresarial da NOTIFICAÇÃO e leitura por usuário: `escopo_tipo`/`modulo`/`empresa_id`/`permission_key`/`dedupe_key` + `modulo_ref` gerada; catálogo `erp.tipos_notificacao` com as combinações permitidas e `notifications_tipo_fk`; classificação FAIL-CLOSED do legado (tipo desconhecido interrompe a migração); `erp.notificacao_leituras` (recibo por usuário, RLS amarrando o recibo ao usuário da sessão) e `notifications.read_at` como legado |
| 0013_purchase_request_responsible_tenant | responsável da solicitação de compra amarrado ao TENANT: chave estrangeira composta `(organization_id, current_responsible_user_id) → erp.organization_members(organization_id, user_id)` com `on delete restrict`, depois de auditar acervo cross-tenant (a migration PARA se encontrar) |
| 0014_company_physical_migration | **migração física fazenda → empresa** (PRE-BASE2-03): `erp.farms` vira `erp.empresas` (tabela) + view `erp.farms` com `security_invoker`; 52 colunas canônicas (`empresa_id`, `empresa_origem_id`, `empresa_destino_id`) criadas ao lado das legadas e sincronizadas por gatilho nos dois sentidos; PK/unicidade/FK movidas para a coluna canônica, FK **composta** `(organization_id, empresa_id)`; 4 tabelas de vínculo renomeadas com view legada; `erp.member_farms` arquivada em `erp.legado_escopo_empresa_v0` e removida; preflight FAIL-CLOSED contra linha apontando para empresa de outra organização |
| 0015_company_rls | **RLS empresarial** (PRE-BASE2-03): `tenant_isolation` SUBSTITUÍDA por `tenant_e_empresa` nas tabelas de escopo (policies PERMISSIVE se combinam com OR — adicionar manteria o vazamento); `erp.escopo_empresa_total`, `erp.empresa_no_escopo`, `erp.empresa_escrita_permitida`; transferências leem por qualquer ponta e escrevem pela origem; `erp.v_bank_account_balances` recriada com `security_invoker` (era definer e vazava entre organizações) |

## Invariantes garantidas por trigger
- `apply_stock_movement`: recalcula saldo e custo médio ponderado; saída maior que o saldo → `INSUFFICIENT_STOCK`.
- `refresh_title_status`: soma baixas confirmadas, atualiza `paid_amount/balance/status`; baixa acima do saldo → `PAYMENT_EXCEEDS_BALANCE`.
- `assert_period_open(org, empresa, data)`: bloqueia lançamentos em períodos congelados (`PERIOD_FROZEN`), escopo organização ou empresa.
- `trg_sync_<coluna>` (0014): mantém coluna canônica e coluna legada iguais. No INSERT, um lado preenche o outro; no UPDATE, o lado que MUDOU manda. Os dois com valores divergentes → `VALIDATION_ERROR` (422), nunca escolha silenciosa.
- `audit_row`: grava antes/depois em `audit_logs` para tabelas auditadas.
- Códigos sequenciais por organização e entidade (`next_code`) com `unique (organization_id, …, code)`.

## Convenções
- `uuid` PK, `organization_id` em toda tabela de tenant, **`empresa_id`** onde há escopo de empresa (`farm_id` continua como espelho legado até PRE-BASE2-05), `deleted_at` (soft delete) em cadastros, `created_by/updated_at`.
- Chave estrangeira de empresa é COMPOSTA: `(organization_id, empresa_id) → erp.empresas(organization_id, id)`. Coluna única provaria que o UUID é uma empresa; só a composta prova que é uma empresa DESTA organização.
- Dinheiro/quantidades: `numeric(18,2)` / `numeric(18,4)`; custos unitários `numeric(18,6)`.
- Datas: `date`; instantes: `timestamptz`.
- Documentos transacionais têm `status` (`confirmed/cancelled/…`) e nunca são apagados.

## Operação
- Aplicar: `DATABASE_URL=… pnpm db:migrate` (ou `node apps/api/dist/migrate.js` no pre-deploy do Railway).
- Seed de referência (unidades, tipos de título, plano de contas, categorias…) e organização demo: `pnpm db:seed`.
- Reset (somente dev): `ALLOW_DB_RESET=1 pnpm db:reset`.
- Supabase: os mesmos arquivos podem ser aplicados via `supabase db push` ou pelo MCP `apply_migration`; o papel `erp_app` deve existir com senha própria (não usar `postgres` na API).
