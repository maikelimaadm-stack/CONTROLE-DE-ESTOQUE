import { describe, it, expect } from "vitest";
import * as dominio from "../src/index.js";
import {
  configuracaoNeutraTop,
  configuracaoNeutraTopV2,
  configuracaoNeutraTopV3,
  configuracaoNeutraTopV4,
  configuracaoNeutraTopV5,
  configuracoesTopIguais,
  lerConfiguracaoTop,
  normalizarConfiguracaoTop,
  secoesAlteradasTop,
  secoesExtensaoDaVersaoTop,
  type ConfiguracaoTipoOperacao,
  type RecusaConfiguracaoTop,
} from "../src/tipo-operacao-configuracao.js";
import { DEFINICOES_SECOES_V5, definicaoDaSecaoV5 } from "../src/tipo-operacao-secoes-v5.js";
import {
  AJUDA_FINANCEIRO_PADRAO,
  MENSAGEM_EXIGIR_FORA_DA_FAMILIA,
  MENSAGEM_PROVISAO_FORA_DA_FAMILIA,
  ROTULOS_SEM_CLASSIFICACAO_TOP,
  SECAO_FINANCEIRO_PADRAO,
  recusasDoFinanceiroPadraoDaFamilia,
  type SecaoFinanceiroPadrao,
} from "../src/tipo-operacao-secao-financeiro-padrao.js";
import {
  CAMPOS_PADRAO_FINANCEIRO,
  MENSAGEM_EXIGE_CLASSIFICACAO,
  SEM_CLASSIFICACAO_TOP,
  camposTrocadosDosPadroes,
  familiaUsaPadroesFinanceiros,
  mensagemDosPadroesTrocados,
  padroesFinanceirosVazios,
  perfilDosPadroesFinanceiros,
  planoDaClassificacao,
  type PadroesFinanceirosTop,
} from "../src/financeiro-padroes.js";
import {
  MOTIVOS_DA_PROVISAO,
  REGRAS_DE_PROVISAO,
  alvoDaProvisao,
  mesmasParcelas,
  provisaoExecutavelNaFamilia,
  regraDeProvisaoDaFamilia,
  type EntradaDoAlvoDaProvisao,
} from "../src/financeiro-provisao.js";
import {
  CAPACIDADE_LCDPR,
  CODIGO_DO_TIPO_LCDPR,
  OPCOES_TIPO_EXPLORACAO,
  OPCOES_TIPO_LCDPR,
  PERIODO_MAXIMO_CONFERENCIA_LCDPR_DIAS,
  SITUACOES_CONFERENCIA_LCDPR,
  TIPOS_EXPLORACAO_IMOVEL,
  TIPOS_LCDPR,
  TIPOS_LCDPR_NO_LIVRO,
  TIPO_LCDPR_FORA,
  codigoDoTipoExploracao,
  entendeLcdpr,
} from "../src/financeiro-lcdpr.js";
import { CAPACIDADE_FINANCEIRO_PELA_TOP, entendeCentralFinanceira, entendeFinanceiroPelaTop } from "../src/financeiro-capacidade.js";
import { SITUACOES_TITULO, SITUACOES_TITULO_DA_LISTA, situacaoDoTitulo } from "../src/financeiro-situacao.js";
import { ROTULOS_FINANCEIRO, rotuloFinanceiro } from "../src/financeiro-rotulos.js";
import { TITLE_STATUS_LABELS, displayTitleStatus } from "../src/financial.js";
import { CODIGOS_TIPO_OPERACAO, resolverTipoOperacao, tipoOperacao, validarRegistroTipoOperacao } from "../src/tipo-operacao.js";
import { CATALOGO_TIPOS_MOVIMENTO_TOP, normalizarPeloPerfilTop, perfilDaFamiliaTop, recusasDoPerfilTop, tiposParaEscolhaTop, CATALOGO_TOP } from "../src/tipo-operacao-catalogo.js";
import { familiaOperacionalDeDocumentoCompra, familiaOperacionalDeDocumentoVenda } from "../src/tipo-operacao-configurado.js";
import { getResource } from "../src/resources/index.js";
import { allPermissionKeys } from "../src/permissions.js";
import { moduloDaPermissao, validarClassificacaoEscopo } from "../src/escopo-permissao.js";
import { DICIONARIO_DE_DADOS } from "../dicionario-dados.mjs";

/**
 * OPERACOES-01 F9a (decisão 286) — O FINANCEIRO PELA TOP, NO DOMÍNIO.
 *
 * F9-S  a seção `financeiroPadrao` do formato 5: neutro = hoje; leitura estrita; normalizar idempotente; as 10 famílias
 *       (as 8 da F9 e a compra e a venda de animais da F10r);
 *       recusada nos formatos 1 a 4 e lida no neutro; a recusa por família (provisão e "exigir").
 * F9-P  o perfil dos padrões por família (a matriz), as regras de provisão (as duas executam; a do pedido de compra desde a F9b).
 * F9-C  a classificação (documento → TOP → exigir → legado) e a troca dos padrões.
 * F9-A  o alvo da provisão e as parcelas.
 * F9-K  as capacidades (financeiro pela TOP, LCDPR), o previsto como situação e os rótulos.
 * F9-R  o registry (a família do movimento bancário), o catálogo, o cadastro do imóvel, as permissões e o dicionário.
 *
 * Os códigos de família aparecem LITERAIS aqui de propósito (o teste confere a derivação; o runtime os pergunta ao
 * registry — `familia-operacional-ssot-audit`). Cada caso afirma a PREMISSA ao lado da conclusão.
 */

const PEDIDO_VENDA = "vendas.pedido";
const VENDA = "vendas.venda";
const ORCAMENTO_VENDA = "vendas.orcamento";
const A_RECEBER = "financeiro.conta_a_receber";
const A_PAGAR = "financeiro.conta_a_pagar";
const MOVIMENTO = "financeiro.movimento_bancario";
const SOLICITACAO = "compras.solicitacao";
const PEDIDO_COMPRA = "compras.pedido";
const COMPRA = "compras.compra";
// OPERACOES-01 F10r (decisão 287): a compra e a venda de animais (o título do movimento de animais).
const COMPRA_ANIMAIS = "pecuaria.compra_de_animais";
const VENDA_ANIMAIS = "pecuaria.venda_de_animais";
const AS_DEZ = [PEDIDO_VENDA, VENDA, A_RECEBER, A_PAGAR, MOVIMENTO, SOLICITACAO, PEDIDO_COMPRA, COMPRA, COMPRA_ANIMAIS, VENDA_ANIMAIS];

const NEUTRO: SecaoFinanceiroPadrao = { provisao: false, documentoTroca: true, semClassificacao: "padrao_legado" };
const LIGADA: SecaoFinanceiroPadrao = { provisao: true, documentoTroca: false, semClassificacao: "exigir" };

