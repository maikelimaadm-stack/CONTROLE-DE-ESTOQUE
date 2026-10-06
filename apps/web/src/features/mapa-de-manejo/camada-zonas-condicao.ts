/**
 * Camada MapLibre das zonas de condição do pasto — MAPA-UX-02 gap.
 */
import { CLASSES_CONDICAO_PASTO } from "@agro/domain";
import type { GeoJSONSource, Map as MapLibreMap } from "maplibre-gl";
import { ANTES_DO_CONTORNO } from "./camada-rasters";
import type { EntradaRasterEmMemoria } from "./rasters-indice";
import { featureCollectionZonas, zonasDeRasterCondicao, type CantosLngLat } from "./zonas-condicao";

export const FONTE_ZONAS_CONDICAO = "condicao-zonas";
export const CAMADA_ZONAS_FILL = "condicao-zonas-fill";
export const OPACIDADE_PNG_SOB_ZONAS = 0.22;

type EntradaComMapa = EntradaRasterEmMemoria & {
  dto: EntradaRasterEmMemoria["dto"] & { mapaId?: string };
};

interface CacheEntry { chave: string; fc: GeoJSON.FeatureCollection; }
const cacheZonas = new Map<string, CacheEntry>();

function cantosValidos(c: unknown): c is CantosLngLat {
  return Array.isArray(c) && c.length === 4 && c.every((p) => Array.isArray(p) && p.length === 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]));
}

function chaveCache(mapaId: string, bytesLen: number, largura: number, altura: number): string {
  return `${mapaId}|${bytesLen}|${largura}x${altura}`;
}

export function featureCollectionDaEntrada(ent: EntradaComMapa): GeoJSON.FeatureCollection | null {
  if (ent.erro || !ent.bytesCinza.length || !cantosValidos(ent.dto.cantos_lnglat)) return null;
  const mapaId = ent.dto.mapaId ?? ent.dto.id;
  const chave = chaveCache(mapaId, ent.bytesCinza.length, ent.largura, ent.altura);
  const hit = cacheZonas.get(mapaId);
  if (hit && hit.chave === chave) return hit.fc;
  const zonas = zonasDeRasterCondicao({
    pixels: ent.bytesCinza, largura: ent.largura, altura: ent.altura, cantos: ent.dto.cantos_lnglat
  });
  const fc = featureCollectionZonas(zonas);
  cacheZonas.set(mapaId, { chave, fc });
  return fc;
}

export function limparCacheZonasCondicao() { cacheZonas.clear(); }

function expressaoCorFill(): unknown[] {
  const pares: unknown[] = ["match", ["get", "codigo"]];
  for (const c of CLASSES_CONDICAO_PASTO) {
    if (c.codigo === 0) continue;
    pares.push(c.codigo, c.cor);
  }
  pares.push("#000000");
  return pares;
}

function garantirFonteECamadas(m: MapLibreMap) {
  if (!m.getSource(FONTE_ZONAS_CONDICAO)) {
    m.addSource(FONTE_ZONAS_CONDICAO, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
  }
  const antes = m.getLayer(ANTES_DO_CONTORNO) ? ANTES_DO_CONTORNO : undefined;
  if (!m.getLayer(CAMADA_ZONAS_FILL)) {
    m.addLayer({
      id: CAMADA_ZONAS_FILL, type: "fill", source: FONTE_ZONAS_CONDICAO,
      filter: ["all", [">=", ["get", "codigo"], 1], ["<=", ["get", "codigo"], 6]],
      paint: {
        "fill-antialias": true,
        "fill-color": expressaoCorFill() as unknown as string,
        "fill-opacity": 0.92,
        "fill-outline-color": "rgba(0,0,0,0)"
      }
    }, antes);
  }
}

export function sincronizarZonasCondicaoNoMapa(
  m: MapLibreMap, porArea: ReadonlyMap<string, EntradaComMapa>, visivel: boolean
) {
  garantirFonteECamadas(m);
  const src = m.getSource(FONTE_ZONAS_CONDICAO) as GeoJSONSource | undefined;
  if (!src) return;
  if (!visivel) {
    src.setData({ type: "FeatureCollection", features: [] });
    if (m.getLayer(CAMADA_ZONAS_FILL)) m.setLayoutProperty(CAMADA_ZONAS_FILL, "visibility", "none");
    return;
  }
  const features: GeoJSON.Feature[] = [];
  for (const [areaId, ent] of porArea) {
    const fc = featureCollectionDaEntrada(ent);
    if (!fc) continue;
    for (const f of fc.features) features.push({ ...f, properties: { ...f.properties, area_id: areaId } });
  }
  for (const id of [...cacheZonas.keys()]) {
    const ainda = [...porArea.values()].some((e) => (e.dto.mapaId ?? e.dto.id) === id);
    if (!ainda) cacheZonas.delete(id);
  }
  src.setData({ type: "FeatureCollection", features });
  if (m.getLayer(CAMADA_ZONAS_FILL)) m.setLayoutProperty(CAMADA_ZONAS_FILL, "visibility", "visible");
}
