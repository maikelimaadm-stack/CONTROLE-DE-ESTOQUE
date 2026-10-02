import { describe, it, expect } from "vitest";
import {
  MATRIZ_REGRAS_GERAIS_TOP,
  MENSAGEM_APROVACAO_NAO_EXIGIDA,
  MENSAGEM_APROVACAO_PENDENTE,
  MENSAGEM_APROVACAO_SO_DOCUMENTO_ABERTO,
  exigeAprovacao,
  lerMatrizRegrasGeraisTop,
  mensagemAprovacaoReprovada,
  normalizarRegrasGeraisDaFamiliaTop,
  regrasGeraisDaFamiliaTop,
  regrasGeraisDaVersaoTop,
  regrasGeraisQuePassamAValer,
  validarRegrasGeraisTop,
  type ItemMatrizRegrasGeraisTop,
  type RegrasGeraisDaVersao,
} from "../src/tipo-operacao-regras-gerais.js";
import {
  MODOS_CONFIRMACAO,
  POLITICAS_ALTERACAO,
  POLITICAS_APROVACAO,
  POLITICAS_DOCUMENTO_SEM_ITENS,
  configuracaoNeutraTop,
  configuracaoNeutraTopV2,
  configuracaoNeutraTopV3,
  configuracaoNeutraTopV4,
  versaoSchemaDaConfiguracaoTop,
  type ConfiguracaoTipoOperacao,
  type ConfiguracaoTipoOperacaoV4,
  type ModoConfirmacao,
  type PoliticaAlteracao,
  type PoliticaAprovacao,
  type PoliticaDocumentoSemItens,
} from "../src/tipo-operacao-configuracao.js";
import { CODIGOS_TIPO_OPERACAO } from "../src/tipo-operacao.js";

/**
 * TOP-CONFIG-08 (decisão 277) — A MATRIZ POR FAMÍLIA DAS REGRAS GERAIS E A LEITURA DA VERSÃO CONGELADA.
 *
 * A matriz é o portão da GRAVAÇÃO: cada família diz o que aceita, com o motivo exato que o editor mostra e a
 * API devolve no 422. A leitura da versão é o portão da EXECUÇÃO: só o formato 4 executa, e executa o que
 * foi gravado, sem a matriz. `exigeAprovacao` é a conta em decimal que o banco repete (paridade na integração).
 */

const clonar = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** Congela em profundidade: qualquer tentativa de mutar a entrada lança (módulo ESM = modo estrito). */
function congelar<T>(v: T): T {
  if (typeof v === "object" && v !== null) {
    for (const k of Object.keys(v)) congelar((v as Record<string, unknown>)[k]);
    Object.freeze(v);
  }
  return v;
}

interface Regras {
  confirmacao?: ModoConfirmacao;
  documentoSemItens?: PoliticaDocumentoSemItens;
  alteracao?: PoliticaAlteracao;
  politica?: PoliticaAprovacao;
  valorMinimo?: string | null;
}

/** Uma cópia da configuração com as quatro regras trocadas. "Por valor" sem valor explícito leva 1500.00. */
function comRegras<C extends ConfiguracaoTipoOperacao>(base: C, r: Regras): C {
  const c = clonar(base);
  if (r.confirmacao) c.geral.confirmacao = r.confirmacao;
  if (r.documentoSemItens) c.geral.documentoSemItens = r.documentoSemItens;
  if (r.alteracao) c.geral.alteracaoAposConfirmacao = r.alteracao;
  if (r.politica) {
    c.aprovacao.politica = r.politica;
    c.aprovacao.valorMinimo = r.politica === "por_valor" ? (r.valorMinimo === undefined ? "1500.00" : r.valorMinimo) : null;
  }
  return c;
}
const v4 = (r: Regras = {}): ConfiguracaoTipoOperacaoV4 => comRegras(configuracaoNeutraTopV4(), r);

// Os motivos — texto exato da seção 2 da especificação.
const SEM_DOCUMENTO = "Esta operação ainda não tem documento no sistema.";
const NAO_CONFIRMADO = "Este documento não é confirmado: ele é convertido ou recebido em outro.";
const SEM_ITENS_ESTOQUE = "Documento de estoque sem itens não movimenta nada.";
const SEM_ITENS_ORCAMENTO_PEDIDO = "Orçamento e pedido sem itens não têm o que converter nem receber.";
const ALTERACAO_VENDA = "Alterar uma venda confirmada ainda não tem execução: o estorno do estoque e os títulos não sabem refazer o documento. Cancele e lance outra.";
const ALTERACAO_COMPRA = "Alterar uma compra confirmada ainda não tem execução: a compra não tem edição. Cancele e lance outra.";
const ALTERACAO_ESTOQUE = "Documento de estoque confirmado não se altera: cancele e lance outro.";
const APROVACAO_VALOR_ESTOQUE = "O valor do documento de estoque só é conhecido na confirmação: use \"Sempre\".";
const APROVACAO_SEM_CONFIRMACAO = "A aprovação acontece antes da confirmação, e este documento não é confirmado.";

