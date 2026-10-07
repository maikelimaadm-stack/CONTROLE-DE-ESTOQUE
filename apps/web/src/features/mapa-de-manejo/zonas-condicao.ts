/**
 * Zonas de apresentação da condição do pasto — SAT-BUNDLE-01B [F2].
 *
 * Agrupa pixels contíguos (4-vizinhos) da mesma classe 1..6 e polygoniza com
 * cancelamento de arestas internas (1 Polygon por blob — não runs horizontais).
 * Classe 0 e byte 255 (fora) não viram zona. Estatísticas NÃO usam isto.
 */
import type { CodigoClasseCondicaoPasto } from "@agro/domain";
import {
  componentes4ConexosGrade, polygonizarComponente, simplificarAnelVisual,
  type CantosLngLat
} from "./polygonizar-grade";

export type { CantosLngLat };

export interface ZonaCondicao {
  codigo: CodigoClasseCondicaoPasto;
  type: "Feature";
  properties: { codigo: number; classe: string; componente: number; faixa?: string };
  geometry: { type: "Polygon" | "MultiPolygon"; coordinates: number[][][] | number[][][][] };
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

function simplificarGeom(
  g: { type: "Polygon" | "MultiPolygon"; coordinates: number[][][] | number[][][][] }
): typeof g {
  if (g.type === "Polygon") {
    const rings = (g.coordinates as number[][][]).map((r) => simplificarAnelVisual(r));
    if (rings.some((r) => r.length < 4)) return g;
    return { type: "Polygon", coordinates: rings };
  }
  const polys = (g.coordinates as number[][][][]).map((poly) =>
    poly.map((r) => simplificarAnelVisual(r))
  );
  if (polys.some((poly) => poly.some((r) => r.length < 4))) return g;
  return { type: "MultiPolygon", coordinates: polys };
}

export function zonasDeRasterCondicao(p: {
  pixels: Uint8Array | Uint8ClampedArray | readonly number[];
  largura: number;
  altura: number;
  cantos: CantosLngLat;
}): ZonaCondicao[] {
  const { pixels, largura, altura, cantos } = p;
  const comps = componentes4Conexos({ pixels, largura, altura });
  return comps.map((comp, i) => {
    const bruto = polygonizarComponente({
      pixels: comp.pixels, largura, altura, cantos
    });
    const geometry = simplificarGeom(bruto);
    return {
      codigo: comp.codigo as CodigoClasseCondicaoPasto,
      type: "Feature" as const,
      properties: {
        codigo: comp.codigo,
        classe: NOMES[comp.codigo] ?? String(comp.codigo),
        componente: i
      },
      geometry
    };
  });
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
