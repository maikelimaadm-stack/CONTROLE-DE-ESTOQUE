import { describe, it, expect } from "vitest";
import {
  FAMILIAS_COM_LAYOUT,
  LAYOUT_DO_SISTEMA,
  validarEstruturaLayout,
  resolverLayout,
  camposObrigatoriosFaltando,
  type EstruturaLayout
} from "../src/layout-documento.js";

function at<T>(a: readonly T[], i: number): T { const v = a[i]; if (v === undefined) throw new Error(`índice ${i} ausente`); return v; }

const F = "vendas.pedido";
const sis = (f: string = F): EstruturaLayout => structuredClone(LAYOUT_DO_SISTEMA(f));
const caminhos = (f: string, e: EstruturaLayout) => validarEstruturaLayout(f, e).map((x) => x.caminho);

describe("LD-D1 layout do sistema reproduz a Central de hoje", () => {
  it.each(FAMILIAS_COM_LAYOUT)("%s valida sem erros e tem a ordem de hoje", (f) => {
    const l = LAYOUT_DO_SISTEMA(f);
    expect(validarEstruturaLayout(f, l)).toEqual([]);
    expect(l.versaoSchema).toBe(1);
    expect(l.cabecalho.map((c) => c.campo)).toEqual([
      "client_id", "empresa_id", "document_date", "due_date", "payment_method_id",
      "categoria_financeira_id", "centro_custo_id", "shipping_date", "proprietary_id"
    ]);
    expect(l.rodape.map((a) => [a.aba, a.campos.map((c) => c.campo)])).toEqual([
      ["Totais", ["discount", "other_values"]],
      ["Financeiro", ["condicao_pagamento_id", "installment_plan"]],
      ["Frete e transporte", ["transporter_id", "driver_name", "freight", "freight_icms"]],
      ["Fiscal", ["is_deductible"]],
      ["Observações", ["note"]]
    ]);
    expect(l.itens.map((c) => c.campo)).toEqual([
      "codigo", "product_id", "warehouse_id", "estoque", "quantity", "unit_price", "discount", "discount_percent", "total"
    ]);
    const obrig = [...l.cabecalho, ...l.rodape.flatMap((a) => a.campos), ...l.itens].filter((c) => c.obrigatorio).map((c) => c.campo);
    expect(obrig).toEqual(["client_id", "empresa_id", "document_date", "categoria_financeira_id", "centro_custo_id", "product_id", "quantity", "unit_price"]);
  });
});

describe("LD-D2 regras de validarEstruturaLayout", () => {
  it("campo fora do catálogo", () => {
    const l = sis(); l.cabecalho.push({ campo: "inventado", obrigatorio: false, editavel: true });
    expect(caminhos(F, l)).toEqual(["cabecalho[9].campo"]);
    const l2 = sis(); l2.cabecalho.push({ campo: "note", obrigatorio: false, editavel: true }); // parte errada
    expect(caminhos(F, l2)).toContain("cabecalho[9].campo");
    const l3 = sis(); l3.itens.push({ campo: "inventado", obrigatorio: false });
    expect(caminhos(F, l3)).toEqual(["itens[9].campo"]);
  });
  it("campo repetido", () => {
    const l = sis(); l.cabecalho.push({ campo: "due_date", obrigatorio: false, editavel: true });
    expect(caminhos(F, l)).toEqual(["cabecalho[9].campo"]);
    const l2 = sis(); l2.itens.push({ campo: "quantity", obrigatorio: true });
    expect(caminhos(F, l2)).toEqual(["itens[9].campo"]);
  });
  it("campo do sistema fora do layout", () => {
    const l = sis(); l.cabecalho = l.cabecalho.filter((c) => c.campo !== "client_id");
    expect(caminhos(F, l)).toEqual(["cabecalho"]);
  });
  it("obrigatório e não editável sem padrão", () => {
    const l = sis(); l.cabecalho[3] = { campo: "due_date", obrigatorio: true, editavel: false };
    expect(caminhos(F, l)).toEqual(["cabecalho[3].valorPadrao"]);
    at(l.cabecalho, 3).valorPadrao = { tipo: "variavel", variavel: "data_atual" };
    expect(validarEstruturaLayout(F, l)).toEqual([]);
  });
  it("padrão incompatível", () => {
    const l = sis(); at(at(l.rodape, 0).campos, 0).valorPadrao = { tipo: "variavel", variavel: "data_atual" }; // numero
    expect(caminhos(F, l)).toEqual(["rodape[0].campos[0].valorPadrao"]);
    const l2 = sis(); at(l2.cabecalho, 3).valorPadrao = { tipo: "variavel", variavel: "empresa_selecionada" }; // data
    expect(caminhos(F, l2)).toEqual(["cabecalho[3].valorPadrao"]);
    const l3 = sis(); at(l3.cabecalho, 4).valorPadrao = { tipo: "literal", valor: "x" }; // referencia
    expect(caminhos(F, l3)).toEqual(["cabecalho[4].valorPadrao"]);
    const ok = sis();
    at(ok.cabecalho, 1).valorPadrao = { tipo: "variavel", variavel: "empresa_selecionada" };
    at(at(ok.rodape, 0).campos, 0).valorPadrao = { tipo: "literal", valor: "10.5" };
    at(at(ok.rodape, 3).campos, 0).valorPadrao = { tipo: "literal", valor: true };
    expect(validarEstruturaLayout(F, ok)).toEqual([]);
  });
  it("só leitura marcado obrigatório/editável", () => {
    const l = sis(); at(l.itens, 8).obrigatorio = true; // total
    expect(caminhos(F, l)).toEqual(["itens[8]"]);
  });
  it("aba vazia", () => {
    const l = sis(); at(l.rodape, 3).campos = [];
    expect(caminhos(F, l)).toEqual(["rodape[3]"]);
  });
  it("coluna do sistema faltando nos itens", () => {
    const l = sis(); l.itens = l.itens.filter((c) => c.campo !== "product_id");
    expect(caminhos(F, l)).toEqual(["itens"]);
  });
  it("família desconhecida", () => {
    expect(validarEstruturaLayout("compras.pedido", sis())).toEqual([{ caminho: "familia", mensagem: expect.any(String) }]);
  });
  it("versaoSchema errada", () => {
    const l = { ...sis(), versaoSchema: 2 } as unknown as EstruturaLayout;
    expect(caminhos(F, l)).toEqual(["estrutura.versaoSchema"]);
  });
});

