/**
 * OPERACOES-01 F2 (decisão 279) — AS REGRAS GERAIS QUE A CENTRAL PRECISA SABER ANTES DE SALVAR.
 *
 * A Central de Vendas e a de Compras perguntam, pela TOP escolhida, duas coisas que mudam a tela: se o documento se
 * CONFIRMA SOZINHO ao salvar (o botão vira "Salvar e confirmar") e se ele ACEITA SALVAR SEM ITENS (a pendência "ao
 * menos um item" deixa de bloquear). As duas respostas viajam em `regrasGerais`, a última chave de
 * `/regras-da-operacao` (vendas e compras) e do `regras` de `GET <base>/:id/edicao` da venda.
 *
 * A MESMA RÉGUA DA GRAVAÇÃO, sem segunda conta: o valor sai de `regrasGeraisDaVersaoTop` — a função que o POST, o
 * PUT/PATCH e o receber usam para decidir (`confirmaAutomaticamente` em `lib/confirmacao-automatica.ts`,
 * `aceitaSemItens` em `sales.ts`, `topQueAceitaSemItens` em `compras.ts`). Por isso o corte do formato (só o 4
 * executa; o 1 a 3 com "Automática" declarada é neutro) e o que vier depois dele (a F4 estende a função ao formato 5)
 * valem aqui sem uma linha a mais. Nunca se compara `configuracao_schema_version` neste caminho.
 *
 * SEM VERSÃO, FORMATO 1 A 3 OU ILEGÍVEL → O NEUTRO `{ false, false }`: nesses casos a gravação também não confirma e
 * recusa itens vazios, e o neutro é exatamente a Central de hoje ("Salvar", "ao menos um item").
 *
 * A VARIANTE É DE QUEM CHAMA (`regrasGeraisDaVariante`): a função do domínio responde só pela VERSÃO, e os handlers
 * servem a várias variantes. Orçamento, pedido de venda e pedido de compra nunca executam regra geral — o POST deles
 * não confirma nem aceita itens vazios (`kind !== "sale"` / `especie !== "compra"` na gravação) —, então a resposta
 * delas é sempre o neutro, qualquer que seja a versão. Cada rota passa a MESMA condição que a sua gravação usa.
 *
 * Módulo puro: só importa `@agro/domain`. Toda função devolve um objeto NOVO (quem recebe pode espalhar ou mudar sem
 * tocar no de outra resposta).
 */
import { regrasGeraisDaVersaoTop } from "@agro/domain";

/** O bloco `regrasGerais` das regras da operação. Tudo `false` = o comportamento de hoje. */
export interface RegrasGeraisDaCentral {
  /** A gravação deste documento tenta confirmá-lo no fim (TOP no formato 4 com "Confirmação: Automática"). */
  confirmacaoAutomatica: boolean;
  /** A gravação aceita o documento sem itens (TOP no formato 4 com "Documento sem itens: Permitido"). */
  aceitaSemItens: boolean;
}

/** O neutro: não confirma ao salvar, exige ao menos um item. Um objeto novo a cada chamada. */
export const regrasGeraisNeutrasDaCentral = (): RegrasGeraisDaCentral => ({ confirmacaoAutomatica: false, aceitaSemItens: false });

/**
 * As regras gerais da versão lida COMO GRAVADA, pela MESMA função da gravação (`regrasGeraisDaVersaoTop`). Sem versão
 * (`null`), formato 1 a 3 ou ilegível (`ok: false`) → o neutro.
 */
export function regrasGeraisDaCentral(versao: { codigoBase: string; configuracao: unknown } | null): RegrasGeraisDaCentral {
  const r = regrasGeraisDaVersaoTop(versao);
  if (!r.ok) return regrasGeraisNeutrasDaCentral();
  return { confirmacaoAutomatica: r.regras.confirmacaoAutomatica, aceitaSemItens: r.regras.aceitaSemItens };
}

/**
 * O que a VARIANTE da porta executa: `executa` falso (orçamento, pedido de venda, pedido de compra) → sempre o neutro,
 * a MESMA régua do POST; verdadeiro (venda, compra) → as regras lidas, numa cópia.
 */
export function regrasGeraisDaVariante(lidas: RegrasGeraisDaCentral, executa: boolean): RegrasGeraisDaCentral {
  if (!executa) return regrasGeraisNeutrasDaCentral();
  return { confirmacaoAutomatica: lidas.confirmacaoAutomatica, aceitaSemItens: lidas.aceitaSemItens };
}
