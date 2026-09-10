import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { encodeList } from "@agro/shared";
import { harness, type Harness } from "./setup.js";

let h: Harness;
beforeAll(async () => { h = await harness(); }, 120_000);
afterAll(async () => { await h.app.close(); await h.db.end(); });
const j = (r: { body: string }) => JSON.parse(r.body) as Record<string, unknown>;

describe("modelo base: valores distintos e operador de lista", () => {
  it("lista valores distintos de um campo com contagem e rótulo de referência", async () => {
    const r = await h.app.inject({ method: "GET", url: "/api/resources/products/distinct?field=group_id", headers: h.headers() });
    expect(r.statusCode).toBe(200);
    const items = j(r) as unknown as { value: string; label: string; count: number }[];
    expect(items.length).toBeGreaterThan(0);
    expect(items[0]).toMatchObject({ value: expect.any(String), label: expect.any(String), count: expect.any(Number) });
    const bad = await h.app.inject({ method: "GET", url: "/api/resources/products/distinct?field=organization_id", headers: h.headers() });
    expect(bad.statusCode).toBe(422);
  });
  it("filtra pela lista de valores (campo__in) e respeita o isolamento por organização", async () => {
    const d = await h.app.inject({ method: "GET", url: "/api/resources/products/distinct?field=group_id", headers: h.headers() });
    const groups = (j(d) as unknown as { value: string; count: number }[]).slice(0, 2);
    const r = await h.app.inject({ method: "GET", url: `/api/resources/products?group_id__in=${encodeURIComponent(encodeList(groups.map((g) => g.value)))}`, headers: h.headers() });
    expect(r.statusCode).toBe(200);
    expect((j(r) as { total: number }).total).toBe(groups.reduce((n, g) => n + g.count, 0));
    // a soma das contagens dos valores distintos nunca ultrapassa o total de produtos da organização
    const all = await h.app.inject({ method: "GET", url: "/api/resources/products?pageSize=1", headers: h.headers() });
    const sum = (j(d) as unknown as { count: number }[]).reduce((n, g) => n + g.count, 0);
    expect(sum).toBeLessThanOrEqual((j(all) as { total: number }).total);
    // operador (perfil restrito) consulta valores distintos com a mesma permissão de visualização
    expect((await h.app.inject({ method: "GET", url: "/api/resources/products/distinct?field=group_id", headers: h.opHeaders() })).statusCode).toBe(200);
  });
});
