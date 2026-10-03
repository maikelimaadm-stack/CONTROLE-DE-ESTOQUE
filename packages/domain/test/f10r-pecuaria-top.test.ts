import { describe, it, expect } from "vitest";
import { ptBR } from "@erp/plataforma";
import {
  CODIGOS_TIPO_OPERACAO,
  discriminadorDeTabela,
  resolverTipoOperacao,
  tipoOperacao,
  tipoOperacaoDoRegistro,
  validarRegistroTipoOperacao,
} from "../src/tipo-operacao.js";
import { MOVIMENTACOES_INTERNAS, MOVIMENTACOES_REBANHO } from "../src/rebanho.js";
import {
  perfilDosPadroesFinanceiros,
  familiaUsaPadroesFinanceiros,
  planoDaClassificacao,
  planoDaClassificacaoPorCampo,
  type PlanoDaClassificacao,
  type SemClassificacaoTop,
} from "../src/financeiro-padroes.js";
import {
  MENSAGEM_EXIGIR_FORA_DA_FAMILIA,
  MENSAGEM_PROVISAO_FORA_DA_FAMILIA,
  SECAO_FINANCEIRO_PADRAO,
  recusasDoFinanceiroPadraoDaFamilia,
  type SecaoFinanceiroPadrao,
} from "../src/tipo-operacao-secao-financeiro-padrao.js";
import {
  CATALOGO_TIPOS_MOVIMENTO_TOP,
  CATALOGO_TOP,
  EXIGENCIAS_GERAIS_SEM_DOCUMENTO_TOP,
  MENSAGEM_EXIGENCIA_FORA_DO_TIPO,
  lerCatalogoTop,
  perfilDaFamiliaTop,
  recusasDoPerfilTop,
  tiposParaEscolhaTop,
} from "../src/tipo-operacao-catalogo.js";
import { configuracaoNeutraTopV5 } from "../src/tipo-operacao-configuracao.js";
import { MATRIZ_REGRAS_GERAIS_TOP, regrasGeraisDaFamiliaTop } from "../src/tipo-operacao-regras-gerais.js";
import { familiaAceitaExecucaoConfiguradaTop } from "../src/tipo-operacao-execucao.js";
import { familiaTemProximasOperacoes } from "../src/tipo-operacao-destinos.js";
import { DICIONARIO_DE_DADOS } from "../dicionario-dados.mjs";

/**
 * OPERACOES-01 F10r (decisão 287) — A PECUÁRIA SAI DO LEGADO, NO DOMÍNIO.
 *
 * PT-1 o registry: duas famílias no movimento de animais, por `movement_type` (`purchase` e `sale`); o resto dos
 *      valores do CHECK não tem família (fail-closed); as 30 de antes, na ordem de antes.
 * PT-2 o perfil dos padrões financeiros das duas (despesa na compra, receita na venda; "exigir" vale; sem provisão).
 * PT-3 o catálogo do formato 5: os dois tipos em Módulos, com tela; o perfil derivado (sem exigências gerais: o movimento
 *      não cobra nenhuma); fora da matriz das regras gerais.
 * PT-4 a classificação POR CAMPO (`planoDaClassificacaoPorCampo`): o campo informado no documento nunca é descartado.
 * PT-5 o dicionário de dados: a entrada do movimento de animais cita as duas TOPs pelo `movement_type`.
 *
 * Os códigos de família aparecem LITERAIS aqui de propósito: o código de produção os pergunta ao registry
 * (`familia-operacional-ssot-audit`), e se o registry mudar, este teste falha alto.
 */

const COMPRA_ANIMAIS = "pecuaria.compra_de_animais";
const VENDA_ANIMAIS = "pecuaria.venda_de_animais";
const TABELA = "erp.animal_movements";

/** As 30 famílias do registry ANTES da F10r, na ordem (a lista literal da F10, base 9377122). */
const AS_30_DE_ANTES = [
  "estoque.entrada_manual", "estoque.documento_fiscal", "estoque.requisicao", "estoque.baixa", "estoque.devolucao",
  "estoque.transferencia_entre_armazens", "estoque.transferencia_entre_empresas", "estoque.producao_de_racao",
  "estoque.entrada", "estoque.saida", "estoque.transferencia", "estoque.ajuste", "estoque.requisicao_material",
  "estoque.consumo", "estoque.devolucao_consumo", "compras.solicitacao", "compras.pedido", "compras.compra",
  "compras.orcamento", "financeiro.conta_a_pagar", "financeiro.conta_a_receber", "financeiro.movimento_bancario",
  "vendas.orcamento", "vendas.pedido", "vendas.venda", "frota_ativos.abastecimento", "frota_ativos.manutencao",
  "ordens_servico.ordem_de_servico", "pecuaria.manejo", "confinamento.batelada",
];