const linha = (
  familia: string,
  confirmacao: [ModoConfirmacao[], string | null],
  documentoSemItens: [PoliticaDocumentoSemItens[], string | null],
  alteracaoAposConfirmacao: [PoliticaAlteracao[], string | null],
  aprovacao: [PoliticaAprovacao[], string | null],
): ItemMatrizRegrasGeraisTop => ({
  familia,
  confirmacao: { aceitos: confirmacao[0], motivo: confirmacao[1] },
  documentoSemItens: { aceitos: documentoSemItens[0], motivo: documentoSemItens[1] },
  alteracaoAposConfirmacao: { aceitos: alteracaoAposConfirmacao[0], motivo: alteracaoAposConfirmacao[1] },
  aprovacao: { aceitos: aprovacao[0], motivo: aprovacao[1] },
});

const estoque = (familia: string) => linha(familia,
  [["manual", "automatica"], null], [["proibido"], SEM_ITENS_ESTOQUE], [["bloqueada"], ALTERACAO_ESTOQUE], [["nenhuma", "sempre"], APROVACAO_VALOR_ESTOQUE]);
const orcamentoOuPedido = (familia: string) => linha(familia,
  [["manual"], NAO_CONFIRMADO], [["proibido"], SEM_ITENS_ORCAMENTO_PEDIDO], [["bloqueada"], NAO_CONFIRMADO], [["nenhuma"], APROVACAO_SEM_CONFIRMACAO]);
const outra = (familia: string) => linha(familia,
  [["manual"], SEM_DOCUMENTO], [["proibido"], SEM_DOCUMENTO], [["bloqueada"], SEM_DOCUMENTO], [["nenhuma"], SEM_DOCUMENTO]);

/** A matriz esperada, linha por linha, na ordem da especificação. */
const ESPERADA: ItemMatrizRegrasGeraisTop[] = [
  linha("vendas.venda", [["manual", "automatica"], null], [["proibido", "permitido"], null], [["bloqueada"], ALTERACAO_VENDA], [["nenhuma", "sempre", "por_valor"], null]),
  linha("compras.compra", [["manual", "automatica"], null], [["proibido", "permitido"], null], [["bloqueada"], ALTERACAO_COMPRA], [["nenhuma", "sempre", "por_valor"], null]),
  estoque("estoque.entrada"),
  estoque("estoque.saida"),
  estoque("estoque.transferencia"),
  estoque("estoque.ajuste"),
  orcamentoOuPedido("vendas.orcamento"),
  orcamentoOuPedido("vendas.pedido"),
  orcamentoOuPedido("compras.pedido"),
];

/** "Outra família": as 8 antigas de estoque, a solicitação de compra e o financeiro. */
const OUTRAS = [
  "estoque.entrada_manual",
  "estoque.documento_fiscal",
  "estoque.requisicao",
  "estoque.baixa",
  "estoque.devolucao",
  "estoque.transferencia_entre_armazens",
  "estoque.transferencia_entre_empresas",
  "estoque.producao_de_racao",
  "compras.solicitacao",
  "financeiro.conta_a_pagar",
  "financeiro.conta_a_receber",
];

describe("TOP-CONFIG-08 — a matriz por família (MATRIZ_REGRAS_GERAIS_TOP)", () => {
  it("tem exatamente as 9 famílias, na ordem, com os aceitos e os motivos exatos", () => {
    expect(MATRIZ_REGRAS_GERAIS_TOP.map((m) => m.familia)).toEqual(ESPERADA.map((m) => m.familia));
    expect(clonar(MATRIZ_REGRAS_GERAIS_TOP)).toEqual(ESPERADA);
  });

  it.each(ESPERADA.map((m) => [m.familia, m] as const))("%s: regrasGeraisDaFamiliaTop devolve a linha dela", (familia, esperada) => {
    expect(clonar(regrasGeraisDaFamiliaTop(familia))).toEqual(esperada);
  });

  it.each(OUTRAS)("outra família — %s: só o neutro, com \"Esta operação ainda não tem documento no sistema.\" nas quatro", (familia) => {
    expect(MATRIZ_REGRAS_GERAIS_TOP.some((m) => m.familia === familia)).toBe(false);
    expect(clonar(regrasGeraisDaFamiliaTop(familia))).toEqual(outra(familia));
  });

  it("toda família do registry fora da matriz cai no padrão, e as 11 'outras' são famílias declaradas", () => {
    for (const f of OUTRAS) expect(CODIGOS_TIPO_OPERACAO).toContain(f);
    for (const m of ESPERADA) expect(CODIGOS_TIPO_OPERACAO).toContain(m.familia);
    const fora = CODIGOS_TIPO_OPERACAO.filter((c) => !ESPERADA.some((m) => m.familia === c));
    expect(fora.length).toBeGreaterThanOrEqual(OUTRAS.length);
    for (const f of fora) expect(clonar(regrasGeraisDaFamiliaTop(f))).toEqual(outra(f));
    // Código que nem existe no registry: o mesmo padrão fechado, nunca a linha de uma vizinha.
    expect(clonar(regrasGeraisDaFamiliaTop("vendas.devolucao"))).toEqual(outra("vendas.devolucao"));
    expect(clonar(regrasGeraisDaFamiliaTop(""))).toEqual(outra(""));
  });

  it("motivo nulo exatamente quando a família aceita o enum inteiro; o neutro é sempre aceito", () => {
    const dominios = { confirmacao: MODOS_CONFIRMACAO, documentoSemItens: POLITICAS_DOCUMENTO_SEM_ITENS, alteracaoAposConfirmacao: POLITICAS_ALTERACAO, aprovacao: POLITICAS_APROVACAO } as const;
    const neutros = { confirmacao: "manual", documentoSemItens: "proibido", alteracaoAposConfirmacao: "bloqueada", aprovacao: "nenhuma" } as const;
    for (const m of [...MATRIZ_REGRAS_GERAIS_TOP, regrasGeraisDaFamiliaTop("compras.solicitacao")]) {
      for (const k of Object.keys(dominios) as (keyof typeof dominios)[]) {
        const r = m[k] as { aceitos: readonly string[]; motivo: string | null };
        const cobreTudo = dominios[k].every((v) => r.aceitos.includes(v));
        expect(r.motivo === null, `${m.familia}.${k}`).toBe(cobreTudo);
        expect(r.aceitos, `${m.familia}.${k}`).toContain(neutros[k]);
      }
    }
  });

  it("é congelada em profundidade: ninguém muda a matriz que o outro consumidor lê", () => {
    expect(Object.isFrozen(MATRIZ_REGRAS_GERAIS_TOP)).toBe(true);
    for (const m of MATRIZ_REGRAS_GERAIS_TOP) {
      expect(Object.isFrozen(m)).toBe(true);
      for (const r of [m.confirmacao, m.documentoSemItens, m.alteracaoAposConfirmacao, m.aprovacao]) {
        expect(Object.isFrozen(r)).toBe(true);
        expect(Object.isFrozen(r.aceitos)).toBe(true);
      }
    }
    const venda = MATRIZ_REGRAS_GERAIS_TOP[0]!;
    expect(() => (venda.alteracaoAposConfirmacao.aceitos as PoliticaAlteracao[]).push("permitida")).toThrow();
    expect(() => { (venda as { familia: string }).familia = "x"; }).toThrow();
    expect(regrasGeraisDaFamiliaTop("vendas.venda").alteracaoAposConfirmacao.aceitos).toEqual(["bloqueada"]);
  });
});

