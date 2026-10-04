import { createHash } from "node:crypto";
import { describe, it, expect } from "vitest";
import { COLECAO_SENTINEL2_L2A } from "@agro/domain";
import type { PoligonoGeoJson } from "../../src/lib/satelite/geometria.js";
import { EVALSCRIPT_RASTER_NDVI } from "../../src/lib/satelite/evalscript-raster.js";
import {
  chaveCacheRaster, CRS_RASTER, CRS_RASTER_URL, dataImagemUtc, de3857ParaLngLat, deLngLatPara3857, ESCALA_NDVI_RASTER, FORMATO_RASTER,
  LADO_MAXIMO_RASTER_PX, LADO_MINIMO_RASTER_PX, MARGEM_RASTER_PX, montarCorpoProcesso, planejarGradeRaster, RAIO_3857_M,
  RESOLUCAO_ALVO_M, TIPO_RASTER, VERSAO_EVALSCRIPT_RASTER, type GradeRaster
} from "../../src/lib/satelite/raster.js";

/**
 * SAT-06 (decisão 297) — a GRADE do raster em EPSG:3857, os CANTOS na ordem do MapLibre, a CHAVE DE CACHE e o CORPO da
 * Process API. Tudo puro: nenhum teste fala com a rede.
 */

const quadrado = (lng: number, lat: number, dLng: number, dLat: number): PoligonoGeoJson =>
  ({ type: "Polygon", coordinates: [[[lng, lat], [lng + dLng, lat], [lng + dLng, lat + dLat], [lng, lat + dLat], [lng, lat]]] });
const rad = (g: number) => (g * Math.PI) / 180;
/** lado do pixel em unidades do 3857 (x e y) */
const pixel3857 = (g: GradeRaster) => [(g.bbox3857[2] - g.bbox3857[0]) / g.largura, (g.bbox3857[3] - g.bbox3857[1]) / g.altura] as const;
/** latitude central do polígono (a que a grade usa para o fator 1/cos) */
const latCentral = (p: PoligonoGeoJson) => { const lats = p.coordinates[0]!.map(([, lat]) => lat); return (Math.min(...lats) + Math.max(...lats)) / 2; };
/** caixa do anel externo em 3857 */
const caixa3857 = (p: PoligonoGeoJson) => {
  const xy = p.coordinates[0]!.map(([lng, lat]) => deLngLatPara3857(lng, lat));
  return { minx: Math.min(...xy.map((c) => c[0])), maxx: Math.max(...xy.map((c) => c[0])), miny: Math.min(...xy.map((c) => c[1])), maxy: Math.max(...xy.map((c) => c[1])) };
};

describe("SAT-06 EPSG:3857 esférico (raio 6 378 137 m)", () => {
  it("valores conhecidos: origem, antimeridiano e o limite de latitude do Web Mercator", () => {
    expect(RAIO_3857_M).toBe(6_378_137);
    const [x0, y0] = deLngLatPara3857(0, 0);
    expect(x0).toBe(0);
    expect(Math.abs(y0)).toBeLessThan(1e-6); // tan(π/4) em ponto flutuante não é exatamente 1
    const [x180] = deLngLatPara3857(180, 0);
    expect(x180).toBeCloseTo(20_037_508.342789244, 6);
    const [, yMax] = deLngLatPara3857(0, 85.0511287798066);
    expect(yMax).toBeCloseTo(20_037_508.342789244, 3);
    // um ponto do Mato Grosso, conferido pela fórmula fechada
    const [x, y] = deLngLatPara3857(-56.1, -15.6);
    expect(x).toBeCloseTo((6_378_137 * -56.1 * Math.PI) / 180, 6);
    expect(y).toBeCloseTo(6_378_137 * Math.log(Math.tan(Math.PI / 4 + rad(-15.6) / 2)), 6);
  });
  it("ida e volta lng/lat → 3857 → lng/lat em vários pontos (erro < 1e-9 grau)", () => {
    for (const [lng, lat] of [[-56.1, -15.6], [-47.93, -15.78], [-52, -30], [-60.0123, 2.5], [0, 0], [179.9, 84.9], [-179.9, -84.9]] as const) {
      const [x, y] = deLngLatPara3857(lng, lat);
      const [lng2, lat2] = de3857ParaLngLat(x, y);
      expect(Math.abs(lng2 - lng)).toBeLessThan(1e-9);
      expect(Math.abs(lat2 - lat)).toBeLessThan(1e-9);
    }
  });
  it("fora da faixa do 3857 (polo, NaN, longitude > 180) LANÇA em vez de devolver infinito", () => {
    expect(() => deLngLatPara3857(0, 90)).toThrow(RangeError);
    expect(() => deLngLatPara3857(0, -86)).toThrow(RangeError);
    expect(() => deLngLatPara3857(181, 0)).toThrow(RangeError);
    expect(() => deLngLatPara3857(Number.NaN, 0)).toThrow(RangeError);
    expect(() => de3857ParaLngLat(Number.POSITIVE_INFINITY, 0)).toThrow(RangeError);
  });
});

