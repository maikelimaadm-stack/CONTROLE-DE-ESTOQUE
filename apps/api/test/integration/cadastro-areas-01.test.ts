import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { harness, ids, type Harness } from "./setup.js";
import { USO_BLOQUEADO, USO_INFRAESTRUTURA } from "@agro/domain";

/**
 * CADASTRO-AREAS-01 — API: filtro `uso=receber_animal` (T5) e listagem server-side (T8).
 */
let h: Harness;
let empresa: string;

beforeAll(async () => {
  h = await harness();
  ({ empresa } = await ids(h));
}, 180_000);

afterAll(async () => {
  if (!h) return;
  await h.app.close();
  await h.db.end();
});

async function criarArea(o: { nome: string; land_use: string; status?: string; area_ha?: string; usable?: string }) {
  const r = await h.app.inject({
    method: "POST",
    url: "/api/resources/areas",
    headers: h.headers({ "x-empresa-id": empresa }),
    payload: {
      empresa_id: empresa,
      name: o.nome,
      area_ha: o.area_ha ?? "10",
      usable_area_ha: o.usable ?? o.area_ha ?? "10",
      land_use: o.land_use,
      status: o.status ?? "ativa",
      tenure: "propria",
      is_active: (o.status ?? "ativa") === "ativa"
    }
  });
  expect(r.statusCode, r.body).toBe(201);
  return r.json() as { id: string; name: string; land_use: string; status: string };
}

describe("CADASTRO-AREAS-01 — listagem e seleção por uso", () => {
  it("T5: uso=receber_animal não devolve ambiental, infraestrutura nem inativa", async () => {
    const pecuaria = await criarArea({ nome: "PASTO T5", land_use: "pastagem", status: "ativa" });
    const inativa = await criarArea({ nome: "PASTO INATIVO T5", land_use: "pastagem", status: "inativa" });
    const bloqueadas = [];
    for (const u of [...USO_BLOQUEADO, ...USO_INFRAESTRUTURA]) {
      bloqueadas.push(await criarArea({ nome: `AREA ${u} T5`, land_use: u, status: "ativa", area_ha: "1", usable: "1" }));
    }
    expect(bloqueadas.length).toBeGreaterThanOrEqual(8);

    const r = await h.app.inject({
      method: "GET",
      url: "/api/resources/areas?uso=receber_animal&pageSize=200",
      headers: h.headers({ "x-empresa-id": empresa })
    });
    expect(r.statusCode, r.body).toBe(200);
    const body = r.json() as { items: { id: string; land_use: string; status: string }[]; totals?: { area_ha: string; usable_area_ha: string } };
    const ids = new Set(body.items.map((i) => i.id));
    expect(ids.has(pecuaria.id), "pasto ativo pecuário entra").toBe(true);
    expect(ids.has(inativa.id), "inativa não entra").toBe(false);
    for (const a of bloqueadas) {
      expect(ids.has(a.id), `${a.land_use} não entra em receber_animal`).toBe(false);
    }
    for (const i of body.items) {
      expect(["pastagem", "ilp", "ilpf", "silvipastoril", "confinamento"]).toContain(i.land_use);
      expect(i.status).toBe("ativa");
    }
    expect(body.totals, "rodapé com totais").toBeTruthy();
    expect(Number(body.totals!.area_ha)).toBeGreaterThan(0);
  });

  it("T8: paginação e filtro são server-side — página não carrega a tabela inteira", async () => {
    for (let i = 0; i < 5; i++) {
      await criarArea({ nome: `PAG ${i}`, land_use: "pastagem", area_ha: "2", usable: "2" });
    }
    const p1 = await h.app.inject({
      method: "GET",
      url: "/api/resources/areas?land_use=pastagem&page=1&pageSize=2&sort=code&dir=asc",
      headers: h.headers({ "x-empresa-id": empresa })
    });
    expect(p1.statusCode).toBe(200);
    const b1 = p1.json() as { items: unknown[]; page: number; pageSize: number; total: number };
    expect(b1.items).toHaveLength(2);
    expect(b1.pageSize).toBe(2);
    expect(b1.total).toBeGreaterThan(2);
    expect(b1.items.length).toBeLessThan(b1.total);

    const p2 = await h.app.inject({
      method: "GET",
      url: "/api/resources/areas?land_use=pastagem&page=2&pageSize=2&sort=code&dir=asc",
      headers: h.headers({ "x-empresa-id": empresa })
    });
    const b2 = p2.json() as { items: { id: string }[] };
    expect(b2.items).toHaveLength(2);
    expect(b2.items[0]!.id).not.toBe((b1.items[0] as { id: string }).id);
  });
});
