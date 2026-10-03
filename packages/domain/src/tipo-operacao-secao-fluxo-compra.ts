/**
 * OPERACOES-01 F6a (decisão 283) — A SEÇÃO "FLUXO DE COMPRA" DO FORMATO 5 (`fluxoCompra`, na raiz da configuração).
 *
 * Uma regra só, a do PEDIDO DE COMPRA: "exigir pedido finalizado para receber". Com Sim, o Receber da Central de
 * Compras só aceita o pedido FINALIZADO (a finalização é a confirmação do pedido e, quando a TOP exige aprovação,
 * passa por ela); com Não — o neutro, o comportamento de hoje —, o pedido aberto ou finalizado é recebido. A
 * aprovação do pedido vale ao FINALIZAR, e por isso anda JUNTO com esta regra (o par, abaixo): uma sem a outra, o pedido
 * aberto seria recebido sem passar pela aprovação, ou o finalizar não teria aprovação a cobrar.
 *
 * Quem executa é a API (o receber lê a versão congelada da TOP do pedido por `fluxoCompraDaVersaoTop`); o banco
 * aceita receber de aberto e de finalizado. A regra nasce DESLIGADA em toda TOP (decisão 281, item (4) da 240).
 *
 * O PAR (decisão do Maike de 03/10, decisão 283): no formato 5, a aprovação do pedido de compra (que vale ao finalizar)
 * e "Exigir pedido finalizado para receber" andam JUNTAS, nos dois sentidos — a configuração com uma sem a outra é
 * recusada. A recusa é da GRAVAÇÃO (`recusasDoFluxoCompraDaFamilia`, a 422 da API e a conferência local do editor, com
 * o mesmo texto); a LEITURA não muda: uma versão já gravada (formatos 1 a 4, lidos no neutro — "sem aprovação" e "sem
 * exigir", que andam juntas —, ou um 5 anterior a esta regra) nunca passa a ser recusada por ela.
 *
 * ARQUIVO FOLHA (regra 3 do ponto de extensão, `tipo-operacao-secoes-v5.ts`): importa só os TIPOS do ponto de
 * extensão e da configuração (`PoliticaAprovacao`) e `tipo-operacao-configurado.ts` (que lê o registry e não importa a
 * configuração). A família é PERGUNTADA
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
import type { PoliticaAprovacao } from "./tipo-operacao-configuracao.js";
import { familiaOperacionalDeDocumentoCompra } from "./tipo-operacao-configurado.js";

/** O valor da seção `fluxoCompra`. */
export interface FluxoCompraTop {
  /** O Receber exige o pedido finalizado? `false` (neutro) = o pedido aberto também é recebido, como hoje. */
  exigeFinalizar: boolean;
}

/**
 * O texto de ajuda da aba "Fluxo de compra" — diz que a aprovação e esta regra andam juntas (decisão do Maike, 03/10).
 */
export const AJUDA_FLUXO_COMPRA =
  "Exigir pedido finalizado para receber: com Sim, o pedido só é recebido depois de finalizado e aprovado. Com Não, o pedido aberto ou finalizado é recebido, como hoje. Esta regra anda junto com a aprovação do pedido (aba Aprovação), que vale ao finalizar: com aprovação ela é Sim, sem aprovação ela é Não — ligar ou desligar a aprovação liga ou desliga esta regra.";

export const SECAO_FLUXO_COMPRA: DefinicaoSecaoV5<"fluxoCompra", FluxoCompraTop> = Object.freeze({
  nome: "fluxoCompra",
  rotulo: "Fluxo de compra",
  ajuda: AJUDA_FLUXO_COMPRA,
  chaves: ["exigeFinalizar"],
  neutro: (): FluxoCompraTop => ({ exigeFinalizar: false }),
  ler: (l: LeitorDeSecaoTop): FluxoCompraTop => ({ exigeFinalizar: l.booleano("exigeFinalizar") }),
  normalizar: (v: FluxoCompraTop): FluxoCompraTop => ({ exigeFinalizar: v.exigeFinalizar }),
  usadaPor: (familia: string): boolean => familiaOperacionalDeDocumentoCompra("pedido") === familia,
  linhas: (v: FluxoCompraTop) => [["Exigir pedido finalizado para receber", v.exigeFinalizar ? "Sim" : "Não"]] as const,
});

