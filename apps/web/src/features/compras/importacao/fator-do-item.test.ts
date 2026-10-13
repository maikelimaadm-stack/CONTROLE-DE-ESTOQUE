import { describe, expect, it, vi } from "vitest";
import { D } from "@agro/shared";
import type { DivergenciaDaImportacaoNfe, FatorDoItemDaNota, ItemDaNota, ProdutoDoVinculo, VinculoDoItemDaNota } from "@agro/domain";
import { avisoDoFatorNaTela, contaDoItem, divergenciasDoServidorNaTela, type DecisaoDoItemNaTela } from "./estado";
import { fatorNaTela } from "./fator-do-item";
import { decisaoDoVinculo, fatorPelaNotaDoVinculo } from "./vinculo-do-item";

// O estado da conferência é um módulo de React: o que ele importa pela rede e pelo apelido "@/…" fica de fora do teste
// (as contas e as divergências provadas aqui são puras e não tocam em nada disso).
vi.mock("@/lib/utils", () => import("../../../lib/utils"));
vi.mock("@/features/central/regras-gerais", () => import("../../central/regras-gerais"));
vi.mock("@/lib/api", () => ({ api: () => Promise.reject(new Error("sem rede no teste")), ApiError: class ApiError extends Error {} }));
vi.mock("../pedido-e-orcamento", () => ({ novaChaveDeIdempotencia: () => ({}) }));

/**
 * XML-04 (decisão 318) — "o fator vem do cadastro": a tela diz DE ONDE veio o fator, perto do campo (o cadastro pela
 * unidade da nota, o vínculo lembrado — com os dois números quando o cadastro diz outro —, a PERGUNTA com o campo vazio);
 * o fator mudado pela pessoa é "informado na tela"; a pergunta é a pendência do fator inválido de sempre; os avisos do
 * servidor sobre o fator são refeitos pela tela só quando ela lê o `fatorPelaNota`; e a API anterior: a tela de antes.
 */

const P1 = "bbbbbbbb-0000-4000-8000-000000000001";
const P2 = "bbbbbbbb-0000-4000-8000-000000000002";
const produto: ProdutoDoVinculo = { id: P1, codigo: "PRD-1", descricao: "Adubo NPK", unidade: "KG", controleLote: "nenhum", controlaEstoque: true };
const produtoNaTela = { id: P1, codigo: "PRD-1", descricao: "Adubo NPK", controleLote: "nenhum" as const, controlaEstoque: true };

const sugerido = (fator: string, fatorPelaNota?: FatorDoItemDaNota): VinculoDoItemDaNota =>
  ({ situacao: "sugerido", origem: "reference", produto, fator, tipoFator: "multiply", ...(fatorPelaNota ? { fatorPelaNota } : {}) });
const lembrado = (fator: string, fatorPelaNota?: FatorDoItemDaNota): VinculoDoItemDaNota =>
  ({ situacao: "lembrado", produto, fator, tipoFator: "multiply", ...(fatorPelaNota ? { fatorPelaNota } : {}) });

const principal = sugerido("1", { origem: "unidade_principal", unidadeDaNota: "KG" });
const doProduto = sugerido("50.000000", { origem: "unidade_do_produto", unidadeDaNota: "SC" });
const doVinculo = lembrado("6", { origem: "vinculo", unidadeDaNota: "CX", cadastro: null });
const vinculoContraCadastro = lembrado("6.000000", { origem: "vinculo", unidadeDaNota: "CX", cadastro: { fator: "12.000000", tipoFator: "multiply" } });
const foraDoCadastro = sugerido("1", { origem: "pergunta", unidadeDaNota: "BD", motivo: "unidade_fora_do_cadastro" });
const outroCodigoDeBarras = sugerido("1", { origem: "pergunta", unidadeDaNota: "CX", motivo: "codigo_de_barras_de_outra_unidade" });
/** A API anterior: o mesmo vínculo, sem `fatorPelaNota`. */
const anterior = sugerido("1");

