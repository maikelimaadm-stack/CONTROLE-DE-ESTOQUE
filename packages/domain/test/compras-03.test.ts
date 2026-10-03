import { createHash } from "node:crypto";
import { describe, it, expect } from "vitest";
import {
  FAMILIAS_COM_LAYOUT,
  FAMILIAS_COM_LAYOUT_DE_VENDAS,
  FAMILIAS_COM_LAYOUT_DE_COMPRAS,
  FAMILIAS_COM_LAYOUT_DE_ESTOQUE,
  familiaTemLayout,
  familiaDeCompras,
  CATALOGO_VENDAS,
  catalogoDaFamilia,
  chaveDosItensDaFamilia,
  colunasComPadraoRegistro,
  COLUNAS_COM_PADRAO_REGISTRO,
  LAYOUT_DO_SISTEMA,
  validarEstruturaLayout,
  resolverLayout,
  camposObrigatoriosFaltando,
  camposAdicionaisDoCabecalho,
  motivoZonaProibida,
  padroesRegistroDaEstrutura,
  removerPadroesRegistro,
  mensagemSempreTemValor,
  MENSAGEM_GRUPO_SO_NO_CABECALHO,
  type CampoDoCatalogo,
  type EstruturaLayout,
  type ValorPadraoLayout
} from "../src/index.js";
import { TIPOS_OPERACAO, tipoOperacao } from "../src/tipo-operacao.js";

/*
 * COMPRAS-03 (decisão 269) — o layout do documento vale para o Pedido de compra e a Compra, com o MESMO mecanismo de
 * vendas e um catálogo por família. Aqui: as famílias, os catálogos de compras (ordem, chaves, rótulos, sistema,
 * sempreTemValor, referência), o layout do sistema de compras (= a Central de Compras de hoje), a chave das linhas
 * e a coluna de padrão por família, a cobrança com caminho `itens[i].campo`, as regras de validação e as zonas. E a
 * trava de que VENDAS NÃO MUDOU UM BYTE.
 */

function at<T>(a: readonly T[], i: number): T { const v = a[i]; if (v === undefined) throw new Error(`índice ${i} ausente`); return v; }

const PEDIDO = "compras.pedido";
const COMPRA = "compras.compra";
const UUID = "3f2b8c1e-7a4d-4e9b-9c2a-1d5e6f7a8b9c";
const reg = (id: string = UUID): ValorPadraoLayout => ({ tipo: "registro", id });
const sis = (f: string = COMPRA): EstruturaLayout => structuredClone(LAYOUT_DO_SISTEMA(f));
const erros = (f: string, e: EstruturaLayout) => validarEstruturaLayout(f, e);
const caminhos = (f: string, e: EstruturaLayout) => erros(f, e).map((x) => x.caminho);
const incompativel = (rotulo: string) => `Valor padrão incompatível com "${rotulo}".`;
const sha = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex");
/** Índice do campo no cabeçalho (falha se não estiver). */
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

describe("C3-D1 famílias com layout: vendas primeiro, compras depois (e o estoque por último, F5b), lidas do registry", () => {
  it("as listas, na ordem", () => {
    expect(FAMILIAS_COM_LAYOUT_DE_VENDAS).toEqual(["vendas.orcamento", "vendas.pedido", "vendas.venda"]);
    // OPERACOES-01 F6a (decisão 283): o orçamento de compra entra sozinho, pelo registry
    expect(FAMILIAS_COM_LAYOUT_DE_COMPRAS).toEqual([PEDIDO, COMPRA, "compras.orcamento"]);
    // OPERACOES-01 F5b (decisão 282): as sete do documento de estoque, pelo registry (provadas em f5b-layout-estoque)
    expect(FAMILIAS_COM_LAYOUT_DE_ESTOQUE).toHaveLength(7);
    // o registry declara compras ANTES de vendas; a lista com layout começa por vendas (o "Novo" do configurador) e
    // termina no estoque
    expect(FAMILIAS_COM_LAYOUT).toEqual([...FAMILIAS_COM_LAYOUT_DE_VENDAS, ...FAMILIAS_COM_LAYOUT_DE_COMPRAS, ...FAMILIAS_COM_LAYOUT_DE_ESTOQUE]);
    expect(at(FAMILIAS_COM_LAYOUT, 0)).toBe("vendas.orcamento");
    const noRegistry = TIPOS_OPERACAO.map((t) => t.codigo);
    expect(noRegistry.indexOf(PEDIDO), "premissa: no registry compras vem antes").toBeLessThan(noRegistry.indexOf("vendas.orcamento"));
  });
  it("vêm do registry (dono único): toda variante das duas tabelas, e só elas", () => {
    const da = (tabela: string) => TIPOS_OPERACAO.filter((t) => t.origem.tabela === tabela).map((t) => t.codigo);
    expect([...FAMILIAS_COM_LAYOUT_DE_VENDAS]).toEqual(da("erp.sales_documents"));
    expect([...FAMILIAS_COM_LAYOUT_DE_COMPRAS]).toEqual(da("erp.documentos_compra"));
    for (const f of FAMILIAS_COM_LAYOUT_DE_COMPRAS) expect(tipoOperacao(f)?.origem.discriminador).toBe("especie");
    // o catálogo de compras é escolhido pela ESPÉCIE da variante (sem segunda lista de famílias)
    expect(FAMILIAS_COM_LAYOUT_DE_COMPRAS.map((f) => tipoOperacao(f)?.origem.valor)).toEqual(["pedido", "compra", "orcamento"]);
  });
  it("congeladas (quem importa não altera a lista do outro)", () => {
    expect(Object.isFrozen(FAMILIAS_COM_LAYOUT)).toBe(true);
    expect(Object.isFrozen(FAMILIAS_COM_LAYOUT_DE_VENDAS)).toBe(true);
    expect(Object.isFrozen(FAMILIAS_COM_LAYOUT_DE_COMPRAS)).toBe(true);
  });
  it("familiaTemLayout e familiaDeCompras", () => {
    for (const f of FAMILIAS_COM_LAYOUT) expect(familiaTemLayout(f), f).toBe(true);
    for (const f of ["compras.solicitacao", "financeiro.conta_a_pagar", "", "COMPRAS.PEDIDO", "compras"]) expect(familiaTemLayout(f), f).toBe(false);
    expect(FAMILIAS_COM_LAYOUT.filter(familiaDeCompras)).toEqual([PEDIDO, COMPRA, "compras.orcamento"]);
    for (const f of ["compras.solicitacao", "vendas.pedido", "estoque.entrada", ""]) expect(familiaDeCompras(f), f).toBe(false);
  });
});

