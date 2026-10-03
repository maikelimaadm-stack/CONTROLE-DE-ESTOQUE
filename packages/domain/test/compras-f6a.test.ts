import { describe, it, expect } from "vitest";
import { ErrorCodes, errorHttpStatus } from "@agro/shared";
import { ptBR } from "@erp/plataforma";
import {
  ARESTAS_EXECUTAVEIS_EM_COMPRAS,
  CAPACIDADE_FINALIZACAO_E_ORCAMENTO_COMPRA,
  CATALOGO_TOP,
  DEFINICOES_SECOES_V5,
  EXIGENCIAS_GERAIS_COMPRA_TOP,
  EXIGENCIAS_GERAIS_ORCAMENTO_COMPRA_TOP,
  LAYOUT_DO_SISTEMA,
  MATRIZ_REGRAS_GERAIS_TOP,
  MENSAGEM_APROVACAO_PENDENTE_PEDIDO,
  MODOS_DIVERGENCIA_PEDIDO,
  MSG_DIVERGENCIA_COM_O_PEDIDO,
  MSG_FINALIZAR_SO_PEDIDO_ABERTO,
  MSG_PEDIDO_PRECISA_FINALIZAR_PARA_RECEBER,
  PERMISSION_RESOURCES,
  ROTULOS_MODO_DIVERGENCIA_PEDIDO,
  SECAO_DIVERGENCIA_PEDIDO,
  SECAO_FLUXO_COMPRA,
  TOLERANCIA_MAXIMA_DIVERGENCIA_PEDIDO,
  camposExigidosTop,
  camposObrigatoriosFaltando,
  catalogoDaFamilia,
  chaveI18nDaFamiliaOperacional,
  colunasComPadraoRegistro,
  configuracaoNeutraTop,
  configuracaoNeutraTopV2,
  configuracaoNeutraTopV3,
  configuracaoNeutraTopV4,
  configuracaoNeutraTopV5,
  divergenciaPedidoDaVersaoTop,
  divergenciasDaCompra,
  enumLabel,
  enumOptions,
  exigeAprovacao,
  exigenciasGeraisDaFamiliaTop,
  familiaOperacionalDeDocumentoCompra,
  familiaTemLayout,
  familiaTemProximasOperacoes,
  fluxoCompraDaVersaoTop,
  lerConfiguracaoTop,
  mensagemSecaoForaDoTipo,
  moduloDaPermissao,
  normalizarPeloPerfilTop,
  perfilDaFamiliaTop,
  recusasDoPerfilTop,
  regrasGeraisDaFamiliaTop,
  regrasGeraisDaVersaoTop,
  resolverRegistroGlobal,
  tabelaComercialDaFamilia,
  tiposParaEscolhaTop,
  tipoOperacao,
  validarDestinoOperacao,
  validarEstruturaLayout,
  validarRegistroIdGlobal,
  validarRegistroTipoOperacao,
  validarRegrasGeraisTop,
  varianteDeDocumentoCompraDaFamilia,
  type ConfiguracaoTipoOperacao,
  type ConfiguracaoTipoOperacaoV5,
  type DivergenciaPedidoTop,
  type LinhaParaDivergencia,
  type RecusaConfiguracaoTop,
} from "../src/index.js";

/**
 * OPERACOES-01 F6a (decisão 283) — O DOMÍNIO DO PEDIDO FINALIZADO, DO ORÇAMENTO DE COMPRA E DA DIVERGÊNCIA.
 *
 * F6A-D1 a família compras.orcamento no registry, no rótulo e na espécie (ida e volta).
 * F6A-D2 a seção `fluxoCompra` do formato 5: neutro, leitura estrita, normalização, família, linhas.
 * F6A-D3 a seção `divergenciaPedido`: idem, com as tolerâncias em texto decimal de 0 a 100.
 * F6A-D4 a leitura das seções pela EXECUÇÃO, na versão congelada (fail-closed).
 * F6A-D5 a conta da divergência, numa tabela de casos (decimal; nunca ponto flutuante).
 * F6A-D6 o perfil do tipo, o grafo, a matriz e as exigências.
 * F6A-D7 o layout do orçamento, os rótulos, as permissões, o ID Global, as mensagens e o código de erro.
 *
 * Os códigos de família aparecem LITERAIS aqui de propósito: o teste confere a derivação feita pelo registry.
 */

const PEDIDO = "compras.pedido";
const COMPRA = "compras.compra";
const ORCAMENTO = "compras.orcamento";

const clonar = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
type Saco = Record<string, unknown>;

/** Um 5 bruto (JSON) com as seções dadas por cima do neutro. */
const v5Com = (secoes: Saco): Saco => ({ ...(clonar(configuracaoNeutraTopV5()) as unknown as Saco), ...secoes });

const recusasDe = (bruto: unknown): RecusaConfiguracaoTop[] => {
  const r = lerConfiguracaoTop(bruto);
  if (r.ok) throw new Error(`esperava recusa, o leitor aceitou: ${JSON.stringify(bruto)}`);
  return r.recusas;
};
const lidaDe = (bruto: unknown): Saco => {
  const r = lerConfiguracaoTop(bruto);
  if (!r.ok) throw new Error(`esperava aceite, o leitor recusou: ${JSON.stringify(r.recusas)}`);
  return r.valor as unknown as Saco;
};

// ---------------------------------------------------------------------------------------------------
// F6A-D1 — a família
// ---------------------------------------------------------------------------------------------------

describe("F6A-D1 a família do orçamento de compra", () => {
  it("é a variante 'orcamento' de erp.documentos_compra, módulo compras, com rótulo; o registry continua válido", () => {
    expect(familiaOperacionalDeDocumentoCompra("orcamento")).toBe(ORCAMENTO);
    expect(tipoOperacao(ORCAMENTO)?.origem).toEqual({ tabela: "erp.documentos_compra", discriminador: "especie", valor: "orcamento" });
    expect(tipoOperacao(ORCAMENTO)?.modulo).toBe("compras");
    expect(chaveI18nDaFamiliaOperacional(ORCAMENTO)).toBe("top.compras.orcamento");
    expect(ptBR.mensagens["top.compras.orcamento"]).toBe("Orçamento de compra");
    expect(validarRegistroTipoOperacao()).toEqual([]);
  });

  it("a ida e volta pelo registry fecha; o orçamento é da tabela comercial de compras", () => {
    expect(varianteDeDocumentoCompraDaFamilia(ORCAMENTO)).toBe("orcamento");
    expect(tabelaComercialDaFamilia(ORCAMENTO)).toBe("erp.documentos_compra");
    // A premissa: as outras duas continuam as de antes.
    expect(varianteDeDocumentoCompraDaFamilia(PEDIDO)).toBe("pedido");
    expect(varianteDeDocumentoCompraDaFamilia(COMPRA)).toBe("compra");
  });
});

