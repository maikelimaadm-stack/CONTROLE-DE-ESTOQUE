# Inventário — dependência estrutural de "Fazenda"

> **Documento gerado.** Não edite à mão: `node scripts/farm-inventory.mjs`.

O núcleo do ERP precisa deixar de depender do nicho agro: **Fazenda → Empresa**
(`docs/MULTI-COMPANY-CONTRACT.md`, `docs/DOMAIN-NAMING-STANDARD.md`). Depois da migração física de
PRE-BASE2-03, um total único mentiria: `farm_id` numa migration aplicada é história, `X-Farm-Id` no
cliente HTTP é ponte com prazo, e "fazenda" no comentário de uma rota é o produto ainda falando o
nicho. Por isso cada ocorrência é classificada em um dos três baldes abaixo — e a catraca trava só o terceiro.

Total medido: **1767** ocorrências · 3 tabelas com coluna de empresa.

## Classificação (o número que importa é o balde 3)

| # | Balde | Ocorrências | Catraca | O que é |
| --- | --- | ---: | --- | --- |
| 1 | **LEGADO HISTÓRICO** | 1308 | não | Migrations aplicadas e documentação. O nome legado aqui é registro do que aconteceu; reescrever é falsificar história. |
| 2 | **COMPATIBILIDADE TRANSITÓRIA PERMITIDA** | 349 | não | Arquivos declarados em scripts/lib/empresa-compat-surface.mjs, cada um com motivo. Removidos em PRE-BASE2-05C-1 (purga física: colunas legadas, as cinco views de nome antigo e os gatilhos de espelho) — apenas a categoria PONTE_FISICA; ver CATEGORIAS_COMPAT. |
| 3 | **DÍVIDA DE PRODUTO PROIBIDA** | 110 | **sim — só diminui** | O produto ainda fala o nicho onde não precisa. Alvo: zero. A catraca só deixa diminuir. |

A regra que impede maquiagem: **arquivo não declarado cai no balde 3 por definição.** Esconder dívida
exige declarar o arquivo com motivo em `scripts/lib/empresa-compat-surface.mjs` — e a declaração aparece no diff.

## Por superfície × balde

| Superfície | 1. Histórico | 2. Compatibilidade | 3. Dívida (travada) | Total |
| --- | ---: | ---: | ---: | ---: |
| Schema (migrations) | 471 | 0 | 0 | 471 |
| API — código | 0 | 9 | **44** | 53 |
| API — testes | 0 | 50 | **51** | 101 |
| Núcleo neutro de nicho (plataforma) | 0 | 4 | 0 | 4 |
| Pacotes compartilhados | 0 | 170 | **11** | 181 |
| Web — código | 0 | 0 | 0 | 0 |
| Web — navegação/rotas | 0 | 7 | 0 | 7 |
| Web — testes ponta a ponta | 0 | 26 | 0 | 26 |
| Scripts e gates | 0 | 83 | **4** | 87 |
| Documentação ativa | 324 | 0 | 0 | 324 |
| Documentação histórica (referência externa) | 513 | 0 | 0 | 513 |
| **Total** | **1308** | **349** | **110** | **1767** |

## Balde 2 — a ponte declarada

Cada arquivo abaixo pode falar o idioma antigo por um motivo escrito. Todos saem em **PRE-BASE2-05C-1 (purga física: colunas legadas, as cinco views de nome antigo e os gatilhos de espelho) — apenas a categoria PONTE_FISICA; ver CATEGORIAS_COMPAT**.

### Runtime — o que o cliente anterior consome

