/**
 * OPERACOES-01 F6a (decisão 283) — A SEÇÃO "FLUXO DE COMPRA" DO FORMATO 5 (`fluxoCompra`, na raiz da configuração).
 *
 * Uma regra só, a do PEDIDO DE COMPRA: "exigir pedido finalizado para receber". Com Sim, o Receber da Central de
 * Compras só aceita o pedido FINALIZADO (a finalização é a confirmação do pedido e, quando a TOP exige aprovação,
 * passa por ela); com Não — o neutro, o comportamento de hoje —, o pedido aberto ou finalizado é recebido. A
 * aprovação do pedido vale ao FINALIZAR: com Não, o pedido aberto é recebido sem ela — por isso a ajuda o diz por
 * extenso (quem liga só a aprovação precisa saber que o Receber não a cobra; a regra que a cobra é esta).
 *
 * Quem executa é a API (o receber lê a versão congelada da TOP do pedido por `fluxoCompraDaVersaoTop`); o banco
 * aceita receber de aberto e de finalizado. A regra nasce DESLIGADA em toda TOP (decisão 281, item (4) da 240).
 *
 * ARQUIVO FOLHA (regra 3 do ponto de extensão, `tipo-operacao-secoes-v5.ts`): importa só os TIPOS do ponto de
 * extensão e `tipo-operacao-configurado.ts` (que lê o registry e não importa a configuração). A família é PERGUNTADA
 * ao registry pela espécie — nenhum código de família escrito aqui (`familia-operacional-ssot-audit`).
 *
 * SÓ TIPOS DO PONTO DE EXTENSÃO, E NÃO `definirSecaoV5`, DE PROPÓSITO: o ponto de extensão importa ESTE arquivo
 * para montar `DEFINICOES_SECOES_V5`. Se este arquivo importasse dele um VALOR, o ciclo existiria em tempo de
 * execução, e quem fosse avaliado primeiro leria o outro ainda não inicializado (`definirSecaoV5` ou esta
 * constante, conforme a ordem dos imports) — um erro que depende de quem importa o quê primeiro. Com `import type`
 * o ciclo some na compilação. O congelamento é o mesmo de `definirSecaoV5` (`Object.freeze`), o nome é o literal
 * do tipo, e o teste de contrato (`top-formato5.test.ts`, F5-D1) recusa nome reservado.
 */
import type { DefinicaoSecaoV5, LeitorDeSecaoTop } from "./tipo-operacao-secoes-v5.js";
import { familiaOperacionalDeDocumentoCompra } from "./tipo-operacao-configurado.js";

/** O valor da seção `fluxoCompra`. */
export interface FluxoCompraTop {
  /** O Receber exige o pedido finalizado? `false` (neutro) = o pedido aberto também é recebido, como hoje. */
  exigeFinalizar: boolean;
}

export const SECAO_FLUXO_COMPRA: DefinicaoSecaoV5<"fluxoCompra", FluxoCompraTop> = Object.freeze({
  nome: "fluxoCompra",
  rotulo: "Fluxo de compra",
  ajuda: "Exigir pedido finalizado para receber: com Sim, o pedido só é recebido depois de finalizado (e, se esta TOP exige aprovação, aprovado). Com Não, o pedido aberto ou finalizado é recebido, como hoje — e o aberto é recebido sem passar pela aprovação desta TOP, que só vale ao finalizar.",
  chaves: ["exigeFinalizar"],
  neutro: (): FluxoCompraTop => ({ exigeFinalizar: false }),
  ler: (l: LeitorDeSecaoTop): FluxoCompraTop => ({ exigeFinalizar: l.booleano("exigeFinalizar") }),
  normalizar: (v: FluxoCompraTop): FluxoCompraTop => ({ exigeFinalizar: v.exigeFinalizar }),
  usadaPor: (familia: string): boolean => familiaOperacionalDeDocumentoCompra("pedido") === familia,
  linhas: (v: FluxoCompraTop) => [["Exigir pedido finalizado para receber", v.exigeFinalizar ? "Sim" : "Não"]] as const,
});
