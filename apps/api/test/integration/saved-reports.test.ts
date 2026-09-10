import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { harness, type Harness } from "./setup.js";

let h: Harness;
beforeAll(async () => { h = await harness(); }, 120_000);
afterAll(async () => { await h.app.close(); await h.db.end(); });
const j = (r: { body: string }) => JSON.parse(r.body) as Record<string, unknown>;
const st = (r: { statusCode: number; body: string }, code: number) => { if (r.statusCode !== code) process.stdout.write(`\n[DEBUG ${r.statusCode}] ${r.body.slice(0, 400)}\n`); return r.statusCode; };

describe("relatórios personalizados", () => {
  let id = "";
  it("lista entidades disponíveis com campos", async () => {
    const r = await h.app.inject({ method: "GET", url: "/api/saved-reports/resources", headers: h.headers() });
    const items = j(r) as unknown as { key: string; fields: { name: string }[] }[];
    expect(items.some((x) => x.key === "products" && x.fields.some((f) => f.name === "description"))).toBe(true);
  });
  it("executa ad hoc com agrupamento e totais, e exporta CSV/XLSX", async () => {
    const def = { columns: ["code", "description", "has_lot", "reference_price", "nao_existe"], filters: { description__is_not_empty: "1", zz__eq: "x" }, sort: { key: "code", dir: "asc" }, groupBy: "has_lot", totals: ["reference_price", "description"] };
    const r = await h.app.inject({ method: "POST", url: "/api/saved-reports/run", headers: h.headers(), payload: { resource_key: "products", definition: def } });
    expect(st(r, 200)).toBe(200);
    const res = j(r) as { columns: { key: string }[]; rows: unknown[]; groups: { label: string; rows: unknown[]; totals: Record<string, string> }[]; totals: Record<string, string>; count: number };
    expect(res.columns.map((c) => c.key)).toEqual(["code", "description", "has_lot", "reference_price"]);
    expect(res.count).toBeGreaterThan(0); expect(res.groups.length).toBeGreaterThan(0);
    expect(Object.keys(res.totals)).toEqual(["reference_price"]);
    expect(res.groups.reduce((a, g) => a + g.rows.length, 0)).toBe(res.count);
    const csv = await h.app.inject({ method: "POST", url: "/api/saved-reports/run", headers: h.headers(), payload: { resource_key: "products", definition: def, format: "csv" } });
    expect(csv.statusCode).toBe(200); expect(csv.headers["content-type"]).toContain("text/csv"); expect(csv.body).toContain("Subtotal"); expect(csv.body).toContain("Total");
    const xlsx = await h.app.inject({ method: "POST", url: "/api/saved-reports/run", headers: h.headers(), payload: { resource_key: "products", definition: def, format: "xlsx" } });
    expect(xlsx.statusCode).toBe(200); expect(xlsx.headers["content-type"]).toContain("spreadsheetml");
  });
  it("salva privado, lista, compartilha (com permissão), edita e exclui", async () => {
    const c = await h.app.inject({ method: "POST", url: "/api/saved-reports", headers: h.headers(), payload: { resource_key: "products", name: "Produtos com lote", definition: { columns: ["code", "description"], filters: { has_lot__eq: "true" }, totals: [] } } });
    expect(st(c, 201)).toBe(201); id = (j(c) as { id: string }).id;
    const opList = j(await h.app.inject({ method: "GET", url: "/api/saved-reports?resource=products", headers: h.opHeaders() })) as { items: { id: string }[] } | { error: unknown };
    // operador não tem saved_reports.view → 403 (o perfil de exemplo não inclui a permissão)
    expect("error" in opList || !(opList as { items: { id: string }[] }).items.some((x) => x.id === id)).toBe(true);
    const share = await h.app.inject({ method: "PUT", url: `/api/saved-reports/${id}`, headers: h.headers(), payload: { is_shared: true, name: "Produtos com lote (todos)" } });
    expect(st(share, 200)).toBe(200); expect((j(share) as { is_shared: boolean; name: string }).is_shared).toBe(true);
    const mine = j(await h.app.inject({ method: "GET", url: "/api/saved-reports", headers: h.headers() })) as { items: { id: string; mine: boolean; resource_label: string }[] };
    expect(mine.items.find((x) => x.id === id)).toMatchObject({ mine: true, resource_label: "Produtos" });
    const del = await h.app.inject({ method: "DELETE", url: `/api/saved-reports/${id}`, headers: h.headers() });
    expect(st(del, 200)).toBe(200);
    expect((await h.app.inject({ method: "GET", url: `/api/saved-reports/${id}`, headers: h.headers() })).statusCode).toBe(404);
  });
  it("rejeita definição sem coluna válida e recurso sem permissão de visualização", async () => {
    const bad = await h.app.inject({ method: "POST", url: "/api/saved-reports/run", headers: h.headers(), payload: { resource_key: "products", definition: { columns: ["zz"], filters: {}, totals: [] } } });
    expect(bad.statusCode).toBe(422);
    const denied = await h.app.inject({ method: "POST", url: "/api/saved-reports/run", headers: h.opHeaders(), payload: { resource_key: "bank_accounts", definition: { columns: ["description"], filters: {}, totals: [] } } });
    expect([403, 422]).toContain(denied.statusCode);
  });
});