describe("LD-D3 resolverLayout", () => {
  const a = sis(); at(a.cabecalho, 3).rotulo = "A";
  const b = sis(); at(b.cabecalho, 3).rotulo = "B";
  it("ligado vence", () => expect(resolverLayout(F, { ligado: a, padraoDaFamilia: b })).toEqual({ estrutura: a, origem: "ligado" }));
  it("padrão da família sem ligado", () => expect(resolverLayout(F, { ligado: null, padraoDaFamilia: b })).toEqual({ estrutura: b, origem: "padrao_da_familia" }));
  it("sistema sem nada", () => expect(resolverLayout(F, {})).toEqual({ estrutura: LAYOUT_DO_SISTEMA(F), origem: "sistema" }));
});

describe("LD-D4 camposObrigatoriosFaltando", () => {
  const cheio = () => ({
    client_id: "c", empresa_id: "e", document_date: "2026-01-01", categoria_financeira_id: "n", centro_custo_id: "r",
    items: [{ product_id: "p", quantity: "1", unit_price: "2" }, { product_id: "p", quantity: "1", unit_price: "2" }]
  } as Record<string, unknown> & { items: Record<string, unknown>[] });
  const cap = { classificacao: true, condicao: true };
  it("documento completo não falta nada", () => expect(camposObrigatoriosFaltando(F, sis(), cheio(), cap)).toEqual([]));
  it("cabeçalho vazio e string só com espaço", () => {
    const d = cheio(); d.client_id = null; d.document_date = "   ";
    expect(camposObrigatoriosFaltando(F, sis(), d, cap)).toEqual([
      { caminho: "client_id", rotulo: "Cliente" }, { caminho: "document_date", rotulo: "Data" }
    ]);
  });
  it("rodapé obrigatório vazio, com rótulo próprio", () => {
    const l = sis(); at(at(l.rodape, 2).campos, 0).obrigatorio = true;
    expect(camposObrigatoriosFaltando(F, l, cheio(), cap)).toEqual([{ caminho: "transporter_id", rotulo: "Transportadora" }]);
    at(at(l.rodape, 2).campos, 0).rotulo = "Transp.";
    expect(camposObrigatoriosFaltando(F, l, cheio(), cap)).toEqual([{ caminho: "transporter_id", rotulo: "Transp." }]);
  });
  it("item obrigatório vazio na linha 1", () => {
    const l = sis(); at(l.itens, 2).obrigatorio = true;
    const d = cheio(); at(d.items, 0).warehouse_id = "w";
    expect(camposObrigatoriosFaltando(F, l, d, cap)).toEqual([{ caminho: "items[1].warehouse_id", rotulo: "Armazém" }]);
  });
  it("campo com capacidade ausente não é cobrado", () => {
    const d = cheio(); d.categoria_financeira_id = ""; d.centro_custo_id = undefined;
    expect(camposObrigatoriosFaltando(F, sis(), d, { classificacao: false })).toEqual([]);
    expect(camposObrigatoriosFaltando(F, sis(), d, cap).map((x) => x.caminho)).toEqual(["categoria_financeira_id", "centro_custo_id"]);
    const l = sis(); at(at(l.rodape, 1).campos, 0).obrigatorio = true; // condicao_pagamento_id
    expect(camposObrigatoriosFaltando(F, l, cheio(), { classificacao: true, condicao: false })).toEqual([]);
    expect(camposObrigatoriosFaltando(F, l, cheio(), cap).map((x) => x.caminho)).toEqual(["condicao_pagamento_id"]);
  });
  it("só leitura nunca é cobrado", () => {
    const l = sis(); at(l.itens, 8).obrigatorio = true; at(l.itens, 3).obrigatorio = true;
    expect(camposObrigatoriosFaltando(F, l, cheio(), cap)).toEqual([]);
  });
});

describe("LD-D2b — campo do sistema no layout não pode ficar opcional", () => {
  it("cabeçalho (client_id) e coluna (product_id) opcionais → erro em .obrigatorio", async () => {
    const { LAYOUT_DO_SISTEMA, validarEstruturaLayout } = await import("../src/index.js");
    const l = LAYOUT_DO_SISTEMA("vendas.venda");
    l.cabecalho = l.cabecalho.map((x) => (x.campo === "client_id" ? { ...x, obrigatorio: false } : x));
    l.itens = l.itens.map((x) => (x.campo === "product_id" ? { ...x, obrigatorio: false } : x));
    const caminhos = validarEstruturaLayout("vendas.venda", l).map((e) => e.caminho);
    expect(caminhos).toEqual(expect.arrayContaining([`cabecalho[${l.cabecalho.findIndex((x) => x.campo === "client_id")}].obrigatorio`, `itens[${l.itens.findIndex((x) => x.campo === "product_id")}].obrigatorio`]));
    expect(caminhos).toHaveLength(2);
  });
});
