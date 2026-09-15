# Preflight da PRE-BASE2-05C-1 — o que precisa ser provado ANTES da purga destrutiva

Este documento é para **executar**, não para consultar. Ele existe porque a 05C-1 é a primeira migration
que APAGA coisa em produção, e porque quatro das provas que ela exige dependem de acesso que nenhuma
sessão automatizada tem. Cada gate abaixo termina em `PASS` ou `BLOCKED` — não existe "quase".

Quem executa: o Maike. Não é preciso saber SQL: tudo que precisa ser rodado está escrito pronto para colar.

> **Estado em 2026-09-15, após o fechamento operacional (05C-G2):**
> **P5 = `PASS`** (medido, ver abaixo) · **P7 mecanismo = `PASS`** · **U5 = NON-BLOCKING BY PROOF** ·
> **P1 = `BLOCKED`** (só fecha com um restore real, que custa dinheiro e depende de autorização) ·
> **P6 = `BLOCKED`** em U1–U4, que são leituras de painel.
> A 05C-1 **não está autorizada**. CI verde não muda nenhum desses.

## A matriz

| Gate | Evidência exigida | `PASS` quando | `BLOCKED` enquanto | Quem confirma | Momento |
| --- | --- | --- | --- | --- | --- |
| **P1** Restore | um backup de produção RESTAURADO em destino isolado e CONSULTADO | as cinco consultas de P1.3 respondem o esperado no destino restaurado | não houver restore real, ou só houver "backup existe" | Maike, no painel da Supabase | uma vez, antes de autorizar a fatia |
| **P5** Seed e papéis ✅ | o VALOR de `SEED_ON_DEPLOY` lido com credencial autenticada | o valor é diferente de `1` | o valor não tiver sido lido nesta janela | leitura automatizada (Railway CLI) ou Maike | reconfirmar imediatamente antes do deploy |
| **P6** Rollout | as cinco respostas de P6 | as cinco estiverem respondidas por campo real | qualquer uma continuar `UNKNOWN` | Maike, no painel do Railway | uma vez, e reconfirmar se o serviço mudar |
| **P7** Locks | a consulta de porteiro, sem linha `BLOQUEIA` | nenhum DDL concorrente no instante do deploy | houver DDL concorrente sobre o catálogo | Maike, no SQL Editor | minutos antes do deploy |

---

## P1 — restore real

**O que NÃO conta como prova:** "o plano tem backup diário"; "o painel mostra um snapshot"; "o PITR está
ligado"; um print de tela. Backup que nunca foi restaurado é hipótese, não garantia.

**O que se sabe hoje** (documentação oficial da Supabase, lida em 2026-09-15):

- A organização está no plano **Pro**: backup diário automático, retenção de **7 dias**.
- O projeto roda PostgreSQL 17.6, acima de 15.8.1.079, então o backup é do tipo **físico** — o que
  habilita o caminho "Restore to a New Project" sem depender do add-on de PITR.
- **PITR é add-on pago** e exige compute Small ou maior. Se estiver desligado, só existem os pontos
  diários — não há "restaurar para o instante anterior à migration".
- O projeto foi criado em 10/09/2026: há no máximo ~5 pontos diários, não 7.
- Armadilha citada pela própria documentação: *backups diários não guardam a senha de papéis
  customizados*. Depois de um restore, `erp_app` e `erp_migrator` precisam ter a senha redefinida.

**P1.1 — descobrir o que existe.** Painel → projeto `CONTROLE-DE-ESTOQUE` → **Database → Backups**.
Anotar: quantos pontos diários aparecem, a data/hora do mais recente, e se a seção **Point in Time**
está ativa ou oferece contratação.

**P1.2 — restaurar para um projeto NOVO.** Na mesma página, aba **Restore to a New Project**, escolher o
backup mais recente e confirmar. O projeto novo nasce na mesma região.
**Nunca** use "restore" sobre o projeto de produção: a documentação avisa que o projeto fica inacessível
durante o processo e que o dado posterior ao ponto do backup se perde.

**P1.3 — provar que o restore serve.** No projeto RESTAURADO, SQL Editor, colar e rodar. As cinco
respostas têm de bater; qualquer uma fora do esperado mantém P1 `BLOCKED`.