const clonar = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
type Saco = Record<string, unknown>;

/** Um 5 bruto (JSON) com a seção `financeiroPadrao` como veio. */
const v5Com = (secao: unknown): Saco => ({ ...(clonar(configuracaoNeutraTopV5()) as unknown as Saco), financeiroPadrao: secao });

const recusasDe = (bruto: unknown): RecusaConfiguracaoTop[] => {
  const r = lerConfiguracaoTop(bruto);
  if (r.ok) throw new Error(`esperava recusa, o leitor aceitou: ${JSON.stringify(bruto)}`);
  return r.recusas;
};
const valorDe = (bruto: unknown): ConfiguracaoTipoOperacao => {
  const r = lerConfiguracaoTop(bruto);
  if (!r.ok) throw new Error(`esperava aceite, o leitor recusou: ${JSON.stringify(r.recusas)}`);
  return r.valor;
};
const secaoLida = (c: ConfiguracaoTipoOperacao): unknown => (c as unknown as Saco)["financeiroPadrao"];

// ---------------------------------------------------------------------------------------------------
// F9-S — a seção do formato 5
// ---------------------------------------------------------------------------------------------------

describe("F9-S a seção financeiroPadrao do formato 5", () => {
  it("F9-S1 está na lista do produto (pela mesma referência, também pelo índice) — o ciclo de import não a deixa vazia", () => {
    expect(DEFINICOES_SECOES_V5).toContain(SECAO_FINANCEIRO_PADRAO);
    expect(definicaoDaSecaoV5("financeiroPadrao")).toBe(SECAO_FINANCEIRO_PADRAO);
    expect(dominio.SECAO_FINANCEIRO_PADRAO).toBe(SECAO_FINANCEIRO_PADRAO);
    expect(dominio.DEFINICOES_SECOES_V5).toContain(SECAO_FINANCEIRO_PADRAO);
    expect(Object.isFrozen(SECAO_FINANCEIRO_PADRAO)).toBe(true);
    expect(SECAO_FINANCEIRO_PADRAO.nome).toBe("financeiroPadrao");
    expect(SECAO_FINANCEIRO_PADRAO.rotulo).toBe("Padrões financeiros");
    expect(SECAO_FINANCEIRO_PADRAO.ajuda).toBe(AJUDA_FINANCEIRO_PADRAO);
    expect([...SECAO_FINANCEIRO_PADRAO.chaves]).toEqual(["provisao", "documentoTroca", "semClassificacao"]);
  });

  it("F9-S2 o neutro é o comportamento de hoje (nenhuma provisão, o documento decide, a 1ª por código), objeto novo a cada chamada", () => {
    const a = SECAO_FINANCEIRO_PADRAO.neutro();
    expect(a).toEqual(NEUTRO);
    expect(a).not.toBe(SECAO_FINANCEIRO_PADRAO.neutro());
    expect(configuracaoNeutraTopV5().financeiroPadrao).toEqual(NEUTRO);
    expect([...SEM_CLASSIFICACAO_TOP]).toEqual(["padrao_legado", "exigir"]);
  });

  it("F9-S3 num 5: AUSENTE → o neutro (o 5 gravado na F4 continua legível); PRESENTE → lida como veio", () => {
    const semSecao = clonar(configuracaoNeutraTopV5()) as unknown as Saco;
    delete semSecao["financeiroPadrao"];
    expect(Object.hasOwn(semSecao, "financeiroPadrao"), "a premissa: o bruto não tem a chave").toBe(false);
    expect(secaoLida(valorDe(semSecao))).toEqual(NEUTRO);
    expect(secaoLida(valorDe(v5Com({ ...LIGADA })))).toEqual(LIGADA);
  });

  it("F9-S4 a leitura é ESTRITA: chave desconhecida, tipo errado, valor fora da lista, campo faltando, seção que não é objeto", () => {
    expect(recusasDe(v5Com({ ...NEUTRO, contaPadrao: "x" }))).toEqual([{ motivo: "campo_desconhecido", caminho: "financeiroPadrao.contaPadrao" }]);
    expect(recusasDe(v5Com({ ...NEUTRO, provisao: "sim" }))).toEqual([{ motivo: "tipo_invalido", caminho: "financeiroPadrao.provisao" }]);
    expect(recusasDe(v5Com({ ...NEUTRO, documentoTroca: 1 }))).toEqual([{ motivo: "tipo_invalido", caminho: "financeiroPadrao.documentoTroca" }]);
    expect(recusasDe(v5Com({ ...NEUTRO, semClassificacao: "primeira" }))).toEqual([{ motivo: "valor_invalido", caminho: "financeiroPadrao.semClassificacao" }]);
    expect(recusasDe(v5Com({ ...NEUTRO, semClassificacao: true }))).toEqual([{ motivo: "tipo_invalido", caminho: "financeiroPadrao.semClassificacao" }]);
    const { documentoTroca: _sem, ...semUmCampo } = NEUTRO;
    expect(recusasDe(v5Com(semUmCampo))).toEqual([{ motivo: "tipo_invalido", caminho: "financeiroPadrao.documentoTroca" }]);
    for (const secao of ["provisao", 1, null, [], true]) {
      expect(recusasDe(v5Com(secao)), JSON.stringify(secao)).toEqual([{ motivo: "tipo_invalido", caminho: "financeiroPadrao" }]);
    }
    // A premissa: o mesmo corpo com os valores certos é aceito.
    expect(secaoLida(valorDe(v5Com({ ...NEUTRO })))).toEqual(NEUTRO);
  });

  it("F9-S5 normalizar é cópia idempotente que não muta nem aponta para a entrada", () => {
    const entrada = Object.freeze({ ...LIGADA });
    const n = SECAO_FINANCEIRO_PADRAO.normalizar(entrada);
    expect(n).toEqual(LIGADA);
    expect(n).not.toBe(entrada);
    expect(SECAO_FINANCEIRO_PADRAO.normalizar(n)).toEqual(n);
    const c = normalizarConfiguracaoTop({ ...configuracaoNeutraTopV5(), financeiroPadrao: { ...LIGADA } });
    expect(c.versaoSchema).toBe(5);
    expect(secaoLida(c)).toEqual(LIGADA);
  });

  it("F9-S6 nos formatos 1 a 4 a chave é RECUSADA; a execução lê a seção no neutro (a versão antiga nunca provisiona)", () => {
    for (const c of [configuracaoNeutraTop(), configuracaoNeutraTopV2(), configuracaoNeutraTopV3(), configuracaoNeutraTopV4()]) {
      expect(recusasDe({ ...(clonar(c) as unknown as Saco), financeiroPadrao: { ...LIGADA } }), `formato ${c.versaoSchema}`)
        .toEqual([{ motivo: "campo_desconhecido", caminho: "financeiroPadrao" }]);
      expect(secoesExtensaoDaVersaoTop(c).financeiroPadrao, `formato ${c.versaoSchema}`).toEqual(NEUTRO);
    }
    // A premissa: no 5 a execução lê a seção dela, copiada.
    const v5 = valorDe(v5Com({ ...LIGADA }));
    const lida = secoesExtensaoDaVersaoTop(v5).financeiroPadrao;
    expect(lida).toEqual(LIGADA);
    expect(lida).not.toBe(secaoLida(v5));
  });

  it("F9-S7 a comparação e a auditoria enxergam a seção: o 4 salvo no 5 neutro é o mesmo; ligar é mudança em financeiroPadrao", () => {
    const v4 = configuracaoNeutraTopV4();
    expect(configuracoesTopIguais(v4, configuracaoNeutraTopV5())).toBe(true);
    const ligada = valorDe(v5Com({ ...NEUTRO, provisao: true }));
    expect(configuracoesTopIguais(v4, ligada)).toBe(false);
    expect(secoesAlteradasTop(v4, ligada)).toEqual(["financeiroPadrao"]);
  });

  it("F9-S8 usadaPor = exatamente as 10 famílias da matriz (perguntado ao registry; as duas de compras desde a F9b; as duas da pecuária desde a F10r)", () => {
    const usam = CODIGOS_TIPO_OPERACAO.filter((f) => SECAO_FINANCEIRO_PADRAO.usadaPor(f));
    expect(new Set(usam)).toEqual(new Set(AS_DEZ));
    expect(usam).toHaveLength(10);
    for (const f of [ORCAMENTO_VENDA, "compras.orcamento", "estoque.entrada", "frota_ativos.abastecimento", "", "vendas.devolucao"]) {
      expect(SECAO_FINANCEIRO_PADRAO.usadaPor(f), f).toBe(false);
    }
    // A premissa: as dez estão declaradas no registry.
    for (const f of AS_DEZ) expect(tipoOperacao(f), f).toBeDefined();
  });

  it("F9-S9 as linhas do histórico: três, com os rótulos e os valores em português", () => {
    expect(SECAO_FINANCEIRO_PADRAO.linhas(NEUTRO)).toEqual([
      ["Provisionar no pedido", "Não"],
      ["O documento troca os padrões", "Sim"],
      ["Sem natureza e centro", "Usar a 1ª natureza e o 1º centro por código (como hoje)"],
    ]);
    expect(SECAO_FINANCEIRO_PADRAO.linhas(LIGADA)).toEqual([
      ["Provisionar no pedido", "Sim"],
      ["O documento troca os padrões", "Não"],
      ["Sem natureza e centro", "Exigir natureza e centro (do documento ou desta TOP)"],
    ]);
    expect(Object.keys(ROTULOS_SEM_CLASSIFICACAO_TOP)).toEqual([...SEM_CLASSIFICACAO_TOP]);
  });

  it("F9-S10 recusas por família: a provisão só nos dois pedidos (venda e compra); \"exigir\" só onde o documento pode vir sem natureza e centro", () => {
    expect(recusasDoFinanceiroPadraoDaFamilia(PEDIDO_VENDA, LIGADA)).toEqual([]);
    const provisao = { motivo: "combinacao_nao_suportada", caminho: "financeiroPadrao.provisao", mensagem: MENSAGEM_PROVISAO_FORA_DA_FAMILIA };
    const exigir = { motivo: "combinacao_nao_suportada", caminho: "financeiroPadrao.semClassificacao", mensagem: MENSAGEM_EXIGIR_FORA_DA_FAMILIA };
    // F9b: o pedido de compra provisiona (só "exigir" é recusado: a compra não tem padrão legado); a compra, não.
    expect(recusasDoFinanceiroPadraoDaFamilia(PEDIDO_COMPRA, LIGADA)).toEqual([exigir]);
    expect(recusasDoFinanceiroPadraoDaFamilia(COMPRA, LIGADA)).toEqual([provisao, exigir]);
    expect(recusasDoFinanceiroPadraoDaFamilia(VENDA, LIGADA)).toEqual([provisao]);
    expect(recusasDoFinanceiroPadraoDaFamilia(SOLICITACAO, LIGADA)).toEqual([provisao]);
    for (const f of [A_PAGAR, A_RECEBER, MOVIMENTO]) expect(recusasDoFinanceiroPadraoDaFamilia(f, LIGADA), f).toEqual([provisao, exigir]);
    expect(recusasDoFinanceiroPadraoDaFamilia(MOVIMENTO, { ...NEUTRO, semClassificacao: "exigir" })).toEqual([exigir]);
    // O neutro nunca é recusado, em nenhuma das dez.
    for (const f of AS_DEZ) expect(recusasDoFinanceiroPadraoDaFamilia(f, NEUTRO), f).toEqual([]);
    // Família sem a seção: a recusa da seção inteira é do catálogo, não daqui.
    expect(recusasDoFinanceiroPadraoDaFamilia(ORCAMENTO_VENDA, LIGADA)).toEqual([]);
    expect(MENSAGEM_PROVISAO_FORA_DA_FAMILIA).toBe("A provisão vale só no pedido de venda e no pedido de compra.");
    expect(MENSAGEM_EXIGIR_FORA_DA_FAMILIA).toBe(
      "O lançamento desta operação sempre informa natureza e centro: deixe \"Usar a 1ª natureza e o 1º centro por código (como hoje)\".",
    );
  });

  it("F9-S11 o catálogo recusa a seção fora do neutro numa família que não a usa, e a volta ao padrão a desliga", () => {
    const ligada = valorDe(v5Com({ ...NEUTRO, provisao: true }));
    const mensagem = "Esta operação não usa a seção Padrões financeiros.";
    expect(recusasDoPerfilTop(ORCAMENTO_VENDA, ligada)).toEqual([{ motivo: "combinacao_nao_suportada", caminho: "financeiroPadrao", mensagem }]);
    expect(recusasDoPerfilTop(PEDIDO_VENDA, ligada), "a premissa: no pedido a seção vale").toEqual([]);
    const perfilOrcamento = perfilDaFamiliaTop(ORCAMENTO_VENDA);
    if (!perfilOrcamento || ligada.versaoSchema !== 5) throw new Error("premissa: perfil do orçamento e um 5");
    const { configuracao, voltaram } = normalizarPeloPerfilTop(perfilOrcamento, ligada);
    expect(configuracao.financeiroPadrao).toEqual(NEUTRO);
    expect(voltaram).toEqual([{ caminho: "financeiroPadrao", texto: "Padrões financeiros: volta ao padrão" }]);
  });
});

