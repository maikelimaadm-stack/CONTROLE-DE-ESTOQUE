/**
 * SUPERFÍCIE DECLARADA DA PONTE FAZENDA → EMPRESA (PRE-BASE2-03).
 *
 * Fonte única de verdade de DOIS gates que fariam a mesma pergunta de formas diferentes se cada um
 * mantivesse a sua lista:
 *
 *   - `scripts/farm-compat-allowlist.mjs` — o nome legado só pode APARECER nos arquivos de `PONTE_RUNTIME`;
 *   - `scripts/farm-inventory.mjs`        — separa COMPATIBILIDADE DECLARADA de DÍVIDA DE PRODUTO.
 *
 * Duas listas divergindo é como a ponte vira arquitetura: um gate autoriza, o outro não vê, e o arquivo
 * some da contabilidade. Aqui cada arquivo tem um motivo escrito e um marco de remoção — é isso que torna
 * possível apagar a ponte um dia em vez de conviver com ela para sempre.
 */

/**
 * NEM TUDO QUE FALA O IDIOMA ANTIGO SAI NA MESMA HORA — E DUAS COISAS NÃO SAEM NUNCA.
 *
 * Até a PRE-BASE2-05C-0 havia UM marco só, e a lista inteira dizia "sai na 05C". Isso estava errado em duas
 * direções, e as duas são caras:
 *
 *  • mandava APAGAR prova que precisa sobreviver. `upgrade-acervo` e `upgrade-rollback` escrevem o histórico
 *    no idioma ANTERIOR porque era assim que a API antiga gravava. Esse acervo não deixa de ter existido
 *    quando a coluna é removida — é exatamente o que a migração precisa continuar sabendo carregar. Apagar
 *    esses testes na 05C-1 removeria a única prova de que o banco de um cliente REAL sobe;
 *  • prometia remover em conjunto coisas com gatilhos diferentes. O contrato negativo só sai com tráfego
 *    real observado; a chave da sequência só sai com uma janela operacional (ver
 *    `apps/api/src/lib/sequencia-empresa.ts`); um gate só sai quando o objeto que ele vigia deixa de existir.
 *
 * Então a superfície passa a ser classificada, e cada categoria tem o SEU gatilho.
 *
 * O QUE NÃO ESTÁ NAS LISTAS ABAIXO, E POR QUÊ. `apps/api/src/lib/sequencia-empresa.ts` guarda o valor
 * `"farm"` de `erp.code_sequences.entity` — um DADO vivo, não um nome de fio nem de coluna. As listas daqui
 * são indexadas por OCORRÊNCIA DE NOME LEGADO, e o inventário (`scripts/farm-inventory.mjs`) não reconhece
 * essa string como tal: declará-lo aqui produziria uma "declaração sem uso" e quebraria o gate sem
 * acrescentar informação. O gatilho de remoção dele está declarado onde ele de fato vive — a fatia
 * PRE-BASE2-05C-2, na tabela de fases de `docs/DEPLOYMENT.md` e na decisão 112 de `docs/DECISIONS.md` —,
 * e o próprio arquivo explica por que a troca exige janela operacional.
 */
export const CATEGORIAS_COMPAT = {
  PONTE_FISICA: { marco: "PRE-BASE2-05C-1", explica: "Depende de um OBJETO do banco que a 05C-1 remove (coluna legada, view de nome antigo, gatilho de espelho). Sai junto com o objeto — antes disso quebraria; depois disso não compila contra nada." },
  TOMBSTONE: { marco: "depois da 05C-1, com tráfego real observado", explica: "Nomeia o idioma antigo para RECUSÁ-LO. Só pode sair quando ninguém mais o envia — e isso se mede em produção, não no repositório." },
  PROVA_HISTORICA: { marco: "NUNCA", explica: "Fala o idioma antigo porque o ACERVO era assim. O passado não muda quando a coluna sai: esta prova continua sendo a única evidência de que um banco antigo sobe. Remover é perder a prova, não concluir a migração." },
  VOCABULARIO: { marco: "enquanto o objeto vigiado existir", explica: "Cita o nome antigo para VIGIÁ-LO ou DOCUMENTÁ-LO (gate, dicionário, classificação). Não é dependência: é o instrumento. Vive exatamente enquanto houver o que medir." }
};