```sql
-- 1) o banco responde e é PostgreSQL
select version();

-- 2) o schema do produto existe, com o tamanho esperado
select count(*) as tabelas_erp from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'erp' and c.relkind = 'r';          -- esperado: 181

-- 3) a tabela central existe e tem dado
select count(*) as empresas from erp.empresas;          -- esperado: > 0

-- 4) o ledger de migrations veio junto e está completo
select count(*) as migrations, max(name) as ultima from public.erp_migrations;
                                                        -- esperado: 16 / 0016_global_id_activation.sql

-- 5) o inventário físico pré-05C é reproduzível no restore
select
  (select count(*) from pg_attribute a join pg_class c on c.oid=a.attrelid
     join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='erp' and c.relkind='r' and a.attnum>0 and not a.attisdropped
      and a.attname in ('farm_id','origin_farm_id','destination_farm_id'))        as colunas_legadas,   -- 52
  (select count(distinct c.relname) from pg_attribute a join pg_class c on c.oid=a.attrelid
     join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='erp' and c.relkind='r' and a.attnum>0 and not a.attisdropped
      and a.attname in ('farm_id','origin_farm_id','destination_farm_id'))        as tabelas,           -- 49
  (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='erp' and c.relkind='v'
      and c.relname in ('farms','proprietary_farms','authorizer_farms',
                        'bank_account_farms','farm_cost_centers'))                as views_legadas,     -- 5
  (select count(*) from pg_trigger t join pg_proc p on p.oid=t.tgfoid
    where not t.tgisinternal and p.proname like 'sincronizar_empresa%')           as gatilhos_espelho,  -- 52
  (select count(*) from pg_constraint k join pg_class c on c.oid=k.conrelid
     join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='erp' and k.contype='f' and array_length(k.conkey,1)=2
      and k.confrelid = 'erp.empresas'::regclass) as fks_compostas; -- 50
-- (compara o OID da tabela alvo, não o texto: `pg_get_constraintdef` omite o schema quando `erp`
--  está no search_path da sessão, e o SQL Editor não garante qual search_path você recebe)
```

**P1.4 — registrar o artefato.** Anotar em `docs/DEPLOYMENT.md` (checklist de go-live): data e hora do
restore, o ref do projeto restaurado, e as cinco respostas obtidas. Depois de registrado, **apagar o
projeto restaurado** para não pagar por ele.

**P1 = `PASS`** só com P1.3 respondido no destino restaurado e P1.4 registrado.

### O que exatamente precisa da sua autorização

Uma ação só, e ela custa dinheiro — por isso nenhuma sessão automatizada a executa:

| | |
| --- | --- |
| **Ação** | painel do projeto `dcroxgdzzgqgiquvfffa` → Database → Backups → aba **Restore to a New Project**: restaurar o backup diário mais recente num projeto NOVO e isolado, mesma região `sa-east-1`, com nome de descarte (ex.: `CONTROLE-DE-ESTOQUE-RESTORE-TESTE-P1`) |
| **Custo** | **USD 10,00/mês** por projeto, cobrado pró-rata enquanto existir. PITR **não** é necessário para este drill (seria outro pedido, ~USD 100/mês) |
| **Tempo de pé** | o mínimo para rodar as consultas — 2 a 4 h, incluindo provisionamento; exclusão no mesmo dia |
| **Produção é tocada?** | **não**. "Restore to a New Project" lê o backup e cria projeto separado; a origem permanece intacta. **Nunca** use "restore" sobre o projeto de produção |
| **Quem clica** | você. Depois disso a sessão roda os `select` de P1.3 no restaurado |

Duas armadilhas da própria documentação da Supabase, para não virarem surpresa: o backup diário **não
guarda a senha de papéis customizados** (`erp_app` e `erp_migrator` precisam de senha nova no restaurado —
irrelevante para o drill, que só faz `select`), e o restore **não copia** objetos de Storage, Edge
Functions, configurações de Auth/Realtime nem extensões — também irrelevante para provar schema e dado.

E uma armadilha de inventário: o ledger do CLI da Supabase (`supabase_migrations`) mostra 7 migrations; o
SSOT do produto é `public.erp_migrations`, com 16. Conferir o ledger errado no restaurado dá a resposta
errada.

