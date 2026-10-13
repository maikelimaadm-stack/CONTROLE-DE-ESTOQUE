import { describe, expect, it } from "vitest";
import { UNKNOWN_VALUE, type ItemDaConferenciaNfe, type ProdutoDoVinculo, type VinculoDoItemDaNota } from "@agro/domain";
import { decisaoDoVinculo, lembrarDoVinculo, lembrarPorPadrao, rotuloDoVinculo, sugeridoPelaDescricao, sugeridoPorPalpite } from "./vinculo-do-item";

/**
 * XML-02 (decisão 314) — o vínculo do item na tela: o rótulo da origem pelos rótulos do domínio (nunca o valor técnico),
 * o "Lembrar este vínculo" desmarcado só no PALPITE (a descrição semelhante; a origem desconhecida, fail-closed), o
 * "Lembrar" refeito pela troca de fornecedor e o skew com a API anterior (sem "reference"/"descricao"): nada muda.
 */

const P1 = "bbbbbbbb-0000-4000-8000-000000000001";
const UN = "aaaaaaaa-0000-4000-8000-000000000001";
const LOCAL = "aaaaaaaa-0000-4000-8000-000000000002";
const produto: ProdutoDoVinculo = { id: P1, codigo: "PRD-1", descricao: "Ração bovina engorda", unidade: "KG", controleLote: "nenhum", controlaEstoque: true };
const preenchimento = { description: "RACAO BOVINA ENGORDA 25KG", ncm_code: "23099090", barcode: null, measurement_id: UN };
const sugerido = (origem: "codigo_fornecedor" | "codigo_barras" | "reference"): VinculoDoItemDaNota => ({ situacao: "sugerido", origem, produto, fator: "1", tipoFator: "multiply" });
const descricao: VinculoDoItemDaNota = { situacao: "sugerido", origem: "descricao", produto, fator: "1", tipoFator: "multiply", preenchimento };
const lembrado: VinculoDoItemDaNota = { situacao: "lembrado", produto, fator: "1", tipoFator: "multiply" };
const ambiguo: VinculoDoItemDaNota = { situacao: "ambiguo", candidatos: [produto, { ...produto, id: "bbbbbbbb-0000-4000-8000-000000000002" }] };
const nenhum: VinculoDoItemDaNota = { situacao: "nenhum", preenchimento };
/** Uma origem que a tela NÃO conhece (uma API mais nova): o tipo não a admite, a resposta pode trazê-la. */
const origemFutura = { situacao: "sugerido", origem: "origem_futura", produto, fator: "1", tipoFator: "multiply" } as unknown as VinculoDoItemDaNota;
const situacaoFutura = { situacao: "situacao_futura" } as unknown as VinculoDoItemDaNota;

describe("XML-02 V1 o rótulo do vínculo: a origem do sugerido pelos rótulos do domínio, nunca o valor técnico", () => {
  it("as 4 origens, cada uma com o seu rótulo (a referência e a descrição NÃO viram 'código do fornecedor')", () => {
    const casos: [VinculoDoItemDaNota, string, string][] = [
      [sugerido("codigo_fornecedor"), "codigo_fornecedor", "Sugerido (código do fornecedor)"],
      [sugerido("codigo_barras"), "codigo_barras", "Sugerido (código de barras)"],
      [sugerido("reference"), "reference", "Sugerido (referência do produto)"],
      [descricao, "descricao", "Sugerido (descrição semelhante)"]
    ];
    expect(casos).toHaveLength(4);
    for (const [v, cru, rotulo] of casos) {
      expect(rotuloDoVinculo(v), cru).toBe(rotulo);
      expect(rotuloDoVinculo(v)).not.toContain(cru);
    }
    expect(new Set(casos.map(([v]) => rotuloDoVinculo(v))).size).toBe(4);
  });
  it("lembrado, ambíguo e sem vínculo: só a situação (sem parêntese)", () => {
    expect(rotuloDoVinculo(lembrado)).toBe("Vínculo lembrado");
    expect(rotuloDoVinculo(ambiguo)).toBe("Mais de um produto corresponde");
    expect(rotuloDoVinculo(nenhum)).toBe("Sem vínculo");
  });
  it("origem que a tela não conhece ⇒ só 'Sugerido' (nem o valor cru, nem parêntese); situação desconhecida ⇒ 'Desconhecido'", () => {
    expect(rotuloDoVinculo(origemFutura)).toBe("Sugerido");
    expect(rotuloDoVinculo(origemFutura)).not.toContain("origem_futura");
    expect(rotuloDoVinculo(situacaoFutura)).toBe(UNKNOWN_VALUE);
    expect(rotuloDoVinculo(situacaoFutura)).not.toContain("situacao_futura");
  });
});

