/**
 * Clip / contenção espacial para zonas temáticas — SAT-BUNDLE-01B [F2] R1 + correção fail-closed.
 * Fora do polígono da área = zero geometria. Sem área válida = null (nunca desenha sem recorte).
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

/**
 * Interseção com a geometria da área.
 * - Sem área / área inválida → null (fail-closed: não publica geometria sem recorte).
 * - Interseção vazia ou erro geométrico → null (não vaza o footprint do raster).
 */
export function clipGeometriaComArea(
  geom: GeomPoly,
  area: Polygon | MultiPolygon | GeomPoly | null | undefined
): GeomPoly | null {
  if (!area) return null;
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

/** Contém o ponto na geometria (Polygon ou MultiPolygon), inclusive buracos via turf. */
export function pontoNaArea(
  area: Polygon | MultiPolygon | GeomPoly,
  p: Position
): boolean {
  const f = comoFeature(area as GeomPoly);
  if (!f) return false;
  try {
    return booleanPointInPolygon(point(p), f);
  } catch {
    return false;
  }
}

/**
 * Amostra densa dos vértices (+ centroides de anéis) e conta quantos caem fora da área.
 * Usado em testes de contenção (diferença geométrica amostrada).
 */
export function amostrarVazamentoForaDaArea(
  geom: GeomPoly,
  area: Polygon | MultiPolygon | GeomPoly,
  passo = 1
): { fora: number; total: number } {
  const verts: Position[] = [];
  const pushAnel = (anel: Position[]) => {
    for (let i = 0; i < anel.length - 1; i += passo) verts.push(anel[i]!);
    if (anel.length >= 4) verts.push(centroideAnel(anel));
  };
  if (geom.type === "Polygon") {
    for (const anel of geom.coordinates as Position[][]) pushAnel(anel);
  } else {
    for (const poly of geom.coordinates as Position[][][]) {
      for (const anel of poly) pushAnel(anel);
    }
  }
  let fora = 0;
  for (const v of verts) {
    if (!pontoNaArea(area, v)) fora++;
  }
  return { fora, total: verts.length };
}