// ---------------------------------------------------------------------------------------------------
// F9-P — o perfil dos padrões e as regras de provisão
// ---------------------------------------------------------------------------------------------------

describe("F9-P o perfil dos padrões por família e as regras de provisão", () => {
  it("F9-P1 as famílias da matriz saem do registry (premissa da derivação)", () => {
    expect(familiaOperacionalDeDocumentoVenda("order")).toBe(PEDIDO_VENDA);
    expect(familiaOperacionalDeDocumentoVenda("sale")).toBe(VENDA);
    expect(resolverTipoOperacao("erp.financial_titles", "receivable")?.codigo).toBe(A_RECEBER);
    expect(resolverTipoOperacao("erp.financial_titles", "payable")?.codigo).toBe(A_PAGAR);
    expect(resolverTipoOperacao("erp.bank_movements")?.codigo).toBe(MOVIMENTO);
    expect(resolverTipoOperacao("erp.purchase_requests")?.codigo).toBe(SOLICITACAO);
    expect(familiaOperacionalDeDocumentoCompra("pedido")).toBe(PEDIDO_COMPRA);
  });

  it("F9-P2 a matriz inteira", () => {
    const todos = [...CAMPOS_PADRAO_FINANCEIRO];
    const doTitulo = ["natureza", "centro", "tipoTitulo", "conta"];
    expect(perfilDosPadroesFinanceiros(PEDIDO_VENDA)).toEqual({ provisao: true, semClassificacao: true, trocaPeloDocumento: true, campos: todos, naturezas: ["income", "both"] });
    expect(perfilDosPadroesFinanceiros(VENDA)).toEqual({ provisao: false, semClassificacao: true, trocaPeloDocumento: true, campos: todos, naturezas: ["income", "both"] });
    expect(perfilDosPadroesFinanceiros(A_RECEBER)).toEqual({ provisao: false, semClassificacao: false, trocaPeloDocumento: true, campos: doTitulo, naturezas: ["income", "both"] });
    expect(perfilDosPadroesFinanceiros(A_PAGAR)).toEqual({ provisao: false, semClassificacao: false, trocaPeloDocumento: true, campos: doTitulo, naturezas: ["expense", "both"] });
    expect(perfilDosPadroesFinanceiros(MOVIMENTO)).toEqual({ provisao: false, semClassificacao: false, trocaPeloDocumento: true, campos: ["natureza", "centro", "conta"], naturezas: ["income", "expense", "both"] });
    // A solicitação não informa nenhum padrão no documento: a regra "o documento troca" não tem efeito nela.
    expect(perfilDosPadroesFinanceiros(SOLICITACAO)).toEqual({ provisao: false, semClassificacao: true, trocaPeloDocumento: false, campos: doTitulo, naturezas: ["expense", "both"] });
    // F9b: o pedido de compra (provisão a pagar ao finalizar) e a compra — sem "sem natureza e centro" (não há legado).
    expect(familiaOperacionalDeDocumentoCompra("compra"), "premissa: a compra pelo registry").toBe(COMPRA);
    expect(perfilDosPadroesFinanceiros(PEDIDO_COMPRA)).toEqual({ provisao: true, semClassificacao: false, trocaPeloDocumento: true, campos: todos, naturezas: ["expense", "both"] });
    expect(perfilDosPadroesFinanceiros(COMPRA)).toEqual({ provisao: false, semClassificacao: false, trocaPeloDocumento: true, campos: todos, naturezas: ["expense", "both"] });
    // F10r: a compra e a venda de animais — "sem natureza e centro" vale (há o padrão legado do movimento), o documento
    // troca (informa natureza e centro), sem forma de pagamento (o movimento não tem forma) e sem provisão.
    expect(resolverTipoOperacao("erp.animal_movements", "purchase")?.codigo, "premissa: a compra de animais pelo registry").toBe(COMPRA_ANIMAIS);
    expect(resolverTipoOperacao("erp.animal_movements", "sale")?.codigo, "premissa: a venda de animais pelo registry").toBe(VENDA_ANIMAIS);
    expect(perfilDosPadroesFinanceiros(COMPRA_ANIMAIS)).toEqual({ provisao: false, semClassificacao: true, trocaPeloDocumento: true, campos: doTitulo, naturezas: ["expense", "both"] });
    expect(perfilDosPadroesFinanceiros(VENDA_ANIMAIS)).toEqual({ provisao: false, semClassificacao: true, trocaPeloDocumento: true, campos: doTitulo, naturezas: ["income", "both"] });
    expect([...CAMPOS_PADRAO_FINANCEIRO]).toEqual(["natureza", "centro", "tipoTitulo", "formaPagamento", "conta"]);
  });

  it("F9-P3 as outras famílias não têm perfil — o orçamento de compra inclusive", () => {
    for (const f of CODIGOS_TIPO_OPERACAO.filter((x) => !AS_DEZ.includes(x))) {
      expect(perfilDosPadroesFinanceiros(f), f).toBeNull();
      expect(familiaUsaPadroesFinanceiros(f), f).toBe(false);
    }
    expect(perfilDosPadroesFinanceiros("compras.orcamento")).toBeNull();
    expect(perfilDosPadroesFinanceiros("vendas.devolucao")).toBeNull();
    expect(perfilDosPadroesFinanceiros("")).toBeNull();
    // A premissa: o orçamento de compra existe no registry (a ausência de perfil é escolha, não falta de família).
    expect(tipoOperacao("compras.orcamento")).toBeDefined();
  });

  it("F9-P4 as regras de provisão: o pedido de venda (ao salvar) e o pedido de compra finalizado (ao finalizar, F9b) — as duas executam", () => {
    expect(REGRAS_DE_PROVISAO).toEqual([
      { familia: PEDIDO_VENDA, direcao: "receivable", momento: "ao_salvar_o_pedido", executa: true },
      { familia: PEDIDO_COMPRA, direcao: "payable", momento: "ao_finalizar_o_pedido", executa: true },
    ]);
    expect(Object.isFrozen(REGRAS_DE_PROVISAO)).toBe(true);
    expect(regraDeProvisaoDaFamilia(PEDIDO_COMPRA)?.executa).toBe(true);
    expect(provisaoExecutavelNaFamilia(PEDIDO_VENDA)).toBe(true);
    expect(provisaoExecutavelNaFamilia(PEDIDO_COMPRA)).toBe(true);
    for (const f of [VENDA, ORCAMENTO_VENDA, COMPRA, A_PAGAR, "vendas.devolucao"]) {
      expect(regraDeProvisaoDaFamilia(f), f).toBeUndefined();
      expect(provisaoExecutavelNaFamilia(f), f).toBe(false);
    }
  });

  it("F9-P5 os padrões vazios: todos nulos, objeto novo", () => {
    const a = padroesFinanceirosVazios();
    expect(a).toEqual({ naturezaId: null, centroCustoId: null, tipoTituloId: null, formaPagamentoId: null, contaBancariaId: null });
    expect(a).not.toBe(padroesFinanceirosVazios());
  });
});

