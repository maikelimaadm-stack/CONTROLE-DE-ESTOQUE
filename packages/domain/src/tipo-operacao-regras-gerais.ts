/**
 * TOP-CONFIG-08 — AS REGRAS GERAIS E A APROVAÇÃO DA TOP, EXECUTADAS NO FORMATO 4 (decisão 277) E NO 5 (decisão 281).
 *
 * ┌─ O QUE ESTE ARQUIVO É ─────────────────────────────────────────────────────────────────────────────┐
 * │ Um dono só para as três perguntas que a API, o editor e as rotas de aprovação fazem sobre as      │
 * │ quatro regras gerais (confirmação, documento sem itens, alteração após confirmar, aprovação):     │
 * │                                                                                                     │
 * │ 1. GRAVAÇÃO — "esta família aceita esta regra?". A MATRIZ POR FAMÍLIA (`MATRIZ_REGRAS_GERAIS_TOP`). │
 * │    O servidor a publica nas capabilities, o editor desabilita a opção com o motivo dela e a API    │
 * │    recusa (422) com o MESMO motivo. Duas listas divergiriam no primeiro motivo novo.                │
 * │ 2. EXECUÇÃO — "o que a versão congelada deste documento manda fazer?" (`regrasGeraisDaVersaoTop`). │
 * │    Lê a versão COMO ELA É: a matriz é o portão da gravação, não da execução, e só cresce.          │
 * │ 3. APROVAÇÃO — "este documento exige aprovação?" (`exigeAprovacao`), a mesma conta da função       │
 * │    `erp.top_exige_aprovacao` do banco (0041), em decimal.                                           │
 * └─────────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ POR QUE SÓ O FORMATO 4 (E O 5) EXECUTA (o corte, como o 3 foi para as restrições) ────────────────┐
 * │ As versões dos formatos 1, 2 e 3 foram gravadas quando NADA executava estas regras. Em produção há │
 * │ um pedido de compra no formato 3 com Confirmação Automática, Documento sem itens Permitido e       │
 * │ Alteração Permitida: ler isso como decisão faria a TOP passar a confirmar sozinha um documento que │
 * │ ninguém pediu para confirmar. Então formato 1 a 3 = tudo neutro, SEM LER AS SEÇÕES, para sempre; o │
 * │ formato 4 é o portão explícito que a decisão 240 pede para todo efeito novo. O formato 5 (decisão   │
 * │ 281) é o 4 + as seções de extensão: executa estas regras exatamente como o 4.                       │
 * └─────────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ POR QUE A MATRIZ RECUSA O QUE RECUSA ─────────────────────────────────────────────────────────────┐
 * │ alteração após confirmar   o estorno do estoque não marca o movimento estornado (estornar duas      │
 * │                            vezes estornaria em dobro); o código do título é único e refazer os      │
 * │                            títulos colide com os cancelados; compra e estoque nem têm edição.      │
 * │ estoque sem itens          o documento de estoque sem itens não movimenta nada.                     │
 * │ estoque "a partir de valor" o valor do documento de estoque só se conhece na confirmação.          │
 * │ orçamento e pedidos        não são confirmados: são convertidos ou recebidos em outro documento.    │
 * │                            O pedido de compra aceita a aprovação: ela acontece ao finalizar (F6a).  │
 * │ qualquer outra família     não tem documento no sistema que execute a regra.                        │
 * └─────────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * As famílias NÃO estão escritas aqui: são perguntadas ao registry (`tipo-operacao.ts`) pela variante de
 * cada documento, como faz a matriz de execução (`familia-operacional-ssot-audit`). Se o registry deixar de
 * declarar uma variante, a linha some e a família cai no padrão "sem documento", que só aceita o neutro:
 * fail-closed.
 *
 * Este arquivo NÃO confirma, NÃO aprova e NÃO grava nada. Quem executa é o serviço dono do documento.
 */