/** 422 — o par (decisão do Maike, 03/10): o pedido de compra com aprovação sem "Exigir pedido finalizado para receber". */
export const MENSAGEM_APROVACAO_EXIGE_PEDIDO_FINALIZADO =
  "Com aprovação, o pedido de compra só é recebido depois de finalizado: \"Exigir pedido finalizado para receber\" tem de ser Sim. As duas andam juntas.";

/** 422 — o par, o lado inverso: "Exigir pedido finalizado para receber" sem aprovação do pedido. */
export const MENSAGEM_EXIGE_FINALIZADO_SEM_APROVACAO =
  "\"Exigir pedido finalizado para receber\" só vale com aprovação do pedido: escolha o critério de aprovação ou deixe a regra em Não. As duas andam juntas.";

/** Os caminhos das recusas do par: cada uma no campo que FALTA ligar (a aba dele abre no editor). */
export const CAMINHO_EXIGE_FINALIZAR = "fluxoCompra.exigeFinalizar";
export const CAMINHO_POLITICA_APROVACAO = "aprovacao.politica";

/** Uma recusa da seção, no formato das recusas do perfil (`{motivo, caminho, mensagem}`). */
export interface RecusaFluxoCompraTop {
  motivo: "combinacao_nao_suportada";
  caminho: string;
  mensagem: string;
}

/**
 * O PAR NA GRAVAÇÃO DO FORMATO 5 (decisão do Maike de 03/10, decisão 283), só no pedido de compra — uma sem a outra é
 * recusada, cada uma no campo que FALTA ligar:
 *   · aprovação (Sempre ou A partir de um valor — vale ao finalizar) sem "exigir" → `fluxoCompra.exigeFinalizar`;
 *   · "exigir" sem aprovação → `aprovacao.politica`.
 * Quem chama só pergunta no formato 5 (a API em `conferirFiscalDaFamilia`, o editor antes de enviar); outra família, ou
 * as duas juntas (ligadas ou desligadas) → `[]`.
 */
export function recusasDoFluxoCompraDaFamilia(familia: string, politicaAprovacao: PoliticaAprovacao, v: FluxoCompraTop): RecusaFluxoCompraTop[] {
  if (!SECAO_FLUXO_COMPRA.usadaPor(familia)) return [];
  const comAprovacao = politicaAprovacao !== "nenhuma";
  if (comAprovacao === v.exigeFinalizar) return [];
  return comAprovacao
    ? [{ motivo: "combinacao_nao_suportada", caminho: CAMINHO_EXIGE_FINALIZAR, mensagem: MENSAGEM_APROVACAO_EXIGE_PEDIDO_FINALIZADO }]
    : [{ motivo: "combinacao_nao_suportada", caminho: CAMINHO_POLITICA_APROVACAO, mensagem: MENSAGEM_EXIGE_FINALIZADO_SEM_APROVACAO }];
}

/**
 * O EDITOR LIGA AS DUAS JUNTAS: o valor da seção depois de a aprovação passar a `politicaAprovacao`. No pedido de compra,
 * a regra acompanha a aprovação — ligada → Sim, desligada → Não (entre Sempre e A partir de um valor, Sim continua).
 * Outra família → o valor como estava. Cópia nova, que não aponta para a entrada.
 */
export function fluxoCompraComAAprovacao(familia: string, politicaAprovacao: PoliticaAprovacao, v: FluxoCompraTop): FluxoCompraTop {
  return { exigeFinalizar: SECAO_FLUXO_COMPRA.usadaPor(familia) ? politicaAprovacao !== "nenhuma" : v.exigeFinalizar };
}
