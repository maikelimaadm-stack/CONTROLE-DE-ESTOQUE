import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createPool, type Db } from "@agro/db";
import { harness, TEST_URL, type Harness } from "./setup.js";

/**
 * VENDAS-A4 · cadastro da CONDIÇÃO DE PAGAMENTO (CP-A1, CP-A10) — pelo motor genérico /api/resources/condicoes_pagamento,
 * com a regra do domínio (normalizar + validar) antes do banco e os CHECKs/RLS da 0031 como rede.
 */
let h: Harness; let admin: Db;
type Resp = { statusCode: number; body: string };
const j = (r: Resp) => JSON.parse(r.body);
const hdr = () => h.headers({ "content-type": "application/json" });
const URL_ = "/api/resources/condicoes_pagamento";
const BASE = { parcelas: 1, dias_primeira_parcela: 0, modo: "intervalo" };
const post = (payload: Record<string, unknown>) => h.app.inject({ method: "POST", url: URL_, headers: hdr(), payload: { ...BASE, ...payload } });
const put = (id: string, payload: Record<string, unknown>) => h.app.inject({ method: "PUT", url: `${URL_}/${id}`, headers: hdr(), payload });
const detalhes = (r: Resp) => (j(r).error?.details ?? []) as { path: string; message: string }[];
const linha = async (id: string) => (await admin.query("select * from erp.condicoes_pagamento where id=$1", [id])).rows[0] as Record<string, unknown>;

beforeAll(async () => { h = await harness(); admin = createPool(TEST_URL, { max: 2 }); }, 240_000);
afterAll(async () => { await admin.end(); await h.app.close(); await h.db.end(); });

describe("CP-A1 criar, editar e excluir", () => {
  it("cria com código sequencial gerado, edita e exclui (lógico)", async () => {
    const r = await post({ nome: "30/60/90", parcelas: 3, dias_primeira_parcela: 30, modo: "intervalo", intervalo_dias: 30 });
    expect(r.statusCode, r.body).toBe(201);
    const id = j(r).id as string;
    const l = await linha(id);
    expect(l).toMatchObject({ organization_id: h.demo.orgId, nome: "30/60/90", parcelas: 3, dias_primeira_parcela: 30, modo: "intervalo", intervalo_dias: 30, dia_vencimento: null, entrada: false, entrada_percentual: null, is_active: true, deleted_at: null });
    expect(String(l["code"])).toMatch(/^\d+$/);

    const e = await put(id, { nome: "30/60/90 dias", modo: "dia_fixo", dia_vencimento: 10, entrada: true, entrada_percentual: "20.5" });
    expect(e.statusCode, e.body).toBe(200);
    expect(await linha(id)).toMatchObject({ nome: "30/60/90 dias", modo: "dia_fixo", dia_vencimento: 10, entrada: true, entrada_percentual: "20.50", code: l["code"] });

    const d = await h.app.inject({ method: "DELETE", url: `${URL_}/${id}`, headers: h.headers() });
    expect([200, 204]).toContain(d.statusCode);
    expect((await linha(id))["deleted_at"]).not.toBeNull();
    const g = await h.app.inject({ method: "GET", url: `${URL_}/${id}`, headers: h.headers() });
    expect(g.statusCode).toBe(404);
  });

  it("código no corpo → 422 no campo code (código é gerado)", async () => {
    const r = await post({ code: "999", nome: "Com código" });
    expect(r.statusCode, r.body).toBe(422);
    expect(detalhes(r).map((d) => [d.path].flat().join("."))).toEqual(["code"]);
  });
});

