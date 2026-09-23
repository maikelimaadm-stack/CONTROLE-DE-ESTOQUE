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
- Variáveis: `DATABASE_URL` (pooler, usuário `erp_app`), `MIGRATE_DATABASE_URL` (pooler, usuário `erp_migrator`), `MIGRATIONS_DIR=/app/supabase/migrations`, `AUTH_MODE=local` + `LOCAL_AUTH_SECRET` (login por e-mail/senha na tabela `erp.users`; `AUTH_MODE=supabase` + `SUPABASE_JWT_SECRET` fica como evolução, pois o web ainda não usa Supabase Auth), `SUPABASE_URL`, `WEB_ORIGIN=https://<app>.vercel.app`, `PORT=3333`, `API_LOG_LEVEL=info`, `RATE_LIMIT_MAX`, `TOP_EFFECTS_RUNTIME_V1_ENABLED` (gate da execução configurada da TOP: ausente ou `0` = desligado, `1` = ligado; qualquer outro valor derruba o startup. Ligá-lo é a fase 2 da seção TOP-CONFIG-04A abaixo, e só no serviço da API — o web não tem par).
- Seed inicial: definir uma única vez `SEED_ON_DEPLOY=1`, `ORG_NAME`, `ORG_SLUG`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`; o pre-deploy cria dados de referência + organização + usuário owner; depois voltar `SEED_ON_DEPLOY=0`.
- O serviço `web` usa `apps/web/Dockerfile`, start `node apps/web/server.js` e health `/login`, também configurados no serviço.

## Superfície web

<!-- SUPERFICIE-WEB-CANONICA -->
CONTRATO_SUPERFICIE_WEB: duas-suportadas
SUPERFICIE_WEB_RAILWAY: suportada
SUPERFICIE_WEB_VERCEL: suportada

**Esta seção é o DONO da resposta "qual superfície web é de produção".** Nenhum outro arquivo do
repositório decide isso; todos os demais referenciam esta. `scripts/superficie-web-canonica-audit.mjs`
cobra três metades: (1) a âncora com o contrato tem de existir aqui, uma única vez e com valor da
lista fechada; (2) nenhum arquivo declarado — inclusive ESTE, fora da faixa que vai da âncora até o
próximo `##` — pode DECLARAR o papel vigente, seja atribuindo posição a um provedor nomeado
("canônica", "principal", "oficial", "suportada", "secundária", "backup", "alternativa"), seja
declarando a CARDINALIDADE da topologia ("duas superfícies suportadas"); fora daqui só se
REFERENCIA esta seção; (3) as duas portas que provam o commit servido (`/api/build` no web e o
campo `build` no `/health` da API) têm de existir e resolver a identidade do build.

Menção explicitamente marcada como histórica continua legítima em qualquer arquivo — o gate não
apaga o que já foi verdade, desde que o próprio texto diga que é passado.

O contrato vigente é **DUAS SUPERFÍCIES SUPORTADAS**, e ele descreve o que está no ar, não uma
preferência:

| Superfície | Domínio | Papel |
|---|---|---|
| Railway `web` | `web-production-4a835.up.railway.app` | suportada, implanta de `main` |
| Vercel | `controle-de-estoque-erp.vercel.app` e `controle-de-estoque-api-eight.vercel.app` | suportada, implanta de `main` |

**A obrigação que vem junto: as duas têm de provar o MESMO commit de `main`.** `GET /api/build` em
cada superfície devolve `{ build: { sha, provedor, ambiente, origem } }`. Divergência de `sha` entre
elas, ou `sha` diferente da ponta de `main`, **não é diferença de artefato — é incidente de deploy**,
e o deploy não está certificado enquanto não fechar.

Por que DUAS e não uma canônica: o `WEB_ORIGIN` da API autoriza hoje as TRÊS origens acima, e todas
respondem `200` em `/login`. Eleger uma canônica em documento sem remover as outras do `WEB_ORIGIN`
seria prosa: o runtime continuaria contradizendo o texto. Reduzir para uma superfície é alteração de
configuração de produção e está registrada como ação manual em "Ações manuais pendentes", abaixo.

**Os artefatos dos dois provedores são legitimamente diferentes byte a byte** — a Vercel usa o Next
gerenciado e a Railway usa Docker com `output: "standalone"` (`apps/web/next.config.ts`). Portanto
diferença de HTML, de tamanho ou de caminho de asset **não prova** commit diferente. Quem prova é
`/api/build`.

### Ações manuais pendentes (MANUAL ACTION REQUIRED — nenhuma executada automaticamente)

1. **Decidir se o contrato vira "uma canônica".** Se sim, é preciso (a) remover as origens não
   canônicas do `WEB_ORIGIN` do serviço `api` e (b) tirar do ar ou proteger os domínios
   correspondentes. As duas são alteração de produção e exigem autorização explícita do Maike na
   hora — e só depois delas o texto pode dizer "canônica" sem mentir.
2. **`controle-de-estoque-api-eight.vercel.app` serve o app WEB sob um nome que promete uma API**, e
   está autorizado no `WEB_ORIGIN`. Medido: responde byte a byte igual ao domínio `-erp`. Remover
   este domínio é a menor redução de superfície disponível.