/** O catálogo de compras como [chave, rótulo, tipo] — a Central de Compras de hoje, na ordem de hoje. */
const CABECALHO_DO_PEDIDO: readonly [string, string, string][] = [
  ["empresa_id", "Empresa", "empresa"],
  ["fornecedor_id", "Fornecedor", "referencia"],
  ["data_documento", "Data do documento", "data"],
  ["data_vencimento", "Vencimento", "data"],
  ["transportadora_id", "Transportadora", "referencia"],
  ["categoria_financeira_id", "Natureza de despesa", "referencia"],
  ["centro_custo_id", "Centro de resultado", "referencia"],
  ["condicao_pagamento_id", "Condição de pagamento", "referencia"],
  ["forma_pagamento_id", "Forma de pagamento", "referencia"],
  ["frete", "Frete", "numero"],
  ["outras_despesas", "Outras despesas", "numero"],
  ["desconto", "Desconto", "numero"],
  ["plano_parcelas", "Parcelas", "plano"],
  ["observacao", "Observação", "texto_longo"]
];
const CABECALHO_DA_COMPRA: readonly [string, string, string][] = [
  ["empresa_id", "Empresa", "empresa"],
  ["fornecedor_id", "Fornecedor", "referencia"],
  ["data_documento", "Data do documento", "data"],
  ["data_entrada", "Data de entrada", "data"],
  ["data_vencimento", "Vencimento", "data"],
  ["numero_nota", "Número da nota", "texto"],
  ["serie_nota", "Série", "texto"],
  ["transportadora_id", "Transportadora", "referencia"],
  ["categoria_financeira_id", "Natureza de despesa", "referencia"],
  ["centro_custo_id", "Centro de resultado", "referencia"],
  ["condicao_pagamento_id", "Condição de pagamento", "referencia"],
  ["forma_pagamento_id", "Forma de pagamento", "referencia"],
  ["frete", "Frete", "numero"],
  ["outras_despesas", "Outras despesas", "numero"],
  ["desconto", "Desconto", "numero"],
  ["plano_parcelas", "Parcelas", "plano"],
  ["observacao", "Observação", "texto_longo"]
];
const ITENS_DO_PEDIDO: readonly [string, string, string][] = [
  ["armazem_id", "Local de estoque", "referencia"],
  ["produto_id", "Produto", "referencia"],
  ["quantidade", "Quantidade", "numero"],
  ["valor_unitario", "Valor unitário", "numero"],
  ["desconto", "Desconto", "numero"],
  ["desconto_percentual", "Desconto %", "numero"]
];
const ITENS_DA_COMPRA: readonly [string, string, string][] = [...ITENS_DO_PEDIDO, ["lote", "Lote", "texto"], ["validade", "Validade", "data"]];
const trio = (c: CampoDoCatalogo) => [c.chave, c.rotulo, c.tipo];