import { D, money } from "@agro/shared";
import {
  MODOS_CONFIRMACAO,
  POLITICAS_ALTERACAO,
  POLITICAS_APROVACAO,
  POLITICAS_DOCUMENTO_SEM_ITENS,
  configuracaoNeutraTopV4,
  formato5Top,
  lerConfiguracaoTop,
  regrasGeraisExecutamTop,
  secoesExtensaoDaVersaoTop,
  versaoSchemaDaConfiguracaoTop,
  versaoSchemaExecutaRegrasGeraisTop,
  type ConfiguracaoComRegrasGeraisTop,
  type ConfiguracaoTipoOperacao,
  type ModoConfirmacao,
  type PoliticaAlteracao,
  type PoliticaAprovacao,
  type PoliticaDocumentoSemItens,
} from "./tipo-operacao-configuracao.js";
import { familiaOperacionalDeDocumentoCompra, familiaOperacionalDeDocumentoVenda } from "./tipo-operacao-configurado.js";
import { ESPECIES_DOCUMENTO_ESTOQUE, familiaOperacionalDeDocumentoEstoque } from "./estoque-documento.js";
import { formatarDinheiroBr } from "./tipo-operacao-restricoes.js";

// ---------------------------------------------------------------------------------------------------
// 1. AS MENSAGENS DA APROVAÇÃO — ditas igual na confirmação, nas rotas de aprovação e na tela
// ---------------------------------------------------------------------------------------------------

/** 409 `APROVACAO_PENDENTE`: o documento exige aprovação e não tem decisão vigente. */
export const MENSAGEM_APROVACAO_PENDENTE = "Este documento precisa de aprovação antes de ser confirmado.";

/**
 * 409 `APROVACAO_REPROVADA`: a decisão vigente é uma reprovação. O molde é fixo ("Este documento foi reprovado: <motivo>"),
 * com o motivo como foi gravado — a mensagem não reescreve o que quem reprovou escreveu — e o ponto final só quando o
 * motivo ainda não fecha a frase:
 *   · o motivo termina em ".", "!" ou "?" → nenhum ponto a mais ("Preço alto." → "…reprovado: Preço alto.");
 *   · qualquer outro fim, inclusive reticências ("…"), ":", ";" e "," → o "." no fim, como sempre foi
 *     ("Preço alto" → "…reprovado: Preço alto."). Só os três sinais contam; nenhum outro é adivinhado.
 * Espaço em branco no FIM do motivo (espaço, tab, quebra de linha — o mesmo conjunto de `String.prototype.trim`) é
 * ignorado SÓ para decidir: o último caractere que conta é o último que não é branco. O texto do motivo entra na
 * mensagem sem nenhuma mudança, brancos inclusive ("Preço alto.␠" → "…reprovado: Preço alto.␠", sem ponto a mais;
 * "Preço alto␠" → "…reprovado: Preço alto␠.", como hoje). Pela API isso não chega a acontecer — as rotas de reprovação
 * gravam o motivo já aparado (`z.string().trim()`) —, mas a linha gravada por outro caminho continua legível, e a
 * mensagem não normaliza o que ninguém pediu para normalizar.
 */
const MOTIVO_JA_FECHA_A_FRASE = /[.!?]$/u;
export const mensagemAprovacaoReprovada = (motivo: string): string =>
  `Este documento foi reprovado: ${motivo}${MOTIVO_JA_FECHA_A_FRASE.test(motivo.trimEnd()) ? "" : "."}`;

/** 409 `APROVACAO_NAO_EXIGIDA`: aprovar ou reprovar um documento cuja versão não pede aprovação. */
export const MENSAGEM_APROVACAO_NAO_EXIGIDA = "Este documento não precisa de aprovação.";

/** 409 `CONFLICT` das rotas de aprovação: confirmado e cancelado não passam por aprovação. */
export const MENSAGEM_APROVACAO_SO_DOCUMENTO_ABERTO = "Só documento aberto passa por aprovação.";

// ---------------------------------------------------------------------------------------------------
// 2. A MATRIZ POR FAMÍLIA — o portão da GRAVAÇÃO
// ---------------------------------------------------------------------------------------------------

/**
 * O que a família aceita numa regra e, quando não aceita tudo, POR QUE as opções de fora não valem.
 * `motivo` é `null` quando `aceitos` cobre o enum inteiro — nada a explicar.
 */
export interface RegraDaFamiliaTop<T> {
  aceitos: readonly T[];
  motivo: string | null;
}

/** Uma linha da matriz: a família e as quatro regras. O tipo obriga a linha a declarar as quatro. */
export interface ItemMatrizRegrasGeraisTop {
  familia: string;
  confirmacao: RegraDaFamiliaTop<ModoConfirmacao>;
  documentoSemItens: RegraDaFamiliaTop<PoliticaDocumentoSemItens>;
  alteracaoAposConfirmacao: RegraDaFamiliaTop<PoliticaAlteracao>;
  aprovacao: RegraDaFamiliaTop<PoliticaAprovacao>;
}

