/**
 * Distribuição PIXEL-LEVEL de faixas temáticas — SAT-BUNDLE-01B [F2] R2.
 *
 * Conta pixels cujo CENTRO está DENTRO do polígono real.
 * Fora = ignorado. Nodata interno = sem_leitura.
 * Hectares: proporção × area_ha cadastral (nunca média × área total).
 */
import {
  ENCODING_RASTER_POR_INDICE, decodificarByteRaster
} from "@agro/domain";
import booleanPointInPolygon from "@turf/boolean-point-in-polygon";
import { multiPolygon, point, polygon } from "@turf/helpers";
import type { Feature, MultiPolygon, Polygon, Position } from "geojson";
import { assinaturaDaGeometria } from "./cache-rasters";
import type { CantosLngLat } from "./polygonizar-grade";
import { faixaDaMedia, faixasDoTema, indiceFonteDoTema, type FaixaVisualTema, type TemaMapaPasto } from "./temas-mapa-pasto";

export const FAIXA_SEM_LEITURA_ID = "sem_leitura";
export const FAIXA_SEM_LEITURA_ROTULO = "Sem leitura";
export const FAIXA_SEM_LEITURA_COR = "#cbd5e1";

export interface ContagemFaixa {
  id: string;
  rotulo: string;
  cor: string;
  pixels: number;
  proporcao_total: number;
  proporcao_valida: number;
  area_estimada_ha: number;
  area_estimada_percentual: number;
}

export interface DistribuicaoFaixasArea {
  pixels_internos: number;
  pixels_validos: number;
  pixels_sem_leitura: number;
  cobertura_valida: number;
  area_ha: number;
  faixas: ContagemFaixa[];
  sem_leitura: ContagemFaixa;
}

function featureArea(g: Polygon | MultiPolygon): Feature<Polygon | MultiPolygon> | null {
  try {
    if (g.type === "Polygon") {
      const rings = g.coordinates as Position[][];
      if (!rings[0] || rings[0].length < 4) return null;
      return polygon(rings);
    }
    const polys = (g.coordinates as Position[][][]).filter((p) => p[0] && p[0].length >= 4);
    if (polys.length === 0) return null;
    return multiPolygon(polys);
  } catch {
    return null;
  }
}

/** Centro lng/lat do pixel (col,row) — meia célula. */
export function centroPixelLngLat(
  col: number, row: number, largura: number, altura: number, cantos: CantosLngLat
): [number, number] {
  const [nw, ne, se, sw] = cantos;
  const u = (col + 0.5) / largura;
  const v = (row + 0.5) / altura;
  const top: [number, number] = [nw[0] + (ne[0] - nw[0]) * u, nw[1] + (ne[1] - nw[1]) * u];
  const bot: [number, number] = [sw[0] + (se[0] - sw[0]) * u, sw[1] + (se[1] - sw[1]) * u];
  return [top[0] + (bot[0] - top[0]) * v, top[1] + (bot[1] - top[1]) * v];
}

function codigoDaFaixa(valor: number, faixas: readonly FaixaVisualTema[]): number {
  for (const f of faixas) {
    if (valor >= f.min && valor < f.max) return f.codigo;
    if (f.max === Infinity && valor >= f.min) return f.codigo;
  }
  return faixas[faixas.length - 1]!.codigo;
}

function linha(
  f: { id: string; rotulo: string; cor: string },
  pixels: number,
  internos: number,
  validos: number,
  areaHa: number
): ContagemFaixa {
  const proporcao_total = internos > 0 ? pixels / internos : 0;
  const proporcao_valida = validos > 0 ? pixels / validos : 0;
  return {
    id: f.id,
    rotulo: f.rotulo,
    cor: f.cor,
    pixels,
    proporcao_total,
    proporcao_valida,
    area_estimada_ha: proporcao_total * areaHa,
    area_estimada_percentual: proporcao_total * 100
  };
}

const CACHE = new Map<string, DistribuicaoFaixasArea>();
const CACHE_MAX = 200;

export function limparCacheDistribuicaoFaixas(): void {
  CACHE.clear();
}

export function chaveCacheDistribuicao(p: {
  rasterId: string;
  tema: TemaMapaPasto;
  geometriaSha256: string;
  largura: number;
  altura: number;
  areaHa: number;
  versao?: string;
}): string {
  return [
    p.rasterId, p.tema, p.geometriaSha256,
    `${p.largura}x${p.altura}`, p.areaHa.toFixed(4), p.versao ?? "v1"
  ].join("|");
}

