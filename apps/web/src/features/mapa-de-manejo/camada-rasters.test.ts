import { describe, expect, it, vi } from "vitest";
import type { Map as MapLibreMap } from "maplibre-gl";
import {
  AVISO_RENDER_SUAVIZADO,
  OPACIDADE_PADRAO,
  RENDER_PADRAO,
  idCamadaRaster,
  idFonteRaster,
  limitarOpacidade,
  sincronizarRastersNoMapa
} from "./camada-rasters";
import type { EntradaRasterEmMemoria } from "./rasters-indice";

interface Camada { id: string; paint: Record<string, unknown>; layout: Record<string, unknown> }

/** Mapa simulado com só o que a camada usa. */
function mapaFalso() {
  const fontes = new Map<string, { updateImage: ReturnType<typeof vi.fn> }>();
  const camadas = new Map<string, Camada>();
  const m = {
    getSource: (id: string) => fontes.get(id),
    addSource: (id: string) => { fontes.set(id, { updateImage: vi.fn() }); },
    removeSource: (id: string) => { fontes.delete(id); },
    getLayer: (id: string) => camadas.get(id),
    addLayer: (c: { id: string; paint: Record<string, unknown> }) => { camadas.set(c.id, { id: c.id, paint: { ...c.paint }, layout: {} }); },
    removeLayer: (id: string) => { camadas.delete(id); },
    setLayoutProperty: (id: string, k: string, v: unknown) => { camadas.get(id)!.layout[k] = v; },
    setPaintProperty: (id: string, k: string, v: unknown) => { camadas.get(id)!.paint[k] = v; },
    getStyle: () => ({ sources: Object.fromEntries([...fontes.keys()].map((k) => [k, {}])) })
  };
  return { m: m as unknown as MapLibreMap, fontes, camadas };
}

function entrada(areaId: string, extra: Partial<EntradaRasterEmMemoria> = {}): EntradaRasterEmMemoria {
  return {
    dto: {
      id: `r-${areaId}`, analise_id: "a", area_id: areaId, indice: "ndvi", tipo: "valores", data_imagem: "2026-09-10", largura: 4, altura: 4,
      cantos_lnglat: [[-55.5, -15.29], [-55.49, -15.29], [-55.49, -15.3], [-55.5, -15.3]], escala_min: -0.2, escala_max: 1,
      resolucao_m: 10, resolucao_reduzida: false, url_assinada: "/x", expira_em: "2099-01-01T00:00:00.000Z"
    },
    bytesCinza: new Uint8ClampedArray(16), largura: 4, altura: 4, canvas: {} as HTMLCanvasElement, blobUrl: "blob:x", erro: null, ...extra
  };
}

describe("camada de rasters", () => {
  it("padrão: Pixel real (nearest) com opacidade 0,7", () => {
    expect(RENDER_PADRAO).toBe("nearest");
    expect(OPACIDADE_PADRAO).toBe(0.7);
    const { m, camadas } = mapaFalso();
    sincronizarRastersNoMapa(m, new Map([["a1", entrada("a1")]]), true);
    const c = camadas.get(idCamadaRaster("a1"))!;
    expect(c.paint["raster-resampling"]).toBe("nearest");
    expect(c.paint["raster-opacity"]).toBe(0.7);
    expect(c.layout["visibility"]).toBe("visible");
  });

  it("Suavizado (linear) e a opacidade escolhida se aplicam a camadas existentes, sem recriar a fonte", () => {
    const { m, camadas, fontes } = mapaFalso();
    const porArea = new Map([["a1", entrada("a1")]]);
    sincronizarRastersNoMapa(m, porArea, true);
    const fonte = fontes.get(idFonteRaster("a1"))!;
    sincronizarRastersNoMapa(m, porArea, true, { resampling: "linear", opacidade: 0.4 });
    const c = camadas.get(idCamadaRaster("a1"))!;
    expect(c.paint["raster-resampling"]).toBe("linear");
    expect(c.paint["raster-opacity"]).toBe(0.4);
    expect(fontes.get(idFonteRaster("a1"))).toBe(fonte);
    expect(fonte.updateImage).toHaveBeenCalledTimes(1);
  });

  it("sai do modo pixel ou da vista: a camada e a fonte são removidas", () => {
    const { m, camadas, fontes } = mapaFalso();
    sincronizarRastersNoMapa(m, new Map([["a1", entrada("a1")], ["a2", entrada("a2")]]), true);
    expect(camadas.size).toBe(2);
    sincronizarRastersNoMapa(m, new Map([["a2", entrada("a2")]]), true);
    expect([...camadas.keys()]).toEqual([idCamadaRaster("a2")]);
    sincronizarRastersNoMapa(m, new Map([["a2", entrada("a2")]]), false);
    expect(camadas.size).toBe(0);
    expect(fontes.size).toBe(0);
  });

  it("entrada com erro, sem imagem ou com cantos inválidos não vira camada", () => {
    const { m, camadas } = mapaFalso();
    const ruim = entrada("c", { dto: { ...entrada("c").dto, cantos_lnglat: [[0, 0]] as unknown as EntradaRasterEmMemoria["dto"]["cantos_lnglat"] } });
    sincronizarRastersNoMapa(m, new Map([["a", entrada("a", { erro: "falhou" })], ["b", entrada("b", { blobUrl: null })], ["c", ruim]]), true);
    expect(camadas.size).toBe(0);
  });

  it("opacidade fora de 0..1 é limitada; não finita volta ao padrão; o aviso do suavizado existe", () => {
    expect(limitarOpacidade(2)).toBe(1);
    expect(limitarOpacidade(-1)).toBe(0);
    expect(limitarOpacidade(Number.NaN)).toBe(OPACIDADE_PADRAO);
    expect(AVISO_RENDER_SUAVIZADO).toMatch(/Pixel real/);
  });
});
