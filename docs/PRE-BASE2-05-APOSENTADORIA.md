# PRE-BASE2-05 — Aposentadoria da ponte Fazenda → Empresa

A ponte existe desde a PRE-BASE2-03 para tolerar *version skew*: o web (Vercel) e a API (Railway) não
trocam de versão no mesmo instante, e durante a janela de rollout as duas versões precisam se entender.
Ela cumpriu o papel. Este documento é o plano de removê-la **sem** abrir uma janela de indisponibilidade —
e, para as fases já executadas, o registro do que de fato foi feito.

## Por que três fases, e não um deploy

Remover ao mesmo tempo o cabeçalho legado da API, a compatibilidade do servidor, a do cliente, as colunas
`farm_id` e a view `erp.farms` cria uma janela real em que *alguma* combinação implantada não fala com a
outra. Como o deploy não é atômico, essa janela não é hipótese — é a ordem natural dos eventos.

Então a remoção acontece em três movimentos, cada um seguro sozinho, e **cada um só começa depois de o
anterior estar em produção e comprovado**:

| Fase | O que sai | O que continua | Pré-requisito |
| --- | --- | --- | --- |
| **05A — Cliente canônico** ✅ | o tradutor de fio do web; `X-Farm-Id` do navegador; leitura de apelido legado na resposta | API bilíngue · banco bilíngue | PRE-BASE2-04 ativada em produção |
| **05B — Servidor canônico** ✅ | borda legada da API: cabeçalho, normalização de entrada, apelidos de saída, nomes legados de tabela, CORS, formato administrativo achatado, promoção de sessão | banco bilíngue | 05A em produção |
| **05C — Purga física do schema** ⬅ fase atual, em três fatias | 05C-0 instrumentos (mesclada) · **05C-1 as 52 colunas legadas, as 5 views, os 52 gatilhos e as 3 funções** · 05C-2 o contador `entity='farm'` | — | 05B em produção |

**05A e 05B foram mescladas e publicadas.** A fase atual é a **05C**, e dentro dela a fatia **05C-1**: a
migration `supabase/migrations/0017_purge_farm_legacy.sql` está escrita e prova aplicar em base zero, em PR
DRAFT, **sem autorização de merge** (ver "Onde a 05C está agora"). A sequência `entity='farm'` **não** é
assunto da 05C-1 — é a 05C-2, e dizer o contrário já produziu plano errado uma vez.

A ordem é obrigatória: o cliente deixa de falar o idioma antigo **antes** de o servidor deixar de entendê-lo,
e o banco só perde as colunas quando ninguém mais as lê.

---

## 05A — Cliente canônico (concluída, em produção)

O web passa a falar o contrato canônico ponta a ponta:

- cabeçalho `X-Empresa-Id` (`cabecalhosDeContexto`, um lugar só — inclusive para o `fetch` direto da
  exportação de relatório);
- caminho, corpo e query canônicos, sem tradução;
- resposta consumida como veio: `ctx.empresas`, `empresa_id`, `empresa_*_label`;
- recurso `empresas`;
- sessão com `empresaId`.

**O que NÃO muda em 05A:** a API continua aceitando `X-Farm-Id`, `farm_id` no corpo e na query, e o recurso
`farms`; o banco continua com as colunas espelhadas e a view. Nenhuma migration destrutiva.

### Sessão do navegador

A sessão no `localStorage` é o único estado do cliente que atravessa um deploy. A regra vive isolada em
`packages/plataforma/src/sessao-empresa.ts` (pura, testada) e o efeito, em `apps/web/src/lib/api.ts`.

Na 05A ela PROMOVIA a chave anterior. Em **05B a promoção saiu** — o rollout que a justificava terminou, e
nenhuma versão viva do cliente grava a chave antiga. O que ficou é o contrato de valor:

| Sessão encontrada | O que acontece |
| --- | --- |
| `empresaId` UUID ou `null` | segue como está, sem escrever no armazenamento |
| `empresaId` fora do contrato (número, objeto, `""`, `"abc"`, `"todas"`, UUID malformado) | **inválida**: sessão apagada, login exigido |
| sem a chave canônica (inclusive sessão dormante da versão anterior) | **inválida**: sessão apagada, login exigido |

