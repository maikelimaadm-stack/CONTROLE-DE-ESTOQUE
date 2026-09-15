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
export const FASE_ESPELHO = "dual";

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
 * uma migration atômica. Por isso continuam declarados, com o motivo à vista.
 */
export const PONTE_RUNTIME = {
  "apps/api/src/lib/contrato-legado.ts": "CONTRATO NEGATIVO (não é tradutor): nomeia o cabeçalho, os campos e o formato administrativo anteriores para RECUSÁ-LOS com erro de validação. Existe porque `z.object` descarta chave desconhecida — um `farm_id` ignorado em silêncio mudaria a empresa da operação. Sai depois da 05C, e só com tráfego real observado.",
  "apps/web/nav.registry.mjs": "Redirecionamentos das rotas legadas de cadastro — navegação de favoritos do usuário, não protocolo de API. Ficam até a 05C."
};

/** Prova: testes que só valem porque falam o idioma antigo — se a ponte quebrar, eles quebram antes do cliente. */
export const PONTE_PROVA = {
  "apps/api/test/integration/contrato-empresa.test.ts": "Prova o CONTRATO NEGATIVO com requisições reais: cabeçalho, corpo, query, recurso e entidade de anexo anteriores são recusados — e o canônico funciona. Cita o nome antigo para provar que ele NÃO é aceito.",
  "apps/api/test/unit/attachment-parent-guard.test.ts": "Prova que o nome ANTERIOR de tabela não resolve mais como entidade anexável.",
  "packages/plataforma/test/sessao-empresa.test.ts": "Prova que a sessão gravada por um cliente anterior à virada canônica é INVÁLIDA (sem promoção) e que o contrato de valor é exigido.",
  "packages/db/test/empresa-compat.test.ts": "PONTE FÍSICA: mede gatilhos de espelho, divergência recusada e a view `erp.farms` — objetos que a 05C-1 remove. Sai JUNTO com eles, na mesma fatia, nunca antes.",
  "packages/db/test/backfill-empresas.test.ts": "PROVA HISTÓRICA: o backfill de `farm_id` → `empresa_id`, linha a linha. Continua sendo a evidência de que um acervo anterior é carregado corretamente — o passado não muda quando a coluna sai. NÃO sai na 05C-1.",
  "packages/db/test/backfill-owner-restrito.test.ts": "PROVA HISTÓRICA: a conversão do escopo herdado de `erp.member_farms`, que é o estado real de quem veio de antes. NÃO sai na 05C-1.",
  "packages/db/test/responsavel-tenant.test.ts": "PONTE FÍSICA: consulta pela view de nome antigo para provar que ela enxerga o mesmo tenant. Sai junto com a view, na 05C-1.",
  "packages/db/test/notificacao-legado.test.ts": "PONTE FÍSICA: prova que a notificação legada resolve pela view de nome antigo. Sai junto com a view, na 05C-1.",
  "packages/db/test/schema.test.ts": "PONTE FÍSICA: afere a COEXISTÊNCIA das duas colunas. Na 05C-1 ele não é apagado e sim INVERTIDO — passa a exigir que a legada não exista —, junto com FASE_ESPELHO.",
  "packages/db/test/upgrade-acervo.test.ts": "PROVA HISTÓRICA: escreve o histórico no idioma ANTERIOR (`farm_id`), como a API antiga gravava, e só então aplica as migrations. Falar o idioma novo aqui inventaria um acervo que nunca existiu — e apagar o teste na 05C-1 removeria a única prova de que o banco de um cliente REAL sobe. NÃO sai; será ESTENDIDO na 05C-1 para atravessar também a purga.",
  "packages/db/test/upgrade-rollback.test.ts": "PROVA HISTÓRICA: mesmo acervo legado, para provar que uma falha depois da janela estrutural devolve o ledger protegido. NÃO sai; será ESTENDIDO na 05C-1 para cobrir a falha DURANTE a purga.",
  "apps/web/e2e/empresa-canonica.spec.ts": "Cutover canônico medido no navegador: cita o nome antigo para provar que ele NÃO sai no fio e que a sessão anterior não é mais promovida.",
  "apps/web/e2e/skew-api-producao.spec.ts": "Version skew SENTIDO 1 (web deste HEAD × API da base): cita o nome antigo para provar que ele NÃO sai do cliente canônico.",
  "apps/web/e2e/skew-web-anterior.spec.ts": "Version skew SENTIDO 2 (web da base × API deste HEAD): cita o nome antigo para provar que a API nova o RECUSA — e que o cliente em produção não depende dele."
};


/** Confinamento: os próprios gates e o dicionário precisam nomear o que vigiam. */
export const PONTE_GATES = {
  "scripts/farm-compat-allowlist.mjs": "O gate que confina o que resta: precisa citar cada símbolo legado para procurá-lo. É ELE o guardrail do servidor canônico — o que não estiver declarado aqui reprova.",
  "apps/web/scripts/empresa-canonica-audit.mjs": "A catraca do cliente canônico (PRE-BASE2-05A): precisa citar cada símbolo legado para PROIBI-LO no web produtivo. Sem o tradutor de fio, um nome legado que voltasse ao cliente não quebraria em runtime — a API bilíngue aceitaria —, e é esta lista que o pega.",
  "scripts/lib/empresa-compat-surface.mjs": "Esta lista.",
  "scripts/company-schema-sync.mjs": "Confere par a par coluna canônica × coluna legada no schema.",
  "scripts/member-farms-audit.mjs": "Impede que `erp.member_farms` volte a ser autoridade de runtime.",
  "scripts/data-dictionary.mjs": "Gera o dicionário, que documenta a coluna legada enquanto ela existir.",
  "packages/domain/dicionario-dados.mjs": "Dicionário de dados: `erp.farms` e `farm_id` existem no banco e precisam estar documentados.",
  "packages/domain/empresa-rls.mjs": "Classificação de RLS: nomeia o arquivo morto de `erp.member_farms`.",
  "scripts/purchase-responsible-audit.mjs": "Mensagem de diagnóstico do gate cita a assinatura anterior."
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
  "packages/plataforma/test/sessao-empresa.test.ts": "TOMBSTONE",
  "packages/db/test/empresa-compat.test.ts": "PONTE_FISICA",
  "packages/db/test/backfill-empresas.test.ts": "PROVA_HISTORICA",
  "packages/db/test/backfill-owner-restrito.test.ts": "PROVA_HISTORICA",
  "packages/db/test/responsavel-tenant.test.ts": "PONTE_FISICA",
  "packages/db/test/notificacao-legado.test.ts": "PONTE_FISICA",
  "packages/db/test/schema.test.ts": "PONTE_FISICA",
  "packages/db/test/upgrade-acervo.test.ts": "PROVA_HISTORICA",
  "packages/db/test/upgrade-rollback.test.ts": "PROVA_HISTORICA",
  "apps/web/e2e/empresa-canonica.spec.ts": "TOMBSTONE",
  "apps/web/e2e/skew-api-producao.spec.ts": "TOMBSTONE",
  "apps/web/e2e/skew-web-anterior.spec.ts": "TOMBSTONE",
  "scripts/farm-compat-allowlist.mjs": "VOCABULARIO",
  "apps/web/scripts/empresa-canonica-audit.mjs": "VOCABULARIO",
  "scripts/lib/empresa-compat-surface.mjs": "VOCABULARIO",
  "scripts/company-schema-sync.mjs": "VOCABULARIO",
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