// Os motivos — texto exato, porque aparecem no editor (ao lado da opção desabilitada) e na recusa 422.
const MOTIVO_SEM_DOCUMENTO = "Esta operação ainda não tem documento no sistema.";
const MOTIVO_NAO_CONFIRMADO = "Este documento não é confirmado: ele é convertido ou recebido em outro.";
const MOTIVO_SEM_ITENS_ESTOQUE = "Documento de estoque sem itens não movimenta nada.";
const MOTIVO_SEM_ITENS_ORCAMENTO_PEDIDO = "Orçamento e pedido sem itens não têm o que converter nem receber.";
const MOTIVO_ALTERACAO_VENDA = "Alterar uma venda confirmada ainda não tem execução: o estorno do estoque e os títulos não sabem refazer o documento. Cancele e lance outra.";
const MOTIVO_ALTERACAO_COMPRA = "Alterar uma compra confirmada ainda não tem execução: a compra não tem edição. Cancele e lance outra.";
const MOTIVO_ALTERACAO_ESTOQUE = "Documento de estoque confirmado não se altera: cancele e lance outro.";
const MOTIVO_APROVACAO_POR_VALOR_ESTOQUE = "O valor do documento de estoque só é conhecido na confirmação: use \"Sempre\".";
const MOTIVO_APROVACAO_SEM_CONFIRMACAO = "A aprovação acontece antes da confirmação, e este documento não é confirmado.";

/** Regra congelada, com a lista copiada: quem lê a matriz nunca altera o que outro consumidor vê. */
const regra = <T>(aceitos: readonly T[], motivo: string | null): RegraDaFamiliaTop<T> =>
  Object.freeze({ aceitos: Object.freeze([...aceitos]), motivo });

/**
 * Venda e compra: o documento que se confirma. Confirmação, sem itens e aprovação valem por inteiro; a
 * alteração após confirmar fica Bloqueada — o motivo é de cada uma.
 */
const linhaDoDocumentoConfirmado = (familia: string, motivoAlteracao: string): ItemMatrizRegrasGeraisTop => Object.freeze({
  familia,
  confirmacao: regra(MODOS_CONFIRMACAO, null),
  documentoSemItens: regra(POLITICAS_DOCUMENTO_SEM_ITENS, null),
  alteracaoAposConfirmacao: regra<PoliticaAlteracao>(["bloqueada"], motivoAlteracao),
  aprovacao: regra(POLITICAS_APROVACAO, null),
});

/** As quatro espécies de estoque: confirmação inteira; aprovação só Sempre (o valor só existe na confirmação). */
const linhaDoEstoque = (familia: string): ItemMatrizRegrasGeraisTop => Object.freeze({
  familia,
  confirmacao: regra(MODOS_CONFIRMACAO, null),
  documentoSemItens: regra<PoliticaDocumentoSemItens>(["proibido"], MOTIVO_SEM_ITENS_ESTOQUE),
  alteracaoAposConfirmacao: regra<PoliticaAlteracao>(["bloqueada"], MOTIVO_ALTERACAO_ESTOQUE),
  aprovacao: regra<PoliticaAprovacao>(["nenhuma", "sempre"], MOTIVO_APROVACAO_POR_VALOR_ESTOQUE),
});

/** Orçamento e pedidos: não são confirmados, então nenhuma das quatro regras tem o que executar. */
const linhaDoOrcamentoOuPedido = (familia: string): ItemMatrizRegrasGeraisTop => Object.freeze({
  familia,
  confirmacao: regra<ModoConfirmacao>(["manual"], MOTIVO_NAO_CONFIRMADO),
  documentoSemItens: regra<PoliticaDocumentoSemItens>(["proibido"], MOTIVO_SEM_ITENS_ORCAMENTO_PEDIDO),
  alteracaoAposConfirmacao: regra<PoliticaAlteracao>(["bloqueada"], MOTIVO_NAO_CONFIRMADO),
  aprovacao: regra<PoliticaAprovacao>(["nenhuma"], MOTIVO_APROVACAO_SEM_CONFIRMACAO),
});