/**
 * Os valores do CHECK de `erp.animal_movements.movement_type` (0006_livestock.sql), escritos à mão: a premissa de que
 * os valores sem família abaixo são valores REAIS da coluna, e não palavras inventadas.
 */
const CHECK_MOVEMENT_TYPE = [
  "purchase", "sale", "birth", "death", "loss", "evolution", "batch_transfer", "farm_transfer", "module_area_transfer",
  "inventory", "weaning", "separation", "processing",
];

// ---------------------------------------------------------------------------------------------------
// PT-1 — o registry
// ---------------------------------------------------------------------------------------------------

describe("PT-1 o registry: a compra e a venda de animais", () => {
  it("PT-1 purchase → compra de animais; sale → venda de animais; módulo pecuária; discriminador movement_type", () => {
    expect(resolverTipoOperacao(TABELA, "purchase")?.codigo).toBe(COMPRA_ANIMAIS);
    expect(resolverTipoOperacao(TABELA, "sale")?.codigo).toBe(VENDA_ANIMAIS);
    expect(discriminadorDeTabela(TABELA)).toBe("movement_type");
    for (const f of [COMPRA_ANIMAIS, VENDA_ANIMAIS]) {
      const t = tipoOperacao(f);
      expect(t?.modulo, f).toBe("pecuaria");
      expect(t?.origem.tabela, f).toBe(TABELA);
      expect(t?.origem.discriminador, f).toBe("movement_type");
    }
    // O registro do movimento resolve pela própria coluna.
    expect(tipoOperacaoDoRegistro(TABELA, { movement_type: "purchase" })?.codigo).toBe(COMPRA_ANIMAIS);
    expect(tipoOperacaoDoRegistro(TABELA, { movement_type: "sale" })?.codigo).toBe(VENDA_ANIMAIS);
    expect(validarRegistroTipoOperacao()).toEqual([]);
  });

  it("PT-1 nascimento, morte, perda e as internas NÃO têm família (fail-closed); vazio e ausente também não", () => {
    // A premissa: os valores são do CHECK da tabela e das listas do domínio do rebanho.
    expect(MOVIMENTACOES_REBANHO.map((o) => o.tipo).sort()).toEqual(["birth", "death", "loss", "purchase", "sale"]);
    expect([...MOVIMENTACOES_REBANHO.map((o) => o.tipo), ...MOVIMENTACOES_INTERNAS].sort()).toEqual([...CHECK_MOVEMENT_TYPE].sort());
    for (const v of CHECK_MOVEMENT_TYPE.filter((x) => x !== "purchase" && x !== "sale")) {
      expect(resolverTipoOperacao(TABELA, v), v).toBeUndefined();
    }
    expect(resolverTipoOperacao(TABELA, "")).toBeUndefined();
    expect(resolverTipoOperacao(TABELA)).toBeUndefined();
    expect(resolverTipoOperacao(TABELA, null)).toBeUndefined();
    expect(resolverTipoOperacao(TABELA, "PURCHASE"), "valor fora da forma do banco não cai na vizinha").toBeUndefined();
  });

  it("PT-1 os rótulos pt-BR: \"Compra de animais\" e \"Venda de animais\"", () => {
    expect(ptBR.mensagens["top.pecuaria.compra_de_animais"]).toBe("Compra de animais");
    expect(ptBR.mensagens["top.pecuaria.venda_de_animais"]).toBe("Venda de animais");
    expect(tipoOperacao(COMPRA_ANIMAIS)?.chaveI18n).toBe("top.pecuaria.compra_de_animais");
    expect(tipoOperacao(VENDA_ANIMAIS)?.chaveI18n).toBe("top.pecuaria.venda_de_animais");
  });

  it("PT-1 as duas são as DUAS ÚLTIMAS do registry; as 30 de antes continuam na ordem de antes", () => {
    expect(CODIGOS_TIPO_OPERACAO).toHaveLength(32);
    expect(CODIGOS_TIPO_OPERACAO.slice(0, 30)).toEqual(AS_30_DE_ANTES);
    expect(CODIGOS_TIPO_OPERACAO.slice(30)).toEqual([COMPRA_ANIMAIS, VENDA_ANIMAIS]);
  });
});