const conf = (v: VinculoDoItemDaNota, nItem = 1) => ({ itens: [{ nItem, vinculo: v, quantidadeInterna: null, valorUnitarioInterno: null, itemDoPedido: null }] });
const decisao = (v: VinculoDoItemDaNota, nItem = 1): DecisaoDoItemNaTela => decisaoDoVinculo(conf(v, nItem), nItem);
const item: ItemDaNota = {
  nItem: 1, codigo: "X04U1", ean: null, descricao: "INSUMO EM BALDE", ncm: "31051000", cfop: "5102", unidade: "BD", quantidade: "6", valorUnitario: "70",
  valorProdutos: "420.00", desconto: "0.00", frete: "0.00", seguro: "0.00", outras: "0.00", ipi: "0.00", icmsSt: "0.00", icms: "0.00", xPed: null, nItemPed: null, rastro: []
};

describe("XML-04 T1 a origem do fator → o texto perto do campo (o fator do servidor, no produto do vínculo)", () => {
  const casos: [string, VinculoDoItemDaNota, string, string][] = [
    ["unidade principal", principal, "unidade_principal", "Fator do cadastro: unidade principal do produto (KG)."],
    ["unidade do produto", doProduto, "unidade_do_produto", "Fator do cadastro: unidade SC do produto."],
    ["vínculo lembrado", doVinculo, "vinculo", "Fator do vínculo lembrado."]
  ];
  it("cada origem com o seu texto; sem aviso e sem pergunta; o campo nasce com o fator do servidor", () => {
    expect(casos).toHaveLength(3);
    for (const [nome, v, origem, texto] of casos) {
      const d = decisao(v);
      expect(d.fator, nome).toBe(v.situacao === "sugerido" || v.situacao === "lembrado" ? D(v.fator).toFixed() : "");
      expect(fatorNaTela(v, d), nome).toEqual({ origem, texto, aviso: null, pergunta: null });
    }
    expect(new Set(casos.map(([, v]) => fatorNaTela(v, decisao(v))?.texto)).size).toBe(3);
  });
  it("o vínculo lembrado que o cadastro contradiz: o AVISO com os DOIS números, a conversão e a unidade (vale o do vínculo)", () => {
    const d = decisao(vinculoContraCadastro);
    expect(d.fator, "o campo mostra o fator do vínculo").toBe("6");
    expect(fatorNaTela(vinculoContraCadastro, d)).toEqual({
      origem: "vinculo", texto: "Fator do vínculo lembrado.", pergunta: null,
      aviso: "O vínculo lembrado usa o fator 6 (Multiplica) e o cadastro do produto diz 12 (Multiplica) para a unidade CX: vale o do vínculo; confira."
    });
  });
  it("o fator com casas aparece como a tela escreve número (vírgula), nunca o texto cru do banco", () => {
    const v = lembrado("0.500000", { origem: "vinculo", unidadeDaNota: "L", cadastro: { fator: "1000.000000", tipoFator: "divide" } });
    expect(fatorNaTela(v, decisao(v))?.aviso).toBe("O vínculo lembrado usa o fator 0,5 (Multiplica) e o cadastro do produto diz 1.000 (Divide) para a unidade L: vale o do vínculo; confira.");
  });
});

