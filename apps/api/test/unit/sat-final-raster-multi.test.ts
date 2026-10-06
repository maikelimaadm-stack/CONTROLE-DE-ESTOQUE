import { describe, it, expect } from "vitest";
import { ENCODING_RASTER_POR_INDICE, INDICES_RASTER } from "@agro/domain";
import type { PoligonoGeoJson } from "../../src/lib/satelite/geometria.js";
import { chaveCacheRaster, montarCorpoProcesso, planejarGradeRaster } from "../../src/lib/satelite/raster.js";
import { EVALSCRIPT_RASTER_POR_INDICE } from "../../src/lib/satelite/evalscript-raster.js";

const AREA = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const HASH = "a".repeat(64);
const POLIGONO: PoligonoGeoJson = {
  type: "Polygon",
  coordinates: [[[-56.1, -15.6], [-56.1, -15.59], [-56.09, -15.59], [-56.09, -15.6], [-56.1, -15.6]]]
};

describe("SAT-FINAL — raster multi-índice (chave/evalscript/resolução)", () => {
  it("R-7 hash diferente muda a chave", () => {
    const e = ENCODING_RASTER_POR_INDICE.ndvi;
    const base = {
      areaId: AREA, dataImagem: "2026-10-01", colecao: "sentinel-2-l2a",
      versaoEvalscript: e.encodingVersion, resolucaoM: 10, crs: "EPSG:3857", formato: "image/png",
      escalaMin: e.scaleMin, escalaMax: e.scaleMax
    };
    const a = chaveCacheRaster({ ...base, geometriaSha256: "a".repeat(64) });
    const b = chaveCacheRaster({ ...base, geometriaSha256: "b".repeat(64) });
    expect(a).not.toBe(b);
  });

  it("R-8 índice diferente muda a chave (via encodingVersion)", () => {
    const chaves = INDICES_RASTER.map((id) => {
      const e = ENCODING_RASTER_POR_INDICE[id];
      return chaveCacheRaster({
        areaId: AREA, geometriaSha256: HASH, dataImagem: "2026-10-01", colecao: "sentinel-2-l2a",
        versaoEvalscript: e.encodingVersion, resolucaoM: e.processingResolutionM,
        crs: "EPSG:3857", formato: "image/png", escalaMin: e.scaleMin, escalaMax: e.scaleMax
      });
    });
    expect(new Set(chaves).size).toBe(INDICES_RASTER.length);
  });

  it("R-5/R-6 grade respeita resolução alvo 10 vs 20", () => {
    const g10 = planejarGradeRaster(POLIGONO, 10);
    const g20 = planejarGradeRaster(POLIGONO, 20);
    expect(g10.resolucaoAlvoM).toBe(10);
    expect(g20.resolucaoAlvoM).toBe(20);
    // Mesmo polígono: 20 m tende a menos pixels que 10 m (quando não reduzido).
    if (!g10.reduzida && !g20.reduzida) {
      expect(g20.largura * g20.altura).toBeLessThanOrEqual(g10.largura * g10.altura);
    }
  });

  it("montarCorpoProcesso usa evalscript do índice pedido", () => {
    const grade = planejarGradeRaster(POLIGONO, 20);
    const janela = { inicio: new Date("2026-10-01T00:00:00Z"), fim: new Date("2026-10-02T00:00:00Z") };
    for (const id of INDICES_RASTER) {
      const corpo = montarCorpoProcesso(grade, janela, id) as { evalscript: string };
      expect(corpo.evalscript).toBe(EVALSCRIPT_RASTER_POR_INDICE[id]);
      expect(corpo.evalscript).toContain("ESCALA_MIN");
      expect(corpo.evalscript).toContain("return [0]");
    }
  });

  it("NDVI chave compatível com componentes SAT-06 (mesma versão/escala)", () => {
    const e = ENCODING_RASTER_POR_INDICE.ndvi;
    expect(e.encodingVersion).toBe("ndvi-valores-v1");
    expect(e.scaleMin).toBe(-0.2);
    expect(e.scaleMax).toBe(1.0);
  });
});