// ---------------------------------------------------------------------------------------------------
// PT-2 — o perfil dos padrões financeiros
// ---------------------------------------------------------------------------------------------------

describe("PT-2 o perfil dos padrões financeiros das duas", () => {
  const DO_TITULO = ["natureza", "centro", "tipoTitulo", "conta"];
  const NEUTRO: SecaoFinanceiroPadrao = { provisao: false, documentoTroca: true, semClassificacao: "padrao_legado" };
  const EXIGIR: SecaoFinanceiroPadrao = { ...NEUTRO, semClassificacao: "exigir" };
  const PROVISAO: SecaoFinanceiroPadrao = { ...NEUTRO, provisao: true };
  const recusaProvisao = { motivo: "combinacao_nao_suportada", caminho: "financeiroPadrao.provisao", mensagem: MENSAGEM_PROVISAO_FORA_DA_FAMILIA };
  const recusaExigir = { motivo: "combinacao_nao_suportada", caminho: "financeiroPadrao.semClassificacao", mensagem: MENSAGEM_EXIGIR_FORA_DA_FAMILIA };

  it("PT-2 os dois perfis exatos: compra com despesa, venda com receita; natureza, centro, tipo de título e conta", () => {
    expect(perfilDosPadroesFinanceiros(COMPRA_ANIMAIS)).toEqual({
      provisao: false, semClassificacao: true, trocaPeloDocumento: true, campos: DO_TITULO, naturezas: ["expense", "both"],
    });
    expect(perfilDosPadroesFinanceiros(VENDA_ANIMAIS)).toEqual({
      provisao: false, semClassificacao: true, trocaPeloDocumento: true, campos: DO_TITULO, naturezas: ["income", "both"],
    });
  });

  it("PT-2 a seção financeiroPadrao é usada pelas duas; uma família de nascimento (inexistente) não", () => {
    for (const f of [COMPRA_ANIMAIS, VENDA_ANIMAIS]) {
      expect(SECAO_FINANCEIRO_PADRAO.usadaPor(f), f).toBe(true);
      expect(familiaUsaPadroesFinanceiros(f), f).toBe(true);
    }
    // A premissa: o nascimento não tem família no registry — e o nome inventado não ganha a seção.
    expect(resolverTipoOperacao(TABELA, "birth")).toBeUndefined();
    expect(SECAO_FINANCEIRO_PADRAO.usadaPor("pecuaria.nascimento")).toBe(false);
    expect(perfilDosPadroesFinanceiros("pecuaria.nascimento")).toBeNull();
    // O manejo (a outra família da pecuária) continua sem a seção: não gera título.
    expect(SECAO_FINANCEIRO_PADRAO.usadaPor("pecuaria.manejo")).toBe(false);
  });

  it("PT-2 \"exigir\" é aceito nas duas (há padrão legado); a provisão ligada é recusada", () => {
    // A premissa: na conta a pagar o MESMO "exigir" é recusado (o lançamento avulso sempre informa natureza e centro).
    expect(recusasDoFinanceiroPadraoDaFamilia("financeiro.conta_a_pagar", EXIGIR)).toEqual([recusaExigir]);
    for (const f of [COMPRA_ANIMAIS, VENDA_ANIMAIS]) {
      expect(recusasDoFinanceiroPadraoDaFamilia(f, EXIGIR), f).toEqual([]);
      expect(recusasDoFinanceiroPadraoDaFamilia(f, NEUTRO), f).toEqual([]);
      expect(recusasDoFinanceiroPadraoDaFamilia(f, PROVISAO), f).toEqual([recusaProvisao]);
    }
  });
});

// ---------------------------------------------------------------------------------------------------
// PT-3 — o catálogo do formato 5
// ---------------------------------------------------------------------------------------------------

