import { describe, it, expect } from "vitest";
import {
  ALL_COMPANIES, assertCompanyVisible, assertPersistableCompanyId, describeCompanyScope,
  isCompanyAuthorized, legacyAllowedCompanies, resolveCompanyScope, selectCompanyForEntry
} from "../src/company.js";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";

describe("escopo de empresa (leitura)", () => {
  it("sem autorização restrita e sem pedido: todas as empresas da organização", () => {
    expect(resolveCompanyScope({ authorized: [] })).toEqual({ companyIds: null, denied: [], isAll: true });
  });
  it("autorização restrita e sem pedido: só as empresas autorizadas", () => {
    expect(resolveCompanyScope({ authorized: [A, B] })).toEqual({ companyIds: [A, B], denied: [], isAll: true });
  });
  it("empresa selecionada recorta o escopo sem ampliar a autorização", () => {
    expect(resolveCompanyScope({ authorized: [A, B] }, { selected: A }).companyIds).toEqual([A]);
  });
  it("pedido fora da autorização NUNCA amplia: resulta em nenhuma linha e registra a recusa", () => {
    const r = resolveCompanyScope({ authorized: [A] }, { requested: [B, C] });
    expect(r.companyIds).toEqual([]);
    expect(r.denied).toEqual([B, C]);
  });
  it("pedido parcialmente autorizado devolve só a interseção", () => {
    const r = resolveCompanyScope({ authorized: [A, B] }, { requested: [B, C] });
    expect(r.companyIds).toEqual([B]);
    expect(r.denied).toEqual([C]);
  });
  it("\"todas\" pedido explicitamente ignora a seleção de trabalho", () => {
    expect(resolveCompanyScope({ authorized: [A, B] }, { requested: ALL_COMPANIES, selected: A }).companyIds).toEqual([A, B]);
    expect(resolveCompanyScope({ authorized: [] }, { requested: ALL_COMPANIES, selected: A }).companyIds).toBeNull();
  });
  it("aceita lista separada por vírgula e ignora vazios/duplicados", () => {
    expect(resolveCompanyScope({ authorized: [] }, { requested: `${A},,${A}, ${B} ` }).companyIds).toEqual([A, B]);
  });
  it("descreve o escopo resolvido", () => {
    expect(describeCompanyScope(resolveCompanyScope({ authorized: [] }))).toEqual({ kind: "all" });
    expect(describeCompanyScope(resolveCompanyScope({ authorized: [A] }))).toEqual({ kind: "one", companyId: A });
    expect(describeCompanyScope(resolveCompanyScope({ authorized: [A, B] }))).toEqual({ kind: "set", companyIds: [A, B] });
  });
});

describe("autorização por empresa", () => {
  it("lista vazia autoriza todas; lista restrita bloqueia as demais", () => {
    expect(isCompanyAuthorized({ authorized: [] }, B)).toBe(true);
    expect(isCompanyAuthorized({ authorized: [A] }, A)).toBe(true);
    expect(isCompanyAuthorized({ authorized: [A] }, B)).toBe(false);
  });
  it("registro fora do escopo não existe (NOT_FOUND, nunca 403 que revele existência)", () => {
    expect(() => assertCompanyVisible({ authorized: [A] }, B, "Lançamento")).toThrowError(/não encontrado/i);
    expect(() => assertCompanyVisible({ authorized: [A] }, A)).not.toThrow();
  });
});

describe("seleção de empresa no lançamento", () => {
  it("uma única empresa efetiva é preenchida automaticamente", () => {
    expect(selectCompanyForEntry({ authorized: [A] })).toEqual({ status: "auto", companyId: A });
    expect(selectCompanyForEntry({ authorized: [] }, { available: [A] })).toEqual({ status: "auto", companyId: A });
  });
  it("mais de uma empresa exige seleção explícita", () => {
    expect(selectCompanyForEntry({ authorized: [A, B] })).toEqual({ status: "required", options: [A, B] });
  });
  it("empresa pedida fora da autorização é recusada", () => {
    expect(selectCompanyForEntry({ authorized: [A] }, { requested: B })).toEqual({ status: "denied", companyId: B });
  });
  it("\"todas as empresas\" nunca vira empresa de um lançamento", () => {
    expect(() => selectCompanyForEntry({ authorized: [A, B] }, { requested: ALL_COMPANIES })).toThrowError(/escopo de consulta/i);
    expect(() => assertPersistableCompanyId(ALL_COMPANIES)).toThrowError(/não pode ser gravado/i);
    expect(() => assertPersistableCompanyId(null)).toThrowError(/obrigatória/i);
    expect(assertPersistableCompanyId(A)).toBe(A);
  });
});

/**
 * COMPATIBILIDADE: enquanto empresa é materializada como fazenda, o contrato precisa produzir exatamente
 * o mesmo resultado de `allowedFarms` (apps/api/src/lib/context.ts). Réplica local da função atual.
 */
function allowedFarmsLegacy(farmIds: string[], selected: string | null, requested?: string[] | string | null): string[] | null {
  const req = requested == null ? [] : Array.isArray(requested) ? requested : requested.split(",");
  const asked = req.filter(Boolean).length ? req.filter(Boolean) : selected ? [selected] : null;
  const allowed = farmIds;
  if (!asked) return allowed.length ? allowed : null;
  return allowed.length ? asked.filter((f) => allowed.includes(f)) : asked;
}

describe("compatibilidade com o escopo de fazenda atual", () => {
  const cases: { authorized: string[]; selected: string | null; requested?: string[] | string | null }[] = [
    { authorized: [], selected: null },
    { authorized: [], selected: A },
    { authorized: [A, B], selected: null },
    { authorized: [A, B], selected: A },
    { authorized: [A], selected: null, requested: [B] },
    { authorized: [A, B], selected: null, requested: [B, C] },
    { authorized: [], selected: null, requested: `${A},${B}` },
    { authorized: [A, B], selected: B, requested: null }
  ];
  it.each(cases)("mesma saída de allowedFarms para %o", (c) => {
    expect(legacyAllowedCompanies(c.authorized, c.selected, c.requested ?? null))
      .toEqual(allowedFarmsLegacy(c.authorized, c.selected, c.requested ?? null));
  });
});