describe("TOP-CONFIG-08 — validarRegrasGeraisTop (o 422 da gravação no formato 4)", () => {
  /** Cada família × cada valor que ela não aceita, uma regra por vez: uma recusa, no caminho, com o motivo da matriz. */
  const casos: [string, string, Regras, string][] = [];
  for (const m of ESPERADA) {
    for (const v of MODOS_CONFIRMACAO) if (!m.confirmacao.aceitos.includes(v)) casos.push([m.familia, "geral.confirmacao", { confirmacao: v }, m.confirmacao.motivo!]);
    for (const v of POLITICAS_DOCUMENTO_SEM_ITENS) if (!m.documentoSemItens.aceitos.includes(v)) casos.push([m.familia, "geral.documentoSemItens", { documentoSemItens: v }, m.documentoSemItens.motivo!]);
    for (const v of POLITICAS_ALTERACAO) if (!m.alteracaoAposConfirmacao.aceitos.includes(v)) casos.push([m.familia, "geral.alteracaoAposConfirmacao", { alteracao: v }, m.alteracaoAposConfirmacao.motivo!]);
    for (const v of POLITICAS_APROVACAO) if (!m.aprovacao.aceitos.includes(v)) casos.push([m.familia, "aprovacao.politica", { politica: v }, m.aprovacao.motivo!]);
  }

  it("a tabela de casos cobre as 9 famílias (nenhuma aceita tudo: a alteração é sempre Bloqueada)", () => {
    expect(new Set(casos.map((c) => c[0])).size).toBe(9);
    expect(casos.length).toBe(2 * 1 + 4 * 3 + 3 * 5); // venda/compra: 1 cada; estoque: 3 cada; orçamento/pedidos: 5 cada
  });

  it.each(casos)("%s — %s fora da matriz → combinacao_nao_suportada com o motivo exato", (familia, caminho, regras, mensagem) => {
    expect(validarRegrasGeraisTop(familia, v4(regras))).toEqual([{ motivo: "combinacao_nao_suportada", caminho, mensagem }]);
  });

  it.each(ESPERADA.map((m) => [m.familia, m] as const))("%s: todo valor aceito passa sem recusa", (familia, m) => {
    for (const v of m.confirmacao.aceitos) expect(validarRegrasGeraisTop(familia, v4({ confirmacao: v }))).toEqual([]);
    for (const v of m.documentoSemItens.aceitos) expect(validarRegrasGeraisTop(familia, v4({ documentoSemItens: v }))).toEqual([]);
    for (const v of m.alteracaoAposConfirmacao.aceitos) expect(validarRegrasGeraisTop(familia, v4({ alteracao: v }))).toEqual([]);
    for (const v of m.aprovacao.aceitos) expect(validarRegrasGeraisTop(familia, v4({ politica: v }))).toEqual([]);
  });

  it("a TOP de pedido de compra de produção (Automática, Permitido, Permitida) enviada no formato 4 → 3 recusas, na ordem fixa", () => {
    const producao = v4({ confirmacao: "automatica", documentoSemItens: "permitido", alteracao: "permitida" });
    expect(validarRegrasGeraisTop("compras.pedido", producao)).toEqual([
      { motivo: "combinacao_nao_suportada", caminho: "geral.confirmacao", mensagem: NAO_CONFIRMADO },
      { motivo: "combinacao_nao_suportada", caminho: "geral.documentoSemItens", mensagem: SEM_ITENS_ORCAMENTO_PEDIDO },
      { motivo: "combinacao_nao_suportada", caminho: "geral.alteracaoAposConfirmacao", mensagem: NAO_CONFIRMADO },
    ]);
  });

  it("outra família com as quatro fora do neutro → 4 recusas, na ordem fixa, todas com o motivo de 'sem documento'", () => {
    const tudo = v4({ confirmacao: "automatica", documentoSemItens: "permitido", alteracao: "permitida", politica: "sempre" });
    for (const f of OUTRAS) {
      expect(validarRegrasGeraisTop(f, tudo).map((r) => [r.caminho, r.mensagem])).toEqual([
        ["geral.confirmacao", SEM_DOCUMENTO],
        ["geral.documentoSemItens", SEM_DOCUMENTO],
        ["geral.alteracaoAposConfirmacao", SEM_DOCUMENTO],
        ["aprovacao.politica", SEM_DOCUMENTO],
      ]);
    }
  });

  it("o neutro do formato 4 passa em qualquer família", () => {
    for (const f of [...ESPERADA.map((m) => m.familia), ...OUTRAS]) expect(validarRegrasGeraisTop(f, configuracaoNeutraTopV4())).toEqual([]);
  });

  it("avalia contra a matriz recebida (a que o servidor declarou), e nunca sai recusa sem mensagem", () => {
    const declarada = [linha("vendas.venda", [["manual"], null], [["proibido", "permitido"], null], [["bloqueada"], "x"], [["nenhuma", "sempre", "por_valor"], null])];
    const r = validarRegrasGeraisTop("vendas.venda", v4({ confirmacao: "automatica" }), declarada);
    expect(r).toHaveLength(1);
    expect(r[0]!.caminho).toBe("geral.confirmacao");
    expect(r[0]!.mensagem).toBe("Esta operação não aceita esta opção.");
  });

  it("não muta a configuração recebida", () => {
    const c = congelar(v4({ confirmacao: "automatica", alteracao: "permitida" }));
    expect(() => validarRegrasGeraisTop("compras.pedido", c)).not.toThrow();
  });
});

