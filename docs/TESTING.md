# Testes

| Camada | Onde | O que cobre | Como rodar |
|---|---|---|---|
| Unitários | `packages/shared/test`, `packages/domain/test`, `apps/api/test/unit` | dinheiro/parcelas/rateio, máquina de estados de compras, autorizador, SLA, custo médio, depreciação, GMD/arrobas, totais de venda, parser OFX | `pnpm test` |
| Schema/RLS | `packages/db/test/schema.test.ts` | migrations em banco limpo, RLS isola organizações, triggers de ledger/baixa | `pnpm --filter @agro/db test:integration` |
| Integração API | `apps/api/test/integration/api.test.ts` (27 casos) | login/contexto, CRUD genérico, **negação de permissão**, **isolamento entre organizações**, ledger de estoque (atomicidade, **idempotência**, **concorrência** com 10 saídas paralelas), cancelamento/estorno, transferência entre fazendas, NF-e, títulos (baixa, cancelamento de baixa, lote, encontro de contas, transferência interna, **período congelado**), fluxo de caixa, relatórios CSV/XLSX, fluxo completo de compras com `version` otimista, vendas (converter/confirmar), abastecimento/depreciação, folha, pecuária (pesagem, sanitário, venda, compra, processamento), dashboards, auditoria, perfis, notificações | `pnpm --filter @agro/api test:integration` |
| E2E | `apps/web/e2e` (8 cenários) | login válido/inválido e redirecionamento, cadastro de produto, entrada de insumos → ledger → cancelamento com estorno, saldo, título a pagar com rateio → baixa parcial → cancelamento de baixa, solicitação de compra até "Aguardando a Compra", **permissões** (operador não vê nem acessa financeiro) | `pnpm db:seed:e2e && pnpm e2e` |
| Paridade | `scripts/parity.mjs` | toda tela da referência tem mapeamento e status | `pnpm parity:check` |

Pré-requisitos locais: Postgres 16 em `TEST_DATABASE_URL` (padrão `postgresql://postgres@127.0.0.1:5433/agro_erp_test`); o setup cria o papel `erp_app_test`. E2E: builds de `@agro/api` e `@agro/web` (`NEXT_PUBLIC_API_URL` apontando para `http://127.0.0.1:3333`), Chromium do Playwright (`PLAYWRIGHT_CHROMIUM` para binário customizado).

Resultados da última execução local (10/09/2026): unit 35 ✓ · schema/RLS 6 ✓ · API 29 ✓ · e2e 8 ✓ · paridade ✓.