| Arquivo | Ocorrências | Por que pode |
| --- | ---: | --- |
| `apps/api/src/lib/contrato-legado.ts` | 9 | CONTRATO NEGATIVO (não é tradutor): nomeia o cabeçalho, os campos e o formato administrativo anteriores para RECUSÁ-LOS com erro de validação. Existe porque `z.object` descarta chave desconhecida — um `farm_id` ignorado em silêncio mudaria a empresa da operação. Sai depois da 05C-1, e só com tráfego real observado. |
| `apps/web/nav.registry.mjs` | 7 | Redirecionamentos das rotas legadas de cadastro — navegação de favoritos do usuário, não protocolo de API. TOMBSTONE: saem depois da 05C-1, com tráfego real observado, nunca junto com a purga. |

### Prova — testes que quebram antes do cliente

| Arquivo | Ocorrências | Por que pode |
| --- | ---: | --- |
| `apps/api/test/integration/contrato-empresa.test.ts` | 21 | Prova o CONTRATO NEGATIVO com requisições reais: cabeçalho, corpo, query, recurso e entidade de anexo anteriores são recusados — e o canônico funciona. Cita o nome antigo para provar que ele NÃO é aceito. |
| `apps/api/test/unit/attachment-parent-guard.test.ts` | 1 | Prova que o nome ANTERIOR de tabela não resolve mais como entidade anexável. |
| `apps/api/test/unit/espelho-empresa-fases.test.ts` | 17 | VOCABULÁRIO: prova o contrato do espelho POR PAR HISTÓRICO com migrations de mentira. Precisa escrever `farm_id` nos fixtures porque é esse o nome que a ponte física usou — é o objeto medido, não uma dependência. Vive enquanto houver par histórico a cobrar, o que inclui DEPOIS da purga: é o lado `canonica` do contrato. |
| `apps/api/test/unit/rls-excecao-protecao.test.ts` | 7 | VOCABULÁRIO: prova que a proteção declarada RECUSA a política perigosa (USING/WITH CHECK abertos, papel extra, PERMISSIVE extra, junção pai→filho quebrada). A 05C-1 já trocou o vínculo de erp.empresa_cost_centers para `empresa_id` na política E no SSOT; o caso B10 continua provando o acoplamento, agora medindo o desvio na direção oposta — VOLTAR para `farm_id` num lado só REPROVA. |
| `packages/plataforma/test/sessao-empresa.test.ts` | 4 | Prova que a sessão gravada por um cliente anterior à virada canônica é INVÁLIDA (sem promoção) e que o contrato de valor é exigido. |
| `packages/db/test/empresa-compat.test.ts` | 21 | PROVA HISTÓRICA, depois da 05C-1. Os blocos que mediam a ponte — a view `erp.farms` e os gatilhos de espelho — saíram JUNTO com os objetos, na fatia que os apagou. O que ficou fala o idioma antigo porque reconstrói um banco até a 0013 (quando `erp.farms` era TABELA) para provar que um acervo real atravessa a cadeia inteira, agora incluindo a purga, sem perder linha nem identificador. |
| `packages/db/test/backfill-empresas.test.ts` | 4 | PROVA HISTÓRICA: o backfill de `farm_id` → `empresa_id`, linha a linha. Continua sendo a evidência de que um acervo anterior é carregado corretamente — o passado não muda quando a coluna sai. NÃO sai na 05C-1. |
| `packages/db/test/backfill-owner-restrito.test.ts` | 5 | PROVA HISTÓRICA: a conversão do escopo herdado de `erp.member_farms`, que é o estado real de quem veio de antes. NÃO sai na 05C-1. |
| `packages/db/test/responsavel-tenant.test.ts` | 4 | PROVA HISTÓRICA: NÃO saiu na 05C-1 — apagá-lo removeria a única prova de que a 0013 PARA diante de acervo cross-tenant. O que mudou é que ele passou a declarar a ERA: o bloco que reconstrói o banco até a 0012 fala `erp.farms`/`farm_id`, porque naquele momento eram a tabela e a coluna de verdade, e o resto fala canônico. |
| `packages/db/test/notificacao-legado.test.ts` | 1 | PROVA HISTÓRICA: reconstrói o banco até a 0011 e escreve em `erp.farms` — que ali é TABELA, não a view que a 05C-1 removeu. Por isso não saiu na purga: o que ele fala é o idioma do acervo daquele momento. |
| `packages/db/test/schema.test.ts` | 4 | VOCABULÁRIO: a 05C-1 já fez a INVERSÃO prometida — o caso que aferia a coexistência das duas colunas agora exige que a legada não exista em coluna nenhuma, com a contraprova de que o lado canônico está de pé. Cita o nome antigo para procurá-lo e não achar. |
| `packages/db/test/upgrade-acervo.test.ts` | 25 | PROVA HISTÓRICA: escreve o histórico no idioma ANTERIOR (`farm_id`), como a API antiga gravava, e só então aplica as migrations. Falar o idioma novo aqui inventaria um acervo que nunca existiu — e apagar o teste na 05C-1 removeria a única prova de que o banco de um cliente REAL sobe. NÃO saiu na 05C-1, e não precisou ser estendido: o laço final do arquivo aplica TUDO que ficou pendente e depois exige que nada tenha sobrado, então ele atravessa a 0017 por construção. |
| `packages/db/test/upgrade-rollback.test.ts` | 4 | PROVA HISTÓRICA: mesmo acervo legado, para provar que uma falha depois da janela estrutural devolve o ledger protegido. NÃO saiu na 05C-1, e NÃO foi estendido: ele mede a janela de suspensão do gatilho do ledger DENTRO da 0014 e termina ali — atravessar a purga não é trabalho dele. A falha DURANTE a purga é coberta por `packages/db/test/purga-0017-concorrencia.test.ts`. |
| `apps/web/e2e/empresa-canonica.spec.ts` | 8 | Cutover canônico medido no navegador: cita o nome antigo para provar que ele NÃO sai no fio e que a sessão anterior não é mais promovida. |
| `apps/web/e2e/skew-api-producao.spec.ts` | 14 | Version skew SENTIDO 1 (web deste HEAD × API da base): cita o nome antigo para provar que ele NÃO sai do cliente canônico. |
| `apps/web/e2e/skew-web-anterior.spec.ts` | 4 | Version skew SENTIDO 2 (web da base × API deste HEAD): cita o nome antigo para provar que a API nova o RECUSA — e que o cliente em produção não depende dele. |
| `packages/db/test/purga-0017-fresh.test.ts` | 20 | VOCABULÁRIO (05C-1): mede a ponte física INTEIRA com a 0016 aplicada — 52 colunas, 5 views, 52 gatilhos, 3 funções, 52 FKs, 8 índices — e então exige que todos esses contadores caiam a zero depois da 0017. Cita o nome antigo porque ele É o objeto medido; sem citá-lo, a ausência não teria como ser contada. |
| `packages/db/test/purga-0017-upgrade.test.ts` | 46 | VOCABULÁRIO + PROVA HISTÓRICA (05C-1): semeia acervo da fase DUAL, escrevendo pelos dois lados para provar que o espelho da 0014 estava vivo, e só então atravessa a purga conferindo que o dado canônico sobreviveu linha a linha. O idioma antigo aparece porque era assim que o acervo era escrito. |
| `packages/db/test/purga-0017-concorrencia.test.ts` | 22 | VOCABULÁRIO (05C-1): prova a trava de concorrência e o comportamento sob contenção de relação e de objeto de catálogo. Cita o nome das funções de sincronia porque é sobre uma delas que a disputa de catálogo é montada, e conta os objetos legados para provar que uma falha NÃO deixou estado parcial. |
| `packages/db/test/purga-0017-invariantes.test.ts` | 5 | VOCABULÁRIO (05C-1): confere FKs compostas, CHECK canônico, papéis da política e isolamento de tenant depois da purga, comparando o estado ANTES e DEPOIS. Precisa nomear a coluna legada para provar que nenhuma política ainda decide por ela. |
| `apps/api/test/unit/cutover-contador-decisao.test.ts` | 4 | VOCABULÁRIO (05C-2): prova que a exceção de version skew EXPIRA sozinha e que o SSOT canônico não regride. Para isso precisa CITAR os nomes legados — `erp.farms`, `member_farms`, `farmScoped`, a constante `'farm'` — porque o que ele cobra é justamente que eles NÃO voltem a ser apresentados como estado atual (T6) e que a decisão ative só na troca da constante. Um teste que proíbe um nome sem escrevê-lo não tem como procurá-lo. |
| `packages/db/test/cutover-0018-fail-closed.test.ts` | 1 | VOCABULÁRIO (05C-2): a 0018 exige, como pré-condição, que a ponte física da 05C-1 já tenha saído — se ainda houver coluna legada, a 0017 não terminou e o cutover do contador não pode rodar. Provar essa recusa obriga a REINTRODUZIR uma coluna `farm_id` num banco descartável, dentro de uma transação desfeita: é o estímulo do teste, não uma dependência do produto. Sem citar o nome antigo, a guarda que o procura ficaria sem prova de que reprova. |

