import { describe, it, expect } from "vitest";
import { autorizacaoPorModulo, AUTORIZACAO_PROPRIETARIO } from "@erp/plataforma";
import { CHAVES_MODULO_EMPRESA } from "@agro/domain";
import { deFarmIdsLegado, paraFarmIdsLegado, validarEscopos } from "../../src/lib/escopo-admin.js";
import { empresaScope, empresaScopeAgregado, type RequestContext } from "../../src/lib/context.js";

/**
 * MATRIZ A — a ponte do formato legado (`farm_ids`) para o modelo canônico por módulo, e a forma da cláusula
 * de escopo que substituiu o array em memória.
 *
 * O que precisa estar provado: (1) a tradução preserva EXATAMENTE a semântica antiga (vazio = todas; lista =
 * aquelas empresas, em todos os módulos); (2) a volta só acontece quando é honesta; (3) a cláusula SQL diz
 * "todas" sem recorte, "nenhuma" com `false` e "selecionadas" com um semi-join — nunca uma lista de uuids
 * montada pela aplicação.
 */
const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

const ctx = (modos: [string, "todas" | "selecionadas"][], farmId: string | null = null, modulo: string | null = "estoque", owner = false): RequestContext => ({
  user: { id: "u", email: "u@x", name: "U" },
  orgId: "org", farmId,
  membership: { orgId: "org", orgName: "demo", roleId: null, isOwner: owner, memberId: "m", escopos: owner ? AUTORIZACAO_PROPRIETARIO : autorizacaoPorModulo(modos) },
  permissions: new Set<string>(),
  moduloEmpresa: modulo
});

describe("ponte do formato legado farm_ids", () => {
  it("lista vazia (convenção legada) vira modo \"todas\" em TODOS os módulos", () => {
    const escopos = deFarmIdsLegado([]);
    expect(escopos.map((e) => e.modulo).sort()).toEqual([...CHAVES_MODULO_EMPRESA].sort());
    expect(escopos.every((e) => e.modo === "todas" && e.empresas.length === 0)).toBe(true);
  });
  it("lista com empresas vira \"selecionadas\" com exatamente aquelas empresas", () => {
    const escopos = deFarmIdsLegado([A, B]);
    expect(escopos.every((e) => e.modo === "selecionadas")).toBe(true);
    expect(escopos[0]!.empresas).toEqual([A, B]);
  });
  it("a volta ao formato legado só acontece quando ele não mente", () => {
    expect(paraFarmIdsLegado(deFarmIdsLegado([]))).toEqual([]);
    expect(paraFarmIdsLegado(deFarmIdsLegado([A, B]))).toEqual([A, B].sort());
    // configuração que o formato antigo não sabe representar → null (nunca uma lista aproximada)
    const misto = deFarmIdsLegado([A]).map((e, i) => (i === 0 ? { ...e, modo: "todas" as const, empresas: [] } : e));
    expect(paraFarmIdsLegado(misto)).toBeNull();
    expect(paraFarmIdsLegado(deFarmIdsLegado([A]).slice(1))).toBeNull(); // módulo faltando = fail-closed, não "todas"
  });
  it("entrada inválida é recusada na borda", () => {
    expect(() => validarEscopos([{ modulo: "inicio", modo: "todas", empresas: [] }])).toThrowError();
    expect(() => validarEscopos([{ modulo: "estoque", modo: "todas", empresas: [A] }])).toThrowError();
    expect(() => validarEscopos([{ modulo: "estoque", modo: "todas", empresas: [] }, { modulo: "estoque", modo: "selecionadas", empresas: [A] }])).toThrowError();
  });
});

describe("forma da cláusula de escopo (substituta do array em memória)", () => {
  it("modo todas: nenhum recorte de autorização", () => {
    expect(empresaScope(ctx([["estoque", "todas"]]), "m", [])).toEqual([]);
  });
  it("proprietário: nenhum recorte, em qualquer módulo", () => {
    expect(empresaScope(ctx([], null, "financeiro", true), "m", [])).toEqual([]);
  });
  it("módulo sem configuração: fail-closed (false), nunca \"todas\"", () => {
    expect(empresaScope(ctx([["financeiro", "todas"]]), "m", [])).toEqual(["false"]);
  });
  it("modo selecionadas: semi-join no banco, sem lista de uuids nos parâmetros", () => {
    const params: unknown[] = [];
    const [clausula] = empresaScope(ctx([["estoque", "selecionadas"]]), "m", params);
    expect(clausula).toContain("exists (select 1 from erp.membro_empresas");
    expect(params).toEqual(["org", "m", "estoque"]);
    expect(params.some((p) => Array.isArray(p))).toBe(false);
  });
  it("empresa selecionada (X-Farm-Id) entra como recorte, somada à autorização", () => {
    const params: unknown[] = [];
    const clausulas = empresaScope(ctx([["estoque", "selecionadas"]], A), "m", params);
    expect(clausulas[0]).toBe("m.farm_id=$1");
    expect(params[0]).toBe(A);
    expect(clausulas).toHaveLength(2);
  });
  it("agregados: o pedido do usuário recorta, a autorização entra por cima", () => {
    const params: unknown[] = [];
    const sql = empresaScopeAgregado(ctx([["estoque", "selecionadas"]]), "e.farm_id", params, [B]);
    expect(sql).toContain("e.farm_id = any($1::uuid[])");
    expect(sql).toContain("erp.membro_empresas");
    expect(params[0]).toEqual([B]);
  });
  it("registro sem empresa é da organização e continua visível quando nullable", () => {
    expect(empresaScope(ctx([["financeiro", "todas"]]), "m", [], { nullable: true })).toEqual(["m.farm_id is null"]);
  });
});
