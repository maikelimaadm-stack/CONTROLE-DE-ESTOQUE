import { describe, expect, it } from "vitest";
import {
  aneisDoComponente, componentes4ConexosGrade, geometriaDosAneis, polygonizarComponente
} from "./polygonizar-grade";
import { zonasDeRasterCondicao } from "./zonas-condicao";
import { gradeBinsDoRaster, isobandasDoRaster } from "./isobandas";
import { codificarValorRaster } from "@agro/domain";

const CANTOS: [[number, number], [number, number], [number, number], [number, number]] = [
  [0, 3], [3, 3], [3, 0], [0, 0]
];
const AREA_GRADE = {
  type: "Polygon" as const,
  coordinates: [[[0, 0], [3, 0], [3, 3], [0, 3], [0, 0]]]
};

describe("SAT-BUNDLE-01B — VEC polygonização", () => {
  it("VEC-01: 3×3 mesma classe → 1 Polygon (não 3 runs)", () => {
    const pixels = new Uint8Array(9).fill(1);
    const zonas = zonasDeRasterCondicao({ pixels, largura: 3, altura: 3, cantos: CANTOS, geometriaArea: AREA_GRADE });
    expect(zonas).toHaveLength(1);
    expect(zonas[0]!.geometry.type).toBe("Polygon");
    const rings = zonas[0]!.geometry.coordinates as number[][][];
    expect(rings.length).toBe(1);
    // Contorno externo: suavização Chaikin aumenta vértices; ainda 1 anel.
    expect(rings[0]!.length).toBeGreaterThanOrEqual(5);
    expect(rings[0]!.length).toBeLessThan(80);
  });

  it("VEC-02: L-shape → 1 feature", () => {
    // ##.
    // #..
    const pixels = Uint8Array.from([1, 1, 0, 1, 0, 0]);
    const g = polygonizarComponente({
      pixels: [0, 1, 3], largura: 3, altura: 2, cantos: CANTOS
    });
    expect(g.type === "Polygon" || g.type === "MultiPolygon").toBe(true);
    const comps = componentes4ConexosGrade({ pixels, largura: 3, altura: 2 });
    expect(comps).toHaveLength(1);
  });

  it("VEC-03: ilha separada → 2 features da mesma classe", () => {
    const pixels = Uint8Array.from([1, 0, 1, 0, 0, 0]);
    const zonas = zonasDeRasterCondicao({ pixels, largura: 3, altura: 2, cantos: CANTOS, geometriaArea: AREA_GRADE });
    expect(zonas.filter((z) => z.codigo === 1)).toHaveLength(2);
  });

  it("VEC-05: duas faixas sem overlap de código no mesmo pixel", () => {
    const pixels = Uint8Array.from([1, 1, 2, 2]);
    const zonas = zonasDeRasterCondicao({ pixels, largura: 2, altura: 2, cantos: CANTOS, geometriaArea: AREA_GRADE });
    expect(new Set(zonas.map((z) => z.codigo)).size).toBe(2);
  });

  it("VEC-06/10: fora/sem leitura não vira geometria; sem runs como produto final", () => {
    const pixels = new Uint8Array(9).fill(0);
    expect(zonasDeRasterCondicao({ pixels, largura: 3, altura: 3, cantos: CANTOS, geometriaArea: AREA_GRADE })).toEqual([]);
    const cheio = new Uint8Array(9).fill(2);
    const z = zonasDeRasterCondicao({ pixels: cheio, largura: 3, altura: 3, cantos: CANTOS, geometriaArea: AREA_GRADE });
    // 1 exterior — não 3 polígonos de run.
    expect(z).toHaveLength(1);
    if (z[0]!.geometry.type === "Polygon") {
      expect((z[0]!.geometry.coordinates as number[][][]).length).toBe(1);
    }
  });

  it("anel fecha e tem área finita", () => {
    const aneis = aneisDoComponente({
      pixels: [0, 1, 2, 3, 4, 5, 6, 7, 8], largura: 3, altura: 3, cantos: CANTOS
    });
    expect(aneis.length).toBeGreaterThanOrEqual(1);
    const g = geometriaDosAneis(aneis);
    expect(g.type).toBe("Polygon");
  });
});

describe("SAT-BUNDLE-01B — isobandas", () => {
  it("bins fixos a partir de NDMI", () => {
    const enc = { scaleMin: -0.5, scaleMax: 0.5 };
    const pixels = Uint8Array.from([
      0,
      codificarValorRaster(-0.2, enc.scaleMin, enc.scaleMax),
      codificarValorRaster(0.1, enc.scaleMin, enc.scaleMax),
      codificarValorRaster(0.35, enc.scaleMin, enc.scaleMax)
    ]);
    const bins = gradeBinsDoRaster({ pixels, indice: "ndmi", tema: "umidade" });
    expect(bins[0]).toBe(0);
    expect(bins[1]).toBeGreaterThan(0);
    expect(bins[3]).toBeGreaterThan(bins[1]!);
  });

  it("isobandas produz features GeoJSON por faixa", () => {
    const enc = { scaleMin: -0.2, scaleMax: 1.0 };
    const pixels = new Uint8Array(9);
    for (let i = 0; i < 9; i++) {
      pixels[i] = codificarValorRaster(0.4, enc.scaleMin, enc.scaleMax);
    }
    const feats = isobandasDoRaster({
      pixels, largura: 3, altura: 3, cantos: CANTOS, indice: "ndre", tema: "vigor", geometriaArea: AREA_GRADE
    });
    expect(feats.length).toBe(1);
    expect(feats[0]!.geometry.type).toBe("Polygon");
  });
});