/**
 * OPERACOES-01 F6a (decisão 283): o PEDIDO DE COMPRA. Como o orçamento e o pedido de venda, ele não é confirmado
 * — confirmação Manual, sem itens Proibido e alteração Bloqueada continuam, com os motivos de hoje —, mas a
 * APROVAÇÃO vale por inteiro: ela acontece ao FINALIZAR o pedido (o "antes da confirmação" do pedido é "antes de
 * finalizar"), com a mesma conta da compra (`exigeAprovacao`, `erp.top_exige_aprovacao`).
 */
const linhaDoPedidoDeCompra = (familia: string): ItemMatrizRegrasGeraisTop => Object.freeze({
  familia,
  confirmacao: regra<ModoConfirmacao>(["manual"], MOTIVO_NAO_CONFIRMADO),
  documentoSemItens: regra<PoliticaDocumentoSemItens>(["proibido"], MOTIVO_SEM_ITENS_ORCAMENTO_PEDIDO),
  alteracaoAposConfirmacao: regra<PoliticaAlteracao>(["bloqueada"], MOTIVO_NAO_CONFIRMADO),
  aprovacao: regra(POLITICAS_APROVACAO, null),
});

/**
 * Qualquer família fora da matriz (as oito antigas de estoque, a solicitação de compra, o financeiro…): só
 * o neutro. NÃO é linha da matriz — é o padrão de `regrasGeraisDaFamiliaTop`, para que a família nova do
 * registry nasça fechada, e não aberta por esquecimento.
 */
const linhaSemDocumento = (familia: string): ItemMatrizRegrasGeraisTop => Object.freeze({
  familia,
  confirmacao: regra<ModoConfirmacao>(["manual"], MOTIVO_SEM_DOCUMENTO),
  documentoSemItens: regra<PoliticaDocumentoSemItens>(["proibido"], MOTIVO_SEM_DOCUMENTO),
  alteracaoAposConfirmacao: regra<PoliticaAlteracao>(["bloqueada"], MOTIVO_SEM_DOCUMENTO),
  aprovacao: regra<PoliticaAprovacao>(["nenhuma"], MOTIVO_SEM_DOCUMENTO),
});

/** Família perguntada ao registry; `undefined` (variante que o registry não declara) tira a linha. */
const linhaSe = (familia: string | undefined, montar: (f: string) => ItemMatrizRegrasGeraisTop): ItemMatrizRegrasGeraisTop[] =>
  familia ? [montar(familia)] : [];

/**
 * A MATRIZ. Venda, compra, as quatro espécies de estoque, orçamento, pedido de venda, pedido de compra e (desde a
 * F6a, decisão 283) orçamento de compra — nesta ordem. O pedido de compra aceita a aprovação (ao finalizar); o
 * orçamento de compra é como o orçamento de venda. A API confere a gravação do formato 4 (e do 5) contra ela; o
 * servidor a publica no bloco `regrasGerais` das capabilities; o editor lê a publicada (`lerMatrizRegrasGeraisTop`).
 */
export const MATRIZ_REGRAS_GERAIS_TOP: readonly ItemMatrizRegrasGeraisTop[] = Object.freeze([
  ...linhaSe(familiaOperacionalDeDocumentoVenda("sale"), (f) => linhaDoDocumentoConfirmado(f, MOTIVO_ALTERACAO_VENDA)),
  ...linhaSe(familiaOperacionalDeDocumentoCompra("compra"), (f) => linhaDoDocumentoConfirmado(f, MOTIVO_ALTERACAO_COMPRA)),
  ...ESPECIES_DOCUMENTO_ESTOQUE.flatMap((especie) => linhaSe(familiaOperacionalDeDocumentoEstoque(especie), linhaDoEstoque)),
  ...linhaSe(familiaOperacionalDeDocumentoVenda("budget"), linhaDoOrcamentoOuPedido),
  ...linhaSe(familiaOperacionalDeDocumentoVenda("order"), linhaDoOrcamentoOuPedido),
  ...linhaSe(familiaOperacionalDeDocumentoCompra("pedido"), linhaDoPedidoDeCompra),
  ...linhaSe(familiaOperacionalDeDocumentoCompra("orcamento"), linhaDoOrcamentoOuPedido),
]);

/**
 * As regras da família. Família fora da matriz → o padrão "sem documento" (só o neutro), nunca a linha de
 * uma família vizinha. `matriz` é parâmetro para a tela avaliar contra a matriz QUE O SERVIDOR DECLAROU.
 */