export function distribuirFaixasRasterNaArea(p: {
  pixels: Uint8Array | Uint8ClampedArray | readonly number[];
  largura: number;
  altura: number;
  cantos: CantosLngLat;
  geometria: Polygon | MultiPolygon | null | undefined;
  tema: TemaMapaPasto;
  areaHa: number;
  /** Identidade para cache (raster/mapa id). */
  rasterId?: string;
  geometriaSha256?: string;
}): DistribuicaoFaixasArea | null {
  if (p.tema === "condicao") return null;
  const indice = indiceFonteDoTema(p.tema);
  const faixas = faixasDoTema(p.tema);
  const enc = indice ? ENCODING_RASTER_POR_INDICE[indice] : null;
  if (!indice || !faixas || !enc || !p.geometria) return null;
  if (p.pixels.length !== p.largura * p.altura) return null;
  if (!(p.areaHa > 0) || !Number.isFinite(p.areaHa)) return null;

  const geoSha = p.geometriaSha256 ?? assinaturaDaGeometria(p.geometria);
  const cacheKey = p.rasterId
    ? chaveCacheDistribuicao({
      rasterId: p.rasterId, tema: p.tema, geometriaSha256: geoSha,
      largura: p.largura, altura: p.altura, areaHa: p.areaHa
    })
    : null;
  if (cacheKey) {
    const hit = CACHE.get(cacheKey);
    if (hit) return hit;
  }

  const feat = featureArea(p.geometria);
  if (!feat) return null;

  const contagem = new Map<number, number>();
  for (const f of faixas) contagem.set(f.codigo, 0);
  let internos = 0;
  let validos = 0;
  let semLeitura = 0;

  for (let row = 0; row < p.altura; row++) {
    for (let col = 0; col < p.largura; col++) {
      const [lng, lat] = centroPixelLngLat(col, row, p.largura, p.altura, p.cantos);
      if (!booleanPointInPolygon(point([lng, lat]), feat)) continue;
      internos += 1;
      const byte = p.pixels[row * p.largura + col]!;
      const valor = decodificarByteRaster(byte, enc.scaleMin, enc.scaleMax);
      if (valor === null) {
        semLeitura += 1;
        continue;
      }
      validos += 1;
      const cod = codigoDaFaixa(valor, faixas);
      contagem.set(cod, (contagem.get(cod) ?? 0) + 1);
    }
  }

  if (internos === 0) {
    const vazio: DistribuicaoFaixasArea = {
      pixels_internos: 0, pixels_validos: 0, pixels_sem_leitura: 0,
      cobertura_valida: 0, area_ha: p.areaHa,
      faixas: faixas.map((f) => linha(f, 0, 0, 0, p.areaHa)),
      sem_leitura: linha(
        { id: FAIXA_SEM_LEITURA_ID, rotulo: FAIXA_SEM_LEITURA_ROTULO, cor: FAIXA_SEM_LEITURA_COR },
        0, 0, 0, p.areaHa
      )
    };
    if (cacheKey) { CACHE.set(cacheKey, vazio); if (CACHE.size > CACHE_MAX) CACHE.delete(CACHE.keys().next().value!); }
    return vazio;
  }

  const porCodigo = new Map(faixas.map((f) => [f.codigo, f]));
  const faixasOut = faixas.map((f) =>
    linha(f, contagem.get(f.codigo) ?? 0, internos, validos, p.areaHa)
  );
  const result: DistribuicaoFaixasArea = {
    pixels_internos: internos,
    pixels_validos: validos,
    pixels_sem_leitura: semLeitura,
    cobertura_valida: validos / internos,
    area_ha: p.areaHa,
    faixas: faixasOut,
    sem_leitura: linha(
      { id: FAIXA_SEM_LEITURA_ID, rotulo: FAIXA_SEM_LEITURA_ROTULO, cor: FAIXA_SEM_LEITURA_COR },
      semLeitura, internos, validos, p.areaHa
    )
  };

  // Fechamento: soma ha ≈ area_ha (tolerância de arredondamento).
  const soma = faixasOut.reduce((s, x) => s + x.area_estimada_ha, 0) + result.sem_leitura.area_estimada_ha;
  if (Math.abs(soma - p.areaHa) > 1e-6 && internos > 0) {
    // Normaliza residual na maior faixa (ou sem_leitura).
    const residual = p.areaHa - soma;
    const alvo = faixasOut.reduce((m, x) => (x.pixels >= m.pixels ? x : m), result.sem_leitura);
    alvo.area_estimada_ha += residual;
    alvo.area_estimada_percentual = (alvo.area_estimada_ha / p.areaHa) * 100;
  }

  void porCodigo;
  if (cacheKey) {
    CACHE.set(cacheKey, result);
    if (CACHE.size > CACHE_MAX) CACHE.delete(CACHE.keys().next().value!);
  }
  return result;
}

/** Agrega hectares de uma faixa a partir de distribuições pixel-level já calculadas (vista atual). */
export function agregarFaixaNaVista(p: {
  faixaId: string;
  itens: readonly {
    areaId: string;
    nome: string;
    dist: DistribuicaoFaixasArea;
  }[];
}): {
  faixaId: string;
  ha: number;
  pctDaVista: number;
  pastos: number;
  principais: { id: string; nome: string; ha: number }[];
  haCarregada: number;
} {
  let ha = 0;
  let haCarregada = 0;
  const principais: { id: string; nome: string; ha: number }[] = [];
  for (const it of p.itens) {
    haCarregada += it.dist.area_ha;
    const linhaFaixa = p.faixaId === FAIXA_SEM_LEITURA_ID
      ? it.dist.sem_leitura
      : it.dist.faixas.find((f) => f.id === p.faixaId);
    const h = linhaFaixa?.area_estimada_ha ?? 0;
    if (h > 0) {
      ha += h;
      principais.push({ id: it.areaId, nome: it.nome, ha: h });
    }
  }
  principais.sort((a, b) => b.ha - a.ha);
  return {
    faixaId: p.faixaId,
    ha,
    pctDaVista: haCarregada > 0 ? (ha / haCarregada) * 100 : 0,
    pastos: principais.length,
    principais: principais.slice(0, 8),
    haCarregada
  };
}

/** @deprecated média×área — não usar para hectares. Mantido só se algum import legado existir. */
export function faixaResumoPorMedia(tema: TemaMapaPasto, media: number | null): FaixaVisualTema | null {
  return faixaDaMedia(tema, media);
}
