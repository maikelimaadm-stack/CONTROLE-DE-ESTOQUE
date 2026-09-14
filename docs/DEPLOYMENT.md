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

**A fase 3 pode acontecer ANTES da 2** — e é o cenário que custa mais caro se não for testado, porque o que
falha não é a aplicação, é o CORS. Até a PRE-BASE2-04 o fio do cliente era legado por causa disso. Desde a
**PRE-BASE2-05A** o cliente é canônico, e a ordem passou a ser um requisito explícito: **o web canônico só
pode subir sobre uma API ≥ PRE-BASE2-03**, que é o que está em produção. O CI mantém o job dedicado,
**Version skew · web novo × API do commit base**, que sobe a API daquele commit de verdade
(`node scripts/api-anterior.mjs`) contra o banco já migrado e roda `apps/web/e2e/skew-api-producao.spec.ts`
no navegador — agora provando que o canônico atravessa, e reprovando se a API regredir.

### PRE-BASE2-05 — aposentadoria da ponte, em três fases

| Fase | O que sai | O que continua |
| --- | --- | --- |
| **05A — Cliente canônico** | tradutor de fio do web, `X-Farm-Id` do navegador | API e banco bilíngues |
| **05B — Servidor canônico** | borda legada da API (cabeçalho, entrada, apelidos, CORS) | banco bilíngue |
| **05C — Purga física** | colunas legadas, view `erp.farms`, gatilhos de espelho, sequência `entity='farm'` | — |

Cada fase só começa depois de a anterior estar em produção e comprovada. **05A não remove compatibilidade
nem da API nem do banco.** Detalhes e inventários: `docs/PRE-BASE2-05-APOSENTADORIA.md`.

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

## Incidente de ativação: 0014 × ledger append-only (resolvido no código, ainda não aplicado)

O primeiro deploy pós-merge da PRE-BASE2-04 falhou no pre-deploy, em DUAS camadas, e a segunda exigiu
correção de código. Registro aqui porque muda qual commit deve ser implantado.

| Camada | O que barrou | Resolução |
| --- | --- | --- |
| `0011_company_permissions.sql` | guarda deliberada: 1 proprietário com escopo restrito em `erp.member_farms` (2 de 2 empresas — restrição vazia) | normalização controlada em produção, com backup: os 2 vínculos removidos, `is_owner` preservado. 0011, 0012 e 0013 aplicaram. |
| `0014_company_physical_migration.sql` | `LEDGER_IMMUTABLE: stock_movements não permite UPDATE` — o backfill de `empresa_id` faz UPDATE numa tabela append-only desde a 0003 | **correção de código** (esta PR): a 0014 suspende `trg_stock_movement_immutable` apenas em volta do seu próprio UPDATE, dentro da transação da migration. |

**Por que a própria 0014 foi corrigida, e não uma 0017.** O runner ordena e executa em sequência e aborta na
0014 — 0015, 0016 e uma eventual 0017 jamais seriam alcançadas. E ele registra NOME, não checksum: como a
0014 nunca chegou a constar em `public.erp_migrations` (a tentativa sofreu rollback integral, sem objeto
parcial), a versão corrigida é executada normalmente na primeira aplicação bem-sucedida. A exceção é
estreita e não vira precedente: migration mesclada e JÁ APLICADA continua sendo história intocável.

**O próximo redeploy NÃO parte de `1b6034d`.** Ele parte do commit de merge desta PR de hotfix. Redeployar
`1b6034d` reproduziria o mesmo `LEDGER_IMMUTABLE`.

Estado de produção no momento deste registro: `public.erp_migrations` em **0013**; API ativa ainda é a de
PRE-BASE2-01 (`449730e`); 0014, 0015 e 0016 pendentes; backfill e verify NÃO executados.

## PRE-BASE2-04 — ativação do ID Global

A ordem importa, e o motivo de cada fase é o estado intermediário que ela evita.

| Fase | O que sobe | Por que nesta ordem |
| --- | --- | --- |
| **1. Banco** | migrations pendentes `0014` → `0016` (pre-deploy do serviço) | Só infraestrutura (reserva de faixa, constraint, índice). Não percorre acervo, então é rápida e reversível. |
| **2. API** | alocação automática + `/registros-globais/:idGlobal` e `/registros-globais/entidade/:tipo/:id` | A partir daqui **todo registro novo já nasce numerado**. Subir a API antes do backfill é de propósito: enquanto o histórico é numerado, o fluxo novo já está correto. |
| **3. Backfill** | no serviço da API: `npm run id-global:backfill -- --batch-size 500` (usa `MIGRATE_DATABASE_URL`) | Em lotes, retomável, reexecutável. Rodar até `faltando ao fim: 0`. Conferir com `npm run id-global:verify`. |
| **4. Web** | busca `#N` e badge de identidade | A UI tolera registro histórico ainda sem número (o badge simplesmente não aparece), então pode subir junto com a API — mas a fase 3 é o que faz a funcionalidade valer para o acervo inteiro. |

### Onde o comando da fase 3 roda — e por que não é `pnpm` da raiz

Há DOIS ambientes, e eles têm comandos diferentes porque têm conteúdos diferentes:

