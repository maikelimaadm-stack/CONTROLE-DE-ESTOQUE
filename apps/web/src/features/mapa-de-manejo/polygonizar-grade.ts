/**
 * POLYGONIZAÇÃO DE GRADE CATEGÓRICA — SAT-BUNDLE-01B [F2] R1.
 *
 * Substitui runs horizontais: cancela arestas internas, anéis com holes por
 * contenção espacial, suavização visual ≤ ~10 m, clip final no polígono da área.
 *
 * Teste fundamental: 3×3 da mesma classe → 1 Polygon (não 3 retângulos).
 */
import type { MultiPolygon, Polygon, Position } from "geojson";
import { centroideAnel, clipGeometriaComArea, pontoEmPoligono, type GeomPoly } from "./clip-geometria";

export type CantosLngLat = [[number, number], [number, number], [number, number], [number, number]];

export interface AnelLngLat {
  /** Anel fechado [lng, lat][]. */
  coords: number[][];
  /** Área assinada (lng×lat); positivo = CCW na projeção local. */
  areaAssinada: number;
}

/** ~10 m em graus (latitude); limite de deslocamento da suavização visual. */
export const TOLERANCIA_SUAVIZACAO_GRAUS = 10 / 111_320;

function canto(
  col: number, row: number, largura: number, altura: number, cantos: CantosLngLat
): [number, number] {
  const [nw, ne, se, sw] = cantos;
  const u = col / largura;
  const v = row / altura;
  const top: [number, number] = [nw[0] + (ne[0] - nw[0]) * u, nw[1] + (ne[1] - nw[1]) * u];
  const bot: [number, number] = [sw[0] + (se[0] - sw[0]) * u, sw[1] + (se[1] - sw[1]) * u];
  return [top[0] + (bot[0] - top[0]) * v, top[1] + (bot[1] - top[1]) * v];
}

/**
 * Componentes 4-conexos de classes/bins > 0. Byte 0 e valores fora de `ehValido` são ignorados.
 */
export function componentes4ConexosGrade(p: {
  pixels: Uint8Array | Uint8ClampedArray | readonly number[];
  largura: number;
  altura: number;
  ehValido?: (v: number) => boolean;
}): Array<{ codigo: number; pixels: number[] }> {
  const { pixels, largura, altura } = p;
  const ok = p.ehValido ?? ((v) => v > 0 && v < 255);
  const n = largura * altura;
  if (pixels.length !== n) throw new RangeError("polygonizar: tamanho incompatível");
  const visto = new Uint8Array(n);
  const comps: Array<{ codigo: number; pixels: number[] }> = [];
  const viz: readonly [number, number][] = [[0, 1], [0, -1], [1, 0], [-1, 0]];

  for (let i = 0; i < n; i++) {
    const b = pixels[i]!;
    if (!ok(b) || visto[i]) continue;
    const fila = [i];
    visto[i] = 1;
    const membros: number[] = [];
    while (fila.length) {
      const cur = fila.pop()!;
      membros.push(cur);
      const row = (cur / largura) | 0;
      const col = cur % largura;
      for (const [dr, dc] of viz) {
        const rr = row + dr;
        const cc = col + dc;
        if (rr < 0 || rr >= altura || cc < 0 || cc >= largura) continue;
        const j = rr * largura + cc;
        if (visto[j] || pixels[j] !== b) continue;
        visto[j] = 1;
        fila.push(j);
      }
    }
    membros.sort((a, b) => a - b);
    comps.push({ codigo: b, pixels: membros });
  }
  return comps;
}

/**
 * Contorno de um componente: arestas de unidade canceladas → anéis.
 * Cada aresta de fronteira é orientada com o interior à esquerda.
 */
