/**
 * GRADE, CHAVE DE CACHE E CORPO DA PROCESS API DO RASTER MULTI-ÍNDICE —
 * SAT-06 (decisão 297) + SATÉLITE COMPLETO (decisão 301).
 *
 * Tudo aqui é PURO (sem rede, sem banco). A geometria vem sempre do banco.
 * NDVI preserva a chave de cache da SAT-06 (mesmos componentes e versão `ndvi-valores-v1`).
 * Outros índices usam encodingVersion própria (evi2-valores-v1, …) — índice entra via versão.
 */
import { createHash } from "node:crypto";
import {
  COLECAO_SENTINEL2_L2A,
  encodingRasterDe,
  type IdIndiceRaster
} from "@agro/domain";
import {
  ESCALA_NDVI_RASTER,
  EVALSCRIPT_RASTER_POR_INDICE,
  VERSAO_EVALSCRIPT_RASTER
} from "./evalscript-raster.js";
import type { PoligonoGeoJson } from "./geometria.js";

export { ESCALA_NDVI_RASTER, VERSAO_EVALSCRIPT_RASTER };
export const TIPO_RASTER = "valores";
export const FORMATO_RASTER = "image/png";
export const CRS_RASTER = "EPSG:3857";
export const CRS_RASTER_URL = "http://www.opengis.net/def/crs/EPSG/0/3857";
export const RESOLUCAO_ALVO_M = 10;
export const LADO_MAXIMO_RASTER_PX = 2500;
export const LADO_MINIMO_RASTER_PX = 32;
export const MARGEM_RASTER_PX = 2;
export const RAIO_3857_M = 6_378_137;
export const LATITUDE_MAXIMA_3857 = 85.0511287798066;

type Par = [number, number];

export interface GradeRaster {
  bbox3857: [number, number, number, number];
  largura: number;
  altura: number;
  /** metros NO TERRENO por pixel (inteiro), na latitude central */
  resolucaoM: number;
  /** resolucaoM > resolução alvo pedida */
  reduzida: boolean;
  /** Resolução alvo pedida (10 ou 20 conforme o índice). */
  resolucaoAlvoM: number;
  poligono3857: { type: "Polygon"; coordinates: [number, number][][] };
  cantosLngLat: [[number, number], [number, number], [number, number], [number, number]];
}

const rad = (graus: number) => (graus * Math.PI) / 180;
const graus = (radianos: number) => (radianos * 180) / Math.PI;

export function deLngLatPara3857(lng: number, lat: number): [number, number] {
  if (!Number.isFinite(lng) || !Number.isFinite(lat) || lng < -180 || lng > 180 || Math.abs(lat) > LATITUDE_MAXIMA_3857) {
    throw new RangeError("coordenada fora da faixa do EPSG:3857");
  }
  return [RAIO_3857_M * rad(lng), RAIO_3857_M * Math.log(Math.tan(Math.PI / 4 + rad(lat) / 2))];
}

export function de3857ParaLngLat(x: number, y: number): [number, number] {
  if (!Number.isFinite(x) || !Number.isFinite(y)) throw new RangeError("coordenada 3857 inválida");
  return [graus(x / RAIO_3857_M), graus(2 * Math.atan(Math.exp(y / RAIO_3857_M)) - Math.PI / 2)];
}

export function dataImagemUtc(instante: Date): string {
  if (Number.isNaN(instante.getTime())) throw new RangeError("data inválida");
  return instante.toISOString().slice(0, 10);
}

/**
 * Planeja a grade. `resolucaoAlvoM` = resolução nativa/processamento do índice (10 ou 20).
 * Compat: chamada sem argumento = 10 m (SAT-06 NDVI).
 */