describe("PT-3 o catálogo: os dois tipos em Módulos, com tela", () => {
  it("PT-3 compra_animais e venda_animais no grupo Módulos, com a família e com tela", () => {
    const tipos = CATALOGO_TIPOS_MOVIMENTO_TOP.filter((t) => t.chave === "compra_animais" || t.chave === "venda_animais");
    expect(tipos.map((t) => ({ chave: t.chave, grupo: t.grupo, rotulo: t.rotulo, familia: t.familia, temTela: t.temTela }))).toEqual([
      { chave: "compra_animais", grupo: "modulos", rotulo: "Compra de animais", familia: COMPRA_ANIMAIS, temTela: true },
      { chave: "venda_animais", grupo: "modulos", rotulo: "Venda de animais", familia: VENDA_ANIMAIS, temTela: true },
    ]);
  });

  it("PT-3 o passo 1 de Módulos: os 8, na ordem, com a compra e a venda de animais no fim", () => {
    const modulos = tiposParaEscolhaTop(CATALOGO_TOP).find((g) => g.grupo.chave === "modulos");
    expect(modulos?.tipos.map((t) => t.chave)).toEqual([
      "abastecimento", "manutencao", "ordem_servico", "manejo", "batelada", "producao_racao", "compra_animais", "venda_animais",
    ]);
    expect(modulos?.tipos.slice(-2).map((t) => t.rotulo)).toEqual(["Compra de animais", "Venda de animais"]);
  });

  it("PT-3 o perfil derivado: sem documento, com Padrões financeiros; NENHUMA exigência geral (o movimento não cobra nenhuma); fora da matriz das regras gerais", () => {
    for (const f of [COMPRA_ANIMAIS, VENDA_ANIMAIS]) {
      // As premissas de onde o perfil sai.
      expect(MATRIZ_REGRAS_GERAIS_TOP.some((m) => m.familia === f), `${f} fora da matriz`).toBe(false);
      expect(familiaTemProximasOperacoes(f), f).toBe(false);
      expect(familiaAceitaExecucaoConfiguradaTop(f), f).toBe(false);
      const p = perfilDaFamiliaTop(f);
      if (!p) throw new Error(`premissa: ${f} tem perfil`);
      expect(p.abas, f).toEqual(["identificacao", "geral", "estoque", "financeiroPadrao", "financeiro", "fiscal"]);
      // O movimento lê da TOP padrão só os padrões financeiros: as 4 genéricas das famílias sem documento seriam
      // configuração que mente na tela (o servidor nunca as cobraria).
      expect(p.exigencias, f).toEqual([]);
      expect(p.secoesNeutras, f).toEqual(["destino", "fluxo", "fluxoCompra", "divergenciaPedido"]);
    }
    // PREMISSA: as outras famílias sem documento (a conta a pagar) continuam com as 4 genéricas.
    expect(perfilDaFamiliaTop("financeiro.conta_a_pagar")?.exigencias).toEqual(EXIGENCIAS_GERAIS_SEM_DOCUMENTO_TOP);
  });

  it("PT-3 a gravação do formato 5 recusa a exigência geral marcada nas duas (422 em geral.<chave>); o neutro do 5 não tem recusa", () => {
    for (const f of [COMPRA_ANIMAIS, VENDA_ANIMAIS]) {
      const neutra = configuracaoNeutraTopV5();
      expect(recusasDoPerfilTop(f, neutra), `${f}: o neutro do 5 é aceito`).toEqual([]);
      for (const chave of ["exigeParceiro", "exigeCentroResultado", "exigeObservacao", "exigeTransportadora"] as const) {
        const marcada = { ...neutra, geral: { ...neutra.geral, [chave]: true } };
        expect(recusasDoPerfilTop(f, marcada), `${f}.${chave}`).toEqual([
          { motivo: "combinacao_nao_suportada", caminho: `geral.${chave}`, mensagem: MENSAGEM_EXIGENCIA_FORA_DO_TIPO },
        ]);
      }
    }
  });

  it("PT-3 a regra geral das duas é o neutro \"sem documento\" (o mesmo da conta a pagar, que também está fora da matriz)", () => {
    // A premissa: a conta a pagar está fora da matriz — a linha dela é a "sem documento".
    expect(MATRIZ_REGRAS_GERAIS_TOP.some((m) => m.familia === "financeiro.conta_a_pagar")).toBe(false);
    const semFamilia = (f: string) => {
      const { familia: _familia, ...resto } = regrasGeraisDaFamiliaTop(f);
      return resto;
    };
    for (const f of [COMPRA_ANIMAIS, VENDA_ANIMAIS]) {
      const r = regrasGeraisDaFamiliaTop(f);
      expect(r.familia, f).toBe(f);
      expect(r.confirmacao.aceitos, f).toEqual(["manual"]);
      expect(r.documentoSemItens.aceitos, f).toEqual(["proibido"]);
      expect(r.alteracaoAposConfirmacao.aceitos, f).toEqual(["bloqueada"]);
      expect(r.aprovacao.aceitos, f).toEqual(["nenhuma"]);
      expect(semFamilia(f), f).toEqual(semFamilia("financeiro.conta_a_pagar"));
    }
  });

  it("PT-3 o catálogo publicado (JSON ida e volta) é aceito pelo leitor estrito e traz os dois tipos com tela", () => {
    const lido = lerCatalogoTop(JSON.parse(JSON.stringify(CATALOGO_TOP)));
    if (!lido) throw new Error("premissa: o catálogo publicado é lido");
    const doisTipos = lido.tipos.filter((t) => t.familia === COMPRA_ANIMAIS || t.familia === VENDA_ANIMAIS);
    expect(doisTipos.map((t) => [t.chave, t.temTela])).toEqual([["compra_animais", true], ["venda_animais", true]]);
    expect(lido.perfis.filter((p) => p.familia === COMPRA_ANIMAIS || p.familia === VENDA_ANIMAIS).map((p) => p.familia))
      .toEqual([COMPRA_ANIMAIS, VENDA_ANIMAIS]);
    expect(tiposParaEscolhaTop(lido).find((g) => g.grupo.chave === "modulos")?.tipos.map((t) => t.chave))
      .toEqual(tiposParaEscolhaTop(CATALOGO_TOP).find((g) => g.grupo.chave === "modulos")?.tipos.map((t) => t.chave));
  });
});

