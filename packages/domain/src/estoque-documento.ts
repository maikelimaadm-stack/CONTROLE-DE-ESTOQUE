/**
 * ESTOQUE-01 (decisão 274) — O DOCUMENTO DE ESTOQUE NO DOMÍNIO.
 *
 * O Portal de Estoque ganha o mesmo desenho dos portais de Vendas e de Compras: um documento único
 * (`erp.documentos_estoque`), com TOP obrigatória, em quatro espécies. Este arquivo é o vocabulário que a API,
 * a tela e os testes compartilham — e nada mais. Ele NÃO move estoque: quem confirma é a rota, pelo
 * `stock-core` de sempre; aqui só se diz o que cada espécie é, que movimento ela produz e como um número
 * chega à API.
 *
 * OPERACOES-01 F5a (decisão 282): o documento ganha a MOVIMENTAÇÃO INTERNA — três espécies a mais (requisição de
 * material, consumo e devolução de consumo), o DESTINO (para onde vai o que sai do estoque), o MOTIVO e a
 * justificativa da saída, a ORIGEM (consumo → requisição, devolução → consumo) e o ATENDIMENTO calculado da
 * requisição. A API, o ID Global, a matriz das regras gerais e o dicionário usam as SETE
 * (`TODAS_AS_ESPECIES_DOCUMENTO_ESTOQUE`). Desde a F5b, a Central de Estoque (no motor da Central) lança as SETE quando
 * a API declara `movimentacaoInterna`, e as QUATRO de antes (`ESPECIES_DOCUMENTO_ESTOQUE`) quando não declara.
 *
 * As famílias (`estoque.entrada`, …) NÃO estão escritas aqui: moram no registry (`tipo-operacao.ts`), como
 * variantes de `erp.documentos_estoque` pela coluna `especie`, e as funções deste arquivo PERGUNTAM ao
 * registry. Um mapa espécie → família escrito à mão funcionaria hoje e mentiria na primeira família nova
 * (`familia-operacional-ssot-audit`).
 */
import { ENUM_LABELS } from "./labels.js";
import { resolverTipoOperacao, tipoOperacao } from "./tipo-operacao.js";

/** As quatro espécies que a Central de Estoque de hoje lança (ESTOQUE-01, 0040). */
export type EspecieEstoqueDaCentral = "entrada" | "saida" | "transferencia" | "ajuste";

/**
 * As três espécies da movimentação interna (OPERACOES-01 F5a, 0043): a requisição (pedido de material, que reserva
 * no local de estoque), o consumo (que baixa — atendendo uma requisição ou direto) e a devolução de consumo (que
 * volta ao local de estoque e puxa do consumo).
 */
export type EspecieMovimentacaoInterna = "requisicao" | "consumo" | "devolucao_consumo";

/** As espécies do documento de estoque, como o banco as persiste (`chk_documentos_estoque_especie`, 0040 + 0043). */
export type EspecieEstoque = EspecieEstoqueDaCentral | EspecieMovimentacaoInterna;

/**
 * As quatro espécies de antes da movimentação interna, na ordem em que a tela as oferece. Desde a F5b, a Central de
 * Estoque usa TODAS (`TODAS_AS_ESPECIES_DOCUMENTO_ESTOQUE`) quando a API declara `movimentacaoInterna`, e só estas
 * quatro quando não declara (a API de antes).
 */
export const ESPECIES_DOCUMENTO_ESTOQUE: readonly EspecieEstoqueDaCentral[] = Object.freeze(["entrada", "saida", "transferencia", "ajuste"] as const);

/** As três espécies da movimentação interna, na ordem do fluxo (requisição → consumo → devolução de consumo). */
export const ESPECIES_MOVIMENTACAO_INTERNA: readonly EspecieMovimentacaoInterna[] = Object.freeze(["requisicao", "consumo", "devolucao_consumo"] as const);

