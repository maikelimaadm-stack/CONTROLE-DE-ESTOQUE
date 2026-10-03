import { ESPECIES_COM_DESTINO_PELA_TOP, especieDeOrigemEstoque, type EspecieEstoque } from "@agro/domain";

/**
 * A FORMA DE CADA ESPÉCIE NA CENTRAL DE ESTOQUE (OPERACOES-01 F5b, decisão 282) — pura: nada de React, nada de API.
 *
 * É a régua da API (`conferirFormaDaEspecie` e `recusasDaFormaDaMovimentacaoInterna`, em
 * `apps/api/src/routes/estoque-documentos.ts` e `estoque-movimentacao-interna.ts`) vista pela tela: o que cada espécie
 * informa no corpo do POST. A tela não decide nada que o servidor não decida igual — ela só não oferece o campo que o
 * contrato recusaria, e cobra antes o que ele cobraria.
 *
 * | espécie       | quantidade         | custo (com MI / sem) | lote | validade | destino local | origem               | destino informado | motivo |
 * |---------------|--------------------|----------------------|------|----------|---------------|----------------------|-------------------|--------|
 * | entrada       | quantidade         | opcional / obrigat.  | sim  | sim      | —             | —                    | —                 | —      |
 * | saída         | quantidade         | —                    | sim  | —        | —             | —                    | sim (MI)          | sim (MI) |
 * | transferência | quantidade         | —                    | sim  | —        | sim           | —                    | —                 | —      |
 * | ajuste        | quantidade_contada | opcional / —         | sim  | sim      | —             | —                    | —                 | —      |
 * | requisição    | quantidade         | —                    | —    | —        | —             | —                    | sim               | —      |
 * | consumo       | quantidade         | —                    | sim  | —        | —             | requisição (opcional) | sim (herda)      | —      |
 * | devolução     | quantidade         | —                    | sim  | sim      | —             | consumo (obrigatória) | — (copiado)      | —      |
 *
 * "MI" é a capacidade `movimentacaoInterna` que a API declara no `operation-types` (F5a). Sem ela (a API de antes, no
 * skew sentido 1) o corpo é exatamente o de antes: custo OBRIGATÓRIO na entrada, ajuste SEM custo, e nada de destino,
 * motivo ou origem. As três espécies novas só existem com ela (sem ela, a rota delas nem responde).
 *
 * A espécie de origem e as espécies cujo destino se informa são PERGUNTADAS ao domínio (`especieDeOrigemEstoque`,
 * `ESPECIES_COM_DESTINO_PELA_TOP`), nunca escritas aqui.
 */
export interface FormaDaEspecieNaCentral {
  readonly especie: EspecieEstoque;
  /** A chave da quantidade no item do corpo: a contada, no ajuste. */
  readonly campoDaQuantidade: "quantidade" | "quantidade_contada";
  /** O mínimo da quantidade (o ajuste conta zero; as outras movem algo). */
  readonly minimoDaQuantidade: "positivo" | "naoNegativo";
  /** A mensagem da quantidade vazia — a mesma da API. */
  readonly faltaQuantidade: string;
  /** O custo unitário do item: obrigatório (a entrada sem MI), opcional (entrada e ajuste com MI) ou nenhum. */
  readonly custo: "obrigatorio" | "opcional" | "nenhum";
  readonly lote: boolean;
  readonly validade: boolean;
  /** O Local de estoque de destino (só a transferência). */
  readonly localDeDestino: boolean;
  /** A espécie do documento de origem (consumo ← requisição; devolução de consumo ← consumo), ou `null`. */
  readonly origem: EspecieEstoque | null;
  /** A origem é obrigatória (a devolução de consumo); a do consumo depende da seção Fluxo da TOP. */
  readonly origemObrigatoria: boolean;
  /** O destino se INFORMA nesta espécie (pela seção Destino da TOP). */
  readonly destinoInformado: boolean;
  /** O destino da origem é HERDADO (o consumo herda o da requisição). */
  readonly destinoHerdado: boolean;
  /** Motivo e justificativa da saída. */
  readonly motivoDaSaida: boolean;
  /** O sentido da pesquisa de produto: na saída, só com saldo no local. */
  readonly pesquisaDeProduto: "entrada" | "saida";
  /** O que a coluna Estoque mostra: o físico, ou o disponível (a régua da confirmação da requisição). */
  readonly colunaDoEstoque: "fisico" | "disponivel";
}

/** O que não depende da capacidade, por espécie. O compilador cobra as sete (`Record<EspecieEstoque, …>`). */
const BASE: Readonly<Record<EspecieEstoque, { lote: boolean; validade: boolean; sentido: "entrada" | "saida"; disponivel: boolean }>> = Object.freeze({
  entrada: { lote: true, validade: true, sentido: "entrada", disponivel: false },
  saida: { lote: true, validade: false, sentido: "saida", disponivel: false },
  transferencia: { lote: true, validade: false, sentido: "saida", disponivel: false },
  ajuste: { lote: true, validade: true, sentido: "entrada", disponivel: false },
  requisicao: { lote: false, validade: false, sentido: "saida", disponivel: true },
  consumo: { lote: true, validade: false, sentido: "saida", disponivel: false },
  devolucao_consumo: { lote: true, validade: true, sentido: "entrada", disponivel: false }
});

/** O custo do item por espécie e capacidade (a régua de `conferirFormaDaEspecie`). */
function custoDa(especie: EspecieEstoque, mi: boolean): FormaDaEspecieNaCentral["custo"] {
  if (especie === "entrada") return mi ? "opcional" : "obrigatorio";
  if (especie === "ajuste") return mi ? "opcional" : "nenhum";
  return "nenhum";
}

export function formaDaEspecieNaCentral(especie: EspecieEstoque, comMovimentacaoInterna: boolean): FormaDaEspecieNaCentral {
  const mi = comMovimentacaoInterna;
  const b = BASE[especie];
  const origem = mi ? especieDeOrigemEstoque(especie) : null;
  const ajuste = especie === "ajuste";
  return Object.freeze({
    especie,
    campoDaQuantidade: ajuste ? "quantidade_contada" : "quantidade",
    minimoDaQuantidade: ajuste ? "naoNegativo" : "positivo",
    faltaQuantidade: ajuste ? "Informe a quantidade contada" : "Informe a quantidade",
    custo: custoDa(especie, mi),
    lote: b.lote,
    validade: b.validade,
    localDeDestino: especie === "transferencia",
    origem,
    // a devolução de consumo SEMPRE vem de um consumo (a API exige); o consumo direto é permitido no neutro do Fluxo
    origemObrigatoria: origem !== null && especie === "devolucao_consumo",
    destinoInformado: mi && ESPECIES_COM_DESTINO_PELA_TOP.includes(especie),
    destinoHerdado: mi && especie === "consumo",
    motivoDaSaida: mi && especie === "saida",
    pesquisaDeProduto: b.sentido,
    colunaDoEstoque: b.disponivel ? "disponivel" : "fisico"
  });
}
