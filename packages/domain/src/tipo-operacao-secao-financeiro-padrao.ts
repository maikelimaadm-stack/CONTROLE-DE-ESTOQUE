/**
 * OPERACOES-01 F9 (decisão 286) — A SEÇÃO "PADRÕES FINANCEIROS" DO FORMATO 5 (`financeiroPadrao`, na raiz).
 *
 * POR QUE `financeiroPadrao` E NÃO `financeiro`: `financeiro` é chave RESERVADA (`CHAVES_RAIZ_RESERVADAS_TOP`) — é a
 * seção de hoje, que diz se a operação gera a pagar, a receber ou nada, e continua dizendo. Uma seção de extensão com
 * esse nome não compila (`definirSecaoV5` torna o nome `never`) e reescreveria a de hoje com outro leitor. "Gera a
 * pagar, a receber ou nada" continua em `financeiro.atualizacao`; as condições de pagamento permitidas continuam na
 * lista da versão (0033).
 *
 * A SEÇÃO GUARDA SÓ REGRAS, NENHUM UUID (regra 4 do ponto de extensão):
 *   · `provisao` — o pedido gera títulos PREVISTOS (`financeiro-provisao.ts`); só onde a família provisiona;
 *   · `documentoTroca` — o documento pode informar natureza, centro, tipo de título, forma ou conta DIFERENTES dos
 *     padrões da TOP (desligado → a troca é recusada com `mensagemDosPadroesTrocados`);
 *   · `semClassificacao` — sem natureza e centro no documento nem na TOP: o padrão legado de hoje (a 1ª natureza e o
 *     1º centro por código) ou EXIGIR (recusa).
 * Os padrões em si (natureza, centro, tipo de título, forma e conta) moram na tabela da versão,
 * `erp.tipos_operacao_versao_financeiro` (0045), lidos e gravados pela API.
 *
 * A REGRA QUE TRAVA NASCE DESLIGADA (decisão 281, item (4) da 240): o neutro é o comportamento de hoje — nenhuma
 * provisão e o documento decide (sem natureza e centro, cada família faz o que faz hoje: a 1ª por código onde a regra
 * vale; a compra e o pedido de compra recusam, porque não têm padrão legado). Só uma versão no formato 5 executa a
 * seção; nos formatos 1 a 4 ela é lida no neutro (`secoesExtensaoDaVersaoTop`).
 *
 * ARQUIVO FOLHA (regra 3 do ponto de extensão, `tipo-operacao-secoes-v5.ts`): importa só os TIPOS do ponto de
 * extensão e `financeiro-padroes.ts` (que lê o registry e não importa a configuração). Nenhum código de família
 * escrito aqui: o perfil de cada família sai de `perfilDosPadroesFinanceiros` (`familia-operacional-ssot-audit`).
 *
 * SÓ TIPOS DO PONTO DE EXTENSÃO, E NÃO `definirSecaoV5`, DE PROPÓSITO (o molde da F5a e da F6a): o ponto de extensão
 * importa ESTE arquivo para montar `DEFINICOES_SECOES_V5`; um VALOR importado de volta faria o ciclo existir em tempo
 * de execução, e quem fosse avaliado primeiro leria o outro ainda não inicializado. Com `import type` o ciclo some na
 * compilação. O congelamento é o mesmo de `definirSecaoV5` (`Object.freeze`), o nome é o literal do tipo, e o teste
 * de contrato (`top-formato5.test.ts`, F5-D1) recusa nome reservado.
 */
import type { DefinicaoSecaoV5, LeitorDeSecaoTop } from "./tipo-operacao-secoes-v5.js";
import {
  SEM_CLASSIFICACAO_TOP,
  familiaUsaPadroesFinanceiros,
  perfilDosPadroesFinanceiros,
  type SemClassificacaoTop,
} from "./financeiro-padroes.js";

/** O valor da seção `financeiroPadrao`. */
export interface SecaoFinanceiroPadrao {
  provisao: boolean;
  documentoTroca: boolean;
  semClassificacao: SemClassificacaoTop;
}

/** O rótulo de cada opção de `semClassificacao` (editor e histórico). */
export const ROTULOS_SEM_CLASSIFICACAO_TOP: Readonly<Record<SemClassificacaoTop, string>> = Object.freeze({
  padrao_legado: "Usar a 1ª natureza e o 1º centro por código (como hoje)",
  exigir: "Exigir natureza e centro (do documento ou desta TOP)",
});

