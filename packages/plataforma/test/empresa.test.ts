import { describe, it, expect } from "vitest";
import {
  TODAS_EMPRESAS, exigirEmpresaVisivel, exigirEmpresaPersistivel, descreverEscopoEmpresa,
  empresaAutorizada, empresasPermitidasLegado, resolverEscopoEmpresa, selecionarEmpresaDoLancamento
} from "../src/empresa.js";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";

describe("escopo de empresa (leitura)", () => {
  it("sem autorização restrita e sem pedido: todas as empresas da organização", () => {
    expect(resolverEscopoEmpresa({ autorizadas: [] })).toEqual({ empresaIds: null, recusadas: [], todas: true });
  });
  it("autorização restrita e sem pedido: só as empresas autorizadas", () => {
    expect(resolverEscopoEmpresa({ autorizadas: [A, B] })).toEqual({ empresaIds: [A, B], recusadas: [], todas: true });
  });
  it("empresa selecionada recorta o escopo sem ampliar a autorização", () => {
    expect(resolverEscopoEmpresa({ autorizadas: [A, B] }, { selecionada: A }).empresaIds).toEqual([A]);
  });
  it("pedido fora da autorização NUNCA amplia: resulta em nenhuma linha e registra a recusa", () => {
    const r = resolverEscopoEmpresa({ autorizadas: [A] }, { pedidas: [B, C] });
    expect(r.empresaIds).toEqual([]);
    expect(r.recusadas).toEqual([B, C]);
  });
  it("pedido parcialmente autorizado devolve só a interseção", () => {
    const r = resolverEscopoEmpresa({ autorizadas: [A, B] }, { pedidas: [B, C] });
    expect(r.empresaIds).toEqual([B]);
    expect(r.recusadas).toEqual([C]);
  });
  it("\"todas\" pedido explicitamente ignora a seleção de trabalho", () => {
    expect(resolverEscopoEmpresa({ autorizadas: [A, B] }, { pedidas: TODAS_EMPRESAS, selecionada: A }).empresaIds).toEqual([A, B]);
    expect(resolverEscopoEmpresa({ autorizadas: [] }, { pedidas: TODAS_EMPRESAS, selecionada: A }).empresaIds).toBeNull();
  });
  it("aceita lista separada por vírgula e ignora vazios/duplicados", () => {
    expect(resolverEscopoEmpresa({ autorizadas: [] }, { pedidas: `${A},,${A}, ${B} ` }).empresaIds).toEqual([A, B]);
  });
  it("descreve o escopo resolvido", () => {
    expect(descreverEscopoEmpresa(resolverEscopoEmpresa({ autorizadas: [] }))).toEqual({ tipo: "todas" });
    expect(descreverEscopoEmpresa(resolverEscopoEmpresa({ autorizadas: [A] }))).toEqual({ tipo: "uma", empresaId: A });
    expect(descreverEscopoEmpresa(resolverEscopoEmpresa({ autorizadas: [A, B] }))).toEqual({ tipo: "conjunto", empresaIds: [A, B] });
  });
});

describe("autorização por empresa", () => {
  it("lista vazia autoriza todas; lista restrita bloqueia as demais", () => {
    expect(empresaAutorizada({ autorizadas: [] }, B)).toBe(true);
    expect(empresaAutorizada({ autorizadas: [A] }, A)).toBe(true);
    expect(empresaAutorizada({ autorizadas: [A] }, B)).toBe(false);
  });
  it("registro fora do escopo não existe (NOT_FOUND, nunca 403 que revele existência)", () => {
    expect(() => exigirEmpresaVisivel({ autorizadas: [A] }, B, "Lançamento")).toThrowError(/não encontrado/i);
    expect(() => exigirEmpresaVisivel({ autorizadas: [A] }, A)).not.toThrow();
  });
});

describe("seleção de empresa no lançamento", () => {
  it("uma única empresa efetiva é preenchida automaticamente", () => {
    expect(selecionarEmpresaDoLancamento({ autorizadas: [A] })).toEqual({ situacao: "automatica", empresaId: A });
    expect(selecionarEmpresaDoLancamento({ autorizadas: [] }, { disponiveis: [A] })).toEqual({ situacao: "automatica", empresaId: A });
  });
  it("mais de uma empresa exige seleção explícita", () => {
    expect(selecionarEmpresaDoLancamento({ autorizadas: [A, B] })).toEqual({ situacao: "obrigatoria", opcoes: [A, B] });
  });
  it("empresa pedida fora da autorização é recusada", () => {
    expect(selecionarEmpresaDoLancamento({ autorizadas: [A] }, { pedida: B })).toEqual({ situacao: "recusada", empresaId: B });
  });
  it("\"todas as empresas\" nunca vira empresa de um lançamento", () => {
    expect(() => selecionarEmpresaDoLancamento({ autorizadas: [A, B] }, { pedida: TODAS_EMPRESAS })).toThrowError(/escopo de consulta/i);
    expect(() => exigirEmpresaPersistivel(TODAS_EMPRESAS)).toThrowError(/não pode ser gravado/i);
    expect(() => exigirEmpresaPersistivel(null)).toThrowError(/obrigatória/i);
    expect(exigirEmpresaPersistivel(A)).toBe(A);
  });
});

/**
 * COMPATIBILIDADE: enquanto Empresa é materializada pela infraestrutura legada, o contrato precisa produzir
 * exatamente o mesmo resultado do escopo atual da API. Réplica local da função legada.
 */
function escopoLegado(autorizadas: string[], selecionada: string | null, pedidas?: string[] | string | null): string[] | null {
  const req = pedidas == null ? [] : Array.isArray(pedidas) ? pedidas : pedidas.split(",");
  const alvo = req.filter(Boolean).length ? req.filter(Boolean) : selecionada ? [selecionada] : null;
  if (!alvo) return autorizadas.length ? autorizadas : null;
  return autorizadas.length ? alvo.filter((f) => autorizadas.includes(f)) : alvo;
}

describe("compatibilidade com o escopo legado", () => {
  const casos: { autorizadas: string[]; selecionada: string | null; pedidas?: string[] | string | null }[] = [
    { autorizadas: [], selecionada: null },
    { autorizadas: [], selecionada: A },
    { autorizadas: [A, B], selecionada: null },
    { autorizadas: [A, B], selecionada: A },
    { autorizadas: [A], selecionada: null, pedidas: [B] },
    { autorizadas: [A, B], selecionada: null, pedidas: [B, C] },
    { autorizadas: [], selecionada: null, pedidas: `${A},${B}` },
    { autorizadas: [A, B], selecionada: B, pedidas: null }
  ];
  it.each(casos)("mesma saída do escopo legado para %o", (c) => {
    expect(empresasPermitidasLegado(c.autorizadas, c.selecionada, c.pedidas ?? null))
      .toEqual(escopoLegado(c.autorizadas, c.selecionada, c.pedidas ?? null));
  });
});
