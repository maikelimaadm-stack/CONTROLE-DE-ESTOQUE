import { describe, it, expect } from "vitest";
import {
  LAYOUT_DO_SISTEMA,
  catalogoDaFamilia,
  validarEstruturaLayout,
  padroesRegistroDaEstrutura,
  removerPadroesRegistro,
  chavePadraoDeCadastro,
  COLUNAS_COM_PADRAO_REGISTRO,
  type EstruturaLayout,
  type CampoDoLayout,
  type ColunaDoLayout,
  type ValorPadraoLayout
} from "../src/layout-documento.js";

/** VENDAS-A3-1b — padrão de CADASTRO (`{ tipo: "registro", id }`) no layout do documento: onde vale e com que forma. */

function at<T>(a: readonly T[], i: number): T { const v = a[i]; if (v === undefined) throw new Error(`índice ${i} ausente`); return v; }

const F = "vendas.pedido";
const UUID = "3f2b8c1e-7a4d-4e9b-9c2a-1d5e6f7a8b9c";
const UUID2 = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const UUID3 = "b7e4d2a1-9c8f-4e3d-a2b1-c0d9e8f7a6b5";
const reg = (id: string = UUID): ValorPadraoLayout => ({ tipo: "registro", id });
const sis = (): EstruturaLayout => structuredClone(LAYOUT_DO_SISTEMA(F));
const incompativel = (rotulo: string) => `Valor padrão incompatível com "${rotulo}".`;

/** Campo do cabeçalho/rodapé no layout → o objeto e o caminho dele. */
function noTopo(l: EstruturaLayout, campo: string): { x: CampoDoLayout; caminho: string } {
  const i = l.cabecalho.findIndex((c) => c.campo === campo);
  if (i >= 0) return { x: at(l.cabecalho, i), caminho: `cabecalho[${i}]` };
  for (const [ai, a] of l.rodape.entries()) {
    const j = a.campos.findIndex((c) => c.campo === campo);
    if (j >= 0) return { x: at(a.campos, j), caminho: `rodape[${ai}].campos[${j}]` };
  }
  throw new Error(`campo ${campo} fora do layout`);
}
/** Coluna dos itens no layout → o objeto e o caminho dela. */
function naColuna(l: EstruturaLayout, campo: string): { x: ColunaDoLayout; caminho: string } {
  const i = l.itens.findIndex((c) => c.campo === campo);
  if (i < 0) throw new Error(`coluna ${campo} fora do layout`);
  return { x: at(l.itens, i), caminho: `itens[${i}]` };
}

/** Os campos "referencia" do cabeçalho/rodapé (contrato 1): todos aceitam padrão registro. */
const REFERENCIAS_DO_TOPO: readonly [campo: string, rotulo: string][] = [
  ["client_id", "Cliente"], ["payment_method_id", "Forma de pagamento"], ["categoria_financeira_id", "Natureza"],
  ["centro_custo_id", "Centro de resultado"], ["proprietary_id", "Proprietário"],
  ["condicao_pagamento_id", "Condição de pagamento"], ["transporter_id", "Transportadora"]
];
/** Os demais campos do cabeçalho/rodapé: nenhum aceita padrão registro (Empresa continua só com a variável). */
const OUTROS_DO_TOPO: readonly [campo: string, rotulo: string, tipo: string][] = [
  ["empresa_id", "Empresa", "empresa"], ["document_date", "Data", "data"], ["due_date", "Vencimento", "data"],
  ["shipping_date", "Data de saída", "data"], ["discount", "Desconto", "numero"], ["other_values", "Outros valores", "numero"],
  ["installment_plan", "Parcelamento", "plano"], ["driver_name", "Motorista", "texto"], ["freight", "Frete", "numero"],
  ["freight_icms", "ICMS frete", "numero"], ["is_deductible", "Dedutível", "booleano"], ["note", "Observação", "texto_longo"]
];
/** As colunas dos itens fora do Armazém: nenhuma aceita valor padrão. */
const OUTRAS_COLUNAS: readonly [campo: string, rotulo: string][] = [
  ["codigo", "Código"], ["product_id", "Produto"], ["estoque", "Estoque"], ["quantity", "Quantidade"],
  ["unit_price", "Valor unitário"], ["discount", "Desconto"], ["discount_percent", "Desconto %"], ["total", "Total"]
];
/** Ids que não são UUID: todos recusados no caminho do valor padrão. */
const IDS_INVALIDOS: readonly [nome: string, id: unknown][] = [
  ["vazio", ""], ["número em texto", "123"], ["palavra", "cliente"], ["UUID sem hífens", UUID.replace(/-/g, "")],
  ["UUID com espaço", ` ${UUID}`], ["UUID com sobra", `${UUID}0`], ["UUID truncado", UUID.slice(0, -1)],
  ["caractere fora de hex", UUID.replace(/^3/, "g")], ["número", 42], ["nulo", null]
];

