# PRE-BASE2-05C-2 — cutover do contador de código da Empresa (`farm` → `empresa`)

> # NORMAL AUTO-DEPLOY IS NOT SAFE FOR THIS CUTOVER.
>
> O merge desta fatia em `main` dispara o deploy automático do Railway, e o pre-deploy
> (`node dist/migrate.js`) executa a migration `0018_empresa_code_sequence.sql` **enquanto o container
> anterior ainda está atendendo tráfego**. Nesse intervalo a API antiga continua pedindo
> `erp.next_code(org, 'farm')` — uma chave que a 0018 acabou de aposentar. `next_code` é
> `insert ... on conflict do update`: chave ausente **não dá erro**, ela **reinicia em 1**, por cima de um
> acervo já numerado. O sintoma que chega ao usuário é um cadastro de Empresa recusado; o que fica no
> banco é a chave legada ressuscitada.
>
> **Estado deste runbook: `BLOCKED`.** Não existe hoje, neste produto, mecanismo comprovável de drenar ou
> parar a versão anterior antes do pre-deploy. A seção B explica com evidência, lista as opções concretas
> e diz o que cada uma custa. Nada aqui autoriza o cutover.

---

## Por que esta fatia é diferente de todas as anteriores

`erp.code_sequences` tem chave primária `(organization_id, entity)`. `'farm'` e `'empresa'` não são dois
rótulos do mesmo contador: são **duas linhas**, dois travamentos e dois valores correntes independentes.
Disso saem dois estados proibidos — e a palavra é *proibidos*, não *degradados*, porque os dois corrompem
numeração visível ao usuário:

| Combinação | O que acontece |
| --- | --- |
| runtime **BASE** + banco **pós-0018** | `next_code(org,'farm')` recria a linha em **1**; o cadastro colide em `unique (organization_id, code)` |
| runtime **HEAD** + banco **pré-0018** | `next_code(org,'empresa')` recria a linha em **1**; a colisão é a mesma |
| runtime BASE + banco pré-0018 | normal (o mundo de hoje) |
| runtime HEAD + banco pós-0018 | normal (o mundo de depois) |

Os quatro quadrantes são **demonstrados**, não argumentados, por `pnpm gate:05c2`
(`scripts/gate-cutover-05c2.mjs`), que tenta gravar a Empresa com o número devolvido e mostra a colisão.

Não existe terceira via. Copiar a linha e manter as duas ativas faz os dois lados emitirem o mesmo número
— medido em `apps/api/test/integration/contador-empresa-transicao.test.ts`. Por isso a 0018 é uma
**substituição** (`update ... set entity = 'empresa'`), e por isso o cutover exige janela single-version.

---

## A. PRECONDIÇÕES

Todas verificáveis antes de tocar em qualquer coisa. Nenhuma se satisfaz por declaração.

| # | Precondição | Como conferir |
| --- | --- | --- |
| A1 | `main` = o commit da PR desta fatia, e a PR está verde | GitHub: CI dos quatro jobs no HEAD |
| A2 | **0017 já aplicada em produção** e comprovada | ledger termina em `0017_purge_farm_legacy.sql` |
| A3 | **0018 ainda ausente** do ledger | `select count(*) from public.erp_migrations where name like '0018%'` → 0 |
| A4 | API em produção é o commit **anterior** a esta fatia | Railway: deployment corrente e seu `commitHash` |
| A5 | `preDeployTimeoutSeconds` definido (não nulo) no serviço `api` | Railway → serviço `api` → config **live**, não staged |
| A6 | `SEED_ON_DEPLOY = 0` | Railway → variáveis do serviço `api` |
| A7 | contador `entity='farm'` **presente** em toda organização com Empresa | consulta A-SQL abaixo |
| A8 | contador `entity='empresa'` **ausente** | idem |
| A9 | `farm.last_value >= max(empresas.code)` em toda organização | idem |
| A10 | zero escritores e zero transações longas sobre `erp.code_sequences` / `erp.empresas` | porteiro P7 (`docs/PRE-BASE2-05C-1-PREFLIGHT.md` § P7.1) |
| A11 | nenhuma outra migration ou deploy concorrente | Railway: nenhum deployment em curso |