describe("C3-D2 catálogos de compras", () => {
  it.each([
    [PEDIDO, CABECALHO_DO_PEDIDO, ITENS_DO_PEDIDO],
    [COMPRA, CABECALHO_DA_COMPRA, ITENS_DA_COMPRA]
  ] as const)("%s: chaves, rótulos e tipos na ordem da Central de Compras", (f, cabecalho, itens) => {
    const cat = catalogoDaFamilia(f);
    expect(cat.filter((c) => c.parte === "cabecalho").map(trio)).toEqual(cabecalho);
    expect(cat.filter((c) => c.parte === "itens").map(trio)).toEqual(itens);
    // sem rodapé: a Central de Compras não tem abas; nada fica "só leitura" nem depende de capacidade
    expect(cat.filter((c) => c.parte === "rodape")).toEqual([]);
    expect(cat.filter((c) => c.aba !== undefined || c.somenteLeitura !== undefined || c.exige !== undefined)).toEqual([]);
  });

  it("[C] só na Compra: entrada, nota, série, lote e validade", () => {
    const chaves = (f: string) => catalogoDaFamilia(f).map((c) => `${c.parte === "itens" ? "itens" : "documento"}:${c.chave}`);
    const soNaCompra = chaves(COMPRA).filter((k) => !chaves(PEDIDO).includes(k));
    expect(soNaCompra).toEqual(["documento:data_entrada", "documento:numero_nota", "documento:serie_nota", "itens:lote", "itens:validade"]);
    expect(chaves(PEDIDO).filter((k) => !chaves(COMPRA).includes(k)), "o pedido não tem campo que a compra não tenha").toEqual([]);
    // fora os [C], a mesma ordem
    expect(chaves(COMPRA).filter((k) => !soNaCompra.includes(k))).toEqual(chaves(PEDIDO));
  });

  it.each([PEDIDO, COMPRA])("%s: sistema, sempreTemValor e referência", (f) => {
    const cat = catalogoDaFamilia(f);
    const k = (c: CampoDoCatalogo) => `${c.parte === "itens" ? "itens." : ""}${c.chave}`;
    expect(cat.filter((c) => c.sistema).map((c) => [k(c), c.sistema])).toEqual([
      ["empresa_id", "sempre"], ["fornecedor_id", "sempre"], ["data_documento", "sempre"],
      ["itens.produto_id", "sempre"], ["itens.quantidade", "sempre"], ["itens.valor_unitario", "sempre"]
    ]);
    expect(cat.filter((c) => c.sempreTemValor).map(k)).toEqual(["frete", "outras_despesas", "desconto", "plano_parcelas", "itens.desconto", "itens.desconto_percentual"]);
    expect(cat.filter((c) => c.referencia).map((c) => [k(c), c.referencia])).toEqual([
      ["fornecedor_id", { recurso: "people", filtro: { is_provider: "true" } }],
      ["transportadora_id", { recurso: "people", filtro: { is_transporter: "true" } }],
      ["centro_custo_id", { recurso: "cost_centers", filtro: { kind: "analytic" } }],
      ["condicao_pagamento_id", { recurso: "condicoes_pagamento" }],
      ["forma_pagamento_id", { recurso: "payment_methods" }],
      ["itens.armazem_id", { recurso: "warehouses" }]
    ]);
    // Natureza de despesa: referência SEM cadastro declarado (sem padrão registro nesta fatia) e SEM "sistema"
    // (quem a exige é a regra da TOP quando gera título) — idem Centro de resultado quanto ao "sistema"
    const natureza = cat.find((c) => c.chave === "categoria_financeira_id");
    expect(natureza).toEqual({ chave: "categoria_financeira_id", rotulo: "Natureza de despesa", parte: "cabecalho", tipo: "referencia" });
    expect(cat.find((c) => c.chave === "centro_custo_id")?.sistema).toBeUndefined();
  });

  it("catalogoDaFamilia: vendas → CATALOGO_VENDAS (o mesmo objeto); desconhecida → nenhum", () => {
    for (const f of FAMILIAS_COM_LAYOUT_DE_VENDAS) expect(catalogoDaFamilia(f), f).toBe(CATALOGO_VENDAS);
    for (const f of ["compras.solicitacao", "", "vendas", "compras"]) expect(catalogoDaFamilia(f), f).toEqual([]);
    expect(catalogoDaFamilia(PEDIDO)).not.toBe(catalogoDaFamilia(COMPRA));
    expect(Object.isFrozen(catalogoDaFamilia(COMPRA))).toBe(true);
  });
});

describe("C3-D3 vendas NÃO mudou um byte", () => {
  // sha256 de JSON.stringify, calculado sobre o domínio de origin/main 93497b1 (antes da COMPRAS-03)
  // OPERACOES-01 F3b (decisão 280): o Local de estoque passou a abrir os itens de venda. Devolvido para logo depois do
  // Produto (a posição de 93497b1), catálogo e layout do sistema voltam a ser os de 93497b1 byte a byte.
  const localDepoisDoProduto = <T>(lista: readonly T[], chave: (x: T) => string): T[] => {
    const i = lista.findIndex((x) => chave(x) === "warehouse_id");
    const sem = lista.filter((_, j) => j !== i);
    const p = sem.findIndex((x) => chave(x) === "product_id");
    return [...sem.slice(0, p + 1), at(lista, i), ...sem.slice(p + 1)];
  };
  it("CATALOGO_VENDAS idêntico (fora o rótulo 'Local de estoque' da F3a e o Local antes do Produto da F3b, decisão 280)", () => {
    const coluna = CATALOGO_VENDAS.find((c) => c.parte === "itens" && c.chave === "warehouse_id");
    expect(coluna?.rotulo).toBe("Local de estoque");
    expect(CATALOGO_VENDAS.filter((c) => c.parte === "itens").map((c) => c.chave).slice(0, 3), "premissa: o Local abre os itens").toEqual(["warehouse_id", "codigo", "product_id"]);
    // com o rótulo de antes e o Local de volta depois do Produto, o catálogo é o de 93497b1 byte a byte: o rename (F3a)
    // e a posição do Local (F3b) foram as ÚNICAS mudanças
    const deAntes = localDepoisDoProduto(CATALOGO_VENDAS, (c) => (c.parte === "itens" ? c.chave : "")).map((c) => (c === coluna ? { ...c, rotulo: "Armazém" } : c));
    expect(sha(deAntes)).toBe("8e61b2e21d907956cfde7db1b2f8e5dfb43ecb9b8e302a7e1f05e34e4e52c13c");
    expect(sha(CATALOGO_VENDAS)).toBe("aac5e7eeb5235c4c46d64fb9294d822155e05f542bddbd40cedc1d2aa3e71a9e");
  });
  it.each(FAMILIAS_COM_LAYOUT_DE_VENDAS)("LAYOUT_DO_SISTEMA(%s) idêntico (fora a posição do Local, decisão 280)", (f) => {
    const l = LAYOUT_DO_SISTEMA(f);
    expect(at(l.itens, 0).campo, "premissa: o Local abre os itens").toBe("warehouse_id");
    expect(sha({ ...l, itens: localDepoisDoProduto(l.itens, (c) => c.campo) })).toBe("d6c475ec8741549071d46c2bec264f73816ea9ae385b9438d788ceb41e9bb9f7");
    expect(sha(l)).toBe("dc34dd54b2ea49c67947cffb1338e70bb7d45ebe21d3eed66aa93e64b449b582");
  });
  it("COLUNAS_COM_PADRAO_REGISTRO continua exportada = a de vendas", () => {
    expect(COLUNAS_COM_PADRAO_REGISTRO).toEqual(["warehouse_id"]);
    for (const f of FAMILIAS_COM_LAYOUT_DE_VENDAS) expect(colunasComPadraoRegistro(f), f).toBe(COLUNAS_COM_PADRAO_REGISTRO);
  });
  it("camposObrigatoriosFaltando de vendas: linhas em `items`, caminho items[i].campo; `itens` não é lido", () => {
    const l = sis("vendas.pedido"); at(l.itens, naColuna(l, "warehouse_id")).obrigatorio = true;
    const doc = { client_id: "c", empresa_id: "e", document_date: "2026-01-01", items: [{ product_id: "p", quantity: "1", unit_price: "2" }], itens: [{}, {}] };
    expect(camposObrigatoriosFaltando("vendas.pedido", l, doc)).toEqual([{ caminho: "items[0].warehouse_id", rotulo: "Local de estoque" }]);
  });
});

