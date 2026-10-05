/**
 * MÉTODO PASTAGEM ESSENCIAL (versão `pastagem-essencial-v2`) — SAT-08 R1/R2/R3, decisão 300.
 *
 * Correção forward-only sobre a v1 (#101 / decisão 299):
 * - Statistical API: histograma oficial `{ bins:[{lowEdge,highEdge,count}], underflowCount, overflowCount }`.
 * - Percentis com chaves numéricas (`"5"`, `"5.0"`, `"05.0"` equivalentes).
 * - dataMask por output (máscara de pastagem nos índices; SCL/qualidade só com dataMask fonte).
 * - Validade por índice (bandas próprias) — B05 inválida não invalida NDVI.
 * - Faixas persistíveis por índice (EVI2 pode >1; MSAVI2 pode < -1 com reflectance >1).
 * - Bundle completo: observação útil só se TODOS os 6 índices forem úteis no MESMO intervalo
 *   (CRITERIO_UTIL_BUNDLE); não escolhe dia só pelo NDVI; não inventa 0 a partir de null.
 * - Qualidade TOP-LEVEL = qualidade do BUNDLE (cobertura = MIN dos 6; índice limitante).
 * - `maior_cobertura` = MAX da cobertura do bundle (MIN dos 6) por intervalo — não NDVI-only.
 * - Frações de histograma: underflow/overflow > 0 → fração null (nunca descartados em silêncio).
 * - Agregação em 20 m; cada índice declara resolução nativa no catálogo.
 */
import { createHash } from "node:crypto";
import {
  BANDAS_BUNDLE_ESSENCIAL,
  CATALOGO_INDICES,
  CLASSES_SCL_EXCLUIDAS,
  COLECAO_SENTINEL2_L2A,
  CRITERIO_UTIL_BUNDLE,
  HISTOGRAMA_BINS_BSI,
  HISTOGRAMA_BINS_EVI2,
  HISTOGRAMA_BINS_MSAVI2,
  HISTOGRAMA_BINS_VIGOR,
  INDICES_BUNDLE_ESSENCIAL,
  LIMIARES_COBERTURA_EXPERIMENTAL,
  PERCENTIS_SATELITE,
  RESOLUCAO_AGREGACAO_PASTAGEM_M,
  VERSAO_INDICADORES_DERIVADOS,
  VERSAO_METODO_PASTAGEM_ESSENCIAL,
  VERSAO_QUALIDADE,
  estadoQualidade,
  indicadoresDerivados,
  type IdIndiceSatelite,
  type IndicadoresDerivados
} from "@agro/domain";
import { FalhaCopernicus } from "./copernicus.js";
import type { GradeDaAnalise, PoligonoGeoJson } from "./geometria.js";
import type { Janela, MetadadosAnalise } from "./ndvi.js";

const CRS84 = "http://www.opengis.net/def/crs/OGC/1.3/CRS84";
/** Mesma ordem de grandeza de HISTOGRAMA_EPS_BORDA (domínio) — borda técnica da faixa. */
export const TOLERANCIA_FAIXA = 1e-6;
const DIA_ISO = /^\d{4}-\d{2}-\d{2}$/;
/** Classes SCL que entram no cloud_ratio (sombra de nuvem, nuvem média/alta, cirro). */
const CLASSES_NUVEM_SCL = new Set([3, 8, 9, 10]);

export const RESOLUCAO_AGREGACAO_M = RESOLUCAO_AGREGACAO_PASTAGEM_M;
export { VERSAO_METODO_PASTAGEM_ESSENCIAL };

/**
 * Evalscript v2: um dataMask por output.
 * - Índices: dataMask fonte ∧ SCL pastagem ∧ bandas do índice ∧ denominador válido.
 * - SCL: só dataMask fonte — enxerga vegetação, solo, água, sombra, nuvem e cirrus.
 */
