/**
 * MÉTODO PASTAGEM ESSENCIAL (versão `pastagem-essencial-v1`) — SAT-08, decisão 299.
 *
 * Uma chamada à Statistical API, vários índices (NDVI, EVI2, NDRE, NDMI, MSAVI2, BSI) + histograma SCL.
 * - Pixel inválido SAI pela dataMask (não vira zero na média).
 * - calculations casam aos IDs dos outputs (nunca `default` cego com outputs nomeados).
 * - Agregação em 20 m; cada índice declara resolução nativa no catálogo.
 * - CLD não entra nesta versão: a máscara usa SCL + dataMask (nuvem/cirro/sombra já excluídos).
 */
import { createHash } from "node:crypto";
import {
  BANDAS_BUNDLE_ESSENCIAL,
  CATALOGO_INDICES,
  CLASSES_SCL_EXCLUIDAS,
  CRITERIO_OBSERVACAO_UTIL,
  COLECAO_SENTINEL2_L2A,
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

export const RESOLUCAO_AGREGACAO_M = RESOLUCAO_AGREGACAO_PASTAGEM_M;
export { VERSAO_METODO_PASTAGEM_ESSENCIAL };

export const EVALSCRIPT_PASTAGEM_ESSENCIAL = `//VERSION=3
// SAT-08 (decisão 299, ${VERSAO_METODO_PASTAGEM_ESSENCIAL}): bundle pastagem essencial.
// NDVI=(B08-B04)/(B08+B04); EVI2=2.5*(B08-B04)/(B08+2.4*B04+1);
// NDRE=(B8A-B05)/(B8A+B05); NDMI=(B8A-B11)/(B8A+B11);
// MSAVI2=(2*B08+1-sqrt((2*B08+1)^2-8*(B08-B04)))/2;
// BSI=((B11+B04)-(B08+B02))/((B11+B04)+(B08+B02)).
// Pixel inválido não vale zero: sai por dataMask=0.
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
      { id: "dataMask", bands: 1 }
    ]
  };
}
function evaluatePixel(s) {
  var sclOk = SCL_EXCLUIDAS.indexOf(s.SCL) === -1;
  var base = s.dataMask === 1 && sclOk
    && s.B02 >= 0 && s.B04 >= 0 && s.B05 >= 0 && s.B08 >= 0 && s.B8A >= 0 && s.B11 >= 0;
  var somaNdvi = s.B08 + s.B04;
  var denEvi = s.B08 + 2.4 * s.B04 + 1;
  var somaNdre = s.B8A + s.B05;
  var somaNdmi = s.B8A + s.B11;
  var aMsavi = 2 * s.B08 + 1;
  var intMsavi = aMsavi * aMsavi - 8 * (s.B08 - s.B04);
  var denBsi = (s.B11 + s.B04) + (s.B08 + s.B02);
  var valido = base && somaNdvi > 0 && denEvi > 0 && somaNdre > 0 && somaNdmi > 0 && intMsavi >= 0 && denBsi > 0;
  var ndvi = valido ? (s.B08 - s.B04) / somaNdvi : 0;
  var evi2 = valido ? 2.5 * (s.B08 - s.B04) / denEvi : 0;
  var ndre = valido ? (s.B8A - s.B05) / somaNdre : 0;
  var ndmi = valido ? (s.B8A - s.B11) / somaNdmi : 0;
  var msavi2 = valido ? (aMsavi - Math.sqrt(intMsavi)) / 2 : 0;
  var bsi = valido ? ((s.B11 + s.B04) - (s.B08 + s.B02)) / denBsi : 0;
  return {
    ndvi: [ndvi], evi2: [evi2], ndre: [ndre], ndmi: [ndmi], msavi2: [msavi2], bsi: [bsi],
    scl: [s.SCL],
    dataMask: [valido ? 1 : 0]
  };
}
`;

export const EVALSCRIPT_PASTAGEM_SHA256 = createHash("sha256").update(EVALSCRIPT_PASTAGEM_ESSENCIAL, "utf8").digest("hex");

/** calculations: uma chave por output nomeado — nunca só `default` com outputs nomeados. */
export function montarCalculationsPastagem() {
  const percentis = { k: [...PERCENTIS_SATELITE] };
  const histIndice = { nBins: 20, lowEdge: -1, highEdge: 1 };
  const porIndice = Object.fromEntries(
    INDICES_BUNDLE_ESSENCIAL.map((id) => [id, {
      statistics: { default: { percentiles: percentis } },
      histograms: { default: histIndice }
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

export interface StatsIndice {
  amostra: number;
  semDado: number;
  validos: number;
  media: number | null;
  minimo: number | null;
  maximo: number | null;
  desvio: number | null;
  percentis: Record<string, number | null> | null;
  histograma: { bins: number[]; counts: number[] } | null;
}

export interface IntervaloMulti {
  inicio: Date;
  fim: Date;
  porIndice: Record<IdIndiceSatelite, StatsIndice>;
  sclHistograma: { bins: number[]; counts: number[] } | null;
}

export interface EstatisticaMultiLida {
  intervalos: IntervaloMulti[];
  errosEm: (Date | null)[];
  statusProvedor: string | null;
}

function lerPercentis(stats: Record<string, unknown>): Record<string, number | null> | null {
  const p = objeto(stats["percentiles"]);
  if (!p) return null;
  const out: Record<string, number | null> = {};
  for (const k of PERCENTIS_SATELITE) {
    const chave = String(k);
    const v = numeroOuNulo(p[chave] ?? p[`p${chave}`]);
    if (v === undefined) return null;
    out[`p${chave}`] = v;
  }
  return out;
}

function lerHistograma(banda: Record<string, unknown> | null): { bins: number[]; counts: number[] } | null {
  if (!banda) return null;
  const h = objeto(banda["histogram"]) ?? (Array.isArray(banda["histograms"]) ? objeto((banda["histograms"] as unknown[])[0]) : null);
  // Statistical API: bands.B0.histogram { bins: [...], counts: [...] } ou similar
  const hist = h ?? objeto(banda["histogram"]);
  const raiz = hist ?? banda;
  const bins = raiz["bins"];
  const counts = raiz["counts"] ?? raiz["binCounts"];
  if (!Array.isArray(bins) || !Array.isArray(counts)) return null;
  if (bins.some((x) => typeof x !== "number") || counts.some((x) => typeof x !== "number" || !Number.isInteger(x) || x < 0)) return null;
  return { bins: bins as number[], counts: counts as number[] };
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

function lerSclHist(outputs: Record<string, unknown>): { bins: number[]; counts: number[] } | null {
  const out = objeto(outputs["scl"]);
  const banda = objeto(objeto(out)?.["bands"])?.["B0"] ?? objeto(objeto(out)?.["bands"])?.["default"];
  return lerHistograma(objeto(banda));
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
    // Recusa calculations.default cego: cada índice do bundle TEM de existir como output nomeado.
    const porIndice = {} as Record<IdIndiceSatelite, StatsIndice>;
    for (const id of INDICES_BUNDLE_ESSENCIAL) {
      const s = lerStatsBanda(outputs, id);
      if (!s) throw malformada();
      porIndice[id] = s;
    }
    intervalos.push({ ...intervalo, porIndice, sclHistograma: lerSclHist(outputs) });
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

function fracaoBins(hist: { bins: number[]; counts: number[] } | null, pred: (centro: number) => boolean): number | null {
  if (!hist || hist.counts.length === 0) return null;
  // bins pode ser edges (n+1) ou centros (n)
  const n = hist.counts.length;
  let total = 0; let ok = 0;
  for (let i = 0; i < n; i++) {
    const c = hist.counts[i]!;
    total += c;
    const centro = hist.bins.length === n + 1
      ? (hist.bins[i]! + hist.bins[i + 1]!) / 2
      : hist.bins[i]!;
    if (pred(centro)) ok += c;
  }
  if (total <= 0) return null;
  return ok / total;
}

export interface QualidadeObservacao {
  versao: string;
  estado: ReturnType<typeof estadoQualidade>;
  cobertura_valida: string | null;
  valid_ratio: string | null;
  cloud_ratio: string | null;
  scl_composition: Record<string, number> | null;
  mascara: { scl_excluidas: number[]; cld: false; dataMask: true };
  motivo: string | null;
}

function qualidadeDe(
  stats: StatsIndice,
  pixelsGeometria: number,
  situacao: "concluida" | "sem_observacao_util",
  motivo: string | null,
  sclHist: { bins: number[]; counts: number[] } | null
): QualidadeObservacao {
  const cob = situacao === "concluida" ? coberturaDezMil(stats.validos, pixelsGeometria) / 10_000 : null;
  const validRatio = stats.amostra > 0 ? stats.validos / stats.amostra : null;
  let cloudRatio: number | null = null;
  let sclComp: Record<string, number> | null = null;
  if (sclHist) {
    const total = sclHist.counts.reduce((a, b) => a + b, 0);
    if (total > 0) {
      sclComp = {};
      let nuvem = 0;
      for (let i = 0; i < sclHist.counts.length; i++) {
        const classe = sclHist.bins.length === sclHist.counts.length + 1 ? Math.floor(sclHist.bins[i]!) : Math.round(sclHist.bins[i]!);
        const frac = sclHist.counts[i]! / total;
        sclComp[String(classe)] = Number(frac.toFixed(4));
        if (classe === 3 || classe === 8 || classe === 9 || classe === 10) nuvem += sclHist.counts[i]!;
      }
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
    mascara: { scl_excluidas: CLASSES_SCL_EXCLUIDAS.map(([c]) => c), cld: false, dataMask: true },
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
  histograma: { bins: number[]; counts: number[] } | null;
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
  // Adaptar para o seletor NDVI da v2 (mesma janela/critério).
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
      pixelsGeometria, "sem_observacao_util", escolha.motivo, null
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
    const valores = {
      medio: valor4(s.media!, cat.dominio.min, cat.dominio.max),
      minimo: valor4(s.minimo!, cat.dominio.min, cat.dominio.max),
      maximo: valor4(s.maximo!, cat.dominio.min, cat.dominio.max),
      desvio: (s.desvio!).toFixed(4)
    };
    if (s.desvio! < 0 || Number(valores.minimo) > Number(valores.medio) || Number(valores.medio) > Number(valores.maximo)) throw malformada();
    const cob = (coberturaDezMil(s.validos, pixelsGeometria) / 10_000).toFixed(4);
    const percentis = s.percentis
      ? Object.fromEntries(Object.entries(s.percentis).map(([k, v]) => [k, v === null ? null : valor4(v, cat.dominio.min, cat.dominio.max)]))
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
      qualidade: qualidadeDe(s, pixelsGeometria, "concluida", null, dia.sclHistograma),
      metadados: escolha.metadados
    };
  });

  const ndviHist = dia.porIndice.ndvi.histograma;
  const bsiHist = dia.porIndice.bsi.histograma;
  const fracaoVegetacao = fracaoBins(ndviHist, (c) => c >= LIMIARES_COBERTURA_EXPERIMENTAL.vegetacaoAtivaNdvi);
  const fracaoBaixa = fracaoBins(ndviHist, (c) =>
    c >= LIMIARES_COBERTURA_EXPERIMENTAL.baixaCoberturaNdviMin && c < LIMIARES_COBERTURA_EXPERIMENTAL.vegetacaoAtivaNdvi);
  const fracaoSolo = fracaoBins(bsiHist, (c) => c >= LIMIARES_COBERTURA_EXPERIMENTAL.bsiSoloExposto)
    ?? fracaoBins(ndviHist, (c) => c < LIMIARES_COBERTURA_EXPERIMENTAL.soloExpostoNdvi);

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