describe("C3-D4 layout do sistema de compras = a Central de Compras de hoje", () => {
  it.each([
    [PEDIDO, CABECALHO_DO_PEDIDO, ITENS_DO_PEDIDO],
    [COMPRA, CABECALHO_DA_COMPRA, ITENS_DA_COMPRA]
  ] as const)("%s: válido, ordem de hoje, obrigatório = sistema, tudo no grupo principal", (f, cabecalho, itens) => {
    const l = LAYOUT_DO_SISTEMA(f);
    expect(validarEstruturaLayout(f, l)).toEqual([]);
    expect(l.versaoSchema).toBe(1);
    expect(l.cabecalho.map((x) => x.campo)).toEqual(cabecalho.map((x) => x[0]));
    expect(l.itens.map((x) => x.campo)).toEqual(itens.map((x) => x[0]));
    expect(l.rodape).toEqual([]);
    // nenhum rótulo próprio, nenhum padrão, nenhum grupo: o layout do sistema é a tela de hoje
    expect(l.cabecalho.every((x) => x.editavel && x.rotulo === undefined && x.valorPadrao === undefined && x.grupo === undefined)).toBe(true);
    expect(l.itens.every((x) => x.rotulo === undefined && x.valorPadrao === undefined)).toBe(true);
    const obrig = [...l.cabecalho, ...l.itens].filter((x) => x.obrigatorio).map((x) => x.campo);
    expect(obrig).toEqual(["empresa_id", "fornecedor_id", "data_documento", "produto_id", "quantidade", "valor_unitario"]);
    expect(camposAdicionaisDoCabecalho(l)).toEqual([]);
  });
  it("a ordem das colunas é a que os E2E de compras usam (armazém, produto, quantidade, valor unitário…)", () => {
    expect(LAYOUT_DO_SISTEMA(COMPRA).itens.slice(0, 4).map((x) => x.campo)).toEqual(["armazem_id", "produto_id", "quantidade", "valor_unitario"]);
  });
  it("resolverLayout sem nada → o do sistema de compras", () => {
    expect(resolverLayout(PEDIDO, {})).toEqual({ estrutura: LAYOUT_DO_SISTEMA(PEDIDO), origem: "sistema" });
    const ligado = sis(PEDIDO); at(ligado.cabecalho, 0).rotulo = "Filial";
    expect(resolverLayout(PEDIDO, { ligado, padraoDaFamilia: sis(PEDIDO) })).toEqual({ estrutura: ligado, origem: "ligado" });
  });
});

