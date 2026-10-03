import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { harness, type Harness } from "./setup.js";

/**
 * CADASTRO-AREAS-02 (decisão 291) — Mapa grava em /api/resources/areas (geometria).
 * Prova: Polygon válido; geometria inválida 422; cor fora de #RRGGBB 422.
 */

const POLIGONO = { type: "Polygon", coordinates: [[[-55, -15], [-55, -15.01], [-54.99, -15.01], [-54.99, -15], [-55, -15]]] };

describe("CADASTRO-AREAS-02 — geometria em areas", () => {
  let h: Harness;
  beforeAll(async () => { h = await harness(); }, 180_000);
  afterAll(async () => { await h.app.close(); await h.db.end(); });

  const empresa = () => h.demo.empresaIds[0]!;
  const hdr = () => h.headers({ "x-empresa-id": empresa(), "content-type": "application/json" });

  async function criar(payload: Record<string, unknown>) {
    return h.app.inject({ method: "POST", url: "/api/resources/areas", headers: hdr(), payload });
  }

  it("cria área com Polygon e devolve geometria", async () => {
    const r = await criar({
      empresa_id: empresa(),
      name: "AREA MAPA 02",
      area_ha: "12.5",
      usable_area_ha: "12.5",
      land_use: "pastagem",
      status: "ativa",
      tenure: "propria",
      color: "#22c55e",
      geometria: POLIGONO
    });
    expect(r.statusCode, r.body).toBe(201);
    const id = (r.json() as { id: string }).id;
    const got = await h.app.inject({ method: "GET", url: `/api/resources/areas/${id}`, headers: hdr() });
    expect(got.statusCode).toBe(200);
    const area = got.json() as { name: string; color: string; geometria: { type: string } | null };
    expect(area.name).toBe("AREA MAPA 02");
    expect(area.color).toBe("#22c55e");
    expect(area.geometria?.type).toBe("Polygon");
  });

  it("recusa (422) geometria não canônica", async () => {
    const r = await criar({
      empresa_id: empresa(),
      name: "GEOM RUIM",
      area_ha: "1",
      usable_area_ha: "1",
      land_use: "pastagem",
      status: "ativa",
      tenure: "propria",
      geometria: { type: "Polygon", coordinates: [[[0, 0], [0, 1], [1, 1]]] }
    });
    expect(r.statusCode).toBe(422);
  });

  it("recusa (422) cor fora de #RRGGBB", async () => {
    const r = await criar({
      empresa_id: empresa(),
      name: "COR RUIM",
      area_ha: "1",
      usable_area_ha: "1",
      land_use: "pastagem",
      status: "ativa",
      tenure: "propria",
      color: "vermelho",
      geometria: POLIGONO
    });
    expect(r.statusCode).toBe(422);
  });
});