| Ambiente | Comando | Por quê |
| --- | --- | --- |
| **Repositório / desenvolvimento / CI** | `pnpm id-global:backfill -- --batch-size 500` · `pnpm id-global:verify` | Scripts do `package.json` da RAIZ, executados com `tsx` sobre `src/`. Existe só onde há checkout do monorepo. |
| **Produção (serviço da API no Railway)** | `npm run id-global:backfill -- --batch-size 500` · `npm run id-global:verify` | Scripts do `apps/api/package.json`, que executam `node dist/cli/id-global-backfill.js`. É o que existe DENTRO da imagem. |

A imagem é construída com `pnpm --filter @agro/api deploy --prod --legacy /out` e o runtime faz
`COPY --from=build /out ./`: ela contém **o pacote `@agro/api` com suas dependências de produção**, e não um
checkout do monorepo. Nela **não existe** o `package.json` da raiz (logo, nenhum script `pnpm id-global:*`) e
**não existe `tsx`** (devDependency, cortada pelo `--prod`). Documentar o comando do repositório para rodar em
produção seria descobrir o erro no pior momento: migration já aplicada, API nova no ar e acervo ainda sem
número.

Equivalente direto, se preferir não passar pelo `npm run`:

```
node dist/cli/id-global-backfill.js --batch-size 500
node dist/cli/id-global-backfill.js --verify-only
```

O gate `node scripts/artefato-operacional.mjs` (no `pnpm lint`) prova o contrato — script presente, apontando
para `node dist/`, sem devDependency, com o Dockerfile levando `/out` para o runtime — e, no job de build da
CI, `--compilado` **executa o artefato de verdade** e exige que ele recuse por falta de conexão operacional,
nunca por arquivo ou script ausente.

### A conexão da fase 3 é a OPERACIONAL, não a da API

O backfill e o verify leem **`MIGRATE_DATABASE_URL`** (o papel `erp_migrator`, com `bypassrls`) — ou
`ID_GLOBAL_DATABASE_URL`, se você preferir uma variável dedicada. **Não há queda para `DATABASE_URL`**: sem
uma das duas, o comando não roda. Não é preciso (nem se deve) copiar segredo para a linha de comando; o
próprio comando escolhe a variável certa do ambiente, que o serviço da API já possui para o pre-deploy.

O motivo é um falso verde, não uma preferência de estilo. `DATABASE_URL` conecta como `erp_app`, **sem**
bypass de RLS. O comando percorre todas as organizações **sem contexto de tenant**, e nesse estado
`erp.tenant_visible(organization_id)` é falso para todas as linhas das 23 tabelas: o backfill conclui com
`atribuídos: 0`, `faltando: 0` e o verify diz **"invariantes OK"** — com o acervo histórico inteiro sem
número. Medido em `apps/api/test/integration/id-global-backfill-conexao.test.ts`.

Duas barreiras impedem que isso volte:

1. **preflight de papel** — o comando consulta `pg_roles` e exige `rolsuper` **ou** `rolbypassrls`; qualquer
   outro papel é recusado **antes** de contar qualquer coisa, citando só o nome do papel (nunca DSN, host ou
   senha). A saída é usar a conexão certa: a aplicação **nunca** concede a si mesma o que lhe falta —
   `alter role erp_app bypassrls`, `set role`, desligar RLS ou um `security definer` genérico estão fora de
   questão, porque destruiriam a separação entre runtime e operação;
2. **zero organizações não certifica nada** — sem `--org`, nenhuma organização visível é ERRO; e `--org` é
   provado contra o banco (UUID malformado e organização inexistente falham, em vez de produzir um verde
   sobre um alvo que não existe).

Saída esperada do verify (é o que torna um resultado absurdo visível de relance):

```
$ npm run id-global:verify
conexão operacional: papel "erp_migrator" (rolsuper=false, rolbypassrls=true).
organizações verificadas: 1 · entidades verificadas: 23 · registros globais: 12345 · elegíveis faltando: 0
ID Global: invariantes OK (zero elegível sem número, zero duplicidade, zero órfão).
```

`organizações verificadas: 0` nunca aparece: o comando para antes.

**Certificação — o que ainda NÃO aconteceu.** Nada disto foi executado em produção: a PR da PRE-BASE2-04 não
foi mesclada e nenhuma fase foi disparada. O que está provado é o código, em ambiente de teste (banco novo,
banco de upgrade com acervo legado, reexecução com mapa idêntico, medição de desempenho). A missão só se
considera concluída depois de, nesta ordem: **merge aprovado** → **fase 1** → **fase 2** → **fase 3 rodada
até `faltando: 0`** → **`pnpm id-global:verify` verde** → **fase 4 com smoke real** (buscar `#N` e `ID N`,
abrir o registro pela rota canônica e conferir o distintivo na tela). Até lá, `docs/PRE-BASE2-ROADMAP.md`
mantém a missão como "implementação pronta — ativação em produção pendente".

**Smoke da fase 4 (o que olhar):** `#N` e `ID N` na busca (Ctrl+K) devolvem o registro certo; a URL final é a
rota canônica **com o UUID**; o distintivo mostra o mesmo número na tela do registro; e um `#N` de registro
fora do escopo do usuário responde a mesma coisa que um número inexistente.

**Reversão por fase.** Voltar o web: o número continua no banco, ninguém perde identidade. Voltar a API:
registros novos param de receber número — rodar o backfill de novo depois resolve, sem renumerar nada.
Voltar o banco NÃO é recomendado depois que `#N` foi exibido: apagar `registros_globais` destruiria
identidades que o usuário já anotou. `sequencias_id_global.ultimo_valor` nunca deve ser diminuído.