describe("C3-D5 chave das linhas e coluna de padrão por família", () => {
  it("chaveDosItensDaFamilia", () => {
    for (const f of FAMILIAS_COM_LAYOUT_DE_VENDAS) expect(chaveDosItensDaFamilia(f), f).toBe("items");
    for (const f of FAMILIAS_COM_LAYOUT_DE_COMPRAS) expect(chaveDosItensDaFamilia(f), f).toBe("itens");
    expect(chaveDosItensDaFamilia("compras.solicitacao")).toBe("items");
  });
  it("colunasComPadraoRegistro", () => {
    expect(colunasComPadraoRegistro(PEDIDO)).toEqual(["armazem_id"]);
    expect(colunasComPadraoRegistro(COMPRA)).toEqual(["armazem_id"]);
    // OPERACOES-01 F6a: o orçamento de compra não tem a coluna Local de estoque — nenhuma coluna aceita padrão
    expect(colunasComPadraoRegistro("compras.orcamento")).toEqual([]);
    expect(colunasComPadraoRegistro("compras.solicitacao")).toEqual([]);
    expect(colunasComPadraoRegistro("")).toEqual([]);
    // a coluna de padrão de cada família existe no catálogo dela, e é de referência com cadastro
    for (const f of FAMILIAS_COM_LAYOUT) for (const col of colunasComPadraoRegistro(f)) {
      const c = catalogoDaFamilia(f).find((x) => x.parte === "itens" && x.chave === col);
      expect(c?.tipo, `${f}.${col}`).toBe("referencia");
      expect(c?.referencia, `${f}.${col}`).toEqual({ recurso: "warehouses" });
    }
  });
  it("compras: armazem_id aceita padrão registro; warehouse_id nem existe; outra coluna não aceita", () => {
    for (const f of [PEDIDO, COMPRA]) {
      const l = sis(f); const i = naColuna(l, "armazem_id");
      at(l.itens, i).valorPadrao = reg();
      expect(erros(f, l), f).toEqual([]);
      at(l.itens, i).valorPadrao = { tipo: "literal", valor: "x" };
      expect(erros(f, l), f).toEqual([{ caminho: `itens[${i}].valorPadrao`, mensagem: incompativel("Local de estoque") }]);
      at(l.itens, i).valorPadrao = reg("nao-e-uuid");
      expect(caminhos(f, l), f).toEqual([`itens[${i}].valorPadrao`]);
      const l2 = sis(f); l2.itens.push({ campo: "warehouse_id", obrigatorio: false, valorPadrao: reg() });
      expect(erros(f, l2), f).toEqual([{ caminho: `itens[${l2.itens.length - 1}].campo`, mensagem: 'Coluna "warehouse_id" não existe nos itens.' }]);
      const l3 = sis(f); const p = naColuna(l3, "produto_id");
      at(l3.itens, p).valorPadrao = reg();
      expect(erros(f, l3), f).toEqual([{ caminho: `itens[${p}].valorPadrao`, mensagem: incompativel("Produto") }]);
    }
  });
  it("vendas: armazem_id não existe (cada família com as próprias chaves)", () => {
    const l = sis("vendas.pedido"); l.itens.push({ campo: "armazem_id", obrigatorio: false, valorPadrao: reg() });
    expect(caminhos("vendas.pedido", l)).toEqual([`itens[${l.itens.length - 1}].campo`]);
  });
});

describe("C3-D6 camposObrigatoriosFaltando em compras: caminho itens[i].campo", () => {
  const cheio = () => ({
    empresa_id: "e", fornecedor_id: "f", data_documento: "2026-01-01", observacao: "",
    itens: [{ armazem_id: "a", produto_id: "p", quantidade: "1", valor_unitario: "2" }, { produto_id: "p", quantidade: "1", valor_unitario: "2" }]
  } as Record<string, unknown> & { itens: Record<string, unknown>[] });
  it("documento completo, layout do sistema → nada falta", () => {
    for (const f of [PEDIDO, COMPRA]) expect(camposObrigatoriosFaltando(f, sis(f), cheio()), f).toEqual([]);
  });
  it("cabeçalho do sistema vazio, com rótulo do catálogo", () => {
    const d = cheio(); d.fornecedor_id = ""; d.data_documento = "  ";
    expect(camposObrigatoriosFaltando(COMPRA, sis(), d)).toEqual([
      { caminho: "fornecedor_id", rotulo: "Fornecedor" }, { caminho: "data_documento", rotulo: "Data do documento" }
    ]);
  });
  it("coluna obrigatória do layout vazia na linha 1 → itens[1].armazem_id, com o rótulo do layout", () => {
    const l = sis(); const i = naColuna(l, "armazem_id");
    at(l.itens, i).obrigatorio = true;
    expect(camposObrigatoriosFaltando(COMPRA, l, cheio())).toEqual([{ caminho: "itens[1].armazem_id", rotulo: "Local de estoque" }]);
    at(l.itens, i).rotulo = "Depósito";
    expect(camposObrigatoriosFaltando(COMPRA, l, cheio())).toEqual([{ caminho: "itens[1].armazem_id", rotulo: "Depósito" }]);
    const lote = sis(); at(lote.itens, naColuna(lote, "lote")).obrigatorio = true;
    expect(camposObrigatoriosFaltando(COMPRA, lote, cheio()).map((x) => x.caminho)).toEqual(["itens[0].lote", "itens[1].lote"]);
  });
  it("as linhas vêm de `itens`: `items` (a chave de vendas) não é lido em compras", () => {
    const l = sis(PEDIDO); at(l.itens, naColuna(l, "armazem_id")).obrigatorio = true;
    const d: Record<string, unknown> = { empresa_id: "e", fornecedor_id: "f", data_documento: "2026-01-01", items: [{}, {}] };
    expect(camposObrigatoriosFaltando(PEDIDO, l, d)).toEqual([]);
    const linha = { produto_id: "p", quantidade: "1", valor_unitario: "2" };
    d.itens = [{ ...linha, armazem_id: "a" }, linha];
    expect(camposObrigatoriosFaltando(PEDIDO, l, d)).toEqual([{ caminho: "itens[1].armazem_id", rotulo: "Local de estoque" }]);
  });
  it("linha que não é objeto conta como vazia (cobra); `itens` que não é lista não tem linha", () => {
    const l = sis(PEDIDO); at(l.itens, naColuna(l, "armazem_id")).obrigatorio = true;
    const base = { empresa_id: "e", fornecedor_id: "f", data_documento: "2026-01-01" };
    expect(camposObrigatoriosFaltando(PEDIDO, l, { ...base, itens: [null, "x"] }).map((x) => x.caminho)).toEqual([
      "itens[0].armazem_id", "itens[0].produto_id", "itens[0].quantidade", "itens[0].valor_unitario",
      "itens[1].armazem_id", "itens[1].produto_id", "itens[1].quantidade", "itens[1].valor_unitario"
    ]);
    expect(camposObrigatoriosFaltando(PEDIDO, l, { ...base, itens: "x" })).toEqual([]);
  });
  it("Natureza de despesa e Observação obrigatórias no layout: cobradas sem depender de capacidade (compras não tem `exige`)", () => {
    const l = sis(); at(l.cabecalho, noCabecalho(l, "categoria_financeira_id")).obrigatorio = true; at(l.cabecalho, noCabecalho(l, "observacao")).obrigatorio = true;
    const esperado = [{ caminho: "categoria_financeira_id", rotulo: "Natureza de despesa" }, { caminho: "observacao", rotulo: "Observação" }];
    expect(camposObrigatoriosFaltando(COMPRA, l, cheio())).toEqual(esperado);
    expect(camposObrigatoriosFaltando(COMPRA, l, cheio(), { classificacao: false, condicao: false })).toEqual(esperado);
    expect(camposObrigatoriosFaltando(COMPRA, l, { ...cheio(), categoria_financeira_id: "n", observacao: "ok" })).toEqual([]);
  });
  it("campo que sempre tem valor nunca é cobrado (estrutura gravada fora da regra)", () => {
    const l = sis();
    for (const x of l.cabecalho) if (["frete", "outras_despesas", "desconto", "plano_parcelas"].includes(x.campo)) x.obrigatorio = true;
    for (const x of l.itens) if (["desconto", "desconto_percentual"].includes(x.campo)) x.obrigatorio = true;
    expect(erros(COMPRA, l), "premissa: a estrutura é a proibida").toHaveLength(6);
    expect(camposObrigatoriosFaltando(COMPRA, l, { ...cheio(), frete: null, plano_parcelas: null })).toEqual([]);
  });
  it("campo do layout que não é do catálogo da espécie não é cobrado (numero_nota num layout de pedido)", () => {
    const l = sis(PEDIDO); l.cabecalho.push({ campo: "numero_nota", obrigatorio: true, editavel: true });
    expect(camposObrigatoriosFaltando(PEDIDO, l, cheio())).toEqual([]);
  });
});