describe("TOP-CONFIG-08 — normalizarRegrasGeraisDaFamiliaTop (o que volta ao padrão)", () => {
  it("o pedido de compra de produção: Automática, Permitido e Permitida voltam os três", () => {
    const entrada = congelar(v4({ confirmacao: "automatica", documentoSemItens: "permitido", alteracao: "permitida" }));
    const { configuracao, voltaram } = normalizarRegrasGeraisDaFamiliaTop("compras.pedido", entrada);
    expect(voltaram).toEqual([
      { caminho: "geral.confirmacao", de: "automatica", para: "manual" },
      { caminho: "geral.documentoSemItens", de: "permitido", para: "proibido" },
      { caminho: "geral.alteracaoAposConfirmacao", de: "permitida", para: "bloqueada" },
    ]);
    expect(configuracao).toEqual(configuracaoNeutraTopV4());
    expect(configuracao.versaoSchema).toBe(4);
    expect(validarRegrasGeraisTop("compras.pedido", configuracao)).toEqual([]);
  });

  it("estoque com \"A partir de um valor\": volta a Sem aprovação, valor nulo; a Automática fica", () => {
    const entrada = congelar(v4({ confirmacao: "automatica", politica: "por_valor", valorMinimo: "1500.00" }));
    const { configuracao, voltaram } = normalizarRegrasGeraisDaFamiliaTop("estoque.saida", entrada);
    expect(voltaram).toEqual([{ caminho: "aprovacao.politica", de: "por_valor", para: "nenhuma" }]);
    expect(configuracao.aprovacao).toEqual({ politica: "nenhuma", valorMinimo: null, momento: "antes_da_confirmacao" });
    expect(configuracao.geral.confirmacao).toBe("automatica");
  });

  it("estoque com \"Sempre\": nada volta", () => {
    const entrada = v4({ confirmacao: "automatica", politica: "sempre" });
    expect(normalizarRegrasGeraisDaFamiliaTop("estoque.ajuste", entrada)).toEqual({ configuracao: entrada, voltaram: [] });
  });

  it("venda: só a alteração Permitida volta; Automática, Permitido e o valor mínimo ficam", () => {
    const entrada = v4({ confirmacao: "automatica", documentoSemItens: "permitido", alteracao: "permitida", politica: "por_valor", valorMinimo: "2500.50" });
    const { configuracao, voltaram } = normalizarRegrasGeraisDaFamiliaTop("vendas.venda", entrada);
    expect(voltaram).toEqual([{ caminho: "geral.alteracaoAposConfirmacao", de: "permitida", para: "bloqueada" }]);
    expect(configuracao).toEqual(v4({ confirmacao: "automatica", documentoSemItens: "permitido", politica: "por_valor", valorMinimo: "2500.50" }));
  });

  it("outra família com as quatro fora do neutro: voltam as quatro, na ordem fixa", () => {
    const entrada = v4({ confirmacao: "automatica", documentoSemItens: "permitido", alteracao: "permitida", politica: "sempre" });
    const { configuracao, voltaram } = normalizarRegrasGeraisDaFamiliaTop("financeiro.conta_a_pagar", entrada);
    expect(voltaram.map((v) => v.caminho)).toEqual(["geral.confirmacao", "geral.documentoSemItens", "geral.alteracaoAposConfirmacao", "aprovacao.politica"]);
    expect(voltaram[3]).toEqual({ caminho: "aprovacao.politica", de: "sempre", para: "nenhuma" });
    expect(configuracao).toEqual(configuracaoNeutraTopV4());
  });

  it("preserva o que não é regra geral (exigências, execução, fiscal) e é idempotente", () => {
    const base = v4({ confirmacao: "automatica", alteracao: "permitida" });
    base.geral.exigeObservacao = true;
    base.execucao.estoque = "configurada";
    base.financeiro.clienteEmAtraso = "bloqueia";
    const uma = normalizarRegrasGeraisDaFamiliaTop("vendas.pedido", congelar(clonar(base)));
    expect(uma.configuracao.geral.exigeObservacao).toBe(true);
    expect(uma.configuracao.execucao).toEqual(base.execucao);
    expect(uma.configuracao.financeiro).toEqual(base.financeiro);
    expect(uma.configuracao.fiscal).toEqual(base.fiscal);
    const duas = normalizarRegrasGeraisDaFamiliaTop("vendas.pedido", uma.configuracao);
    expect(duas).toEqual({ configuracao: uma.configuracao, voltaram: [] });
  });

  it("não devolve referência à entrada: mexer no resultado não muda o que entrou", () => {
    const entrada = v4();
    const { configuracao } = normalizarRegrasGeraisDaFamiliaTop("vendas.venda", entrada);
    for (const s of ["geral", "estoque", "financeiro", "fiscal", "aprovacao", "execucao"] as const) {
      expect(configuracao[s]).not.toBe(entrada[s]);
    }
    configuracao.estoque.exigeArmazem = true;
    expect(entrada.estoque.exigeArmazem).toBe(false);
  });
});

