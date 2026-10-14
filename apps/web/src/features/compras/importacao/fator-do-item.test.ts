import { describe, expect, it, vi } from "vitest";
import { D } from "@agro/shared";
import type { DivergenciaDaImportacaoNfe, FatorDoItemDaNota, ItemDaNota, PedidoCandidatoDaNota, ProdutoDoVinculo, VinculoDoItemDaNota } from "@agro/domain";
import { avisoDoFatorNaTela, contaDoItem, divergenciasDoServidorNaTela, itemMudado, type DecisaoDoItemNaTela } from "./estado";
import { fatorNaTela } from "./fator-do-item";
import { decisaoDoVinculo, fatorAoTrocarProduto, fatorPelaNotaDoVinculo } from "./vinculo-do-item";

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
/** O uCom KG chega, pela régua das unidades, à KG da ORGANIZAÇÃO, e o produto está cadastrado na KG do SISTEMA. */
const homonima = sugerido("1", { origem: "pergunta", unidadeDaNota: "KG", motivo: "unidade_homonima_da_organizacao" });
const PERGUNTA_HOMONIMA_KG = "A unidade KG da nota é a da organização, e o produto está cadastrado na KG do sistema: informe o fator.";
const PERGUNTA_GENERICA = "O cadastro do produto não diz o fator desta unidade da nota: informe o fator.";
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
      aviso: "O vínculo lembrado usa o fator 6 (Multiplica) e o cadastro do produto diz 12 (Multiplica) para a unidade CX: vale o do vínculo."
    });
  });
  it("o fator com casas aparece como a tela escreve número (vírgula), nunca o texto cru do banco", () => {
    const v = lembrado("0.500000", { origem: "vinculo", unidadeDaNota: "L", cadastro: { fator: "1000.000000", tipoFator: "divide" } });
    expect(fatorNaTela(v, decisao(v))?.aviso).toBe("O vínculo lembrado usa o fator 0,5 (Multiplica) e o cadastro do produto diz 1.000 (Divide) para a unidade L: vale o do vínculo.");
  });
});