describe("XML-02 V2 'Lembrar este vínculo' nasce DESMARCADO só no palpite (a descrição semelhante)", () => {
  const casos: [string, VinculoDoItemDaNota | undefined, boolean][] = [
    ["lembrado", lembrado, true], ["codigo_fornecedor", sugerido("codigo_fornecedor"), true], ["codigo_barras", sugerido("codigo_barras"), true],
    ["reference", sugerido("reference"), true], ["ambiguo", ambiguo, true], ["nenhum", nenhum, true], ["sem vínculo na resposta", undefined, true],
    ["descricao", descricao, false], ["origem desconhecida (fail-closed)", origemFutura, false]
  ];
  it("o padrão de cada vínculo (premissa: há marcado E desmarcado; só a descrição e a origem desconhecida desmarcam)", () => {
    expect(casos).toHaveLength(9);
    for (const [nome, v, esperado] of casos) {
      expect(lembrarPorPadrao(v), nome).toBe(esperado);
      expect(lembrarDoVinculo(v), nome).toBe(esperado);
    }
    expect(casos.filter(([, v]) => !lembrarDoVinculo(v)).map(([nome]) => nome)).toEqual(["descricao", "origem desconhecida (fail-closed)"]);
  });
  it("palpite: a descrição e a origem desconhecida; o sugerido pela descrição é só o da descrição", () => {
    expect(casos.filter(([, v]) => sugeridoPorPalpite(v)).map(([nome]) => nome)).toEqual(["descricao", "origem desconhecida (fail-closed)"]);
    expect(casos.filter(([, v]) => sugeridoPelaDescricao(v)).map(([nome]) => nome)).toEqual(["descricao"]);
  });
});

describe("XML-02 V3 o 'Lembrar' refeito pela troca de fornecedor: o palpite volta desmarcado; o que a pessoa mudou fica", () => {
  it("o vínculo novo é a descrição ⇒ desmarcado, venha de onde vier e marcado ou não", () => {
    expect(lembrarDoVinculo(descricao, { lembrar: true, vinculo: lembrado })).toBe(false);
    expect(lembrarDoVinculo(descricao, { lembrar: true, vinculo: sugerido("codigo_fornecedor") })).toBe(false);
    expect(lembrarDoVinculo(descricao, { lembrar: true, vinculo: nenhum })).toBe(false);
    expect(lembrarDoVinculo(descricao, { lembrar: true, vinculo: descricao })).toBe(false);
    expect(lembrarDoVinculo(descricao, { lembrar: false, vinculo: sugerido("codigo_barras") })).toBe(false);
  });
  it("da descrição para a identidade: o desmarcado do palpite não passa adiante; o que a pessoa marcou fica marcado", () => {
    expect(lembrarDoVinculo(lembrado, { lembrar: false, vinculo: descricao })).toBe(true);
    expect(lembrarDoVinculo(sugerido("codigo_fornecedor"), { lembrar: false, vinculo: descricao })).toBe(true);
    expect(lembrarDoVinculo(sugerido("codigo_fornecedor"), { lembrar: true, vinculo: descricao })).toBe(true);
  });
  it("entre vínculos que não são palpite, como era (`base.lembrar`): o desmarcado pela pessoa fica desmarcado", () => {
    expect(lembrarDoVinculo(sugerido("codigo_barras"), { lembrar: false, vinculo: lembrado })).toBe(false);
    expect(lembrarDoVinculo(nenhum, { lembrar: false, vinculo: sugerido("reference") })).toBe(false);
    expect(lembrarDoVinculo(lembrado, { lembrar: true, vinculo: nenhum })).toBe(true);
    expect(lembrarDoVinculo(ambiguo, { lembrar: true, vinculo: undefined })).toBe(true);
    expect(lembrarDoVinculo(ambiguo, { lembrar: false, vinculo: undefined })).toBe(false);
  });
});

