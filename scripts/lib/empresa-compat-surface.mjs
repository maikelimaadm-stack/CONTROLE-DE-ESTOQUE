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
  "apps/web/src/lib/api.ts": "Cliente HTTP: promove a sessão gravada com `farmId` e envia os dois cabeçalhos durante a janela de rollout.",
  "apps/web/src/lib/auth.tsx": "Lê `empresas ?? farms` de /auth/context enquanto a API anterior puder estar no ar.",
  "apps/web/nav.registry.mjs": "Redirecionamentos das rotas legadas de cadastro.",
  "packages/domain/src/resources/index.ts": "Chave de recurso legada `farms` resolvendo para o mesmo ResourceDef de `empresas`."
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
  "apps/web/e2e/empresa-compat.spec.ts": "Prova no navegador que sessão antiga e cabeçalho antigo continuam funcionando.",
  "apps/web/e2e/acesso-empresa.spec.ts": "Lê `empresas ?? farms` como o cliente durante o rollout."
};

/** Confinamento: os próprios gates e o dicionário precisam nomear o que vigiam. */
export const PONTE_GATES = {
  "scripts/farm-compat-allowlist.mjs": "O gate que confina a ponte: precisa citar cada símbolo legado para procurá-lo.",
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
