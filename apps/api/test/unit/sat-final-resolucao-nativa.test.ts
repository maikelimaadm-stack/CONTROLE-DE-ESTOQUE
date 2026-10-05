import { describe, it, expect } from "vitest";
import { planejarGradeRaster } from "../../src/lib/satelite/raster.js";
import type { PoligonoGeoJson } from "../../src/lib/satelite/geometria.js";

const quadrado = (lng: number, lat: number, dLng: number, dLat: number): PoligonoGeoJson => ({
  type: "Polygon",
  coordinates: [[[lng, lat], [lng + dLng, lat], [lng + dLng, lat + dLat], [lng, lat + dLat], [lng, lat]]]
});

describe("SAT-FINAL R1 — resolução nativa (Pixel real)", () => {
  it("RES-1 área minúscula NDVI → resolucao_m >= 10", () => {
    const g = planejarGradeRaster(quadrado(-56.1, -15.6, 0.0001, 0.0001), 10);
    expect(g.resolucaoM).toBeGreaterThanOrEqual(10);
    expect(g.resolucaoM).toBe(10);
  });

  it("RES-2 área minúscula NDMI → resolucao_m >= 20", () => {
    const g = planejarGradeRaster(quadrado(-56.1, -15.6, 0.0001, 0.0001), 20);
    expect(g.resolucaoM).toBeGreaterThanOrEqual(20);
    expect(g.resolucaoM).toBe(20);
  });

  it("RES-3 área normal NDVI → 10", () => {
    const g = planejarGradeRaster(quadrado(-56.1, -15.6, 0.00932, 0.00904), 10);
    expect(g.resolucaoM).toBe(10);
    expect(g.reduzida).toBe(false);
  });

  it("RES-4 área normal NDRE → 20", () => {
    const g = planejarGradeRaster(quadrado(-56.1, -15.6, 0.00932, 0.00904), 20);
    expect(g.resolucaoM).toBe(20);
    expect(g.reduzida).toBe(false);
  });

  it("RES-5 área muito grande → resolução aumenta e reduzida=true", () => {
    const g = planejarGradeRaster(quadrado(-56.5, -15.9, 0.4, 0.4), 10);
    expect(g.reduzida).toBe(true);
    expect(g.resolucaoM).toBeGreaterThan(10);
  });
});