describe("XML-04 T2 a PERGUNTA: o campo nasce VAZIO (nunca o '1' do servidor) e o item é PENDÊNCIA até o fator válido", () => {
  it("o servidor manda fator '1' por compatibilidade; a tela nasce vazia, com a pergunta de cada motivo", () => {
    for (const [v, pergunta] of [
      [foraDoCadastro, "A unidade BD da nota não está no cadastro do produto: informe o fator."],
      [homonima, PERGUNTA_HOMONIMA_KG]
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
  it("outro produto no item: com fator, nenhuma origem (a do servidor é do produto do vínculo); sem fator, a pergunta do produto trocado; sem produto, nada", () => {
    expect(fatorNaTela(principal, { ...decisao(principal), produtoId: P2 })).toBeNull();
    expect(fatorNaTela(foraDoCadastro, { ...decisao(foraDoCadastro), produtoId: "" })).toBeNull();
    expect(fatorNaTela(principal, { ...decisao(principal), produtoId: "", fator: "" }), "sem produto: a pendência é o produto").toBeNull();
    for (const [v, fator] of [[principal, ""], [foraDoCadastro, ""], [doVinculo, "0"], [doProduto, "abc"]] as const) {
      expect(fatorNaTela(v, { ...decisao(v), produtoId: P2, fator }), `${v.situacao} com o campo "${fator}"`)
        .toEqual({ origem: "pergunta", texto: null, aviso: null, pergunta: "O produto foi trocado: informe o fator do produto escolhido." });
    }
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
      mensagem: "Item 10: O vínculo lembrado usa o fator 6 (Multiplica) e o cadastro do produto diz 12 (Multiplica) para a unidade CX: vale o do vínculo."
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

describe("XML-04 T6 a unidade HOMÔNIMA da organização: a pergunta diz o porquê verdadeiro; o código de barras não põe o fator em dúvida", () => {
  const pergunta = (v: VinculoDoItemDaNota) => fatorNaTela(v, decisao(v))?.pergunta;
  const comPergunta = (f: Record<string, unknown>) => sugerido("1", { origem: "pergunta", unidadeDaNota: "UN", ...f } as unknown as FatorDoItemDaNota);
  const codigoDeBarras = { unidade: "CX", fator: "12.000000", tipoFator: "multiply" };

  it("o motivo lido por propriedade própria; o texto EXATO com a unidade da nota (as duas de mesmo símbolo); o campo VAZIO e a pendência; o digitado é 'informado'", () => {
    expect(fatorPelaNotaDoVinculo(homonima)).toEqual({ origem: "pergunta", unidadeDaNota: "KG", motivo: "unidade_homonima_da_organizacao" });
    expect(pergunta(homonima)).toBe(PERGUNTA_HOMONIMA_KG);
    expect(pergunta(sugerido("1", { origem: "pergunta", unidadeDaNota: "SC", motivo: "unidade_homonima_da_organizacao" })))
      .toBe("A unidade SC da nota é a da organização, e o produto está cadastrado na SC do sistema: informe o fator.");
    expect(pergunta(sugerido("1", { origem: "pergunta", unidadeDaNota: "KG", motivo: "unidade_fora_do_cadastro" })), "premissa: o outro motivo, na mesma unidade, diz outra coisa")
      .toBe("A unidade KG da nota não está no cadastro do produto: informe o fator.");
    const d = decisao(homonima);
    expect(d.fator, "o '1' de compatibilidade do servidor não entra no campo").toBe("");
    expect(contaDoItem(item, d, produtoNaTela)).toEqual({ situacao: "fator_invalido" });
    expect(fatorNaTela(homonima, { ...d, fator: "50" })).toEqual({ origem: "informado", texto: "Fator informado na tela.", aviso: null, pergunta: null });
    const lista = divergenciasDoServidorNaTela({ divergencias: [{ codigo: "fator_a_informar", mensagem: "do servidor", nItem: 1, bloqueia: false }], itens: conf(homonima).itens });
    expect(lista, "a tela lê o `fatorPelaNota` do item e refaz a pergunta: o aviso do servidor sai").toEqual([]);
  });
  it("motivo que a tela não conhece (também o do código de barras, que saiu), ausente ou HERDADO do protótipo ⇒ o texto genérico, com o campo vazio (fail-closed)", () => {
    const desconhecidos: unknown[] = ["codigo_de_barras_de_outra_unidade", "motivo_futuro", "UNIDADE_HOMONIMA_DA_ORGANIZACAO", " unidade_homonima_da_organizacao", "unidade_homonima", "", 7, null, true, {}];
    const vinculos = [...desconhecidos.map((motivo) => comPergunta({ motivo })), comPergunta({})];
    const herdado = sugerido("1", Object.assign(Object.create({ motivo: "unidade_homonima_da_organizacao" }) as object, { origem: "pergunta", unidadeDaNota: "UN" }) as FatorDoItemDaNota);
    for (const v of [...vinculos, herdado]) {
      const nome = JSON.stringify(v.situacao === "sugerido" ? v.fatorPelaNota : null);
      expect(fatorPelaNotaDoVinculo(v), nome).toEqual({ origem: "pergunta", unidadeDaNota: "UN", motivo: null });
      expect(decisao(v).fator, nome).toBe("");
      expect(pergunta(v), nome).toBe(PERGUNTA_GENERICA);
    }
    expect(vinculos.length + 1, "premissa: os 10 desconhecidos, o ausente e o herdado").toBe(12);
    const semUnidade = sugerido("1", { origem: "pergunta", unidadeDaNota: "", motivo: "unidade_homonima_da_organizacao" });
    expect(pergunta(semUnidade), "sem a unidade da nota (o servidor não manda assim), a tela não afirma o homônimo").toBe(PERGUNTA_GENERICA);
  });
  it("o `codigoDeBarras` que uma API mande junto NÃO é lido: o motivo dele é desconhecido (genérico, sem número), e nos motivos conhecidos o texto é o do uCom", () => {
    const doCodigo = comPergunta({ motivo: "codigo_de_barras_de_outra_unidade", codigoDeBarras });
    expect(fatorPelaNotaDoVinculo(doCodigo)).toEqual({ origem: "pergunta", unidadeDaNota: "UN", motivo: null });
    expect(pergunta(doCodigo)).toBe(PERGUNTA_GENERICA);
    expect(pergunta(doCodigo), "nenhum número nem unidade do código de barras na tela").not.toMatch(/12|CX|código de barras/i);
    for (const [motivo, texto] of [
      ["unidade_fora_do_cadastro", "A unidade UN da nota não está no cadastro do produto: informe o fator."],
      ["unidade_homonima_da_organizacao", "A unidade UN da nota é a da organização, e o produto está cadastrado na UN do sistema: informe o fator."]
    ] as const) {
      const v = comPergunta({ motivo, codigoDeBarras });
      expect(fatorPelaNotaDoVinculo(v), motivo).toEqual({ origem: "pergunta", unidadeDaNota: "UN", motivo });
      expect(pergunta(v), motivo).toBe(texto);
    }
  });
  it("a API anterior (sem `fatorPelaNota`, ou com o homônimo herdado do protótipo) ⇒ nada: nenhuma origem, nenhuma pergunta, o fator do servidor e o aviso dele", () => {
    const herdada = Object.assign(Object.create({ fatorPelaNota: { origem: "pergunta", unidadeDaNota: "KG", motivo: "unidade_homonima_da_organizacao" } }) as object,
      { situacao: "sugerido", origem: "reference", produto, fator: "1", tipoFator: "multiply" }) as VinculoDoItemDaNota;
    for (const [nome, v] of [["ausente", anterior], ["herdada", herdada]] as const) {
      expect(fatorPelaNotaDoVinculo(v), nome).toBeNull();
      const d = decisao(v);
      expect(d.fator, nome).toBe("1");
      expect(fatorNaTela(v, d), nome).toBeNull();
      const lista = divergenciasDoServidorNaTela({ divergencias: [{ codigo: "fator_a_informar", mensagem: "do servidor", nItem: 1, bloqueia: false }], itens: conf(v).itens });
      expect(lista.map((x) => [x.codigo, x.origem]), nome).toEqual([["fator_a_informar", "servidor"]]);
    }
  });
  it("nenhum texto do fator na tela diz 'confira' nem fala do código de barras: cada pergunta termina pedindo o fator, e o aviso diz os dois números", () => {
    const vinculos = [principal, doProduto, doVinculo, vinculoContraCadastro, foraDoCadastro, homonima, comPergunta({ motivo: "codigo_de_barras_de_outra_unidade", codigoDeBarras }),
      sugerido("1", { origem: "pergunta", unidadeDaNota: "SC", motivo: "unidade_homonima_da_organizacao" }),
      sugerido("1", { origem: "pergunta", unidadeDaNota: "", motivo: "unidade_fora_do_cadastro" }),
      sugerido("1", { origem: "pergunta", unidadeDaNota: "BD", motivo: "motivo_futuro" } as unknown as FatorDoItemDaNota)];
    const textos: string[] = [];
    for (const v of vinculos) {
      const d = decisao(v);
      for (const dd of [d, { ...d, fator: "7" }, { ...d, fator: "" }, { ...d, tipoFator: "divide" as const }, { ...d, produtoId: P2, fator: "" }, { ...d, produtoId: P2 }]) {
        const t = fatorNaTela(v, dd);
        if (t) textos.push(...[t.texto, t.aviso, t.pergunta].filter((x): x is string => x !== null));
        const a = avisoDoFatorNaTela(conf(v), dd);
        if (a) textos.push(a.mensagem);
        if (t?.pergunta) expect(t.pergunta, t.pergunta).toMatch(/: informe o fator( do produto escolhido)?\.$/);
      }
    }
    expect(textos.length, "premissa: há textos (perguntas, origens e avisos) para conferir").toBeGreaterThan(30);
    expect(new Set(textos).size, "premissa: textos diferentes").toBeGreaterThanOrEqual(12);
    expect(textos, "premissa: o homônimo está entre eles").toContain(PERGUNTA_HOMONIMA_KG);
    expect(textos.filter((t) => /confira|código de barras/i.test(t))).toEqual([]);
  });
});

describe("XML-04 T7 a TROCA DE PRODUTO: o fator derivado é do produto do vínculo (vazio + pergunta + pendência; de volta, o fator e a origem)", () => {
  const P3 = "bbbbbbbb-0000-4000-8000-000000000003";
  const produtoP2 = { id: P2, codigo: "PRD-2", descricao: "Outro adubo", controleLote: "nenhum" as const, controlaEstoque: true };
  const confDaTroca = (v: VinculoDoItemDaNota, candidatos: PedidoCandidatoDaNota[] = []) => ({ ...conf(v), pedidos: { referenciados: [], candidatos } });
  const trocar = (c: ReturnType<typeof confDaTroca>, d: DecisaoDoItemNaTela, produtoId: string) => itemMudado(c, "", d, { produtoId, produtoManual: true });
  const PERGUNTA = { origem: "pergunta", texto: null, aviso: null, pergunta: "O produto foi trocado: informe o fator do produto escolhido." };
  const doServidor = (v: VinculoDoItemDaNota) => (v.situacao === "lembrado" || v.situacao === "sugerido" ? [D(v.fator).toFixed(), v.tipoFator] : null);
  const queDivide: VinculoDoItemDaNota = { situacao: "lembrado", produto, fator: "4.000000", tipoFator: "divide", fatorPelaNota: { origem: "vinculo", unidadeDaNota: "FD", cadastro: null } };

  it("o fator derivado (o cadastro: principal e do produto; o vínculo lembrado, com e sem o cadastro contra; o que divide) → outro produto: VAZIO, a pergunta e a pendência; de volta: o fator, a conversão e a origem", () => {
    const derivados: [string, VinculoDoItemDaNota, string][] = [
      ["unidade principal", principal, "unidade_principal"], ["unidade do produto", doProduto, "unidade_do_produto"], ["vínculo lembrado", doVinculo, "vinculo"],
      ["vínculo contra o cadastro", vinculoContraCadastro, "vinculo"], ["vínculo que divide", queDivide, "vinculo"]
    ];
    expect(derivados).toHaveLength(5);
    for (const [nome, v, origem] of derivados) {
      const c = confDaTroca(v);
      const d0 = decisaoDoVinculo(c, 1);
      expect([d0.fator, d0.tipoFator], `${nome}: premissa — o campo nasce com o fator do servidor`).toEqual(doServidor(v));
      expect(fatorNaTela(v, d0)?.origem, `${nome}: premissa — a origem do servidor`).toBe(origem);
      const d1 = trocar(c, d0, P2);
      expect([d1.produtoId, d1.fator, d1.tipoFator], `${nome}: outro produto ⇒ o campo VAZIO, multiplica`).toEqual([P2, "", "multiply"]);
      expect(fatorNaTela(v, d1), `${nome}: a pergunta do produto trocado`).toEqual(PERGUNTA);
      expect(contaDoItem(item, d1, produtoP2), `${nome}: a pendência do fator inválido de sempre`).toEqual({ situacao: "fator_invalido" });
      expect(avisoDoFatorNaTela(c, d1), `${nome}: o aviso do vínculo é do produto do vínculo`).toBeNull();
      const d2 = trocar(c, d1, P1);
      expect([d2.produtoId, d2.fator, d2.tipoFator], `${nome}: de volta ⇒ o fator e a conversão do servidor`).toEqual([P1, d0.fator, d0.tipoFator]);
      expect(fatorNaTela(v, d2), `${nome}: de volta ⇒ a origem`).toEqual(fatorNaTela(v, d0));
      expect(contaDoItem(item, d2, produtoNaTela), `${nome}: de volta ⇒ a conta`).toEqual(contaDoItem(item, d0, produtoNaTela));
    }
  });
  it("o fator que a pessoa DIGITOU fica (é dela): outro número ou outra conversão na troca; o digitado no outro produto, na volta", () => {
    const c = confDaTroca(doProduto);
    const d0 = decisaoDoVinculo(c, 1);
    const digitado = trocar(c, itemMudado(c, "", d0, { fator: "48" }), P2);
    expect([digitado.fator, digitado.tipoFator], "outro número: fica").toEqual(["48", "multiply"]);
    expect(fatorNaTela(doProduto, digitado), "com fator, nenhuma origem").toBeNull();
    expect(contaDoItem(item, digitado, produtoP2)).toMatchObject({ situacao: "pronta", quantidadeInterna: "288.0000" });
    expect(trocar(c, digitado, P1).fator, "e na volta, também").toBe("48");
    expect(fatorNaTela(doProduto, trocar(c, digitado, P1))?.origem).toBe("informado");
    const outraConversao = trocar(c, itemMudado(c, "", d0, { tipoFator: "divide" }), P2);
    expect([outraConversao.fator, outraConversao.tipoFator], "outra conversão: fica").toEqual(["50", "divide"]);
    const noOutro = itemMudado(c, "", trocar(c, d0, P2), { fator: "3" });
    const volta = trocar(c, noOutro, P1);
    expect([volta.fator, volta.tipoFator], "o digitado no outro produto fica na volta").toEqual(["3", "multiply"]);
    expect(fatorNaTela(doProduto, volta)?.origem).toBe("informado");
    const mesmoNumero = trocar(confDaTroca(doVinculo), itemMudado(confDaTroca(doVinculo), "", decisao(doVinculo), { fator: "6.0" }), P2);
    expect(mesmoNumero.fator, "o mesmo número escrito de outro jeito é o do servidor (a régua do fatorNaTela): esvazia").toBe("");
    const cp = confDaTroca(principal);
    const noP2 = itemMudado(cp, "", trocar(cp, decisaoDoVinculo(cp, 1), P2), { fator: "1" });
    expect(trocar(cp, noP2, P3).fator, "digitado no outro produto, IGUAL ao do servidor: para um terceiro produto, fica (o campo é da pessoa)").toBe("1");
  });
  it("a PERGUNTA do servidor (o campo já nasce vazio): na troca, a pergunta passa a ser a do produto trocado; de volta, a do servidor", () => {
    for (const [v, doServidor] of [
      [foraDoCadastro, "A unidade BD da nota não está no cadastro do produto: informe o fator."],
      [homonima, PERGUNTA_HOMONIMA_KG]
    ] as const) {
      const c = confDaTroca(v);
      const d0 = decisaoDoVinculo(c, 1);
      const d1 = trocar(c, d0, P2);
      expect([d1.fator, fatorNaTela(v, d1)]).toEqual(["", PERGUNTA]);
      const d2 = trocar(c, d1, P1);
      expect([d2.fator, fatorNaTela(v, d2)?.pergunta]).toEqual(["", doServidor]);
    }
  });
  it("sem produto (o Limpar) também esvazia; outro produto depois mantém a pergunta; de volta ao do vínculo, o fator", () => {
    const c = confDaTroca(principal);
    const semProduto = trocar(c, decisaoDoVinculo(c, 1), "");
    expect([semProduto.produtoId, semProduto.fator]).toEqual(["", ""]);
    expect(fatorNaTela(principal, semProduto), "sem produto: nenhuma pergunta do fator (a pendência é o produto)").toBeNull();
    expect(contaDoItem(item, semProduto, undefined)).toEqual({ situacao: "sem_produto" });
    const outro = trocar(c, semProduto, P2);
    expect([outro.fator, fatorNaTela(principal, outro)]).toEqual(["", PERGUNTA]);
    const volta = trocar(c, outro, P1);
    expect([volta.fator, fatorNaTela(principal, volta)?.origem]).toEqual(["1", "unidade_principal"]);
  });
  it("a mudança que já traz o fator (o produto criado pela nota, o lote) fica como veio", () => {
    const c = confDaTroca(doProduto);
    const criado = itemMudado(c, "", decisaoDoVinculo(c, 1), { produtoId: P3, produtoManual: true, fator: "1", tipoFator: "multiply" });
    expect([criado.produtoId, criado.fator, criado.tipoFator]).toEqual([P3, "1", "multiply"]);
  });
  it("ambíguo e sem vínculo (fora da 3.2: sem `fatorPelaNota`): a troca não mexe no fator — como na main", () => {
    const ambiguo: VinculoDoItemDaNota = { situacao: "ambiguo", candidatos: [produto, { ...produto, id: P2 }] };
    const nenhum: VinculoDoItemDaNota = { situacao: "nenhum", preenchimento: { description: "X", ncm_code: null, barcode: null } };
    for (const v of [ambiguo, nenhum]) {
      const c = confDaTroca(v);
      const d0 = decisaoDoVinculo(c, 1);
      for (const produtoId of [P2, P1, ""]) {
        expect(fatorAoTrocarProduto(v, d0, produtoId), `${v.situacao} → ${produtoId}`).toBeUndefined();
        const d1 = trocar(c, d0, produtoId);
        expect([d1.fator, d1.tipoFator], `${v.situacao} → ${produtoId}`).toEqual(["1", "multiply"]);
        expect(fatorNaTela(v, d1)).toBeNull();
      }
    }
  });
  it("a API anterior (sem `fatorPelaNota`, ou com a forma que a tela não lê): a troca é a de antes, campo a campo", () => {
    const origemFutura = { ...anterior, fatorPelaNota: { origem: "origem_futura", unidadeDaNota: "KG" } } as unknown as VinculoDoItemDaNota;
    for (const v of [anterior, lembrado("6"), origemFutura]) {
      const c = confDaTroca(v);
      const d0 = decisaoDoVinculo(c, 1);
      const comoAntes = { ...d0, produtoId: P2, produtoManual: true, itemOrigemId: "", lembrar: v.situacao === "sugerido" ? true : d0.lembrar };
      expect(fatorAoTrocarProduto(v, d0, P2)).toBeUndefined();
      expect(trocar(c, d0, P2), `${v.situacao}: o fator do servidor fica (o de hoje)`).toEqual(comoAntes);
      expect(fatorNaTela(v, trocar(c, d0, P2))).toBeNull();
    }
  });
  it("o resto da troca continua: o item do pedido do produto escolhido, o 'Lembrar' do palpite; sem estoque, sem local", () => {
    const pedido: PedidoCandidatoDaNota = {
      id: "pedido-1", codigo: "PC-1", situacao: "aberto", dataDocumento: "2026-10-01", valorTotal: "60.00", condicaoPagamentoId: null,
      itens: [{ id: "item-do-p2", posicao: 1, produtoId: P2, produtoDescricao: "Outro adubo", quantidade: "6", saldo: "6", valorUnitario: "10" }]
    };
    const c = confDaTroca(principal, [pedido]);
    const d0 = decisaoDoVinculo(c, 1);
    expect(d0.lembrar, "premissa: a referência é palpite (nasce desmarcado)").toBe(false);
    const d1 = itemMudado(c, pedido.id, d0, { produtoId: P2, produtoManual: true });
    expect([d1.itemOrigemId, d1.lembrar, d1.fator]).toEqual(["item-do-p2", true, ""]);
    expect(itemMudado(c, pedido.id, { ...d0, armazemId: "local-1" }, { geraEstoque: false }).armazemId).toBe("");
  });
});