export const EVALSCRIPT_PASTAGEM_ESSENCIAL = `//VERSION=3
// SAT-08 R1 (decisão 300, ${VERSAO_METODO_PASTAGEM_ESSENCIAL}): bundle pastagem essencial.
// NDVI=(B08-B04)/(B08+B04); EVI2=2.5*(B08-B04)/(B08+2.4*B04+1);
// NDRE=(B8A-B05)/(B8A+B05); NDMI=(B8A-B11)/(B8A+B11);
// MSAVI2=(2*B08+1-sqrt((2*B08+1)^2-8*(B08-B04)))/2;
// BSI=((B11+B04)-(B08+B02))/((B11+B04)+(B08+B02)).
// Pixel inválido não vale zero: sai por dataMask=0 do output.
// dataMask por output: índices usam máscara de pastagem; scl usa só a fonte.
var SCL_EXCLUIDAS = [${CLASSES_SCL_EXCLUIDAS.map(([c]) => c).join(", ")}];
function setup() {
  return {
    input: [{ bands: [${BANDAS_BUNDLE_ESSENCIAL.map((b) => `"${b}"`).join(", ")}, "dataMask"] }],
    output: [
      { id: "ndvi", bands: 1, sampleType: "FLOAT32" },
      { id: "evi2", bands: 1, sampleType: "FLOAT32" },
      { id: "ndre", bands: 1, sampleType: "FLOAT32" },
      { id: "ndmi", bands: 1, sampleType: "FLOAT32" },
      { id: "msavi2", bands: 1, sampleType: "FLOAT32" },
      { id: "bsi", bands: 1, sampleType: "FLOAT32" },
      { id: "scl", bands: 1, sampleType: "UINT8" },
      { id: "dataMask", bands: ["ndvi", "evi2", "ndre", "ndmi", "msavi2", "bsi", "scl"] }
    ]
  };
}
function evaluatePixel(s) {
  var fonte = s.dataMask === 1 ? 1 : 0;
  var sclOk = SCL_EXCLUIDAS.indexOf(s.SCL) === -1;
  var pastagem = fonte === 1 && sclOk ? 1 : 0;
  var b02ok = s.B02 >= 0;
  var b04ok = s.B04 >= 0;
  var b05ok = s.B05 >= 0;
  var b08ok = s.B08 >= 0;
  var b8aok = s.B8A >= 0;
  var b11ok = s.B11 >= 0;
  var somaNdvi = s.B08 + s.B04;
  var denEvi = s.B08 + 2.4 * s.B04 + 1;
  var somaNdre = s.B8A + s.B05;
  var somaNdmi = s.B8A + s.B11;
  var aMsavi = 2 * s.B08 + 1;
  var intMsavi = aMsavi * aMsavi - 8 * (s.B08 - s.B04);
  var denBsi = (s.B11 + s.B04) + (s.B08 + s.B02);
  var mNdvi = pastagem === 1 && b04ok && b08ok && somaNdvi > 0 ? 1 : 0;
  var mEvi2 = pastagem === 1 && b04ok && b08ok && denEvi > 0 ? 1 : 0;
  var mNdre = pastagem === 1 && b05ok && b8aok && somaNdre > 0 ? 1 : 0;
  var mNdmi = pastagem === 1 && b8aok && b11ok && somaNdmi > 0 ? 1 : 0;
  var mMsavi = pastagem === 1 && b04ok && b08ok && intMsavi >= 0 ? 1 : 0;
  var mBsi = pastagem === 1 && b02ok && b04ok && b08ok && b11ok && denBsi > 0 ? 1 : 0;
  return {
    ndvi: [mNdvi ? (s.B08 - s.B04) / somaNdvi : 0],
    evi2: [mEvi2 ? 2.5 * (s.B08 - s.B04) / denEvi : 0],
    ndre: [mNdre ? (s.B8A - s.B05) / somaNdre : 0],
    ndmi: [mNdmi ? (s.B8A - s.B11) / somaNdmi : 0],
    msavi2: [mMsavi ? (aMsavi - Math.sqrt(intMsavi)) / 2 : 0],
    bsi: [mBsi ? ((s.B11 + s.B04) - (s.B08 + s.B02)) / denBsi : 0],
    scl: [s.SCL],
    dataMask: [mNdvi, mEvi2, mNdre, mNdmi, mMsavi, mBsi, fonte]
  };
}
`;

export const EVALSCRIPT_PASTAGEM_SHA256 = createHash("sha256").update(EVALSCRIPT_PASTAGEM_ESSENCIAL, "utf8").digest("hex");

function histogramaPedido(id: IdIndiceSatelite): { bins: number[] } {
  if (id === "evi2") return { bins: [...HISTOGRAMA_BINS_EVI2] };
  if (id === "msavi2") return { bins: [...HISTOGRAMA_BINS_MSAVI2] };
  if (id === "bsi") return { bins: [...HISTOGRAMA_BINS_BSI] };
  // NDVI, NDRE, NDMI: limiares de vigor alinhados (não centro aproximado).
  return { bins: [...HISTOGRAMA_BINS_VIGOR] };
}

/** calculations: uma chave por output nomeado — nunca só `default` com outputs nomeados. */
export function montarCalculationsPastagem() {
  const percentis = { k: [...PERCENTIS_SATELITE] };
  const porIndice = Object.fromEntries(
    INDICES_BUNDLE_ESSENCIAL.map((id) => [id, {
      statistics: { default: { percentiles: percentis } },
      histograms: { default: histogramaPedido(id) }
    }])
  );
  return {
    ...porIndice,
    scl: {
      histograms: { default: { bins: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] } }
    }
  };
}

export function montarCorpoPastagem(
  poligono: PoligonoGeoJson,
  janela: Janela,
  grade: Pick<GradeDaAnalise, "resx" | "resy">
) {
  return {
    input: {
      bounds: { geometry: { type: poligono.type, coordinates: poligono.coordinates }, properties: { crs: CRS84 } },
      data: [{ type: COLECAO_SENTINEL2_L2A }]
    },
    aggregation: {
      timeRange: { from: janela.inicio.toISOString(), to: janela.fim.toISOString() },
      aggregationInterval: { of: "P1D" },
      evalscript: EVALSCRIPT_PASTAGEM_ESSENCIAL,
      resx: grade.resx,
      resy: grade.resy
    },
    calculations: montarCalculationsPastagem()
  };
}

