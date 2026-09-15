# Preflight da PRE-BASE2-05C-1 — o que precisa ser provado ANTES da purga destrutiva

Este documento é para **executar**, não para consultar. Ele existe porque a 05C-1 é a primeira migration
que APAGA coisa em produção, e porque algumas das provas que ela exige dependem de acesso que nenhuma
sessão automatizada tem. Nasceram quatro assim; três foram fechadas por leitura autenticada desde então, e
**resta uma**: P1, o restore, que não é questão de acesso e sim de **custo e consentimento** — e que, por
decisão escrita do proprietário, está **suspenso enquanto os dados forem descartáveis**, não aprovado.
Cada gate abaixo termina em `PASS` ou `BLOCKED` — não existe "quase". A única exceção é P1, e ela tem nome
próprio (`NOT APPLICABLE WHILE PRE-PROD DATA IS DISPOSABLE`) justamente para não ser lida como `PASS`.

Quem executa: o Maike. Não é preciso saber SQL: tudo que precisa ser rodado está escrito pronto para colar.

> **Estado em 2026-09-15, após o fechamento operacional (05C-G2), a correção externa da PR #35 e a
> DECLARAÇÃO DE PRÉ-PRODUÇÃO do proprietário:**
> **P1 = `NOT APPLICABLE WHILE PRE-PROD DATA IS DISPOSABLE`** · **`RECOVERY = REBUILD FROM ZERO`** — o
> proprietário declarou que o sistema ainda NÃO está em produção operacional, que os dados atuais NÃO
> precisam ser preservados e que, em caso de falha, é aceitável resetar o banco, reaplicar as migrations e
> recriar os dados de teste. Isso **não é `PASS`**: o drill de restore continua sem ter sido executado. É
> uma dispensa com prazo, e o prazo é um evento — ver "Condição de retorno", abaixo ·
> **P5 = `MEDIDO EM 15/09`** — vira `PASS` quando relido na janela do deploy, e não antes: o valor é
> mutável por qualquer pessoa com acesso ao Railway · **P7 mecanismo = `PASS`** ·
> **P6 = `PASS CONDICIONAL`, com RISCO DECLARADO.** As cinco perguntas estão respondidas: U1, U2, U3
> e U5 estão **NON-BLOCKING PENDENTE DE G-U5** — U5 por medição, U1/U2/U3 por derivação; o instrumento do
> G-U5 **já existe** nesta fatia (`scripts/gate-purga-0017-runtime-anterior.mjs`), e o que falta é a
> EXECUÇÃO registrada ·
> **U4 = `OPERATIONAL MERGE BLOCKER`** — mudou de rótulo. Continua sendo o mesmo fato medido
> (`preDeployTimeoutSeconds = null`), mas deixou de ser "risco declarado e só": como o merge em `main`
> dispara deploy automático, **é o merge que liga o risco**. Enquanto não houver contenção, a 05C-1 não é
> liberada para merge.
> A 05C-1 **não está autorizada**. CI verde não muda nenhum desses.

## A matriz

| Gate | Evidência exigida | `PASS` quando | `BLOCKED` enquanto | Quem confirma | Momento |
| --- | --- | --- | --- | --- | --- |
| **P1** Restore | **SUSPENSO** — `NOT APPLICABLE WHILE PRE-PROD DATA IS DISPOSABLE`. Enquanto vale, a prova exigida não é de RECUPERAÇÃO e sim de RECONSTRUÇÃO: banco recriado do zero, `0001..0017` aplicadas, dados de teste recriados (`RECOVERY = REBUILD FROM ZERO`) | **nunca por este caminho.** A suspensão não produz `PASS`: ela dispensa o gate para esta janela e o devolve inteiro na condição de retorno | existir o primeiro dado não descartável sem que o drill de backup + restore tenha sido feito — aí volta a `BLOCKED`, com o enunciado original | a SUSPENSÃO é do Maike, por escrito; o RETORNO é automático no evento, e só a execução do drill o fecha | reavaliar ANTES do primeiro uso real e ANTES do primeiro dado não descartável |
| **P5** Seed e papéis | o VALOR de `SEED_ON_DEPLOY` lido com credencial autenticada | o valor foi lido NESTA janela e é diferente de `1` | o valor não tiver sido lido nesta janela — **é o estado de hoje**: a leitura é de 15/09 | leitura automatizada (Railway CLI) ou Maike | reconfirmar imediatamente antes do deploy |
| **P6** Rollout | as cinco perguntas respondidas: **U4 e U5 por evidência direta**, U1/U2/U3 **dispensados por derivação** | `PASS CONDICIONAL` hoje: vira `PASS` quando **G-U5** rodar, porque é ele que transforma a derivação de U1/U2/U3 em fato | G-U5 não tiver rodado, ou alguma voltar a `UNKNOWN` (ex.: o serviço ser recriado) | leitura automatizada (API do Railway) para U4; painel para o resto | reconfirmar se o serviço mudar |
| **G-U5** Compatibilidade do binário anterior | o commit da API em produção subindo e servindo contra um banco com a `0017` aplicada | boot, login, leitura escopada e gravação com ROW COUNT, todos verdes | a EXECUÇÃO não estiver registrada. O instrumento deixou de ser hipótese: existe como `scripts/gate-purga-0017-runtime-anterior.mjs` nesta fatia — mas gate que existe e não rodou continua `BLOCKED` | o próprio gate, em banco descartável | dentro da 05C-1, ANTES de qualquer deploy em produção |
| **U4** Teto do pre-deploy | uma contenção real para o pre-deploy sem teto (`preDeployTimeoutSeconds = null` no serviço `api`, medido em 15/09) | o campo tiver valor, medido e registrado, **ou** existir contenção equivalente aceita por escrito | o campo estiver vazio: **`OPERATIONAL MERGE BLOCKER`** — merge em `main` dispara deploy automático, então liberar a PR para merge é ligar o risco | Maike, no painel do Railway (ação humana, fora desta fatia) | antes de liberar a 05C-1 para merge |
| **P7** Locks | a consulta de porteiro, sem linha `BLOQUEIA` | nenhum DDL concorrente **sobre objeto de `erp`** no instante do deploy | houver DDL concorrente sobre objeto de `erp` (ou objeto que não resolve) | Maike, no SQL Editor | minutos antes do deploy |