/**
 * Marco citado nos relatórios. Continua existindo para os textos que já o referenciam, mas agora diz a
 * verdade: o que sai na fatia destrutiva é a PONTE FÍSICA — não "tudo abaixo".
 */
export const MARCO_DE_REMOCAO = "PRE-BASE2-05C-1 (purga física: colunas legadas, as cinco views de nome antigo e os gatilhos de espelho) — apenas a categoria PONTE_FISICA; ver CATEGORIAS_COMPAT";

/**
 * FASE DO ESPELHO — marcador CONSCIENTE, lido por `scripts/company-schema-sync.mjs`.
 *
 * `dual`: as duas grafias existem e precisam concordar. `canonica`: a legada não existe mais em lugar nenhum.
 * É um interruptor que a PRE-BASE2-05C-1 tem de virar À MÃO, junto com a migration — e é essa exigência que
 * o torna útil. Sem ele, no dia em que as colunas legadas sumissem, o gate de espelho encontraria zero pares,
 * não teria o que comparar e imprimiria OK: o verde que não prova nada, no exato momento mais perigoso da
 * migração. Com ele, esquecer de virar a fase REPROVA.
 */
export const FASE_ESPELHO = "canonica";

/**
 * Runtime: o que ainda pode nomear o idioma antigo — e NENHUM deles traduz (PRE-BASE2-05B).
 *
 * A diferença é o ponto inteiro desta fase. Até a 05A esta lista era uma PONTE: código que aceitava os dois
 * idiomas e convertia um no outro. Depois da 05B ela é outra coisa — uma lápide e uma chave física:
 *
 *   · o contrato negativo RECUSA o nome antigo (e precisa nomeá-lo para procurá-lo);
 *   · a chave da sequência é um DADO em `erp.code_sequences`, não um nome de fio.
 *
 * Nenhum dos dois pode ser "removido" sozinho: o primeiro depende de observar tráfego real; o segundo, de
 * uma JANELA OPERACIONAL em que só uma versão da API sirva (a fatia PRE-BASE2-05C-2; não existe migration
 * atômica com um binário implantado). Por isso continuam declarados, com o motivo à vista.
 */
export const PONTE_RUNTIME = {
  "apps/api/src/lib/contrato-legado.ts": "CONTRATO NEGATIVO (não é tradutor): nomeia o cabeçalho, os campos e o formato administrativo anteriores para RECUSÁ-LOS com erro de validação. Existe porque `z.object` descarta chave desconhecida — um `farm_id` ignorado em silêncio mudaria a empresa da operação. Sai depois da 05C-1, e só com tráfego real observado.",
  "apps/web/nav.registry.mjs": "Redirecionamentos das rotas legadas de cadastro — navegação de favoritos do usuário, não protocolo de API. TOMBSTONE: saem depois da 05C-1, com tráfego real observado, nunca junto com a purga."
};