3. **A Railway implanta de `main` sem exigir CI verde** (`checkSuites: false` nos dois serviços):
   `main` vermelha vai a produção. Corrigir é configuração do painel, não do repositório.

## Vercel (web)
- Projeto Git com **Root Directory = `apps/web`** (a Vercel instala o workspace pnpm a partir da raiz); `apps/web/vercel.json` compila `@agro/shared`, `@erp/plataforma` e `@agro/domain` antes do `next build` (todo pacote do workspace consumido pelo web precisa entrar aqui e nos Dockerfiles — senão o deploy quebra com o import não resolvido). `output: "standalone"` fica desativado na Vercel (variável `VERCEL`), pois quebra o rastreamento de arquivos da plataforma.
- Variáveis: `NEXT_PUBLIC_API_URL=https://api-production-ec77.up.railway.app`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
- `NEXT_PUBLIC_API_URL` é embutida no build: alterar a URL da API exige novo deploy.
- `NEXT_PUBLIC_DEMO_MODE=true` só em ambientes de demonstração (mostra as credenciais demo no login); produção não define a variável.
- A Railway também constrói o web (o papel de cada superfície está em "## Superfície web"): serviço `web` com `apps/web/Dockerfile` (raiz do repositório como contexto de build); variáveis `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `PORT=3000`, `HOSTNAME=0.0.0.0`.

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
| **05C-1 — Purga física** ✅ mesclada (PR #36, `602cda3`) e **aplicada em produção** em 16/09/2026 | 52 colunas legadas em 49 tabelas, as **cinco** views de nome antigo, 52 gatilhos de espelho NOMEADOS (as tabelas alvo têm 66 gatilhos: 14 são de negócio e ficam) e 3 funções, **52 FKs de coluna única** (as **50** compostas ficam), 8 índices, e o CHECK órfão de `erp.equipment_transfers` só depois do substituto canônico | contador `entity='farm'`; lápides (`contrato-legado.ts`, redirects) |
| **05C-2 — Contador** ✅ mesclada (PR #37, merge `935f9dc`) e **aplicada em produção** em 16/09/2026: `0018_empresa_code_sequence.sql` no ledger uma única vez, `entity='farm'` = 0, `entity='empresa'` = 1, `last_value` preservado | a linha `entity='farm'` de `erp.code_sequences`, renomeada para `'empresa'` com o `last_value` preservado, e a constante `SEQUENCIA_EMPRESA` junto | os demais contadores; lápides (`contrato-legado.ts`, redirects). ⚠️ A ressalva "`farm_transfer` inclusive" valeu até o **HOTFIX PRÉ-BASE2-03**: a `0019` aposenta aquela linha e a transforma em alias — ver a seção própria abaixo |

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
3. **Uma única versão da API servindo** — **não é gate da 05C-1**, e por isso deixou de morar nesta lista:
   ele é o gate da **05C-2**, e agora tem endereço próprio em `docs/PRE-BASE2-05C-2-CUTOVER.md` § B, com
   evidência de por que está `BLOCKED`. Ficava aqui como lembrete, e lembrete hospedado na lista errada é
   como um gate se perde entre duas fatias.
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
4. **Aplicar TODAS as migrations do repositório, em ordem**, da `0001` à última de
   `supabase/migrations/`, pelo runner do produto (`pnpm db:migrate`, ou o pre-deploy
   `node dist/migrate.js` no serviço). Nunca aplicar arquivo solto: a ordem é a garantia. O alvo é o
   DIRETÓRIO, não um número escrito aqui — este passo já parou na `0017` uma vez, e teria reconstruído o
   ambiente sem o cutover do contador (`0018`) e sem o hotfix da numeração (`0019`), que é exatamente o
   estado que as duas existem para tornar impossível.
5. **Recriar os dados de teste** com `pnpm db:seed` (dados de referência, organização, usuário owner,
   cadastros de exemplo). Em produção isso é `SEED_ON_DEPLOY=1` por UM deploy, voltando a `0` em seguida —
   e voltar a `0` faz parte do procedimento, não é limpeza opcional.
6. **Recriar o que o seed não recria**: usuários reais do Auth, `erp.users.auth_user_id`, bucket
   `attachments` e seus arquivos. Se essa lista doer, a condição de retorno de P1 provavelmente já
   disparou — pare e releia P1.

**O que conferir no fim** (qualquer resposta fora do esperado significa ambiente não recuperado):

```sql
select count(*) as migrations, max(name) as ultima from public.erp_migrations;
-- esperado: o MESMO número de arquivos de supabase/migrations/ (`ls supabase/migrations/*.sql | wc -l`)
-- e o MESMO nome do último deles. Confira contra o repositório, nunca contra um número decorado:
-- número escrito à mão aqui envelhece na próxima migration, e envelhece em silêncio, porque continua
-- parecendo uma verificação.

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

### Go-live da 05C-2 (cutover do contador) — ✅ EXECUTADO em 16/09/2026

O cutover foi **executado e validado em 16/09/2026**, pelo mecanismo preferencial (`Remove` no deployment
ativo da API antes do merge). O runbook completo, com a execução real registrada, é
**`docs/PRE-BASE2-05C-2-CUTOVER.md`** § *Encerramento real — 16/09/2026*, que é o dono do assunto.