// ---------------------------------------------------------------------------------------------------
// PT-4 — a classificação por campo
// ---------------------------------------------------------------------------------------------------

describe("PT-4 planoDaClassificacaoPorCampo: o campo informado no documento nunca é descartado", () => {
  const N_DOC = "AAAAAAAA-0000-4000-8000-000000000001";
  const C_DOC = "AAAAAAAA-0000-4000-8000-000000000002";
  const N_TOP = "BBBBBBBB-0000-4000-8000-000000000003";
  const C_TOP = "BBBBBBBB-0000-4000-8000-000000000004";
  const min = (v: string) => v.toLowerCase();
  type Entrada = Parameters<typeof planoDaClassificacaoPorCampo>[0];
  const entrada = (
    doc: [string | null, string | null],
    padrao: [string | null, string | null] | null,
    semClassificacao: SemClassificacaoTop,
  ): Entrada => ({
    documento: { naturezaId: doc[0], centroCustoId: doc[1] },
    padrao: padrao === null ? null : { naturezaId: padrao[0], centroCustoId: padrao[1] },
    semClassificacao,
  });

  const casos: ReadonlyArray<readonly [string, Entrada, PlanoDaClassificacao]> = [
    ["documento com os dois → pronta \"documento\"", entrada([N_DOC, C_DOC], [N_TOP, C_TOP], "exigir"),
      { tipo: "pronta", naturezaId: min(N_DOC), centroCustoId: min(C_DOC), origem: "documento" }],
    ["vazio + TOP com os dois → pronta \"padrão da TOP\"", entrada([null, null], [N_TOP, C_TOP], "padrao_legado"),
      { tipo: "pronta", naturezaId: min(N_TOP), centroCustoId: min(C_TOP), origem: "padrão da TOP" }],
    ["só a natureza no documento + TOP com os dois → natureza do documento, centro da TOP", entrada([N_DOC, null], [N_TOP, C_TOP], "padrao_legado"),
      { tipo: "pronta", naturezaId: min(N_DOC), centroCustoId: min(C_TOP), origem: "padrão da TOP" }],
    ["só o centro no documento + TOP só com a natureza → pronta com os dois", entrada([null, C_DOC], [N_TOP, null], "exigir"),
      { tipo: "pronta", naturezaId: min(N_TOP), centroCustoId: min(C_DOC), origem: "padrão da TOP" }],
    ["vazio + \"exigir\" + TOP vazia → exigir os dois", entrada([null, null], [null, null], "exigir"),
      { tipo: "exigir", faltam: ["natureza", "centro"] }],
    ["só a natureza + \"exigir\" + TOP vazia → exigir só o centro", entrada([N_DOC, null], [null, null], "exigir"),
      { tipo: "exigir", faltam: ["centro"] }],
    ["vazio + legado + TOP só com o centro → legado com o centro da TOP", entrada([null, null], [null, C_TOP], "padrao_legado"),
      { tipo: "legado", naturezaId: null, centroCustoId: min(C_TOP) }],
    ["vazio + legado + sem padrões → legado vazio (o caminho de hoje)", entrada([null, null], null, "padrao_legado"),
      { tipo: "legado", naturezaId: null, centroCustoId: null }],
    ["só o centro + legado + sem padrões → legado com o centro do documento", entrada([null, C_DOC], null, "padrao_legado"),
      { tipo: "legado", naturezaId: null, centroCustoId: min(C_DOC) }],
    ["espaços e vazio no documento valem como ausentes", entrada(["  ", ""], [N_TOP, C_TOP], "padrao_legado"),
      { tipo: "pronta", naturezaId: min(N_TOP), centroCustoId: min(C_TOP), origem: "padrão da TOP" }],
  ];

  for (const [nome, e, esperado] of casos) {
    it(`PT-4 ${nome}`, () => {
      expect(planoDaClassificacaoPorCampo(e)).toEqual(esperado);
    });
  }

  it("PT-4 a diferença declarada: com o documento parcial, a classificação por PAR descartaria o campo do documento", () => {
    const e = entrada([N_DOC, null], [N_TOP, C_TOP], "padrao_legado");
    // A premissa: `planoDaClassificacao` (por par) usa a natureza da TOP, ignorando a do documento.
    expect(planoDaClassificacao(e)).toEqual({ tipo: "pronta", naturezaId: min(N_TOP), centroCustoId: min(C_TOP), origem: "padrão da TOP" });
    // A conclusão: por campo, a natureza do documento é mantida.
    expect(planoDaClassificacaoPorCampo(e)).toEqual({ tipo: "pronta", naturezaId: min(N_DOC), centroCustoId: min(C_TOP), origem: "padrão da TOP" });
  });

  it("PT-4 com o documento vazio ou completo, é exatamente planoDaClassificacao", () => {
    const docs: ReadonlyArray<[string | null, string | null]> = [[null, null], [N_DOC, C_DOC]];
    const padroes: ReadonlyArray<[string | null, string | null] | null> = [null, [null, null], [N_TOP, null], [null, C_TOP], [N_TOP, C_TOP]];
    const regras: readonly SemClassificacaoTop[] = ["padrao_legado", "exigir"];
    let conferidos = 0;
    for (const d of docs) for (const p of padroes) for (const r of regras) {
      const e = entrada(d, p, r);
      expect(planoDaClassificacaoPorCampo(e), JSON.stringify(e)).toEqual(planoDaClassificacao(e));
      conferidos += 1;
    }
    expect(conferidos).toBe(20);
  });
});

