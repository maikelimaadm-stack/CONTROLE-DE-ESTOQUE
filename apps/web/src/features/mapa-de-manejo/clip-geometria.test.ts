import { describe, expect, it } from "vitest";
import type { Polygon } from "geojson";
import {
  areaAusenteM2,
  areaM2,
  areaVazamentoM2,
  amostrarVazamentoForaDaArea,
  clipGeometriaComArea,
  clipGeometriaComAreaDetalhe,
  pontoNaArea,
  type GeomPoly
} from "./clip-geometria";
import { apresentarGeometriaZona } from "./polygonizar-grade";
import { zonasDeRasterCondicao } from "./zonas-condicao";

/** Tolerância explícita: ruído numérico Turf em graus → m² (fixtures pequenas). */
const TOL_M2 = 1;

const QUAD: Polygon = {
  type: "Polygon",
  coordinates: [[[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]]
};

const FOOTPRINT: GeomPoly = {
  type: "Polygon",
  coordinates: [[[-1, -1], [3, -1], [3, 3], [-1, 3], [-1, -1]]]
};

const CANTOS: [[number, number], [number, number], [number, number], [number, number]] = [
  [0, 3], [3, 3], [3, 0], [0, 0]
];

const TRIANGULO: Polygon = {
  type: "Polygon",
  coordinates: [[[0, 0], [3, 0], [0, 3], [0, 0]]]
};

/** Côncavo em C (média dos vértices cai fora). */
const CONCAVO: Polygon = {
  type: "Polygon",
  coordinates: [[[0, 0], [3, 0], [3, 1], [1, 1], [1, 2], [3, 2], [3, 3], [0, 3], [0, 0]]]
};

/** Buraco interno. */
const COM_BURACO: Polygon = {
  type: "Polygon",
  coordinates: [
    [[0, 0], [4, 0], [4, 4], [0, 4], [0, 0]],
    [[1, 1], [1, 3], [3, 3], [3, 1], [1, 1]]
  ]
};

/** Corredor estreito contido no footprint (−1..3). */
const CORREDOR: Polygon = {
  type: "Polygon",
  coordinates: [[[0, 0], [2.5, 0], [2.5, 0.15], [0, 0.15], [0, 0]]]
};

describe("clip fail-closed / diferença geométrica", () => {
  it("sem área cadastrada → null / status sem_area", () => {
    expect(clipGeometriaComArea(FOOTPRINT, null)).toBeNull();
    expect(clipGeometriaComAreaDetalhe(FOOTPRINT, null).status).toBe("sem_area");
    expect(apresentarGeometriaZona(FOOTPRINT, null)).toBeNull();
  });

  it("diferença geométrica: área(camada − polígono) ≤ tolerância após clip", () => {
    const clipped = clipGeometriaComArea(FOOTPRINT, QUAD);
    expect(clipped).not.toBeNull();
    expect(areaVazamentoM2(clipped!, QUAD)).toBeLessThanOrEqual(TOL_M2);
    // Footprint bruto vaza muito
    expect(areaVazamentoM2(FOOTPRINT, QUAD)).toBeGreaterThan(TOL_M2);
  });

  it("cobertura: clip do suporte esperado não corta partes válidas indevidamente", () => {
    const suporte = QUAD as GeomPoly;
    const clipped = clipGeometriaComArea(FOOTPRINT, QUAD)!;
    // Contido no cadastro e cobre o suporte (quad) — ausência ~0
    expect(areaAusenteM2(suporte, clipped)).toBeLessThanOrEqual(TOL_M2);
    expect(areaVazamentoM2(clipped, QUAD)).toBeLessThanOrEqual(TOL_M2);
  });

  it("pipeline completo (suavizar→clip) — vazamento m² e vértices", () => {
    const pixels = new Uint8Array(9).fill(1);
    const zonas = zonasDeRasterCondicao({
      pixels, largura: 3, altura: 3, cantos: CANTOS, geometriaArea: TRIANGULO
    });
    expect(zonas.length).toBeGreaterThanOrEqual(1);
    for (const z of zonas) {
      expect(areaVazamentoM2(z.geometry, TRIANGULO)).toBeLessThanOrEqual(TOL_M2);
      const { fora, total } = amostrarVazamentoForaDaArea(z.geometry, TRIANGULO);
      expect(total).toBeGreaterThan(0);
      expect(fora).toBe(0);
    }
  });

  it("sem geometriaArea as zonas não saem do pipeline", () => {
    const pixels = new Uint8Array(9).fill(1);
    const zonas = zonasDeRasterCondicao({
      pixels, largura: 3, altura: 3, cantos: CANTOS
    });
    expect(zonas).toEqual([]);
  });

  it("MultiPolygon + ilha pequena: clip só nas partes válidas, sem vazamento", () => {
    const multi = {
      type: "MultiPolygon" as const,
      coordinates: [
        [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]],
        [[[2.5, 2.5], [2.7, 2.5], [2.7, 2.7], [2.5, 2.7], [2.5, 2.5]]]
      ]
    };
    const clipped = clipGeometriaComArea(FOOTPRINT, multi);
    expect(clipped).not.toBeNull();
    expect(areaVazamentoM2(clipped!, multi)).toBeLessThanOrEqual(TOL_M2);
  });

  it("côncavo: diferença por área (centroide fora não é prova)", () => {
    const clipped = clipGeometriaComArea(FOOTPRINT, CONCAVO)!;
    expect(areaVazamentoM2(clipped, CONCAVO)).toBeLessThanOrEqual(TOL_M2);
  });

  it("buraco interno: clip não preenche o buraco (ausência no anel interno)", () => {
    const clipped = clipGeometriaComArea(FOOTPRINT, COM_BURACO)!;
    expect(areaVazamentoM2(clipped, COM_BURACO)).toBeLessThanOrEqual(TOL_M2);
    // Buraco ~2×2 graus — área do clip deve ser bem menor que o footprint cheio
    expect(areaM2(clipped)).toBeLessThan(areaM2(FOOTPRINT) * 0.9);
    // Ponto no buraco não deve estar na camada
    expect(pontoNaArea(clipped, [2, 2])).toBe(false);
  });

  it("corredor estreito: partes válidas preservadas sem vazamento", () => {
    const clipped = clipGeometriaComArea(FOOTPRINT, CORREDOR)!;
    expect(areaVazamentoM2(clipped, CORREDOR)).toBeLessThanOrEqual(TOL_M2);
    expect(areaAusenteM2(CORREDOR, clipped)).toBeLessThanOrEqual(TOL_M2);
  });

  it("interseção vazia ≠ erro; geometria inválida ≠ vazio", () => {
    const longe: GeomPoly = {
      type: "Polygon",
      coordinates: [[[10, 10], [11, 10], [11, 11], [10, 11], [10, 10]]]
    };
    expect(clipGeometriaComAreaDetalhe(longe, QUAD).status).toBe("vazio");
    const lixo = { type: "Polygon" as const, coordinates: [[[0, 0], [1, 0]]] };
    expect(clipGeometriaComAreaDetalhe(lixo as GeomPoly, QUAD).status).toBe("invalido");
  });

  it("borda diagonal (triângulo): sem vazamento após clip", () => {
    const clipped = clipGeometriaComArea(FOOTPRINT, TRIANGULO)!;
    expect(areaVazamentoM2(clipped, TRIANGULO)).toBeLessThanOrEqual(TOL_M2);
  });
});