---

## P5 — seed e conexões — `PASS`

Medido em 2026-09-15 com o **Railway CLI autenticado**, em leitura pura
(`railway variable list -p <projeto> -s <serviço> -e production --json`, executado fora do repositório,
saída processada por script que emite só booleanos e o arquivo apagado em seguida). O bloqueio do G0 não
era um gate externo: era a sessão OAuth do MCP, que devolve `valuesRedacted: true`. Com o CLI, o valor se lê.

| Condição | Resultado | Como foi provado |
| --- | --- | --- |
| `SEED_ON_DEPLOY != "1"` | **atendida** — o valor é `0` | Railway CLI; a comparação em `migrate.ts:13` é estrita contra a string `"1"` |
| runtime é `erp_app` | **atendida** | a variável, e o catálogo: conexões vivas chegam como `erp_app` via Supavisor |
| migrator é `erp_migrator` | **atendida** | a variável, e o catálogo: `erp_migrator` é dono do schema `erp` e das 187 relações |
| identidades distintas | **atendida** | usuário **e** senha distintos; `erp_app` não é dono de nada e não pode fazer DDL |

Contraprova que não depende de ler URL nenhuma: `erp_app` tem `rolbypassrls = false` — exatamente o que
`.claude/rules/security.md` exige — e `erp_migrator`, que tem `bypassrls`, **não fica conectado em runtime**
(zero conexões vivas dele; só é usado no pre-deploy).

Conexão: host `aws-0-sa-east-1.pooler.supabase.com`, porta `5432` — pooler em modo **sessão** (o modo
transação seria 6543), confirmado pelo `application_name = Supavisor` das conexões vivas.

**Reconfirmar antes da janela.** O `PASS` é sobre o estado atual. `SEED_ON_DEPLOY` é variável comum, **não
selada**: qualquer pessoa com acesso ao Railway pode pô-la em `1`, e o próximo deploy rodaria `seedDemo` em
produção. Não existe gate automatizado que reprove isso.

**Dois riscos declarados, fora do escopo desta fatia:**
- `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ORG_NAME` e `ORG_SLUG` continuam no serviço de produção. São as entradas
  de `seedDemo`. Removê-las, ou fazer `migrate.ts` abortar quando `NODE_ENV=production` e
  `SEED_ON_DEPLOY="1"`, fecharia o risco por construção — as duas coisas são escrita e decisão sua.
- `DIRECT_URL` aponta para o papel `postgres` (`rolbypassrls = true`). Quem a consome não foi auditado.
  `UNKNOWN` explícito, não `PASS`.

**P5.3 — o que o deploy escreve mesmo sem seed.** Todo deploy roda `seedPermissions`, sem condição: ele
reescreve as 782 linhas de `erp.permissions` com `on conflict (key) do update`. Deploy nunca é operação
somente-leitura neste sistema. Saber disso evita interpretar a escrita como efeito da purga.

---

## P6 — rollout do Railway

As cinco perguntas abaixo continuam `UNKNOWN` porque a API do Railway não as expõe. **`UNKNOWN` é
`BLOCKED`** — não se preenche por hipótese.

| # | Pergunta | Onde responder |
| --- | --- | --- |
| U1 | Qual é a **restart policy** do serviço `api`? | Painel → serviço `api` → Settings → Deploy → *Restart Policy* |
| U2 | Qual é o **overlap** entre o container antigo e o novo? | Settings → Deploy → *Overlap* (ou variável `RAILWAY_DEPLOYMENT_OVERLAP_SECONDS`) |
| U3 | Qual é o **draining** (tempo entre SIGTERM e SIGKILL)? | Settings → Deploy → *Draining* (ou `RAILWAY_DEPLOYMENT_DRAINING_SECONDS`) |
| U4 | O **pre-deploy** tem timeout configurado? | Settings → Deploy → *Pre-Deploy Command* → campo de timeout |
| U5 | Um **rollback reexecuta** o `preDeployCommand`? | **RESOLVIDO — ver abaixo. A pergunta deixou de importar.** |

### U5 — NON-BLOCKING BY PROOF

