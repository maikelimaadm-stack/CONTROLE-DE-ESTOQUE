/**
 * EVALSCRIPT DO RASTER DE VALORES DO NDVI — SAT-06, decisão 297.
 *
 * A imagem NÃO é colorida: cada pixel carrega o VALOR do NDVI codificado em 1 byte (PNG cinza de 8 bits), para a
 * tela pintar depois com a paleta que quiser sem pedir outra imagem ao provedor.
 *
 *  - 0 = SEM VALOR. É o pixel que a SAT-01 tira da estatística: `dataMask` ≠ 1 (fora do polígono ou sem dado do
 *    satélite), classe da SCL em `CLASSES_SCL_EXCLUIDAS` (lista do domínio, interpolada aqui — não redigitada),
 *    reflectância negativa ou soma das bandas ≤ 0. Nunca é um NDVI.
 *  - 1..255 = NDVI LINEAR na escala FIXA `ESCALA_NDVI_RASTER`: `1 + round(clamp((ndvi − min) / (max − min), 0, 1) × 254)`.
 *    254 degraus de (max − min)/254 ≈ 0,0047; `decodificarValor` devolve o centro do degrau, então o erro de um pixel
 *    decodificado é no máximo meio degrau (≈ 0,0024). NDVI abaixo de `min` vira 1 e acima de `max` vira 255 (saturado,
 *    não descartado): a escala cobre de solo exposto/água rasa ao dossel denso.
 *
 * A escala e a versão moram AQUI, junto do script que as usa (`raster.ts` as reexporta): mudar a máscara, a fórmula
 * ou a escala muda os bytes, então muda `VERSAO_EVALSCRIPT_RASTER` — e a versão entra na chave de cache, de modo que
 * imagem de versão antiga nunca é reaproveitada como se fosse da nova.
 */
import { CLASSES_SCL_EXCLUIDAS } from "@agro/domain";

/** Escala fixa da codificação (não é a escala de cor da tela, que é da web). min < max, ambos dentro de [−1, 1]. */
export const ESCALA_NDVI_RASTER = { min: -0.2, max: 1.0 } as const;
/** Versão do script + máscara + escala. Mudou um, muda a versão. */
export const VERSAO_EVALSCRIPT_RASTER = "ndvi-valores-v1";
/** Byte do pixel sem valor. */
export const VALOR_SEM_DADO_RASTER = 0;
/** Degraus da codificação: os bytes 1..255. */
export const DEGRAUS_RASTER = 254;

export const EVALSCRIPT_RASTER_NDVI = `//VERSION=3
// SAT-06 (decisão 297, versão ${VERSAO_EVALSCRIPT_RASTER}): VALOR do NDVI por pixel em 1 byte (sem cor).
// 0 = sem valor (máscara da SAT-01). 1..255 = 1 + round(clamp((ndvi - MIN) / (MAX - MIN), 0, 1) * ${DEGRAUS_RASTER}).
var SCL_EXCLUIDAS = [${CLASSES_SCL_EXCLUIDAS.map(([classe]) => classe).join(", ")}];
var ESCALA_MIN = ${JSON.stringify(ESCALA_NDVI_RASTER.min)};
var ESCALA_MAX = ${JSON.stringify(ESCALA_NDVI_RASTER.max)};
function setup() {
  return {
    input: [{ bands: ["B04", "B08", "SCL", "dataMask"] }],
    output: { bands: 1, sampleType: "UINT8" }
  };
}
function evaluatePixel(s) {
  var soma = s.B08 + s.B04;
  var valido = s.dataMask === 1 && s.B04 >= 0 && s.B08 >= 0 && soma > 0 && SCL_EXCLUIDAS.indexOf(s.SCL) === -1;
  if (!valido) return [${VALOR_SEM_DADO_RASTER}];
  var t = ((s.B08 - s.B04) / soma - ESCALA_MIN) / (ESCALA_MAX - ESCALA_MIN);
  if (t < 0) t = 0;
  if (t > 1) t = 1;
  return [1 + Math.round(t * ${DEGRAUS_RASTER})];
}
`;

/**
 * Byte → NDVI (o centro do degrau). 0 → `null` (sem valor: nunca vira número). Byte fora de 0..255 ou não inteiro, ou
 * escala invertida, LANÇA: não é um valor desta codificação.
 */
export function decodificarValor(byte: number, escalaMin: number, escalaMax: number): number | null {
  if (!Number.isInteger(byte) || byte < 0 || byte > 255) throw new RangeError("byte fora da codificação do raster");
  if (!Number.isFinite(escalaMin) || !Number.isFinite(escalaMax) || escalaMin >= escalaMax) throw new RangeError("escala do raster inválida");
  if (byte === VALOR_SEM_DADO_RASTER) return null;
  return ((byte - 1) / DEGRAUS_RASTER) * (escalaMax - escalaMin) + escalaMin;
}
