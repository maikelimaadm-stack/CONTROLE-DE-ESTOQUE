# Agro ERP — reimplementação funcional (clean-room)

Sistema de gestão agropecuária multi-tenant (organizações × fazendas) reimplementado a partir do levantamento funcional de um sistema de referência (ver `docs/reference/`). Nenhum código, asset ou marca do sistema de referência foi copiado: a implementação é própria, com melhorias arquiteturais documentadas (`docs/DECISIONS.md`, `docs/parity/`).

## Stack
- **Web**: Next.js 16 (App Router) · React 19 · TypeScript · Tailwind 4 · componentes próprios estilo shadcn · TanStack Query/Table · Recharts — deploy na **Vercel** (`apps/web`).
- **API**: Node 22 · Fastify 5 · zod · pg · decimal.js — deploy no **Railway** (`apps/api`, `apps/api/Dockerfile`).
- **Banco**: PostgreSQL 16 / **Supabase** (schema `erp`, migrations SQL versionadas, RLS por organização, Auth, Storage) — `supabase/migrations`.
- **Pacotes**: `packages/shared` (erros, dinheiro, datas), `packages/domain` (regras, máquinas de estado, registro declarativo de cadastros, catálogo de permissões), `packages/db` (pool, migrations, seed), `packages/config` (tsconfig/eslint base).

## Rodando localmente
```bash
pnpm install
cp .env.example .env            # ajuste DATABASE_URL
pnpm --filter @agro/shared build && pnpm --filter @agro/domain build && pnpm --filter @agro/db build
pnpm db:seed                    # migrations + dados de referência + organização demo (admin@demo.local / Demo@12345)
pnpm dev:api                    # http://localhost:3333 (health: /health)
pnpm dev:web                    # http://localhost:3000
```

## Qualidade
```bash
pnpm lint && pnpm typecheck     # eslint + tsc em todos os pacotes
pnpm test                       # unitários (shared, domain, api/ofx)
pnpm test:integration           # schema/RLS + API (requer Postgres em TEST_DATABASE_URL)
pnpm db:seed:e2e && pnpm e2e    # Playwright (requer builds da API e do web)
pnpm parity:check               # auditoria de paridade com o sistema de referência
```
Detalhes em `docs/TESTING.md`. CI em `.github/workflows/ci.yml` (lint, typecheck, unit, migrations em banco limpo, RLS, integração, build, e2e, auditoria de paridade, varredura de segredos).

## Documentação
| Documento | Conteúdo |
|---|---|
| `docs/ARCHITECTURE.md` | Monorepo, camadas, fluxo de requisição, decisões de runtime |
| `docs/DATABASE.md` | Schema, ledgers, triggers, sequências de código, migrations |
| `docs/SECURITY.md` | Autenticação, RLS, segredos, CORS, rate limit, auditoria |
| `docs/AUTHORIZATION.md` | Catálogo de permissões, perfis, escopo por fazenda |
| `docs/DOMAIN-MODEL.md` | Entidades e relacionamentos por módulo |
| `docs/WORKFLOWS.md` | Fluxos: compras, estoque, financeiro, vendas, pecuária, OS, RH |
| `docs/DEPLOYMENT.md` | Supabase, Railway, Vercel, variáveis, migrations em produção |
| `docs/PERSONALIZACAO.md` | Modelo base: preferências de listagem, filtros avançados, filtros salvos, layout de formulário, padrão da organização |
| `docs/TESTING.md` | Estratégia e como rodar cada camada de teste |
| `docs/DECISIONS.md` | ADRs: onde divergimos da referência e por quê |
| `docs/reference/` | Inventário do sistema de referência (455 telas, 120 relatórios, 14 dashboards, 666 permissões, regras) |
| `docs/parity/` | Paridade módulo/tela/campo/ação/relatório/regra/fluxo e análise de gaps |