describe("LB-D1 padrão registro: aceito em cada campo de referência e na coluna Armazém", () => {
  it("premissa: a lista de referências do teste é EXATAMENTE a do catálogo, e todas declaram o cadastro", () => {
    const topo = catalogoDaFamilia(F).filter((c) => c.parte !== "itens");
    expect(topo.filter((c) => c.tipo === "referencia").map((c) => [c.chave, c.rotulo])).toEqual(REFERENCIAS_DO_TOPO);
    expect(topo.filter((c) => c.tipo !== "referencia").map((c) => [c.chave, c.rotulo, c.tipo])).toEqual(OUTROS_DO_TOPO);
    expect(topo.filter((c) => c.tipo === "referencia").every((c) => Boolean(c.referencia?.recurso))).toBe(true);
    expect(catalogoDaFamilia(F).filter((c) => c.parte === "itens" && !COLUNAS_COM_PADRAO_REGISTRO.includes(c.chave)).map((c) => [c.chave, c.rotulo])).toEqual(OUTRAS_COLUNAS);
    expect(COLUNAS_COM_PADRAO_REGISTRO).toEqual(["warehouse_id"]);
  });

  it.each(REFERENCIAS_DO_TOPO)("%s aceita registro com UUID", (campo) => {
    const l = sis(); noTopo(l, campo).x.valorPadrao = reg();
    expect(validarEstruturaLayout(F, l)).toEqual([]);
  });

  it("todos os campos de referência e o Armazém com registro ao mesmo tempo → válido", () => {
    const l = sis();
    for (const [campo] of REFERENCIAS_DO_TOPO) noTopo(l, campo).x.valorPadrao = reg();
    naColuna(l, "warehouse_id").x.valorPadrao = reg(UUID2);
    expect(validarEstruturaLayout(F, l)).toEqual([]);
  });

  it("coluna Armazém aceita registro com UUID (opcional ou obrigatória)", () => {
    const l = sis(); const { x } = naColuna(l, "warehouse_id"); x.valorPadrao = reg();
    expect(validarEstruturaLayout(F, l)).toEqual([]);
    x.obrigatorio = true;
    expect(validarEstruturaLayout(F, l)).toEqual([]);
  });

  it.each(OUTROS_DO_TOPO)("%s (%s, tipo %s) recusa registro no caminho .valorPadrao", (campo, rotulo) => {
    const l = sis(); const { x, caminho } = noTopo(l, campo); x.valorPadrao = reg();
    expect(validarEstruturaLayout(F, l)).toEqual([{ caminho: `${caminho}.valorPadrao`, mensagem: incompativel(rotulo) }]);
  });

  it("Empresa continua aceitando a variável empresa_selecionada (nada muda para variável)", () => {
    const l = sis(); noTopo(l, "empresa_id").x.valorPadrao = { tipo: "variavel", variavel: "empresa_selecionada" };
    expect(validarEstruturaLayout(F, l)).toEqual([]);
  });

  it.each(REFERENCIAS_DO_TOPO)("%s com id que não é UUID → erro no caminho exato", (campo, rotulo) => {
    for (const [nome, id] of IDS_INVALIDOS) {
      const l = sis(); const { x, caminho } = noTopo(l, campo); x.valorPadrao = { tipo: "registro", id } as ValorPadraoLayout;
      expect(validarEstruturaLayout(F, l), nome).toEqual([{ caminho: `${caminho}.valorPadrao`, mensagem: incompativel(rotulo) }]);
    }
  });

  it("coluna Armazém com id que não é UUID → erro em itens[i].valorPadrao", () => {
    for (const [nome, id] of IDS_INVALIDOS) {
      const l = sis(); const { x, caminho } = naColuna(l, "warehouse_id"); x.valorPadrao = { tipo: "registro", id } as ValorPadraoLayout;
      expect(validarEstruturaLayout(F, l), nome).toEqual([{ caminho: `${caminho}.valorPadrao`, mensagem: incompativel("Armazém") }]);
    }
  });

  it("coluna Armazém recusa literal e variável: em coluna, só registro", () => {
    const padroes: ValorPadraoLayout[] = [
      { tipo: "literal", valor: UUID }, { tipo: "literal", valor: 1 }, { tipo: "literal", valor: true },
      { tipo: "variavel", variavel: "empresa_selecionada" }, { tipo: "variavel", variavel: "data_atual" }
    ];
    for (const v of padroes) {
      const l = sis(); const { x, caminho } = naColuna(l, "warehouse_id"); x.valorPadrao = v;
      expect(validarEstruturaLayout(F, l), JSON.stringify(v)).toEqual([{ caminho: `${caminho}.valorPadrao`, mensagem: incompativel("Armazém") }]);
    }
  });

  it.each(OUTRAS_COLUNAS)("coluna %s (%s) recusa qualquer valor padrão em itens[i].valorPadrao", (campo, rotulo) => {
    const padroes: ValorPadraoLayout[] = [reg(), { tipo: "literal", valor: "1" }, { tipo: "variavel", variavel: "data_atual" }];
    for (const v of padroes) {
      const l = sis(); const { x, caminho } = naColuna(l, campo); x.valorPadrao = v;
      expect(validarEstruturaLayout(F, l), JSON.stringify(v)).toEqual([{ caminho: `${caminho}.valorPadrao`, mensagem: incompativel(rotulo) }]);
    }
  });

  it("vários padrões inválidos → um erro por caminho, na ordem da estrutura", () => {
    const l = sis();
    const a = noTopo(l, "note"); a.x.valorPadrao = reg();
    const b = noTopo(l, "client_id"); b.x.valorPadrao = reg("x");
    const c = naColuna(l, "quantity"); c.x.valorPadrao = reg();
    expect(validarEstruturaLayout(F, l)).toEqual([
      { caminho: `${b.caminho}.valorPadrao`, mensagem: incompativel("Cliente") },
      { caminho: `${a.caminho}.valorPadrao`, mensagem: incompativel("Observação") },
      { caminho: `${c.caminho}.valorPadrao`, mensagem: incompativel("Quantidade") }
    ]);
  });
});

