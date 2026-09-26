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
   `OK` liga o gate sozinho.
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
→ CBO "621005" → Ocupação (CBO) "Trabalhador agropecuário em geral" e Código CBO "621005" separados. **Não apagar
nada criado no teste** (decisão 247): usar um parceiro de teste já existente ou inativá-lo depois.

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
