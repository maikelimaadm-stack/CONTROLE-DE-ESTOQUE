# PRE-BASE2-05C-2 — cutover do contador de código da Empresa (`farm` → `empresa`)

> # NORMAL AUTO-DEPLOY IS NOT SAFE FOR THIS CUTOVER.
>
> O merge desta fatia em `main` dispara o deploy automático do Railway, e o pre-deploy
> (`node dist/migrate.js`) executa a migration `0018_empresa_code_sequence.sql` **enquanto o container
> anterior ainda está atendendo tráfego**. Nesse intervalo a API antiga continua pedindo
> `erp.next_code(org, 'farm')` — uma chave que a 0018 acabou de aposentar. `next_code` é
> `insert ... on conflict do update`: chave ausente **não dá erro**, ela é **criada** e devolve **1**.
>
> O que acontece daí em diante depende de haver acervo, e o cadastro roda numa **única transação**
> (`runService` → `withTx`: `begin` → serviço → `commit`, `rollback` em erro):
>
> - **o número emitido COLIDE** com um código existente — o `insert` bate no `unique (organization_id,
>   code)` e a transação volta atrás inteira. O usuário leva um cadastro recusado, e **nada fica no banco**:
>   nem a Empresa, nem a linha de contador que a tentativa criou. Barulhento e sem sequela;
> - **o número NÃO colide** — o `insert` passa, a transação **comita**, e a chave legada fica **gravada
>   depois do cutover**, sem erro, sem log, sem sintoma.
>
> E o que separa os dois não é "ter acervo": é a colisão. Uma organização **sem Empresa** cai no segundo
> caso, e uma organização cuja numeração **não começa em 1** também — só que pior, porque lá nem o cadastro
> canônico seguinte denuncia o estado. Ver a tabela de quadrantes abaixo.
>
> **É o segundo caso que obriga a janela**, e é ele que não se pode contar com "alguém vai ver o erro":
> ele não levanta nenhum. O sentido inverso (binário novo contra banco pré-0018) tem as mesmas duas
> formas — e, na organização sem Empresa, deixa a chave canônica gravada ANTES da migration, estado que a
> própria 0018 depois **recusa**. Tudo isso está demonstrado em `pnpm gate:05c2` (Q3, Q3b, Q4, Q4b).
>
> **Estado deste runbook: `BLOCKED`.**
>
> O bloqueio **mudou de natureza** e é preciso ser exato sobre isso. O PRODUTO não tem alavanca de
> manutenção (§B3) — isso continua verdade. Mas a **plataforma tem uma primitiva documentada** que faz o
> que o gate pede: `Remove` **para o deployment que está servindo**
> ([Deployments Reference](https://docs.railway.com/deployments/reference)). Dizer "não existe mecanismo"
> era impreciso, e a §B4 passa a tratá-lo como **mecanismo preferencial candidato**: remover o deployment
> ativo da API ANTES do merge.
>
> O que ainda falta é **confirmação ACCOUNT-SPECIFIC** (§B6): que `Remove` não deleta o service, que o
> source segue ligado a GitHub/`main`, que o autodeploy continua habilitado e que um commit novo em `main`
> ainda inicia deployment. Sem isso, a janela pode terminar com a API parada e nenhum caminho de volta.
>
> Nada aqui autoriza o cutover, e **nada aqui foi executado no Railway**.

---

## Por que esta fatia é diferente de todas as anteriores

`erp.code_sequences` tem chave primária `(organization_id, entity)`. `'farm'` e `'empresa'` não são dois
rótulos do mesmo contador: são **duas linhas**, dois travamentos e dois valores correntes independentes.
Disso saem estados **proibidos** — a palavra é *proibidos*, não *degradados*, porque corrompem numeração
visível ao usuário. E o cadastro roda numa **única transação**, então quem decide o estrago é o `commit`:

| Combinação | Organização | O que acontece | O que SOBRA no banco |
| --- | --- | --- | --- |
| runtime BASE + banco pré-0018 | qualquer | normal (o mundo de hoje) | numeração segue |
| runtime HEAD + banco pós-0018 | qualquer | normal (o mundo de depois) | numeração segue |
| runtime **BASE** + banco **pós-0018** | acervo **1..N** | pede `'farm'`, recebe 1, colide no `unique` → **rollback** | **nada** — nem a Empresa, nem a linha de contador da tentativa |
| runtime **BASE** + banco **pós-0018** | **sem** Empresa | pede `'farm'`, recebe 1, **grava e comita** | **a chave legada, viva depois do cutover** |
| runtime **BASE** + banco **pós-0018** | acervo **LACUNAR** | pede `'farm'`, recebe 1, **grava e comita** — e o canônico seguinte TAMBÉM | **as duas chaves, convivendo, sem que nada nunca levante erro** |
| runtime **HEAD** + banco **pré-0018** | acervo **1..N** | pede `'empresa'`, recebe 1, colide → **rollback** | **nada** |
| runtime **HEAD** + banco **pré-0018** | **sem** Empresa | pede `'empresa'`, **grava e comita** | a canônica **antes** da migration — e a 0018 passa a ter de RECUSAR aquele banco |

**O discriminador é a COLISÃO, não a existência de acervo.** Esta foi a segunda modelagem errada desta
fatia, achada por red team independente e reproduzida: o que decide é se o número que a chave
**ressuscitada** emite bate num código que já existe. Uma organização cuja numeração não começa em 1
(códigos 5 e 6, por exemplo) tem Empresas **e** não colide — e é o pior caso dos sete, porque em
"sem Empresa" o cadastro canônico seguinte pelo menos morre e denuncia o estado, enquanto no acervo
lacunar a chave canônica ficou intacta, emite o próximo livre e **também comita**. As duas chaves passam a
conviver indefinidamente na mesma organização, sem sintoma nenhum.

Numeração legada arbitrária não é hipótese: a `0014_company_physical_migration.sql` já registra que "as
empresas existentes nasceram com código escrito à mão" e reconcilia o contador com `greatest`. Pela tela
de hoje a lacuna não se cria (a unicidade de código é total, sem recorte por `deleted_at`), então o vetor
é **dado legado ou manual** — e por isso ele entra na conferência pré-cutover do passo A, não na torcida.

E vale para o outro sentido também: a recusa da 0018 (último caso) **não** depende de a organização estar
vazia. Uma organização com acervo que comite a chave canônica antes da migration deixa o banco **inteiro**
irrecusável pela 0018 — uma organização suja basta para travar o cutover de produção.

Os sete casos são **demonstrados**, não argumentados, por `pnpm gate:05c2`
(`scripts/gate-cutover-05c2.mjs`), que executa o cadastro como a API o executa — `begin` → `next_code` →
`insert` → `commit`/`rollback` — e **inspeciona o estado persistente depois**.

A linha que obriga a janela é a das organizações **sem Empresa**: ali não há colisão, ninguém vê erro, e o
dano fica gravado. Contar só a metade barulhenta seria contar a metade que dá menos medo.

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
| A12 | o papel de `MIGRATE_DATABASE_URL` tem **bypass de RLS** | `select current_user, rolsuper, rolbypassrls from pg_roles where rolname = current_user` → um dos dois `true` |
| A13 | **quais organizações têm numeração lacunar** (acervo que não começa em 1, ou com buraco em `1..max(code)`) — são as que caem no caso silencioso Q3c se o BASE servir depois do cutover | `select organization_id, min(code), max(code), count(*) from erp.empresas group by 1 having min(code) > 1 or count(*) <> max(code);` — o resultado não bloqueia nada, mas dimensiona o risco da janela |

> **Por que A12 existe, e por que ela não é zelo.** `0007_rls.sql` aplica `force row level security` em
> toda tabela de `erp` — o que vale inclusive para o DONO da tabela — e a política `tenant_isolation` é
> `to erp_app, authenticated`. Um papel fora dessas roles e sem bypass enxerga **zero linha** em
> `erp.code_sequences` e `erp.empresas`. Com zero linha, todas as conferências da 0018 passam por
> vacuidade e ela COMMITA sem mover nada, deixando o ledger dizer que o cutover aconteceu. Medido: antes
> da guarda existir, aplicar a 0018 por um papel `nobypassrls` devolvia sucesso, gravava `0018` no ledger
> e mantinha `entity='farm'` de pé.
>
> A migration agora se recusa sozinha nesse caso (seção 0: preflight de papel + `row_security = off`), e
> `packages/db/test/cutover-0018-fail-closed.test.ts` prova a recusa com um papel real sem bypass. A12
> continua na lista mesmo assim porque **descobrir isso no pre-deploy é tarde**: a janela já estaria
> aberta e o serviço já parado. Confira antes de começar, não durante.

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
> teto externo, migration destrutiva lá dentro. Reconfira na hora, e na config **live**, nunca no patch
> staged.
>
> Essa distinção não é teórica, e o que aconteceu em 16/09 é a razão de ela estar escrita aqui — em duas
> leituras, nesta ordem:
>
> 1. antes do merge da 05C-1, a leitura independente encontrou os 300 s **staged e NÃO aplicados**, com a
>    config live ainda sem teto. Isso reprovou a janela (`DECISÃO = BLOCKED`);
> 2. o proprietário então **aplicou** a mudança, e a releitura confirmou `preDeployTimeoutSeconds` **live
>    = 300** — foi assim, já fechado, que a 05C-1 seguiu para o merge.
>
> Ou seja: o estado final registrado em `docs/PRE-BASE2-05-APOSENTADORIA.md` ("U4 fechado antes do merge,
> 300 na config live") é o do passo 2, e não contradiz o passo 1. O que o passo 1 prova, e o motivo de
> ficar aqui, é que `describe-service` mostra staged e live FUNDIDOS: só comparar `get-service-config`
> com `get-staged-changes` separa os dois. Uma leitura que não faz isso aprova uma janela que não existe.

---

## B. QUIESCE / SINGLE-VERSION GATE — `BLOCKED` (por confirmação, não por ausência de mecanismo)

### O que o gate exige

Antes de a 0018 começar, a versão BASE não pode **mais** atender criação de Empresa nem nenhuma rota capaz
de chamar o contador. Não basta "pouco tráfego" nem "fora do horário": o que se exige é a impossibilidade
de uma requisição nova alcançar o binário antigo enquanto a migration roda.

### B1. O caminho normal de deploy faz o CONTRÁRIO — e agora isso está documentado, não só medido

A documentação do Railway publica a ordem das fases (*Troubleshooting Slow Deployments* →
*Understanding deployment phases*):

| Fase | O que acontece |
| --- | --- |
| Build | a imagem é construída |
| **Pre-Deploy** | **o pre-deploy command executa** — "*Pre-deploy commands execute between building and deploying your application, handling tasks like database migrations*" |
| Deploy | o container novo é criado e iniciado |
| Network | healthchecks |
| **Post-Deploy** | **"*Previous deployment is drained and removed*"** |

Ou seja: **a instância anterior só é retirada na ÚLTIMA fase**, depois que a migration já rodou. Não é um
detalhe de implementação nem azar de timing — é o desenho da plataforma. A medição própria concorda:
`docs/PRE-BASE2-05C-1-PREFLIGHT.md` (§ U4) registrou ~1 min 50 s de binário antigo servindo durante o
deploy de `d4639bb`.

Pelo caminho normal, portanto, a ordem que o cutover exige é **inalcançável**. Isso não mudou.

### B2. O merge é a largada

`docs/REPOSITORY-GOVERNANCE.md`: *"o Railway publica a partir de `main` com `checkSuites: false` e dispara
~2,7 s depois do commit, com pre-deploy `node dist/migrate.js`"*. Não existe "mesclar agora e parar a API
depois": qualquer quiesce tem de estar **valendo antes do merge** e continuar valendo o deploy inteiro.

### B3. O PRODUTO não tem alavanca — e isso continua verdade

Verificado, não suposto:

- `apps/api/src/config.ts` — a superfície de variáveis é fechada e conhecida. Nenhuma desliga escrita. O
  schema **não** é `.strict()`, então inventar `MAINTENANCE=1` seria ignorado **em silêncio** — pior que
  não fazer nada.
- `apps/api/src/server.ts` — as rotas são registradas incondicionalmente; não há gate global de escrita.
- `apps/api/src/routes/health.ts` — `/health` só falha se o **banco** falhar; `/health/live` é 200
  incondicional. Não dá para derrubar o healthcheck de propósito sem derrubar o banco.
- Busca por `manutencao|maintenance|read.?only|kill|drain|quiesce|flag` em `apps/`, `packages/`,
  `scripts/`, `supabase/`, `.github/`: nenhum mecanismo.

### B4. Mas a PLATAFORMA tem uma primitiva — e o runbook não pode dizer que não existe

Esta é a correção da auditoria externa, e ela importa: **a ausência de alavanca no produto não é ausência
de mecanismo**. A documentação oficial do Railway descreve uma primitiva que faz exatamente o que o gate
pede — parar o deployment que está servindo:

| Fonte | O que diz |
| --- | --- |
| [Deployments Reference → Remove](https://docs.railway.com/deployments/reference) | "*Stops the currently running deployment, this also marks the deployment as `REMOVED` and moves it into the history section*" |
| [Deployment Actions → Remove](https://docs.railway.com/deployments/deployment-actions) | remover pelo menu de três pontos "*will remove the deployment and stop any further project usage*" |
| [CLI `railway down`](https://docs.railway.com/cli/down) | remove o último deployment bem-sucedido — **o serviço não é deletado** |

São **duas operações distintas**, e o passo C usa a primeira: o `Remove` do **dashboard**, sobre o
deployment. A garantia de que "o serviço não é deletado" está documentada para o `railway down` da **CLI**,
e a segunda linha fala em "*stop any further project usage*", que é escopo de PROJETO — mais largo que o de
um deployment. Por isso §B6.1 continua sendo uma confirmação a fazer na conta, sobre a operação do
dashboard, e não algo que esta tabela já tenha respondido.

**MECANISMO PREFERENCIAL CANDIDATO: `Remove` no deployment ATIVO da API, ANTES do merge.**

Ele é preferencial porque ataca o alvo certo — a instância que serve — em vez de mexer em configuração.
Custa **indisponibilidade total** da API durante a janela: sem redundância (1 réplica, região `iad`, sem
volume), quiesce e indisponibilidade são a mesma coisa. Essa aceitação é uma **decisão do Maike que ainda
não foi tomada**, e este documento não a presume — ela entra em §B6 como item 8, junto com a hora
declarada da janela. O tamanho do custo, aliás, é desconhecido: o comportamento do frontend sem backend
**não está testado**.

**Por que NÃO `scale = 0` como primeira opção:** mexer em réplicas é mudar CONFIGURAÇÃO do serviço, o que
acrescenta um passo de restauração (voltar a 1) e, pior, cai na mesma dúvida de "alterar configuração
dispara deployment novo?". `Remove` age sobre o deployment, não sobre a configuração.

### B5. Por que o gate continua BLOCKED mesmo com a primitiva documentada

Documentação **não** é confirmação deste projeto. O que falta é ACCOUNT-SPECIFIC, e está listado em §B6.
Fechar o blocker só com a leitura da documentação seria trocar uma afirmação não verificada ("não existe
mecanismo") por outra ("o mecanismo funciona aqui") — e a segunda é a que derruba produção se estiver errada.

O risco concreto: se `Remove` desligar o autodeploy, desconectar o source ou impedir que um commit novo em
`main` inicie deployment, a janela termina com a API parada, a 0018 não aplicada e **nenhum caminho
automático de volta**.

### B6. O que precisa ser confirmado, SOMENTE LEITURA, antes do merge

Confirmação **fora desta missão** — nenhuma alteração no Railway foi feita nem é autorizada aqui:

1. `Remove` **não deleta o service** (só o deployment);
2. o source continua conectado ao **GitHub/`main`**;
3. o **autodeploy continua habilitado** depois de remover o deployment;
4. um **commit novo em `main`** continua elegível para iniciar deployment;
5. `Remove` **não executa** pre-deploy nem migration;
6. **não sobra outra instância** da API servindo (réplicas, região extra, deployment antigo ativo);
7. **fallback**, caso o autodeploy não inicie sozinho: `Deploy Latest Commit` — só com autorização humana e
   só depois de confirmar que `main` está no merge aprovado;
8. a **indisponibilidade total** da API durante a janela é aceita, com **hora declarada** — decisão do
   Maike, pedida na hora e para aquela janela, ciente de que o comportamento do frontend sem backend não
   está testado.

### Ideias que parecem quiesce e não são — descartadas aqui para não voltarem na hora H

| Ideia | Por que não serve |
| --- | --- |
| Fechar período contábil | `erp.assert_period_open` é chamada pelas rotas financeiras e de vendas. O caminho que aloca o código da Empresa é `apps/api/src/routes/resources.ts`, que **não** a chama. Congela o que não precisa e não congela o que precisa. |
| Estrangular `WEB_ORIGIN` (CORS) | CORS é regra de **navegador**. Qualquer cliente não-browser continua escrevendo. |
| `RATE_LIMIT_MAX=0` | O rate limit é global e é registrado **antes** de `healthRoutes`: derrubaria `GET /health`, que é o healthcheck do serviço. Troca o problema por um deploy que não sobe. |
| Reusar o porteiro P7 | Ele mede **DDL concorrente** sobre objetos de `erp`. Não diz nada sobre quantas versões da API estão servindo. Usá-lo como prova de single-version seria verde que não prova nada. |
| `RAILWAY_DEPLOYMENT_DRAINING_SECONDS` | Governa quanto tempo o deployment ANTIGO ganha para encerrar **no post-deploy** — depois de a migration já ter rodado. Não antecipa nada. |

### Alternativas ao mecanismo preferencial — continuam disponíveis, nenhuma provada

1. **Aplicar a 0018 fora do pre-deploy**, com o serviço parado. Colide com `docs/DEPLOYMENT.md`
   (*"Nunca aplicar arquivo solto: a ordem é a garantia"*) e obriga a decidir o que vai para
   `public.erp_migrations` — sem a linha no ledger, o pre-deploy seguinte tentaria aplicar de novo (e
   seria recusado pela pré-condição 5.1, que é o comportamento certo, mas o deploy falharia).
2. **Embutir um modo de manutenção no produto**, em **duas entregas**: o deploy N liga a capacidade, o
   deploy N+1 carrega a 0018. É superfície nova (`config.ts` + hook global ou gate em `runService`), com
   verificação reversa própria — portanto **outra PR**, fora da fronteira desta fatia.

> Enquanto os sete pontos de §B6 não forem confirmados no projeto real, o gate B permanece `BLOCKED`. Ele
> não se satisfaz com "janela de manutenção" como frase, nem com CI verde, nem com o laboratório da seção
> E, nem com a documentação da plataforma: nenhum deles prova que só uma versão estava servindo **aqui**.

---

## C. CUTOVER

Sequência **candidata**, válida somente depois de B resolvido — isto é, depois que os sete pontos de §B6
forem confirmados no projeto real. Enquanto B estiver `BLOCKED`, esta seção é plano, não autorização.

O mecanismo assumido aqui é o preferencial de §B4: **remover o deployment ativo da API antes do merge**.

| # | Passo | O que comprova / registra |
| --- | --- | --- |
| **A** | **Preflight com a API ainda no ar** | A-SQL inteiro (5 valores exigidos), porteiro P7 e A12. Com a API viva, porque é o último momento em que dá para medir o sistema funcionando |
| **B** | **Conferir o Railway, somente leitura** | source = GitHub/`main`; autodeploy **habilitado**; `preDeployTimeoutSeconds` **live** = 300 (não staged); `SEED_ON_DEPLOY = 0`; **nenhuma** staged change; **nenhum** deployment em curso |
| **C** | **`Remove` no deployment ATIVO da API** | o deployment corrente para de servir e vai para o histórico como `REMOVED` |
| **D** | **Comprovar que o BASE morreu** | deployment antigo em `REMOVED`; **zero** instância da API servindo; o endpoint público **indisponível**; zero escritor e zero requisição relevante |
| **E** | **Reler P7 + A-SQL + A12 DEPOIS de parar a API** | é esta leitura que vale como gate, não a do passo A: entre A e D o mundo mudou de propósito |
| **F** | **Autorização humana para o merge** | decisão do Maike, registrada. O merge é irreversível como largada |
| **G** | **Merge da PR** | ~2,7 s depois o deploy novo começa |
| **H** | **Pre-deploy aplica a 0018 sem BASE servindo** | advisory lock `(2026,52)` → `lock_timeout = 2s` → `lock table` `access exclusive`/`share` `nowait` → pré-condições → `update` → pós-condições. Qualquer falha reverte tudo e **aborta o deploy** |
| **I** | **A API nova sobe** | `SEQUENCIA_EMPRESA = "empresa"` |
| **J** | **Validar, nesta ordem** | `GET /health` 200 → ledger com `0018_empresa_code_sequence.sql` → **zero** linhas `entity='farm'` → contador canônico com o **mesmo** `last_value` de antes → cadastrar **uma** Empresa real e conferir que o código é maior que todos e não se repete |

Só depois de **J** a janela se encerra. Reabrir tráfego antes de validar é transformar uma janela
declarada num incidente silencioso.

> **Se o autodeploy não iniciar sozinho depois do `Remove`** (passo G não dispara deploy): o fallback é
> `Deploy Latest Commit`, **com autorização humana** e só depois de confirmar que `main` está no merge
> aprovado. Nunca dispare deploy de um `main` que você não conferiu.

**Janela.** Medido em laboratório (§ E): a 0018 leva de **6,8 ms** (1 organização) a **27,6 ms** (500
organizações, 10 000 empresas). O que dimensiona a janela **não** é a migration: é o deploy inteiro —
build + pre-deploy + boot + healthcheck —, que na 05C-1 levou **2 min 37 s** de ponta a ponta, três ordens
de grandeza acima. Com `Remove` antes do merge, some a isso o tempo em que a API fica **fora do ar**, que
começa no passo C e só termina em J. Não trate o número de laboratório como SLA de produção.

---

## D. ROLLBACK / ABORT

Quatro pontos, com respostas diferentes. Misturá-los é o erro caro.

### D1 — abort ANTES do merge (gate B, A-SQL ou a comprovação do passo D reprovou)

**Antes de qualquer restauração, MEÇA — não deduza pelo título desta seção:**

```sql
select count(*) from public.erp_migrations where name like '0018%';   -- tem de vir 0
```

Se vier **1**, você **não** está em D1: vá para **D3**, e o BASE **não** sobe. Esta conferência é uma
guarda, não uma recapitulação: às 3h da manhã, com a API fora do ar, ninguém navega o fluxograma pelo
título — vai-se direto à seção que promete restaurar o serviço. D1 é a única porta deste documento que
manda SUBIR O BASE, e subi-lo contra um banco pós-0018 é precisamente o quadrante proibido.

Confirmado o zero: **nada foi tocado no banco, e a 0018 está ausente.** Mas, se o `Remove` do passo C já
aconteceu, a API está **parada** — então "abortar" aqui não é não fazer nada: é **restaurar o BASE**.

Restaurar é decisão **humana**, e o caminho é subir de volta o deployment anterior (`Deploy Latest Commit`
sobre o `main` de ANTES do merge, ou o mecanismo equivalente que §B6 tiver confirmado). Antes de subir,
confira `SEED_ON_DEPLOY = 0`: o seed da BASE ainda grava `entity='farm'`, e contra um banco pós-0018 ele
**ressuscita a chave legada já alinhada com o acervo** — sem erro, sem colisão, sem precisar que ninguém
cadastre Empresa nenhuma. É o dano silencioso por um caminho que o `gate:05c2` não modela, porque o gate
exercita cadastro, nunca semeadura. Com o zero confirmado e o seed desligado, o BASE volta ao seu
quadrante normal (runtime BASE + banco pré-0018) e nada de numeração ficou pendente.

Depois de restaurar, releia: `select count(*) from erp.code_sequences where entity='farm'` — e compare com
o que havia antes. **Não mescle** — a PR continua DRAFT.

### D2 — a 0018 falhou e a transação reverteu

O comportamento desejado, não um problema. A transação é tudo-ou-nada: o contador continua `'farm'`, o
ledger não recebeu linha, e o deploy foi abortado — o runtime novo **não subiu**, então continua valendo a
combinação normal (runtime BASE + banco pré-0018). Leia a mensagem: ela nomeia a pré-condição que
reprovou. Corrija o estado (decisão **humana**, nunca `update` automático) e recomece de A.

### D2b — merge feito, 0018 AINDA não aplicada (deploy em curso ou não iniciado)

Se o autodeploy não disparou depois do `Remove`, ou o deploy está no meio do caminho: **mantenha a API
fechada enquanto investiga.** A tentação é subir o BASE "só para não ficar fora do ar" — e é exatamente o
que não se pode fazer sem antes saber se a 0018 já entrou. Confira o ledger primeiro
(`select count(*) from public.erp_migrations where name like '0018%'`); a resposta decide se você está em
D1 (zero: BASE pode voltar) ou em D3 (um: BASE **não** pode voltar).

### D3 — a 0018 aplicou, mas o HEAD não ficou saudável

**O estado mais delicado.** O banco está pós-0018 e o binário que está de pé pode ser o BASE — que é o
quadrante proibido. Nesta situação:

- **NUNCA suba o BASE contra um banco pós-0018.** É a combinação Q3/Q3b/Q3c: quando o número colide o
  usuário leva erro e o rollback protege, mas onde ele **não** colide — organização sem Empresa, ou com
  acervo que não começa em 1 — o cadastro **comita a chave legada de volta**, em silêncio, e aí o estrago
  é persistente. "Voltar para o que funcionava" é precisamente o movimento errado.
- E isso **não depende de tráfego de usuário**: se o BASE subir com `SEED_ON_DEPLOY = 1`, o seed daquela
  árvore grava `entity='farm'` já alinhado com o acervo, no próprio pre-deploy. Confira a variável **antes**
  de qualquer deploy aqui, como em D1.

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