// ---------------------------------------------------------------------------------------------------
// F6A-D2 — fluxoCompra
// ---------------------------------------------------------------------------------------------------

describe("F6A-D2 a seção fluxoCompra (Fluxo de compra)", () => {
  it("está na lista do produto, com o nome, o rótulo, a ajuda e as chaves do contrato", () => {
    expect(DEFINICOES_SECOES_V5).toContain(SECAO_FLUXO_COMPRA);
    expect(SECAO_FLUXO_COMPRA.nome).toBe("fluxoCompra");
    expect(SECAO_FLUXO_COMPRA.rotulo).toBe("Fluxo de compra");
    // Decisão do Maike de 03/10 (o par): a ajuda diz que a aprovação e esta regra andam juntas.
    expect(SECAO_FLUXO_COMPRA.ajuda).toBe("Exigir pedido finalizado para receber: com Sim, o pedido só é recebido depois de finalizado e aprovado. Com Não, o pedido aberto ou finalizado é recebido, como hoje. Esta regra anda junto com a aprovação do pedido (aba Aprovação), que vale ao finalizar: com aprovação ela é Sim, sem aprovação ela é Não — ligar ou desligar a aprovação liga ou desliga esta regra.");
    expect(SECAO_FLUXO_COMPRA.chaves).toEqual(["exigeFinalizar"]);
    expect(Object.isFrozen(SECAO_FLUXO_COMPRA)).toBe(true);
  });

  it("o neutro é o comportamento de hoje (não exige finalizar) e é um objeto novo a cada chamada", () => {
    expect(SECAO_FLUXO_COMPRA.neutro()).toEqual({ exigeFinalizar: false });
    expect(SECAO_FLUXO_COMPRA.neutro()).not.toBe(SECAO_FLUXO_COMPRA.neutro());
    expect(configuracaoNeutraTopV5().fluxoCompra).toEqual({ exigeFinalizar: false });
  });

  it("lida estrita num 5: Sim e Não passam; tipo errado, chave a mais e campo que falta são recusa no caminho", () => {
    expect(lidaDe(v5Com({ fluxoCompra: { exigeFinalizar: true } })).fluxoCompra).toEqual({ exigeFinalizar: true });
    expect(lidaDe(v5Com({ fluxoCompra: { exigeFinalizar: false } })).fluxoCompra).toEqual({ exigeFinalizar: false });
    expect(recusasDe(v5Com({ fluxoCompra: { exigeFinalizar: "sim" } }))).toEqual([{ motivo: "tipo_invalido", caminho: "fluxoCompra.exigeFinalizar" }]);
    expect(recusasDe(v5Com({ fluxoCompra: { exigeFinalizar: true, x: 1 } }))).toEqual([{ motivo: "campo_desconhecido", caminho: "fluxoCompra.x" }]);
    expect(recusasDe(v5Com({ fluxoCompra: {} }))).toEqual([{ motivo: "tipo_invalido", caminho: "fluxoCompra.exigeFinalizar" }]);
    expect(recusasDe(v5Com({ fluxoCompra: true }))).toEqual([{ motivo: "tipo_invalido", caminho: "fluxoCompra" }]);
  });

  it("AUSENTE num 5 é o neutro; nos formatos 1 a 4 a chave é recusada", () => {
    const semSecao = v5Com({});
    delete semSecao.fluxoCompra;
    expect(Object.hasOwn(semSecao, "fluxoCompra"), "a premissa: a chave não está lá").toBe(false);
    expect(lidaDe(semSecao).fluxoCompra).toEqual({ exigeFinalizar: false });
    for (const c of [configuracaoNeutraTop(), configuracaoNeutraTopV2(), configuracaoNeutraTopV3(), configuracaoNeutraTopV4()]) {
      expect(recusasDe({ ...clonar(c), fluxoCompra: { exigeFinalizar: true } }), `formato ${c.versaoSchema}`)
        .toEqual([{ motivo: "campo_desconhecido", caminho: "fluxoCompra" }]);
    }
  });

  it("só o pedido de compra usa a seção (perguntado ao registry); linhas do histórico", () => {
    expect(SECAO_FLUXO_COMPRA.usadaPor(PEDIDO)).toBe(true);
    for (const f of [COMPRA, ORCAMENTO, "vendas.pedido", "compras.solicitacao", "", "nao.existe"]) expect(SECAO_FLUXO_COMPRA.usadaPor(f), f).toBe(false);
    expect(SECAO_FLUXO_COMPRA.linhas({ exigeFinalizar: true })).toEqual([["Exigir pedido finalizado para receber", "Sim"]]);
    expect(SECAO_FLUXO_COMPRA.linhas({ exigeFinalizar: false })).toEqual([["Exigir pedido finalizado para receber", "Não"]]);
    const v = { exigeFinalizar: true };
    expect(SECAO_FLUXO_COMPRA.normalizar(v)).toEqual(v);
    expect(SECAO_FLUXO_COMPRA.normalizar(v)).not.toBe(v);
  });
});

// ---------------------------------------------------------------------------------------------------
// F6A-D3 — divergenciaPedido
// ---------------------------------------------------------------------------------------------------