// ---------------------------------------------------------------------------------------------------
// PT-5 — o dicionário de dados
// ---------------------------------------------------------------------------------------------------

describe("PT-5 o dicionário: o movimento de animais cita as duas TOPs", () => {
  it("PT-5 ERP-PECUARIA-MOVIMENTACAO: tops = as duas, discriminadorTop = movement_type", () => {
    // `tops` e `discriminadorTop` não estão na declaração do `.d.mts`: a mesma vista estreita do `tipo-operacao.test.ts`.
    const dicionario = DICIONARIO_DE_DADOS as readonly {
      codigo: string; tabela: string; discriminador?: string; top?: string; tops?: string[]; discriminadorTop?: string;
    }[];
    const entradas = dicionario.filter((e) => e.codigo === "ERP-PECUARIA-MOVIMENTACAO");
    expect(entradas).toHaveLength(1);
    const e = entradas[0]!;
    // A premissa: a entrada é a da tabela do registry, e o discriminador das ROTAS continua o `movement_type`.
    expect(e.tabela).toBe(TABELA);
    expect(e.discriminador).toBe("movement_type");
    expect(e.tops).toEqual([COMPRA_ANIMAIS, VENDA_ANIMAIS]);
    expect(e.discriminadorTop).toBe("movement_type");
    expect(e.top).toBeUndefined();
  });
});
