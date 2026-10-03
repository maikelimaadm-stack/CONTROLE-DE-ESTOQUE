import { describe, it, expect } from "vitest";
import {
  CAMPOS_DESTINO_ESTOQUE,
  FAMILIAS_COM_LAYOUT,
  FAMILIAS_COM_LAYOUT_DE_COMPRAS,
  FAMILIAS_COM_LAYOUT_DE_ESTOQUE,
  FAMILIAS_COM_LAYOUT_DE_VENDAS,
  LAYOUT_DO_SISTEMA,
  MENSAGEM_OBSERVACAO_NAO_SAI_DO_ESTOQUE,
  MENSAGEM_OBSERVACAO_NOS_DADOS_PRINCIPAIS_DO_ESTOQUE,
  TODAS_AS_ESPECIES_DOCUMENTO_ESTOQUE,
  camposObrigatoriosFaltando,
  catalogoDaFamilia,
  chaveDosItensDaFamilia,
  colunasComPadraoRegistro,
  familiaDeCompras,
  familiaDeEstoque,
  familiaOperacionalDeDocumentoEstoque,
  familiaTemLayout,
  mensagemOrdemDoCabecalhoDoEstoque,
  mensagemSoNoRodape,
  mensagemSoNosDadosPrincipais,
  motivoZonaProibida,
  padroesRegistroDaEstrutura,
  validarEstruturaLayout,
  type CampoDoCatalogo,
  type EstruturaLayout
} from "../src/index.js";
import { TIPOS_OPERACAO, tipoOperacao } from "../src/tipo-operacao.js";

/*
 * OPERACOES-01 F5b (decisão 282) — O LAYOUT DO DOCUMENTO DE ESTOQUE.
 *
 * LE-D1 as sete famílias de estoque vêm do registry (as variantes de `erp.documentos_estoque`), por último na lista.
 * LE-D2 o catálogo de cada espécie, chave a chave (as chaves do corpo de `POST /api/estoque/<segmento>`).
 * LE-D3 o layout do sistema de cada família valida sem erro, só com cabeçalho e itens; as linhas são "itens".
 * LE-D4 as recusas do estoque: custo, observação, lote e validade obrigatórios ou com padrão; campo fora dos Dados
 *       principais. Premissa de cada caso: o MESMO layout sem a mudança valida vazio.
 * LE-D5 `motivoZonaProibida` no estoque e, INALTERADO, em vendas e compras.
 * LE-D6 o padrão de cadastro do Local de estoque é do CABEÇALHO; nas colunas do item, nenhum.
 * LE-D7 o cabeçalho tem a ORDEM e os CAMPOS que a Central de Estoque desenha (I-2 da revisão da fase): reordenar e
 *       tirar a Observação são recusados; a Observação fora dos Dados principais diz onde a Central a mostra.
 *
 * Os códigos de família aparecem LITERAIS aqui de propósito: o teste confere a derivação do registry.
 */

function at<T>(a: readonly T[], i: number): T { const v = a[i]; if (v === undefined) throw new Error(`índice ${i} ausente`); return v; }

const ENTRADA = "estoque.entrada";
const SAIDA = "estoque.saida";
const TRANSFERENCIA = "estoque.transferencia";
const AJUSTE = "estoque.ajuste";
const REQUISICAO = "estoque.requisicao_material";
const CONSUMO = "estoque.consumo";
const DEVOLUCAO = "estoque.devolucao_consumo";
const SETE = [ENTRADA, SAIDA, TRANSFERENCIA, AJUSTE, REQUISICAO, CONSUMO, DEVOLUCAO];
const UUID = "3f2b8c1e-7a4d-4e9b-9c2a-1d5e6f7a8b9c";

const sis = (f: string): EstruturaLayout => structuredClone(LAYOUT_DO_SISTEMA(f));
const erros = (f: string, e: EstruturaLayout) => validarEstruturaLayout(f, e);
function noCabecalho(e: EstruturaLayout, campo: string): number {
  const i = e.cabecalho.findIndex((x) => x.campo === campo);
  if (i < 0) throw new Error(`campo ${campo} fora do cabeçalho`);
  return i;
}
function naColuna(e: EstruturaLayout, campo: string): number {
  const i = e.itens.findIndex((x) => x.campo === campo);
  if (i < 0) throw new Error(`coluna ${campo} fora dos itens`);
  return i;
}
/** Tira `campo` do cabeçalho e devolve a estrutura. */
function semNoCabecalho(e: EstruturaLayout, campo: string): EstruturaLayout {
  noCabecalho(e, campo);
  e.cabecalho = e.cabecalho.filter((x) => x.campo !== campo);
  return e;
}

// ---------------------------------------------------------------------------------------------------
// LE-D1 — as famílias
// ---------------------------------------------------------------------------------------------------