describe("F6A-D3 a seção divergenciaPedido (Divergência com o pedido)", () => {
  const BLOQUEIA: DivergenciaPedidoTop = { modo: "bloqueia", toleranciaPrecoPercentual: "5.5", toleranciaQuantidadePercentual: "10" };

  it("está na lista do produto, com o nome, o rótulo, a ajuda, as chaves, os modos e o teto", () => {
    expect(DEFINICOES_SECOES_V5).toContain(SECAO_DIVERGENCIA_PEDIDO);
    expect(SECAO_DIVERGENCIA_PEDIDO.nome).toBe("divergenciaPedido");
    expect(SECAO_DIVERGENCIA_PEDIDO.rotulo).toBe("Divergência com o pedido");
    expect(SECAO_DIVERGENCIA_PEDIDO.ajuda).toBe("Na compra recebida de um pedido, compara cada item com o pedido: o preço unitário líquido e a quantidade (contra o saldo do pedido). Nenhuma: não compara, como hoje. Avisar: a prévia da confirmação mostra a divergência. Bloquear: a compra com divergência acima da tolerância não é confirmada. Tolerância em %, de 0 a 100, com ponto como separador decimal.");
    expect(SECAO_DIVERGENCIA_PEDIDO.chaves).toEqual(["modo", "toleranciaPrecoPercentual", "toleranciaQuantidadePercentual"]);
    expect(MODOS_DIVERGENCIA_PEDIDO).toEqual(["nenhuma", "avisa", "bloqueia"]);
    expect(ROTULOS_MODO_DIVERGENCIA_PEDIDO).toEqual({ nenhuma: "Nenhuma", avisa: "Avisar", bloqueia: "Bloquear" });
    expect(TOLERANCIA_MAXIMA_DIVERGENCIA_PEDIDO).toBe("100");
  });

  it("o neutro é 'Nenhuma' (o comportamento de hoje) com as tolerâncias em \"0\"", () => {
    expect(SECAO_DIVERGENCIA_PEDIDO.neutro()).toEqual({ modo: "nenhuma", toleranciaPrecoPercentual: "0", toleranciaQuantidadePercentual: "0" });
    expect(configuracaoNeutraTopV5().divergenciaPedido).toEqual(SECAO_DIVERGENCIA_PEDIDO.neutro());
  });

  it("lida estrita: modo da lista, tolerâncias em texto decimal de 0 a 100 com até 2 casas", () => {
    expect(lidaDe(v5Com({ divergenciaPedido: { ...BLOQUEIA } })).divergenciaPedido).toEqual(BLOQUEIA);
    // As bordas aceitas (o máximo inclusive), e o decimal digitado não é reformatado.
    for (const t of ["0", "100", "100.00", "0.5", "12.50", "99.99"]) {
      expect((lidaDe(v5Com({ divergenciaPedido: { ...BLOQUEIA, toleranciaPrecoPercentual: t } })).divergenciaPedido as DivergenciaPedidoTop).toleranciaPrecoPercentual, t).toBe(t);
    }
    const casos: ReadonlyArray<readonly [Saco, RecusaConfiguracaoTop]> = [
      [{ modo: "quase" }, { motivo: "valor_invalido", caminho: "divergenciaPedido.modo" }],
      [{ modo: 1 }, { motivo: "tipo_invalido", caminho: "divergenciaPedido.modo" }],
      [{ toleranciaPrecoPercentual: "100.01" }, { motivo: "valor_invalido", caminho: "divergenciaPedido.toleranciaPrecoPercentual" }],
      [{ toleranciaPrecoPercentual: "-1" }, { motivo: "valor_invalido", caminho: "divergenciaPedido.toleranciaPrecoPercentual" }],
      [{ toleranciaPrecoPercentual: "1.234" }, { motivo: "valor_invalido", caminho: "divergenciaPedido.toleranciaPrecoPercentual" }],
      [{ toleranciaPrecoPercentual: "1e2" }, { motivo: "valor_invalido", caminho: "divergenciaPedido.toleranciaPrecoPercentual" }],
      [{ toleranciaPrecoPercentual: "5,5" }, { motivo: "valor_invalido", caminho: "divergenciaPedido.toleranciaPrecoPercentual" }],
      [{ toleranciaPrecoPercentual: 5 }, { motivo: "tipo_invalido", caminho: "divergenciaPedido.toleranciaPrecoPercentual" }],
      [{ toleranciaQuantidadePercentual: "150" }, { motivo: "valor_invalido", caminho: "divergenciaPedido.toleranciaQuantidadePercentual" }],
      [{ toleranciaQuantidadePercentual: null }, { motivo: "tipo_invalido", caminho: "divergenciaPedido.toleranciaQuantidadePercentual" }],
      [{ x: 1 }, { motivo: "campo_desconhecido", caminho: "divergenciaPedido.x" }],
    ];
    for (const [ajuste, recusa] of casos) {
      expect(recusasDe(v5Com({ divergenciaPedido: { ...BLOQUEIA, ...ajuste } })), JSON.stringify(ajuste)).toEqual([recusa]);
    }
  });

  it("normalizar: 'Nenhuma' zera as tolerâncias (não decidem nada); Avisar e Bloquear ficam como vieram", () => {
    expect(lidaDe(v5Com({ divergenciaPedido: { modo: "nenhuma", toleranciaPrecoPercentual: "7", toleranciaQuantidadePercentual: "8" } })).divergenciaPedido)
      .toEqual(SECAO_DIVERGENCIA_PEDIDO.neutro());
    const avisa: DivergenciaPedidoTop = { modo: "avisa", toleranciaPrecoPercentual: "7.50", toleranciaQuantidadePercentual: "0" };
    expect(SECAO_DIVERGENCIA_PEDIDO.normalizar(avisa)).toEqual(avisa);
    expect(SECAO_DIVERGENCIA_PEDIDO.normalizar(avisa)).not.toBe(avisa);
  });

  it("só a compra usa a seção (perguntado ao registry); linhas do histórico com o rótulo do modo", () => {
    expect(SECAO_DIVERGENCIA_PEDIDO.usadaPor(COMPRA)).toBe(true);
    for (const f of [PEDIDO, ORCAMENTO, "vendas.venda", "estoque.entrada", ""]) expect(SECAO_DIVERGENCIA_PEDIDO.usadaPor(f), f).toBe(false);
    expect(SECAO_DIVERGENCIA_PEDIDO.linhas(BLOQUEIA)).toEqual([
      ["Divergência com o pedido", "Bloquear"],
      ["Tolerância de preço", "5.5%"],
      ["Tolerância de quantidade", "10%"],
    ]);
  });
});

// ---------------------------------------------------------------------------------------------------
// F6A-D4 — a leitura pela execução
// ---------------------------------------------------------------------------------------------------