`"todas"` nunca entra: "todas as empresas" é **escopo de leitura**, resolvido no servidor a cada requisição,
não empresa persistida. E a validação não é zelo excessivo — `localStorage` é editável e sobrevive a
qualquer versão do cliente; contrato que só o servidor faz cumprir não é contrato.

O custo de ter removido a promoção é um login a mais para quem está dormante há muito tempo. O custo de
mantê-la seria uma ponte que ninguém mais atravessa pedindo manutenção a cada mudança.

### Catraca

`apps/web/scripts/empresa-canonica-audit.mjs` (no `pnpm lint` do web) impede que o contrato legado volte ao
web produtivo. Ela é necessária **porque** o tradutor saiu: sem adaptador, um `farm_id` que reapareça no
cliente não quebra nada — a API bilíngue aceita, e o erro some no sucesso.

A allowlist é **vazia**: nenhum arquivo do web produtivo escapa, `src/lib/api.ts` inclusive — excluir o
arquivo mais crítico do contrato HTTP para poupar uma palavra de comentário desarmaria a catraca justamente
onde ela mais importa. E a catraca **se autotesta a cada execução**: injeta cada padrão proibido em `api.ts`
na leitura (o disco não é tocado) e falha se a auditoria não acusar. Catraca que nunca foi vista falhando é
decoração.

Ela NÃO vigia vocabulário agronômico legítimo nem nomes de permissão/enum do servidor
(`farm_transfers.view`, `movement_type: "farm_transfer"`): renomeá-los é 05B/05C, e fazê-lo no cliente
quebraria a autorização.

---

## 05B — Servidor canônico (concluída, em produção)

A API passa a ter **uma** língua. Não é "parar de traduzir e ignorar o resto": entrada antiga conhecida é
**recusada**, nunca promovida e nunca descartada em silêncio.

| O que saiu | Onde estava | Virou |
| --- | --- | --- |
| Adaptador de borda inteiro | `apps/api/src/lib/compat-empresa.ts` | **arquivo apagado** |
| `X-Farm-Id` no CORS e no resolvedor | `server.ts` · `resolverEmpresaSelecionada` | `lib/empresa-header.ts`, que só aceita `X-Empresa-Id` |
| Normalização de corpo e query | hook `preValidation` | recusa em `lib/contrato-legado.ts` |
| Apelidos de resposta | hook `preSerialization` | nada — a resposta é canônica |
| `farms` no `/auth/context` | `routes/auth.ts` | só `empresas` |
| Nomes legados de tabela | `TABELAS_LEGADAS` / `tabelaCanonica` | `entity` canônico em anexos |
| Chave de recurso legada | `CHAVES_LEGADAS` em `@agro/domain` | só `empresas` resolve |
| Contrato admin achatado | `deFarmIdsLegado` / `paraFarmIdsLegado` | só `escopos_empresas`; `empresa_ids` **recusado** |
| Alias de coluna em relatório salvo | `campoCanonico` | nada (produção tinha **zero** definições legadas) |
| Promoção de sessão | `sessao-empresa.ts` | só validação canônica |

### Por que RECUSAR e não ignorar

Os schemas de entrada são `z.object`, que **descarta chave desconhecida**. Tirar `farm_id` do schema não
seria "remover o suporte" — seria trocar tradução por descarte silencioso:

- corpo: `farm_id: <empresa B>` sumiria e o lançamento iria para a empresa do **contexto**. O cliente pediu
  B, o servidor grava em A, e nada aparece até o relatório;
- query: `farm_id__eq` descartado devolve a lista **sem** o recorte — mais linhas do que foram pedidas;
- cabeçalho: sem empresa selecionada a leitura abre para **todas** as empresas permitidas no módulo.

Nos três casos o efeito é ampliação silenciosa de escopo. Por isso existe `lib/contrato-legado.ts`: uma
**lápide**, não um tradutor. Ela nomeia o contrato anterior só para recusá-lo, olha apenas o nível de cima
do corpo e da query (jsonb do usuário continua intocado) e não vigia vocabulário de domínio
(`farm_transfer`, `farms.view`) — esses são contratos do servidor, com vida própria.

`empresa_ids` é o único nome que exigiu recusa **local**: ele continua canônico e legítimo como filtro de
empresas dos painéis; o que morreu foi o seu uso como configuração de acesso de um membro.

