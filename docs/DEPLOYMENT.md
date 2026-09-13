# Deploy

## Supabase (banco + auth + storage)
1. Criar projeto; anotar `Project URL`, `anon key`, `service role key`, `JWT secret` (Settings › API) e a connection string do **pooler em modo sessão** (`aws-0-<região>.pooler.supabase.com`, porta 5432). **Não** acrescente `?sslmode=require` à URL: o `pg` passa a exigir certificado verificado e a conexão falha com `self-signed certificate in certificate chain`; o pool já negocia TLS sozinho.
2. Papéis: `erp_app` (login, **sem** bypass de RLS; usado pela API em `DATABASE_URL`) e `erp_migrator` (login, `bypassrls`, dono do schema `erp`; usado só pelo pre-deploy em `MIGRATE_DATABASE_URL`). Senhas fortes, nunca versionadas.
3. Aplicar `supabase/migrations/*.sql` em ordem (`pnpm db:migrate` com `DATABASE_URL` do projeto, ou MCP `apply_migration`). Depois `pnpm db:seed` para dados de referência + organização inicial.
4. Auth: habilitar e-mail/senha; ao criar usuários no Supabase, preencher `erp.users.auth_user_id`. Storage: bucket privado `attachments`.
5. **Status nesta entrega**: aplicado no projeto `CONTROLE-DE-ESTOQUE` (ref `dcroxgdzzgqgiquvfffa`, sa-east-1, Postgres 17) — ver tabela abaixo.