/** Prova: testes que só valem porque falam o idioma antigo — se a ponte quebrar, eles quebram antes do cliente. */
export const PONTE_PROVA = {
  "apps/api/test/integration/contrato-empresa.test.ts": "Prova o CONTRATO NEGATIVO com requisições reais: cabeçalho, corpo, query, recurso e entidade de anexo anteriores são recusados — e o canônico funciona. Cita o nome antigo para provar que ele NÃO é aceito.",
  "apps/api/test/unit/attachment-parent-guard.test.ts": "Prova que o nome ANTERIOR de tabela não resolve mais como entidade anexável.",
  "apps/api/test/unit/espelho-empresa-fases.test.ts": "VOCABULÁRIO: prova o contrato do espelho POR PAR HISTÓRICO com migrations de mentira. Precisa escrever `farm_id` nos fixtures porque é esse o nome que a ponte física usou — é o objeto medido, não uma dependência. Vive enquanto houver par histórico a cobrar, o que inclui DEPOIS da purga: é o lado `canonica` do contrato.",
  "apps/api/test/unit/rls-excecao-protecao.test.ts": "VOCABULÁRIO: prova que a proteção declarada RECUSA a política perigosa (USING/WITH CHECK abertos, papel extra, PERMISSIVE extra, junção pai→filho quebrada). A 05C-1 já trocou o vínculo de erp.empresa_cost_centers para `empresa_id` na política E no SSOT; o caso B10 continua provando o acoplamento, agora medindo o desvio na direção oposta — VOLTAR para `farm_id` num lado só REPROVA.",
  "packages/plataforma/test/sessao-empresa.test.ts": "Prova que a sessão gravada por um cliente anterior à virada canônica é INVÁLIDA (sem promoção) e que o contrato de valor é exigido.",
  "packages/db/test/empresa-compat.test.ts": "PROVA HISTÓRICA, depois da 05C-1. Os blocos que mediam a ponte — a view `erp.farms` e os gatilhos de espelho — saíram JUNTO com os objetos, na fatia que os apagou. O que ficou fala o idioma antigo porque reconstrói um banco até a 0013 (quando `erp.farms` era TABELA) para provar que um acervo real atravessa a cadeia inteira, agora incluindo a purga, sem perder linha nem identificador.",
  "packages/db/test/backfill-empresas.test.ts": "PROVA HISTÓRICA: o backfill de `farm_id` → `empresa_id`, linha a linha. Continua sendo a evidência de que um acervo anterior é carregado corretamente — o passado não muda quando a coluna sai. NÃO sai na 05C-1.",
  "packages/db/test/backfill-owner-restrito.test.ts": "PROVA HISTÓRICA: a conversão do escopo herdado de `erp.member_farms`, que é o estado real de quem veio de antes. NÃO sai na 05C-1.",
  "packages/db/test/responsavel-tenant.test.ts": "PROVA HISTÓRICA: NÃO saiu na 05C-1 — apagá-lo removeria a única prova de que a 0013 PARA diante de acervo cross-tenant. O que mudou é que ele passou a declarar a ERA: o bloco que reconstrói o banco até a 0012 fala `erp.farms`/`farm_id`, porque naquele momento eram a tabela e a coluna de verdade, e o resto fala canônico.",
  "packages/db/test/notificacao-legado.test.ts": "PROVA HISTÓRICA: reconstrói o banco até a 0011 e escreve em `erp.farms` — que ali é TABELA, não a view que a 05C-1 removeu. Por isso não saiu na purga: o que ele fala é o idioma do acervo daquele momento.",
  "packages/db/test/schema.test.ts": "VOCABULÁRIO: a 05C-1 já fez a INVERSÃO prometida — o caso que aferia a coexistência das duas colunas agora exige que a legada não exista em coluna nenhuma, com a contraprova de que o lado canônico está de pé. Cita o nome antigo para procurá-lo e não achar.",
  "packages/db/test/upgrade-acervo.test.ts": "PROVA HISTÓRICA: escreve o histórico no idioma ANTERIOR (`farm_id`), como a API antiga gravava, e só então aplica as migrations. Falar o idioma novo aqui inventaria um acervo que nunca existiu — e apagar o teste na 05C-1 removeria a única prova de que o banco de um cliente REAL sobe. NÃO saiu na 05C-1, e não precisou ser estendido: o laço final do arquivo aplica TUDO que ficou pendente e depois exige que nada tenha sobrado, então ele atravessa a 0017 por construção.",
  "packages/db/test/upgrade-rollback.test.ts": "PROVA HISTÓRICA: mesmo acervo legado, para provar que uma falha depois da janela estrutural devolve o ledger protegido. NÃO saiu na 05C-1, e NÃO foi estendido: ele mede a janela de suspensão do gatilho do ledger DENTRO da 0014 e termina ali — atravessar a purga não é trabalho dele. A falha DURANTE a purga é coberta por `packages/db/test/purga-0017-concorrencia.test.ts`.",
  "apps/web/e2e/empresa-canonica.spec.ts": "Cutover canônico medido no navegador: cita o nome antigo para provar que ele NÃO sai no fio e que a sessão anterior não é mais promovida.",
  "apps/web/e2e/skew-api-producao.spec.ts": "Version skew SENTIDO 1 (web deste HEAD × API da base): cita o nome antigo para provar que ele NÃO sai do cliente canônico.",
  "apps/web/e2e/skew-web-anterior.spec.ts": "Version skew SENTIDO 2 (web da base × API deste HEAD): cita o nome antigo para provar que a API nova o RECUSA — e que o cliente em produção não depende dele.",
  "packages/db/test/purga-0017-fresh.test.ts": "VOCABULÁRIO (05C-1): mede a ponte física INTEIRA com a 0016 aplicada — 52 colunas, 5 views, 52 gatilhos, 3 funções, 52 FKs, 8 índices — e então exige que todos esses contadores caiam a zero depois da 0017. Cita o nome antigo porque ele É o objeto medido; sem citá-lo, a ausência não teria como ser contada.",
  "packages/db/test/purga-0017-upgrade.test.ts": "VOCABULÁRIO + PROVA HISTÓRICA (05C-1): semeia acervo da fase DUAL, escrevendo pelos dois lados para provar que o espelho da 0014 estava vivo, e só então atravessa a purga conferindo que o dado canônico sobreviveu linha a linha. O idioma antigo aparece porque era assim que o acervo era escrito.",
  "packages/db/test/purga-0017-concorrencia.test.ts": "VOCABULÁRIO (05C-1): prova a trava de concorrência e o comportamento sob contenção de relação e de objeto de catálogo. Cita o nome das funções de sincronia porque é sobre uma delas que a disputa de catálogo é montada, e conta os objetos legados para provar que uma falha NÃO deixou estado parcial.",
  "packages/db/test/purga-0017-invariantes.test.ts": "VOCABULÁRIO (05C-1): confere FKs compostas, CHECK canônico, papéis da política e isolamento de tenant depois da purga, comparando o estado ANTES e DEPOIS. Precisa nomear a coluna legada para provar que nenhuma política ainda decide por ela.",
  "apps/api/test/unit/cutover-contador-decisao.test.ts": "VOCABULÁRIO (05C-2): prova que a exceção de version skew EXPIRA sozinha e que o SSOT canônico não regride. Para isso precisa CITAR os nomes legados — `erp.farms`, `member_farms`, `farmScoped`, a constante `'farm'` — porque o que ele cobra é justamente que eles NÃO voltem a ser apresentados como estado atual (T6) e que a decisão ative só na troca da constante. Um teste que proíbe um nome sem escrevê-lo não tem como procurá-lo.",
  "packages/db/test/cutover-0018-fail-closed.test.ts": "VOCABULÁRIO (05C-2): a 0018 exige, como pré-condição, que a ponte física da 05C-1 já tenha saído — se ainda houver coluna legada, a 0017 não terminou e o cutover do contador não pode rodar. Provar essa recusa obriga a REINTRODUZIR uma coluna `farm_id` num banco descartável, dentro de uma transação desfeita: é o estímulo do teste, não uma dependência do produto. Sem citar o nome antigo, a guarda que o procura ficaria sem prova de que reprova."
};