**A-SQL — leitura, roda no SQL Editor, cobre A3 e A7 a A9 de uma vez:**

```sql
select
  (select count(*) from public.erp_migrations where name like '0018%')            as ja_aplicada,
  (select count(*) from erp.code_sequences where entity = 'farm')                 as contador_legado,
  (select count(*) from erp.code_sequences where entity = 'empresa')              as contador_canonico,
  (select count(*) from (
     select e.organization_id from erp.empresas e group by e.organization_id
     except
     select cs.organization_id from erp.code_sequences cs where cs.entity = 'farm') x)
                                                                                   as org_sem_contador,
  (select count(*) from erp.code_sequences cs
     join (select organization_id, max(code) mx from erp.empresas group by organization_id) e
       on e.organization_id = cs.organization_id
    where cs.entity = 'farm' and cs.last_value < e.mx)                             as contador_atrasado;
-- exigido: ja_aplicada = 0 · contador_legado > 0 · contador_canonico = 0
--          org_sem_contador = 0 · contador_atrasado = 0
```

Se qualquer linha divergir, **pare**: a própria 0018 recusaria, e recusar em produção no meio do deploy é
pior do que não começar. As mesmas conferências estão dentro da migration (seções 4 e 5), de propósito —
o runbook não substitui o fail-closed, ele evita chegar nele.

> **A5 não é herança da 05C-1.** O `preDeployTimeoutSeconds` foi aplicado para a janela daquela fatia; se
> ele voltar a ficar nulo, o merge desta liga o mesmo risco outra vez — deploy automático, pre-deploy sem
> teto externo, migration destrutiva lá dentro. Reconfira na hora, na config **live**, e não no patch
> staged: em 16/09 a leitura independente encontrou os 300 s **staged e não aplicados**, com a config live
> ainda sem teto.

---

## B. QUIESCE / SINGLE-VERSION GATE — `BLOCKED`

### O que o gate exige

Antes de a 0018 começar, a versão BASE não pode **mais** atender criação de Empresa nem nenhuma rota capaz
de chamar o contador. Não basta "pouco tráfego" nem "fora do horário": o que se exige é a impossibilidade
de uma requisição nova alcançar o binário antigo enquanto a migration roda.

### Por que ele está BLOCKED — evidência, não opinião

**B1. A plataforma faz o contrário, e isso está medido.**
`docs/PRE-BASE2-05C-1-PREFLIGHT.md` (§ U4): *"Enquanto o pre-deploy roda, o container **antigo** continua
atendendo tráfego. Consequência direta: a migration destrutiva executa com o binário anterior servindo.
Medido no deploy de `d4639bb`: o web ficou pronto às 14:14:45 e a API às 14:16:36 — ~1 min 50 s de web novo
conversando com API antiga."* A ordem que o cutover pede é, pelo caminho normal de deploy, **inalcançável**.

**B2. O merge é a largada.**
`docs/REPOSITORY-GOVERNANCE.md`: *"o Railway publica a partir de `main` com `checkSuites: false` e dispara
~2,7 s depois do commit, com pre-deploy `node dist/migrate.js`"*. Não existe "mesclar agora e parar a API
depois": qualquer quiesce tem de estar **valendo antes do merge** e continuar valendo o deploy inteiro.

**B3. O produto não tem alavanca.** Verificado, não suposto:

- `apps/api/src/config.ts` — a superfície de variáveis é fechada e conhecida (`NODE_ENV`, `PORT`, `HOST`,
  `DATABASE_URL`, `API_LOG_LEVEL`, `WEB_ORIGIN`, `AUTH_MODE`, `LOCAL_AUTH_SECRET`, `SUPABASE_JWT_SECRET`,
  `SUPABASE_URL`, `RATE_LIMIT_MAX`, `LOGIN_RATE_LIMIT_MAX`). Nenhuma desliga escrita. O schema **não** é
  `.strict()`, então inventar `MAINTENANCE=1` seria ignorado **em silêncio** — pior que não fazer nada.
