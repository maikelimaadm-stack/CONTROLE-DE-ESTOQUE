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
 * rollback de binário continua correto contra o banco pós-0019 — **de UM passo**, até o runtime da 05C-2.
 * A fronteira é literal: um binário anterior àquele cutover pede `next_code(org,'farm')` para o código de
 * Empresa, chave que a 0018 apagou, e `docs/DEPLOYMENT.md` já registra que voltar até lá exige migration
 * nova, não redeploy. Este hotfix não muda essa política forward-only; ele só garante o passo dele.
 *
 * E o ROLLBACK DE BANCO não é redeploy: a 0019 apaga linha de contador e substitui função, então restaurar
 * um backup pré-0019 com o binário novo no ar recria as chaves em 1 sobre acervo numerado. O caminho de
 * volta escrito está em `docs/DEPLOYMENT.md`, e é forward-only.
 *
 * A CHAVE LEGADA É SOBRECARREGADA — E POR ISSO ELA CONTINUA SENDO A CHAVE DAS DUAS ROTAS
 * -------------------------------------------------------------------------------------
 * `'farm_transfer'` não pertence só a esta tabela: `erp.animal_movements`, que tem namespace PRÓPRIO
 * (`unique (organization_id, movement_type, code)`), numera com a MESMA chave.
 *
 * A tentação é separar as duas agora. Uma rodada anterior desta fatia fez isso — deu ao rebanho um
 * contador `animal_farm_transfer` — e a auditoria externa mostrou que INTRODUZ UMA CORRIDA no rolling
 * deploy: o binário anterior pede a chave legada (aliasada para ESTE contador) e o novo pediria o próprio;
 * são LINHAS DIFERENTES, sem trava em comum, emitindo o MESMO número para `erp.animal_movements`. Um
 * `select` de "já existe?" não fecha isso — é TOCTOU contra transação não commitada — e os dois contadores
 * nascem no mesmo baseline, então a colisão cai no primeiro par concorrente.
 *
 * Por isso, enquanto o alias existir, as DUAS rotas pedem a MESMA chave: `erp.next_code` é
 * `insert ... on conflict do update`, a linha do contador é travada, e as transações SERIALIZAM nela.
 * Medido com duas conexões e barreiras reais no quadrante C de `pnpm gate:0019`, que também REPRODUZ a
 * corrida da arquitetura abandonada para que o quadrante tenha dentes.
 *
 * Consequências aceitas e declaradas: (a) a numeração de rebanho fica intercalada com a de estoque, com
 * lacuna nas duas — lacuna é normal no contrato, colisão não é; (b) como este contador grava nas DUAS
 * tabelas, o baseline da 0019 inclui o `max(code)` de ambas, com pós-condição própria. A separação do
 * contador de rebanho é o cleanup da fatia que REMOVE o alias.
 *
 * QUEM REPROVA QUEM VOLTAR ATRÁS — e por que NÃO é o teste de integração
 * ---------------------------------------------------------------------
 * MEDIDO, não deduzido: com a rota sabotada de volta para
 * `d.kind === "farm" ? "farm_transfer" : "warehouse_transfer"`,
 * `apps/api/test/integration/transferencia-numeracao.test.ts` continua 11/11 VERDE — a suíte INTEIRA,
 * sem um único caso reprovando.
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