### Confinamento — gates e dicionário

| Arquivo | Ocorrências | Por que pode |
| --- | ---: | --- |
| `scripts/farm-compat-allowlist.mjs` | 21 | O gate que confina o que resta: precisa citar cada símbolo legado para procurá-lo. É ELE o guardrail do servidor canônico — o que não estiver declarado aqui reprova. |
| `apps/web/scripts/empresa-canonica-audit.mjs` | 10 | A catraca do cliente canônico (PRE-BASE2-05A): precisa citar cada símbolo legado para PROIBI-LO no web produtivo. Sem o tradutor de fio, um nome legado que voltasse ao cliente não quebraria em runtime — a API bilíngue aceitaria —, e é esta lista que o pega. |
| `scripts/lib/empresa-compat-surface.mjs` | 20 | Esta lista. |
| `scripts/company-schema-sync.mjs` | 1 | Borda de linha de comando do contrato do espelho; nomeia as duas grafias para conferi-las. |
| `scripts/lib/espelho-empresa.mjs` | 10 | A REGRA do espelho, pura e testável: precisa nomear cada par canônico × legado para cobrá-lo por par histórico. É o instrumento que detecta purga parcial — some no dia em que não houver mais par histórico algum, o que não acontece na 05C-1. |
| `scripts/member-farms-audit.mjs` | 6 | Impede que `erp.member_farms` volte a ser autoridade de runtime. |
| `scripts/data-dictionary.mjs` | 1 | Gera o dicionário, que documenta a coluna legada enquanto ela existir. |
| `packages/domain/dicionario-dados.mjs` | 4 | Dicionário de dados: `erp.farms` e `farm_id` existem no banco e precisam estar documentados. |
| `packages/domain/empresa-rls.mjs` | 4 | Classificação de RLS: nomeia o arquivo morto de `erp.member_farms`. |
| `scripts/purchase-responsible-audit.mjs` | 2 | Mensagem de diagnóstico do gate cita a assinatura anterior. |
| `scripts/gate-purga-0017-runtime-anterior.mjs` | 12 | VOCABULÁRIO (G-U5): sobe o binário ANTERIOR da API contra um banco com a 0017 aplicada e varre as respostas procurando menção a objeto purgado. Precisa nomear `farm_id`, `erp.farms` e as funções de sincronia porque são exatamente eles que NÃO podem aparecer. É o instrumento, não a dependência. |