export function regrasGeraisDaFamiliaTop(
  codigoBase: string,
  matriz: readonly ItemMatrizRegrasGeraisTop[] = MATRIZ_REGRAS_GERAIS_TOP,
): ItemMatrizRegrasGeraisTop {
  return matriz.find((m) => m.familia === codigoBase) ?? linhaSemDocumento(codigoBase);
}

// ---------------------------------------------------------------------------------------------------
// 3. A CONFERÊNCIA E A VOLTA AO PADRÃO
// ---------------------------------------------------------------------------------------------------

/** As coordenadas das quatro regras, na ordem fixa das recusas e da volta ao padrão. */
export const CAMINHOS_REGRAS_GERAIS_TOP = [
  "geral.confirmacao",
  "geral.documentoSemItens",
  "geral.alteracaoAposConfirmacao",
  "aprovacao.politica",
] as const;
export type CaminhoRegraGeralTop = (typeof CAMINHOS_REGRAS_GERAIS_TOP)[number];

/** A recusa da gravação no formato 4 ou 5: o caminho do campo e o motivo da matriz. Compatível com `RecusaExecucaoTop`. */
export interface RecusaRegraGeralTop {
  motivo: "combinacao_nao_suportada";
  caminho: CaminhoRegraGeralTop;
  mensagem: string;
}

/**
 * Só alcançável com uma matriz declarada de fora que recusa uma opção sem dizer por quê (`motivo: null`).
 * A matriz do produto sempre diz; mesmo assim a recusa não sai sem mensagem.
 */
const MENSAGEM_REGRA_SEM_MOTIVO = "Esta operação não aceita esta opção.";

/**
 * A configuração do formato 4 (ou 5) cabe na família? Devolve TODAS as recusas, na ordem fixa dos caminhos, ou `[]`.
 * A mensagem é o motivo da matriz — o mesmo texto que o editor mostra ao lado da opção desabilitada.
 */
export function validarRegrasGeraisTop(
  codigoBase: string,
  c: ConfiguracaoComRegrasGeraisTop,
  matriz: readonly ItemMatrizRegrasGeraisTop[] = MATRIZ_REGRAS_GERAIS_TOP,
): RecusaRegraGeralTop[] {
  const f = regrasGeraisDaFamiliaTop(codigoBase, matriz);
  const recusas: RecusaRegraGeralTop[] = [];
  const conferir = <T>(r: RegraDaFamiliaTop<T>, valor: T, caminho: CaminhoRegraGeralTop): void => {
    if (!r.aceitos.includes(valor)) recusas.push({ motivo: "combinacao_nao_suportada", caminho, mensagem: r.motivo ?? MENSAGEM_REGRA_SEM_MOTIVO });
  };
  conferir(f.confirmacao, c.geral.confirmacao, "geral.confirmacao");
  conferir(f.documentoSemItens, c.geral.documentoSemItens, "geral.documentoSemItens");
  conferir(f.alteracaoAposConfirmacao, c.geral.alteracaoAposConfirmacao, "geral.alteracaoAposConfirmacao");
  conferir(f.aprovacao, c.aprovacao.politica, "aprovacao.politica");
  return recusas;
}

/** Uma regra que a família não aceita e volta ao padrão: de onde, para onde. Valores do enum, não rótulos. */
export type RegraGeralQueVoltaTop =
  | { caminho: "geral.confirmacao"; de: ModoConfirmacao; para: ModoConfirmacao }
  | { caminho: "geral.documentoSemItens"; de: PoliticaDocumentoSemItens; para: PoliticaDocumentoSemItens }
  | { caminho: "geral.alteracaoAposConfirmacao"; de: PoliticaAlteracao; para: PoliticaAlteracao }
  | { caminho: "aprovacao.politica"; de: PoliticaAprovacao; para: PoliticaAprovacao };

/**
 * Volta ao neutro TODA regra que a família não aceita — o que o editor faz ao gravar no formato 4 (ou 5) uma TOP
 * cuja versão anterior declarava o que a família não executa (o pedido de compra de produção: Automática,
 * Permitido e Permitida voltam os três). `voltaram` é a lista que o diálogo "Estas regras passam a valer"
 * mostra, na ordem fixa dos caminhos.
 *
 * O neutro vem de `configuracaoNeutraTopV4` (um dono só): Manual, Proibido, Bloqueada e Sem aprovação com
 * `valorMinimo` nulo — as quatro regras são as mesmas no 4 e no 5. O FORMATO QUE ENTRA É O QUE SAI (4 → 4, 5 → 5),
 * com as seções de extensão do 5 intactas. Não muta a entrada e não devolve referência a ela: cada seção é copiada,
 * as de extensão inclusive.
 */
