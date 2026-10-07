/**
 * Camada MapLibre das zonas temáticas (condição + isobands) — SAT-BUNDLE-01B [F2] R1.
 *
 * Modo operacional: SOMENTE fill GeoJSON. PNG/raster bruto NÃO é apresentação.
 */
import { CLASSES_CONDICAO_PASTO } from "@agro/domain";
import type { GeoJSONSource, Map as MapLibreMap } from "maplibre-gl";
import type { MultiPolygon, Polygon } from "geojson";
import { ANTES_DO_CONTORNO } from "./camada-rasters";
import { assinaturaDaGeometria } from "./cache-rasters";
import type { EntradaRasterEmMemoria } from "./rasters-indice";
import { featureCollectionZonas, zonasDeRasterCondicao, type CantosLngLat } from "./zonas-condicao";
import { featureCollectionIsobandas, isobandasDoRaster } from "./isobandas";
import type { GeomPoly } from "./clip-geometria";
import { indiceFonteDoTema, type TemaMapaPasto } from "./temas-mapa-pasto";

export const FONTE_ZONAS_CONDICAO = "condicao-zonas";
export const CAMADA_ZONAS_FILL = "condicao-zonas-fill";
/** Operacional: PNG sob zonas desligado (01B). Mantido 0 para não regressar a “Minecraft”. */
export const OPACIDADE_PNG_SOB_ZONAS = 0;

type EntradaComMapa = EntradaRasterEmMemoria & {
  dto: EntradaRasterEmMemoria["dto"] & { mapaId?: string };
};

interface CacheEntry { chave: string; fc: GeoJSON.FeatureCollection; }
const cacheZonas = new Map<string, CacheEntry>();

function cantosValidos(c: unknown): c is CantosLngLat {
  return Array.isArray(c) && c.length === 4 && c.every((p) => Array.isArray(p) && p.length === 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]));
}

function chaveCache(
  id: string, bytesLen: number, largura: number, altura: number, tema: string, geoKey: string
): string {
  return `${id}|${tema}|${bytesLen}|${largura}x${altura}|${geoKey}`;
}

/** Identidade geométrica real — não o tamanho da string JSON. */
export function geoKey(g: Polygon | MultiPolygon | GeomPoly | null | undefined): string {
  if (!g) return "0";
  return assinaturaDaGeometria(g);
}

export function featureCollectionDaEntrada(
  ent: EntradaComMapa,
  geometriaArea?: Polygon | MultiPolygon | GeomPoly | null
): GeoJSON.FeatureCollection | null {
  if (ent.erro || !ent.bytesCinza.length || !cantosValidos(ent.dto.cantos_lnglat)) return null;
  const mapaId = ent.dto.mapaId ?? ent.dto.id;
  const gk = geoKey(geometriaArea);
  const chave = chaveCache(mapaId, ent.bytesCinza.length, ent.largura, ent.altura, "condicao", gk);
  const hit = cacheZonas.get(mapaId);
  if (hit && hit.chave === chave) return hit.fc;
  const zonas = zonasDeRasterCondicao({
    pixels: ent.bytesCinza, largura: ent.largura, altura: ent.altura,
    cantos: ent.dto.cantos_lnglat, geometriaArea
  });
  const fc = featureCollectionZonas(zonas);
  cacheZonas.set(mapaId, { chave, fc });
  return fc;
}

export function featureCollectionTematicaDaEntrada(
  ent: EntradaComMapa,
  tema: TemaMapaPasto,
  geometriaArea?: Polygon | MultiPolygon | GeomPoly | null
): GeoJSON.FeatureCollection | null {
  if (tema === "condicao") return featureCollectionDaEntrada(ent, geometriaArea);
  const indice = indiceFonteDoTema(tema);
  if (!indice || ent.erro || !ent.bytesCinza.length || !cantosValidos(ent.dto.cantos_lnglat)) return null;
  const id = ent.dto.mapaId ?? ent.dto.id;
  const gk = geoKey(geometriaArea);
  const chave = chaveCache(id, ent.bytesCinza.length, ent.largura, ent.altura, tema, gk);
  const cacheId = `${id}:${tema}`;
  const hit = cacheZonas.get(cacheId);
  if (hit && hit.chave === chave) return hit.fc;
  const feats = isobandasDoRaster({
    pixels: ent.bytesCinza, largura: ent.largura, altura: ent.altura,
    cantos: ent.dto.cantos_lnglat, indice, tema, geometriaArea
  });
  const fc = featureCollectionIsobandas(feats);
  cacheZonas.set(cacheId, { chave, fc });
  return fc;
}

export function limparCacheZonasCondicao() { cacheZonas.clear(); }

function expressaoCorFill(): unknown[] {
  const pares: unknown[] = ["case", ["has", "cor"], ["get", "cor"]];
  const match: unknown[] = ["match", ["get", "codigo"]];
  for (const c of CLASSES_CONDICAO_PASTO) {
    if (c.codigo === 0) continue;
    match.push(c.codigo, c.cor);
  }
  match.push("#94a3b8");
  pares.push(match);
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
      filter: [">=", ["get", "codigo"], 1],
      paint: {
        "fill-antialias": true,
        "fill-color": expressaoCorFill() as unknown as string,
        "fill-opacity": [
          "case",
          ["==", ["feature-state", "apagada"], true], 0.12,
          ["==", ["get", "faixa"], "sem_leitura"], 0.25,
          0.92
        ],
        "fill-outline-color": "rgba(0,0,0,0)"
      }
    }, antes);
  }
}

export function sincronizarZonasCondicaoNoMapa(
  m: MapLibreMap,
  porArea: ReadonlyMap<string, EntradaComMapa>,
  visivel: boolean,
  tema: TemaMapaPasto = "condicao",
  geometriasPorArea?: ReadonlyMap<string, Polygon | MultiPolygon | GeomPoly | null | undefined>,
  faixaDestaque?: string | null
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
    const geo = geometriasPorArea?.get(areaId) ?? null;
    const fc = featureCollectionTematicaDaEntrada(ent, tema, geo);
    if (!fc) continue;
    for (const f of fc.features) {
      const props = f.properties ?? {};
      const faixa = typeof props.faixa === "string" ? props.faixa
        : typeof props.classe === "string" ? props.classe
          : null;
      const apagada = Boolean(faixaDestaque && faixa && faixa !== faixaDestaque
        && String(props.codigo) !== faixaDestaque);
      features.push({
        type: "Feature",
        id: features.length,
        properties: { ...props, area_id: areaId, apagada },
        geometry: f.geometry
      });
    }
  }
  src.setData({ type: "FeatureCollection", features });
  if (m.getLayer(CAMADA_ZONAS_FILL)) {
    m.setLayoutProperty(CAMADA_ZONAS_FILL, "visibility", "visible");
    // Opacidade: faixa selecionada plena; demais atenuadas.
    m.setPaintProperty(CAMADA_ZONAS_FILL, "fill-opacity", faixaDestaque
      ? [
          "case",
          ["==", ["get", "faixa"], faixaDestaque], 0.95,
          ["==", ["get", "classe"], faixaDestaque], 0.95,
          ["==", ["to-string", ["get", "codigo"]], faixaDestaque], 0.95,
          0.12
        ]
      : [
          "case",
          ["==", ["get", "faixa"], "sem_leitura"], 0.25,
          0.92
        ]);
  }
}
