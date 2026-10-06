/**
 * ENCODING VERSIONADO DO RASTER DE VALORES — SATÉLITE COMPLETO (decisão 301).
 *
 * PNG UINT8 de VALORES (não cor): byte 0 = nodata; 1..255 = valor linear na escala do índice.
 * Paleta fica na web. Escala FIXA por índice (nunca min/max da própria imagem).
 * NDVI preserva a escala/versão da SAT-06 (`ndvi-valores-v1`, [−0,2, 1]) para não invalidar cache.
 *
 * SSOT: este arquivo. Banco, API e web consomem daqui — ninguém redigita escalas.
 */

import { CATALOGO_INDICES, INDICES_BUNDLE_ESSENCIAL, type IdIndiceSatelite } from "./indices-satelitais.js";

/** Byte sem valor — NUNCA é zero do índice. */
export const RASTER_NODATA_BYTE = 0;
/** Degraus úteis (bytes 1..255). */
export const RASTER_DEGRAUS = 254;
/** Bits do encoding atual. */
export const RASTER_BITS = 8;
/** Família de encoding UINT8 linear. */
export const RASTER_ENCODING_FAMILY = "uint8-linear-v1";

export type IdIndiceRaster = IdIndiceSatelite;

export interface EncodingRasterIndice {
  indice: IdIndiceRaster;
  /** Versão do evalscript+máscara+escala — entra na chave de cache. */
  encodingVersion: string;
  scaleMin: number;
  scaleMax: number;
  nodata: typeof RASTER_NODATA_BYTE;
  bits: typeof RASTER_BITS;
  nativeResolutionM: 10 | 20;
  /** Resolução alvo de processamento (igual à nativa do índice). */
  processingResolutionM: 10 | 20;
}

/**
 * Escalas de CODIFICAÇÃO (não são as faixas persistíveis do banco).
 * Amplas o bastante para pastagem; EVI2 cobre >1; MSAVI2 satura abaixo de −1 na visualização.
 */
export const ENCODING_RASTER_POR_INDICE: Readonly<Record<IdIndiceRaster, EncodingRasterIndice>> = {
  ndvi: {
    indice: "ndvi",
    encodingVersion: "ndvi-valores-v1",
    scaleMin: -0.2,
    scaleMax: 1.0,
    nodata: RASTER_NODATA_BYTE,
    bits: RASTER_BITS,
    nativeResolutionM: 10,
    processingResolutionM: 10
  },
  evi2: {
    indice: "evi2",
    encodingVersion: "evi2-valores-v1",
    scaleMin: -0.2,
    scaleMax: 1.5,
    nodata: RASTER_NODATA_BYTE,
    bits: RASTER_BITS,
    nativeResolutionM: 10,
    processingResolutionM: 10
  },
  ndre: {
    indice: "ndre",
    encodingVersion: "ndre-valores-v1",
    scaleMin: -0.2,
    scaleMax: 1.0,
    nodata: RASTER_NODATA_BYTE,
    bits: RASTER_BITS,
    nativeResolutionM: 20,
    processingResolutionM: 20
  },
  ndmi: {
    indice: "ndmi",
    encodingVersion: "ndmi-valores-v1",
    scaleMin: -0.5,
    scaleMax: 0.5,
    nodata: RASTER_NODATA_BYTE,
    bits: RASTER_BITS,
    nativeResolutionM: 20,
    processingResolutionM: 20
  },
  msavi2: {
    indice: "msavi2",
    encodingVersion: "msavi2-valores-v1",
    scaleMin: -1.0,
    scaleMax: 1.0,
    nodata: RASTER_NODATA_BYTE,
    bits: RASTER_BITS,
    nativeResolutionM: 10,
    processingResolutionM: 10
  },
  bsi: {
    indice: "bsi",
    encodingVersion: "bsi-valores-v1",
    scaleMin: -1.0,
    scaleMax: 1.0,
    nodata: RASTER_NODATA_BYTE,
    bits: RASTER_BITS,
    nativeResolutionM: 20,
    processingResolutionM: 20
  }
} as const;

/** Índices com raster Process API (os 6 do bundle essencial). */
export const INDICES_RASTER: readonly IdIndiceRaster[] = INDICES_BUNDLE_ESSENCIAL;

export function encodingRasterDe(indice: string): EncodingRasterIndice | null {
  if (!(indice in ENCODING_RASTER_POR_INDICE)) return null;
  return ENCODING_RASTER_POR_INDICE[indice as IdIndiceRaster];
}

/**
 * Lookup pela versão QUE GEROU o raster (`versao_evalscript` armazenada).
 * Não usar o catálogo atual do índice: encoding antigo ≠ versão nova com o mesmo nome de índice.
 */
export function encodingRasterPorVersao(versao: string): EncodingRasterIndice | null {
  for (const enc of Object.values(ENCODING_RASTER_POR_INDICE)) {
    if (enc.encodingVersion === versao) return enc;
  }
  return null;
}

/** Confere que o encoding declara a mesma resolução nativa do catálogo SSOT. */
export function resolucaoNativaHonesta(indice: IdIndiceRaster): 10 | 20 {
  const cat = CATALOGO_INDICES[indice].resolucaoNativaM;
  const enc = ENCODING_RASTER_POR_INDICE[indice].nativeResolutionM;
  if (cat !== enc) throw new Error(`raster: resolução nativa divergente para ${indice}`);
  return cat;
}

/**
 * Byte → valor do índice (centro do degrau). 0 → null (nodata ≠ zero do índice).
 * Byte/escala inválidos LANÇAM.
 */
export function decodificarByteRaster(
  byte: number,
  scaleMin: number,
  scaleMax: number
): number | null {
  if (!Number.isInteger(byte) || byte < 0 || byte > 255) throw new RangeError("byte fora da codificação do raster");
  if (!Number.isFinite(scaleMin) || !Number.isFinite(scaleMax) || scaleMin >= scaleMax) {
    throw new RangeError("escala do raster inválida");
  }
  if (byte === RASTER_NODATA_BYTE) return null;
  return ((byte - 1) / RASTER_DEGRAUS) * (scaleMax - scaleMin) + scaleMin;
}

/** Valor → byte (0 = nodata). Valores fora da escala saturam em 1 ou 255. */
export function codificarValorRaster(
  valor: number | null,
  scaleMin: number,
  scaleMax: number
): number {
  if (valor === null || !Number.isFinite(valor)) return RASTER_NODATA_BYTE;
  if (!Number.isFinite(scaleMin) || !Number.isFinite(scaleMax) || scaleMin >= scaleMax) {
    throw new RangeError("escala do raster inválida");
  }
  let t = (valor - scaleMin) / (scaleMax - scaleMin);
  if (t < 0) t = 0;
  if (t > 1) t = 1;
  return 1 + Math.round(t * RASTER_DEGRAUS);
}