/**
 * As SETE espécies: as quatro da Central de hoje seguidas das três da movimentação interna. É a CONCATENAÇÃO das
 * duas listas acima, não uma terceira lista — a API, o ID Global, a matriz das regras gerais e o dicionário leem
 * esta.
 */
export const TODAS_AS_ESPECIES_DOCUMENTO_ESTOQUE: readonly EspecieEstoque[] = Object.freeze([...ESPECIES_DOCUMENTO_ESTOQUE, ...ESPECIES_MOVIMENTACAO_INTERNA]);

/** O segmento de URL de cada espécie (`/api/estoque/<segmento>`, `/estoque/movimentacoes/<segmento>/…`). */
export type SegmentoEstoque = "entradas" | "saidas" | "transferencias" | "ajustes" | "requisicoes" | "consumos" | "devolucoes-consumo";

/** A TABELA que o Portal de Estoque lança — o endereço no registry, não uma lista de famílias. */
export const TABELA_DOCUMENTO_ESTOQUE = "erp.documentos_estoque";

/** As situações do documento (`erp.documentos_estoque.situacao`). Cancelado é final; nada volta. */
export type SituacaoDocumentoEstoque = "aberto" | "confirmado" | "cancelado";
export const SITUACOES_DOCUMENTO_ESTOQUE: readonly SituacaoDocumentoEstoque[] = Object.freeze(["aberto", "confirmado", "cancelado"] as const);

export const SEGMENTO_DA_ESPECIE_ESTOQUE: Readonly<Record<EspecieEstoque, SegmentoEstoque>> = Object.freeze({
  entrada: "entradas",
  saida: "saidas",
  transferencia: "transferencias",
  ajuste: "ajustes",
  requisicao: "requisicoes",
  consumo: "consumos",
  devolucao_consumo: "devolucoes-consumo"
});

/**
 * A espécie de um segmento de URL, procurada nas SETE. Segmento desconhecido → `undefined`, e quem chama responde
 * "não encontrado". Só propriedade PRÓPRIA do mapa: `"constructor"` ou `"__proto__"` vindos da URL nunca viram
 * espécie. (A Central de hoje continua sem variante para as três novas: ela itera `ESPECIES_DOCUMENTO_ESTOQUE`.)
 */
export function especieDoSegmentoEstoque(segmento: string): EspecieEstoque | undefined {
  if (typeof segmento !== "string") return undefined;
  return TODAS_AS_ESPECIES_DOCUMENTO_ESTOQUE.find((e) => SEGMENTO_DA_ESPECIE_ESTOQUE[e] === segmento);
}

/**
 * O recurso de permissão de cada espécie. Um recurso por espécie, como no documento de compra: quem pode
 * lançar entrada não pode, por isso, acertar o inventário. Confirmar e cancelar exigem `<recurso>.edit`.
 */
export const RECURSO_DA_ESPECIE_ESTOQUE: Readonly<Record<EspecieEstoque, "entradas_estoque" | "saidas_estoque" | "transferencias_estoque" | "ajustes_estoque" | "requisicoes_estoque" | "consumos_estoque" | "devolucoes_consumo_estoque">> = Object.freeze({
  entrada: "entradas_estoque",
  saida: "saidas_estoque",
  transferencia: "transferencias_estoque",
  ajuste: "ajustes_estoque",
  requisicao: "requisicoes_estoque",
  consumo: "consumos_estoque",
  devolucao_consumo: "devolucoes_consumo_estoque"
});