describe("TOP-CONFIG-08 — regrasGeraisQuePassamAValer (o diálogo \"Estas regras passam a valer\")", () => {
  it("3 → 4: lista o que a nova versão declara fora do neutro, na ordem e com os textos exatos", () => {
    const antes = comRegras(configuracaoNeutraTopV3(), { confirmacao: "automatica", documentoSemItens: "permitido", alteracao: "permitida" });
    const depois = v4({ confirmacao: "automatica", documentoSemItens: "permitido", politica: "por_valor", valorMinimo: "1500.00" });
    expect(regrasGeraisQuePassamAValer(antes, depois)).toEqual([
      "Confirmação automática",
      "Documento sem itens permitido",
      "Aprovação a partir de R$ 1.500,00",
    ]);
  });

  it("\"Sempre\" vira \"Aprovação sempre\"; a alteração nunca entra (no formato 4 ela só é Bloqueada)", () => {
    expect(regrasGeraisQuePassamAValer(configuracaoNeutraTopV3(), v4({ politica: "sempre", alteracao: "permitida" }))).toEqual(["Aprovação sempre"]);
  });

  it("4 → 4: vazio — as regras já executavam", () => {
    const antes = v4({ confirmacao: "automatica" });
    expect(regrasGeraisQuePassamAValer(antes, v4({ confirmacao: "automatica", documentoSemItens: "permitido", politica: "sempre" }))).toEqual([]);
    expect(regrasGeraisQuePassamAValer(configuracaoNeutraTopV4(), v4({ confirmacao: "automatica" }))).toEqual([]);
  });

  it("formato 1 e 2 (e a criação, sem versão anterior) também listam; o neutro não lista nada", () => {
    const depois = v4({ confirmacao: "automatica" });
    expect(regrasGeraisQuePassamAValer(configuracaoNeutraTop(), depois)).toEqual(["Confirmação automática"]);
    expect(regrasGeraisQuePassamAValer(configuracaoNeutraTopV2(), depois)).toEqual(["Confirmação automática"]);
    expect(regrasGeraisQuePassamAValer(null, depois)).toEqual(["Confirmação automática"]);
    expect(regrasGeraisQuePassamAValer(configuracaoNeutraTopV3(), configuracaoNeutraTopV4())).toEqual([]);
  });

  it("o valor sai em reais sem ponto flutuante", () => {
    const texto = (valorMinimo: string) => regrasGeraisQuePassamAValer(null, v4({ politica: "por_valor", valorMinimo }));
    expect(texto("0.01")).toEqual(["Aprovação a partir de R$ 0,01"]);
    expect(texto("1500")).toEqual(["Aprovação a partir de R$ 1.500,00"]);
    expect(texto("1234567.5")).toEqual(["Aprovação a partir de R$ 1.234.567,50"]);
    expect(texto("9999999999999.99")).toEqual(["Aprovação a partir de R$ 9.999.999.999.999,99"]);
  });

  it("rascunho com valor inválido não inventa número", () => {
    expect(regrasGeraisQuePassamAValer(null, v4({ politica: "por_valor", valorMinimo: null }))).toEqual(["Aprovação a partir de um valor"]);
    expect(regrasGeraisQuePassamAValer(null, v4({ politica: "por_valor", valorMinimo: "1,5" }))).toEqual(["Aprovação a partir de um valor"]);
  });
});