A pergunta certa não era "o rollback reexecuta o pre-deploy", e sim "se reexecutar, o que acontece".
Medido em banco descartável, com o runner real:

Montou-se um banco cujo ledger já continha uma migration FUTURA (`0017`) que **não existe** no diretório do
binário anterior — exatamente o estado de um rollback. Rodando o runner ANTERIOR contra esse banco:

```
RUNNER done = []
LEDGER = ["0001_base.sql","0002_dual.sql","0017_purga.sql"]    <- 0017 preservada
MARCADOR = ["0002 ...","0017 purga (futura)"]                  <- o efeito da 0017 intacto
permissions synced ; PERMISSIONS = 782 ; ROLE_PERMISSIONS = 782
EXIT = 0
```

O runner é **forward-only**: ele itera sobre o DIRETÓRIO e usa o ledger apenas para PULAR
(`packages/db/src/migrate.ts:17-19`). Não tenta desfazer nada, não falha por entrada extra, e o
`seedPermissions` do binário anterior roda inteiro contra o schema pós-purga.

E o runtime anterior? Auditoria estática de `apps/api/src` e `packages/*/src` (excluindo testes, migrations,
docs e os arquivos declarados TOMBSTONE/PROVA_HISTORICA): **zero consultas SQL** citam `farm_id`,
`origin_farm_id`, `destination_farm_id`, qualquer das 5 views de nome antigo ou as 3 funções de
sincronização. As únicas ocorrências vivas são chave de permissão, valor de enum, discriminador em memória
e nome de variável — nada que a purga alcance.

**Consequência: U1, U2 e U3 também deixam de ser blockers por si mesmos.** Os três descrevem a mesma
situação — uma instância do binário anterior servindo contra o schema pós-purga — e é justamente ela que a
evidência acima não incrimina. O que continua valendo é o teto: **U4 permanece o pior dos quatro**, porque
sem timeout provado a janela de coexistência não tem limite superior.

### O gate que este veredito cria na 05C-1

**G-U5, obrigatório:** o binário da BASE (o commit da API em produção no momento do deploy) tem de subir e
servir contra um banco com a `0017` **aplicada**, provando boot sem erro, login, uma leitura escopada por
empresa e uma gravação com conferência de ROW COUNT. Enquanto esse gate não rodar, a compatibilidade do
runtime anterior é derivação, não fato. Ele roda em banco descartável: não exige produção nem custo.
Forma sugerida: estender `packages/db/test/upgrade-rollback.test.ts`, que já atravessa a janela estrutural.

**O que já é fato, e não muda com o painel:**

- O pre-deploy roda **entre build e deploy**, em container separado, e sua falha **aborta** o deploy — o
  runtime novo não sobe.
- Enquanto o pre-deploy roda, o container **antigo** continua atendendo tráfego. Consequência direta: a
  migration destrutiva executa com o binário anterior servindo. Medido no deploy de `d4639bb`: o web ficou
  pronto às 14:14:45 e a API às 14:16:36 — ~1 min 50 s de web novo conversando com API antiga.
- **1 réplica**, região `iad`, sem volume. Não há redundância: a janela de troca é a janela de risco.
- O rollback restaura imagem e variáveis. **Não desfaz migration**: o banco continua no estado pós-purga.
  O caminho de volta do dado é o da própria fatia, não o da plataforma.

---

## P7 — locks e timeouts

**A política, decidida e medida** (decisão 118): a purga é **uma migration atômica** que pré-adquire os
locks com `lock table ... in access exclusive mode nowait` antes de qualquer DDL, com `set local
lock_timeout` curto como rede de segurança. Nunca fragmentada, nunca com `commit` no corpo do arquivo,
nunca com `create index concurrently` (proibido dentro de transação) e nunca com `cascade`.

Por que: a purga inteira, dentro de uma transação, tem janela de `ACCESS EXCLUSIVE` de **mediana ~71 ms**
(medida por uma segunda pessoa, n=7; 98 ms num banco com 500 000 linhas). O `lock table` nomeia 54
relações — 49 tabelas + 5 views — e trava 55, porque a view `erp.farms` arrasta `erp.empresas` junto.
O custo nunca é o trabalho: é a espera. Com `lock_timeout = 0`, que é o valor de produção hoje, a mesma
purga esperou **120 s** atrás de uma conexão ociosa, morreu em `57014` sem remover nada, e prendeu um
leitor inocente — de uma tabela sem contenção nenhuma — por **117 s**.

