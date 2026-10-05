/**
 * MÉTODO PASTAGEM ESSENCIAL (versão `pastagem-essencial-v2`) — SAT-08 R1, decisão 300.
 *
 * Correção forward-only sobre a v1 (#101 / decisão 299):
 * - Statistical API: histograma oficial `{ bins:[{lowEdge,highEdge,count}], underflowCount, overflowCount }`.
 * - Percentis com chaves numéricas (`"5"`, `"5.0"`, `"05.0"` equivalentes).
 * - dataMask por output (máscara de pastagem nos índices; SCL/qualidade só com dataMask fonte).
 * - Validade por índice (bandas próprias) — B05 inválida não invalida NDVI.
 * - Faixas persistíveis por índice (EVI2 pode ultrapassar +1).
 * - Agregação em 20 m; cada índice declara resolução nativa no catálogo.
 */
import { createHash } from "node:crypto";
import {
  BANDAS_BUNDLE_ESSENCIAL,
  CATALOGO_INDICES,
  CLASSES_SCL_EXCLUIDAS,
  COLECAO_SENTINEL2_L2A,
  HISTOGRAMA_BINS_BSI,
  HISTOGRAMA_BINS_EVI2,
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
import { escolherObservacaoV2 } from "./ndvi-v2.js";

const CRS84 = "http://www.opengis.net/def/crs/OGC/1.3/CRS84";
const TOLERANCIA_FAIXA = 1e-6;
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
  if (id === "bsi") return { bins: [...HISTOGRAMA_BINS_BSI] };
  // NDVI, NDRE, NDMI, MSAVI2: limiares de vigor alinhados (não centro aproximado).
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
    const valores = matches.map(([, v]) => numeroOuNulo(v));
    if (valores.some((v) => v === undefined)) return null;
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

function valor4(v: number, min: number, max: number): string {
  if (v < min - TOLERANCIA_FAIXA || v > max + TOLERANCIA_FAIXA) throw malformada();
  const t = Math.min(max, Math.max(min, v)).toFixed(4);
  return t === "-0.0000" ? "0.0000" : t;
}

function coberturaDezMil(validos: number, pixelsGeometria: number): number {
  if (pixelsGeometria <= 0) return 0;
  return Math.min(10_000, Math.floor((validos * 10_000) / pixelsGeometria));
}

/**
 * Fração espacial a partir de bins alinhados aos limiares.
 * Não usa centro do bin. Conta só bins cujo intervalo está inteiramente na faixa pedida.
 * É fração dos pixels do histograma (válidos do índice), não área geométrica exata.
 */
export function fracaoBinsAlinhados(
  hist: HistogramaCanonico | null,
  pred: (low: number, high: number) => boolean
): number | null {
  if (!hist || hist.bins.length === 0) return null;
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
  qualidade: QualidadeObservacao;
  evalscript_sha256: string;
  versao_metodo: string;
}

/**
 * Escolhe a observação útil (critério do NDVI do bundle) e materializa os 6 índices do mesmo dia.
 * Reusa a lógica temporal da v2 via adaptação do NDVI para o seletor.
 */
export function escolherObservacaoPastagem(
  lida: EstatisticaMultiLida,
  pixelsGeometria: number,
  dataAlvo: string | null
): ResultadoPastagem {
  const comoNdvi = {
    intervalos: lida.intervalos.map((i) => ({
      inicio: i.inicio,
      fim: i.fim,
      amostra: i.porIndice.ndvi.amostra,
      semDado: i.porIndice.ndvi.semDado,
      validos: i.porIndice.ndvi.validos,
      media: i.porIndice.ndvi.media,
      minimo: i.porIndice.ndvi.minimo,
      maximo: i.porIndice.ndvi.maximo,
      desvio: i.porIndice.ndvi.desvio
    })),
    errosEm: lida.errosEm,
    statusProvedor: lida.statusProvedor
  };
  const escolha = escolherObservacaoV2(comoNdvi, pixelsGeometria, dataAlvo);

  if (escolha.situacao === "sem_observacao_util") {
    const qualidade = qualidadeDe(
      { amostra: 0, semDado: 0, validos: 0, media: null, minimo: null, maximo: null, desvio: null, percentis: null, histograma: null },
      pixelsGeometria, "sem_observacao_util", escolha.motivo, null, null
    );
    const indices: ResultadoIndicePastagem[] = INDICES_BUNDLE_ESSENCIAL.map((id) => ({
      indice: id,
      situacao: "sem_observacao_util",
      motivo: escolha.motivo,
      observacao: null,
      valores: null,
      pixels: { amostra: 0, semDado: 0, validos: 0, geometria: pixelsGeometria },
      cobertura: null,
      percentis: null,
      histograma: null,
      resolucao_m: RESOLUCAO_AGREGACAO_M,
      resolucao_nativa_m: CATALOGO_INDICES[id].resolucaoNativaM,
      qualidade,
      metadados: escolha.metadados
    }));
    return {
      situacao: "sem_observacao_util",
      motivo: escolha.motivo,
      observacao: null,
      indices,
      indicadores: indicadoresDerivados({ ndviMedio: null, ndmiMedio: null, bsiMedio: null }),
      qualidade,
      evalscript_sha256: EVALSCRIPT_PASTAGEM_SHA256,
      versao_metodo: VERSAO_METODO_PASTAGEM_ESSENCIAL
    };
  }

  const dia = lida.intervalos.find((i) =>
    i.inicio.getTime() === escolha.observacao.inicio.getTime() && i.fim.getTime() === escolha.observacao.fim.getTime());
  if (!dia) throw malformada();

  const indices: ResultadoIndicePastagem[] = INDICES_BUNDLE_ESSENCIAL.map((id) => {
    const s = dia.porIndice[id];
    const cat = CATALOGO_INDICES[id];
    const faixa = cat.faixaPersistivel;
    const valores = {
      medio: valor4(s.media!, faixa.min, faixa.max),
      minimo: valor4(s.minimo!, faixa.min, faixa.max),
      maximo: valor4(s.maximo!, faixa.min, faixa.max),
      desvio: (s.desvio!).toFixed(4)
    };
    if (s.desvio! < 0 || Number(valores.minimo) > Number(valores.medio) || Number(valores.medio) > Number(valores.maximo)) throw malformada();
    const cob = (coberturaDezMil(s.validos, pixelsGeometria) / 10_000).toFixed(4);
    const percentis = s.percentis
      ? Object.fromEntries(Object.entries(s.percentis).map(([k, v]) => [k, v === null ? null : valor4(v, faixa.min, faixa.max)]))
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
      metadados: escolha.metadados
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
    observacao: escolha.observacao,
    indices,
    indicadores: { ...indicadores, versao: VERSAO_INDICADORES_DERIVADOS },
    qualidade: indices[0]!.qualidade,
    evalscript_sha256: EVALSCRIPT_PASTAGEM_SHA256,
    versao_metodo: VERSAO_METODO_PASTAGEM_ESSENCIAL
  };
}