export function normalizarRegrasGeraisDaFamiliaTop<C extends ConfiguracaoComRegrasGeraisTop>(
  codigoBase: string,
  c: C,
  matriz: readonly ItemMatrizRegrasGeraisTop[] = MATRIZ_REGRAS_GERAIS_TOP,
): { configuracao: C; voltaram: RegraGeralQueVoltaTop[] } {
  const f = regrasGeraisDaFamiliaTop(codigoBase, matriz);
  const n = configuracaoNeutraTopV4();
  const voltaram: RegraGeralQueVoltaTop[] = [];
  const geral = { ...c.geral };
  let aprovacao = { ...c.aprovacao };

  if (!f.confirmacao.aceitos.includes(geral.confirmacao)) {
    voltaram.push({ caminho: "geral.confirmacao", de: geral.confirmacao, para: n.geral.confirmacao });
    geral.confirmacao = n.geral.confirmacao;
  }
  if (!f.documentoSemItens.aceitos.includes(geral.documentoSemItens)) {
    voltaram.push({ caminho: "geral.documentoSemItens", de: geral.documentoSemItens, para: n.geral.documentoSemItens });
    geral.documentoSemItens = n.geral.documentoSemItens;
  }
  if (!f.alteracaoAposConfirmacao.aceitos.includes(geral.alteracaoAposConfirmacao)) {
    voltaram.push({ caminho: "geral.alteracaoAposConfirmacao", de: geral.alteracaoAposConfirmacao, para: n.geral.alteracaoAposConfirmacao });
    geral.alteracaoAposConfirmacao = n.geral.alteracaoAposConfirmacao;
  }
  if (!f.aprovacao.aceitos.includes(aprovacao.politica)) {
    voltaram.push({ caminho: "aprovacao.politica", de: aprovacao.politica, para: n.aprovacao.politica });
    aprovacao = { ...n.aprovacao };
  }

  const configuracao: C = {
    ...c,
    geral,
    estoque: { ...c.estoque },
    financeiro: { ...c.financeiro },
    fiscal: { ...c.fiscal },
    aprovacao,
    execucao: { ...c.execucao },
    // As seções de extensão do 5, COPIADAS (`secoesExtensaoDaVersaoTop` devolve cópias): sem isto o `...c` acima as
    // levaria por referência. Nos formatos 1 a 4 nada é acrescentado — o 4 nunca carrega seção nova.
    ...(formato5Top(c) ? secoesExtensaoDaVersaoTop(c) : null),
  };
  return { configuracao, voltaram };
}

/** Forma do valor mínimo que vira texto em reais — a mesma do leitor da configuração. */
const FORMA_VALOR_DECIMAL = /^\d{1,13}(\.\d{1,2})?$/;

/**
 * O que PASSA A EXECUTAR com esta gravação — a lista do diálogo "Estas regras passam a valer".
 *
 * Vazio quando `antes` já é formato 4 ou 5: lá as regras já executavam, e a mudança é uma edição comum. Senão
 * (formato 1 a 3, ou criação), a lista do que `depois` declara fora do neutro, nesta ordem: "Confirmação
 * automática", "Documento sem itens permitido", "Aprovação sempre", "Aprovação a partir de R$ <valor>".
 * `depois` é a configuração que vai ser gravada, já com as regras da família no padrão
 * (`normalizarRegrasGeraisDaFamiliaTop`): o que voltou ao padrão não passa a valer.
 *
 * Alteração após confirmar nunca entra: no formato 4 (e no 5) ela só aceita Bloqueada, o neutro.
 * O valor sai em reais sem ponto flutuante (decimal → "1.500,00").
 */
export function regrasGeraisQuePassamAValer(antes: ConfiguracaoTipoOperacao | null, depois: ConfiguracaoComRegrasGeraisTop): string[] {
  if (antes !== null && regrasGeraisExecutamTop(antes)) return [];
  const lista: string[] = [];
  if (depois.geral.confirmacao === "automatica") lista.push("Confirmação automática");
  if (depois.geral.documentoSemItens === "permitido") lista.push("Documento sem itens permitido");
  if (depois.aprovacao.politica === "sempre") lista.push("Aprovação sempre");
  if (depois.aprovacao.politica === "por_valor") {
    const v = depois.aprovacao.valorMinimo;
    // Rascunho com valor ainda inválido (o servidor recusará): diz a regra sem inventar um número.
    lista.push(v !== null && FORMA_VALOR_DECIMAL.test(v) ? `Aprovação a partir de R$ ${formatarDinheiroBr(money(v))}` : "Aprovação a partir de um valor");
  }
  return lista;
}

