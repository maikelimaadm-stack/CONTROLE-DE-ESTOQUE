/**
 * OPERACOES-01 F6a (decisão 283) — A SEÇÃO "DIVERGÊNCIA COM O PEDIDO" DO FORMATO 5 (`divergenciaPedido`, na raiz).
 *
 * Na COMPRA recebida de um pedido, compara cada item com o pedido: o preço unitário líquido (por linha) e a
 * quantidade (por item do pedido, contra o saldo antes desta compra). Três modos:
 *   · Nenhuma — o neutro, o comportamento de hoje: não compara;
 *   · Avisar  — a prévia da confirmação mostra a divergência; a compra confirma;
 *   · Bloquear — a compra com divergência ACIMA da tolerância não é confirmada (`DIVERGENCIA_COM_O_PEDIDO`, 409).
 * As tolerâncias são percentuais em TEXTO DECIMAL (0 a 100, até duas casas, ponto como separador) — `decimal.js`
 * no código, string no JSON; nunca ponto flutuante. A conta mora em `compras-finalizacao-orcamento.ts`.
 *
 * ARQUIVO FOLHA (regra 3 do ponto de extensão): importa só os TIPOS de `tipo-operacao-secoes-v5.ts` (nunca um
 * valor: o ponto de extensão importa este arquivo, e um valor faria o ciclo existir em tempo de execução — ver o
 * cabeçalho de `tipo-operacao-secao-fluxo-compra.ts`) e `tipo-operacao-configurado.ts`. A família é perguntada ao
 * registry pela espécie (`familia-operacional-ssot-audit`).
 */
import type { DefinicaoSecaoV5, LeitorDeSecaoTop } from "./tipo-operacao-secoes-v5.js";
import { familiaOperacionalDeDocumentoCompra } from "./tipo-operacao-configurado.js";

/** Os modos, na ordem da tela. `nenhuma` é o neutro. */
export const MODOS_DIVERGENCIA_PEDIDO = ["nenhuma", "avisa", "bloqueia"] as const;
export type ModoDivergenciaPedido = (typeof MODOS_DIVERGENCIA_PEDIDO)[number];

/** O rótulo de cada modo (editor, histórico). Um dono só: o web lê daqui. */
export const ROTULOS_MODO_DIVERGENCIA_PEDIDO: Readonly<Record<ModoDivergenciaPedido, string>> =
  Object.freeze({ nenhuma: "Nenhuma", avisa: "Avisar", bloqueia: "Bloquear" });

/** O teto das duas tolerâncias, em texto decimal (100%). */
export const TOLERANCIA_MAXIMA_DIVERGENCIA_PEDIDO = "100";

/** As casas decimais aceitas nas tolerâncias. */
export const CASAS_TOLERANCIA_DIVERGENCIA_PEDIDO = 2;

/** O valor da seção `divergenciaPedido`. */
export interface DivergenciaPedidoTop {
  modo: ModoDivergenciaPedido;
  /** Tolerância do preço unitário líquido, em %, texto decimal de "0" a "100". */
  toleranciaPrecoPercentual: string;
  /** Tolerância da quantidade contra o saldo do pedido, em %, texto decimal de "0" a "100". */
  toleranciaQuantidadePercentual: string;
}

export const SECAO_DIVERGENCIA_PEDIDO: DefinicaoSecaoV5<"divergenciaPedido", DivergenciaPedidoTop> = Object.freeze({
  nome: "divergenciaPedido",
  rotulo: "Divergência com o pedido",
  ajuda: "Na compra recebida de um pedido, compara cada item com o pedido: o preço unitário líquido e a quantidade (contra o saldo do pedido). Nenhuma: não compara, como hoje. Avisar: a prévia da confirmação mostra a divergência. Bloquear: a compra com divergência acima da tolerância não é confirmada. Tolerância em %, de 0 a 100, com ponto como separador decimal.",
  chaves: ["modo", "toleranciaPrecoPercentual", "toleranciaQuantidadePercentual"],
  neutro: (): DivergenciaPedidoTop => ({ modo: "nenhuma", toleranciaPrecoPercentual: "0", toleranciaQuantidadePercentual: "0" }),
  ler: (l: LeitorDeSecaoTop): DivergenciaPedidoTop => ({
    modo: l.enumerado("modo", MODOS_DIVERGENCIA_PEDIDO),
    toleranciaPrecoPercentual: l.decimal("toleranciaPrecoPercentual", CASAS_TOLERANCIA_DIVERGENCIA_PEDIDO, TOLERANCIA_MAXIMA_DIVERGENCIA_PEDIDO),
    toleranciaQuantidadePercentual: l.decimal("toleranciaQuantidadePercentual", CASAS_TOLERANCIA_DIVERGENCIA_PEDIDO, TOLERANCIA_MAXIMA_DIVERGENCIA_PEDIDO),
  }),
  // Zera o que não decide nada: sem comparação, as tolerâncias voltam a "0". Não reformata o decimal digitado.
  normalizar: (v: DivergenciaPedidoTop): DivergenciaPedidoTop =>
    v.modo === "nenhuma"
      ? { modo: "nenhuma", toleranciaPrecoPercentual: "0", toleranciaQuantidadePercentual: "0" }
      : { ...v },
  usadaPor: (familia: string): boolean => familiaOperacionalDeDocumentoCompra("compra") === familia,
  linhas: (v: DivergenciaPedidoTop) => [
    ["Divergência com o pedido", ROTULOS_MODO_DIVERGENCIA_PEDIDO[v.modo]],
    ["Tolerância de preço", `${v.toleranciaPrecoPercentual}%`],
    ["Tolerância de quantidade", `${v.toleranciaQuantidadePercentual}%`],
  ] as const,
});
