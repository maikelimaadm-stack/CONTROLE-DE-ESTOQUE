/**
 * OPERACOES-01 F5a (decisão 282) — A SEÇÃO "FLUXO" DO FORMATO 5 (`fluxo`, na raiz da configuração).
 *
 * O fluxo é a regra do CONSUMO de estoque: se ele precisa vir de uma requisição de material (não; em algum item; em
 * todos os itens) e se pode atender a requisição em parte. É do consumo e só dele (a requisição é a origem, e a
 * devolução de consumo sempre vem de um consumo).
 *
 * AS REGRAS QUE TRAVAM NASCEM DESLIGADAS (decisão 281, item (4) da 240): o neutro é o comportamento de hoje — o
 * consumo pode ser lançado direto (`exigeRequisicao: "nao"`) e atende a requisição em parte (`permiteParcial: true`).
 * Quem executa é a API, no lançamento do consumo (`recusasDoFluxoDoConsumo`).
 *
 * ARQUIVO FOLHA (regra 3 do ponto de extensão, `tipo-operacao-secoes-v5.ts`): importa só os TIPOS do ponto de
 * extensão e `estoque-documento.ts`. A família é PERGUNTADA ao registry pela espécie — nenhum código de família
 * escrito aqui. Só `import type` do ponto de extensão, pelo mesmo motivo de `tipo-operacao-secao-destino.ts` (o
 * ponto de extensão importa este arquivo; um valor importado de volta faria o ciclo existir em tempo de execução).
 */
import type { DefinicaoSecaoV5, LeitorDeSecaoTop } from "./tipo-operacao-secoes-v5.js";
import { familiaOperacionalDeDocumentoEstoque } from "./estoque-documento.js";

/** Se o consumo exige requisição de origem: não, em algum item, em todos os itens. */
export const EXIGENCIAS_REQUISICAO_TOP = ["nao", "algum_item", "todos"] as const;
export type ExigenciaRequisicaoTop = (typeof EXIGENCIAS_REQUISICAO_TOP)[number];

/** O rótulo de cada opção de "Exigir requisição" (editor e histórico). */
export const ROTULOS_EXIGENCIA_REQUISICAO_TOP: Readonly<Record<ExigenciaRequisicaoTop, string>> = Object.freeze({
  nao: "Não",
  algum_item: "Em algum item",
  todos: "Em todos os itens",
});

/** O valor da seção `fluxo`. */
export interface SecaoFluxoTop {
  /** O consumo precisa vir de uma requisição? `"nao"` (neutro) = o consumo pode ser lançado direto, como hoje. */
  exigeRequisicao: ExigenciaRequisicaoTop;
  /** O consumo pode atender a requisição em parte? `true` (neutro) = sim, como hoje. */
  permiteParcial: boolean;
}

/** O texto de ajuda da aba Fluxo no editor da TOP. */
const AJUDA_FLUXO =
  "O fluxo diz se o consumo precisa vir de uma requisição de material e se pode atender a requisição em parte. No padrão, o consumo pode ser lançado direto e atende em parte.";

export const SECAO_FLUXO: DefinicaoSecaoV5<"fluxo", SecaoFluxoTop> = Object.freeze({
  nome: "fluxo",
  rotulo: "Fluxo",
  ajuda: AJUDA_FLUXO,
  chaves: Object.freeze(["exigeRequisicao", "permiteParcial"] as const),
  neutro: (): SecaoFluxoTop => ({ exigeRequisicao: "nao", permiteParcial: true }),
  ler: (l: LeitorDeSecaoTop): SecaoFluxoTop => ({
    exigeRequisicao: l.enumerado("exigeRequisicao", EXIGENCIAS_REQUISICAO_TOP),
    permiteParcial: l.booleano("permiteParcial"),
  }),
  // As duas regras decidem sozinhas (o consumo direto ainda pode atender uma requisição, quando a informa): nada a
  // zerar. Cópia nova, que não aponta para a entrada.
  normalizar: (v: SecaoFluxoTop): SecaoFluxoTop => ({ exigeRequisicao: v.exigeRequisicao, permiteParcial: v.permiteParcial }),
  usadaPor: (familia: string): boolean => typeof familia === "string" && familiaOperacionalDeDocumentoEstoque("consumo") === familia,
  linhas: (v: SecaoFluxoTop): readonly (readonly [string, string])[] => [
    ["Exigir requisição", ROTULOS_EXIGENCIA_REQUISICAO_TOP[v.exigeRequisicao]],
    ["Atender requisição em parte", v.permiteParcial ? "Sim" : "Não"],
  ],
});

/** Uma recusa do fluxo do consumo: o caminho do 422 (`origem_documento_id`, `itens`, `itens.<i>.origem_item_id`) e a mensagem. */
export interface RecusaFluxoTop {
  readonly caminho: string;
  readonly mensagem: string;
}

/** O que o consumo é, para o fluxo: se aponta uma requisição, quais itens estão ligados a ela e se leva o saldo inteiro. */
export interface ConsumoParaFluxoTop {
  /** O cabeçalho aponta uma requisição de origem. */
  readonly temOrigem: boolean;
  /** Um por item do consumo, na ordem do corpo: o item aponta um item da requisição. */
  readonly ligados: readonly boolean[];
  /** O consumo leva o saldo pendente INTEIRO de todo item pendente da requisição. */
  readonly atendeTudo: boolean;
}

/**
 * O que a seção Fluxo da TOP recusa neste consumo (`[]` no neutro, sempre):
 *   · `algum_item` ou `todos` sem requisição de origem → `origem_documento_id`;
 *   · `algum_item` com origem e nenhum item ligado → `itens`;
 *   · `todos` com origem → cada item não ligado em `itens.<i>.origem_item_id`;
 *   · `permiteParcial` desligado, com origem, sem levar o saldo inteiro → `itens`.
 * Sem origem, só a primeira (não há requisição para conferir item nem parcial).
 */
export function recusasDoFluxoDoConsumo(secao: SecaoFluxoTop, c: ConsumoParaFluxoTop): RecusaFluxoTop[] {
  const recusas: RecusaFluxoTop[] = [];
  if (!c.temOrigem) {
    if (secao.exigeRequisicao !== "nao") {
      recusas.push({ caminho: "origem_documento_id", mensagem: "Esta operação exige requisição: informe a requisição de origem." });
    }
    return recusas;
  }
  if (secao.exigeRequisicao === "algum_item" && !c.ligados.some(Boolean)) {
    recusas.push({ caminho: "itens", mensagem: "Esta operação exige ao menos um item da requisição." });
  }
  if (secao.exigeRequisicao === "todos") {
    c.ligados.forEach((ligado, i) => {
      if (!ligado) recusas.push({ caminho: `itens.${i}.origem_item_id`, mensagem: "Esta operação exige que todo item venha da requisição." });
    });
  }
  if (!secao.permiteParcial && !c.atendeTudo) {
    recusas.push({
      caminho: "itens",
      mensagem: "Esta operação não atende requisição em parte: leve o saldo inteiro de todos os itens pendentes da requisição.",
    });
  }
  return recusas;
}