export function planejarGradeRaster(poligono: PoligonoGeoJson, resolucaoAlvoM: number = RESOLUCAO_ALVO_M): GradeRaster {
  if (!Number.isInteger(resolucaoAlvoM) || resolucaoAlvoM < 1) throw new RangeError("resolução alvo inválida");
  const externo = poligono.coordinates[0];
  if (poligono.type !== "Polygon" || !externo || externo.length < 4) throw new RangeError("polígono sem anel externo");
  const aneis3857 = poligono.coordinates.map((anel) => anel.map(([lng, lat]) => deLngLatPara3857(lng, lat)));

  let minx = Infinity, maxx = -Infinity, miny = Infinity, maxy = -Infinity, sul = Infinity, norte = -Infinity;
  externo.forEach(([, lat], i) => {
    const [x, y] = aneis3857[0]![i]!;
    minx = Math.min(minx, x); maxx = Math.max(maxx, x); miny = Math.min(miny, y); maxy = Math.max(maxy, y);
    sul = Math.min(sul, lat); norte = Math.max(norte, lat);
  });
  const cosLat = Math.cos(rad((sul + norte) / 2));
  const dx = maxx - minx, dy = maxy - miny;
  const lados = (resolucaoM: number) => {
    const pixel = resolucaoM / cosLat;
    return {
      largura: Math.max(1, Math.ceil(dx / pixel - 1e-6)) + 2 * MARGEM_RASTER_PX,
      altura: Math.max(1, Math.ceil(dy / pixel - 1e-6)) + 2 * MARGEM_RASTER_PX
    };
  };
  const maior = (r: number) => { const l = lados(r); return Math.max(l.largura, l.altura); };

  // Pixel real: resolucaoM NUNCA abaixo da nativa (10 m ou 20 m). Área grande pode
  // aumentar o metro/pixel (reduzida=true). Área minúscula mantém a nativa e completa
  // o bbox com margem até LADO_MINIMO_RASTER_PX — sem inventar 1 m / 2 m.
  let resolucaoM = resolucaoAlvoM;
  if (maior(resolucaoM) > LADO_MAXIMO_RASTER_PX) {
    const piso = Math.floor((Math.max(dx, dy) * cosLat) / (LADO_MAXIMO_RASTER_PX - 2 * MARGEM_RASTER_PX + 1));
    resolucaoM = Math.max(resolucaoAlvoM + 1, piso);
    while (maior(resolucaoM) > LADO_MAXIMO_RASTER_PX) resolucaoM++;
  }
  const pixel = resolucaoM / cosLat;
  const { largura: l0, altura: a0 } = lados(resolucaoM);
  const largura = Math.max(l0, LADO_MINIMO_RASTER_PX);
  const altura = Math.max(a0, LADO_MINIMO_RASTER_PX);
  const cx = (minx + maxx) / 2, cy = (miny + maxy) / 2;
  const bbox3857: [number, number, number, number] = [cx - (largura * pixel) / 2, cy - (altura * pixel) / 2, cx + (largura * pixel) / 2, cy + (altura * pixel) / 2];
  const [bx0, by0, bx1, by1] = bbox3857;
  return {
    bbox3857,
    largura,
    altura,
    resolucaoM,
    reduzida: resolucaoM > resolucaoAlvoM,
    resolucaoAlvoM,
    poligono3857: { type: "Polygon", coordinates: aneis3857.map((anel) => anel.map(([x, y]) => [x, y] as Par)) },
    cantosLngLat: [de3857ParaLngLat(bx0, by1), de3857ParaLngLat(bx1, by1), de3857ParaLngLat(bx1, by0), de3857ParaLngLat(bx0, by0)]
  };
}

const HEX64 = /^[0-9a-f]{64}$/;
const UUID_CANONICO = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DATA = /^\d{4}-\d{2}-\d{2}$/;

/**
 * sha256 hex de "área|geometria|data|coleção|versão|resolução|crs|formato|escala_min|escala_max".
 * A versão do evalscript embute o índice (ndvi-valores-v1, evi2-valores-v1, …): mudar índice muda a chave.
 */
export function chaveCacheRaster(p: {
  areaId: string; geometriaSha256: string; dataImagem: string; colecao: string; versaoEvalscript: string; resolucaoM: number;
  crs: string; formato: string; escalaMin: number; escalaMax: number;
}): string {
  if (typeof p.areaId !== "string" || !UUID_CANONICO.test(p.areaId)) throw new RangeError("area_id fora da forma canônica");
  if (!HEX64.test(p.geometriaSha256)) throw new RangeError("geometria_sha256 fora da forma");
  if (!DATA.test(p.dataImagem) || Number.isNaN(Date.parse(`${p.dataImagem}T00:00:00Z`))) throw new RangeError("data da imagem fora da forma");
  for (const texto of [p.colecao, p.versaoEvalscript, p.crs, p.formato]) {
    if (typeof texto !== "string" || !texto || texto.includes("|")) throw new RangeError("componente textual da chave fora da forma");
  }
  if (!Number.isInteger(p.resolucaoM) || p.resolucaoM < 1) throw new RangeError("resolução fora da forma");
  if (!Number.isFinite(p.escalaMin) || !Number.isFinite(p.escalaMax) || p.escalaMin >= p.escalaMax) throw new RangeError("escala fora da forma");
  const partes = [p.areaId, p.geometriaSha256, p.dataImagem, p.colecao, p.versaoEvalscript, String(p.resolucaoM), p.crs, p.formato, String(p.escalaMin), String(p.escalaMax)];
  return createHash("sha256").update(partes.join("|"), "utf8").digest("hex");
}

/** Corpo da Process API para o índice pedido (evalscript + escala do encoding). */
export function montarCorpoProcesso(
  grade: GradeRaster,
  janela: { inicio: Date; fim: Date },
  indice: IdIndiceRaster | string = "ndvi"
): unknown {
  const inicio = janela.inicio.getTime(), fim = janela.fim.getTime();
  if (!Number.isFinite(inicio) || !Number.isFinite(fim) || fim <= inicio) throw new RangeError("janela da observação inválida");
  const enc = encodingRasterDe(indice);
  if (!enc) throw new RangeError(`índice sem encoding de raster: ${indice}`);
  const evalscript = EVALSCRIPT_RASTER_POR_INDICE[enc.indice];
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
    evalscript
  };
}
