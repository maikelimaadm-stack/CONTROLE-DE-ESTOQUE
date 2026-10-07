/**
 * Clip / contenção espacial para zonas temáticas — SAT-BUNDLE-01B [F2] R1.
 * Fora do polígono da área = zero geometria. Só apresentação.
 */
import booleanPointInPolygon from "@turf/boolean-point-in-polygon";
import { featureCollection, multiPolygon, point, polygon } from "@turf/helpers";
import intersect from "@turf/intersect";
import type { Feature, MultiPolygon, Polygon, Position } from "geojson";

export type GeomPoly = {
  type: "Polygon" | "MultiPolygon";
  coordinates: Position[][] | Position[][][];
};

function comoFeature(g: GeomPoly | Polygon | MultiPolygon): Feature<Polygon | MultiPolygon> | null {
  if (g.type === "Polygon") {
    const rings = g.coordinates as Position[][];
    if (!rings[0] || rings[0].length < 4) return null;
    return polygon(rings as Position[][]);
  }
  const polys = g.coordinates as Position[][][];
  const ok = polys.filter((p) => p[0] && p[0].length >= 4);
  if (ok.length === 0) return null;
  return multiPolygon(ok as Position[][][]);
}

/** Interseção com a geometria da área. Null = nada dentro. */
export function clipGeometriaComArea(
  geom: GeomPoly,
  area: Polygon | MultiPolygon | GeomPoly | null | undefined
): GeomPoly | null {
  if (!area) return geom;
  const a = comoFeature(area as GeomPoly);
  const b = comoFeature(geom);
  if (!a || !b) return null;
  try {
    const r = intersect(featureCollection([a, b]));
    if (!r?.geometry) return null;
    if (r.geometry.type !== "Polygon" && r.geometry.type !== "MultiPolygon") return null;
    return r.geometry as GeomPoly;
  } catch {
    return null;
  }
}

/** Ponto representativo do anel (média dos vértices, sem o fechamento). */
export function centroideAnel(coords: Position[]): Position {
  const n = Math.max(1, coords.length - 1);
  let x = 0, y = 0;
  for (let i = 0; i < n; i++) {
    x += coords[i]![0]!;
    y += coords[i]![1]!;
  }
  return [x / n, y / n];
}

export function pontoEmPoligono(anelExterior: Position[], p: Position): boolean {
  try {
    return booleanPointInPolygon(point(p), polygon([anelExterior]));
  } catch {
    return false;
  }
}