## Balde 3 — dívida de produto (alvo: zero)

Onde o produto ainda fala o nicho sem precisar. Ordem de ataque: quem concentra mais.

| Arquivo | Superfície | Ocorrências |
| --- | --- | ---: |
| `apps/api/test/integration/api.test.ts` | API — testes | 16 |
| `apps/api/test/integration/escopo-empresa-matriz.test.ts` | API — testes | 16 |
| `apps/api/test/unit/escopo-empresa-guard.test.ts` | API — testes | 11 |
| `apps/api/src/routes/resources.ts` | API — código | 8 |
| `apps/api/src/routes/stock.ts` | API — código | 7 |
| `apps/api/src/routes/livestock.ts` | API — código | 5 |
| `packages/db/src/seed.ts` | Pacotes compartilhados | 5 |
| `apps/api/src/routes/admin.ts` | API — código | 4 |
| `apps/api/src/routes/reports.ts` | API — código | 4 |
| `apps/api/test/integration/attachments-scope.test.ts` | API — testes | 4 |
| `apps/api/src/lib/attachment-parent.ts` | API — código | 3 |
| `apps/api/src/routes/fleet-hr.ts` | API — código | 3 |
| `apps/api/test/integration/rls-matriz.test.ts` | API — testes | 3 |
| `scripts/parity-map.mjs` | Scripts e gates | 3 |
| `apps/api/src/plugins/auth.ts` | API — código | 2 |
| `packages/domain/src/escopo-permissao.ts` | Pacotes compartilhados | 2 |
| `apps/api/src/lib/context.ts` | API — código | 1 |
| `apps/api/src/lib/empresa.ts` | API — código | 1 |
| `apps/api/src/lib/escopo-admin.ts` | API — código | 1 |
| `apps/api/src/routes/attachments.ts` | API — código | 1 |
| `apps/api/src/routes/sales.ts` | API — código | 1 |
| `apps/api/src/routes/supply.ts` | API — código | 1 |
| `apps/api/src/server.ts` | API — código | 1 |
| `apps/api/src/services/stock-core.ts` | API — código | 1 |
| `apps/api/test/unit/escopo-classificacao.test.ts` | API — testes | 1 |
| _… mais 5 arquivo(s)_ | | 5 |