**Os quatro pontos abaixo são o PROCEDIMENTO PRÉ-CUTOVER, preservado como histórico** — eles descrevem por
que a janela foi necessária, e continuam valendo como regra para qualquer cutover futuro com esta forma.
Nenhum deles é tarefa pendente:

1. **Auto-deploy normal NÃO é seguro para este cutover.** O merge dispara o pre-deploy, e a 0018 executa
   com o binário anterior ainda servindo — que continua pedindo `next_code(org,'farm')`, uma chave que a
   migration acabou de aposentar. `next_code` não erra com chave ausente: ele REINICIA em 1.
2. **O gate "uma única versão da API servindo" foi RESOLVIDO em 16/09/2026** — e o histórico de por que
   esteve `BLOCKED` continua registrado, porque é ele que explica a regra. No PRODUTO continua não havendo
   modo de manutenção, flag de readiness, variável que recuse escrita nem healthcheck derrubável de
   propósito; a alavanca é da PLATAFORMA: `Remove` **para o deployment que está servindo**
   (`https://docs.railway.com/deployments/reference`). Foi esse o mecanismo usado — deployment BASE
   `a9df04a8-f4c5-4f69-ab8e-c826bcc7e5b2` removido, **zero réplicas** servindo, e só então o merge. O que
   faltava era confirmação ACCOUNT-SPECIFIC (`Remove` não deleta o service, source ligado a GitHub/`main`,
   autodeploy habilitado), obtida na própria janela. Ver `docs/PRE-BASE2-05C-2-CUTOVER.md` §B4–§B6 e
   § *Encerramento real*, que é o dono do assunto.
3. **U4 valeu, e foi conferido.** A 05C-2 chegou em produção pelo mesmo caminho merge → auto-deploy →
   pre-deploy, com `preDeployTimeoutSeconds` reconferido na config **live** antes do merge (A12 `PASS`,
   `SEED_ON_DEPLOY = 0`, porteiro P7 `OK`/`LIBERA`). A regra permanece para as próximas migrations.
4. **O rollback da plataforma não desfaz a 0018 — e isso vale AGORA, em produção.** O banco está pós-0018.
   Voltar ao binário anterior (pré-`SEQUENCIA_EMPRESA = "empresa"`) exige migration nova, não redeploy: a
   política é **forward-only**, e o version skew `farm` ↔ `empresa` continua inseguro, o cutover concluído
   não o torna seguro. Ver § D do runbook e `pnpm gate:05c2`.

> **O ponto 1 é sobre ESTA FORMA de cutover, não sobre toda migration de contador.** O HOTFIX PRÉ-BASE2-03
> tem a mesma forma aparente (troca a chave que a API pede) e **não** precisa de janela, porque resolve a
> incompatibilidade DENTRO do banco em vez de no calendário. A diferença está escrita na seção própria
> abaixo, e é o que separa "cutover de chave" de "cutover com alias".

### HOTFIX PRÉ-BASE2-03 — numeração de `erp.warehouse_transfers` (`0019`)

**Janela de deploy: NÃO precisa.** Autodeploy normal (merge → pre-deploy → rolling), ao contrário da 05C-2.

O motivo é estrutural, não otimismo. A 05C-2 renomeou a chave do contador e não havia como o banco servir
os dois binários: qualquer ordem deixava uma das versões pedindo uma chave inexistente, e `erp.next_code`
responde a chave ausente REINICIANDO EM 1. A `0019` resolve isso dentro do banco: `erp.next_code` passa a
CANONICALIZAR `farm_transfer` para `warehouse_transfer`, então o binário anterior pede a chave antiga e
recebe número do contador canônico, sem criar linha legada. Os dois runtimes ficam corretos contra o mesmo
banco — provado quadrante a quadrante por `pnpm gate:0019` (Q3 binário anterior × banco novo, Q4 rolling
deploy com os dois vivos, Q5 rollback de binário).

**E a prova inclui CONCORRÊNCIA, não só alternância.** O quadrante C roda duas transações ABERTAS ao mesmo
tempo, em conexões diferentes, com barreiras explícitas: o binário anterior e o novo, na mesma rota de
transferência de rebanho, serializam na linha do contador em vez de emitir o mesmo número. O mesmo
quadrante REPRODUZ a corrida da arquitetura que foi abandonada (dar ao rebanho um contador próprio durante
a vida do alias), para que a prova tenha dentes. É por isso que, enquanto o alias existir, a rota de
rebanho continua pedindo a chave legada: duas rotas na MESMA chave é o que dá o ponto de serialização.

**Ordem obrigatória: BANCO → API.** O quadrante inverso (API nova antes da migration) continua PROIBIDO e
está medido no gate: sem a `0019`, a API nova pede a chave canônica, a linha não existe, o contador reinicia
em 1 e colide com o acervo — e quando o acervo não começa em 1 há uma janela SILENCIOSA em que documentos
são gravados antes de o erro aparecer. O pre-deploy garante a ordem, e um pre-deploy que falha aborta o
deploy.

**Rollback de BINÁRIO: seguro, de um passo.** Voltar ao binário imediatamente anterior contra o banco
pós-0019 é correto — é o que o alias sustenta, e é por isso que ele não sai nesta fatia. A fronteira é a
mesma do ponto 4 acima: voltar além do runtime da 05C-2 continua exigindo migration nova.

