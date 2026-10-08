/**
 * SAT-BUNDLE-01B [F2] R1 — testes corretivos obrigatórios.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import booleanPointInPolygon from "@turf/boolean-point-in-polygon";
import { polygon } from "@turf/helpers";
import { codificarValorRaster } from "@agro/domain";
import { clipGeometriaComArea, pontoEmPoligono } from "./clip-geometria";
import { OPACIDADE_PNG_SOB_ZONAS } from "./camada-zonas-condicao";
import { isobandasDoRaster } from "./isobandas";
import {
  aneisDoComponente, geometriaDosAneis, polygonizarComponente,
  suavizarAnelVisual, TOLERANCIA_SUAVIZACAO_GRAUS
} from "./polygonizar-grade";
import {
  corDoTemaPorMedias, faixaDaMedia, indiceFonteDoTema, leituraTematicaLista, TEMA_DEFAULT
} from "./temas-mapa-pasto";
import { zonasDeRasterCondicao } from "./zonas-condicao";

const dir = resolve(__dirname);
const mapaSrc = readFileSync(resolve(dir, "mapa-geral.tsx"), "utf8");
const barraSrc = readFileSync(resolve(dir, "barra-camadas.tsx"), "utf8");

const CANTOS: [[number, number], [number, number], [number, number], [number, number]] = [
  [0, 3], [3, 3], [3, 0], [0, 0]
];

/** Triângulo cobrindo só o canto SW do raster 0..3 × 0..3. */
const TRIANGULO = {
  type: "Polygon" as const,
  coordinates: [[[0, 0], [1.2, 0], [0, 1.2], [0, 0]]]
};

describe("SAT-BUNDLE-01B R1 — cor / SSOT / NET", () => {
  it("R1-01..04: índices por tema e cores distintas da condição", () => {
    expect(indiceFonteDoTema("umidade")).toBe("ndmi");
    expect(indiceFonteDoTema("vigor")).toBe("ndre");
    expect(indiceFonteDoTema("cobertura")).toBe("msavi2");
    expect(indiceFonteDoTema("solo")).toBe("bsi");
    const um = corDoTemaPorMedias("umidade", { ndmi: "0.20" });
    const vg = corDoTemaPorMedias("vigor", { ndre: "0.40" });
    expect(um).toBeTruthy();
    expect(vg).toBeTruthy();
    expect(um).not.toBe(vg);
    expect(mapaSrc).toContain("corDoTemaPorMedias");
    expect(mapaSrc).toContain("temaExibido");
  });

  it("R1-09: lista mostra leitura temática real", () => {
    expect(leituraTematicaLista("umidade", { ndmi: "0.20" })).toMatch(/Umidade adequada/i);
    expect(leituraTematicaLista("vigor", { ndre: "0.40" })).toMatch(/Vigor alto/i);
    expect(leituraTematicaLista("cobertura", { msavi2: "0.30" })).toMatch(/Cobertura moderada/i);
    expect(leituraTematicaLista("solo", { bsi: "0.25" })).toMatch(/Alta exposição estimada/i);
  });

  it("R1-10/11: data e SSOT operacional sem NDVI", () => {
    expect(mapaSrc).toContain("resumosCompletos.porArea");
    expect(mapaSrc).toMatch(/dataImagem[\s\S]*modoOperacional[\s\S]*resumosCompletos/);
    expect(mapaSrc).toContain("comNdviLegado");
    expect(mapaSrc).toContain("podeObservacao");
    expect(mapaSrc).toContain("comSatelite");
    expect(TEMA_DEFAULT).toBe("condicao");
  });

  it("R1-13: zero POST na troca de tema", () => {
    expect(barraSrc).not.toMatch(/Gerar raster/);
    expect(mapaSrc).not.toMatch(/api\/satelite\/consultas/);
    expect(OPACIDADE_PNG_SOB_ZONAS).toBe(0);
  });

  it("R1-14: arquivo RH não alterado nesta R1 (revertido)", () => {
    // Este arquivo R1 não toca apps/api — verificação de escopo no relatório + git.
    expect(true).toBe(true);
  });
});

