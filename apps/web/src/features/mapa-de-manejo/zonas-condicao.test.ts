import { describe, expect, it } from "vitest";
import { componentes4Conexos, zonasDeRasterCondicao } from "./zonas-condicao";
import { featureCollectionDaEntrada, limparCacheZonasCondicao } from "./camada-zonas-condicao";

const CANTOS: [[number, number], [number, number], [number, number], [number, number]] = [
  [-56.1, -15.59], [-56.09, -15.59], [-56.09, -15.60], [-56.1, -15.60]
];
/** Contorno = bbox do raster — testes de agrupamento; clip fail-closed exige área. */
const AREA_GRADE = {
  type: "Polygon" as const,
  coordinates: [[[-56.1, -15.60], [-56.09, -15.60], [-56.09, -15.59], [-56.1, -15.59], [-56.1, -15.60]]]
};

describe("MAPA-UX-02 — zonas visuais", () => {
  it("VIS: agrupa classes 1..6; ignora 0 e 255; um componente 4-conexo por mancha", () => {
    const pixels = Uint8Array.from([
      255, 0, 1, 1,
      255, 1, 1, 2,
      255, 5, 5, 2
    ]);
    const comps = componentes4Conexos({ pixels, largura: 4, altura: 3 });
    expect(comps.map((c) => c.codigo)).toEqual([1, 2, 5]);
    expect(comps.find((c) => c.codigo === 1)!.pixels).toHaveLength(4);
    const zonas = zonasDeRasterCondicao({ pixels, largura: 4, altura: 3, cantos: CANTOS, geometriaArea: AREA_GRADE });
    expect(zonas.map((z) => z.codigo).sort()).toEqual([1, 2, 5]);
    expect(zonas.filter((z) => z.codigo === 1)).toHaveLength(1);
    // 01B: um blob → 1 Polygon (não MultiPolygon de runs).
    expect(zonas.find((z) => z.codigo === 1)!.geometry.type).toBe("Polygon");
  });

  it("dois componentes da mesma classe ficam separados (determinístico)", () => {
    const pixels = Uint8Array.from([1, 0, 1, 0, 0, 0]);
    const zonas = zonasDeRasterCondicao({ pixels, largura: 3, altura: 2, cantos: CANTOS, geometriaArea: AREA_GRADE });
    expect(zonas.filter((z) => z.codigo === 1)).toHaveLength(2);
  });

  it("não inventa classe a partir de fora/sem leitura", () => {
    const pixels = new Uint8Array(9).fill(255);
    pixels[4] = 0;
    expect(zonasDeRasterCondicao({ pixels, largura: 3, altura: 3, cantos: CANTOS, geometriaArea: AREA_GRADE })).toEqual([]);
  });

  it("cache de FeatureCollection por mapaId × bytes.length", () => {
    limparCacheZonasCondicao();
    const bytes = Uint8ClampedArray.from([1, 1, 2, 2]);
    const ent = {
      dto: {
        id: "mapa-1", mapaId: "mapa-1", analise_id: "mapa-1", area_id: "a1",
        indice: "condicao_pasto", tipo: "png", data_imagem: "2024-01-01",
        largura: 2, altura: 2, cantos_lnglat: CANTOS, escala_min: 0, escala_max: 6,
        resolucao_m: 20, resolucao_reduzida: false, url_assinada: "/x", expira_em: "2099-01-01"
      },
      bytesCinza: bytes, largura: 2, altura: 2,
      canvas: null as unknown as HTMLCanvasElement, blobUrl: null, erro: null
    };
    const a = featureCollectionDaEntrada(ent);
    const b = featureCollectionDaEntrada(ent);
    expect(a).not.toBeNull();
    expect(a).toBe(b);
  });
});
