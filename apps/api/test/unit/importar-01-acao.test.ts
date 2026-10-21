import { describe, it, expect } from "vitest";
import { getResource, RESOURCES } from "@agro/domain";
import { ACOES_IMPORTACAO, aceitaAtualizar, cabecalhos, cabecalhosDaAcao, campoDoCodigo, colunasQueMudaram, comTotalDoArquivo, LOTE_DA_IMPORTACAO, recortarPlanilha, resolverCodigo, type PlanilhaLida } from "../../src/lib/importacao.js";

/**
 * IMPORTAR-01 (decisão 317) — as contas PURAS do ATUALIZAR, sem banco: quais cadastros têm a ação, as colunas do modelo
 * de cada ação, o código que resolve (um, nenhum, vários) e as colunas que mudaram.
 */
const def = (key: string) => { const d = getResource(key); if (!d) throw new Error(`cadastro ${key} fora do registry`); return d; };

describe("IMPORTAR-01 · unitário da ação", () => {
  it("U1: as ações são exatamente criar e atualizar (criar primeiro: o padrão)", () => {
    expect([...ACOES_IMPORTACAO]).toEqual(["criar", "atualizar"]);
  });

  it("U2: ATUALIZAR = cadastro importável COM código — os 6, com products; os 4 sem código ficam só com CRIAR; não importável nunca", () => {
    const importaveis = RESOURCES.filter((r) => r.importacao).map((r) => r.key).sort();
    expect(importaveis).toEqual(["addressings", "chart_accounts", "cost_centers", "cultivations", "financial_categories", "measurement_units", "people", "product_groups", "products", "warehouses"]);
    expect(RESOURCES.filter((r) => aceitaAtualizar(r)).map((r) => r.key).sort()).toEqual(["chart_accounts", "cost_centers", "financial_categories", "people", "product_groups", "products"]);
    // cadastro com campo `code` mas SEM importação (ex.: equipamentos) não ganha nada
    const comCodigoSemImportacao = RESOURCES.filter((r) => !r.importacao && r.fields.some((f) => f.name === "code"));
    expect(comCodigoSemImportacao.length, "premissa: existem cadastros com código fora da importação").toBeGreaterThan(0);
    for (const r of comCodigoSemImportacao) expect(campoDoCodigo(r), r.key).toBeNull();
  });

  it("U3: colunas do CRIAR = as de sempre; do ATUALIZAR = o Código primeiro e obrigatório, o resto igual e opcional", () => {
    expect(cabecalhosDaAcao(def("products"), "criar")).toEqual(cabecalhos(def("products")));
    const criar = cabecalhos(def("products"));
    const atualizar = cabecalhosDaAcao(def("products"), "atualizar");
    expect(atualizar[0]).toMatchObject({ chave: "Código", titulo: "Código *" });
    expect(atualizar[0]!.campo).toMatchObject({ name: "code", required: true, readOnly: false });
    expect(atualizar.slice(1).map((c) => c.chave)).toEqual(criar.map((c) => c.chave));
    expect(atualizar.slice(1).every((c) => !c.campo.required && !c.titulo.endsWith("*"))).toBe(true);
    // o registry NÃO foi mutado: o código do produto continua só leitura e a Descrição continua obrigatória
    expect(def("products").fields.find((f) => f.name === "code")).toMatchObject({ readOnly: true });
    expect(def("products").fields.find((f) => f.name === "description")).toMatchObject({ required: true });
    // árvore: o Código já era coluna — continua a primeira, sem duplicar
    const contas = cabecalhosDaAcao(def("chart_accounts"), "atualizar").map((c) => c.titulo);
    expect(contas.filter((t) => t.startsWith("Código"))).toEqual(["Código *"]);
    expect(() => cabecalhosDaAcao(def("measurement_units"), "atualizar")).toThrow(/não tem código/);
  });

  it("U4: o código resolve para UM registro; nenhum = erro (nunca criação); vários = erro (nunca 'o primeiro')", () => {
    const alvos = new Map([["00001", ["a"]], ["00002", ["b", "c"]]]);
    expect(resolverCodigo(alvos, "00001", { labelPlural: "Produtos" })).toEqual({ id: "a" });
    expect(resolverCodigo(alvos, "00002", { labelPlural: "Produtos" })).toEqual({ erro: '"00002" corresponde a 2 registros de Produtos: nada é atualizado sem saber qual.' });
    expect(resolverCodigo(alvos, "1", { labelPlural: "Produtos" })).toEqual({ erro: '"1" não encontrado em Produtos. Atualizar não cria registro: para criar, use "Criar registros".' });
  });

  it("U5: colunas que mudaram — pelo valor GRAVADO antes × depois (o efeito, não o pedido), na ordem do modelo, nulo = ausente", () => {
    const cols = cabecalhosDaAcao(def("products"), "atualizar");
    const antes = { code: "00001", marca: "A", min_stock: "1.0000", fabricante: null, is_active: true };
    expect(colunasQueMudaram(cols, antes, { ...antes })).toEqual([]);
    expect(colunasQueMudaram(cols, antes, { ...antes, marca: "B", fabricante: "F", is_active: false })).toEqual(["Marca", "Fabricante", "Ativo"]);
    // a chave nunca vai no corpo; se a porta a mudasse (regra do cadastro), a prévia mostraria
    expect(colunasQueMudaram(cols, antes, { ...antes, code: "99999" })).toEqual(["Código"]);
    expect(colunasQueMudaram(cols, { ...antes, barcode: undefined }, { ...antes, barcode: null }), "ausente e nulo são o mesmo vazio").toEqual([]);
  });

  it("U6: recorte offset/limit fatia as linhas de dados; lote sugerido 40; linhas_arquivo só quando recortou", () => {
    expect(LOTE_DA_IMPORTACAO).toBe(40);
    const linhas = Array.from({ length: 5 }, (_, i) => ({ n: i + 2, celulas: new Map(), erros: [] as { linha: number; coluna: string | null; mensagem: string }[] }));
    const planilha = { cols: [], presentes: new Set<string>(), linhas, erros: [] } satisfies PlanilhaLida;
    expect(recortarPlanilha(planilha).linhas).toHaveLength(5);
    expect(recortarPlanilha(planilha, 0, 2).linhas.map((l) => l.n)).toEqual([2, 3]);
    expect(recortarPlanilha(planilha, 4, 10).linhas.map((l) => l.n)).toEqual([6]);
    expect(recortarPlanilha(planilha, 10, 10).linhas).toEqual([]);
    const base = { linhas: 2, gravadas: 0, erros: [] as { linha: number; coluna: string | null; mensagem: string }[], simulacao: true as const, modo: "tudo" as const, certas: 2, com_erro: 0, planilha_erros_base64: null };
    expect(comTotalDoArquivo(base, 250, false)).toEqual(base);
    expect(comTotalDoArquivo(base, 250, true)).toEqual({ ...base, linhas_arquivo: 250 });
  });
});