describe("SAT-06 planejarGradeRaster — pixel de ~10 m NO TERRENO, margem, teto e piso", () => {
  it("constantes do contrato", () => {
    expect([RESOLUCAO_ALVO_M, LADO_MAXIMO_RASTER_PX, LADO_MINIMO_RASTER_PX, MARGEM_RASTER_PX]).toEqual([10, 2500, 32, 2]);
    expect([TIPO_RASTER, FORMATO_RASTER, CRS_RASTER, VERSAO_EVALSCRIPT_RASTER]).toEqual(["valores", "image/png", "EPSG:3857", "ndvi-valores-v1"]);
    expect(ESCALA_NDVI_RASTER).toEqual({ min: -0.2, max: 1.0 });
  });
  it("em latitudes diferentes o pixel tem 10 m no terreno: em 3857 ele mede 10 / cos(lat central), quadrado", () => {
    for (const lat of [0, -15.6, -30, -33.5, 5]) {
      const p = quadrado(-52, lat, 0.01, 0.01);
      const g = planejarGradeRaster(p);
      const [px, py] = pixel3857(g);
      const esperado = RESOLUCAO_ALVO_M / Math.cos(rad(latCentral(p)));
      expect(g.resolucaoM).toBe(10);
      expect(g.reduzida).toBe(false);
      expect(Math.abs(px - esperado) / esperado).toBeLessThan(1e-9);
      expect(Math.abs(py - px) / px).toBeLessThan(1e-9); // pixel quadrado em 3857
      // de volta ao terreno: lado do pixel × cos(lat central) = 10 m
      expect(px * Math.cos(rad(latCentral(p)))).toBeCloseTo(10, 6);
    }
    // a 30° S o pixel em 3857 é maior que a 0°: o fator 1/cos foi aplicado (sem ele os dois seriam iguais)
    const g0 = planejarGradeRaster(quadrado(-52, 0, 0.01, 0.01)), g30 = planejarGradeRaster(quadrado(-52, -30, 0.01, 0.01));
    expect(pixel3857(g30)[0] / pixel3857(g0)[0]).toBeCloseTo(1 / Math.cos(rad(-29.995)), 4);
  });
  it("exemplo numérico: ~1 km a 15,6° S → 104 × 105 px a 10 m (pixel de 10,382 m em 3857)", () => {
    const g = planejarGradeRaster(quadrado(-56.1, -15.6, 0.00932, 0.00904));
    expect([g.largura, g.altura, g.resolucaoM, g.reduzida]).toEqual([104, 105, 10, false]);
    expect(pixel3857(g)[0]).toBeCloseTo(10.3822, 3);
  });
  it("MARGEM: a caixa do polígono fica dentro da grade com pelo menos 2 pixels livres de cada lado (e menos de 3)", () => {
    for (const p of [quadrado(-56.1, -15.6, 0.00932, 0.00904), quadrado(-52, -30, 0.013, 0.007), quadrado(-47.9, -15.8, 0.0031, 0.0047)]) {
      const g = planejarGradeRaster(p);
      const [px, py] = pixel3857(g);
      const c = caixa3857(p);
      const folgas = [(c.minx - g.bbox3857[0]) / px, (g.bbox3857[2] - c.maxx) / px, (c.miny - g.bbox3857[1]) / py, (g.bbox3857[3] - c.maxy) / py];
      for (const f of folgas) { expect(f).toBeGreaterThanOrEqual(MARGEM_RASTER_PX - 1e-6); expect(f).toBeLessThan(MARGEM_RASTER_PX + 1); }
      // centrada: folga esquerda = direita, inferior = superior
      expect(folgas[0]).toBeCloseTo(folgas[1]!, 6);
      expect(folgas[2]).toBeCloseTo(folgas[3]!, 6);
    }
  });
  it("área GRANDE: a resolução sobe (metro inteiro, a MENOR que cabe), maior lado ≤ 2500, reduzida = true", () => {
    const p = quadrado(-56.5, -15.9, 0.4, 0.4); // ~43 × 44 km
    const g = planejarGradeRaster(p);
    expect(g.reduzida).toBe(true);
    expect(g.resolucaoM).toBe(18);
    expect(Math.max(g.largura, g.altura)).toBeLessThanOrEqual(LADO_MAXIMO_RASTER_PX);
    expect([g.largura, g.altura]).toEqual([2386, 2478]);
    const [px] = pixel3857(g);
    expect(px * Math.cos(rad(latCentral(p)))).toBeCloseTo(18, 6); // a resolução gravada é a REAL do pixel
    // minimalidade: com 1 metro a menos o maior lado passaria do teto
    const c = caixa3857(p);
    const ladoCom17 = Math.ceil((c.maxy - c.miny) / (17 / Math.cos(rad(latCentral(p))))) + 2 * MARGEM_RASTER_PX;
    expect(ladoCom17).toBeGreaterThan(LADO_MAXIMO_RASTER_PX);
  });
  it("área MINÚSCULA: a resolução desce (inteiro ≥ 1) e o menor lado nunca fica abaixo de 32 px", () => {
    const pequena = planejarGradeRaster(quadrado(-56.1, -15.6, 0.0012, 0.0012)); // ~130 m: 10 m daria 13 + 4 px
    expect(pequena.resolucaoM).toBeLessThan(10);
    expect(pequena.resolucaoM).toBeGreaterThanOrEqual(1);
    expect(Math.min(pequena.largura, pequena.altura)).toBeGreaterThanOrEqual(LADO_MINIMO_RASTER_PX);
    expect(pequena.reduzida).toBe(false);
    // ~11 m de lado: nem a 1 m chega a 32 px — o lado é completado até 32 (margem centrada)
    const minuscula = planejarGradeRaster(quadrado(-56.1, -15.6, 0.0001, 0.0001));
    expect([minuscula.largura, minuscula.altura, minuscula.resolucaoM]).toEqual([32, 32, 1]);
  });
  it("faixa longa e estreita: o teto vence (resolução reduzida) e o lado curto é completado até 32", () => {
    const g = planejarGradeRaster(quadrado(-56.5, -15.6, 0.25, 0.0005)); // ~27 km × 55 m
    expect(g.reduzida).toBe(true);
    expect(g.largura).toBeLessThanOrEqual(LADO_MAXIMO_RASTER_PX);
    expect(g.altura).toBe(LADO_MINIMO_RASTER_PX);
  });
  it("polígono em 3857 com TODOS os anéis (furo incluído), na mesma ordem; função determinística", () => {
    const p: PoligonoGeoJson = {
      type: "Polygon",
      coordinates: [
        [[-56.1, -15.6], [-56.09, -15.6], [-56.09, -15.59], [-56.1, -15.59], [-56.1, -15.6]],
        [[-56.097, -15.597], [-56.093, -15.597], [-56.093, -15.593], [-56.097, -15.597]]
      ]
    };
    const g = planejarGradeRaster(p);
    expect(g.poligono3857.type).toBe("Polygon");
    expect(g.poligono3857.coordinates).toHaveLength(2);
    g.poligono3857.coordinates.forEach((anel, i) => anel.forEach(([x, y], j) => {
      const [ex, ey] = deLngLatPara3857(...p.coordinates[i]![j]!);
      expect(x).toBe(ex); expect(y).toBe(ey);
    }));
    expect(planejarGradeRaster(p)).toEqual(g);
  });
  it("polígono sem anel externo LANÇA", () => {
    expect(() => planejarGradeRaster({ type: "Polygon", coordinates: [] })).toThrow(RangeError);
  });
});

