import { describe, expect, it } from "vitest";
import { zonasDeRasterCondicao } from "./zonas-condicao";

const CANTOS: [[number, number], [number, number], [number, number], [number, number]] = [
  [-56.1, -15.59], [-56.09, -15.59], [-56.09, -15.60], [-56.1, -15.60]
];

describe("MAPA-UX-02 — zonas visuais", () => {
  it("VIS: agrupa classes 1..6; ignora 0 e 255; contido na grade", () => {
    const pixels = Uint8Array.from([
      255, 0, 1, 1,
      255, 1, 1, 2,
      255, 5, 5, 2
    ]);
    const zonas = zonasDeRasterCondicao({ pixels, largura: 4, altura: 3, cantos: CANTOS });
    const codigos = zonas.map((z) => z.codigo).sort();
    expect(codigos).toEqual([1, 2, 5]);
    for (const z of zonas) {
      expect(z.geometry.type).toBe("MultiPolygon");
      expect(z.geometry.coordinates.length).toBeGreaterThan(0);
    }
    const n1 = zonas.find((z) => z.codigo === 1)!.geometry.coordinates.length;
    expect(n1).toBe(4); // quatro pixels de classe 1
  });

  it("não inventa classe a partir de fora/sem leitura", () => {
    const pixels = new Uint8Array(9).fill(255);
    pixels[4] = 0;
    expect(zonasDeRasterCondicao({ pixels, largura: 3, altura: 3, cantos: CANTOS })).toEqual([]);
  });
});
