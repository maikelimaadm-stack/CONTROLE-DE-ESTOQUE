import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { harness, type Harness } from "./setup.js";

/**
 * MAPA-01 (decisão 279) — cadastro de áreas do Mapa de Manejo pela porta genérica /api/resources/mapa_areas.
 * Prova: criação com polígono GeoJSON; recorte por empresa na listagem; 422 para geometria não canônica e
 * cor fora de #RRGGBB (validação no banco/contrato, nunca ignorada); soft delete que some no GET por id (404).
 */

const POLIGONO = { type: "Polygon", coordinates: [[[-55, -15], [-55, -15.01], [-54.99, -15.01], [-54.99, -15], [-55, -15]]] };

describe("MAPA-01 — áreas do Mapa de Manejo", () => {
  let h: Harness;
  beforeAll(async () => { h = await harness(); });
  afterAll(async () => { await h.app.close(); await h.db.end(); });

  const empresaA = () => h.demo.empresaIds[0]!;
  const empresaB = () => h.demo.empresaIds[1]!;
  const hA = (extra: Record<string, string> = {}) => h.headers({ "x-empresa-id": empresaA(), "content-type": "application/json", ...extra });

  async function criar(payload: Record<string, unknown>) {
    return h.app.inject({ method: "POST", url: "/api/resources/mapa_areas", headers: hA(), payload });
  }

  it("cria uma área válida (empresa A) e devolve o polígono salvo", async () => {
    const r = await criar({ empresa_id: empresaA(), nome: "Piquete 1", cor: "#22c55e", tamanho_ha: 12.5, geometria: POLIGONO });
    expect(r.statusCode, r.body).toBe(201);
    const id = (r.json() as { id: string }).id;
    const got = await h.app.inject({ method: "GET", url: `/api/resources/mapa_areas/${id}`, headers: hA() });
    expect(got.statusCode).toBe(200);
    const area = got.json() as { nome: string; cor: string; geometria: { type: string } | null };
    expect(area.nome).toBe("Piquete 1");
    expect(area.cor).toBe("#22c55e");
    expect(area.geometria?.type).toBe("Polygon");
  });

  it("a listagem recorta por empresa (área de A não aparece em B)", async () => {
    const post = await criar({ empresa_id: empresaA(), nome: "Só da A", cor: "#1E88E5", tamanho_ha: 3, geometria: POLIGONO });
    const id = (post.json() as { id: string }).id;
    const listaA = (await h.app.inject({ method: "GET", url: "/api/resources/mapa_areas", headers: h.headers({ "x-empresa-id": empresaA() }) })).json() as { items: { id: string }[] };
    expect(listaA.items.some((x) => x.id === id)).toBe(true);
    const listaB = (await h.app.inject({ method: "GET", url: "/api/resources/mapa_areas", headers: h.headers({ "x-empresa-id": empresaB() }) })).json() as { items: { id: string }[] };
    expect(listaB.items.some((x) => x.id === id)).toBe(false);
  });

  it("recusa (422) geometria não canônica (anel aberto, menos de 4 pontos)", async () => {
    const r = await criar({ empresa_id: empresaA(), nome: "Geometria ruim", geometria: { type: "Polygon", coordinates: [[[0, 0], [0, 1], [1, 1]]] } });
    expect(r.statusCode).toBe(422);
  });

  it("recusa (422) cor fora do formato #RRGGBB", async () => {
    const r = await criar({ empresa_id: empresaA(), nome: "Cor ruim", cor: "vermelho", geometria: POLIGONO });
    expect(r.statusCode).toBe(422);
  });

  it("exclui (soft delete) e some do GET por id (404)", async () => {
    const post = await criar({ empresa_id: empresaA(), nome: "Para excluir", geometria: POLIGONO });
    const id = (post.json() as { id: string }).id;
    const del = await h.app.inject({ method: "DELETE", url: `/api/resources/mapa_areas/${id}`, headers: h.headers({ "x-empresa-id": empresaA() }) });
    expect(del.statusCode, del.body).toBe(200);
    const got = await h.app.inject({ method: "GET", url: `/api/resources/mapa_areas/${id}`, headers: h.headers({ "x-empresa-id": empresaA() }) });
    expect(got.statusCode).toBe(404);
  });
});