describe("TOP-CONFIG-08 — regrasGeraisDaVersaoTop (o que a versão congelada manda executar)", () => {
  const NEUTRAS: RegrasGeraisDaVersao = { confirmacaoAutomatica: false, aceitaSemItens: false, aprovacao: null };
  const tudo: Regras = { confirmacao: "automatica", documentoSemItens: "permitido", alteracao: "permitida", politica: "sempre" };

  it("sem TOP → neutro", () => {
    expect(regrasGeraisDaVersaoTop(null)).toEqual({ ok: true, regras: NEUTRAS });
  });

  it("formato 1, 2 e 3 → neutro, MESMO com Automática, Permitido e Sempre gravados (o corte)", () => {
    for (const base of [configuracaoNeutraTop(), configuracaoNeutraTopV2(), configuracaoNeutraTopV3()]) {
      const c = comRegras<ConfiguracaoTipoOperacao>(base, tudo);
      expect(regrasGeraisDaVersaoTop({ codigoBase: "vendas.venda", configuracao: c }), `formato ${c.versaoSchema}`).toEqual({ ok: true, regras: NEUTRAS });
    }
    // O pedido de compra de produção, formato 3, como está gravado.
    const producao = comRegras(configuracaoNeutraTopV3(), { confirmacao: "automatica", documentoSemItens: "permitido", alteracao: "permitida" });
    expect(regrasGeraisDaVersaoTop({ codigoBase: "compras.pedido", configuracao: producao })).toEqual({ ok: true, regras: NEUTRAS });
  });

  it("formato 1 a 3 não tem as seções lidas: a regra não depende do conteúdo dele", () => {
    expect(regrasGeraisDaVersaoTop({ codigoBase: "vendas.venda", configuracao: { versaoSchema: 3 } })).toEqual({ ok: true, regras: NEUTRAS });
  });

  it("formato 4 → o que ela diz", () => {
    expect(regrasGeraisDaVersaoTop({ codigoBase: "vendas.venda", configuracao: v4(tudo) }))
      .toEqual({ ok: true, regras: { confirmacaoAutomatica: true, aceitaSemItens: true, aprovacao: { politica: "sempre" } } });
    expect(regrasGeraisDaVersaoTop({ codigoBase: "compras.compra", configuracao: v4({ politica: "por_valor", valorMinimo: "1500.00" }) }))
      .toEqual({ ok: true, regras: { confirmacaoAutomatica: false, aceitaSemItens: false, aprovacao: { politica: "por_valor", valorMinimo: "1500.00" } } });
    expect(regrasGeraisDaVersaoTop({ codigoBase: "vendas.venda", configuracao: configuracaoNeutraTopV4() })).toEqual({ ok: true, regras: NEUTRAS });
  });

  it("formato 4 é lido como foi gravado: a matriz NÃO se aplica na execução", () => {
    expect(regrasGeraisDaVersaoTop({ codigoBase: "estoque.entrada", configuracao: v4({ politica: "por_valor", valorMinimo: "10.00" }) }))
      .toEqual({ ok: true, regras: { confirmacaoAutomatica: false, aceitaSemItens: false, aprovacao: { politica: "por_valor", valorMinimo: "10.00" } } });
    expect(regrasGeraisDaVersaoTop({ codigoBase: "compras.pedido", configuracao: v4({ confirmacao: "automatica" }) }))
      .toEqual({ ok: true, regras: { confirmacaoAutomatica: true, aceitaSemItens: false, aprovacao: null } });
  });

  it("formato desconhecido ou formato 4 (ou 5) malformado → configuracao_ilegivel (nunca neutro)", () => {
    const ilegivel = { ok: false, motivo: "configuracao_ilegivel" };
    const malformado = clonar(v4()) as unknown as Record<string, unknown>;
    (malformado.geral as Record<string, unknown>).confirmacao = "quase";
    const comChaveNova = { ...clonar(v4()), regraNova: true };
    const porValorSemValor = clonar(v4({ politica: "por_valor" })) as unknown as Record<string, unknown>;
    (porValorSemValor.aprovacao as Record<string, unknown>).valorMinimo = null;
    // OPERACOES-01 F4 (decisão 281): o 6 é o formato desconhecido; o 5 só com o número (sem seções) é um 5 MALFORMADO
    // — ilegível como o 4 malformado, nunca o neutro do corte. As premissas: o 5 é conhecido e o 6 não.
    expect(versaoSchemaDaConfiguracaoTop({ versaoSchema: 5 })).toBe(5);
    expect(versaoSchemaDaConfiguracaoTop({ versaoSchema: 6 })).toBeNull();
    for (const configuracao of [{ versaoSchema: 6 }, { versaoSchema: "4" }, "texto", null, [], { versaoSchema: 4 }, { versaoSchema: 5 }, malformado, comChaveNova, porValorSemValor]) {
      expect(regrasGeraisDaVersaoTop({ codigoBase: "vendas.venda", configuracao }), JSON.stringify(configuracao)).toEqual(ilegivel);
    }
  });
});