## Railway (API)
- Serviço a partir do repositório; configuração definida no próprio serviço (sem `railway.json` na raiz, pois ele valeria para todos os serviços do repositório): Dockerfile `apps/api/Dockerfile`, start `node dist/main.js`, health `/health`, pre-deploy `node dist/migrate.js` (aplica migrations pendentes).
- Região: `iad` (US East, Virgínia), a mais próxima disponível de São Paulo (o banco Supabase fica em sa-east-1); em `sfo` cada listagem levava ~3,5 s.
- Variáveis: `DATABASE_URL` (pooler, usuário `erp_app`), `MIGRATE_DATABASE_URL` (pooler, usuário `erp_migrator`), `MIGRATIONS_DIR=/app/supabase/migrations`, `AUTH_MODE=local` + `LOCAL_AUTH_SECRET` (login por e-mail/senha na tabela `erp.users`; `AUTH_MODE=supabase` + `SUPABASE_JWT_SECRET` fica como evolução, pois o web ainda não usa Supabase Auth), `SUPABASE_URL`, `WEB_ORIGIN=https://<app>.vercel.app`, `PORT=3333`, `API_LOG_LEVEL=info`, `RATE_LIMIT_MAX`.
- Seed inicial: definir uma única vez `SEED_ON_DEPLOY=1`, `ORG_NAME`, `ORG_SLUG`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`; o pre-deploy cria dados de referência + organização + usuário owner; depois voltar `SEED_ON_DEPLOY=0`.
- O serviço `web` usa `apps/web/Dockerfile`, start `node apps/web/server.js` e health `/login`, também configurados no serviço.

## Vercel (web)
- Projeto Git com **Root Directory = `apps/web`** (a Vercel instala o workspace pnpm a partir da raiz); `apps/web/vercel.json` compila `@agro/shared`, `@erp/plataforma` e `@agro/domain` antes do `next build` (todo pacote do workspace consumido pelo web precisa entrar aqui e nos Dockerfiles — senão o deploy quebra com o import não resolvido). `output: "standalone"` fica desativado na Vercel (variável `VERCEL`), pois quebra o rastreamento de arquivos da plataforma.
- Variáveis: `NEXT_PUBLIC_API_URL=https://api-production-ec77.up.railway.app`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
- `NEXT_PUBLIC_API_URL` é embutida no build: alterar a URL da API exige novo deploy.
- `NEXT_PUBLIC_DEMO_MODE=true` só em ambientes de demonstração (mostra as credenciais demo no login); produção não define a variável.
- Alternativa/backup na Railway: serviço `web` com `apps/web/Dockerfile` (raiz do repositório como contexto de build); variáveis `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `PORT=3000`, `HOSTNAME=0.0.0.0`.

## Janela de rollout da migração fazenda → empresa (PRE-BASE2-03)

As migrations `0014_company_physical_migration.sql` e `0015_company_rls.sql` renomeiam a tabela, criam a coluna
canônica ao lado da legada e trocam a RLS. Nenhuma coluna legada é removida nesta rodada — é o que permite
implantar sem janela de indisponibilidade e sem exigir que banco, API e web subam no mesmo segundo.

| Fase | O que sobe | Estado do sistema | Pode voltar? |
| --- | --- | --- | --- |
| **1. EXPAND (banco)** | `0014` + `0015` no pre-deploy | `erp.empresas` existe, `erp.farms` vira view, toda tabela de escopo tem as DUAS colunas sincronizadas por gatilho, RLS já recorta por empresa | Sim — a API anterior continua funcionando: ela escreve `farm_id` e o gatilho preenche `empresa_id` |
| **2. API** | binário novo da API | Aceita `X-Empresa-Id` **e** `X-Farm-Id`; traduz payload legado na borda; responde com os DOIS nomes | Sim — o binário anterior volta a rodar contra o mesmo banco |
| **3. WEB** | build novo do frontend | Fala EMPRESA por dentro e LEGADO no fio: envia só `X-Farm-Id`, pede `/api/resources/farms`, manda `farm_id` no corpo e na query, e promove a resposta para o canônico antes de a tela ver o dado | Sim — o build anterior continua servido pela API nova |
| **4. COMPATIBILIDADE (observação)** | nada | Janela em que os dois idiomas convivem; o inventário (`docs/FARM-DEPENDENCY-INVENTORY.md`) mede o que falta | — |

Ordem obrigatória: **1 → 2 → 3**. Subir a API nova antes do banco é o único caminho que quebra (ela escreve
`empresa_id` numa tabela que ainda não tem a coluna).

**A fase 3 pode acontecer ANTES da 2 sem quebrar** — e é o cenário que custa mais caro se não for testado,
porque o que falha não é a aplicação, é o CORS: a API anterior declara `allowedHeaders` sem `X-Empresa-Id`, e
um navegador que o envia tem o preflight recusado e a tela em branco. Por isso o fio do cliente é legado
(`docs/MULTI-COMPANY-CONTRACT.md` §8.4) e o CI tem um job dedicado, **Version skew · web novo × API do commit
base**, que sobe a API daquele commit de verdade (`node scripts/api-anterior.mjs`) contra o banco já migrado
e roda `apps/web/e2e/skew-api-anterior.spec.ts` no navegador.

**A migration é FAIL-CLOSED antes de tocar em qualquer coisa**: se existir linha apontando para empresa de
OUTRA organização, a `0014` PARA e imprime a consulta de diagnóstico com os ids. Ela não corrige em silêncio,
não apaga dado, não troca a empresa e não coloca nulo "para passar" — esse acervo é um incidente e precisa de
decisão humana.

### Rollback

- **Fase 3 ou 2**: redeploy da versão anterior. Nada a desfazer no banco — os dois idiomas continuam válidos.
- **Fase 1**: as migrations são aditivas em dados (nenhuma coluna apagada, nenhuma linha removida:
  `erp.member_farms` está arquivada em `erp.legado_escopo_empresa_v0`). Reverter exige o caminho inverso —
  `erp.empresas` de volta a `erp.farms` (tabela), `drop view`, e as políticas `tenant_isolation` recriadas.
  Enquanto o rollback não acontece, a API anterior segue servida pela view e pelos gatilhos, o que torna a
  reversão uma decisão sem pressa.
- **Não existe rollback "parcial de uma tabela"**: a coluna canônica é PK/UNIQUE/FK nas 49 tabelas de escopo.

### Verificação pós-deploy (fase 1)

```sql
select count(*) from erp.empresas;                                  -- tabela canônica responde
select count(*) from erp.farms;                                     -- view legada responde o mesmo número
select relrowsecurity from pg_class where oid = 'erp.stock_movements'::regclass;   -- t
select polname from pg_policy where polrelid = 'erp.stock_movements'::regclass;    -- tenant_e_empresa

-- tabela com empresa ANULÁVEL: quatro políticas, uma por comando (uma só deixaria DELETE com a regra de leitura)
select polname, polcmd from pg_policy where polrelid = 'erp.documents'::regclass order by polcmd;
-- transferência: além das quatro, o gatilho que impede trocar as pontas sem autoridade na origem
select tgname from pg_trigger where tgrelid = 'erp.warehouse_transfers'::regclass and not tgisinternal;