describe("SAT-06 cantos — ordem do MapLibre e ida e volta com a caixa (critério 6)", () => {
  const grades = [planejarGradeRaster(quadrado(-56.1, -15.6, 0.00932, 0.00904)), planejarGradeRaster(quadrado(-52, -30, 0.013, 0.007)), planejarGradeRaster(quadrado(-56.5, -15.9, 0.4, 0.4))];
  it("sup-esq (min_x, max_y), sup-dir (max_x, max_y), inf-dir (max_x, min_y), inf-esq (min_x, min_y), em [lng, lat]", () => {
    for (const g of grades) {
      const [minx, miny, maxx, maxy] = g.bbox3857;
      expect(g.cantosLngLat).toEqual([de3857ParaLngLat(minx, maxy), de3857ParaLngLat(maxx, maxy), de3857ParaLngLat(maxx, miny), de3857ParaLngLat(minx, miny)]);
      const [se, sd, id, ie] = g.cantosLngLat;
      // oeste à esquerda, norte em cima
      expect(se[0]).toBe(ie[0]); expect(sd[0]).toBe(id[0]); expect(se[0]).toBeLessThan(sd[0]);
      expect(se[1]).toBe(sd[1]); expect(ie[1]).toBe(id[1]); expect(se[1]).toBeGreaterThan(ie[1]);
    }
  });
  it("cantos → 3857 devolve a caixa (erro < 1 mm) e a caixa → cantos devolve os cantos", () => {
    for (const g of grades) {
      const xy = g.cantosLngLat.map(([lng, lat]) => deLngLatPara3857(lng, lat));
      const caixaDosCantos = [xy[0]![0], xy[2]![1], xy[2]![0], xy[0]![1]];
      caixaDosCantos.forEach((v, i) => expect(Math.abs(v - g.bbox3857[i]!)).toBeLessThan(1e-3));
      expect([xy[3]![0], xy[3]![1], xy[1]![0], xy[1]![1]].every((v, i) => Math.abs(v - g.bbox3857[i]!) < 1e-3)).toBe(true);
    }
  });
  it("o polígono inteiro cabe no retângulo dos cantos", () => {
    const p = quadrado(-56.1, -15.6, 0.00932, 0.00904);
    const g = planejarGradeRaster(p);
    const [se, , id] = g.cantosLngLat;
    for (const [lng, lat] of p.coordinates[0]!) {
      expect(lng).toBeGreaterThan(se[0]); expect(lng).toBeLessThan(id[0]);
      expect(lat).toBeLessThan(se[1]); expect(lat).toBeGreaterThan(id[1]);
    }
  });
});