/** O texto de ajuda da aba "Padrões financeiros" no editor da TOP. */
export const AJUDA_FINANCEIRO_PADRAO =
  "Provisão e padrões do lançamento financeiro desta operação. Tudo nasce desligado: sem padrão, o documento decide, como hoje.";

const simOuNao = (v: boolean): string => (v ? "Sim" : "Não");

export const SECAO_FINANCEIRO_PADRAO: DefinicaoSecaoV5<"financeiroPadrao", SecaoFinanceiroPadrao> = Object.freeze({
  nome: "financeiroPadrao",
  rotulo: "Padrões financeiros",
  ajuda: AJUDA_FINANCEIRO_PADRAO,
  chaves: Object.freeze(["provisao", "documentoTroca", "semClassificacao"] as const),
  neutro: (): SecaoFinanceiroPadrao => ({ provisao: false, documentoTroca: true, semClassificacao: "padrao_legado" }),
  ler: (l: LeitorDeSecaoTop): SecaoFinanceiroPadrao => ({
    provisao: l.booleano("provisao"),
    documentoTroca: l.booleano("documentoTroca"),
    semClassificacao: l.enumerado("semClassificacao", SEM_CLASSIFICACAO_TOP),
  }),
  // Cada campo decide sozinho: nada a zerar. Cópia nova, que não aponta para a entrada.
  normalizar: (v: SecaoFinanceiroPadrao): SecaoFinanceiroPadrao => ({
    provisao: v.provisao,
    documentoTroca: v.documentoTroca,
    semClassificacao: v.semClassificacao,
  }),
  usadaPor: (familia: string): boolean => typeof familia === "string" && familiaUsaPadroesFinanceiros(familia),
  linhas: (v: SecaoFinanceiroPadrao): readonly (readonly [string, string])[] => [
    ["Provisionar no pedido", simOuNao(v.provisao)],
    ["O documento troca os padrões", simOuNao(v.documentoTroca)],
    ["Sem natureza e centro", ROTULOS_SEM_CLASSIFICACAO_TOP[v.semClassificacao]],
  ],
});

/** 422 — provisão ligada numa família que não provisiona (hoje, o pedido de venda e o de compra provisionam). */
export const MENSAGEM_PROVISAO_FORA_DA_FAMILIA = "A provisão vale só no pedido de venda e no pedido de compra.";

/** 422 — "exigir" numa família cujo lançamento sempre informa natureza e centro (o avulso, o movimento). */
export const MENSAGEM_EXIGIR_FORA_DA_FAMILIA =
  `O lançamento desta operação sempre informa natureza e centro: deixe "${ROTULOS_SEM_CLASSIFICACAO_TOP.padrao_legado}".`;

/** Uma recusa da seção, no formato das recusas do perfil (`{motivo, caminho, mensagem}`). */
export interface RecusaFinanceiroPadraoTop {
  motivo: "combinacao_nao_suportada";
  caminho: string;
  mensagem: string;
}

/**
 * O que a FAMÍLIA não aceita nesta seção, campo a campo (a recusa 422 da gravação do formato 5), na ordem dos campos:
 *   · `provisao` ligada sem provisão executável na família → `financeiroPadrao.provisao`;
 *   · `semClassificacao = "exigir"` numa família sem a regra → `financeiroPadrao.semClassificacao`.
 * Família que não usa a seção → `[]` (a recusa da seção inteira fora do neutro é do catálogo, `recusasDoPerfilTop`).
 */
export function recusasDoFinanceiroPadraoDaFamilia(familia: string, v: SecaoFinanceiroPadrao): RecusaFinanceiroPadraoTop[] {
  const perfil = perfilDosPadroesFinanceiros(familia);
  if (!perfil) return [];
  const recusas: RecusaFinanceiroPadraoTop[] = [];
  if (v.provisao && !perfil.provisao) {
    recusas.push({ motivo: "combinacao_nao_suportada", caminho: "financeiroPadrao.provisao", mensagem: MENSAGEM_PROVISAO_FORA_DA_FAMILIA });
  }
  if (v.semClassificacao === "exigir" && !perfil.semClassificacao) {
    recusas.push({ motivo: "combinacao_nao_suportada", caminho: "financeiroPadrao.semClassificacao", mensagem: MENSAGEM_EXIGIR_FORA_DA_FAMILIA });
  }
  return recusas;
}