describe("C3-D7 validarEstruturaLayout em compras: as regras de vendas, com o catálogo de compras", () => {
  it("padrão registro: Fornecedor, Transportadora, Centro, Condição e Forma aceitam; Natureza de despesa e Empresa recusam", () => {
    for (const campo of ["fornecedor_id", "transportadora_id", "centro_custo_id", "condicao_pagamento_id", "forma_pagamento_id"]) {
      const l = sis(); at(l.cabecalho, noCabecalho(l, campo)).valorPadrao = reg();
      expect(erros(COMPRA, l), campo).toEqual([]);
    }
    const n = sis(); const i = noCabecalho(n, "categoria_financeira_id"); at(n.cabecalho, i).valorPadrao = reg();
    expect(erros(COMPRA, n)).toEqual([{ caminho: `cabecalho[${i}].valorPadrao`, mensagem: incompativel("Natureza de despesa") }]);
    const e = sis(); const j = noCabecalho(e, "empresa_id"); at(e.cabecalho, j).valorPadrao = reg();
    expect(caminhos(COMPRA, e)).toEqual([`cabecalho[${j}].valorPadrao`]);
  });
  it("literal e variável conforme o tipo", () => {
    const ok = sis();
    at(ok.cabecalho, noCabecalho(ok, "empresa_id")).valorPadrao = { tipo: "variavel", variavel: "empresa_selecionada" };
    at(ok.cabecalho, noCabecalho(ok, "data_documento")).valorPadrao = { tipo: "variavel", variavel: "data_atual" };
    at(ok.cabecalho, noCabecalho(ok, "data_entrada")).valorPadrao = { tipo: "literal", valor: "2026-01-31" };
    at(ok.cabecalho, noCabecalho(ok, "serie_nota")).valorPadrao = { tipo: "literal", valor: "1" };
    at(ok.cabecalho, noCabecalho(ok, "frete")).valorPadrao = { tipo: "literal", valor: "0" };
    at(ok.cabecalho, noCabecalho(ok, "observacao")).valorPadrao = { tipo: "literal", valor: "Compra do mês" };
    expect(erros(COMPRA, ok)).toEqual([]);
    const ruim = sis(); const i = noCabecalho(ruim, "data_vencimento");
    at(ruim.cabecalho, i).valorPadrao = { tipo: "variavel", variavel: "empresa_selecionada" };
    expect(erros(COMPRA, ruim)).toEqual([{ caminho: `cabecalho[${i}].valorPadrao`, mensagem: incompativel("Vencimento") }]);
    const plano = sis(); const p = noCabecalho(plano, "plano_parcelas");
    at(plano.cabecalho, p).valorPadrao = { tipo: "literal", valor: "1" };
    expect(caminhos(COMPRA, plano)).toEqual([`cabecalho[${p}].valorPadrao`]);
  });
  it("campo que sempre tem valor não pode ser obrigatório (cabeçalho e itens)", () => {
    for (const [campo, rotulo] of [["frete", "Frete"], ["outras_despesas", "Outras despesas"], ["desconto", "Desconto"], ["plano_parcelas", "Parcelas"]] as const) {
      const l = sis(); const i = noCabecalho(l, campo); at(l.cabecalho, i).obrigatorio = true;
      expect(erros(COMPRA, l), campo).toEqual([{ caminho: `cabecalho[${i}].obrigatorio`, mensagem: mensagemSempreTemValor(rotulo) }]);
    }
    for (const [campo, rotulo] of [["desconto", "Desconto"], ["desconto_percentual", "Desconto %"]] as const) {
      const l = sis(); const i = naColuna(l, campo); at(l.itens, i).obrigatorio = true;
      expect(erros(COMPRA, l), campo).toEqual([{ caminho: `itens[${i}].obrigatorio`, mensagem: mensagemSempreTemValor(rotulo) }]);
    }
  });
  it("campo do sistema fora do layout ou opcional → erro", () => {
    const fora = sis(); fora.cabecalho = fora.cabecalho.filter((x) => x.campo !== "fornecedor_id");
    expect(erros(COMPRA, fora)).toEqual([{ caminho: "cabecalho", mensagem: '"Fornecedor" é obrigatório do sistema: ponha no layout.' }]);
    const opc = sis(); const i = noCabecalho(opc, "fornecedor_id"); at(opc.cabecalho, i).obrigatorio = false;
    expect(caminhos(COMPRA, opc)).toEqual([`cabecalho[${i}].obrigatorio`]);
    const semProduto = sis(); semProduto.itens = semProduto.itens.filter((x) => x.campo !== "produto_id");
    expect(caminhos(COMPRA, semProduto)).toEqual(["itens"]);
    const qtd = sis(); const q = naColuna(qtd, "quantidade"); at(qtd.itens, q).obrigatorio = false;
    expect(caminhos(COMPRA, qtd)).toEqual([`itens[${q}].obrigatorio`]);
    // Natureza e Centro NÃO são do sistema: podem sair do layout (a regra da TOP os força na tela quando gera título)
    const semNatureza = sis(); semNatureza.cabecalho = semNatureza.cabecalho.filter((x) => !["categoria_financeira_id", "centro_custo_id"].includes(x.campo));
    expect(erros(COMPRA, semNatureza)).toEqual([]);
  });
  it("campo só da Compra num layout de Pedido → não existe; chave de vendas em compras → não existe", () => {
    const l = sis(PEDIDO); l.cabecalho.push({ campo: "numero_nota", obrigatorio: false, editavel: true });
    expect(erros(PEDIDO, l)).toEqual([{ caminho: `cabecalho[${l.cabecalho.length - 1}].campo`, mensagem: 'Campo "numero_nota" não existe nesta parte do documento.' }]);
    const l2 = sis(PEDIDO); l2.itens.push({ campo: "lote", obrigatorio: false });
    expect(erros(PEDIDO, l2)).toEqual([{ caminho: `itens[${l2.itens.length - 1}].campo`, mensagem: 'Coluna "lote" não existe nos itens.' }]);
    const l3 = sis(); l3.cabecalho.push({ campo: "client_id", obrigatorio: false, editavel: true });
    expect(caminhos(COMPRA, l3)).toEqual([`cabecalho[${l3.cabecalho.length - 1}].campo`]);
    // e a chave de compras não vale em vendas
    const v = sis("vendas.venda"); v.cabecalho.push({ campo: "fornecedor_id", obrigatorio: false, editavel: true });
    expect(caminhos("vendas.venda", v)).toEqual([`cabecalho[${v.cabecalho.length - 1}].campo`]);
  });
  it("repetido, obrigatório não editável sem padrão", () => {
    const rep = sis(); rep.cabecalho.push({ campo: "observacao", obrigatorio: false, editavel: true });
    expect(erros(COMPRA, rep)).toEqual([{ caminho: `cabecalho[${rep.cabecalho.length - 1}].campo`, mensagem: 'Campo "Observação" repetido no layout.' }]);
    const repCol = sis(); repCol.itens.push({ campo: "armazem_id", obrigatorio: false });
    expect(caminhos(COMPRA, repCol)).toEqual([`itens[${repCol.itens.length - 1}].campo`]);
    // "desconto" existe no documento E nos itens: são campos diferentes, não repetição
    expect(erros(COMPRA, sis())).toEqual([]);
    const trava = sis(); const i = noCabecalho(trava, "observacao"); at(trava.cabecalho, i).obrigatorio = true; at(trava.cabecalho, i).editavel = false;
    expect(caminhos(COMPRA, trava)).toEqual([`cabecalho[${i}].valorPadrao`]);
    at(trava.cabecalho, i).valorPadrao = { tipo: "literal", valor: "Fixa" };
    expect(erros(COMPRA, trava)).toEqual([]);
  });
});

