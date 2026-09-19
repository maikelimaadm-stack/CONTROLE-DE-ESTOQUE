# Roteiro até o Modelo Base 2

> Ordem e fronteiras das próximas missões. Cada linha é **uma PR**. A separação de responsabilidades é o que
> torna cada passo reversível: missão que mistura contrato, migração e interface não tem como voltar atrás.

## Sequência

| # | Missão | Entrega | Depende de |
| --- | --- | --- | --- |
| 1 | **PRE-BASE2-01** — Fundação | Contratos (empresa, ID Global, i18n), dicionário de dados, inventário de "fazenda", auditores e gates. ✅ concluída | — |
| 2 | **PRE-BASE2-02** — Empresa e permissões | Modelo de permissão por empresa (granularidade por módulo), camada de compatibilidade sobre o mecanismo de fazenda atual, `member_empresas` gravando a autorização já no formato explícito do contrato (`todas` × `selecionadas`), aposentando a ponte de compatibilidade. | 01 |
| 3 | **PRE-BASE2-03** — Migração fazenda → empresa | Tabela, colunas, cabeçalho, rotas e RLS migrados para o idioma canônico, com compatibilidade bidirecional (view `security_invoker`, coluna espelho por gatilho, adaptador de borda) e isolamento por empresa dentro do banco. ✅ concluída | 02 |
| 4 | **PRE-BASE2-04** — ID Global | Alocação automática nas 29 portas de escrita + porta genérica, backfill operacional determinístico e retomável, resolução na busca global (`55`, `#55`, `ID 55`) e exibição do número no registro. 🟡 **implementação pronta — ativação em produção pendente** | 01 (03 recomendada) |
| 5 | **PRE-BASE2-05** — Contexto multiempresa | Seletor "todas / uma / conjunto", filtros e painéis consolidados, seleção obrigatória no lançamento, seletor de idioma. ✅ **CONCLUÍDA EM PRODUÇÃO**: cutover 05C-2 executado em 16/09/2026 (merge `935f9dc`; `0018` no ledger uma única vez; `entity='farm'` = 0 e `entity='empresa'` = 1, `last_value` preservado), e encerramento documental feito — runbook, `DEPLOYMENT.md` e roteiro de aposentadoria registram a execução | 02, 03 |
| 6 | **BASE2-01** — Moldura de lançamento | Shell oficial do Modelo Base 2 (cabeçalho, dados principais × itens, totais, histórico, **anexos**, ações). Contrato em `MODELO-BASE2-CONTRACT.md`; implementação em `apps/web/src/features/base2/`; piloto no detalhe de documento de estoque. ✅ **CONCLUÍDA / IMPLANTADA EM PRODUÇÃO** — merge `9615560`. ANEXOS: entregues com suporte inicial real — `Base2Shell` integra o `AttachmentsDialog` oficial e `input_entries` foi habilitada em `ATTACHMENT_PARENTS`, com a matriz de autorização provada em integração. As outras seis entidades entram uma a uma, conforme o backend as aceite | 05 |
| 7 | **BASE2-02** — TOP | Registry e contrato inicial de Tipo de Operação; nenhuma regra de negócio fundida. ✅ **CONCLUÍDA / IMPLANTADA EM PRODUÇÃO** — merge `dd6e0e0` (PR #39, ancestral de `origin/main`, verificável por `git merge-base --is-ancestor`), CI de push verde nos quatro jobs (run 35258298588) e implantação relatada pelo Maike na abertura deste hotfix: Vercel, Railway web e Railway API com SUCCESS. Este último item é declaração operacional, não verificação feita daqui — a sessão não tem acesso autenticado a produção. Registry canônico em `packages/domain/src/tipo-operacao.ts`, contrato em `docs/TIPO-OPERACAO-CONTRACT.md`, rótulos no catálogo pt-BR e identidade visível nas sete rotas do piloto. CLASSIFICAR ≠ EXECUTAR: nenhuma regra de negócio mudou de dono. A dívida que ela DECLAROU (numeração de `erp.warehouse_transfers`) é o hotfix da linha abaixo. | 06 |
| 8 | **BASE2-03+** — Migração dos módulos | Compras, Estoque, Financeiro, Vendas e demais migrados progressivamente para o Base 2. ✅ **LIBERADA / EM EXECUÇÃO PROGRESSIVA**: a única precondição pendente era o HOTFIX de numeração de `erp.warehouse_transfers`, hoje mesclado (`ca74c56`, PR #40) e certificado no ambiente real (ver a seção abaixo). A migração é POR ENTIDADE, não por módulo inteiro — o estado de cada fatia fica na seção "BASE2-03+ — fatias" logo abaixo, e não nesta linha: a linha declara o estado da FASE, e uma fase que acumulasse o estado de cada fatia passaria a declarar vários estados ao mesmo tempo. | 07 + HOTFIX ✅ |
| 9 | **DATA-GOV** — Governança de dados | Nomenclatura final, dicionário com cobertura certificada, rótulos de enum por i18n. | 03, 08 |

### BASE2-03+ — fatias

A fase é LIBERADA; cada FATIA tem o seu próprio estado, e é aqui que ele mora. Uma fatia só conta como
implantada com o artefato EXATO em produção — merge, CI do merge, deployments no mesmo commit e ledger
conferido —, nunca com "a PR foi mesclada".

| Fatia | Entidade · rotas | Estado | Evidência |
|---|---|---|---|
| **BASE2-03A** — Compras / Solicitação de Compra | `erp.purchase_requests` · `/suprimentos/view/:id` | ✅ **CLOSED / IMPLANTADA EM PRODUÇÃO** | merge `57c97ef` (PR #41) · CI do merge **4/4 SUCCESS** (run `35340969500`) · Railway API `53ccee7b-2d01-4ce3-9e45-2ce0b3cdec36` e WEB `c82a3e3f-f079-4f18-ab8a-32d1391bc793`, ambos SUCCESS no commit do merge · ledger inalterado (19 migrations, última `0019`, `0019` 1×, zero `0020+`) porque a fatia não traz migration · `/health` 200 com `db: ok` |
| **BASE2-03B** — Financeiro / Títulos Financeiros | `erp.financial_titles` · `/financeiro/contas-a-pagar/:id` e `/financeiro/contas-a-receber/:id` | ✅ **CLOSED / IMPLANTADA EM PRODUÇÃO** | DUAS variantes da MESMA entidade (`direction` = `payable` / `receivable`), uma fatia só. Zero migration. Merge `475152b154dc689fef128ba8d033dfbc9f1b6c76` (PR #42) · CI do merge **4/4 SUCCESS** (run `35353870062`) · Railway API `ba3a73f5-f9eb-4ef0-a7c6-4f1ee9c41542` e WEB `135de2e3-113d-4f95-9d36-c908fe1e3a58`, ambos com `commitHash` exatamente igual ao merge · Vercel `success` **pelo commit status do GitHub** (a API da Vercel respondeu 403 de escopo nesta sessão: a fonte é secundária e está declarada) · ledger medido em 19 migrations, topo `0019_warehouse_transfer_code_sequence.sql`, no checkpoint de certificação de 18/09/2026 — a fatia não criou migration, e o boot da API registrou `migrations aplicadas: []`. |
| **HOTFIX pós-BASE2-03B** — fronteira da baixa cruzada | `erp.financial_titles` · `settle` e `settlements/:sid/cancel` | ✅ **CLOSED / IMPLANTADO EM PRODUÇÃO / CERTIFICADO** | Fechou autorização composta da baixa cruzada, período das duas empresas, auditoria dos dois lados, identidade do espelho por cardinalidade e estado do título contrário. Zero migration. Merge `30b342a2c5d0ebffbcf1a8470c4cddd41f6ad988` (PR #43) · CI do merge **4/4 SUCCESS** (run `35442241574`, `event=push`, `head_sha` igual ao merge) · Railway API `65f86872-0943-48f0-9ea1-f08963b59479` e WEB `3878f430-c79f-4bbd-a7eb-09a8cb462e7a`, ambos SUCCESS no ambiente `production` com `commitHash` exatamente igual ao merge · Vercel `success` **pelo commit status do GitHub** (a API da Vercel não foi acessível pelo escopo usado: a fonte é secundária e está declarada) · `/health` 200 com `db: ok` em `api-production-ec77.up.railway.app` · ledger de produto medido em 19 migrations, `count(distinct name)` 19, topo `0019_warehouse_transfer_code_sequence.sql`, `0019` 1×, zero `0020+` — o boot da API do merge registrou `migrations aplicadas: []`. Certificação externa concluída pelo arquiteto. |
| **BASE2-03C** — Vendas / Documento de Venda | `erp.sales_documents` · `/vendas/budgets/:id`, `/vendas/orders/:id`, `/vendas/sales/:id` | 🟠 **EM PR / EM EXECUÇÃO** | TRÊS variantes da MESMA entidade (`kind` = `budget` / `order` / `sale`), uma fatia só, três famílias de capacidade (`budgets.*`, `orders.*`, `sales.*`). Fecha a fronteira de variante (carregamento amarrado ao `kind`, rota errada = 404) e a autorização COMPOSTA da conversão (`source.edit` ∧ `target.create`), e migra o detalhe para o Modelo Base 2. Zero migration. |

**Nota sobre os gates 05C-2 e 0019 em execução de push pós-merge.** Neles a base resolve na ponta de `origin/main`, que É o próprio commit, e os dois terminam "APROVADO (inativo)". Isso não é prova de version skew — quem compara versões distintas é o job dedicado de version skew, com a base real. Inativo ≠ provado.

**PENDING declarado da BASE2-03A.** O smoke autenticado de UI em produção não foi executado: a sessão não
tem credencial de produção, e gate que exige acesso autenticado não se substitui por preview, `localhost`
nem E2E. A prova funcional que sustenta o CLOSED é o E2E do COMMIT DE MERGE (105 testes, run
`35340969500`), somada ao artefato exato implantado e ao ledger conferido em leitura.

### HOTFIX obrigatório antes da BASE2-03 — numeração de `erp.warehouse_transfers` · ✅ CLOSED / IMPLANTADO EM PRODUÇÃO

**O defeito.** `POST /api/stock/transfers` gerava o código com **dois contadores independentes**
(`warehouse_transfer` e `farm_transfer`, via `nextCode`) para **uma** tabela com
`unique (organization_id, code)`. A primeira transferência de cada variante numa organização recebia o
mesmo código, e a segunda era recusada com `409 CONFLICT`. Numa organização nova, a transferência entre
empresas quebrava no primeiro documento. Defeito de PRODUÇÃO, anterior à BASE2-02, no caminho de
**escrita**, e nunca comportamento esperado: nenhum teste o exigia
(`scripts/regressao-invertida-audit.mjs` impede que volte a ser exigido).

**A decisão.** A sequência acompanha o **namespace de unicidade da tabela**, nunca a variante funcional.
Como a UNIQUE de `erp.warehouse_transfers` não inclui `kind`, existe UM namespace por organização e o
contador passa a ser um só (`warehouse_transfer`). As outras tabelas que numeram por variante
(`financial_titles`, `sales_documents`, `animal_movements`) têm o discriminador DENTRO da chave única —
lá numerar por variante é correto, e é por isso que elas não tinham este defeito.

**A TOP não muda.** Continuam DUAS operações (`estoque.transferencia_entre_armazens` e
`estoque.transferencia_entre_empresas`). Unificar a NUMERAÇÃO não unifica a OPERAÇÃO.

**O que a PR entrega:**

| Peça | Onde |
| --- | --- |
| Migration fail-closed, com reconciliação pelo maior entre contador canônico, legado e acervo | `supabase/migrations/0019_warehouse_transfer_code_sequence.sql` |
| `farm_transfer` vira ALIAS em `erp.next_code` — a compatibilidade mora no BANCO, não no calendário | seção 7 da 0019 |
| Chave única do runtime, com o motivo ao lado | `apps/api/src/lib/sequencia-warehouse-transfer.ts` |
| Gate do princípio (contador por variante exige o discriminador na UNIQUE) | `scripts/sequencia-namespace-audit.mjs`, no `pnpm lint` |
| Matriz de version skew: BASE × pós-0019, rolling deploy, rollback de binário | `pnpm gate:0019` |
| Regressão pela porta real: as DUAS variantes na mesma organização | `apps/api/test/integration/transferencia-numeracao.test.ts` |
| Prova de UI da variante `farm` — o PENDING da BASE2-02, fechado | `apps/web/e2e/base2-moldura.spec.ts` |
| Corrida cross-version provada ausente: BASE e HEAD concorrentes na rota de rebanho | quadrante C de `pnpm gate:0019` (duas conexões, barreiras reais) |

**A chave legada é SOBRECARREGADA — e isso mudou o desenho DUAS vezes.** `'farm_transfer'` não serve só
à transferência de estoque: `erp.animal_movements` (namespace `unique (organization_id, movement_type,
code)`) numera com a MESMA chave. A primeira resposta foi separar, dando ao rebanho um contador próprio.
A auditoria externa derrubou essa resposta: separar DURANTE a vida do alias cria uma corrida que não
existia — o binário anterior pede a chave legada (aliasada para o contador de estoque) e o novo pediria o
próprio; duas LINHAS sem trava em comum, emitindo o mesmo número para a mesma tabela, e um `select` de
"já existe?" é TOCTOU, não solução.

A decisão final é a menor que PROVA segurança: **enquanto o alias existir, as duas rotas pedem a MESMA
chave**, e `erp.next_code` (`insert ... on conflict do update`) serializa as transações na linha do
contador. Provado com duas conexões e barreiras reais no quadrante C de `pnpm gate:0019`, que também
reproduz a corrida da arquitetura abandonada. Preço aceito: numeração intercalada, com lacuna nas duas
tabelas — lacuna é normal no contrato, colisão não é. A separação do contador de rebanho fica declarada
como cleanup da fatia que REMOVE o alias.

**Por que este hotfix NÃO precisa de janela single-version como a 05C-2.** Lá a chave mudava de nome e o
banco não tinha como servir os dois binários. Aqui `erp.next_code` canonicaliza `farm_transfer` para
`warehouse_transfer`: o binário anterior pede a chave antiga e recebe número do contador canônico, sem
criar linha legada. Autodeploy normal, e o rollback de binário continua correto contra o banco pós-0019 —
de **um passo**, até o runtime da 05C-2; voltar além disso continua sendo forward-only, como
`docs/DEPLOYMENT.md` já registra. Rollback de BANCO é outra coisa e também é forward-only: o caminho de
volta escrito está em `docs/DEPLOYMENT.md`.
O alias **não sai nesta fatia** — ele é o caminho de volta; sai em fatia própria, quando não houver mais
versão viva pedindo a chave antiga.

**Ordem fixa, agora inteira cumprida:** BASE2-02 mesclada ✅ → **HOTFIX de numeração** mesclado e
implantado ✅ → BASE2-03+ liberada ✅.

**Encerramento — o que foi verificado, e onde.** A fatia só fecha com o artefato EXATO em produção, não
com "o merge passou":

| O que | Evidência |
| --- | --- |
| Merge | PR #40 mesclada em 2026-09-18T02:08:04Z · `ca74c56e7c1bf267f765b46490153b06f85efc9f`, cujos pais são `dd6e0e0` (base) e `f46e7ce` (HEAD da fatia) |
| CI do merge | run `35298145571`, 4/4 SUCCESS — inclusive o passo "Matriz de version skew da numeração de transferências (gate 0019)" |
| Railway API | deployment `2fb5d7f0-4eb4-4981-b06c-c5c1ed92cc53`, SUCCESS **no commit do merge** |
| Railway WEB | deployment `01fa6a35-96be-4560-9389-7a20fd2e2cba`, SUCCESS **no commit do merge** |
| Vercel | SUCCESS no commit do merge, pelo *commit status* do GitHub (verificado pelo Maike: a sessão não alcança aquele escopo da Vercel) |
| Migration | `0019_warehouse_transfer_code_sequence.sql` aplicada **exatamente 1×**, em `2026-09-18 02:08:56.545774+00`, e é a última do ledger (19 no total) |
| Chaves | `farm_transfer` e `animal_farm_transfer` = **0 linhas** em `erp.code_sequences` |
| Estrutura | UNIQUE de `warehouse_transfers` e de `animal_movements`, PK e FK de `code_sequences`, RLS habilitada e forçada nas três — todas íntegras |

O alias **continua vivo**, como a própria fatia decidiu: ele é o caminho de volta e sai em fatia
própria, junto com a separação do contador de rebanho. Nenhuma fatia posterior — esta inclusive —
pode removê-lo por conveniência.


## Fronteiras que não podem ser cruzadas

| Missão | Não faz |
| --- | --- |
| PRE-BASE2-02 | Não renomeia colunas (isso é 03). |
| PRE-BASE2-03 | Não muda interface além do necessário para acompanhar a renomeação. Não remove coluna legada, view legada nem cabeçalho legado (isso é 05). Não renomeia VALOR de domínio nem chave de permissão (DATA-GOV). |
| PRE-BASE2-04 | Não acopla ID Global à URL: a rota deriva do registro. |
| PRE-BASE2-05 | Não implementa a moldura do Base 2. |
| BASE2-01 | Não cria motor genérico de regras (tela unificada ≠ regra unificada). |
| BASE2-02 | Não implementa todas as TOPs de uma vez. |
| DATA-GOV | Não faz renomeação sem camada de compatibilidade. |

## Critérios de conclusão

**PRE-BASE2-03** ✅ terminou com: o inventário classificado em três baldes (legado histórico · compatibilidade
declarada · dívida de produto) e a catraca travando o terceiro; `X-Farm-Id` e `X-Empresa-Id` coexistindo com
teste dos dois sentidos de version skew; RLS empresarial nas 49 tabelas de escopo, com matriz em
`docs/COMPANY-RLS-MATRIX.md` sem nenhuma tabela "não auditada"; e a compatibilidade com prazo e endereço
(`scripts/lib/empresa-compat-surface.mjs`), removida em PRE-BASE2-05.

**PRE-BASE2-04** 🟡 **implementação pronta; ativação em produção PENDENTE.** O que está provado é o código:
banco novo, banco de upgrade com acervo legado real, reexecução sem renumerar e medição de desempenho — tudo
em ambiente de teste. Isso NÃO é o acervo de produção, e a missão só se considera concluída depois do
checkpoint operacional (nesta ordem): **merge** → **migration 0016 aplicada** → **API nova implantada** →
**backfill oficial executado até `faltando = 0`** → **`pnpm id-global:verify` verde** → **smoke de busca
(`#N`, `ID N`) e do distintivo no registro**. Enquanto isso não acontecer, nenhum documento deve afirmar que
o ID Global está ativo em produção. Runbook em `docs/DEPLOYMENT.md`.

**Estado atual da PRE-BASE2-04: IMPLEMENTAÇÃO PRONTA / ATIVAÇÃO EM PRODUÇÃO PENDENTE.** Esta é a frase
canônica de ESTADO ATUAL, e ela é a mesma nos três documentos que falam da fase (aqui, `docs/DEPLOYMENT.md`
e `docs/PRE-BASE2-05-APOSENTADORIA.md`). Ter uma frase única evita a comparação por sinônimo: cada documento
descreveria a mesma situação com palavras um pouco diferentes, e a divergência só apareceria quando alguém
lesse os três lado a lado. Registro HISTÓRICO é outra coisa e continua permitido, desde que marcado como
tal — a gate T15 mede o estado atual, não proíbe citar o passado.

A implementação entregou: todo registro elegível recebendo ID Global na MESMA transação de negócio,
nas 29 portas de escrita direta mais a porta genérica do Resource Registry (gate estrutural
`scripts/id-global-audit.mjs` + matriz de runtime que cria um registro de cada tipo pela rota real, ANTES de
qualquer backfill); backfill operacional em lotes (`pnpm id-global:backfill`), determinístico, retomável e
comprovadamente reexecutável sem renumerar (mapa idêntico, medido); zero duplicidade e zero elegível sem
número (`pnpm id-global:verify`); e `#N` resolvendo por organização, empresa ATUAL do registro e permissão
DAQUELE registro, com toda negativa na mesma superfície 404. Fica registrada uma divergência de contrato: a
variante `locate` de `animal_handlings` está declarada e não tem porta de criação
(ver docs/GLOBAL-ID-CONTRACT.md §13), e um defeito pré-existente do seed (equipments com códigos fixos sem
avançar `erp.code_sequences`) permanece no backlog, fora do escopo desta missão.

**DATA-GOV** só termina quando: o dicionário cobrir 100% das tabelas de negócio; nenhum identificador herdado
permanecer sem decisão registrada; e os rótulos de enum vierem do catálogo de idioma.

## Escala que o desenho precisa suportar

Dezenas a centenas de empresas por organização · usuários com subconjunto de empresas · painéis consolidados ·
milhões de ID Globais · criação concorrente · múltiplos idiomas · novos módulos · outros nichos · API móvel
ou offline usando exatamente as mesmas regras de escopo.

Por isso: escopo resolvido em SQL (nunca lista de identificadores em memória), sequência atômica no banco
(nunca `MAX(id)+1`), permissão verificada no servidor (nunca só no cliente), texto em catálogo (nunca
literal em componente novo).