## Por símbolo (o que precisa migrar)

| Símbolo atual | Natureza | Total | dos quais dívida | Destino canônico |
| --- | --- | ---: | ---: | --- |
| `farm_id` | dado | 769 | 4 | `empresa_id` |
| `farms` | dado | 126 | 0 | `erp.empresas` |
| `member_farms` | dado | 76 | 15 | `member_empresas` |
| `ctx_farmId` | contrato | 9 | 0 | `empresaSelecionada` |
| `farmIds` | contrato | 0 | 0 | `empresasPermitidas` |
| `x_farm_id` | contrato | 35 | 3 | `X-Empresa-Id` |
| `farmScope` | contrato | 3 | 2 | `escopoEmpresa` |
| `allowedFarms` | contrato | 6 | 3 | `escopoEmpresa (@erp/plataforma)` |
| `farms` | contrato | 89 | 6 | `/empresas` |
| `fazenda` | texto | 654 | 77 | `Empresa (i18n: termos.empresa)` |

`dado` = exige migration e backfill · `contrato` = quebra clientes se mudar sem compatibilidade · `texto` = rótulo, resolvido por i18n.

## Tabelas com coluna de empresa

As 3 tabelas abaixo carregam a coluna legada espelhada ao lado da canônica `empresa_id`.

| Tabela | Coluna(s) legada(s) |
| --- | --- |
| `erp.animal_movements` | `empresa_destino_id` |
| `erp.equipment_transfers` | `empresa_origem_id` · `empresa_destino_id` |
| `erp.warehouse_transfers` | `empresa_origem_id` · `empresa_destino_id` |

## Como esta catraca funciona

`node scripts/farm-inventory.mjs --check` roda no `lint` e falha quando:

1. a **dívida de produto** cresce em qualquer superfície (balde 3, comparado a `scripts/farm-inventory.baseline.json`);
2. um arquivo **declarado** na ponte não tem mais nome legado — a autorização virou letra morta e precisa sair da lista.

Para crescer a ponte de propósito, declare o arquivo com motivo em `scripts/lib/empresa-compat-surface.mjs` e
regenere o baseline no MESMO commit: a intenção fica visível na revisão.