describe("F6A-D4 a leitura das seções na versão congelada (fail-closed)", () => {
  const ligadoV5 = v5Com({
    fluxoCompra: { exigeFinalizar: true },
    divergenciaPedido: { modo: "avisa", toleranciaPrecoPercentual: "2", toleranciaQuantidadePercentual: "3" },
  });

  it("sem versão congelada → o neutro (documento sem TOP: o de hoje)", () => {
    expect(fluxoCompraDaVersaoTop(null)).toEqual({ ok: true, valor: { exigeFinalizar: false } });
    expect(divergenciaPedidoDaVersaoTop(null)).toEqual({ ok: true, valor: SECAO_DIVERGENCIA_PEDIDO.neutro() });
  });

  it("formatos 1 a 4 legíveis → o neutro (a seção não existia quando a versão foi gravada)", () => {
    const v4Rico: ConfiguracaoTipoOperacao = { ...configuracaoNeutraTopV4(), aprovacao: { politica: "sempre", valorMinimo: null, momento: "antes_da_confirmacao" } };
    for (const c of [configuracaoNeutraTop(), configuracaoNeutraTopV2(), configuracaoNeutraTopV3(), v4Rico]) {
      expect(lerConfiguracaoTop(clonar(c)).ok, `a premissa: o formato ${c.versaoSchema} é legível`).toBe(true);
      expect(fluxoCompraDaVersaoTop({ codigoBase: PEDIDO, configuracao: clonar(c) }), `formato ${c.versaoSchema}`).toEqual({ ok: true, valor: { exigeFinalizar: false } });
      expect(divergenciaPedidoDaVersaoTop({ codigoBase: COMPRA, configuracao: clonar(c) }), `formato ${c.versaoSchema}`).toEqual({ ok: true, valor: SECAO_DIVERGENCIA_PEDIDO.neutro() });
    }
  });

  it("formato 5 → a seção como a versão a diz, lida e normalizada", () => {
    expect(fluxoCompraDaVersaoTop({ codigoBase: PEDIDO, configuracao: ligadoV5 })).toEqual({ ok: true, valor: { exigeFinalizar: true } });
    expect(divergenciaPedidoDaVersaoTop({ codigoBase: COMPRA, configuracao: ligadoV5 }))
      .toEqual({ ok: true, valor: { modo: "avisa", toleranciaPrecoPercentual: "2", toleranciaQuantidadePercentual: "3" } });
    const nenhumaComSobra = v5Com({ divergenciaPedido: { modo: "nenhuma", toleranciaPrecoPercentual: "9", toleranciaQuantidadePercentual: "9" } });
    expect(divergenciaPedidoDaVersaoTop({ codigoBase: COMPRA, configuracao: nenhumaComSobra })).toEqual({ ok: true, valor: SECAO_DIVERGENCIA_PEDIDO.neutro() });
    // Um 5 gravado antes da seção existir (a chave ausente) → o neutro.
    const semSecoes = v5Com({});
    delete semSecoes.fluxoCompra;
    delete semSecoes.divergenciaPedido;
    expect(fluxoCompraDaVersaoTop({ codigoBase: PEDIDO, configuracao: semSecoes })).toEqual({ ok: true, valor: { exigeFinalizar: false } });
  });

  it("formatos 1 a 4 MALFORMADOS → o neutro, sem ler (decisão 277, regra 4; §18.2): nunca uma recusa nova; premissa: o leitor estrito os recusa", () => {
    const v4Rico: ConfiguracaoTipoOperacao = { ...configuracaoNeutraTopV4(), aprovacao: { politica: "sempre", valorMinimo: null, momento: "antes_da_confirmacao" } };
    for (const c of [configuracaoNeutraTop(), configuracaoNeutraTopV2(), configuracaoNeutraTopV3(), v4Rico]) {
      const malformada = { ...clonar(c), lixo: true };
      expect(lerConfiguracaoTop(malformada).ok, `a premissa: o leitor estrito recusa o formato ${c.versaoSchema} com uma chave a mais`).toBe(false);
      expect(fluxoCompraDaVersaoTop({ codigoBase: PEDIDO, configuracao: malformada }), `formato ${c.versaoSchema}`).toEqual({ ok: true, valor: { exigeFinalizar: false } });
      expect(divergenciaPedidoDaVersaoTop({ codigoBase: COMPRA, configuracao: malformada }), `formato ${c.versaoSchema}`).toEqual({ ok: true, valor: SECAO_DIVERGENCIA_PEDIDO.neutro() });
    }
    // As regras gerais dizem o mesmo de 1 a 3 (o corte): neutro, nunca recusa.
    for (const c of [configuracaoNeutraTop(), configuracaoNeutraTopV2(), configuracaoNeutraTopV3()]) {
      expect(regrasGeraisDaVersaoTop({ codigoBase: PEDIDO, configuracao: { ...clonar(c), lixo: true } }).ok, `regras gerais, formato ${c.versaoSchema}`).toBe(true);
    }
  });

  it("formato desconhecido ou 5 malformado → configuracao_ilegivel (nunca o neutro)", () => {
    const ilegiveis: unknown[] = [
      { ...ligadoV5, versaoSchema: 6 },
      { versaoSchema: 99 },
      v5Com({ divergenciaPedido: { modo: "talvez", toleranciaPrecoPercentual: "0", toleranciaQuantidadePercentual: "0" } }),
      v5Com({ fluxoCompra: { exigeFinalizar: "sim" } }),
      { ...clonar(ligadoV5), lixo: true },
      null,
      "texto",
    ];
    for (const configuracao of ilegiveis) {
      expect(fluxoCompraDaVersaoTop({ codigoBase: PEDIDO, configuracao }), JSON.stringify(configuracao)).toEqual({ ok: false, motivo: "configuracao_ilegivel" });
      expect(divergenciaPedidoDaVersaoTop({ codigoBase: COMPRA, configuracao }), JSON.stringify(configuracao)).toEqual({ ok: false, motivo: "configuracao_ilegivel" });
    }
  });

  it("a leitura não muta a versão nem devolve referência a ela", () => {
    const bruto = clonar(ligadoV5);
    const antes = JSON.stringify(bruto);
    const r = fluxoCompraDaVersaoTop({ codigoBase: PEDIDO, configuracao: bruto });
    if (!r.ok) throw new Error("premissa: legível");
    expect(r.valor).not.toBe(bruto.fluxoCompra);
    expect(JSON.stringify(bruto)).toBe(antes);
  });
});

// ---------------------------------------------------------------------------------------------------
// F6A-D5 — a conta da divergência
// ---------------------------------------------------------------------------------------------------

/** Uma linha da compra: por padrão, 10 unidades a R$ 10,00 contra um item do pedido de 10 a R$ 10,00, saldo 10. */
const linhaDe = (p: Partial<LinhaParaDivergencia> = {}): LinhaParaDivergencia => ({
  itemId: "c1", itemPedidoId: "p1", produto: "001 - Milho",
  quantidadeCompra: "10", valorTotalCompra: "100.00",
  quantidadePedido: "10", valorTotalPedido: "100.00",
  saldoAntesDaCompra: "10",
  ...p,
});
const secao = (modo: DivergenciaPedidoTop["modo"], preco = "0", quantidade = "0"): DivergenciaPedidoTop =>
  ({ modo, toleranciaPrecoPercentual: preco, toleranciaQuantidadePercentual: quantidade });