describe("LE-D1 as famílias de estoque com layout: as variantes de erp.documentos_estoque, por último", () => {
  it("LE-D1 FAMILIAS_COM_LAYOUT_DE_ESTOQUE = as variantes do registry, na ordem do registry, uma por espécie", () => {
    const doRegistry = TIPOS_OPERACAO.filter((t) => t.origem.tabela === "erp.documentos_estoque").map((t) => t.codigo);
    expect(doRegistry, "a premissa: o registry tem as sete variantes").toEqual(SETE);
    expect([...FAMILIAS_COM_LAYOUT_DE_ESTOQUE]).toEqual(doRegistry);
    // uma família por espécie, na ordem das espécies (a família perguntada ao registry pela espécie)
    expect(FAMILIAS_COM_LAYOUT_DE_ESTOQUE.map((f) => tipoOperacao(f)?.origem.valor)).toEqual([...TODAS_AS_ESPECIES_DOCUMENTO_ESTOQUE]);
    expect(TODAS_AS_ESPECIES_DOCUMENTO_ESTOQUE.map((e) => familiaOperacionalDeDocumentoEstoque(e))).toEqual(SETE);
    expect(Object.isFrozen(FAMILIAS_COM_LAYOUT_DE_ESTOQUE)).toBe(true);
  });

  it("LE-D1 FAMILIAS_COM_LAYOUT = vendas, compras e estoque, nessa ordem (as duas primeiras listas inalteradas)", () => {
    expect([...FAMILIAS_COM_LAYOUT_DE_VENDAS], "a premissa: vendas inalterada").toEqual(["vendas.orcamento", "vendas.pedido", "vendas.venda"]);
    expect([...FAMILIAS_COM_LAYOUT_DE_COMPRAS], "a premissa: compras inalterada").toEqual(["compras.pedido", "compras.compra", "compras.orcamento"]);
    expect([...FAMILIAS_COM_LAYOUT]).toEqual([
      "vendas.orcamento", "vendas.pedido", "vendas.venda",
      "compras.pedido", "compras.compra", "compras.orcamento",
      ...SETE
    ]);
    // o "Novo" do configurador continua abrindo em vendas
    expect(at(FAMILIAS_COM_LAYOUT, 0)).toBe("vendas.orcamento");
  });

  it("LE-D1 familiaTemLayout e familiaDeEstoque: verdadeiros nas sete; falsos na requisição antiga, em vendas e em compras", () => {
    for (const f of SETE) {
      expect(familiaTemLayout(f), f).toBe(true);
      expect(familiaDeEstoque(f), f).toBe(true);
      expect(familiaDeCompras(f), f).toBe(false);
    }
    // A premissa: a requisição ANTIGA existe no registry, noutra tabela (não é documento de estoque).
    expect(tipoOperacao("estoque.requisicao")?.origem.tabela).toBe("erp.requisitions");
    expect(familiaTemLayout("estoque.requisicao")).toBe(false);
    expect(familiaDeEstoque("estoque.requisicao")).toBe(false);
    for (const f of ["vendas.venda", "compras.compra", "compras.orcamento", "", "ESTOQUE.ENTRADA", "estoque"]) expect(familiaDeEstoque(f), f).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------------
// LE-D2 — o catálogo por espécie
// ---------------------------------------------------------------------------------------------------

type Linha = readonly [parte: string, chave: string, rotulo: string, tipo: string, marca: "sistema" | "somenteLeitura" | null, recurso: string | null];
const resumo = (c: CampoDoCatalogo): Linha =>
  [c.parte, c.chave, c.rotulo, c.tipo, c.sistema ? "sistema" : c.somenteLeitura ? "somenteLeitura" : null, c.referencia?.recurso ?? null];

const EMPRESA: Linha = ["cabecalho", "empresa_id", "Empresa", "empresa", "sistema", null];
const DATA: Linha = ["cabecalho", "data_documento", "Data do documento", "data", "sistema", null];
const LOCAL = (rotulo: string): Linha => ["cabecalho", "armazem_id", rotulo, "referencia", "sistema", "warehouses"];
const LOCAL_DESTINO: Linha = ["cabecalho", "armazem_destino_id", "Local de estoque de destino", "referencia", "sistema", "warehouses"];
const OBSERVACAO: Linha = ["cabecalho", "observacao", "Observação", "texto_longo", null, null];
const CODIGO: Linha = ["itens", "codigo", "Código", "texto", "somenteLeitura", null];
const PRODUTO: Linha = ["itens", "produto_id", "Produto", "referencia", "sistema", null];
const ESTOQUE = (rotulo: string): Linha => ["itens", "estoque", rotulo, "numero", "somenteLeitura", null];
const QUANTIDADE: Linha = ["itens", "quantidade", "Quantidade", "numero", "sistema", null];
const CONTADA: Linha = ["itens", "quantidade_contada", "Quantidade contada", "numero", "sistema", null];
const CUSTO: Linha = ["itens", "custo_unitario", "Custo unitário", "numero", null, null];
const LOTE: Linha = ["itens", "lote", "Lote", "texto", null, null];
const VALIDADE: Linha = ["itens", "validade", "Validade", "data", null, null];
const CABECALHO = [EMPRESA, DATA, LOCAL("Local de estoque"), OBSERVACAO];

const CATALOGO_ESPERADO: Readonly<Record<string, readonly Linha[]>> = {
  [ENTRADA]: [...CABECALHO, CODIGO, PRODUTO, ESTOQUE("Estoque"), QUANTIDADE, CUSTO, LOTE, VALIDADE],
  [SAIDA]: [...CABECALHO, CODIGO, PRODUTO, ESTOQUE("Estoque"), QUANTIDADE, LOTE],
  [TRANSFERENCIA]: [EMPRESA, DATA, LOCAL("Local de estoque de origem"), LOCAL_DESTINO, OBSERVACAO, CODIGO, PRODUTO, ESTOQUE("Estoque"), QUANTIDADE, LOTE],
  [AJUSTE]: [...CABECALHO, CODIGO, PRODUTO, ESTOQUE("Estoque"), CONTADA, CUSTO, LOTE, VALIDADE],
  [REQUISICAO]: [...CABECALHO, CODIGO, PRODUTO, ESTOQUE("Disponível"), QUANTIDADE],
  [CONSUMO]: [...CABECALHO, CODIGO, PRODUTO, ESTOQUE("Estoque"), QUANTIDADE, LOTE],
  [DEVOLUCAO]: [...CABECALHO, CODIGO, PRODUTO, ESTOQUE("Estoque"), QUANTIDADE, LOTE, VALIDADE]
};

describe("LE-D2 o catálogo de cada espécie de estoque, chave a chave", () => {
  it("LE-D2 as sete, cada uma com as chaves do corpo do POST da espécie, na ordem, com rótulo, tipo, marca e cadastro", () => {
    expect(Object.keys(CATALOGO_ESPERADO), "a premissa: o esperado cobre as sete").toEqual(SETE);
    for (const f of SETE) expect(catalogoDaFamilia(f).map(resumo), f).toEqual(CATALOGO_ESPERADO[f]);
  });

  it("LE-D2 a transferência: Local de estoque de origem e de destino; o ajuste: quantidade contada e nunca quantidade", () => {
    const chaves = (f: string) => catalogoDaFamilia(f).map((c) => `${c.parte}.${c.chave}`);
    expect(chaves(TRANSFERENCIA)).toContain("cabecalho.armazem_destino_id");
    for (const f of SETE.filter((x) => x !== TRANSFERENCIA)) expect(chaves(f), f).not.toContain("cabecalho.armazem_destino_id");
    expect(chaves(AJUSTE)).toContain("itens.quantidade_contada");
    expect(chaves(AJUSTE)).not.toContain("itens.quantidade");
    for (const f of SETE.filter((x) => x !== AJUSTE)) {
      expect(chaves(f), f).toContain("itens.quantidade");
      expect(chaves(f), f).not.toContain("itens.quantidade_contada");
    }
  });

  it("LE-D2 a requisição: sem custo, lote e validade, e a coluna Estoque diz 'Disponível'", () => {
    const chaves = catalogoDaFamilia(REQUISICAO).map((c) => c.chave);
    expect(chaves, "a premissa: o catálogo da requisição existe e tem o produto").toContain("produto_id");
    for (const fora of ["custo_unitario", "lote", "validade"]) expect(chaves, fora).not.toContain(fora);
    expect(catalogoDaFamilia(REQUISICAO).find((c) => c.chave === "estoque")?.rotulo).toBe("Disponível");
  });

  it("LE-D2 nenhum rótulo diz 'Armazém'; nenhum campo com aba, exige, sempreTemValor ou filtro de cadastro", () => {
    const ARMAZEM = /armaz[ée]m|armaz[ée]ns/i;
    const campos = SETE.flatMap((f) => catalogoDaFamilia(f));
    expect(campos.length, "a premissa: a varredura leu os sete catálogos").toBe(SETE.reduce((n, f) => n + (CATALOGO_ESPERADO[f]?.length ?? 0), 0));
    expect(campos.filter((c) => ARMAZEM.test(c.rotulo)).map((c) => c.rotulo)).toEqual([]);
    for (const c of campos) {
      expect(c.aba, c.chave).toBeUndefined();
      expect(c.exige, c.chave).toBeUndefined();
      expect(c.sempreTemValor, c.chave).toBeUndefined();
      expect(c.referencia?.filtro, c.chave).toBeUndefined();
      expect(c.sistema === undefined || c.sistema === "sempre", c.chave).toBe(true);
      expect(c.parte === "cabecalho" || c.parte === "itens", c.chave).toBe(true);
    }
  });

  it("LE-D2 destino, origem, motivo e justificativa ficam FORA do catálogo (os donos são a TOP e a espécie)", () => {
    const fora = [...CAMPOS_DESTINO_ESTOQUE.map((c) => c.coluna), "origem_documento_id", "origem_item_id", "motivo_saida", "justificativa", "tipo_operacao_id"];
    expect(CAMPOS_DESTINO_ESTOQUE, "a premissa: as seis dimensões do destino").toHaveLength(6);
    for (const f of SETE) {
      const chaves = catalogoDaFamilia(f).map((c) => c.chave);
      for (const k of fora) expect(chaves, `${f}: ${k}`).not.toContain(k);
    }
  });

  it("LE-D2 o catálogo é escolhido pela ESPÉCIE do registry, congelado; família sem catálogo → nenhum campo", () => {
    for (const f of SETE) {
      expect(Object.isFrozen(catalogoDaFamilia(f)), f).toBe(true);
      expect(catalogoDaFamilia(f), f).toBe(catalogoDaFamilia(f));
    }
    expect(catalogoDaFamilia("estoque.requisicao")).toEqual([]);
    expect(validarEstruturaLayout("estoque.requisicao", sis(ENTRADA))).toEqual([{ caminho: "familia", mensagem: "Movimento sem layout de documento." }]);
  });
});

// ---------------------------------------------------------------------------------------------------
// LE-D3 — o layout do sistema
// ---------------------------------------------------------------------------------------------------

describe("LE-D3 o layout do sistema do estoque", () => {
  it("LE-D3 valida sem erro nas sete, só com cabeçalho e itens (rodapé vazio, nenhum grupo)", () => {
    for (const f of SETE) {
      const l = LAYOUT_DO_SISTEMA(f);
      expect(l.cabecalho.length, `a premissa: ${f} tem cabeçalho`).toBeGreaterThan(0);
      expect(l.itens.length, `a premissa: ${f} tem itens`).toBeGreaterThan(0);
      expect(validarEstruturaLayout(f, l), f).toEqual([]);
      expect(l.rodape, f).toEqual([]);
      expect(l.cabecalho.every((x) => x.grupo === undefined), f).toBe(true);
    }
  });

  it("LE-D3 a entrada e a transferência, campo a campo: obrigatório só o do sistema; tudo editável", () => {
    expect(LAYOUT_DO_SISTEMA(ENTRADA)).toEqual({
      versaoSchema: 1,
      cabecalho: [
        { campo: "empresa_id", obrigatorio: true, editavel: true },
        { campo: "data_documento", obrigatorio: true, editavel: true },
        { campo: "armazem_id", obrigatorio: true, editavel: true },
        { campo: "observacao", obrigatorio: false, editavel: true }
      ],
      rodape: [],
      itens: [
        { campo: "codigo", obrigatorio: false },
        { campo: "produto_id", obrigatorio: true },
        { campo: "estoque", obrigatorio: false },
        { campo: "quantidade", obrigatorio: true },
        { campo: "custo_unitario", obrigatorio: false },
        { campo: "lote", obrigatorio: false },
        { campo: "validade", obrigatorio: false }
      ]
    });
    expect(LAYOUT_DO_SISTEMA(TRANSFERENCIA).cabecalho.map((x) => [x.campo, x.obrigatorio])).toEqual([
      ["empresa_id", true], ["data_documento", true], ["armazem_id", true], ["armazem_destino_id", true], ["observacao", false]
    ]);
  });

  it("LE-D3 as linhas do estoque são 'itens' (vendas 'items' e compras 'itens', inalteradas)", () => {
    expect(chaveDosItensDaFamilia("vendas.venda"), "a premissa: vendas").toBe("items");
    expect(chaveDosItensDaFamilia("compras.compra"), "a premissa: compras").toBe("itens");
    for (const f of SETE) expect(chaveDosItensDaFamilia(f), f).toBe("itens");
  });

  it("LE-D3 o layout do sistema só cobra o que o servidor já cobra (custo, lote, validade e observação vazios não são cobrados)", () => {
    const entrada = camposObrigatoriosFaltando(ENTRADA, LAYOUT_DO_SISTEMA(ENTRADA), {
      empresa_id: UUID, data_documento: "", armazem_id: UUID, observacao: "",
      itens: [{ produto_id: "", quantidade: "1", custo_unitario: "", lote: "", validade: "" }, { produto_id: UUID, quantidade: "" }]
    });
    expect(entrada).toEqual([
      { caminho: "data_documento", rotulo: "Data do documento" },
      { caminho: "itens[0].produto_id", rotulo: "Produto" },
      { caminho: "itens[1].quantidade", rotulo: "Quantidade" }
    ]);
    const ajuste = camposObrigatoriosFaltando(AJUSTE, LAYOUT_DO_SISTEMA(AJUSTE), {
      empresa_id: UUID, data_documento: "2026-10-02", armazem_id: UUID, itens: [{ produto_id: UUID, quantidade_contada: "" }]
    });
    expect(ajuste).toEqual([{ caminho: "itens[0].quantidade_contada", rotulo: "Quantidade contada" }]);
    // A premissa: com tudo preenchido, nada falta.
    expect(camposObrigatoriosFaltando(AJUSTE, LAYOUT_DO_SISTEMA(AJUSTE), {
      empresa_id: UUID, data_documento: "2026-10-02", armazem_id: UUID, itens: [{ produto_id: UUID, quantidade_contada: "0" }]
    })).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------
// LE-D4 — as recusas
// ---------------------------------------------------------------------------------------------------

describe("LE-D4 o que o layout do estoque recusa (premissa: o mesmo layout sem a mudança valida vazio)", () => {
  it("LE-D4 Custo unitário obrigatório → recusado (entrada e ajuste)", () => {
    for (const f of [ENTRADA, AJUSTE]) {
      const l = sis(f);
      expect(erros(f, l), `a premissa: ${f}`).toEqual([]);
      const i = naColuna(l, "custo_unitario");
      at(l.itens, i).obrigatorio = true;
      expect(erros(f, l), f).toEqual([{ caminho: `itens[${i}].obrigatorio`, mensagem: "\"Custo unitário\" é opcional no documento de estoque: o layout não o torna obrigatório." }]);
    }
  });

  it("LE-D4 Observação obrigatória → recusada: é regra da TOP (Exigir observação)", () => {
    for (const f of SETE) {
      const l = sis(f);
      expect(erros(f, l), `a premissa: ${f}`).toEqual([]);
      const i = noCabecalho(l, "observacao");
      at(l.cabecalho, i).obrigatorio = true;
      expect(erros(f, l), f).toEqual([{
        caminho: `cabecalho[${i}].obrigatorio`,
        mensagem: "\"Observação\" obrigatória é regra da operação (Exigir observação, na aba Geral da TOP): o layout não a torna obrigatória."
      }]);
    }
  });

  it("LE-D4 Lote e Validade obrigatórios ou com valor padrão → as MESMAS recusas das compras, uma por campo", () => {
    const casos: readonly [campo: "lote" | "validade", mudanca: "obrigatorio" | "valorPadrao"][] = [
      ["lote", "obrigatorio"], ["lote", "valorPadrao"], ["validade", "obrigatorio"], ["validade", "valorPadrao"]
    ];
    for (const [campo, mudanca] of casos) {
      const aplicar = (f: string): { caminho: string; mensagem: string }[] => {
        const l = sis(f);
        expect(erros(f, l), `a premissa: ${f}`).toEqual([]);
        const x = at(l.itens, naColuna(l, campo));
        if (mudanca === "obrigatorio") x.obrigatorio = true;
        else x.valorPadrao = campo === "lote" ? { tipo: "literal", valor: "L-01" } : { tipo: "literal", valor: "2027-01-31" };
        return erros(f, l).map((e) => ({ caminho: e.caminho.replace(/^itens\[\d+\]/, "itens[i]"), mensagem: e.mensagem }));
      };
      const daCompra = aplicar("compras.compra");
      const rotulo = campo === "lote" ? "Lote" : "Validade";
      expect(daCompra, `a premissa: a recusa das compras (${campo}, ${mudanca})`).toEqual([{
        caminho: `itens[i].${mudanca}`,
        mensagem: mudanca === "obrigatorio" ? `"${rotulo}" é exigido pela regra do produto: o layout não o torna obrigatório.` : `"${rotulo}" é informado item a item: não aceita valor padrão.`
      }]);
      for (const f of SETE.filter((x) => catalogoDaFamilia(x).some((c) => c.chave === campo))) expect(aplicar(f), `${f}: ${campo}, ${mudanca}`).toEqual(daCompra);
    }
  });

  it("LE-D4 campo do documento em Dados adicionais → 'fica nos Dados principais neste movimento'", () => {
    const l = sis(SAIDA);
    const i = noCabecalho(l, "observacao");
    at(l.cabecalho, i).grupo = "principal";
    expect(erros(SAIDA, l), "a premissa: no grupo principal, válido").toEqual([]);
    at(l.cabecalho, i).grupo = "adicionais";
    expect(erros(SAIDA, l)).toEqual([{
      caminho: `cabecalho[${i}].campo`,
      mensagem: "\"Observação\" fica nos Dados principais do layout neste movimento: a Central de Estoque a mostra na aba Observações."
    }]);
    // Um do sistema (o Local de estoque) também: só a recusa de zona, uma vez.
    const l2 = sis(REQUISICAO);
    const j = noCabecalho(l2, "armazem_id");
    at(l2.cabecalho, j).grupo = "adicionais";
    expect(erros(REQUISICAO, l2)).toEqual([{ caminho: `cabecalho[${j}].campo`, mensagem: mensagemSoNosDadosPrincipais("Local de estoque") }]);
  });

  it("LE-D4 campo do documento numa aba do rodapé → 'fica nos Dados principais neste movimento'", () => {
    const l = semNoCabecalho(sis(CONSUMO), "observacao");
    // A premissa: sem a observação em parte nenhuma, a recusa é a de SAIR do layout (LE-D7) — e só ela.
    expect(erros(CONSUMO, l), "a premissa: a observação fora do layout").toEqual([{ caminho: "cabecalho", mensagem: MENSAGEM_OBSERVACAO_NAO_SAI_DO_ESTOQUE }]);
    l.rodape = [{ aba: "Outros", campos: [{ campo: "observacao", obrigatorio: false, editavel: true }] }];
    // Numa aba do rodapé ela está no layout: só a recusa de ZONA, que diz onde a Central a mostra.
    expect(erros(CONSUMO, l)).toEqual([{ caminho: "rodape[0].campos[0].campo", mensagem: MENSAGEM_OBSERVACAO_NOS_DADOS_PRINCIPAIS_DO_ESTOQUE }]);
    // A transferência com o Local de estoque de destino numa aba
    const t = semNoCabecalho(sis(TRANSFERENCIA), "armazem_destino_id");
    t.rodape = [{ aba: "Destino", campos: [{ campo: "armazem_destino_id", obrigatorio: true, editavel: true }] }];
    expect(erros(TRANSFERENCIA, t)).toEqual([{ caminho: "rodape[0].campos[0].campo", mensagem: mensagemSoNosDadosPrincipais("Local de estoque de destino") }]);
  });

  it("LE-D4 a mensagem é a do rótulo do CATÁLOGO; a da Observação diz onde a Central a mostra", () => {
    expect(mensagemSoNosDadosPrincipais("Local de estoque")).toBe("\"Local de estoque\" fica nos Dados principais neste movimento.");
    expect(MENSAGEM_OBSERVACAO_NOS_DADOS_PRINCIPAIS_DO_ESTOQUE)
      .toBe("\"Observação\" fica nos Dados principais do layout neste movimento: a Central de Estoque a mostra na aba Observações.");
  });
});

// ---------------------------------------------------------------------------------------------------
// LE-D5 — a regra de zona
// ---------------------------------------------------------------------------------------------------

describe("LE-D5 motivoZonaProibida: no estoque só os Dados principais; vendas e compras inalteradas", () => {
  it("LE-D5 estoque: campo do documento — principal null; adicionais e aba, a mensagem; colunas só nos itens", () => {
    let vistos = 0;
    for (const f of SETE) {
      for (const c of catalogoDaFamilia(f)) {
        vistos += 1;
        if (c.parte === "itens") {
          expect(motivoZonaProibida(f, c.chave, { tipo: "itens" }), `${f}.${c.chave}`).toBeNull();
          expect(motivoZonaProibida(f, c.chave, { tipo: "principal" }), `${f}.${c.chave}`).toBe("Colunas dos itens só podem ficar na grade de itens.");
          continue;
        }
        const fora = c.chave === "observacao" ? MENSAGEM_OBSERVACAO_NOS_DADOS_PRINCIPAIS_DO_ESTOQUE : mensagemSoNosDadosPrincipais(c.rotulo);
        expect(motivoZonaProibida(f, c.chave, { tipo: "principal" }), `${f}.${c.chave}`).toBeNull();
        expect(motivoZonaProibida(f, c.chave, { tipo: "adicionais" }), `${f}.${c.chave}`).toBe(fora);
        expect(motivoZonaProibida(f, c.chave, { tipo: "aba", indice: 0 }), `${f}.${c.chave}`).toBe(fora);
        expect(motivoZonaProibida(f, c.chave, { tipo: "itens" }), `${f}.${c.chave}`).toBe("Só colunas dos itens podem ficar na grade de itens.");
      }
    }
    expect(vistos, "a premissa: passou por todos os campos dos sete catálogos").toBe(SETE.reduce((n, f) => n + (CATALOGO_ESPERADO[f]?.length ?? 0), 0));
  });

  it("LE-D5 vendas inalterada: Proprietário em Dados adicionais pode; Parcelamento fora do rodapé, a mensagem de sempre", () => {
    const V = "vendas.pedido";
    expect(motivoZonaProibida(V, "proprietary_id", { tipo: "adicionais" })).toBeNull();
    expect(motivoZonaProibida(V, "note", { tipo: "aba", indice: 2 })).toBeNull();
    expect(motivoZonaProibida(V, "due_date", { tipo: "aba", indice: 0 })).toBeNull();
    expect(motivoZonaProibida(V, "installment_plan", { tipo: "principal" })).toBe(mensagemSoNoRodape("Parcelamento"));
    expect(motivoZonaProibida(V, "installment_plan", { tipo: "adicionais" })).toBe(mensagemSoNoRodape("Parcelamento"));
    expect(motivoZonaProibida(V, "installment_plan", { tipo: "aba", indice: 1 })).toBeNull();
    // e a gravação de vendas recusa o Parcelamento no cabeçalho com a MESMA mensagem de sempre
    const l = structuredClone(LAYOUT_DO_SISTEMA(V));
    for (const a of l.rodape) a.campos = a.campos.filter((x) => x.campo !== "installment_plan");
    l.rodape = l.rodape.filter((a) => a.campos.length > 0);
    l.cabecalho.push({ campo: "installment_plan", obrigatorio: false, editavel: true });
    expect(validarEstruturaLayout(V, l)).toEqual([{ caminho: `cabecalho[${l.cabecalho.length - 1}].campo`, mensagem: mensagemSoNoRodape("Parcelamento") }]);
  });

  it("LE-D5 compras inalterada: campo do documento em Dados adicionais e numa aba pode", () => {
    for (const f of ["compras.pedido", "compras.compra", "compras.orcamento"]) {
      expect(motivoZonaProibida(f, "observacao", { tipo: "adicionais" }), f).toBeNull();
      expect(motivoZonaProibida(f, "observacao", { tipo: "aba", indice: 0 }), f).toBeNull();
      expect(motivoZonaProibida(f, "empresa_id", { tipo: "principal" }), f).toBeNull();
    }
    const l = structuredClone(LAYOUT_DO_SISTEMA("compras.compra"));
    const i = noCabecalho(l, "observacao");
    at(l.cabecalho, i).grupo = "adicionais";
    expect(validarEstruturaLayout("compras.compra", l)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------
// LE-D6 — o padrão de cadastro
// ---------------------------------------------------------------------------------------------------

describe("LE-D6 o padrão de cadastro do Local de estoque é do CABEÇALHO", () => {
  it("LE-D6 padrão registro no Local de estoque do cabeçalho: aceito e listado com o recurso warehouses", () => {
    const l = sis(ENTRADA);
    const i = noCabecalho(l, "armazem_id");
    at(l.cabecalho, i).valorPadrao = { tipo: "registro", id: UUID };
    at(l.cabecalho, i).editavel = false;
    expect(erros(ENTRADA, l)).toEqual([]);
    expect(padroesRegistroDaEstrutura(ENTRADA, l)).toEqual([{
      chave: "armazem_id", caminho: `cabecalho[${i}].valorPadrao`, parte: "cabecalho", campo: "armazem_id", id: UUID,
      rotulo: "Local de estoque", referencia: { recurso: "warehouses" }
    }]);
    // A transferência: os dois locais aceitam o padrão
    const t = sis(TRANSFERENCIA);
    for (const campo of ["armazem_id", "armazem_destino_id"]) at(t.cabecalho, noCabecalho(t, campo)).valorPadrao = { tipo: "registro", id: UUID };
    expect(erros(TRANSFERENCIA, t)).toEqual([]);
    expect(padroesRegistroDaEstrutura(TRANSFERENCIA, t).map((p) => [p.campo, p.rotulo, p.referencia?.recurso])).toEqual([
      ["armazem_id", "Local de estoque de origem", "warehouses"], ["armazem_destino_id", "Local de estoque de destino", "warehouses"]
    ]);
  });

  it("LE-D6 o Local de estoque fixo sem padrão e o padrão fora da forma são recusados (as regras de sempre)", () => {
    const l = sis(SAIDA);
    const i = noCabecalho(l, "armazem_id");
    at(l.cabecalho, i).editavel = false;
    expect(erros(SAIDA, l)).toEqual([{ caminho: `cabecalho[${i}].valorPadrao`, mensagem: "\"Local de estoque\" é obrigatório e não editável: informe o valor padrão." }]);
    at(l.cabecalho, i).valorPadrao = { tipo: "registro", id: "nao-e-uuid" };
    expect(erros(SAIDA, l)).toEqual([{ caminho: `cabecalho[${i}].valorPadrao`, mensagem: "Valor padrão incompatível com \"Local de estoque\"." }]);
  });

  it("LE-D6 nas colunas do item, nenhum padrão: colunasComPadraoRegistro = [] e o padrão numa coluna é recusado", () => {
    expect(colunasComPadraoRegistro("compras.compra"), "a premissa: na compra, a coluna do Local de estoque").toEqual(["armazem_id"]);
    for (const f of SETE) expect(colunasComPadraoRegistro(f), f).toEqual([]);
    const l = sis(ENTRADA);
    expect(erros(ENTRADA, l), "a premissa").toEqual([]);
    const c = naColuna(l, "custo_unitario");
    at(l.itens, c).valorPadrao = { tipo: "literal", valor: "10" };
    const p = naColuna(l, "produto_id");
    at(l.itens, p).valorPadrao = { tipo: "registro", id: UUID };
    expect(erros(ENTRADA, l)).toEqual([
      { caminho: `itens[${p}].valorPadrao`, mensagem: "Valor padrão incompatível com \"Produto\"." },
      { caminho: `itens[${c}].valorPadrao`, mensagem: "Valor padrão incompatível com \"Custo unitário\"." }
    ]);
  });
});

// ---------------------------------------------------------------------------------------------------
// LE-D7 — o cabeçalho que a Central de Estoque desenha (I-2 da revisão da fase)
// ---------------------------------------------------------------------------------------------------

describe("LE-D7 o cabeçalho do estoque tem a ordem e os campos da Central de Estoque (premissa: o mesmo layout sem a mudança valida vazio)", () => {
  it("LE-D7 reordenar o cabeçalho → UMA recusa, com a ordem que vale (os rótulos do catálogo); nas sete", () => {
    for (const f of SETE) {
      const l = sis(f);
      expect(erros(f, l), `a premissa: ${f}`).toEqual([]);
      const rotulos = catalogoDaFamilia(f).filter((c) => c.parte === "cabecalho").map((c) => c.rotulo);
      // a Data antes da Empresa (dois campos do sistema: nada mais muda)
      const iEmpresa = noCabecalho(l, "empresa_id");
      const iData = noCabecalho(l, "data_documento");
      const empresa = at(l.cabecalho, iEmpresa);
      l.cabecalho[iEmpresa] = at(l.cabecalho, iData);
      l.cabecalho[iData] = empresa;
      expect(erros(f, l), f).toEqual([{ caminho: "cabecalho", mensagem: mensagemOrdemDoCabecalhoDoEstoque(rotulos) }]);
    }
    expect(mensagemOrdemDoCabecalhoDoEstoque(["Empresa", "Data do documento", "Local de estoque", "Observação"]))
      .toBe("A ordem do cabeçalho é fixa neste movimento (a da Central de Estoque): Empresa, Data do documento, Local de estoque, Observação.");
  });

  it("LE-D7 a Observação antes do Local de estoque, e o Local de destino antes do de origem (transferência) → recusados", () => {
    const l = sis(SAIDA);
    const iObs = noCabecalho(l, "observacao");
    const obs = at(l.cabecalho, iObs);
    l.cabecalho = [obs, ...l.cabecalho.filter((x) => x.campo !== "observacao")];
    expect(l.cabecalho.map((x) => x.campo), "a premissa: a observação subiu para o topo").toEqual(["observacao", "empresa_id", "data_documento", "armazem_id"]);
    expect(erros(SAIDA, l)).toEqual([{ caminho: "cabecalho", mensagem: mensagemOrdemDoCabecalhoDoEstoque(["Empresa", "Data do documento", "Local de estoque", "Observação"]) }]);
    const t = sis(TRANSFERENCIA);
    const iOrigem = noCabecalho(t, "armazem_id");
    const iDestino = noCabecalho(t, "armazem_destino_id");
    const origem = at(t.cabecalho, iOrigem);
    t.cabecalho[iOrigem] = at(t.cabecalho, iDestino);
    t.cabecalho[iDestino] = origem;
    expect(erros(TRANSFERENCIA, t)).toEqual([{
      caminho: "cabecalho",
      mensagem: mensagemOrdemDoCabecalhoDoEstoque(["Empresa", "Data do documento", "Local de estoque de origem", "Local de estoque de destino", "Observação"])
    }]);
  });

  it("LE-D7 tirar a Observação do layout → recusado (a Central sempre a mostra); nas sete", () => {
    for (const f of SETE) {
      const l = sis(f);
      expect(erros(f, l), `a premissa: ${f}`).toEqual([]);
      expect(erros(f, semNoCabecalho(l, "observacao")), f).toEqual([{ caminho: "cabecalho", mensagem: MENSAGEM_OBSERVACAO_NAO_SAI_DO_ESTOQUE }]);
    }
    expect(MENSAGEM_OBSERVACAO_NAO_SAI_DO_ESTOQUE).toBe(
      "\"Observação\" não sai do layout neste movimento: a Central de Estoque sempre a mostra (quem a exige é a operação, em Exigir observação, na aba Geral da TOP)."
    );
  });

  it("LE-D7 o que o layout do estoque MUDA no cabeçalho continua aceito: rótulo, valor padrão e 'editável'", () => {
    const l = sis(SAIDA);
    const iObs = noCabecalho(l, "observacao");
    at(l.cabecalho, iObs).rotulo = "Anotação";
    at(l.cabecalho, iObs).valorPadrao = { tipo: "literal", valor: "Baixa do almoxarifado" };
    at(l.cabecalho, iObs).editavel = false;
    const iData = noCabecalho(l, "data_documento");
    at(l.cabecalho, iData).rotulo = "Data da baixa";
    at(l.cabecalho, iData).valorPadrao = { tipo: "variavel", variavel: "data_atual" };
    expect(erros(SAIDA, l)).toEqual([]);
  });

  it("LE-D7 vendas e compras não passam por aqui: reordenar e tirar a Observação continuam aceitos", () => {
    for (const f of ["vendas.pedido", "compras.compra"]) {
      const l = structuredClone(LAYOUT_DO_SISTEMA(f));
      expect(validarEstruturaLayout(f, l), `a premissa: ${f}`).toEqual([]);
      l.cabecalho = [...l.cabecalho].reverse();
      expect(validarEstruturaLayout(f, l), `${f}: reordenado`).toEqual([]);
    }
    const c = structuredClone(LAYOUT_DO_SISTEMA("compras.compra"));
    c.cabecalho = c.cabecalho.filter((x) => x.campo !== "observacao");
    expect(c.cabecalho.length, "a premissa: a compra tinha a observação no cabeçalho").toBe(LAYOUT_DO_SISTEMA("compras.compra").cabecalho.length - 1);
    expect(validarEstruturaLayout("compras.compra", c)).toEqual([]);
  });
});