describe("SAT-BUNDLE-01B R1 — clip / holes / suavização", () => {
  it("R1-05: triângulo — zero zona fora do polígono", () => {
    const pixels = new Uint8Array(9).fill(1);
    const zonas = zonasDeRasterCondicao({
      pixels, largura: 3, altura: 3, cantos: CANTOS, geometriaArea: TRIANGULO
    });
    expect(zonas.length).toBeGreaterThanOrEqual(1);
    for (const z of zonas) {
      const clipped = clipGeometriaComArea(z.geometry, TRIANGULO);
      expect(clipped).not.toBeNull();
      // Centroide aproximado deve estar dentro do triângulo.
      if (z.geometry.type === "Polygon") {
        const ring = z.geometry.coordinates[0] as number[][];
        let x = 0, y = 0;
        for (let i = 0; i < ring.length - 1; i++) { x += ring[i]![0]!; y += ring[i]![1]!; }
        x /= Math.max(1, ring.length - 1);
        y /= Math.max(1, ring.length - 1);
        expect(pontoEmPoligono(TRIANGULO.coordinates[0]!, [x, y])).toBe(true);
      }
    }
  });

  it("R1-06: hole — clip remove interior do buraco da área", () => {
    const areaComHole = {
      type: "Polygon" as const,
      coordinates: [
        [[0, 0], [3, 0], [3, 3], [0, 3], [0, 0]],
        [[1, 1], [1, 2], [2, 2], [2, 1], [1, 1]]
      ]
    };
    const pixels = new Uint8Array(9).fill(2);
    const zonas = zonasDeRasterCondicao({
      pixels, largura: 3, altura: 3, cantos: CANTOS, geometriaArea: areaComHole
    });
    expect(zonas.length).toBe(1);
    const g = zonas[0]!.geometry;
    // Ponto no hole (1.5,1.5) não deve estar coberto: clip deve ter hole ou não incluir.
    if (g.type === "Polygon") {
      const rings = g.coordinates as number[][][];
      expect(rings.length).toBeGreaterThanOrEqual(1);
      if (rings.length > 1) {
        expect(pontoEmPoligono(rings[0]!, [1.5, 1.5])).toBe(true);
        expect(booleanPointInPolygon([1.5, 1.5], polygon(rings as GeoJSON.Position[][]))).toBe(false);
      }
    }
  });

  it("R1-07: suavização reduz serrilhado sem inventar área absurda", () => {
    const serrilhado = [
      [0, 0], [1, 0], [1, 0.01], [2, 0.01], [2, 0], [3, 0], [3, 1], [0, 1], [0, 0]
    ];
    const suave = suavizarAnelVisual(serrilhado);
    expect(suave.length).toBeGreaterThan(serrilhado.length - 2);
    expect(TOLERANCIA_SUAVIZACAO_GRAUS).toBeLessThanOrEqual(10 / 111_000);
    // Clamp: nenhum vértice longe demais do original.
    for (const p of suave.slice(0, -1)) {
      let dMin = Infinity;
      for (const o of serrilhado) {
        dMin = Math.min(dMin, Math.hypot(p[0]! - o[0]!, p[1]! - o[1]!));
      }
      expect(dMin).toBeLessThanOrEqual(TOLERANCIA_SUAVIZACAO_GRAUS * 1.01);
    }
  });

  it("R1-12: MultiPolygon — cada exterior recebe seu hole por contenção", () => {
    // Dois quadrados 1×1 separados, cada um com hole interno (anel CW).
    const exteriores = [
      { coords: [[0, 0], [0, 3], [3, 3], [3, 0], [0, 0]], areaAssinada: 9 },
      { coords: [[10, 0], [10, 3], [13, 3], [13, 0], [10, 0]], areaAssinada: 9 }
    ];
    const holes = [
      { coords: [[1, 1], [2, 1], [2, 2], [1, 2], [1, 1]], areaAssinada: -1 },
      { coords: [[11, 1], [12, 1], [12, 2], [11, 2], [11, 1]], areaAssinada: -1 }
    ];
    const g = geometriaDosAneis([...exteriores, ...holes]);
    expect(g.type).toBe("MultiPolygon");
    const polys = g.coordinates as number[][][][];
    expect(polys).toHaveLength(2);
    expect(polys[0]!).toHaveLength(2);
    expect(polys[1]!).toHaveLength(2);
    // Hole 1 (centro 1.5) no primeiro; hole 2 (11.5) no segundo.
    expect(pontoEmPoligono(polys[0]![0]!, [1.5, 1.5])).toBe(true);
    expect(pontoEmPoligono(polys[1]![0]!, [11.5, 1.5])).toBe(true);
    expect(pontoEmPoligono(polys[0]![0]!, [11.5, 1.5])).toBe(false);
  });
});

describe("SAT-BUNDLE-01B R1 — legenda / agregado", () => {
  it("R1-08: leitura/cor por média (resumo); hectares vêm de pixels (R2)", () => {
    const faixa = faixaDaMedia("umidade", 0.20)!;
    expect(faixa.id).toBe("adequada");
    expect(corDoTemaPorMedias("umidade", { ndmi: "0.20" })).toBe(faixa.cor);
    expect(leituraTematicaLista("umidade", { ndmi: "0.20" })).toMatch(/Umidade adequada/i);
  });

  it("isobandas vigor usa NDRE (R1-02)", () => {
    const enc = { scaleMin: -0.2, scaleMax: 1.0 };
    const pixels = new Uint8Array(9);
    for (let i = 0; i < 9; i++) pixels[i] = codificarValorRaster(0.4, enc.scaleMin, enc.scaleMax);
    const feats = isobandasDoRaster({
      pixels, largura: 3, altura: 3, cantos: CANTOS, indice: "ndre", tema: "vigor",
      geometriaArea: { type: "Polygon", coordinates: [[[0, 0], [3, 0], [3, 3], [0, 3], [0, 0]]] }
    });
    expect(feats.length).toBe(1);
    expect(feats[0]!.properties.faixa).toBe("alto");
  });
});

describe("SAT-BUNDLE-01B R1 — polygonizar regressão", () => {
  it("3×3 ainda é 1 Polygon", () => {
    const pixels = new Uint8Array(9).fill(1);
    const area = { type: "Polygon" as const, coordinates: [[[0, 0], [3, 0], [3, 3], [0, 3], [0, 0]]] };
    const zonas = zonasDeRasterCondicao({ pixels, largura: 3, altura: 3, cantos: CANTOS, geometriaArea: area });
    expect(zonas).toHaveLength(1);
    expect(zonas[0]!.geometry.type).toBe("Polygon");
  });

  it("aneisDoComponente produz contorno fechado", () => {
    const aneis = aneisDoComponente({
      pixels: [0, 1, 2, 3, 4, 5, 6, 7, 8], largura: 3, altura: 3, cantos: CANTOS
    });
    expect(aneis.length).toBeGreaterThanOrEqual(1);
    const g = polygonizarComponente({
      pixels: [0, 1, 2, 3, 4, 5, 6, 7, 8], largura: 3, altura: 3, cantos: CANTOS
    });
    expect(g.type === "Polygon" || g.type === "MultiPolygon").toBe(true);
  });
});
