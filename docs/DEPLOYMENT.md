# Deploy

## Supabase (banco + auth + storage)
1. Criar projeto; anotar `Project URL`, `anon key`, `service role key`, `JWT secret` (Settings › API) e a connection string do **pooler em modo sessão** (`aws-0-<região>.pooler.supabase.com`, porta 5432). **Não** acrescente `?sslmode=require` à URL: o `pg` passa a exigir certificado verificado e a conexão falha com `self-signed certificate in certificate chain`; o pool já negocia TLS sozinho.
2. Papéis: `erp_app` (login, **sem** bypass de RLS; usado pela API em `DATABASE_URL`) e `erp_migrator` (login, `bypassrls`, dono do schema `erp`; usado só pelo pre-deploy em `MIGRATE_DATABASE_URL`). Senhas fortes, nunca versionadas.
3. Aplicar `supabase/migrations/*.sql` em ordem (`pnpm db:migrate` com `DATABASE_URL` do projeto, ou MCP `apply_migration`). Depois `pnpm db:seed` para dados de referência + organização inicial.
4. Auth: habilitar e-mail/senha; ao criar usuários no Supabase, preencher `erp.users.auth_user_id`. Storage: bucket privado `attachments`.
5. **Status nesta entrega**: aplicado no projeto `CONTROLE-DE-ESTOQUE` (ref `dcroxgdzzgqgiquvfffa`, sa-east-1, Postgres 17) — ver tabela abaixo.

