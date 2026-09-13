import { describe, it, expect } from "vitest";
import { empresaAutorizada, resolverEscopoEmpresa } from "@erp/plataforma";
import { autorizacaoDeFarmIdsLegado, autorizacaoEmpresas, escopoEmpresa } from "../../src/lib/empresa.js";
import { allowedFarms, farmAllowed, type RequestContext } from "../../src/lib/context.js";

/**
 * MATRIZ A — a ponte legado → contrato explícito.
 *
 * A convenção antiga (`membership.farmIds = []` significa "todas as empresas") existe apenas aqui. O que
 * precisa estar provado: (1) a tradução é exata nos dois sentidos; (2) o resultado continua idêntico ao
 * escopo legado que a API aplica hoje — a correção de contrato não pode afrouxar nem apertar nada.
 */
const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";

const ctx = (farmIds: string[], farmId: string | null = null): RequestContext => ({
  user: { id: "u", email: "u@x", name: "U" },
  orgId: "org", farmId,
  membership: { orgId: "org", orgName: "demo", roleId: null, isOwner: false, farmIds },
  permissions: new Set<string>()
});

describe("tradução da autorização legada", () => {
  it("lista vazia (convenção legada) vira modo \"todas\"", () => {
    expect(autorizacaoDeFarmIdsLegado([])).toEqual({ modo: "todas" });
    expect(autorizacaoEmpresas(ctx([]))).toEqual({ modo: "todas" });
  });
  it("lista com empresas vira modo \"selecionadas\" com exatamente aquelas empresas", () => {
    expect(autorizacaoEmpresas(ctx([A, B]))).toEqual({ modo: "selecionadas", empresaIds: [A, B] });
    expect(empresaAutorizada(autorizacaoEmpresas(ctx([A])), B)).toBe(false);
    expect(empresaAutorizada(autorizacaoEmpresas(ctx([A])), A)).toBe(true);
  });
  it("\"autorizado a nenhuma\" só é expressável no contrato — a ponte nunca o produz por acidente", () => {
    expect(resolverEscopoEmpresa({ modo: "selecionadas", empresaIds: [] }).empresaIds).toEqual([]);
    expect(resolverEscopoEmpresa(autorizacaoDeFarmIdsLegado([])).empresaIds).toBeNull();
  });
});

describe("equivalência com o escopo legado da API", () => {
  const casos: { farmIds: string[]; selecionada: string | null; pedidas?: string[] | string | null }[] = [
    { farmIds: [], selecionada: null },
    { farmIds: [], selecionada: A },
    { farmIds: [A, B], selecionada: null },
    { farmIds: [A, B], selecionada: A },
    { farmIds: [A], selecionada: null, pedidas: [B] },
    { farmIds: [A, B], selecionada: null, pedidas: [B, C] },
    { farmIds: [], selecionada: null, pedidas: `${A},${B}` },
    { farmIds: [A, B], selecionada: B, pedidas: null }
  ];
  /** Réplica local do escopo legado (allowedFarms + recorte da seleção/pedido), como a API o aplica hoje. */
  const legado = (farmIds: string[], selecionada: string | null, pedidas?: string[] | string | null): string[] | null => {
    const req = pedidas == null ? [] : Array.isArray(pedidas) ? pedidas : pedidas.split(",");
    const alvo = req.filter(Boolean).length ? req.filter(Boolean) : selecionada ? [selecionada] : null;
    if (!alvo) return farmIds.length ? farmIds : null;
    return farmIds.length ? alvo.filter((f) => farmIds.includes(f)) : alvo;
  };
  it.each(casos)("mesma saída do escopo legado para %o", (c) => {
    expect(escopoEmpresa(ctx(c.farmIds, c.selecionada), c.pedidas ?? null).empresaIds)
      .toEqual(legado(c.farmIds, c.selecionada, c.pedidas ?? null));
  });
  it("allowedFarms e farmAllowed continuam concordando com o contrato", () => {
    expect(allowedFarms(ctx([]))).toBeNull();
    expect(allowedFarms(ctx([A, B]))).toEqual([A, B]);
    for (const farmIds of [[], [A], [A, B]]) {
      for (const empresa of [A, B, C, null]) {
        expect(farmAllowed(ctx(farmIds), empresa), `${farmIds}/${empresa}`)
          .toBe(empresaAutorizada(autorizacaoEmpresas(ctx(farmIds)), empresa));
      }
    }
  });
});
