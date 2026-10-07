/**
 * Zonas de apresentação da condição do pasto — SAT-BUNDLE-01B [F2] R1.
 *
 * Agrupa pixels contíguos (4-vizinhos) da mesma classe 1..6, polygoniza,
 * suaviza (≤ ~10 m) e faz clip final no polígono da área.
 */
import type { CodigoClasseCondicaoPasto } from "@agro/domain";
import type { MultiPolygon, Polygon } from "geojson";
import type { GeomPoly } from "./clip-geometria";
import {
  componentes4ConexosGrade, polygonizarComponente, apresentarGeometriaZona,
  type CantosLngLat
} from "./polygonizar-grade";

export type { CantosLngLat };

export interface ZonaCondicao {
  codigo: CodigoClasseCondicaoPasto;
  type: "Feature";
  properties: { codigo: number; classe: string; componente: number; faixa?: string };
  geometry: GeomPoly;
}

const NOMES: Record<number, string> = {
  1: "vegetacao_ativa_boa_cobertura",
  2: "vegetacao_ativa_cobertura_moderada",
  3: "baixa_cobertura",
  4: "possivel_estresse_hidrico",
  5: "solo_exposto_estimado",
  6: "agua"
};

/** Reexport — testes e consumidores legados. */
export function componentes4Conexos(p: {
  pixels: Uint8Array | Uint8ClampedArray | readonly number[];
  largura: number;
  altura: number;
}) {
  return componentes4ConexosGrade({
    ...p,
    ehValido: (v) => v >= 1 && v <= 6
  });
}

export function zonasDeRasterCondicao(p: {
  pixels: Uint8Array | Uint8ClampedArray | readonly number[];
  largura: number;
  altura: number;
  cantos: CantosLngLat;
  geometriaArea?: Polygon | MultiPolygon | GeomPoly | null;
}): ZonaCondicao[] {
  const { pixels, largura, altura, cantos } = p;
  const comps = componentes4Conexos({ pixels, largura, altura });
  const out: ZonaCondicao[] = [];
  comps.forEach((comp, i) => {
    const bruto = polygonizarComponente({
      pixels: comp.pixels, largura, altura, cantos
    });
    const geometry = apresentarGeometriaZona(bruto, p.geometriaArea ?? null);
    if (!geometry) return;
    out.push({
      codigo: comp.codigo as CodigoClasseCondicaoPasto,
      type: "Feature",
      properties: {
        codigo: comp.codigo,
        classe: NOMES[comp.codigo] ?? String(comp.codigo),
        componente: i
      },
      geometry
    });
  });
  return out;
}

export function featureCollectionZonas(zonas: readonly ZonaCondicao[]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: zonas.map((z) => ({
      type: "Feature" as const,
      properties: z.properties,
      geometry: z.geometry as GeoJSON.Polygon | GeoJSON.MultiPolygon
    }))
  };
}