**O que produção tem hoje**, medido: `lock_timeout = 0` · `statement_timeout = 120000 ms` ·
`idle_in_transaction_session_timeout = 0` · `erp_migrator` sem ajuste próprio. Nada disso é alterado pela
05C-G1: mudar configuração de servidor é ação humana, em outra janela.

**O que o NOWAIT NÃO cobre — e é por isso que o porteiro existe.** Medido: o `lock table` pré-adquire as 55
relações, mas **não** os locks de objeto do catálogo. Uma sessão rodando `comment on function
erp.sincronizar_empresa_legado() is 'x'` — que não toca em tabela nenhuma — segura um lock em `pg_proc`; a
purga então **passa** pelo `lock table`, reescreve a policy, derruba os 52 gatilhos, e **trava** no
`drop function`. Com `lock_timeout = 0` (o valor de produção) ela fica presa até o `statement_timeout` de
120 s, segurando `ACCESS EXCLUSIVE` em 55 relações. Durante a espera, um leitor inocente de
`erp.warehouses` — tabela sem contenção nenhuma — foi bloqueado e morreu no próprio teto.

Duas consequências, as duas obrigatórias:

1. **`set local lock_timeout = '2s'` no topo da migration não é rede, é requisito.** Com ele, o pior caso
   vira `57014` com rollback total e ledger limpo (medido). Sem ele, vira 120 s de indisponibilidade.
2. **O porteiro procura DDL concorrente**, não "banco calmo". Leitura normal não ameaça nada: contra ela o
   NOWAIT falha em 0,72 ms, sem dano.

**P7.1 — a consulta de porteiro.** Painel Supabase → SQL Editor, minutos antes do deploy. A primeira
consulta continua sendo a de sessões vivas; a segunda foi **substituída** — a anterior era inatingível
(`mode like '%Exclusive%'` casa com o `ExclusiveLock` em `virtualxid` que TODA transação segura, e uma
leitura banal de 2 s já devolvia 8 linhas de ruído; critério inatingível é critério ignorado na hora H).

```sql
with alvo as (
  select c.oid from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'erp' and c.relkind in ('r','p','v','m')
),
ameaca as (
  -- BLOQUEIA: DDL concorrente. Lock de objeto de catálogo que o LOCK TABLE não pré-adquire e que o
  -- NOWAIT não vê: a purga passa do lock table e trava no drop function/trigger.
  select 'BLOQUEIA'::text as veredito, 'ddl_concorrente'::text as classe, l.pid::text as quem,
         coalesce(l.classid::regclass::text,'?')||' '||l.mode as detalhe
    from pg_locks l
   where l.locktype = 'object' and l.pid <> pg_backend_pid()
     and l.classid::regclass::text in
         ('pg_proc','pg_type','pg_class','pg_trigger','pg_constraint','pg_rewrite','pg_namespace')
  union all
  -- BLOQUEIA: transação preparada segura lock sem backend vivo; não há quem esperar.
  select 'BLOQUEIA','two_phase_pendente', gid, prepared::text from pg_prepared_xacts
  union all
  -- ADIA: transação aberta há mais de 2 s (o NOWAIT falha barato, mas o deploy só falha de novo)
  select 'ADIA','transacao_longa', a.pid::text,
         a.state||' há '||date_trunc('second', now()-a.xact_start)::text
    from pg_stat_activity a
   where a.datname = current_database() and a.pid <> pg_backend_pid()
     and a.xact_start is not null and now()-a.xact_start > interval '2 seconds'
  union all
  -- ADIA: idle in transaction sobre erp, de qualquer duração
  select distinct 'ADIA','idle_in_transaction', a.pid::text, a.state
    from pg_stat_activity a join pg_locks l on l.pid = a.pid
   where a.datname = current_database() and a.pid <> pg_backend_pid()
     and a.state like 'idle in transaction%' and l.relation in (select oid from alvo)
  union all
  -- ADIA: já existe fila de lock; o banco não está calmo
  select 'ADIA','fila_de_lock', l.pid::text,
         coalesce(l.relation::regclass::text, l.locktype)||' '||l.mode
    from pg_locks l where l.granted = false and l.pid <> pg_backend_pid()
  union all
  -- ADIA: lock sobre erp em modo que não é leitura (escrita ou manutenção em curso)
  select distinct 'ADIA','escrita_em_curso', l.pid::text,
         l.relation::regclass::text||' '||l.mode
    from pg_locks l join pg_stat_activity a on a.pid = l.pid
   where l.pid <> pg_backend_pid() and l.relation in (select oid from alvo)
     and l.mode <> 'AccessShareLock'
)
select veredito, classe, quem, detalhe from ameaca order by veredito, classe;
```