describe("TOP-CONFIG-08 — exigeAprovacao (decimal; \"a partir de\" inclui o igual)", () => {
  const regras = (aprovacao: RegrasGeraisDaVersao["aprovacao"]): RegrasGeraisDaVersao => ({ confirmacaoAutomatica: false, aceitaSemItens: false, aprovacao });
  const porValor = (valorMinimo: string) => regras({ politica: "por_valor", valorMinimo });

  it("sem política → não exige, com ou sem valor", () => {
    for (const v of [null, "0", "1500.00", "99999999"]) expect(exigeAprovacao(regras(null), v)).toBe(false);
  });

  it("\"Sempre\" → exige, com ou sem valor", () => {
    for (const v of [null, "0", "0.00", "1500.00"]) expect(exigeAprovacao(regras({ politica: "sempre" }), v)).toBe(true);
  });

  it("limite 1500.00: 1500.00 exige; 1499.99 não exige", () => {
    const r = porValor("1500.00");
    expect(exigeAprovacao(r, "1500.00")).toBe(true);
    expect(exigeAprovacao(r, "1500")).toBe(true);
    expect(exigeAprovacao(r, "1500.01")).toBe(true);
    expect(exigeAprovacao(r, "1499.99")).toBe(false);
    expect(exigeAprovacao(r, "0")).toBe(false);
  });

  it("limite 0.01: 0.01 exige; zero não exige", () => {
    const r = porValor("0.01");
    expect(exigeAprovacao(r, "0.01")).toBe(true);
    expect(exigeAprovacao(r, "0.00")).toBe(false);
    expect(exigeAprovacao(r, "0")).toBe(false);
  });

  it("sem valor do documento (o estoque) → exige", () => {
    expect(exigeAprovacao(porValor("1500.00"), null)).toBe(true);
  });

  it("decimal de verdade: nada de ponto flutuante no último centavo", () => {
    expect(exigeAprovacao(porValor("0.30"), "0.3")).toBe(true);
    expect(exigeAprovacao(porValor("10000.10"), "10000.1")).toBe(true);
    expect(exigeAprovacao(porValor("10000.10"), "10000.09")).toBe(false);
    expect(exigeAprovacao(porValor("9999999999999.99"), "9999999999999.99")).toBe(true);
    expect(exigeAprovacao(porValor("9999999999999.99"), "9999999999999.98")).toBe(false);
    // 9007199254740993 não cabe num double: em ponto flutuante as duas contas dariam "igual".
    expect(exigeAprovacao(porValor("9007199254740993"), "9007199254740992")).toBe(false);
  });

  it("valor do documento que não é decimal → exige (na dúvida, aprova-se)", () => {
    expect(exigeAprovacao(porValor("1500.00"), "abc")).toBe(true);
  });

  it("encadeado com a leitura da versão: formato 3 com \"Sempre\" gravado nunca exige", () => {
    const v3 = comRegras(configuracaoNeutraTopV3(), { politica: "sempre" });
    const lida = regrasGeraisDaVersaoTop({ codigoBase: "vendas.venda", configuracao: v3 });
    expect(lida.ok && exigeAprovacao(lida.regras, "1000000.00")).toBe(false);
    const lida4 = regrasGeraisDaVersaoTop({ codigoBase: "vendas.venda", configuracao: v4({ politica: "por_valor", valorMinimo: "1500.00" }) });
    expect(lida4.ok && exigeAprovacao(lida4.regras, "1500.00")).toBe(true);
    expect(lida4.ok && exigeAprovacao(lida4.regras, "1499.99")).toBe(false);
  });
});

