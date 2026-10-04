/**
 * GRADE, CHAVE DE CACHE E CORPO DA PROCESS API DO RASTER DE VALORES DO NDVI — SAT-06, decisão 297.
 *
 * Tudo aqui é PURO (sem rede, sem banco). A geometria vem sempre do banco (`erp.areas.geometria`, lida pelo servidor
 * depois da autorização, já conferida por `lerPoligono`); nada recebe polígono do cliente.
 *
 * 1. PROJEÇÃO: a imagem é pedida em EPSG:3857 (Web Mercator ESFÉRICO, raio 6 378 137 m) — o CRS do MapLibre: uma
 *    imagem retangular em 3857 cai sobre o mapa sem reprojeção, presa pelos quatro cantos.
 * 2. GRADE (`planejarGradeRaster`): caixa do polígono + `MARGEM_RASTER_PX` pixels de cada lado; pixel QUADRADO de
 *    ~`RESOLUCAO_ALVO_M` m NO TERRENO. Em 3857 o metro "cresce" com 1/cos(lat), então o lado do pixel em unidades do
 *    3857 é `resolução / cos(latitude central)` (a 15° S: 10 m no terreno = 10,35 m em 3857). Maior lado acima de
 *    `LADO_MAXIMO_RASTER_PX` → a resolução AUMENTA (metro inteiro, o menor que cabe) e a grade fica marcada
 *    `reduzida`. Menor lado abaixo de `LADO_MINIMO_RASTER_PX` → a resolução DIMINUI (metro inteiro ≥ 1) enquanto o
 *    maior lado continuar cabendo; se nem assim chegar ao mínimo (faixa estreita e comprida, ou área minúscula), o
 *    lado curto é COMPLETADO até o mínimo com mais margem (centrada). A caixa final tem exatamente largura × pixel por
 *    altura × pixel, centrada no polígono.
 * 3. CANTOS na ordem que o MapLibre espera numa fonte de imagem: superior-esquerdo, superior-direito,
 *    inferior-direito, inferior-esquerdo, cada um em [lng, lat].
 * 4. CHAVE DE CACHE (`chaveCacheRaster`): sha256 hex da ÁREA e de tudo que muda os bytes da imagem, numa ordem fixa.
 *    Mesma chave = mesma imagem DA MESMA ÁREA = reaproveitada sem chamar o provedor. A área entra (primeiro
 *    componente) porque duas áreas com o MESMO polígono e a mesma data — até de empresas diferentes da mesma
 *    organização — teriam a mesma chave e colidiriam no `unique (organization_id, chave_cache)`: a segunda nunca
 *    seria gravada e a leitura pela chave devolveria a imagem da outra área.
 * 5. CORPO (`montarCorpoProcesso`): `bounds` com a caixa E a geometria do polígono em 3857 (com `geometry` o provedor
 *    zera o que fica fora do polígono; só com a caixa, pintaria o retângulo todo); `timeRange` EXATAMENTE a janela
 *    recebida — a da OBSERVAÇÃO da análise, nunca "a mais recente"; saída PNG, uma resposta.
 */
import { createHash } from "node:crypto";
import { COLECAO_SENTINEL2_L2A } from "@agro/domain";
import { ESCALA_NDVI_RASTER, EVALSCRIPT_RASTER_NDVI, VERSAO_EVALSCRIPT_RASTER } from "./evalscript-raster.js";
import type { PoligonoGeoJson } from "./geometria.js";

// A escala e a versão moram com o script que as usa (evalscript-raster.ts); aqui são reexportadas.
export { ESCALA_NDVI_RASTER, VERSAO_EVALSCRIPT_RASTER };
export const TIPO_RASTER = "valores";
export const FORMATO_RASTER = "image/png";
export const CRS_RASTER = "EPSG:3857";
/** O mesmo CRS na forma de URL que a Process API exige em `bounds.properties.crs`. */
export const CRS_RASTER_URL = "http://www.opengis.net/def/crs/EPSG/0/3857";
export const RESOLUCAO_ALVO_M = 10;
export const LADO_MAXIMO_RASTER_PX = 2500;
export const LADO_MINIMO_RASTER_PX = 32;
export const MARGEM_RASTER_PX = 2;
/** Raio da esfera do Web Mercator (EPSG:3857). */
export const RAIO_3857_M = 6_378_137;
/** Latitude além da qual o EPSG:3857 não existe (y infinito). */
export const LATITUDE_MAXIMA_3857 = 85.0511287798066;

type Par = [number, number];

export interface GradeRaster {
  /** [min_x, min_y, max_x, max_y] em EPSG:3857 */
  bbox3857: [number, number, number, number];
  largura: number;
  altura: number;
  /** metros NO TERRENO por pixel (inteiro), na latitude central */
  resolucaoM: number;
  /** resolucaoM > RESOLUCAO_ALVO_M (a área não coube em LADO_MAXIMO_RASTER_PX a 10 m) */
  reduzida: boolean;
  poligono3857: { type: "Polygon"; coordinates: [number, number][][] };
  /** sup-esq, sup-dir, inf-dir, inf-esq — [lng, lat] */
  cantosLngLat: [[number, number], [number, number], [number, number], [number, number]];
}