// ---------------------------------------------------------------------------------------------------
// 4. A EXECUÇÃO — o que a versão congelada do documento manda fazer
// ---------------------------------------------------------------------------------------------------

/**
 * As regras gerais que a confirmação e a gravação DESTE documento executam. Tudo `false`/`null` é o neutro:
 * o comportamento de hoje.
 */
export interface RegrasGeraisDaVersao {
  confirmacaoAutomatica: boolean;
  aceitaSemItens: boolean;
  aprovacao: null | { politica: "sempre" } | { politica: "por_valor"; valorMinimo: string };
}

export type ResultadoRegrasGeraisDaVersao =
  | { ok: true; regras: RegrasGeraisDaVersao }
  | { ok: false; motivo: "configuracao_ilegivel" };

const REGRAS_NEUTRAS = (): RegrasGeraisDaVersao => ({ confirmacaoAutomatica: false, aceitaSemItens: false, aprovacao: null });

/**
 * As regras gerais da versão congelada que o DOCUMENTO cita (`tipo_operacao_versao_id`) — nunca a versão
 * corrente da TOP. A ordem das perguntas é a regra:
 *   1. sem versão congelada              → neutro (documento sem TOP);
 *   2. formato desconhecido              → `configuracao_ilegivel` (ninguém sabe o que ela decidiu);
 *   3. formato 4 ou 5 malformado         → `configuracao_ilegivel`;
 *   4. formato 1, 2 ou 3                 → neutro (o corte da decisão 277); malformada também é neutro, porque a
 *                                          leitura das seções de uma versão que nunca executou não pode virar
 *                                          recusa nova;
 *   5. formato 4 ou 5                    → o que ela diz, COMO ELA DIZ.
 * O PORTÃO É UM SÓ: executa a versão que `regrasGeraisExecutamTop` aceita, o mesmo predicado da gravação, para que
 * "só o formato 4 ou 5 executa" tenha um dono só. O número do formato decide apenas o destino de quem NÃO executa: a
 * que se declarou 4 ou 5 (`versaoSchemaExecutaRegrasGeraisTop`) e não saiu da leitura como tal é ilegível (nunca
 * neutro); a de 1 a 3 é o corte, neutro.
 * A matriz NÃO é aplicada aqui: ela é o portão da gravação, e a versão já gravada vale como foi gravada.
 * `codigoBase` viaja junto por ser a mesma entrada das políticas da venda e da compra; a execução não o lê.
 */
export function regrasGeraisDaVersaoTop(versao: { codigoBase: string; configuracao: unknown } | null): ResultadoRegrasGeraisDaVersao {
  if (!versao) return { ok: true, regras: REGRAS_NEUTRAS() };
  const formato = versaoSchemaDaConfiguracaoTop(versao.configuracao);
  if (formato === null) return { ok: false, motivo: "configuracao_ilegivel" };

  const lida = lerConfiguracaoTop(versao.configuracao);
  if (!lida.ok || !regrasGeraisExecutamTop(lida.valor)) {
    return versaoSchemaExecutaRegrasGeraisTop(formato) ? { ok: false, motivo: "configuracao_ilegivel" } : { ok: true, regras: REGRAS_NEUTRAS() };
  }
  const c = lida.valor;

  let aprovacao: RegrasGeraisDaVersao["aprovacao"] = null;
  if (c.aprovacao.politica === "sempre") aprovacao = { politica: "sempre" };
  else if (c.aprovacao.politica === "por_valor") {
    // O leitor estrito já recusa "por valor" sem valor; nulo aqui seria versão escrita fora da API.
    if (c.aprovacao.valorMinimo === null) return { ok: false, motivo: "configuracao_ilegivel" };
    aprovacao = { politica: "por_valor", valorMinimo: c.aprovacao.valorMinimo };
  }
  return {
    ok: true,
    regras: {
      confirmacaoAutomatica: c.geral.confirmacao === "automatica",
      aceitaSemItens: c.geral.documentoSemItens === "permitido",
      aprovacao,
    },
  };
}

