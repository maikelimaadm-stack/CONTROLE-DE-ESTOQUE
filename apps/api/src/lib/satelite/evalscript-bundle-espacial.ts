/**
 * EVALSCRIPT MULTI-OUTPUT DO BUNDLE ESPACIAL — SAT-BUNDLE-01C.
 *
 * Uma Process → condição v3 + 6 rasters técnicos (UINT8), grade comum 20 m.
 * Fórmulas e limiares vêm do SSOT de domínio / builders existentes — sem redigitar ciência.
 *
 * Identifiers canônicos (setup.output.id ≡ responses.identifier):
 *   condicao | ndvi | evi2 | ndre | ndmi | msavi2 | bsi
 */
import {
  CLASSES_SCL_EXCLUIDAS,
  ENCODING_RASTER_POR_INDICE,
  INDICES_BUNDLE_ESSENCIAL,
  LIMIARES_CLASSIFICADOR_CONDICAO_PASTO,
  RASTER_DEGRAUS,
  RASTER_NODATA_BYTE,
  RESOLUCAO_AGREGACAO_PASTAGEM_M,
  SCL_AGUA,
  SCL_PERMITIDAS_CONDICAO_PASTO,
  VERSAO_EVALSCRIPT_CONDICAO_PASTO,
  type IdIndiceSatelite
} from "@agro/domain";

/** Identifiers oficiais do bundle espacial multi-output. */
export const IDS_OUTPUT_BUNDLE_ESPACIAL = [
  "condicao", "ndvi", "evi2", "ndre", "ndmi", "msavi2", "bsi"
] as const;
export type IdOutputBundleEspacial = (typeof IDS_OUTPUT_BUNDLE_ESPACIAL)[number];

export const RESOLUCAO_BUNDLE_ESPACIAL_M = RESOLUCAO_AGREGACAO_PASTAGEM_M; // 20
export const VERSAO_EVALSCRIPT_BUNDLE_ESPACIAL = `bundle-espacial-v1+${VERSAO_EVALSCRIPT_CONDICAO_PASTO}`;

const SCL_EXCLUIDAS_RASTER = CLASSES_SCL_EXCLUIDAS.map(([c]) => c).join(", ");
const L = LIMIARES_CLASSIFICADOR_CONDICAO_PASTO;

/** Spec puro de cada raster — reusa encoding/fórmula do evalscript-raster. */
const SPEC_RASTER: Readonly<Record<IdIndiceSatelite, { validade: string; formula: string }>> = {
  ndvi: {
    validade: "s.B04 >= 0 && s.B08 >= 0 && (s.B08 + s.B04) > 0",
    formula: "(s.B08 - s.B04) / (s.B08 + s.B04)"
  },
  evi2: {
    validade: "s.B04 >= 0 && s.B08 >= 0 && (s.B08 + 2.4 * s.B04 + 1) > 0",
    formula: "2.5 * (s.B08 - s.B04) / (s.B08 + 2.4 * s.B04 + 1)"
  },
  ndre: {
    validade: "s.B05 >= 0 && s.B8A >= 0 && (s.B8A + s.B05) > 0",
    formula: "(s.B8A - s.B05) / (s.B8A + s.B05)"
  },
  ndmi: {
    validade: "s.B8A >= 0 && s.B11 >= 0 && (s.B8A + s.B11) > 0",
    formula: "(s.B8A - s.B11) / (s.B8A + s.B11)"
  },
  msavi2: {
    validade: "s.B04 >= 0 && s.B08 >= 0 && ((2 * s.B08 + 1) * (2 * s.B08 + 1) - 8 * (s.B08 - s.B04)) >= 0",
    formula: "(2 * s.B08 + 1 - Math.sqrt((2 * s.B08 + 1) * (2 * s.B08 + 1) - 8 * (s.B08 - s.B04))) / 2"
  },
  bsi: {
    validade: "s.B02 >= 0 && s.B04 >= 0 && s.B08 >= 0 && s.B11 >= 0 && ((s.B11 + s.B04) + (s.B08 + s.B02)) > 0",
    formula: "((s.B11 + s.B04) - (s.B08 + s.B02)) / ((s.B11 + s.B04) + (s.B08 + s.B02))"
  }
};

export function ehIdOutputBundle(id: string): id is IdOutputBundleEspacial {
  return (IDS_OUTPUT_BUNDLE_ESPACIAL as readonly string[]).includes(id);
}

