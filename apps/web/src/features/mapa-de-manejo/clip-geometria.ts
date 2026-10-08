/**
 * Clip / contenção espacial para zonas temáticas — SAT-BUNDLE-01B [F2] + prova por diferença.
 * Fora do polígono da área = zero geometria. Sem área válida = null (nunca desenha sem recorte).
 */
import area from "@turf/area";
import booleanPointInPolygon from "@turf/boolean-point-in-polygon";
import { featureCollection, multiPolygon, point, polygon } from "@turf/helpers";
import intersect from "@turf/intersect";
import type { Feature, MultiPolygon, Polygon, Position } from "geojson";

export type GeomPoly = {
  type: "Polygon" | "MultiPolygon";
  coordinates: Position[][] | Position[][][];
};

/** Resultado discriminado: vazio legítimo ≠ falha geométrica ≠ sem área. */
export type ClipDetalhe =
  | { status: "ok"; geom: GeomPoly }
  | { status: "sem_area" }
  | { status: "invalido" }
  | { status: "vazio" }
  | { status: "erro" };

function comoFeature(g: GeomPoly | Polygon | MultiPolygon): Feature<Polygon | MultiPolygon> | null {
  try {
    if (g.type === "Polygon") {
      const rings = g.coordinates as Position[][];
      if (!rings[0] || rings[0].length < 4) return null;
      return polygon(rings as Position[][]);
    }
    const polys = g.coordinates as Position[][][];
    const ok = polys.filter((p) => p[0] && p[0].length >= 4);
    if (ok.length === 0) return null;
    return multiPolygon(ok as Position[][][]);
  } catch {
    return null;
  }
}

/**
 * Clip com status discriminado (para UI/diagnóstico).
 * `comoFeature` fica dentro do fluxo — geometria inválida não derruba a tela.
 */
export function clipGeometriaComAreaDetalhe(
  geom: GeomPoly,
  areaGeom: Polygon | MultiPolygon | GeomPoly | null | undefined
): ClipDetalhe {
  if (!areaGeom) return { status: "sem_area" };
  const a = comoFeature(areaGeom as GeomPoly);
  const b = comoFeature(geom);
  if (!a || !b) return { status: "invalido" };
  try {
    const r = intersect(featureCollection([a, b]));
    if (!r?.geometry) return { status: "vazio" };
    if (r.geometry.type !== "Polygon" && r.geometry.type !== "MultiPolygon") return { status: "vazio" };
    return { status: "ok", geom: r.geometry as GeomPoly };
  } catch {
    return { status: "erro" };
  }
}

/**
 * Interseção com a geometria da área (fail-closed).
 * - Sem área / inválida / vazia / erro → null (não vaza o footprint).
 */
export function clipGeometriaComArea(
  geom: GeomPoly,
  areaGeom: Polygon | MultiPolygon | GeomPoly | null | undefined
): GeomPoly | null {
  const d = clipGeometriaComAreaDetalhe(geom, areaGeom);
  return d.status === "ok" ? d.geom : null;
}

/** Área em m² (Turf/geodesic). Não usar graus². */
export function areaM2(g: GeomPoly | Polygon | MultiPolygon): number {
  const f = comoFeature(g as GeomPoly);
  if (!f) return 0;
  try {
    return area(f);
  } catch {
    return 0;
  }
}

/**
 * Vazamento: área(camada) − área(camada ∩ polígono), em m².
 * Contido perfeitamente → ~0. Tolerância típica de teste: 1 m² (ruído numérico).
 */
export function areaVazamentoM2(
  camada: GeomPoly,
  areaCadastro: Polygon | MultiPolygon | GeomPoly
): number {
  const a = comoFeature(areaCadastro as GeomPoly);
  const b = comoFeature(camada);
  if (!a || !b) return areaM2(camada);
  try {
    const inter = intersect(featureCollection([a, b]));
    const areaCamada = area(b);
    const areaInter = inter?.geometry ? area(inter) : 0;
    return Math.max(0, areaCamada - areaInter);
  } catch {
    return areaM2(camada);
  }
}

/**
 * Cobertura ausente em relação a um suporte esperado (ex.: grade toda válida dentro do pasto), em m²:
 * área(esperado) − área(esperado ∩ obtido).
 */
export function areaAusenteM2(
  esperado: GeomPoly | Polygon | MultiPolygon,
  obtido: GeomPoly | Polygon | MultiPolygon | null | undefined
): number {
  if (!obtido) return areaM2(esperado as GeomPoly);
  const a = comoFeature(esperado as GeomPoly);
  const b = comoFeature(obtido as GeomPoly);
  if (!a) return 0;
  if (!b) return area(a);
  try {
    const inter = intersect(featureCollection([a, b]));
    const areaEsp = area(a);
    const areaInter = inter?.geometry ? area(inter) : 0;
    return Math.max(0, areaEsp - areaInter);
  } catch {
    return area(a);
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
  areaGeom: Polygon | MultiPolygon | GeomPoly,
  p: Position
): boolean {
  const f = comoFeature(areaGeom as GeomPoly);
  if (!f) return false;
  try {
    return booleanPointInPolygon(point(p), f);
  } catch {
    return false;
  }
}

/**
 * Amostra densa dos vértices (sem usar centroide como prova de vazamento — côncavo/buraco).
 * Complemento da diferença por área, não substituto.
 */
export function amostrarVazamentoForaDaArea(
  geom: GeomPoly,
  areaGeom: Polygon | MultiPolygon | GeomPoly,
  passo = 1
): { fora: number; total: number } {
  const verts: Position[] = [];
  const pushAnel = (anel: Position[]) => {
    for (let i = 0; i < anel.length - 1; i += passo) verts.push(anel[i]!);
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
    if (!pontoNaArea(areaGeom, v)) fora++;
  }
  return { fora, total: verts.length };
}