// ---------------------------------------------------------------------------------------------------
// F9-C — a classificação e a troca dos padrões
// ---------------------------------------------------------------------------------------------------

const N1 = "11111111-1111-4111-8111-111111111111";
const N2 = "22222222-2222-4222-8222-222222222222";
const C1 = "33333333-3333-4333-8333-333333333333";
const C2 = "44444444-4444-4444-8444-444444444444";
const T1 = "55555555-5555-4555-8555-555555555555";
const F1 = "66666666-6666-4666-8666-666666666666";
const K1 = "77777777-7777-4777-8777-777777777777";
const NULOS = { naturezaId: null, centroCustoId: null };

describe("F9-C a classificação (documento → TOP → exigir → legado)", () => {
  it("F9-C1 o documento com os DOIS vence, mesmo com o padrão da TOP e com \"exigir\"", () => {
    for (const semClassificacao of SEM_CLASSIFICACAO_TOP) {
      expect(planoDaClassificacao({ documento: { naturezaId: N1, centroCustoId: C1 }, padrao: { naturezaId: N2, centroCustoId: C2 }, semClassificacao }))
        .toEqual({ tipo: "pronta", naturezaId: N1, centroCustoId: C1, origem: "documento" });
    }
  });

  it("F9-C2 sem o documento, a TOP com os DOIS → o padrão da TOP (ids em minúsculas)", () => {
    expect(planoDaClassificacao({ documento: NULOS, padrao: { naturezaId: N2.toUpperCase(), centroCustoId: ` ${C2.toUpperCase()} ` }, semClassificacao: "exigir" }))
      .toEqual({ tipo: "pronta", naturezaId: N2, centroCustoId: C2, origem: "padrão da TOP" });
    expect(planoDaClassificacao({ documento: { naturezaId: N1.toUpperCase(), centroCustoId: C1.toUpperCase() }, padrao: null, semClassificacao: "padrao_legado" }))
      .toEqual({ tipo: "pronta", naturezaId: N1, centroCustoId: C1, origem: "documento" });
  });

  it("F9-C3 o documento PARCIAL vale como sem documento", () => {
    expect(planoDaClassificacao({ documento: { naturezaId: N1, centroCustoId: null }, padrao: { naturezaId: N2, centroCustoId: C2 }, semClassificacao: "padrao_legado" }))
      .toEqual({ tipo: "pronta", naturezaId: N2, centroCustoId: C2, origem: "padrão da TOP" });
    expect(planoDaClassificacao({ documento: { naturezaId: "", centroCustoId: C1 }, padrao: null, semClassificacao: "padrao_legado" }))
      .toEqual({ tipo: "legado", naturezaId: null, centroCustoId: null });
  });

  it("F9-C4 \"exigir\" sem o par → recusa dizendo o que falta NA TOP", () => {
    expect(planoDaClassificacao({ documento: NULOS, padrao: null, semClassificacao: "exigir" })).toEqual({ tipo: "exigir", faltam: ["natureza", "centro"] });
    expect(planoDaClassificacao({ documento: NULOS, padrao: { naturezaId: N2, centroCustoId: null }, semClassificacao: "exigir" })).toEqual({ tipo: "exigir", faltam: ["centro"] });
    expect(planoDaClassificacao({ documento: NULOS, padrao: { naturezaId: null, centroCustoId: C2 }, semClassificacao: "exigir" })).toEqual({ tipo: "exigir", faltam: ["natureza"] });
    expect(MENSAGEM_EXIGE_CLASSIFICACAO).toBe("A operação exige natureza e centro de resultado: informe no documento ou configure os padrões da TOP.");
  });

  it("F9-C5 o padrão legado (o de hoje) completa com o que a TOP tiver; sem TOP, os dois campos são o legado", () => {
    expect(planoDaClassificacao({ documento: NULOS, padrao: null, semClassificacao: "padrao_legado" })).toEqual({ tipo: "legado", naturezaId: null, centroCustoId: null });
    expect(planoDaClassificacao({ documento: NULOS, padrao: { naturezaId: N2, centroCustoId: null }, semClassificacao: "padrao_legado" }))
      .toEqual({ tipo: "legado", naturezaId: N2, centroCustoId: null });
  });
});

