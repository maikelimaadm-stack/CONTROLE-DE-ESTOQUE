/**
 * CHAVE DA SEQUÊNCIA DE CÓDIGO DA TRANSFERÊNCIA DE REBANHO ENTRE EMPRESAS — canônica desde a 0019.
 *
 * POR QUE ESTE ARQUIVO EXISTE, E POR QUE ELE NASCE JUNTO COM O HOTFIX DE TRANSFERÊNCIA DE ESTOQUE
 * ---------------------------------------------------------------------------------------------
 * `'farm_transfer'` era uma chave SOBRECARREGADA: DUAS tabelas diferentes, com namespaces de unicidade
 * diferentes, pediam o MESMO contador a `erp.next_code`:
 *
 *   erp.warehouse_transfers   unique (organization_id, code)                 rota POST /stock/transfers
 *   erp.animal_movements      unique (organization_id, movement_type, code)  rota POST /livestock/transfers/to-farm
 *
 * Isso não produzia colisão — um contador só sobe, e as duas tabelas são distintas —, mas sobrecarregava
 * um nome. E o hotfix 0019 transforma essa sobrecarga em problema REAL, porque ele faz `erp.next_code`
 * CANONICALIZAR `'farm_transfer'` para `'warehouse_transfer'`. Um alias não sabe quem chamou: sem esta
 * separação, a numeração do REBANHO passaria a sair do contador de ESTOQUE, os dois documentos
 * intercalariam números, e a linha legada — que é o contador do rebanho — seria apagada pela migration.
 *
 * Ou seja: separar esta chave não é escopo extra, é PRÉ-REQUISITO do alias. Sem ela o hotfix consertaria
 * a numeração de uma tabela quebrando a de outra.
 *
 * O NOME SEGUE A CONVENÇÃO QUE A PRÓPRIA ROTA JÁ USA
 * -------------------------------------------------
 * `apps/api/src/routes/livestock.ts` numera movimentação de rebanho com `animal_<tipo>`:
 * `animal_${d.movement_type}` na porta genérica, `animal_batch_transfer` na transferência entre lotes.
 * A transferência entre empresas era a ÚNICA que pedia a chave nua `'farm_transfer'` — uma inconsistência
 * anterior a esta fatia, e exatamente a que criou a sobrecarga. `'animal_farm_transfer'` é o que a
 * convenção já dizia que o nome deveria ser.
 *
 * O QUE A MIGRATION FAZ COM O HISTÓRICO
 * -------------------------------------
 * A linha legada `'farm_transfer'` carrega o histórico COMPARTILHADO das duas tabelas. A 0019 a divide:
 * o valor entra no baseline do contador de estoque E no desta chave, cada um combinado com o `max(code)`
 * da SUA tabela. Contador que só sobe e lacuna são normais; emitir número já ocupado não é.
 *
 * RISCO RESIDUAL DECLARADO (janela de rolling deploy) — E AS DUAS CORREÇÕES QUE ELE EXIGIU
 * ---------------------------------------------------------------------------------------
 * O binário BASE pede `'farm_transfer'` para as DUAS rotas, e o alias só pode acertar uma — ele acerta a
 * de ESTOQUE, que é o assunto do hotfix. Durante a janela, uma transferência de rebanho atendida pelo
 * binário anterior recebe número do contador de estoque e grava NESTA tabela. A primeira redação desta
 * seção afirmava duas garantias que o código não dava; as duas viraram correção, não prosa:
 *
 *  (1) "ela comita em segurança, por construção" era FALSO. O baseline do contador de estoque (seção 6.1
 *      da 0019) não olhava o acervo de rebanho: bastava uma organização com o contador legado atrás do
 *      acervo — restauração parcial, importação — para a primeira criação da janela colidir de imediato.
 *      Agora `max(erp.animal_movements.code)` entra no `greatest`, e a pós-condição 8.5 cobra a
 *      invariante em vez de confiar nela.
 *
 *  (2) "um 409 que se resolve na tentativa seguinte" era FALSO. `erp.next_code` e o `insert` rodam na
 *      MESMA transação: a violação de unicidade desfaz o incremento junto, a tentativa seguinte aloca
 *      exatamente o mesmo número, e a rota ficaria MORTA naquela organização. Daí a alocação desta rota
 *      passar por `codigoDeMovimento`, que pula código já ocupado dentro da própria transação —
 *      travamento vira LACUNA, que o contrato trata como normal.
 *
 * Com as duas, o que sobra é apenas a lacuna. Medido em `packages/db/test/hotfix-0019-upgrade.test.ts`,
 * casos 23 a 25 — o 25 reproduz o travamento contra o banco e mostra o laço resolvendo.
 */
export const SEQUENCIA_ANIMAL_FARM_TRANSFER = "animal_farm_transfer";