/** Confinamento: os próprios gates e o dicionário precisam nomear o que vigiam. */
export const PONTE_GATES = {
  "scripts/farm-compat-allowlist.mjs": "O gate que confina o que resta: precisa citar cada símbolo legado para procurá-lo. É ELE o guardrail do servidor canônico — o que não estiver declarado aqui reprova.",
  "apps/web/scripts/empresa-canonica-audit.mjs": "A catraca do cliente canônico (PRE-BASE2-05A): precisa citar cada símbolo legado para PROIBI-LO no web produtivo. Sem o tradutor de fio, um nome legado que voltasse ao cliente não quebraria em runtime — a API bilíngue aceitaria —, e é esta lista que o pega.",
  "scripts/lib/empresa-compat-surface.mjs": "Esta lista.",
  "scripts/company-schema-sync.mjs": "Borda de linha de comando do contrato do espelho; nomeia as duas grafias para conferi-las.",
  "scripts/lib/espelho-empresa.mjs": "A REGRA do espelho, pura e testável: precisa nomear cada par canônico × legado para cobrá-lo por par histórico. É o instrumento que detecta purga parcial — some no dia em que não houver mais par histórico algum, o que não acontece na 05C-1.",
  "scripts/member-farms-audit.mjs": "Impede que `erp.member_farms` volte a ser autoridade de runtime.",
  "scripts/data-dictionary.mjs": "Gera o dicionário, que documenta a coluna legada enquanto ela existir.",
  "packages/domain/dicionario-dados.mjs": "Dicionário de dados: `erp.farms` e `farm_id` existem no banco e precisam estar documentados.",
  "packages/domain/empresa-rls.mjs": "Classificação de RLS: nomeia o arquivo morto de `erp.member_farms`.",
  "scripts/purchase-responsible-audit.mjs": "Mensagem de diagnóstico do gate cita a assinatura anterior.",
  "scripts/gate-purga-0017-runtime-anterior.mjs": "VOCABULÁRIO (G-U5): sobe o binário ANTERIOR da API contra um banco com a 0017 aplicada e varre as respostas procurando menção a objeto purgado. Precisa nomear `farm_id`, `erp.farms` e as funções de sincronia porque são exatamente eles que NÃO podem aparecer. É o instrumento, não a dependência."
};