describe("SAT-06 chaveCacheRaster — sha256 da área e dos componentes, nessa ordem", () => {
  const AREA = "0b5c2d1e-3f40-4a51-8b62-7c83d94ea5f6";
  const base: Parameters<typeof chaveCacheRaster>[0] = {
    areaId: AREA, geometriaSha256: "a".repeat(64), dataImagem: "2026-09-20", colecao: COLECAO_SENTINEL2_L2A, versaoEvalscript: VERSAO_EVALSCRIPT_RASTER,
    resolucaoM: 10, crs: CRS_RASTER, formato: FORMATO_RASTER, escalaMin: ESCALA_NDVI_RASTER.min, escalaMax: ESCALA_NDVI_RASTER.max
  };
  it("determinística (mesma área e mesmos parâmetros → mesma chave), hex de 64, igual ao sha256 de \"área|geometria|data|coleção|versão|resolução|crs|formato|min|max\"", () => {
    const k = chaveCacheRaster(base);
    expect(k).toMatch(/^[0-9a-f]{64}$/);
    expect(chaveCacheRaster({ ...base })).toBe(k);
    const texto = `${AREA}|${"a".repeat(64)}|2026-09-20|sentinel-2-l2a|ndvi-valores-v1|10|EPSG:3857|image/png|-0.2|1`;
    expect(k).toBe(createHash("sha256").update(texto).digest("hex"));
  });
  it("muda com CADA componente", () => {
    const k = chaveCacheRaster(base);
    const variantes: Partial<typeof base>[] = [
      { areaId: "0b5c2d1e-3f40-4a51-8b62-7c83d94ea5f7" }, { geometriaSha256: "b".repeat(64) }, { dataImagem: "2026-09-21" }, { colecao: "sentinel-2-l1c" }, { versaoEvalscript: "ndvi-valores-v2" },
      { resolucaoM: 11 }, { crs: "EPSG:4326" }, { formato: "image/tiff" }, { escalaMin: -0.3 }, { escalaMax: 0.9 }
    ];
    const chaves = variantes.map((v) => chaveCacheRaster({ ...base, ...v }));
    for (const c of chaves) expect(c).not.toBe(k);
    expect(new Set(chaves).size).toBe(variantes.length);
  });
  it("duas áreas com o MESMO polígono e a mesma data têm chaves DIFERENTES (sem a área, colidiriam no unique)", () => {
    const outraArea = "9f8e7d6c-5b4a-4392-8170-6f5e4d3c2b1a";
    expect(chaveCacheRaster({ ...base, areaId: outraArea })).not.toBe(chaveCacheRaster(base));
    expect(chaveCacheRaster({ ...base, areaId: outraArea })).toBe(chaveCacheRaster({ ...base, areaId: outraArea }));
  });
  it("componente fora da forma LANÇA (inclusive o separador dentro de um texto: chave ambígua; UUID fora da grafia canônica)", () => {
    for (const v of [{ areaId: AREA.toUpperCase() }, { areaId: AREA.replaceAll("-", "") }, { areaId: "" }, { areaId: `${AREA}|x` }, { geometriaSha256: "A".repeat(64) }, { geometriaSha256: "a".repeat(63) }, { dataImagem: "20/09/2026" }, { dataImagem: "2026-13-45" },
      { colecao: "a|b" }, { formato: "" }, { resolucaoM: 0 }, { resolucaoM: 10.5 }, { escalaMin: 1, escalaMax: -0.2 }, { escalaMax: Number.NaN }]) {
      expect(() => chaveCacheRaster({ ...base, ...v }), JSON.stringify(v)).toThrow(RangeError);
    }
  });
  it("dataImagemUtc: o dia UTC do instante (a data da observação)", () => {
    expect(dataImagemUtc(new Date("2026-09-20T00:00:00Z"))).toBe("2026-09-20");
    expect(dataImagemUtc(new Date("2026-09-20T23:59:59.999Z"))).toBe("2026-09-20");
    expect(dataImagemUtc(new Date("2026-09-20T23:30:00-03:00"))).toBe("2026-09-21");
  });
});

