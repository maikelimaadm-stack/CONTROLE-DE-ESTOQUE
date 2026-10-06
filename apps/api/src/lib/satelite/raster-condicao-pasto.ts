/**
 * GRADE, CHAVE E CORPO DA PROCESS API DO MAPA CATEGÓRICO — SAT-COND-01 (decisão 302).
 * Puro: sem rede, sem banco. Resolução alvo = 20 m (NDRE/NDMI/BSI).
 */
import { createHash } from "node:crypto";
import {
  CHAVE_MAPA_CONDICAO_PASTO,
  COLECAO_SENTINEL2_L2A,
  RESOLUCAO_ANALITICA_CONDICAO_PASTO_M,
  VERSAO_CLASSIFICADOR_CONDICAO_PASTO,
  VERSAO_EVALSCRIPT_CONDICAO_PASTO
} from "@agro/domain";
import { EVALSCRIPT_CONDICAO_PASTO_V1 } from "./evalscript-condicao-pasto.js";
import {
  CRS_RASTER, CRS_RASTER_URL, FORMATO_RASTER,
  planejarGradeRaster, type GradeRaster
} from "./raster.js";

export { CRS_RASTER, FORMATO_RASTER };
export const TIPO_MAPA_CONDICAO = "classificacao";
export const RESOLUCAO_ALVO_CONDICAO_M = RESOLUCAO_ANALITICA_CONDICAO_PASTO_M;

const HEX64 = /^[0-9a-f]{64}$/;
const UUID_CANONICO = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DATA = /^\d{4}-\d{2}-\d{2}$/;

export function planejarGradeCondicao(poligono: Parameters<typeof planejarGradeRaster>[0]): GradeRaster {
  return planejarGradeRaster(poligono, RESOLUCAO_ALVO_CONDICAO_M);
}

/**
 * sha256 de área|geometria|data|coleção|classificador|evalscript|resolução|crs|formato|tipo.
 * Trocar classificador, evalscript, geometria ou data invalida o cache.
 */
export function chaveCacheCondicaoPasto(p: {
  areaId: string; geometriaSha256: string; dataImagem: string; colecao: string;
  versaoClassificador: string; versaoEvalscript: string; resolucaoM: number; crs: string; formato: string;
}): string {
  if (typeof p.areaId !== "string" || !UUID_CANONICO.test(p.areaId)) throw new RangeError("area_id fora da forma canônica");
  if (!HEX64.test(p.geometriaSha256)) throw new RangeError("geometria_sha256 fora da forma");
  if (!DATA.test(p.dataImagem) || Number.isNaN(Date.parse(`${p.dataImagem}T00:00:00Z`))) throw new RangeError("data da imagem fora da forma");
  for (const texto of [p.colecao, p.versaoClassificador, p.versaoEvalscript, p.crs, p.formato]) {
    if (typeof texto !== "string" || !texto || texto.includes("|")) throw new RangeError("componente textual da chave fora da forma");
  }
  if (!Number.isInteger(p.resolucaoM) || p.resolucaoM < 1) throw new RangeError("resolução fora da forma");
  const partes = [
    p.areaId, p.geometriaSha256, p.dataImagem, p.colecao,
    p.versaoClassificador, p.versaoEvalscript, String(p.resolucaoM), p.crs, p.formato, TIPO_MAPA_CONDICAO
  ];
  return createHash("sha256").update(partes.join("|"), "utf8").digest("hex");
}

export function montarCorpoProcessoCondicao(
  grade: GradeRaster,
  janela: { inicio: Date; fim: Date }
): unknown {
  const inicio = janela.inicio.getTime(), fim = janela.fim.getTime();
  if (!Number.isFinite(inicio) || !Number.isFinite(fim) || fim <= inicio) throw new RangeError("janela da observação inválida");
  return {
    input: {
      bounds: {
        bbox: [...grade.bbox3857],
        geometry: { type: "Polygon", coordinates: grade.poligono3857.coordinates.map((anel) => anel.map(([x, y]) => [x, y])) },
        properties: { crs: CRS_RASTER_URL }
      },
      data: [{ type: COLECAO_SENTINEL2_L2A, dataFilter: { timeRange: { from: janela.inicio.toISOString(), to: janela.fim.toISOString() } } }]
    },
    output: { width: grade.largura, height: grade.altura, responses: [{ identifier: "default", format: { type: FORMATO_RASTER } }] },
    evalscript: EVALSCRIPT_CONDICAO_PASTO_V1
  };
}

export function caminhoDoMapaCondicao(p: {
  orgId: string; areaId: string; dataImagem: string; chaveCache: string;
}): string {
  if (!UUID_CANONICO.test(p.orgId) || !UUID_CANONICO.test(p.areaId) || !DATA.test(p.dataImagem) || !HEX64.test(p.chaveCache)) {
    throw new Error("caminho do mapa de condição: componente fora da forma");
  }
  return `${p.orgId}/${p.areaId}/${CHAVE_MAPA_CONDICAO_PASTO}/${p.dataImagem}/${p.chaveCache}.png`;
}

export const METADADOS_CONDICAO_PASTO = {
  chave: CHAVE_MAPA_CONDICAO_PASTO,
  tipo: TIPO_MAPA_CONDICAO,
  versaoClassificador: VERSAO_CLASSIFICADOR_CONDICAO_PASTO,
  versaoEvalscript: VERSAO_EVALSCRIPT_CONDICAO_PASTO,
  resolucaoAlvoM: RESOLUCAO_ALVO_CONDICAO_M
} as const;