describe("TOP-CONFIG-08 — lerMatrizRegrasGeraisTop (o leitor estrito do bloco das capabilities)", () => {
  const publicada = (): Record<string, unknown>[] => JSON.parse(JSON.stringify(MATRIZ_REGRAS_GERAIS_TOP)) as Record<string, unknown>[];
  /** A matriz publicada com UM desvio aplicado ao primeiro item. */
  const comDesvio = (desvio: (item: Record<string, unknown>) => void): unknown => {
    const m = publicada();
    desvio(m[0]!);
    return m;
  };
  const regraDo = (item: Record<string, unknown>, nome: string) => item[nome] as Record<string, unknown>;

  it("aceita a própria matriz serializada em JSON, sem referência ao que veio", () => {
    const bruto = publicada();
    const lida = lerMatrizRegrasGeraisTop(bruto);
    expect(lida).toEqual(clonar(MATRIZ_REGRAS_GERAIS_TOP));
    expect(lida![0]).not.toBe(bruto[0]);
    expect(lida![0]!.confirmacao.aceitos).not.toBe(regraDo(bruto[0]!, "confirmacao").aceitos);
  });

  it("aceita lista vazia (nenhuma família tem linha: todas caem no padrão fechado)", () => {
    expect(lerMatrizRegrasGeraisTop([])).toEqual([]);
  });

  it.each([
    ["não é lista", null],
    ["objeto no lugar da lista", {}],
    ["texto no lugar da lista", "matriz"],
    ["item que não é objeto", [1]],
    ["item nulo", [null]],
  ])("recusa: %s", (_nome, bruto) => {
    expect(lerMatrizRegrasGeraisTop(bruto)).toBeNull();
  });

  it.each<[string, (item: Record<string, unknown>) => void]>([
    ["chave a mais no item", (i) => { i.extra = true; }],
    ["chave a menos no item", (i) => { delete i.aprovacao; }],
    ["família vazia", (i) => { i.familia = ""; }],
    ["família que não é texto", (i) => { i.familia = 1; }],
    ["regra que não é objeto", (i) => { i.confirmacao = ["manual"]; }],
    ["chave a mais na regra", (i) => { regraDo(i, "confirmacao").extra = 1; }],
    ["regra sem motivo", (i) => { delete regraDo(i, "confirmacao").motivo; }],
    ["regra sem aceitos", (i) => { delete regraDo(i, "documentoSemItens").aceitos; }],
    ["aceitos vazio", (i) => { regraDo(i, "aprovacao").aceitos = []; }],
    ["aceitos que não é lista", (i) => { regraDo(i, "aprovacao").aceitos = "nenhuma"; }],
    ["valor fora do enum", (i) => { regraDo(i, "alteracaoAposConfirmacao").aceitos = ["bloqueada", "talvez"]; }],
    ["valor de outro enum", (i) => { regraDo(i, "confirmacao").aceitos = ["manual", "sempre"]; }],
    ["valor repetido", (i) => { regraDo(i, "confirmacao").aceitos = ["manual", "manual"]; }],
    ["motivo que não é texto", (i) => { regraDo(i, "alteracaoAposConfirmacao").motivo = 7; }],
    ["motivo ausente como undefined", (i) => { regraDo(i, "alteracaoAposConfirmacao").motivo = undefined; }],
  ])("recusa: %s", (_nome, desvio) => {
    expect(lerMatrizRegrasGeraisTop(comDesvio(desvio))).toBeNull();
  });

  it("recusa família repetida (uma linha por família)", () => {
    const m = publicada();
    expect(lerMatrizRegrasGeraisTop([...m, m[0]])).toBeNull();
  });

  it("a matriz lida decide igual à do produto", () => {
    const lida = lerMatrizRegrasGeraisTop(publicada())!;
    const producao = v4({ confirmacao: "automatica", documentoSemItens: "permitido", alteracao: "permitida" });
    expect(validarRegrasGeraisTop("compras.pedido", producao, lida)).toEqual(validarRegrasGeraisTop("compras.pedido", producao));
    expect(normalizarRegrasGeraisDaFamiliaTop("compras.pedido", producao, lida)).toEqual(normalizarRegrasGeraisDaFamiliaTop("compras.pedido", producao));
  });
});

describe("TOP-CONFIG-08 — as mensagens da aprovação", () => {
  it("textos exatos", () => {
    expect(MENSAGEM_APROVACAO_PENDENTE).toBe("Este documento precisa de aprovação antes de ser confirmado.");
    expect(MENSAGEM_APROVACAO_NAO_EXIGIDA).toBe("Este documento não precisa de aprovação.");
    expect(MENSAGEM_APROVACAO_SO_DOCUMENTO_ABERTO).toBe("Só documento aberto passa por aprovação.");
    expect(mensagemAprovacaoReprovada("valor acima do combinado")).toBe("Este documento foi reprovado: valor acima do combinado.");
  });

  it("reprovação: motivo que já termina em '.', '!' ou '?' não ganha outro ponto", () => {
    expect(mensagemAprovacaoReprovada("Preço alto.")).toBe("Este documento foi reprovado: Preço alto.");
    expect(mensagemAprovacaoReprovada("Preço alto!")).toBe("Este documento foi reprovado: Preço alto!");
    expect(mensagemAprovacaoReprovada("Preço alto?")).toBe("Este documento foi reprovado: Preço alto?");
    expect(mensagemAprovacaoReprovada("Rever o preço...")).toBe("Este documento foi reprovado: Rever o preço...");
    expect(mensagemAprovacaoReprovada("Preço alto?!")).toBe("Este documento foi reprovado: Preço alto?!");
  });

  it("reprovação: motivo sem pontuação no fim ganha o ponto, como sempre", () => {
    expect(mensagemAprovacaoReprovada("Preço alto")).toBe("Este documento foi reprovado: Preço alto.");
    // Só o FIM conta: pontuação no meio não dispensa o ponto final.
    expect(mensagemAprovacaoReprovada("Preço alto. Rever com o comprador")).toBe("Este documento foi reprovado: Preço alto. Rever com o comprador.");
    // Só os três sinais fecham a frase; reticências de um caractere, ":", ";", "," e ")" ganham o ponto (nada é adivinhado).
    for (const fim of ["…", ":", ";", ",", ")"]) {
      expect(mensagemAprovacaoReprovada(`Preço alto${fim}`), fim).toBe(`Este documento foi reprovado: Preço alto${fim}.`);
    }
  });

  it("reprovação: branco no fim do motivo só é ignorado para decidir; o texto entra como foi gravado", () => {
    expect(mensagemAprovacaoReprovada("Preço alto.  ")).toBe("Este documento foi reprovado: Preço alto.  ");
    expect(mensagemAprovacaoReprovada("Preço alto!\t\n")).toBe("Este documento foi reprovado: Preço alto!\t\n");
    expect(mensagemAprovacaoReprovada("Preço alto ")).toBe("Este documento foi reprovado: Preço alto .");
    expect(mensagemAprovacaoReprovada("Preço alto\n")).toBe("Este documento foi reprovado: Preço alto\n.");
  });
});