- `apps/api/src/server.ts` — as rotas são registradas incondicionalmente; não há gate global de escrita.
- `apps/api/src/routes/health.ts` — `/health` só falha se o **banco** falhar; `/health/live` é 200
  incondicional. Não dá para derrubar o healthcheck de propósito sem derrubar o banco.
- Busca por `manutencao|maintenance|read.?only|kill|drain|quiesce|flag` em `apps/`, `packages/`,
  `scripts/`, `supabase/`, `.github/`: nenhum mecanismo. As ocorrências são "manutenção" de frota
  (domínio) e `readOnly` de campo de formulário.

**B4. Sem redundância, quiesce = indisponibilidade total.** 1 réplica, região `iad`, sem volume
(PREFLIGHT § U4). Não existe "tirar uma réplica do balanceador": parar é parar. A janela tem de ser
declarada com hora, e o comportamento do frontend sem backend **não está testado**.

### Ideias que parecem quiesce e não são — descartadas aqui para não voltarem na hora H

| Ideia | Por que não serve |
| --- | --- |
| Fechar período contábil | `erp.assert_period_open` é chamada pelas rotas financeiras e de vendas. O caminho que aloca o código da Empresa é `apps/api/src/routes/resources.ts:232`, que **não** a chama. Congela o que não precisa e não congela o que precisa. |
| Estrangular `WEB_ORIGIN` (CORS) | CORS é regra de **navegador**. Qualquer cliente não-browser continua escrevendo. |
| `RATE_LIMIT_MAX=0` | O rate limit é global e é registrado **antes** de `healthRoutes`: derrubaria `GET /health`, que é o healthcheck do serviço. Troca o problema por um deploy que não sobe. |
| Reusar o porteiro P7 | Ele mede **DDL concorrente** sobre objetos de `erp`. Não diz nada sobre quantas versões da API estão servindo. Usá-lo como prova de single-version seria verde que não prova nada. |

### Opções concretas que existiriam — nenhuma executada, nenhuma provada aqui

Estas são as saídas reais. A escolha é do Maike, e todas exigem decisão humana:

1. **Parar o serviço `api` no painel do Railway antes do merge**, e só então mesclar. É indisponibilidade
   total e declarada. **Ressalva não verificada:** há suspeita de que alterar variável ou configuração do
   serviço dispare um novo deployment — que reexecutaria o pre-deploy e tornaria a manobra
   autodestrutiva. **Isso precisa ser confirmado contra a documentação do Railway antes de qualquer
   dependência.** Este runbook não confirma, e não tem como confirmar sem tocar a plataforma.
2. **Aplicar a 0018 fora do pre-deploy**, com o serviço parado. Colide com `docs/DEPLOYMENT.md`
   (*"Nunca aplicar arquivo solto: a ordem é a garantia"*) e obriga a decidir o que vai para
   `public.erp_migrations` — sem a linha no ledger, o pre-deploy seguinte tentaria aplicar de novo (e
   seria recusado pela pré-condição 5.1, que é o comportamento certo, mas o deploy falharia).
3. **Embutir um modo de manutenção no produto**, em **duas entregas**: o deploy N liga a capacidade, o
   deploy N+1 carrega a 0018. É superfície nova (`config.ts` + hook global ou gate em `runService`), com
   verificação reversa própria — portanto **outra PR**, fora da fronteira desta fatia.

> Enquanto uma dessas não for escolhida, executada e **comprovada**, o gate B permanece `BLOCKED`. Ele não
> se satisfaz com "janela de manutenção" como frase, nem com CI verde, nem com o laboratório da seção E:
> nenhum deles prova que só uma versão estava servindo em produção.

---

## C. CUTOVER

Sequência válida **somente** depois de B resolvido. Enquanto B estiver `BLOCKED`, esta seção é plano, não
autorização.

