import booleanPointInPolygon from "@turf/boolean-point-in-polygon";
import type { Polygon, Position } from "geojson";

/**
 * MAPA-MANEJO-04 (F2) — CAMADA 4: PONTO EM POLÍGONO, para achar a área onde o lote arrastado foi solto.
 *
 * É o ÚNICO cálculo geométrico da tela do mapa operacional (declarado na decisão 308): posição, não regra. Não existe
 * função de domínio para isto (packages/domain não tem ponto-em-polígono); o algoritmo é o da dependência que o web
 * já tem (`@turf/boolean-point-in-polygon`, a mesma do recorte do /mapa-geral em clip-geometria.ts), sem reimplementar:
 *   - par-ímpar (cruzamentos de um raio) somado em TODOS os anéis — o externo e os furos: ponto dentro de um furo
 *     cruza o anel do furo também, e a contagem fica par (fora);
 *   - BORDA conta como DENTRO (inclusive a borda de um furo): soltar exatamente na divisa não é "fora de qualquer área";
 *   - polígono côncavo (em L) é tratado pelo mesmo par-ímpar: o canto vazio fica fora.
 *
 * Nada de área, centróide ou distância aqui: só "o ponto está dentro?".
 */

/** Ponto geográfico (o `LngLat` do MapLibre convertido; o mesmo formato do `centroide` da API). */
export interface PontoGeografico {
  lon: number;
  lat: number;
}

const posicaoFinita = (p: Position | undefined): p is Position =>
  Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]);

/**
 * O anel como o algoritmo exige: ao menos três vértices distintos e FECHADO (o último igual ao primeiro). Anel aberto
 * é fechado numa cópia; anel com posição não numérica ou com menos de três vértices é inválido (`null`).
 */
function anelUtil(anel: readonly Position[] | undefined): Position[] | null {
  if (!Array.isArray(anel) || !anel.every(posicaoFinita)) return null;
  const primeiro = anel[0];
  const ultimo = anel[anel.length - 1];
  if (!primeiro || !ultimo) return null;
  const fechado = primeiro[0] === ultimo[0] && primeiro[1] === ultimo[1] ? [...anel] : [...anel, primeiro];
  return fechado.length >= 4 ? fechado : null;
}

/**
 * O ponto está dentro do polígono (borda inclusa)? Furos (anéis internos) ficam fora. Geometria ausente, que não é
 * `Polygon` ou com anel externo inválido: `false` — não há onde soltar. Furo inválido é ignorado (o externo vale).
 */
export function pontoNoPoligono(p: PontoGeografico, geometria: Polygon | null | undefined): boolean {
  if (!Number.isFinite(p.lon) || !Number.isFinite(p.lat)) return false;
  if (!geometria || geometria.type !== "Polygon" || !Array.isArray(geometria.coordinates)) return false;
  const [externo, ...internos] = geometria.coordinates;
  const anelExterno = anelUtil(externo);
  if (!anelExterno) return false;
  const furos = internos.map(anelUtil).filter((a): a is Position[] => a !== null);
  return booleanPointInPolygon([p.lon, p.lat], { type: "Polygon", coordinates: [anelExterno, ...furos] });
}

/** O que a busca lê de cada área (a `AreaOperacional` da API satisfaz). */
export interface AreaComGeometria {
  id: string;
  geometria: Polygon | null;
}

/**
 * O id da área que contém o ponto, ou `null` (fora de qualquer área). Áreas sobrepostas: vale a de CIMA no mapa — a
 * última da lista, porque a fonte `areas` desenha as áreas na ordem da resposta (mapa-base.tsx, `desenharAreas`) e a
 * última fica por cima. Assim o destino é o que a pessoa vê sob o dedo.
 */
export function areaNoPontoGeografico(p: PontoGeografico, areas: readonly AreaComGeometria[]): string | null {
  for (let i = areas.length - 1; i >= 0; i--) {
    const a = areas[i];
    if (a && pontoNoPoligono(p, a.geometria)) return a.id;
  }
  return null;
}
