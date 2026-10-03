import { describe, it, expect } from "vitest";
import * as dominio from "../src/index.js";
import { configuracaoNeutraTopV5, type ConfiguracaoTipoOperacaoV5 } from "../src/tipo-operacao-configuracao.js";
import {
  AJUDA_FINANCEIRO_PADRAO,
  MENSAGEM_EXIGIR_FORA_DA_FAMILIA,
  MENSAGEM_PROVISAO_FORA_DA_FAMILIA,
  SECAO_FINANCEIRO_PADRAO,
  recusasDoFinanceiroPadraoDaFamilia,
  type SecaoFinanceiroPadrao,
} from "../src/tipo-operacao-secao-financeiro-padrao.js";
import { familiaUsaPadroesFinanceiros, perfilDosPadroesFinanceiros, planoDaClassificacao } from "../src/financeiro-padroes.js";
import {
  MENSAGEM_PEDIDO_DE_COMPRA_SEM_CLASSIFICACAO,
  MOTIVOS_DA_PROVISAO,
  MOTIVOS_DA_PROVISAO_COMPRA,
  REGRAS_DE_PROVISAO,
  alvoDaProvisao,
  provisaoExecutavelNaFamilia,
  regraDeProvisaoDaFamilia,
  type EntradaDoAlvoDaProvisao,
} from "../src/financeiro-provisao.js";
import { CATALOGO_TOP, lerCatalogoTop, perfilDaFamiliaTop, perfilDoTipoTop, recusasDoPerfilTop } from "../src/tipo-operacao-catalogo.js";
import { familiaOperacionalDeDocumentoCompra, familiaOperacionalDeDocumentoVenda } from "../src/tipo-operacao-configurado.js";
import { tipoOperacao } from "../src/tipo-operacao.js";

/**
 * OPERACOES-01 F9b (decisão 286, complemento F9b) — A PROVISÃO DO PEDIDO DE COMPRA FINALIZADO E OS PADRÕES DA TOP NA
 * COMPRA, NO DOMÍNIO.
 *
 * F9B-D1 as regras de provisão: as duas executam; o pedido de compra provisiona a pagar ao finalizar.
 * F9B-D2 os perfis dos padrões das duas famílias de compras (sem "padrão legado").
 * F9B-D3 as recusas da seção nas duas famílias de compras (e a do catálogo, no orçamento de compra).
 * F9B-D4 as abas e as seções neutras do editor, no perfil derivado e no catálogo publicado.
 * F9B-D5 a classificação da compra: `planoDaClassificacao` com "exigir" (nunca o legado).
 * F9B-D6 o alvo da provisão no cenário da compra.
 * F9B-D7 os textos (escritos à mão: é o contrato) e os motivos da venda inalterados.
 *
 * Os códigos de família aparecem LITERAIS só aqui, de propósito: o teste confere a derivação; o runtime os pergunta ao
 * registry (`familia-operacional-ssot-audit`). Cada caso afirma a PREMISSA ao lado da conclusão.
 */

const PEDIDO_VENDA = "vendas.pedido";
const VENDA = "vendas.venda";
const PEDIDO_COMPRA = "compras.pedido";
const COMPRA = "compras.compra";
const ORCAMENTO_COMPRA = "compras.orcamento";
const OS_CINCO = ["natureza", "centro", "tipoTitulo", "formaPagamento", "conta"];
const DESPESA = ["expense", "both"];

const NEUTRO: SecaoFinanceiroPadrao = { provisao: false, documentoTroca: true, semClassificacao: "padrao_legado" };

/** Um 5 neutro com a seção `financeiroPadrao` dada (o resto no neutro). */
const v5Com = (secao: SecaoFinanceiroPadrao): ConfiguracaoTipoOperacaoV5 => ({ ...configuracaoNeutraTopV5(), financeiroPadrao: secao });