export function idsOutputsSolicitados(
  faltantes: readonly IdOutputBundleEspacial[]
): IdOutputBundleEspacial[] {
  const set = new Set(faltantes);
  return IDS_OUTPUT_BUNDLE_ESPACIAL.filter((id) => set.has(id));
}

/**
 * Builder canônico do evalscript multi-output.
 * Declara no setup TODOS os outputs pedidos; evaluatePixel devolve só esses ids.
 */
export function montarEvalscriptBundleEspacial(
  outputs: readonly IdOutputBundleEspacial[]
): string {
  const ids = idsOutputsSolicitados(outputs);
  if (ids.length === 0) throw new RangeError("bundle espacial: nenhum output solicitado");

  const outputsSetup = ids
    .map((id) => `{ id: ${JSON.stringify(id)}, bands: 1, sampleType: "UINT8" }`)
    .join(",\n      ");

  const precisaCondicao = ids.includes("condicao");
  const rasters = ids.filter((id): id is IdIndiceSatelite => id !== "condicao");

  const constsRaster = rasters.map((id) => {
    const e = ENCODING_RASTER_POR_INDICE[id];
    return `var ESCALA_MIN_${id.toUpperCase()} = ${JSON.stringify(e.scaleMin)};
var ESCALA_MAX_${id.toUpperCase()} = ${JSON.stringify(e.scaleMax)};`;
  }).join("\n");

  const fnsRaster = rasters.map((id) => {
    const spec = SPEC_RASTER[id];
    const U = id.toUpperCase();
    return `function byte_${id}(s, sclOkRaster) {
  var valido = s.dataMask === 1 && sclOkRaster && (${spec.validade});
  if (!valido) return ${RASTER_NODATA_BYTE};
  var t = ((${spec.formula}) - ESCALA_MIN_${U}) / (ESCALA_MAX_${U} - ESCALA_MIN_${U});
  if (t < 0) t = 0;
  if (t > 1) t = 1;
  return 1 + Math.round(t * ${RASTER_DEGRAUS});
}`;
  }).join("\n");

  const blocoCondicao = precisaCondicao ? `
function byte_condicao(s) {
  if (s.dataMask !== 1) return 0;
  if (s.SCL === SCL_AGUA) return 6;
  if (SCL_OK.indexOf(s.SCL) === -1) return 0;
  if (s.B02 < 0 || s.B04 < 0 || s.B05 < 0 || s.B08 < 0 || s.B8A < 0 || s.B11 < 0) return 0;
  var denNdvi = s.B08 + s.B04;
  var denEvi = s.B08 + 2.4 * s.B04 + 1;
  var denNdre = s.B8A + s.B05;
  var denNdmi = s.B8A + s.B11;
  var denBsi = (s.B11 + s.B04) + (s.B08 + s.B02);
  var disc = (2 * s.B08 + 1) * (2 * s.B08 + 1) - 8 * (s.B08 - s.B04);
  if (denNdvi <= 0 || denEvi <= 0 || denNdre <= 0 || denNdmi <= 0 || denBsi <= 0 || disc < 0) return 0;
  var ndvi = (s.B08 - s.B04) / denNdvi;
  var evi2 = 2.5 * (s.B08 - s.B04) / denEvi;
  var ndre = (s.B8A - s.B05) / denNdre;
  var ndmi = (s.B8A - s.B11) / denNdmi;
  var msavi2 = (2 * s.B08 + 1 - Math.sqrt(disc)) / 2;
  var bsi = ((s.B11 + s.B04) - (s.B08 + s.B02)) / denBsi;
  if (!(isFinite(ndvi) && isFinite(evi2) && isFinite(ndre) && isFinite(ndmi) && isFinite(msavi2) && isFinite(bsi))) return 0;
  if ((bsi >= BSI_FORTE && msavi2 < MSAVI2_MOD) || (bsi >= BSI_SOLO && ndvi < NDVI_SOLO && msavi2 < MSAVI2_MOD)) return 5;
  if (msavi2 < MSAVI2_MOD && ndvi < NDVI_ATIVA) return 3;
  var vigor = ndvi >= NDVI_ATIVA && (evi2 >= EVI2_VIGOR || ndre >= NDRE_VIGOR);
  if (ndmi < NDMI_BAIXA && msavi2 >= MSAVI2_MOD && vigor) return 4;
  if (msavi2 >= MSAVI2_BOA && vigor) return 1;
  if (msavi2 >= MSAVI2_MOD || ndvi >= NDVI_ATIVA) return 2;
  return 0;
}
` : "";

  const constsCondicao = precisaCondicao ? `
var SCL_OK = [${SCL_PERMITIDAS_CONDICAO_PASTO.join(", ")}];
var SCL_AGUA = ${SCL_AGUA};
var MSAVI2_BOA = ${JSON.stringify(L.msavi2BoaCobertura)};
var MSAVI2_MOD = ${JSON.stringify(L.msavi2CoberturaModerada)};
var MSAVI2_BAIXA = ${JSON.stringify(L.msavi2BaixaCobertura)};
var BSI_SOLO = ${JSON.stringify(L.bsiSoloExposto)};
var BSI_FORTE = ${JSON.stringify(L.bsiSoloExpostoForte)};
var NDVI_ATIVA = ${JSON.stringify(L.ndviVegetacaoAtiva)};
var NDVI_BAIXA = ${JSON.stringify(L.ndviBaixaCobertura)};
var NDVI_SOLO = ${JSON.stringify(L.ndviSoloExposto)};
var EVI2_VIGOR = ${JSON.stringify(L.evi2VigorAtivo)};
var NDRE_VIGOR = ${JSON.stringify(L.ndreVigorAtivo)};
var NDMI_BAIXA = ${JSON.stringify(L.ndmiBaixa)};
` : "";

  const retorno = ids.map((id) =>
    id === "condicao" ? "condicao: [byte_condicao(s)]" : `${id}: [byte_${id}(s, sclOkRaster)]`
  ).join(",\n    ");

  return `//VERSION=3
// Bundle espacial ${VERSAO_EVALSCRIPT_BUNDLE_ESPACIAL}: outputs [${ids.join(",")}] UINT8; grade ${RESOLUCAO_BUNDLE_ESPACIAL_M} m.
var SCL_EXCLUIDAS = [${SCL_EXCLUIDAS_RASTER}];
${constsCondicao}${constsRaster}
function setup() {
  return {
    input: [{ bands: ["B02", "B04", "B05", "B08", "B8A", "B11", "SCL", "dataMask"] }],
    output: [
      ${outputsSetup}
    ]
  };
}
${blocoCondicao}${fnsRaster}
function evaluatePixel(s) {
  var sclOkRaster = SCL_EXCLUIDAS.indexOf(s.SCL) === -1;
  return {
    ${retorno}
  };
}
`;
}

