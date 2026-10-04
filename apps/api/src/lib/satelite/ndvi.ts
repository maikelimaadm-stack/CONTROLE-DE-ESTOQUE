/**
 * MÉTODO NDVI (versão `VERSAO_METODO_NDVI`) — SAT-01, decisão 293.
 *
 * Quatro peças puras, sem rede e sem banco:
 *  1. `EVALSCRIPT_NDVI`: Evalscript V3 da Sentinel-2 L2A. NDVI = (B08 − B04) / (B08 + B04). O pixel só entra na
 *     estatística quando `dataMask` = 1, as duas reflectâncias são ≥ 0, a soma é > 0 e a classe da SCL NÃO está em
 *     `CLASSES_SCL_EXCLUIDAS` (lista do domínio, interpolada aqui — não redigitada). Pixel recusado sai pela saída
 *     `dataMask` = 0: ele não vale zero, ele não entra na média.
 *  2. `janelaPadrao`: os últimos `JANELA_PADRAO_DIAS` dias UTC inteiros, hoje incluído (fim exclusivo = próxima
 *     meia-noite UTC). É também a chave de reaproveitamento: no mesmo dia UTC a janela é a mesma.
 *  3. `montarCorpoEstatistica`: o corpo da Statistical API com a GEOMETRIA da área (não o retângulo) em CRS84,
 *     intervalos de 1 dia (`P1D`) e a grade de 10 m convertida em graus.
 *  4. `interpretarEstatistica` + `escolherObservacao`: leitura ESTRITA da resposta (fora do contrato →
 *     `resposta_malformada`, nunca um número inventado) e a escolha da observação útil MAIS RECENTE pelo
 *     `CRITERIO_OBSERVACAO_UTIL`. A data é a do intervalo devolvido pelo provedor, nunca a do registro.
 */
import {
  CLASSES_SCL_EXCLUIDAS, CRITERIO_OBSERVACAO_UTIL, COLECAO_SENTINEL2_L2A, JANELA_PADRAO_DIAS
} from "@agro/domain";
import { FalhaCopernicus } from "./copernicus.js";
import type { GradeDaAnalise, PoligonoGeoJson } from "./geometria.js";

const DIA_MS = 86_400_000;
const CRS84 = "http://www.opengis.net/def/crs/OGC/1.3/CRS84";

export const EVALSCRIPT_NDVI = `//VERSION=3
// SAT-01 (decisão 293): NDVI = (B08 - B04) / (B08 + B04) na Sentinel-2 L2A.
// Pixel inválido não vale zero: sai da estatística por dataMask = 0.
var SCL_EXCLUIDAS = [${CLASSES_SCL_EXCLUIDAS.map(([classe]) => classe).join(", ")}];
function setup() {
  return {
    input: [{ bands: ["B04", "B08", "SCL", "dataMask"] }],
    output: [
      { id: "ndvi", bands: 1, sampleType: "FLOAT32" },
      { id: "dataMask", bands: 1 }
    ]
  };
}
function evaluatePixel(s) {
  var soma = s.B08 + s.B04;
  var valido = s.dataMask === 1 && s.B04 >= 0 && s.B08 >= 0 && soma > 0 && SCL_EXCLUIDAS.indexOf(s.SCL) === -1;
  return { ndvi: [valido ? (s.B08 - s.B04) / soma : 0], dataMask: [valido ? 1 : 0] };
}
`;

export interface Janela { inicio: Date; fim: Date }

export function janelaPadrao(agoraMs: number): Janela {
  const fim = Math.floor(agoraMs / DIA_MS) * DIA_MS + DIA_MS;
  return { inicio: new Date(fim - JANELA_PADRAO_DIAS * DIA_MS), fim: new Date(fim) };
}

export function montarCorpoEstatistica(poligono: PoligonoGeoJson, janela: Janela, grade: Pick<GradeDaAnalise, "resx" | "resy">) {
  return {
    input: {
      bounds: { geometry: { type: poligono.type, coordinates: poligono.coordinates }, properties: { crs: CRS84 } },
      data: [{ type: COLECAO_SENTINEL2_L2A }]
    },
    aggregation: {
      timeRange: { from: janela.inicio.toISOString(), to: janela.fim.toISOString() },
      aggregationInterval: { of: "P1D" },
      evalscript: EVALSCRIPT_NDVI,
      resx: grade.resx,
      resy: grade.resy
    }
  };
}