// ---------------------------------------------------------------------------------------------------
// F9B-D1 — as regras de provisão
// ---------------------------------------------------------------------------------------------------

describe("F9B-D1 as regras de provisão: as duas executam", () => {
  it("as duas famílias saem do registry (premissa) e as duas regras executam; o pedido de compra provisiona a pagar ao finalizar", () => {
    expect(familiaOperacionalDeDocumentoVenda("order"), "premissa: o pedido de venda pelo registry").toBe(PEDIDO_VENDA);
    expect(familiaOperacionalDeDocumentoCompra("pedido"), "premissa: o pedido de compra pelo registry").toBe(PEDIDO_COMPRA);
    expect(REGRAS_DE_PROVISAO).toEqual([
      { familia: PEDIDO_VENDA, direcao: "receivable", momento: "ao_salvar_o_pedido", executa: true },
      { familia: PEDIDO_COMPRA, direcao: "payable", momento: "ao_finalizar_o_pedido", executa: true },
    ]);
    expect(Object.isFrozen(REGRAS_DE_PROVISAO)).toBe(true);
    for (const r of REGRAS_DE_PROVISAO) expect(Object.isFrozen(r), r.familia).toBe(true);
    expect(regraDeProvisaoDaFamilia(PEDIDO_COMPRA)).toEqual({ familia: PEDIDO_COMPRA, direcao: "payable", momento: "ao_finalizar_o_pedido", executa: true });
  });

  it("provisaoExecutavelNaFamilia: verdadeira nos dois pedidos; falsa na compra, no orçamento de compra e na venda", () => {
    expect(provisaoExecutavelNaFamilia(PEDIDO_VENDA)).toBe(true);
    expect(provisaoExecutavelNaFamilia(PEDIDO_COMPRA)).toBe(true);
    for (const f of [COMPRA, ORCAMENTO_COMPRA, VENDA]) {
      expect(tipoOperacao(f), `premissa: ${f} existe no registry`).toBeDefined();
      expect(regraDeProvisaoDaFamilia(f), f).toBeUndefined();
      expect(provisaoExecutavelNaFamilia(f), f).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------------------------------
// F9B-D2 — os perfis dos padrões das duas famílias de compras
// ---------------------------------------------------------------------------------------------------

describe("F9B-D2 os perfis dos padrões do pedido de compra e da compra", () => {
  it("o pedido de compra: provisão, sem \"sem natureza e centro\", o documento troca, os cinco padrões, natureza de despesa", () => {
    const p = perfilDosPadroesFinanceiros(PEDIDO_COMPRA);
    expect(p).toEqual({ provisao: true, semClassificacao: false, trocaPeloDocumento: true, campos: OS_CINCO, naturezas: DESPESA });
    expect(Object.isFrozen(p)).toBe(true);
  });

  it("a compra: igual ao pedido, sem a provisão", () => {
    expect(perfilDosPadroesFinanceiros(COMPRA)).toEqual({ provisao: false, semClassificacao: false, trocaPeloDocumento: true, campos: OS_CINCO, naturezas: DESPESA });
  });

  it("as duas usam a seção; o orçamento de compra, não (premissa: ele existe no registry)", () => {
    for (const f of [PEDIDO_COMPRA, COMPRA]) {
      expect(familiaUsaPadroesFinanceiros(f), f).toBe(true);
      expect(SECAO_FINANCEIRO_PADRAO.usadaPor(f), f).toBe(true);
    }
    expect(familiaOperacionalDeDocumentoCompra("orcamento"), "premissa: o orçamento de compra pelo registry").toBe(ORCAMENTO_COMPRA);
    expect(tipoOperacao(ORCAMENTO_COMPRA), "premissa: o orçamento de compra existe").toBeDefined();
    expect(familiaUsaPadroesFinanceiros(ORCAMENTO_COMPRA)).toBe(false);
    expect(SECAO_FINANCEIRO_PADRAO.usadaPor(ORCAMENTO_COMPRA)).toBe(false);
    expect(perfilDosPadroesFinanceiros(ORCAMENTO_COMPRA)).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------------
// F9B-D3 — as recusas da seção nas famílias de compras
// ---------------------------------------------------------------------------------------------------

describe("F9B-D3 as recusas da seção financeiroPadrao nas famílias de compras", () => {
  const recusaProvisao = {
    motivo: "combinacao_nao_suportada",
    caminho: "financeiroPadrao.provisao",
    mensagem: "A provisão vale só no pedido de venda e no pedido de compra.",
  };
  const recusaExigir = {
    motivo: "combinacao_nao_suportada",
    caminho: "financeiroPadrao.semClassificacao",
    mensagem: "O lançamento desta operação sempre informa natureza e centro: deixe \"Usar a 1ª natureza e o 1º centro por código (como hoje)\".",
  };

  it("o pedido de compra aceita a provisão e a troca desligada; \"exigir\" é a única recusa", () => {
    expect(recusasDoFinanceiroPadraoDaFamilia(PEDIDO_COMPRA, { provisao: true, documentoTroca: false, semClassificacao: "padrao_legado" })).toEqual([]);
    expect(recusasDoFinanceiroPadraoDaFamilia(PEDIDO_COMPRA, { provisao: true, documentoTroca: false, semClassificacao: "exigir" })).toEqual([recusaExigir]);
  });

  it("a compra recusa a provisão (com o texto novo) e \"exigir\"; a troca desligada passa", () => {
    expect(recusasDoFinanceiroPadraoDaFamilia(COMPRA, { provisao: true, documentoTroca: false, semClassificacao: "padrao_legado" })).toEqual([recusaProvisao]);
    expect(recusasDoFinanceiroPadraoDaFamilia(COMPRA, { provisao: true, documentoTroca: false, semClassificacao: "exigir" })).toEqual([recusaProvisao, recusaExigir]);
    expect(recusasDoFinanceiroPadraoDaFamilia(COMPRA, { ...NEUTRO, documentoTroca: false })).toEqual([]);
    // A premissa: a mensagem nova vale para toda família fora dos dois pedidos (a venda também).
    expect(recusasDoFinanceiroPadraoDaFamilia(VENDA, { ...NEUTRO, provisao: true })).toEqual([recusaProvisao]);
    expect(MENSAGEM_PROVISAO_FORA_DA_FAMILIA).toBe(recusaProvisao.mensagem);
    expect(MENSAGEM_EXIGIR_FORA_DA_FAMILIA).toBe(recusaExigir.mensagem);
  });

  it("o neutro nunca é recusado nas duas", () => {
    for (const f of [PEDIDO_COMPRA, COMPRA]) expect(recusasDoFinanceiroPadraoDaFamilia(f, NEUTRO), f).toEqual([]);
  });

  it("o catálogo aceita a seção fora do neutro nas duas e a recusa no orçamento de compra", () => {
    const ligada = v5Com({ ...NEUTRO, provisao: true });
    expect(recusasDoPerfilTop(PEDIDO_COMPRA, ligada)).toEqual([]);
    expect(recusasDoPerfilTop(COMPRA, v5Com({ ...NEUTRO, documentoTroca: false }))).toEqual([]);
    // A premissa: a família que não usa a seção continua recusando-a fora do neutro.
    expect(recusasDoPerfilTop(ORCAMENTO_COMPRA, ligada)).toEqual([
      { motivo: "combinacao_nao_suportada", caminho: "financeiroPadrao", mensagem: "Esta operação não usa a seção Padrões financeiros." },
    ]);
  });
});

// ---------------------------------------------------------------------------------------------------
// F9B-D4 — as abas e as seções neutras do editor
// ---------------------------------------------------------------------------------------------------

describe("F9B-D4 as abas e as seções neutras das duas famílias de compras", () => {
  const PEDIDO_ABAS = ["identificacao", "geral", "destinos", "estoque", "fluxoCompra", "financeiroPadrao", "financeiro", "fiscal", "aprovacao"];
  // Premissa (288): a seção Implantação (F11) só vale na entrada; nas compras ela é neutra, no fim.
  const PEDIDO_NEUTRAS = ["destino", "fluxo", "divergenciaPedido", "implantacao"];
  const COMPRA_ABAS = ["identificacao", "geral", "estoque", "divergenciaPedido", "financeiroPadrao", "financeiro", "fiscal", "aprovacao", "execucao"];
  const COMPRA_NEUTRAS = ["destino", "fluxo", "fluxoCompra", "implantacao"];

  it("o perfil derivado: Padrões financeiros depois das seções de compras e antes do Financeiro; fora das neutras", () => {
    expect(perfilDoTipoTop(PEDIDO_COMPRA).abas).toEqual(PEDIDO_ABAS);
    expect(perfilDoTipoTop(PEDIDO_COMPRA).secoesNeutras).toEqual(PEDIDO_NEUTRAS);
    expect(perfilDoTipoTop(COMPRA).abas).toEqual(COMPRA_ABAS);
    expect(perfilDoTipoTop(COMPRA).secoesNeutras).toEqual(COMPRA_NEUTRAS);
    // A premissa: o orçamento de compra continua sem a aba e com a seção neutra.
    expect(perfilDoTipoTop(ORCAMENTO_COMPRA).abas).not.toContain("financeiroPadrao");
    expect(perfilDoTipoTop(ORCAMENTO_COMPRA).secoesNeutras).toContain("financeiroPadrao");
  });

  it("o catálogo publicado diz o mesmo, e o leitor estrito do web o aceita", () => {
    expect(perfilDaFamiliaTop(PEDIDO_COMPRA)).toEqual(perfilDoTipoTop(PEDIDO_COMPRA));
    expect(perfilDaFamiliaTop(COMPRA)).toEqual(perfilDoTipoTop(COMPRA));
    const publicado = CATALOGO_TOP.perfis.filter((p) => p.familia === PEDIDO_COMPRA || p.familia === COMPRA);
    expect(publicado.map((p) => [p.familia, p.abas, p.secoesNeutras])).toEqual([
      [PEDIDO_COMPRA, PEDIDO_ABAS, PEDIDO_NEUTRAS],
      [COMPRA, COMPRA_ABAS, COMPRA_NEUTRAS],
    ]);
    const lido = lerCatalogoTop(JSON.parse(JSON.stringify(CATALOGO_TOP)) as unknown);
    expect(lido, "premissa: o catálogo publicado passa no leitor estrito").not.toBeNull();
    expect(lido ? perfilDaFamiliaTop(PEDIDO_COMPRA, lido)?.abas : null).toEqual(PEDIDO_ABAS);
    expect(lido ? perfilDaFamiliaTop(COMPRA, lido)?.abas : null).toEqual(COMPRA_ABAS);
  });
});

// ---------------------------------------------------------------------------------------------------
// F9B-D5 — a classificação da compra: "exigir", nunca o legado
// ---------------------------------------------------------------------------------------------------

describe("F9B-D5 a classificação da compra é planoDaClassificacao com \"exigir\"", () => {
  const N1 = "11111111-1111-4111-8111-111111111111";
  const N2 = "22222222-2222-4222-8222-222222222222";
  const C1 = "33333333-3333-4333-8333-333333333333";
  const C2 = "44444444-4444-4444-8444-444444444444";
  const SEM_DOCUMENTO = { naturezaId: null, centroCustoId: null };

  it("premissa: nas duas famílias de compras a regra \"sem natureza e centro\" não vale (não há legado)", () => {
    for (const f of [PEDIDO_COMPRA, COMPRA]) expect(perfilDosPadroesFinanceiros(f)?.semClassificacao, f).toBe(false);
  });

  it("o documento com o par vence o padrão da TOP", () => {
    expect(planoDaClassificacao({ documento: { naturezaId: N1, centroCustoId: C1 }, padrao: { naturezaId: N2, centroCustoId: C2 }, semClassificacao: "exigir" }))
      .toEqual({ tipo: "pronta", naturezaId: N1, centroCustoId: C1, origem: "documento" });
  });

  it("sem o documento, a TOP com o par → o padrão da TOP", () => {
    expect(planoDaClassificacao({ documento: SEM_DOCUMENTO, padrao: { naturezaId: N2, centroCustoId: C2 }, semClassificacao: "exigir" }))
      .toEqual({ tipo: "pronta", naturezaId: N2, centroCustoId: C2, origem: "padrão da TOP" });
  });

  it("a TOP só com a natureza (ou sem padrões) → recusa dizendo o que falta, nunca o legado", () => {
    expect(planoDaClassificacao({ documento: SEM_DOCUMENTO, padrao: { naturezaId: N2, centroCustoId: null }, semClassificacao: "exigir" }))
      .toEqual({ tipo: "exigir", faltam: ["centro"] });
    expect(planoDaClassificacao({ documento: SEM_DOCUMENTO, padrao: null, semClassificacao: "exigir" }))
      .toEqual({ tipo: "exigir", faltam: ["natureza", "centro"] });
    // A premissa: a MESMA entrada com o padrão legado completaria pelo legado — é o "exigir" que o impede.
    expect(planoDaClassificacao({ documento: SEM_DOCUMENTO, padrao: { naturezaId: N2, centroCustoId: null }, semClassificacao: "padrao_legado" }))
      .toEqual({ tipo: "legado", naturezaId: N2, centroCustoId: null });
  });
});

// ---------------------------------------------------------------------------------------------------
// F9B-D6 — o alvo da provisão no cenário da compra
// ---------------------------------------------------------------------------------------------------

describe("F9B-D6 o alvo da provisão do pedido de compra finalizado", () => {
  /** O pedido de compra FINALIZADO de 1000, com a TOP que provisiona, ainda com saldo a receber. */
  const finalizado: EntradaDoAlvoDaProvisao = { provisaoLigada: true, cancelado: false, saldoEncerrado: false, totalDoDocumento: "1000.00", partes: [] };

  it("finalizado sem compra → o valor do pedido (premissa); com uma compra confirmada de 400 → 600.00", () => {
    expect(alvoDaProvisao(finalizado)).toBe("1000.00");
    expect(alvoDaProvisao({ ...finalizado, partes: [{ total: "400.00", situacao: "confirmada" }] })).toBe("600.00");
  });

  it("convertido (nada mais a gerar) com uma compra aberta de 900 → 900.00; confirmada → 0.00", () => {
    // A premissa: o mesmo pedido AINDA com saldo prevê o valor inteiro (a compra aberta não abate).
    expect(alvoDaProvisao({ ...finalizado, partes: [{ total: "900.00", situacao: "aberta" }] })).toBe("1000.00");
    const convertido: EntradaDoAlvoDaProvisao = { ...finalizado, saldoEncerrado: true };
    expect(alvoDaProvisao({ ...convertido, partes: [{ total: "900.00", situacao: "aberta" }] })).toBe("900.00");
    expect(alvoDaProvisao({ ...convertido, partes: [{ total: "900.00", situacao: "confirmada" }] })).toBe("0.00");
  });

  it("cancelado → 0.00; a provisão desligada → 0.00", () => {
    const comCompra: EntradaDoAlvoDaProvisao = { ...finalizado, partes: [{ total: "400.00", situacao: "confirmada" }] };
    expect(alvoDaProvisao(comCompra), "premissa: vivo e ligado, prevê o que falta").toBe("600.00");
    expect(alvoDaProvisao({ ...comCompra, cancelado: true })).toBe("0.00");
    expect(alvoDaProvisao({ ...comCompra, provisaoLigada: false })).toBe("0.00");
  });
});

// ---------------------------------------------------------------------------------------------------
// F9B-D7 — os textos
// ---------------------------------------------------------------------------------------------------

describe("F9B-D7 os textos da provisão da compra e da seção", () => {
  it("os motivos da provisão do pedido de compra, congelados e exatos", () => {
    expect(Object.isFrozen(MOTIVOS_DA_PROVISAO_COMPRA)).toBe(true);
    expect(Object.keys(MOTIVOS_DA_PROVISAO_COMPRA)).toEqual(["pedidoFinalizado", "recebido", "compraConfirmada", "compraCancelada"]);
    expect(MOTIVOS_DA_PROVISAO_COMPRA.pedidoFinalizado).toBe("Pedido finalizado");
    expect(MOTIVOS_DA_PROVISAO_COMPRA.recebido("7")).toBe("Recebido na compra 7");
    expect(MOTIVOS_DA_PROVISAO_COMPRA.compraConfirmada("7")).toBe("Compra 7 confirmada");
    expect(MOTIVOS_DA_PROVISAO_COMPRA.compraCancelada("7")).toBe("Compra 7 cancelada");
    // A premissa: a API os lê pelo índice do pacote (o mesmo objeto).
    expect(dominio.MOTIVOS_DA_PROVISAO_COMPRA).toBe(MOTIVOS_DA_PROVISAO_COMPRA);
  });

  it("a recusa do pedido de compra sem classificação e a ajuda da aba, exatas", () => {
    expect(MENSAGEM_PEDIDO_DE_COMPRA_SEM_CLASSIFICACAO).toBe(
      "Esta operação provisiona contas a pagar ao finalizar o pedido: informe a natureza financeira e o centro de resultado, ou configure os padrões da TOP.",
    );
    expect(dominio.MENSAGEM_PEDIDO_DE_COMPRA_SEM_CLASSIFICACAO).toBe(MENSAGEM_PEDIDO_DE_COMPRA_SEM_CLASSIFICACAO);
    expect(AJUDA_FINANCEIRO_PADRAO).toBe("Provisão e padrões do lançamento financeiro desta operação. Tudo nasce desligado: sem padrão, o documento decide, como hoje.");
    expect(SECAO_FINANCEIRO_PADRAO.ajuda, "premissa: a aba mostra a mesma ajuda").toBe(AJUDA_FINANCEIRO_PADRAO);
  });

  it("os motivos da VENDA não mudaram (premissa de que a venda fica igual)", () => {
    expect(Object.isFrozen(MOTIVOS_DA_PROVISAO)).toBe(true);
    expect(Object.keys(MOTIVOS_DA_PROVISAO)).toEqual(["pedidoGravado", "faturado", "vendaCancelada", "saldoEncerrado", "pedidoCancelado", "semProvisao"]);
    expect(MOTIVOS_DA_PROVISAO.pedidoGravado).toBe("Pedido alterado");
    expect(MOTIVOS_DA_PROVISAO.faturado("7")).toBe("Faturado na venda 7");
    expect(MOTIVOS_DA_PROVISAO.vendaCancelada("7")).toBe("Venda 7 cancelada");
    expect(MOTIVOS_DA_PROVISAO.saldoEncerrado("sem estoque")).toBe("Saldo do pedido encerrado: sem estoque");
    expect(MOTIVOS_DA_PROVISAO.pedidoCancelado(null)).toBe("Pedido cancelado");
    expect(MOTIVOS_DA_PROVISAO.pedidoCancelado("  ")).toBe("Pedido cancelado");
    expect(MOTIVOS_DA_PROVISAO.pedidoCancelado(" desistiu ")).toBe("Pedido cancelado: desistiu");
    expect(MOTIVOS_DA_PROVISAO.semProvisao).toBe("A operação do pedido não provisiona mais");
  });
});