describe("SAT-06 montarCorpoProcesso — caixa E geometria em 3857, timeRange = a janela DADA", () => {
  const p = quadrado(-56.1, -15.6, 0.00932, 0.00904);
  const g = planejarGradeRaster(p);
  const janela = { inicio: new Date("2026-09-20T00:00:00Z"), fim: new Date("2026-09-21T00:00:00Z") };
  it("corpo exato do contrato", () => {
    expect(montarCorpoProcesso(g, janela)).toEqual({
      input: {
        bounds: {
          bbox: g.bbox3857,
          geometry: { type: "Polygon", coordinates: g.poligono3857.coordinates },
          properties: { crs: "http://www.opengis.net/def/crs/EPSG/0/3857" }
        },
        data: [{ type: "sentinel-2-l2a", dataFilter: { timeRange: { from: "2026-09-20T00:00:00.000Z", to: "2026-09-21T00:00:00.000Z" } } }]
      },
      output: { width: g.largura, height: g.altura, responses: [{ identifier: "default", format: { type: "image/png" } }] },
      evalscript: EVALSCRIPT_RASTER_NDVI
    });
    expect(CRS_RASTER_URL).toBe("http://www.opengis.net/def/crs/EPSG/0/3857");
  });
  it("a geometria VAI no corpo (sem ela o provedor pintaria o retângulo inteiro)", () => {
    const corpo = montarCorpoProcesso(g, janela) as { input: { bounds: Record<string, unknown> } };
    expect(Object.keys(corpo.input.bounds).sort()).toEqual(["bbox", "geometry", "properties"]);
    expect((corpo.input.bounds["geometry"] as { coordinates: unknown }).coordinates).toEqual(g.poligono3857.coordinates);
  });
  it("timeRange é EXATAMENTE a janela recebida, qualquer que seja (nunca \"a mais recente\" nem a janela da análise)", () => {
    for (const j of [janela, { inicio: new Date("2025-01-07T00:00:00Z"), fim: new Date("2025-01-08T00:00:00Z") }, { inicio: new Date("2026-09-03T10:11:12.345Z"), fim: new Date("2026-09-03T10:11:13Z") }]) {
      const corpo = montarCorpoProcesso(g, j) as { input: { data: { dataFilter: { timeRange: unknown } }[] } };
      expect(corpo.input.data[0]!.dataFilter.timeRange).toEqual({ from: j.inicio.toISOString(), to: j.fim.toISOString() });
    }
  });
  it("o corpo não muda a grade recebida (cópia) e janela inválida LANÇA", () => {
    const corpo = montarCorpoProcesso(g, janela) as { input: { bounds: { bbox: number[] } } };
    corpo.input.bounds.bbox[0] = 0;
    expect(g.bbox3857[0]).not.toBe(0);
    expect(() => montarCorpoProcesso(g, { inicio: janela.fim, fim: janela.inicio })).toThrow(RangeError);
    expect(() => montarCorpoProcesso(g, { inicio: new Date("x"), fim: janela.fim })).toThrow(RangeError);
  });
});