---

## P1 — restore real — `NOT APPLICABLE WHILE PRE-PROD DATA IS DISPOSABLE`

### A declaração que suspende este gate

O proprietário declarou, para esta janela, que:

- o sistema **ainda NÃO está em produção operacional**;
- os dados hoje no banco **NÃO precisam ser preservados**;
- em caso de falha, **é aceitável resetar o banco, reaplicar as migrations e recriar os dados de teste**.

Enquanto isso for verdade, o gate fica em **`P1 = NOT APPLICABLE WHILE PRE-PROD DATA IS DISPOSABLE`** e a
política de recuperação é **`RECOVERY = REBUILD FROM ZERO`**. O procedimento de reconstrução — os passos, na
ordem, e o que conferir no fim — mora em `docs/DEPLOYMENT.md`, seção "Recuperação"; não é recopiado aqui.

**Isto não é `PASS`, e a diferença não é de vocabulário.** `PASS` significa "a pergunta foi respondida por
evidência". Aqui a pergunta **não foi respondida**: nenhum backup deste projeto foi restaurado, e portanto
continua sendo hipótese que ele restaure. O que mudou foi o VALOR da resposta, não a resposta: enquanto o
dado é descartável, perder o banco custa o tempo de recriá-lo. Escrever `PASS` transformaria uma dispensa
temporária em fato permanente — e ninguém releria a linha depois.

### Condição de retorno — a parte que não pode ser esquecida

> **Antes do PRIMEIRO uso real e antes do PRIMEIRO dado não descartável, o drill de backup + restore volta a
> ser gate OBRIGATÓRIO**, com o enunciado original (P1.1 a P1.4, logo abaixo), e a 05C-1 — ou qualquer outra
> migration destrutiva — volta a depender dele.

Uma política de pré-produção sem retorno obrigatório não adia gate nenhum: apaga. A dispensa acima só é
legítima porque tem evento de vencimento escrito, e o evento é observável por terceiro.

**O que conta como "dado não descartável"** — basta UM item para a condição disparar:

| Conta | Por quê |
| --- | --- |
| qualquer registro criado por **pessoa de fora da equipe de desenvolvimento** contando encontrá-lo depois | recriar não é opção: o dado não está na cabeça de quem opera o deploy |
| lançamento **financeiro, fiscal ou de estoque** que alguém vá usar para decidir, cobrar, pagar ou declarar | vira evidência contábil; o ledger é imutável por decisão de arquitetura (`CLAUDE.md`), e histórico recriado é histórico falsificado |
| **ID Global já exibido** a um usuário (`#N` anotado, impresso ou referenciado fora do sistema) | o número é localizador humano: renumerar quebra a referência que a pessoa tem na mão |
| anexo enviado por um usuário (Storage), que o seed **não** recria | não existe origem para reconstruir |
| **primeiro login real** de usuário que não seja de teste | a partir daí o sistema está em uso, mesmo que ninguém tenha lançado nada ainda |

**O que NÃO conta:** dados de `seedDemo`, organizações e empresas `[DEMO]`, cadastros de exemplo, usuários
de teste da equipe — tudo que `pnpm db:seed` refaz sozinho.

**Quem decide: o Maike, por escrito, e a decisão é PONTUAL.** Nenhuma sessão automatizada declara que o dado
continua descartável, e "ninguém disse que virou produção" não é declaração — a ausência de declaração é
motivo para PERGUNTAR, não para prosseguir. Na dúvida sobre um item específico, o gate está de volta: o
critério é fail-closed como o resto deste documento.

**Quando a condição disparar, o que fazer**, em ordem: (1) marcar P1 como `BLOCKED` aqui e em
`docs/DEPLOYMENT.md`; (2) executar P1.1–P1.4 abaixo, incluindo a leitura do custo no resumo da própria
Supabase; (3) só então retomar qualquer fatia destrutiva.

### O enunciado original — volta inteiro na condição de retorno

Nada abaixo foi removido ou afrouxado. Está aqui para ser executado no dia em que a suspensão vencer.

**O que NÃO conta como prova:** "o plano tem backup diário"; "o painel mostra um snapshot"; "o PITR está
ligado"; um print de tela. Backup que nunca foi restaurado é hipótese, não garantia.

**O que se sabe hoje** (documentação oficial da Supabase, lida em 2026-09-15):

- A organização está no plano **Pro**: backup diário automático, retenção de **7 dias**.
- O projeto roda PostgreSQL 17.6, acima de 15.8.1.079, então o backup é do tipo **físico** — o que
  habilita o caminho "Restore to a New Project" sem depender do add-on de PITR.
- **PITR é add-on pago** e exige compute Small ou maior. Se estiver desligado, só existem os pontos
  diários — não há "restaurar para o instante anterior à migration".
- O projeto foi criado em 10/09/2026: há no máximo ~5 pontos diários, não 7.
- Ressalva citada pela documentação, com o escopo que ela de fato tem: *backups diários não guardam a
  senha de papéis customizados*. A frase está na página de **Backups**, escopada a "daily backups" /
  "downloadable files", e a página de clone não a repete — se ela alcança o caminho físico deste projeto
  é `UNKNOWN` por texto. Prática: se `erp_app` ou `erp_migrator` não autenticarem no restaurado, redefina
  a senha lá. Não afeta o drill, que é só `select`.

**P1.1 — descobrir o que existe.** Painel → projeto `CONTROLE-DE-ESTOQUE` → **Database → Backups**.
Anotar: quantos pontos diários aparecem, a data/hora do mais recente, e se a seção **Point in Time**
está ativa ou oferece contratação.