/** O rótulo curto da espécie — lido do dono dos rótulos de enum (`labels.ts`), nunca escrito duas vezes. */
export const ROTULO_DA_ESPECIE_ESTOQUE: Readonly<Record<EspecieEstoque, string>> = Object.freeze({
  entrada: ENUM_LABELS.especie_documento_estoque.entrada,
  saida: ENUM_LABELS.especie_documento_estoque.saida,
  transferencia: ENUM_LABELS.especie_documento_estoque.transferencia,
  ajuste: ENUM_LABELS.especie_documento_estoque.ajuste,
  requisicao: ENUM_LABELS.especie_documento_estoque.requisicao,
  consumo: ENUM_LABELS.especie_documento_estoque.consumo,
  devolucao_consumo: ENUM_LABELS.especie_documento_estoque.devolucao_consumo
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
 *   · ajuste → `correction_in` (contou mais) ou `correction_out` (contou menos); diferença zero não move nada;
 *   · requisição → NENHUM: confirmar a requisição só RESERVA no local de estoque (a parte C da reserva, 0043);
 *   · consumo → `requisition` (baixa do local de estoque, atendendo ou não uma requisição);
 *   · devolução de consumo → `devolution` (volta ao local de estoque pelo custo do consumo de origem).
 * A execução configurada da TOP NÃO vale para estas famílias nesta fatia: o movimento é o da ESPÉCIE.
 */
export const MOVIMENTOS_DA_ESPECIE_ESTOQUE: Readonly<Record<EspecieEstoque, readonly string[]>> = Object.freeze({
  entrada: Object.freeze(["entry"]),
  saida: Object.freeze(["writeoff"]),
  transferencia: Object.freeze(["transfer_out", "transfer_in"]),
  ajuste: Object.freeze(["correction_in", "correction_out"]),
  requisicao: Object.freeze([]),
  consumo: Object.freeze(["requisition"]),
  devolucao_consumo: Object.freeze(["devolution"])
});

// ─────────────── movimentação interna (OPERACOES-01 F5a, decisão 282) ───────────────

/**
 * A espécie de ORIGEM de cada espécie que puxa de outro documento: o consumo atende uma requisição (opcional, a
 * não ser que a TOP exija — seção Fluxo) e a devolução de consumo volta de um consumo (obrigatória). As outras
 * espécies não têm origem (`chk_documentos_estoque_origem`, 0043).
 */
export const ESPECIE_DE_ORIGEM_ESTOQUE: Readonly<Partial<Record<EspecieEstoque, EspecieEstoque>>> = Object.freeze({
  consumo: "requisicao",
  devolucao_consumo: "consumo"
});

/** A espécie de origem desta espécie, ou `null` (a espécie não puxa de outro documento). Só propriedade própria. */
export function especieDeOrigemEstoque(especie: EspecieEstoque): EspecieEstoque | null {
  return Object.hasOwn(ESPECIE_DE_ORIGEM_ESTOQUE, especie) ? (ESPECIE_DE_ORIGEM_ESTOQUE[especie] ?? null) : null;
}

/**
 * As espécies que levam DESTINO no cabeçalho (`chk_documentos_estoque_apropriacao`, 0043). A saída, a requisição e
 * o consumo o recebem conforme a seção Destino da TOP; a devolução de consumo leva o destino COPIADO do consumo de
 * origem (não se informa). As outras espécies: destino sempre vazio.
 */
export const ESPECIES_COM_DESTINO_ESTOQUE: readonly EspecieEstoque[] = Object.freeze(["saida", "requisicao", "consumo", "devolucao_consumo"] as const);

/** As seis dimensões do destino, pela chave da seção Destino da TOP. */
export type DimensaoDestinoEstoque = "centroCusto" | "equipamento" | "ordemServico" | "loteAnimais" | "area" | "safra";

/** A coluna do cabeçalho do documento de estoque que guarda cada dimensão do destino. */
export type ColunaDestinoEstoque = "centro_custo_id" | "equipamento_id" | "ordem_servico_id" | "lote_animais_id" | "area_id" | "safra_id";

/** Uma dimensão do destino: a chave (seção Destino), a coluna (documento) e o rótulo (texto visível). */
export interface CampoDestinoEstoque {
  readonly chave: DimensaoDestinoEstoque;
  readonly coluna: ColunaDestinoEstoque;
  readonly rotulo: string;
}

/**
 * AS SEIS DIMENSÕES DO DESTINO, na ordem da tela — o DONO da lista (a seção Destino da TOP, a API e o web leem
 * daqui). "Centro de resultado" é o nome do produto para `erp.cost_centers` (cadastro, exigência da TOP,
 * relatório); "Área/talhão" é `erp.areas`. Centro de resultado e safra são da organização; máquina/equipamento,
 * ordem de serviço, lote de animais e área/talhão são da empresa do documento.
 */
export const CAMPOS_DESTINO_ESTOQUE: readonly CampoDestinoEstoque[] = Object.freeze([
  Object.freeze({ chave: "centroCusto", coluna: "centro_custo_id", rotulo: "Centro de resultado" }),
  Object.freeze({ chave: "equipamento", coluna: "equipamento_id", rotulo: "Máquina/equipamento" }),
  Object.freeze({ chave: "ordemServico", coluna: "ordem_servico_id", rotulo: "Ordem de serviço" }),
  Object.freeze({ chave: "loteAnimais", coluna: "lote_animais_id", rotulo: "Lote de animais" }),
  Object.freeze({ chave: "area", coluna: "area_id", rotulo: "Área/talhão" }),
  Object.freeze({ chave: "safra", coluna: "safra_id", rotulo: "Safra" })
] as const);

/**
 * Os 13 motivos da saída, na ordem do `check` da baixa antiga (`erp.stock_writeoffs.reason`, 0003) — o mesmo
 * `check` que a 0043 põe em `erp.documentos_estoque.motivo_saida`. O rótulo de cada um é o de
 * `ENUM_LABELS.writeoff_reason` (o teste confere as mesmas chaves, na mesma ordem).
 */
export const MOTIVOS_SAIDA_ESTOQUE = Object.freeze([
  "loss", "deterioration", "theft", "damage", "inventory", "accounting", "burglary", "expiration", "gift",
  "donation", "consumption", "payment_with_product", "other"
] as const);
export type MotivoSaidaEstoque = (typeof MOTIVOS_SAIDA_ESTOQUE)[number];

/** O limite da justificativa da saída (caracteres, depois de aparar os espaços). */
export const LIMITE_JUSTIFICATIVA_SAIDA = 2000;

/**
 * O ATENDIMENTO da requisição — CALCULADO, nunca uma situação do banco: a requisição confirmada é a pendente, e
 * quanto já foi consumido dela (por consumos não cancelados) e se o saldo foi encerrado dizem em que ponto ela
 * está. `null` fora da requisição confirmada.
 */
export const ATENDIMENTOS_REQUISICAO_ESTOQUE = Object.freeze(["pendente", "parcial", "atendido", "encerrado"] as const);
export type AtendimentoRequisicaoEstoque = (typeof ATENDIMENTOS_REQUISICAO_ESTOQUE)[number];

/**
 * A capacidade que a API declara em `capacidades.movimentacaoInterna` das rotas `/estoque/<segmento>/operation-types`:
 * as três espécies novas, o destino, o motivo e a justificativa da saída, a entrada sem custo (custo médio), o
 * custo no ajuste, a origem, o encerramento do saldo da requisição, o atendimento e o `empresa_id` do saldo.
 */
export const CAPACIDADE_MOVIMENTACAO_INTERNA = 1;

/**
 * A API declarou a movimentação interna? Só um objeto com `movimentacaoInterna` IGUAL a
 * `CAPACIDADE_MOVIMENTACAO_INTERNA` responde `true`; qualquer outra forma (ausente, `null`, texto, outro número,
 * lista) responde `false` — a tela trata a API como a de antes, sem as espécies novas (fail-closed).
 */
export function entendeMovimentacaoInterna(capacidades: unknown): boolean {
  if (typeof capacidades !== "object" || capacidades === null || Array.isArray(capacidades)) return false;
  // Só a propriedade PRÓPRIA e de dado: nem herdada do protótipo, nem um getter executado aqui.
  const valor: unknown = Object.getOwnPropertyDescriptor(capacidades, "movimentacaoInterna")?.value;
  return valor === CAPACIDADE_MOVIMENTACAO_INTERNA;
}

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