describe("XML-04 T2 a PERGUNTA: o campo nasce VAZIO (nunca o '1' do servidor) e o item é PENDÊNCIA até o fator válido", () => {
  it("o servidor manda fator '1' por compatibilidade; a tela nasce vazia, com a pergunta de cada motivo", () => {
    for (const [v, pergunta] of [
      [foraDoCadastro, "A unidade BD da nota não está no cadastro do produto: informe o fator."],
      [outroCodigoDeBarras, "O código de barras da nota é de outra unidade do produto: informe o fator."]
    ] as const) {
      expect(v.situacao === "sugerido" ? v.fator : null, "premissa: o fator de compatibilidade do servidor").toBe("1");
      const d = decisao(v);
      expect(d.fator).toBe("");
      expect(fatorNaTela(v, d)).toEqual({ origem: "pergunta", texto: null, aviso: null, pergunta });
    }
  });
  it("a pendência é a do fator inválido de sempre (`contaDoItem` → fator_invalido) até a pessoa digitar um fator válido", () => {
    const d = decisao(foraDoCadastro);
    expect(contaDoItem(item, d, produtoNaTela)).toEqual({ situacao: "fator_invalido" });
    for (const invalido of ["0", "abc", "1.1234567"]) {
      const dd = { ...d, fator: invalido };
      expect(contaDoItem(item, dd, produtoNaTela).situacao, invalido).toBe("fator_invalido");
      expect(fatorNaTela(foraDoCadastro, dd)?.origem, `${invalido}: a pergunta continua`).toBe("pergunta");
    }
    const informado = { ...d, fator: "20" };
    expect(contaDoItem(item, informado, produtoNaTela)).toMatchObject({ situacao: "pronta", quantidadeInterna: "120.0000" });
    expect(fatorNaTela(foraDoCadastro, informado)).toEqual({ origem: "informado", texto: "Fator informado na tela.", aviso: null, pergunta: null });
  });
  it("a unidade da nota vazia e um motivo que a tela não conhece: a pergunta continua, com o texto possível", () => {
    const semUnidade = sugerido("1", { origem: "pergunta", unidadeDaNota: "", motivo: "unidade_fora_do_cadastro" });
    expect(fatorNaTela(semUnidade, decisao(semUnidade))?.pergunta).toBe("A nota não traz a unidade do item: informe o fator.");
    const motivoFuturo = sugerido("1", { origem: "pergunta", unidadeDaNota: "BD", motivo: "motivo_futuro" } as unknown as FatorDoItemDaNota);
    expect(decisao(motivoFuturo).fator).toBe("");
    expect(fatorNaTela(motivoFuturo, decisao(motivoFuturo))?.pergunta).toBe("O cadastro do produto não diz o fator desta unidade da nota: informe o fator.");
  });
});

describe("XML-04 T3 o fator continua EDITÁVEL: o que a pessoa muda é 'informado na tela' (a pessoa sempre ganha)", () => {
  it("outro número ou outra conversão ⇒ informado, sem o aviso; de volta ao fator do servidor ⇒ a origem dele de novo", () => {
    const d = decisao(vinculoContraCadastro);
    const casos: [string, Partial<DecisaoDoItemNaTela>][] = [["o fator do cadastro", { fator: "12" }], ["outro número", { fator: "7" }], ["outra conversão", { tipoFator: "divide" }], ["vazio", { fator: "" }]];
    for (const [nome, mudanca] of casos) {
      expect(fatorNaTela(vinculoContraCadastro, { ...d, ...mudanca }), nome).toEqual({ origem: "informado", texto: "Fator informado na tela.", aviso: null, pergunta: null });
    }
    expect(fatorNaTela(vinculoContraCadastro, { ...d, fator: "6.0" })?.origem, "o mesmo número escrito de outro jeito").toBe("vinculo");
  });
  it("outro produto no item ⇒ nenhuma origem (a do servidor é do produto do vínculo)", () => {
    expect(fatorNaTela(principal, { ...decisao(principal), produtoId: P2 })).toBeNull();
    expect(fatorNaTela(foraDoCadastro, { ...decisao(foraDoCadastro), produtoId: "" })).toBeNull();
  });
});