1. **Congelar o gate B** pelo mecanismo que tiver sido escolhido e comprovado. Registrar hora de início.
2. **Comprovar que ninguém mais escreve**: releia A-SQL e o porteiro P7. `escrita_em_curso`,
   `idle_in_transaction` e `fila_de_lock` sobre `erp.code_sequences` / `erp.empresas` têm de estar vazios.
   O porteiro é **retrato**: vale poucos minutos, e a leitura tem de ser imediatamente anterior ao passo 4.
3. **Gate final de banco**: A-SQL inteiro com os cinco valores exigidos.
4. **Autorizar o merge** da PR. Ele é a largada: ~2,7 s depois o pre-deploy começa.
5. **Pre-deploy aplica a 0018.** Dentro dela, em ordem: trava `pg_try_advisory_xact_lock(2026, 52)` →
   `lock_timeout = 2s` → `lock table erp.code_sequences in access exclusive mode nowait` e
   `erp.empresas in share mode nowait` → pré-condições → `update` → pós-condições. Qualquer falha reverte
   a transação inteira e **aborta o deploy**: o runtime novo não sobe.
6. **A API nova sobe** com `SEQUENCIA_EMPRESA = "empresa"`.
7. **Validar**, nesta ordem: `GET /health` 200 → ledger com `0018_empresa_code_sequence.sql` → zero linhas
   `entity='farm'` → o contador canônico presente com o **mesmo** `last_value` de antes → cadastrar **uma**
   Empresa real e conferir que o código alocado é maior que todos os existentes e não se repete.
8. **Só então reabrir o tráfego**, desfazendo o mecanismo do passo 1.

**Janela.** Medido em laboratório (§ E): a 0018 leva de **6,8 ms** (1 organização) a **27,6 ms** (500
organizações, 10 000 empresas). O que dimensiona a janela **não** é a migration: é build + pre-deploy +
boot + healthcheck do deploy inteiro, que na 05C-1 levou **2 min 37 s** de ponta a ponta — três ordens de
grandeza acima. Não trate o número de laboratório como SLA de produção.

---

## D. ROLLBACK / ABORT

Quatro pontos, com respostas diferentes. Misturá-los é o erro caro.

### D1 — abort ANTES da 0018 (gate B ou A-SQL reprovou)

Sem consequência. Desfaça o quiesce, reabra o tráfego, **não mescle**. Nada foi tocado no banco.

### D2 — a 0018 falhou e a transação reverteu

O comportamento desejado, não um problema. A transação é tudo-ou-nada: o contador continua `'farm'`, o
ledger não recebeu linha, e o deploy foi abortado — o runtime novo **não subiu**, então continua valendo a
combinação normal (runtime BASE + banco pré-0018). Leia a mensagem: ela nomeia a pré-condição que
reprovou. Corrija o estado (decisão **humana**, nunca `update` automático) e recomece de A.

### D3 — a 0018 aplicou, mas o HEAD não ficou saudável

**O estado mais delicado.** O banco está pós-0018 e o binário que está de pé pode ser o BASE — que é o
quadrante proibido. Nesta situação:

- **NÃO** faça rollback de imagem no Railway esperando que o banco volte junto. Ele não volta:
  *"O rollback restaura imagem e variáveis. **Não desfaz migration**"* (PREFLIGHT § U4). Voltar a imagem
  aqui **coloca** o sistema no quadrante proibido em vez de tirá-lo.
- Mantenha o tráfego **fechado**. A prioridade é fazer o HEAD subir, não restaurar o antigo.
- Se o HEAD não subir de jeito nenhum, a volta do contador é uma **migration nova** (`0019`) que renomeia
  `'empresa'` de volta para `'farm'`, com as mesmas pré-condições invertidas — o runner é forward-only e
  não existe reversão de migration pela plataforma. Isso é fatia própria, escrita com calma, **não** um
  improviso de madrugada.

### D4 — HEAD saudável e **código novo já consumido**

