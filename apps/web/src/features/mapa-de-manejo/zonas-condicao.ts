/**
 * Zonas de apresentação da condição do pasto — MAPA-UX-02.
 *
 * Agrupa pixels contíguos (4-vizinhos) da mesma classe 1..6 em componentes
 * conexos; cada componente vira uma Feature MultiPolygon na grade do raster
 * (cantos lng/lat). Retângulos de pixel (ou runs horizontais) são aceitos —
 * sem dissolve topológico. Classe 0 e byte 255 (fora) não viram zona.
 * Estatísticas NÃO usam isto — só a camada visual.
 */
import type { CodigoClasseCondicaoPasto } from "@agro/domain";

export type CantosLngLat = [[number, number], [number, number], [number, number], [number, number]];

export interface ZonaCondicao {
  codigo: CodigoClasseCondicaoPasto;
  type: "Feature";
  properties: { codigo: number; classe: string; componente: number };
  geometry: { type: "MultiPolygon"; coordinates: number[][][][] };
}

function lngLatDoPixel(
  col: number, row: number, largura: number, altura: number, cantos: CantosLngLat
): [number, number] {
  const [nw, ne, se, sw] = cantos;
  const u = (col + 0.5) / largura;
  const v = (row + 0.5) / altura;
  const top: [number, number] = [nw[0] + (ne[0] - nw[0]) * u, nw[1] + (ne[1] - nw[1]) * u];
  const bot: [number, number] = [sw[0] + (se[0] - sw[0]) * u, sw[1] + (se[1] - sw[1]) * u];
  return [top[0] + (bot[0] - top[0]) * v, top[1] + (bot[1] - top[1]) * v];
}

function anelDoRun(
  colIni: number, colFimExcl: number, row: number,
  largura: number, altura: number, cantos: CantosLngLat
): number[][] {
  const corners: [number, number][] = [
    lngLatDoPixel(colIni - 0.5, row - 0.5, largura, altura, cantos),
    lngLatDoPixel(colFimExcl - 0.5, row - 0.5, largura, altura, cantos),
    lngLatDoPixel(colFimExcl - 0.5, row + 0.5, largura, altura, cantos),
    lngLatDoPixel(colIni - 0.5, row + 0.5, largura, altura, cantos)
  ];
  return [...corners.map((c) => [c[0], c[1]]), [corners[0]![0], corners[0]![1]]];
}

const NOMES: Record<number, string> = {
  1: "vegetacao_ativa_boa_cobertura",
  2: "vegetacao_ativa_cobertura_moderada",
  3: "baixa_cobertura",
  4: "possivel_estresse_hidrico",
  5: "solo_exposto_estimado",
  6: "agua"
};

const VIZINHOS: readonly [number, number][] = [[0, 1], [0, -1], [1, 0], [-1, 0]];

interface Componente {
  codigo: number;
  pixels: number[];
  minRow: number;
  minCol: number;
}

export function componentes4Conexos(p: {
  pixels: Uint8Array | Uint8ClampedArray | readonly number[];
  largura: number;
  altura: number;
}): Componente[] {
  const { pixels, largura, altura } = p;
  const n = largura * altura;
  if (pixels.length !== n) throw new RangeError("zonas: tamanho incompatível");
  const visto = new Uint8Array(n);
  const comps: Componente[] = [];

  for (let i = 0; i < n; i++) {
    const b = pixels[i]!;
    if (b < 1 || b > 6 || visto[i]) continue;
    const fila: number[] = [i];
    visto[i] = 1;
    const membros: number[] = [];
    let minRow = (i / largura) | 0;
    let minCol = i % largura;
    while (fila.length > 0) {
      const cur = fila.pop()!;
      membros.push(cur);
      const row = (cur / largura) | 0;
      const col = cur % largura;
      if (row < minRow || (row === minRow && col < minCol)) {
        minRow = row;
        minCol = col;
      }
      for (const [dr, dc] of VIZINHOS) {
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
    comps.push({ codigo: b, pixels: membros, minRow, minCol });
  }

  comps.sort((a, b) => a.codigo - b.codigo || a.minRow - b.minRow || a.minCol - b.minCol);
  return comps;
}

function poligonosDoComponente(
  comp: Componente, largura: number, altura: number, cantos: CantosLngLat
): number[][][][] {
  const set = new Set(comp.pixels);
  const polys: number[][][][] = [];
  for (const idx of comp.pixels) {
    const row = (idx / largura) | 0;
    const col = idx % largura;
    const esq = col === 0 ? -1 : idx - 1;
    if (esq >= 0 && set.has(esq)) continue;
    let cFim = col + 1;
    while (cFim < largura && set.has(row * largura + cFim)) cFim += 1;
    polys.push([anelDoRun(col, cFim, row, largura, altura, cantos)]);
  }
  return polys;
}

export function zonasDeRasterCondicao(p: {
  pixels: Uint8Array | Uint8ClampedArray | readonly number[];
  largura: number;
  altura: number;
  cantos: CantosLngLat;
}): ZonaCondicao[] {
  const { pixels, largura, altura, cantos } = p;
  const comps = componentes4Conexos({ pixels, largura, altura });
  return comps.map((comp, i) => ({
    codigo: comp.codigo as CodigoClasseCondicaoPasto,
    type: "Feature" as const,
    properties: {
      codigo: comp.codigo,
      classe: NOMES[comp.codigo] ?? String(comp.codigo),
      componente: i
    },
    geometry: {
      type: "MultiPolygon" as const,
      coordinates: poligonosDoComponente(comp, largura, altura, cantos)
    }
  }));
}

export function featureCollectionZonas(zonas: readonly ZonaCondicao[]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: zonas.map((z) => ({
      type: "Feature",
      properties: z.properties,
      geometry: z.geometry
    }))
  };
}