**P1.2 — restaurar para um projeto NOVO.** Na mesma página, aba **Restore to a New Project**, escolher o
backup mais recente. **Pare na tela de resumo de custo, leia o valor e só então confirme** (ver "O custo é
`UNKNOWN`"). O projeto novo nasce na mesma região.
**Nunca** use "restore" sobre o projeto de produção: a documentação avisa que o projeto fica inacessível
durante o processo e que o dado posterior ao ponto do backup se perde.

**P1.2b — desarmar o restaurado ANTES de consultá-lo.** O clone traz **todas as extensões habilitadas na
origem**. Extensão de efeito externo (`pg_net`, `pg_cron`, wrappers) passa a rodar no projeto novo com o
dado de produção — a própria documentação manda desabilitá-las no destino. Confira e desabilite antes de
qualquer outra coisa:

```sql
select extname from pg_extension
 where extname in ('pg_net','pg_cron','wrappers','http','pgmq','supabase_vault')
 order by 1;   -- esperado depois de desarmar: as de efeito externo, ausentes
```

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

**P1.4 — registrar o artefato, e NÃO apagar ainda.** Anotar em `docs/DEPLOYMENT.md` (checklist de
go-live): data e hora do restore, o ref do projeto restaurado, e as cinco respostas obtidas.

O projeto restaurado é **TEMPORÁRIO, e fica de pé aguardando revisão externa**. Ele é o único artefato que
permite a um terceiro repetir as consultas de P1.3 por conta própria — apagá-lo logo depois de anotar as
respostas transforma o drill em relatório auto-certificado, que é exatamente o que este repositório não
aceita como prova. Enquanto ele existir, custa dinheiro; o custo de mantê-lo por alguns dias é o preço da
contraprova independente, e é uma decisão consciente, não um esquecimento.

| | |
| --- | --- |
| **Depois das consultas** | marcar o projeto como `TEMPORÁRIO — aguardando revisão externa do drill P1` (no nome ou na descrição do projeto) |
| **Quando apagar** | **somente** após aprovação explícita do auditor externo ou do Maike, dada para aquela remoção |
| **Quem apaga** | o Maike. Nenhuma sessão automatizada apaga projeto |
| **Depois de apagar** | registrar em `docs/DEPLOYMENT.md` a data/hora da remoção e quem aprovou |

**Como este gate fecha, no dia em que voltar a valer:** só com P1.3 respondido no destino restaurado e
P1.4 registrado — nunca por declaração, nunca por "o backup existe". A remoção do projeto restaurado é
posterior a esse fechamento e **não** é condição dele. Hoje o gate não está fechado: está SUSPENSO.

### O que exatamente precisa da sua autorização

Uma ação só, e ela custa dinheiro — por isso nenhuma sessão automatizada a executa. **O valor NÃO está
escrito aqui de propósito**, e a próxima subseção explica por quê.

| | |
| --- | --- |
| **Ação** | painel do projeto `dcroxgdzzgqgiquvfffa` → Database → Backups → aba **Restore to a New Project**: restaurar o backup diário mais recente num projeto NOVO e isolado, com nome de descarte (ex.: `CONTROLE-DE-ESTOQUE-RESTORE-TESTE-P1`). A região é a da origem, `sa-east-1`, e não é escolha sua |
| **Custo** | **A CONFIRMAR NO RESUMO DA PRÓPRIA SUPABASE, ANTES DO CLIQUE FINAL.** Ver "O custo é UNKNOWN" abaixo |
| **Tempo de pé** | até a revisão externa do drill liberar a remoção (P1.4). Não há prazo prometido pela plataforma para o restore em si |
| **Produção é tocada?** | **não**. "Restore to a New Project" lê o backup e cria projeto separado; a origem permanece intacta. **Nunca** use "restore" sobre o projeto de produção |
| **Quem clica** | você. Depois disso a sessão roda os `select` de P1.3 no restaurado |

#### O custo é `UNKNOWN`, e é por isso que não se pede autorização de um número inventado

A 05C-G2 afirmou "USD 10,00/mês" como fato. Isso está **reprovado**, por dois motivos independentes:

1. **O número nunca veio com moeda.** A única leitura de preço obtida por caminho automatizado foi
   `get_cost(type="project")` da API da Supabase, que devolveu literalmente
   `{"type":"project","recurrence":"monthly","amount":10}` — escalar `10`, recorrência mensal, **sem
   campo de moeda**. E essa chamada nem aceita o ref do projeto de origem: ela é estruturalmente incapaz
   de precificar o espelhamento. O valor é a constante do menor compute (Micro): a mesma API, para
   `branch`, devolve `0.01344/h`, que é exatamente o preço horário de Micro na tabela oficial.
2. **A documentação diz que o custo depende da origem.** *"A new project is automatically created,
   replicating key configurations from the original, including the compute instance size, disk
   attributes, SSL enforcement settings, and network restrictions"* e *"The new project will incur
   additional monthly expenses based on the mirrored resources from the source project"*
   (`supabase.com/docs/guides/platform/clone-project`). Se a origem não estiver em Micro com disco base,
   o restaurado custa **mais** que 10.

E o compute size e os atributos de disco da origem **não são legíveis** por esta sessão: `get_project`
devolve ref, região, status, versão do Postgres e host — e nada de compute, disco, IOPS ou add-ons.

**O que a plataforma oferece, e é o único número autoritativo:** *"Before starting the restoration,
you'll be presented with an overview of the costs associated with creating the new project (…) It's
important to review these costs carefully before proceeding."* Existe um resumo de custo **antes** da
confirmação, dentro do fluxo. É esse número que se autoriza — não uma estimativa deste documento.

**Como pedir a autorização, então:**

1. Abrir o fluxo **Restore to a New Project** até a tela do resumo de custo. **Não confirmar.**
2. Anotar o que a tela mostra: valor, recorrência, e o que ela diz estar espelhando.
3. Autorizar (ou não) **aquele** valor, por escrito, para aquela execução.

Ordens de grandeza publicadas, **só para dimensionar o risco** — não são o custo do drill:
compute mensal ≈ 10 (Micro) · 15 (Small) · 60 (Medium) · 111 (Large); PITR ≈ 100 / 200 / 400 conforme
retenção de 7 / 14 / 28 dias. Duas advertências que mudam o cálculo: **compute é faturado por hora, e
hora iniciada é hora cheia**; e **Compute Hours e PITR não são cobertos pelo Spend Cap** — o teto de
gasto da conta não protege exatamente estas duas linhas.

Também `UNKNOWN`, e registrado como tal em vez de suposto: **se existe backup diário disponível**, **o
timestamp do mais recente** e **se o add-on PITR está ativo**. Não há tool de leitura para backups nem
para add-ons nesta sessão; o caminho seria a Management API (`GET /v1/projects/{ref}/database/backups`),
que exige um token pessoal que o ambiente não tem. É a primeira coisa a olhar em P1.1.

#### Sobre o tempo: não existe prazo prometido

A documentação é explícita: *"The time required to complete the restoration can vary depending largely
on the volume of data involved."* Não há SLA, faixa nem estimativa publicada. O "2 a 4 h" que este
documento trazia era **estimativa interna sem respaldo**, e foi retirado. Se quiser uma referência para
planejar a janela, trate-a como chute e meça na primeira execução.

#### O que o restore leva e o que ele NÃO leva — corrigido

A 05C-G2 escreveu que o restore "não copia (…) nem extensões". **Isso está errado**, e o erro tem
consequência operacional real.

| É transferido | Precisa de reconfiguração manual |
| --- | --- |
| schema do banco (tabelas, views, procedures) | objetos e settings de **Storage** (arquivos e buckets **não** são copiados) |
| **todos** os dados e índices | **Edge Functions** |
| **roles, permissões e users** do banco | **settings do Auth e API keys** |
| **dados de usuário do Auth** — contas, senhas com hash e registros de autenticação do schema `auth` | **settings de Realtime** |
| **encryption root key** (segredos do Vault e colunas criptografadas seguem legíveis) | **extensions e settings de banco**, e **read replicas** |

Portanto: **não** escreva "Auth não é copiado". O **dado de usuário do Auth vem**; o que não vem é a
**configuração** do Auth e as **chaves de API**. São coisas diferentes na mesma página da documentação.

**A armadilha nova, que é séria:** *"As the entire database is copied to the new project, this will
include all extensions that were enabled at the source. If the source project included extensions that
are configured to carry out external operations — for example `pg_net`, `pg_cron`, wrappers — "* a
documentação manda **desabilitá-las no destino**. Um projeto restaurado pode, sozinho, disparar cron,
chamadas HTTP e integrações externas usando o dado de produção. **Antes de qualquer `select` de P1.3,
conferir e desabilitar extensões de efeito externo no restaurado.** Isso entra no drill como primeiro
passo, não como observação.

Duas ressalvas menores, ditas com o escopo que a documentação realmente dá:

- **Senha de papel customizado.** A advertência existe (*"daily backups do not store passwords for
  custom roles"*), mas está na página de **Backups**, escopada a "daily backups" / "downloadable files",
  e a página de clone **não a menciona**. Se ela vale para o caminho físico deste projeto é `UNKNOWN`
  por texto — a documentação não reconcilia os dois trechos. Para o drill é indiferente: ele só faz
  `select`, e quem conecta é o dono do projeto novo. Se a senha não vier, redefina no destino.
- **O restaurado não serve de origem.** *"Projects that are created through the restoration process
  cannot themselves be used as a source for further clones at this time."* Cada drill parte sempre de
  `dcroxgdzzgqgiquvfffa`.

E uma armadilha de inventário: o ledger do CLI da Supabase (`supabase_migrations`) mostra 7 migrations; o
SSOT do produto é `public.erp_migrations`, com 16. Conferir o ledger errado no restaurado dá a resposta
errada.

---

## P5 — seed e conexões — `MEDIDO EM 15/09`, revalidar na janela

Medido em 2026-09-15 com o **Railway CLI autenticado**, em leitura pura
(`railway variable list -p <projeto> -s <serviço> -e production --json`, executado fora do repositório,
saída processada por script que emite só booleanos e o arquivo apagado em seguida). O bloqueio do G0 não
era um gate externo: era a sessão OAuth do MCP, que devolve `valuesRedacted: true`. Com o CLI, o valor se lê.

| Condição | Resultado | Como foi provado |
| --- | --- | --- |
| `SEED_ON_DEPLOY != "1"` | **atendida** — o valor é `0` | Railway CLI; a comparação em `migrate.ts:13` é estrita contra a string `"1"` |
| runtime é `erp_app` | **atendida** | a variável, e o catálogo: conexões vivas chegam como `erp_app` via Supavisor |
| migrator é `erp_migrator` | **atendida** | a variável, e o catálogo: `erp_migrator` é dono do schema `erp` e das 187 relações |
| identidades distintas | **atendida — pelo catálogo** | `erp_app` e `erp_migrator` são papéis distintos, com `rolbypassrls` distinto, e `erp_app` não é dono de nada nem pode fazer DDL. Tudo isso se lê em `pg_roles` e no catálogo de propriedade, sem tocar em nenhuma variável. **Ver a nota de retratação abaixo sobre a senha.** |

Contraprova que não depende de ler URL nenhuma: `erp_app` tem `rolbypassrls = false` — exatamente o que
`.claude/rules/security.md` exige — e `erp_migrator`, que tem `bypassrls`, **não fica conectado em runtime**
(zero conexões vivas dele; só é usado no pre-deploy).

Conexão: as conexões vivas da API chegam pelo pooler em modo **sessão**, confirmado pelo
`application_name = Supavisor` e pela porta de sessão do pooler — lido no catálogo do banco, sem citar
host, usuário nem string de conexão.

> **Senha, token e string de conexão inteira nunca vão para chat, PR, relatório ou log** — nem mascarados,
> nem "de exemplo". Se precisar citar, cite o NOME do papel. Este aviso existia neste documento, foi
> removido por engano na 05C-G1 e está de volta.

**Retratação, escrita porque a regra vale para nós também.** A 05C-G2 declarou "usuário **e** senha
distintos" como evidência. Para produzir esse booleano, a sessão listou as variáveis do serviço e um script
leu os dois valores em memória. Nada foi impresso, logado, commitado, parafraseado, truncado nem reduzido a
hash — mas `CLAUDE.md` e `.claude/rules/security.md` proíbem **ler**, não só publicar. Foi violação, e por
isso a linha de "identidades distintas" acima passou a se apoiar **só no catálogo**. A parte "senha
distinta" **não é evidência deste preflight**: não é reproduzível por terceiro sem repetir o ato proibido, e
não precisa ser — `rolbypassrls` e a propriedade do schema já separam os dois papéis pelo que importa. Se
um dia a distinção de senha precisar ser provada, o caminho é rotacionar a senha de um dos papéis e
observar a autenticação, sem ler valor nenhum.

**Reconfirmar antes da janela — e é por isso que o rótulo não é `PASS`.** A medição é de 15/09. `SEED_ON_DEPLOY` é variável comum, **não
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

## P6 — rollout do Railway — `PASS CONDICIONAL` ao G-U5, com risco declarado

As cinco perguntas abaixo nasceram `UNKNOWN`, e `UNKNOWN` era `BLOCKED` — nenhuma delas foi preenchida por
hipótese. Hoje as cinco estão respondidas, mas por caminhos diferentes, e a diferença importa:

- **U5** deixou de ser a pergunta certa e foi respondida por **medição do runner** (abaixo);
- **U1, U2 e U3** caem junto com U5, porque descrevem a mesma coexistência — mas a prova disso é
  auditoria ESTÁTICA, então o rótulo honesto deles é **`NON-BLOCKING PENDENTE DE G-U5`**, não
  "by proof". Enquanto o G-U5 não rodar, é derivação;
- **U4** foi respondida por **leitura direta do campo** na API do Railway, e a resposta é ruim:
  `KNOWN: unbounded`. Gate fechado, risco aberto.

Os três primeiros continuam anotados abaixo com o caminho de painel, para quem precisar reconferir se o
serviço mudar.

| # | Pergunta | Onde responder |
| --- | --- | --- |
| U1 | Qual é a **restart policy** do serviço `api`? | Painel → serviço `api` → Settings → Deploy → *Restart Policy* |
| U2 | Qual é o **overlap** entre o container antigo e o novo? | Settings → Deploy → *Overlap* (ou variável `RAILWAY_DEPLOYMENT_OVERLAP_SECONDS`) |
| U3 | Qual é o **draining** (tempo entre SIGTERM e SIGKILL)? | Settings → Deploy → *Draining* (ou `RAILWAY_DEPLOYMENT_DRAINING_SECONDS`) |
| U4 | O **pre-deploy** tem timeout configurado? | **RESPONDIDO — `KNOWN: unbounded`. Ver abaixo.** |
| U5 | Um **rollback reexecuta** o `preDeployCommand`? | **RESPONDIDO por medição — ver abaixo. A pergunta deixou de importar.** |

### U5 — NON-BLOCKING, e o que ele arrasta junto

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

Uma ressalva sobre o `782` acima, para não virar citação circular: ele saiu daquele experimento **manual**.
Nenhum teste automatizado do repositório chama `seedPermissions`, e não existe schema "pós-purga" em teste
— a `0017` não existe. Quem prova isso em execução é o gate G-U5, abaixo.

E o runtime anterior? Auditoria estática de `apps/api/src` e `packages/*/src` (excluindo testes, migrations,
docs e os arquivos declarados TOMBSTONE/PROVA_HISTORICA): **zero consultas SQL** citam `farm_id`,
`origin_farm_id`, `destination_farm_id`, qualquer das 5 views de nome antigo ou as 3 funções de
sincronização. As únicas ocorrências vivas são chave de permissão, valor de enum, discriminador em memória
e nome de variável — nada que a purga alcance.

**Consequência: U1, U2 e U3 também deixam de ser blockers por si mesmos.** Os três descrevem a mesma
situação — uma instância do binário anterior servindo contra o schema pós-purga — e é justamente ela que a
evidência acima não incrimina. O que continua valendo é o teto, e ele agora tem nome: ver **U4** abaixo.

### U4 — `KNOWN: unbounded`

Era a última pergunta que se acreditava depender de leitura humana no painel. Não dependia: o campo existe
no schema público da API do Railway e foi lido direto.

```
serviceInstance(serviceId: <api>, environmentId: <production>)
  preDeployCommand        = ["node dist/migrate.js"]
  preDeployTimeoutSeconds = NULL      <- vazio
  healthcheckTimeout      = 120
  startCommand            = "node dist/main.js"
```

Pela documentação do Railway o campo aceita 1 a 3600 s e **vazio significa sem limite**. Logo: o
pre-deploy da 05C-1 roda **sem teto externo de tempo**.

**Controle negativo, para o `NULL` não ser confundido com falta de permissão:** na MESMA consulta,
`healthcheckTimeout` voltou `120` e `preDeployCommand` voltou o array real — campos preenchidos vêm
preenchidos. E o serviço `web`, que não tem pre-deploy, devolve `preDeployCommand = null` junto com
`preDeployTimeoutSeconds = null`, exatamente como se espera de um serviço sem essa etapa. O `NULL` do
`api` é valor de configuração, não mascaramento. Não há `railway.json`, `railway.toml` nem qualquer
config-as-code no repositório que possa estar fixando isso — a única fonte é o próprio serviço.

**Por que isso não é a mesma coisa que o teto de SQL.** São dois tetos diferentes, e só um existe:

| Teto | Valor hoje | O que ele alcança |
| --- | --- | --- |
| **Interno, no banco** | `statement_timeout = 120000 ms`; `lock_timeout = 0` (a 05C-1 impõe `2s` local) | só o que acontece DENTRO de um enunciado SQL |
| **Externo, no container** | **nenhum** (`preDeployTimeoutSeconds = null`) | tudo o mais |

O que cai no vão entre os dois: DNS, handshake TLS, aquisição de conexão do pool (que não tem
`connectionTimeoutMillis` configurado), `seedPermissions`, e qualquer travamento do próprio código Node.
Nenhum timeout de banco mata um processo que ainda não chegou a emitir um comando SQL. O
`healthcheckTimeout` de 120 s também não cobre: ele só começa a contar **depois** que o pre-deploy termina.

**Consequência operacional:** um pre-deploy travado não falha o deploy — ele o segura. A falha do
pre-deploy ABORTA o deploy (isso é bom e continua valendo); o que não existe é quem declare a falha por
tempo. Fechar esse risco é configuração de serviço, ação humana, em outra janela — **não** é feito por esta
fatia e **não** foi feito aqui.

#### U4 é `OPERATIONAL MERGE BLOCKER` da 05C-1

O fato não mudou; o que mudou foi quem o liga. **Merge em `main` dispara deploy automático** (Railway e
Vercel implantam a partir de `main`), e o deploy da API roda o pre-deploy, que é onde a `0017` executa.
Então não existe "mesclar agora e decidir o deploy depois": o merge É a decisão de deploy. Com
`preDeployTimeoutSeconds` vazio, um pre-deploy que trave segura o deploy indefinidamente, e nenhum teto
interno alcança isso (tabela acima).

Por isso o rótulo passou de "risco declarado" para **bloqueador de merge**:

| | |
| --- | --- |
| **O que bloqueia** | liberar a PR da 05C-1 para merge |
| **O que NÃO bloqueia** | escrever a fatia, rodar os gates em laboratório, revisar o diff, manter a PR em DRAFT |
| **Como sai** | valor medido no campo *Pre-Deploy Timeout* do serviço `api`, ou contenção equivalente aceita por escrito |
| **Quem executa** | o Maike, no painel do Railway. **Esta fatia não altera nada no Railway** |

**O valor recomendado não está escrito aqui, de propósito.** Propor um número sem medir é repetir o erro do
custo do P1 (decisão 124): um teto chutado baixo derruba deploy legítimo, e um chutado alto não é teto.
O número tem de vir da medição da própria `0017` — quanto tempo o pre-deploy leva de ponta a ponta, com
margem para DNS, handshake, pool e `seedPermissions`, que ficam fora de qualquer teto de SQL. Esta linha
fica preparada para receber esse valor, do agente que mede:

| Origem da medição | Tempo medido do pre-deploy | Teto proposto | Registrado por |
| --- | --- | --- | --- |
| *(a preencher — medição da `0017` em laboratório)* | — | — | — |

### Um risco que U1 encosta e nenhuma das cinco perguntas cobria — FECHADO NA MIGRATION

`migrate()` **continua sem trava de concorrência**: não há advisory lock nem equivalente no runner. Se dois
pre-deploys rodarem sobrepostos — retentativa por restart policy, redeploy disparado em cima de outro — os
dois leem o ledger, os dois veem a `0017` como pendente, e os dois tentam aplicá-la.

O que mudou é que **a `0017` passou a se defender sozinha**: o primeiro comando do arquivo é
`pg_try_advisory_xact_lock(2026, 51)`, e a migration ABORTA com `55P03` se a trava já estiver com outra
transação. A trava é transacional (sai no commit ou no rollback, sem caminho de vazamento) e usa o espaço de
DOIS inteiros, distinto do `pg_advisory_xact_lock(bigint)` da rota de notificações — não há colisão possível
entre os dois. O caminho alternativo (trava dentro do `migrate()`) **não** foi tomado: é mudança de
plataforma, vale para toda migration e pede fatia própria.

Escopo honesto do que isso fecha: protege a `0017` de si mesma, **não** as outras dezesseis migrations, que
seguem sem trava. E o risco residual continua sendo deploy vermelho, nunca banco pela metade — a transação
inteira volta atrás.

### O gate que este veredito cria na 05C-1

**G-U5, obrigatório. O instrumento já existe; o que vale é a EXECUÇÃO registrada.** O binário da BASE
(o commit da API em produção no momento do deploy) tem de subir e servir contra um banco com a `0017`
**aplicada**, provando boot sem erro, login, uma leitura escopada por empresa, uma gravação com conferência
de ROW COUNT — e `seedPermissions` completo, que antes desta fatia só tinha medição manual. Ele roda em
banco descartável: não exige produção nem custo.

Nesta fatia o gate virou `scripts/gate-purga-0017-runtime-anterior.mjs`, e não um teste em
`packages/db/test/`: o sujeito é o **binário** de `apps/api` (dist compilado), e um teste em `packages/db`
faria o pacote de baixo depender do artefato de build do pacote de cima — inversão de camada que
`.claude/rules/architecture.md` proíbe. O próprio script explica as três razões no cabeçalho.

Enquanto a execução não estiver registrada na PR, a reclassificação de U1, U2, U3 e U5 para NON-BLOCKING
continua sendo derivação, não fato consumado — e existir não é rodar.

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

## P7 — locks e timeouts — mecanismo `PASS`

**A política, decidida e medida** (decisão 118): a purga é **uma migration atômica** que pré-adquire os
locks com `lock table ... in access exclusive mode nowait` antes de qualquer DDL, com `set local
lock_timeout` curto como rede de segurança. Nunca fragmentada, nunca com `commit` no corpo do arquivo,
nunca com `create index concurrently` (proibido dentro de transação) e nunca com `cascade`.

**A política deixou de ser plano: é o arquivo.** `supabase/migrations/0017_purge_farm_legacy.sql` implementa
os quatro itens — trava de concorrência (item 1), `set local lock_timeout = '2s'` (item 2), `lock table …
in access exclusive mode nowait` sobre 55 relações em ordem alfabética (item 3) e nenhum `commit`,
`concurrently` ou `cascade` no corpo. Conferir é ler o arquivo; ele nomeia cada objeto que remove.

Por que: a purga inteira, dentro de uma transação, tem janela de `ACCESS EXCLUSIVE` de **mediana ~71 ms**
(medida por uma segunda pessoa, n=7; 98 ms num banco com 500 000 linhas). O `lock table` da `0017` nomeia **55**
relações: as 49 tabelas de escopo, as 5 views de nome antigo e `erp.empresas` — esta última nomeada de
propósito, porque a view `erp.farms` a arrastaria junto de qualquer jeito e lock implícito não tem ordem
declarada. (A decisão 118 falava em "nomeia 54, trava 55", descrevendo o plano antes do arquivo existir.)
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

1. **`set local lock_timeout = '2s'` no topo da migration não é rede, é requisito — e não é teto de
   janela.** *(Implementado: `0017`, item 2.)* Com ele, CADA espera por lock morre em 2 s, com `57014`, rollback total e ledger limpo
   (medido). Sem ele, uma única espera já vira 120 s de indisponibilidade. Mas `lock_timeout` é **por
   comando**, não por transação: a purga adquire mais de trezentos locks de objeto DEPOIS do `lock table`,
   e o pior caso teórico é 2 s × número de comandos que esperam, todo ele com `ACCESS EXCLUSIVE` retido
   nas 55 relações. Medido no laboratório, de forma reproduzível: três `lock table` em sequência, cada um
   esperando ~1,8 s (abaixo do teto), numa transação com `lock_timeout = '2s'` — total de **5401 ms**
   segurando `ACCESS EXCLUSIVE`, com **zero** `57014`.
   **Não existe teto de janela em lugar nenhum** — nem no banco (`statement_timeout` também é por
   comando) nem no container (U4: `preDeployTimeoutSeconds` é nulo). É por isso que o porteiro não é
   opcional: ele é o único instrumento que reduz a probabilidade de ENTRAR numa espera.
2. **O porteiro procura DDL concorrente**, não "banco calmo". Leitura normal não ameaça nada: contra ela o
   NOWAIT falha em 0,72 ms, sem dano.

**P7.1 — a consulta de porteiro.** Painel Supabase → SQL Editor, minutos antes do deploy. A primeira
consulta continua sendo a de sessões vivas; a segunda foi **substituída duas vezes**, e as duas correções
erram para lados opostos:

1. A consulta ORIGINAL era **inatingível** (`mode like '%Exclusive%'` casa com o `ExclusiveLock` em
   `virtualxid` que TODA transação segura, e uma leitura banal de 2 s já devolvia 8 linhas de ruído).
   Critério inatingível é critério ignorado na hora H.
2. A substituta da 05C-G2 corrigia isso, mas passava a marcar `BLOQUEIA` para **qualquer** lock de objeto
   de catálogo, **em qualquer schema**. Medido: um `comment on function` sobre uma função de `public` —
   que não tem relação nenhuma com a purga e não pode bloqueá-la — produzia `BLOQUEIA`. Num banco
   gerenciado, onde o próprio provedor mexe em catálogo, isso vira alarme constante; e alarme constante é
   tão ignorado quanto critério inatingível.

A consulta abaixo resolve o `objid` de cada lock de objeto até o **schema do objeto travado**: `BLOQUEIA`
só quando a disputa é sobre um objeto de `erp` — o conjunto que contém tudo o que a purga remove — e
`ADIA` quando o catálogo está ocupado em outro lugar. Objeto que não resolve (sumiu do catálogo entre o
lock e a leitura) é `BLOQUEIA`: na dúvida, fecha.

```sql
with alvo as (
  select c.oid from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'erp' and c.relkind in ('r','p','v','m')
  union all
  select 'public.erp_migrations'::regclass    -- a migration escreve no ledger; disputa ali também conta
),
objeto as (
  -- resolve o objid do lock de catálogo até o schema DONO do objeto travado
  select l.pid, l.mode, l.classid::regclass::text as catalogo,
         case
           when l.classid = 'pg_proc'::regclass then
             (select n.nspname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where p.oid = l.objid)
           when l.classid = 'pg_type'::regclass then
             (select n.nspname from pg_type t join pg_namespace n on n.oid = t.typnamespace where t.oid = l.objid)
           when l.classid = 'pg_class'::regclass then
             (select n.nspname from pg_class c join pg_namespace n on n.oid = c.relnamespace where c.oid = l.objid)
           when l.classid = 'pg_trigger'::regclass then
             (select n.nspname from pg_trigger g join pg_class c on c.oid = g.tgrelid
                join pg_namespace n on n.oid = c.relnamespace where g.oid = l.objid)
           when l.classid = 'pg_constraint'::regclass then
             (select n.nspname from pg_constraint k join pg_namespace n on n.oid = k.connamespace where k.oid = l.objid)
           when l.classid = 'pg_rewrite'::regclass then
             (select n.nspname from pg_rewrite w join pg_class c on c.oid = w.ev_class
                join pg_namespace n on n.oid = c.relnamespace where w.oid = l.objid)
           when l.classid = 'pg_namespace'::regclass then
             (select n.nspname from pg_namespace n where n.oid = l.objid)
         end as onde
    from pg_locks l
   where l.locktype = 'object' and l.pid <> pg_backend_pid()
     and l.classid in ('pg_proc'::regclass,'pg_type'::regclass,'pg_class'::regclass,'pg_trigger'::regclass,
                       'pg_constraint'::regclass,'pg_rewrite'::regclass,'pg_namespace'::regclass)
     -- lock de OUTRO banco do cluster não disputa objeto nosso; 0 = catálogo compartilhado
     and l.database in (0, (select oid from pg_database where datname = current_database()))
),
ameaca as (
  -- BLOQUEIA: DDL concorrente SOBRE O ALVO. Lock de objeto de catálogo que o LOCK TABLE não pré-adquire
  -- e que o NOWAIT não vê: a purga passa do lock table e trava no drop function/trigger.
  select 'BLOQUEIA'::text as veredito, 'ddl_no_alvo'::text as classe, o.pid::text as quem,
         o.catalogo||' '||o.mode||' em '||coalesce(o.onde,'<objeto sumiu do catálogo>') as detalhe
    from objeto o where o.onde = 'erp' or o.onde is null
  union all
  -- BLOQUEIA: transação preparada segura lock sem backend vivo; não há quem esperar.
  select 'BLOQUEIA','two_phase_pendente', p.gid, p.prepared::text from pg_prepared_xacts p
   where p.database = current_database()
  union all
  -- BLOQUEIA: O PORTEIRO ESTÁ CEGO. Sem `pg_read_all_stats`, `pg_stat_activity` esconde `state` e
  -- `xact_start` dos backends de OUTROS usuários — os ramos ADIA calam, e "consulta vazia libera" vira
  -- mentira. Esta linha existe para que a falta de privilégio REPROVE em vez de silenciar.
  select 'BLOQUEIA','porteiro_invalido', current_user,
         'papel sem pg_read_all_stats: transacao_longa e idle_in_transaction ficam cegos'
   where not (pg_has_role(current_user,'pg_read_all_stats','member')
              or coalesce((select r.rolsuper from pg_roles r where r.rolname = current_user), false))
  union all
  -- ADIA: catálogo ocupado FORA de erp. Não disputa objeto da purga, mas o banco não está parado.
  select 'ADIA','ddl_fora_do_alvo', o.pid::text, o.catalogo||' '||o.mode||' em '||o.onde
    from objeto o where o.onde is not null and o.onde <> 'erp'
  union all
  -- ADIA: transação aberta há mais de 2 s (o NOWAIT falha barato, mas o deploy só falha de novo)
  select 'ADIA','transacao_longa', a.pid::text,
         a.state||' há '||date_trunc('second', now()-a.xact_start)::text
    from pg_stat_activity a
   where a.datname = current_database() and a.pid <> pg_backend_pid()
     and a.backend_type = 'client backend'
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
`55P03` de 0,7 ms sem dano, então espere alguns segundos e reconsulte; consulta vazia libera **desde que
nenhuma linha `porteiro_invalido` apareça** — essa linha diz que a consulta não pôde enxergar, e não que
está limpo.

**O porteiro é um RETRATO, não um intertravamento.** Entre esta leitura e o `begin` da migration não há
nada segurando o estado: qualquer sessão pode abrir um `comment on function` no segundo seguinte. Por isso
o resultado vale por poucos minutos — se o deploy não sair logo, releia. O intertravamento de verdade só
existiria DENTRO da migration, relendo este mesmo critério como primeiro comando da transação e abortando
se houver linha `BLOQUEIA`.

**A `0017` NÃO faz isso, e é importante não confundir as duas travas.** O que ela adquire é
`pg_try_advisory_xact_lock(2026, 51)`, que protege a purga de **outra execução da própria purga** — nada
mais. Contra DDL concorrente de terceiros sobre objeto de `erp`, o que existe continua sendo o `nowait`
(que não enxerga lock de objeto de catálogo) e **este porteiro, lido por gente, minutos antes**. O porteiro
segue obrigatório; ele não foi substituído por nada.

**Validação executada**, em banco descartável local com o schema real (181 tabelas em `erp`, as 3 funções
de sincronização e os 52 gatilhos presentes). Cada cenário foi montado e as DUAS consultas rodaram sobre o
mesmo estado, no mesmo instante:

| # | Cenário montado | Consulta da 05C-G2 | Consulta desta correção | Certo é |
| --- | --- | --- | --- | --- |
| S0 | banco parado | LIBERA | LIBERA | LIBERA |
| S1 | 8 conexões em laço de `select` sobre `erp` | LIBERA | LIBERA | LIBERA |
| S2 | `idle in transaction` sobre `erp.empresas` | `ADIA` | `ADIA` | `ADIA` |
| S3 | fila de lock sobre `erp.warehouses` | `ADIA` | `ADIA` | `ADIA` |
| S4 | `comment on function erp.sincronizar_empresa_legado()` | `BLOQUEIA` | `BLOQUEIA` | `BLOQUEIA` |
| S5 | `comment on function` numa função de **`public`** | **`BLOQUEIA` — falso** | `ADIA` | `ADIA` |
| S6 | transação preparada pendente | `BLOQUEIA` | `BLOQUEIA` | `BLOQUEIA` |
| S7 | `alter table erp.warehouses add column` | `ADIA` | `ADIA` | `ADIA` |
| S8 | S2 **visto por papel sem `pg_read_all_stats`** | **`LIBERA` — falha aberto** | `BLOQUEIA` | não pode liberar |

Placar: a consulta desta correção acerta **9 de 9**; a da 05C-G2 erra **S5** (falso positivo) e **S8**
(falha aberto). O ramo `onde is null` (objeto que sumiu do catálogo entre o lock e a leitura) foi
verificado à parte, com linhas injetadas: `erp` → `BLOQUEIA`, `public` → `ADIA`, `null` → `BLOQUEIA`. Ele é
fail-closed por construção, e esse caso **não** foi observado em cenário real — está escrito aqui como o
que é.

**S8 é o mais importante da tabela e o mais fácil de não ver.** A validação de 8 cenários da 05C-G2 rodou
como SUPERUSUÁRIO. No SQL Editor você não é necessariamente um: `pg_stat_activity` devolve `state` e
`xact_start` NULOS para backends de outros usuários quando o papel não é membro de `pg_read_all_stats`.
Medido lado a lado, no mesmo instante e sobre o mesmo estado: superusuário vê `ADIA`, papel restrito vê
**zero linhas** — e zero linhas era o critério de liberação. É exatamente a situação que a decisão 118
mediu como 120 s de `ACCESS EXCLUSIVE` retido, virando "pode ir".

Uma observação que o S4 entrega de graça: o lock que ele produz é `ShareUpdateExclusiveLock` sobre
`pg_proc`, adquirido por `LockDatabaseObject`. `lock_timeout` aborta qualquer espera por lock de tabela,
índice, linha **ou outro objeto de banco** — não só de relação. É por isso que `set local lock_timeout`
é requisito da migration, e não conforto.


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

## Depois dos cinco

Com P5, P6, P7 **e G-U5** em `PASS`, e **P1** suspenso pela declaração de pré-produção (ou executado, se a
condição de retorno já tiver disparado), a 05C-1 passa a ser uma fatia normal: branch própria, PR DRAFT,
revisão, merge manual. **Nenhuma sessão automatizada autoriza a fatia** — a autorização é do Maike, por
escrito, depois de olhar esta página inteira.

**E ainda assim falta U4.** Os gates acima dizem que a fatia pode ser APLICADA com segurança; U4 é sobre
COMO ela chega em produção. Enquanto o pre-deploy não tiver teto, o merge — que dispara o deploy sozinho —
fica bloqueado. São perguntas diferentes, e é por isso que U4 tem linha própria na matriz: um bloqueador
que só aparecesse na prosa seria lido como observação, e a decisão 128 já custou essa lição uma vez.

## O que esta fatia (05C-1) entrega, e o que ela não resolve

A migration `0017` existe e foi provada aplicando em base zero. Isso NÃO move nenhuma linha da matriz:
gate é sobre produção e sobre execução, e um arquivo que aplica em laboratório é pré-requisito, não prova
de largada. O inventário da fatia e a ordem de remoção estão em `docs/PRE-BASE2-05-APOSENTADORIA.md`; o
procedimento de recuperação, em `docs/DEPLOYMENT.md`.