describe("F9-C a troca dos padrões (documentoTroca desligado)", () => {
  const padroes: PadroesFinanceirosTop = { naturezaId: N1, centroCustoId: C1, tipoTituloId: T1, formaPagamentoId: F1, contaBancariaId: K1 };

  it("F9-C6 o mesmo valor (em outra caixa) e o vazio NÃO são troca", () => {
    expect(camposTrocadosDosPadroes(padroes, {})).toEqual([]);
    expect(camposTrocadosDosPadroes(padroes, {
      naturezaIds: [N1.toUpperCase(), null, ""], centroCustoIds: [C1], tipoTituloId: null, formaPagamentoId: "", contaBancariaId: K1.toUpperCase(),
    })).toEqual([]);
  });

  it("F9-C7 cada campo diferente, na ordem fixa (natureza, centro, tipo de título, forma, conta)", () => {
    expect(camposTrocadosDosPadroes(padroes, {
      contaBancariaId: N2, formaPagamentoId: N2, tipoTituloId: N2, centroCustoIds: [C1, C2], naturezaIds: [N2],
    })).toEqual(["natureza", "centro", "tipoTitulo", "formaPagamento", "conta"]);
    // Uma linha do rateio diferente basta.
    expect(camposTrocadosDosPadroes(padroes, { naturezaIds: [N1, N2] })).toEqual(["natureza"]);
  });

  it("F9-C8 padrão AUSENTE na TOP nunca é troca: o documento decide", () => {
    expect(camposTrocadosDosPadroes(padroesFinanceirosVazios(), { naturezaIds: [N2], centroCustoIds: [C2], tipoTituloId: T1, formaPagamentoId: F1, contaBancariaId: K1 })).toEqual([]);
    // A premissa: com o padrão, o mesmo documento troca.
    expect(camposTrocadosDosPadroes({ ...padroesFinanceirosVazios(), naturezaId: N1 }, { naturezaIds: [N2] })).toEqual(["natureza"]);
  });

  it("F9-C9 a mensagem: um, dois (com \"e\") e três ou mais (vírgulas e \"e\")", () => {
    expect(mensagemDosPadroesTrocados(["natureza"])).toBe("Esta operação não deixa trocar a natureza: use o padrão da TOP.");
    expect(mensagemDosPadroesTrocados(["natureza", "centro"])).toBe("Esta operação não deixa trocar a natureza e o centro de resultado: use o padrão da TOP.");
    expect(mensagemDosPadroesTrocados(["natureza", "centro", "conta"])).toBe("Esta operação não deixa trocar a natureza, o centro de resultado e a conta: use o padrão da TOP.");
    expect(mensagemDosPadroesTrocados(["tipoTitulo", "formaPagamento"])).toBe("Esta operação não deixa trocar o tipo de título e a forma de pagamento: use o padrão da TOP.");
    expect(mensagemDosPadroesTrocados([])).toBe("Esta operação não deixa trocar os padrões: use o padrão da TOP.");
  });
});

