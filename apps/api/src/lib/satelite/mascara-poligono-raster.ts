/**
 * MÁSCARA GEOMÉTRICA DO RASTER CATEGÓRICO — MAPA-UX-02.
 *
 * FORA_DO_POLIGONO ≠ SEM_LEITURA. A Process API devolve um retângulo (bbox da grade);
 * só o centro do pixel DENTRO do polígono (anel externo menos furos) conta no universo.
 *
 * Puro: sem rede, sem banco, sem DOM. CRS: polígono CRS84 → Web Mercator (mesma grade
 * EPSG:3857 de `planejarGradeRaster`).
 *
 * Regra de borda: o CENTRO do pixel decide (col+0.5, row+0.5). Determinístico.
 */
import { deLngLatPara3857, type GradeRaster } from "./raster.js";
import type { PoligonoGeoJson } from "./geometria.js";

export type MascaraPoligonoRaster = Uint8Array; // 1 = dentro, 0 = fora

/** Ponto em anel (ray casting). Borda: ponto sobre aresta conta como DENTRO. Anel GeoJSON fechado (primeiro=último). */
function pontoNoAnel(x: number, y: number, anel: readonly [number, number][]): boolean {
  // Ignora o vértice de fechamento duplicado.
  const n = anel.length >= 2
    && anel[0]![0] === anel[anel.length - 1]![0]
    && anel[0]![1] === anel[anel.length - 1]![1]
    ? anel.length - 1
    : anel.length;
  if (n < 3) return false;
  let dentro = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const [xi, yi] = anel[i]!;
    const [xj, yj] = anel[j]!;
    const dx = xj - xi, dy = yj - yi;
    const cross = (x - xi) * dy - (y - yi) * dx;
    if (Math.abs(cross) <= 1e-6 * Math.max(1, Math.hypot(dx, dy))) {
      const dot = (x - xi) * dx + (y - yi) * dy;
      if (dot >= -1e-6 && dot <= dx * dx + dy * dy + 1e-6) return true;
    }
    const cruza = (yi > y) !== (yj > y);
    if (cruza) {
      const xInter = ((xj - xi) * (y - yi)) / (yj - yi) + xi;
      if (x < xInter) dentro = !dentro;
    }
  }
  return dentro;
}

/** Dentro do polígono com furos: no exterior e fora de todos os furos. */
export function pontoNoPoligono3857(x: number, y: number, aneis3857: readonly [number, number][][]): boolean {
  if (aneis3857.length === 0) return false;
  if (!pontoNoAnel(x, y, aneis3857[0]!)) return false;
  for (let i = 1; i < aneis3857.length; i++) {
    if (pontoNoAnel(x, y, aneis3857[i]!)) return false;
  }
  return true;
}

/**
 * Rasteriza a máscara na grade: 1 se o centro do pixel está dentro do polígono.
 * Origem da imagem: canto NOROESTE (row 0 = norte), igual aos cantos MapLibre da grade.
 */
export function mascaraPoligonoNaGrade(poligono: PoligonoGeoJson, grade: GradeRaster): MascaraPoligonoRaster {
  const aneis3857 = poligono.coordinates.map((anel) =>
    anel.map(([lng, lat]) => deLngLatPara3857(lng, lat) as [number, number])
  );
  const [bx0, by0, bx1, by1] = grade.bbox3857;
  const px = (bx1 - bx0) / grade.largura;
  const py = (by1 - by0) / grade.altura;
  const n = grade.largura * grade.altura;
  const mascara = new Uint8Array(n);
  for (let row = 0; row < grade.altura; row++) {
    const y = by1 - (row + 0.5) * py;
    for (let col = 0; col < grade.largura; col++) {
      const x = bx0 + (col + 0.5) * px;
      mascara[row * grade.largura + col] = pontoNoPoligono3857(x, y, aneis3857) ? 1 : 0;
    }
  }
  return mascara;
}