A partir do momento em que uma Empresa real recebe número pelo contador `'empresa'`, voltar ao binário
`'farm'` deixa de ser trivial: a chave legada não existe, e a API antiga reiniciaria a numeração em 1 por
cima do que acabou de ser gravado. **Não existe rollback trivial aqui, e este runbook não promete um.**

O caminho, se for mesmo necessário voltar: fechar o tráfego, escrever a migration de volta com o
`last_value` **atual** (não o de antes do cutover — o contador andou), e só então trocar o binário. É
intervenção humana, fail-closed, com o mesmo rigor do cutover de ida.

> **Regra geral dos quatro casos:** prefira **STOP** e intervenção humana a automação. Um rollback
> automático que erra o quadrante transforma um incidente de indisponibilidade num incidente de
> numeração — e numeração de cadastro é dado que o usuário já viu.

---

## E. ENSAIO SEM PRODUÇÃO — o que o laboratório prova, e o que ele não prova

Reproduzível com `pnpm gate:05c2` e com as quatro suítes `packages/db/test/cutover-0018-*.test.ts`.

**Prova:** a ordem operacional (banco em 0017 → 0018 → runtime novo), a preservação exata do valor, a
continuidade `N → N+1`, a recusa fail-closed em oito estados impossíveis, o comportamento sob concorrência
real (runner duplo, escritor em voo, criação de Empresa em voo, rollback integral) e os dois quadrantes
proibidos.

**Medido** em banco descartável local, com a 0018 aplicada pelo mesmo caminho do runner (uma transação):

| Cenário | Transação da 0018 |
| --- | --- |
| 1 organização · 2 empresas · 5 linhas de contador | **6,8 ms** |
| 50 organizações · 1 000 empresas · 250 linhas de contador | **9,8 ms** |
| 500 organizações · 10 000 empresas · 2 500 linhas de contador | **27,6 ms** |

O trabalho cresce com o número de ORGANIZAÇÕES (uma linha de contador cada), não com o acervo de Empresas
— o `max(code)` por organização é agregação sobre índice. Em produção hoje são **2 empresas em 1
organização**, ordens de grandeza abaixo do maior ponto medido.

Contenção e recusa, no mesmo ensaio:

- escritor em voo (`next_code` de outra sessão, transação aberta) → a 0018 **recusa em 1,2 ms**
  (`could not obtain lock on relation "erp.code_sequences"`), e o estado fica **inteiro**. É a falha barata
  que o `nowait` compra;
- sequência proibida encenada — binário antigo contra banco pós-0018 → `next_code` devolveu **1** e o
  cadastro **colidiu**, como o gate prevê. É o comportamento correto do banco e o incorreto do produto.

**O que dimensiona a janela NÃO é a migration.** São build + pre-deploy + boot + healthcheck do deploy
inteiro, que na 05C-1 levaram **2 min 37 s** de ponta a ponta — três ordens de grandeza acima dos 27,6 ms
do pior caso medido aqui. Tratar o número de laboratório como SLA de produção seria ler a medição ao
contrário.

**Não prova, e não pode:** que apenas uma versão da API estava servindo em produção. Isso é observação da
plataforma, não do banco — e é exatamente o gate B. Nenhum número desta seção autoriza o cutover.

---

## Referências

- `supabase/migrations/0018_empresa_code_sequence.sql` — a migration, com as pré e pós-condições
- `apps/api/src/lib/sequencia-empresa.ts` — a constante de runtime e o registro histórico do risco
- `scripts/gate-cutover-05c2.mjs` — a matriz dos quatro quadrantes (`pnpm gate:05c2`)
- `scripts/lib/cutover-contador.mjs` — a decisão auto-expirável da exceção de version skew
- `packages/db/test/cutover-0018-*.test.ts` — fresh, upgrade, fail-closed, concorrência
- `apps/api/test/integration/contador-empresa-transicao.test.ts` — as duas armadilhas, medidas
- `docs/PRE-BASE2-05C-1-PREFLIGHT.md` § U4 e § P7.1 — comportamento do pre-deploy e o porteiro de locks
- `docs/DEPLOYMENT.md` — ordem de deploy, rollback e checklist de go-live
