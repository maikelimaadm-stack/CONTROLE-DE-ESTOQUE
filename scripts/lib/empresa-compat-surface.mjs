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
export const MARCO_DE_REMOCAO = "PRE-BASE2-05 (remoção da compatibilidade: colunas legadas, views e cabeçalho)";

/** Runtime: o que o servidor e o navegador precisam FALAR para não quebrar o binário anterior. */
export const PONTE_RUNTIME = {
  "apps/api/src/lib/compat-empresa.ts": "O adaptador. É a ponte inteira: tradução de entrada, apelidos de saída, cabeçalho e nomes legados de tabela.",
  "apps/api/src/server.ts": "Declara `X-Farm-Id` em allowedHeaders do CORS — sem isso o navegador do cliente antigo nem envia o cabeçalho.",
  "apps/api/src/lib/escopo-admin.ts": "Borda de administração: traduz o contrato legado `farm_ids` (lista vazia = todas) para o modelo canônico. Documentado em docs/MULTI-COMPANY-CONTRACT.md §6.",
  "apps/web/nav.registry.mjs": "Redirecionamentos das rotas legadas de cadastro.",
  "packages/domain/src/resources/index.ts": "Chave de recurso legada `farms` resolvendo para o mesmo ResourceDef de `empresas`.",
  "packages/plataforma/src/sessao-empresa.ts": "PROMOÇÃO DE SESSÃO (PRE-BASE2-05A): a única leitura que ainda conhece `farmId`, para migrar uma vez a sessão gravada no navegador por uma versão anterior e regravá-la canônica. Isolada aqui de propósito, para ser testável sem navegador e removível num arquivo só em PRE-BASE2-05B."
};

/** Prova: testes que só valem porque falam o idioma antigo — se a ponte quebrar, eles quebram antes do cliente. */
export const PONTE_PROVA = {
  "apps/api/test/integration/compat-empresa.test.ts": "Prova a tradução de borda: payload legado entra, resposta sai com os dois nomes, valores divergentes falham em 422.",
  "apps/api/test/unit/empresa-bridge.test.ts": "Prova o adaptador isoladamente (tabela de apelidos, formas id/texto/lista, valores opacos).",
  "apps/api/test/integration/api.test.ts": "Suíte geral escrita no idioma anterior (`farm_id`, `x-farm-id`): é a prova de version-skew de que o cliente antigo continua servido sem alteração.",
  "apps/api/test/integration/farm-scope.test.ts": "Escopo por empresa exercitado pelo contrato anterior (cabeçalho e coluna legados).",
  "apps/api/test/unit/farm-scope-guard.test.ts": "Guarda de escopo verificada pelos nomes anteriores.",
  "apps/api/test/integration/setup.ts": "Semeadura das suítes que ainda inserem pelo nome legado.",
  "packages/db/test/empresa-compat.test.ts": "Prova o espelho no banco: gatilhos, divergência recusada, view `erp.farms` com security_invoker.",
  "packages/db/test/backfill-empresas.test.ts": "Prova o backfill de `farm_id` → `empresa_id` linha a linha.",
  "packages/db/test/backfill-owner-restrito.test.ts": "Prova a conversão do escopo herdado de `erp.member_farms`.",
  "packages/db/test/responsavel-tenant.test.ts": "Consulta pela view legada para provar que ela enxerga o mesmo tenant.",
  "packages/db/test/notificacao-legado.test.ts": "Prova que a notificação legada continua resolvendo pela view.",
  "packages/db/test/schema.test.ts": "Afere a coexistência das duas colunas no schema real.",
  "packages/db/test/upgrade-acervo.test.ts": "Upgrade com acervo: escreve o histórico no idioma ANTERIOR (`farm_id`), como a API antiga gravava, e só então aplica 0014→0016. Falar o idioma novo aqui inventaria um acervo que nunca existiu e o teste deixaria de provar a migração.",
  "packages/db/test/upgrade-rollback.test.ts": "Mesmo acervo legado, para provar que uma falha depois da janela estrutural da 0014 devolve o ledger protegido.",
  "apps/web/e2e/empresa-canonica.spec.ts": "Cutover canônico medido no navegador: cita o nome antigo para provar que ele NÃO sai mais no fio e que a sessão gravada por uma versão anterior migra uma vez.",
  "apps/web/e2e/acesso-empresa.spec.ts": "Fixture da matriz de acesso; cita o nome antigo ao montar o estado da tela.",
  "apps/web/e2e/skew-api-producao.spec.ts": "Version skew no navegador: web desta PR contra a API EXATA do commit base (a que está no ar). Cita o nome antigo para PROVAR a sua ausência no fio e para verificar que o servidor segue bilíngue até a 05B.",
  "packages/plataforma/test/sessao-empresa.test.ts": "Prova a promoção da sessão gravada por uma versão anterior: `farmId` vira `empresaId` uma vez, a chave legada sai do armazenamento e valores divergentes caem em fail-safe."
};

/** Confinamento: os próprios gates e o dicionário precisam nomear o que vigiam. */
export const PONTE_GATES = {
  "scripts/farm-compat-allowlist.mjs": "O gate que confina a ponte: precisa citar cada símbolo legado para procurá-lo.",
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