/**
 * CATEGORIA DE CADA ARQUIVO DECLARADO. Fail-closed: `categoriaDaPonte` devolve `null` para arquivo sem
 * classificação, e o gate que a consome reprova — declarar um arquivo sem dizer QUANDO ele sai é como a
 * lista voltava a virar arquitetura.
 */
export const CATEGORIA_COMPAT = {
  "apps/api/src/lib/contrato-legado.ts": "TOMBSTONE",
  "apps/web/nav.registry.mjs": "TOMBSTONE",
  "apps/api/test/integration/contrato-empresa.test.ts": "TOMBSTONE",
  "apps/api/test/unit/attachment-parent-guard.test.ts": "TOMBSTONE",
  "apps/api/test/unit/espelho-empresa-fases.test.ts": "VOCABULARIO",
  "apps/api/test/unit/rls-excecao-protecao.test.ts": "VOCABULARIO",
  "packages/plataforma/test/sessao-empresa.test.ts": "TOMBSTONE",
  "packages/db/test/empresa-compat.test.ts": "PROVA_HISTORICA",
  "packages/db/test/backfill-empresas.test.ts": "PROVA_HISTORICA",
  "packages/db/test/backfill-owner-restrito.test.ts": "PROVA_HISTORICA",
  "packages/db/test/responsavel-tenant.test.ts": "PROVA_HISTORICA",
  "packages/db/test/notificacao-legado.test.ts": "PROVA_HISTORICA",
  "packages/db/test/schema.test.ts": "VOCABULARIO",
  "packages/db/test/purga-0017-fresh.test.ts": "VOCABULARIO",
  "packages/db/test/purga-0017-upgrade.test.ts": "PROVA_HISTORICA",
  "packages/db/test/purga-0017-concorrencia.test.ts": "VOCABULARIO",
  "packages/db/test/purga-0017-invariantes.test.ts": "VOCABULARIO",
  "apps/api/test/unit/cutover-contador-decisao.test.ts": "VOCABULARIO",
  "packages/db/test/cutover-0018-fail-closed.test.ts": "VOCABULARIO",
  "scripts/gate-purga-0017-runtime-anterior.mjs": "VOCABULARIO",
  "packages/db/test/upgrade-acervo.test.ts": "PROVA_HISTORICA",
  "packages/db/test/upgrade-rollback.test.ts": "PROVA_HISTORICA",
  "apps/web/e2e/empresa-canonica.spec.ts": "TOMBSTONE",
  "apps/web/e2e/skew-api-producao.spec.ts": "TOMBSTONE",
  "apps/web/e2e/skew-web-anterior.spec.ts": "TOMBSTONE",
  "scripts/farm-compat-allowlist.mjs": "VOCABULARIO",
  "apps/web/scripts/empresa-canonica-audit.mjs": "VOCABULARIO",
  "scripts/lib/empresa-compat-surface.mjs": "VOCABULARIO",
  "scripts/company-schema-sync.mjs": "VOCABULARIO",
  "scripts/lib/espelho-empresa.mjs": "VOCABULARIO",
  "scripts/member-farms-audit.mjs": "VOCABULARIO",
  "scripts/data-dictionary.mjs": "VOCABULARIO",
  "packages/domain/dicionario-dados.mjs": "VOCABULARIO",
  "packages/domain/empresa-rls.mjs": "VOCABULARIO",
  "scripts/purchase-responsible-audit.mjs": "VOCABULARIO"
};

/** Categoria declarada de um arquivo da ponte; `null` quando não há — o que é motivo de reprovação. */
export const categoriaDaPonte = (arquivo) => CATEGORIA_COMPAT[arquivo] ?? null;

/** Tudo que pode falar o idioma antigo, com motivo. Fora daqui, nome legado é dívida de produto. */
export const PONTE = { ...PONTE_RUNTIME, ...PONTE_PROVA, ...PONTE_GATES };

export const ehPonte = (arquivo) => Object.hasOwn(PONTE, arquivo);