describe("C3-D8 zonas em compras: guardadas e validadas como em vendas", () => {
  it("campo em Dados adicionais (grupo) → válido e listado", () => {
    const l = sis(); for (const x of l.cabecalho) if (["transportadora_id", "observacao"].includes(x.campo)) x.grupo = "adicionais";
    expect(erros(COMPRA, l)).toEqual([]);
    expect(camposAdicionaisDoCabecalho(l)).toEqual(["transportadora_id", "observacao"]);
  });
  it("abas: campo do documento numa aba → válido, inclusive obrigatório do sistema; cobrado pela chave", () => {
    const l = sis();
    const mover = ["fornecedor_id", "observacao"];
    l.cabecalho = l.cabecalho.filter((x) => !mover.includes(x.campo));
    l.rodape = [{ aba: "Outros", campos: [{ campo: "fornecedor_id", obrigatorio: true, editavel: true }, { campo: "observacao", obrigatorio: true, editavel: true }] }];
    expect(erros(COMPRA, l)).toEqual([]);
    const doc = { empresa_id: "e", data_documento: "2026-01-01", itens: [] };
    expect(camposObrigatoriosFaltando(COMPRA, l, doc)).toEqual([{ caminho: "fornecedor_id", rotulo: "Fornecedor" }, { caminho: "observacao", rotulo: "Observação" }]);
    // Parcelas: em compras fica no grid principal hoje — pode ficar no cabeçalho ou numa aba (a restrição é de vendas)
    expect(motivoZonaProibida(COMPRA, "plano_parcelas", { tipo: "principal" })).toBeNull();
    expect(motivoZonaProibida(COMPRA, "plano_parcelas", { tipo: "aba", indice: 0 })).toBeNull();
  });
  it("aba vazia, grupo em campo de aba, coluna fora dos itens → erro", () => {
    const vazia = sis(); vazia.rodape = [{ aba: "Vazia", campos: [] }];
    expect(erros(COMPRA, vazia)).toEqual([{ caminho: "rodape[0]", mensagem: 'A aba "Vazia" está vazia.' }]);
    const grupo = sis(); grupo.cabecalho = grupo.cabecalho.filter((x) => x.campo !== "observacao");
    grupo.rodape = [{ aba: "Notas", campos: [{ campo: "observacao", obrigatorio: false, editavel: true, grupo: "principal" }] }];
    expect(erros(COMPRA, grupo)).toEqual([{ caminho: "rodape[0].campos[0].grupo", mensagem: MENSAGEM_GRUPO_SO_NO_CABECALHO }]);
    const col = sis(); col.rodape = [{ aba: "X", campos: [{ campo: "quantidade", obrigatorio: false, editavel: true }] }];
    expect(erros(COMPRA, col)).toEqual([{ caminho: "rodape[0].campos[0].campo", mensagem: 'Campo "quantidade" não existe nesta parte do documento.' }]);
    const repetido = sis(); repetido.rodape = [{ aba: "X", campos: [{ campo: "observacao", obrigatorio: false, editavel: true }] }];
    expect(erros(COMPRA, repetido)).toEqual([{ caminho: "rodape[0].campos[0].campo", mensagem: 'Campo "Observação" repetido no layout.' }]);
  });
  it("motivoZonaProibida: coluna só nos itens, campo do documento fora dos itens", () => {
    expect(motivoZonaProibida(COMPRA, "armazem_id", { tipo: "itens" })).toBeNull();
    expect(motivoZonaProibida(COMPRA, "armazem_id", { tipo: "principal" })).toBe("Colunas dos itens só podem ficar na grade de itens.");
    expect(motivoZonaProibida(COMPRA, "fornecedor_id", { tipo: "itens" })).toBe("Só colunas dos itens podem ficar na grade de itens.");
    expect(motivoZonaProibida(COMPRA, "fornecedor_id", { tipo: "adicionais" })).toBeNull();
    // "desconto": do documento E coluna — vale nas duas
    expect(motivoZonaProibida(COMPRA, "desconto", { tipo: "principal" })).toBeNull();
    expect(motivoZonaProibida(COMPRA, "desconto", { tipo: "itens" })).toBeNull();
    // lote é só da Compra
    expect(motivoZonaProibida(PEDIDO, "lote", { tipo: "itens" })).toBe("Só colunas dos itens podem ficar na grade de itens.");
  });
});

