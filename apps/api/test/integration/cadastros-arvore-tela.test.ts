import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import pg from "pg";
import { createPool, type Db } from "@agro/db";
import { harness, ids, TEST_URL, type Harness } from "./setup.js";

/**
 * CADASTROS Fase 7 — TELA DE ÁRVORE, parte da API (decisão 256).
 *
 * AR-3: os campos de busca desses cadastros mostram o CAMINHO ("1 RECEITAS › 1.01 …") — as opções trazem
 *       `caminho` e `kind`, montados numa consulta em lote — e o recorte `kind=analytic` deixa só analíticos.
 * AR-4: onde o lançamento exige analítico, a API RECUSA o sintético: rateio de título a pagar e de
 *       movimento bancário, e produto (grupo, natureza de custo, centro padrão). A venda já recusava
 *       (sales-classificacao-financeira A1-C2/A1-C3) e continua coberta lá.
 */
let h: Harness; let admin: Db; let I: Awaited<ReturnType<typeof ids>>;
const j = (r: { body: string }) => JSON.parse(r.body);
const get = (url: string) => h.app.inject({ method: "GET", url, headers: h.headers() });
const send = (method: "POST" | "PUT", url: string, payload: Record<string, unknown>) => h.app.inject({ method, url, headers: h.headers({ "content-type": "application/json" }), payload });
const um = async <T extends Record<string, unknown>>(sql: string, p: unknown[] = []) => (await admin.query(sql, [h.demo.orgId, ...p])).rows[0] as T;
let catSintetica: string; let ccSintetico: string;

beforeAll(async () => {
  h = await harness(); admin = createPool(TEST_URL, { max: 2 }); I = await ids(h);
  catSintetica = (await um<{ id: string }>("select id from erp.financial_categories where organization_id=$1 and kind='synthetic' and nature='expense' and deleted_at is null order by code limit 1")).id;
  ccSintetico = (await um<{ id: string }>("insert into erp.cost_centers(organization_id,code,name,kind) values ($1,'9','Agrupador AR','synthetic') returning id")).id;
}, 120_000);
afterAll(async () => { await admin.end(); await h.app.close(); await h.db.end(); });

describe("AR-3 — caminho nas opções e só analíticos", () => {
  it("AR-3a: cada opção de natureza traz o caminho completo 'código nome › código nome', na ordem do código", async () => {
    const r = await get("/api/resources/financial_categories/options");
    expect(r.statusCode, r.body).toBe(200);
    const ops = j(r) as { id: string; label: string; code: string; kind: string; caminho: string }[];
    expect(ops.length).toBeGreaterThan(3);
    const esperado = await admin.query<{ id: string; code: string; name: string; parent_id: string | null }>("select id, code, name, parent_id from erp.financial_categories where organization_id=$1 and deleted_at is null", [h.demo.orgId]);
    const porId = new Map(esperado.rows.map((x) => [x.id, x]));
    const caminho = (id: string): string => { const x = porId.get(id)!; const eu = `${x.code} ${x.name}`; return x.parent_id && porId.has(x.parent_id) ? `${caminho(x.parent_id)} › ${eu}` : eu; };
    for (const o of ops) expect(o.caminho, o.code).toBe(caminho(o.id));
    const comFilho = ops.find((o) => o.code.includes("."));
    expect(comFilho?.caminho, "há opção de 2º nível com o superior no caminho").toMatch(/^\S+ .+ › \S+\.\S+ /);
    expect(ops.map((o) => o.code)).toEqual([...ops.map((o) => o.code)].sort());
  });

  it("AR-3b: kind=analytic deixa só analíticos; a busca acha pelo código e pelo nome", async () => {
    const r = j(await get("/api/resources/financial_categories/options?kind=analytic")) as { kind: string }[];
    expect(r.length).toBeGreaterThan(0);
    expect(r.every((o) => o.kind === "analytic")).toBe(true);
    const cod = await um<{ code: string; name: string }>("select code, name from erp.financial_categories where organization_id=$1 and kind='analytic' and deleted_at is null order by code limit 1");
    const porCodigo = j(await get(`/api/resources/financial_categories/options?search=${encodeURIComponent(cod.code)}`)) as { code: string }[];
    expect(porCodigo.some((o) => o.code === cod.code)).toBe(true);
    const porNome = j(await get(`/api/resources/financial_categories/options?search=${encodeURIComponent(cod.name.slice(0, 6))}`)) as { code: string }[];
    expect(porNome.some((o) => o.code === cod.code)).toBe(true);
  });

  it("AR-3c: o valor gravado é legível pelo caminho (options?id=), inclusive sintético; cadastro sem árvore fica como era", async () => {
    const r = j(await get(`/api/resources/financial_categories/options?id=${catSintetica}&include_inactive=1`)) as { id: string; caminho: string }[];
    expect(r).toHaveLength(1); expect(r[0]!.id).toBe(catSintetica); expect(r[0]!.caminho).toBeTruthy();
    const plano = j(await get("/api/resources/payment_methods/options")) as Record<string, unknown>[];
    expect(plano.length).toBeGreaterThan(0);
    expect(Object.keys(plano[0]!).sort()).toEqual(["code", "id", "label"]);
  });

  it("AR-3e: o caminho é UMA consulta para a página inteira (sem N+1) — contada", async () => {
    const espiao = vi.spyOn(pg.Client.prototype, "query");
    try {
      const r = await get("/api/resources/financial_categories/options");
      const n = (j(r) as unknown[]).length;
      expect(n, "a página tem várias opções (senão a contagem não prova nada)").toBeGreaterThan(3);
      const recursivas = espiao.mock.calls.filter((c) => typeof c[0] === "string" && c[0].includes("with recursive c as")).length;
      expect(recursivas).toBe(1);
    } finally { espiao.mockRestore(); }
  });

  it("AR-3d: nos quatro cadastros o caminho vem (plano de contas usa a descrição; grupos de produtos)", async () => {
    for (const key of ["cost_centers", "chart_accounts", "product_groups"]) {
      const r = await get(`/api/resources/${key}/options`);
      expect(r.statusCode, `${key}: ${r.body}`).toBe(200);
      const ops = j(r) as { code: string | null; caminho: string | null }[];
      expect(ops.length, key).toBeGreaterThan(0);
      for (const o of ops.filter((x) => x.code)) expect(o.caminho, key).toContain(o.code!);
    }
  });
});