describe("F6A-D5 divergenciasDaCompra — tabela de casos", () => {
  interface Caso {
    nome: string;
    secao: DivergenciaPedidoTop;
    linhas: LinhaParaDivergencia[];
    itens: { campo: "preco" | "quantidade"; itemPedidoId: string; itemIds: string[]; valorPedido: string; valorCompra: string; diferencaPercentual: string | null; acimaDaTolerancia: boolean }[];
    bloqueia: boolean;
  }
  const casos: Caso[] = [
    { nome: "igual ao pedido → nada", secao: secao("bloqueia"), linhas: [linhaDe()], itens: [], bloqueia: false },
    {
      nome: "preço acima, avisa → o item, sem bloquear", secao: secao("avisa", "5"), linhas: [linhaDe({ valorTotalCompra: "110.00" })],
      itens: [{ campo: "preco", itemPedidoId: "p1", itemIds: ["c1"], valorPedido: "10.000000", valorCompra: "11.000000", diferencaPercentual: "10.00", acimaDaTolerancia: true }],
      bloqueia: false,
    },
    {
      nome: "preço acima, bloqueia → bloqueia", secao: secao("bloqueia", "5"), linhas: [linhaDe({ valorTotalCompra: "110.00" })],
      itens: [{ campo: "preco", itemPedidoId: "p1", itemIds: ["c1"], valorPedido: "10.000000", valorCompra: "11.000000", diferencaPercentual: "10.00", acimaDaTolerancia: true }],
      bloqueia: true,
    },
    {
      nome: "preço ABAIXO também diverge (diferença absoluta)", secao: secao("bloqueia", "5"), linhas: [linhaDe({ valorTotalCompra: "90.00" })],
      itens: [{ campo: "preco", itemPedidoId: "p1", itemIds: ["c1"], valorPedido: "10.000000", valorCompra: "9.000000", diferencaPercentual: "-10.00", acimaDaTolerancia: true }],
      bloqueia: true,
    },
    {
      nome: "tolerância no LIMITE (igual não passa)", secao: secao("bloqueia", "5"), linhas: [linhaDe({ valorTotalCompra: "105.00" })],
      itens: [{ campo: "preco", itemPedidoId: "p1", itemIds: ["c1"], valorPedido: "10.000000", valorCompra: "10.500000", diferencaPercentual: "5.00", acimaDaTolerancia: false }],
      bloqueia: false,
    },
    {
      nome: "um centavo acima do limite passa", secao: secao("bloqueia", "5"), linhas: [linhaDe({ valorTotalCompra: "105.01" })],
      itens: [{ campo: "preco", itemPedidoId: "p1", itemIds: ["c1"], valorPedido: "10.000000", valorCompra: "10.501000", diferencaPercentual: "5.01", acimaDaTolerancia: true }],
      bloqueia: true,
    },
    {
      nome: "comparação EXATA antes de arredondar: 0.10002% > 0.1% mesmo exibindo \"0.10\"", secao: secao("bloqueia", "0.1"),
      linhas: [linhaDe({ quantidadeCompra: "3", valorTotalCompra: "10.01", quantidadePedido: "3", valorTotalPedido: "10.00", saldoAntesDaCompra: "3" })],
      itens: [{ campo: "preco", itemPedidoId: "p1", itemIds: ["c1"], valorPedido: "3.333333", valorCompra: "3.336667", diferencaPercentual: "0.10", acimaDaTolerancia: true }],
      bloqueia: true,
    },
    {
      nome: "líquido em 6 casas, meio para cima: 0.0000005 e 0.0000008 viram 0.000001 — não diverge", secao: secao("bloqueia"),
      linhas: [linhaDe({ quantidadeCompra: "12500", valorTotalCompra: "0.01", quantidadePedido: "20000", valorTotalPedido: "0.01", saldoAntesDaCompra: "12500" })],
      itens: [], bloqueia: false,
    },
    {
      nome: "base zero no pedido: a compra com preço diverge sem percentual, sempre acima", secao: secao("bloqueia", "100"),
      linhas: [linhaDe({ valorTotalPedido: "0.00", valorTotalCompra: "50.00" })],
      itens: [{ campo: "preco", itemPedidoId: "p1", itemIds: ["c1"], valorPedido: "0.000000", valorCompra: "5.000000", diferencaPercentual: null, acimaDaTolerancia: true }],
      bloqueia: true,
    },
    { nome: "base zero dos dois lados → nada", secao: secao("bloqueia"), linhas: [linhaDe({ valorTotalPedido: "0.00", valorTotalCompra: "0.00" })], itens: [], bloqueia: false },
    {
      nome: "quantidade parcial dentro da tolerância", secao: secao("bloqueia", "0", "50"),
      linhas: [linhaDe({ quantidadeCompra: "6", valorTotalCompra: "60.00" })],
      itens: [{ campo: "quantidade", itemPedidoId: "p1", itemIds: ["c1"], valorPedido: "10.0000", valorCompra: "6.0000", diferencaPercentual: "-40.00", acimaDaTolerancia: false }],
      bloqueia: false,
    },
    {
      nome: "quantidade parcial acima da tolerância", secao: secao("bloqueia", "0", "30"),
      linhas: [linhaDe({ quantidadeCompra: "6", valorTotalCompra: "60.00" })],
      itens: [{ campo: "quantidade", itemPedidoId: "p1", itemIds: ["c1"], valorPedido: "10.0000", valorCompra: "6.0000", diferencaPercentual: "-40.00", acimaDaTolerancia: true }],
      bloqueia: true,
    },
    {
      nome: "duas linhas do mesmo item do pedido (o lote divide): a quantidade soma as duas", secao: secao("bloqueia", "0", "20"),
      linhas: [
        linhaDe({ itemId: "c1", quantidadeCompra: "4", valorTotalCompra: "40.00" }),
        linhaDe({ itemId: "c2", quantidadeCompra: "3", valorTotalCompra: "30.00" }),
      ],
      itens: [{ campo: "quantidade", itemPedidoId: "p1", itemIds: ["c1", "c2"], valorPedido: "10.0000", valorCompra: "7.0000", diferencaPercentual: "-30.00", acimaDaTolerancia: true }],
      bloqueia: true,
    },
    {
      nome: "o saldo antes desta compra (entrega anterior) é a base da quantidade", secao: secao("bloqueia", "0", "0"),
      linhas: [linhaDe({ quantidadeCompra: "4", valorTotalCompra: "40.00", saldoAntesDaCompra: "4" })],
      itens: [], bloqueia: false,
    },
    { nome: "saldo zero → a quantidade não entra", secao: secao("bloqueia"), linhas: [linhaDe({ saldoAntesDaCompra: "0" })], itens: [], bloqueia: false },
    {
      nome: "ordem: por item do pedido (na ordem das linhas); no item, o preço antes da quantidade", secao: secao("avisa", "1", "1"),
      linhas: [
        linhaDe({ itemId: "c1", itemPedidoId: "pA", quantidadeCompra: "5", valorTotalCompra: "60.00" }),
        linhaDe({ itemId: "c2", itemPedidoId: "pB", valorTotalCompra: "120.00" }),
      ],
      itens: [
        { campo: "preco", itemPedidoId: "pA", itemIds: ["c1"], valorPedido: "10.000000", valorCompra: "12.000000", diferencaPercentual: "20.00", acimaDaTolerancia: true },
        { campo: "quantidade", itemPedidoId: "pA", itemIds: ["c1"], valorPedido: "10.0000", valorCompra: "5.0000", diferencaPercentual: "-50.00", acimaDaTolerancia: true },
        { campo: "preco", itemPedidoId: "pB", itemIds: ["c2"], valorPedido: "10.000000", valorCompra: "12.000000", diferencaPercentual: "20.00", acimaDaTolerancia: true },
      ],
      bloqueia: false,
    },
  ];

  it.each(casos.map((c) => [c.nome, c] as const))("%s", (_nome, c) => {
    const r = divergenciasDaCompra(c.secao, c.linhas);
    expect(r.modo).toBe(c.secao.modo);
    expect(r.toleranciaPrecoPercentual).toBe(c.secao.toleranciaPrecoPercentual);
    expect(r.toleranciaQuantidadePercentual).toBe(c.secao.toleranciaQuantidadePercentual);
    expect(r.itens).toEqual(c.itens.map((i) => ({ ...i, produto: "001 - Milho" })));
    expect(r.bloqueia).toBe(c.bloqueia);
  });

  it("modo Nenhuma → nada, mesmo com a divergência que bloquearia (a premissa: no Bloquear ela bloqueia)", () => {
    const linhas = [linhaDe({ valorTotalCompra: "200.00", quantidadeCompra: "1" })];
    expect(divergenciasDaCompra(secao("bloqueia"), linhas).bloqueia).toBe(true);
    expect(divergenciasDaCompra(secao("nenhuma"), linhas)).toEqual({ modo: "nenhuma", toleranciaPrecoPercentual: "0", toleranciaQuantidadePercentual: "0", itens: [], bloqueia: false });
  });

  it("Bloquear com divergência SÓ dentro da tolerância não bloqueia; uma acima basta", () => {
    const dentro = [linhaDe({ valorTotalCompra: "102.00" })];
    expect(divergenciasDaCompra(secao("bloqueia", "5"), dentro)).toMatchObject({ bloqueia: false, itens: [{ campo: "preco", acimaDaTolerancia: false }] });
    const umaAcima = [...dentro, linhaDe({ itemId: "c2", itemPedidoId: "p2", valorTotalCompra: "120.00" })];
    expect(divergenciasDaCompra(secao("bloqueia", "5"), umaAcima).bloqueia).toBe(true);
  });

  it("sem linhas → nada; a entrada não é mutada", () => {
    expect(divergenciasDaCompra(secao("bloqueia"), [])).toMatchObject({ itens: [], bloqueia: false });
    const linhas = Object.freeze([Object.freeze(linhaDe({ valorTotalCompra: "130.00" }))]);
    expect(() => divergenciasDaCompra(secao("avisa"), linhas)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------------------------------
// F6A-D6 — perfil, grafo, matriz, exigências
// ---------------------------------------------------------------------------------------------------

describe("F6A-D6 o perfil, o grafo, a matriz e as exigências", () => {
  it("perfil do orçamento de compra: sem Próximas operações, sem Aprovação, sem Execução; Fornecedor e Observação", () => {
    const p = perfilDaFamiliaTop(ORCAMENTO);
    expect(p).not.toBeNull();
    expect(p!.abas).toEqual(["identificacao", "geral", "estoque", "financeiro", "fiscal"]);
    expect(p!.exigencias).toEqual([{ chave: "exigeParceiro", rotulo: "Fornecedor" }, { chave: "exigeObservacao", rotulo: "Observação" }]);
    expect(p!.secoesNeutras).toEqual(["destino", "fluxo", "fluxoCompra", "divergenciaPedido", "financeiroPadrao"]);
  });

  it("perfil do pedido (Fluxo de compra e Aprovação) e da compra (Divergência com o pedido)", () => {
    expect(perfilDaFamiliaTop(PEDIDO)?.abas).toEqual(["identificacao", "geral", "destinos", "estoque", "fluxoCompra", "financeiroPadrao", "financeiro", "fiscal", "aprovacao"]);
    expect(perfilDaFamiliaTop(PEDIDO)?.secoesNeutras).toEqual(["destino", "fluxo", "divergenciaPedido"]);
    expect(perfilDaFamiliaTop(COMPRA)?.abas).toEqual(["identificacao", "geral", "estoque", "divergenciaPedido", "financeiroPadrao", "financeiro", "fiscal", "aprovacao", "execucao"]);
    expect(perfilDaFamiliaTop(COMPRA)?.secoesNeutras).toEqual(["destino", "fluxo", "fluxoCompra"]);
  });

  it("no 5, a seção que o tipo não usa fora do padrão é recusa (422); a que ele usa passa; a volta ao padrão a zera", () => {
    const ligado: ConfiguracaoTipoOperacaoV5 = {
      ...configuracaoNeutraTopV5(),
      fluxoCompra: { exigeFinalizar: true },
      divergenciaPedido: { modo: "bloqueia", toleranciaPrecoPercentual: "5", toleranciaQuantidadePercentual: "0" },
    };
    const recusa = (caminho: string, rotulo: string) => ({ motivo: "combinacao_nao_suportada", caminho, mensagem: mensagemSecaoForaDoTipo(rotulo) });
    expect(recusasDoPerfilTop(PEDIDO, ligado)).toEqual([recusa("divergenciaPedido", "Divergência com o pedido")]);
    expect(recusasDoPerfilTop(COMPRA, ligado)).toEqual([recusa("fluxoCompra", "Fluxo de compra")]);
    expect(recusasDoPerfilTop(ORCAMENTO, ligado)).toEqual([recusa("fluxoCompra", "Fluxo de compra"), recusa("divergenciaPedido", "Divergência com o pedido")]);
    // A premissa: cada uma no tipo que a usa passa; no 4 não há seção de extensão para recusar.
    expect(recusasDoPerfilTop(PEDIDO, { ...ligado, divergenciaPedido: SECAO_DIVERGENCIA_PEDIDO.neutro() })).toEqual([]);
    expect(recusasDoPerfilTop(COMPRA, { ...ligado, fluxoCompra: SECAO_FLUXO_COMPRA.neutro() })).toEqual([]);
    const r = normalizarPeloPerfilTop(perfilDaFamiliaTop(PEDIDO)!, ligado);
    expect(r.configuracao.divergenciaPedido).toEqual(SECAO_DIVERGENCIA_PEDIDO.neutro());
    expect(r.configuracao.fluxoCompra).toEqual({ exigeFinalizar: true });
    expect(r.voltaram.map((v) => v.caminho)).toEqual(["divergenciaPedido"]);
  });

  it("o tipo orcamento_compra tem a família, com a tela (F6b): o passo 1 do assistente o oferece", () => {
    const tipo = CATALOGO_TOP.tipos.find((t) => t.chave === "orcamento_compra");
    expect(tipo).toEqual({ chave: "orcamento_compra", grupo: "compras", rotulo: "Orçamento", familia: ORCAMENTO, temTela: true });
    const compras = tiposParaEscolhaTop(CATALOGO_TOP).find((g) => g.grupo.chave === "compras");
    expect(compras?.tipos.map((t) => t.chave)).toEqual(["pedido_compra", "orcamento_compra", "compra"]);
  });

  it("o grafo de compras é a lista congelada pedido → compra e pedido → orçamento, em espécies", () => {
    expect(ARESTAS_EXECUTAVEIS_EM_COMPRAS).toEqual([{ origem: "pedido", destino: "compra" }, { origem: "pedido", destino: "orcamento" }]);
    expect(Object.isFrozen(ARESTAS_EXECUTAVEIS_EM_COMPRAS)).toBe(true);
    for (const a of ARESTAS_EXECUTAVEIS_EM_COMPRAS) expect(Object.isFrozen(a)).toBe(true);
    expect(validarDestinoOperacao(PEDIDO, ORCAMENTO)).toEqual([]);
    expect(validarDestinoOperacao(PEDIDO, COMPRA)).toEqual([]);
    expect(validarDestinoOperacao(ORCAMENTO, COMPRA)).toEqual([{ motivo: "aresta_nao_executavel", origem: ORCAMENTO, destino: COMPRA }]);
    expect(validarDestinoOperacao(ORCAMENTO, "vendas.pedido")).toEqual([{ motivo: "tabelas_diferentes" }]);
    // Derivado: o orçamento não tem próximas operações; o pedido continua tendo.
    expect(familiaTemProximasOperacoes(ORCAMENTO)).toBe(false);
    expect(familiaTemProximasOperacoes(PEDIDO)).toBe(true);
  });

  it("a matriz: o pedido de compra aceita a aprovação inteira (ao finalizar); o orçamento de compra é como o de venda", () => {
    const pedido = regrasGeraisDaFamiliaTop(PEDIDO);
    expect(pedido.aprovacao).toEqual({ aceitos: ["nenhuma", "sempre", "por_valor"], motivo: null });
    // O resto da linha do pedido continua o de hoje.
    expect(pedido.confirmacao.aceitos).toEqual(["manual"]);
    expect(pedido.documentoSemItens.aceitos).toEqual(["proibido"]);
    expect(pedido.alteracaoAposConfirmacao.aceitos).toEqual(["bloqueada"]);
    const orcamento = regrasGeraisDaFamiliaTop(ORCAMENTO);
    const orcamentoDeVenda = regrasGeraisDaFamiliaTop("vendas.orcamento");
    expect({ ...orcamento, familia: "x" }).toEqual({ ...orcamentoDeVenda, familia: "x" });
    expect(MATRIZ_REGRAS_GERAIS_TOP.map((m) => m.familia).slice(-2)).toEqual([PEDIDO, ORCAMENTO]);
    // A gravação aceita "Sempre" e "A partir de um valor" no pedido; no orçamento, recusa com o motivo.
    const sempre = { ...configuracaoNeutraTopV4(), aprovacao: { politica: "sempre" as const, valorMinimo: null, momento: "antes_da_confirmacao" as const } };
    const porValor = { ...configuracaoNeutraTopV4(), aprovacao: { politica: "por_valor" as const, valorMinimo: "1000.00", momento: "antes_da_confirmacao" as const } };
    expect(validarRegrasGeraisTop(PEDIDO, sempre)).toEqual([]);
    expect(validarRegrasGeraisTop(PEDIDO, porValor)).toEqual([]);
    expect(validarRegrasGeraisTop(ORCAMENTO, sempre)).toEqual([{ motivo: "combinacao_nao_suportada", caminho: "aprovacao.politica", mensagem: "A aprovação acontece antes da confirmação, e este documento não é confirmado." }]);
    // E a execução da versão do pedido diz a aprovação, com a mesma conta da 0041.
    const r = regrasGeraisDaVersaoTop({ codigoBase: PEDIDO, configuracao: clonar(porValor) });
    if (!r.ok) throw new Error("premissa: legível");
    expect(exigeAprovacao(r.regras, "999.99")).toBe(false);
    expect(exigeAprovacao(r.regras, "1000.00")).toBe(true);
  });

  it("exigências da Geral: o orçamento de compra só tem fornecedor e observação; pedido e compra, o mapa da compra", () => {
    expect(exigenciasGeraisDaFamiliaTop(ORCAMENTO)).toBe(EXIGENCIAS_GERAIS_ORCAMENTO_COMPRA_TOP);
    expect(EXIGENCIAS_GERAIS_ORCAMENTO_COMPRA_TOP).toEqual([
      { chave: "exigeParceiro", caminho: "fornecedor_id", rotulo: "Fornecedor" },
      { chave: "exigeObservacao", caminho: "observacao", rotulo: "Observação" },
    ]);
    expect(exigenciasGeraisDaFamiliaTop(PEDIDO)).toBe(EXIGENCIAS_GERAIS_COMPRA_TOP);
    expect(exigenciasGeraisDaFamiliaTop(COMPRA)).toBe(EXIGENCIAS_GERAIS_COMPRA_TOP);
    const tudo = configuracaoNeutraTopV3();
    tudo.geral.exigeParceiro = true;
    tudo.geral.exigeCentroResultado = true;
    tudo.geral.exigeObservacao = true;
    tudo.geral.exigeTransportadora = true;
    expect(camposExigidosTop(tudo, EXIGENCIAS_GERAIS_ORCAMENTO_COMPRA_TOP)).toEqual(["fornecedor_id", "observacao"]);
  });
});

// ---------------------------------------------------------------------------------------------------
// F6A-D7 — layout, rótulos, permissões, ID Global, mensagens e erro
// ---------------------------------------------------------------------------------------------------

describe("F6A-D7 layout, rótulos, permissões, ID Global, mensagens e o código de erro", () => {
  it("o layout do sistema do orçamento de compra é válido e tem só os campos do corpo do orçamento", () => {
    expect(familiaTemLayout(ORCAMENTO)).toBe(true);
    expect(validarEstruturaLayout(ORCAMENTO, LAYOUT_DO_SISTEMA(ORCAMENTO))).toEqual([]);
    expect(catalogoDaFamilia(ORCAMENTO).map((c) => [c.parte, c.chave, c.rotulo, c.tipo, c.sistema ?? null])).toEqual([
      ["cabecalho", "empresa_id", "Empresa", "empresa", "sempre"],
      ["cabecalho", "fornecedor_id", "Fornecedor", "referencia", "sempre"],
      ["cabecalho", "data_documento", "Data do documento", "data", "sempre"],
      ["cabecalho", "condicao_pagamento_id", "Condição de pagamento", "referencia", null],
      ["cabecalho", "prazo_entrega_dias", "Prazo de entrega (dias)", "numero", null],
      ["cabecalho", "validade_orcamento", "Validade do orçamento", "data", null],
      ["cabecalho", "observacao", "Observação", "texto_longo", null],
      ["itens", "produto_id", "Produto", "referencia", "sempre"],
      ["itens", "quantidade", "Quantidade", "numero", "sempre"],
      ["itens", "valor_unitario", "Valor unitário", "numero", "sempre"],
    ]);
    expect(catalogoDaFamilia(ORCAMENTO).find((c) => c.chave === "fornecedor_id")?.referencia).toEqual({ recurso: "people", filtro: { is_provider: "true" } });
    expect(colunasComPadraoRegistro(ORCAMENTO)).toEqual([]);
  });

  it("o layout do orçamento recusa campo que o corpo dele não tem (lote, Local de estoque, frete)", () => {
    const l = LAYOUT_DO_SISTEMA(ORCAMENTO);
    const comFrete = { ...l, cabecalho: [...l.cabecalho, { campo: "frete", obrigatorio: false, editavel: true }] };
    expect(validarEstruturaLayout(ORCAMENTO, comFrete).map((e) => e.caminho)).toEqual([`cabecalho[${l.cabecalho.length}].campo`]);
    const comLote = { ...l, itens: [...l.itens, { campo: "lote", obrigatorio: false }] };
    expect(validarEstruturaLayout(ORCAMENTO, comLote).map((e) => e.caminho)).toEqual([`itens[${l.itens.length}].campo`]);
    const comLocal = { ...l, itens: [...l.itens, { campo: "armazem_id", obrigatorio: false }] };
    expect(validarEstruturaLayout(ORCAMENTO, comLocal).map((e) => e.caminho)).toEqual([`itens[${l.itens.length}].campo`]);
    // A premissa: no pedido, a coluna Local de estoque existe e é aceita.
    expect(validarEstruturaLayout(PEDIDO, LAYOUT_DO_SISTEMA(PEDIDO))).toEqual([]);
  });

  it("os obrigatórios do layout do orçamento: o que falta no corpo é apontado (itens em `itens[i]`)", () => {
    const l = LAYOUT_DO_SISTEMA(ORCAMENTO);
    const faltando = camposObrigatoriosFaltando(ORCAMENTO, l, { empresa_id: "e", fornecedor_id: null, data_documento: "2026-10-02", itens: [{ produto_id: "p", quantidade: "1", valor_unitario: "" }] });
    expect(faltando).toEqual([{ caminho: "fornecedor_id", rotulo: "Fornecedor" }, { caminho: "itens[0].valor_unitario", rotulo: "Valor unitário" }]);
  });

  it("rótulos: a espécie e as situações novas", () => {
    expect(enumLabel("especie_documento_compra", "orcamento")).toBe("Orçamento de compra");
    expect(enumLabel("situacao_documento_compra", "finalizado")).toBe("Finalizado");
    expect(enumLabel("situacao_documento_compra", "escolhido")).toBe("Escolhido");
    expect(enumLabel("situacao_documento_compra", "nao_escolhido")).toBe("Não escolhido");
    expect(enumOptions("especie_documento_compra").map((o) => o.value)).toEqual(["pedido", "compra", "orcamento"]);
  });

  it("permissões: o pedido aprova; o orçamento de compra é recurso próprio (CRUD), todos no módulo compras", () => {
    expect(PERMISSION_RESOURCES.find((r) => r.key === "pedidos_compra")?.actions).toEqual(["view", "create", "edit", "delete", "approve"]);
    expect(PERMISSION_RESOURCES.find((r) => r.key === "orcamentos_compra")).toEqual({
      key: "orcamentos_compra", label: "Orçamentos de Compra", module: "Operacional > Compras", actions: ["view", "create", "edit", "delete"],
    });
    for (const p of ["orcamentos_compra.view", "orcamentos_compra.create", "orcamentos_compra.edit", "orcamentos_compra.delete", "pedidos_compra.approve"]) {
      expect(moduloDaPermissao(p), p).toBe("compras");
    }
    // A premissa: a aprovação do pedido cai no MESMO módulo do `.edit` dele (o escopo de empresa é o de compras).
    expect(moduloDaPermissao("pedidos_compra.approve")).toBe(moduloDaPermissao("pedidos_compra.edit"));
  });

  it("ID Global: o orçamento abre em /compras/orcamentos/:id com orcamentos_compra.view; o catálogo continua válido", () => {
    expect(validarRegistroIdGlobal()).toEqual([]);
    expect(resolverRegistroGlobal("documentos_compra", "u1", { especie: "orcamento" })).toEqual({ rota: "/compras/orcamentos/u1", permissao: "orcamentos_compra.view" });
    expect(resolverRegistroGlobal("documentos_compra", "u1", { especie: "pedido" })).toEqual({ rota: "/compras/pedidos/u1", permissao: "pedidos_compra.view" });
  });

  it("a capacidade, as mensagens exatas e o código de erro 409 da divergência", () => {
    expect(CAPACIDADE_FINALIZACAO_E_ORCAMENTO_COMPRA).toBe(1);
    expect(MSG_FINALIZAR_SO_PEDIDO_ABERTO).toBe("Só pedido aberto é finalizado.");
    expect(MSG_PEDIDO_PRECISA_FINALIZAR_PARA_RECEBER).toBe("Este pedido precisa ser finalizado antes de ser recebido.");
    expect(MENSAGEM_APROVACAO_PENDENTE_PEDIDO).toBe("Este pedido precisa de aprovação antes de ser finalizado.");
    expect(MSG_DIVERGENCIA_COM_O_PEDIDO).toBe("A compra diverge do pedido além da tolerância desta operação.");
    expect(ErrorCodes.DIVERGENCIA_COM_O_PEDIDO).toBe("DIVERGENCIA_COM_O_PEDIDO");
    expect(errorHttpStatus.DIVERGENCIA_COM_O_PEDIDO).toBe(409);
  });
});
