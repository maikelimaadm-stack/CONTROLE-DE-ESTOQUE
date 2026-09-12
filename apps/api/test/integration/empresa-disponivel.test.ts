import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createPool, withTx } from "@agro/db";
import { TODAS_AS_EMPRESAS, empresasSelecionadas, selecionarEmpresaDoLancamento } from "@erp/plataforma";
import { harness, ids, TEST_URL, type Harness } from "./setup.js";
import { empresasDisponiveis, selecionarEmpresaParaLancamento } from "../../src/lib/empresa.js";
import type { ServiceCtx } from "../../src/lib/context.js";

/**
 * EMPRESA DE LANÇAMENTO — A LISTA DE DISPONÍVEIS É DO SERVIDOR.
 *
 * O que precisa estar provado aqui: `modo: "todas"` significa "todas as empresas DESTA organização", e não
 * "qualquer UUID que exista no banco". A prova é empírica: uma empresa de OUTRA organização, uma empresa
 * excluída e uma empresa inativa não entram na lista — e, por isso, são recusadas mesmo no modo "todas".
 */
let h: Harness; let I: Awaited<ReturnType<typeof ids>>;
let orgB = ""; let empresaOutraOrg = ""; let empresaExcluida = ""; let empresaInativa = "";

async function comoServico<T>(fn: (ctx: ServiceCtx) => Promise<T>, farmIds: string[] = []): Promise<T> {
  return withTx(h.db, { orgId: h.demo.orgId, userId: h.demo.adminUserId }, (tx) =>
    fn({
      tx,
      user: { id: h.demo.adminUserId, email: h.demo.adminEmail, name: "Administrador" },
      orgId: h.demo.orgId, farmId: null,
      membership: { orgId: h.demo.orgId, orgName: "demo", roleId: null, isOwner: true, farmIds },
      permissions: new Set<string>()
    }));
}

beforeAll(async () => {
  h = await harness(); I = await ids(h);
  const admin = createPool(TEST_URL, { max: 2 });
  try {
    orgB = (await admin.query<{ id: string }>("insert into erp.organizations(name,slug) values ('[TEST] Org Empresas','orgempresas') returning id")).rows[0]!.id;
    const nova = async (orgId: string, code: number, nome: string, extra = "") =>
      (await admin.query<{ id: string }>(`insert into erp.farms(organization_id,code,name${extra ? ",is_active,deleted_at" : ""}) values ($1,$2,$3${extra}) returning id`, [orgId, code, nome])).rows[0]!.id;
    empresaOutraOrg = await nova(orgB, 901, "Empresa de outra organização");
    empresaExcluida = await nova(h.demo.orgId, 902, "Empresa excluída", ",true,now()");
    empresaInativa = await nova(h.demo.orgId, 903, "Empresa inativa", ",false,null");
  } finally { await admin.end(); }
}, 180_000);
afterAll(async () => { await h.app.close(); await h.db.end(); });

describe("lista de empresas disponíveis (server-side)", () => {
  it("é escopada pelo tenant: empresa de outra organização NUNCA entra", async () => {
    const disponiveis = await comoServico((ctx) => empresasDisponiveis(ctx));
    expect(disponiveis).toContain(I.farm);
    expect(disponiveis).toContain(I.farm2);
    expect(disponiveis, "empresa de outra organização vazou para a lista").not.toContain(empresaOutraOrg);
  });
  it("empresa excluída e empresa inativa não servem para lançamento", async () => {
    const paraLancamento = await comoServico((ctx) => empresasDisponiveis(ctx));
    expect(paraLancamento).not.toContain(empresaExcluida);
    expect(paraLancamento).not.toContain(empresaInativa);
    // consulta histórica pode enxergar a inativa; a excluída, nunca
    const comInativas = await comoServico((ctx) => empresasDisponiveis(ctx, { somenteAtivas: false }));
    expect(comInativas).toContain(empresaInativa);
    expect(comInativas).not.toContain(empresaExcluida);
  });
});

describe("seleção de empresa para lançamento na ponte da API", () => {
  it("MODO \"TODAS\" NÃO É \"QUALQUER UUID\": empresa de outra organização é recusada", async () => {
    const r = await comoServico((ctx) => selecionarEmpresaParaLancamento(ctx, empresaOutraOrg));
    expect(r).toEqual({ situacao: "recusada", empresaId: empresaOutraOrg });
  });
  it("empresa excluída e inativa são recusadas mesmo com autorização a todas", async () => {
    for (const alvo of [empresaExcluida, empresaInativa]) {
      const r = await comoServico((ctx) => selecionarEmpresaParaLancamento(ctx, alvo));
      expect(r, alvo).toEqual({ situacao: "recusada", empresaId: alvo });
    }
  });
  it("empresa real da organização é aceita", async () => {
    const r = await comoServico((ctx) => selecionarEmpresaParaLancamento(ctx, I.farm));
    expect(r).toEqual({ situacao: "escolhida", empresaId: I.farm });
  });
  it("autorização restrita corta a lista disponível; sobrando uma, a seleção é automática", async () => {
    const r = await comoServico((ctx) => selecionarEmpresaParaLancamento(ctx), [I.farm]);
    // o contexto é de owner, então a autorização vale por membership: uma empresa autorizada = automática
    expect(r).toEqual({ situacao: "automatica", empresaId: I.farm });
  });
  it("sem pedido e com mais de uma empresa, a seleção é obrigatória — nunca um padrão inventado", async () => {
    const r = await comoServico((ctx) => selecionarEmpresaParaLancamento(ctx));
    expect(r.situacao).toBe("obrigatoria");
    expect((r as { opcoes: string[] }).opcoes).toEqual(expect.arrayContaining([I.farm, I.farm2]));
    expect((r as { opcoes: string[] }).opcoes).not.toContain(empresaOutraOrg);
  });
  it("a regra pura concorda com a ponte para a mesma lista", async () => {
    const disponiveis = await comoServico((ctx) => empresasDisponiveis(ctx));
    expect(selecionarEmpresaDoLancamento(TODAS_AS_EMPRESAS, { disponiveis, pedida: empresaOutraOrg }))
      .toEqual({ situacao: "recusada", empresaId: empresaOutraOrg });
    expect(selecionarEmpresaDoLancamento(empresasSelecionadas([]), { disponiveis }))
      .toEqual({ situacao: "indisponivel" });
  });
});