### O que a 05B NÃO removeu

`SEQUENCIA_EMPRESA = "farm"` — agora sozinha em `apps/api/src/lib/sequencia-empresa.ts`. **Não é nome de
fio**: é a chave de uma sequência persistida (`erp.code_sequences`, 1 linha em produção). Trocá-la sem
migrar o dado reiniciaria a numeração do cadastro de Empresa, dando a uma empresa nova um código que já
existe. A troca **não** é atômica com o `update` — isso foi corrigido na 05C-0 e está detalhado abaixo: ela
é a fatia **05C-2**, com janela operacional. Há teste provando que a numeração **continua** de onde estava.

Os redirecionamentos de rota (`/cadastros/farms` → `/cadastros/empresas`) também ficam: são favoritos de
usuário, fora do nosso controle, e navegação não é protocolo. São categoria `TOMBSTONE`: saem depois da
05C-1, com tráfego real observado — não junto com a purga.

### Version skew: os dois sentidos

Na 05A só um sentido era real (quem virava canônico era o CLIENTE). Na 05B quem vira é o servidor, e ele
pode subir antes ou depois do web — desde então os dois importam. Mas os sentidos **não são nomeados por
fase**: cada execução tem um SHA de base e um checkout, e é isso que eles comparam.

| Sentido | O que prova | Onde |
| --- | --- | --- |
| web do CHECKOUT × API do SHA BASE | o web do checkout funciona sobre a API que está no ar | `playwright.skew.config.ts` |
| **web do SHA BASE × API do CHECKOUT** | **o bundle já publicado não depende de nenhum resquício legado** | `playwright.skew-web-anterior.config.ts` |

Descrever a combinação atual como "web 05B × API 05A" — como esta tabela fazia — congela a fatia em que o
harness nasceu: quando a base avança, o texto segue afirmando um pareamento que a execução não tem. Desde
que a 05B mesclou os dois lados já são canônicos, e é por isso que a IDENTIDADE de cada lado é provada pelo
SHA, não pelo comportamento HTTP — um teste que tentasse distingui-los por contrato passaria contra os dois.
O contrato continua sendo provado, como contrato: que o idioma antigo é RECUSADO, e com o código certo.

Nos dois casos o outro lado é montado do próprio repositório por `scripts/api-anterior.mjs` — binário e
bundle reais, não mock.

## 05C — Purga física, em TRÊS fatias

Remedido em **PRE-BASE2-05C-0** contra o schema real, e o levantamento anterior estava errado em pontos que
mudam o plano. Esta seção é o resultado da remedição; o que ela corrige está dito abertamente, porque um
número errado que vira "o tamanho do trabalho" é mais caro do que um número ausente.

### Por que três fatias, e não uma

