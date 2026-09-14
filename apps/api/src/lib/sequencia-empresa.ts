/**
 * CHAVE DA SEQUÊNCIA DE CÓDIGO DA EMPRESA — legada de propósito, e a razão é aritmética.
 *
 * `erp.next_code(organização, entidade)` guarda o último valor em `erp.code_sequences`, com chave primária
 * `(organization_id, entity)`. Duas entidades diferentes são DOIS contadores independentes. Trocar esta
 * constante para `'empresa'` sem migrar a linha faria o contador começar do zero: a próxima empresa
 * cadastrada receberia o código 1, que já existe. Não é um detalhe de nomenclatura — é a numeração do
 * cadastro, visível ao usuário e usada como identidade.
 *
 * Por isso ela NÃO muda em PRE-BASE2-05B, que não toca no banco. A troca é da PRE-BASE2-05C, e precisa ser
 * ATÔMICA com o dado: `update erp.code_sequences set entity='empresa' ...` e a mudança desta constante no
 * MESMO slice. Enquanto isso, o nome antigo fica confinado neste arquivo — que existe só para isolá-lo do
 * resto do runtime, agora que o adaptador de borda foi apagado.
 *
 * TEMPORÁRIO ATÉ PRE-BASE2-05C.
 */
export const SEQUENCIA_EMPRESA = "farm";