describe("CP-A10 coerência antes do banco, normalização, duplicidade, CHECK e RLS", () => {
  it("dia_fixo sem dia_vencimento → 422 em dia_vencimento", async () => {
    const r = await post({ nome: "Dia fixo sem dia", modo: "dia_fixo" });
    expect(r.statusCode, r.body).toBe(422);
    expect(detalhes(r)).toEqual([expect.objectContaining({ path: "dia_vencimento" })]);
  });

  it("entrada sem percentual → 422 em entrada_percentual; percentual 100 também", async () => {
    const r = await post({ nome: "Entrada sem %", entrada: true });
    expect(r.statusCode, r.body).toBe(422);
    expect(detalhes(r)).toEqual([expect.objectContaining({ path: "entrada_percentual" })]);
    const cem = await post({ nome: "Entrada 100", entrada: true, entrada_percentual: "100" });
    expect(cem.statusCode, cem.body).toBe(422);
    expect(detalhes(cem).map((d) => d.path)).toContain("entrada_percentual");
  });

  it("PUT valida o objeto resultante (linha atual + corpo)", async () => {
    const c = await post({ nome: "Base PUT", modo: "dia_fixo", dia_vencimento: 5 });
    expect(c.statusCode, c.body).toBe(201);
    const r = await put(j(c).id, { dia_vencimento: null });
    expect(r.statusCode, r.body).toBe(422);
    expect(detalhes(r).map((d) => d.path)).toEqual(["dia_vencimento"]);
  });

  it("normalização zera o campo escondido (no POST e quando só o modo/entrada muda no PUT)", async () => {
    const c = await post({ nome: "Normaliza", modo: "intervalo", dia_vencimento: 15, entrada: false, entrada_percentual: "10" });
    expect(c.statusCode, c.body).toBe(201);
    expect(await linha(j(c).id)).toMatchObject({ dia_vencimento: null, entrada_percentual: null });
    const d = await post({ nome: "Normaliza PUT", modo: "dia_fixo", dia_vencimento: 20, entrada: true, entrada_percentual: "30" });
    expect(d.statusCode, d.body).toBe(201);
    const e = await put(j(d).id, { modo: "intervalo", entrada: false });
    expect(e.statusCode, e.body).toBe(200);
    expect(await linha(j(d).id)).toMatchObject({ modo: "intervalo", dia_vencimento: null, entrada: false, entrada_percentual: null });
  });

  it("nome duplicado entre vivas → recusa; excluída libera o nome", async () => {
    const a = await post({ nome: "À Vista" });
    expect(a.statusCode, a.body).toBe(201);
    const b = await post({ nome: "à vista" });
    expect(b.statusCode, b.body).toBe(409);
    await h.app.inject({ method: "DELETE", url: `${URL_}/${j(a).id}`, headers: h.headers() });
    const c = await post({ nome: "À Vista" });
    expect(c.statusCode, c.body).toBe(201);
  });

  it("INSERT direto violando CHECK (fora da API) → recusado pelo banco", async () => {
    const ins = (extra: string, vals: string) => admin.query(`insert into erp.condicoes_pagamento (organization_id, code, nome${extra}) values ($1, $2, $3${vals})`, [h.demo.orgId, `X${Math.random()}`, `Direto ${Math.random()}`]);
    await expect(ins(", modo", ", 'dia_fixo'")).rejects.toMatchObject({ code: "23514", constraint: "chk_condicoes_pagamento_par_dia_fixo" });
    await expect(ins(", entrada", ", true")).rejects.toMatchObject({ code: "23514", constraint: "chk_condicoes_pagamento_par_entrada" });
    await expect(ins(", parcelas", ", 121")).rejects.toMatchObject({ code: "23514", constraint: "chk_condicoes_pagamento_parcelas" });
    await expect(ins(", entrada, entrada_percentual", ", true, 100")).rejects.toMatchObject({ code: "23514", constraint: "chk_condicoes_pagamento_entrada_percentual" });
  });

  it("RLS: outra organização (conexão erp_app) não lê nem escreve; erp_app não tem DELETE", async () => {
    const c = await post({ nome: "Só da demo" });
    expect(c.statusCode, c.body).toBe(201);
    const id = j(c).id as string;
    const outra = (await admin.query<{ id: string }>("insert into erp.organizations (name) values ('Outra A4') returning id")).rows[0]!.id;
    const cli = await h.db.connect();
    try {
      await cli.query("begin");
      await cli.query("select set_config('app.org_id',$1,true)", [outra]);
      expect((await cli.query("select id from erp.condicoes_pagamento where id=$1", [id])).rowCount).toBe(0);
      expect((await cli.query("select id from erp.condicoes_pagamento")).rowCount).toBe(0);
      expect((await cli.query("update erp.condicoes_pagamento set nome='roubado' where id=$1", [id])).rowCount).toBe(0);
      await expect(cli.query("insert into erp.condicoes_pagamento (organization_id, code, nome) values ($1, 'Z1', 'Invasora')", [h.demo.orgId])).rejects.toMatchObject({ code: "42501" });
      await cli.query("rollback");
      await cli.query("begin");
      await cli.query("select set_config('app.org_id',$1,true)", [h.demo.orgId]);
      expect((await cli.query("select id from erp.condicoes_pagamento where id=$1", [id])).rowCount, "premissa: a própria org vê").toBe(1);
      await expect(cli.query("delete from erp.condicoes_pagamento where id=$1", [id])).rejects.toMatchObject({ code: "42501" });
      await cli.query("rollback");
    } finally { cli.release(); }
    expect((await linha(id))["nome"]).toBe("Só da demo");
  });
});