const rad = (graus: number) => (graus * Math.PI) / 180;
const graus = (radianos: number) => (radianos * 180) / Math.PI;

/** lng/lat (graus, WGS84 tratado como esfera) → EPSG:3857 (metros). Fora da faixa do Web Mercator LANÇA. */
export function deLngLatPara3857(lng: number, lat: number): [number, number] {
  if (!Number.isFinite(lng) || !Number.isFinite(lat) || lng < -180 || lng > 180 || Math.abs(lat) > LATITUDE_MAXIMA_3857) {
    throw new RangeError("coordenada fora da faixa do EPSG:3857");
  }
  return [RAIO_3857_M * rad(lng), RAIO_3857_M * Math.log(Math.tan(Math.PI / 4 + rad(lat) / 2))];
}

/** EPSG:3857 (metros) → lng/lat (graus). */
export function de3857ParaLngLat(x: number, y: number): [number, number] {
  if (!Number.isFinite(x) || !Number.isFinite(y)) throw new RangeError("coordenada 3857 inválida");
  return [graus(x / RAIO_3857_M), graus(2 * Math.atan(Math.exp(y / RAIO_3857_M)) - Math.PI / 2)];
}

/** O dia UTC (AAAA-MM-DD) de um instante — a `data_imagem` de uma observação (dia UTC de `observacao_inicio`). */
export function dataImagemUtc(instante: Date): string {
  if (Number.isNaN(instante.getTime())) throw new RangeError("data inválida");
  return instante.toISOString().slice(0, 10);
}

export function planejarGradeRaster(poligono: PoligonoGeoJson): GradeRaster {
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
  // A folga de um milionésimo de pixel só absorve ruído numérico (100,0000001 px continua sendo 100 px).
  const lados = (resolucaoM: number) => {
    const pixel = resolucaoM / cosLat;
    return {
      largura: Math.max(1, Math.ceil(dx / pixel - 1e-6)) + 2 * MARGEM_RASTER_PX,
      altura: Math.max(1, Math.ceil(dy / pixel - 1e-6)) + 2 * MARGEM_RASTER_PX
    };
  };
  const maior = (r: number) => { const l = lados(r); return Math.max(l.largura, l.altura); };
  const menor = (r: number) => { const l = lados(r); return Math.min(l.largura, l.altura); };

  let resolucaoM = RESOLUCAO_ALVO_M;
  if (maior(resolucaoM) > LADO_MAXIMO_RASTER_PX) {
    // Começa de um piso seguro (nunca acima da menor resolução que cabe) e sobe de metro em metro: o resultado é a
    // MENOR resolução inteira que cabe.
    const piso = Math.floor((Math.max(dx, dy) * cosLat) / (LADO_MAXIMO_RASTER_PX - 2 * MARGEM_RASTER_PX + 1));
    resolucaoM = Math.max(RESOLUCAO_ALVO_M + 1, piso);
    while (maior(resolucaoM) > LADO_MAXIMO_RASTER_PX) resolucaoM++;
  } else {
    while (resolucaoM > 1 && menor(resolucaoM) < LADO_MINIMO_RASTER_PX && maior(resolucaoM - 1) <= LADO_MAXIMO_RASTER_PX) resolucaoM--;
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
    reduzida: resolucaoM > RESOLUCAO_ALVO_M,
    poligono3857: { type: "Polygon", coordinates: aneis3857.map((anel) => anel.map(([x, y]) => [x, y] as Par)) },
    cantosLngLat: [de3857ParaLngLat(bx0, by1), de3857ParaLngLat(bx1, by1), de3857ParaLngLat(bx1, by0), de3857ParaLngLat(bx0, by0)]
  };
}

const HEX64 = /^[0-9a-f]{64}$/;
/** UUID na forma canônica do Postgres (minúsculo, com hifens): a mesma área sempre gera o mesmo texto. */
const UUID_CANONICO = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DATA = /^\d{4}-\d{2}-\d{2}$/;

/**
 * sha256 hex de "área|geometria|data|coleção|versão|resolução|crs|formato|escala_min|escala_max", nessa ordem.
 * Componente fora da forma (área que não é UUID canônico minúsculo, hash que não é hex64, data fora de AAAA-MM-DD,
 * número não finito, texto com o separador) LANÇA: uma chave ambígua faria duas imagens diferentes parecerem a mesma,
 * e um UUID em outra grafia faria a mesma imagem parecer outra.
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

/**
 * Corpo da Process API. `janela` = EXATAMENTE `observacao_inicio..observacao_fim` da análise (o dia da imagem que deu
 * o número): a imagem pintada é a MESMA observação que a média da análise descreve.
 */
export function montarCorpoProcesso(grade: GradeRaster, janela: { inicio: Date; fim: Date }): unknown {
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
    evalscript: EVALSCRIPT_RASTER_NDVI
  };
}