// ---------------------------------------------------------------------------------------------------
// F9-A — o alvo da provisão e as parcelas
// ---------------------------------------------------------------------------------------------------

describe("F9-A o alvo da provisão", () => {
  const base: EntradaDoAlvoDaProvisao = { provisaoLigada: true, cancelado: false, saldoEncerrado: false, totalDoDocumento: "1000.00", partes: [] };

  it("F9-A1 não ligada ou cancelado → 0.00 (premissa: o mesmo documento ligado e vivo prevê o total)", () => {
    expect(alvoDaProvisao(base)).toBe("1000.00");
    expect(alvoDaProvisao({ ...base, provisaoLigada: false })).toBe("0.00");
    expect(alvoDaProvisao({ ...base, cancelado: true })).toBe("0.00");
  });

  it("F9-A2 parte ABERTA não abate; parte CONFIRMADA abate; cancelada não conta", () => {
    expect(alvoDaProvisao({ ...base, partes: [{ total: "400", situacao: "aberta" }] })).toBe("1000.00");
    expect(alvoDaProvisao({ ...base, partes: [{ total: "400", situacao: "confirmada" }] })).toBe("600.00");
    expect(alvoDaProvisao({ ...base, partes: [{ total: "400", situacao: "cancelada" }] })).toBe("1000.00");
    expect(alvoDaProvisao({ ...base, totalDoDocumento: "0.30", partes: [{ total: "0.10", situacao: "confirmada" }, { total: "0.10", situacao: "confirmada" }] })).toBe("0.10");
  });

  it("F9-A3 saldo ENCERRADO: só o que foi gerado continua esperado (a parte aberta fica prevista; confirmada, sai)", () => {
    expect(alvoDaProvisao({ ...base, saldoEncerrado: true, partes: [{ total: "400", situacao: "aberta" }] })).toBe("400.00");
    expect(alvoDaProvisao({ ...base, saldoEncerrado: true, partes: [{ total: "400", situacao: "confirmada" }] })).toBe("0.00");
    expect(alvoDaProvisao({ ...base, saldoEncerrado: true, partes: [{ total: "400", situacao: "confirmada" }, { total: "250.50", situacao: "aberta" }, { total: "99", situacao: "cancelada" }] })).toBe("250.50");
    expect(alvoDaProvisao({ ...base, saldoEncerrado: true, partes: [] })).toBe("0.00");
  });

  it("F9-A4 nunca negativo: confirmado acima do total → 0.00", () => {
    expect(alvoDaProvisao({ ...base, partes: [{ total: "1200", situacao: "confirmada" }] })).toBe("0.00");
  });
});

describe("F9-A as parcelas previstas (o no-op da sincronização)", () => {
  it("F9-A5 o valor pelo VALOR e o vencimento pela data", () => {
    expect(mesmasParcelas([{ valor: "100", vencimento: "2026-11-01" }], [{ valor: "100.00", vencimento: "2026-11-01T00:00:00.000Z" }])).toBe(true);
    expect(mesmasParcelas([{ valor: "100", vencimento: "2026-11-01" }], [{ valor: "100.01", vencimento: "2026-11-01" }])).toBe(false);
    expect(mesmasParcelas([{ valor: "100", vencimento: "2026-11-01" }], [{ valor: "100", vencimento: "2026-11-02" }])).toBe(false);
  });

  it("F9-A6 multiconjunto: a ordem não importa, a repetição conta, o tamanho conta; valor que não é número nunca é igual", () => {
    const a = [{ valor: "500", vencimento: "2026-11-01" }, { valor: "500", vencimento: "2026-12-01" }];
    expect(mesmasParcelas(a, [...a].reverse())).toBe(true);
    expect(mesmasParcelas(a, [a[0]!, a[0]!])).toBe(false);
    expect(mesmasParcelas(a, a.slice(0, 1))).toBe(false);
    expect(mesmasParcelas([], [])).toBe(true);
    expect(mesmasParcelas([{ valor: "x", vencimento: "2026-11-01" }], [{ valor: "x", vencimento: "2026-11-01" }])).toBe(false);
  });

  it("F9-A7 os motivos da trilha do previsto cancelado", () => {
    expect(MOTIVOS_DA_PROVISAO.pedidoGravado).toBe("Pedido alterado");
    expect(MOTIVOS_DA_PROVISAO.faturado("000012")).toBe("Faturado na venda 000012");
    expect(MOTIVOS_DA_PROVISAO.vendaCancelada("000012")).toBe("Venda 000012 cancelada");
    expect(MOTIVOS_DA_PROVISAO.saldoEncerrado("cliente desistiu")).toBe("Saldo do pedido encerrado: cliente desistiu");
    expect(MOTIVOS_DA_PROVISAO.pedidoCancelado("sem estoque")).toBe("Pedido cancelado: sem estoque");
    expect(MOTIVOS_DA_PROVISAO.pedidoCancelado(null)).toBe("Pedido cancelado");
    expect(MOTIVOS_DA_PROVISAO.pedidoCancelado("  ")).toBe("Pedido cancelado");
    expect(MOTIVOS_DA_PROVISAO.semProvisao).toBe("A operação do pedido não provisiona mais");
  });
});

// ---------------------------------------------------------------------------------------------------
// F9-K — capacidades, o previsto e os rótulos
// ---------------------------------------------------------------------------------------------------