-- a porta organizacional do saldo é definer, mas estreita: sem execute para public
select proname, prosecdef, proconfig from pg_proc where proname = 'movimentos_conta_organizacao';
select has_function_privilege('public', 'erp.movimentos_conta_organizacao(uuid[],date,date)', 'execute');  -- f
```

Pelo papel da aplicação (`erp_app`, sem bypass): uma consulta a `erp.farms` precisa devolver **o mesmo número
de linhas** que a mesma consulta a `erp.empresas`. Números diferentes significam view definer — e view definer
é vazamento entre organizações.

## Checklist de go-live
- [x] Migrations aplicadas e `erp_app` sem privilégio de bypass RLS (verificado: `rolbypassrls=false`, 171 tabelas com RLS forçada, 187 políticas)
- [x] Autenticação: `AUTH_MODE=local` com `LOCAL_AUTH_SECRET` aleatório (Supabase Auth: evolução)
- [x] CORS (`WEB_ORIGIN`) apontando para os domínios do frontend na Vercel
- [ ] Backups automáticos do Supabase ativos (plano do projeto)
- [x] Usuário owner criado e vinculado (`organization_members.is_owner`)

## Estado real desta entrega (10/09/2026)
| Recurso | Estado | Evidência |
|---|---|---|
| Supabase projeto `CONTROLE-DE-ESTOQUE` (`dcroxgdzzgqgiquvfffa`) | **Aplicado**: 7 migrations via MCP `apply_migration` (registradas também em `public.erp_migrations`, tabela com RLS e sem acesso de `anon`); 171 tabelas, RLS forçada em todas, 187 políticas; papéis `erp_app` (login, sem bypass) e `erp_migrator` (bypass, dono do schema `erp`, privilégios padrão para novas tabelas → `erp_app`). Seed executado pelo pre-deploy: 27 UFs, 773 permissões, organização `Controle de Estoque` (slug `principal`) com owner `maike.lima.adm@gmail.com`, 2 fazendas de exemplo (`[DEMO]`) e cadastros de exemplo. Advisor de segurança: só avisos (search_path mutável em 12 funções; `citext` em `public`). | `list_migrations`, `execute_sql`, `get_advisors` |
| Railway serviço `api` | **Em produção** em `https://api-production-ec77.up.railway.app` (deployment `4525526d…` SUCCESS). Pre-deploy `node dist/migrate.js` e healthcheck `/health` configurados no serviço. Verificado: `GET /health` → `{"status":"ok","db":"ok"}`; `POST /api/auth/login` 200 com o owner e 401 com senha errada; `GET /api/auth/context` devolve organização e fazendas; `GET /api/resources/products` lista com `X-Org-Id` correto, **403** com organização alheia e **401** sem token. Pooler correto para este projeto: `aws-0-sa-east-1` (o `aws-1` responde `tenant/user not found`). Região do container: `sfo` (latência ~1 s na primeira consulta; migrar para região mais próxima quando disponível). `WEB_ORIGIN` ainda precisa apontar para a URL final do frontend. | logs do deployment; `curl` |
| Vercel (frontend) | Projeto `controle-de-estoque` configurado (Root `apps/web`, Next.js, Node 22, domínios `controle-de-estoque-erp.vercel.app` e `controle-de-estoque-api-eight.vercel.app`). **Em 10/09/2026 ~16:30 UTC o time da Vercel entrou em bloqueio por fatura em aberto** (`softBlock: UNPAID_INVOICE`, plano Pro com status `canceled`): todas as URLs respondem `402 Payment Required / DEPLOYMENT_DISABLED` e novos deploys não são publicados. Ação do proprietário: regularizar a fatura em vercel.com › Settings › Billing (o deploy volta sozinho) ou manter o frontend na Railway (abaixo). | `curl -I https://controle-de-estoque-erp.vercel.app` → 402 |
| Railway serviço `web` (frontend, alternativa) | Serviço `web` no mesmo projeto Railway, build por `apps/web/Dockerfile` (Next standalone; `NEXT_PUBLIC_*` embutidas no build a partir das variáveis do serviço), domínio `https://web-production-4a835.up.railway.app`, healthcheck `/login`. `WEB_ORIGIN` da API já inclui esse domínio. | serviço `74264061-f73a-40ee-9748-11be096c0cb6` |
| Pull requests | PR #1 (sistema) e PR #2 (correção do deploy Vercel) mergeados em `main`; Railway e Vercel implantam a partir de `main` | GitHub |