describe("LB-D2 obrigatório e não editável satisfeito com padrão registro", () => {
  it.each(REFERENCIAS_DO_TOPO)("%s obrigatório + não editável + registro → válido", (campo, rotulo) => {
    const l = sis(); const { x, caminho } = noTopo(l, campo);
    x.obrigatorio = true; x.editavel = false;
    expect(validarEstruturaLayout(F, l), "premissa: sem padrão é recusado").toEqual([
      { caminho: `${caminho}.valorPadrao`, mensagem: `"${rotulo}" é obrigatório e não editável: informe o valor padrão.` }
    ]);
    x.valorPadrao = reg();
    expect(validarEstruturaLayout(F, l)).toEqual([]);
  });

  it("registro com id inválido não satisfaz: só o erro de padrão incompatível", () => {
    const l = sis(); const { x, caminho } = noTopo(l, "condicao_pagamento_id");
    x.obrigatorio = true; x.editavel = false; x.valorPadrao = reg("nao-e-uuid");
    expect(validarEstruturaLayout(F, l)).toEqual([{ caminho: `${caminho}.valorPadrao`, mensagem: incompativel("Condição de pagamento") }]);
  });
});

describe("padroesRegistroDaEstrutura", () => {
  it("chavePadraoDeCadastro: o campo, ou itens.<coluna>", () => {
    expect(chavePadraoDeCadastro("cabecalho", "client_id")).toBe("client_id");
    expect(chavePadraoDeCadastro("rodape", "transporter_id")).toBe("transporter_id");
    expect(chavePadraoDeCadastro("itens", "warehouse_id")).toBe("itens.warehouse_id");
  });

  it("layout sem padrão registro → lista vazia (literal e variável não entram)", () => {
    const l = sis();
    noTopo(l, "empresa_id").x.valorPadrao = { tipo: "variavel", variavel: "empresa_selecionada" };
    noTopo(l, "freight").x.valorPadrao = { tipo: "literal", valor: "0" };
    expect(padroesRegistroDaEstrutura(F, l)).toEqual([]);
  });

  it("cabeçalho, rodapé e itens: chave, caminho, parte, campo, id, rótulo (do layout ou do catálogo) e referência do catálogo", () => {
    const l = sis();
    const cli = noTopo(l, "client_id"); cli.x.valorPadrao = reg(UUID);
    const tra = noTopo(l, "transporter_id"); tra.x.valorPadrao = reg(UUID2); tra.x.rotulo = "Transp.";
    const arm = naColuna(l, "warehouse_id"); arm.x.valorPadrao = reg(UUID3);
    noTopo(l, "freight").x.valorPadrao = { tipo: "literal", valor: "0" };
    expect(padroesRegistroDaEstrutura(F, l)).toEqual([
      { chave: "client_id", caminho: `${cli.caminho}.valorPadrao`, parte: "cabecalho", campo: "client_id", id: UUID, rotulo: "Cliente",
        referencia: { recurso: "people", filtro: { is_client: "true" } } },
      { chave: "transporter_id", caminho: `${tra.caminho}.valorPadrao`, parte: "rodape", campo: "transporter_id", id: UUID2, rotulo: "Transp.",
        referencia: { recurso: "people", filtro: { is_transporter: "true" } } },
      { chave: "itens.warehouse_id", caminho: `${arm.caminho}.valorPadrao`, parte: "itens", campo: "warehouse_id", id: UUID3, rotulo: "Armazém",
        referencia: { recurso: "warehouses" } }
    ]);
    expect(cli.caminho).toBe("cabecalho[0]");
    expect(tra.caminho).toBe("rodape[2].campos[0]");
    expect(arm.caminho).toBe("itens[2]");
  });

  it("campo sem referência no catálogo (a validação recusa) sai SEM a chave referencia", () => {
    const l = sis(); const q = naColuna(l, "quantity"); q.x.valorPadrao = reg();
    const [p, ...resto] = padroesRegistroDaEstrutura(F, l);
    expect(resto).toEqual([]);
    expect(p).toEqual({ chave: "itens.quantity", caminho: `${q.caminho}.valorPadrao`, parte: "itens", campo: "quantity", id: UUID, rotulo: "Quantidade" });
    expect(p && "referencia" in p).toBe(false);
  });
});

