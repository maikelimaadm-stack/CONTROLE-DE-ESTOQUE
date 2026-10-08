import { describe, expect, it } from "vitest";
import type { Polygon } from "geojson";
import {
  amostrarVazamentoForaDaArea,
  clipGeometriaComArea,
  type GeomPoly
} from "./clip-geometria";
import { apresentarGeometriaZona } from "./polygonizar-grade";
import { zonasDeRasterCondicao } from "./zonas-condicao";

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

describe("clip fail-closed / contenção", () => {
  it("sem área cadastrada → null (nunca devolve footprint sem recorte)", () => {
    expect(clipGeometriaComArea(FOOTPRINT, null)).toBeNull();
    expect(clipGeometriaComArea(FOOTPRINT, undefined)).toBeNull();
    expect(apresentarGeometriaZona(FOOTPRINT, null)).toBeNull();
  });

  it("clip reduz ao polígono cadastrado — vértices amostrados dentro", () => {
    const clipped = clipGeometriaComArea(FOOTPRINT, QUAD);
    expect(clipped).not.toBeNull();
    const { fora, total } = amostrarVazamentoForaDaArea(clipped!, QUAD);
    expect(total).toBeGreaterThan(0);
    expect(fora).toBe(0);
  });

  it("pipeline completo (suavizar→clip) não vaza do triângulo", () => {
    const pixels = new Uint8Array(9).fill(1);
    const zonas = zonasDeRasterCondicao({
      pixels, largura: 3, altura: 3, cantos: CANTOS, geometriaArea: TRIANGULO
    });
    expect(zonas.length).toBeGreaterThanOrEqual(1);
    for (const z of zonas) {
      const { fora, total } = amostrarVazamentoForaDaArea(z.geometry, TRIANGULO);
      expect(total).toBeGreaterThan(0);
      // Tolerância numérica: 0 vértices fora (clip é a autoridade).
      expect(fora).toBe(0);
    }
  });

  it("sem geometriaArea as zonas de raster não saem do pipeline de apresentação", () => {
    const pixels = new Uint8Array(9).fill(1);
    const zonas = zonasDeRasterCondicao({
      pixels, largura: 3, altura: 3, cantos: CANTOS
      // sem geometriaArea → clip fail-closed → zero zonas publicáveis
    });
    expect(zonas).toEqual([]);
  });

  it("MultiPolygon cadastrado: clip só nas partes válidas", () => {
    const multi = {
      type: "MultiPolygon" as const,
      coordinates: [
        [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]],
        [[[2, 2], [3, 2], [3, 3], [2, 3], [2, 2]]]
      ]
    };
    const clipped = clipGeometriaComArea(FOOTPRINT, multi);
    expect(clipped).not.toBeNull();
    const { fora } = amostrarVazamentoForaDaArea(clipped!, multi);
    expect(fora).toBe(0);
  });
});
