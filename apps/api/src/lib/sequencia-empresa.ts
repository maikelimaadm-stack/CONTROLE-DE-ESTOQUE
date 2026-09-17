/**
 * CHAVE DA SEQUÊNCIA DE CÓDIGO DA EMPRESA — canônica desde a PRE-BASE2-05C-2.
 *
 * `erp.next_code(organização, entidade)` guarda o último valor em `erp.code_sequences`, com chave primária
 * `(organization_id, entity)`. A migration `0018_empresa_code_sequence.sql` RENOMEOU a chave persistida de
 * `'farm'` para `'empresa'` — um `update` que move a linha, preservando `organization_id` e `last_value`
 * exatamente. Esta constante é o par de runtime daquela migration: as duas TÊM de andar juntas, e é por
 * isso que a fatia inteira é um corte single-version.
 *
 * POR QUE A TROCA PRECISOU DE UMA FATIA PRÓPRIA — registro histórico, ainda verdadeiro
 * -----------------------------------------------------------------------------------
 * `'farm'` e `'empresa'` nunca foram dois rótulos do mesmo contador: são DUAS LINHAS, dois travamentos de
 * linha e dois valores correntes independentes. E `next_code` é um `insert ... on conflict do update`:
 * linha AUSENTE não dá erro, REINICIA EM 1. Disso decorrem as duas armadilhas que fecharam as saídas que
 * pareciam seguras, ambas MEDIDAS em `apps/api/test/integration/contador-empresa-transicao.test.ts`:
 *
 *   • COPIAR a linha e manter as duas ativas durante o rollout faz a API antiga e a API nova emitirem O
 *     MESMO próximo número; o segundo cadastro morre no `unique (organization_id, code)` de `erp.empresas`;
 *   • MOVER a linha enquanto a API antiga ainda serve deixa aquela versão sem contador:
 *     `next_code(org,'farm')` recria a linha em 1 e recomeça a numeração por cima do acervo.
 *
 * Não existe terceira opção, e nenhuma delas é resolvível no repositório: uma migration e um binário
 * implantado não compartilham transação, e o rollout não é instantâneo. "Mesmo slice" é uma afirmação
 * sobre o repositório; a atomicidade teria de ser sobre o AR, e ali ela é impossível.
 *
 * A CONSEQUÊNCIA, QUE VALE DEPOIS DO CUTOVER
 * ------------------------------------------
 * A 05C-2 NÃO torna a troca segura em rollout normal. Ela exigiu uma janela em que apenas UMA versão da
 * API estivesse servindo (`docs/PRE-BASE2-05C-2-CUTOVER.md`) — janela **realizada em 16/09/2026**: o
 * deployment ativo foi removido, o merge `935f9dc` entrou com zero réplicas servindo, a 0018 foi aplicada
 * uma única vez e a validação fechou (`entity='farm'` = 0, `entity='empresa'` = 1, `last_value`
 * preservado). O runbook registra a execução em § "Encerramento real — 16/09/2026".
 *
 * O cutover estar concluído NÃO torna o version skew seguro, e é por isso que o que vem abaixo continua
 * valendo como regra, não como histórico:
 *
 *   • a ÚNICA chave de runtime é `'empresa'`. Não existe fallback `farm || empresa`, e não deve existir:
 *     um fallback leria o contador errado em silêncio e devolveria um número já usado;
 *   • um binário ANTERIOR à 05C-2 contra um banco pós-0018 é um estado PROIBIDO, não degradado — ele
 *     recriaria `'farm'` em 1. A matriz de version skew da fatia prova os dois sentidos proibidos.
 *
 * Trocar esta linha de volta para `'farm'` sem mover a linha no banco reintroduz exatamente o defeito que
 * a fatia existe para eliminar — e o teste citado acima reprova quem tentar.
 */
export const SEQUENCIA_EMPRESA = "empresa";