/** Corpo Process multi-output: responses só para faltantes; Accept application/tar no cliente. */
export function montarCorpoProcessoBundleEspacial(
  grade: { bbox3857: readonly [number, number, number, number]; poligono3857: { coordinates: number[][][] }; largura: number; altura: number },
  janela: { inicio: Date; fim: Date },
  outputs: readonly IdOutputBundleEspacial[],
  colecao: string
): unknown {
  const ids = idsOutputsSolicitados(outputs);
  if (ids.length === 0) throw new RangeError("bundle espacial: nenhum output");
  const inicio = janela.inicio.getTime(), fim = janela.fim.getTime();
  if (!Number.isFinite(inicio) || !Number.isFinite(fim) || fim <= inicio) {
    throw new RangeError("janela da observação inválida");
  }
  return {
    input: {
      bounds: {
        bbox: [...grade.bbox3857],
        geometry: {
          type: "Polygon",
          coordinates: grade.poligono3857.coordinates.map((anel) => anel.map(([x, y]) => [x, y]))
        },
        properties: { crs: "http://www.opengis.net/def/crs/EPSG/0/3857" }
      },
      data: [{
        type: colecao,
        dataFilter: { timeRange: { from: janela.inicio.toISOString(), to: janela.fim.toISOString() } }
      }]
    },
    output: {
      width: grade.largura,
      height: grade.altura,
      responses: ids.map((id) => ({
        identifier: id,
        format: { type: "image/png" }
      }))
    },
    evalscript: montarEvalscriptBundleEspacial(ids)
  };
}

/** Mapeia id de output → índice de domínio (condicao → null). */
export function indiceDoOutput(id: IdOutputBundleEspacial): IdIndiceSatelite | null {
  if (id === "condicao") return null;
  return id;
}

export function outputsObrigatoriosCompletos(): readonly IdOutputBundleEspacial[] {
  return IDS_OUTPUT_BUNDLE_ESPACIAL;
}

/** Garante que INDICES_BUNDLE cobre os 6 rasters do multi-output. */
void INDICES_BUNDLE_ESSENCIAL;
