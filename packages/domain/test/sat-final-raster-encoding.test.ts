import { describe, it, expect } from "vitest";
import {
  CATALOGO_INDICES,
  ENCODING_RASTER_POR_INDICE,
  INDICES_RASTER,
  RASTER_NODATA_BYTE,
  codificarValorRaster,
  decodificarByteRaster,
  encodingRasterDe,
  resolucaoNativaHonesta
} from "../src/index.js";

describe("SAT-FINAL — encoding raster multi-índice", () => {
  it("R-1 NDVI encode/decode roundtrip no centro do degrau", () => {
    const e = ENCODING_RASTER_POR_INDICE.ndvi;
    const byte = codificarValorRaster(0.5, e.scaleMin, e.scaleMax);
    expect(byte).toBeGreaterThan(0);
    const v = decodificarByteRaster(byte, e.scaleMin, e.scaleMax)!;
    expect(Math.abs(v - 0.5)).toBeLessThan(0.005);
  });

  it("R-2 EVI2 >1 cabe na escala e não vira nodata", () => {
    const e = ENCODING_RASTER_POR_INDICE.evi2;
    const byte = codificarValorRaster(1.2, e.scaleMin, e.scaleMax);
    expect(byte).toBeGreaterThan(0);
    expect(decodificarByteRaster(byte, e.scaleMin, e.scaleMax)).not.toBeNull();
  });

  it("R-3 MSAVI2 < -1 satura no piso visual (não nodata)", () => {
    const e = ENCODING_RASTER_POR_INDICE.msavi2;
    expect(codificarValorRaster(-1.5, e.scaleMin, e.scaleMax)).toBe(1);
  });

  it("R-4 nodata ≠ zero do índice", () => {
    const e = ENCODING_RASTER_POR_INDICE.ndvi;
    expect(decodificarByteRaster(RASTER_NODATA_BYTE, e.scaleMin, e.scaleMax)).toBeNull();
    const zero = codificarValorRaster(0, e.scaleMin, e.scaleMax);
    expect(zero).not.toBe(RASTER_NODATA_BYTE);
    expect(decodificarByteRaster(zero, e.scaleMin, e.scaleMax)).not.toBeNull();
  });

  it("R-5/R-6 resoluções nativas 10 m vs 20 m honestas", () => {
    expect(ENCODING_RASTER_POR_INDICE.ndvi.nativeResolutionM).toBe(10);
    expect(ENCODING_RASTER_POR_INDICE.evi2.nativeResolutionM).toBe(10);
    expect(ENCODING_RASTER_POR_INDICE.msavi2.nativeResolutionM).toBe(10);
    expect(ENCODING_RASTER_POR_INDICE.ndre.nativeResolutionM).toBe(20);
    expect(ENCODING_RASTER_POR_INDICE.ndmi.nativeResolutionM).toBe(20);
    expect(ENCODING_RASTER_POR_INDICE.bsi.nativeResolutionM).toBe(20);
    for (const id of INDICES_RASTER) {
      expect(resolucaoNativaHonesta(id)).toBe(CATALOGO_INDICES[id].resolucaoNativaM);
      expect(ENCODING_RASTER_POR_INDICE[id].processingResolutionM).toBe(CATALOGO_INDICES[id].resolucaoNativaM);
    }
  });

  it("R-8 índices distintos têm encodingVersion distintas", () => {
    const versoes = new Set(INDICES_RASTER.map((i) => ENCODING_RASTER_POR_INDICE[i].encodingVersion));
    expect(versoes.size).toBe(INDICES_RASTER.length);
  });

  it("NDVI preserva escala/versão SAT-06", () => {
    expect(ENCODING_RASTER_POR_INDICE.ndvi.encodingVersion).toBe("ndvi-valores-v1");
    expect(ENCODING_RASTER_POR_INDICE.ndvi.scaleMin).toBe(-0.2);
    expect(ENCODING_RASTER_POR_INDICE.ndvi.scaleMax).toBe(1.0);
    expect(encodingRasterDe("foo")).toBeNull();
  });
});