/** Um intervalo (dia) com estatística. `media`…`desvio` são nulos quando nenhum pixel passou na máscara. */
export interface IntervaloEstatistico {
  inicio: Date;
  fim: Date;
  amostra: number;
  semDado: number;
  validos: number;
  media: number | null;
  minimo: number | null;
  maximo: number | null;
  desvio: number | null;
}

export interface EstatisticaLida {
  intervalos: IntervaloEstatistico[];
  /** início de cada intervalo que o provedor devolveu com erro (`null`: erro sem intervalo legível) */
  errosEm: (Date | null)[];
  statusProvedor: string | null;
}

const malformada = () => new FalhaCopernicus("resposta_malformada", 200);
const objeto = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const contagem = (v: unknown): number | null => (typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : null);
/** número finito; "NaN"/null/ausente → null (a API devolve "NaN" quando a máscara recusou tudo) */
const numeroOuNulo = (v: unknown): number | null | undefined => {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (v === null || v === undefined || v === "NaN") return null;
  return undefined; // tipo fora do contrato
};

function lerIntervalo(v: unknown): { inicio: Date; fim: Date } | null {
  const o = objeto(v);
  if (!o || typeof o["from"] !== "string" || typeof o["to"] !== "string") return null;
  const inicio = new Date(o["from"]); const fim = new Date(o["to"]);
  if (Number.isNaN(inicio.getTime()) || Number.isNaN(fim.getTime()) || fim <= inicio) return null;
  return { inicio, fim };
}

export function interpretarEstatistica(corpo: unknown, janela: Janela): EstatisticaLida {
  const raiz = objeto(corpo);
  if (!raiz || !Array.isArray(raiz["data"])) throw malformada();
  const status = typeof raiz["status"] === "string" && /^[A-Z_]{1,32}$/.test(raiz["status"]) ? raiz["status"] : null;
  const intervalos: IntervaloEstatistico[] = [];
  const errosEm: (Date | null)[] = [];
  for (const item of raiz["data"] as unknown[]) {
    const o = objeto(item);
    if (!o) throw malformada();
    const intervalo = lerIntervalo(o["interval"]);
    if (o["error"] !== undefined) { errosEm.push(intervalo?.inicio ?? null); continue; }
    if (!intervalo) throw malformada();
    // O provedor só pode devolver dias DENTRO da janela pedida; fora dela a resposta não é a que foi pedida.
    if (intervalo.inicio < janela.inicio || intervalo.fim > janela.fim) throw malformada();
    const stats = objeto(objeto(objeto(objeto(objeto(o["outputs"])?.["ndvi"])?.["bands"])?.["B0"])?.["stats"]);
    if (!stats) throw malformada();
    const amostra = contagem(stats["sampleCount"]);
    const semDado = contagem(stats["noDataCount"]);
    if (amostra === null || semDado === null || semDado > amostra) throw malformada();
    const validos = amostra - semDado;
    const [media, minimo, maximo, desvio] = (["mean", "min", "max", "stDev"] as const).map((k) => numeroOuNulo(stats[k]));
    if (media === undefined || minimo === undefined || maximo === undefined || desvio === undefined) throw malformada();
    if (validos > 0 && (media === null || minimo === null || maximo === null || desvio === null)) throw malformada();
    intervalos.push({ ...intervalo, amostra, semDado, validos, media, minimo, maximo, desvio });
  }
  return { intervalos, errosEm, statusProvedor: status };
}

/** Metadados SANITIZADOS (lista branca) gravados em `metadados_provedor`. Só contagens e rótulos fixos. */
export interface MetadadosAnalise {
  intervalos_recebidos: number;
  intervalos_com_erro: number;
  intervalos_com_dado: number;
  intervalos_uteis: number;
  maior_cobertura: string | null;
  fonte_pixels_geometria: "grade_crs84";
  status_provedor: string | null;
}