**Rollback de BANCO: FORWARD-ONLY. Não restaure backup pré-0019 com o binário novo no ar.**

A `0019` é destrutiva em dois pontos: apaga a linha `entity='farm_transfer'` de `erp.code_sequences` e
substitui `erp.next_code`. Restaurar um estado pré-0019 por baixo de um binário pós-0019 reproduz, na
direção contrária, exatamente o modo de falhar que a migration existe para evitar:

- `warehouse_transfer` volta a um `last_value` anterior aos códigos emitidos depois da migration → colisão
  na própria tabela do hotfix **e também em `erp.animal_movements`**, porque enquanto o alias existir esse
  contador é o destino das duas rotas;
- a linha `farm_transfer` reaparece e volta a ser contador de verdade para o binário anterior, enquanto o
  novo continua pedindo a canônica — exatamente os dois estados que a `0019` existe para não ter juntos.

Se for mesmo necessário voltar o banco, o caminho é o inverso inteiro e com o serviço parado: restaurar o
backup, **e então** reaplicar a `0019` antes de qualquer binário pós-hotfix voltar a servir — a migration é
idempotente (`greatest` só sobe, `delete` de chave ausente casa zero linhas) e reconcilia o estado
restaurado. Reverter a `0019` sem reaplicá-la exige missão própria, com migration nova e precondição
verificada, como manda `.claude/rules/database-migrations.md`.

**Verificação pós-deploy:**

```sql
-- a chave legada não existe mais como linha (mas continua aceita como alias)
select count(*) from erp.code_sequences where entity = 'farm_transfer';        -- 0

-- o contador canônico cobre o acervo de ESTOQUE
select count(*) from (
  select wt.organization_id, max(wt.code::bigint) maior
    from erp.warehouse_transfers wt where wt.code ~ '^[0-9]+$' group by 1
) a left join erp.code_sequences cs
  on cs.organization_id = a.organization_id and cs.entity = 'warehouse_transfer'
where coalesce(cs.last_value, -1) < a.maior;                                    -- 0

-- e o MESMO contador cobre o acervo de REBANHO, porque o alias o faz numerar as duas tabelas.
-- Esta metade é separada de propósito: uma organização com códigos de rebanho e NENHUMA transferência
-- de estoque não aparece na consulta acima, e ali o zero não diria nada sobre ela.
select count(*) from (
  select am.organization_id, max(am.code::bigint) maior
    from erp.animal_movements am
   where am.movement_type = 'farm_transfer' and am.code ~ '^[0-9]+$' group by 1
) a left join erp.code_sequences cs
  on cs.organization_id = a.organization_id and cs.entity = 'warehouse_transfer'
where coalesce(cs.last_value, -1) < a.maior;                                    -- 0
```

### Verificação pós-deploy (fase 1)

