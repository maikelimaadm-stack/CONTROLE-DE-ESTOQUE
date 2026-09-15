/**
 * CHAVE DA SEQUÊNCIA DE CÓDIGO DA EMPRESA — legada de propósito, e a razão é aritmética.
 *
 * `erp.next_code(organização, entidade)` guarda o último valor em `erp.code_sequences`, com chave primária
 * `(organization_id, entity)`. Duas entidades diferentes são DOIS contadores independentes: dois travamentos
 * de linha, dois valores correntes, e nenhuma relação entre eles. Trocar esta constante para `'empresa'` sem
 * mover a linha faria o contador começar do zero — a próxima empresa receberia o código 1, que já existe.
 * Não é detalhe de nomenclatura: é a numeração do cadastro, visível ao usuário.
 *
 * O QUE ESTE COMENTÁRIO DIZIA E ESTAVA ERRADO (corrigido na PRE-BASE2-05C-0)
 * -------------------------------------------------------------------------
 * Ele prometia que a troca seria "ATÔMICA com o dado": `update erp.code_sequences set entity='empresa'` e a
 * mudança desta constante "no MESMO slice". Isso não existe. Uma migration e um binário implantado não
 * compartilham transação, e o rollout não é instantâneo — Railway e Vercel trocam de versão em momentos
 * diferentes, e durante a janela as DUAS versões da API atendem ao mesmo tempo. "Mesmo slice" é uma
 * afirmação sobre o repositório; a atomicidade teria de ser sobre o AR, e ali ela é impossível.
 *
 * As duas saídas que parecem seguras não são:
 *   • MOVER a linha (`update ... set entity='empresa'`) enquanto a API antiga ainda serve deixa aquela
 *     versão sem contador: `next_code(org,'farm')` recria a linha em 1 e recomeça a numeração;
 *   • COPIAR a linha e manter as duas faz os dois lados emitirem O MESMO próximo número, e o segundo
 *     cadastro morre no `unique (organization_id, code)` de `erp.empresas`.
 * As duas estão MEDIDAS, não argumentadas, em
 * `apps/api/test/integration/contador-empresa-transicao.test.ts`.
 *
 * POR ISSO A TROCA É UMA FATIA PRÓPRIA (PRE-BASE2-05C-2), E NÃO ACONTECE AQUI
 * --------------------------------------------------------------------------
 * A PRE-BASE2-05C-1 remove colunas; ela NÃO mexe neste contador, e esta constante segue `'farm'` depois
 * dela. A substituição do contador exige uma janela em que apenas UMA versão da API esteja servindo — um
 * gate operacional (drenar a versão anterior), não uma propriedade do código. Enquanto esse gate não for
 * decidido e executado pelo Maike, o nome antigo fica confinado neste arquivo, que existe exatamente para
 * isolá-lo do resto do runtime.
 *
 * Trocar esta linha sem esse gate é uma regressão de produção, não uma limpeza de nomenclatura — e o teste
 * citado acima reprova quem tentar.
 */
export const SEQUENCIA_EMPRESA = "farm";
