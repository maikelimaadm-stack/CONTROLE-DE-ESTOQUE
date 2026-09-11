# Arquitetura

## Monorepo (pnpm workspaces)
```
apps/web        Next.js (App Router, client components + TanStack Query) — UI
apps/api        Fastify — API REST /api/*, regras de negócio, transações
packages/shared Erros de domínio, dinheiro (decimal.js), datas pt-BR, paginação
packages/domain Regras puras (máquinas de estado, cálculos), registro declarativo de cadastros, catálogo de permissões
packages/db     Pool pg, runner de migrations, seed (referência + demo)
packages/config tsconfig/eslint base
supabase/       migrations SQL (schema erp), seed
scripts/        auditoria de paridade
docs/           documentação e referência
```

## Camadas na API
1. **Plugins**: helmet, CORS (origem única `WEB_ORIGIN`), rate limit, tratamento de erros (`DomainError` → HTTP), autenticação (JWT local ou Supabase) e contexto de tenant (`X-Org-Id`, `X-Farm-Id`).
2. **`runService(app, req, permission, fn)`**: abre transação, aplica `SET LOCAL app.org_id/app.user_id` (RLS), verifica permissão e executa o serviço. Toda escrita acontece dentro de uma única transação: ou tudo é aplicado, ou nada.
3. **Rotas por módulo** (`apps/api/src/routes/*`): `resources` (CRUD genérico dirigido pelo registro declarativo), `stock`, `supply`, `financial`, `sales`, `fleet-hr`, `livestock`, `reports`, `dashboards`, `admin`, `auth`.
4. **Serviços núcleo**: `stock-core` (postagem/estorno no ledger de estoque), `financial-core` (criação de títulos com rateio/parcelas e movimentos bancários).
5. **Banco**: triggers garantem invariantes independentemente do caminho (saldo de estoque nunca negativo, baixa nunca maior que saldo, período congelado, auditoria de linha).

## Padrões
- **Ledger imutável**: movimentos de estoque e baixas nunca são editados; correção = cancelamento com estorno (`reversal`).
- **Idempotência**: `Idempotency-Key` + hash do corpo em `erp.idempotency_keys`; repetir a chamada devolve o mesmo resultado sem duplicar efeitos.
- **Concorrência**: `SELECT … FOR UPDATE` em documentos/saldos; `version` otimista em solicitações de compra (`CONCURRENCY_CONFLICT`).
- **Dinheiro**: `numeric` no banco, `decimal.js` no código, strings na API (nunca `float`).
- **Paginação/filtros/ordenação**: sempre no servidor; listagens generic recebem `page/pageSize/sort/dir/search/<filtros>`.
- **Cadastros declarativos**: `packages/domain/src/resources/registries.ts` descreve tabela, campos, filtros, colunas, permissões; API e UI derivam formulário, listagem, validação zod, opções de referência e exportação.

## Frontend
- Navegação por **áreas de trabalho** (`/modulo?tab=…&sub=…`, `components/workspace.tsx`): abas e ações montadas pelas permissões; rotas antigas redirecionam (`apps/web/redirects.mjs`). Ver `docs/UX-ARCHITECTURE.md` (antes → depois por módulo).
- `features/docs/shared.tsx`: listagem transacional (`DocList`), editores de itens/rateio/parcelamento, detalhe, filtros.
- Permissões: `useAuth().can(perm)` só esconde/mostra; a autorização real é no servidor (403 `PERMISSION_DENIED`).
- Sessão em `localStorage` (token + org + fazenda ativa); 401 redireciona ao login.