```sql
select count(*) from erp.empresas;                                  -- tabela canônica responde
-- A linha que comparava `erp.farms` com `erp.empresas` saiu: a 0017 REMOVEU a view legada, e pedi-la agora
-- é erro de objeto inexistente. A conferência equivalente hoje é a ausência dela.
select to_regclass('erp.farms') is null as view_legada_removida;    -- t, desde a 05C-1
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

Pelo papel da aplicação (`erp_app`, sem bypass): até a 05C-1, uma consulta a `erp.farms` precisava devolver
**o mesmo número de linhas** que a mesma consulta a `erp.empresas` — números diferentes significariam view
definer, e view definer é vazamento entre organizações. A view saiu na 0017, então o que resta conferir é
que ela não voltou, e que `erp_app` continua **sem** bypass de RLS (`rolbypassrls = false`).

### TOP-CONFIG-02 — prontidão de TOP antes do Portal de Vendas (`0021`)

**Janela de indisponibilidade: NÃO precisa — e evitá-la é o caminho padrão.**

A fatia faz o Portal de Vendas exigir uma TOP ativa da família antes de deixar salvar. Nenhuma TOP nasce
pronta: a `0020` não insere nenhuma e o seed não cria nenhuma, então TODA organização já existente tem
zero TOPs no instante em que a web nova sobe.

O que torna a janela evitável é que **a tela de cadastro já está em produção desde a TOP-CONFIG-01**
(`0020`, mesclada pela #46): banco, `POST /api/admin/tipos-operacao` e **Configurações › Operações ›
Tipos de Operação** respondem hoje, no binário que está servindo. O cadastro NÃO depende desta fatia —
só o BLOQUEIO depende. Logo o pré-cadastro fecha a janela inteira, em vez de encurtá-la.

Isso importa porque a ordem de publicação não é controlável: API e web publicam de forma assíncrona a
partir do MESMO merge, e é a **web** que bloqueia. Mandar cadastrar "depois de a API subir" não fecha
janela nenhuma — apenas aposta que a web demore mais, e o estado bloqueado é silencioso por construção.

#### Caminho preferencial — SEM JANELA (fazer ANTES do merge da #47)

Por organização, com a #47 ainda em DRAFT:

1. Em **Configurações › Operações › Tipos de Operação** (já implantada), cadastrar ao menos uma TOP
   **ativa** para cada uma das três famílias: `vendas.orcamento`, `vendas.pedido` e `vendas.venda`. Uma
   família sem TOP bloqueia só a sua variante — e a conversão que tem ela como DESTINO.
2. Opcionalmente marcar uma como **padrão** em cada família. **Não é obrigatório**: sem padrão o campo
   abre em "Selecione…" e o usuário escolhe a cada lançamento. Recomendado por ergonomia, nunca como
   pré-requisito.
3. Rodar a **prova de prontidão** abaixo contra a conexão operacional e conferir que ela devolve ZERO
   linhas. É essa consulta que autoriza o merge — e não a ausência de erro em log, que aqui não prova
   nada, porque o estado bloqueado não gera erro nenhum.
4. Só então: merge da #47 → deploy normal. Quando a web nova ficar Ready, o campo já encontra TOP.

O passo 1 é reversível e não escreve em documento nenhum: cadastrar TOP antes do merge não altera o
comportamento do binário que está no ar hoje, porque só a `0021` liga lançamento e TOP. Não há version
skew a temer aqui.

#### Caminho alternativo — JANELA ACEITA CONSCIENTEMENTE

Mergear sem pré-cadastro **continua tecnicamente seguro para os dados**: a API aceita TOP nula, os
documentos existentes continuam abrindo e nada é perdido. O que se perde é a OPERAÇÃO — a web recusa
novo lançamento e conversão até que alguém configure.

| Superfície | Sem nenhuma TOP cadastrada |
|---|---|
| `/vendas/<variante>/new` | campo obrigatório vazio, aviso de família sem TOP, **Salvar desabilitado** |
| Conversão (orçamento → pedido → venda) | diálogo abre, **Converter desabilitado** (falta a TOP do DESTINO) |
| `POST /api/sales/<variante>` | continua **201** — o documento nasce legado, sem TOP. Não há perda de dado |
| Documentos antigos | abrem normalmente, dizendo "Não configurada (registro legado)" |

Este caminho exige **decisão explícita do operador, registrada**, porque aqui a janela é ESCOLHIDA, não
imposta pela arquitetura. Não é o caminho principal e não é o padrão. Quem o escolher assume que a
duração da janela é o tempo até o cadastro manual — e não o tempo de deploy.

#### Prova de prontidão (READ-ONLY, por organização)

**Dois passos, nesta ordem. O segundo não vale sem o primeiro.**

**Passo 1 — PREFLIGHT DE PAPEL.** A consulta abaixo responde ZERO linhas quando tudo está pronto. Mas o
erro operacional mais provável produz exatamente a mesma resposta: rodada por um papel sujeito a RLS
(`erp_app` via `DATABASE_URL`, `authenticated` no editor SQL do Supabase, PostgREST), não há GUC de
organização, `erp.current_org_id()` é null, `erp.tenant_visible()` é falso para TODA linha, e
`erp.organizations` devolve zero — que o operador lê como "pronto para mergear".

É o mesmo defeito que a decisão 67 já fechou no backfill do ID Global e que o cutover 05C-2 verifica em
A12. Então, ANTES da consulta, com a MESMA conexão:

```sql
select current_user, rolsuper, rolbypassrls from pg_roles where rolname = current_user;
```

**Um dos dois tem de ser `true`.** Se ambos forem `false`, a consulta do passo 2 NÃO PROVA NADA e o
resultado dela deve ser descartado — não é "pronto", é "não medido". Registre as duas saídas juntas.

**Passo 2 — A CONSULTA.** Executar com `MIGRATE_DATABASE_URL` (a conexão operacional), nunca com a da
aplicação:

```sql
with prontidao as (
  select
    o.id                                                           as organizacao_id,
    o.name                                                         as organizacao,
    coalesce(bool_or(t.codigo_base = 'vendas.orcamento'), false)   as top_orcamento,
    coalesce(bool_or(t.codigo_base = 'vendas.pedido'),    false)   as top_pedido,
    coalesce(bool_or(t.codigo_base = 'vendas.venda'),     false)   as top_venda,
    count(*) filter (where t.padrao)                               as familias_com_padrao
  from erp.organizations o
  left join erp.tipos_operacao t
    on  t.organization_id = o.id
    and t.ativo
    and t.excluido_em is null
    and t.codigo_base in ('vendas.orcamento', 'vendas.pedido', 'vendas.venda')
  where o.deleted_at is null
  group by o.id, o.name
)
select
  (select count(*) from prontidao)                                           as organizacoes_conferidas,
  (select count(*) from prontidao
    where not (top_orcamento and top_pedido and top_venda))                  as pendentes,
  p.organizacao_id, p.organizacao, p.top_orcamento, p.top_pedido, p.top_venda, p.familias_com_padrao
