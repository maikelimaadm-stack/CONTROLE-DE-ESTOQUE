/**
 * EVALSCRIPTS DO RASTER DE VALORES MULTI-ÍNDICE — SATÉLITE COMPLETO (decisão 301).
 *
 * Expandir SAT-06: PNG UINT8 de valores por índice (NDVI, EVI2, NDRE, NDMI, MSAVI2, BSI).
 *  - 0 = NODATA (máscara / fora do polígono / banda inválida) — nunca é zero do índice.
 *  - 1..255 = valor linear na escala FIXA do encoding do índice.
 *
 * Escalas e versões: SSOT em `@agro/domain` (`raster-satelital.ts`).
 * NDVI mantém `ndvi-valores-v1` e escala [−0,2, 1] da SAT-06 (cache intacto).
 */
import {
  CLASSES_SCL_EXCLUIDAS,
  ENCODING_RASTER_POR_INDICE,
  RASTER_DEGRAUS,
  RASTER_NODATA_BYTE,
  decodificarByteRaster,
  encodingRasterDe,
  type IdIndiceRaster
} from "@agro/domain";

/** @deprecated use ENCODING_RASTER_POR_INDICE.ndvi — mantido para testes SAT-06. */
export const ESCALA_NDVI_RASTER = {
  min: ENCODING_RASTER_POR_INDICE.ndvi.scaleMin,
  max: ENCODING_RASTER_POR_INDICE.ndvi.scaleMax
} as const;
/** @deprecated use ENCODING_RASTER_POR_INDICE.ndvi.encodingVersion */
export const VERSAO_EVALSCRIPT_RASTER = ENCODING_RASTER_POR_INDICE.ndvi.encodingVersion;
export const VALOR_SEM_DADO_RASTER = RASTER_NODATA_BYTE;
export const DEGRAUS_RASTER = RASTER_DEGRAUS;

const SCL = CLASSES_SCL_EXCLUIDAS.map(([c]) => c).join(", ");

function scriptIndice(opts: {
  versao: string;
  bandas: readonly string[];
  scaleMin: number;
  scaleMax: number;
  validade: string;
  formula: string;
}): string {
  const bands = [...opts.bandas, "SCL", "dataMask"];
  return `//VERSION=3
// Raster valores ${opts.versao}: 0=nodata; 1..255=linear [${opts.scaleMin},${opts.scaleMax}].
var SCL_EXCLUIDAS = [${SCL}];
var ESCALA_MIN = ${JSON.stringify(opts.scaleMin)};
var ESCALA_MAX = ${JSON.stringify(opts.scaleMax)};
function setup() {
  return {
    input: [{ bands: [${bands.map((b) => `"${b}"`).join(", ")}] }],
    output: { bands: 1, sampleType: "UINT8" }
  };
}
function evaluatePixel(s) {
  var sclOk = SCL_EXCLUIDAS.indexOf(s.SCL) === -1;
  var valido = s.dataMask === 1 && sclOk && (${opts.validade});
  if (!valido) return [${RASTER_NODATA_BYTE}];
  var t = ((${opts.formula}) - ESCALA_MIN) / (ESCALA_MAX - ESCALA_MIN);
  if (t < 0) t = 0;
  if (t > 1) t = 1;
  return [1 + Math.round(t * ${RASTER_DEGRAUS})];
}
`;
}

const e = ENCODING_RASTER_POR_INDICE;

export const EVALSCRIPT_RASTER_POR_INDICE: Readonly<Record<IdIndiceRaster, string>> = {
  ndvi: scriptIndice({
    versao: e.ndvi.encodingVersion,
    bandas: ["B04", "B08"],
    scaleMin: e.ndvi.scaleMin,
    scaleMax: e.ndvi.scaleMax,
    validade: "s.B04 >= 0 && s.B08 >= 0 && (s.B08 + s.B04) > 0",
    formula: "(s.B08 - s.B04) / (s.B08 + s.B04)"
  }),
  evi2: scriptIndice({
    versao: e.evi2.encodingVersion,
    bandas: ["B04", "B08"],
    scaleMin: e.evi2.scaleMin,
    scaleMax: e.evi2.scaleMax,
    validade: "s.B04 >= 0 && s.B08 >= 0 && (s.B08 + 2.4 * s.B04 + 1) > 0",
    formula: "2.5 * (s.B08 - s.B04) / (s.B08 + 2.4 * s.B04 + 1)"
  }),
  ndre: scriptIndice({
    versao: e.ndre.encodingVersion,
    bandas: ["B05", "B8A"],
    scaleMin: e.ndre.scaleMin,
    scaleMax: e.ndre.scaleMax,
    validade: "s.B05 >= 0 && s.B8A >= 0 && (s.B8A + s.B05) > 0",
    formula: "(s.B8A - s.B05) / (s.B8A + s.B05)"
  }),
  ndmi: scriptIndice({
    versao: e.ndmi.encodingVersion,
    bandas: ["B8A", "B11"],
    scaleMin: e.ndmi.scaleMin,
    scaleMax: e.ndmi.scaleMax,
    validade: "s.B8A >= 0 && s.B11 >= 0 && (s.B8A + s.B11) > 0",
    formula: "(s.B8A - s.B11) / (s.B8A + s.B11)"
  }),
  msavi2: scriptIndice({
    versao: e.msavi2.encodingVersion,
    bandas: ["B04", "B08"],
    scaleMin: e.msavi2.scaleMin,
    scaleMax: e.msavi2.scaleMax,
    validade: "s.B04 >= 0 && s.B08 >= 0 && ((2 * s.B08 + 1) * (2 * s.B08 + 1) - 8 * (s.B08 - s.B04)) >= 0",
    formula: "(2 * s.B08 + 1 - Math.sqrt((2 * s.B08 + 1) * (2 * s.B08 + 1) - 8 * (s.B08 - s.B04))) / 2"
  }),
  bsi: scriptIndice({
    versao: e.bsi.encodingVersion,
    bandas: ["B02", "B04", "B08", "B11"],
    scaleMin: e.bsi.scaleMin,
    scaleMax: e.bsi.scaleMax,
    validade: "s.B02 >= 0 && s.B04 >= 0 && s.B08 >= 0 && s.B11 >= 0 && ((s.B11 + s.B04) + (s.B08 + s.B02)) > 0",
    formula: "((s.B11 + s.B04) - (s.B08 + s.B02)) / ((s.B11 + s.B04) + (s.B08 + s.B02))"
  })
};

/** Compat SAT-06. */
export const EVALSCRIPT_RASTER_NDVI = EVALSCRIPT_RASTER_POR_INDICE.ndvi;

export function evalscriptRasterDe(indice: string): string | null {
  const enc = encodingRasterDe(indice);
  if (!enc) return null;
  return EVALSCRIPT_RASTER_POR_INDICE[enc.indice];
}

export function decodificarValor(byte: number, escalaMin: number, escalaMax: number): number | null {
  return decodificarByteRaster(byte, escalaMin, escalaMax);
}
