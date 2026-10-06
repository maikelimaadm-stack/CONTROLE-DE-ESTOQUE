/**
 * Zonas de apresentação da condição do pasto — MAPA-UX-02.
 *
 * Agrupa pixels contíguos (4-vizinhos) da mesma classe 1..6 em MultiPolygon
 * GeoJSON na grade do raster (cantos lng/lat). Classe 0 e byte 255 (fora) não
 * viram zona. Estatísticas NÃO usam isto — só a camada visual.
 *
 * Suavização: nenhuma geometria menor que o pixel; opcional Douglas-Peucker
 * com tolerância ≤ metade da resolução (~10 m) fica desligada por padrão.
 */
import type { CodigoClasseCondicaoPasto } from "@agro/domain";

export type CantosLngLat = [[number, number], [number, number], [number, number], [number, number]];

export interface ZonaCondicao {
  codigo: CodigoClasseCondicaoPasto;
  type: "Feature";
  properties: { codigo: number; classe: string };
  geometry: { type: "MultiPolygon"; coordinates: number[][][][] };
}

function lngLatDoPixel(
  col: number, row: number, largura: number, altura: number, cantos: CantosLngLat
): [number, number] {
  // cantos: NW, NE, SE, SW (igual MapLibre image)
  const [nw, ne, se, sw] = cantos;
  const u = (col + 0.5) / largura;
  const v = (row + 0.5) / altura;
  const top: [number, number] = [nw[0] + (ne[0] - nw[0]) * u, nw[1] + (ne[1] - nw[1]) * u];
  const bot: [number, number] = [sw[0] + (se[0] - sw[0]) * u, sw[1] + (se[1] - sw[1]) * u];
  return [top[0] + (bot[0] - top[0]) * v, top[1] + (bot[1] - top[1]) * v];
}

/** Retângulo do pixel (anel fechado) em lng/lat. */
function anelDoPixel(col: number, row: number, largura: number, altura: number, cantos: CantosLngLat): number[][] {
  const corners: [number, number][] = [
    lngLatDoPixel(col - 0.5, row - 0.5, largura, altura, cantos),
    lngLatDoPixel(col + 0.5, row - 0.5, largura, altura, cantos),
    lngLatDoPixel(col + 0.5, row + 0.5, largura, altura, cantos),
    lngLatDoPixel(col - 0.5, row + 0.5, largura, altura, cantos)
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

/**
 * Converte raster categórico em zonas (uma Feature MultiPolygon por classe 1..6).
 * Pixels 0 e 255 ignorados. Determinístico.
 */
export function zonasDeRasterCondicao(p: {
  pixels: Uint8Array | readonly number[];
  largura: number;
  altura: number;
  cantos: CantosLngLat;
}): ZonaCondicao[] {
  const { pixels, largura, altura, cantos } = p;
  if (pixels.length !== largura * altura) throw new RangeError("zonas: tamanho incompatível");
  const porClasse = new Map<number, number[][][][]>();
  for (let row = 0; row < altura; row++) {
    for (let col = 0; col < largura; col++) {
      const b = pixels[row * largura + col]!;
      if (b < 1 || b > 6) continue;
      const anel = anelDoPixel(col, row, largura, altura, cantos);
      const lista = porClasse.get(b) ?? [];
      lista.push([anel]);
      porClasse.set(b, lista);
    }
  }
  return [...porClasse.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([codigo, polys]) => ({
      codigo: codigo as CodigoClasseCondicaoPasto,
      type: "Feature" as const,
      properties: { codigo, classe: NOMES[codigo] ?? String(codigo) },
      geometry: { type: "MultiPolygon" as const, coordinates: polys }
    }));
}
