/**
 * CHAVE DA SEQUÊNCIA DE CÓDIGO DA TRANSFERÊNCIA DE ESTOQUE — canônica e ÚNICA desde o hotfix 0019.
 *
 * `erp.warehouse_transfers` tem `unique (organization_id, code)`. A unicidade NÃO inclui `kind`, logo
 * existe UM namespace de código por organização para a tabela inteira — e o contador tem de acompanhar
 * o NAMESPACE DE UNICIDADE, não a variante funcional.
 *
 * O DEFEITO QUE ESTA CONSTANTE ELIMINA
 * ------------------------------------
 * Até o hotfix, a rota numerava com duas chaves:
 *
 *   kind = 'warehouse' -> next_code(org, 'warehouse_transfer')
 *   kind = 'farm'      -> next_code(org, 'farm_transfer')
 *
 * `erp.code_sequences` tem PK `(organization_id, entity)`: duas chaves são DUAS LINHAS, com dois
 * `last_value` independentes. Os dois começam em 1 e sobem sozinhos, então os dois emitem `0001` para a
 * MESMA coluna com unicidade compartilhada. A segunda variante criada numa organização morria no
 * `unique (organization_id, code)` com 409 — e numa organização nova isso acontecia logo no primeiro
 * documento da segunda variante, quebrando justamente a transferência ENTRE EMPRESAS.
 *
 * POR QUE NÃO É O MESMO CASO DE `SEQUENCIA_EMPRESA`
 * ------------------------------------------------
 * A 05C-2 precisou de uma janela single-version porque não havia como o banco servir os dois binários:
 * a chave `'farm'` e a chave `'empresa'` eram contadores diferentes, e qualquer ordem de rollout deixava
 * uma das versões lendo o contador errado.
 *
 * Aqui a compatibilidade mora no BANCO. A `0019` faz `erp.next_code` CANONICALIZAR `'farm_transfer'`
 * para `'warehouse_transfer'`: o binário anterior pede a chave antiga e recebe número do contador
 * canônico, sem criar linha legada nova. Por isso este hotfix roda em AUTODEPLOY NORMAL, e por isso o
 * rollback de binário continua correto contra o banco pós-0019.
 *
 * A CHAVE LEGADA ERA SOBRECARREGADA — E POR ISSO O ALIAS SOZINHO NÃO BASTAVA
 * -------------------------------------------------------------------------
 * `'farm_transfer'` não pertencia só a esta tabela: `erp.animal_movements`, que tem namespace PRÓPRIO
 * (`unique (organization_id, movement_type, code)`), numerava com a MESMA chave. Um alias não sabe quem
 * chamou, então canonicalizar sem mais nada mandaria a numeração do REBANHO para este contador e a
 * migration apagaria a linha que era o contador do rebanho — o hotfix consertaria uma tabela quebrando
 * outra. A 0019 divide o histórico compartilhado nas duas chaves canônicas antes de apagar a legada, e a
 * do rebanho mora em `sequencia-transferencia-rebanho.ts`, com o resíduo de janela declarado lá.
 *
 * QUEM REPROVA QUEM VOLTAR ATRÁS — e por que NÃO é o teste de integração
 * ---------------------------------------------------------------------
 * MEDIDO, não deduzido: com a rota sabotada de volta para
 * `d.kind === "farm" ? "farm_transfer" : "warehouse_transfer"`,
 * `apps/api/test/integration/transferencia-numeracao.test.ts` continua 9/9 VERDE.
 *
 * Isso não é falha do teste: é o ALIAS funcionando. A 0019 faz `erp.next_code` canonicalizar
 * `farm_transfer` antes do `insert`, então pedir a chave antiga e pedir a canônica produzem exatamente as
 * mesmas linhas — mesmo contador, mesmo número, nenhuma linha legada. É justamente essa
 * indistinguibilidade que torna o rolling deploy e o rollback de binário seguros, e ela vale para o
 * binário BASE e para uma regressão da rota igualmente: nenhum experimento de comportamento separa os dois.
 *
 * Logo o gate contra a regressão da ROTA tem de ser ESTÁTICO, e é `scripts/sequencia-namespace-audit.mjs`
 * (encadeado no `pnpm lint`): ele lê o argumento de entidade de cada `nextCode` e reprova numeração
 * derivada de variante que não esteja declarada com o discriminador dentro da UNIQUE. Verificado contra a
 * mesma sabotagem: reprova com saída nomeando `apps/api/src/routes/stock.ts:379`.
 *
 * A divisão de trabalho, então: o teste de integração prova o SISTEMA (banco + rota) correto pela porta
 * real; o auditor estático prova a ROTA correta. Nenhum dos dois substitui o outro, e o dia em que o alias
 * sair — fatia própria, quando não houver mais versão viva pedindo a chave antiga — é o auditor estático
 * que garante que a rota já estava certa antes de a rede sumir.
 *
 * O que esta constante NÃO é: um framework de sequências. É uma chave, com o motivo ao lado — mesmo
 * molde de `sequencia-empresa.ts`. A TOP continua tendo DUAS operações
 * (`estoque.transferencia_entre_armazens` e `estoque.transferencia_entre_empresas`): classificar e
 * numerar são coisas diferentes, e o hotfix não toca na primeira.
 */
export const SEQUENCIA_WAREHOUSE_TRANSFER = "warehouse_transfer";
