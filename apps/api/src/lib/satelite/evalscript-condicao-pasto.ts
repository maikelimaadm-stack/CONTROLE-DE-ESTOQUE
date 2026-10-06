/**
 * EVALSCRIPT CATEGÓRICO DA CONDIÇÃO DO PASTO — SAT-COND-01 (decisão 302).
 *
 * Uma banda UINT8 0..6 (0 = nodata/sem leitura). Thresholds interpolados do SSOT
 * `LIMIARES_CLASSIFICADOR_CONDICAO_PASTO` — não redigitar números aqui.
 */
import {
  LIMIARES_CLASSIFICADOR_CONDICAO_PASTO,
  SCL_AGUA,
  SCL_PERMITIDAS_CONDICAO_PASTO,
  VERSAO_EVALSCRIPT_CONDICAO_PASTO
} from "@agro/domain";

const L = LIMIARES_CLASSIFICADOR_CONDICAO_PASTO;

export const EVALSCRIPT_CONDICAO_PASTO_V1 = `//VERSION=3
// Classificação integrada ${VERSAO_EVALSCRIPT_CONDICAO_PASTO}: UINT8 0..6 (0=sem leitura).
// Precedência: SEM_LEITURA → AGUA → SOLO → ESTRESSE → BAIXA → MODERADA → BOA.
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
function setup() {
  return {
    input: [{ bands: ["B02", "B04", "B05", "B08", "B8A", "B11", "SCL", "dataMask"] }],
    output: { bands: 1, sampleType: "UINT8" }
  };
}
function evaluatePixel(s) {
  if (s.dataMask !== 1) return [0];
  if (s.SCL === SCL_AGUA) return [6];
  if (SCL_OK.indexOf(s.SCL) === -1) return [0];
  if (s.B02 < 0 || s.B04 < 0 || s.B05 < 0 || s.B08 < 0 || s.B8A < 0 || s.B11 < 0) return [0];
  var denNdvi = s.B08 + s.B04;
  var denEvi = s.B08 + 2.4 * s.B04 + 1;
  var denNdre = s.B8A + s.B05;
  var denNdmi = s.B8A + s.B11;
  var denBsi = (s.B11 + s.B04) + (s.B08 + s.B02);
  var disc = (2 * s.B08 + 1) * (2 * s.B08 + 1) - 8 * (s.B08 - s.B04);
  if (denNdvi <= 0 || denEvi <= 0 || denNdre <= 0 || denNdmi <= 0 || denBsi <= 0 || disc < 0) return [0];
  var ndvi = (s.B08 - s.B04) / denNdvi;
  var evi2 = 2.5 * (s.B08 - s.B04) / denEvi;
  var ndre = (s.B8A - s.B05) / denNdre;
  var ndmi = (s.B8A - s.B11) / denNdmi;
  var msavi2 = (2 * s.B08 + 1 - Math.sqrt(disc)) / 2;
  var bsi = ((s.B11 + s.B04) - (s.B08 + s.B02)) / denBsi;
  if (!(isFinite(ndvi) && isFinite(evi2) && isFinite(ndre) && isFinite(ndmi) && isFinite(msavi2) && isFinite(bsi))) return [0];
  if ((bsi >= BSI_FORTE && msavi2 < MSAVI2_MOD) || (bsi >= BSI_SOLO && ndvi < NDVI_SOLO && msavi2 < MSAVI2_MOD)) return [5];
  if (ndmi < NDMI_BAIXA && (ndvi >= NDVI_BAIXA || msavi2 >= MSAVI2_BAIXA || evi2 >= EVI2_VIGOR)) return [4];
  if (msavi2 < MSAVI2_MOD && ndvi < NDVI_ATIVA) return [3];
  var vigor = ndvi >= NDVI_ATIVA && (evi2 >= EVI2_VIGOR || ndre >= NDRE_VIGOR);
  if (msavi2 >= MSAVI2_BOA && vigor) return [1];
  if (msavi2 >= MSAVI2_MOD || ndvi >= NDVI_ATIVA) return [2];
  return [0];
}
`;