/**
 * O documento EXIGE aprovação? A mesma conta de `erp.top_exige_aprovacao` (0041), provada por teste de
 * paridade:
 *   · sem política          → não;
 *   · "sempre"              → sim;
 *   · "a partir de um valor" → total ≥ valor mínimo ("a partir de" INCLUI o igual), em decimal; sem valor do
 *                             documento (o estoque, que só conhece o valor na confirmação) → sim.
 * Valor do documento que não é decimal (só alcançável por erro de quem chama) → sim: na dúvida, aprova-se.
 */
export function exigeAprovacao(regras: RegrasGeraisDaVersao, valorDocumento: string | null): boolean {
  const a = regras.aprovacao;
  if (a === null) return false;
  if (a.politica === "sempre") return true;
  if (valorDocumento === null) return true;
  try {
    return D(valorDocumento).gte(D(a.valorMinimo));
  } catch {
    return true;
  }
}

// ---------------------------------------------------------------------------------------------------
// 5. A MATRIZ COMO CONTRATO (o servidor declara; a tela lê)
// ---------------------------------------------------------------------------------------------------

const ehObjeto = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** O objeto tem EXATAMENTE estas chaves, todas próprias — nem a mais, nem a menos. */
const temExatamente = (o: Record<string, unknown>, chaves: readonly string[]): boolean =>
  Object.keys(o).length === chaves.length && chaves.every((k) => Object.hasOwn(o, k));

const CHAVES_ITEM = ["familia", "confirmacao", "documentoSemItens", "alteracaoAposConfirmacao", "aprovacao"] as const;
const CHAVES_REGRA = ["aceitos", "motivo"] as const;

function lerRegra<T extends string>(bruto: unknown, dominio: readonly T[]): RegraDaFamiliaTop<T> | null {
  if (!ehObjeto(bruto) || !temExatamente(bruto, CHAVES_REGRA)) return null;
  const { aceitos, motivo } = bruto;
  if (!Array.isArray(aceitos) || aceitos.length === 0) return null;
  if (!aceitos.every((v) => (dominio as readonly unknown[]).includes(v))) return null;
  if (new Set(aceitos).size !== aceitos.length) return null;
  if (motivo !== null && typeof motivo !== "string") return null;
  return { aceitos: [...(aceitos as T[])], motivo };
}

/**
 * Lê ESTRITAMENTE a matriz que o servidor declarou no bloco `regrasGerais` das capabilities. Qualquer desvio
 * devolve `null`, e a tela trata o bloco como inexistente (o editor de hoje, formato 3) — em vez de adivinhar
 * um pedaço da matriz:
 *   · não é lista, ou item que não é objeto com EXATAMENTE as cinco chaves;
 *   · família que não é texto, vazia, ou repetida (uma linha por família);
 *   · regra sem EXATAMENTE `aceitos` e `motivo`; `aceitos` vazio, com valor fora do enum ou repetido;
 *     `motivo` que não é texto nem `null`.
 * Devolve objetos novos: nada do resultado aponta para o que veio da rede.
 */
export function lerMatrizRegrasGeraisTop(bruto: unknown): ItemMatrizRegrasGeraisTop[] | null {
  if (!Array.isArray(bruto)) return null;
  const matriz: ItemMatrizRegrasGeraisTop[] = [];
  const familias = new Set<string>();
  for (const item of bruto) {
    if (!ehObjeto(item) || !temExatamente(item, CHAVES_ITEM)) return null;
    const { familia } = item;
    if (typeof familia !== "string" || familia.length === 0 || familias.has(familia)) return null;
    familias.add(familia);
    const confirmacao = lerRegra(item.confirmacao, MODOS_CONFIRMACAO);
    const documentoSemItens = lerRegra(item.documentoSemItens, POLITICAS_DOCUMENTO_SEM_ITENS);
    const alteracaoAposConfirmacao = lerRegra(item.alteracaoAposConfirmacao, POLITICAS_ALTERACAO);
    const aprovacao = lerRegra(item.aprovacao, POLITICAS_APROVACAO);
    if (!confirmacao || !documentoSemItens || !alteracaoAposConfirmacao || !aprovacao) return null;
    matriz.push({ familia, confirmacao, documentoSemItens, alteracaoAposConfirmacao, aprovacao });
  }
  return matriz;
}
