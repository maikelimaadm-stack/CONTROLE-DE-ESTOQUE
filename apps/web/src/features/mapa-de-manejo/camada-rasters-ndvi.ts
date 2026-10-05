/**
 * SAT-07 — camadas MapLibre do raster NDVI por área.
 *
 * Cada área com imagem vira uma fonte `image` (data URL do canvas colorido) com
 * `cantos_lnglat` na ordem recebida (NO, NE, SE, SO). A camada fica ACIMA da base /
 * do preenchimento e ABAIXO do contorno branco (`areas-contorno`).
 */
import type { Map as MapLibreMap } from "maplibre-gl";
import type { EntradaRasterEmMemoria } from "./rasters-ndvi";

const PREFIXO_FONTE = "raster-ndvi-";
const PREFIXO_CAMADA = "raster-ndvi-layer-";
/** Antes desta camada: contorno fino das áreas. */
export const ANTES_DO_CONTORNO = "areas-contorno";

export function idFonteRaster(areaId: string) {
  return `${PREFIXO_FONTE}${areaId}`;
}
export function idCamadaRaster(areaId: string) {
  return `${PREFIXO_CAMADA}${areaId}`;
}

function cantosValidos(c: unknown): c is [[number, number], [number, number], [number, number], [number, number]] {
  return Array.isArray(c) && c.length === 4 && c.every((p) => Array.isArray(p) && p.length === 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]));
}

/** Remove fonte+camada de uma área (e libera o gancho E2E se existir). */
export function removerRasterDoMapa(m: MapLibreMap, areaId: string) {
  const camada = idCamadaRaster(areaId);
  const fonte = idFonteRaster(areaId);
  try { if (m.getLayer(camada)) m.removeLayer(camada); } catch { /* */ }
  try { if (m.getSource(fonte)) m.removeSource(fonte); } catch { /* */ }
}

/**
 * Sincroniza as camadas de raster com o cache em memória.
 * `visivel`: no modo "Por pixel"; fora dele as camadas saem (o bitmap permanece no cache).
 */
export function sincronizarRastersNoMapa(
  m: MapLibreMap,
  porArea: ReadonlyMap<string, EntradaRasterEmMemoria>,
  visivel: boolean
) {
  const vivos = new Set<string>();
  if (visivel) {
    for (const [areaId, ent] of porArea) {
      if (ent.erro || !ent.blobUrl || !cantosValidos(ent.dto.cantos_lnglat)) continue;
      vivos.add(areaId);
      const fonteId = idFonteRaster(areaId);
      const camadaId = idCamadaRaster(areaId);
      const coords = ent.dto.cantos_lnglat;
      const existente = m.getSource(fonteId) as { updateImage?: (o: { url: string; coordinates: typeof coords }) => void } | undefined;
      if (existente?.updateImage) {
        existente.updateImage({ url: ent.blobUrl, coordinates: coords });
      } else {
        if (m.getLayer(camadaId)) try { m.removeLayer(camadaId); } catch { /* */ }
        if (m.getSource(fonteId)) try { m.removeSource(fonteId); } catch { /* */ }
        m.addSource(fonteId, { type: "image", url: ent.blobUrl, coordinates: coords });
        const antes = m.getLayer(ANTES_DO_CONTORNO) ? ANTES_DO_CONTORNO : undefined;
        m.addLayer({
          id: camadaId,
          type: "raster",
          source: fonteId,
          paint: { "raster-fade-duration": 0, "raster-opacity": 1 }
        }, antes);
      }
      if (m.getLayer(camadaId)) {
        m.setLayoutProperty(camadaId, "visibility", "visible");
      }
    }
  }

  // Remove camadas de áreas que saíram do conjunto ou do modo pixel.
  const estilo = m.getStyle();
  const fontes = estilo?.sources ? Object.keys(estilo.sources) : [];
  for (const fonteId of fontes) {
    if (!fonteId.startsWith(PREFIXO_FONTE)) continue;
    const areaId = fonteId.slice(PREFIXO_FONTE.length);
    if (!vivos.has(areaId)) removerRasterDoMapa(m, areaId);
  }
}

/** Amostra a cor RGBA de um pixel do canvas colorido (para E2E / aceite). */
export function amostrarPixelCanvas(canvas: HTMLCanvasElement, x: number, y: number): [number, number, number, number] {
  const ctx = canvas.getContext("2d");
  if (!ctx) return [0, 0, 0, 0];
  const { data } = ctx.getImageData(Math.max(0, Math.min(canvas.width - 1, x)), Math.max(0, Math.min(canvas.height - 1, y)), 1, 1);
  return [data[0]!, data[1]!, data[2]!, data[3]!];
}