-- O LEFT JOIN a partir de uma linha constante é o que garante que a consulta SEMPRE devolva ao menos uma
-- linha. Com um `where` no fim, o caso PRONTO devolveria zero linhas — e resposta vazia é justamente o
-- que este gate não pode usar como sinal, porque é o que a conexão errada também devolve.
from (select 1) z
left join prontidao p on not (p.top_orcamento and p.top_pedido and p.top_venda)
order by p.organizacao;
```

**O critério de aceite é `pendentes = 0` COM `organizacoes_conferidas > 0`** — nunca "a consulta não
devolveu nada". Quando há pendências, cada linha nomeia a organização e as colunas booleanas dizem qual
família falta. Quando não há, a consulta devolve UMA linha com os dois contadores e as colunas de detalhe
nulas: é essa linha que autoriza o merge, porque ela carrega o DENOMINADOR.

`organizacoes_conferidas = 0` é **REPROVAÇÃO**, não aprovação: ou a conexão não enxerga as organizações
(volte ao passo 1), ou o banco não tem nenhuma — e nos dois casos nada foi medido.

`familias_com_padrao` é INFORMATIVO: padrão ausente não bloqueia e não reprova. Para inspecionar todas as
organizações, inclusive as prontas, remova o `where` final.

Por que a consulta tem esta forma, e não a óbvia:

- **Publica o denominador** — um gate cujo sinal de aprovação é "vazio" é indistinguível de um gate que
  não rodou. Com o total à vista, "0 de 0" e "0 de 7" deixam de ter a mesma cara.
- **Parte de `erp.organizations`, com LEFT JOIN** — partir de `erp.tipos_operacao` faria a organização
  com ZERO TOPs, que é exatamente a que precisa reprovar, simplesmente não aparecer.
- **Os quatro predicados no `on`, não no `where`** — filtro de tabela à direita no `where` degrada o
  LEFT JOIN para INNER e reintroduz o defeito acima.
- **`coalesce(..., false)` em toda parte** — sem ele, a organização sem nenhuma TOP produz `bool_or`
  nulo nas três colunas, `null and null and null` é null, `not null` é null, e a linha seria DESCARTADA:
  o gate aprovaria em silêncio justamente a organização mais vazia de todas. Isto foi MEDIDO, não
  deduzido: com uma organização sem nenhuma TOP inserida numa transação descartável, a forma acima a
  devolve e a forma sem `coalesce` não — some exatamente a que tinha zero.
- **`t.ativo` e `t.excluido_em is null`** — TOP inativa ou excluída existe e não serve; a exclusão é
  lógica, e o índice único de código não filtra por `excluido_em`.
- **`o.deleted_at is null`** — organização excluída não opera, e cobrá-la produziria uma reprovação
  permanente e insolúvel, que treina o operador a ignorar o gate.

Esta prova é **gate operacional**, não gate de CI: ela mede o banco de produção e por isso NÃO entra em
`pnpm lint` nem no CI contra banco de teste — um gate que se autoaprova não é gate. Enquanto não for
executada com a credencial real, a prontidão é `PENDING`.

## TOP-CONFIG-04A — execução configurada da venda, em duas fases

A fatia faz a configuração da TOP (formato 2, bloco `execucao`) decidir o estoque e o financeiro da
confirmação de VENDA (`docs/TIPO-OPERACAO-CONTRACT.md` §12). O risco que esta seção fecha é um só: **uma
venda cuja versão declara execução configurada ser confirmada por um binário que não a executa** — ele
aplicaria o comportamento legado em silêncio. Três travas, em camadas:

- o gate `TOP_EFFECTS_RUNTIME_V1_ENABLED` nasce DESLIGADO: sem ele, nenhuma execução configurada pode ser
  ativada, e uma venda de versão configurada é RECUSADA na confirmação (nunca confirmada pelo legado);
- a migration `0023_venda_execucao_configurada_guarda.sql` põe um gatilho em `erp.sales_documents` que
  recusa, no banco, a confirmação de venda de versão configurada feita por um binário anterior à fatia (a
  ENTRADA em confirmada ou faturada; faturar uma venda já confirmada não passa pela guarda);
- a ativação só acontece na fase 2, e só com as **pré-condições da fase 2** cumpridas (lista abaixo,
  depois da prova entre as fases).

**Janela de indisponibilidade: NÃO precisa.** A 0023 não altera dado nem coluna; enquanto nenhuma versão
declara execução configurada, o gatilho deixa passar toda confirmação — então a ordem entre banco, API e
web na fase 1 é livre, e o pre-deploy a aplica como qualquer migration.

| Fase | O que sobe | Estado do sistema | Pode voltar? |
| --- | --- | --- | --- |
| **1** | merge → deploy automático, com o gate AUSENTE (desligado) | o formato 2 é lido e gravado com os dois efeitos em `legado`; ativar é recusado; toda venda confirma pelo legado; a área Execução do editor diz que a execução está desligada | sim, para vendas: o binário anterior convive (a 0023 não barra nada enquanto não há versão configurada). As TOPs gravadas no formato 2 ficam só leitura para ele (ver "Reversão por fase") |
| entre fases | nada sobe | cumprir e registrar, com evidência, as **pré-condições da fase 2** (lista abaixo, depois da prova entre as fases) | — |
| **2** | o gate `TOP_EFFECTS_RUNTIME_V1_ENABLED=1` no serviço da API, só com TODAS as pré-condições da fase 2 cumpridas — a última é a autorização explícita do Maike (é alteração de configuração de produção) | o administrador pode ativar, por efeito, dentro da matriz; vendas criadas sob versões ativadas executam a política congelada | ver "Reversão por fase" |

**Prova entre as fases (LEITURA, pela conexão operacional; `PENDING` até ser executada com a credencial
real).** A contagem abaixo não altera nada e publica o denominador junto do numerador — zero versões num
banco sem TOP nenhuma não provaria coisa alguma:

```sql
select count(*) as versoes,
       count(*) filter (where configuracao_schema_version >= 2) as formato_2,
       count(*) filter (where configuracao_schema_version >= 2
                         and (configuracao->'execucao'->>'estoque' is distinct from 'legado'
                           or configuracao->'execucao'->>'financeiro' is distinct from 'legado')) as declaram_execucao_configurada
  from erp.tipos_operacao_versoes;