describe("F9-K as capacidades, o previsto e os rótulos", () => {
  it("F9-K1 financeiro pela TOP: só com a Central E financeiroPelaTop === 1 (o número)", () => {
    expect(CAPACIDADE_FINANCEIRO_PELA_TOP).toBe(1);
    expect(entendeFinanceiroPelaTop({ centralFinanceira: 1, financeiroPelaTop: 1 })).toBe(true);
    // A premissa: a resposta da F8 entende a Central, mas não o financeiro pela TOP.
    expect(entendeCentralFinanceira({ centralFinanceira: 1 })).toBe(true);
    expect(entendeFinanceiroPelaTop({ centralFinanceira: 1 })).toBe(false);
    for (const r of [{ centralFinanceira: 1, financeiroPelaTop: "1" }, { centralFinanceira: 1, financeiroPelaTop: 2 }, { financeiroPelaTop: 1 },
      { centralFinanceira: 2, financeiroPelaTop: 1 }, null, undefined, [], "1", [{ centralFinanceira: 1, financeiroPelaTop: 1 }]]) {
      expect(entendeFinanceiroPelaTop(r), JSON.stringify(r)).toBe(false);
    }
  });

  it("F9-K2 LCDPR: só um objeto com lcdpr === 1 (o número)", () => {
    expect(CAPACIDADE_LCDPR).toBe(1);
    expect(entendeLcdpr({ lcdpr: 1, consultaCnpjJanela: 1 })).toBe(true);
    for (const c of [{ lcdpr: "1" }, { lcdpr: 2 }, { lcdpr: true }, {}, null, undefined, [], [1], "lcdpr"]) {
      expect(entendeLcdpr(c), JSON.stringify(c)).toBe(false);
    }
  });

  it("F9-K3 o previsto: situação \"previsto\", status \"Prevista\" (nunca vencida), fora da lista padrão", () => {
    expect(situacaoDoTitulo({ status: "previsto", dueDate: "2020-01-01" }, "2026-10-02")).toBe("previsto");
    expect(displayTitleStatus({ status: "previsto", dueDate: "2020-01-01", paymentType: "single" }, "2026-10-02")).toBe("Prevista");
    // A premissa: o aberto com a mesma data é "Vencida".
    expect(displayTitleStatus({ status: "open", dueDate: "2020-01-01", paymentType: "single" }, "2026-10-02")).toBe("Vencida");
    expect(TITLE_STATUS_LABELS.previsto).toBe("Prevista");
    expect(dominio.enumLabel("title_status", "previsto")).toBe("Prevista");
    expect([...SITUACOES_TITULO_DA_LISTA]).toEqual(["a_vencer", "vencido", "parcial", "baixado"]);
    expect(SITUACOES_TITULO).toContain("previsto");
    expect(SITUACOES_TITULO).toContain("cancelado");
    expect(Object.isFrozen(SITUACOES_TITULO_DA_LISTA)).toBe(true);
  });

  it("F9-K4 os rótulos novos do financeiro: o motivo do lote, o tipo no LCDPR, a exploração e a conferência", () => {
    expect(rotuloFinanceiro("motivo_lote", "previsto")).toBe("Título previsto: muda pelo documento de origem");
    expect(rotuloFinanceiro("tipo_lcdpr", "receita")).toBe("1 — Receita da atividade rural");
    expect(rotuloFinanceiro("tipo_lcdpr", "custeio_investimento")).toBe("2 — Despesa de custeio e investimento");
    expect(rotuloFinanceiro("tipo_lcdpr", "produto_adiantado")).toBe("3 — Produto entregue de adiantamento");
    expect(rotuloFinanceiro("tipo_lcdpr", "fora")).toBe("Fora do LCDPR");
    expect(rotuloFinanceiro("tipo_lcdpr", "outro")).toBe("Desconhecido");
    expect(rotuloFinanceiro("tipo_lcdpr", null)).toBe("Não informado");
    expect(rotuloFinanceiro("tipo_exploracao", "arrendado")).toBe("3 — Imóvel arrendado");
    expect(rotuloFinanceiro("situacao_conferencia_lcdpr", "pendentes")).toBe("Pendentes");
    // Um texto só: o rótulo é o da opção do cadastro.
    expect(Object.entries(ROTULOS_FINANCEIRO.tipo_lcdpr)).toEqual(OPCOES_TIPO_LCDPR.map(([v, r]) => [v, r]));
    expect(Object.entries(ROTULOS_FINANCEIRO.tipo_exploracao)).toEqual(OPCOES_TIPO_EXPLORACAO.map(([v, r]) => [v, r]));
    expect(Object.keys(ROTULOS_FINANCEIRO.situacao_conferencia_lcdpr)).toEqual([...SITUACOES_CONFERENCIA_LCDPR]);
  });

  it("F9-K5 o LCDPR: os tipos, os códigos do livro (o \"fora\" não tem) e a exploração 1 a 6", () => {
    expect([...TIPOS_LCDPR]).toEqual(["receita", "custeio_investimento", "produto_adiantado", "fora"]);
    expect(OPCOES_TIPO_LCDPR.map(([v]) => v)).toEqual([...TIPOS_LCDPR]);
    expect(CODIGO_DO_TIPO_LCDPR).toEqual({ receita: 1, custeio_investimento: 2, produto_adiantado: 3 });
    expect(Object.hasOwn(CODIGO_DO_TIPO_LCDPR, "fora")).toBe(false);
    // A lista dos tipos do livro (a da conferência na API) é a dos códigos, na ordem 1, 2, 3; com o "fora", a do banco.
    expect(TIPOS_LCDPR_NO_LIVRO.map((t) => CODIGO_DO_TIPO_LCDPR[t])).toEqual([1, 2, 3]);
    expect(Object.keys(CODIGO_DO_TIPO_LCDPR).sort()).toEqual([...TIPOS_LCDPR_NO_LIVRO].sort());
    expect([...TIPOS_LCDPR]).toEqual([...TIPOS_LCDPR_NO_LIVRO, TIPO_LCDPR_FORA]);
    expect([...TIPOS_EXPLORACAO_IMOVEL]).toEqual(["individual", "condominio", "arrendado", "parceria", "comodato", "outros"]);
    expect(OPCOES_TIPO_EXPLORACAO.map(([v]) => v)).toEqual([...TIPOS_EXPLORACAO_IMOVEL]);
    expect(TIPOS_EXPLORACAO_IMOVEL.map(codigoDoTipoExploracao)).toEqual([1, 2, 3, 4, 5, 6]);
    // O rótulo começa pelo código do livro (o que o usuário confere com o arquivo oficial).
    for (const [v, r] of OPCOES_TIPO_EXPLORACAO) expect(r.startsWith(`${codigoDoTipoExploracao(v)} — `), v).toBe(true);
    expect(PERIODO_MAXIMO_CONFERENCIA_LCDPR_DIAS).toBe(366);
    expect([...SITUACOES_CONFERENCIA_LCDPR]).toEqual(["conferidas", "pendentes"]);
  });

  it("F9-K6 o barril do índice publica a provisão, os padrões e o LCDPR", () => {
    expect(dominio.alvoDaProvisao).toBe(alvoDaProvisao);
    expect(dominio.planoDaClassificacao).toBe(planoDaClassificacao);
    expect(dominio.entendeLcdpr).toBe(entendeLcdpr);
    expect(dominio.entendeFinanceiroPelaTop).toBe(entendeFinanceiroPelaTop);
    expect(dominio.recusasDoFinanceiroPadraoDaFamilia).toBe(recusasDoFinanceiroPadraoDaFamilia);
  });
});

// ---------------------------------------------------------------------------------------------------
// F9-R — registry, catálogo, cadastro, permissões e dicionário
// ---------------------------------------------------------------------------------------------------