export type ResultadoNdvi =
  | {
      situacao: "concluida";
      observacao: { inicio: Date; fim: Date };
      valores: { medio: string; minimo: string; maximo: string; desvio: string };
      pixels: { amostra: number; semDado: number; validos: number; geometria: number };
      cobertura: string;
      metadados: MetadadosAnalise;
    }
  | {
      situacao: "sem_observacao_util";
      motivo: "sem_aquisicao" | "cobertura_insuficiente";
      pixelsGeometria: number;
      metadados: MetadadosAnalise;
    };

/** Cobertura em décimos de milésimo, por aritmética INTEIRA e arredondada para baixo (nunca promove uma imagem). */
function coberturaDezMil(validos: number, pixelsGeometria: number): number {
  if (pixelsGeometria <= 0) return 0;
  return Math.min(10_000, Math.floor((validos * 10_000) / pixelsGeometria));
}

const TOLERANCIA_FAIXA = 1e-6;
/** Valor do NDVI com 4 casas. Fora de [-1, 1] (além do erro de ponto flutuante) a resposta não é um NDVI. */
function ndvi4(v: number): string {
  if (v < -1 - TOLERANCIA_FAIXA || v > 1 + TOLERANCIA_FAIXA) throw malformada();
  const t = Math.min(1, Math.max(-1, v)).toFixed(4);
  return t === "-0.0000" ? "0.0000" : t;
}

export function escolherObservacao(lida: EstatisticaLida, pixelsGeometria: number): ResultadoNdvi {
  const minimaDezMil = Math.round(CRITERIO_OBSERVACAO_UTIL.coberturaMinima * 10_000);
  const uteis = lida.intervalos.filter((i) =>
    i.validos >= CRITERIO_OBSERVACAO_UTIL.pixelsValidosMinimos && coberturaDezMil(i.validos, pixelsGeometria) >= minimaDezMil);
  const maior = lida.intervalos.reduce<number | null>((m, i) => Math.max(m ?? 0, coberturaDezMil(i.validos, pixelsGeometria)), null);
  const metadados: MetadadosAnalise = {
    intervalos_recebidos: lida.intervalos.length + lida.errosEm.length,
    intervalos_com_erro: lida.errosEm.length,
    intervalos_com_dado: lida.intervalos.filter((i) => i.validos > 0).length,
    intervalos_uteis: uteis.length,
    maior_cobertura: maior === null ? null : (maior / 10_000).toFixed(4),
    fonte_pixels_geometria: "grade_crs84",
    status_provedor: lida.statusProvedor
  };
  const escolhida = [...uteis].sort((a, b) => b.inicio.getTime() - a.inicio.getTime())[0];
  // Um dia com ERRO do provedor mais recente do que a escolha (ou qualquer erro quando nada serviu) poderia ser a
  // observação útil mais recente: sem ele não há como afirmar a escolha nem a falta dela. Nada é gravado e o pedido
  // pode ser repetido.
  const erroDecisivo = lida.errosEm.some((em) => em === null || !escolhida || em.getTime() >= escolhida.inicio.getTime());
  if (erroDecisivo) throw new FalhaCopernicus("processamento_parcial", 200);
  if (!escolhida) {
    return { situacao: "sem_observacao_util", motivo: lida.intervalos.length ? "cobertura_insuficiente" : "sem_aquisicao", pixelsGeometria, metadados };
  }
  const valores = { medio: ndvi4(escolhida.media!), minimo: ndvi4(escolhida.minimo!), maximo: ndvi4(escolhida.maximo!), desvio: (escolhida.desvio!).toFixed(4) };
  if (escolhida.desvio! < 0 || Number(valores.minimo) > Number(valores.medio) || Number(valores.medio) > Number(valores.maximo)) throw malformada();
  return {
    situacao: "concluida",
    observacao: { inicio: escolhida.inicio, fim: escolhida.fim },
    valores,
    pixels: { amostra: escolhida.amostra, semDado: escolhida.semDado, validos: escolhida.validos, geometria: pixelsGeometria },
    cobertura: (coberturaDezMil(escolhida.validos, pixelsGeometria) / 10_000).toFixed(4),
    metadados
  };
}
