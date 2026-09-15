# Preflight da PRE-BASE2-05C-1 — o que precisa ser provado ANTES da purga destrutiva

Este documento é para **executar**, não para consultar. Ele existe porque a 05C-1 é a primeira migration
que APAGA coisa em produção, e porque quatro das provas que ela exige dependem de acesso que nenhuma
sessão automatizada tem. Cada gate abaixo termina em `PASS` ou `BLOCKED` — não existe "quase".

Quem executa: o Maike. Não é preciso saber SQL: tudo que precisa ser rodado está escrito pronto para colar.

> **Estado em 2026-09-15:** P1, P5, P6 e P7 estão `BLOCKED`. A 05C-1 **não está autorizada**.
> CI verde não muda nenhum deles.

## A matriz

| Gate | Evidência exigida | `PASS` quando | `BLOCKED` enquanto | Quem confirma | Momento |
| --- | --- | --- | --- | --- | --- |
| **P1** Restore | um backup de produção RESTAURADO em destino isolado e CONSULTADO | as cinco consultas de P1.3 respondem o esperado no destino restaurado | não houver restore real, ou só houver "backup existe" | Maike, no painel da Supabase | uma vez, antes de autorizar a fatia |
| **P5** Seed e papéis | o VALOR de `SEED_ON_DEPLOY` lido no painel | o valor é diferente de `1` | o valor não tiver sido lido nesta janela | Maike, no painel do Railway | imediatamente antes do deploy |
| **P6** Rollout | as cinco respostas de P6 | as cinco estiverem respondidas por campo real | qualquer uma continuar `UNKNOWN` | Maike, no painel do Railway | uma vez, e reconfirmar se o serviço mudar |
| **P7** Locks | a consulta de porteiro, com o banco calmo | nenhuma transação aberta sobre `erp` no instante do deploy | a política não estiver versionada, ou o banco estiver ocupado | Maike, no SQL Editor | minutos antes do deploy |

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

---

## P5 — seed e conexões

**P5.1 — o valor de `SEED_ON_DEPLOY`.** Painel do Railway → projeto `controle-de-estoque` → ambiente
`production` → serviço **api** → aba **Variables** → localizar `SEED_ON_DEPLOY` e revelar o valor.

- `PASS` se o valor for **diferente de `1`** (`0`, vazio ou ausente servem).
- `BLOCKED` se for `1` — nesse caso o deploy da 05C-1 recriaria dados de referência e a organização demo
  junto com a purga.
- `BLOCKED` também se ninguém leu o valor **nesta janela**: comportamento histórico não é configuração
  atual. (O que a sessão automatizada conseguiu provar é só o EFEITO: o seed de referência rodou **uma
  única vez** na vida do banco, na provisão, e não rodou em nenhum dos ~25 deploys seguintes. Isso é forte,
  e ainda assim não é o valor.)

**P5.2 — os dois papéis.** Na mesma aba, conferir `DATABASE_URL` e `MIGRATE_DATABASE_URL`. Anotar
**apenas**: o host, a porta e o nome de usuário antes do `:`. Esperado: usuários **diferentes** —
`erp_app` na primeira, `erp_migrator` na segunda.

> **Senha, token e string de conexão inteira nunca vão para chat, PR, relatório ou log** — nem mascarados,
> nem "de exemplo". Se precisar citar, cite o NOME do papel.

Confirmação independente que já existe, feita pelo lado do banco e sem ler nenhuma URL: `erp_migrator` é
dono de 100% dos objetos do schema `erp` e do ledger, com `rolbypassrls = true`; as conexões vivas da API
chegam como `erp_app`, que tem `rolbypassrls = false` e nenhum privilégio de DDL.

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
| U5 | Um **rollback reexecuta** o `preDeployCommand`? | Nenhuma página oficial afirma nem nega. Só se resolve testando num ambiente que não seja produção, ou perguntando ao suporte |

U5 é o mais caro dos cinco: se o rollback reexecuta o pre-deploy, voltar o código faz a migration ANTIGA
rodar contra um banco já migrado para frente.

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

**P7.1 — a consulta de porteiro.** Painel Supabase → SQL Editor, minutos antes do deploy:

```sql
-- sessões vivas neste instante
select a.pid, a.usename, a.state,
       date_trunc('second', now() - a.xact_start)::text as transacao_aberta_ha,
       a.wait_event_type, left(regexp_replace(a.query, '\s+', ' ', 'g'), 60) as consulta
  from pg_stat_activity a
 where a.datname = current_database() and a.pid <> pg_backend_pid()
   and (a.state <> 'idle' or a.xact_start is not null)
 order by a.xact_start nulls last;

-- locks não concedidos ou exclusivos sobre o schema do produto
select l.pid, a.usename, l.mode, l.granted, coalesce(c.relname, l.locktype) as objeto
  from pg_locks l
  left join pg_class c on c.oid = l.relation
  left join pg_namespace n on n.oid = c.relnamespace
  join pg_stat_activity a on a.pid = l.pid
 where l.pid <> pg_backend_pid()
   and (l.granted = false or l.mode like '%Exclusive%' or n.nspname = 'erp');
```

**Critério:** prosseguir só se a primeira consulta não mostrar nenhuma transação aberta há mais de poucos
segundos, e a segunda vier vazia. Qualquer `idle in transaction` sobre `erp` → **adiar**. Não encerre
sessão de ninguém para abrir caminho.

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