describe("F9-R a família do movimento bancário, o catálogo, o imóvel rural e as permissões", () => {
  it("F9-R1 o movimento bancário é uma família (a tabela inteira), com rótulo, e o registry continua íntegro", () => {
    const t = tipoOperacao(MOVIMENTO);
    expect(t).toEqual({ codigo: MOVIMENTO, modulo: "financeiro", chaveI18n: "top.financeiro.movimento_bancario", origem: { tabela: "erp.bank_movements" } });
    expect(resolverTipoOperacao("erp.bank_movements", "qualquer")?.codigo, "tabela sem variante ignora o valor").toBe(MOVIMENTO);
    expect(validarRegistroTipoOperacao()).toEqual([]);
    expect(CODIGOS_TIPO_OPERACAO.indexOf(MOVIMENTO), "logo depois da conta a receber").toBe(CODIGOS_TIPO_OPERACAO.indexOf(A_RECEBER) + 1);
  });

  it("F9-R2 os 3 tipos do Financeiro têm tela e família; o passo 1 os oferece no grupo Financeiro", () => {
    const fin = CATALOGO_TIPOS_MOVIMENTO_TOP.filter((x) => x.grupo === "financeiro");
    expect(fin.map((x) => [x.chave, x.familia, x.temTela])).toEqual([
      ["conta_pagar", A_PAGAR, true], ["conta_receber", A_RECEBER, true], ["movimento_bancario", MOVIMENTO, true],
    ]);
    expect(tiposParaEscolhaTop(CATALOGO_TOP).find((g) => g.grupo.chave === "financeiro")?.tipos.map((x) => x.chave))
      .toEqual(["conta_pagar", "conta_receber", "movimento_bancario"]);
    // Cada um tem perfil, e a aba "Padrões financeiros" aparece nele.
    for (const f of [A_PAGAR, A_RECEBER, MOVIMENTO]) expect(perfilDaFamiliaTop(f)?.abas, f).toContain("financeiroPadrao");
  });

  it("F9-R3 o cadastro do imóvel rural: por empresa, os campos do LCDPR, a permissão própria", () => {
    const r = getResource("imoveis_rurais");
    if (!r) throw new Error("premissa: o recurso existe");
    expect({ table: r.table, permission: r.permission, labelField: r.labelField, softDelete: r.softDelete, empresaScoped: r.empresaScoped, defaultSort: r.defaultSort })
      .toEqual({ table: "imoveis_rurais", permission: "imoveis_rurais", labelField: "nome", softDelete: true, empresaScoped: true, defaultSort: "nome" });
    expect(r.label).toBe("Imóvel rural");
    expect(r.labelPlural).toBe("Imóveis rurais");
    expect(r.fields.map((f) => f.name)).toEqual(["empresa_id", "nome", "cib", "caepf", "inscricao_estadual", "tipo_exploracao", "participacao", "padrao", "is_active"]);
    const f = (n: string) => r.fields.find((x) => x.name === n)!;
    expect(f("empresa_id")).toMatchObject({ type: "ref", ref: { resource: "empresas" }, required: true });
    expect(f("nome")).toMatchObject({ required: true, maxLength: 120 });
    expect(f("tipo_exploracao").options?.map((o) => o.value)).toEqual([...TIPOS_EXPLORACAO_IMOVEL]);
    expect(f("tipo_exploracao")).toMatchObject({ required: true, default: "individual" });
    expect(f("participacao")).toMatchObject({ type: "percent", required: true, default: 100 });
    expect(f("padrao")).toMatchObject({ type: "boolean", default: false });
    // O formato do CIB (8 dígitos) e do CAEPF (14) — o mesmo do CHECK da 0045 —, com a mensagem da recusa.
    const cib = new RegExp(f("cib").padrao!.regex);
    const caepf = new RegExp(f("caepf").padrao!.regex);
    expect(["12345678"].every((v) => cib.test(v)) && !["1234567", "123456789", "1234567a"].some((v) => cib.test(v))).toBe(true);
    expect(caepf.test("12345678901234") && !caepf.test("1234567890123")).toBe(true);
    expect(f("cib").padrao!.mensagem).toBe("Informe os 8 dígitos do CIB (NIRF do ITR), só números.");
    // O CAEPF tem a mesma régua do parceiro (people).
    expect(f("caepf").padrao).toEqual(getResource("people")!.fields.find((x) => x.name === "caepf")!.padrao);
  });

  it("F9-R4 o tipo no LCDPR da natureza: as 4 opções, só com a API que declara a capacidade lcdpr 1", () => {
    const n = getResource("financial_categories")!;
    const campo = n.fields.find((x) => x.name === "tipo_lcdpr");
    if (!campo) throw new Error("premissa: o campo existe");
    expect(campo.type).toBe("select");
    expect(campo.exigeCapacidade).toEqual({ nome: "lcdpr", versao: 1 });
    expect(campo.required).toBeUndefined();
    expect(campo.options).toEqual(OPCOES_TIPO_LCDPR.map(([value, label]) => ({ value, label })));
    // A premissa: é logo depois do grupo do DRE, e nenhum outro campo da natureza depende da capacidade.
    const nomes = n.fields.map((x) => x.name);
    expect(nomes.indexOf("tipo_lcdpr")).toBe(nomes.indexOf("grupo_dre") + 1);
    expect(n.fields.filter((x) => x.exigeCapacidade).map((x) => x.name)).toEqual(["tipo_lcdpr"]);
  });

  it("F9-R5 as permissões: imoveis_rurais.* no catálogo, no módulo financeiro (escopo de empresa), classificação íntegra", () => {
    const chaves = allPermissionKeys();
    for (const a of ["view", "create", "edit", "delete"]) expect(chaves, a).toContain(`imoveis_rurais.${a}`);
    expect(moduloDaPermissao("imoveis_rurais.view")).toBe("financeiro");
    expect(moduloDaPermissao("imoveis_rurais")).toBe("financeiro");
    expect(validarClassificacaoEscopo()).toEqual([]);
  });

  it("F9-R6 o dicionário: o movimento bancário classificado pela TOP; o imóvel rural e os padrões da versão declarados", () => {
    const porTabela = new Map(DICIONARIO_DE_DADOS.map((e) => [e.tabela, e]));
    expect(porTabela.get("erp.bank_movements")?.top).toBe(MOVIMENTO);
    expect(porTabela.get("erp.imoveis_rurais")).toMatchObject({ codigo: "ERP-FINANCEIRO-IMOVEL-RURAL", modulo: "FINANCEIRO", natureza: "entidade", idGlobal: false });
    expect(porTabela.get("erp.tipos_operacao_versao_financeiro")).toMatchObject({ codigo: "ERP-FINANCEIRO-PADROES-TOP", modulo: "FINANCEIRO", natureza: "linha", idGlobal: false });
    // A premissa: a TOP do movimento não classifica outra entidade.
    // (`tops` existe no .mjs e não no .d.mts — a mesma leitura de `tipo-operacao.test.ts`.)
    const comTops = DICIONARIO_DE_DADOS as readonly { top?: string; tops?: readonly string[] }[];
    expect(comTops.filter((e) => e.top === MOVIMENTO || (e.tops ?? []).includes(MOVIMENTO))).toHaveLength(1);
  });
});