export function aneisDoComponente(p: {
  pixels: readonly number[];
  largura: number;
  altura: number;
  cantos: CantosLngLat;
}): AnelLngLat[] {
  const { pixels, largura, altura, cantos } = p;
  const set = new Set(pixels);
  const dirigidas = new Set<string>();

  const addDir = (c0: number, r0: number, c1: number, r1: number) => {
    dirigidas.add(`${c0},${r0}>${c1},${r1}`);
  };

  for (const idx of pixels) {
    const row = (idx / largura) | 0;
    const col = idx % largura;
    if (row === 0 || !set.has(idx - largura)) addDir(col, row, col + 1, row);
    if (col === largura - 1 || !set.has(idx + 1)) addDir(col + 1, row, col + 1, row + 1);
    if (row === altura - 1 || !set.has(idx + largura)) addDir(col + 1, row + 1, col, row + 1);
    if (col === 0 || !set.has(idx - 1)) addDir(col, row + 1, col, row);
  }

  const saida = new Map<string, string[]>();
  for (const e of dirigidas) {
    const [a, b] = e.split(">") as [string, string];
    if (!saida.has(a)) saida.set(a, []);
    saida.get(a)!.push(b);
  }

  const usado = new Set<string>();
  const aneis: AnelLngLat[] = [];

  for (const start of saida.keys()) {
    for (const primeiro of saida.get(start) ?? []) {
      const e0 = `${start}>${primeiro}`;
      if (usado.has(e0)) continue;
      const path: string[] = [start];
      let cur = start;
      let next = primeiro;
      let guard = 0;
      while (guard++ < pixels.length * 8) {
        const e = `${cur}>${next}`;
        if (usado.has(e)) break;
        usado.add(e);
        path.push(next);
        if (next === start) break;
        const ops = saida.get(next) ?? [];
        let escolhida: string | null = null;
        for (const cand of ops) {
          if (!usado.has(`${next}>${cand}`)) { escolhida = cand; break; }
        }
        if (escolhida === null) break;
        cur = next;
        next = escolhida;
      }
      if (path[path.length - 1] !== start || path.length < 4) continue;

      const coords: number[][] = path.map((v) => {
        const [cs, rs] = v.split(",").map(Number) as [number, number];
        return canto(cs, rs, largura, altura, cantos);
      });
      let area = 0;
      for (let i = 0; i < coords.length - 1; i++) {
        const a = coords[i]!;
        const b = coords[i + 1]!;
        area += a[0]! * b[1]! - b[0]! * a[1]!;
      }
      aneis.push({ coords, areaAssinada: area / 2 });
    }
  }

  return aneis;
}

/**
 * Converte anéis em Polygon ou MultiPolygon.
 * Holes → exterior por contenção espacial do centroide (não heurística do maior).
 */
export function geometriaDosAneis(aneis: readonly AnelLngLat[]): GeomPoly {
  if (aneis.length === 0) {
    return { type: "Polygon", coordinates: [] };
  }
  const sinalExterior = Math.sign(
    aneis.reduce((m, a) => (Math.abs(a.areaAssinada) > Math.abs(m) ? a.areaAssinada : m), 0)
  ) || 1;

  const exteriores = aneis.filter((a) => Math.sign(a.areaAssinada) === sinalExterior || a.areaAssinada === 0);
  const holes = aneis.filter((a) => !exteriores.includes(a));

  const holesPorExt = new Map<number, number[][][]>();
  for (let i = 0; i < exteriores.length; i++) holesPorExt.set(i, []);

  for (const h of holes) {
    const c = centroideAnel(h.coords as Position[]);
    let dono = -1;
    for (let i = 0; i < exteriores.length; i++) {
      if (pontoEmPoligono(exteriores[i]!.coords as Position[], c)) {
        dono = i;
        break;
      }
    }
    if (dono < 0) dono = 0;
    holesPorExt.get(dono)!.push(h.coords);
  }

  if (exteriores.length === 1) {
    return {
      type: "Polygon",
      coordinates: [exteriores[0]!.coords, ...holesPorExt.get(0)!]
    };
  }

  return {
    type: "MultiPolygon",
    coordinates: exteriores.map((e, i) => [e.coords, ...holesPorExt.get(i)!])
  };
}

export function polygonizarComponente(p: {
  pixels: readonly number[];
  largura: number;
  altura: number;
  cantos: CantosLngLat;
}): GeomPoly {
  return geometriaDosAneis(aneisDoComponente(p));
}

