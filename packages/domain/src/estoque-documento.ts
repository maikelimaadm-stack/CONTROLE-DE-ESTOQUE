/**
 * ESTOQUE-01 (decisão 274) — O DOCUMENTO DE ESTOQUE NO DOMÍNIO.
 *
 * O Portal de Estoque ganha o mesmo desenho dos portais de Vendas e de Compras: um documento único
 * (`erp.documentos_estoque`), com TOP obrigatória, em quatro espécies. Este arquivo é o vocabulário que a API,
 * a tela e os testes compartilham — e nada mais. Ele NÃO move estoque: quem confirma é a rota, pelo
 * `stock-core` de sempre; aqui só se diz o que cada espécie é, que movimento ela produz e como um número
 * chega à API.
 *
 * As famílias (`estoque.entrada`, …) NÃO estão escritas aqui: moram no registry (`tipo-operacao.ts`), como
 * variantes de `erp.documentos_estoque` pela coluna `especie`, e as funções deste arquivo PERGUNTAM ao
 * registry. Um mapa espécie → família escrito à mão funcionaria hoje e mentiria na primeira família nova
 * (`familia-operacional-ssot-audit`).
 */
import { ENUM_LABELS } from "./labels.js";
import { resolverTipoOperacao, tipoOperacao } from "./tipo-operacao.js";

/** As espécies do documento de estoque, como o banco as persiste (`chk_documentos_estoque_especie`, 0040). */
export type EspecieEstoque = "entrada" | "saida" | "transferencia" | "ajuste";

/** As quatro espécies, na ordem em que a tela as oferece. */
export const ESPECIES_DOCUMENTO_ESTOQUE: readonly EspecieEstoque[] = Object.freeze(["entrada", "saida", "transferencia", "ajuste"] as const);

/** O segmento de URL de cada espécie (`/api/estoque/<segmento>`, `/estoque/movimentacoes/<segmento>/…`). */
export type SegmentoEstoque = "entradas" | "saidas" | "transferencias" | "ajustes";

/** A TABELA que o Portal de Estoque lança — o endereço no registry, não uma lista de famílias. */
export const TABELA_DOCUMENTO_ESTOQUE = "erp.documentos_estoque";

/** As situações do documento (`erp.documentos_estoque.situacao`). Cancelado é final; nada volta. */
export type SituacaoDocumentoEstoque = "aberto" | "confirmado" | "cancelado";
export const SITUACOES_DOCUMENTO_ESTOQUE: readonly SituacaoDocumentoEstoque[] = Object.freeze(["aberto", "confirmado", "cancelado"] as const);

export const SEGMENTO_DA_ESPECIE_ESTOQUE: Readonly<Record<EspecieEstoque, SegmentoEstoque>> = Object.freeze({
  entrada: "entradas",
  saida: "saidas",
  transferencia: "transferencias",
  ajuste: "ajustes"
});

/**
 * A espécie de um segmento de URL. Segmento desconhecido → `undefined`, e quem chama responde "não encontrado".
 * Só propriedade PRÓPRIA do mapa: `"constructor"` ou `"__proto__"` vindos da URL nunca viram espécie.
 */
export function especieDoSegmentoEstoque(segmento: string): EspecieEstoque | undefined {
  if (typeof segmento !== "string") return undefined;
  return ESPECIES_DOCUMENTO_ESTOQUE.find((e) => SEGMENTO_DA_ESPECIE_ESTOQUE[e] === segmento);
}

/**
 * O recurso de permissão de cada espécie. Um recurso por espécie, como no documento de compra: quem pode
 * lançar entrada não pode, por isso, acertar o inventário. Confirmar e cancelar exigem `<recurso>.edit`.
 */
export const RECURSO_DA_ESPECIE_ESTOQUE: Readonly<Record<EspecieEstoque, "entradas_estoque" | "saidas_estoque" | "transferencias_estoque" | "ajustes_estoque">> = Object.freeze({
  entrada: "entradas_estoque",
  saida: "saidas_estoque",
  transferencia: "transferencias_estoque",
  ajuste: "ajustes_estoque"
});

/** O rótulo curto da espécie — lido do dono dos rótulos de enum (`labels.ts`), nunca escrito duas vezes. */
export const ROTULO_DA_ESPECIE_ESTOQUE: Readonly<Record<EspecieEstoque, string>> = Object.freeze({
  entrada: ENUM_LABELS.especie_documento_estoque.entrada,
  saida: ENUM_LABELS.especie_documento_estoque.saida,
  transferencia: ENUM_LABELS.especie_documento_estoque.transferencia,
  ajuste: ENUM_LABELS.especie_documento_estoque.ajuste
});

/**
 * A família canônica que um documento de estoque de determinada espécie É — perguntada ao registry, nunca
 * escrita aqui. Espécie desconhecida, vazia ou ausente → `undefined` (fail-closed: a rota recusa, não
 * escolhe uma família vizinha).
 */