| Fatia | O que faz | O que NÃO faz |
| --- | --- | --- |
| **05C-0** (concluída, mesclada na PR #33) | calibra os instrumentos: leitor de migrations que enxerga remoção, guarda de RLS que confere o `pg_policies` real, base do version skew resolvida, contagem separada, superfície reclassificada, prova do contador | **nenhuma DDL**, nenhuma migration, nenhuma mudança de produção |
| **05C-1** (fatia ativa: `0017_purge_farm_legacy.sql`) | a purga, nesta ordem: CHECK canônico e policy `api_child` reescritos ANTES; depois as cinco views, os 52 gatilhos, as 3 funções, o CHECK legado, as 52 FKs de coluna única, os 8 índices e as 52 colunas | não mexe no contador de código da Empresa; não remove nada por conter a palavra "farm"; não cria índice novo |
| **05C-2** | a troca do contador (`entity='farm'` → `'empresa'` e a constante) | — |

A 05C-0 existe porque todos os instrumentos de prova da 05C-1, do jeito que estavam, ficariam **verdes
medindo o objeto errado** depois da remoção. Um gate que descreve um schema que não existe mais é pior que
gate nenhum: dá confiança onde não há.

A 05C-2 é separada porque a troca do contador **não é atômica com o deploy** — ver abaixo.

### Onde a 05C está agora

| Etapa | Estado |
| --- | --- |
| **05C-0** — instrumentos, `NO-DDL` | **concluída**, mesclada na PR #33 (`d4639bb`) |
| **05C-G0** — preflight externo de produção (somente leitura) | **executado**; `BLOCKED` em P1 (restore), P5 (valor de `SEED_ON_DEPLOY`), P6 (semântica de rollout) e P7 (política de lock/timeout); `PASS` em P2 (dados legados), P3 (integridade da ponte), P4 (inventário físico) e P8 (versão publicada) |
| **05C-G1 / 05C-G2** — hardening do preflight | documentação corrigida, contratos executáveis reforçados, atomicidade medida, porteiro de locks validado em 9 cenários, runbook humano em `docs/PRE-BASE2-05C-1-PREFLIGHT.md` |
| **05C-1** — a purga | **fatia ATIVA**: `supabase/migrations/0017_purge_farm_legacy.sql` escrita e provada aplicando em base zero, com gates próprios e o gate G-U5 (`scripts/gate-purga-0017-runtime-anterior.mjs`). **Merge NÃO liberado** — `OPERATIONAL MERGE BLOCKER` por U4 (pre-deploy sem teto de tempo). **Aplicação em produção NÃO autorizada** |
| **05C-2** — o contador | futura, depois da 05C-1, com janela operacional |

O que mudou nesta rodada, e o que não mudou: a purga **deixou de ser plano e virou arquivo**. Isso
não move nenhum gate. P1 passou a `NOT APPLICABLE WHILE PRE-PROD DATA IS DISPOSABLE` por declaração escrita
do proprietário — dispensa temporária com condição de retorno, não aprovação —, e U4 virou bloqueador de
merge porque o merge em `main` dispara deploy sozinho. Os enunciados vivem em
`docs/PRE-BASE2-05C-1-PREFLIGHT.md`; este documento não os recopia.

CI verde não move nenhuma dessas linhas: o que falta exige acesso e decisão que nenhuma sessão automatizada
tem.

### Schema — contagem corrigida

| Objeto | Quantidade | Dependências | Migration | Rollback |
| --- | ---: | --- | --- | --- |
| Colunas legadas em TABELAS | **52** em **49** tabelas | FKs **de coluna única**, índices, CHECK e RLS que as citam, gatilhos de espelho — as FKs **compostas** NÃO dependem delas (dependem da canônica e ficam) | `drop column` por tabela, depois dos gatilhos e das views | recriar coluna + repopular a partir da canônica (o dado não se perde: é espelho) |
| Views de nome antigo | **5** | consultas legadas, testes de espelho | `drop view` **antes** das colunas | `create view` (definição versionada na 0014) |
| Gatilhos de sincronização `trg_sync_*` | **52** | as colunas acima | `drop trigger` **antes** das colunas | recriar a partir da 0014 |
| Funções `erp.sincronizar_empresa*` | **3** | os gatilhos acima | `drop function` depois dos gatilhos | recriar a partir da 0014 |
| Chaves estrangeiras **de coluna única** sobre a coluna legada | **52** | `FOREIGN KEY (farm_id) REFERENCES erp.empresas(id)` — **não** provam tenant | caem junto com a coluna | recriar a partir da 0014 |
| Índices que incluem coluna legada | **8** | desempenho das consultas legadas | cair junto com a coluna | recriar se a leitura legada voltar (não deve) |
| **CHECK órfão** `equipment_transfers_check` | **1** | `CHECK (origin_farm_id <> destination_farm_id)` — anônimo e inline, batizado pelo PostgreSQL | cai com a coluna **em silêncio**; o equivalente canônico (`empresa_origem_id <> empresa_destino_id`) precisa nascer no **mesmo arquivo**, antes do `drop column` — **feito: item 5 da `0017`**, e o legado sai nomeado no item 10, não de carona | recriar a partir de `supabase/migrations/0005_sales_fleet_hr.sql:142` (a 0002 NÃO cria esta tabela) |
| Política de RLS citando coluna legada | **1** (`erp.empresa_cost_centers` → `api_child`) | leitura do filho pelo pai | reescrever no canônico **antes** de dropar a coluna | versão anterior da política |
| Sequência `erp.code_sequences` com `entity='farm'` | **1 linha** | numeração de Empresa em uso | **fatia 05C-2**, com janela operacional | `update` inverso |

**Os gatilhos das 49 tabelas alvo são 66, não 52.** Medido em produção: além dos 52 de espelho, essas mesmas
tabelas carregam 14 gatilhos de NEGÓCIO que têm de sobreviver — `audit_row` (5), `set_updated_at` (3),
`travar_pontas_transferencia_origem` (2), `validar_lotes_transferencia_pecuaria`, `forbid_change`,
`travar_pontas_movimento_animal` e `apply_stock_movement` (1 cada). Uma purga que remova "os gatilhos das
tabelas alvo" em vez dos **52 nomeados** apaga auditoria e invariantes de transferência. `drop trigger` vai
por nome, nunca por tabela.

#### O que estava errado, e por quê

**"56 colunas em 49 tabelas" não existe.** São **52** colunas em 49 **tabelas**, mais **4** colunas de
mesmo nome que aparecem nas **views** de compatibilidade. O 56 vinha de uma consulta a
`information_schema.columns` sem filtrar `table_type='BASE TABLE'`: view tem coluna, e as colunas das views
foram somadas às das tabelas. A purga não dropa coluna de view — ela dropa a view inteira. Planejar por 56
é planejar remoção de quatro objetos que não se removem assim.

**Não é uma view, são cinco:** `erp.farms`, `erp.authorizer_farms`, `erp.bank_account_farms`,
`erp.farm_cost_centers`, `erp.proprietary_farms`. O levantamento anterior via só a primeira. As outras
quatro eram, até esta fatia, caminhos de escrita reais — `packages/db/src/seed.ts` gravava por
`erp.proprietary_farms`, e a catraca não reclamava porque só vigiava `erp.farms`.

**O CHECK órfão.** `CHECK (origin_farm_id <> destination_farm_id)` em `erp.equipment_transfers` é uma
invariante de domínio escrita sobre as colunas legadas. Um `drop column` a leva junto — **em silêncio**, sem
erro de migration. A 05C-1 precisa criar o equivalente canônico ANTES; senão a regra "origem ≠ destino"
deixa de ser garantida pelo banco e ninguém é avisado.

**O mapeamento não é uniforme.** Nem toda tabela tem o par `empresa_id`/`farm_id`: quatro tabelas
(`erp.notifications`, `erp.registros_globais`, `erp.membro_empresas`, `erp.legado_escopo_empresa_v0`)
nasceram canônicas e não têm nome antigo nenhum. Tratar as 56 (ou 52) como uma lista homogênea produziria
uma migration que tenta dropar coluna que nunca existiu.

**As FKs legadas NÃO são as compostas — e confundi-las seria destrutivo.** As 52 chaves estrangeiras que
citam a coluna legada são de **coluna única** (`FOREIGN KEY (farm_id) REFERENCES erp.empresas(id)`): elas
provam que o UUID é uma empresa, e não que é uma empresa DESTA organização. As **compostas** são as
**canônicas** — **50** no schema atual, criadas na 0014: 45 `(organization_id, empresa_id)`, 3
`(organization_id, empresa_destino_id)` e 2 `(organization_id, empresa_origem_id)` —, e são a
única prova de tenant no schema físico. O número 45 sozinho descreve UMA das três famílias, não o conjunto:
lido como "o que fica", ele deixa desprotegidas exatamente as 5 chaves de origem/destino de
`animal_movements`, `equipment_transfers` e `warehouse_transfers` — as três tabelas que perdem
`origin_farm_id`/`destination_farm_id` nesta mesma purga. Uma 05C-1 que lesse "dropar as FKs compostas junto com a coluna"
removeria exatamente a garantia que a PRE-BASE2-03 construiu. O que cai com a coluna legada é só o primeiro
grupo; o segundo **fica**, e o guarda que o mede (`rls-matriz.test.ts`, "toda coluna canônica de tabela com
organização tem referência COMPOSTA") continua valendo depois da purga.

**Sobrevivem objetos de NOME legado que não são coluna:** as próprias tabelas renomeadas mantêm índices,
constraints e sequências com o nome antigo embutido (ex.: `proprietary_farms_pkey` foi renomeada, outros
não). Nome de objeto não é comportamento, e renomeá-los é fatia própria — mas não declarar isso faria o
"inventário final" parecer incompleto sem motivo.

### Dados persistidos com nomes antigos

Remedido em produção autenticada no preflight **PRE-BASE2-05C-G0** (2026-09-15, somente `select`). Os cinco
pré-requisitos reais da purga física continuam em **zero** — mas o preflight encontrou ocorrências que a
lista anterior não previa, e elas ficam aqui CLASSIFICADAS, não normalizadas.

| Conteúdo | Total | Com nome legado | Classificação |
| --- | ---: | ---: | --- |
| `erp.saved_reports.definition` | 0 | **0** | pré-requisito da purga |
| `erp.saved_reports.resource_key = 'farms'` | 0 | **0** | pré-requisito da purga |
| `erp.user_screen_preferences.preferences` | 18 | **0** | pré-requisito da purga |
| `erp.user_screen_preferences.screen` com `farms` | 18 | **0** | pré-requisito da purga |
| `erp.attachments.entity = 'farms'` | 2 | **0** | pré-requisito da purga |
| `erp.user_screen_preferences.module = 'farms'` | 18 | **1** | FORA da purga — dado morto |
| `erp.audit_logs.entity = 'farms'` | 244 | **4** | FORA da purga — histórico imutável |
| `erp.audit_logs.metadata` citando coluna legada | 244 | **1** | FORA da purga — histórico imutável |
| `erp.permissions.key` com `farm` | 782 | **13** | FORA da purga — autorização VIVA |
| `erp.role_permissions.permission_key` com `farm` | 854 | **13** | FORA da purga — autorização VIVA |
| `erp.code_sequences.entity = 'farm'` | 20 | **1** | fatia **05C-2** |
| `erp.client_profiles.farm_name` preenchido | 1 | **0** | vocabulário agronômico legítimo — NUNCA tocar |

O que cada classificação obriga:

- **Pré-requisito da purga** — precisa estar em zero antes da 05C-1, e está. É o único grupo que a purga
  física pressupõe.
- **Dado morto** — a chave de recurso viva é `empresas`; a preferência gravada sob `module='farms'` não é
  mais alcançada por nenhuma rota. Some da tela sozinha, sem migration.
- **Histórico imutável** — trilha de auditoria. `Ledger é imutável` (CLAUDE.md): não se corrige histórico
  para deixar o inventário bonito. O efeito residual é que essas 4 linhas deixam de resolver para uma
  entidade viva, e isso é aceito por escrito, não descoberto depois.
- **Autorização viva** — 13 chaves (`farms.*`, `farm_transfers.*`, `animal_farm_transfer.*`,
  `batch_farm_transfer.*`) com 13 concessões dependentes por chave estrangeira. Renomeá-las é fatia
  própria, com migration de `permissions` **e** de `role_permissions`: `seedPermissions` roda a cada deploy
  com `on conflict (key) do update` e **nunca apaga chave órfã**, então trocar o nome só no código criaria a
  nova e deixaria a velha viva e concedida.
- **05C-2** — o contador. Não é assunto da 05C-1 nem "de graça" porque o arquivo está aberto.

A 05C-1 continua sendo uma purga de DDL, sem migration de normalização de dados. Nenhum JSON arbitrário de
histórico/auditoria será tocado, e `zero substring farm no banco` **não é** critério de conclusão: objetos
com essa substring sobrevivem legitimamente.

### O contador da Empresa: não há atomicidade, e por isso é a 05C-2

O plano anterior dizia que a troca seria "atômica com o `update`, no MESMO deploy". **Isso não existe.**
Uma migration e um binário implantado não compartilham transação, e o rollout não é instantâneo: durante a
janela, as duas versões da API atendem ao mesmo tempo. As duas saídas aparentemente seguras falham, e a
falha está **medida** em `apps/api/test/integration/contador-empresa-transicao.test.ts`:

- **mover** a linha (`update ... set entity='empresa'`) enquanto a API antiga serve deixa aquela versão sem
  contador: `next_code(org,'farm')` **recria** a linha em 1 e recomeça a numeração;
- **copiar** a linha e manter as duas faz os dois lados emitirem **o mesmo próximo número**, e o segundo
  cadastro morre no `unique (organization_id, code)` de `erp.empresas`.

`erp.code_sequences` tem chave primária `(organization_id, entity)`: `'farm'` e `'empresa'` são duas linhas,
dois travamentos e dois contadores. A troca exige uma janela em que **apenas uma versão da API** esteja
servindo — um gate operacional, decidido e executado pelo Maike, não uma propriedade do código. Por isso ela
é a fatia 05C-2, depois da purga.

### A 05C-1 em um arquivo: `0017_purge_farm_legacy.sql`

A purga deixou de ser plano. Ela é **uma migration atômica**, executada pelo runner do produto dentro de UMA
transação (`begin` → arquivo inteiro → `insert` no ledger → `commit`): ou tudo entra, ou nada entra, e o
ledger só recebe a linha se o arquivo inteiro passar. Por isso o arquivo não tem `commit` no corpo, não tem
`create index concurrently` (proibido em transação) e **não tem `cascade` em lugar nenhum**.

Toda lista é **estática e nomeada**: cada objeto removido está escrito, um a um. Nada é descoberto por
consulta e removido em laço, e nada sai por casar com a palavra "farm".

#### A ordem, e por que é esta

| # | O que faz | Por que aqui, e não depois |
| ---: | --- | --- |
| 1 | `pg_try_advisory_xact_lock(2026, 51)`; se não obtém, aborta com `55P03` | o runner não tem trava própria: dois pre-deploys sobrepostos veriam a `0017` como pendente e tentariam aplicá-la juntos. A trava é transacional — sai no commit ou no rollback — e usa o espaço de DOIS inteiros, distinto do `pg_advisory_xact_lock(bigint)` da rota de notificações |
| 2 | `set local lock_timeout = '2s'` | sem ele, UMA espera por lock vira 120 s de `ACCESS EXCLUSIVE` retido (medido). É teto por COMANDO, não da janela — a janela não tem teto em lugar nenhum, e é por isso que o porteiro humano continua obrigatório |
| 3 | `lock table` de **55** relações em `access exclusive mode nowait`, ordem alfabética | ordem fixa para que duas execuções nunca se cruzem em sentidos opostos; `nowait` para falhar em milissegundos em vez de ficar pendurada segurando as outras 54. São as 49 tabelas + as 5 views + `erp.empresas`, nomeada de propósito porque a view `erp.farms` a arrastaria junto e lock implícito não tem ordem declarada |
| 4 | **pré-condições de inventário**, por igualdade EXATA contra o catálogo: colunas, FKs de coluna única, gatilhos, índices (e o gêmeo canônico de cada um), views e funções | fail-closed nos dois sentidos: falta um objeto da lista → aborta; existe um objeto legado FORA da lista → aborta também. Um objeto acrescentado depois desta lista não sobrevive escondido à purga — ele para a migration |
| 4.6 | **divergência legado × canônico, linha a linha**, nos 52 pares, com contagem e ids de exemplo | se algum par divergir, a purga apagaria justamente o lado que talvez fosse o certo. A migration PARA e diz onde; não corrige em silêncio. A chave de exemplo é a PK — inclusive as compostas das quatro tabelas de ligação sem coluna `id` |
| 4.7 | confere que `empresa_origem_id <> empresa_destino_id` já é verdade no acervo | `add constraint … check` valida na hora; criar sobre acervo inválido falharia no meio da purga |
| 5 | cria o **CHECK canônico** `equipment_transfers_empresa_origem_destino_check` | o CHECK histórico foi escrito sobre as colunas LEGADAS. Se elas caíssem primeiro, a invariante "origem ≠ destino" sumiria junto, **em silêncio**. O canônico nasce antes, e já validado |
| 6 | **substitui** a policy `api_child` de `erp.empresa_cost_centers` (`drop` + `create`) | era a única política do schema cujo predicado citava coluna legada. Substituída, nunca acompanhada: duas PERMISSIVE no mesmo comando combinam com OR e a mais frouxa acabaria valendo |
| 7 | remove as **5 views** de nome antigo | elas LEEM as colunas legadas; `drop column` sem `cascade` recusaria enquanto existissem |
| 8 | remove os **52 gatilhos** de espelho, por nome | as 49 tabelas alvo têm 66 gatilhos: 14 são de NEGÓCIO (auditoria, `set_updated_at`, travas de transferência) e ficam. `drop trigger` vai por nome, nunca por tabela |
| 9 | remove as **3 funções** `erp.sincronizar_empresa*` | depois dos gatilhos, senão o `drop function` esbarra na dependência |
| 10 | remove o **CHECK legado** `equipment_transfers_check` | explicitamente, e não de carona no `drop column`: o substituto já está de pé desde o item 5, e o que sai tem de estar inventariado |
| 11 | remove as **52 FKs de coluna única** | coluna única não prova tenant. Quem fica são as **50 compostas** `(organization_id, empresa_*)` |
| 12 | remove os **8 índices** legados | os oito gêmeos canônicos já existem desde a 0014, e a pré-condição 4.4 exigiu a presença de cada um: nenhum caminho de acesso se perde |
| 13 | remove as **52 colunas** legadas | por último, quando nada mais depende delas. Se alguma dependência tivesse escapado do inventário, o `drop column` falha aqui e a transação inteira volta atrás — que é o comportamento desejado |
| 14 | **pós-condições**: zero colunas, zero views, zero gatilhos, zero funções, **50** FKs compostas validadas, CHECK canônico presente e validado, nenhuma policy citando coluna legada, `erp.code_sequences` intacta | a migration confere o próprio resultado antes de deixar o commit acontecer. Verde por vacuidade não passa: cada zero tem um número esperado do outro lado |

No repositório, no MESMO commit: `colunaVinculo` de `erp.empresa_cost_centers` passou de `farm_id` para
`empresa_id` em `packages/domain/empresa-rls.mjs`, e `FASE_ESPELHO` passou de `dual` para `canonica` em
`scripts/lib/empresa-compat-surface.mjs`. Mudar só um dos lados REPROVA — é exatamente isso que impede a
purga de apagar a proteção em silêncio. Os testes de `upgrade-acervo` e `upgrade-rollback` **não** foram
apagados: atravessam a purga, porque o acervo legado não deixou de ter existido.

#### O que a 0017 deliberadamente NÃO faz

- **não toca no contador.** `erp.code_sequences` e `erp.next_code` ficam como estão, e a linha
  `entity = 'farm'` continua viva. Trocá-la é a **05C-2**, que precisa de janela com uma única versão da API
  servindo. A migration inclusive CONFERE, na pós-condição, que `erp.code_sequences` continua existindo —
  para que a fatia não passe perto do contador por acidente;
- **não remove nada por conter a palavra "farm".** `erp.farm_transfers`, `animal_farm_transfer`,
  `batch_farm_transfer`, `client_profiles.farm_name`, preferências de usuário, redirecionamentos de rota,
  `contrato-legado.ts` e as 13 chaves de permissão continuam onde estão. O escopo é a **ponte física**, não
  o vocabulário. Nomes históricos de constraint também ficam: `farm_cost_centers_farm_id_fkey` governa uma
  coluna de `erp.empresa_cost_centers` — nome é história, o que importa é a coluna;
- **não cria índice novo.** Os oito gêmeos canônicos já existiam; a fatia só exige que estejam lá;
- **não usa `cascade`**, em nenhum comando. Tudo que sai, sai nomeado;
- **não normaliza dado.** É DDL. O histórico de auditoria, as chaves de permissão e a preferência morta
  seguem classificados acima, não corrigidos.

### "Dívida = 0" não é critério de conclusão

O plano anterior encerrava com "inventário final: dívida = 0". Isso é um alvo de contador, não uma prova —
e um alvo de contador se atinge mexendo no contador. O que conclui a 05C é o conjunto abaixo, cada item
verificável por terceiro:

- os objetos da tabela acima não existem mais no banco de produção, medido por consulta a catálogo;
- `company-schema-sync` em fase `canonica`, verde, com número de colunas canônicas > 0;
- o guarda de RLS verde com a política `api_child` **reescrita** e presente no `pg_policies`, com `USING` e
  `WITH CHECK` conferidos separadamente, papéis como conjunto exato e a junção pai→filho pela coluna nova;
- `upgrade-acervo` e `upgrade-rollback` verdes atravessando a purga com acervo legado;
- version skew verde nos dois sentidos, com a base resolvida pela PR e impressa no log;
- as categorias `TOMBSTONE` e `PROVA_HISTORICA` **ainda declaradas** — se saíram, alguma coisa foi apagada
  antes da hora.

Nada disso é "dívida zero": é o conjunto de perguntas que, respondidas, tornam a remoção reversível e
comprovada. A contagem de ocorrências do nome antigo continua caindo como consequência, não como meta.
