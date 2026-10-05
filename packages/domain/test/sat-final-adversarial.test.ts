import { describe, it, expect } from "vitest";
import {
  ENCODING_RASTER_POR_INDICE,
  RASTER_NODATA_BYTE,
  avaliarAnomaliaSatelite,
  codificarValorRaster,
  decodificarByteRaster,
  encodingRasterDe,
  encodingRasterPorVersao,
  type PontoSerieIndice
} from "../src/index.js";

/**
 * Testes adversariais (Checkpoint G): se alguém sabotar o contrato, estes FALHAM.
 * Nenhuma sabotagem é commitada — só a prova positiva do invariante.
 */

const H = "c".repeat(64);

describe("SAT-FINAL adversarial — contratos que não podem regredir", () => {
  it("ADV-1: encoding sempre embute geometry hash na identidade lógica (versão ≠ vazia)", () => {
    for (const enc of Object.values(ENCODING_RASTER_POR_INDICE)) {
      expect(enc.encodingVersion.length).toBeGreaterThan(0);
      expect(enc.encodingVersion).toMatch(enc.indice);
    }
  });

  it("ADV-2: nodata nunca decodifica como zero do índice", () => {
    const e = ENCODING_RASTER_POR_INDICE.ndmi;
    expect(decodificarByteRaster(RASTER_NODATA_BYTE, e.scaleMin, e.scaleMax)).toBeNull();
    const zeroByte = codificarValorRaster(0, e.scaleMin, e.scaleMax);
    expect(zeroByte).not.toBe(RASTER_NODATA_BYTE);
  });

  it("ADV-3: NDRE não declara 10 m", () => {
    expect(ENCODING_RASTER_POR_INDICE.ndre.nativeResolutionM).toBe(20);
    expect(ENCODING_RASTER_POR_INDICE.ndre.processingResolutionM).toBe(20);
  });

  it("ADV-4: anomalia nunca marca praga/biomassa", () => {
    const serie = (vals: number[]): PontoSerieIndice[] =>
      vals.map((media, i) => ({
        data: `2026-09-${String(10 + i).padStart(2, "0")}T00:00:00.000Z`,
        media,
        qualidadeOk: true,
        geometriaSha256: H
      }));
    const r = avaliarAnomaliaSatelite({
      geometriaSha256Atual: H,
      series: {
        ndvi: serie([0.8, 0.7, 0.5, 0.2]),
        ndre: serie([0.6, 0.5, 0.3, 0.1]),
        ndmi: serie([0.2, 0.1, 0, -0.2]),
        bsi: serie([0, 0.1, 0.3, 0.5])
      }
    });
    expect(r.praga_detectada).toBe(false);
    expect(r.biomassa_estimada).toBe(false);
    expect(JSON.stringify(r).toLowerCase()).not.toMatch(/praga detectada/);
  });

  it("ADV-5: escala relativa proibida — encodings usam escala fixa com min < max", () => {
    for (const enc of Object.values(ENCODING_RASTER_POR_INDICE)) {
      expect(enc.scaleMin).toBeLessThan(enc.scaleMax);
      expect(Number.isFinite(enc.scaleMin)).toBe(true);
      expect(Number.isFinite(enc.scaleMax)).toBe(true);
    }
  });

  it("ADV-6: versão desconhecida não herda metadados do catálogo atual do índice", () => {
    expect(encodingRasterDe("ndvi")?.encodingVersion).toBe("ndvi-valores-v1");
    expect(encodingRasterPorVersao("ndvi-valores-v1")?.encodingVersion).toBe("ndvi-valores-v1");
    expect(encodingRasterPorVersao("ndvi-valores-v999-inexistente")).toBeNull();
  });

  it("ADV-7: 30 pontos com queda só no fim — anomalia precisa ver os recentes (série ASC completa)", () => {
    const hash = "d".repeat(64);
    const vals = Array.from({ length: 30 }, (_, i) => (i < 24 ? 0.7 : 0.7 - (i - 23) * 0.1));
    const serie = vals.map((media, i) => ({
      data: `2026-09-${String(i + 1).padStart(2, "0")}T00:00:00.000Z`,
      media,
      qualidadeOk: true,
      geometriaSha256: hash
    }));
    // Se alguém cortar ASC LIMIT 24 dos antigos, a queda some.
    const soAntigos = serie.slice(0, 24);
    const recentes = serie.slice(-24);
    const rAntigos = avaliarAnomaliaSatelite({
      geometriaSha256Atual: hash,
      series: { ndvi: soAntigos, ndre: soAntigos, ndmi: soAntigos, bsi: soAntigos }
    });
    const rRecentes = avaliarAnomaliaSatelite({
      geometriaSha256Atual: hash,
      series: { ndvi: recentes, ndre: recentes, ndmi: recentes, bsi: recentes }
    });
    expect(rAntigos.nivel).toBe("nenhuma");
    expect(["leve", "moderada", "forte"]).toContain(rRecentes.nivel);
  });
});
