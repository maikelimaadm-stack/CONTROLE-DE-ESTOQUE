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

/** Marco em que a ponte inteira deve ser removida (nenhum arquivo abaixo sobrevive a ele). */
/** Marco em que o que resta deve ser removido (nenhum arquivo abaixo sobrevive a ele). */
export const MARCO_DE_REMOCAO = "PRE-BASE2-05C (purga física: colunas legadas, view erp.farms, gatilhos de espelho e a chave da sequência)";

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
  "packages/db/test/empresa-compat.test.ts": "Prova o espelho no banco: gatilhos, divergência recusada, view `erp.farms` com security_invoker. FÍSICO: sai na 05C.",
  "packages/db/test/backfill-empresas.test.ts": "Prova o backfill de `farm_id` → `empresa_id` linha a linha. FÍSICO: sai na 05C.",
  "packages/db/test/backfill-owner-restrito.test.ts": "Prova a conversão do escopo herdado de `erp.member_farms`. FÍSICO: sai na 05C.",
  "packages/db/test/responsavel-tenant.test.ts": "Consulta pela view legada para provar que ela enxerga o mesmo tenant. FÍSICO: sai na 05C.",
  "packages/db/test/notificacao-legado.test.ts": "Prova que a notificação legada continua resolvendo pela view. FÍSICO: sai na 05C.",
  "packages/db/test/schema.test.ts": "Afere a coexistência das duas colunas no schema real. FÍSICO: sai na 05C.",
  "packages/db/test/upgrade-acervo.test.ts": "Upgrade com acervo: escreve o histórico no idioma ANTERIOR (`farm_id`), como a API antiga gravava, e só então aplica 0014→0016. Falar o idioma novo aqui inventaria um acervo que nunca existiu. FÍSICO: sai na 05C.",
  "packages/db/test/upgrade-rollback.test.ts": "Mesmo acervo legado, para provar que uma falha depois da janela estrutural da 0014 devolve o ledger protegido. FÍSICO: sai na 05C.",
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

/** Tudo que pode falar o idioma antigo, com motivo. Fora daqui, nome legado é dívida de produto. */
export const PONTE = { ...PONTE_RUNTIME, ...PONTE_PROVA, ...PONTE_GATES };

export const ehPonte = (arquivo) => Object.hasOwn(PONTE, arquivo);
