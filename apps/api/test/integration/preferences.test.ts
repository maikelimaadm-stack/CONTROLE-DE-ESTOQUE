import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { harness, type Harness } from "./setup.js";

let h: Harness;
beforeAll(async () => { h = await harness(); }, 120_000);
afterAll(async () => { await h.app.close(); await h.db.end(); });
const j = (r: { body: string }) => JSON.parse(r.body) as Record<string, unknown>;

describe("preferências de tela (modelo base)", () => {
  it("salva, normaliza e lê preferências de listagem do usuário", async () => {
    const put = await h.app.inject({ method: "PUT", url: "/api/preferences/products/list?scope=user", headers: h.headers(), payload: { preferences: { columns: { visible: ["description", "nao_existe"], widths: { description: 220 } }, pageSize: 50, view: { mode: "cards" }, filters: { operators: { description: "starts_with", reference_price: "contains" } } } } });
    expect(put.statusCode).toBe(200);
    const p = j(put) as { revision: number; preferences: { columns: { visible: string[] }; filters: { operators: Record<string, string> }; meta: { revision: number } } };
    expect(p.revision).toBe(1); expect(p.preferences.columns.visible).toEqual(["description"]); expect(p.preferences.filters.operators).toEqual({ description: "starts_with" }); expect(p.preferences.meta.revision).toBe(1);
    const get = await h.app.inject({ method: "GET", url: "/api/preferences/products/list", headers: h.headers() });
    const g = j(get) as { user: { revision: number } | null; org: unknown; canEditOrg: boolean };
    expect(g.user?.revision).toBe(1); expect(g.org).toBeNull(); expect(g.canEditOrg).toBe(true);
  });
  it("detecta conflito de revisão (409) e faz merge por seção (PATCH)", async () => {
    const stale = await h.app.inject({ method: "PUT", url: "/api/preferences/products/list", headers: h.headers(), payload: { preferences: { view: { mode: "table" } }, expectedRevision: 0 } });
    expect(stale.statusCode).toBe(409); expect((j(stale) as { error: { details: { current: { revision: number } } } }).error.details.current.revision).toBe(1);
    const patch = await h.app.inject({ method: "PATCH", url: "/api/preferences/products/list", headers: h.headers(), payload: { section: "view", patch: { cardsPerRow: 4 } } });
    expect(patch.statusCode).toBe(200);
    const p = j(patch) as { revision: number; preferences: { view: { mode: string; cardsPerRow: number }; columns: { visible: string[] } } };
    expect(p.revision).toBe(2); expect(p.preferences.view).toMatchObject({ mode: "cards", cardsPerRow: 4 }); expect(p.preferences.columns.visible).toEqual(["description"]);
  });
  it("padrão da organização exige permissão; operador sem permissão recebe 403 e lê o padrão", async () => {
    const denied = await h.app.inject({ method: "PUT", url: "/api/preferences/products/list?scope=org", headers: h.opHeaders(), payload: { preferences: { pageSize: 10 } } });
    expect(denied.statusCode).toBe(403);
    const ok = await h.app.inject({ method: "PUT", url: "/api/preferences/products/list?scope=org", headers: h.headers(), payload: { preferences: { pageSize: 10 } } });
    expect(ok.statusCode).toBe(200);
    const read = await h.app.inject({ method: "GET", url: "/api/preferences/products/list", headers: h.opHeaders() });
    const g = j(read) as { user: unknown; org: { preferences: { pageSize: number } }; canEditOrg: boolean };
    expect(g.user).toBeNull(); expect(g.org.preferences.pageSize).toBe(10); expect(g.canEditOrg).toBe(false);
    const del = await h.app.inject({ method: "DELETE", url: "/api/preferences/products/list?scope=user", headers: h.headers() });
    expect((j(del) as { deleted: number }).deleted).toBe(1);
  });
  it("valida layout de formulário contra a definição do cadastro", async () => {
    const r = await h.app.inject({ method: "PUT", url: "/api/preferences/products/form", headers: h.headers(), payload: { preferences: { panels: [{ id: "p", label: "Principal" }], cards: [{ id: "c", panelId: "p", colSpan: 6, rows: [{ fieldIds: ["description", "zz", "description"] }] }], hiddenFieldIds: ["description"] } } });
    expect(r.statusCode).toBe(200);
    const l = (j(r) as { preferences: { cards: { id: string; rows: { fieldIds: string[] }[] }[]; hiddenFieldIds: string[] } }).preferences;
    expect(l.cards[0]!.rows[0]!.fieldIds).toEqual(["description"]); expect(l.cards.some((c) => c.id === "outros")).toBe(true); expect(l.hiddenFieldIds).toEqual([]);
    const bad = await h.app.inject({ method: "PUT", url: "/api/preferences/stock.entries/form", headers: h.headers(), payload: { preferences: {} } });
    expect(bad.statusCode).toBe(422);
  });
});

describe("filtros avançados nas listagens declarativas", () => {
  it("aplica operadores campo__operador e rejeita valores inválidos", async () => {
    const all = j(await h.app.inject({ method: "GET", url: "/api/resources/products?pageSize=100", headers: h.headers() })) as { items: { description: string; reference_price: string }[]; total: number };
    expect(all.total).toBeGreaterThan(0);
    const first = all.items[0]!;
    const starts = j(await h.app.inject({ method: "GET", url: `/api/resources/products?description__starts_with=${encodeURIComponent(first.description.slice(0, 4))}`, headers: h.headers() })) as { items: { description: string }[] };
    expect(starts.items.length).toBeGreaterThan(0); expect(starts.items.every((i) => i.description.toLowerCase().startsWith(first.description.slice(0, 4).toLowerCase()))).toBe(true);
    const none = j(await h.app.inject({ method: "GET", url: "/api/resources/products?description__not_contains=" + encodeURIComponent(first.description), headers: h.headers() })) as { items: { description: string }[] };
    expect(none.items.every((i) => i.description !== first.description)).toBe(true);
    const between = j(await h.app.inject({ method: "GET", url: "/api/resources/products?reference_price__between=" + encodeURIComponent("0|999999"), headers: h.headers() })) as { total: number };
    expect(between.total).toBe(all.total);
    const empty = j(await h.app.inject({ method: "GET", url: "/api/resources/products?barcode__is_empty=1", headers: h.headers() })) as { total: number };
    expect(empty.total).toBeGreaterThanOrEqual(0);
    const invalid = await h.app.inject({ method: "GET", url: "/api/resources/products?reference_price__gt=abc", headers: h.headers() });
    expect(invalid.statusCode).toBe(422);
    const ignored = await h.app.inject({ method: "GET", url: "/api/resources/products?description__nope=x", headers: h.headers() });
    expect(ignored.statusCode).toBe(200);
  });
});
