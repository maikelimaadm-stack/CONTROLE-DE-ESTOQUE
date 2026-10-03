# Deploy

## Supabase (banco + auth + storage)
1. Criar projeto; anotar `Project URL`, `anon key`, `service role key`, `JWT secret` (Settings › API) e a connection string do **pooler em modo sessão** (`aws-0-<região>.pooler.supabase.com`, porta 5432). **Não** acrescente `?sslmode=require` à URL: o `pg` passa a exigir certificado verificado e a conexão falha com `self-signed certificate in certificate chain`; o pool já negocia TLS sozinho.
2. Papéis: `erp_app` (login, **sem** bypass de RLS; usado pela API em `DATABASE_URL`) e `erp_migrator` (login, `bypassrls`, dono do schema `erp`; usado só pelo pre-deploy em `MIGRATE_DATABASE_URL`). Senhas fortes, nunca versionadas.
3. Aplicar `supabase/migrations/*.sql` em ordem (`pnpm db:migrate` com `DATABASE_URL` do projeto, ou MCP `apply_migration`). Depois `pnpm db:seed` para dados de referência + organização inicial.
4. Auth: habilitar e-mail/senha; ao criar usuários no Supabase, preencher `erp.users.auth_user_id`. Storage: bucket privado `attachments`.
5. **Status nesta entrega**: aplicado no projeto `CONTROLE-DE-ESTOQUE` (ref `dcroxgdzzgqgiquvfffa`, sa-east-1, Postgres 17) — ver tabela abaixo.

## Railway (API)
- Serviço a partir do repositório; configuração definida no próprio serviço (sem `railway.json` na raiz, pois ele valeria para todos os serviços do repositório): Dockerfile `apps/api/Dockerfile`, start `node dist/main.js`, health `/health`, pre-deploy `node dist/migrate.js` (aplica migrations pendentes).
- **Pre-deploy: teto de 300 s lido em 23/09/2026** (`preDeployTimeoutSeconds = 300` no serviço `api`, leitura da sessão de revisão do GO-LIVE-01 pela API do Railway). O registro abaixo é de 15/09, quando o campo estava vazio, e continua sendo o critério se ele voltar a ficar vazio. **Histórico — pre-deploy sem teto de tempo.** O campo *Pre-Deploy Timeout* do serviço está **vazio** (`preDeployTimeoutSeconds = null`, lido em 15/09/2026 pela API do Railway, no `serviceInstance` do serviço `api` em `production`). Pela documentação do Railway, vazio significa **sem limite**: um pre-deploy que trave não falha o deploy — ele o segura. O `healthcheckTimeout` de 120 s não cobre essa janela, porque só começa a contar depois que o pre-deploy termina. O único teto que existe hoje é do lado do banco (`statement_timeout` de 120 s; `lock_timeout` = 0), e ele só alcança o que está DENTRO de um enunciado SQL — DNS, handshake, aquisição de conexão do pool, `seedPermissions` e travamento de código ficam sem teto algum. Relevante para toda migration longa, e especialmente para a 05C-1, onde deixou de ser observação: como o merge em `main` dispara deploy automático, **enquanto este campo estiver vazio a 05C-1 não é liberada para merge** (`OPERATIONAL MERGE BLOCKER`; enunciado, saída e onde o valor medido será registrado em `docs/PRE-BASE2-05C-1-PREFLIGHT.md`, U4).
- Região: `iad` (US East, Virgínia), a mais próxima disponível de São Paulo (o banco Supabase fica em sa-east-1); em `sfo` cada listagem levava ~3,5 s.
- Variáveis: `DATABASE_URL` (pooler, usuário `erp_app`), `MIGRATE_DATABASE_URL` (pooler, usuário `erp_migrator`), `MIGRATIONS_DIR=/app/supabase/migrations`, `AUTH_MODE=local` + `LOCAL_AUTH_SECRET` (login por e-mail/senha na tabela `erp.users`; `AUTH_MODE=supabase` + `SUPABASE_JWT_SECRET` fica como evolução, pois o web ainda não usa Supabase Auth), `SUPABASE_URL`, `WEB_ORIGIN=https://<app>.vercel.app`, `PORT=3333`, `API_LOG_LEVEL=info`, `RATE_LIMIT_MAX`, `TOP_EFFECTS_RUNTIME_V1_ENABLED` (gate da execução configurada da TOP: ausente ou `0` = desligado, `1` = ligado; qualquer outro valor derruba o startup. Ligá-lo é a fase 2 da seção TOP-CONFIG-04A abaixo, e só no serviço da API — o web não tem par).
- Semeadura no pre-deploy — **no máximo UMA flag por deploy; as duas juntas são recusadas antes das migrations** (`packages/db/src/organizacao-limpa.ts`, `resolverSeedDoDeploy`):
  - `SEED_ON_DEPLOY=1` → dados de referência + organização **DEMO** (`ORG_NAME`, `ORG_SLUG`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`). Desde o GO-LIVE-01 é **blindado**: recusa, sem escrever nada, se o slug pertencer a organização que não é demo, ou se `ADMIN_EMAIL`/`operador@demo.local` já pertencer a usuário que não seja exclusivamente demo. Demo = marca `parameters.origem_seed = 'demo'` (gravada nas organizações novas) ou, sem marca, a razão social e o documento que o seed antigo gravava fixos (`packages/db/src/origem-organizacao.ts`; na dúvida, recusa). Em produção operacional fica em `0`.
  - `ORGANIZACAO_LIMPA_ON_DEPLOY=1` → **organização limpa para uso real** (`ORG_NAME`, `ORG_SLUG`, `ADMIN_NAME`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`). Os nomes `ORG_*`/`ADMIN_*` são os mesmos do seed demo de propósito (uma variável a menos para esquecer no painel), e por isso **os valores atuais, que são os da demo, têm de ser trocados antes do deploy de criação** — se não forem, a criação é recusada (slug e e-mail já existem) sem gravar nada. Procedimento completo: § "Go-live — checklist de entrada em uso real", G7.
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
3. **A Railway implanta de `main` sem exigir CI verde** (`checkSuites: false` nos dois serviços — **relido em 23/09/2026: continua `false` em `api` e em `web`**; é o item G2 do checklist de go-live):
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

1. **U4 — o pre-deploy precisa ter teto de tempo.** **Lido em 23/09/2026: `preDeployTimeoutSeconds = 300` — há teto; reler na janela.** Histórico: estava vazio no serviço `api`
   (medido em 15/09/2026): um pre-deploy travado não falha o deploy, ele o segura, e nenhum teto de banco
   alcança DNS, handshake, pool ou `seedPermissions`. Como não existe "mesclar agora e decidir o deploy
   depois", este é um **`OPERATIONAL MERGE BLOCKER`**: a PR da 05C-1 fica em DRAFT até haver valor medido no
   campo, ou contenção equivalente aceita por escrito. **Configurar isso é ação humana no painel do
   Railway; nenhuma fatia altera o serviço.** O valor recomendado vem da medição da própria `0017`, e o
   lugar de registrá-lo é `docs/PRE-BASE2-05C-1-PREFLIGHT.md`, U4.

**Antes de aplicar (todos obrigatórios; qualquer `PENDING` interrompe):**

1. **P1 — `BLOCKED` desde 23/09/2026 (GO-LIVE-01: a condição de retorno disparou).** Fecha só com P1.1–P1.4 executados e registrados (G4 abaixo). O texto a seguir é o histórico da dispensa, que deixou de valer: o proprietário declarou que o sistema ainda
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

#### Recuperação — produção: `RECOVERY = RESTORE` desde o go-live · `RECOVERY = REBUILD FROM ZERO` só para banco descartável (PROIBIDO em produção)

> **23/09/2026 (GO-LIVE-01):** a partir da primeira transação real na organização limpa, a recuperação do banco
> de produção é **RESTORE** de backup (o drill P1 é o que prova que ele funciona — G4). **`REBUILD FROM ZERO` é
> PROIBIDO para o banco de produção**: recriar o banco apagaria dado real. O procedimento abaixo continua
> válido só para bancos descartáveis (local, CI, homologação) e fica aqui como histórico.


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
   `old.status IS DISTINCT FROM 'confirmed'::text` — é assim, em minúsculas e com o cast, que o Postgres devolve a
   definição (medido; a consulta pronta é o bloco 6a de `docs/sql/inventario-go-live.sql`) — (a 0023 foi corrigida na revisão R1, antes de qualquer
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
   servindo, em `/api/build`, um commit que contém a correção. Até a VENDAS-A5-1, o diálogo "Confirmar
   venda" (`apps/web/src/app/(app)/vendas/[kind]/[id]/page.tsx`) afirmava, para toda venda, "Baixa o
   estoque dos itens com armazém e gera as contas a receber." Na fase 1 isso é verdade: com o gate
   desligado nenhuma versão executa configuração, e toda venda que confirma, confirma pelo legado. Na fase
   2 deixa de ser: uma venda de versão configurada pode não movimentar estoque, não gerar título ou ser
   recusada por exigência não atendida (`docs/TIPO-OPERACAO-CONTRACT.md` §12.5), e o diálogo prometeria um
   efeito que não vai acontecer. A correção é de APRESENTAÇÃO — o servidor continua sendo a autoridade do
   efeito — e não cabia na TOP-CONFIG-04A, que não muda a tela de venda (W12 de
   `top-configuracao-editor.spec.ts`). A mesma premissa estava na dica da criação da venda
   (`vendas/[kind]/new/page.tsx`) e no diálogo de cancelamento ("Vendas confirmadas têm estoque e títulos
   estornados."), e a fatia do diálogo os revisa junto.

   **A correção é a VENDAS-A5-1** (decisão 249; contrato em `docs/TIPO-OPERACAO-CONTRACT.md` §12.5, "A
   prévia da confirmação"). O diálogo diz o que a confirmação vai fazer NESTA venda segundo a prévia do
   servidor, calculada pela MESMA função que executa a confirmação (`planejarConfirmacao`); com recusa
   prevista mostra a recusa e desabilita o Confirmar; sem a prévia (API anterior na janela de deploy),
   mostra um texto neutro, verdadeiro para qualquer servidor. A dica da criação e o diálogo de cancelamento
   deixam de prometer efeito, e o aviso do padrão automático da VENDAS-A1 passa a seguir a prévia. A fatia
   não liga o gate e não muda efeito, código, ordem nem mensagem da confirmação.

   **Estado: `OK` em 24/09/2026 13:28 UTC** — leitura da sessão revisora, depois do deploy do merge da
   VENDAS-A5-1 (`8445801`): a API em `/health`, o web Vercel em `/api/build` e o web Railway em
   `/api/build` servem `844580160ae2ea5ac0063ffaaee75ed3e5a1523b`, que é o próprio merge da fatia (o
   critério era o `sha` servido ter esse merge como ancestral — `git merge-base --is-ancestor`). Registrado
   pela CADASTROS-ESTRUTURA a partir da leitura revisora; a PR da A5-1 não marcou o item. **A fase 2
   continua DESLIGADA**: o item 5 (autorização do Maike para esta ação) não foi dado, e nenhum item
   `OK` liga o gate sozinho. (Estado em 24/09; a fase 2 foi LIGADA em 26/09 — registro abaixo, depois do item 5.)
5. **Autorização explícita do Maike, pedida na hora, para ESTA ação** — autorização dada ao merge ou à
   fase 1 não vale para a fase 2 (`.claude/rules/security.md` § Produção).

   **Estado: `OK` em 26/09/2026** — autorização explícita do Maike nesta data, para esta ação.

**FASE 2 LIGADA — 26/09/2026.** Evidência lida pela sessão revisora (nenhum valor de variável lido):

- **Antes de ligar:** a 0023 no ledger (23/09 18:28 UTC) com o gatilho da R1 (item 1); contagem de versões:
  **3** / formato 2: **3** / declaram execução configurada: **0** (item 3).
- **Item 5:** autorização explícita do Maike nesta data, para esta ação.
- **26/09/2026 23:16:55 UTC:** variável `TOP_EFFECTS_RUNTIME_V1_ENABLED = 1` no serviço `api` (Railway,
  production).
- **Deployment `797b6e2a-687b-4261-8c80-42e581b502d9`:** `SUCCESS` às 23:19:30 UTC; o deployment anterior foi
  `REMOVED` às 23:19:34 UTC (item 2: nenhuma instância anterior atendendo).
- **`/health` às 23:19:57 UTC:** status `ok`, db `ok`, build `49a96ab` (API) e `49a96ab` nas duas webs.

Nenhuma TOP executa até o administrador escolher "configurada". Ligar o gate só PERMITE a ativação, por efeito,
dentro da matriz; com as 3 versões em `legado`, toda venda continua confirmando pelo legado. Desligar é a
"Reversão por fase" abaixo — e desligar NÃO é voltar ao legado para versão já configurada.

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

## Go-live — checklist de entrada em uso real

O Maike começa transações reais numa **organização nova e limpa**, dentro do banco de produção atual. A
premissa original deste checklist — a organização existente (`principal`, do seed demo antigo) ficaria
intacta como sandbox — **deixou de existir**: em 23/09/2026, por decisão ESCRITA do Maike ("autorizo apagar
todos os dados da produção e criar minha conta"), a sessão revisora limpou a produção inteira e a
organização real foi criada pelo mecanismo da decisão 241. Não existe mais organização sandbox em produção,
e **dado de produção não se apaga mais** (decisão 247, que substitui o item (5) da 240). A política de
desenvolvimento a partir daqui é a decisão 240 com a 247.

**Linha do tempo da limpeza (23/09/2026, UTC — registrada pela sessão revisora):**

| Hora | O quê |
|---|---|
| 20:03:17 | Railway `api`: `SEED_ON_DEPLOY=0` (sem deploy) |
| 20:03:21 | Supabase (projeto de produção): `set lock_timeout = '5s'; truncate table erp.organizations, erp.users, erp.audit_logs cascade;` — a cascata alcançou 177 tabelas; sobraram só as tabelas globais de referência sem dono (`banks`, `cities`, `modulos_escopo_empresa`, `ncm`, `permissions`, `states`, `tipos_notificacao`) |
| 20:04:33 | Railway `api`: `ORG_NAME`, `ORG_SLUG`, `ADMIN_NAME`, `ADMIN_EMAIL`, `ADMIN_PASSWORD` e `ORGANIZACAO_LIMPA_ON_DEPLOY=1` |
| 20:04:35 | deployment `5fa0cdfd-ea94-49fb-a14b-61d40175a811` — o pre-deploy criou a organização pelo mecanismo da decisão 241 |
| 20:07:25 | `created_at` da organização nova |
| 20:12:27 | Railway `api`: `ORGANIZACAO_LIMPA_ON_DEPLOY=0` e `ADMIN_PASSWORD` substituída por um texto não secreto (sem deploy) |
| depois | o Maike entrou pela interface com sucesso |

**Desde a 0041 (TOP-CONFIG-08, decisão 277), o comando de 20:03:21 FALHA** (OPERACOES-01, decisão 278). As três
tabelas de aprovação (`erp.aprovacoes_venda`, `aprovacoes_compra`, `aprovacoes_estoque`) têm gatilho `BEFORE TRUNCATE`
de imutabilidade, e um `TRUNCATE … CASCADE` alcança essas tabelas a partir de qualquer tabela de que elas dependem por
chave estrangeira, direta ou indiretamente: `organizations`, `users`, `empresas`, `tipos_operacao`,
`tipos_operacao_versoes`, `sales_documents`, `documentos_compra`, `documentos_estoque` e as que estas referenciam (por
exemplo, `people`). O comando inteiro é recusado e nada é truncado. A linha acima é histórico e fica como está; a regra
permanente continua a da decisão 247: dado de produção não se apaga.

Estados: `PENDING` = não feito ou não comprovado. `OK` = feito, com evidência datada. Nenhum item vira `OK`
por declaração, preview, `localhost`, CI ou "deploy verde". **Bloqueia** = sem ele, a primeira transação real
não acontece.

**Leitura de produção em 23/09/2026 — ANTES da limpeza (histórico)** (inventário `docs/sql/inventario-go-live.sql`, rodado pela sessão do
GO-LIVE-01 numa transação `READ ONLY`, com `transaction_read_only = on` conferido na mesma transação):

| Bloco | Resultado |
|---|---|
| 1. Organizações | 1: `principal` ("Controle de Estoque"), criada em 10/09/2026, sem marca de origem, **reconhecida como demo** pelo critério do seed antigo |
| 2. Usuários | 5, nenhum `admin@demo.local`. `operador@demo.local` **ativo** (criado pelo seed com a senha pública do repositório; se nunca foi trocada, qualquer um entra). O e-mail do Maike é **dono** da `principal`. Três usuários `ckpt-v2-*@teste.local` de checkpoints anteriores (dois com vínculo inativo, um ativo) |
| 3. Vínculos | todos os 5 na `principal`; dono = o e-mail do Maike, perfil Administrador |
| 4. Volume da `principal` | 2 empresas · 5 pessoas · 8 produtos · 6 armazéns · 2 contas · 7 documentos de venda · 6 movimentos de estoque · 4 títulos · 1 movimento bancário · 4 solicitações de compra · 20 animais |
| 5. Ledger | 23 migrations, última `0023_venda_execucao_configurada_guarda.sql` |
| 6. 0023 e TOP | gatilho com a cláusula da R1 = `true`; versões de TOP com execução configurada = `0` |

**Leitura depois da limpeza — própria, 24/09/2026 00:35:55 UTC, READ ONLY** (inventário
`docs/sql/inventario-go-live.sql`, rodado pela sessão da VENDAS-A1 numa transação `READ ONLY`, com
`transaction_read_only = on` conferido na mesma transação; blocos agregados num único `select` seguido de
`rollback`):

| Bloco | Resultado |
|---|---|
| 1. Organizações | 1: "Fazenda Kaiman I", slug `fazenda-kaiman-i`, id `f5ab2eae-73e9-48fe-9259-01677fded263`, criada em 23/09/2026 20:07:25 UTC, não excluída, `origem_seed = organizacao_limpa` |
| 2. Usuários | 1: o e-mail do Maike, ativo, em 1 organização. É o MESMO e-mail de antes: a limpeza o liberou, e a recusa de e-mail existente da decisão 241 não entrou em jogo. Nenhum `@demo.local` nem `@teste.local` |
| 3. Vínculos | 1: `fazenda-kaiman-i` / o e-mail do Maike, dono, perfil Administrador, ativo |
| 4. Volume | 1 empresa · 1 pessoa · 0 produtos · 0 armazéns · 0 contas bancárias · 0 centros de custo · 2 categorias financeiras · 0 documentos de venda · 0 movimentos de estoque · 0 títulos · 0 movimentos bancários · 0 solicitações de compra · 0 animais · 0 TOPs |
| 5. Ledger | 23 migrations, última `0023_venda_execucao_configurada_guarda.sql` (aplicada em 23/09/2026 18:28:20 UTC) |
| 6. 0023 e TOP | gatilho com a cláusula da R1 = `true`; versões de TOP com execução configurada = `0` |

**Leitura da sessão revisora, 23/09/2026 às 20:38:20 UTC** (somente leitura, logo depois da limpeza; citada
como dela, não desta sessão): 1 organização (`fazenda-kaiman-i`, `origem_seed = organizacao_limpa`) · 1
usuário (o e-mail do Maike, ativo) · empresas 0 · pessoas 0 · produtos 0 · armazéns 0 · centros de custo 0 ·
categorias financeiras 1 (código "1", receita, analítica, criada pelo Maike às 20:38) · documentos de venda 0
· títulos 0 · movimentos de estoque 0 · TOPs 0 · versões com execução configurada 0 · ledger com 23
migrations, última a 0023. A diferença para a leitura própria (1 empresa, 1 pessoa, 2 categorias) é cadastro
do Maike entre as duas leituras.

| # | O quê | Quem | Onde | Como verificar | Estado | Bloqueia? |
|---|---|---|---|---|---|---|
| **G1** | PR #56 implantada; `0023` no ledger com o gatilho da R1; `TOP_EFFECTS_RUNTIME_V1_ENABLED` ausente ou `0` | Maike (gate); sessão (leitura) | Supabase (leitura); Railway, serviço `api` → Variables | blocos 5 e 6 do inventário; nome da variável no painel (o valor não precisa ser lido por sessão) | ledger e gatilho **OK em 23/09/2026** (inventário acima); gate da TOP: **leitura datada da sessão revisora em 23/09/2026 (~18h30 UTC)** — a lista de NOMES de variáveis do serviço `api` no Railway não continha `TOP_EFFECTS_RUNTIME_V1_ENABLED` → gate desligado (valores não foram lidos); reconferir na janela do go-live | sim |
| **G2** | Railway exigir CI verde antes de implantar (`checkSuites`) em `api` **e** `web` | Maike | Railway → cada serviço → Settings → "Wait for CI" | ler de novo o campo nos dois serviços | **PENDING** — lido `false` nos dois em 23/09/2026 | sim |
| **G3** | teto do pre-deploy no `api` | Maike | Railway → `api` → Settings → Pre-Deploy Timeout | ler o campo | **OK em 23/09/2026**: `preDeployTimeoutSeconds = 300` (reler na janela de deploy destrutivo) | sim |
| **G4** | P1: backup diário existe; restore num projeto NOVO; consultas P1.3 no restaurado; registro P1.4 | Maike (P1.1/P1.2); sessão (P1.3, leitura) | Supabase → Database → Backups → Restore to a New Project | `docs/PRE-BASE2-05C-1-PREFLIGHT.md` P1.1–P1.4; P1.4 anotado AQUI com data, projeto restaurado e respostas | **PENDING** (`BLOCKED` desde 23/09/2026) | sim |
| **G5** | inventário rodado e registrado | sessão | Supabase, transação `READ ONLY` | tabela "Leitura depois da limpeza" acima | **OK em 24/09/2026 (00:35:55 UTC)** — leitura própria da VENDAS-A1, `READ ONLY` (a da sessão revisora, de 23/09 20:38:20 UTC, fica registrada ao lado); reler imediatamente antes da primeira transação real | sim |
| **G6** | credenciais conhecidas e variáveis de seed neutralizadas: (a) **OBRIGATÓRIO antes do primeiro lançamento real: desativar TODOS os usuários `@demo.local` e `@teste.local` da sandbox** (hoje: `operador@demo.local` ativo e 3 `ckpt-v2-*@teste.local`), pela tela Configurações → Usuários da sandbox; (b) `LOCAL_AUTH_SECRET` forte (≥ 32 caracteres aleatórios, nunca o padrão de desenvolvimento); (c) `NEXT_PUBLIC_DEMO_MODE` ausente em cada serviço web listado em "## Superfície web"; (d) `SEED_ON_DEPLOY=0` ou ausente | Maike | (a) Configurações → Usuários, na organização sandbox; (b)(d) Railway `api` → Variables; (c) Railway `web` e Vercel → Environment Variables | (a) bloco 2 do inventário: nenhum `@demo.local`/`@teste.local` com `is_active = true` e nenhum com vínculo ativo; (b) só o Maike confere o valor — nenhuma sessão lê segredo; (c)(d) presença/ausência do NOME da variável | (a) **NOT_APPLICABLE** desde a limpeza de 23/09/2026 — não existe usuário `@demo.local` nem `@teste.local` (bloco 2 da leitura depois da limpeza); antes dela: `operador@demo.local` ativo; (b) **PENDING**; (c) Railway `web`: ausente em 23/09/2026 (**OK**), Vercel **PENDING** — a sessão revisora não teve acesso às variáveis do projeto na Vercel (403) em 23/09/2026; o Maike confere em Vercel → projeto → Settings → Environment Variables → Production; (d) **OK** — `SEED_ON_DEPLOY=0` gravada pela sessão revisora às 20:03:17 UTC de 23/09/2026 (o valor é conhecido porque a própria sessão o gravou; não é segredo) | sim |
| **G7** | criar a organização limpa (roteiro abaixo) | Maike | Railway `api` → Variables + um deploy | log do pre-deploy `organização limpa criada: id=… slug=… admin=…`; login; bloco 1 e 3 do inventário | **OK em 23/09/2026, na VARIANTE executada**: limpeza total + organização limpa com o MESMO e-mail do Maike; deployment `5fa0cdfd-ea94-49fb-a14b-61d40175a811`; slug `fazenda-kaiman-i`; id da organização `f5ab2eae-73e9-48fe-9259-01677fded263` (leitura própria de 24/09/2026). Passo 6 **PARCIAL**: `ORGANIZACAO_LIMPA_ON_DEPLOY=0` e `ADMIN_PASSWORD` neutralizada às 20:12:27 UTC; os NOMES `ORG_NAME`, `ORG_SLUG`, `ADMIN_NAME`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ORGANIZACAO_LIMPA_ON_DEPLOY` e `SEED_ON_DEPLOY` continuam definidos, inertes → remoção **PENDING** (Maike). Passo 8 (trocar a senha pela interface) **PENDING** até o Maike confirmar | sim |
| **G8** | cadastros mínimos, NESTA ordem: empresas → armazéns → centros de custo → categorias financeiras → contas bancárias → pessoas → produtos → TOPs de Venda, Pedido e Orçamento (uma padrão por família) | Maike | telas do sistema, logado na organização nova | cada tela lista o que foi criado; a primeira empresa tem código 1 | **EM ANDAMENTO** — leitura própria de 24/09/2026 (00:35:55 UTC): empresas 1 · armazéns 0 · centros de custo 0 · categorias financeiras 2 · contas bancárias 0 · pessoas 1 · produtos 0 · TOPs 0. Sem TOP ativa da família, a Central não lança (a tela mostra "Nenhum Tipo de Operação ativo está cadastrado…") | sim |
| **G9** | data de corte e saldos iniciais ANTES dela: estoque, contas bancárias, títulos em aberto | Maike | telas de estoque (entrada/ajuste), Caixa e Bancos, Contas a Pagar/Receber | relatório de saldo por armazém e por conta na data de corte bate com o controle anterior | **PENDING** | sim |
| **R1** | ambiente de homologação separado da produção | Maike | Railway/Supabase | projeto próprio com banco próprio | **PENDING** | não (recomendado) |
| **R2** | PITR (recuperação para um instante) | Maike | Supabase → add-on PITR | painel mostra PITR ativo | **PENDING** | não (recomendado) |
| **R3** | uma única URL web para uso real | Maike | Railway `web` / Vercel / `WEB_ORIGIN` | uma URL divulgada; as outras fora do `WEB_ORIGIN` | **PENDING** | não (recomendado) |

**Aviso de G8 — receita da venda (reescrito pela VENDAS-A1).** Orçamento, pedido e venda criados pela
Central nova levam a PRÓPRIA "Categoria financeira" e o PRÓPRIO "Centro de custo" (obrigatórios na tela nas
três variantes; a conversão os copia), e a confirmação gera as contas a receber com a classificação DO
DOCUMENTO — nos dois caminhos, legado e configurado. O recuo antigo — a PRIMEIRA categoria de receita
**analítica** e o PRIMEIRO centro de custo **analítico**, pela ordem do código — só vale para documento SEM
classificação (cliente anterior à VENDAS-A1 ou chamada de API sem os campos). Nesse documento, o detalhe
mostra "Não informada" na categoria e "Não informado" no centro de custo e, na venda ainda aberta, avisa que a
confirmação usará o "padrão automático" (desde a VENDAS-A5-1, só quando a prévia da confirmação prevê que ela pode
acontecer e vai gerar contas a receber pelo recuo, e já nomeando a categoria e o centro — decisão 249); depois de confirmada, é a AUDITORIA
da confirmação que registra a origem "padrão legado" e os ids usados. Documento classificado cuja categoria ou centro deixou de valer é RECUSADO
na confirmação, nunca recua. Confirmar continua exigindo categoria de receita analítica e centro de custo
analítico cadastrados e ativos: sem centro de custo nenhum (a produção hoje tem 0), a venda não confirma.

**Por que G7 exige cuidado com o e-mail — HISTÓRICO** (valia enquanto existia a sandbox; depois da limpeza de
23/09/2026 o e-mail do Maike pertence só à organização real). O login escolhe a primeira organização do usuário **por nome**
e não existe seletor de organização. Hoje o e-mail do Maike é dono da `principal` (inventário, 23/09/2026).
Se o mesmo usuário ficasse nas duas, o login poderia abrir a sandbox e a transação real iria para o lugar
errado. Por isso a criação **recusa e-mail já cadastrado** (nunca altera o usuário existente) e o e-mail do
dono novo tem de pertencer **só** à organização nova.

### G7 — passo a passo

1. **Escolher o e-mail do dono novo: um e-mail que AINDA NÃO EXISTE no sistema** — é a única opção.
   O sistema não troca e-mail de usuário (a edição recusa: "O e-mail do usuário não pode ser alterado."), e a
   criação recusa e-mail já cadastrado. Sugestão prática: um apelido com "+" do mesmo endereço (ex.:
   `nome+fazenda@gmail.com`) — para o sistema é outro e-mail, e a mensagem chega na mesma caixa. O usuário
   atual da sandbox fica onde está, como usuário da sandbox.
2. **Conferir G1–G6** acima. Em especial `SEED_ON_DEPLOY` fora (ou `0`): as duas flags juntas são recusadas.
3. **Railway → `api` → Variables**, trocar os VALORES (os nomes são os mesmos do seed demo):
   `ORG_NAME` = nome real · `ORG_SLUG` = slug novo (minúsculas, dígitos e hífen; **não** `principal`) ·
   `ADMIN_NAME` = nome do dono · `ADMIN_EMAIL` = e-mail do passo 1 · `ADMIN_PASSWORD` = senha temporária com
   **12+ caracteres**, que não seja nenhuma senha do repositório · `ORGANIZACAO_LIMPA_ON_DEPLOY=1`.
4. **UM deploy** do `api` (redeploy da versão atual; o pre-deploy roda sozinho).
5. **Ler o log do pre-deploy.** Esperado: `organização limpa criada: id=<uuid> slug=<slug> admin=<e-mail>`.
   Qualquer `organização limpa recusada: …` diz o motivo e garante que **nada** foi gravado — corrija a
   variável indicada e repita o passo 4. O log nunca mostra senha nem hash.
6. **Remover** do `api`: `ORGANIZACAO_LIMPA_ON_DEPLOY`, `ADMIN_PASSWORD` e as variáveis de seed que não serão
   mais usadas (`ORG_NAME`, `ORG_SLUG`, `ADMIN_NAME`, `ADMIN_EMAIL`, `SEED_ON_DEPLOY`). Se um deploy rodar com a
   flag ainda ligada, ele é um no-op que avisa `organização já criada; remova a flag e ADMIN_PASSWORD` — mas a
   senha temporária continua no painel até você removê-la.
7. **Primeiro login** com o e-mail e a senha temporária; conferir que o cabeçalho mostra a organização nova.
8. **Trocar a senha pela interface.** A senha temporária esteve no painel; depois deste passo ela não vale mais.
9. **Registrar aqui** a data, o slug e o id da organização (nunca a senha), e rodar de novo os blocos 1 e 3
   do inventário: a organização nova aparece com `origem_seed = organizacao_limpa`, `e_demo = false`, um único
   vínculo (o dono).
10. Seguir para **G8**.

O que a criação faz e não faz: cria dados de referência (globais), a organização, o dono, o perfil
"Administrador" de sistema com todas as permissões, o vínculo e o escopo do dono (todas as empresas, todos os
módulos). **Não** cria empresa, pessoa, produto, armazém, conta, centro de custo, categoria, plano de contas,
safra, bem, animal, lote, TOP, nada `[DEMO]`, nem outro usuário. Mínimo estrutural sem tela: nenhum além do
perfil, do vínculo e do escopo do dono — contadores de código e de ID Global nascem sob demanda (a primeira
empresa recebe código 1, o primeiro registro numerado recebe ID Global 1); SLA de compras tem tela e padrão
0; autorizadores têm tela. Tudo isso está coberto em `packages/db/test/organizacao-limpa.test.ts` e
`apps/api/test/integration/organizacao-limpa.test.ts`.

## VENDAS-A1 — classificação financeira no documento de venda

A fatia acrescenta `categoria_financeira_id` e `centro_custo_id` (em PAR) a `erp.sales_documents` e faz a
confirmação gerar as contas a receber com a classificação do documento (decisão 248). A migration
`0024_venda_classificacao_financeira.sql` é **aditiva**: duas colunas anuláveis, o CHECK do par, chaves
candidatas `unique (id, organization_id)` em `erp.financial_categories` e `erp.cost_centers`, FKs compostas
com o tenant e dois gatilhos de guarda: `trg_sales_documents_classificacao_financeira` (confirmação) e
`trg_sales_documents_classificacao_conversao` (conversão). Sem backfill, sem default, sem NOT
NULL, sem corrigir dado — o item (2) da decisão 240 (P1 recente para migration destrutiva) **não se aplica**.

**Implantação — ordem: banco (0024) → API → web.** O pre-deploy da API aplica a 0024 como qualquer
migration; enquanto nenhum documento é classificado, os dois gatilhos deixam passar toda confirmação e toda
conversão, então uma instância anterior no pool durante o deploy não é barrada por documento antigo. A web nova só mostra e envia
os campos quando `GET /api/sales/<variante>/operation-types` declara `capacidades.classificacaoFinanceira = 1`
(o `contractVersion` continua 1); contra uma API anterior os campos não aparecem e o Salvar segue a regra de
antes. **Janela de indisponibilidade: NÃO precisa.**

**Reversão.**

- **Web:** livre — a web anterior não conhece os campos e a API nova preserva o gravado quando o campo vem
  ausente no PUT.
- **API (binário):** o binário anterior ignora a classificação por DOIS caminhos, e a 0024 barra os dois:
  - **confirmação:** ele confirmaria venda classificada pela "primeira por código"; o gatilho
    `trg_sales_documents_classificacao_financeira` o faz RECUSAR;
  - **conversão:** ele montaria o derivado de um orçamento ou pedido classificado SEM o par (e a venda derivada
    escaparia da guarda da confirmação); o gatilho `trg_sales_documents_classificacao_conversao` o faz
    RECUSAR, a origem continua aberta e nenhum derivado nasce.

  É seguro no sentido de não mentir, mas deixa esses documentos parados até o binário voltar. Por isso,
  **ANTES de reverter o binário da API, CONTAR** (LEITURA, pela conexão operacional; `PENDING` até ser
  executada com a credencial real), publicando os denominadores junto:

```sql
select count(*) filter (where kind = 'sale' and deleted_at is null) as vendas,
       count(*) filter (where kind = 'sale' and deleted_at is null
                         and categoria_financeira_id is not null
                         and status not in ('confirmed','invoiced','cancelled')) as vendas_classificadas_nao_confirmadas,
       count(*) filter (where kind in ('budget','order') and deleted_at is null) as orcamentos_e_pedidos,
       count(*) filter (where kind in ('budget','order') and deleted_at is null
                         and categoria_financeira_id is not null
                         and status not in ('converted','cancelled')) as orcamentos_e_pedidos_classificados_abertos
  from erp.sales_documents;
```

  `vendas_classificadas_nao_confirmadas` diz quantas vendas o binário anterior não vai confirmar;
  `orcamentos_e_pedidos_classificados_abertos` diz quantos orçamentos e pedidos ele não vai converter (a
  conversão recusa só `converted` e `cancelled` — `assertConvertible` —, por isso o filtro é por exclusão e
  pega `open`, `approved` e qualquer situação nova). Qualquer um dos dois diferente de zero exige decisão
  explícita do Maike antes da reversão.
- **Banco:** a 0024 fica — migration aplicada é histórico, e as colunas anuláveis são inertes para o
  binário anterior.

## CADASTROS-ESTRUTURA — Grupo de Produtos em árvore (`0025`) e nomes de mercado

Decisão 250. Os nomes novos (Naturezas, Centros de Resultado, Conta Contábil, Analítica Sim/Não, "superior")
são só RÓTULO: nenhum dado, chave, permissão ou endereço muda, e a web anterior continua funcionando com os
nomes antigos. O que tem janela de deploy é o Grupo de Produtos.

**A migration `0025_grupo_de_produtos_arvore.sql` é aditiva**: `erp.product_groups` ganha `code` (anulável —
o acervo não tem código e a 240(3) proíbe inventar), `parent_id` (FK composta com o tenant, sem cascade),
`kind` (padrão `analytic`) e `deleted_at`; a unicidade de nome passa da organização inteira para os IRMÃOS
vivos (relaxamento — nenhuma linha muda); `erp.products.category_id` e `kind_id` deixam de ser NOT NULL.
`product_categories` e `product_kinds` ficam (legado, fora de uso; remoção é da DATA-GOV). Trava própria,
`lock_timeout` e pré/pós-condições nomeadas. Produção em 24/09/2026 (leitura revisora 13:29 UTC): 1 grupo
("teste", sem código), 0 categorias, 0 classes, 0 produtos — o grupo do acervo fica raiz, sem código, no fim
da lista.

**Implantação — ordem: banco (0025) → API → web.** **Janela de indisponibilidade: NÃO precisa.** Na janela
de deploy há QUATRO combinações, todas provadas no harness de skew (`skew-web-anterior.spec.ts` e
`skew-api-producao.spec.ts`, casos CE-K1..CE-K4):

1. **web ANTERIOR × API nova — produto:** o formulário anterior manda `category_id` e `kind_id`; a API nova
   os aceita como campos LEGADOS opcionais (schema continua `.strict()`) e grava o que vier → **201**.
2. **web ANTERIOR × API nova — grupo:** o formulário anterior manda só o nome; a API nova exige código →
   **422 declarado** no campo Código, nada gravado. Cadastrar grupo espera a web nova.
3. **web NOVA × API anterior — produto e grupo:** a API anterior exige categoria/classe e não conhece
   `code`/`kind`/`parent_id` do grupo (`.strict()`) → gravação **RECUSADA (422)**, nada gravado
   (fail-closed; nunca grava pela metade).
4. **web NOVA × API anterior — parâmetros:** o schema das máscaras (`apps/api/src/routes/admin.ts`) é
   `.strict()` sobre a lista de cadastros de código hierárquico; salvar máscara de **Grupos** na janela é
   **recusado (422)**; sem máscara de grupo, os parâmetros salvam normalmente.

**Reversão.** Web: livre (a anterior usa os lookups de Categoria/Classe, que continuam na API). API
(binário): o anterior volta a exigir categoria/classe no produto e não edita grupo com os campos novos (422,
caso 3) — seguro, sem gravação parcial; produto criado sem categoria/classe continua legível. Banco: a 0025
fica — migration aplicada é histórico; as colunas novas são inertes para o binário anterior, e a unicidade
relaxada não quebra nenhuma escrita dele (o `on conflict (organization_id, name)` só existia no seed).

## CADASTROS FASE 2 — importação parcial (sem migration)

Decisão 251. Nenhuma migration, nenhuma variável nova. Muda só o contrato de `POST /api/imports/:key`
(parâmetro `modo`, campos novos e aditivos na resposta) e o diálogo de importação.

**Implantação — ordem: API → web.** **Janela de indisponibilidade: NÃO precisa.** Na janela há duas
combinações:

1. **web ANTERIOR × API nova:** a web anterior não manda `modo` → `tudo`, exatamente o comportamento de
   antes (qualquer erro → 422, nada gravado). Os campos novos da resposta são ignorados por ela. (IM-6)
2. **web NOVA × API anterior:** a prévia e "Importar tudo" saem SEM `modo` e funcionam como antes;
   "Importar só as X linhas certas" manda `modo=parcial`, a query `.strict()` da API anterior o recusa com
   422 ("Campo não reconhecido") ANTES de abrir o arquivo — nada gravado — e a tela mostra "O servidor ainda
   não aceita importação parcial; use Importar tudo." O corpo da recusa é medido contra o binário real da
   base no harness de skew (`skew-api-producao.spec.ts`, IM-K1); a reação da tela a esse corpo, em IM-W2
   (`cadastros-importacao.spec.ts`). Sem os campos novos, a prévia conta as linhas com erro pela própria lista.

**Reversão.** Web: livre. API: a anterior volta ao tudo-ou-nada; o que já foi gravado no modo parcial é
cadastro normal (com ID Global), legível e editável pelo binário anterior. Nenhum dado a desfazer.

## CADASTROS FASE 3 — referências oficiais (`0026`) e consultas de CEP e CNPJ

Decisão 252.

**A migration `0026_referencias_oficiais.sql` é aditiva** (trava (2026,60), `lock_timeout`, pré/pós-condições
nomeadas, não reaplicável): `erp.banks.ispb`; `erp.ncm.nivel`, `descricao_completa`, `vigencia_inicio`,
`vigencia_fim`; tabelas novas `erp.cbo_ocupacoes`, `erp.consulta_cep_cache` e `erp.consulta_cnpj_cache` (as
duas últimas GLOBAIS, RLS forçada, só `erp_app`; `authenticated`/`anon` sem acesso). A carga (27 UFs, 5.571
municípios, 463 bancos, 15.156 linhas de NCM, 2.694 ocupações CBO; procedência no cabeçalho de
`supabase/referencias/*.csv` e no DATA-DICTIONARY) é UPSERT: nada apagado, nome oficial pode mudar, os 14
municípios e os 10 bancos anteriores (inclusive `000`) continuam — a pós-condição PARA se algum sumir. O
arquivo tem ~1,7 MB (dados embutidos); a aplicação leva poucos segundos. Nenhuma tabela de organização é
tocada. Atualizar uma referência depois = rodar `node scripts/referencias/baixar.mjs` e escrever OUTRA
migration de carga.

**Variável nova da API — `CONSULTA_CNPJ_FONTES`** (opcional; não é segredo). Ordem das fontes GRATUITAS e
sem chave da consulta de CNPJ; padrão `brasilapi,cnpja,cnpjws`. `desligado` desliga a consulta (503). Nome
desconhecido, repetido ou lista vazia derruba o startup. Não existe credencial de consulta, nem fonte paga.

| Fonte | Endereço | Limite da fonte |
|---|---|---|
| BrasilAPI | `https://brasilapi.com.br/api/cnpj/v1/{cnpj}` (e `/api/cep/v1/{cep}`, reserva do CEP) | sem limite publicado |
| CNPJá aberta | `https://open.cnpja.com/office/{cnpj}` | 5 por minuto por IP |
| CNPJ.ws pública | `https://publica.cnpj.ws/cnpj/{cnpj}` | 3 por minuto por IP |
| ViaCEP | `https://viacep.com.br/ws/{cep}/json/` (principal do CEP) | sem limite publicado |

Limites da API: CEP 60/min e CNPJ 20/min por organização; "consultar de novo" 1/min por CNPJ; fonte que
responde 429 fica 60 s em pausa. Cache global: CEP 30 dias, CNPJ 7 dias. Tempo por fonte: ~3 s (CEP),
~5 s (CNPJ). Esses limites e a pausa vivem na MEMÓRIA de cada instância: com N réplicas o teto efetivo é N×.
**Saída de rede:** a API passa a fazer HTTPS de saída para os quatro hosts acima — se o ambiente restringir
egress, liberar só eles.

**Implantação — ordem: banco (0026) → API → web.** **Janela de indisponibilidade: NÃO precisa.** Na janela:

1. **API anterior × banco novo:** colunas e tabelas novas são inertes para ela; `people.city_id` e
   `products.ncm_code` continuam FK para as mesmas tabelas, agora completas.
2. **web ANTERIOR × API nova:** a cidade continua indo como código IBGE inteiro, banco como código e NCM como
   texto — a API aceita igual. Diferença declarada: NCM nova no produto que não seja de 8 dígitos vigente é
   recusada (422 no campo) — antes a FK já recusava qualquer código fora de `erp.ncm`, que estava vazia.
3. **web NOVA × API anterior:** a API anterior não tem `/api/referencias` (404); o campo de busca vira
   digitação do código com o aviso "Busca de … indisponível agora; digite o código" — a tela não trava.

**Reversão.** Web: livre. API: a anterior ignora as tabelas e colunas novas; nada a desfazer. Banco: a 0026
fica (migration aplicada é histórico); as referências carregadas são dado público oficial, e os caches podem
simplesmente envelhecer.

## CADASTROS FASE 4 — Parceiros: ficha em abas (`0027`)

Decisão 253.

**A migration `0027_parceiros_ficha_em_abas.sql` é aditiva** (trava (2026,61), `lock_timeout` 2 s, pré/pós-condições
nomeadas, não reaplicável): `unique (id, organization_id)` em `erp.people` (alvo das FKs compostas); colunas novas
em `erp.people` (`complemento`, `nascimento_abertura`, `indicador_ie`, `consumidor_final`, `produtor_rural`,
`regime_tributario`, `cnae_principal`, `situacao_receita`, `situacao_receita_consultada_em` — todas anuláveis ou com
default); `erp.client_profiles.limite_credito`; tabelas novas `erp.parceiro_enderecos`, `erp.parceiro_contatos` e
`erp.parceiro_contas` (RLS forçada, política única de tenant, `erp_app` sem DELETE); índice único
`ux_people_documento_normalizado` (organização + documento normalizado, entre vivos, só documento que NÃO fica vazio
depois de normalizar — o mesmo filtro da pré-condição; documento só de pontuação fica fora). **Pré-condição:** nenhum
documento duplicado entre parceiros vivos depois de normalizar — havendo, a migration PARA e nomeia os códigos
(nada é aplicado; a decisão de qual corrigir é humana). Rodar antes, em leitura, para saber:
`select organization_id, upper(regexp_replace(document,'[^0-9A-Za-z]','','g')), string_agg(code, ',') from erp.people
where document is not null and deleted_at is null and upper(regexp_replace(document,'[^0-9A-Za-z]','','g')) <> ''
group by 1, 2 having count(*) > 1;`. Nenhum UPDATE, nenhum DELETE: o parceiro de produção "Jurídica" com CPF formatado
fica como está — a regra tipo × documento da API (decisão 253, item 7) só o cobra na próxima edição pela tela.
Nenhuma variável nova.

**Implantação — ordem: banco (0027) → API → web.** **Janela de indisponibilidade: NÃO precisa.** Na janela:

1. **API anterior × banco novo:** colunas e tabelas novas são inertes; o índice novo passa a recusar documento
   duplicado com pontuação diferente (antes só o igual byte a byte) — 409 genérico na API anterior.
2. **web ANTERIOR × API nova:** o formulário anterior grava (campos de sempre); PUT sem as grades não mexe
   nelas; sem nenhum tipo marcado → 422 declarado ("Marque pelo menos um tipo…"); documento inválido → 422;
   duplicado → 409 com o código e o nome do existente. Provado em `skew-web-anterior.spec.ts` (PA-K2). Tipo ×
   documento divergente (Física com CNPJ, Jurídica com CPF; o formulário anterior também manda os dois campos) →
   422 declarado no campo do documento — provado na API em `cadastros-parceiros.test.ts` (DOC-1). As permissões
   por tipo (decisão 253, item 8) não mudam nada para o formulário anterior: ele não manda grades nem perfis.
3. **web NOVA × API anterior:** a ficha manda grades e perfis; o schema estrito da API anterior RECUSA (422
   "Campo não reconhecido") e nada é gravado — o usuário vê o erro e salva depois do deploy da API. Provado em
   `skew-api-producao.spec.ts` (PA-K1). O cadastro rápido manda só o principal e funciona.

**Reversão.** Web: livre. API: a anterior ignora colunas e tabelas novas (grades gravadas ficam guardadas e
voltam a aparecer quando a API nova voltar). Banco: a 0027 fica (migration aplicada é histórico); nada a desfazer.

## CADASTROS FASE 5 — RH: Funcionários (`0028`)

Decisão 255.

**A migration `0028_rh_funcionarios.sql` é aditiva** (trava (2026,62), `lock_timeout` 2 s, pré/pós-condições
nomeadas, não reaplicável): `erp.employee_profiles` ganha `organization_id` (preenchido a partir do parceiro — o
ÚNICO `UPDATE` da migration — e depois NOT NULL, com trigger que o preenche quando quem insere não o informa; FK
composta `(person_id, organization_id)` → `people`), `matricula`, `empresa_id` (FK composta com a organização),
`tipo_vinculo`, `trabalhador_rural`, `jornada_semanal`, PIS/NIS, CTPS, RG, CNH, `conta_pagamento_id` (FK composta
`(conta_pagamento_id, person_id)` → `parceiro_contas`, que ganha `unique (id, person_id)`) e `motivo_desligamento`;
trigger `trg_employee_profiles_matricula` (matrícula única entre funcionários VIVOS, 23505); `erp.job_functions.cbo_code`
ganha FK `NOT VALID` para `erp.cbo_ocupacoes` (acervo com CBO livre não é reconferido; só gravação nova do código);
**auditoria com sigilo (R1-2):** função `erp.audit_row_sigilo()` (SECURITY INVOKER, `search_path` fixo) e os gatilhos
`trg_employee_profiles_audit` e `trg_job_functions_audit` — a ficha de RH e a Função passam a ser auditadas, e o valor
de salário, valor hora, meta e comissão NUNCA entra na trilha (só o nome do campo, em `metadata.sigilo`); a
pós-condição confere os dois gatilhos.
**Pré-condição:** nenhuma ficha de RH órfã (sem parceiro) — havendo, PARA. Nenhum DELETE. Nenhuma variável nova.

**Implantação — ordem: banco (0028) → API → web.** **Janela de indisponibilidade: NÃO precisa.** Na janela:

1. **API anterior × banco novo:** colunas novas inertes; a folha e o relatório de funcionários leem
   `employee_profiles` como antes; o trigger preenche `organization_id` de qualquer insert antigo. Toda gravação
   da API anterior em `employee_profiles`/`job_functions` passa a deixar trilha (sem o valor de salário): o insert
   na trilha passa pela RLS de `erp.audit_logs` com a organização da própria linha — a API sempre grava com a
   organização da sessão (`runService`), então nada muda para ela.
2. **web ANTERIOR × API nova:** para quem tem `employees.edit` (e o proprietário) nada muda — "Novo funcionário"
   antigo (Pessoas com `is_employee`) grava; Funções sem CBO gravam; CBO digitado fora da CBO oficial → 422.
   Provado em `skew-web-anterior.spec.ts` (RH-K2, com o proprietário). **Mudança declarada (R1-2):** para perfil
   SEM `employees.edit`, o formulário ANTERIOR de Funções mostra salário e valor hora como obrigatórios e vazios (a
   API não os devolve): a própria tela anterior não deixa salvar sem preenchê-los, e preenchidos a API recusa (403
   "campo sigiloso …"), nada gravado; a lista anterior de Funções deixa de mostrar o salário, e ordenar/filtrar por
   ele → 403. É o sigilo valendo, não regressão: o web novo esconde os campos, não os manda e edita a Função; criar
   Função (salário obrigatório) exige `employees.edit` nos dois.
3. **web NOVA × API anterior:** a ficha de RH (`/api/resources/funcionarios`) e o novo pelo CPF
   (`/api/hr/funcionarios/por-cpf`) não existem na API anterior → 404, nada gravado. Provado em
   `skew-api-producao.spec.ts` (RH-K1).

**Reversão.** Web: livre. API: a anterior ignora as colunas novas (dados da ficha ficam guardados). Banco: a 0028
fica (migration aplicada é histórico); nada a desfazer.

## CADASTROS FASE 6 — Produtos: ficha em abas (`0029`)

Decisão 254.

**A migration `0029_produtos_ficha_em_abas.sql` é aditiva** (trava (2026,63), `lock_timeout` 2 s, pré/pós-condições
nomeadas, não reaplicável; depende da 0027, NÃO da 0028): `unique (id, organization_id)` em `erp.products`; colunas
novas em `erp.products` (`marca`, `fabricante`, `tipo_item`, `estoque_maximo`, `controle_lote` NOT NULL default
`nenhum`, `origem`, `cest`, `registro_mapa`); tabelas novas `erp.produto_unidades` e `erp.produto_fornecedores` (RLS
forçada, política única de tenant, `erp_app` sem DELETE, FKs compostas, auditoria); gatilhos
`trg_products_controle_lote` (has_lot ⇄ controle; controle não muda com saldo ≠ 0), `trg_stock_movements_exige_lote`
(só INSERT: lote obrigatório para produto com controle, INCLUSIVE no estorno; validade na entrada para lote + validade,
não no estorno) e
`trg_produto_{unidades,fornecedores}_conferir`; coluna anulável nova `erp.feed_batches.validade` (validade do produto
produzido, R1-1). **Pré-condição nomeada nova (R1-1 h):** produto com `has_lot` e saldo ≠ 0 no balde SEM lote
(`provider_lot` vazio ou só espaços) PARA a migration nomeando os produtos (código, descrição, id) — depois dela esse
saldo ficaria preso, porque todo movimento do produto exige lote e a escolha automática só olha lotes preenchidos.
**UPDATEs (nada apagado):** `controle_lote = 'lote'` onde `has_lot`;
`cest`/`origem` copiados de `taxes` quando o valor antigo já tem o formato novo (a chave em `taxes` fica); INSERT da
2ª unidade de hoje como primeira linha de `produto_unidades`. Pós-condição confere contagens (produtos, movimentos,
embalagens intactos; controle = has_lot de antes; uma linha de unidade por 2ª unidade válida). Nenhuma variável nova.

**Regra do lote depois desta fatia (revisão R1-1, decisão 254):** todo produto com `has_lot = true` vira controle
"lote", e todo movimento gravado dele leva o lote (API e gatilho).

- **Saída SEM lote informado** — venda, abastecimento, manutenção, OS, manejo/nutrição, dieta, ração (insumo),
  requisição, baixa, correção para baixo e perna de saída da transferência: a API ESCOLHE o lote pela validade (a mais
  próxima primeiro; sem validade por último; empate pelo lote em ordem alfabética), divide a quantidade entre lotes (um
  movimento por lote, com a validade do lote) e trava, na ordem da escolha, SÓ os saldos que vai consumir, antes de
  gravar (revisão do R1: travar também os que não usa fechava deadlock com a trava do produto que o gatilho pega).
  **Lote vencido** na data do movimento fica fora: só sai com o lote informado. Faltou saldo em lotes válidos → **409
  `INSUFFICIENT_STOCK`** dizendo quanto há em lotes válidos e em vencidos; nada é gravado. Quantidade que arredonda a
  zero na escala do estoque (4 casas) → 422.
- **Valor do documento = soma das partes:** o total do item e do documento de saída (baixa, requisição, transferência,
  manutenção, abastecimento, manejo, dieta, ração) é a soma do valor de cada parte (Σ lineTotal(qᵢ, cᵢ), a conta de
  antes, meio centavo para o par), nunca quantidade × custo médio ponderado — numa saída dividida os dois diferem em
  centavos. Com UMA parte (todo produto sem controle de lote, e toda saída que cabe num lote) o valor é exatamente o de
  antes desta fatia; o `total_cost` do ledger pode diferir dele em 1 centavo só no empate exato de meio centavo, como já
  diferia (LT-12c). Correção para baixo sem valor informado, de produto COM controle e sem lote informado, sai pela
  média de CADA lote (a do saldo do lote); produto sem controle e lote informado seguem com a média do saldo lido, como
  antes (LT-12d).
- **Saída COM lote informado:** sai do lote informado, inclusive vencido; o movimento grava a validade do lote.
- **Entradas:** NF-e, entrada de insumo e saldo inicial exigem o lote (e a validade no "lote + validade"). Devolução:
  lote e validade no item, exigidos só para produto com controle. Correção para cima: lote e validade (esta no "lote +
  validade"; num ajuste para baixo a validade é recusada). Transferência: o destino recebe o lote e a validade de cada
  parte da saída. Produção de ração: o produzido com controle recebe o código da produção como lote e a validade
  informada na produção (exigida no "lote + validade").
- **Lote aparado** na borda da API; lote só de espaços é "sem lote". O lote informado é resolvido pela CHAVE GRAVADA
  (`btrim(provider_lot)`): o saldo gravado pela API anterior com espaços nas pontas é achado pela correção (conta do
  saldo atual), pela saída com o lote informado e pela entrada — nenhum lote "sem espaços" nasce ao lado dele. Dois
  saldos do mesmo produto e armazém que só diferem por espaços, ambos com quantidade → 422 nomeando o lote.
- **Estorno sem lote de produto que controla lote → 422:** cancelar documento cujo movimento foi gravado SEM lote
  quando o produto ainda não controlava lote (API anterior, ou controle ligado depois com saldo zerado) é recusado,
  nada gravado — o estorno devolveria saldo ao balde sem lote, onde ficaria preso. O acerto é devolução ou correção
  informando o lote. A API recusa antes (`reverseStock`, com o nome do produto), e o GATILHO da 0029 também recusa
  o estorno sem lote (LT-8b): quem estorna sem conferir — a API anterior na janela do deploy ou numa reversão — não
  recria o saldo preso.
- **Controle com saldo:** mudar o controle com saldo ≠ 0 na organização → 422 "zere o saldo em todos os armazéns".

**Impacto em dados reais — medir ANTES, em leitura:** nenhum fluxo fica recusado por falta de campo de lote; o que
muda para o usuário é a escolha automática por validade (e o 409 quando só há saldo vencido ou insuficiente). Contar:
`select count(*) from erp.products where has_lot and deleted_at is null;`. A pré-condição nova tem de voltar VAZIA
(o texto da revisão R1 registra 0 produtos em produção; reconferir na hora):
`select p.code, p.description, b.warehouse_id, b.quantity from erp.products p join erp.stock_balances b on b.organization_id = p.organization_id and b.product_id = p.id where p.has_lot and btrim(b.provider_lot) = '' and b.quantity <> 0;`.
Havendo linha, a 0029 PARA nomeando o produto: zerar esse saldo é decisão humana ANTES do deploy.
Medir também (leitura; nenhuma delas para a migration):
- saldos com lote gravado com espaços nas pontas — a API nova os acha pela chave gravada; havendo DOIS do mesmo lote
  com quantidade no mesmo armazém, a saída com o lote informado responde 422 até o acerto (decisão humana):
  `select organization_id, warehouse_id, product_id, btrim(provider_lot) as lote, count(*) filter (where quantity <> 0) as com_saldo, array_agg(provider_lot) as gravados from erp.stock_balances where btrim(provider_lot) <> '' group by 1,2,3,4 having bool_or(provider_lot <> btrim(provider_lot)) and bool_or(quantity <> 0);`
  (`com_saldo` > 1 = o caso do 422);
- movimentos SEM lote, não estornados, de produto com `has_lot` — depois do deploy o cancelamento do documento deles
  responde 422 (o estorno cairia no balde sem lote); o que tiver de ser cancelado, cancelar ANTES do deploy:
  `select p.code, p.description, m.source_type, m.source_id, m.direction, m.quantity from erp.stock_movements m join erp.products p on p.id = m.product_id and p.organization_id = m.organization_id where p.has_lot and coalesce(btrim(m.provider_lot), '') = '' and m.movement_type <> 'reversal' and not exists (select 1 from erp.stock_movements r where r.organization_id = m.organization_id and r.movement_type = 'reversal' and r.note = 'estorno de ' || m.id);`.

**Riscos remanescentes declarados (revisão do R1):**
- **Deadlock residual:** uma saída sem lote que PRECISA de dois ou mais lotes trava todos eles antes de gravar; uma
  transferência concorrente PARA o mesmo armazém, de um desses lotes, que já segure a linha do produto, fecha ciclo. O
  PostgreSQL aborta uma das duas (40P01 → 409 `CONCURRENCY_CONFLICT`, nada gravado; repetir resolve). A saída que
  cabe num lote só não trava os outros (LT-9c).
- **Data da OS em UTC:** a finalização da OS grava o movimento com a data UTC do servidor (`todayISO()`, anterior a
  esta fatia; a API não tem fuso de negócio). Entre 21h e 24h no horário de Brasília, lote com validade de HOJE conta
  como vencido na escolha automática da OS: ela consome o lote seguinte ou responde 409. Corrigir exige a política de
  fuso da operação — fora do R1.
- **Correção lê o saldo atual sem trava** (anterior a esta fatia): uma saída concorrente confirmada entre a leitura e
  o movimento faz o ajuste aplicar uma diferença velha. Fora do R1.
- **Consulta de "em uso" sem índice, com o cadastro travado** (R1-5, decisão 256 (4)(b)): na troca analítico →
  sintético a natureza, o centro ou a conta é travada `for update` e cada ramo da consulta de uso (movimentos de
  estoque, rateios, itens de NF…) varre a tabela sem índice na FK. Lançamentos concorrentes naquele cadastro esperam a
  varredura. Só disponibilidade; os índices exigem migration nova — PR própria, com autorização.
- **Troca analítico → sintético exige visão da organização inteira** (R1-5, decisão 256 (4)(b)): a busca de uso roda
  sob a RLS de quem grava, e "não vejo" não pode virar "não está em uso". Membro com escopo parcial de empresas não
  faz a troca nem de registro sem uso (fail-closed). Afrouxar exige porta `SECURITY DEFINER` estreita — migration nova.
- **Registro com filhos não muda de superior também nas árvores SEM código** (R1-5, decisão 256 (4)(a)):
  Endereçamentos e Tipos de Documento seguem a regra literal; mover um galho exige mover as folhas antes.
- **Oráculo "inexistente × outra organização" na NF-e e na entrada de insumo** (anterior ao R1, decisão 256 (4)(c)):
  itens e rateio da NF e itens da entrada são gravados ANTES de `createTitles`/`createBankMovement` conferirem o
  rateio. Id inexistente cai na FK (409 "referência inválida") e id de outra organização passa pela FK de coluna
  única e cai na recusa 422 — distinção útil só a quem já tem o UUID alheio; e na entrada de insumo SEM movimento
  bancário a classificação do item não passa pela conferência. Correção (conferir antes do insert): PR própria.
- **Seletor genérico `GET /resources/:key/options` com filtro por qualquer coluna existente** (vem da `main`, fora do
  R1): fora do campo com `sigilo` (R1-2) e da grade `employee_events`, `?coluna=valor` filtra por qualquer coluna, e a
  rota só exige capacidade da tabela que é grade declarada. Ex.: sem permissão de RH, `bonuses/options?person_id=…`
  lista os eventos lançados para o funcionário (e `&amount=…` confirma o valor por tentativa); o `person_id` sai de
  `people/options`, que também não exige capacidade; `people/options?document=<CPF>` devolve o nome do parceiro a quem
  não tem `people.view`. Correção (filtro extra só em campo `ref`/`filter` do registry e capacidade da tabela para
  filtrar por outra coluna, ou `bonuses.amount` como dado de salário): PR própria, decisão do Maike.
- **Aceitos sem mudança pela revisão do R1 (texto do Maike):** baixa em lote em "movimento único" sem rateio
  (`movement_mode = single`, anterior a esta PR); códigos do eSocial pendentes de conferência do contador, sem mudança
  de código agora; CNPJ com letras → 422 enquanto nenhuma fonte gratuita consultar (decisão 252); limite de consultas
  de CNPJ/CEP em memória, por réplica (ver "CADASTROS FASE 3").
- **Pendentes de decisão do Maike (nada mudou no código):** conta contábil do rateio ativa e analítica (hoje só tenant
  e vida, decisão 256 (4)(c)); readmissão de quem tem a ficha de RH INATIVA (o novo pelo CPF recusa com 422 e não há
  porta de readmissão pela tela, decisão 255 (2)(c)); estorno sem lote de produto que hoje controla lote → 422 (acima);
  escrita da participação do proprietário pela UNIÃO dos módulos (decisão 253 (8)); subárvore travada também sem
  código (acima).

**Implantação — ordem: banco (0029) → API → web.** **Janela de indisponibilidade: NÃO precisa.** Na janela:

1. **API anterior × banco novo:** colunas e tabelas novas inertes; `has_lot` gravado pela API anterior vira o
   controle pelo gatilho; o gatilho de lote no movimento JÁ VALE, e a API anterior NÃO tem a escolha da revisão R1-1:
   ela escolhe UM lote com quantidade ≥ o pedido, ordenado só pela validade — INCLUSIVE lote vencido —, e sem lote
   que baste grava o movimento sem lote, que o gatilho recusa (422 genérico "informe o lote"). Na janela (e numa
   reversão da API) venda, OS, manejo, abastecimento, manutenção, dieta, ração, requisição e baixa de produto com
   lote VOLTAM a falhar quando a quantidade precisa de mais de um lote, e lote vencido volta a sair automaticamente.
   Entrada sem lote de produto com lote → erro do gatilho (422 genérico). Estorno sem lote de produto com lote
   (cancelar documento cujo movimento foi gravado sem lote) → o gatilho recusa (LT-8b), nada gravado — a API
   anterior não recria o saldo preso no balde sem lote.
2. **web ANTERIOR × API nova:** o formulário anterior grava (`has_lot` true → "lote", false → "nenhum"; 2ª
   unidade, tipo e fator aceitos como legado); PUT sem as grades não mexe nelas; mudar `has_lot` com saldo → 422.
   **Estoque pela web anterior (R1-1):** a devolução da web anterior não tem campo de lote — devolução de produto com
   controle passa a responder **422** "informe o lote" (em produção hoje ela GRAVA, no balde sem lote); o ajuste para
   cima sem lote de produto com controle também → 422 (antes gravava sem lote). Produto sem controle segue como antes.
   As saídas (venda, OS, requisição, baixa…) pela web anterior gravam: a escolha automática da API nova não depende
   da tela. É recusa declarada, nada gravado — nunca entrada sem lote.
3. **web NOVA × API anterior:** a ficha manda `controle_lote`, colunas e grades novas; o schema estrito da API
   anterior RECUSA (422 "Campo não reconhecido") e nada é gravado. Provado em `skew-api-producao.spec.ts` (PR-K1).
   **Estoque (R1-1, rodada 1 do R1):** lote e validade da devolução, validade da correção para cima e validade da
   produção de ração só aparecem e só viajam quando a API DECLARA `capacidades.loteNaEntrada = 1` em `/auth/context`
   (os schemas da API anterior não são estritos e DESCARTARIAM essas chaves em silêncio — a devolução entraria sem
   lote e o ajuste para cima gravaria o lote sem a validade). A API anterior não declara: a web nova se comporta como
   a anterior nas três telas, e o que a API anterior não sabe gravar o gatilho da 0029 recusa (devolução de produto
   com controle → 422, nada gravado). Provado em `skew-api-producao.spec.ts` (LT-K1) e, com a mesma API sem a
   declaração, pela reversa do LT-W1 (as colunas de lote somem). A ordem API → web deixa de ser condição de
   integridade para estas telas: se a web subir antes (Vercel antes do Railway, ou pre-deploy parado na 0029), nada
   é gravado sem o lote.

**Reversão.** Web: livre — a web nova sobre a API anterior esconde e não envia lote e validade na entrada (item 3).
API: a anterior ignora colunas e tabelas novas; na saída volta à escolha ANTIGA (um lote só, inclusive vencido; mais
de um lote → 422, item 1); entrada e estorno sem lote de produto com lote continuam recusados pelo gatilho. Banco: a
0029 fica (migration aplicada é histórico); nada a desfazer.

## CADASTROS AJUSTES 01 — parceiro, buscas, máscaras, árvores e `0030`

Decisão 257, subitens (A) a (E). A única migration é a `0030` (subitem C); as frentes A, B, D e E não têm
migration nem variável de ambiente nova.

**A migration `0030_cadastros_ajustes_01.sql` é aditiva e SEM backfill** (trava (2026,64), `lock_timeout` 2 s,
pré/pós-condições nomeadas, não reaplicável): colunas novas em `erp.people` (`matriz_id` com FK COMPOSTA
`(matriz_id, organization_id)` → `people` e check "não é ele mesmo", `rg`, `caepf` 14 dígitos, `sexo` F/M, `site`,
`caixa_postal`, `latitude`/`longitude` numeric(9,6) com faixa, `email_nfe` citext, `calcula_funrural` default false)
e `latitude`/`longitude` em `erp.parceiro_enderecos`; nas duas tabelas, o CHECK do PAR latitude/longitude (as duas ou
nenhuma: `chk_people_par_coordenadas`, `chk_parceiro_enderecos_par_coordenadas` — como as colunas nascem vazias, o
check não recusa nenhuma linha existente). Todas anuláveis ou com default; nenhuma linha muda de valor (a
pós-condição confere, e confere também que os dois CHECKs do par existem). **Pré-condições:** 0027 e 0029 aplicadas; colunas ainda inexistentes. Nenhuma variável nova.
**Impacto em dados reais:** nenhum UPDATE, nenhum DELETE; parceiros existentes ficam com as colunas novas vazias.

**Implantação — ordem: banco (0030) → API → web.** **Janela de indisponibilidade: NÃO precisa.** Na janela:

1. **API anterior × banco novo:** colunas novas inertes (anuláveis/default); a API anterior grava `erp.people` sem elas.
2. **web ANTERIOR × API nova:** a ficha anterior não manda as chaves novas; PUT sem elas não muda nada (as regras de
   tipo de pessoa só cobram quando o corpo toca o tipo ou o campo). A consulta antiga continua funcionando.
3. **web NOVA × API anterior:** a API anterior não declara `capacidades.consultaCnpjJanela`: a web nova não mostra
   nem envia os campos da 0030 (o schema estrito da anterior recusaria o corpo inteiro), não mostra `Consultar CNPJ`
   na barra nem `Novo pelo CNPJ` na lista, e usa a consulta antiga na aba Identificação.
   **O que aparece de NOVO mesmo SEM a capacidade, e por que é seguro** — tudo isto é só tela e grava as MESMAS
   chaves, com valores que a API anterior já aceita; nenhuma chave nova viaja, então o `.strict()` da anterior não
   recusa o corpo e nada é descartado em silêncio:
   - **máscaras** (CPF, CNPJ, CEP, telefone): a caixa mostra o formatado e grava o NORMALIZADO (só dígitos; no CNPJ
     alfanumérico, [0-9A-Z]) — o mesmo valor que a anterior grava e confere (o documento ela normaliza igual);
   - **campo Cidade** (nome, código IBGE ou CEP · Código IBGE · UF só leitura): grava o mesmo `city_id` (código IBGE)
     de sempre; a lista vem da busca de referência que a anterior já tem (sem texto ela responde 500 → a tela mostra
     "Tentar de novo" e não aceita texto livre, item 5);
   - **tipo de pessoa seguindo o documento** (e a faixa "Ajustar para…"): muda o `person_type` do formulário para uma
     das opções de sempre; a anterior confere tipo × documento com a mesma regra (R1-6) e recusa em 422 o que não bater;
   - **"Tipo do parceiro" num campo só**: continua gravando os mesmos booleanos `is_client`, `is_provider`,
     `is_transporter`, `is_employee`, `is_proprietary`;
   - **Anexos na barra de ações**: o mesmo diálogo e as mesmas rotas de anexo de antes, só em outro lugar da ficha — e só
     nas fichas cujo cadastro aceita anexo. Funcionários é VISÃO de Parceiros (recorte fixo `is_employee`): a API não a
     aceita como pai de anexo (422), então a ficha de Funcionários não mostra o botão (revisão final do R1).
4. **web ANTERIOR × API nova — referências (A):** a busca sem texto passa a responder 200 (a anterior dava 500 ao abrir
   Banco, NCM, CBO ou Cidade); o formato da resposta é o mesmo, só o texto do rótulo muda (`5106752 · Pontes e Lacerda -
   MT`, `001 · Banco do Brasil S.A.`). CEP passa a responder a qualquer membro da organização.
5. **web NOVA × API anterior — referências (B):** a busca sem texto da anterior continua dando 500 → a tela mostra
   "Tentar de novo" e nunca aceita texto livre; com texto a busca funciona. Na anterior o CEP ainda exige
   `people.create`/`people.edit`: sem elas, aviso "Sem permissão para consultar CEP.".
6. **web ANTERIOR × API nova — árvores e sequenciais (D):** POST de árvore com o código sugerido → aceito; código
   diferente → 422 "O código é gerado pelo sistema."; mudar o superior pela edição → 422 "Use Mover." (também quando o
   corpo traz o código novo junto, `{ parent_id, code }`: o superior é conferido antes do código). Registro do acervo
   SEM código (Grupos de Produtos anteriores à 0025) ganha o código gerado ao ser salvo — pela web anterior também;
   se ela mandar um código digitado diferente do gerado, 422. Conta bancária,
   área, pátio, setor e curral: a web anterior exige digitar o código e a API nova o recusa (422 legível) — **enquanto a
   web anterior estiver no ar, esses cinco cadastros não recebem inclusão**. Por isso o intervalo entre API e web deve ser
   curto (minutos), como nas fatias anteriores.
7. **web NOVA × API anterior — árvores (D):** sem `codigoAutomatico`/`moverComFilhos`, a web mostra o código digitável com
   a sugestão de sempre, o Mover de antes (só registro sem filhos) e não mostra a Numeração dos cadastros.
8. **Zerar numeração (D)**, na ordem em que acontece, numa transação: trava da numeração do cadastro NA organização
   (advisory — as inclusões pela API daquele cadastro, naquela organização, esperam) → linha do contador `for update` →
   contagem: com registro vivo, 422 com o motivo, sem nenhuma escrita e sem pedir trava de tabela → **limite de 1 Zerar
   por cadastro por organização por minuto** (o segundo → 429; conferido na auditoria, dentro da transação: vale entre
   instâncias da API e só conta o Zerar que gravou) → fila de Zerar da MESMA tabela entre organizações (advisory só da
   tabela: sem ela, dois Zerar de organizações diferentes, cada um com a liberação feita, pediam a trava da tabela um
   contra o outro e o banco derrubava um com 409; com ela, o segundo espera o primeiro) → liberação dos excluídos que seguram código (`EXC-<id>`; os pares
   `{ id, codigo_antigo }` vão na auditoria do Zerar, porque a maioria das tabelas não tem gatilho de auditoria) e
   contador a 0 → auditoria → **só então** `LOCK TABLE … IN SHARE ROW EXCLUSIVE` e, sob ela, SÓ a recontagem, até o
   commit. Com a tabela travada — quando inclusões NAQUELA tabela esperam, em TODAS as organizações — fica só a
   RECONTAGEM, que LÊ as linhas da organização naquela tabela, excluídos inclusive, e não reescreve nenhuma: esse tempo
   cresce com o acervo da organização. A liberação, que REESCREVE os excluídos (o passo longo, que só toca linhas desta
   organização), roda antes da trava da tabela. Medido no banco local de teste, Contas bancárias com 50 mil excluídos:
   Zerar em ~0,9 s; inclusões de OUTRA organização na mesma tabela, durante ele, esperaram no máximo 40 ms — é a
   recontagem sob a trava (antes desta correção, 620 ms: a liberação rodava com a tabela travada). A trava da tabela espera no máximo 2 s (`lock_timeout`): se outra gravação longa (ex.:
   importação de outra organização) estiver na tabela, o Zerar desiste com 409, sem efeito. Se a recontagem achar um
   vivo (inclusão por porta que não passa pela trava da numeração: importação com código, SQL de fora), 422 e a
   transação desfaz tudo — liberação, contador e auditoria. Só roda com zero registros vivos; nada é apagado.
9. **Mover (D)** grava em DUAS fases (quem segura hoje o código final de outra linha sai da frente primeiro — o excluído
   liberado já para `EXC-<id>`, o que continua no galho para um código provisório —, depois os códigos finais): a
   ordem das linhas não importa mais e o POST nunca dá 409 onde a prévia deu 200 (a prévia é o mesmo plano). Libera
   como `EXC-<id>` o código de descendente EXCLUÍDO que não pode acompanhar o galho (acervo do Mover-de-folha anterior)
   e o de um EXCLUÍDO FORA do galho que segure o código novo de um registro VIVO do galho (em Grupos de Produtos o código
   é único só entre vivos: o excluído não conta e não é tocado); excluído do galho que cabe e não colide acompanha com o
   prefixo novo. Cada troca vai no plano, na prévia e no `audit` do Mover (`{ id, antes, depois }`, com o id canônico
   do registro). Descendente vivo fora do prefixo, ou código novo já usado por um VIVO fora do galho, continuam
   recusando (422).
10. **Referências e parceiro (R1):** `page` da busca de referência acima de 1000 → 422 (antes, `?page=1e308` dava 500);
   id malformado nas rotas do Mover → 404, a mesma de inexistente; CAEPF fora de 14 dígitos → 422 no campo, na aba
   Identificação (antes, a mensagem genérica do CHECK do banco). **Matriz** (só quando o corpo MUDA a matriz): precisa
   ser parceiro vivo, ativo, Jurídica, da organização, que não seja filial; parceiro que tem filiais não vira filial;
   nunca ele mesmo — 422 no campo `matriz_id`. A web anterior não conhece a Matriz e não a manda: nada muda para ela.

**Reversão.** Web: livre (itens 3, 5 e 7). API: a anterior ignora as colunas novas; a web nova volta sozinha ao
comportamento dos itens 3, 5 e 7. Códigos gerados, renumerados pelo Mover ou liberados como `EXC-<id>` pelo Zerar são
códigos comuns para a API anterior e ficam como estão (histórico, auditado). Banco: a 0030 fica (migration aplicada é
histórico); nada a desfazer.

**Roteiro de teste do Maike depois do deploy (na mão, produção, sem gravar nada que não queira manter):**
UI-1 abrir um parceiro em leitura → `Consultar CNPJ` ao lado de `Anexos`, habilitado; consultar → todos os dados;
aba Divergências; `Importar para o cadastro` → entra em Editar com os campos preenchidos e Tipo = Jurídica; Cancelar
(nada gravado). UI-2 lista de Parceiros → `Novo pelo CNPJ` → Importar → parceiro novo preenchido (Salvar só se
quiser manter). UI-4 CEP + Tab → Endereço, Bairro, Cidade, Código IBGE, UF e foco no Número; CEP de outra cidade →
aviso. UI-6 digitar 11 dígitos e SAIR do campo (Tab) → Física (RG, CAEPF, Sexo aparecem; "Nome completo");
enquanto se digita continua Jurídica, com máscara de CNPJ; a partir da 12ª posição → Jurídica já digitando (Matriz
aparece); troca que apagaria campo preenchido pergunta antes, listando-os; parceiro Jurídica com CPF → faixa âmbar e
`Ajustar para Física`. UI-7 Tipo do parceiro num campo só;
marcar Fornecedor → aba Fornecedor aparece. UI-3 campo Cidade: "pontes" → `5106752 · Pontes e Lacerda - MT`; um CEP →
a cidade do CEP como 1ª opção; 5106752 no Código IBGE → a cidade; UF só leitura. UI-5 máscaras: CPF, CNPJ (também colado
com pontuação e com o tipo ainda em Física), CEP, telefone e celular aparecem formatados e gravam só os dígitos (telefone: formatado ao SAIR do campo —
enquanto se digita, o texto digitado; com mais de 11 dígitos, ex. ramal, fica como digitado). UI-8
abrir Banco, NCM e CBO SEM digitar → a lista aparece (antes: erro); "nubank" → 260. UI-9 Naturezas: Código só leitura;
Novo filho mostra "será gerado ao salvar: …"; Mover um galho → PRÉVIA (os códigos novos) → **Cancelar**: a prévia é o
mesmo plano do POST e não grava nada. **Confirmar só com um galho que se queira de fato mover: o Mover é definitivo** —
e em produção nada se apaga (decisão 247): um galho de teste criado e excluído fica para sempre segurando os códigos.
Mover de volta NÃO GARANTE os códigos antigos: o galho recebe o número seguinte ao MAIOR código debaixo do superior de
origem (se era o último filho, volta ao mesmo número; senão ganha outro — ex.: 1.03 → 2.05 → 1.07); o que virou
`EXC-<id>` continua `EXC-<id>`; os códigos antigos ficam no `audit` do Mover. UI-10 Parametrizações → Numeração: cadastro com registros →
Zerar desabilitado com o motivo (não zerar nada em produção sem querer).

## CADASTROS AJUSTES 02 — campos de referência, CEP × cidade e cartões

Decisão 257, bloco "AJUSTES 02 (pós-merge)". **Sem migration, sem permissão, sem variável nova.** Implanta a web e
duas mudanças na API: `<campo>_nome` na listagem/detalhe (aditiva) e a conferência CEP × cidade na gravação
(validação). **Ordem livre** entre API e web; nenhum dado muda no deploy.

1. **web NOVA × API anterior:** sem `<campo>_nome`, a coluna da lista mostra o código (como hoje); a ficha funciona
   igual (o corpo enviado não mudou) e a API anterior não confere CEP × cidade — a trava "pelo CEP" da tela continua.
2. **web ANTERIOR × API nova:** a chave `<campo>_nome` a mais é ignorada pela web anterior; a gravação com CEP e
   cidade divergentes (CEP no cache) passa a ser recusada com a mensagem no campo da cidade — só quando o CEP ou a
   cidade mudou naquela gravação.

**Roteiro do Maike (na mão, em produção, depois do deploy):** (14) Parceiro novo → CEP 78250-000 + Tab → Cidade
"Pontes e Lacerda", Código IBGE "5106752", UF "MT", travada com "pelo CEP"; apagar o CEP destrava; CEP inexistente →
aviso e Cidade livre; digitar um CEP na busca da Cidade leva ao campo CEP. (15) Endereço → Incluir endereço: o
cartão tem os mesmos campos, na mesma ordem, do endereço principal, mais Tipo/Descrição/IE da propriedade/Ativo; CEP +
Tab preenche e trava; salvar, reabrir, valores lá. (16) Financeiro → Incluir conta → buscar "260" → Banco "NU
PAGAMENTOS S.A. - INSTITUIÇÃO DE PAGAMENTO" e Código do banco "260" em campos separados; salvar e reabrir. (17) Funções
→ CBO "621005" → Ocupação (CBO) "Trabalhador agropecuário em geral" e Código CBO "621005" separados. (R1) Abrir um parceiro já gravado com CEP → Editar → a Cidade vem travada "pelo CEP"
(se a cidade gravada for de outro CEP: aviso e botão "Usar a cidade do CEP"). **Não apagar
nada criado no teste** (decisão 247): usar um parceiro de teste já existente ou inativá-lo depois.

## VENDAS-A4 — condição de pagamento (0031)

Decisão 258. **Uma migration: `0031_vendas_condicao_pagamento.sql`** (pre-deploy; trava (2026,65), `lock_timeout` 2 s,
pré/pós-condições nomeadas, não destrutiva): tabela nova `erp.condicoes_pagamento` (VAZIA — nenhuma condição nasce),
e em `erp.sales_documents` duas colunas novas: `condicao_pagamento_id` (nula, FK composta) e `parcelas_ajustadas`
(falso). **Sem backfill: nenhuma linha existente muda de valor.** Nenhuma variável nova; o gate da 04A continua desligado.

**Ordem: banco (0031) → API → web.** Janela:
1. **API anterior × banco novo:** tabela e colunas inertes; a API anterior grava documentos sem elas (nula/falso).
2. **web ANTERIOR × API nova:** a web anterior não manda `condicao_pagamento_id`; POST sem a chave = sem condição e o
   plano como enviado; PUT sem a chave PRESERVA — exatamente o de hoje.
3. **web NOVA × API anterior:** sem `capacidades.condicaoPagamento`, a Central não mostra o campo e não envia a chave;
   a aba Configurações › Condições de pagamento mostra erro legível (a rota do cadastro não existe na API anterior).

**Reversão:** API e web voltam por redeploy; a tabela e as colunas ficam, inertes para o binário anterior (dado de
produção nunca é apagado — decisão 247).

**Roteiro do Maike (depois do deploy):** 1. Configurações › Financeiro › Condições de pagamento: criar "À vista"
(1 parcela, 0 dias), "30/60/90" (3 parcelas, 30 dias, intervalo 30) e "Entrada 30% + 2x" (entrada 30%, 2 parcelas,
30 dias, intervalo 30) — o código aparece sozinho. 2. Novo pedido ou venda → aba Financeiro → "30/60/90": o plano
aparece com 3 parcelas e 1º vencimento em 30 dias. 3. Salvar e abrir: "Condição de pagamento: <código> · 30/60/90".
4. Só numa venda de verdade: ao confirmar, as parcelas do financeiro batem com o plano.

## VENDAS-A3-1 — layout do documento por TOP (0032)

Decisão 259. **Uma migration: `0032_layout_documento.sql`** (pre-deploy; trava (2026,66), `lock_timeout` 2 s,
pré/pós-condições nomeadas, não destrutiva): tabelas novas `erp.layouts_documento` e `erp.layout_documento_tops`,
**VAZIAS**. Nenhuma linha existente muda. Nenhuma variável nova. **Sem layout cadastrado, tudo é como hoje** (vale o
layout do sistema = a Central atual, e nada novo é cobrado ao salvar).

**Ordem: banco (0032) → API → web.** Janela:
1. **API anterior × banco novo:** tabelas novas inertes.
2. **web ANTERIOR × API nova:** a web anterior não conhece o layout; sem layout cadastrado nada muda. Com layout
   cadastrado, o servidor cobra os obrigatórios dele ao salvar (a recusa vem no campo, 422 `LAYOUT_CAMPO_OBRIGATORIO`)
   — por isso cadastrar layouts só depois de a web nova estar no ar.
3. **web NOVA × API anterior:** sem `capacidades.layoutDocumento`, a Central é a de hoje, idêntica; a aba Layouts de
   documento mostra erro legível (a rota não existe na API anterior).

**Reversão:** API e web voltam por redeploy; as tabelas ficam, inertes para o binário anterior (decisão 247).

**Roteiro do Maike (depois do deploy) — no PEDIDO, não na venda** (em produção só existem as TOPs 1 Orçamento e 2
Pedido; não há TOP de venda): 1. Configurações › Operações › Layouts de documento › Novo (Pedido) a partir do
sistema: tirar "ICMS frete", renomear "Transportadora" para "Transp." e marcar obrigatória, pôr "Data de saída" com
padrão "data de hoje" e não editável; ligar à TOP 2 Pedido. "Parcelamento" (e Desconto, Outros valores, Frete, ICMS
frete, Dedutível) NÃO aceita obrigatório — sempre tem valor (R1). 2. Central com essa TOP: "ICMS frete" some, "Transp." com
"*", Data de saída preenchida e só leitura; salvar sem transportadora → erro no campo; com → salva. 3. TOP sem layout →
vale o padrão da família; sem padrão → a Central de hoje. 4. Editor da TOP mostra o layout e a origem.

## EDITAR-01 — editar o documento de venda salvo (0039)

Decisão 272. **Uma migration: `0039_versao_do_documento_de_venda.sql`** (pre-deploy; trava (2026,73), `lock_timeout` 2 s,
pré/pós-condições nomeadas `EDITAR-01: ...`, não destrutiva, sem backfill): a coluna
`erp.sales_documents.version bigint not null default 0` e o gatilho BEFORE UPDATE `trg_sales_documents_versao` (função
`erp.sales_documents_versao()`, sem SECURITY DEFINER, `search_path = erp, pg_temp`, EXECUTE só do dono), que soma 1 à
versão em todo update da linha; e recria a porta `erp.situacao_atraso_cliente(uuid, int)` (0033, SECURITY DEFINER)
com a MESMA assinatura, corpo, `search_path` e privilégios — só a reconferência de capacidade de dentro passa a aceitar
também `budgets.edit`, `orders.edit` e `sales.edit`, além das três `.create` (decisão 272, ponto 9). A coluna nasce com
o default constante, sem reescrever a tabela; o `alter table` pede a trava exclusiva de `erp.sales_documents` por um
instante — com uma transação longa segurando a tabela, a migration desiste em 2 s sem aplicar nada, e o deploy é
refeito (seguro: nada foi aplicado). Nenhuma variável nova, nenhuma permissão nova: a PATCH e o `/edicao` usam
`<variante>.edit` junto com `<variante>.view` (`budgets`, `orders`, `sales`), que já existem. **Sem tela** nesta fatia:
nenhuma tela chama as rotas novas (o lápis vem na F2, depois da VISUAL-UX-02).

**Pré-condição:** a 0039 recusa, com a mensagem nomeada e sem aplicar nada:
- **`erp.sales_documents` ausente** (a cadeia de migrations fora de ordem) — a primeira pergunta, antes de qualquer
  outra sobre a tabela;
- **já aplicada ou schema divergente** — `version`, `erp.sales_documents_versao()` ou `trg_sales_documents_versao` já
  existem (`EDITAR-01: erp.sales_documents.version ja existe; ...` vem primeiro, para a reaplicação dizer o motivo
  verdadeiro);
- **os BEFORE UPDATE por linha de `erp.sales_documents` não são exatamente os dois de hoje**, por nome e por função
  (`trg_sales_documents_classificacao_financeira` → `erp.venda_classificacao_financeira_guarda` e
  `trg_sales_documents_execucao_configurada` → `erp.venda_execucao_configurada_guarda`): `EDITAR-01: gatilhos BEFORE
  UPDATE por linha de erp.sales_documents diferentes dos dois esperados (...)`, que lista os encontrados. É sobre esse
  conjunto que vale "nenhuma guarda compara a linha inteira" e "a versão é a última";
- **quem aplica** não é dono de `erp.sales_documents` (`pg_has_role(..., 'USAGE')`), não cria objetos no schema `erp`,
  ou não é dono de `erp.situacao_atraso_cliente`;
- **o papel da aplicação poderia contornar o gatilho** — conferido PRIMEIRO que o papel `erp_app` existe (a falta
  dele é recusa própria, antes das conferências que o citam); depois, a pergunta é sempre `MEMBER` (o próprio
  `erp_app` conta; e `MEMBER`, não `USAGE`, porque ele é NOINHERIT e ainda faria SET ROLE): `erp_app` membro de
  qualquer papel superusuário, de qualquer papel com SET em `session_replication_role`, de qualquer papel com TRIGGER
  em `erp.sales_documents`, ou do papel dono da tabela — direto ou em cadeia, com ou sem herança; ou com
  `session_replication_role` guardado em `pg_db_role_setting` para ele (`ALTER ROLE erp_app SET`, também `IN
  DATABASE`) ou para todos os papéis (`setrole = 0`: `ALTER ROLE ALL SET`, `ALTER DATABASE SET`), em qualquer banco —
  a sessão dele nasceria com o gatilho desligado. O caso `setrole = 0` vai além do pedido na revisão, de propósito: é
  o mesmo efeito por outra porta;
- **a porta do atraso não é a da 0033**: ausente ou sem SECURITY DEFINER; corpo que não é, byte a byte, o da 0033
  (`md5(prosrc)` diferente de `d55df1291552c3fdd19b7c0eecf4d22c`); dono que não atravessa RLS.

**Conferido em produção (só leitura, pelo Maike, 30/09/2026) — o estado sobre o qual as pré-condições passam:** ledger
em 38; os BEFORE UPDATE por linha de `erp.sales_documents` são só os dois esperados (além deles, o AFTER da auditoria e
o BEFORE INSERT da conversão, que não entram na conta); sem `version` e sem `erp.sales_documents_versao()`; dono
`erp_migrator`, com CREATE em `erp`; `erp_app` não superusuário, não MEMBER de papel nenhum, sem TRIGGER, sem SET em
`session_replication_role` e sem linha em `pg_db_role_setting`; a porta: dono `erp_migrator` (BYPASSRLS), SECURITY
DEFINER, `stable`, `search_path` `erp, pg_temp`, EXECUTE só do `erp_app` e do dono, `md5(prosrc)` = o da 0033.

As pós-condições conferem objetos, nunca contagem de tabela viva: a coluna (`bigint`, `not null`, default `0`, sem
identity nem generated); a função (plpgsql, SECURITY INVOKER, `search_path = erp, pg_temp`, EXECUTE só do dono); o
gatilho (BEFORE UPDATE por linha, sem coluna, sem WHEN, ligado); a ORDEM (as duas guardas e a versão, a versão por
último); e a porta do atraso (as seis capacidades, SECURITY DEFINER, `stable`, o mesmo `search_path`, dono que
atravessa RLS, EXECUTE só do dono e do `erp_app`). Em erro, publique o nome do papel, nunca a conexão.

**Ordem: banco (0039) → API → web.** Janelas:
1. **API ANTERIOR × banco novo:** a API anterior nunca escreve `version`. O INSERT dela nomeia as colunas, e o
   documento nasce com o default 0. Cada UPDATE dela (PUT, confirmar, cancelar, encerrar saldo e a conversão quando
   atualiza a origem) passa pelo gatilho, que só soma 1 à versão — e um `set` explícito seria sobrescrito. O gatilho
   não recusa nada, não lê outra tabela e não toca outra coluna: por ele, nenhuma gravação da API anterior muda de
   resultado, código ou mensagem. Ele dispara depois das duas guardas da tabela (0023 e 0024, `before update of
   status`, que comparam colunas, não a linha inteira), então nenhuma vê a versão mudar; `erp.audit_row` (AFTER) grava
   antes/depois já com a versão. O `select d.*` do `GET` anterior passa a trazer `version` (campo aditivo, que a tela da
   consulta ignora), e a foto de `erp.audit_row` também (Histórico, abaixo). A API anterior chama
   `erp.situacao_atraso_cliente` com a mesma assinatura e lê a mesma forma; quem passa a receber linhas é só o usuário
   com alguma `.edit` de venda e nenhuma `.create` — e, para ele, o PUT da API anterior que troca o cliente para um
   devedor numa TOP com "bloqueia" passa a ser recusado (abaixo).
2. **web ANTERIOR × API nova:** a web anterior não chama a PATCH nem o `/edicao` — e nenhuma tela edita documento de
   venda salvo, nem pelo PUT. O PUT não mudou (compatibilidade da API). O `GET` ganha `version` (aditivo). Confirmar,
   cancelar e encerrar saldo pela web anterior somam a versão do documento (são update). Converter soma a versão da
   ORIGEM quando a conversão a atualiza: a conversão inteira sempre (a origem vira `converted`); a conversão em partes
   (faturar em partes) só quando a parte zera o saldo — a parte que não zera deixa a origem, e a versão dela, como
   estão; cancelar a parte que tinha zerado o saldo reabre a origem e também soma. O documento gerado nasce com 0.
   Quando a tela de edição existir, uma PATCH com a versão lida antes dessas gravações recebe 409
   `CONCURRENCY_CONFLICT` e recarrega — o efeito pretendido.
3. **web NOVA × API anterior:** a web desta fatia não muda, e nenhuma tela chama as rotas novas. A API anterior
   responde 404 de rota à PATCH e ao `/edicao`.

**Histórico de alterações:** a tela lista os campos que mudaram na foto de `erp.audit_row`, tirando só `updated_at`;
com a 0039, a `version` aparece em toda alteração (`version: N → N+1`), e a PATCH que grava gera DUAS linhas — a do
gatilho (a linha inteira do cabeçalho) e a do evento da PATCH (§15.2 do contrato). É verdadeiro e sem dado novo; como a
tela apresenta isso fica para a F2 (o lápis).

**Impacto em dados reais: os documentos de venda ganham a coluna version (0 para todos); nenhum valor existente muda.**
medido em produção (só leitura, 30/09): 1 papel, nenhum com .edit sem .create ou sem .view; nenhuma versão de TOP com cliente em atraso 'bloqueia' ou 'avisa'. A porta aberta a .edit não muda nada hoje.

**Mudança de efeito declarada (decisão 272, ponto 9):** o usuário que tem `budgets.edit`, `orders.edit` ou
`sales.edit` e NENHUMA de `budgets.create`, `orders.create` e `sales.create`, ao editar pelo PUT trocando o cliente para um cliente com título vencido
numa TOP de formato 3 com "Cliente em atraso: bloqueia", passa a receber 422 `CLIENTE_EM_ATRASO`. Antes a porta lhe
respondia zero linhas e a regra falhava aberta; não é efeito novo, é a regra que a organização já configurou valendo
também para quem só edita. Quem tem alguma das três `.create` não percebe diferença (a porta já lhe respondia). A
porta aberta a `.edit` fica por decisão do Maike (decisão 272).

**Reversão:** API e web voltam por redeploy da versão anterior, sem tocar no banco. A 0039 fica: a API anterior
convive com ela (janela 1) — inclusive com a porta do atraso alargada, que continua valendo para ela. Remover a
coluna ou o gatilho, ou devolver a porta às três `.create`, só por migration NOVA, e é decisão do Maike — nunca
editando a 0039. As edições já feitas pela PATCH são edições comuns do documento e ficam; nada de apagar dado de produção
(decisão 247).

**Roteiro ESCRITO e NÃO executado — devolver a porta do atraso ao corpo da 0033, se um dia for preciso.** É migration
NOVA, decisão do Maike; nenhuma sessão a aplica. Ela toma a própria trava, confere antes que a porta é a da 0039 (cita
as três `.edit`) e, depois, que `md5(prosrc)` voltou a `d55df1291552c3fdd19b7c0eecf4d22c` e que só o dono e o
`erp_app` a executam; roda pelo dono da função (`create or replace` conserva dono e privilégios). O corpo entre os `$$`
é copiado BYTE A BYTE de `supabase/migrations/0033_tipo_operacao_restricoes.sql` — é isso que devolve o md5.
Consequência: quem só edita volta a receber zero linhas da porta (o falso "em dia" do ponto 9 da decisão 272).

```sql
create or replace function erp.situacao_atraso_cliente(p_cliente uuid, p_tolerancia int)
  returns table (titulos int, total numeric, vencimento_mais_antigo date)
language plpgsql stable security definer set search_path = erp, pg_temp as $$
declare
  v_org uuid := erp.current_org_id();
  v_user uuid := erp.effective_user_id();
begin
  if v_org is null or v_user is null or p_cliente is null or p_tolerancia is null
     or p_tolerancia < 0 or p_tolerancia > 365 then
    return;
  end if;
  if not (erp.has_permission(v_org, v_user, 'budgets.create')
          or erp.has_permission(v_org, v_user, 'orders.create')
          or erp.has_permission(v_org, v_user, 'sales.create')) then
    return;
  end if;
  return query
    select count(*)::int, coalesce(sum(t.balance), 0)::numeric, min(t.due_date)
      from erp.financial_titles t
     where t.organization_id = v_org
       and t.direction = 'receivable'
       and t.person_id = p_cliente
       and t.status in ('open', 'partially_paid')
       and t.deleted_at is null
       and t.balance > 0
       and t.due_date < current_date - p_tolerancia;
end $$;

comment on function erp.situacao_atraso_cliente(uuid, int) is
  'TOP-CONFIG-05: agregados (quantidade, total, vencimento mais antigo) dos titulos a receber vencidos do cliente, alem da tolerancia, em todas as empresas da organizacao da GUC. Porta estreita: exige capacidade de lancar venda; sem ela, zero linhas.';

revoke execute on function erp.situacao_atraso_cliente(uuid, int) from public;
grant execute on function erp.situacao_atraso_cliente(uuid, int) to erp_app;
```

**Roteiro do Maike (produção é operacional — decisões 240 e 247; a prova é só leitura, não cria nem muda documento):**
1. Depois da 0039, leitura no banco: `select count(*) filter (where version = 0) as sem_mudanca, count(*) filter (where
   version > 0) as mudaram from erp.sales_documents;` → os documentos parados desde a 0039 em 0; os que a operação
   atualizou DEPOIS da 0039 (confirmou, cancelou, editou, encerrou o saldo, converteu inteiro, ou teve o saldo zerado
   por uma parte) com versão ≥ 1 (com a produção em uso, `mudaram > 0` é esperado — o gatilho soma já na janela da API
   anterior); e `select tgname, tgenabled from pg_trigger where tgrelid = 'erp.sales_documents'::regclass and not
   tgisinternal order by tgname;` → `trg_sales_documents_versao` ligado (`O`); e `select
   pg_get_functiondef('erp.situacao_atraso_cliente(uuid,integer)'::regprocedure);` → a reconferência cita as seis
   capacidades (três `.create` e três `.edit`).
2. Depois da API nova: Vendas › abrir a consulta de um documento → a resposta de `GET /api/sales/<segmento>/<id>`
   (ferramentas do navegador › Rede) traz `version` — `"0"` no documento que não mudou desde a 0039.
3. Sem provocar nada: quando a operação confirmar, cancelar ou converter inteiro um documento, a mesma leitura do
   passo 1 mostra esse documento com versão ≥ 1 (a origem faturada em partes só sobe quando uma parte zera o saldo).
   Não há tela nova para conferir: o lápis vem na F2.

**Gate externo em produção: PENDING (Maike)** — a sessão não tem acesso autenticado à produção.

## OPERACOES-01 — correções e modelo de operações para o sistema inteiro (PR #90)

Fatia F1 em fases (decisões 278 a 288), uma PR. Cada fase acrescenta a sua subseção abaixo: migration (se houver),
ordem de deploy, compatibilidade nos dois sentidos do skew, impacto em dados reais, reversão e o roteiro do Maike em
produção (PENDING). As migrations da fatia são numeradas na ordem em que entram na branch (0042 a 0048, travas
(2026,76) a (2026,82)).

### F2 — as Centrais de Vendas e de Compras usam as regras gerais da TOP (OPERACOES-01, sem migration)

Decisão 279. **Sem migration, sem variável, sem permissão nova, sem capacidade nova.** Duas rotas novas, só de
LEITURA, em prefixo próprio: `GET /api/aprovacoes/vendas/:id` (`sales.view`) e `GET /api/aprovacoes/compras/:id`
(`compras.view`) — a situação da aprovação de UM documento. Uma chave nova, aditiva e por último, em
`GET /api/sales/<seg>/regras-da-operacao`, `GET /api/compras/<seg>/regras-da-operacao` e no `regras` de
`GET /api/sales/<seg>/:id/edicao`: `regrasGerais: { confirmacaoAutomatica, aceitaSemItens }`. Os corpos de entrada e
as respostas do POST, do PUT/PATCH e do `/convert` não mudam. Na tela: "Salvar e confirmar" com a TOP de Confirmação
Automática, o aviso do Salvar pelo resultado da confirmação, a venda e a compra sem itens quando a TOP permite, e o
bloco "Aprovação" na consulta da venda e da compra abertas.

**Migration:** nenhuma. Nada a aplicar no banco. As tabelas lidas (`erp.aprovacoes_venda`, `erp.aprovacoes_compra`,
0041) já estão em produção.

**Ordem do deploy:** esta fase não impõe ordem entre API e web — os dois sentidos do skew estão provados (abaixo). Duas
condições da PR #90:
- a F4 (decisão 281) vai no MESMO deploy: a ajuda nova da Geral do editor fala do documento sem itens nas Centrais de
  Vendas e de Compras, e isso só é verdade com esta fase;
- a ordem do deploy da PR é a das fases com migration (F5 a F10), nas seções delas.

**Impacto em dados reais:** NENHUM. Nada é gravado, reescrito nem apagado; sem backfill. As rotas novas só leem.
- As 3 TOPs de produção (leitura de 02/10) são de pedido de compra (formato 3, com Automática e Permitido declarados),
  orçamento e pedido de venda (formato 2). São variantes que nunca executam regra geral: `regrasGerais` sai
  `{ "confirmacaoAutomatica": false, "aceitaSemItens": false }`, e as Centrais continuam com "Salvar" e pedindo item.
- O bloco "Aprovação" só é montado na consulta da VENDA e da COMPRA. Produção não tem nenhuma das duas (só 1 orçamento
  convertido e 1 pedido de venda aberto); nenhuma consulta de lá faz o GET novo.
- O efeito novo só aparece quando o Maike gravar uma TOP de VENDA ou de COMPRA com Confirmação Automática, Documento sem
  itens Permitido ou aprovação — efeito que o servidor já executa desde a decisão 277. Ligar é decisão dele, TOP por TOP
  (decisão 281; item 4 da 240).

**Version skew** (base `622f194`; os specs entram nos configs de skew pelo nome e ficam fora da suíte comum):
- **Sentido 1 — web novo × API da base** (janela "web antes da API" e reversão só da API): sem `regrasGerais`, o web
  novo é a Central de hoje — "Salvar" exato com a TOP Automática; "Adicione ao menos um item." / "Inclua ao menos um
  item." com ZERO POST mesmo com a TOP que permitiria. O aviso do Salvar lê o `confirmacaoAutomatica` que a base JÁ
  devolve: com a TOP Automática a base confirma, e o aviso é "Salvo e confirmado." — a afirmação verdadeira. Na
  consulta, a pergunta da situação recebe o 404 "Rota não encontrada" (resposta, não falha de rede), o bloco não
  aparece, e a prévia do Confirmar explica a aprovação pendente como hoje. Nenhuma requisição morre no navegador.
  `operacoes-01-f2-skew-api-producao.spec.ts` (K-1a vendas, K-1b compras, K-1c consulta). O mundo é perguntado à base
  na hora, pelas duas portas da F2, que têm de concordar: o bloco em `/regras-da-operacao` e a resposta ao id
  inexistente em `/api/aprovacoes/<área>/<id>` (404 de rota = legado; 404 do documento = novo). Uma sem a outra
  reprova. O `skew-api-producao.spec.ts` compartilhado passa inteiro (34 casos) com o web desta fase.
- **Sentido 2 — web da base × API nova** (janela "API antes do web" e reversão só do web): a API manda a chave a mais,
  que o web da base ignora. O POST sai com as chaves de hoje e recebe 201 com a confirmação. A rota nova não é chamada.
  DECLARADO, como já é hoje com a base: o web da base diz "Salvo com sucesso" depois do POST que confirmou (ele não lê
  `confirmacaoAutomatica`), a consulta mostra o documento confirmado, e com a TOP Permitido ele ainda pede item (a API
  aceitaria). Nenhum 404, 422 ou 5xx no navegador. `operacoes-01-f2-skew-web-anterior.spec.ts` (K-2a vendas, K-2b
  compras). O mundo sai do fonte do web da base: `git grep -c -F "Salvar e confirmar" HEAD -- apps/web/src` → 0 em
  `622f194`.
- Os ramos "mundo novo" dos dois specs ("Salvar e confirmar", sem itens salva, bloco pendente) só rodam quando a base
  tiver esta fase.

**Reversão:** API e web voltam por redeploy da versão anterior; nada a desfazer em banco ou configuração.
- Reverter só a API = sentido 1: o rótulo e a pendência de hoje, o bloco da aprovação some, e o aviso continua lendo a
  resposta.
- Reverter só o web = sentido 2: a Central de hoje ("Salvar", item exigido, "Salvo com sucesso").
- TOP gravada no formato 5 segue a reversão da F4 (§ F4).

**Roteiro do Maike em produção (depois do deploy; produção é operacional — decisões 240 e 247; só leitura, nada é
gravado):**
1. Vendas › Novo › a TOP de pedido de venda que já existe:
   - o botão Salvar tem a dica "Salvar" (não "Salvar e confirmar");
   - clicar Salvar sem item → a pendência "Adicione ao menos um item." e nada é enviado;
   - no DevTools › Rede, a resposta de `…/api/sales/orders/regras-da-operacao?tipo_operacao_id=…` termina em
     `"regrasGerais":{"confirmacaoAutomatica":false,"aceitaSemItens":false}` (prova de que a API nova está no ar).
   Descartar.
2. Compras › Novo › a TOP de pedido de compra que já existe:
   - "Salvar"; sem item → "Inclua ao menos um item." e nada é enviado;
   - a resposta de `…/api/compras/pedidos/regras-da-operacao?tipo_operacao_id=…` termina no mesmo `regrasGerais` neutro
     (a TOP é formato 3 com Automática e Permitido declarados: o corte da 277, e o pedido nunca executa).
   Descartar.
3. Abrir o pedido de venda aberto: nenhum bloco "Aprovação", e a Rede não mostra pedido a `/api/aprovacoes/vendas/…`
   (só a consulta da venda pergunta). A pílula da conversão e o resto da consulta, como antes.
4. Aprovações: a fila abre como antes ("Nenhum documento aguardando aprovação.").

A prova com gravação ("Salvar e confirmar" → "Salvo e confirmado.") NÃO faz parte deste roteiro: ela grava um documento
confirmado, com estoque e financeiro, em produção. Ela acontece quando o Maike decidir ligar a Confirmação Automática
numa TOP de venda ou de compra real, e o primeiro Salvar dela é a prova.

**Gate externo em produção: PENDING (Maike)** — a sessão não tem acesso autenticado à produção.

### F3a — Local de estoque, pesquisa de pessoas e importação com o nome antigo (OPERACOES-01, sem migration)

Decisão 280 (parte F3a). **Sem migration, sem variável, sem permissão nova, sem capacidade nova, sem rota nova.**
"Armazém" passa a "Local de estoque" em todo texto que o usuário vê (telas, cadastros, permissões, relatórios, menu,
mensagens da API); os identificadores técnicos (tabela, colunas, `warehouses`, `/cadastros/armazens`, testids, códigos de
erro, `estoque.transferencia_entre_armazens`) não mudam. A importação de Produtos aceita também a coluna "Armazém padrão".
O seletor de Parceiros (`GET /api/resources/people/options`) acha também pela razão social e pelo CPF/CNPJ (com
`people.view`; sem ela, pelo nome e pelo documento completo), e todo seletor aceita `page`/`pageSize` (padrão 1 × 200, a
página de hoje). O motivo de baixa "Pagamento com produto" ganha rótulo.

**Migration:** nenhuma. Nada a aplicar no banco.

**Ordem do deploy:** esta parte não impõe ordem — API e web em qualquer ordem, nas superfícies de § Superfície web. Na
PR #90, a ordem do deploy é a das fases com migration (F5 a F10), nas seções delas.

**Impacto em dados reais:** NENHUM. Nada é gravado, reescrito nem apagado; sem backfill. Layout de documento gravado
com rótulo próprio continua com ele; o sem rótulo próprio passa a mostrar "Local de estoque" (o rótulo vem do catálogo,
não do registro). O que muda para fora do sistema: o cabeçalho das exportações (CSV/XLSX de listas e relatórios) que
tinham a coluna "Armazém" passa a "Local de estoque", e o modelo de importação de Produtos sai com "Local de estoque
padrão". Produção em 02/10: zero baixas, zero transferências — a coluna Motivo não tem o que mostrar lá.

**Version skew** (base `622f194`; provas em arquivos próprios, fora da suíte comum):
- **Sentido 1 — web novo × API da base** (janela "web antes da API" e reversão só da API): o web manda os MESMOS pedidos
  e corpos (o seletor pede `search` e nada mais). A tela diz "Local de estoque"; as mensagens que vêm da base dizem
  "armazém" (texto misturado, nada quebra). A pesquisa por CPF/CNPJ ou razão social mostra "Nenhum resultado", sem
  erro: a base só acha pelo nome (`operacoes-01-f3a-skew-api-producao.spec.ts`, K-1: a pergunta vai à base antes da tela
  e decide o ramo; na execução local, "a base NÃO acha o parceiro pelo CNPJ → Nenhum resultado"). Importação: o modelo
  vem da API que serve — a base produz e aceita "Armazém padrão". A lista de baixas mostra o rótulo (o dado é o mesmo).
  A produção de ração do web novo escolhe os locais pelos rótulos novos (LT-K1 de `skew-api-producao.spec.ts`).
- **Sentido 2 — web da base × API nova** (janela "API antes do web" e reversão só do web): o web da base pede
  `/options?search=…` sem página e recebe a página 1 de 200, com a MESMA forma (array `{code, id, label}`); o seletor
  antigo passa a achar o parceiro pelo CNPJ sem mudar nada nele, e salvar com ele funciona
  (`operacoes-01-f3a-skew-web-anterior.spec.ts`, K-2: premissa `page=abc` → 422, a API é a nova; a equipe salva com 201).
  As mensagens novas aparecem como vieram (o web da base não compara texto de mensagem). A planilha baixada ANTES do
  deploy (coluna "Armazém padrão") é aceita; o modelo baixado depois sai com "Local de estoque padrão".
  `GET /resources/:key/definition` ganha duas chaves (`pesquisaDoSeletor`, `rotulosAnteriores`), que o web da base ignora.

**Reversão:** redeploy da API e/ou do web anteriores; nada a desfazer em banco ou configuração. Reverter a API = sentido
1: a pesquisa por documento e razão volta a não achar ("Nenhum resultado"), o 422 de parâmetro repetido some, e — DECLARADO
— a planilha de Produtos baixada da API nova (cabeçalho "Local de estoque padrão") é RECUSADA pela anterior como
"Coluna desconhecida para Produtos. Baixe o modelo atualizado." (422, nada gravado): baixar o modelo de novo resolve.
Reverter o web = sentido 2.

**Roteiro do Maike (produção; produção é operacional — decisões 240 e 247; só leitura, nada é gravado):**
1. Menu (depois do deploy com a troca do `nav.registry.mjs`): Configurações › Produtos e Classificações mostra "Locais
   de estoque"; a busca do menu por "armazém" ainda acha a aba; Estoque › ações mostra "Transferência entre locais de
   estoque".
2. Configurações › Locais de estoque: o título "Locais de estoque"; "Novo" abre "Novo local de estoque" — fechar sem
   salvar. A ficha de um Produto (aba Estoque): o campo "Local de estoque padrão".
3. Perfis de usuário (permissões): "Locais de estoque" e "Transferência entre locais de estoque".
4. Vendas › + Novo › a TOP de orçamento ou de pedido de venda que já existe (produção tem só essas duas de venda): a coluna "Local de estoque" da grade aparece inteira, sem corte; o
   campo Cliente, com um cliente cadastrado com CNPJ: digitar o CNPJ COM máscara → o cliente aparece; digitar um pedaço
   da razão social em minúsculas → aparece. Descartar — nada é gravado. (Com um usuário sem a leitura de Parceiros, se
   houver: pelo nome e pelo CNPJ completo acha; pela raiz do CNPJ e pela razão, "Nenhum resultado" — de propósito.)
5. Cadastros › Produtos › Importar planilha: baixar o modelo → a coluna "Local de estoque padrão" (e nenhuma "Armazém
   padrão"). Enviar uma planilha com o cabeçalho "Armazém padrão" e um local da aba Listas: a PRÉVIA não acusa coluna
   desconhecida. FECHAR NA PRÉVIA — nunca "Importar tudo" nem "Importar só as linhas certas" (gravaria produto).
6. Estoque › Nova baixa: o "Motivo da baixa" lista 13 motivos, com "Pagamento com produto" e "Outro". Voltar sem salvar.
7. Relatórios › Movimentação de Estoque e Estoque Consolidado: o filtro "Local de estoque"; Estoque por Lote/Fornecedor:
   a coluna "Local de estoque".

**Gate externo em produção: PENDING (Maike)** — a sessão não tem acesso autenticado à produção.

### F3b — o local antes do produto e a pesquisa de produto com o saldo do local (OPERACOES-01, sem migration)

Decisão 280 (parte F3b). **Sem migration, sem variável, sem permissão nova, sem flag.** O que entra:
- uma rota nova de LEITURA, `GET /api/produtos/pesquisa/capacidades` → `{"capacidades":{"pesquisaDeProdutos":1}}`;
- três parâmetros ADITIVOS em `GET /api/produtos/pesquisa` (`pagina`, `com_saldo`, `controla_estoque`) e três chaves
  novas no fim da resposta (`pagina`, `temMais`, `filtradoPorSaldo`);
- no catálogo de itens de venda (domínio), o Local de estoque antes do produto. É esse catálogo que gera o layout do
  sistema, devolvido em `layout-efetivo` para a TOP de venda sem layout ligado;
- nas Centrais de Vendas e de Compras, o "Local de estoque" do cabeçalho (estado da tela, fora do corpo) e a pesquisa
  de produto na rota nova, com o saldo do local da linha (só com saldo nas saídas).

Nenhum corpo de POST/PUT/PATCH muda.

**Migration:** nenhuma. Nada a aplicar no banco.

**Ordem do deploy:** API e web em QUALQUER ordem (provado nos dois sentidos, abaixo). A F3b entrou na branch depois da
F8 (0042), da F5a (0043) e da F6a (0044) e não acrescenta migration: na PR #90, a ordem do deploy é a das fases com
migration, nas seções delas.

**Impacto em dados reais:** nada é gravado, reescrito nem apagado; sem backfill; nenhum layout salvo é reordenado. O
que muda na TELA de produção (02/10: 3 TOPs — pedido de compra, orçamento de venda e pedido de venda —; 2 movimentos de
estoque):
- depois do deploy da API, a TOP de venda sem layout ligado abre a grade com Local de estoque → Código → Produto →
  Estoque. A TOP 1 Orçamento, com o layout 0001 ligado (§ VENDAS-A3-1d_R1), continua na ordem do layout salvo. As duas
  TOPs de venda podem ficar com ordens diferentes até alguém reordenar o 0001 (o "Restaurar padrão" do configurador
  aplica a ordem nova; salvar grava no layout);
- depois do deploy do web, a criação da venda e da compra ganha o campo "Local de estoque" (na venda, logo depois do
  Tipo de Operação; na compra, logo depois da Empresa, na zona onde ela estiver), só quando a coluna do local está na
  grade. Ele vem vazio quando o layout não tem padrão de cadastro do local;
- depois do deploy dos DOIS (a pesquisa nova só entra com a capacidade da API nova), na venda, com local na linha e
  `stocks.view`, a pesquisa de produto vem com "Só com saldo neste local" marcado. Com 2 movimentos de estoque, aparece quase só produto que não controla estoque; desmarcar mostra
  tudo. É efeito novo LIGADO: exceção ao item (4) da decisão 240, pelo pedido de 02/10 (decisões 280 e 281). Sem
  `stocks.view`, a pesquisa mostra tudo, sem saldo, como hoje.

**Version skew** (base `622f194`; provas em arquivos próprios, fora da suíte comum):
- **Sentido 1 — web novo × API da base** (janela "web antes da API" e reversão só da API):
  - a tela pergunta `GET /api/produtos/pesquisa/capacidades`, recebe 404 de rota e usa a pesquisa de HOJE
    (`/api/resources/products/options`, Código | Descrição, `data-fonte="opcoes"`, sem coluna Estoque e sem o
    controle);
  - zero pedido a `/api/produtos/pesquisa` e nenhum parâmetro novo (a base os recusaria com 422);
  - a grade segue o layout que a base manda (Produto antes do Local);
  - o "Local de estoque" do cabeçalho existe (a base serve os locais da empresa) e preenche a linha nova; o POST leva as
    chaves de hoje e a base grava (201).

  Prova: `operacoes-01-f3b-skew-api-producao.spec.ts`, K-1a (venda) e K-1b (compra). O mundo é perguntado à base na
  hora: capacidade 404 ⇔ `pagina` 422.
- **Sentido 2 — web da base × API nova** (janela "API antes do web" e reversão só do web):
  - o web da base nunca chama a rota nova nem manda parâmetro novo, e pesquisa em `/options`;
  - o `layout-efetivo` da TOP de venda sem layout ligado chega com o Local primeiro, e o web da base desenha nessa ordem
    (o layout manda desde a A3-1);
  - o POST de hoje é aceito (201), e nenhuma resposta 404/422/5xx chega ao web da base (K-2a de
    `operacoes-01-f3b-skew-web-anterior.spec.ts`);
  - a rota, com os parâmetros de hoje, responde `itens` e `estoqueDoArmazem` primeiro, as seis chaves do item e o mesmo
    significado (sem filtro, o produto sem saldo aparece), com as três chaves novas no fim (K-2b).

**Reversão:** redeploy da API e/ou do web anteriores; nada a desfazer em banco ou configuração.
- Reverter a API = sentido 1. A ordem volta à de antes (o layout do sistema é da API), e a pesquisa volta à de hoje.
- DECLARADO: a aba aberta com o web novo leu a capacidade UMA vez, da API nova, e continua pedindo a pesquisa nova. A
  API anterior recusa (422, `pagina` desconhecido), e o painel de pesquisa de produto diz "Não foi possível carregar a
  lista." até a página ser RECARREGADA. Nada é gravado.
- Reverter o web = sentido 2.

**Roteiro do Maike** (produção; produção é operacional — decisões 240 e 247. Só leitura: nada é gravado; sempre
DESCARTAR, nunca Salvar):
1. Vendas › + Novo › a TOP de pedido de venda. Com as ferramentas do navegador abertas na aba Rede, o pedido
   `produtos/pesquisa/capacidades` responde 200 com `{"capacidades":{"pesquisaDeProdutos":1}}`.
2. Na mesma criação:
   - a grade começa por "Local de estoque" e depois "Código", "Produto", "Estoque" (se essa TOP tiver layout ligado,
     vale a ordem dele);
   - o campo "Local de estoque" vem logo depois do Tipo de Operação; o mouse sobre ele mostra a dica;
   - escolher um local → "Adicionar produto" → a linha nasce com ele;
   - clicar no Produto da linha: o painel mostra "Código | Descrição | Estoque" e "Só com saldo neste local" marcado;
   - desmarcar → aparecem também os produtos sem saldo, com "0,0000";
   - Esc fecha; Descartar.
3. Vendas › + Novo › a TOP 1 Orçamento (layout 0001 ligado): a grade fica na ordem do layout 0001, sem reordenar. O
   campo do cabeçalho só aparece se o 0001 mostra a coluna do local. Descartar.
4. Compras › + Novo › a TOP de pedido de compra:
   - "Local de estoque" vem logo depois da Empresa; escolher um local → "Adicionar produto" → a linha nasce com ele;
   - a pesquisa de produto mostra tudo, com a coluna Estoque e sem "Só com saldo neste local";
   - Descartar.
5. Vendas › o pedido de venda aberto (consulta): a grade dos itens começa por "Local de estoque", e no formulário do
   item "Local de estoque" vem antes de "Produto".
6. (Se houver usuário sem a permissão de ver estoque) a pesquisa de produto da venda mostra todos os produtos, sem
   coluna Estoque e sem o controle.

**Gate externo em produção: PENDING (Maike)** — a sessão não tem acesso autenticado à produção.

### F4 — a TOP pelo tipo de movimento e o formato 5 (OPERACOES-01, sem migration)

Decisão 281. **Sem migration, sem variável, sem permissão nova, sem rota nova.** Uma chave nova, aditiva, nas
capabilities da TOP: `formato5`, na raiz, depois de `regrasGerais`. `contractVersion`, `configuracao` (1), `restricoes`
(3) e `regrasGerais` (4) não mudam. A criação da TOP começa pelo tipo de movimento (o assistente: só os 9 tipos com
tela). As abas mostram só o que vale para o tipo. Toda TOP é LIDA no formato 5 — o 4 mais as seções de extensão das
fases seguintes, nenhuma nesta —, e salvar com mudança grava o 5. No 5 o servidor recusa (422) o que o tipo não aceita.
O editor e o histórico da TOP dizem "local de estoque".

**Migration:** nenhuma. O 5 entra sem DDL:
- o CHECK de schema da 0022 não tem teto;
- `erp.top_exige_aprovacao` (0041) trata `versaoSchema` ≥ 4 — provado sobre uma versão gravada no 5
  (`packages/db/test/top-formato5-0041.test.ts`, B5-1 e B5-2);
- a venda no 5 confirma com a marca da guarda da 0023.
A 0041 não foi editada.

**Ordem do deploy:** esta fase não impõe ordem entre API e web — os dois sentidos do skew estão provados (abaixo). Duas
condições da PR #90:
- a F2 (decisão 279) vai no MESMO deploy: a ajuda nova da Geral diz que as Centrais de Vendas e de Compras aceitam o
  documento sem item quando a TOP permite, e isso só é verdade com a F2;
- a ordem do deploy da PR é a das fases com migration (F5 a F10), nas seções delas.

**Impacto em dados reais:** nenhum registro é reescrito; sem backfill.
- As TOPs de produção continuam no formato em que foram gravadas e são LIDAS como 5 (no editor, na API e na execução,
  pelo número GRAVADO: um formato 3 nunca passa a executar regra geral por ser lido como 5). Nada é gravado até alguém
  salvar.
- Salvar uma TOP cuja configuração já cabe no tipo, sem mexer, não grava (nenhuma versão, nenhuma trilha).
- Salvar com mudança cria a versão N+1 no formato 5.
- As 3 TOPs de produção NÃO estão nesse caso (leitura de 01/10, decisão 277):
  - o pedido de compra, no formato 3, com Confirmação Automática, Documento sem itens Permitido e Alteração Permitida;
  - o orçamento e o pedido de venda, no formato 2, com Alteração Permitida.

  O tipo delas só aceita o neutro. O primeiro Salvar, mesmo sem mexer, abre o diálogo "Estas regras passam a valer" com
  o que volta ao padrão: "Confirmação: Automática → Manual", "Documento sem itens: Permitido → Proibido", "Alteração
  após confirmar: Permitida → Bloqueada". "Voltar e revisar" não grava nada. "Salvar assim mesmo" grava a N+1 no 5, no
  neutro, e nada passa a executar. É o comportamento do editor do 4 de hoje.
- Numa TOP de documento de estoque com condições de pagamento permitidas, o diálogo lista também "Condições de
  pagamento: voltam ao padrão", e a versão nova sai sem elas. Não há caso em produção.
- A tela passa a CRIAR TOP só dos 9 tipos com tela. As TOPs de outras famílias que já existam continuam editáveis.
  Produção não tem nenhuma.

**Version skew** (base `622f194`; os specs novos entram nos configs de skew pelo nome e ficam fora da suíte comum):
- **Sentido 1 — web novo × API da base** (janela "web antes da API" e reversão só da API): sem o bloco `formato5`, o web
  é o editor do 4 de hoje — seletor de família, ajuda antiga da Geral, Execução indisponível no pedido, gravação no 4
  (`top-formato5-skew-api-producao.spec.ts`, K-1 do 5, 2 casos). O web nunca manda o 5 a quem não o declarou. A base
  recusa um corpo no 5 com 422 `TIPO_OPERACAO_CONFIGURACAO_SCHEMA_NAO_SUPORTADO`, e nada é criado. O K-1 da TOP-CONFIG-08
  escolhe o mundo pela capacidade: legado → formato 3; novo → formato 4 e ajuda antiga; formato5 → formato 5 e ajuda nova.
- **Sentido 2 — web da base × API nova** (janela "API antes do web" e reversão só do web): a API declara o bloco a mais,
  que o web da base ignora. O editor da base grava o 4, e a API guarda a N+1 no 4, sem promover. Uma TOP já gravada no 5
  abre com as seções de operação BLOQUEADAS (`top-config-ilegivel`). Renomear manda o PUT sem `configuracao`, e a versão
  nova guarda o 5 inteiro. O histórico da base lista as versões; nenhum 404, 422 ou 5xx no navegador
  (`top-formato5-skew-web-anterior.spec.ts`, K-2 do 5, 3 casos). As Centrais da base leem `/regras-da-operacao` com
  `formato` 5, e o leitor delas só exige um número.
- O detector `editorDaBaseGravaFormato5` (marca `top-assistente` no fonte do commit da base) tem prova reversa do lado
  falso. O lado verdadeiro só ganha commit fixo depois que esta fase entrar na main.

**Reversão:** API e web voltam por redeploy da versão anterior, sem tocar no banco. Enquanto nenhuma TOP for gravada no
5, nada muda. Depois que uma TOP for gravada no 5, o binário anterior não a lê:
- (a) **Escrita.** A API anterior recusa QUALQUER PUT numa TOP cuja versão vigente está no 5 — renomear, ativar,
  desativar e marcar como padrão inclusive — com 422 `TIPO_OPERACAO_CONFIGURACAO_SCHEMA_NAO_SUPORTADO`
  (`622f194:apps/api/src/routes/tipos-operacao.ts:1009`). O editor anterior abre a configuração bloqueada. A TOP no 5
  fica congelada até o binário novo voltar. Só na janela de skew com a API NOVA (web anterior × API desta versão) o
  renomear funciona e preserva o 5.
- (b) **Confirmação.** O binário anterior não confirma venda, compra NEM documento de estoque cuja versão congelada está
  no 5: 409 `TIPO_OPERACAO_EXECUCAO_INDISPONIVEL`, a "configuração ilegível", fail-closed, como com formato desconhecido.
  No estoque, a mensagem termina com "O documento não foi confirmado.", e a prévia traz a recusa em `recusas`, com
  `podeConfirmar` falso (`622f194:apps/api/src/routes/estoque-confirmacao.ts:171-180`). Nada confirma sozinho
  (`confirmaAutomaticamente` → falso). A guarda da 0041 continua o fundo.
- (c) **Aprovações.** A fila anterior conta pela SQL (`erp.top_exige_aprovacao`, que trata ≥ 4) e LISTA o documento com
  TOP no 5 que exige aprovação. Aprovar e Reprovar, que perguntam ao domínio anterior, respondem 409
  `TIPO_OPERACAO_EXECUCAO_INDISPONIVEL`. É o risco "formato futuro" que a decisão 277 declarou, agora com o 5.
- (d) **Lançamento.** O documento LANÇADO no binário anterior com TOP no 5 fica sem as regras dela:
  - venda e compra: sem exigências, sem condições permitidas e sem a conferência de cliente em atraso
    (`regrasDaVersaoTop` devolve nulo para formato desconhecido, `622f194:apps/api/src/routes/vendas-regras-operacao.ts:41`,
    e `cobrarRegrasDaOperacao` não cobra nada, `:106`);
  - orçamento e pedido de venda e pedido de compra, que não se confirmam: passam sem restrição nenhuma;
  - documento de estoque: "Exigir observação" deixa de ser cobrada
    (`622f194:apps/api/src/routes/estoque-documentos.ts:289`);
  - itens vazios: recebem o 422 de hoje, mesmo com a TOP permitindo.
  É o risco que a TOP-CONFIG-08 declarou para o 4, agora para toda TOP salva no 5.
- Documento confirmado antes da reversão continua confirmado, com os efeitos que deu.
- **Por isso:** gravar a primeira TOP no 5 em produção é o que torna a reversão cara. Faça-o só depois de conferir o
  deploy (roteiro abaixo), e é decisão do Maike.

**Roteiro do Maike em produção (depois do deploy; produção é operacional — decisões 240 e 247):** os passos 1 a 4 são só
leitura (nada é gravado). O passo 5 grava, e só com a decisão dele.
1. Configurações › Operações › Tipos de Operação › Novo — o passo 1, "Passo 1 de 2: escolha o tipo de movimento.
   Depois, as abas mostram só o que vale para ele.":
   - Vendas (Orçamento, Pedido, Venda), Compras (Pedido, Compra), Movimentação interna (Entrada, Saída/baixa,
     Transferência, Ajuste);
   - Módulos NÃO aparecem; Financeiro (Conta a pagar, Conta a receber, Movimento bancário) aparece desde a F9a
     (decisão 286).
2. Escolher Entrada:
   - "Movimento" só leitura, com "Trocar";
   - as abas Identificação, Geral, Estoque e Aprovação;
   - na Geral, só "Exigir observação".
   "Trocar" → Venda:
   - as abas Identificação, Geral, Próximas operações, Estoque, Padrões financeiros (desde a F9a), Financeiro, Fiscal,
     Aprovação e Execução;
   - na Geral, "Exigir cliente", e a ajuda termina em "Documento sem itens: quando esta operação permite, a venda e a
     compra podem ser salvas sem item nas Centrais de Vendas e de Compras (o recebimento de um pedido sempre pede
     item). As exigências de preenchimento são cobradas no lançamento.".
   Fechar sem salvar.
3. Abrir a TOP de pedido de compra:
   - as abas Identificação, Geral, Próximas operações, Estoque, Fluxo de compra, Padrões financeiros, Financeiro,
     Fiscal e Aprovação, sem Execução (Fluxo de compra e Aprovação desde a F6a, decisão 283; Padrões financeiros desde
     a F9b, decisão 286);
   - na Geral, "Exigir fornecedor";
   - na Estoque, "Exigir local de estoque".
   Clicar Salvar SEM mexer → o diálogo "Estas regras passam a valer" lista o que volta ao padrão (se ela ainda estiver
   como em 01/10). Clicar "Voltar e revisar" e fechar sem salvar. Fazer o mesmo no orçamento e no pedido de venda
   ("Alteração após confirmar: Permitida → Bloqueada", se ainda Permitida).
4. Em cada TOP, Histórico: as versões continuam com o formato em que foram gravadas ("Formato da configuração: 2" ou
   "3").
5. (Decisão do Maike; grava; ver Reversão.) "Salvar assim mesmo" numa delas:
   - versão nova no formato 5, no neutro, e o histórico diz "Formato da configuração: 5";
   - nada passa a executar: orçamento e pedidos só aceitam o neutro.

**Gate externo em produção: PENDING (Maike)** — a sessão não tem acesso autenticado à produção.

### F5a — movimentação interna no documento de estoque (OPERACOES-01, migration 0043)

Decisão 282, parte F5a. A F5b — a Central de Estoque no motor — tem a subseção dela (§ F5b, abaixo), no mesmo deploy.
- **Migration:** uma, `0043_movimentacao_interna_estoque.sql` — pre-deploy; trava (2026,77); `lock_timeout` 2 s;
  pré-condições nomeadas `OPERACOES-01 F5: …`, a primeira é "já aplicada"; pós-condições só de catálogo; aditiva; sem
  backfill.
- **Sem variável.** Três recursos de permissão novos (12 chaves).
- **Rotas:** uma nova, `POST /api/estoque/requisicoes/:id/encerrar-saldo`; as das três espécies novas saem do laço de
  hoje.
- **Capacidade:** uma chave nova e aditiva em `capacidades` das sete `GET /api/estoque/<segmento>/operation-types`:
  `movimentacaoInterna: 1`.
- **A tela de estoque NÃO muda nesta parte**, nem o menu: as entradas das espécies novas em `apps/web/nav.registry.mjs`
  vêm com a F5b. A F5b muda as duas (§ F5b).
- **Condição da PR #90:** ela não vai à produção sem a F5b (decisão 282, M-4) — cumprida: a F5b está na mesma PR.

Contrato em `docs/OPERACOES-CONTRACT.md` §2 (Destino e Fluxo) e §3 (F5a).

**Migration — o que faz** (nenhuma linha existente é reescrita):
- `erp.documentos_estoque`:
  - 12 colunas anuláveis:
    - `origem_documento_id`;
    - o destino: `centro_custo_id`, `equipamento_id`, `ordem_servico_id`, `lote_animais_id`, `area_id`, `safra_id`;
    - `motivo_saida`, `justificativa`;
    - `saldo_encerrado_em`, `saldo_encerrado_por`, `saldo_encerrado_motivo`;
  - 7 FKs compostas `(coluna, organization_id) → (id, organization_id)`, sem cascata, e a FK de trilha para `erp.users`;
  - o CHECK de espécie com as sete;
  - os CHECKs novos:
    - de origem;
    - de apropriação (o destino só na requisição, no consumo, na saída e na devolução de consumo);
    - de motivo e justificativa (os 13, em par, só na saída);
    - de saldo encerrado;
  - 2 índices parciais;
- `erp.documentos_estoque_itens`:
  - `origem_item_id`, com FK composta para o próprio item;
  - o CHECK de espécie com as sete, um CHECK de origem e o do item da requisição (sem lote, validade e custo);
  - o CHECK `chk_documentos_estoque_itens_custo_entrada` SAI: a entrada pode vir sem custo;
  - 1 índice parcial;
- `erp.stock_movements`: `equipamento_id`, `ordem_servico_id`, `lote_animais_id` e `area_id`, com FK composta;
- chaves `(id, organization_id)` novas, alvo das FKs, em `erp.harvests`, `erp.equipments`, `erp.service_orders`,
  `erp.batches`, `erp.areas` e `erp.documentos_estoque_itens`;
- funções por `create or replace`, com a mesma assinatura, o mesmo dono, a mesma ACL e os mesmos atributos (a
  transição passa a SECURITY DEFINER):
  - `documentos_estoque_conferir`: família por espécie, origem, destino herdado, referências do destino e encerramento
    do saldo;
  - `documentos_estoque_transicao`: a requisição com consumo vivo e o consumo com devolução viva não se cancelam;
  - a reserva da 0035 — núcleo, porta, guarda e flag `control_stock` —, com a parte C;
  - só o TEXTO de `apply_stock_movement` (0003), `products_controle_lote` (0029) e
    `documentos_compra_itens_documento_aberto` (0036);
- função e gatilho novos: `erp.documentos_estoque_item_origem_guarda()` e `trg_documentos_estoque_itens_origem_guarda`
  (EXECUTE só do dono);
- `erp.layouts_documento`: o CHECK de família aceita as cinco de hoje e as sete de estoque (preparação da F5b; é deste
  CHECK que a 0044 parte).

**Pré-condições.** A migration recusa sem aplicar nada, com uma mensagem `OPERACOES-01 F5: …` que nomeia o que falta:
- 2.0 já aplicada (`erp.documentos_estoque.origem_documento_id` ou a função nova já existe);
- 2.1 quem aplica não atravessa RLS (precisa ser superusuário ou `BYPASSRLS`), ou o `erp_app` não existe;
- 2.2 a 0040, a 0041 ou a 0035 não estão aplicadas (tabelas e funções);
- **2.3 a definição VIGENTE de uma das nove funções substituídas não é a da migration que a criou.** A conferência é
  pelo md5 do corpo: um hotfix feito fora do repositório seria apagado em silêncio pelo `create or replace`, e por isso
  um humano decide;
- 2.4 os CHECKs refeitos são diferentes dos esperados: as quatro espécies da 0040 no cabeçalho e no item, o CHECK de
  custo da entrada, as cinco famílias da 0038 no layout;
- 2.5 os gatilhos das duas tabelas são diferentes dos de hoje;
- 2.6 as chaves alvo não existem, ou as novas já existem;
- 2.7 as colunas lidas não existem, ou as novas já existem;
- 2.8 o módulo de escopo `estoque` não existe. **Conferido em produção em 02/10** (leitura do Maike): os módulos de
  escopo de empresa em produção são 11 (`compras`, `confinamento`, `documentos`, `estoque`, `financeiro`, `fiscal`,
  `frota_ativos`, `ordens_servico`, `pecuaria`, `pessoas_rh`, `vendas`) — `estoque` entre eles: a 2.8 passa.
Em erro, publique o nome do papel, nunca a conexão.

**Travas:**
- `ADD COLUMN` e `ADD CONSTRAINT … UNIQUE` pegam ACCESS EXCLUSIVE em `erp.harvests`, `erp.equipments`,
  `erp.service_orders`, `erp.batches`, `erp.areas`, `erp.documentos_estoque`, `erp.documentos_estoque_itens`,
  `erp.stock_movements` e `erp.layouts_documento`. A trava é curta: só catálogo, sem regravar a tabela; o índice único
  lê a tabela uma vez.
- As FKs pegam SHARE ROW EXCLUSIVE nas tabelas referenciadas: `erp.cost_centers`, `erp.users` e as acima.
- `erp.stock_movements` recebe escrita de toda confirmação de venda, compra, OS e estoque. Se uma transação longa
  segurar uma dessas tabelas, a 0043 desiste em 2 s sem aplicar nada, e o deploy é refeito (seguro).
- O runner aplica cada migration na sua própria transação (`packages/db/src/migrate.ts:22-25`). Se a 0043 desistir
  depois de a 0042 entrar, o banco fica com a 0042 e a API anterior continua no ar (a janela 1 da F8).

**Ordem: banco (0043) → API → web.** Na PR #90, as migrations entram na ordem do número: 0042 (F8) → 0043 → 0044 (F6a).
- **A 0044 depende da 0043:** a pré-condição 2.9 dela exige que o CHECK de família do layout já aceite as cinco famílias
  da 0038 e as sete de estoque desta, e recusa sem aplicar nada se a 0043 não estiver aplicada (§ F6a, abaixo).
- **A API desta fase EXIGE a 0043.** O razão grava as quatro colunas novas em TODO movimento
  (`apps/api/src/services/stock-core.ts:169-176`). Sem elas, toda confirmação que move estoque — venda, compra, OS,
  manejo, documento de estoque — e toda leitura de documento de estoque dariam 500 (42703). O pre-deploy garante a
  ordem.
- O menu (`apps/web/nav.registry.mjs`) não muda nesta parte.

Janelas:
1. **API anterior × banco novo** (entre o pre-deploy e a API nova; também a reversão só da API):
   - o corpo dela continua aceito: entrada com custo, saída sem motivo, nenhuma origem, nenhum destino;
   - os INSERTs dela deixam as colunas novas nulas;
   - a lista dela filtra as quatro espécies de hoje;
   - as mensagens dos gatilhos mudam só o texto ("local de estoque"); os códigos não mudam, nem os status HTTP;
   - sem requisição confirmada, a reserva é a de hoje.
2. **Web anterior × API nova** (janela "API antes do web"; também a reversão só do web). Prova:
   `apps/web/e2e/f5-estoque-skew-web-anterior.spec.ts`, 5 casos, só no sentido 2 (a medida é o web da base):
   - o web da base lança e confirma entrada (com custo), saída, transferência e ajuste pela Central de Estoque dele,
     exatamente como hoje (K2-a, K2-b): corpo de sempre, respostas com as mesmas chaves, saldo certo no servidor,
     nenhuma resposta 404, 422 ou 5xx;
   - com uma requisição confirmada no local de estoque, a lista de Movimentações e o Saldo da base abrem, e o Saldo
     mostra o reservado (K2-c);
   - o "Ajustar estoque" do Saldo da base — a correção antiga — passa a nascer na empresa da linha, pelo `empresa_id`
     novo (antes ia vazio, e caía na empresa padrão), e a correção vale (K2-d);
   - a fila de Aprovações de estoque da base lista uma requisição pendente SEM ações; a entrada pendente continua com
     as dela (K2-e).
3. **Web novo × API anterior** (janela "web antes da API"; também a reversão só da API). Tudo como hoje:
   - a Central de Estoque desta parte era a de antes; com a F5b ela lê `movimentacaoInterna` e, sem a chave, oferece as
     quatro espécies com o corpo de hoje (§ F5b, sentido 1);
   - o editor da TOP sem o bloco `formato5` é o do 4, sem as abas de extensão;
   - o Saldo sem `empresa_id` cai na empresa padrão, como hoje.

   Não há spec novo. A evidência está em `estoque-01-skew-api-producao.spec.ts` (1/1) e em
   `top-formato5-skew-api-producao.spec.ts` (2/2): a premissa do K-1 do 5 passou a ser "o que o 5 tem a mais que o 4
   são exatamente as `SECOES_EXTENSAO_V5`". A tela nova e o sentido 1 dela estão na § F5b
   (`f5b-estoque-skew-api-producao.spec.ts`).

Os dois sentidos rodam no job `skew` do CI, contra os binários reais da base (`622f194`).

**Impacto em dados reais** (decisão 240: P1 recente, efeito novo desligado, sem sandbox; dado de produção nunca é
apagado — decisão 247): nenhuma linha muda; sem backfill.
- As colunas novas nascem nulas. Os CHECKs refeitos só ACEITAM mais. Os novos valem para toda linha existente: as
  colunas deles estão nulas, e as espécies de hoje passam.
- Seis índices únicos `(id, organization_id)` sobre ids que já são únicos. As FKs são validadas sobre colunas todas
  nulas (leitura).
- O pre-deploy (`seedPermissions`, `apps/api/src/migrate.ts:17`) insere 12 chaves novas no catálogo de permissões:
  `requisicoes_estoque`, `consumos_estoque` e `devolucoes_consumo_estoque`, cada uma com view, create, edit e approve. Ele
  as concede aos perfis "Administrador" de sistema; os outros perfis não ganham nada.
- Produção (02/10): zero requisições, baixas, OS e manejos; 2 movimentos de estoque; 3 TOPs, nenhuma de estoque. Por
  isso:
  - a reserva não muda (não há requisição);
  - a OS e o manejo gravam o destino só nos movimentos novos;
  - "Saídas x Centro de Resultado" só muda se um dos 2 movimentos for uma saída estornada (leitura no passo 5).
- As 3 TOPs de produção são lidas como antes. Se alguém salvar uma delas no formato 5 depois desta fase, o JSON da
  versão nova leva as seções de extensão no neutro (`destino` e `fluxo` desta parte; `fluxoCompra` e
  `divergenciaPedido` da F6a), e nada passa a valer.
- O que muda para fora do sistema:
  - o editor da TOP de saída ganha a aba Destino;
  - Perfis e Permissões ganha os três recursos;
  - "Saídas x Centro de Resultado" deixa de somar a saída cancelada;
  - a mensagem de saldo insuficiente do razão diz "local de estoque".

**Reversão:** API e web voltam por redeploy da versão anterior, e o banco fica (decisão 247: coluna não se apaga;
desligar um gatilho ou voltar um CHECK só com migration nova, por decisão humana).
- Reverter só o web é a janela 2; reverter só a API é a janela 1.
- Enquanto ninguém lançar requisição, consumo, devolução de consumo ou destino, a reversão não deixa resto. As 12
  chaves de permissão ficam no catálogo.
- Depois disso:
  - **requisição CONFIRMADA (e consumo aberto ligado):** a reserva CONTINUA valendo no banco, porque a guarda é do
    banco. A API anterior não lista, não atende, não encerra e não cancela essas espécies (as rotas dela não as
    conhecem). Uma saída que invada a reserva recebe 409 `INSUFFICIENT_STOCK … reservado para pedidos`. A correção é
    voltar a API nova e encerrar o saldo ou cancelar;
  - **saída com destino cancelada pela API anterior:** o estorno sai sem o destino e sem a cultura, porque o
    `reverseStock` anterior não os copia. O líquido por destino deixa de fechar só naquele documento;
  - **TOP gravada no 5 com as seções:** vale o que a F4 declarou para o 5 (a TOP congela na API anterior).
- Por isso: só lance espécie nova e só ligue Destino ou Fluxo em produção depois de conferir o deploy (roteiro abaixo),
  e com a F5b no ar.

**Roteiro do Maike em produção** (produção é operacional — decisões 240 e 247). Os passos 0 a 6 são só leitura: nada
é gravado. A F5b entra no mesmo deploy: a Central nova tem o roteiro da § F5b, e estes passos conferem o que é da
F5a.
0. Antes do deploy (SQL só de leitura): confira que as nove funções têm a definição esperada, comparando
   `select p.oid::regprocedure, md5(p.prosrc) from pg_proc p where p.oid = any (array['erp.apply_stock_movement()'::regprocedure, …])`
   com os hashes literais da 0043 (`supabase/migrations/0043_movimentacao_interna_estoque.sql:131-157`). A
   pré-condição 2.3 refaz a pergunta na hora de aplicar e recusa com o nome da função.
1. Depois do deploy (leitura): o ledger de migrations tem a 0043 depois da 0042 (e a 0044 depois dela).
2. Configurações › Usuários › Perfis e Permissões › Administrador: em "Operacional > Estoque" aparecem "Requisições de
   Material", "Consumos de Estoque" e "Devoluções de Consumo", com Ver, Criar, Editar e Aprovar marcados. Feche sem
   salvar.
3. Configurações › Operações › Tipos de Operação › Novo:
   - em "Movimentação interna" aparecem Requisição, Consumo, Devolução de consumo, Entrada, Saída/baixa, Transferência e
     Ajuste (as três primeiras com tela desde a F5b, no mesmo deploy);
   - escolha Saída/baixa:
     - abas Identificação, Geral, Estoque, Destino e Aprovação;
     - na aba Destino: Centro de resultado, Máquina/equipamento, Ordem de serviço, Lote de animais, Área/talhão e Safra,
       todos "Não usada", com a ajuda "O destino diz para onde vai o que sai do estoque: …";
   - clique em "Trocar" e escolha Entrada: sem Destino e sem Fluxo;
   - feche sem salvar.
4. Abra a TOP de pedido de venda:
   - as abas são as de antes, sem Destino e sem Fluxo;
   - no Histórico, as versões estão no formato em que foram gravadas, sem os blocos Destino e Fluxo;
   - feche.
5. Relatórios › "Saídas x Centro de Resultado", no período dos 2 movimentos: o relatório abre; se um deles for uma
   saída cancelada, ela não aparece.
6. Estoque › Saldo:
   - Reservado e Disponível estão como antes (não há requisição);
   - em "Ajustar estoque" numa linha, o diálogo abre na empresa do local de estoque da linha;
   - feche sem salvar.
7. (Decisão do Maike; grava.) Ligar dimensões do Destino ou o Fluxo numa TOP. Com a F5b, a Central de Estoque mostra a
   aba Destino e pede a dimensão "Obrigatória" antes de salvar.

**Decisões pendentes do Maike** (registradas na decisão 282, não tomadas aqui): o par motivo/justificativa da saída
passa a obrigatório no servidor só na primeira PR depois que o web anterior sair de produção e da janela de reversão
(I-1); e as perguntas antes da F11 — saldo inicial, entrada sem NF, requisição antiga, o neutro do Destino, a devolução
antiga, `reason_note` e os relatórios que só leem as tabelas antigas (I-2 e I-3). O Maike decidiu em 03/10: § F5b,
"Decisões do Maike".

**Gate externo em produção: PENDING (Maike)** — a sessão não tem acesso autenticado à produção.

### F5b — a Central de Estoque no motor da Central (OPERACOES-01, sem migration)

Decisão 282, parte F5b. **Sem migration, sem variável, sem permissão nova, sem flag.** O que entra:
- três rotas novas de LEITURA no estoque, com a porta `<recurso>.create`:
  - `GET /api/estoque/<segmento>/regras-da-operacao?tipo_operacao_id=` (as sete espécies);
  - `GET /api/estoque/<segmento>/layout-efetivo?tipo_operacao_id=` (as sete);
  - `GET /api/estoque/<segmento>/destino/opcoes?dimensao=&empresa_id=&busca=&limite=` (só saída, requisição e consumo);
- duas chaves aditivas no fim das `capacidades` das sete `GET /api/estoque/<segmento>/operation-types`:
  `layoutDocumento: 1` e `regrasDaOperacao: 1`. O bloco fica `{ documentoEstoque: 1, movimentacaoInterna: 1,
  layoutDocumento: 1, regrasDaOperacao: 1 }`, e `contractVersion` continua 1;
- o admin de layouts (`/api/admin/layouts-documento`) passa a aceitar as sete famílias de estoque, pelo domínio;
- no web: a Central de Estoque no motor, as sete espécies com a capacidade, o destino, a origem, o layout por TOP no
  estoque, o "Ajustar estoque" do Saldo na Central de ajuste e os botões das três espécies novas na fila de Aprovações;
- no catálogo da TOP (domínio), a requisição, o consumo e a devolução de consumo com tela.

Nenhum corpo de POST/PUT/PATCH muda. Contrato em `docs/OPERACOES-CONTRACT.md` §3 (F5b).

**Migration:** nenhuma. A F5b usa o banco da 0043 (F5a) e o CHECK de família do layout com as sete de estoque (0043, refeito
pela 0044).

**Ordem do deploy:** a da PR #90 (as fases com migration, nas seções delas). A F5b vai no MESMO deploy da F5a. Ela cumpre a
condição da § F5a: a #90 não vai à produção sem a F5b. A API desta fase exige a 0043, e o pre-deploy garante isso. Entre si,
API e web vão em QUALQUER ordem: os dois sentidos estão provados abaixo.

**Menu:** `apps/web/nav.registry.mjs` recebe, no merge da fase e no MESMO deploy do web, as permissões das três espécies
novas na aba Movimentações, na criação, na consulta e na fila de Aprovações › Estoque (decisão 282): quem só tem as
permissões delas abre a Central pelo menu e pelo link. As telas antigas continuam no menu (a F11 decide; decisão 288).

**Impacto em dados reais:** nada é gravado no deploy; nenhuma linha é reescrita; sem backfill; nenhuma permissão nova
(o `seedPermissions` não muda). O que muda na TELA de produção (02/10: 3 TOPs — pedido de compra, orçamento de venda e
pedido de venda —, NENHUMA de estoque; 2 movimentos de estoque; nenhuma requisição):
- Configurações › Tipos de Operação › Novo: "Movimentação interna" oferece também Requisição, Consumo e Devolução de
  consumo, antes de Entrada.
- Configurações › Layouts de documento: o "Novo" oferece os sete movimentos de estoque, depois de vendas e compras.
- Estoque › Movimentações: os chips das sete espécies, mais a coluna e o filtro "Atendimento". Sem TOP de estoque, o
  "+ Novo" não tem operação de estoque para lançar.
- Estoque › Saldo: o "Ajustar estoque" continua no diálogo de sempre. Ele só passa à Central de ajuste quando existir
  uma TOP de ajuste ativa.
- A Central de Estoque (quando houver TOP de estoque) tem o desenho novo. Efeito novo LIGADO, pelo pedido de 02/10
  (exceção declarada ao item (4) da decisão 240): toda saída exige Motivo e Justificativa na tela; o servidor não
  exige (I-1, fora desta PR; abaixo). Também mudam: a entrada aceita o custo vazio (vale o custo médio, com o aviso na
  tela); a linha nova nasce em branco; o número se digita com ponto (a vírgula deixa de valer).
- Aprovações › Estoque: Aprovar e Reprovar também na requisição, no consumo e na devolução de consumo (produção: nenhum).

**Version skew** (base `622f194`; provas em arquivos próprios, fora da suíte comum; o mundo é perguntado à base na hora):
- **Sentido 1 — web novo × API da base** (janela "web antes da API" e reversão só da API). Sem `movimentacaoInterna`,
  `layoutDocumento` e `regrasDaOperacao`:
  - a lista oferece as QUATRO espécies de hoje, e a Central aberta pelo "+ Novo" não pede nenhuma rota nova (K1-a);
  - a entrada exige o custo (pendência, zero POST); com o custo, 201. O corpo de cada POST tem EXATAMENTE as chaves de
    hoje, no cabeçalho e no item, porque a base é `.strict()` e recusaria chave nova com 422. A saída não tem aba
    Destino nem Motivo, na criação e na consulta. A prévia da base é lida como hoje, e a confirmação vale (K1-b);
  - o "Ajustar estoque" do Saldo abre o diálogo de sempre, e a correção vale (K1-c);
  - rodados de novo, sem mudança: `estoque-01-skew-api-producao.spec.ts` (1/1) e
    `top-config-08-skew-api-producao.spec.ts -g "K-1"` (4/4).
  Prova: `apps/web/e2e/f5b-estoque-skew-api-producao.spec.ts`. Declarado: o configurador de layouts lista as famílias de
  estoque, e a base recusa gravar o layout delas (422) — admin, transitório, nada gravado.
- **Sentido 2 — web da base × API nova** (janela "API antes do web" e reversão só do web):
  - o `operation-types` declara as quatro chaves, as duas da F5b no fim, e o web da base as ignora;
  - nenhuma rota que a base usa muda;
  - a Central da base (a grade própria, com os testids `estoque-item-*`) lança uma entrada com o corpo de hoje (201) e
    confirma pela prévia de hoje, e o saldo muda no servidor;
  - nenhuma requisição morre no navegador, e nenhuma resposta 404, 422 ou 5xx chega ao web (K-2).
  Prova: `apps/web/e2e/f5b-estoque-skew-web-anterior.spec.ts`. O resto do sentido 2 é o da F5a
  (`f5-estoque-skew-web-anterior.spec.ts`, 5/5, rodado de novo); `estoque-01-skew-web-anterior.spec.ts` 1/1.

**Reversão:** redeploy do web e/ou da API anteriores; nada a desfazer em banco ou configuração.
- Reverter só o web = sentido 2. Reverter só a API = sentido 1. A volta da API inteira da #90 segue a § F5a.
- Os layouts de estoque criados ficam no cadastro: a API e o web anteriores não os usam. A base lista todos os layouts
  sem filtro de família, então eles podem aparecer na lista do configurador anterior, sem uso (não provado).
- DECLARADO: a aba aberta com o web novo leu as capacidades UMA vez, ao montar o formulário, da API nova. Depois de
  reverter só a API, essa aba pode pedir rota que a API anterior não tem (o Salvar trava, com "As regras da operação
  não carregaram") ou mandar chave que ela recusa (422). Nada é gravado; a página precisa ser RECARREGADA.

**Roteiro do Maike em produção** (produção é operacional — decisões 240 e 247). Os passos 1 a 6 são só leitura: nada é
gravado; sempre feche sem salvar ou Descarte.
1. Configurações › Operações › Tipos de Operação › Novo:
   - "Movimentação interna" oferece Requisição, Consumo, Devolução de consumo, Entrada, Saída/baixa, Transferência e
     Ajuste, nesta ordem;
   - escolha Consumo: abas Identificação, Geral, Estoque, Destino, Fluxo e Aprovação;
   - feche sem salvar.
2. Configurações › Operações › Layouts de documento › Novo:
   - no passo 1, o Movimento oferece, depois de vendas e compras, os sete de estoque, de "Entrada de estoque" a
     "Devolução de consumo";
   - cancele no passo 1: concluir o assistente CRIA o layout (a prévia de um layout de estoque — a Operação primeiro,
     depois Empresa, Data do documento, Local de estoque e Observação — fica para quando o Maike criar um, no passo 7).
3. Com as ferramentas do navegador abertas na aba Rede, Estoque › Movimentações:
   - o pedido `estoque/entradas/operation-types` responde 200 com `capacidades` `{"documentoEstoque":1,
     "movimentacaoInterna":1,"layoutDocumento":1,"regrasDaOperacao":1}`;
   - os chips vão de Entrada a Devolução de consumo, e há a coluna "Atendimento";
   - o "+ Novo" não tem operação de estoque para lançar (não há TOP de estoque);
   - feche.
4. Estoque › Saldo: o "Ajustar estoque" de uma linha abre o diálogo de sempre (não há TOP de ajuste). Feche sem salvar.
5. Aprovações › Estoque: a fila abre (vazia).
6. Vendas: abra o pedido de venda aberto (consulta). A grade, o formulário do item e o rodapé com o subtotal estão como
   antes (o motor mudou só por acréscimo). Feche.
7. (Decisão do Maike; GRAVA. Dado de produção nunca se apaga — decisão 247: o que for lançado só se cancela.) Para usar
   a movimentação interna:
   - criar as TOPs no formato 5 (requisição, consumo e, se quiser destino na baixa, a saída), ligando o Destino e o Fluxo
     que quiser;
   - lançar e confirmar uma requisição: o Saldo mostra o reservado;
   - "Atender requisição" em parte → confirmar → "Encerrar saldo" com motivo;
   - "Devolver itens" no consumo → confirmar;
   - conferir o Saldo e o relatório "Saídas x Centro de Resultado".

**Decisões do Maike (03/10; registradas na 282):**
- a F5 está FECHADA: a F5a e a F5b estão na PR #90 e vão no mesmo deploy;
- I-1 — o par motivo/justificativa da saída obrigatório no SERVIDOR — NÃO entra nesta PR. Fica fora, com dono: a 1ª PR
  depois desta em produção. O web anterior precisa sair de produção antes: com ele no ar (no deploy e na reversão só do
  web), o servidor recusaria a saída que o web anterior manda sem o par;
- I-2 e I-3 — o que a F11 precisa para tirar a tela antiga de estoque do menu — a F11 decide e declara (decisão 288).

Item novo para a F11/F12: a aprovação na CONSULTA do estoque (`GET /api/aprovacoes/estoque/<segmento>/:id` +
`AprovacaoDoDocumento`).

**Gate externo em produção: PENDING (Maike)** — a sessão não tem acesso autenticado à produção.

### F8 — Central Financeira (OPERACOES-01, migration 0042)

Decisão 285. **Uma migration: `0042_central_financeira.sql`** (pre-deploy; trava (2026,76); `lock_timeout` 2 s;
pré-condições nomeadas `OPERACOES-01 F8: …`, a primeira é "já aplicada"; pós-condições só de catálogo; aditiva; sem
backfill). Sem variável, sem permissão nova. Rotas novas no prefixo próprio `/api/financeiro/*` e a capacidade
`GET /api/financeiro/capacidades` → `{ "centralFinanceira": 1 }`: o web novo só mostra a Central quando a API a declara;
sem ela (404 de rota, erro ou outra forma), é o Financeiro de hoje, idêntico. Contrato em `docs/OPERACOES-CONTRACT.md` §6.

**Migration — o que faz** (nenhuma linha existente é reescrita):
- colunas novas, todas anuláveis e sem default: `bank_accounts.data_saldo_inicial`; `financial_titles.data_competencia`,
  `.conta_prevista_id`, `.cancel_reason`, `.cancelled_at`, `.cancelled_by`; `title_settlements.lote_id`, `.tarifa`,
  `.adiantamento_id`, `.natureza_desconto_id`; `bank_movements.tipo_transferencia`, `.title_settlement_id`,
  `.componente_baixa`, `.lote_baixa_id`, `.cancel_reason`, `.cancelled_at`, `.cancelled_by`;
  `financial_categories.grupo_dre` — com as chaves `(id, organization_id)` que as FKs compostas pedem, 13 FKs compostas
  sem ação de exclusão, 2 FKs de trilha para `erp.users`, 5 CHECKs e 6 índices parciais;
- tabela nova `erp.financeiro_naturezas_padrao` (configuração da organização, vazia, sem empresa: RLS forçada com
  `tenant_isolation`, auditoria, `updated_at` por gatilho; o `erp_app` lê, insere e altera, sem DELETE nem TRUNCATE; não
  entra em `scripts/company-rls-modules.json`);
- `erp.refresh_title_status` com a soma `sum(amount)` (era `sum(amount + discount)`): o desconto da baixa passa a contar
  UMA vez. Mesma assinatura, linguagem e privilégios; não recalcula título algum — só vale na próxima baixa ou estorno;
- gatilho `trg_bm_confirmado_imutavel`: movimento bancário confirmado não muda data, valor, juros, conta, tipo,
  categoria, destino, empresa nem rótulo da transferência (`CONFLICT`, 409 em todo binário);
- gatilho `trg_ts_credito_conferir`: o uso do crédito de um adiantamento confere adiantamento, parceiro, empresa,
  direção e crédito;
- porta `erp.extrato_conta_organizacao(uuid[], date, date)`, SECURITY DEFINER estreita no molde da
  `erp.movimentos_conta_organizacao` (0015) — EXECUTE só do `erp_app`;
- o `erp_app` perde DELETE e TRUNCATE em `financial_titles`, `title_settlements`, `bank_movements` e
  `bank_movement_apportionments`, e UPDATE em `bank_movement_apportionments`.

**Pré-condições (a migration recusa sem aplicar nada, com a mensagem `OPERACOES-01 F8: …` que nomeia o que falta):**
P1 já aplicada (a tabela nova, `title_settlements.lote_id` ou `bank_movements.tipo_transferencia` já existe); P2 papel
`erp_app` ausente; P3 quem aplica não atravessa RLS (precisa ser superusuário ou `BYPASSRLS`: é o dono da função
SECURITY DEFINER e lê o acervo); P4 alguma das 55 colunas que a migration lê ausente; P5 a chave
`uq_financial_categories_tenant` ausente; P6 alguma função chamada ausente (`tenant_visible`, `audit_row`,
`current_org_id`, `effective_user_id`, `has_permission`, `refresh_title_status`, `title_settlement_changed`,
`set_updated_at`); P7 os gatilhos do ledger diferentes dos de hoje (`title_settlements`: `trg_settlement_changed`;
`bank_movements`: `trg_bm_audit`; `financial_titles`: `trg_ft_audit`, `trg_ft_updated`); **P8 há baixa confirmada com
desconto** (até 20 ids no diagnóstico) — a soma muda de sentido e uma baixa assim passaria a quitar menos; um humano
decide. Os ALTER TABLE pedem trava curta em `bank_accounts`, `financial_titles`, `title_settlements`, `bank_movements`,
`financial_categories` e `users`: com uma transação longa segurando uma delas, a migration desiste em 2 s sem aplicar
nada, e o deploy é refeito (seguro). Em erro, publique o nome do papel, nunca a conexão.

**Ordem: banco (0042) → API → web.** Na PR #90, a ordem do deploy é a das fases com migration (0042 a 0048, nas seções
delas); a 0042 é a primeira. O menu (`apps/web/nav.registry.mjs`) vai no MESMO deploy do web desta fase. Janelas:
1. **API anterior × banco novo:** os INSERTs dela ignoram as colunas novas e nunca gravam `adiantamento_id` (o gatilho
   do crédito não dispara para ela); ela não apaga o ledger nem chama a função do extrato. Declarado: (a) a baixa COM
   desconto feita por ela quita o título só pelo `amount` e deixa o valor do desconto em aberto (ela confere
   `amount + discount ≤ saldo`, mais estrita: nunca estoura); (b) o PUT de movimento que troca o rateio recebe 403 (ela
   apaga `bank_movement_apportionments`, e o `erp_app` não apaga mais); (c) o PUT que muda valor, data ou conta de
   movimento confirmado recebe 409 do gatilho. A web anterior não tem tela de PUT de movimento. Produção não tem baixa
   nem movimento (02/10).
2. **Web anterior × API nova** (janela "API antes do web" e reversão só do web): as rotas `/api/financial/*` recebem os
   corpos de hoje e devolvem as chaves de hoje, só com acréscimos. Mudam, de propósito (os defeitos): título gerado por
   documento não se edita (valor, parceiro, rateio…) nem se cancela pelo financeiro (409); movimento confirmado não
   muda valor nem data (409); "gera obrigação" sem empresa → 422; conta OFX inválida → 422; transferência com destino
   inválido → 422; a baixa com desconto quita o `amount` e movimenta valor − desconto — o "Valor líquido do movimento"
   que a tela antiga mostra; adiantamento pelo tipo de título aparece como "Adiantamento/Pendente"; a contagem de anexos
   passa a contar; baixa em lote "Único" com títulos de 2 ou mais empresas → 422, título fora do escopo no lote é pulado
   (antes, 404 do lote inteiro), id repetido → 422; baixa cruzada com desconto: o contrário abate valor − desconto.
   Provado pelo K-2 (`central-financeira-skew-web-anterior.spec.ts`, 3 casos: a lista antiga com as chaves e os tipos
   de hoje; a baixa antiga com Desconto 10 → "Baixada" e o movimento de saldo − 10; lote, cancelamento em lote e OFX
   antigos com os corpos e as chaves de hoje).
3. **Web nova × API anterior** (janela "web antes da API" e reversão só da API): a capacidade dá 404, e a página é o
   Financeiro de hoje — mesmas abas, formulário com rateio por %, diálogo de baixa sem Tarifa, corpo do `/settle` sem
   `tarifa`, `excedente` nem `adiantamento_id` — e nenhum outro pedido sai para `/api/financeiro/*` (K-1,
   `central-financeira-skew-api-producao.spec.ts`, 3 casos, contando os pedidos no fio). Diferenças inócuas: o
   cancelamento de movimento manda o motivo digitado (a API anterior o descarta, como descartava o fixo), e o link da
   baixa no detalhe do movimento segue o de hoje (a API anterior não manda `direction`). Declarado: o menu do web novo
   mostra as áreas novas (Títulos, Bancos e caixa…), que a tela de hoje não tem — o link cai na aba padrão (Contas) —,
   e não mostra Contas nem Caixa e Bancos, que a tela de hoje continua mostrando como abas.

Os dois sentidos rodam no job `skew` do CI, contra os binários reais da base (`622f194`), e os specs escolhem o ramo pelo
mundo medido na hora (K-1: a base responde 404 ou 200 a `GET /api/financeiro/capacidades`; K-2: o web da base conhece ou
não a rota da capacidade, por `git grep` na árvore da base).

**Impacto em dados reais:** nenhuma linha muda; sem backfill. Produção (02/10): 1 título financeiro, zero baixas, zero
contas bancárias, zero movimentos bancários e zero OFX — a P8 passa (zero baixas confirmadas com desconto, conferido em
produção em 02/10), e as telas de Bancos e caixa, Conciliação e
Adiantamentos abrem vazias. O título de produção continua com o mesmo saldo e situação: a soma nova só vale na próxima
baixa. Se ele foi gerado por documento (Origem diferente de "Avulso"), passa a mudar pelo financeiro só no vencimento,
na conta prevista e na observação. Sem natureza padrão configurada (a tabela nasce vazia), juros, multa e acréscimo
ficam no movimento principal, como hoje, e a baixa com tarifa é recusada até alguém configurar a natureza da tarifa.
Nenhuma natureza tem `grupo_dre`: o DRE sai pelos padrões derivados (receita → Receitas; despesa CAPEX →
Investimentos; despesa → Despesas); Deduções e Custos só aparecem com a marcação no cadastro. O que muda para fora do
sistema: o menu Financeiro (as áreas novas; Contas e Caixa e Bancos saem do menu e da busca, e continuam pela URL e
pelos favoritos).

**Reversão:** API e web voltam por redeploy da versão anterior; o banco fica (aditivo; a tabela nova nunca se apaga,
decisão 247; devolver DELETE ao `erp_app` ou desligar um gatilho só com migration nova, por decisão humana). Reverter
só o web = janela 2; reverter só a API = janela 3 sobre o banco novo, com a janela 1. Enquanto ninguém usar a Central
(baixa com componente, tarifa, excedente, lote ou encontro de contas com desconto), a reversão não deixa resto. Depois:
- a API anterior não estorna a baixa CRUZADA com desconto feita pela nova: o espelho abate valor − desconto e ela acha o
  par só pelo `amount` igual → 409 "Par da baixa cruzada não identificado com exatidão: cancelamento bloqueado"
  (fail-closed; nada corrompe);
- o estorno pela API anterior de uma baixa com componentes, tarifa ou excedente cancela a baixa e o principal (se nenhuma
  outra baixa o usa), e deixa CONFIRMADOS os movimentos de componente, a tarifa do lote e o título-crédito do excedente
  (com excedente, o principal também fica: a baixa do crédito o compartilha);
- a API anterior deixa estornar direto um movimento de componente (ela não conhece `title_settlement_id`).
A correção, nos três, é voltar a API nova e estornar por ela. Por isso: use os recursos novos de baixa em produção só
depois de conferir o deploy (roteiro abaixo).

**Roteiro do Maike em produção** (produção é operacional — decisões 240 e 247). Os passos 0 a 9 são só leitura (nada é
gravado); o passo 10 grava, e só com a decisão dele.
0. Antes do deploy (leitura): o ledger de migrations termina na 0041; nenhuma baixa confirmada com desconto (a P8 refaz a
   pergunta na hora de aplicar). **Conferido em produção em 02/10** (leitura do Maike, por volta das 23h UTC, com a `main`
   `622f194` no ar): o ledger de migrations na 0041 e ZERO baixas confirmadas com desconto — a parada da P8 não
   dispara. Os gatilhos de `erp.financial_titles` (a parte deles na P7) são exatamente `trg_ft_audit` e
   `trg_ft_updated` (o mesmo fato da P9 da F9a).
1. Menu Financeiro: Títulos, Bancos e caixa, Conciliação, Fluxo e resultado, Adiantamentos, Visão Geral, Planejamento,
   Compromissos, nesta ordem; Contas e Caixa e Bancos fora do menu; a busca do menu por "contas a pagar" leva a Títulos.
   `/financeiro?tab=contas&sub=pagar` ainda abre a lista de hoje.
2. Títulos › A pagar, A receber e Todos: o título de produção aparece; os cartões (Vencidos, Vencem hoje, A vencer,
   Pagos/Recebidos no período) contam e somam; "Previstos" habilitado com 0 (a provisão pela TOP é da F9a; nenhuma TOP
   provisiona); o rodapé "Totais do filtro". Exportar CSV abre a planilha com o dinheiro em texto. Nenhuma ação em lote.
3. Abrir o título: "Origem" com o rótulo (e "Abrir origem" quando ele vem de documento, com o aviso "Título gerado por …"
   e sem Editar nem Cancelar). "Baixar" abre o diálogo novo (Tipo, Conta bancária, Valor, Juros, Multa, Desconto,
   Acréscimo, Tarifa, Movimento). Fechar sem confirmar.
4. "+ Novo" › Nova despesa: o lançamento avulso (Competência, Conta prevista, Rateio em R$ com "Falta R$ …", "Já pago",
   Anexos); o primeiro campo é "Tipo de operação" (F9a). Voltar sem salvar.
5. Bancos e caixa › Contas: vazia (produção sem conta), com o link "Cadastro de contas"; Extrato: "Escolha uma conta
   para ver o extrato."; Transferências: o formulário (Tipo, Conta de origem, Conta de destino…). Fechar sem lançar.
6. Conciliação: a lista de importações vazia; "Importar OFX" pede a conta. Fechar.
7. Fluxo e resultado › Fluxo de caixa do mês; "Incluir previstos" habilitado (F9a; sem previsto, as colunas da provisão
   saem zeradas). Resultado (DRE): competência e caixa do mês, por grupo.
8. Adiantamentos: vazio.
9. Configurações › Financeiro › "Naturezas padrão da baixa": os 9 campos vazios. Cadastros › Naturezas: o campo "Grupo do
   DRE". Não salvar.
10. (Decisão do Maike; grava.) Configurar as naturezas padrão (juros, multa, acréscimo, desconto e tarifa) e, se quiser,
    o "Grupo do DRE" das naturezas de dedução e de custo.

**Gate externo em produção: PENDING (Maike)** — a sessão não tem acesso autenticado à produção.

### F6a — pedido de compra finalizado com aprovação, aprovado para orçamento e orçamento de compra (OPERACOES-01, migration 0044)

Decisão 283, parte F6a. A F6b — as telas da Central de Compras — acrescenta a subseção dela. **Uma migration:
`0044_pedido_finalizado_e_orcamento_de_compra.sql`** (pre-deploy; trava (2026,78); `lock_timeout` 2 s; pré-condições
nomeadas `OPERACOES-01 F6a: …`, a primeira é "já aplicada"; pós-condições só de catálogo; aditiva; sem backfill; a 0041
não foi editada). Sem variável. Permissões novas sem migration: `pedidos_compra.approve` e
`orcamentos_compra.{view,create,edit,delete}` — o pre-deploy sincroniza o catálogo e o perfil Administrador do sistema
as recebe (`packages/db/src/seed.ts:20-21`); os outros perfis, o Maike dá na tela de perfis. Doze rotas novas
(`/api/compras/pedidos/:id/{previa-finalizacao,finalizar,aprovar-para-orcamento,orcamentos}`,
`/api/compras/pedidos/:id/orcamentos/:orcamentoId/escolher` e `/api/compras/orcamentos/*`), a capacidade
`finalizacaoEOrcamento: 1` (no FIM de `capacidades`, em `GET /api/compras/{pedidos,compras,orcamentos}/operation-types`),
as seções `fluxoCompra` e `divergenciaPedido` em `formato5.secoes` (depois de `destino` e `fluxo` da F5a) e o código de
erro `DIVERGENCIA_COM_O_PEDIDO` (409). Nenhuma tela da Central de Compras muda, nem o menu (a entrada do orçamento de
compra em `apps/web/nav.registry.mjs` vem com a F6b); o editor da TOP ganha as abas "Fluxo de compra" (pedido) e
"Divergência com o pedido" (compra). Contrato em `docs/OPERACOES-CONTRACT.md` §2 e §4 e
`docs/TIPO-OPERACAO-CONTRACT.md` §18.9.

**Migration — o que faz** (nenhuma linha existente é reescrita):
- `erp.documentos_compra`: colunas novas, anuláveis, sem default — `finalizado_em`, `finalizado_por` (FK `erp.users`),
  `aprovado_orcamento_em`, `aprovado_orcamento_por` (FK `erp.users`), `pedido_orcado_id` (FK COMPOSTA
  `(pedido_orcado_id, organization_id)` → a própria tabela), `prazo_entrega_dias`, `validade_orcamento`; cinco CHECKs
  novos (os pares de finalização e de aprovação para orçamento andam juntos e são só do pedido; `pedido_orcado_id` só e
  sempre no orçamento; prazo e validade só no orçamento; prazo de 0 a 3650) — 20 CHECKs no total; os CHECKs de
  espécie e de situação refeitos na MESMA instrução (drop e add), só ACRESCENTANDO `orcamento`, `finalizado`,
  `escolhido` e `nao_escolhido`; índices novos: `ix_documentos_compra_pedido_orcado` e os únicos parciais
  `ux_documentos_compra_orcamento_fornecedor` (um orçamento vivo por fornecedor no pedido) e
  `ux_documentos_compra_orcamento_escolhido` (um vencedor por pedido);
- `erp.documentos_compra_itens`: `item_pedido_orcado_id` (FK composta → a própria tabela) e os índices
  `ux_documentos_compra_itens_pedido_orcado` e `ix_documentos_compra_itens_pedido_orcado`;
- seis funções de gatilho novas, todas SECURITY DEFINER estreitas (`search_path = erp, pg_temp`, EXECUTE só do dono):
  `documentos_compra_conferir_v3`, `documentos_compra_transicao_v3`, `documentos_compra_item_origem_guarda_v2`,
  `documentos_compra_item_orcamento_guarda` (nova), `aprovacoes_compra_conferir_v2` e `documentos_compra_finalizacao_guarda`
  (nova); os gatilhos de MESMO nome trocados para elas (a ordem de disparo não muda), dois gatilhos novos
  (`trg_documentos_compra_finalizacao`, só na passagem aberto → finalizado do pedido; `trg_documentos_compra_itens_orcamento_guarda`)
  e as quatro funções substituídas removidas SEM cascata; `erp.documentos_compra_itens_documento_aberto` não muda (a
  0043 trocou só o texto dela, e a 0044 confere só o nome);
- `erp.layouts_documento`: o CHECK da família refeito por lista ESTÁTICA com as TREZE — as cinco da 0038, as sete de
  estoque da 0043 (`estoque.entrada`, `estoque.saida`, `estoque.transferencia`, `estoque.ajuste`,
  `estoque.requisicao_material`, `estoque.consumo`, `estoque.devolucao_consumo`) e `compras.orcamento` —, e o
  comentário da coluna cita as treze.

**Pré-condições (a migration recusa sem aplicar nada, com a mensagem `OPERACOES-01 F6a: …` que nomeia o que falta):**
já aplicada (funções novas, colunas novas ou os dois gatilhos novos já existem — a primeira pergunta); papel `erp_app`
ausente; quem aplica não atravessa RLS (precisa ser superusuário ou `BYPASSRLS`: é o dono das funções SECURITY DEFINER);
tabelas e chaves `(id, organization_id)` alvo das FKs compostas ausentes; funções que ela troca ou chama ausentes; os
gatilhos a trocar desligados ou fora das funções esperadas; as funções SECURITY DEFINER de compras, enumeradas PELO NOME,
diferentes das seis esperadas; quem aplica não é dono delas e das quatro tabelas; os 15 CHECKs de hoje diferentes; e
**2.9, o CHECK de família do layout**: ausente; sem as cinco famílias da 0038 e as sete de estoque da 0043 (a 0043 não
aplicada); já aceitando `compras.orcamento`; ou aceitando alguma família que a lista estática da 0044 não carrega (a
rede para a junção das fases). A pós-condição 12.8 confere o CHECK validado com exatamente as treze.
Os ALTER TABLE e as trocas de gatilho pedem travas curtas em `erp.documentos_compra`, `erp.documentos_compra_itens`,
`erp.aprovacoes_compra` e `erp.layouts_documento`: com uma transação longa segurando uma delas, a migration desiste em
2 s sem aplicar nada, e o deploy é refeito (seguro). Em erro, publique o nome do papel, nunca a conexão.

**Ordem: banco (0044) → API → web.** Na PR #90, as migrations entram na ordem do número (0042 → 0043 → 0044). A 0044
DEPENDE da 0043 (F5a): a pré-condição 2.9 recusa enquanto o CHECK de layouts não aceitar as sete famílias de estoque
dela. O runner aplica cada migration na sua própria transação: se a 0044 desistir depois de a 0043 entrar, o banco fica
com a 0043, e o deploy é refeito.

**Version skew** (base `622f194`; provas em arquivos próprios, fora da suíte comum):
- **Sentido 2 — web da base × API nova** (janela "API antes do web" e reversão só do web): igual a hoje. A lista única
  sem filtro de espécie não traz orçamento; a leitura do pedido ganha chaves (ignoradas); o pedido aberto cuja TOP não
  exige finalizar é recebido e a compra confirmada pela tela da base; a fila Aprovações › Compras da base lista o pedido
  cuja TOP (formato 4) exige aprovação e o Aprovar da base decide (com `pedidos_compra.approve`); a prévia da compra só
  ganha `divergencia` quando a TOP da compra tem a seção. Provado pelo K-2 (`f6a-compras-skew-web-anterior.spec.ts`,
  3 casos: K2-1 receber e confirmar; K2-2 a fila aprova o pedido, depois o finalizar da API nova dá 200 e a consulta da
  base abre o pedido finalizado com o Receber desabilitado; K2-3 a lista da base sem o orçamento e a consulta do pedido
  com orçamento abrindo), com o vigia: nenhum 404, 422 ou 5xx e nenhuma requisição morta. Declarado: no web da base, o
  pedido FINALIZADO aparece como "Desconhecido" (o rótulo da base não conhece a situação), sem Receber, Cancelar nem
  Encerrar saldo — o servidor aceitaria; o pedido cuja ÚNICA próxima operação é o orçamento mostra "A TOP deste pedido
  não tem próxima operação configurada.".
- **Sentido 1 — web novo × API da base** (janela "web antes da API" e reversão só da API): sem o bloco `formato5`, o
  editor da TOP é o do 4, sem as abas de extensão (K-1 do 5 da F4, `top-formato5-skew-api-producao.spec.ts`, 2 casos; a
  premissa passou a tirar as seções de extensão do corpo no 5). A Central de Compras desta parte não pede nada novo: o
  Tipo "Orçamento de compra" só aparece com `orcamentos_compra.view`, que a API anterior não conhece. O K-1 de compras
  (`finalizacaoEOrcamento`) é da F6b, que consome a chave.
- **Com "Exigir pedido finalizado para receber" = Sim, o web só com a F6a não recebe o pedido**: o Receber da Central
  continua habilitado no pedido aberto, o servidor responde 409 "Este pedido precisa ser finalizado antes de ser
  recebido.", e não há botão Finalizar até a F6b. Desde a F6b (§ F6b, na mesma PR), o "Receber…" do pedido aberto fica
  desabilitado com essa mensagem e o Finalizar está na tela. Ligue as regras só com as telas da F6b no ar (passo 7).

**Impacto em dados reais** (decisão 240: P1 recente, efeito novo desligado, sem sandbox; dado de produção nunca é
apagado — decisão 247): nenhuma linha muda; sem backfill. Colunas novas nulas; CHECKs só alargados; os novos só
restringem colunas novas. Produção (leitura de 02/10, decisão 281): nenhum documento de compra listado; 3 TOPs — a de
pedido de compra no formato 3 lê "Exigir pedido finalizado para receber" e a divergência no neutro sem ler a
configuração e não exige aprovação: o receber e a confirmação seguem os de hoje. O que muda para quem usa (Administrador,
que recebe as permissões novas): nos perfis, "Pedidos de Compra" com "Aprovar" e o recurso "Orçamentos de Compra"; no
editor da TOP, as abas "Fluxo de compra" e "Aprovação" no pedido de compra e "Divergência com o pedido" na compra; em
Compras › Documentos, o Tipo "Orçamento de compra" (lista vazia) e as situações Finalizado, Escolhido e Não escolhido no
filtro; em Layouts de documento, o movimento "Orçamento de compra". A Central de Compras e a fila de Aprovações não
mudam.

**Reversão:** API e web voltam por redeploy da versão anterior e convivem com a 0044; colunas, linhas e decisões nunca
se apagam (decisão 247); desligar a guarda ou estreitar um CHECK só com migration nova, por decisão humana. Enquanto
ninguém finalizar pedido nem lançar orçamento, a reversão não deixa resto. Depois:
- a API anterior não lê as colunas novas; orçamentos ficam invisíveis (espécie fora das portas e da lista única dela) e a
  fila dela não lista pedido (espécie compra fixa); as decisões de pedido já gravadas ficam;
- o pedido FINALIZADO: receber e encerrar o saldo → 409 "Este pedido não está aberto."; cancelar → 404 (o UPDATE dela só
  alcança o aberto);
- a compra gerada de um pedido que foi finalizado e ficou convertido NÃO se cancela pela API anterior (aberta ou
  confirmada): ela reabre o pedido como aberto, e a transição da 0044 recusa — 409 "O pedido de compra reabre na situação
  de antes de ser convertido (finalizado).", e nada é gravado;
- "Exigir pedido finalizado para receber" não é cobrado: o pedido aberto é recebido.
A correção, nos casos acima, é voltar a API nova. Reverter só o web = o sentido 2 acima.

**Roteiro do Maike em produção** (depois do deploy; produção é operacional — decisões 240 e 247). Os passos 1 a 6 são só
leitura (nada é gravado); o passo 7 grava, e só com a decisão dele.
1. Perfis de usuário: "Pedidos de Compra" tem "Aprovar"; "Orçamentos de Compra" (Ver, Criar, Editar, Excluir) aparece em
   Operacional › Compras; o Administrador tem todas. Fechar sem salvar.
2. Configurações › Operações › Tipos de Operação › a TOP de pedido de compra: as abas Identificação, Geral, Próximas
   operações, Estoque, Fluxo de compra, Padrões financeiros (F9b), Financeiro, Fiscal e Aprovação (sem Execução). Na
   "Fluxo de compra", "Exigir pedido finalizado para receber" = Não, com a ajuda que termina em "… como hoje — e o
   aberto é recebido sem passar pela aprovação desta TOP, que só vale ao finalizar."; na "Aprovação", "Sem aprovação",
   com "Sempre" e "A partir de um valor" habilitados. Fechar sem salvar.
3. "Novo" › Compras › Compra (desde a F6b, o passo 1 também oferece "Orçamento" em Compras): a aba "Divergência com o
   pedido" com "Divergência" = Nenhuma e as duas tolerâncias em "0", desabilitadas; "Avisar" as habilita; digitar
   "150" mostra "Informe um percentual de 0 a 100, com até duas casas decimais."; voltar a "Nenhuma" põe "0" de novo.
   Fechar sem salvar.
4. Aprovações › Compras: a lista de hoje (nenhuma TOP de pedido de produção exige aprovação).
5. Compras › Documentos: o Tipo oferece "Orçamento de compra" — escolhido, a lista vem vazia; o filtro Situação lista
   também Finalizado, Escolhido e Não escolhido.
6. Configurações › Operações › Layouts de documento: o movimento "Orçamento de compra", com Empresa, Fornecedor, Data do
   documento, Condição de pagamento, Prazo de entrega (dias), Validade do orçamento, Observação e, nos itens, Produto,
   Quantidade e Valor unitário. Não salvar.
7. (Decisão do Maike; grava; só com as telas da F6b no ar — sem elas não há Finalizar na tela.) Ligar, TOP por TOP,
   "Exigir pedido finalizado para receber" e a Aprovação no pedido de compra (as duas juntas, para o pedido não ser
   recebido sem aprovação), e a Divergência na compra. O roteiro com gravação de pedido, orçamento e vencedor é o da F6b.

**Decisão pendente do Maike** (registrada na decisão 283, não tomada aqui): exigir o par na gravação da TOP de pedido de
compra — aprovação diferente de "Sem aprovação" ⇒ "Exigir pedido finalizado para receber" = Sim (E12). Hoje é só
declarado, na ajuda da aba "Fluxo de compra".

**Gate externo em produção: PENDING (Maike)** — a sessão não tem acesso autenticado à produção.

### F6b — as telas de Compras: finalizar, aprovar para orçamento, o orçamento de compra e o vencedor (OPERACOES-01, sem migration)

Decisão 283, parte F6b. **Sem migration, sem variável, sem permissão nova, sem rota nova, sem capacidade nova, sem
código de erro novo.** As migrations continuam 45, a última a 0045. Usa o que a 0044 e as rotas da F6a já criaram. O
que entra:
- web, na Central de Compras (sobre o motor, sem mudá-lo), tudo atrás da capacidade `finalizacaoEOrcamento` que a F6a
  declara em `GET /api/compras/{pedidos,compras,orcamentos}/operation-types`:
  - no pedido: "Finalizar" (com a prévia), "Aprovar para orçamento", "Novo orçamento", o bloco da Aprovação, a aba
    "Orçamentos" (comparar, "Escolher", "Cancelar") e "Finalizado"/"Aprovado para orçamento" nos Dados adicionais;
  - o orçamento de compra: a criação a partir do pedido, a consulta, editar no lugar e cancelar;
  - na compra: a divergência com o pedido na prévia da confirmação;
  - no Portal: o "Novo" sem orçamento avulso e o Tipo "Orçamento de compra" pela capacidade;
  - sem a capacidade: o pedido FINALIZADO recebe, encerra o saldo e se cancela na tela; a chave de idempotência da Central
    de Compras só troca quando o servidor recusa;
- API, ADITIVA e só de leitura:
  - `GET /api/aprovacoes/compras/:id` lê também o pedido (`compras.view` ∧ `pedidos_compra.view`);
  - `GET /api/compras/pedidos/:id/proximos-passos` ganha `orcamentos` no fim (com `orcamentos_compra.create`);
  - a leitura do pedido traz, em cada orçamento, a condição e o preço de cada item (com `orcamentos_compra.view`);
- domínio: o tipo `orcamento_compra` ganha tela (o passo 1 do assistente oferece "Orçamento" em Compras; 13 tipos com
  tela, 15 das 28 famílias sem tela no passo 1);
- editor da TOP: só a ajuda da aba Aprovação no pedido de compra;
- menu (`apps/web/nav.registry.mjs`, aplicado pelo coordenador no merge da fase, no mesmo commit das telas):
  `orcamentos_compra.view` em Compras › Documentos e no detalhe do documento de compra, com as palavras-chave "orçamento
  de compra" e "cotação"; a descrição de Aprovações › Compras passa a "Compras e pedidos de compra que aguardam
  aprovação" (a porta `compras.approve` não muda).

**Migration:** nenhuma. Nada a aplicar no banco.

**Ordem do deploy:** a F6b não tem exigência própria. Na PR #90 vale a ordem das fases com migration (0042 → 0043 → 0044
→ 0045, depois a API, depois o web). As regras de compras que travam — a aprovação no pedido, "Exigir pedido finalizado
para receber" e a divergência em "Bloquear" — só se ligam, TOP por TOP, DEPOIS deste web no ar.

**Version skew** (base `622f194`; provas em arquivos próprios, fora da suíte comum):
- **Sentido 1 — web novo × API da base** (janela "web antes da API" e reversão só da API): a base não declara
  `finalizacaoEOrcamento`, e a consulta do pedido é a de HOJE — sem Finalizar, Aprovar para orçamento, Novo orçamento, aba
  "Orçamentos" nem bloco da aprovação; as abas de hoje, exatas; o "Receber…" de hoje — e NENHUMA pergunta a
  `/previa-finalizacao`, a `/api/aprovacoes/compras/<pedido>` ou a caminho com `/orcamentos`; no Portal, o Tipo
  "Orçamento de compra" não existe e nada de orçamento é perguntado (K1-1). A prévia da compra da base, sem
  `divergencia`, é lida como "pronta" e confirma (200) (K1-2). `f6b-compras-skew-api-producao.spec.ts`, 2 casos, com o
  vigia (nenhum 404, 422 ou 5xx). O ramo "mundo novo" do mesmo arquivo só roda quando a base de skew tiver a F6.
  **Não coberto:** o pedido FINALIZADO gravado antes de reverter a API (ver Reversão); e o papel que só lança orçamento
  (só `orcamentos_compra.create` entre as de compras), que pergunta a porta do orçamento que a base não tem — 404 de
  rota no fio, e a tela é a de hoje.
- **Sentido 2 — web da base × API nova** (janela "API antes do web" e reversão só do web): igual a hoje. O web da base não
  pergunta a situação do pedido, ignora `orcamentos` nos próximos passos e as chaves a mais da leitura, e recebe e confirma
  o pedido cujo leque tem orçamento como hoje (K2-1, `f6b-compras-skew-web-anterior.spec.ts`, 1 caso, com o vigia). O resto
  é o K-2 da F6a (o pedido finalizado aparece "Desconhecido" no web da base, sem Receber).
- O web F6b sobre a API F6a sem F6b não existe em produção (a mesma PR). Mesmo assim, o web tolera: sem `orcamentos` nos
  próximos passos, o "Novo orçamento" fica indisponível; sem os preços, a aba compara só os totais; a situação do pedido
  em 404 esconde o bloco.

**Impacto em dados reais** (decisão 240: P1 recente, efeito novo desligado, sem sandbox; dado de produção nunca é
apagado — decisão 247): o deploy não grava nada; nenhuma linha muda; sem backfill. Produção (leitura de 02/10, decisão
281): nenhum documento de compra listado; 3 TOPs — a de pedido de compra no formato 3, sem destino de orçamento e sem
aprovação. O que muda para quem usa (o Administrador, o único com as permissões da F6a):
- Compras › Documentos: o Tipo oferece "Orçamento de compra" (lista vazia: não há orçamento) e o "Novo" não o oferece;
- num pedido de compra ABERTO (nenhum hoje): "Finalizar" e "Aprovar para orçamento" na barra;
- o passo 1 do assistente da TOP: "Orçamento" em Compras;
- a TOP de pedido de compra, aba "Aprovação": a ajuda nova;
- no menu, a descrição de Aprovações › Compras: "Compras e pedidos de compra que aguardam aprovação" (a fila não muda);
- para todos, sem a capacidade inclusive: depois de uma queda de rede, o reenvio do Salvar, Confirmar, Cancelar ou
  Encerrar saldo de compras leva a mesma chave (nunca um segundo documento); o reenvio com outros dados mostra o aviso
  "A tentativa anterior ficou sem resposta do servidor e pode ter sido gravada. …".
Finalizar, aprovar para orçamento e escolher o vencedor gravam e não se desfazem: só com a decisão do Maike.

**Reversão:** redeploy do web e/ou da API anteriores; nada no banco. Os pedidos finalizados, os orçamentos e as decisões
gravados ficam (decisão 247). Enquanto ninguém finalizar pedido nem lançar orçamento, a reversão não deixa resto.
Depois:
- reverter só o web = o sentido 2 acima (e o K-2 da F6a);
- reverter só a API = o sentido 1 acima, com UMA diferença: o pedido FINALIZADO já gravado continua com "Receber…",
  "Encerrar saldo" e "Cancelar pedido de compra…" na tela (o web aceita o finalizado sem a capacidade), e a API anterior
  recusa — 409 "Este pedido não está aberto." no receber e no encerrar, 404 no cancelar (§ F6a, Reversão). Um papel com
  `orcamentos_compra.view` que não lança nada de compras vê o Tipo "Orçamento de compra" com a lista vazia. A correção é
  voltar a API nova;
- reverter os dois = a reversão da F6a.

**Roteiro do Maike em produção** (depois do deploy; produção é operacional — decisões 240 e 247). Os passos 1 a 5 são só
leitura (nada é gravado). Os passos 6 a 8 gravam, só com a decisão dele, um por vez.
1. Compras › Documentos: o Tipo oferece "Orçamento de compra" — escolhido, a lista vem vazia e o "Novo" não existe; no
   Tipo "Todos", o "Novo" lista só as TOPs de pedido de compra e de compra (nenhuma de orçamento).
2. Configurações › Operações › Tipos de Operação › "Novo": o passo 1, grupo Compras, oferece "Pedido", "Orçamento" e
   "Compra". Fechar sem salvar.
3. A TOP de pedido de compra, aba "Aprovação": a ajuda "No pedido de compra, a aprovação vale ao finalizar: com
   aprovação, o pedido só é finalizado depois de aprovado em Aprovações, por quem tem as permissões Aprovar de Pedidos
   de Compra e Aprovar de Compras. …". Fechar sem salvar.
4. Abrir `/compras/orcamentos/new` (sem pedido): "O orçamento de compra nasce do pedido: abra um pedido aprovado para
   orçamento e use “Novo orçamento”." e o link "Ir para Documentos de compra". Nada é gravado.
5. Aprovações › Compras: a lista de hoje.
6. (Decisão do Maike; grava.) Criar a TOP de orçamento de compra pelo assistente (Compras › Orçamento) e incluí-la nas
   "Próximas operações" da TOP de pedido de compra. Salvar a TOP de pedido grava uma versão nova, no formato 5 (o editor
   mostra antes o que volta ao padrão). O leque vale só para os pedidos salvos DEPOIS.
7. (Decisão do Maike; grava.) Um pedido de compra de teste nessa TOP, com dois itens. Conferir, nesta ordem:
   - "Aprovar para orçamento" → confirmar → "Aprovado para orçamento" nos Dados adicionais; a pílula some;
   - "Novo orçamento" → a Central do orçamento com a faixa do pedido, as linhas do pedido travadas e sem Local de estoque
     → fornecedor A, preços → Salvar → a consulta do orçamento (Aberto);
   - de novo, com o fornecedor B, mais barato; o mesmo fornecedor A de novo é recusado ("Este pedido já tem orçamento
     deste fornecedor.");
   - a aba "Orçamentos" do pedido: "Menor total" no B e "menor" nos preços dele → "Escolher" o B → B "Escolhido", A "Não
     escolhido"; o pedido com o fornecedor e os preços do B;
   - "Finalizar" → o diálogo com o texto "Finalizar confirma o pedido de compra: ele não volta a aberto. Não mexe em
     estoque, e os orçamentos abertos continuam abertos. Se esta operação provisiona contas a pagar, os títulos previstos
     nascem agora." e a prévia "Esta operação não exige aprovação para finalizar." → confirmar → "Finalizado", com
     "Receber…" habilitado.
   Nada se apaga (decisão 247): o pedido e os orçamentos de teste ficam (cancele o pedido, se quiser).
8. (Decisão do Maike; grava; TOP por TOP.) Ligar a Aprovação no pedido de compra JUNTO com "Exigir pedido finalizado
   para receber" (para o pedido não ser recebido sem aprovação), e a Divergência na compra. Num pedido novo: o bloco
   "Aguardando aprovação"; "Receber…" desabilitado com "Este pedido precisa ser finalizado antes de ser recebido.";
   "Finalizar" recusado na prévia até a aprovação. Com a provisão da F9b ligada, finalizar cria os previstos — o roteiro
   da § F9b, passos 6 a 8, passa a ter o botão Finalizar.

**Decisão pendente do Maike** (registrada na decisão 283, não tomada aqui): exigir o par na gravação da TOP de pedido de
compra — aprovação diferente de "Sem aprovação" ⇒ "Exigir pedido finalizado para receber" = Sim. A F6b só o declara, na
ajuda da aba "Aprovação".

**Gate externo em produção: PENDING (Maike)** — a sessão não tem acesso autenticado à produção.

### F9a — financeiro pela TOP, título previsto e LCDPR (OPERACOES-01, migration 0045)

Decisão 286, parte F9a. A F9b — a provisão do pedido de compra finalizado e a TOP na compra, sem migration — acrescenta
a subseção dela. **Uma migration: `0045_financeiro_pela_top_e_lcdpr.sql`** (pre-deploy; trava (2026,79); `lock_timeout`
2 s; pré-condições nomeadas `OPERACOES-01 F9: …`, a primeira é "já aplicada"; pós-condições só de catálogo; aditiva; sem
backfill; a 0041 não foi editada; não depende da 0043 nem da 0044). Sem variável. Permissão nova sem migration:
`imoveis_rurais.{view,create,edit,delete}` ("Imóveis rurais", "Cadastros Base > Financeiros", módulo `financeiro`) — o
pre-deploy sincroniza o catálogo e o perfil Administrador do sistema as recebe (`packages/db/src/seed.ts:20-21`); os
outros perfis, o Maike dá na tela de perfis. Três rotas novas (`GET /api/financeiro/tops`,
`GET /api/financeiro/imoveis-rurais/opcoes`, `GET /api/financeiro/lcdpr/conferencia`) e três capacidades ADITIVAS:
`financeiroPelaTop: 1` em `GET /api/financeiro/capacidades`, `capacidades.lcdpr: 1` em `GET /api/auth/context` e
`padroesFinanceiros: 1` em `GET /api/admin/tipos-operacao/capabilities` (com `financeiroPadrao` em `formato5.secoes`, que
fica com as cinco seções de extensão: `destino`, `fluxo`, `fluxoCompra`, `divergenciaPedido` e `financeiroPadrao`).
Nenhum código de erro novo. O menu ganha Configurações › Financeiro › "Imóveis rurais" (`apps/web/nav.registry.mjs` e
`apps/web/src/app/(app)/configuracoes/page.tsx`, aplicados no merge da fase, no MESMO deploy do web); a conferência do
LCDPR entra na aba Fiscal › Livro Caixa, sem entrada nova. Os relatórios (`apps/api/src/routes/reports.ts`, arquivo da
F5a e da F6a) passaram a excluir o previsto no merge: as 12 leituras `t.status<>'cancelled'` viraram
`t.status not in ('cancelled','previsto')` — com a API desta PR, nenhum relatório soma o previsto. Contrato em
`docs/OPERACOES-CONTRACT.md` §2 e §7 e `docs/TIPO-OPERACAO-CONTRACT.md` §18.10.

**Migration — o que faz** (nenhuma linha existente é reescrita):
- tabela nova `erp.imoveis_rurais` (14 colunas: nome, `cib` — 8 dígitos —, `caepf` — 14 dígitos —,
  `inscricao_estadual`, `tipo_exploracao` — `individual`, `condominio`, `arrendado`, `parceria`, `comodato`, `outros` —,
  `participacao` > 0 e ≤ 100, `padrao`, `is_active`, `created_at`, `updated_at`, `deleted_at`, empresa obrigatória):
  FK COMPOSTA `(organization_id, empresa_id)` → `erp.empresas`; chaves `(id, organization_id)` e
  `(id, empresa_id, organization_id)`; índices únicos parciais de um imóvel PADRÃO e de um CIB por empresa entre os vivos;
  RLS habilitada e FORÇADA com a política ÚNICA `tenant_e_empresa` (o gabarito da categoria A, conferido letra por letra
  contra o de `erp.aprovacoes_venda` da 0041); auditoria e `updated_at` por gatilho; o `erp_app` lê, insere e altera,
  sem DELETE nem TRUNCATE (exclusão lógica); entra em `scripts/company-rls-modules.json` como `financeiro`;
- tabela nova `erp.tipos_operacao_versao_financeiro` (11 colunas: os padrões financeiros de uma versão de TOP — natureza,
  centro, tipo de título, forma de pagamento, conta —, uma linha por versão, ao menos um padrão): FKs compostas com a
  organização para a versão, a natureza, o centro e a conta; FK de coluna única para tipo de título e forma (têm linhas
  do sistema; a API confere a organização); imutável (gatilhos por linha contra UPDATE e DELETE e por comando contra
  TRUNCATE, também para o dono); RLS `tenant_isolation` forçada; auditoria; o `erp_app` só lê e insere;
- colunas novas, todas anuláveis e sem default: `financial_titles.tipo_operacao_id` e `.tipo_operacao_versao_id` (o par
  inteiro ou nada; FK de três colunas para a versão daquela TOP); `title_settlements.imovel_rural_id` (FK com a
  organização); `bank_movements.imovel_rural_id` (FK com a EMPRESA e a organização; CHECK: só com empresa, nunca em
  transferência nem saldo inicial), `.tipo_operacao_id` e `.tipo_operacao_versao_id` (o par); `financial_categories.tipo_lcdpr`
  (`receita`, `custeio_investimento`, `produto_adiantado`, `fora`; nulo = não classificada) — 11 FKs novas sem ação de
  exclusão, 12 CHECKs novos e 7 índices;
- o CHECK `financial_titles_status_check` (o MESMO nome) passa a aceitar `previsto`, e `chk_financial_titles_previsto`
  exige do previsto nada pago e uma origem de documento;
- `erp.refresh_title_status` com UMA linha nova: título previsto levanta `CONFLICT` (409 em todo binário) — a baixa de
  um previsto morre no banco. Mesma assinatura, linguagem, corpo da 0042 e privilégios; não recalcula título algum;
- gatilho `trg_ft_previsto_guarda` (BEFORE UPDATE com WHEN): o previsto só sai CANCELADO, sem mudar valor, desconto,
  pago, parceiro, empresa, direção ou origem, e nenhum título vira previsto por UPDATE;
- duas funções de gatilho novas, INVOKER, `search_path` fixo, EXECUTE só do dono. Nenhuma SECURITY DEFINER nova;
  nenhuma política existente tocada.

**Pré-condições (a migration recusa sem aplicar nada, com a mensagem `OPERACOES-01 F9: …` que nomeia o que falta):**
P1 já aplicada (uma das tabelas novas, `financial_titles.tipo_operacao_id`, `financial_categories.tipo_lcdpr` ou a
função da guarda já existe); P2 papel `erp_app` ausente; P3 quem aplica não atravessa RLS; P4 alguma das 35 colunas que a
migration lê ausente; P5 alguma chave alvo das FKs compostas ausente (`uq_tipos_operacao_versoes_tenant`,
`uq_financial_categories_tenant`, `uq_cost_centers_tenant`, `uq_bank_accounts_tenant` e a `(organization_id, id)` de
`erp.empresas`); P6 alguma função chamada ausente (`tenant_visible`, `audit_row`, `set_updated_at`,
`escopo_empresa_total`, `empresas_do_membro`, `modulo_empresa_atual`, `refresh_title_status`, `title_settlement_changed`);
P7 o módulo de escopo `financeiro` ausente (conferido em produção em 02/10: os 11 módulos de escopo de empresa incluem
`financeiro` — passa); **P8 o CHECK de situação do título não é EXATAMENTE o de hoje** (o texto de
`pg_get_constraintdef` com `open`, `partially_paid`, `paid`, `cancelled`) — a lista com `previsto` é escrita sobre ele, e
uma lista diferente seria trocada sem ninguém decidir (conferido em produção em 02/10: passa, passo 0 do roteiro); P9 os
gatilhos de `erp.financial_titles` diferentes de `{trg_ft_audit, trg_ft_updated}` (conferido em produção em 02/10:
passa, passo 0 do roteiro); P10 `erp.refresh_title_status` não é a da 0042. A 0043 e a 0044 (F5a e F6a) não tocam
nenhum desses objetos. Os ALTER TABLE pedem trava curta ACCESS EXCLUSIVE em `financial_titles` (a validação do CHECK
alargado lê a tabela), `title_settlements`, `bank_movements` e `financial_categories`, e as FKs novas pedem SHARE ROW
EXCLUSIVE nas referenciadas: com uma transação longa segurando uma delas, a migration desiste em 2 s sem aplicar nada, e
o deploy é refeito (seguro). O gatilho BEFORE TRUNCATE da tabela dos padrões faz qualquer `TRUNCATE … CASCADE` a partir
das tabelas que ela referencia falhar (desejado: histórico não se trunca; para a versão da TOP, a organização e o
usuário isso já acontecia desde a 0041). Em erro, publique o nome do papel, nunca a conexão.

**Ordem: banco (0045) → API → web.** Na PR #90 o pre-deploy aplica 0042, 0043, 0044 e 0045, nessa ordem; a 0045 é a
última, e o runner aplica cada uma na sua própria transação (se a 0045 desistir, o banco fica com a 0044 e o deploy é
refeito). O menu vai no MESMO deploy do web desta fase. Janelas:
1. **API anterior × banco novo:** os INSERTs dela não citam as colunas novas (anuláveis, sem default) e nunca gravam
   `previsto`; o CHECK alargado não muda nada para ela; ela não lê nem grava as tabelas novas. Só depois que alguém LIGAR
   a provisão numa TOP (API e web novos) existe previsto. Com previstos gravados, a API anterior os listaria como
   "A vencer" e os somaria nos relatórios e painéis (a correção do `reports.ts` é do binário novo), mas NENHUMA baixa
   neles passa (`refresh_title_status` → 409) e nenhuma mudança de valor (a guarda). O cancelamento pelo financeiro da
   API anterior (que não trava título de documento) cancelaria o previsto sem motivo — a guarda deixa o previsto ir a
   cancelado. Produção não tem previsto.
2. **Web anterior × API nova** (janela "API antes do web" e reversão só do web): as rotas `/api/financial/*` e o cadastro
   recebem os corpos de hoje e devolvem as chaves de hoje, só com acréscimos. Mudam, de propósito e aditivamente: a
   baixa e o movimento de entrada ou saída de uma empresa SEM imóvel informado ganham o imóvel PADRÃO da empresa (empresa
   sem padrão = como hoje); o título da venda com TOP guarda a TOP e a versão; a lista antiga não mostra o previsto nem o
   soma; a natureza salva sem `tipo_lcdpr` preserva o gravado. O "padrão legado" da confirmação da venda sem
   classificação continua idêntico para toda TOP nos formatos 1 a 4 (todas as de produção). Provado pelo K-2
   (`f9-financeiro-skew-web-anterior.spec.ts`, 4 casos: a conta a pagar pela tela antiga sem TOP; a baixa pela tela
   antiga com o imóvel padrão na baixa e no movimento; a lista antiga sem o previsto de um pedido e sem ele nos totais;
   a natureza salva pela tela antiga com o tipo LCDPR preservado).
3. **Web nova × API anterior** (janela "web antes da API" e reversão só da API): sem `financeiroPelaTop`, `lcdpr` e
   `padroesFinanceiros`, cada tela é a de hoje — o "Novo movimento bancário" sem Tipo de operação nem Imóvel rural e com
   o corpo de hoje (aceito, 201), o Livro Caixa só com o painel, a natureza sem "Tipo no LCDPR" — e nenhum pedido sai
   para `/api/financeiro/tops`, `/imoveis-rurais` ou `/lcdpr` (K-1, `f9-financeiro-skew-api-producao.spec.ts`, 3 casos,
   contando os pedidos no fio). Com a API anterior (sem `formato5`) o editor da TOP é o do 4, sem a aba nova.

Os dois sentidos rodam no job `skew` do CI, contra os binários reais da base (`622f194`), e os specs escolhem o ramo pelo
mundo medido na hora (K-1: `GET /api/financeiro/capacidades` 404/200 e `capacidades.lcdpr` no `/auth/context`, que têm de
descrever o MESMO binário; K-2: o web da base conhece ou não `/api/financeiro/tops`, por `git grep` na árvore da base,
com erro do `git` reprovando). O ramo "mundo novo" de cada um só roda quando a base tiver a F9.

**Impacto em dados reais** (decisão 240: P1 recente, efeito novo desligado, sem sandbox; dado de produção nunca é
apagado — decisão 247): nenhuma linha muda; sem backfill. Produção (02/10): 1 título financeiro, 2 documentos de venda
(1 orçamento convertido e 1 pedido aberto), 3 TOPs (pedido de compra, orçamento de venda e pedido de venda), zero contas
bancárias, movimentos e baixas. As tabelas novas nascem vazias; nenhuma TOP provisiona (a provisão nasce desligada): não
nasce previsto. Salvar o pedido aberto roda a sincronização da provisão sem efeito nem trilha (a TOP não provisiona e não
há previsto). Uma venda confirmada a partir dele gera o título com a TOP e a versão da venda (colunas novas) e a
classificação de hoje (a TOP não tem padrões). O título existente continua com o mesmo saldo e situação; o detalhe mostra
a origem pelo nome. Sem conta e sem movimento, nenhum imóvel é aplicado; as naturezas não têm tipo LCDPR, e a conferência
abre vazia. O que muda para fora do sistema: o menu Configurações › Financeiro › "Imóveis rurais", o grupo Financeiro no
assistente da TOP, o campo "Tipo de operação" no lançamento avulso e no movimento (com "Nenhum tipo de operação ativo
para este lançamento: ele segue sem operação." enquanto não houver TOP financeira) e a conferência no Livro Caixa.

**Reversão:** API e web voltam por redeploy da versão anterior; o banco fica (aditivo; as tabelas novas nunca se apagam,
decisão 247; os previstos ficam como linhas; desligar um gatilho só com migration nova, por decisão humana). Reverter
só o web = janela 2; reverter só a API = janela 3 sobre o banco novo, com a janela 1. Enquanto ninguém ligar a provisão
nem cadastrar imóvel, a reversão não deixa resto. Depois: os previstos aparecem como "A vencer" na lista e nos relatórios
da API anterior (sem baixa possível), e os imóveis gravados ficam sem tela — a correção é voltar a API nova. Por isso:
ligar a provisão em produção só depois de conferir o deploy (roteiro abaixo), com a API desta PR no ar (os relatórios
dela já excluem o previsto).

**Roteiro do Maike em produção** (produção é operacional — decisões 240 e 247). Os passos 0 a 9 são só leitura (nada é
gravado); os passos 10 a 13 gravam, e só com a decisão dele, um por vez.
0. Antes do deploy (leitura): o ledger de migrations termina na 0041 (o pre-deploy da PR aplica 0042, 0043, 0044 e 0045,
   nessa ordem); o texto de
   `select pg_get_constraintdef(oid) from pg_constraint where conname = 'financial_titles_status_check'` é
   `CHECK ((status = ANY (ARRAY['open'::text, 'partially_paid'::text, 'paid'::text, 'cancelled'::text])))` (a P8 refaz a
   pergunta na hora de aplicar e recusa se for outro). Depois do deploy (leitura): o ledger termina na 0045, depois da
   0044.
   **Conferido em produção em 02/10** (leitura do Maike, por volta das 23h UTC, com a `main` `622f194` no ar e o ledger
   de migrations na 0041):
   - P8: o texto do CHECK é exatamente
     `CHECK ((status = ANY (ARRAY['open'::text, 'partially_paid'::text, 'paid'::text, 'cancelled'::text])))` — passa;
   - P9: os gatilhos de `erp.financial_titles` são exatamente `trg_ft_audit` e `trg_ft_updated` — passa;
   - P7: o módulo de escopo `financeiro` existe (os 11 módulos de escopo de empresa de produção) — passa.
1. Configurações › Operações › Tipos de Operação › Novo: o passo 1 mostra o grupo Financeiro com "Conta a pagar", "Conta a
   receber" e "Movimento bancário". Cancelar.
2. Abrir a TOP de pedido de venda de produção: a aba "Padrões financeiros" depois de Estoque, com "Provisionar a receber
   ao salvar o pedido" desmarcado, "O documento pode trocar os padrões" marcado e "Padrões do lançamento" vazio. Não
   salvar. O histórico lista as versões sem linha de padrões.
3. Financeiro › Títulos: o cartão "Previstos" habilitado com 0; o filtro Situação tem "Previsto"; o título de produção
   aparece na lista padrão.
4. Abrir o título: "Origem" pelo nome ("Avulso", ou o documento com o código); sem "Tipo de operação" se ele não tem TOP.
5. "+ Novo" › Nova despesa: o primeiro campo é "Tipo de operação", com "Nenhum tipo de operação ativo para este
   lançamento: ele segue sem operação.". Voltar sem salvar.
6. Bancos e caixa › Novo movimento bancário: o mesmo aviso no topo; escolhendo uma empresa e Entrada ou Saída, o campo
   "Imóvel rural (LCDPR)" com "Sem imóvel". Voltar sem salvar.
7. Fluxo e resultado › Fluxo de caixa: "Incluir previstos" habilitado; marcado, as colunas "Provisão a receber" e
   "Provisão a pagar" zeradas e "Saldo projetado com previstos" igual ao "Saldo projetado".
8. Fiscal › Livro Caixa: o painel de hoje e, embaixo, "Conferência do LCDPR" vazia, com "Pendências do período: Sem
   imóvel: 0 … · Sem tipo no LCDPR: 0 … · Sem empresa: 0 …".
9. Configurações › Financeiro › Imóveis rurais: a lista vazia. Configurações › Financeiro › Naturezas: o campo "Tipo no
   LCDPR" vazio. Não salvar.
10. (Decisão do Maike; grava.) Cadastrar os imóveis rurais de cada empresa, com o padrão marcado (um por empresa).
11. (Decisão do Maike; grava.) Classificar as naturezas no LCDPR (1, 2, 3 ou "Fora do LCDPR").
12. (Decisão do Maike; grava.) Criar as TOPs financeiras (conta a pagar, a receber, movimento) com os padrões.
13. (Decisão do Maike; grava; com a API desta PR no ar — os relatórios dela já excluem o previsto.) Na TOP do pedido de
    venda, ligar "Provisionar a receber ao salvar o pedido", com os padrões, e conferir num pedido de teste: o cartão
    "Previstos" e o detalhe do previsto (aviso, sem Baixar).

**Gate externo em produção: PENDING (Maike)** — a sessão não tem acesso autenticado à produção. A P8 e a P9, antes
PENDING, foram conferidas em produção em 02/10 (passo 0): passam. O resto do roteiro (depois do deploy) continua PENDING.

### F9b — a provisão do pedido de compra finalizado e os padrões da TOP na compra (OPERACOES-01, sem migration)

Decisão 286, parte F9b. **Sem migration, sem variável, sem permissão nova, sem rota nova, sem capacidade nova, sem
código de erro novo.** As migrations continuam 45, a última a 0045. Usa o que a 0044 (F6a:
`documentos_compra.finalizado_em`) e a 0045 (F9a: o título `previsto`, a TOP e a versão no título, os padrões da versão)
já criaram. O que entra:
- domínio:
  - a regra de provisão do pedido de compra passa a EXECUTAR (a pagar, ao finalizar);
  - `compras.pedido` e `compras.compra` ganham o perfil dos padrões financeiros, e com ele a aba "Padrões financeiros"
    no editor das duas. O catálogo publicado (`formato5.catalogo.perfis`) muda junto;
- API:
  - a provisão do pedido de compra (`apps/api/src/lib/financeiro-provisao.ts`: um núcleo com duas fontes; a venda não
    muda);
  - os padrões da TOP no salvar da compra e do pedido (`apps/api/src/lib/financeiro-compra.ts`, novo) e na confirmação
    da compra;
  - a TOP e a versão no título da compra, em qualquer formato;
- web: só a ajuda da caixa da provisão no editor da TOP, que passa a vir do momento da regra. A Central de Compras não
  muda nesta fase.

**Migration:** nenhuma. Nada a aplicar no banco.

**Ordem do deploy:** a F9b não tem exigência própria nem acrescenta migration. Na PR #90 vale a ordem das fases com
migration (0042 → 0043 → 0044 → 0045, depois a API, depois o web), descrita nas seções delas.

**Version skew** (base `622f194`): nenhum K-1 ou K-2 novo, porque nenhum corpo, resposta ou capacidade que um web de
produção usa muda.
- **Sentido 1 — web novo × API da base:** sem o bloco `formato5`, o editor da TOP é o do 4, sem a aba (o K-1 do formato
  5, da F4). A Central de Compras desta fase não pede nada novo (as telas da F6b, na mesma PR, têm o K-1 próprio —
  § F6b).
- **Sentido 2 — web da base × API nova:** toda TOP de produção está nos formatos 1 a 4.
  - O salvar, a prévia, a confirmação e a auditoria da compra são os de hoje, chave por chave (CC-5).
  - Finalizar, receber, encerrar e cancelar não deixam previsto nem trilha `provisao` (PC-9). A premissa do PC-1 prova
    o mesmo: o mesmo pedido numa TOP no 4, finalizado, não provisiona.
  - Muda, de forma aditiva: o título da compra confirmada guarda a TOP e a versão. Nenhuma resposta antiga lê essas
    colunas (`GET /compras/compras/:id` lista `id, code, number, installment_number, due_date, amount, balance,
    status`).
- Os skews que já existem e passam pela TOP e por compras não mudaram e rodam no job `skew` do CI:
  `top-formato5-skew-*`, `f6a-compras-skew-web-anterior` e `f9-financeiro-skew-*`.

**Impacto em dados reais** (decisão 240: P1 recente, efeito novo desligado, sem sandbox; dado de produção nunca é
apagado — decisão 247): nenhuma linha existente é reescrita nem apagada; sem backfill. Produção (leitura de 02/10,
decisão 281): 3 TOPs, a de pedido de compra no formato 3 (`apps/api/src/routes/tipos-operacao.ts:271`); nenhum documento
de compra listado; 1 título financeiro. A provisão do pedido de compra finalizado nasce DESLIGADA (o neutro = hoje:
nenhum título previsto). Nenhum previsto nasce até alguém fazer as duas coisas: ligar a provisão numa TOP de pedido de
compra (o que a grava no formato 5) e finalizar um pedido salvo nessa versão. **Um efeito aditivo nos dados, mesmo sem
nada ligado:** a compra confirmada depois do deploy grava a TOP e a versão no título (`tipo_operacao_id` e
`tipo_operacao_versao_id`, colunas da 0045; os títulos que já existem continuam com elas nulas). O detalhe desse título
passa a mostrar, em "Tipo de operação", o código, o nome e a versão da TOP da compra. Fora dos dados, com as TOPs de
hoje:
- a confirmação de uma compra gerada de pedido trava o pedido antes do contador do ID Global;
- o salvar do pedido, e o da compra que gera título, leem a versão da TOP uma vez a mais;
- cada evento do pedido (finalizar, receber, confirmar ou cancelar a compra gerada, encerrar o saldo, cancelar) faz de
  uma a três leituras a mais, sem efeito nem trilha;
- no editor da TOP, o pedido de compra e a compra mostram a aba "Padrões financeiros", no neutro. Em todas as famílias,
  a ajuda da aba deixa de dizer "e, sem natureza e centro, vale a 1ª por código".

**Reversão:** redeploy da API e/ou do web anteriores; nada no banco. Não deixa resto enquanto ninguém fizer uma destas
duas coisas: ligar a provisão numa TOP de pedido de compra, ou salvar uma compra sem natureza e centro pelo par da TOP.
Os títulos de compra com a TOP e a versão ficam (colunas da 0045, que a API anterior não lê). Depois:
- os previstos a pagar gravados deixam de ser sincronizados pela API anterior. Confirmar ou cancelar a compra, encerrar
  o saldo ou cancelar o pedido os deixam como estavam.
  - A lista antiga os mostra como "A vencer", e os relatórios da API anterior os somam (como na F9a).
  - Nenhuma baixa passa: o banco recusa.
  - A correção é voltar a API nova: o próximo evento do pedido os acerta.
- a compra e o pedido cuja versão congelada está no 5 seguem a reversão da F4 (§ F4, "Reversão", item (b): o binário
  anterior não confirma documento com a versão no 5).

Reverter só o web = o sentido 2 acima.

**Roteiro do Maike em produção** (depois do deploy; produção é operacional — decisões 240 e 247). Os passos 1 a 5 são só
leitura (nada é gravado). Os passos 6 a 8 gravam, só com a decisão dele, um por vez, e só com o botão Finalizar da F6b
no ar (§ F6b, na mesma PR).
1. Configurações › Operações › Tipos de Operação › a TOP de pedido de compra.
   - As abas: Identificação, Geral, Próximas operações, Estoque, Fluxo de compra, Padrões financeiros, Financeiro,
     Fiscal e Aprovação.
   - Na "Padrões financeiros":
     - a ajuda da aba: "Provisão e padrões do lançamento financeiro desta operação. Tudo nasce desligado: sem padrão, o
       documento decide, como hoje.";
     - "Provisionar a pagar ao finalizar o pedido" desmarcada, com a ajuda "O pedido finalizado gera títulos previstos a
       pagar, fora das baixas. A compra confirmada os troca pelos títulos de verdade; encerrar o saldo ou cancelar o
       pedido os cancela.";
     - "O documento pode trocar os padrões" marcada;
     - nenhum "Sem natureza e centro";
     - em "Padrões do lançamento", os cinco campos com "Sem padrão".
   - Fechar sem salvar.
2. "Novo" › Compras › Compra: a aba "Padrões financeiros" logo depois de "Divergência com o pedido". Ela vem sem a caixa
   da provisão e sem "Sem natureza e centro"; a ajuda da "Natureza padrão" diz "Uma natureza analítica e ativa de
   despesa (ou de receita e despesa).". Fechar sem salvar.
3. A TOP de pedido de venda, aba "Padrões financeiros": "Provisionar a receber ao salvar o pedido" com a ajuda de antes
   ("O pedido gera títulos previstos, fora das baixas. A venda os troca pelos títulos de verdade; …"). Fechar sem
   salvar.
4. Financeiro › Títulos › A pagar: o cartão "Previstos" com 0.
5. (Se alguma compra for confirmada depois do deploy) o detalhe do título dela mostra a origem "Compra <código>" e
   "Tipo de operação: <código> — <nome> (versão N)".
6. (Decisão do Maike; grava.) Na TOP de pedido de compra:
   - escolher a natureza de despesa e o centro de resultado padrão — ou decidir que todo pedido os informe;
   - marcar "Provisionar a pagar ao finalizar o pedido";
   - salvar: nasce uma versão nova, no formato 5.
   A provisão vale só para os pedidos salvos DEPOIS.
7. (Decisão do Maike; grava.) Um pedido de compra de teste nessa TOP, com duas parcelas; Finalizar.
   Conferir:
   - Financeiro › Títulos › A pagar › "Previstos" mostra as duas parcelas, com a origem "Pedido de compra <código>", o
     aviso do previsto e sem Baixar;
   - a consulta do pedido, aba Financeiro, mostra a situação "Prevista".
8. (Decisão do Maike; grava.) Receber uma parte e confirmar a compra:
   - os previstos passam ao que falta;
   - os anteriores ficam "Cancelada", com o motivo "Compra <código> confirmada";
   - cancelar o pedido de teste, ou encerrar o saldo, cancela os previstos com o motivo.
   Nada se apaga (decisão 247): o pedido de teste fica cancelado na história.

**Gate externo em produção: PENDING (Maike)** — a sessão não tem acesso autenticado à produção, e os passos 6 a 8
gravam (só com a decisão dele).

## VISUAL-UX-04b — correções da Central de Compras (sem migration)

Decisão 278. **Só web**: sem migration, sem rota, sem API, sem variável, sem permissão, sem domínio. Conserta regressões
da VISUAL-UX-04 (#87, `1303de3`, em produção): a Central de Compras deixa de escrever o custo médio do armazém no valor
unitário (lançar e receber); a consulta mostra quantidade, Recebido e Saldo com 4 casas; a coluna Armazém dos itens
volta a obedecer ao layout (só a regra da operação a força); a Origem "Recebido de pedido" lê a chave que a leitura
devolve; o diálogo do "Confirmar compra" da criação só abre com a compra carregada e ainda confirmável; o Duplicar
descarta a cópia que não abriu formulário. A Central de Vendas não muda. Também conserta os detectores do version skew
(`apps/web/e2e/skew-web-anterior.spec.ts`) que erram sobre o web da base no motor da Central.

**Ordem do deploy:** só o web, nas superfícies de § Superfície web. Sem migration e sem API: nada a aplicar no banco,
nada a publicar na API.

**Impacto em dados reais:** daqui para frente, nenhum — a fatia só deixa de escrever. Para trás, DECLARADO: desde o
deploy do web da #87 (merge `1303de3` em 02/10/2026 01:22 UTC), a Central de Compras — lançar Pedido de compra e Compra,
e Receber pedido — trocava o valor unitário vazio ou "0" de cada item pelo custo médio do armazém escolhido (M1). Um
preço que ninguém digitou pode ter sido gravado e, numa compra confirmada, ter virado entrada no estoque (e o custo
médio do armazém) e conta a pagar com esse valor. A sessão não tem acesso à produção: se há documento atingido, e
quantos, é PENDING (Maike). Nada é apagado nem alterado por esta fatia (decisão 247): corrigir um documento é decisão do
Maike, pelo cancelamento (com estorno, se confirmado) e um lançamento novo — nunca UPDATE nem DELETE.

Consulta SOMENTE LEITURA (transação `read only`, desfeita no fim), para o editor SQL do Supabase com um papel que vê
todas as organizações. Sob o papel da API, sem as GUCs da transação, a RLS devolve zero linhas — e zero ali não prova
nada. Antes de ler a lista vazia, a premissa: `select count(*) from erp.documentos_compra where created_at >= timestamptz
'2026-10-02 01:22:17+00';` (sem documento na janela, a lista vazia não diz nada).

```sql
begin transaction isolation level repeatable read read only;
with itens as (            -- itens com armazém e unitário > 0 de documentos criados desde o merge da #87
  select d.organization_id, d.id as documento_id, d.especie, d.codigo, d.situacao, d.created_at,
         i.id as item_id, i.posicao, i.produto_id, i.armazem_id, i.quantidade, i.valor_unitario
    from erp.documentos_compra d
    join erp.documentos_compra_itens i on i.documento_id = d.id and i.organization_id = d.organization_id
   where d.created_at >= timestamptz '2026-10-02 01:22:17+00'
     and i.armazem_id is not null and i.valor_unitario > 0
), mov as (                -- o razão dos pares (armazém, produto) desses itens, por lote, com o efeito de cada movimento no total
  select m.organization_id, m.warehouse_id, m.product_id, coalesce(m.provider_lot, '') as lote, m.created_at, m.id,
         m.direction * m.quantity as dq,
         case when m.direction = 1 then round(m.quantity * m.unit_cost, 2)
              else -round(m.quantity * m.avg_cost_after, 2) end as dv,
         (m.direction = -1 and m.balance_after = 0) as zerou
    from erp.stock_movements m
   where (m.organization_id, m.warehouse_id, m.product_id) in (select organization_id, armazem_id, produto_id from itens)
), mov_grupo as (          -- a saída que zera o lote recomeça o total (erp.apply_stock_movement, 0003)
  select mov.*, count(*) filter (where zerou) over (partition by organization_id, warehouse_id, product_id, lote
                order by created_at, id rows between unbounded preceding and 1 preceding) as grupo
    from mov
), estado as (             -- quantidade e total do lote depois de cada movimento
  select organization_id, warehouse_id, product_id, lote, created_at, id,
         sum(dq) over (partition by organization_id, warehouse_id, product_id, lote order by created_at, id) as qtd,
         case when zerou then 0
              else sum(dv) over (partition by organization_id, warehouse_id, product_id, lote, grupo order by created_at, id) end as total
    from mov_grupo
), na_criacao as (         -- o custo médio que o web leria na criação do documento: soma dos lotes, total ÷ quantidade
  select it.item_id, sum(e.total) / nullif(sum(e.qtd), 0) as quociente
    from itens it
    cross join lateral (select distinct on (lote) lote, qtd, total from estado e
                         where e.organization_id = it.organization_id and e.warehouse_id = it.armazem_id
                           and e.product_id = it.produto_id and e.created_at < it.created_at
                         order by lote, created_at desc, id desc) e
   group by it.item_id
), atual as (              -- o mesmo cálculo de GET /api/stock/balances/<armazém>/<produto> hoje (stock-core.ts, currentBalance)
  select it.item_id, sum(sb.total_value) / nullif(sum(sb.quantity), 0) as quociente
    from itens it
    join erp.stock_balances sb on sb.organization_id = it.organization_id and sb.warehouse_id = it.armazem_id and sb.product_id = it.produto_id
   group by it.item_id
)
select it.organization_id, it.especie, it.codigo, it.situacao, it.created_at, it.posicao + 1 as item,
       p.code as produto_codigo, p.description as produto, w.initials as armazem, it.quantidade, it.valor_unitario,
       round(nc.quociente, 6) as custo_medio_na_criacao, round(a.quociente, 6) as custo_medio_atual,
       case when abs(it.valor_unitario - nc.quociente) <= 0.0000005 and abs(it.valor_unitario - a.quociente) <= 0.0000005 then 'os dois'
            when abs(it.valor_unitario - nc.quociente) <= 0.0000005 then 'na criação'
            else 'só o atual' end as bate_com
  from itens it
  join erp.products p on p.id = it.produto_id and p.organization_id = it.organization_id
  join erp.warehouses w on w.id = it.armazem_id and w.organization_id = it.organization_id
  left join na_criacao nc on nc.item_id = it.item_id
  left join atual a on a.item_id = it.item_id
 where (nc.quociente > 0 and abs(it.valor_unitario - nc.quociente) <= 0.0000005)
    or (a.quociente > 0 and abs(it.valor_unitario - a.quociente) <= 0.0000005)
 order by it.created_at, it.codigo, it.posicao;
rollback;
```

Como ler: um item por linha, dos documentos criados desde o merge do `1303de3` (o deploy veio depois: o corte é
conservador), com armazém e unitário > 0, cujo unitário bate — até meio milionésimo (a coluna guarda 6 casas) — com o custo
médio que `GET /api/stock/balances/<armazém>/<produto>` devolvia: total ÷ quantidade, somando os lotes, como
`currentBalance` faz. `custo_medio_na_criacao` é reconstruído pelo razão até a criação do documento, pelo mesmo cálculo
do gatilho `erp.apply_stock_movement` (0003): a entrada soma quantidade × custo, a saída tira quantidade × custo médio (cada
parcela em centavos), e a saída que zera o lote recomeça o total; `custo_medio_atual` é o de agora. `bate_com` = "na criação" ou "os dois" é o
sinal forte; "só o atual" é candidato fraco (o custo médio mudou depois e passou a coincidir). Coincidência não é prova:
um preço digitado igual ao custo médio também aparece — a lista é para conferir documento a documento. Provada num banco
local migrado, com 13 documentos de cenário: listou os 7 que deviam aparecer (inclusive a compra cujo custo médio mudou
depois dela, o pedido de compra, a média de dois lotes, o lote que zerou e reabriu, e a saída que afasta a coluna
`average_cost` de total ÷ quantidade) e deixou fora os 6 de controle (antes do corte, preço digitado, sem armazém, média
de um lote só, a coluna `average_cost`, a soma sem o recomeço); a mesma reconstrução levada até agora bateu com
`erp.stock_balances` em todos os lotes; com o recomeço desligado e o corte recuado, passou a listar o que não devia.

**Version skew:** web nova contra a API da base — as mesmas portas e os mesmos corpos (o unitário só deixa de ser
preenchido; nenhuma chave nova em corpo, URL ou navegador); web anterior contra a API nova — nada muda na API. No CI, a
prova reversa do detector busca três commits da main por SHA (o checkout do job é raso): sem rede, ela fica vermelha com
a mensagem, nunca verde vazia — e, num spec próprio fora do modo serial (`visual-ux-04b-skew-web-anterior.spec.ts`),
reprova só ela, sem levar os casos do modo serial.

**Reversão:** redeploy do web anterior. Nada a desfazer em banco ou configuração. Declarado: reverter religa o M1 (o
custo médio volta a ser escrito no unitário da compra) e as 2 casas da consulta — reverter é decisão do Maike.

**Ordem: sem predecessora aberta — a #88 já está na main.** A ordem planejada era esta ANTES da #88 (TOP-CONFIG-08,
decisão 277); a #88 entrou primeiro (`57b30e2`, 02/10/2026 02:45 UTC), e o job de Version skew da main ficou vermelho
no sentido 2 — web da base `1303de3` × API do `57b30e2`: o A1-K2 erra no detector da pílula de pendências (o web da
base está no motor da Central, e o caso esperava o Salvar desabilitado), e os 14 casos seguintes do modo serial não
rodam. É o defeito que o M2 desta fatia conserta. Com a base na `57b30e2`, o mesmo job tinha um segundo vermelho, que a
#88 trouxe e não podia consertar: o TOP-CONFIG-04A esperava o formato 3 da TOP renomeada pelo web da base, que agora
grava o 4 (esperado 3, recebido 4) — esta fatia o conserta também. Esta branch trouxe a main (merge, sem rebase); no CI desta PR o skew
roda contra a base da PR (`pull_request.base.sha`). A 277 e a seção TOP-CONFIG-08 desta DEPLOYMENT (o "Merge depois
da VISUAL-UX-04b", o "Declarado" e o passo 3 do roteiro) são da #88 e ficam como estão: descrevem a ordem planejada.
Com esta na main vale o ramo "com a VISUAL-UX-04b na main" delas: o "Confirmar compra" na criação com TOP de compra
Automática deixa de abrir o diálogo sobre a compra já confirmada — a consulta abre em Confirmado, sem prévia e sem
segundo `/confirm` (CX-6) —, e deixa de ser preciso usar "Salvar" no lugar de "Confirmar compra". Na
`docs/DECISIONS.md`, a 277 fica antes da 278.

**Roteiro do Maike (produção; produção é operacional — decisões 240 e 247, nada é apagado):**
1. Depois do deploy (uma aba aberta com o web anterior continua com o M1 até recarregar): a premissa e a consulta
   somente leitura acima; guardar a lista.
2. Depois do deploy, M1: Compras › + Novo › Compra › uma TOP; escolher um produto e um armazém com saldo e custo médio
   (Estoque › Saldo mostra o custo médio): o Valor unitário continua "0". Descartar — nada é gravado. Em Compras › um
   Pedido de compra › "Receber…", o mesmo: o unitário é o do pedido, nunca o custo médio; Descartar.
3. S1: abrir a consulta de qualquer compra ou pedido de compra: quantidade, Recebido e Saldo com 4 casas ("2,0000"); o
   valor unitário e o desconto continuam com 2.
4. S2 (se houver uma TOP de compra com layout que esconde o Armazém dos itens): a criação não mostra a coluna Armazém,
   a não ser que a TOP exija o armazém — aí a coluna aparece mesmo com o layout escondendo.
5. Origem: numa compra recebida de pedido, "Origem" é o link "Pedido de compra <código>"; numa compra direta,
   "Lançamento direto" (como antes).
6. Confirmar: Compras › + Novo › Compra › uma TOP de Confirmação Manual › preencher › "Confirmar compra": a compra
   salva abre com o diálogo e a prévia; fechar deixa Aberta (a compra de teste fica Aberta e, se não servir, se cancela — nada se apaga). Abrir a consulta de
   uma compra já confirmada: nenhum diálogo. A compra que CHEGA confirmada (TOP de compra no formato 4 com Confirmação
   Automática, da #88) abre a consulta em Confirmado, sem o diálogo e sem a prévia — provado no E2E pelo CX-6. Conferir
   em produção é opcional: só com uma TOP assim já criada (o passo 3 do roteiro da TOP-CONFIG-08), e a compra lançada
   fica CONFIRMADA, com estoque e conta a pagar — dado real; se não servir, cancelar com estorno (nada se apaga).
7. Duplicar: na consulta de uma compra, Duplicar abre um rascunho da mesma TOP com "Cópia aberta como rascunho";
   Descartar.
8. A venda não muda: Vendas › Novo › Venda, um produto com saldo: o unitário vazio é preenchido pelo custo médio, como
   antes; Descartar.

**Gate externo em produção: PENDING (Maike)** — a sessão não tem acesso autenticado à produção, nem para o roteiro nem
para a consulta do impacto.

## VISUAL-UX-04 — Central de Compras no motor da Central (sem migration)

Decisão 276. **Só web**: sem migration, sem rota, sem API, sem variável, sem permissão, sem domínio. O motor da Central
sai da Central de Vendas para `apps/web/src/features/central/`, e a Central de Compras (`/compras/<espécie>/new` e
`/compras/<espécie>/<id>`) passa a ser montada sobre ele, com a apresentação da venda. As escritas continuam as portas
de hoje, com os mesmos corpos: `POST /api/compras/<seg>`, `/convert`, `/confirm`, `/cancel` e `/encerrar-saldo`. O shell
passa a tratar `/compras/<espécie>/new` e `/compras/<espécie>/<id>` como rotas imersivas, como as de venda.

**Impacto em dados reais:** nenhum. A Central de Compras passa a oferecer Duplicar (abre um rascunho) e Cancelar com
motivo; a Central de Vendas não muda.

**Version skew:** web nova contra a API da base — as mesmas portas e os mesmos corpos (o cancelamento com motivo usa a
chave `motivo` que a API já aceita; vazio, o corpo sai sem ela, como hoje); web anterior contra a API nova — nada muda
na API.

**Reversão:** reverter a PR (redeploy do web anterior). Nada a desfazer em banco ou configuração: a cópia do Duplicar,
o "Salvo", a posição do rótulo e o Ampliar vivem só na memória da tela.

**Roteiro do Maike (produção):** 1. Compras › + Novo › Compra › uma TOP: a Central abre com a barra da venda (Descartar,
Salvar, Confirmar compra) e os Dados principais com a TOP travada. 2. Escolher só o fornecedor e Salvar sem item: nada é gravado e
a pílula vermelha "N pendências" lista o que falta; o clique leva ao campo. 3. Preencher e Salvar: a compra salva abre
com "Salvo". 4. Na consulta: Duplicar abre um rascunho da mesma TOP sem número de nota, série, lote nem validade;
Descartar volta ao começo sem gravar. 5. Ações rápidas › Cancelar compra… com um motivo: a compra fica Cancelada (o motivo
vai no corpo do cancelamento). 6. Um Pedido de compra: "Receber…" abre a Central em modo receber com o saldo; a Central de
Vendas continua igual.

**Gate externo em produção: PENDING (Maike)** — a sessão não tem acesso autenticado à produção.

## VISUAL-UX-03 — Configuração de layout igual ao desenho

Decisão 275. **Só web**: sem migration, sem rota, sem API, sem variável, sem permissão, sem domínio. A página
`/cadastros/:recurso/configuracao-layout` (todos os cadastros declarativos) passa a ser a do desenho: consulta e edição
com a barra de cada modo, a coluna Disponíveis / Em uso com o trilho (Usar todos / Tirar todos), as faixas de painéis e
de cards, as linhas com o x/y e o "+ Campo", arrastar por ponteiro (vão, troca na linha cheia, soltar na coluna), o
inspetor de propriedades no lugar do popover, Desfazer / Refazer e Pré-visualizar. O formulário do cadastro
(`ResourceForm`) não muda. As escritas continuam as portas de hoje, com o mesmo documento:
`PUT /api/preferences/<recurso>/form?scope=user` (Salvar), `DELETE …?scope=user` (Restaurar padrão) e `PUT` /
`DELETE …?scope=org` (Padrão da organização). Sai o editor do "Tipo de largura" (`fieldSizes`), que o formulário não
usa; o valor salvo atravessa intacto.

**Impacto em dados reais:** nenhum. O documento salvo é o mesmo FormLayout, e os layouts já salvos abrem iguais.

**Version skew:** web nova contra a API da base — mesmas rotas e o mesmo corpo, normalizado pelo servidor como antes;
web anterior contra a API nova — nada muda na API. Um layout gravado pela tela nova abre na anterior, e o inverso: o
documento não ganhou chave (as linhas só passam a ir renumeradas r1..rN e o `order` 1..n, o que o normalizador já
aceitava).

**Reversão:** reverter a PR (redeploy do web anterior). Nada a desfazer em banco ou configuração: o rascunho, a pilha,
a aba e a busca da coluna, a marca do "+ Campo" e o Pré-visualizar vivem só na memória da tela.

**Roteiro do Maike (produção):** 1. Abrir um cadastro (por exemplo Armazéns) › Novo › ícone "Layout do formulário": a
tela abre na consulta, sem coluna nem ferramentas, com Restaurar padrão desabilitado. 2. Editar layout: aparecem a
coluna (Disponíveis / Em uso), o trilho, o "+ Campo" e o "Adicionar linha"; passando o mouse num campo, o ⚙ e o ×;
Salvar desabilitado ("Nada mudou ainda"). 3. Arrastar um campo para outra linha (o vão abre com o nome), tirar outro
pelo × (vai para Disponíveis) e renomear um terceiro pelo ⚙ ("Rótulo do campo"): o ponto aparece na aba e o Salvar
fica verde; Desfazer volta um passo. 4. Salvar: a tela volta à consulta com "Layout salvo"; no Novo do cadastro, o
rótulo novo aparece, o campo tirado não, e a ordem é a da tela. 5. Editar layout › Restaurar padrão › "Restaurar
padrão" no diálogo: a tela volta ao padrão da organização (ou do sistema), e o formulário também. 6. Um layout que já
estava salvo antes do deploy abre com os mesmos painéis, cards, linhas e propriedades.

**Gate externo em produção: PENDING (Maike)** — a sessão não tem acesso autenticado à produção.

## VISUAL-UX-02 — Central de Vendas igual ao desenho (sem migration)

Decisão 270. **Só web**: sem migration, sem rota, sem API, sem variável, sem permissão, sem domínio. A Central de
Vendas (criação e consulta) passa a ter a barra e o leque de Ações rápidas do desenho, a posição do rótulo, Duplicar,
Descartar, Salvar com pendências (Cliente, Natureza e Centro de resultado, itens e Financeiro: o clique com pendência
não grava e lista o que falta), Confirmar venda na criação (Salvar + diálogo com a prévia de sempre), Cancelar com
motivo, Fiscal e plano na consulta, esqueleto e Ampliar; os itens da criação passam à grade do desenho (seleção pelo
círculo, Duplicar item e Remover item na barra, "Grade e formulário" em Configurar colunas, rodapé "Itens (N)" e
"Subtotal dos itens", formulário "Item X de N") e o Financeiro da criação aos campos do plano em coluna, na densidade
da Central; o diálogo de fechar aba ganha o texto do desenho. O `PlanEditor` compartilhado ganhou só uma prop
opcional de apresentação: sem ela, documentos fiscais, transferências, títulos e compras ficam como estavam. As
escritas continuam as mesmas portas de hoje (`POST /api/sales/<seg>`, `/confirm`, `/cancel` com `reason`,
`/convert`, `/encerrar-saldo`), com as mesmas chaves de corpo (cabeçalho, item e plano) e a mesma `Idempotency-Key`.

**Impacto em dados reais:** nenhum dado muda; a Central passa a oferecer Duplicar (abre rascunho) e Cancelar com
motivo.

**Version skew:** web nova contra a API da base — mesmas rotas e mesmos corpos (o `skew-api-producao.spec.ts` roda a
Central nova contra a API anterior, já com Natureza e Centro de resultado como pendência de clique); web anterior
contra a API nova — nada muda na API. Os helpers de E2E que o skew usa (`pickRef`, `acaoDaCentral`,
`abrirDadosAdicionais`) funcionam nas duas Centrais.

**Reversão:** reverter a PR (redeploy do web anterior). Nada a desfazer em banco ou configuração: a posição do
rótulo, o ampliar, as colunas, a seleção de item, o Duplicar e o "Salvo" vivem só na memória da tela.

## ANEXOS-PESQUISA-01 — anexos nos documentos de venda e de compra e pesquisa de produtos

Decisão 271. **Sem migration**, sem variável nova, sem permissão nova. Ordem: **API → web**.

**Impacto em dados reais: nenhum dado muda; o botão Anexos dos portais de Vendas e de Compras passa a aceitar arquivos.**

Janelas de version skew:

1. **API nova × web anterior**: a web anterior já tinha o botão Anexos nos portais; ele deixa de receber 422 e passa
   a funcionar sob a política da decisão 271. A pesquisa de produtos não é chamada pela web anterior. O
   `/layout-efetivo` de vendas responde byte a byte igual (L-0).
2. **API anterior × web nova**: a API anterior responde 422 ao anexo de documento de venda/compra (como hoje) e 404
   de rota a `GET /api/produtos/pesquisa`; nenhuma tela desta fatia chama a pesquisa, e a tela futura cai no
   `/api/resources/products/options`.

**Reversão:** reverter a PR. Os anexos já enviados ficam no banco (`erp.attachments`, `erp.attachment_blobs`) e voltam
a aparecer quando a mudança voltar; dado de produção não se apaga (decisão 247).

**Roteiro do Maike (produção):** Vendas › marcar uma venda › Anexos › enviar um PDF — aparece na lista, baixa e
o histórico da venda mostra o anexo adicionado.

## TOP-CONFIG-08 — regras gerais e aprovação da TOP (0041)

Decisão 277. **Uma migration: `0041_regras_gerais_e_aprovacao_da_top.sql`** (pre-deploy, como a 0040; trava (2026,75),
`lock_timeout` 2 s, pré/pós-condições nomeadas `TOP-CONFIG-08: ...` — a primeira é "já aplicada" —, não destrutiva, sem
backfill): três tabelas de DECISÃO de aprovação, vazias, uma ao lado de cada documento — `erp.aprovacoes_venda`
(`erp.sales_documents`), `erp.aprovacoes_compra` (`erp.documentos_compra`) e `erp.aprovacoes_estoque`
(`erp.documentos_estoque`) —, só de inserção (gatilho de imutabilidade por linha contra UPDATE e DELETE e por comando
contra TRUNCATE — nem o dono edita, apaga ou esvazia uma tabela de decisões — e, para o papel da API, só `select` e
`insert`), com FKs para o documento, a versão da TOP, a TOP e a empresa (composta, `(organization_id, empresa_id)`), RLS
forçada com a política `tenant_e_empresa` da 0040 (módulos `vendas`, `compras` e `estoque`), `erp.audit_row` e o índice
`(organization_id, documento_id, id desc)`; a conta `erp.top_exige_aprovacao(jsonb, numeric)` (imutável, não lê tabela,
a mesma de `exigeAprovacao` do domínio; o papel da API a executa, porque a fila de aprovações a usa em SQL); um gatilho
de inserção por tabela (`trg_aprovacoes_venda_conferir`, `trg_aprovacoes_compra_conferir`,
`trg_aprovacoes_estoque_conferir`; SECURITY DEFINER, `search_path` fixo, organização e usuário da GUC do servidor —
linha de outra organização, ou sem organização na GUC, recebe a `NOT_FOUND` antes de ler qualquer documento, e linha de
empresa fora do escopo de escrita de quem decide no módulo da transação (`erp.empresa_escrita_permitida`, o predicado do
`with check` da política) também), que lê `for share` só o documento que passa pelo filtro inteiro da `NOT_FOUND`, no
próprio `where` — id, organização da GUC e empresa da linha; na venda, também `kind` `sale` e não excluída; na compra,
espécie `compra` —, de modo que documento de outra empresa, de outra espécie ou excluído recebe a `NOT_FOUND` na hora,
sem ser lido nem travado (mesmo quando outra sessão o segura `for update`), e que confere o documento aberto, que exige
aprovação pelo total ATUAL — na venda, também a versão atual —, e ATRIBUI do documento a TOP, a versão congelada e o
valor, e da transação `decidido_por` e `decidido_em`; e três guardas de transição BEFORE UPDATE da situação —
`trg_sales_documents_aprovacao` (o mesmo WHEN da 0023; procura a decisão da versão `OLD.version` e dispara antes das
três de hoje), `trg_documentos_compra_aprovacao` e `trg_documentos_estoque_aprovacao` (aberto → confirmado) —, que
recusam com `CONFLICT` (mensagem fixa de uma linha: 409 em todo binário) a entrada no confirmado de documento cuja
versão congelada está no formato 4, exige aprovação e não tem a vigente aprovada. A aprovação só cobre o valor e a
versão que aprovou: na venda e na compra, a vigente aprovada só vale com o valor aprovado ≥ o maior total (o de antes e
o de depois do UPDATE) e a versão da TOP aprovada igual à de depois do UPDATE; no estoque, só a versão; senão, a MESMA
recusa "precisa de aprovação" — confirmar e, no mesmo UPDATE, subir o total ou trocar a TOP não aproveita a aprovação
antiga. Na venda, o UPDATE que confirma e, no mesmo comando, deixa a TOP nula não dispara a guarda (o MESMO WHEN da
0023, que também não dispara): a API recusa tirar a TOP, e a guarda de banco para isso é de outra fatia. A reprovação
exige motivo com ao menos um caractere fora da classe `[[:space:]]` do banco (CHECK `observacao ~ '[^[:space:]]'`: motivo
só de espaço, tab ou quebra de linha é recusado; a API apara o motivo antes). Formato 1 a 3 nunca é barrado. As pós-condições conferem objetos (as tabelas, a
RLS forçada e a política única, as 12 FKs sem cascata, os 9 CHECKs, os índices, a forma da conta e das funções de
gatilho, EXECUTE das funções de gatilho só do dono, os 12 gatilhos das tabelas de aprovação — o conjunto exato, nenhum a
mais, os 3 de TRUNCATE inclusive —, as 3 guardas, o WHEN igual ao da 0023, os quatro BEFORE UPDATE por linha da venda
por nome — a guarda da aprovação primeiro, a 0039 por último — e os privilégios); não comparam contagens de tabelas
vivas. As permissões novas (`sales.approve`, `compras.approve`, `entradas_estoque.approve`, `saidas_estoque.approve`,
`transferencias_estoque.approve`, `ajustes_estoque.approve` — "Aprovar") não têm migration: o pre-deploy sincroniza o
catálogo e o perfil Administrador do sistema as recebe; os outros perfis, o Maike dá na tela de perfis. Rotas novas num
prefixo próprio, `/api/aprovacoes/{vendas,compras,estoque}`, e o módulo Aprovações (`/aprovacoes`) no menu — o 14º, o
limite do menu. Nenhuma variável nova.

**Pré-condição:** quem aplica a 0041 é o dono das funções SECURITY DEFINER e precisa atravessar RLS (superusuário ou
`BYPASSRLS`) — a própria migration recusa, com `TOP-CONFIG-08: o papel que aplica a migration (dono das funcoes
SECURITY DEFINER) nao atravessa RLS; ...`, e nada é aplicado. Também recusa, sempre com a mensagem `TOP-CONFIG-08: ...`
que nomeia o que falta e sem aplicar nada: já aplicada (as tabelas, as funções ou as guardas já existem — a primeira
pergunta); o papel `erp_app` ausente; uma coluna que os gatilhos leem ausente (`sales_documents`: `version`, `total`,
`status`, `kind`, `empresa_id`, `deleted_at`, `tipo_operacao_id`, `tipo_operacao_versao_id`; `documentos_compra`:
`valor_total`, `situacao`, `especie`, `empresa_id`, `tipo_operacao_id`, `tipo_operacao_versao_id`;
`documentos_estoque`: `situacao`, `empresa_id`, `tipo_operacao_id`, `tipo_operacao_versao_id`;
`tipos_operacao_versoes.configuracao`); a chave alvo de uma FK composta (`uq_tipos_operacao_versoes_tenant` da 0021,
`uq_tipos_operacao_tenant` da 0020, `uq_documentos_compra_tenant` da 0036, `uq_documentos_estoque_tenant` da 0040, a
chave `(organization_id, id)` de `erp.empresas`); as funções de auditoria, RLS, organização, usuário e escopo de escrita
que a política e os gatilhos chamam (`erp.current_org_id()` e `erp.empresa_escrita_permitida(uuid)` inclusive); os
módulos de escopo `vendas`, `compras` e `estoque`; e os BEFORE UPDATE por linha de `erp.sales_documents` diferentes,
por nome e por função, dos três de hoje (`trg_sales_documents_classificacao_financeira` da 0024,
`trg_sales_documents_execucao_configurada` da 0023 e `trg_sales_documents_versao` da 0039) — é sobre esse conjunto que
vale "a guarda da aprovação dispara primeiro e a versão continua a última". Os gatilhos e as FKs novas pedem uma trava
curta em `erp.sales_documents`, `erp.documentos_compra`, `erp.documentos_estoque` e nas tabelas referenciadas: com uma
transação longa segurando uma delas, a migration desiste em 2 s sem aplicar nada, e o deploy é refeito (seguro: nada foi
aplicado). Em erro, publique o nome do papel, nunca a conexão.

**Pré-condições da 0041 conferidas em produção pela revisão (01/10, só leitura):** os três BEFORE UPDATE por linha da
venda (`trg_sales_documents_classificacao_financeira`, `trg_sales_documents_execucao_configurada` e
`trg_sales_documents_versao`); os módulos de escopo, as colunas, as chaves, as funções e o papel `erp_app` presentes; as
tabelas de aprovação ausentes; o ledger em 40. A conferência não substitui a da própria migration, que refaz cada
pergunta na hora de aplicar.

**Ordem: banco (0041) → API → web.** Janelas:
1. **API anterior × banco novo:** a API anterior não conhece as tabelas novas, a conta nem as permissões novas, e não as
   lê. A guarda nova da venda dispara antes das três de hoje, não muda o NEW e, sem versão no formato 4, só lê e deixa
   passar; o mesmo vale para as guardas da compra e do estoque. Nenhuma versão no formato 4 existe antes da API nova (o
   domínio anterior recusa o 4 na gravação): venda, compra e documento de estoque confirmam exatamente como hoje, com o
   mesmo resultado, código e mensagem. Depois que a API nova gravar uma TOP no formato 4, uma instância anterior ainda no
   pool que tente confirmar um documento dela recebe 409: na venda e na compra pela própria API ("configuração
   ilegível", `TIPO_OPERACAO_EXECUCAO_INDISPONIVEL`), e no documento de estoque que exige aprovação pela guarda do banco
   (`CONFLICT`).
2. **web ANTERIOR × API nova:** a web anterior não tem o módulo Aprovações nem os textos novos do editor. O editor
   anterior ignora o bloco `regrasGerais` das capabilities (os blocos de hoje não mudam; `configuracao.versaoSchema`
   continua 1) e grava o formato 3 como hoje; corpo no formato 1 a 3 sobre TOP cuja versão vigente já está no 4 → 422
   `TIPO_OPERACAO_CONFIGURACAO_SCHEMA_NAO_SUPORTADO` (o formato não retrocede), nada gravado. `POST` e confirmação com
   TOP de formato 1 a 3 — todas as de produção — devolvem o corpo de hoje, chave por chave: `confirmacaoAutomatica` só
   aparece com versão no formato 4 Automática, e a prévia do estoque só ganha `recusas` com versão no formato 4 (ou
   ilegível). A Central de Vendas (que não muda nesta fatia) já mostra as recusas da prévia, a da aprovação inclusive.
   Declarado: a Central de Estoque anterior mostra "prévia indisponível" diante de uma recusa de aprovação e deixa
   clicar Confirmar — o servidor responde 409 `APROVACAO_PENDENTE` (ou `APROVACAO_REPROVADA`), e nada é confirmado.
   Declarado também: com TOP no formato 4 Automática (o editor anterior não a grava), a Central de Estoque anterior diz
   "Salvo com sucesso" também quando o servidor confirmou ou a automática não aconteceu; a consulta que ela abre em
   seguida mostra a situação que o servidor leu.
3. **web NOVA × API anterior:** sem o bloco `regrasGerais` nas capabilities, o editor grava o formato 3, com os textos e
   as abas de hoje, e o histórico da TOP não mostra nenhuma das duas linhas "Regras gerais e aprovação: …", em versão
   nenhuma (nem na do formato 3 que traz as chaves das regras gerais): elas só aparecem com o bloco. O módulo
   Aprovações recebe 404 nas rotas novas — o prefixo próprio responde um 404 limpo no binário anterior — e mostra "As
   aprovações ainda não estão disponíveis neste servidor.", sem quebrar o resto do sistema. As Centrais ficam iguais; a
   de Estoque, sem `recusas` na prévia e sem `confirmacaoAutomatica` no `POST` (a API anterior não manda nenhuma das
   duas), se comporta como hoje: a prévia de hoje e o aviso "Salvo com sucesso".

As três janelas são provadas no CI pelo job `skew` (K-1 e K-2, `docs/TESTING.md`), contra os binários reais da base: o
sentido 1 sobe a API da base sobre o banco migrado e semeado por este HEAD, com a web deste HEAD (janelas 1 e 3); o
sentido 2, a web da base contra a API deste HEAD (janela 2). Os specs perguntam à API da base, na hora, se ela declara o
bloco `regrasGerais` e se responde `GET /api/aprovacoes/vendas` (404 = mundo legado), e passam nos dois mundos. O
aviso do Salvar da Central de Estoque não passa pelo job `skew` (o K-1 lança o documento de estoque pela API): o caminho
"sem a chave → Salvo com sucesso" é provado pelo passo (1) do W-5b, com uma TOP no formato 3 na API deste HEAD. Até a
VISUAL-UX-04b entrar e esta trazer a main, o job fica vermelho no sentido 2 por casos de outras fatias, sem defeito
desta (a ordem de merge, abaixo).

**Impacto em dados reais: nenhum dado muda; as TOPs de produção continuam no formato delas, e nada passa a executar até
alguém gravar uma TOP no formato 4.** Tabelas novas, vazias; nenhuma linha existente muda (produção, lida em
01/10/2026: três TOPs — o pedido de compra no formato 3, com Confirmação Automática, Documento sem itens Permitido e
Alteração Permitida; o orçamento e o pedido de venda no formato 2, com Alteração Permitida —, e nenhuma TOP de venda,
de compra ou de estoque). Nada disso executa hoje e continua sem executar, porque só o formato 4 executa. O seed do
pre-deploy acrescenta ao catálogo as seis permissões `.approve` e as dá ao perfil Administrador do sistema — o caminho
de toda permissão nova; nenhum outro perfil muda. Com elas, o Administrador passa a ver o módulo Aprovações (a lista
vazia: "Nenhum documento aguardando aprovação.").

**A Central de Estoque, ao salvar, diz o resultado da confirmação automática (W-5b e W-5c).** O aviso sai do
`confirmacaoAutomatica` que o `POST` devolve, nunca da TOP da tela: `{confirmado: true}` → "Salvo e confirmado."
(sucesso); `aguardando_aprovacao` → "Salvo. Este documento precisa de aprovação antes de ser confirmado." (informação);
`sem_permissao` → "Salvo, mas não confirmado: você não tem permissão para confirmar este documento." (atenção);
`recusada` → "Salvo, mas não confirmado: <a mensagem do servidor>." (atenção; a mensagem é a MESMA que o Confirmar
daria, com um ponto final só); sem a chave (formato 1 a 3, Manual, ou API anterior) ou com resultado fora do contrato →
o "Salvo com sucesso" de hoje. Depois do aviso, a consulta abre como hoje. Um Salvar dá um aviso só, nunca o novo ao
lado do de hoje. O `sem_permissao` é provado pelo W-5c: um membro que lança saída sem a permissão de confirmá-la (sem
`saidas_estoque.edit`) salva pela Central com a TOP Automática → "Salvo, mas não confirmado: você não tem permissão
para confirmar este documento.", um aviso só, a consulta em Aberto e o saldo parado; o mesmo lançamento pelo
administrador confirma.

**Declarado (fica para a fatia F2 da Central no motor):** a Central de Vendas e a de Compras não mudam nesta fatia.
Com uma TOP de venda Automática, "Confirmar venda" na criação salva, o `POST` já confirma, e a consulta abre a venda
confirmada, sem o diálogo de confirmação e sem segundo `/confirm` (W-4c): a consulta da venda, depois de carregar, só
abre o diálogo para venda que chega `open` ou `approved` e para quem tem `sales.edit` (o efeito da chegada depois de
salvar, em `apps/web/src/app/(app)/vendas/[kind]/[id]/page.tsx`). Com uma TOP de compra Automática, "Confirmar compra"
na criação salva e o `POST` já confirma; enquanto a VISUAL-UX-04b (decisão 278, PR a abrir) não estiver na main, a
consulta da compra abre o diálogo de confirmação só pelo pedido do clique, sem olhar a situação (o estado inicial de
`confirmando` em `apps/web/src/features/compras/central/estado.ts`): o diálogo aparece sobre uma compra já confirmada,
a prévia dele recusa ("Compra já confirmada") e o Confirmar fica desabilitado; a compra fica confirmada, sem efeito
duplicado. A VISUAL-UX-04b, que entra ANTES desta (a ordem de merge, abaixo), faz a consulta da compra conferir a
situação e a permissão depois de carregar, antes de abrir o diálogo, como a da venda: com ela na main, a compra
confirmada sozinha abre a consulta em Confirmado, sem diálogo. Se esta entrar sem a VISUAL-UX-04b na main, com TOP de
compra Automática, use "Salvar" na criação. Nas duas Centrais, ao salvar, o aviso continua o "Salvo com sucesso" de hoje também quando a confirmação automática não
aconteceu: `recusada` → o documento aparece Aberto, e o motivo surge na prévia ou no `/confirm`; `sem_permissao` →
aparece Aberto, sem o Confirmar para quem salvou. O rótulo "Salvar e confirmar", o aviso do Salvar pelo resultado da
confirmação automática, os itens vazios que a TOP permite — e, junto, a ajuda da Geral do editor no formato 4, que
diz "nas Centrais de Vendas e de Compras o lançamento ainda pede ao menos um item", com os dois E2E que a conferem letra
por letra (W-1 e K-1) (desde a OPERACOES-01 F4, decisão 281, o editor do formato 5 diz o texto novo, e o do formato 4,
que só roda contra a API anterior, mantém este) — e a situação da aprovação e o Aprovar/Reprovar na consulta ficam para essa fatia. O servidor é
a regra: a aprovação se dá em Aprovações. Feito na OPERACOES-01 F2 (decisão 279), § OPERACOES-01 › F2; a ajuda da
Geral é da F4 (decisão 281).

**Reversão:** API e web voltam por redeploy da versão anterior, sem tocar no banco. A 0041 fica e convive com a API
anterior (janela 1). Código: o binário anterior não confirma venda nem compra com TOP formato 4 — 409 "configuração
ilegível" (`TIPO_OPERACAO_EXECUCAO_INDISPONIVEL`), como hoje com formato desconhecido; no estoque ele não lê a
configuração, e quem barra o documento que exige aprovação é a guarda do banco (409 `CONFLICT`). Código: documento
lançado no binário anterior com TOP formato 4 fica sem exigências e sem condições permitidas, porque `regrasDaVersaoTop`
devolve nulo para formato desconhecido, e não confirma sozinho; o binário anterior também não edita TOP cuja versão
vigente está no formato 4 (422 `TIPO_OPERACAO_CONFIGURACAO_SCHEMA_NAO_SUPORTADO`: a escrita fecha). Documento confirmado
antes da reversão, pela automática ou depois de aprovado, continua confirmado, com os efeitos que deu. Banco: as
tabelas de aprovação NUNCA se apagam nem se esvaziam — são dado real (decisão 247), e o gatilho de TRUNCATE recusa até o
dono, com `CONFLICT: A decisão de aprovação não aceita TRUNCATE (uma decisão nova registra a mudança).`; declarado:
`TRUNCATE … CASCADE` de `erp.sales_documents`, `erp.documentos_compra` ou `erp.documentos_estoque` passa a ser recusado
com a mesma `CONFLICT`, porque o gatilho dispara também nas tabelas alcançadas pela cascata (nenhum script nem teste do
repositório faz TRUNCATE; o reset dos testes derruba o schema); desligar as guardas ou a conta só com uma migration
NOVA, por decisão do Maike — nunca editando a 0041. Nada de apagar dado de produção: documento se cancela, com estorno.

**Já na main e trazidas para esta branch (merge, sem rebase; base `1303de3`):** a #84 (decisão 275), a #86 (F3, só um
teste de outra fatia e a linha dela no TESTING) e a #87 (decisão 276, Central de Compras no motor da Central, F2, só
`apps/web` e documentos) entraram antes. Esta fatia não edita nenhum arquivo delas; os E2E daqui (W-3, W-4) só leem os
`data-testid` `central-vendas-*`, que o motor da Central mantém pelo prefixo, e foram rodados de novo depois de trazer
a main. Nenhuma das três tem migration: a contagem de migrations continua 41 (a 0041 por último), e os gerados foram
refeitos depois do merge.

**Merge depois da VISUAL-UX-04b (PR a abrir; número quando existir).** Motivo: o conserto dos dois detectores do
`apps/web/e2e/skew-web-anterior.spec.ts` (spec de outra fatia) que erram sobre o web da base no motor da Central — a
pílula de pendências só pelo literal `central-vendas-pendencias`, e não pelo prefixo do motor; e o vigia de requisições
que conta como bloqueio uma leitura que a própria página cancela ao trocar de tela — vai na VISUAL-UX-04b (correções da
Central de Compras, decisão 278), e não nesta PR: as duas não podem mudar o mesmo arquivo (PRE-PR-02). O ajuste que
esta branch tinha feito (`b1928e9`) saiu pelo commit de reversão `e1ab554`, e esta PR não muda mais esse spec (o diff
contra a main não o lista). A VISUAL-UX-04b também traz a consulta da compra que confere a situação antes de abrir o
diálogo (acima). Consequência declarada: até a VISUAL-UX-04b entrar e esta trazer a main, o job de Version skew desta
PR fica vermelho no sentido 2 sem defeito desta fatia — sobre o web da base `1303de3`, o A1-K2 (caso de outra fatia)
falha no detector, e os 14 casos seguintes do modo serial não rodam (CP-K2 e LD-K2 entre eles, que falham também se
rodarem sem o conserto do vigia); depois de trazer a main, o CI roda de novo no HEAD novo.

**Roteiro do Maike (cria TOPs e documentos reais; produção é operacional — decisões 240 e 247, nada é apagado):**
1. Configurações › Usuários e Permissões › Perfis e Permissões: dar "Aprovar" (Vendas, Compras e as quatro espécies de
   Estoque, conforme o caso) aos perfis que aprovam. O Administrador do sistema já recebeu as seis no pre-deploy; quem
   tem alguma vê o módulo Aprovações no menu.
2. Configurações › Operações › Tipos de Operação: abrir a TOP de pedido de compra (formato 3: Automática, Permitido,
   Permitida) e salvar — o diálogo "Estas regras passam a valer" mostra o que volta ao padrão ("Confirmação: Automática
   → Manual", "Documento sem itens: Permitido → Proibido", "Alteração após confirmar: Permitida → Bloqueada"); "Salvar
   assim mesmo" → versão nova no formato 4, no neutro (o pedido só aceita o neutro; nada passa a executar).
3. Criar as TOPs de venda, de compra e de estoque com Confirmação Automática e/ou Aprovação (Sempre; na venda e na
   compra também "A partir de um valor") e salvar — o histórico mostra "Regras gerais e aprovação: executadas". Com a
   VISUAL-UX-04b na main (a ordem de merge, acima), "Confirmar compra" na criação com a TOP de compra Automática abre a
   consulta em Confirmado, sem diálogo. Se esta entrar sem a VISUAL-UX-04b na main, com a TOP de compra Automática, use
   "Salvar" na criação da compra, não "Confirmar compra": o `POST` já confirma, e o "Confirmar compra" abriria o
   diálogo de confirmação sobre a compra já confirmada (a prévia recusa com "Compra já confirmada"; nada é duplicado).
4. Salvar um documento com a TOP Automática, sem aprovação → ele volta confirmado (estoque e financeiro como na
   confirmação manual; a Central de Estoque avisa "Salvo e confirmado.", e as de Vendas e de Compras, o "Salvo com
   sucesso" de hoje, com a consulta em Confirmado) (desde a OPERACOES-01 F2, decisão 279, as três avisam "Salvo e
   confirmado."). Com aprovação → fica aberto e aparece em Aprovações (aba Vendas,
   Compras ou Estoque; com a TOP Automática, a Central de Estoque avisa "Salvo. Este documento precisa de aprovação
   antes de ser confirmado."); Aprovar → com a TOP Automática, confirma no mesmo clique ("Aprovado e confirmado."); com
   a Manual, "Aprovado." e o Confirmar da consulta passa.
5. (Para desfazer a prova) cancelar os documentos: os confirmados são estornados. As decisões de aprovação ficam (só
   inserção).

**Gate externo em produção: PENDING (Maike)** — a sessão não tem acesso autenticado à produção. A conferência é SÓ DE
LEITURA, pela conexão operacional, depois do pre-deploy e antes do passo 2 do roteiro:

```sql
begin transaction read only;

-- 1. o ledger: 41 migrations, a última é a 0041
select count(*) as migrations, max(name) as ultima from public.erp_migrations;
--    esperado: 41 · 0041_regras_gerais_e_aprovacao_da_top.sql

-- 2. as três tabelas: RLS habilitada e FORÇADA, a política única, os privilégios do papel da API e o CHECK do motivo
select c.relname as tabela, c.relrowsecurity as rls, c.relforcerowsecurity as forcada,
       (select string_agg(p.policyname, ',') from pg_policies p
         where p.schemaname = 'erp' and p.tablename = c.relname) as politicas,
       has_table_privilege('erp_app', c.oid, 'select') as sel, has_table_privilege('erp_app', c.oid, 'insert') as ins,
       has_table_privilege('erp_app', c.oid, 'update') as upd, has_table_privilege('erp_app', c.oid, 'delete') as del,
       has_table_privilege('erp_app', c.oid, 'truncate') as trunc,
       (select pg_get_constraintdef(k.oid) from pg_constraint k
         where k.conrelid = c.oid and k.conname = 'chk_' || c.relname || '_reprovacao') as reprovacao
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'erp' and c.relname in ('aprovacoes_venda', 'aprovacoes_compra', 'aprovacoes_estoque')
 order by c.relname;
--    esperado: 3 linhas · rls e forcada true · politicas tenant_e_empresa · sel e ins true · upd, del e trunc false ·
--    reprovacao com observacao ~ '[^[:space:]]' (um caractere fora de [[:space:]]; nunca btrim)

-- 3. os gatilhos: 3 guardas, 3 de inserção, 3 de imutabilidade por linha, 3 de TRUNCATE (e os 3 de auditoria), todos
--    ligados ('O')
select c.relname as tabela, t.tgname as gatilho, t.tgenabled as ligado, p.proname as funcao,
       case when (t.tgtype & 1) = 1 then 'linha' else 'comando' end as nivel,
       (t.tgtype & 32) = 32 as no_truncate
  from pg_trigger t
  join pg_class c on c.oid = t.tgrelid
  join pg_proc p on p.oid = t.tgfoid
 where not t.tgisinternal
   and (t.tgname in ('trg_sales_documents_aprovacao', 'trg_documentos_compra_aprovacao',
                     'trg_documentos_estoque_aprovacao')
        or t.tgname like 'trg\_aprovacoes\_%')
 order by c.relname, t.tgname;
--    esperado: 15 linhas, todas 'O' — as guardas sales_documents → venda_aprovacao_guarda, documentos_compra →
--    documentos_compra_aprovacao_guarda e documentos_estoque → documentos_estoque_aprovacao_guarda; em cada tabela de
--    aprovação, _conferir → aprovacoes_<documento>_conferir, _imutavel e _imutavel_truncate → aprovacoes_imutavel e
--    _audit → audit_row; nivel 'comando' e no_truncate true SÓ nos três _imutavel_truncate (os outros 12: 'linha' e
--    false)

-- 4. a ordem dos BEFORE UPDATE por linha da venda: a guarda da aprovação primeiro, a versão (0039) por último
select array_agg(t.tgname::text order by t.tgname collate "C") as before_update
  from pg_trigger t
 where t.tgrelid = 'erp.sales_documents'::regclass and not t.tgisinternal
   and (t.tgtype & 1) = 1 and (t.tgtype & 2) = 2 and (t.tgtype & 16) = 16;
--    esperado: {trg_sales_documents_aprovacao, trg_sales_documents_classificacao_financeira,
--               trg_sales_documents_execucao_configurada, trg_sales_documents_versao}

-- 5. a conta: imutável, sem SECURITY DEFINER, search_path fixo; o papel da API executa e PUBLIC não
select p.provolatile as volatilidade, p.prosecdef as definer, p.proconfig as configuracao,
       has_function_privilege('erp_app', p.oid, 'execute') as erp_app,
       has_function_privilege('public', p.oid, 'execute') as publico
  from pg_proc p
 where p.oid = 'erp.top_exige_aprovacao(jsonb,numeric)'::regprocedure;
--    esperado: i · false · {"search_path=erp, pg_temp"} · true · false

-- 6. as seis permissões Aprovar: no catálogo, no Administrador do sistema e em nenhum outro perfil (ainda)
select p.key,
       (select count(*) from erp.role_permissions rp join erp.roles r on r.id = rp.role_id
         where rp.permission_key = p.key and r.is_system and r.name = 'Administrador') as administradores,
       (select count(*) from erp.role_permissions rp join erp.roles r on r.id = rp.role_id
         where rp.permission_key = p.key and not (r.is_system and r.name = 'Administrador')) as outros_perfis,
       (select count(*) from erp.roles r where r.is_system and r.name = 'Administrador') as perfis_administrador
  from erp.permissions p
 where p.key in ('sales.approve', 'compras.approve', 'entradas_estoque.approve', 'saidas_estoque.approve',
                 'transferencias_estoque.approve', 'ajustes_estoque.approve')
 order by p.key;
--    esperado: 6 linhas · administradores = perfis_administrador · outros_perfis 0 (até o passo 1 do roteiro)

-- 7. nenhuma versão de TOP no formato 4 antes de o Maike salvar
select configuracao_schema_version as formato, count(*) as versoes
  from erp.tipos_operacao_versoes
 group by 1
 order by 1;
--    esperado: nenhuma linha com formato 4 (até o passo 2 do roteiro)

rollback;
```

## ESTOQUE-01 — documento de estoque (0040)

Decisão 274. **Uma migration: `0040_documento_de_estoque.sql`** (pre-deploy, como a 0036; trava (2026,74),
`lock_timeout` 2 s, pré/pós-condições nomeadas `ESTOQUE-01: ...` — a primeira é "já aplicada" —, não destrutiva, sem
backfill): tabelas `erp.documentos_estoque` e `erp.documentos_estoque_itens` (vazias), com as quatro espécies
(`entrada`, `saida`, `transferencia`, `ajuste`), TOP obrigatória com FKs compostas, CHECKs por espécie no item,
gatilhos de conferência (família `estoque.<espécie>` da TOP, armazéns da empresa do documento, TOP e versão imutáveis),
de transição (aberto → confirmado, aberto → cancelado, confirmado → cancelado) e do item (só com o documento aberto),
RLS (cabeçalho com a política de empresa da 0015, módulo `estoque`; itens `api_child`), `erp.audit_row` no cabeçalho e
`revoke delete` do papel da API nas duas tabelas. As pós-condições conferem os objetos criados; não comparam contagens
de tabelas vivas. O ledger (`erp.stock_movements`, `erp.stock_balances`) NÃO muda: os movimentos usam tipos que já
existem, com `source_type` `documentos_estoque`. As permissões novas (`entradas_estoque.*`, `saidas_estoque.*`,
`transferencias_estoque.*`, `ajustes_estoque.*`, ações view/create/edit) não têm migration: o pre-deploy sincroniza o
catálogo e o Administrador as recebe; papel personalizado recebe pelo admin. Nenhuma variável nova.

**Pré-condição:** quem aplica a 0040 é o dono das funções SECURITY DEFINER e precisa atravessar RLS (superusuário ou
`BYPASSRLS`) — a própria migration recusa, com `ESTOQUE-01: o papel que aplica a migration (dono das funcoes SECURITY
DEFINER) nao atravessa RLS; ...`, e nada é aplicado. Também recusa se faltar dependência (a chave
`uq_warehouses_tenant` da 0036, a `uq_products_tenant`, as chaves da TOP e da versão, a chave composta de empresas, as
funções de RLS e auditoria, o módulo de escopo `estoque` ou o papel `erp_app`), sempre com a mensagem `ESTOQUE-01: ...`
que nomeia o que falta. Em erro, publique o nome do papel, nunca a conexão.

**Ordem: banco (0040) → API → web.** Janelas:
1. **API anterior × banco novo:** a API anterior não conhece as tabelas novas nem as permissões novas, e não as lê. As
   telas e rotas de estoque de hoje (`/stock/*`) seguem iguais; o ledger e o saldo não mudaram.
2. **web ANTERIOR × API nova:** a web anterior não tem a aba Movimentações nem a Central de Estoque; as abas antigas do
   `/estoque` (Visão geral, Estoque, Recebimentos, Operações…) e o "+ Novo" antigo seguem iguais. Um documento confirmado
   pela web nova aparece no ledger e no Saldo da web anterior como um movimento comum (origem `documentos_estoque`). O
   editor anterior da TOP OFERECE as quatro famílias novas (lê a lista da API) e manda o que conhece: efeito
   configurado nelas é recusado pela API nova (fora da matriz) e "Cliente em atraso" diferente de "não valida" também
   (422 no campo) — fail-closed, nada é gravado; salvar TOP de estoque com os valores neutros funciona. Na web anterior,
   `?tab=movimentacoes` continua levando ao ledger (o atalho antigo é dela); na web nova, essa aba é a lista do documento.
3. **web NOVA × API anterior:** sem `GET /api/estoque/documentos` (404), a aba Movimentações diz "Movimentações
   indisponíveis nesta versão do servidor" — sem lista vazia e sem "+ Novo" —, e o resto do `/estoque` (Visão geral,
   Saldo, ledger e as telas antigas) continua funcionando. A Central não tem como ser aberta pelo portal; aberta por
   URL, ela não encontra as TOPs de estoque (a API anterior responde 404 a `operation-types`) e não lança nada.

As três janelas são provadas no CI pelo job `skew` (ES-K1, `docs/TESTING.md`), contra os binários reais da base.

**Impacto em dados reais: nenhum dado muda; o Portal de Estoque ganha a aba Movimentações.** Tabelas novas, vazias;
nenhuma linha existente muda (produção, lida em 01/10/2026: nenhuma TOP de estoque, zero documento nas telas antigas,
1 armazém, 1 movimento). Para lançar o primeiro documento é preciso cadastrar uma TOP de estoque — até lá a aba mostra a
lista vazia e o "+ Novo" sem operação.

**Reversão:** API e web voltam por redeploy da versão anterior, sem tocar no banco. A 0040 fica: tabelas vazias (ou com
documentos já lançados) não afetam a API anterior. Documento confirmado antes da reversão continua com os movimentos no
ledger e o saldo que eles deram; a API anterior não o lê nem o cancela — reverter nesse estado é decisão do Maike. O
caminho inverso do banco, se um dia for preciso, é migration NOVA — nunca editar a 0040. Nada de apagar dado de
produção (decisão 247): documento se cancela, com estorno.

**Merge depois de #81: a 0039 entra antes da 0040.** Nesta branch a contagem de migrations é 39 (a 0039 é da #81);
depois do merge da #81 e da main trazida, os testes de contagem passam a 40 (quem entra depois refaz a contagem).

**Roteiro do Maike (cria documentos reais; produção é operacional — decisões 240 e 247, nada é apagado):**
1. Configurações › Tipos de operação: criar as TOPs "Entrada de estoque" (Movimento: Entrada de estoque) e "Ajuste de
   estoque (inventário)" (Movimento: Ajuste de estoque (inventário)) e salvar. O editor mostra "O movimento é definido
   pela espécie".
2. Estoque › Movimentações › Novo: escolher a TOP de entrada e lançar 1 unidade de um produto que controla estoque, com
   armazém e custo; salvar — o documento fica Aberto e o Saldo NÃO muda.
3. Na consulta, Confirmar: a prévia mostra o saldo de agora e o de depois; confirmar → Estoque › Saldo mostra a unidade.
4. Novo › TOP de ajuste: o mesmo produto e armazém com a contagem real; Confirmar — a prévia mostra a diferença; o saldo
   vira a contagem.
5. (Para desfazer a prova) cancelar o ajuste e a entrada, nessa ordem: os movimentos são estornados.

**Gate externo em produção: PENDING (Maike)** — a sessão não tem acesso autenticado à produção.

## COMPRAS-03 — layout do documento de compra (0038)

Decisão 269. **Uma migration: `0038_layout_do_documento_de_compra.sql`** (pre-deploy; trava (2026,72), `lock_timeout` 2 s,
pré/pós-condições nomeadas `COMPRAS-03: ...`, não destrutiva, sem backfill): o CHECK `chk_layouts_documento_familia`
de `erp.layouts_documento` passa a aceitar as duas famílias de compra (`compras.pedido` e `compras.compra`) ao lado
das três de venda — drop e add na MESMA instrução, sem instante sem o CHECK; o gatilho que confere "família da TOP =
família do layout" (`trg_layout_documento_tops_familia`, 0032) já era genérico e NÃO muda. E as funções SECURITY
DEFINER do documento de compra vivas depois da 0037 (enumeradas pelo catálogo na pré-condição) passam a
`search_path = erp, pg_temp` (padrão da 0033 e da 0035: `pg_catalog` implícito primeiro, `pg_temp` por último), por `ALTER FUNCTION` — corpo, dono, privilégios
e gatilhos ficam como estão (item 0 e). As pós-condições conferem objetos (o CHECK aceita exatamente as cinco
famílias; toda função definer de compras tem o `search_path` novo; o gatilho da família continua o da 0032); não
comparam contagens de tabelas vivas. Nenhuma variável nova, nenhuma permissão nova: o layout de compra se administra
com as capacidades da TOP (`tipos_operacao.*`) e a Central o lê com `pedidos_compra.create` / `compras.create`.

**Pré-condição:** quem aplica a 0038 é dono (ou membro do papel dono: `pg_has_role(..., 'USAGE')`) das funções de
compras e de `erp.layouts_documento` (ALTER TABLE e COMMENT), e o dono das funções atravessa RLS (superusuário ou
`BYPASSRLS`) — a própria migration recusa, com `COMPRAS-03: o dono de alguma funcao SECURITY DEFINER de compras nao
atravessa RLS; ...`, `COMPRAS-03: o papel que aplica a migration nao e dono das funcoes SECURITY DEFINER de
compras; ...` ou `COMPRAS-03: o papel que aplica a migration nao e dono de erp.layouts_documento; ...`, e nada é
aplicado. Também recusa se o gatilho da família não for o da 0032 (ausente, desligado, de outro tipo ou em outra
função), se o CHECK de família não for o da 0032, ou se a 0037 não terminou. Em erro, publique o nome do papel, nunca a conexão. A 0038 também
exige que as funções SECURITY DEFINER do schema `erp` que se chamam `documentos_compra%` ou leem `documentos_compra`
sejam EXATAMENTE as quatro da COMPRAS-01/02 (`documentos_compra_itens_documento_aberto`, `documentos_compra_conferir_v2`,
`documentos_compra_transicao_v2` e `documentos_compra_item_origem_guarda`). Qualquer outra — criada à mão, schema
divergente — para a migration com `COMPRAS-03: funcoes SECURITY DEFINER de compras diferentes das quatro esperadas
(...)`, que nomeia a função a mais, e nada é aplicado. O que fazer com essa função é decisão do Maike; a sessão não a
remove nem a altera.

**Ordem: banco (0038) → API → web.** Janelas:
1. **API anterior × banco novo:** a API anterior só cria layout das famílias de venda (a lista de famílias dela é a
   de vendas) e não lê layout de compra; o CHECK mais largo não muda nada do que ela grava ou lê. Os gatilhos de
   compras só mudaram o `search_path` — toda referência deles já era qualificada —, então lançar, receber, confirmar
   e cancelar seguem como na COMPRAS-02.
2. **web ANTERIOR × API nova:** o "Novo" do configurador anterior só oferece as famílias de venda, então nenhum layout
   de compra nasce por ele; sem layout de compra, a API nova cobra o layout do sistema — isto é, nada — e a Central de
   Compras anterior salva como hoje (ela não conhece `capacidades.layoutDocumento` e não pede `/layout-efetivo`). Se um
   layout de compra já existir (criado pela web nova), a lista de layouts da web anterior o mostra com o código cru da
   família e ela não tem catálogo para editá-lo: não o edite por ela (o servidor novo confere toda gravação com o
   catálogo de compra, então nada inválido é gravado). Com esse layout ligado, a Central anterior recebe do salvar o
   422 `LAYOUT_CAMPO_OBRIGATORIO`, que ela mostra pela mensagem e pelo caminho de `details`, como qualquer 422 de campo.
3. **web NOVA × API anterior:** sem `capacidades.layoutDocumento` em `operation-types`, a Central de Compras não pede
   `/layout-efetivo` e é a Central de hoje (sem campo governado, sem erro novo, Salvar como hoje); sem os três flags
   novos em `regras-da-operacao`, nenhum campo é forçado por eles — e sem layout nenhum campo está escondido. O
   lançador que escolhe a TOP primeiro e a TOP travada na Central valem com qualquer API (dependem só de
   `operation-types`, que a API anterior já responde). O configurador novo oferece as famílias de compra, mas a API
   anterior recusa criar layout de compra (422 na família): nada é gravado; e o filtro do Movimento **Compra** na lista
   de layouts chama a API anterior com `familia=compras.*`, que ela recusa — a grade mostra o 422 (os filtros de venda
   seguem normais). Na lista de TOPs, as TOPs de compra mostram "Layout do documento: indisponível" (a API anterior não
   responde o layout efetivo de compra); as de venda, como hoje.

**Impacto em dados reais:** o CHECK de família dos layouts passa a aceitar as duas famílias de compra; nenhum dado muda.

**Reversão:** API e web voltam por redeploy da versão anterior, sem tocar no banco. A 0038 fica: o CHECK mais largo e o
`search_path` novo não mudam o que a API anterior faz. Com layout de compra já gravado, a API anterior não o lê nem o
cobra (a Central de Compras volta a salvar sem layout) e não o edita (a família não está no catálogo dela). Voltar o
CHECK às três famílias de venda só é possível sem layout de compra gravado e é decisão do Maike — com migration NOVA,
nunca editando a 0038. Nada de apagar dado de produção (decisão 247): para tirar um layout de compra de uso, desligue
as TOPs dele (a Central volta ao layout do sistema) ou desative-o; o layout fica guardado.

**Roteiro do Maike (produção é operacional — decisões 240 e 247; a prova não precisa gravar documento):**
1. Configurações › Operações › Layouts de documento › Novo → Movimento **Compra** → nome → criar a partir do layout
   do sistema.
2. No configurador: tirar um campo (por exemplo, Transportadora), marcar **Observação** como obrigatória, pôr um
   **Fornecedor** como valor padrão (padrão de cadastro) e salvar. Em "TOPs ligadas", ligar a TOP **Compra** e salvar.
3. Compras › Documentos › Novo → TOP **Compra**: a Central de Compras mostra o layout — a Transportadora não aparece, a
   Observação tem "*", o Fornecedor vem preenchido e a TOP aparece travada ("Tipo de Operação").
4. Salvar sem Observação recusa no campo, e nada é gravado. (Para desfazer a prova: desligue a TOP do layout.)

**Gate externo em produção: PENDING (Maike)** — a sessão não tem acesso autenticado à produção.

## COMPRAS-02 — receber o pedido de compra (0037)

Decisão 268. **Uma migration: `0037_receber_pedido_de_compra.sql`** (pre-deploy; trava (2026,71), `lock_timeout` 2 s,
pré/pós-condições nomeadas `COMPRAS-02: ...`, não destrutiva, sem backfill): em `erp.documentos_compra`, a origem da
compra (`origem_documento_id`, FK composta com a organização para a própria tabela, só na compra) e o encerramento do
saldo do pedido (`saldo_encerrado_em`, `saldo_encerrado_por`, `saldo_encerrado_motivo`, os três juntos, só no pedido
convertido); a situação `convertido` (só no pedido) nos CHECKs de situação; em `erp.documentos_compra_itens`, a chave
`(id, organization_id)` e `origem_item_id` (FK composta para a própria tabela); os gatilhos de conferência e de
transição trocados por funções novas (`_v2`, mesmos nomes de gatilho) e o gatilho da origem
`trg_documentos_compra_itens_origem_guarda` (mesmo pedido, mesmo produto, soma ≤ quantidade, item de origem travado).
As pós-condições conferem os objetos criados; não comparam contagens de tabelas vivas. Nenhuma variável nova, nenhuma
permissão nova (o recebimento usa `pedidos_compra.edit` e `compras.create`, que já existem).

**Pré-condição:** quem aplica a 0037 é o dono das funções e precisa atravessar RLS (superusuário ou `BYPASSRLS`) — a
própria migration recusa, com `COMPRAS-02: o papel que aplica a migration (dono das funcoes SECURITY DEFINER) nao
atravessa RLS; ...`, e nada é aplicado. Em erro, publique o nome do papel, nunca a conexão.

**Ordem: banco (0037) → API → web.** Janelas:
1. **API anterior × banco novo:** a API anterior não lê nem grava as colunas novas. A compra que ela lança não tem
   origem, e o gatilho da origem exige justamente item sem origem nesse caso — que é o que ela grava. Nenhum pedido
   vira convertido sem a API nova, e nenhum pedido tem compra ligada, então cancelar pedido e compra segue como hoje.
2. **web ANTERIOR × API nova:** a web anterior não mostra Próximos passos, Recebido, Saldo nem compras geradas; a
   consulta do pedido e a Central de Compras seguem como na COMPRAS-01 (os campos novos das respostas são aditivos).
   O editor anterior da TOP já tem a aba "Próximas operações" genérica: para a TOP de Pedido de compra ela passa a
   listar as TOPs de Compra (a API nova as devolve em `/destinos-possiveis`), e salvar grava a aresta — sem efeito até
   a web nova, que é quem oferece o recebimento. O aviso do editor anterior para política não declarada ("segue o
   caminho anterior do produto") não vale para compras: sem política declarada, o pedido de compra não tem próximo
   passo. Pedido recebido pela web nova e aberto na anterior mostra a situação `convertido` sem o rótulo e a cor novos.
3. **web NOVA × API anterior:** sem `GET /api/compras/pedidos/:id/proximos-passos` (404), o card Próximos passos da
   consulta do pedido diz "indisponível nesta versão do servidor" e a consulta segue funcionando; sem `recebido` e
   `saldo` nos itens, as colunas novas não têm o que mostrar. Nada é gravado: o recebimento só é oferecido a partir
   do leque, que não chega.

**Impacto em dados reais:** colunas novas, vazias; nenhum dado muda.

**Reversão:** API e web voltam por redeploy da versão anterior, sem tocar no banco. A 0037 fica: colunas nulas e os
gatilhos novos não mudam o que a API anterior faz (compra sem origem, pedido sem compra ligada). Com recebimentos já
feitos, a API anterior lê pedido e compra sem a ligação, mas o banco continua valendo: ela não cancela pedido com
compra ligada viva (o banco recusa) nem pedido convertido, e não reabre o pedido convertido ao cancelar uma
compra — reverter nesse estado é decisão do Maike. O caminho inverso do banco, se um dia for preciso, é
migration NOVA — nunca editar a 0037. Nada de apagar dado de produção (decisão 247).

**Roteiro do Maike (cria documentos reais; produção é operacional — decisões 240 e 247, nada é apagado):**
1. Configurações › Tipos de operação: criar a TOP "Pedido de compra" (Movimento: Pedido de compra), se ainda não
   existir. Na aba Próximas operações dela: "Compra", com "Em partes"; salvar.
2. Compras › Documentos › Novo: escolher a TOP "Pedido de compra" e lançar um pedido de 10 un de um produto que
   controla estoque; salvar.
3. Na consulta do pedido, Próximos passos › Compra: a Central abre em modo receber pedido. Receber 4 (nota, série,
   data de entrada, armazém) → salvar → na consulta da compra, Confirmar → o pedido mostra Recebido 4 e saldo 6.
4. Receber os 6 do mesmo jeito → o pedido vira Convertido.

**Gate externo em produção: PENDING (Maike)** — a sessão não tem acesso autenticado à produção.

## COMPRAS-01 — documento de compra (0036)

Decisão 267. **Uma migration: `0036_documento_de_compra.sql`** (pre-deploy; trava (2026,70), pré/pós-condições
nomeadas `COMPRAS-01: ...`, não destrutiva, sem backfill): tabelas `erp.documentos_compra` e
`erp.documentos_compra_itens` (vazias), gatilhos de transição de situação e de item só com documento aberto, unique
parcial da nota da Compra não cancelada, RLS (cabeçalho com a política de empresa da 0015, módulo `compras`; itens
`api_child`), `erp.audit_row` no cabeçalho, `revoke delete` do papel da API nas duas tabelas e a chave
`(id, organization_id)` em `erp.warehouses` (alvo da FK composta do armazém do item). A forma de pagamento tem FK
simples e gatilho de organização: `erp.payment_methods` tem linhas globais (`organization_id` nulo), que uma FK
composta recusaria. As pós-condições
conferem os objetos criados; não comparam contagens de tabelas vivas. As permissões novas (`pedidos_compra.*`,
`compras.*`) não têm migration: o pre-deploy sincroniza o catálogo. Nenhuma variável nova.

**Ordem: banco (0036) → API → web.** Janelas:
1. **API anterior × banco novo:** a API anterior não conhece as tabelas novas nem as permissões novas; o
   `POST /stock/invoices` anterior não confere nota em Compra, mas não existe Compra ainda. Tudo como hoje.
2. **web ANTERIOR × API nova:** a web anterior não tem a aba Documentos de Compras nem a Central de Compras; o
   Documento fiscal de Estoque segue igual, com a única diferença de recusar (409 `DUPLICATE_DOCUMENT`) a nota que já
   está numa Compra. O editor anterior da TOP OFERECE as famílias de compra (lê a lista da API) e manda o "Cliente em
   atraso" que conhece; a API nova recusa, nas duas famílias de compra, valor ≠ "não valida" (422 no campo) — fail-closed,
   nada é gravado. Salvar TOP de compra com o valor neutro funciona.
3. **web NOVA × API anterior:** sem `GET /api/compras/documentos`, a aba Documentos mostra "indisponível nesta versão
   do servidor"; "Processos" e "Visão geral" de Compras continuam funcionando.

**Impacto em dados reais:** tabelas novas, vazias. Chave (id, organization_id) nova em armazéns, sem mudar dado. Permissões novas: o Administrador recebe; papel personalizado recebe pelo admin. Nenhum dado existente
muda.

Nota: a missão previa a chave nova também em formas de pagamento; ela não foi criada porque `erp.payment_methods`
tem formas globais (sem organização), que uma FK composta não aceitaria — lá a forma do documento é conferida por FK
simples e por um gatilho que só aceita forma global ou da mesma organização.

**Reversão:** API e web voltam por redeploy da versão anterior, sem tocar no banco. A 0036 fica: tabelas vazias (ou
com as compras já lançadas) não afetam a API anterior. Compra confirmada antes da reversão continua com a entrada e os
títulos no ledger; a API anterior não a lê nem a cancela — reverter nesse estado é decisão do Maike. O caminho inverso
do banco, se um dia for preciso, é migration NOVA — nunca editar a 0036. Nada de apagar dado de produção (decisão 247).

**Roteiro do Maike (cria documentos reais; produção é operacional — decisões 240 e 247, nada é apagado):**
1. Configurações › Tipos de operação: criar a TOP "Compra" (Movimento: Compra) e salvar.
2. Compras › Documentos › Novo: escolher a TOP "Compra" e lançar uma compra de um produto que controla estoque, com
   armazém, natureza de despesa, centro, condição de pagamento e frete; salvar.
3. Na consulta da compra, Confirmar (conferir a prévia: entrada com o custo rateado e as parcelas).
4. Conferir Estoque › Saldo (a entrada com o custo, frete incluído) e Financeiro › Pagar (as parcelas do fornecedor).

**Aviso:** a mesma nota não entra pelos dois caminhos. Nota (fornecedor, número e série) lançada numa Compra é
recusada no Documento fiscal de Estoque, e vice-versa (409 dizendo onde ela já está). Escolha um caminho por nota.

**Gate externo em produção: PENDING (Maike)** — a sessão não tem acesso autenticado à produção.

## TOP-CONFIG-07 — reserva de estoque (0035)

Decisão 266. **Uma migration: `0035_reserva_de_estoque.sql`** (pre-deploy; trava (2026,69), `lock_timeout` 2 s,
pré/pós-condições nomeadas `TOP-CONFIG-07: ...`, não destrutiva, sem backfill): coluna `reserva_estoque` nas versões
da TOP (default false; o gatilho `trg_tipos_operacao_versoes_reserva_familia` só a aceita ligada na família pedido),
a conta do reservado `erp.reserva_estoque_nucleo` (só produto com controle de estoque; sem `execute` para o papel da API), a porta exposta
`erp.reserva_estoque` (`SECURITY DEFINER`, `execute` só para o papel da API, capacidade conferida dentro), o gatilho
de saída `trg_stock_movement_reserva` (AFTER INSERT em `erp.stock_movements`, depois de `trg_stock_movement_apply`) e
o índice parcial `ix_sales_document_items_reserva` e o gatilho `BEFORE UPDATE OF control_stock` em `erp.products`, que
recusa trocar "Controla estoque" de produto citado por pedido com reserva vivo (ou venda aberta gerada dele). As pós-condições conferem que nenhuma versão nasceu reservando e
que as contagens de versões, movimentos, saldos e documentos e a quantidade total em estoque não mudaram. Nenhuma
variável nova, nenhuma permissão nova.

**Pré-condição:** quem aplica a 0035 é o dono das funções e precisa atravessar RLS (superusuário ou `BYPASSRLS`) — a
própria migration recusa, com `TOP-CONFIG-07: o papel que aplica a migration (dono das funcoes) nao atravessa RLS`,
e nada é aplicado. Em erro, publique o nome do papel, nunca a conexão.

**Ordem: banco (0035) → API → web.** Janela:
1. **API anterior × banco novo:** a API anterior não lê nem grava a coluna nova; versão de TOP salva por ela nasce sem
   reserva (default). O gatilho de saída roda, mas não recusa nada: nenhuma versão reserva, o reservado é zero.
   Tudo como hoje.
2. **web ANTERIOR × API nova:** o editor anterior não manda `reservaEstoque` — a API preserva o valor da versão atual;
   nada é desligado em silêncio. A Central anterior não marca o armazém como obrigatório: com a reserva ligada, item de
   produto com controle de estoque sem armazém volta 422 (serviço e produto sem controle ficam fora da reserva) — por isso ligar a caixa só com a web nova no ar. Os campos novos das respostas
   (`reservado`, `disponivel`, `reserva_estoque`) são aditivos.
3. **web NOVA × API anterior:** sem `reservaEstoque` nas capabilities da TOP, o editor esconde a caixa; sem
   `reservaEstoque` nas regras da operação, a Central não exige armazém; sem `reserva_estoque` no documento, nada de
   reserva aparece nele. O físico continua em `quantity`; `reservado` e `disponivel` só vêm da API nova.

**Impacto em dados reais:** coluna nova desligada em toda versão; nenhum saldo muda; nenhuma saída que passa hoje
passa a ser recusada, porque não existe pedido reservando; pela mesma razão, nenhuma troca de "Controla estoque" no
cadastro de produto (nem a da importação) é recusada pelo gatilho novo.

**Reversão:** API e web voltam por redeploy da versão anterior, sem tocar no banco. A 0035 fica: o gatilho não recusa
nada enquanto nenhuma versão reservar. Com a reserva já ligada e pedido reservando, o gatilho continua valendo sob a
API anterior (saída que invade a reserva volta 409 `INSUFFICIENT_STOCK`), mas a API anterior salva pedido sem conferir
o disponível — reverter nesse estado é decisão do Maike (antes, desligar a caixa na TOP; pedido já salvo continua
reservando pela versão congelada até ser faturado, cancelado ou ter o saldo encerrado). O caminho inverso do banco, se
um dia for preciso, é migration NOVA que desliga o gatilho e as funções — nunca editar a 0035. Nada de apagar dado de
produção (decisão 247).

**Roteiro do Maike (opcional; cria documentos de teste, que ficam cancelados):** produção é operacional (decisões
240 e 247) — nada criado no teste é apagado.
1. Na TOP 2 Pedido, ligar "Reservar estoque ao salvar o pedido" (aba Estoque) e salvar.
2. Criar um Pedido NOVO (a versão congelada tem de ser a nova) com armazém nos itens, de produto com saldo nesse
   armazém; incluir também o produto sem controle de estoque que já existe em produção, SEM armazém — o pedido salva e
   ele não reserva nada.
3. Ver o disponível cair na Central (coluna Estoque do mesmo produto e armazém) e em Estoque › Saldo ("Reservado no
   armazém" / "Disponível no armazém").
4. Cancelar o pedido e ver o disponível voltar.

Se os pedidos novos não devem reservar, desligar a caixa de novo na TOP 2 (versão nova; as de teste ficam no
histórico, imutável). **Gate externo em produção: PENDING (Maike)** — a sessão não tem acesso autenticado à produção.

## TOP-CONFIG-06 — faturar em partes (0034)

Decisão 265. **Uma migration: `0034_faturar_em_partes.sql`** (pre-deploy; trava (2026,68), `lock_timeout` 2 s,
pré/pós-condições nomeadas `TOP-CONFIG-06: ...`, não destrutiva, sem backfill): `em_partes` nas arestas das próximas
operações (default false), `origem_item_id` nos itens de venda (FK para o item de origem, índice parcial), três colunas de
saldo encerrado no documento (com CHECK), índice parcial em `origin_document_id` e o gatilho do saldo
(`trg_sales_document_items_origem_guarda`). Nenhuma variável nova, nenhuma permissão nova.

**Ordem: banco (0034) → API → web.** Janela:
1. **API anterior × banco novo:** a API anterior não lê nem grava as colunas novas; o gatilho só age em item com origem,
   que ela nunca grava. Tudo como hoje.
2. **web ANTERIOR × API nova:** o web anterior manda arestas sem `emPartes` — a API preserva o valor da versão atual; a
   conversão sem `itens` é a de hoje. Nada é desligado em silêncio.
3. **web NOVA × API anterior:** sem `destinos.emPartes` nas capabilities, o editor esconde a caixa; sem `emPartes` nos
   próximos passos, o diálogo de conversão é o de hoje.

**Impacto em dados reais:** colunas novas; toda aresta existente fica sem "Em partes", então nada muda no que existe.
A produção não tem documento de venda.

**Reversão:** API e web voltam por redeploy; as colunas e o gatilho ficam, inertes para o binário anterior. Documento já
convertido em partes continua com a ligação gravada; a API anterior converte e cancela como antes (sem saldo) — não
reverter com partes em uso sem decisão do Maike. Nada de apagar dado de produção (decisão 247).

**Roteiro do Maike (opcional; cria documentos de teste, que ficam cancelados):**
1. Criar a TOP de Venda no editor novo.
2. Na TOP 2 Pedido, em Próximas operações, pôr a Venda com "Em partes".
3. Criar um Pedido NOVO com 2 itens (a versão congelada tem de ser a nova).
4. Converter uma parte → ver Faturado e Saldo.
5. Converter o resto → 'Convertido'.
6. Cancelar uma parte → o saldo volta e o pedido reabre.
7. No fim, encerrar o saldo (pede uma parte ativa e saldo > 0) e cancelar a parte que sobrou — o pedido continua
   encerrado.

## TOP-CONFIG-05_R2 — venda com TOP no formato 3 confirma (sem migration)

**Só API**: sem migration, sem rota, sem variável, sem permissão, sem mudança de tela. A confirmação de venda passa
a gravar a marca da 0023 (`app.venda_execucao_configurada`) também quando a versão congelada é do formato 3 com os
dois efeitos em legado — o neutro do formato 3. Antes, a guarda do banco tratava essa versão como "formato que este
banco ainda não conhece" e recusava a confirmação. A guarda não muda.

**Impacto em dados reais:** nenhum dado muda. Venda com TOP no formato 3 passa a confirmar; a produção ainda não tem
TOP de Venda.

**Reversão:** redeploy da API anterior (a venda com TOP no formato 3 volta a ser recusada na confirmação, sem efeito
parcial).

## TOP-CONFIG-05 — restrições comerciais e fiscal configurado na TOP (0033)

Decisão 263; contrato em `docs/TIPO-OPERACAO-CONTRACT.md` §13. **Uma migration: `0033_tipo_operacao_restricoes.sql`**
(pre-deploy; trava (2026,67), `lock_timeout` 2 s, pré/pós-condições nomeadas `TOP-CONFIG-05: ...`, não destrutiva,
sem backfill): tabela nova `erp.tipos_operacao_versao_condicoes` (**VAZIA**) e a função `erp.situacao_atraso_cliente`
(porta estreita, `SECURITY DEFINER`, `execute` só para o papel da API). Nenhuma linha existente muda. Nenhuma
variável nova; o gate da 04A continua como está.

**Pré-condição:** quem aplica a 0033 é o dono da função e precisa atravessar RLS (superusuário ou `BYPASSRLS`) — a
própria migration recusa, com `TOP-CONFIG-05: o papel que aplica a migration (dono da funcao) nao atravessa RLS`,
e nada é aplicado. Em erro, publique o nome do papel, nunca a conexão.

**Ordem: banco (0033) → API → web.** Janela:
1. **API anterior × banco novo:** a API anterior ignora a tabela e a função; tudo como hoje.
2. **web ANTERIOR × API nova:** a web anterior não conhece `restricoes` (capabilities da TOP) nem
   `capacidades.regrasDaOperacao`: o editor segue gravando o formato 2 e a Central é a de hoje. PUT sem
   `condicoesPermitidas` PRESERVA a lista. Nenhuma regra nova executa, porque nenhuma TOP está no formato 3.
3. **API nova × web nova, TOPs antigas:** as TOPs continuam no formato 2 (e sem restrição) até alguém salvá-las no
   editor novo — só então nasce uma versão formato 3.
4. **web NOVA × API anterior:** sem `restricoes` o editor é o de hoje (formato 2, nenhuma chave nova visível); sem
   `regrasDaOperacao` a Central é a de hoje, sem pedido novo no fio.

**Reversão:** API e web voltam por redeploy; a tabela (vazia ou não) e a função ficam, inertes para o binário
anterior. Nada de apagar dado de produção (decisão 247). **Atenção:** a API anterior só lê os formatos 1 e 2 — TOP
já salva no formato 3 fica ilegível para ela até a API nova voltar, e o formato não retrocede. Reverter a API depois
do roteiro abaixo exige essa decisão consciente do Maike.

**Roteiro do Maike em produção (depois do deploy) — SEM salvar documento.** Estado de partida (produção): TOP 1
Orçamento no formato 2 com "Exigir observação" = SIM; TOP 2 Pedido no formato 2 com "Exigir parceiro", "Exigir
centro de resultado" e "Exigir observação" = SIM; 0 condições de pagamento, 0 títulos, 0 documentos de venda.
1. Cadastros › Condições de pagamento: cadastrar UMA condição (ex.: "À vista") — hoje não existe nenhuma.
2. Configurações › Operações › Tipos de Operação › TOP 2 Pedido › editar:
   - marcar "Exige transportadora";
   - em Condições permitidas, adicionar a condição do passo 1;
   - Salvar → abre a confirmação "Estas exigências passam a valer", listando Cliente, Centro de resultado,
     Observação (nada é gravado antes da resposta);
   - para NÃO exigir observação em todo Pedido: "Voltar e revisar", desmarcar "Exigir observação" e salvar de novo
     (a confirmação lista então Cliente e Centro de resultado) → "Salvar assim mesmo" → versão nova no formato 3.
3. Central, novo Pedido com a TOP 2: "Transportadora" com "*" (aparece mesmo se o layout não a mostra) e o campo
   Condição de pagamento oferece só a condição permitida. **NÃO salvar o documento.**
4. Restaurar: editar a TOP 2, desmarcar "Exige transportadora" e esvaziar a lista (volta a "Todas as condições");
   salvar. A TOP continua no formato 3 (o formato não retrocede) com as exigências da Geral que ficaram marcadas.
   As versões de teste ficam no histórico (imutável).
5. TOP 1 Orçamento tem "Exigir observação" = SIM: a mesma confirmação aparecerá na primeira vez em que ela for
   salva no editor novo. Decidir ali — manter (passa a ser cobrada) ou "Voltar e revisar" e desmarcar.

**Impacto em dados reais:** tabela nova vazia; função sem efeito de escrita; nenhuma TOP muda sozinha — 1 Orçamento
e 2 Pedido seguem no formato 2 até serem salvas no editor novo, e o primeiro salvar que as leva ao formato 3 com
exigência da Geral marcada pede confirmação antes de gravar (Orçamento: Observação; Pedido: Cliente, Centro de
resultado, Observação). O roteiro acima cria uma condição de pagamento e versões da TOP 2 (a última no formato 3,
sem as opções do teste, com as exigências da Geral que ficaram marcadas) e nenhum documento. **Gate externo em produção: PENDING (Maike)** — a sessão não tem acesso
autenticado à produção.

## VENDAS-A3-1b — padrão de cadastro no layout e exportar/importar (sem migration)

Decisão 260. **Sem migration, sem variável, sem permissão e sem capacidade nova.** Layout que já existe continua
igual: nenhum tem padrão de cadastro até o administrador pôr um. O servidor NÃO aplica padrão ao gravar documento.

**Ordem: API → web** (qualquer ordem é segura). Janela:
1. **web ANTERIOR × API nova:** o `layout-efetivo` devolve a estrutura SEM o padrão de cadastro (o registro vai só
   no mapa `padroesDeCadastro`, que a web anterior ignora) — a Central abre como hoje e o documento nasce como hoje.
2. **web NOVA × API anterior:** sem `padroesDeCadastro` na resposta, a Central é a de hoje; no editor, a opção
   "Registro do cadastro" é recusada pela API anterior ao gravar, e Exportar/Importar respondem erro legível (as
   rotas não existem nela).

**Reversão:** API e web voltam por redeploy, sem tocar no banco. **Antes de reverter a API, tirar o padrão de
cadastro dos layouts que o tenham (ou inativá-los):** a API anterior devolve a estrutura crua no `layout-efetivo`,
com o `{tipo:"registro"}` dentro, e a Central ANTERIOR não conhece esse tipo — poria um texto inválido no campo, e o
documento seria recusado ao salvar (422 no campo). A Central nova ignora o tipo e abre como hoje, então o risco só
existe com a web anterior no ar. A API anterior também recusa regravar um layout que ainda tenha o padrão
(validador de antes, 422 no caminho).

**Roteiro do Maike (depois do deploy) — no PEDIDO (TOP 2), sem gravar documento:**
1. Configurações › Operações › Layouts de documento › Novo (Pedido), um layout de TESTE: em "Natureza", Configurar
   campo › Valor padrão "Registro do cadastro", escolher uma natureza analítica de receita, desmarcar "Editável";
   salvar; ligar à TOP 2 Pedido.
2. Central com a TOP 2: a Natureza vem preenchida e travada. Não salvar o documento.
3. Na lista de layouts, "Exportar" o layout de teste; "Importar" o arquivo baixado → nasce "… (importado)", sem TOP
   e não padrão, com a Natureza padrão mantida (mesma organização).
4. No fim: desligar a TOP 2 do layout de teste (ou religá-la ao layout anterior) e INATIVAR os dois layouts (o de
   teste e o importado).

## VENDAS-A3-1d_R1 — correções do configurador de layout (sem migration)

**Só web**: sem migration, sem rota, sem variável, sem permissão. Três correções da revisão da A3-1d:
(1) com o rascunho sujo, "Abrir na Central" fica desligado, com a frase "Salve o layout para ver as mudanças na
Central." — a navegação do cliente não passa pela proteção de aba suja e descartava o rascunho em silêncio;
(2) na tela de Configurações a seleção mora no endereço (`&layout=<id>`): voltar da Central reabre o mesmo layout;
id que a API não encontra é ignorado sem mensagem e sai do endereço; (3) o texto da faixa de versão nova passa a
morar na casca (`components/layout/versao-nova.tsx`), que deixa de depender da tela de administração.

**Impacto em dados reais: nenhum.** (nenhuma gravação nova)

**Reversão:** redeploy do web anterior.

**Roteiro do Maike (1 minuto, produção de hoje: layout 0001 ligado à TOP 1 Orçamento):**
1. Layouts de documento → selecionar o 0001 → mexer num campo sem salvar → "Abrir na Central" desligado, com a frase.
2. Salvar → vira link → clicar → a Central mostra a mudança.
3. Voltar do navegador → o 0001 continua selecionado, com a área aberta.
4. Restaurar: desfazer a mudança e salvar.

## VENDAS-A3-1d — configurador organizado (tela única) e o fim do "não salva" (sem migration)

Decisão 262. **Só web**: sem migration, sem rota nova, sem variável, sem permissão, sem mudança de API. Deploy do web
sozinho; a API continua a da A3-1c. **Reversão:** redeploy do web anterior (nada gravado muda de forma).

Na publicação da A3-1d, quem já estava com a aba aberta precisou recarregar (F5) uma vez: a aba antiga não tinha o código da faixa. A partir da publicação seguinte (TOP-CONFIG-05), a faixa aparece sozinha. A faixa ("Saiu uma versão nova do sistema", a casca compara o `sha`
de `GET /api/build`) oferece "Atualizar agora". Sem o sha do provedor (local, CI), a faixa nunca aparece.

**Roteiro do Maike (depois do deploy), sem gravar documento:**
0. Na publicação da A3-1d, quem já estava com a aba aberta precisou recarregar (F5) uma vez: a aba antiga não tinha o código da faixa. A partir da publicação seguinte (TOP-CONFIG-05), a faixa aparece sozinha. Com a faixa na tela, clicar em "Atualizar agora".
1. Configurações › Operações › Layouts de documento: a grade mostra o "Em uso" real de cada layout ("Não está em uso"
   em destaque quando não vale para nenhuma TOP).
2. Selecionar o 0001 → a área abre logo abaixo, já editável; o status diz se ele está em uso → "Visualizar TOPs" →
   selecionar a TOP 1 Orçamento → "Mover →" → Salvar → o status passa a "Em uso nas TOPs: 1 · Orçamento".
3. "Abrir na Central" ao lado da TOP → no topo de Dados principais: "Layout: 0001… (ligado à TOP)", e os campos que o
   layout tirou não aparecem.
4. No fim, se o Maike quiser: desligar a TOP (Visualizar TOPs → "← Remover" → Salvar) ou inativar o layout.

## VENDAS-A3-1c — configurador visual do layout e "Movimento" (sem migration)

Decisão 261. **Sem migration, sem variável, sem permissão, sem capacidade nova.** Layout que já existe continua igual (sem
`grupo` = regra de antes: Proprietário em Dados adicionais). **Ordem: API → web** (qualquer ordem é segura: o `grupo` é
opcional; a web anterior ignora a chave e desenha como hoje; a API anterior recusa (422) layout gravado com `grupo`, então
só use o configurador novo depois da API nova no ar).

**Reversão:** API e web voltam por redeploy. Layout gravado com campo fora da zona do sistema ou com `grupo` continua
legível para a API anterior, mas a Central anterior desenha o campo onde ele está no JSON; antes de reverter a API,
confira os layouts editados na página nova.

**Roteiro do Maike (depois do deploy), sem gravar documento:**
1. Configurações › Operações › Layouts de documento › abrir o layout "teste" (Orçamento) → abre a PÁGINA com a prévia.
2. Editar → arrastar "Vencimento" para a aba "Financeiro" → Salvar.
3. Central de Orçamento com uma TOP ligada a esse layout: "Vencimento" aparece na aba Financeiro, não no cabeçalho.
4. No fim: inativar o layout de teste.

## Checklist de go-live
- [x] Migrations aplicadas e `erp_app` sem privilégio de bypass RLS (verificado: `rolbypassrls=false`, 171 tabelas com RLS forçada, 187 políticas)
- [x] Autenticação: `AUTH_MODE=local` com `LOCAL_AUTH_SECRET` aleatório (Supabase Auth: evolução)
- [x] CORS (`WEB_ORIGIN`) apontando para os domínios declarados em "## Superfície web"
- [ ] Backups automáticos do Supabase ativos (plano do projeto) — **e restaurados pelo menos uma vez**.
  **`BLOCKED` desde 23/09/2026**: o primeiro uso real foi decidido (GO-LIVE-01), a condição de retorno de P1
  disparou e esta caixa é o item **G4** de "Go-live — checklist de entrada em uso real". Recuperação:
  RESTORE; `REBUILD FROM ZERO` proibido em produção.
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

## CADASTROS FASE 7 — Tela de árvore e caminho nos campos de busca (sem migration)

Decisão 256. **Sem migration, sem variável nova.** API e web podem subir em qualquer ordem:

- **Web nova × API anterior:** as opções vêm sem `caminho`/`kind` e o campo mostra o rótulo de sempre; a tela de
  árvore usa só rotas que já existem (`GET /resources/:key`, `proximo-codigo`, `PUT`). O recorte de analítico da
  tela usa o filtro por coluna que a API anterior já aceitava.
- **Web anterior × API nova:** as opções trazem dois campos a mais, ignorados; a busca passa a achar também pelo
  código. A API nova passa a RECUSAR (422) rateio com natureza ou centro sintético e produto com grupo, natureza de
  custo ou centro padrão sintético — a web anterior já não oferecia sintético nesses campos, então o 422 só aparece
  para quem chama a API direto ou reenvia um rateio antigo.
- **Reverter:** voltar o binário; nada no banco muda.

**Impacto em dados reais — medir ANTES, em leitura:** título ou movimento com rateio sintético já gravado continua
legível, mas a EDIÇÃO do rateio passa a exigir analítico:
`select count(*) from erp.title_apportionments a join erp.financial_categories c on c.id=a.financial_category_id where c.kind<>'analytic';`
(idem com `cost_centers` e com `bank_movement_apportionments`), e
`select count(*) from erp.products where deleted_at is null and (financial_category_id in (select id from erp.financial_categories where kind<>'analytic') or default_cost_center_id in (select id from erp.cost_centers where kind<>'analytic'));`
— produto nessa situação continua editável em outros campos; só a troca do valor é conferida.

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