describe("AR-4 — sintético recusado onde o lançamento exige analítico", () => {
  const titulo = (cat: string | undefined, cc: string | undefined) => ({ empresa_id: I.empresa, number: `AR4-${Math.random().toString(36).slice(2, 8)}`, person_id: I.provider, amount: "100.00", emission_date: "2026-09-01", due_date: "2026-09-30", note: "AR-4", apportionment: [{ financial_category_id: cat, cost_center_id: cc, percentage: "100" }] });
  const contarTitulos = async () => Number((await um<{ n: string }>("select count(*) n from erp.financial_titles where organization_id=$1 and note='AR-4'")).n);

  it("AR-4a: rateio de título com natureza ou centro sintético → 422 no campo; nada gravado; analítico grava", async () => {
    const antes = await contarTitulos();
    const a = await send("POST", "/api/financial/payables", titulo(catSintetica, I.costCenter));
    expect(a.statusCode, a.body).toBe(422);
    expect(j(a).error.details[0]).toMatchObject({ path: ["apportionment", "financial_category_id"], message: expect.stringMatching(/Natureza sintética/) });
    const b = await send("POST", "/api/financial/payables", titulo(I.category, ccSintetico));
    expect(b.statusCode, b.body).toBe(422);
    expect(j(b).error.details[0]).toMatchObject({ path: ["apportionment", "cost_center_id"] });
    expect(await contarTitulos()).toBe(antes);
    const ok = await send("POST", "/api/financial/payables", titulo(I.category, I.costCenter));
    expect(ok.statusCode, ok.body).toBe(201);
    // editar o rateio para um sintético também é recusado
    const e = await send("PUT", `/api/financial/payables/${j(ok).id}`, { apportionment: [{ financial_category_id: catSintetica, cost_center_id: I.costCenter, percentage: "100" }] });
    expect(e.statusCode, e.body).toBe(422);
    const rateio = await admin.query<{ financial_category_id: string }>("select financial_category_id from erp.title_apportionments where title_id=$1", [j(ok).id]);
    expect(rateio.rows.map((x) => x.financial_category_id)).toEqual([I.category]);
  });

  it("AR-4b: rateio de movimento bancário com natureza sintética → 422", async () => {
    const r = await send("POST", "/api/financial/bank-movements", { empresa_id: I.empresa, bank_account_id: I.bankAccount, movement_date: "2026-09-02", type: "out", amount: "10.00", note: "AR-4b", apportionment: [{ financial_category_id: catSintetica, cost_center_id: I.costCenter, percentage: "100" }] });
    expect(r.statusCode, r.body).toBe(422);
    expect(j(r).error.message).toMatch(/Natureza sintética/);
  });

  it("AR-4c: produto com natureza de custo ou centro padrão sintético → 422 no campo; valor antigo que não muda não é reconferido", async () => {
    const p = await um<{ id: string }>("select id from erp.products where organization_id=$1 and deleted_at is null order by code limit 1");
    const n = await send("PUT", `/api/resources/products/${p.id}`, { financial_category_id: catSintetica });
    expect(n.statusCode, n.body).toBe(422);
    expect(j(n).error.details[0]).toMatchObject({ path: ["financial_category_id"], message: expect.stringMatching(/analítico/) });
    const c = await send("PUT", `/api/resources/products/${p.id}`, { default_cost_center_id: ccSintetico });
    expect(c.statusCode, c.body).toBe(422);
    expect(j(c).error.details[0]).toMatchObject({ path: ["default_cost_center_id"] });
    // dado antigo: sintético gravado fora da API continua editável em outros campos
    await admin.query("update erp.products set default_cost_center_id=$2 where id=$1", [p.id, ccSintetico]);
    const outro = await send("PUT", `/api/resources/products/${p.id}`, { default_cost_center_id: ccSintetico, marca: "AR-4c" });
    expect(outro.statusCode, outro.body).toBe(200);
    const ok = await send("PUT", `/api/resources/products/${p.id}`, { default_cost_center_id: I.costCenter });
    expect(ok.statusCode, ok.body).toBe(200);
  });

  it("AR-4d: grupo sintético no produto continua recusado pela regra própria do grupo (mensagem específica)", async () => {
    const g = await um<{ id: string }>("select id from erp.product_groups where organization_id=$1 and kind='synthetic' and deleted_at is null limit 1").catch(() => null);
    const grupo = g?.id ?? (await um<{ id: string }>("insert into erp.product_groups(organization_id,code,name,kind) values ($1,'98','Grupo AR','synthetic') returning id")).id;
    const p = await um<{ id: string }>("select id from erp.products where organization_id=$1 and deleted_at is null order by code limit 1");
    const r = await send("PUT", `/api/resources/products/${p.id}`, { group_id: grupo });
    expect(r.statusCode, r.body).toBe(422);
    expect(j(r).error.details[0].path).toEqual(["group_id"]);
  });
});