describe("XML-04 T4 os avisos do fator do servidor: a tela os refaz só quando lê o `fatorPelaNota` do item", () => {
  const div = (codigo: string, nItem: number | null, bloqueia = false): DivergenciaDaImportacaoNfe => ({ codigo, mensagem: `mensagem de ${codigo}`, nItem, bloqueia });
  const doServidor = [div("fator_a_informar", 1), div("fator_do_vinculo_diferente_do_cadastro", 2), div("parceiro_ie_diferente", null), div("preco_diferente_do_pedido", 1)];
  const itens = (um: VinculoDoItemDaNota, dois: VinculoDoItemDaNota) => [
    { nItem: 1, vinculo: um, quantidadeInterna: null, valorUnitarioInterno: null, itemDoPedido: null },
    { nItem: 2, vinculo: dois, quantidadeInterna: null, valorUnitarioInterno: null, itemDoPedido: null }
  ];
  it("com o `fatorPelaNota`: a pergunta e o vínculo × cadastro saem da lista do servidor (a tela os refaz); os outros avisos ficam", () => {
    const lista = divergenciasDoServidorNaTela({ divergencias: doServidor, itens: itens(foraDoCadastro, vinculoContraCadastro) });
    expect(lista.map((d) => [d.codigo, d.aba, d.origem])).toEqual([["parceiro_ie_diferente", "cabecalho", "servidor"], ["preco_diferente_do_pedido", "pedido", "servidor"]]);
  });
  it("sem o `fatorPelaNota` daquele item (a tela não o leu): o aviso do servidor fica, como veio", () => {
    const lista = divergenciasDoServidorNaTela({ divergencias: doServidor, itens: itens(anterior, lembrado("6")) });
    expect(lista.map((d) => [d.codigo, d.bloqueia, d.origem])).toEqual([
      ["fator_a_informar", false, "servidor"], ["fator_do_vinculo_diferente_do_cadastro", false, "servidor"], ["parceiro_ie_diferente", false, "servidor"], ["preco_diferente_do_pedido", false, "servidor"]
    ]);
  });
  it("o aviso da tela: enquanto o campo mostra o fator do vínculo — Aviso (não bloqueia), na aba Itens, com os dois números", () => {
    const c = conf(vinculoContraCadastro, 10);
    const d = decisaoDoVinculo(c, 10);
    expect(avisoDoFatorNaTela(c, d)).toEqual({
      codigo: "fator_do_vinculo_diferente_do_cadastro", nItem: 10, bloqueia: false, aba: "itens", origem: "tela",
      mensagem: "Item 10: O vínculo lembrado usa o fator 6 (Multiplica) e o cadastro do produto diz 12 (Multiplica) para a unidade CX: vale o do vínculo; confira."
    });
    expect(avisoDoFatorNaTela(c, { ...d, fator: "12" }), "a pessoa decidiu: o aviso some").toBeNull();
    expect(avisoDoFatorNaTela(conf(doVinculo, 10), decisaoDoVinculo(conf(doVinculo, 10), 10)), "o cadastro não contradiz").toBeNull();
  });
});

describe("XML-04 T5 a API anterior (sem `fatorPelaNota`) e a forma estranha: a tela de antes", () => {
  it("sem a propriedade (ou herdada do protótipo): nenhuma origem, o fator do servidor no campo (o '1' de hoje)", () => {
    const herdada = Object.assign(Object.create({ fatorPelaNota: { origem: "pergunta", unidadeDaNota: "BD", motivo: "unidade_fora_do_cadastro" } }) as object,
      { situacao: "sugerido", origem: "reference", produto, fator: "1", tipoFator: "multiply" }) as VinculoDoItemDaNota;
    for (const [nome, v] of [["ausente", anterior], ["herdada", herdada]] as const) {
      expect(fatorPelaNotaDoVinculo(v), nome).toBeNull();
      const d = decisao(v);
      expect(d.fator, nome).toBe("1");
      expect(fatorNaTela(v, d), nome).toBeNull();
      expect(contaDoItem(item, d, produtoNaTela).situacao, nome).toBe("pronta");
    }
  });
  it("origem que a tela não conhece, ou sem a unidade da nota ⇒ nenhuma origem e o fator do servidor (fail-closed: nada afirmado)", () => {
    for (const f of [{ origem: "origem_futura", unidadeDaNota: "KG" }, { origem: "unidade_principal" }, "unidade_principal", null]) {
      const v = { ...anterior, fatorPelaNota: f } as unknown as VinculoDoItemDaNota;
      expect(fatorPelaNotaDoVinculo(v), JSON.stringify(f)).toBeNull();
      expect(decisao(v).fator).toBe("1");
    }
  });
  it("o cadastro do vínculo fora da forma ⇒ sem cadastro (sem aviso: a tela não afirma um número que não leu)", () => {
    const v = lembrado("6", { origem: "vinculo", unidadeDaNota: "CX", cadastro: { fator: "doze", tipoFator: "multiply" } });
    expect(fatorPelaNotaDoVinculo(v)).toEqual({ origem: "vinculo", unidadeDaNota: "CX", cadastro: null });
    expect(fatorNaTela(v, decisao(v))?.aviso).toBeNull();
  });
  it("ambíguo e sem vínculo não têm `fatorPelaNota`: o fator 1 de sempre", () => {
    const nenhum: VinculoDoItemDaNota = { situacao: "nenhum", preenchimento: { description: "X", ncm_code: null, barcode: null } };
    expect(decisao(nenhum).fator).toBe("1");
    expect(fatorNaTela(nenhum, decisao(nenhum))).toBeNull();
  });
});