export function familiaOperacionalDeDocumentoEstoque(especie: string): string | undefined {
  return resolverTipoOperacao(TABELA_DOCUMENTO_ESTOQUE, especie)?.codigo;
}

/**
 * A família é uma das do documento de estoque? É a pergunta do editor da TOP: só nelas a seção Estoque diz
 * "o movimento é definido pela espécie" e o financeiro, o fiscal e o cliente em atraso ficam escondidos.
 * As oito famílias antigas de estoque respondem `false` — continuam presas às telas antigas.
 */
export function ehFamiliaDeDocumentoEstoque(codigoBase: string): boolean {
  return typeof codigoBase === "string" && tipoOperacao(codigoBase)?.origem.tabela === TABELA_DOCUMENTO_ESTOQUE;
}

/**
 * O movimento de estoque que cada espécie produz ao ser CONFIRMADA — tipos que JÁ existem no `check` de
 * `erp.stock_movements` (0003); o ledger não muda nem recebe TOP. Estorno é sempre `reversal`.
 *   · entrada → `entry`;
 *   · saída → `writeoff`;
 *   · transferência → `transfer_out` na origem e `transfer_in` no destino, com o mesmo custo e lote;
 *   · ajuste → `correction_in` (contou mais) ou `correction_out` (contou menos); diferença zero não move nada.
 * A execução configurada da TOP NÃO vale para estas famílias nesta fatia: o movimento é o da ESPÉCIE.
 */
export const MOVIMENTOS_DA_ESPECIE_ESTOQUE: Readonly<Record<EspecieEstoque, readonly string[]>> = Object.freeze({
  entrada: Object.freeze(["entry"]),
  saida: Object.freeze(["writeoff"]),
  transferencia: Object.freeze(["transfer_out", "transfer_in"]),
  ajuste: Object.freeze(["correction_in", "correction_out"])
});

// ─────────────── números ───────────────

/** O limite de uma coluna numérica: casas decimais e dígitos inteiros (precisão − escala). */
export interface LimiteNumeroEstoque {
  readonly casas: 4 | 6;
  readonly inteiros: number;
}

/** `numeric(18,4)`: quantidade, quantidade contada, saldo e diferença. */
export const LIMITE_QUANTIDADE_ESTOQUE = Object.freeze({ casas: 4, inteiros: 14 } as const);
/** `numeric(18,6)`: custo unitário. */
export const LIMITE_CUSTO_ESTOQUE = Object.freeze({ casas: 6, inteiros: 12 } as const);

export type ResultadoNumeroEstoque = { ok: true; valor: string } | { ok: false; mensagem: string };

/** Texto canônico: sem sinal, sem expoente, sem vírgula, sem espaço, sem zero à esquerda, sem ponto solto. */
const FORMA_CANONICA = /^(0|[1-9]\d*)(\.\d+)?$/;

/**
 * Confere um número que chega à API (ou sai da tela) como TEXTO CANÔNICO, na forma e no limite da coluna.
 *
 * Por que texto: dinheiro e quantidade nunca passam por ponto flutuante (`CLAUDE.md`, "Dados"). Um número
 * JSON já chegou arredondado pelo parser antes de qualquer conferência — `0.1 + 0.2` vira outra coisa —, e
 * por isso é RECUSADO, não convertido.
 *
 * Por que recusar e nunca arredondar: o banco arredondaria em silêncio um valor com casas a mais
 * (`numeric(18,4)` grava `1.23456` como `1.2346`), e o documento passaria a afirmar uma quantidade que o
 * usuário não digitou. Fora da forma ou do limite → recusa com mensagem; nunca 500, nunca truncado.
 *
 * O valor devolvido é o MESMO texto recebido: a conferência não reescreve o número.
 */
export function conferirNumeroEstoque(
  valor: unknown,
  o: { casas: 4 | 6; inteiros: number; minimo: "positivo" | "naoNegativo" }
): ResultadoNumeroEstoque {
  if (typeof valor === "number" || typeof valor === "bigint") return { ok: false, mensagem: "Informe o número como texto." };
  if (typeof valor !== "string" || valor === "") return { ok: false, mensagem: "Informe um número." };
  if (!FORMA_CANONICA.test(valor)) {
    if (/^-/.test(valor)) return { ok: false, mensagem: "O número não pode ser negativo." };
    if (valor.includes(",")) return { ok: false, mensagem: "Use ponto como separador decimal." };
    return { ok: false, mensagem: "Número inválido: use só dígitos e ponto decimal, sem sinal, espaço ou expoente." };
  }
  const [inteiros = "", casas = ""] = valor.split(".");
  if (casas.length > o.casas) return { ok: false, mensagem: `Use no máximo ${o.casas} casas decimais.` };
  if (inteiros.length > o.inteiros) return { ok: false, mensagem: `O número passa do limite de ${o.inteiros} dígitos inteiros.` };
  if (o.minimo === "positivo" && /^[0.]+$/.test(valor)) return { ok: false, mensagem: "Informe um número maior que zero." };
  return { ok: true, valor };
}