describe("C3-D9 padrões de cadastro da estrutura de compras", () => {
  it("o recurso sai do catálogo de compras pelo campo; remover tira só os registro", () => {
    const l = sis();
    at(l.cabecalho, noCabecalho(l, "fornecedor_id")).valorPadrao = reg();
    at(l.itens, naColuna(l, "armazem_id")).valorPadrao = reg();
    at(l.cabecalho, noCabecalho(l, "data_documento")).valorPadrao = { tipo: "variavel", variavel: "data_atual" };
    const i = noCabecalho(l, "fornecedor_id"); const j = naColuna(l, "armazem_id");
    expect(padroesRegistroDaEstrutura(COMPRA, l)).toEqual([
      { chave: "fornecedor_id", caminho: `cabecalho[${i}].valorPadrao`, parte: "cabecalho", campo: "fornecedor_id", id: UUID, rotulo: "Fornecedor", referencia: { recurso: "people", filtro: { is_provider: "true" } } },
      { chave: "itens.armazem_id", caminho: `itens[${j}].valorPadrao`, parte: "itens", campo: "armazem_id", id: UUID, rotulo: "Local de estoque", referencia: { recurso: "warehouses" } }
    ]);
    const sem = removerPadroesRegistro(l);
    expect(padroesRegistroDaEstrutura(COMPRA, sem)).toEqual([]);
    expect(at(sem.cabecalho, noCabecalho(sem, "data_documento")).valorPadrao).toEqual({ tipo: "variavel", variavel: "data_atual" });
  });
});