**Critério, em uma frase:** qualquer linha `BLOQUEIA` proíbe o deploy até aquela sessão terminar — é a única
contenção que o NOWAIT não vê e que custa 120 s de `ACCESS EXCLUSIVE`; linhas `ADIA` prometem apenas um
`55P03` de 0,7 ms sem dano, então espere alguns segundos e reconsulte; consulta vazia libera.

Validada contra cinco cenários reais: banco parado → vazio · 400 leituras rápidas → vazio (a consulta
anterior devolvia ruído) · `idle in transaction` → `ADIA` · fila de lock → `ADIA` · `comment on function` →
`BLOQUEIA`, que é exatamente o único caso em que a purga trava.


**P7.2 — o que esperar se der errado.** Com `nowait`, a falha é imediata (`55P03`, ~1 ms), a transação
inteira volta atrás, o ledger fica vazio e a migration pode ser reexecutada sem nenhum ajuste — o runner é
idempotente e o arquivo é tudo-ou-nada. Falhar barato e repetir é o comportamento desejado, não um
problema. O que NÃO é aceitável é o deploy ficar pendurado: isso significa que a política não foi aplicada.

---

## Os quatro que o G0 já fechou — enunciado e como reconferir

Não basta dizer que passaram: quem audita precisa saber **o quê** passou e como repetir. Todos são
`select` puro; rodar de novo custa segundos.

| Gate | Pergunta | `PASS` quando | Como reconferir |
| --- | --- | --- | --- |
| **P2** Dados legados | sobrou nome antigo PERSISTIDO que a purga física pressuponha ausente? | os cinco pré-requisitos em zero; todo o resto classificado (ver `docs/PRE-BASE2-05-APOSENTADORIA.md`, "Dados persistidos com nomes antigos") | as contagens daquela tabela, uma a uma |
| **P3** Integridade da ponte | os 52 pares canônico/legado têm o mesmo valor em toda linha? | 52 pares medidos, zero divergência de valor e de nulabilidade, nenhum par pela metade | `select count(*) filter (where legada is distinct from canonica)` por par |
| **P4** Inventário físico | o que existe no banco é o que a 05C-1 pretende remover? | 52/49 colunas · 5 views · 52 gatilhos · 3 funções · 52 FKs de coluna única · 8 índices · 1 CHECK · 1 policy · **50** compostas que FICAM | a consulta 5 de P1.3 acima |
| **P8** Versão publicada | o que está servindo em produção é o commit que se pensa? | o deploy ativo da API e do web no mesmo commit de `main`, `/health` em 200 | painel do Railway (commit do deploy ativo) + `curl -s .../health` |

Ressalva honesta sobre P3: 24 dos 52 pares estão em tabelas VAZIAS hoje. "Zero divergência" ali é
verdadeiro por vacuidade — não prova nada sobre dado que não existe. E mesmo nos 28 com dado, os
gatilhos de espelho copiam um lado no outro, então a integridade medida é a DA PONTE, não evidência de
que a aplicação já escreve na coluna canônica.

## Depois dos quatro

Com P1, P5, P6 e P7 em `PASS`, a 05C-1 passa a ser uma fatia normal: branch própria, PR DRAFT, revisão,
merge manual. **Nenhuma sessão automatizada autoriza a fatia** — a autorização é do Maike, por escrito,
depois de olhar esta página inteira.