```

Antes da fase 2 o esperado em `declaram_execucao_configurada` é **zero** (o gate desligado recusa a
ativação). Um número diferente significa escrita por fora da API e PARA a fase 2 até ser explicado.
`formato_2` não tem valor esperado: ele mede quantas versões um binário anterior deixaria de editar se
a API fosse revertida (ver "Reversão por fase").

**Pré-condições da fase 2 (todas obrigatórias; qualquer uma `PENDING` mantém o gate DESLIGADO).** Ligar o
gate é alteração de configuração de produção, e nenhum item abaixo se satisfaz com preview, `localhost`,
CI ou "deploy verde": cada um é respondido contra a produção real, com evidência que um terceiro possa
conferir.

1. **A 0023 aplicada em produção** — `0023_venda_execucao_configurada_guarda.sql` no ledger
   (`public.erp_migrations`) do banco de produção, uma única vez, E o gatilho com a definição da versão
   mesclada: `pg_get_triggerdef` de `trg_sales_documents_execucao_configurada` contém
   `OLD.status IS DISTINCT FROM 'confirmed'` (a 0023 foi corrigida na revisão R1, antes de qualquer
   aplicação compartilhada — o ledger registra só o NOME, e um banco com a versão anterior passaria na
   checagem por nome). Sem a guarda, uma instância anterior
   confirmaria pelo legado, em silêncio, a venda que o administrador configurou — e o gate não alcança
   essa instância.
2. **Nenhuma instância anterior à fatia atendendo tráfego** — TODA réplica da API responde em `/health` um
   `build.sha` que contém o merge da fatia, e o web responde o mesmo em `/api/build`. Uma réplica antiga no
   pool não conhece o gate nem o formato 2.
3. **A contagem de produção feita em modo LEITURA** — a consulta da "Prova entre as fases", acima, pela
   conexão operacional e com a credencial real, publicada com o denominador, e
   `declaram_execucao_configurada` igual a zero.
4. **O diálogo de confirmação da venda corrigido, em fatia própria, mesclada e implantada** — com o web
   servindo, em `/api/build`, um commit que contém a correção. O diálogo "Confirmar venda"
   (`apps/web/src/app/(app)/vendas/[kind]/[id]/page.tsx`) afirma hoje "Baixa o estoque dos itens com
   armazém e gera as contas a receber." Na fase 1 isso é verdade: com o gate desligado nenhuma versão
   executa configuração, e toda venda que confirma, confirma pelo legado. Na fase 2 deixa de ser: uma venda
   de versão configurada pode não movimentar estoque, não gerar título ou ser recusada por exigência não
   atendida (`docs/TIPO-OPERACAO-CONTRACT.md` §12.5), e o diálogo prometeria um efeito que não vai
   acontecer. A correção é de APRESENTAÇÃO — o servidor continua sendo a autoridade do efeito — e não cabe
   na TOP-CONFIG-04A, que não muda a tela de venda (W12 de `top-configuracao-editor.spec.ts`). A mesma
   premissa está na dica da criação da venda (`vendas/[kind]/new/page.tsx`) e no diálogo de cancelamento
   ("Vendas confirmadas têm estoque e títulos estornados."): a fatia do diálogo os revisa junto, ou declara
   por que não.
5. **Autorização explícita do Maike, pedida na hora, para ESTA ação** — autorização dada ao merge ou à
   fase 1 não vale para a fase 2 (`.claude/rules/security.md` § Produção).

**Reversão por fase.**

- **Fase 1:** reverter o binário não põe venda nenhuma em risco (nenhuma versão declara execução
  configurada, e o binário anterior não lê a configuração da TOP ao lançar ou confirmar venda). O custo é
  outro, e é declarado: toda TOP cuja versão atual foi gravada no formato 2 — as criadas na fase 1 e as
  editadas pelo web novo — fica SÓ LEITURA para o binário anterior. Detalhe e histórico abrem declarando
  um formato que ele não interpreta; a edição é recusada com 422
  `TIPO_OPERACAO_CONFIGURACAO_SCHEMA_NAO_SUPORTADO` ("atualize o servidor antes de editar"). É a recusa
  que o próprio binário anterior foi escrito para dar (nunca regrava por cima do que não sabe ler), e ela
  some quando a API volta. A contagem `formato_2` acima diz, antes de reverter, quantas versões ficariam
  assim. A 0023 fica: ela é inerte sem versão configurada, e migration aplicada é histórico.
- **Fase 2 — desligar o gate NÃO é voltar ao legado.** Com ele desligado, vendas de versões configuradas
  passam a ser RECUSADAS na confirmação (`TIPO_OPERACAO_EXECUCAO_INDISPONIVEL`), e a tela da TOP avisa
  isso. Para uma operação voltar ao comportamento anterior, o caminho é a TOP: editar e pôr o efeito em
  "Comportamento legado" — isso cria a versão N+1, que vale para documentos NOVOS; documentos já lançados
  continuam citando a versão que capturaram.
- **Fase 2 — reverter o binário da API para antes da fatia:** a 0023 faz o binário anterior RECUSAR (422)
  a confirmação de vendas de versões configuradas, em vez de confirmá-las pelo legado. É seguro no sentido
  de não mentir, mas deixa essas vendas sem confirmação até o binário voltar; por isso a reversão do
  binário depois da fase 2 exige, antes, a mesma contagem acima e uma decisão explícita do Maike.

## Checklist de go-live
- [x] Migrations aplicadas e `erp_app` sem privilégio de bypass RLS (verificado: `rolbypassrls=false`, 171 tabelas com RLS forçada, 187 políticas)
- [x] Autenticação: `AUTH_MODE=local` com `LOCAL_AUTH_SECRET` aleatório (Supabase Auth: evolução)
- [x] CORS (`WEB_ORIGIN`) apontando para os domínios declarados em "## Superfície web"
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
| Vercel (frontend) | Projeto `controle-de-estoque` configurado (Root `apps/web`, Next.js, Node 22, domínios `controle-de-estoque-erp.vercel.app` e `controle-de-estoque-api-eight.vercel.app`). O bloqueio por fatura em aberto de 10/09/2026 (`softBlock: UNPAID_INVOICE`, `402 DEPLOYMENT_DISABLED`) **foi regularizado**: em 15/09/2026 os dois domínios respondem **200** e a Vercel voltou a publicar — o commit `85666dcc` de `main` tem status `success` ("Deployment has completed"). O papel de cada superfície está em "## Superfície web"; a prova de qual commit cada uma serve é `GET /api/build`. | `curl -I https://controle-de-estoque-erp.vercel.app` → 200; commit status `Vercel` = success |
| Railway serviço `web` (frontend; papel em "## Superfície web") | Serviço `web` no mesmo projeto Railway, build por `apps/web/Dockerfile` (Next standalone; `NEXT_PUBLIC_*` embutidas no build a partir das variáveis do serviço), domínio `https://web-production-4a835.up.railway.app`, healthcheck `/login`. `WEB_ORIGIN` da API já inclui esse domínio. | serviço `74264061-f73a-40ee-9748-11be096c0cb6` |
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