/** Remove colineares (rede de segurança). */
export function simplificarAnelVisual(coords: number[][], toleranciaRel = 1e-9): number[][] {
  if (coords.length < 5) return coords;
  const out: number[][] = [coords[0]!];
  for (let i = 1; i < coords.length - 1; i++) {
    const a = out[out.length - 1]!;
    const b = coords[i]!;
    const c = coords[i + 1]!;
    const area = Math.abs((b[0]! - a[0]!) * (c[1]! - a[1]!) - (b[1]! - a[1]!) * (c[0]! - a[0]!));
    if (area > toleranciaRel) out.push(b);
  }
  out.push(coords[coords.length - 1]!);
  if (out.length < 4) return coords;
  return out;
}

/**
 * Suavização visual conservadora (Chaikin 1 passo + clamp ≤ ~10 m).
 * Não altera classe/estatística — só contorno. Inválida → devolve bruto.
 */
export function suavizarAnelVisual(
  coords: number[][],
  maxDeslocGraus = TOLERANCIA_SUAVIZACAO_GRAUS
): number[][] {
  if (coords.length < 5) return coords;
  const aberto = coords[0]![0] === coords[coords.length - 1]![0]
    && coords[0]![1] === coords[coords.length - 1]![1]
    ? coords.slice(0, -1)
    : coords.slice();
  if (aberto.length < 3) return coords;

  // Chaikin: novos pontos a 1/4 e 3/4 de cada aresta.
  const chaikin: number[][] = [];
  for (let i = 0; i < aberto.length; i++) {
    const a = aberto[i]!;
    const b = aberto[(i + 1) % aberto.length]!;
    chaikin.push([
      a[0]! * 0.75 + b[0]! * 0.25,
      a[1]! * 0.75 + b[1]! * 0.25
    ]);
    chaikin.push([
      a[0]! * 0.25 + b[0]! * 0.75,
      a[1]! * 0.25 + b[1]! * 0.75
    ]);
  }

  // Clamp: cada vértice suavizado não se afasta mais que maxDesloc do original mais próximo.
  const clamped = chaikin.map((p) => {
    let melhor = aberto[0]!;
    let dMin = Infinity;
    for (const o of aberto) {
      const d = (p[0]! - o[0]!) ** 2 + (p[1]! - o[1]!) ** 2;
      if (d < dMin) { dMin = d; melhor = o; }
    }
    const dx = p[0]! - melhor[0]!;
    const dy = p[1]! - melhor[1]!;
    const dist = Math.hypot(dx, dy);
    if (dist <= maxDeslocGraus || dist === 0) return p;
    const f = maxDeslocGraus / dist;
    return [melhor[0]! + dx * f, melhor[1]! + dy * f];
  });

  const fechado = [...clamped, clamped[0]!];
  const limpo = simplificarAnelVisual(fechado, 1e-14);
  if (limpo.length < 4) return coords;
  // Self-intersection grosseira: área assinada muda de sinal ou vira 0 → fallback.
  let area = 0;
  for (let i = 0; i < limpo.length - 1; i++) {
    area += limpo[i]![0]! * limpo[i + 1]![1]! - limpo[i + 1]![0]! * limpo[i]![1]!;
  }
  if (!Number.isFinite(area) || Math.abs(area) < 1e-18) return coords;
  return limpo;
}

export function suavizarGeometriaVisual(g: GeomPoly): GeomPoly {
  if (g.type === "Polygon") {
    const rings = (g.coordinates as number[][][]).map((r) => suavizarAnelVisual(r));
    if (rings.some((r) => r.length < 4)) return g;
    return { type: "Polygon", coordinates: rings };
  }
  const polys = (g.coordinates as number[][][][]).map((poly) =>
    poly.map((r) => suavizarAnelVisual(r))
  );
  if (polys.some((poly) => poly.some((r) => r.length < 4))) return g;
  return { type: "MultiPolygon", coordinates: polys };
}

/**
 * Pipeline de apresentação: bruto → suavizar → clip na área.
 * Clip falho ou vazio → tenta clip do bruto; ainda vazio → null.
 */
export function apresentarGeometriaZona(
  bruto: GeomPoly,
  area: Polygon | MultiPolygon | GeomPoly | null | undefined
): GeomPoly | null {
  const suavizada = suavizarGeometriaVisual(bruto);
  const clipSuave = clipGeometriaComArea(suavizada, area);
  if (clipSuave) return clipSuave;
  return clipGeometriaComArea(bruto, area);
}