## Railway (API)
- Serviço a partir do repositório; configuração definida no próprio serviço (sem `railway.json` na raiz, pois ele valeria para todos os serviços do repositório): Dockerfile `apps/api/Dockerfile`, start `node dist/main.js`, health `/health`, pre-deploy `node dist/migrate.js` (aplica migrations pendentes).
- **Pre-deploy sem teto de tempo.** O campo *Pre-Deploy Timeout* do serviço está **vazio** (`preDeployTimeoutSeconds = null`, lido em 15/09/2026 pela API do Railway, no `serviceInstance` do serviço `api` em `production`). Pela documentação do Railway, vazio significa **sem limite**: um pre-deploy que trave não falha o deploy — ele o segura. O `healthcheckTimeout` de 120 s não cobre essa janela, porque só começa a contar depois que o pre-deploy termina. O único teto que existe hoje é do lado do banco (`statement_timeout` de 120 s; `lock_timeout` = 0), e ele só alcança o que está DENTRO de um enunciado SQL — DNS, handshake, aquisição de conexão do pool, `seedPermissions` e travamento de código ficam sem teto algum. Relevante para toda migration longa, e especialmente para a 05C-1, onde deixou de ser observação: como o merge em `main` dispara deploy automático, **enquanto este campo estiver vazio a 05C-1 não é liberada para merge** (`OPERATIONAL MERGE BLOCKER`; enunciado, saída e onde o valor medido será registrado em `docs/PRE-BASE2-05C-1-PREFLIGHT.md`, U4).
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
| **2. API** | binário novo da API | **Desde PRE-BASE2-05B fala só o canônico**: aceita `X-Empresa-Id`, recebe e responde `empresa_*`, e RECUSA o contrato anterior com 422 | Sim — o binário anterior volta a rodar contra o mesmo banco (o espelho de coluna continua até 05C) |
| **3. WEB** | build novo do frontend | **Canônico ponta a ponta desde PRE-BASE2-05A**: `X-Empresa-Id`, `/api/resources/empresas`, `empresa_id` no corpo e na query, resposta consumida como vem | Sim — o build da 05A continua servido pela API da 05B (provado nos dois sentidos do version skew) |
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
| **05A — Cliente canônico** ✅ publicada | tradutor de fio do web, o cabeçalho anterior do navegador | API e banco bilíngues |
| **05B — Servidor canônico** ✅ publicada | borda legada da API (cabeçalho, entrada, apelidos, CORS, recurso, escopo admin achatado, promoção de sessão) | banco bilíngue |
| **05C-0 — Instrumentos** ✅ mesclada (PR #33) | nada do banco: **NO-DDL**. Calibra os gates que a purga usa como prova | tudo |
| **05C-G0/G1/G2 — Preflight** ✅ concluída | nada do banco: leitura de produção, correção de documentação, contratos executáveis e runbook. Ver `docs/PRE-BASE2-05C-1-PREFLIGHT.md` | tudo |
| **05C-1 — Purga física** ⬅ atual: migration **escrita** (`0017_purge_farm_legacy.sql`), PR DRAFT, ⛔ **merge NÃO liberado** (U4) | 52 colunas legadas em 49 tabelas, as **cinco** views de nome antigo, 52 gatilhos de espelho NOMEADOS (as tabelas alvo têm 66 gatilhos: 14 são de negócio e ficam) e 3 funções, **52 FKs de coluna única** (as **50** compostas ficam), 8 índices, e o CHECK órfão de `erp.equipment_transfers` só depois do substituto canônico | contador `entity='farm'`; lápides (`contrato-legado.ts`, redirects) |
| **05C-2 — Contador** | a linha `entity='farm'` de `erp.code_sequences` e a constante `SEQUENCIA_EMPRESA` | — |

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

### Go-live e recuperação da 05C (fail-closed)

A 05C-1 é a primeira migration **destrutiva** do produto, e por isso o critério de largada é uma lista de
gates, não uma impressão de prontidão. Nenhum item abaixo se satisfaz com preview, `localhost`, CI ou
"deploy verde" — cada um é uma pergunta respondida contra o objeto real.

**Antes de liberar para MERGE — porque o merge em `main` dispara o deploy sozinho:**

1. **U4 — o pre-deploy precisa ter teto de tempo.** `preDeployTimeoutSeconds` está vazio no serviço `api`
   (medido em 15/09/2026): um pre-deploy travado não falha o deploy, ele o segura, e nenhum teto de banco
   alcança DNS, handshake, pool ou `seedPermissions`. Como não existe "mesclar agora e decidir o deploy
   depois", este é um **`OPERATIONAL MERGE BLOCKER`**: a PR da 05C-1 fica em DRAFT até haver valor medido no
   campo, ou contenção equivalente aceita por escrito. **Configurar isso é ação humana no painel do
   Railway; nenhuma fatia altera o serviço.** O valor recomendado vem da medição da própria `0017`, e o
   lugar de registrá-lo é `docs/PRE-BASE2-05C-1-PREFLIGHT.md`, U4.

**Antes de aplicar (todos obrigatórios; qualquer `PENDING` interrompe):**

1. **P1 — `NOT APPLICABLE WHILE PRE-PROD DATA IS DISPOSABLE`.** O proprietário declarou que o sistema ainda
   não está em produção operacional, que os dados atuais não precisam ser preservados e que, em falha, é
   aceitável resetar o banco, reaplicar as migrations e recriar os dados de teste — logo **`RECOVERY =
   REBUILD FROM ZERO`** (procedimento na seção "Recuperação", abaixo). Isto **não é `PASS`**: o drill de
   restore continua sem ter sido feito, e um backup que nunca foi restaurado continua sendo hipótese.
   **Condição de retorno, obrigatória:** antes do PRIMEIRO uso real e antes do PRIMEIRO dado não
   descartável, o drill de backup + restore volta a ser gate `BLOCKED`, com o enunciado original. O que
   conta como "dado não descartável", quem declara e o que fazer quando disparar estão em
   `docs/PRE-BASE2-05C-1-PREFLIGHT.md`, P1 — este item não repete a definição, só a obedece.
2. **Remedição dos dados persistidos com nome antigo** na produção autenticada (tabela em
   `docs/PRE-BASE2-05-APOSENTADORIA.md`). Se qualquer contagem for > 0, a 05C-1 deixa de ser só DDL e a
   fatia muda de escopo.
3. **Uma única versão da API servindo** — condição da 05C-2, não da 05C-1, mas registrada aqui porque é o
   gate que as pessoas esquecem entre as duas.
4. **Gates verdes na PR da 05C-1**, incluindo os instrumentos calibrados na 05C-0: `company-schema-sync` em
   fase `canonica`, guarda de RLS com a política `api_child` reescrita, `upgrade-acervo` aplicando a
   sequência INTEIRA (o laço final não para na 0016: aplica tudo que ficou pendente, 0017 inclusive, e
   confere que nada sobrou) — `upgrade-rollback` NÃO atravessa a purga, e não deveria: ele prova a janela
   de suspensão do gatilho do ledger dentro da 0014 e termina ali — version skew nos dois sentidos com a
   base impressa no log —
   mais os testes próprios da purga (`packages/db/test/purga-0017-*.test.ts`: base nova, upgrade com
   acervo, invariantes estruturais e concorrência).
5. **G-U5 executado e verde** — comando: **`pnpm gate:g-u5`** (`scripts/gate-purga-0017-runtime-anterior.mjs`). Ele NÃO roda no CI, e a razão está escrita: precisa compilar e subir o binário da BASE, o que exige a árvore da base e um banco descartável próprio; o que o CI cobre são os `purga-0017-*`. Por isso é pré-requisito NUMERADO aqui, com comando, e não prosa. O binário da API que
   está em produção subindo e servindo contra um banco com a `0017` aplicada: boot, login, leitura escopada por empresa e gravação com conferência de ROW
   COUNT. Roda em banco descartável, sem custo. Sem ele, a compatibilidade do runtime anterior com o
   schema pós-purga é derivação de auditoria estática, não fato — e é ela que sustenta a dispensa de
   U1, U2 e U3 em `docs/PRE-BASE2-05C-1-PREFLIGHT.md`.
6. **Porteiro de locks lido na hora, por papel com `pg_read_all_stats`** (ou superusuário), sem linha
   `BLOQUEIA` e sem linha `porteiro_invalido`. Papel sem esse privilégio enxerga menos do que precisa e a
   consulta devolve vazio — vazio por cegueira é indistinguível de vazio por calmaria.

**Depois de aplicar, antes de declarar concluída** (lista própria, numeração própria):

1. consulta de catálogo em produção provando que os objetos da tabela de inventário **não existem mais**;
2. `CHECK` canônico equivalente ao órfão **existe** (a invariante "origem ≠ destino" continua no banco);
3. cadastro real de uma Empresa em produção, conferindo que o código alocado é novo e não repete;
4. as categorias `TOMBSTONE` e `PROVA_HISTORICA` da superfície de compatibilidade **ainda declaradas**.

#### Recuperação — `RECOVERY = REBUILD FROM ZERO`

Enquanto valer a declaração de pré-produção (item 1 dos pré-requisitos), o caminho autorizado de
recuperação **não é restaurar backup**: é **recriar o ambiente**. Está escrito aqui porque é o dono do
assunto; a política e a condição de retorno que o autorizam moram em
`docs/PRE-BASE2-05C-1-PREFLIGHT.md`, P1.

**Diga-se antes de tudo o que este caminho NÃO é.** Ele **não recupera dado**: tudo que estiver no banco no
momento da falha se perde, e nada é reconstruído a partir do que havia. Ele recria um ambiente **novo**, com
o schema correto e dados de TESTE. Só é aceitável porque, hoje, o dado é descartável por declaração escrita.
No dia em que deixar de ser, este procedimento deixa de ser recuperação e passa a ser destruição — e o gate
P1 volta antes disso.

**O procedimento, na ordem:**

1. **Parar de implantar.** O deploy que falhou não é retentado até o fim deste roteiro: uma segunda
   tentativa em cima de um banco em estado desconhecido troca um problema legível por um ilegível.
2. **Olhar o ledger antes de mexer** — é ele que diz onde a falha parou:
   `select count(*), max(name) from public.erp_migrations;`. Como cada migration roda em UMA transação
   (`begin` → arquivo → `insert` no ledger → `commit`), o ledger só tem a linha se o arquivo inteiro passou.
   Ledger em `0016` depois de uma tentativa da `0017` significa que a purga voltou atrás por completo —
   comportamento desejado, não incidente.
3. **Recriar o banco vazio** (ou um projeto novo, se o dano for do projeto). Nenhuma sessão automatizada faz
   isso: `.claude/hooks/` recusa `db:reset`, `db:migrate` e `db:seed` justamente porque a conexão vem do
   ambiente e o guarda não distingue local de remoto.
4. **Aplicar as migrations em ordem, `0001` a `0017`**, pelo runner do produto (`pnpm db:migrate`, ou o
   pre-deploy `node dist/migrate.js` no serviço). Nunca aplicar arquivo solto: a ordem é a garantia.
5. **Recriar os dados de teste** com `pnpm db:seed` (dados de referência, organização, usuário owner,
   cadastros de exemplo). Em produção isso é `SEED_ON_DEPLOY=1` por UM deploy, voltando a `0` em seguida —
   e voltar a `0` faz parte do procedimento, não é limpeza opcional.
6. **Recriar o que o seed não recria**: usuários reais do Auth, `erp.users.auth_user_id`, bucket
   `attachments` e seus arquivos. Se essa lista doer, a condição de retorno de P1 provavelmente já
   disparou — pare e releia P1.

**O que conferir no fim** (qualquer resposta fora do esperado significa ambiente não recuperado):

```sql
select count(*) as migrations, max(name) as ultima from public.erp_migrations;
-- esperado: 17 / 0017_purge_farm_legacy.sql

select count(*) as colunas_legadas from pg_attribute a
  join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'erp' and c.relkind = 'r' and a.attnum > 0 and not a.attisdropped
   and a.attname in ('farm_id','origin_farm_id','destination_farm_id');          -- esperado: 0

select count(*) as fks_compostas from pg_constraint k
  join pg_class c on c.oid = k.conrelid join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'erp' and k.contype = 'f' and array_length(k.conkey,1) = 2
   and k.confrelid = 'erp.empresas'::regclass and k.convalidated;                 -- esperado: 50

select count(*) as check_canonico from pg_constraint
 where conrelid = 'erp.equipment_transfers'::regclass and contype = 'c'
   and conname = 'equipment_transfers_empresa_origem_destino_check' and convalidated;  -- esperado: 1

select count(*) as empresas from erp.empresas;                                    -- esperado: > 0
select relrowsecurity from pg_class where oid = 'erp.stock_movements'::regclass;  -- esperado: t
```

E, no ar: `GET /health` em 200, login do owner em 200, uma listagem escopada por empresa devolvendo linha.
Schema certo com aplicação fora do ar não é ambiente recuperado.

**Por que a `0017` quase nunca deixa meio caminho.** Ela é atômica e sem `cascade`: se qualquer objeto do
inventário divergir, ou se qualquer dependência escapar da lista, o comando falha e a transação inteira
volta atrás — schema como estava, ledger sem a entrada. Medido em laboratório: com o `CHECK` canônico
sabotado, a migration morreu na própria pós-condição e o banco voltou a 52 colunas legadas, 5 views, 52
gatilhos e ledger em `0016`; com um `drop trigger` retirado da lista, ela morreu em
`cannot drop function … because other objects depend on it`, com o mesmo estado íntegro no fim. Falhar
barato e repetir é o comportamento desejado.

**Reversão da 05C-1, se um dia for preciso desfazer com o banco íntegro.** Recriar coluna + repopular a
partir da canônica: o dado não se perde, porque a coluna legada era espelho. A política de RLS e o CHECK
**não** voltam sozinhos, e não porque tenham sido removidos com `cascade` — a `0017` **não usa `cascade` em
lugar nenhum**: eles saem nomeados, um a um, e por isso a volta é sempre "recriar o que está versionado".
A política `api_child` se recria a partir da `0014`; o CHECK de `erp.equipment_transfers` nasceu em
**`supabase/migrations/0005_sales_fleet_hr.sql:142`** — *não* na `0002`, que nem cria essa tabela. É essa a
razão de a ordem mandar reescrever a política e criar o CHECK canônico **antes** de qualquer `drop`:
nenhuma proteção some de carona.

**A 05C-0 não autoriza a 05C-1.** Mesmo com aquela PR mesclada e o CI inteiro verde, a fatia destrutiva
depende dos pré-requisitos acima, que exigem acesso autenticado à produção e decisão do Maike.

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
- [ ] Backups automáticos do Supabase ativos (plano do projeto) — **e restaurados pelo menos uma vez**.
  Hoje `NOT APPLICABLE WHILE PRE-PROD DATA IS DISPOSABLE`: a recuperação autorizada é
  `RECOVERY = REBUILD FROM ZERO` (seção "Recuperação"). Esta caixa **não** se marca por declaração de
  pré-produção — ela continua aberta, e volta a ser obrigatória antes do primeiro uso real.
- [x] Usuário owner criado e vinculado (`organization_members.is_owner`)

## Estado real desta entrega (10/09/2026)
| Recurso | Estado | Evidência |
|---|---|---|
| Supabase projeto `CONTROLE-DE-ESTOQUE` (`dcroxgdzzgqgiquvfffa`) | **Aplicado**: 7 migrations via MCP `apply_migration` (registradas também em `public.erp_migrations`, tabela com RLS e sem acesso de `anon`); 171 tabelas, RLS forçada em todas, 187 políticas; papéis `erp_app` (login, sem bypass) e `erp_migrator` (bypass, dono do schema `erp`, privilégios padrão para novas tabelas → `erp_app`). Seed executado pelo pre-deploy: 27 UFs, 773 permissões, organização `Controle de Estoque` (slug `principal`) com owner `maike.lima.adm@gmail.com`, 2 fazendas de exemplo (`[DEMO]`) e cadastros de exemplo. Advisor de segurança: só avisos (search_path mutável em 12 funções; `citext` em `public`). | `list_migrations`, `execute_sql`, `get_advisors` |
| Railway serviço `api` | **Em produção** em `https://api-production-ec77.up.railway.app` (deployment `4525526d…` SUCCESS). Pre-deploy `node dist/migrate.js` e healthcheck `/health` configurados no serviço. Verificado: `GET /health` → `{"status":"ok","db":"ok"}`; `POST /api/auth/login` 200 com o owner e 401 com senha errada; `GET /api/auth/context` devolve organização e fazendas; `GET /api/resources/products` lista com `X-Org-Id` correto, **403** com organização alheia e **401** sem token. Pooler correto para este projeto: `aws-0-sa-east-1` (o `aws-1` responde `tenant/user not found`). Região do container: `sfo` (latência ~1 s na primeira consulta; migrar para região mais próxima quando disponível). `WEB_ORIGIN` ainda precisa apontar para a URL final do frontend. | logs do deployment; `curl` |
| Vercel (frontend) | Projeto `controle-de-estoque` configurado (Root `apps/web`, Next.js, Node 22, domínios `controle-de-estoque-erp.vercel.app` e `controle-de-estoque-api-eight.vercel.app`). O bloqueio por fatura em aberto de 10/09/2026 (`softBlock: UNPAID_INVOICE`, `402 DEPLOYMENT_DISABLED`) **foi regularizado**: em 15/09/2026 os dois domínios respondem **200** e a Vercel voltou a publicar — o commit `85666dcc` de `main` tem status `success` ("Deployment has completed"). O frontend servido em produção continua sendo o da Railway (abaixo); a Vercel é a segunda superfície. | `curl -I https://controle-de-estoque-erp.vercel.app` → 200; commit status `Vercel` = success |
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
