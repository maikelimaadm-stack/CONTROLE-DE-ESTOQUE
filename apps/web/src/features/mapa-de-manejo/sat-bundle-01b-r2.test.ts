/**
 * SAT-BUNDLE-01B [F2] R2 — distribuição pixel-level, zoom, cache geométrico.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { codificarValorRaster } from "@agro/domain";
import { assinaturaDaGeometria } from "./cache-rasters";
import { geoKey, OPACIDADE_PNG_SOB_ZONAS } from "./camada-zonas-condicao";
import {
  agregarFaixaNaVista, chaveCacheDistribuicao, centroPixelLngLat,
  distribuirFaixasRasterNaArea, FAIXA_SEM_LEITURA_ID, limparCacheDistribuicaoFaixas
} from "./distribuicao-faixas-raster";
import { idsDetalheTematico, deveCarregarDetalheTematico, ZOOM_MINIMO_DETALHE_TEMAS } from "./zoom-detalhe-temas";

const dir = resolve(__dirname);
const mapaSrc = readFileSync(resolve(dir, "mapa-geral.tsx"), "utf8");
const painelSrc = readFileSync(resolve(dir, "painel-tema-pasto.tsx"), "utf8");

const CANTOS: [[number, number], [number, number], [number, number], [number, number]] = [
  [0, 3], [3, 3], [3, 0], [0, 0]
];
const QUADRADO = {
  type: "Polygon" as const,
  coordinates: [[[0, 0], [3, 0], [3, 3], [0, 3], [0, 0]]]
};
const TRIANGULO = {
  type: "Polygon" as const,
  coordinates: [[[0, 0], [1.5, 0], [0, 1.5], [0, 0]]]
};
const COM_HOLE = {
  type: "Polygon" as const,
  coordinates: [
    [[0, 0], [3, 0], [3, 3], [0, 3], [0, 0]],
    [[1, 1], [1, 2], [2, 2], [2, 1], [1, 1]]
  ]
};

const encNdmi = { scaleMin: -0.5, scaleMax: 0.5 };

function px(valor: number) {
  return codificarValorRaster(valor, encNdmi.scaleMin, encNdmi.scaleMax);
}

describe("SAT-BUNDLE-01B R2 — distribuição pixel-level", () => {
  it("R2-01: não atribui area_ha inteira pela média (3 faixas)", () => {
    limparCacheDistribuicaoFaixas();
    // 3×3: três valores em faixas distintas
    const pixels = Uint8Array.from([
      px(-0.2), px(-0.2), px(-0.2),
      px(0.10), px(0.10), px(0.10),
      px(0.35), px(0.35), px(0.35)
    ]);
    const d = distribuirFaixasRasterNaArea({
      pixels, largura: 3, altura: 3, cantos: CANTOS, geometria: QUADRADO,
      tema: "umidade", areaHa: 40, rasterId: "r2-01"
    })!;
    const comPixels = d.faixas.filter((f) => f.pixels > 0);
    expect(comPixels.length).toBeGreaterThanOrEqual(2);
    expect(comPixels.every((f) => f.area_estimada_ha < 40)).toBe(true);
    expect(comPixels.some((f) => f.area_estimada_ha === 40)).toBe(false);
  });

  it("R2-02: soma faixas + sem leitura ≈ area_ha", () => {
    limparCacheDistribuicaoFaixas();
    const pixels = new Uint8Array(9);
    pixels[0] = 0; // nodata
    for (let i = 1; i < 9; i++) pixels[i] = px(0.2);
    const d = distribuirFaixasRasterNaArea({
      pixels, largura: 3, altura: 3, cantos: CANTOS, geometria: QUADRADO,
      tema: "umidade", areaHa: 40, rasterId: "r2-02"
    })!;
    const soma = d.faixas.reduce((s, f) => s + f.area_estimada_ha, 0) + d.sem_leitura.area_estimada_ha;
    expect(Math.abs(soma - 40)).toBeLessThan(1e-6);
  });

  it("R2-03: pixels fora do triângulo não entram", () => {
    limparCacheDistribuicaoFaixas();
    const pixels = new Uint8Array(9).fill(px(0.2));
    const d = distribuirFaixasRasterNaArea({
      pixels, largura: 3, altura: 3, cantos: CANTOS, geometria: TRIANGULO,
      tema: "umidade", areaHa: 40, rasterId: "r2-03"
    })!;
    expect(d.pixels_internos).toBeLessThan(9);
    expect(d.pixels_internos).toBeGreaterThan(0);
  });

  it("R2-04: hole não entra nos hectares internos", () => {
    limparCacheDistribuicaoFaixas();
    const pixels = new Uint8Array(9).fill(px(0.2));
    const cheio = distribuirFaixasRasterNaArea({
      pixels, largura: 3, altura: 3, cantos: CANTOS, geometria: QUADRADO,
      tema: "umidade", areaHa: 40, rasterId: "r2-04a"
    })!;
    const comHole = distribuirFaixasRasterNaArea({
      pixels, largura: 3, altura: 3, cantos: CANTOS, geometria: COM_HOLE,
      tema: "umidade", areaHa: 40, rasterId: "r2-04b"
    })!;
    expect(comHole.pixels_internos).toBeLessThan(cheio.pixels_internos);
  });

  it("R2-05/06: nodata interno = sem leitura; fora não conta", () => {
    limparCacheDistribuicaoFaixas();
    const pixels = new Uint8Array(9).fill(0); // tudo nodata
    const d = distribuirFaixasRasterNaArea({
      pixels, largura: 3, altura: 3, cantos: CANTOS, geometria: TRIANGULO,
      tema: "umidade", areaHa: 40, rasterId: "r2-05"
    })!;
    expect(d.pixels_sem_leitura).toBe(d.pixels_internos);
    expect(d.pixels_validos).toBe(0);
    expect(d.sem_leitura.area_estimada_ha).toBeCloseTo(40, 5);
    // Fora do triângulo: não aumenta internos
    expect(d.pixels_internos).toBeLessThan(9);
  });

  it("R2-11: agregado da vista soma pixels, não média×área", () => {
    limparCacheDistribuicaoFaixas();
    const a = distribuirFaixasRasterNaArea({
      pixels: Uint8Array.from([px(0.2), px(0.2), px(-0.2), px(-0.2)]),
      largura: 2, altura: 2,
      cantos: [[0, 2], [2, 2], [2, 0], [0, 0]],
      geometria: { type: "Polygon", coordinates: [[[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]] },
      tema: "umidade", areaHa: 40, rasterId: "r2-11a"
    })!;
    const faixa = a.faixas.find((f) => f.pixels > 0)!;
    const agg = agregarFaixaNaVista({
      faixaId: faixa.id,
      itens: [
        { areaId: "a", nome: "A", dist: a },
        { areaId: "b", nome: "B", dist: a }
      ]
    });
    expect(agg.ha).toBeCloseTo(faixa.area_estimada_ha * 2, 5);
    expect(agg.ha).toBeLessThan(80);
  });
});

describe("SAT-BUNDLE-01B R2 — popup / zoom / cache / SSOT", () => {
  it("R2-07..10: painel mostra min/max/cobertura/distribuição", () => {
    expect(painelSrc).toContain("painel-tema-min");
    expect(painelSrc).toContain("painel-tema-max");
    expect(painelSrc).toContain("painel-tema-distribuicao");
    expect(painelSrc).toContain("area_estimada_ha");
  });

  it("R2-12..14: zoom distante/próximo/selecionada", () => {
    expect(ZOOM_MINIMO_DETALHE_TEMAS).toBe(13);
    expect(deveCarregarDetalheTematico({ zoom: 11, selecionadaId: null })).toBe(false);
    expect(deveCarregarDetalheTematico({ zoom: 13, selecionadaId: null })).toBe(true);
    expect(deveCarregarDetalheTematico({ zoom: 10, selecionadaId: "x" })).toBe(true);
    expect(idsDetalheTematico({ zoom: 10, selecionadaId: null, idsViewport: ["a", "b"] })).toEqual([]);
    expect(idsDetalheTematico({ zoom: 10, selecionadaId: "a", idsViewport: ["a", "b"] })).toEqual(["a"]);
    expect(idsDetalheTematico({ zoom: 14, selecionadaId: null, idsViewport: ["a", "b"] })).toEqual(["a", "b"]);
    expect(mapaSrc).toContain("ZOOM_MINIMO_DETALHE_TEMAS");
    expect(mapaSrc).toContain("detalheTematico");
  });

  it("R2-15: geoKey usa assinatura — geometrias diferentes com mesmo length JSON diferem", () => {
    const a = { type: "Polygon" as const, coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] };
    const b = { type: "Polygon" as const, coordinates: [[[0, 0], [2, 0], [2, 1], [0, 1], [0, 0]]] };
    // Mesmo número de vértices; coordinates.length serializado pode coincidir em tamanho.
    expect(JSON.stringify(a.coordinates).length).toBe(JSON.stringify(b.coordinates).length);
    expect(geoKey(a)).not.toBe(geoKey(b));
    expect(assinaturaDaGeometria(a)).not.toBe(assinaturaDaGeometria(b));
    expect(chaveCacheDistribuicao({
      rasterId: "1", tema: "umidade", geometriaSha256: geoKey(a),
      largura: 3, altura: 3, areaHa: 40
    })).not.toBe(chaveCacheDistribuicao({
      rasterId: "1", tema: "umidade", geometriaSha256: geoKey(b),
      largura: 3, altura: 3, areaHa: 40
    }));
  });

  it("R2-16: sem análise operacional usa bulk F1", () => {
    expect(mapaSrc).toContain("semAnaliseOperacional");
    expect(mapaSrc).toContain("statusOperacional");
    expect(mapaSrc).toMatch(/idsSemAnalise[\s\S]*modoOperacional[\s\S]*semAnaliseOperacional/);
  });

  it("R2-17/18: zero POST e PNG operacional zero", () => {
    expect(OPACIDADE_PNG_SOB_ZONAS).toBe(0);
    expect(mapaSrc).not.toMatch(/method:\s*[\"']POST[\"']/);
    expect(mapaSrc).toContain("distribuirFaixasRasterNaArea");
  });

  it("centroPixelLngLat no meio da célula", () => {
    const [lng, lat] = centroPixelLngLat(0, 0, 3, 3, CANTOS);
    expect(lng).toBeCloseTo(0.5, 5);
    expect(lat).toBeCloseTo(2.5, 5);
  });

  it("desatualizadas operacional = null (sem do_poligono_atual no bulk)", () => {
    expect(mapaSrc).toMatch(/modoOperacional\) return null/);
    expect(mapaSrc).toContain("do_poligono_atual");
  });
});