const malformada = () => new FalhaCopernicus("resposta_malformada", 200);
const objeto = (v: unknown): Record<string, unknown> | null =>
  (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const contagem = (v: unknown): number | null =>
  (typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : null);
const numeroOuNulo = (v: unknown): number | null | undefined => {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (v === null || v === undefined || v === "NaN") return null;
  return undefined;
};

function lerIntervalo(v: unknown): { inicio: Date; fim: Date } | null {
  const o = objeto(v);
  if (!o || typeof o["from"] !== "string" || typeof o["to"] !== "string") return null;
  const inicio = new Date(o["from"]); const fim = new Date(o["to"]);
  if (Number.isNaN(inicio.getTime()) || Number.isNaN(fim.getTime()) || fim <= inicio) return null;
  return { inicio, fim };
}

/** Formato canônico interno do histograma oficial da Statistical API. */
export interface HistogramaCanonico {
  bins: { lowEdge: number; highEdge: number; count: number }[];
  underflowCount: number;
  overflowCount: number;
}

export interface StatsIndice {
  amostra: number;
  semDado: number;
  validos: number;
  media: number | null;
  minimo: number | null;
  maximo: number | null;
  desvio: number | null;
  percentis: Record<string, number | null> | null;
  histograma: HistogramaCanonico | null;
}

export interface IntervaloMulti {
  inicio: Date;
  fim: Date;
  porIndice: Record<IdIndiceSatelite, StatsIndice>;
  sclHistograma: HistogramaCanonico | null;
  sclStats: { amostra: number; semDado: number; validos: number } | null;
}

export interface EstatisticaMultiLida {
  intervalos: IntervaloMulti[];
  errosEm: (Date | null)[];
  statusProvedor: string | null;
}

/**
 * Lê percentis pedindo 5,10,25,50,75,90,95.
 * Aceita chaves `"5"`, `"5.0"`, `"05.0"` (e prefixo `p`) quando o Number é o mesmo.
 * Ausência, duplicidade ambígua, NaN/Infinity → null (fail-closed).
 */
export function lerPercentis(stats: Record<string, unknown>): Record<string, number | null> | null {
  const p = objeto(stats["percentiles"]);
  if (!p) return null;
  const entradas = Object.entries(p);
  const out: Record<string, number | null> = {};
  for (const k of PERCENTIS_SATELITE) {
    const matches = entradas.filter(([chave]) => {
      const n = Number(String(chave).replace(/^p/i, ""));
      return Number.isFinite(n) && n === k;
    });
    if (matches.length === 0) return null;
    const valores: Array<number | null> = [];
    for (const [, v] of matches) {
      // NaN/Infinity → fail-closed (não viram null silencioso).
      if (typeof v === "number" && !Number.isFinite(v)) return null;
      const lido = numeroOuNulo(v);
      if (lido === undefined) return null;
      valores.push(lido);
    }
    const unicos = new Set(valores.map((v) => (v === null ? "null" : String(v))));
    if (unicos.size > 1) return null;
    out[`p${k}`] = valores[0]!;
  }
  return out;
}

/** Parser do histograma oficial. Shape legado `bins:number[]` + `counts` → null (fail-closed). */
export function lerHistograma(banda: Record<string, unknown> | null): HistogramaCanonico | null {
  if (!banda) return null;
  const h = objeto(banda["histogram"]) ?? (Array.isArray(banda["histograms"]) ? objeto((banda["histograms"] as unknown[])[0]) : null);
  const raiz = h ?? banda;
  const binsRaw = raiz["bins"];
  if (!Array.isArray(binsRaw) || binsRaw.length === 0) return null;
  // Shape legado (edges/centros numéricos + counts) — NÃO aceitar silenciosamente.
  if (typeof binsRaw[0] === "number") return null;
  const bins: HistogramaCanonico["bins"] = [];
  for (const item of binsRaw) {
    const b = objeto(item);
    if (!b) return null;
    const low = b["lowEdge"];
    const high = b["highEdge"];
    const count = b["count"];
    if (typeof low !== "number" || typeof high !== "number" || !Number.isFinite(low) || !Number.isFinite(high)) return null;
    if (!(low < high)) return null;
    if (typeof count !== "number" || !Number.isInteger(count) || count < 0) return null;
    bins.push({ lowEdge: low, highEdge: high, count });
  }
  for (let i = 1; i < bins.length; i++) {
    if (!(bins[i - 1]!.highEdge <= bins[i]!.lowEdge + 1e-12)) return null;
  }
  const underflow = contagem(raiz["underflowCount"]);
  const overflow = contagem(raiz["overflowCount"]);
  if (underflow === null || overflow === null) return null;
  return { bins, underflowCount: underflow, overflowCount: overflow };
}

function lerStatsBanda(outputs: Record<string, unknown>, id: string): StatsIndice | null {
  const out = objeto(outputs[id]);
  const banda = objeto(objeto(out)?.["bands"])?.["B0"] ?? objeto(objeto(out)?.["bands"])?.["default"];
  const bandaObj = objeto(banda);
  if (!bandaObj) return null;
  const stats = objeto(bandaObj["stats"]);
  if (!stats) return null;
  const amostra = contagem(stats["sampleCount"]);
  const semDado = contagem(stats["noDataCount"]);
  if (amostra === null || semDado === null || semDado > amostra) return null;
  const validos = amostra - semDado;
  const [media, minimo, maximo, desvio] = (["mean", "min", "max", "stDev"] as const).map((k) => numeroOuNulo(stats[k]));
  if (media === undefined || minimo === undefined || maximo === undefined || desvio === undefined) return null;
  if (validos > 0 && (media === null || minimo === null || maximo === null || desvio === null)) return null;
  return {
    amostra, semDado, validos, media, minimo, maximo, desvio,
    percentis: lerPercentis(stats),
    histograma: lerHistograma(bandaObj)
  };
}

function lerScl(outputs: Record<string, unknown>): {
  histograma: HistogramaCanonico | null;
  stats: { amostra: number; semDado: number; validos: number } | null;
} {
  const out = objeto(outputs["scl"]);
  const banda = objeto(objeto(out)?.["bands"])?.["B0"] ?? objeto(objeto(out)?.["bands"])?.["default"];
  const bandaObj = objeto(banda);
  if (!bandaObj) return { histograma: null, stats: null };
  const histograma = lerHistograma(bandaObj);
  const statsObj = objeto(bandaObj["stats"]);
  if (!statsObj) return { histograma, stats: null };
  const amostra = contagem(statsObj["sampleCount"]);
  const semDado = contagem(statsObj["noDataCount"]);
  if (amostra === null || semDado === null || semDado > amostra) return { histograma, stats: null };
  return { histograma, stats: { amostra, semDado, validos: amostra - semDado } };
}

export function interpretarEstatisticaMulti(corpo: unknown, janela: Janela): EstatisticaMultiLida {
  const raiz = objeto(corpo);
  if (!raiz || !Array.isArray(raiz["data"])) throw malformada();
  const status = typeof raiz["status"] === "string" && /^[A-Z_]{1,32}$/.test(raiz["status"]) ? raiz["status"] : null;
  const intervalos: IntervaloMulti[] = [];
  const errosEm: (Date | null)[] = [];
  for (const item of raiz["data"] as unknown[]) {
    const o = objeto(item);
    if (!o) throw malformada();
    const intervalo = lerIntervalo(o["interval"]);
    if (o["error"] !== undefined) { errosEm.push(intervalo?.inicio ?? null); continue; }
    if (!intervalo) throw malformada();
    if (intervalo.inicio < janela.inicio || intervalo.fim > janela.fim) throw malformada();
    const outputs = objeto(o["outputs"]);
    if (!outputs) throw malformada();
    const porIndice = {} as Record<IdIndiceSatelite, StatsIndice>;
    for (const id of INDICES_BUNDLE_ESSENCIAL) {
      const s = lerStatsBanda(outputs, id);
      if (!s) throw malformada();
      porIndice[id] = s;
    }
    const scl = lerScl(outputs);
    intervalos.push({ ...intervalo, porIndice, sclHistograma: scl.histograma, sclStats: scl.stats });
  }
  return { intervalos, errosEm, statusProvedor: status };
}

/**
 * Formata valor do índice com 4 casas. Defesa em profundidade: rejeita em runtime qualquer
 * entrada que não seja number finito — ausência de dado NUNCA vira 0.0000 nem TypeError.
 */
export function valor4(v: unknown, min: number, max: number): string {
  if (typeof v !== "number" || !Number.isFinite(v)) throw malformada();
  if (v < min - TOLERANCIA_FAIXA || v > max + TOLERANCIA_FAIXA) throw malformada();
  const t = Math.min(max, Math.max(min, v)).toFixed(4);
  return t === "-0.0000" ? "0.0000" : t;
}

function coberturaDezMil(validos: number, pixelsGeometria: number): number {
  if (pixelsGeometria <= 0) return 0;
  return Math.min(10_000, Math.floor((validos * 10_000) / pixelsGeometria));
}

/** Um índice é útil no intervalo se atinge CRITERIO_UTIL_BUNDLE e tem stats finitos quando há válidos. */
export function indiceUtilNoIntervalo(s: StatsIndice, pixelsGeometria: number): boolean {
  if (s.validos < CRITERIO_UTIL_BUNDLE.pixelsValidosMinimos) return false;
  if (coberturaDezMil(s.validos, pixelsGeometria) < Math.round(CRITERIO_UTIL_BUNDLE.coberturaMinima * 10_000)) return false;
  if (s.validos > 0) {
    for (const v of [s.media, s.minimo, s.maximo, s.desvio]) {
      if (typeof v !== "number" || !Number.isFinite(v)) return false;
    }
  }
  return true;
}

/** Bundle completo = TODOS os 6 índices essenciais úteis no MESMO intervalo. */
export function intervaloBundleUtil(i: IntervaloMulti, pixelsGeometria: number): boolean {
  return INDICES_BUNDLE_ESSENCIAL.every((id) => indiceUtilNoIntervalo(i.porIndice[id], pixelsGeometria));
}

function meiaNoiteUtc(dia: string): number {
  const ms = DIA_ISO.test(dia) ? Date.parse(`${dia}T00:00:00Z`) : NaN;
  if (!Number.isFinite(ms) || new Date(ms).toISOString().slice(0, 10) !== dia) {
    throw new RangeError("dia fora do formato AAAA-MM-DD");
  }
  return ms;
}

function diaUtc(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Fração espacial a partir de bins alinhados aos limiares.
 * Não usa centro do bin. Conta só bins cujo intervalo está inteiramente na faixa pedida.
 * É fração dos pixels do histograma (válidos do índice), não área geométrica exata.
 *
 * Política R3 (decisão 300): se underflowCount > 0 OU overflowCount > 0, a fração
 * derivada é null — esses pixels ficam preservados no histograma para inspeção e
 * NÃO entram no denominador por adivinhação nem são descartados em silêncio.
 */
export function fracaoBinsAlinhados(
  hist: HistogramaCanonico | null,
  pred: (low: number, high: number) => boolean
): number | null {
  if (!hist || hist.bins.length === 0) return null;
  if (hist.underflowCount > 0 || hist.overflowCount > 0) return null;
  let total = 0;
  let ok = 0;
  for (const b of hist.bins) {
    total += b.count;
    if (pred(b.lowEdge, b.highEdge)) ok += b.count;
  }
  if (total <= 0) return null;
  return ok / total;
}

export interface QualidadeObservacao {
  versao: string;
  estado: ReturnType<typeof estadoQualidade>;
  /** pixels válidos do índice / pixels geométricos da grade. */
  cobertura_valida: string | null;
  /** pixels válidos do índice / sampleCount do índice (fonte ∩ máscara do índice). */
  valid_ratio: string | null;
  /**
   * Pixels SCL nas classes 3/8/9/10 ÷ pixels com dado fonte no output SCL.
   * Exige máscara distinta (só dataMask fonte) — com máscara de vegetação as nuvens somem.
   */
  cloud_ratio: string | null;
  /** Fração por classe SCL sobre pixels com dado fonte (sampleCount − noDataCount do output scl). */
  scl_composition: Record<string, number> | null;
  denominadores: {
    pixels_geometricos: number;
    pixels_com_dado_fonte: number | null;
    pixels_validos_indice: number;
    pixels_mascarados_qualidade: number | null;
  };
  mascara: {
    scl_excluidas: number[];
    cld: false;
    dataMask: true;
    por_output: true;
  };
  motivo: string | null;
}

/**
 * Qualidade TOP-LEVEL do bundle completo (R3).
 * cobertura_valida = MIN das coberturas dos 6 índices; indice_limitante = quem produz o mínimo
 * (empate: ordem SSOT de INDICES_BUNDLE_ESSENCIAL). Sem pixels_validos_indice no top-level.
 */
export interface QualidadeBundle {
  versao: string;
  estado: ReturnType<typeof estadoQualidade>;
  cobertura_valida: string | null;
  indice_limitante: IdIndiceSatelite | null;
  coberturas_por_indice: Record<IdIndiceSatelite, string | null>;
  /** MIN dos valid_ratio individuais (quando todos existem). */
  valid_ratio_minimo: string | null;
  cloud_ratio: string | null;
  scl_composition: Record<string, number> | null;
  denominadores: {
    pixels_geometricos: number;
    pixels_com_dado_fonte: number | null;
    pixels_mascarados_qualidade: number | null;
  };
  mascara: {
    scl_excluidas: number[];
    cld: false;
    dataMask: true;
    por_output: true;
  };
  motivo: string | null;
}

/** Cobertura do bundle num intervalo = MIN das coberturas dos 6 (em décimos de milésimo). */
export function coberturaBundleDezMil(i: IntervaloMulti, pixelsGeometria: number): number {
  let min = Number.POSITIVE_INFINITY;
  for (const id of INDICES_BUNDLE_ESSENCIAL) {
    min = Math.min(min, coberturaDezMil(i.porIndice[id].validos, pixelsGeometria));
  }
  return Number.isFinite(min) ? min : 0;
}

/** Índice com a menor cobertura; empate → primeira ocorrência em INDICES_BUNDLE_ESSENCIAL. */
export function indiceLimitanteDoIntervalo(i: IntervaloMulti, pixelsGeometria: number): IdIndiceSatelite {
  let min = Number.POSITIVE_INFINITY;
  let limitante: IdIndiceSatelite = INDICES_BUNDLE_ESSENCIAL[0]!;
  for (const id of INDICES_BUNDLE_ESSENCIAL) {
    const cob = coberturaDezMil(i.porIndice[id].validos, pixelsGeometria);
    if (cob < min) {
      min = cob;
      limitante = id;
    }
  }
  return limitante;
}

/** Monta qualidade do bundle a partir das qualidades individuais já materializadas. */
export function qualidadeBundleDe(
  indices: ResultadoIndicePastagem[],
  situacao: "concluida" | "sem_observacao_util",
  motivo: string | null,
  pixelsGeometria: number
): QualidadeBundle {
  const coberturas_por_indice = {} as Record<IdIndiceSatelite, string | null>;
  let cobMin: number | null = null;
  let limitante: IdIndiceSatelite | null = null;
  let validMin: number | null = null;
  let ref: QualidadeObservacao | null = null;

  for (const id of INDICES_BUNDLE_ESSENCIAL) {
    const idx = indices.find((x) => x.indice === id);
    const q = idx?.qualidade ?? null;
    if (q && !ref) ref = q;
    const cobStr = idx?.cobertura ?? q?.cobertura_valida ?? null;
    coberturas_por_indice[id] = cobStr;
    if (situacao === "concluida" && cobStr != null) {
      const cob = Number(cobStr);
      if (Number.isFinite(cob) && (cobMin === null || cob < cobMin)) {
        cobMin = cob;
        limitante = id;
      }
    }
    const vr = q?.valid_ratio != null ? Number(q.valid_ratio) : null;
    if (vr != null && Number.isFinite(vr) && (validMin === null || vr < validMin)) validMin = vr;
  }

  const estado = estadoQualidade(cobMin, situacao);
  return {
    versao: VERSAO_QUALIDADE,
    estado,
    cobertura_valida: cobMin === null ? null : cobMin.toFixed(4),
    indice_limitante: situacao === "concluida" ? limitante : null,
    coberturas_por_indice,
    valid_ratio_minimo: validMin === null ? null : validMin.toFixed(4),
    cloud_ratio: ref?.cloud_ratio ?? null,
    scl_composition: ref?.scl_composition ?? null,
    denominadores: {
      pixels_geometricos: pixelsGeometria,
      pixels_com_dado_fonte: ref?.denominadores.pixels_com_dado_fonte ?? null,
      pixels_mascarados_qualidade: ref?.denominadores.pixels_mascarados_qualidade ?? null
    },
    mascara: {
      scl_excluidas: CLASSES_SCL_EXCLUIDAS.map(([c]) => c),
      cld: false,
      dataMask: true,
      por_output: true
    },
    motivo
  };
}

/**
 * Reconstrói qualidade do bundle a partir de coberturas já persistidas (resumo).
 * Empate no MIN → ordem SSOT de INDICES_BUNDLE_ESSENCIAL.
 */
export function qualidadeBundleDeCoberturas(
  coberturas: Record<IdIndiceSatelite, string | null>,
  situacao: "concluida" | "sem_observacao_util",
  motivo: string | null,
  pixelsGeometria: number,
  compartilhado: {
    cloud_ratio: string | null;
    scl_composition: Record<string, number> | null;
    pixels_com_dado_fonte: number | null;
    pixels_mascarados_qualidade: number | null;
    valid_ratios?: Partial<Record<IdIndiceSatelite, string | null>>;
  }
): QualidadeBundle {
  let cobMin: number | null = null;
  let limitante: IdIndiceSatelite | null = null;
  for (const id of INDICES_BUNDLE_ESSENCIAL) {
    const cobStr = coberturas[id];
    if (situacao === "concluida" && cobStr != null) {
      const cob = Number(cobStr);
      if (Number.isFinite(cob) && (cobMin === null || cob < cobMin)) {
        cobMin = cob;
        limitante = id;
      }
    }
  }
  let validMin: number | null = null;
  if (compartilhado.valid_ratios) {
    for (const id of INDICES_BUNDLE_ESSENCIAL) {
      const vr = compartilhado.valid_ratios[id];
      if (vr != null) {
        const n = Number(vr);
        if (Number.isFinite(n) && (validMin === null || n < validMin)) validMin = n;
      }
    }
  }
  return {
    versao: VERSAO_QUALIDADE,
    estado: estadoQualidade(cobMin, situacao),
    cobertura_valida: cobMin === null ? null : cobMin.toFixed(4),
    indice_limitante: situacao === "concluida" ? limitante : null,
    coberturas_por_indice: { ...coberturas },
    valid_ratio_minimo: validMin === null ? null : validMin.toFixed(4),
    cloud_ratio: compartilhado.cloud_ratio,
    scl_composition: compartilhado.scl_composition,
    denominadores: {
      pixels_geometricos: pixelsGeometria,
      pixels_com_dado_fonte: compartilhado.pixels_com_dado_fonte,
      pixels_mascarados_qualidade: compartilhado.pixels_mascarados_qualidade
    },
    mascara: {
      scl_excluidas: CLASSES_SCL_EXCLUIDAS.map(([c]) => c),
      cld: false,
      dataMask: true,
      por_output: true
    },
    motivo
  };
}

function qualidadeDe(
  stats: StatsIndice,
  pixelsGeometria: number,
  situacao: "concluida" | "sem_observacao_util",
  motivo: string | null,
  sclHist: HistogramaCanonico | null,
  sclStats: { amostra: number; semDado: number; validos: number } | null
): QualidadeObservacao {
  const cob = situacao === "concluida" ? coberturaDezMil(stats.validos, pixelsGeometria) / 10_000 : null;
  const validRatio = stats.amostra > 0 ? stats.validos / stats.amostra : null;
  let cloudRatio: number | null = null;
  let sclComp: Record<string, number> | null = null;
  let pixelsFonte: number | null = sclStats?.validos ?? null;
  let mascaradosQualidade: number | null = null;

  if (sclHist && sclStats && sclStats.validos > 0) {
    pixelsFonte = sclStats.validos;
    const denom = sclStats.validos;
    sclComp = {};
    let nuvem = 0;
    let emBins = 0;
    for (const b of sclHist.bins) {
      // bins SCL oficiais: [classe, classe+1) → classe = floor(lowEdge) quando alinhado.
      const classe = Math.floor(b.lowEdge + 1e-9);
      emBins += b.count;
      const frac = b.count / denom;
      sclComp[String(classe)] = Number(frac.toFixed(4));
      if (CLASSES_NUVEM_SCL.has(classe)) nuvem += b.count;
    }
    void emBins; // bins podem não cobrir 100% se houver underflow/overflow; denom = pixels com dado fonte.
    mascaradosQualidade = nuvem;
    cloudRatio = nuvem / denom;
  } else if (sclHist) {
    // Sem stats do SCL: denominador = soma dos bins (aproximação documentada).
    const total = sclHist.bins.reduce((a, b) => a + b.count, 0) + sclHist.underflowCount + sclHist.overflowCount;
    if (total > 0) {
      pixelsFonte = total;
      sclComp = {};
      let nuvem = 0;
      for (const b of sclHist.bins) {
        const classe = Math.floor(b.lowEdge + 1e-9);
        sclComp[String(classe)] = Number((b.count / total).toFixed(4));
        if (CLASSES_NUVEM_SCL.has(classe)) nuvem += b.count;
      }
      mascaradosQualidade = nuvem;
      cloudRatio = nuvem / total;
    }
  }

  return {
    versao: VERSAO_QUALIDADE,
    estado: estadoQualidade(cob, situacao),
    cobertura_valida: cob === null ? null : cob.toFixed(4),
    valid_ratio: validRatio === null ? null : validRatio.toFixed(4),
    cloud_ratio: cloudRatio === null ? null : cloudRatio.toFixed(4),
    scl_composition: sclComp,
    denominadores: {
      pixels_geometricos: pixelsGeometria,
      pixels_com_dado_fonte: pixelsFonte,
      pixels_validos_indice: stats.validos,
      pixels_mascarados_qualidade: mascaradosQualidade
    },
    mascara: {
      scl_excluidas: CLASSES_SCL_EXCLUIDAS.map(([c]) => c),
      cld: false,
      dataMask: true,
      por_output: true
    },
    motivo
  };
}

export interface ResultadoIndicePastagem {
  indice: IdIndiceSatelite;
  situacao: "concluida" | "sem_observacao_util";
  motivo: "sem_aquisicao" | "cobertura_insuficiente" | null;
  observacao: { inicio: Date; fim: Date } | null;
  valores: { medio: string; minimo: string; maximo: string; desvio: string } | null;
  pixels: { amostra: number; semDado: number; validos: number; geometria: number } | null;
  cobertura: string | null;
  percentis: Record<string, string | null> | null;
  histograma: HistogramaCanonico | null;
  resolucao_m: number;
  resolucao_nativa_m: number;
  qualidade: QualidadeObservacao;
  metadados: MetadadosAnalise;
}

export interface ResultadoPastagem {
  situacao: "concluida" | "sem_observacao_util";
  motivo: "sem_aquisicao" | "cobertura_insuficiente" | null;
  observacao: { inicio: Date; fim: Date } | null;
  indices: ResultadoIndicePastagem[];
  indicadores: IndicadoresDerivados;
  /** Qualidade do BUNDLE (índice limitante), não a do NDVI. */
  qualidade: QualidadeBundle;
  evalscript_sha256: string;
  versao_metodo: string;
}

/**
 * Escolhe a observação útil do BUNDLE COMPLETO e materializa os 6 índices do mesmo dia.
 *
 * Um intervalo só é útil se TODOS os índices de INDICES_BUNDLE_ESSENCIAL atingem
 * CRITERIO_UTIL_BUNDLE (cobertura + pixels mínimos + stats finitos). Não escolhe só pelo NDVI.
 * Sem data alvo: o completo MAIS RECENTE. Com data alvo: se há intervalo no dia alvo e ele
 * não é completo → sem_observacao_util (sem fallback silencioso); se não há aquisição no
 * dia → o completo mais perto do alvo (empate: mais recente).
 */
export function escolherObservacaoPastagem(
  lida: EstatisticaMultiLida,
  pixelsGeometria: number,
  dataAlvo: string | null
): ResultadoPastagem {
  const uteis = lida.intervalos.filter((i) => intervaloBundleUtil(i, pixelsGeometria));
  // maior_cobertura (v2) = melhor cobertura do BUNDLE (MIN dos 6) entre os intervalos — não NDVI-only.
  const maiorCobBundle = lida.intervalos.reduce<number | null>((m, i) =>
    Math.max(m ?? 0, coberturaBundleDezMil(i, pixelsGeometria)), null);
  const metadados: MetadadosAnalise = {
    intervalos_recebidos: lida.intervalos.length + lida.errosEm.length,
    intervalos_com_erro: lida.errosEm.length,
    intervalos_com_dado: lida.intervalos.filter((i) =>
      INDICES_BUNDLE_ESSENCIAL.some((id) => i.porIndice[id].validos > 0)).length,
    intervalos_uteis: uteis.length,
    maior_cobertura: maiorCobBundle === null ? null : (maiorCobBundle / 10_000).toFixed(4),
    fonte_pixels_geometria: "grade_crs84",
    status_provedor: lida.statusProvedor
  };

  let escolhida: IntervaloMulti | undefined;
  if (dataAlvo === null) {
    escolhida = [...uteis].sort((a, b) => b.inicio.getTime() - a.inicio.getTime())[0];
  } else {
    const alvoMs = meiaNoiteUtc(dataAlvo);
    const noDiaAlvo = lida.intervalos.filter((i) => diaUtc(i.inicio) === dataAlvo);
    if (noDiaAlvo.length > 0) {
      // Há aquisição no dia alvo: exige bundle completo NESSE dia — sem fallback silencioso.
      escolhida = noDiaAlvo.filter((i) => intervaloBundleUtil(i, pixelsGeometria))
        .sort((a, b) => b.inicio.getTime() - a.inicio.getTime())[0];
    } else {
      const dist = (inicio: Date) => Math.abs(inicio.getTime() - alvoMs);
      escolhida = [...uteis].sort((a, b) =>
        dist(a.inicio) - dist(b.inicio) || b.inicio.getTime() - a.inicio.getTime())[0];
    }
  }

  const erroDecisivo = lida.errosEm.some((em) => {
    if (em === null) return true;
    if (!escolhida) return true;
    if (dataAlvo === null) return em.getTime() >= escolhida.inicio.getTime();
    const alvoMs = meiaNoiteUtc(dataAlvo);
    const dErr = Math.abs(em.getTime() - alvoMs);
    const dOk = Math.abs(escolhida.inicio.getTime() - alvoMs);
    return dErr < dOk || (dErr === dOk && em.getTime() >= escolhida.inicio.getTime());
  });
  if (erroDecisivo) throw new FalhaCopernicus("processamento_parcial", 200);

  if (!escolhida) {
    const motivo: "sem_aquisicao" | "cobertura_insuficiente" =
      lida.intervalos.length ? "cobertura_insuficiente" : "sem_aquisicao";
    const qualidadeIndice = qualidadeDe(
      { amostra: 0, semDado: 0, validos: 0, media: null, minimo: null, maximo: null, desvio: null, percentis: null, histograma: null },
      pixelsGeometria, "sem_observacao_util", motivo, null, null
    );
    const indices: ResultadoIndicePastagem[] = INDICES_BUNDLE_ESSENCIAL.map((id) => ({
      indice: id,
      situacao: "sem_observacao_util",
      motivo,
      observacao: null,
      valores: null,
      pixels: { amostra: 0, semDado: 0, validos: 0, geometria: pixelsGeometria },
      cobertura: null,
      percentis: null,
      histograma: null,
      resolucao_m: RESOLUCAO_AGREGACAO_M,
      resolucao_nativa_m: CATALOGO_INDICES[id].resolucaoNativaM,
      qualidade: qualidadeIndice,
      metadados
    }));
    return {
      situacao: "sem_observacao_util",
      motivo,
      observacao: null,
      indices,
      indicadores: indicadoresDerivados({ ndviMedio: null, ndmiMedio: null, bsiMedio: null }),
      qualidade: qualidadeBundleDe(indices, "sem_observacao_util", motivo, pixelsGeometria),
      evalscript_sha256: EVALSCRIPT_PASTAGEM_SHA256,
      versao_metodo: VERSAO_METODO_PASTAGEM_ESSENCIAL
    };
  }

  const dia = escolhida;
  const indices: ResultadoIndicePastagem[] = INDICES_BUNDLE_ESSENCIAL.map((id) => {
    const s = dia.porIndice[id];
    const cat = CATALOGO_INDICES[id];
    const faixa = cat.faixaPersistivel;
    // Defesa: índice útil já exige finitos; valor4 rejeita null/NaN/Infinity em runtime.
    if (typeof s.desvio !== "number" || !Number.isFinite(s.desvio) || s.desvio < 0) throw malformada();
    const valores = {
      medio: valor4(s.media, faixa.min, faixa.max),
      minimo: valor4(s.minimo, faixa.min, faixa.max),
      maximo: valor4(s.maximo, faixa.min, faixa.max),
      desvio: s.desvio.toFixed(4)
    };
    if (Number(valores.minimo) > Number(valores.medio)
      || Number(valores.medio) > Number(valores.maximo)) throw malformada();
    const cob = (coberturaDezMil(s.validos, pixelsGeometria) / 10_000).toFixed(4);
    const percentis = s.percentis
      ? Object.fromEntries(Object.entries(s.percentis).map(([k, v]) => [
        k, v === null ? null : valor4(v, faixa.min, faixa.max)
      ]))
      : null;
    return {
      indice: id,
      situacao: "concluida" as const,
      motivo: null,
      observacao: { inicio: dia.inicio, fim: dia.fim },
      valores,
      pixels: { amostra: s.amostra, semDado: s.semDado, validos: s.validos, geometria: pixelsGeometria },
      cobertura: cob,
      percentis,
      histograma: s.histograma,
      resolucao_m: RESOLUCAO_AGREGACAO_M,
      resolucao_nativa_m: cat.resolucaoNativaM,
      qualidade: qualidadeDe(s, pixelsGeometria, "concluida", null, dia.sclHistograma, dia.sclStats),
      metadados
    };
  });

  const ndviHist = dia.porIndice.ndvi.histograma;
  const bsiHist = dia.porIndice.bsi.histograma;
  // Frações por bins alinhados: vegetação ativa [0,40 →); baixa cobertura [0,20 → 0,40); solo NDVI < 0,20.
  const fracaoVegetacao = fracaoBinsAlinhados(ndviHist, (low, high) => low >= LIMIARES_COBERTURA_EXPERIMENTAL.vegetacaoAtivaNdvi - 1e-12 && high > low);
  const fracaoBaixa = fracaoBinsAlinhados(ndviHist, (low, high) =>
    low >= LIMIARES_COBERTURA_EXPERIMENTAL.baixaCoberturaNdviMin - 1e-12
    && high <= LIMIARES_COBERTURA_EXPERIMENTAL.vegetacaoAtivaNdvi + 1e-12);
  const fracaoSolo = fracaoBinsAlinhados(bsiHist, (low) => low >= LIMIARES_COBERTURA_EXPERIMENTAL.bsiSoloExposto - 1e-12)
    ?? fracaoBinsAlinhados(ndviHist, (_low, high) => high <= LIMIARES_COBERTURA_EXPERIMENTAL.soloExpostoNdvi + 1e-12);

  const indicadores = indicadoresDerivados({
    ndviMedio: Number(indices.find((i) => i.indice === "ndvi")!.valores!.medio),
    ndmiMedio: Number(indices.find((i) => i.indice === "ndmi")!.valores!.medio),
    bsiMedio: Number(indices.find((i) => i.indice === "bsi")!.valores!.medio),
    fracaoVegetacaoAtiva: fracaoVegetacao,
    fracaoBaixaCobertura: fracaoBaixa,
    fracaoSoloExposto: fracaoSolo
  });

  return {
    situacao: "concluida",
    motivo: null,
    observacao: { inicio: dia.inicio, fim: dia.fim },
    indices,
    indicadores: { ...indicadores, versao: VERSAO_INDICADORES_DERIVADOS },
    qualidade: qualidadeBundleDe(indices, "concluida", null, pixelsGeometria),
    evalscript_sha256: EVALSCRIPT_PASTAGEM_SHA256,
    versao_metodo: VERSAO_METODO_PASTAGEM_ESSENCIAL
  };
}