**Certificação — o que já aconteceu e o que ainda NÃO.** Até 18/09/2026 este parágrafo negava tanto o merge
da PRE-BASE2-04 quanto o disparo de qualquer fase. As duas negações eram FALSAS e foram corrigidas: a
migration `0016_global_id_activation.sql` entrou em `main` no commit `fceb4f2` e está APLICADA em produção
(ledger medido: 19 migrations, `0016` exatamente 1×), e `erp.registros_globais` tem 66 linhas em 17 tipos de
entidade — ou seja, a alocação está viva em produção. O que continua NÃO PROVADO, e é o que impede declarar a
missão concluída: `faltando = 0` nunca foi medido em produção, `pnpm id-global:verify` nunca foi executado
contra o acervo real, e o smoke de busca (`#N`, `ID N`) e do distintivo na tela nunca foi feito. Migration
aplicada NÃO é ativação completa. O que está provado do resto é o código, em ambiente de teste (banco novo,
banco de upgrade com acervo legado, reexecução com mapa idêntico, medição de desempenho). A missão só se
considera concluída depois de, nesta ordem: **merge aprovado** → **fase 1** → **fase 2** → **fase 3 rodada
até `faltando: 0`** → **`pnpm id-global:verify` verde** → **fase 4 com smoke real** (buscar `#N` e `ID N`,
abrir o registro pela rota canônica e conferir o distintivo na tela). Até lá, `docs/PRE-BASE2-ROADMAP.md`
mantém a missão como "implementação pronta — ativação em produção pendente".

**Estado atual da PRE-BASE2-04: IMPLEMENTAÇÃO PRONTA / ATIVAÇÃO EM PRODUÇÃO PENDENTE.** (Frase canônica de
estado atual, idêntica em `docs/PRE-BASE2-ROADMAP.md` e `docs/PRE-BASE2-05-APOSENTADORIA.md`.)

**Smoke da fase 4 (o que olhar):** `#N` e `ID N` na busca (Ctrl+K) devolvem o registro certo; a URL final é a
rota canônica **com o UUID**; o distintivo mostra o mesmo número na tela do registro; e um `#N` de registro
fora do escopo do usuário responde a mesma coisa que um número inexistente.

**Reversão por fase.** Voltar o web: o número continua no banco, ninguém perde identidade. Voltar a API:
registros novos param de receber número — rodar o backfill de novo depois resolve, sem renumerar nada.
Voltar o banco NÃO é recomendado depois que `#N` foi exibido: apagar `registros_globais` destruiria
identidades que o usuário já anotou. `sequencias_id_global.ultimo_valor` nunca deve ser diminuído.