describe("XML-02 V4 skew: web nova + API anterior (só lembrado, sugerido por código do fornecedor/barras sem pré-preenchimento, ambíguo, nenhum)", () => {
  const daApiAnterior: VinculoDoItemDaNota[] = [lembrado, sugerido("codigo_fornecedor"), sugerido("codigo_barras"), ambiguo, nenhum];
  it("o rótulo é o de antes, o 'Lembrar' nasce marcado em todos e nenhum é palpite", () => {
    expect(daApiAnterior.map(rotuloDoVinculo)).toEqual(["Vínculo lembrado", "Sugerido (código do fornecedor)", "Sugerido (código de barras)", "Mais de um produto corresponde", "Sem vínculo"]);
    expect(daApiAnterior.map((v) => lembrarDoVinculo(v))).toEqual([true, true, true, true, true]);
    expect(daApiAnterior.some((v) => sugeridoPorPalpite(v) || sugeridoPelaDescricao(v))).toBe(false);
  });
});

describe("XML-02 V5 a decisão com que a tela nasce: o sugerido pela descrição vem ESCOLHIDO, com 'Lembrar' desmarcado", () => {
  const item = (nItem: number, vinculo: VinculoDoItemDaNota): ItemDaConferenciaNfe => ({ nItem, vinculo, quantidadeInterna: null, valorUnitarioInterno: null, itemDoPedido: null });
  const vinculos = [lembrado, sugerido("codigo_fornecedor"), sugerido("codigo_barras"), sugerido("reference"), descricao, ambiguo, nenhum];
  const conf = { itens: vinculos.map((v, k) => item(k + 1, v)) };
  it("produto e fator do lembrado e de todo sugerido; o 'Lembrar' desmarcado só no item 5 (a descrição)", () => {
    const d = conf.itens.map((i) => decisaoDoVinculo(conf, i.nItem));
    expect(d).toHaveLength(7);
    expect(d.map((x) => x.produtoId)).toEqual([P1, P1, P1, P1, P1, "", ""]);
    expect(d.map((x) => x.lembrar)).toEqual([true, true, true, true, false, true, true]);
    expect(d.every((x) => !x.produtoManual && x.fator === "1" && x.tipoFator === "multiply")).toBe(true);
  });
  it("refeita pela troca de fornecedor: o que a pessoa decidiu no item fica; o lembrado que vira descrição volta desmarcado", () => {
    const base = { ...decisaoDoVinculo(conf, 1), armazemId: LOCAL, lote: "L1" };
    expect(base.lembrar).toBe(true);
    expect(decisaoDoVinculo({ itens: [item(1, descricao)] }, 1, base, lembrado)).toMatchObject({ produtoId: P1, armazemId: LOCAL, lote: "L1", lembrar: false });
    const daDescricao = decisaoDoVinculo(conf, 5);
    expect(daDescricao.lembrar).toBe(false);
    expect(decisaoDoVinculo({ itens: [item(5, lembrado)] }, 5, daDescricao, descricao).lembrar).toBe(true);
  });
});