describe("removerPadroesRegistro", () => {
  /** Layout com registro em client_id (travado), condição, Armazém; e literal/variável em outros campos. */
  const montar = (): EstruturaLayout => {
    const l = sis();
    const cli = noTopo(l, "client_id").x; cli.valorPadrao = reg(UUID); cli.editavel = false; cli.rotulo = "Comprador";
    noTopo(l, "condicao_pagamento_id").x.valorPadrao = reg(UUID2);
    naColuna(l, "warehouse_id").x.valorPadrao = reg(UUID3);
    noTopo(l, "empresa_id").x.valorPadrao = { tipo: "variavel", variavel: "empresa_selecionada" };
    const fr = noTopo(l, "freight").x; fr.valorPadrao = { tipo: "literal", valor: "0" }; fr.editavel = false;
    return l;
  };
  /** O esperado: a estrutura de entrada sem o valorPadrao dos campos dados. */
  const sem = (l: EstruturaLayout, topo: string[], colunas: string[]): EstruturaLayout => {
    const out = structuredClone(l);
    for (const c of topo) delete noTopo(out, c).x.valorPadrao;
    for (const c of colunas) delete naColuna(out, c).x.valorPadrao;
    return out;
  };

  it("sem chaves: tira TODOS os registros; literal, variável, rótulo e editavel ficam iguais; entrada intacta", () => {
    const l = montar(); const antes = structuredClone(l);
    const r = removerPadroesRegistro(l);
    expect(r).toEqual(sem(l, ["client_id", "condicao_pagamento_id"], ["warehouse_id"]));
    expect(noTopo(r, "client_id").x).toEqual({ campo: "client_id", rotulo: "Comprador", obrigatorio: true, editavel: false });
    expect("valorPadrao" in noTopo(r, "client_id").x).toBe(false);
    expect("valorPadrao" in naColuna(r, "warehouse_id").x).toBe(false);
    expect(padroesRegistroDaEstrutura(F, r)).toEqual([]);
    expect(l, "a entrada não é alterada").toEqual(antes);
    expect(noTopo(r, "freight").x).not.toBe(noTopo(l, "freight").x);
  });

  it("com chaves: tira só as dadas (item pela chave itens.<coluna>)", () => {
    const l = montar();
    expect(removerPadroesRegistro(l, new Set(["client_id", "itens.warehouse_id"]))).toEqual(sem(l, ["client_id"], ["warehouse_id"]));
    expect(removerPadroesRegistro(l, new Set(["condicao_pagamento_id"]))).toEqual(sem(l, ["condicao_pagamento_id"], []));
    expect(removerPadroesRegistro(l, new Set(["warehouse_id"])), "a chave da coluna é itens.warehouse_id").toEqual(l);
    expect(removerPadroesRegistro(l, new Set(["empresa_id", "freight"])), "literal e variável nunca saem").toEqual(l);
    expect(removerPadroesRegistro(l, new Set())).toEqual(l);
  });

  it("layout sem registro sai igual", () => {
    expect(removerPadroesRegistro(sis())).toEqual(sis());
  });

  it("editavel preservado: obrigatório + não editável sem o registro volta a pedir o padrão na validação", () => {
    const l = montar(); const { caminho } = noTopo(l, "client_id");
    expect(validarEstruturaLayout(F, l), "premissa: com o registro é válido").toEqual([]);
    expect(validarEstruturaLayout(F, removerPadroesRegistro(l))).toEqual([
      { caminho: `${caminho}.valorPadrao`, mensagem: `"Cliente" é obrigatório e não editável: informe o valor padrão.` }
    ]);
  });
});
