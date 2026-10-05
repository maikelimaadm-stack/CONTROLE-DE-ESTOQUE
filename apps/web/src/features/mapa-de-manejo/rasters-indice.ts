/**
 * Cliente e cache dos rasters por índice (SAT-06/07, generalizado na decisão 301).
 *
 * Listagem e geração passam por sessão; o arquivo PNG usa só a URL assinada (sem credenciais). A `url_assinada` vale 10
 * minutos e NÃO fica em cache persistente: em 404 pedimos o DTO de novo uma vez. O bitmap DECODIFICADO (bytes cinza)
 * fica em memória enquanto a área está à vista, para trocar de modo sem baixar de novo.
 *
 * Carga PREGUIÇOSA: o cache é do índice ATIVO e da data ativa. Trocar de índice solta tudo (e revoga as ObjectURLs);
 * pedido obsoleto é abortado. O que decide quais áreas pedem raster está em `viewport-rasters.ts`.
 */
"use client";
import * as React from "react";
import { ehIndiceDoBundle } from "@agro/domain";
import { API_URL, api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { bitmapParaBytesCinza, colorirRasterNdvi } from "./colorir-raster-ndvi";
import { escalaDeCodificacao, montarLutIndice, type IdIndice } from "./paletas-indices";
import {
  idsFaltando,
  listarRastersPorAreas as listarPaginado,
  type RasterIndiceDto,
  type RequisitarJson
} from "./viewport-rasters";

export type { RasterIndiceDto } from "./viewport-rasters";
/** Compatibilidade com a SAT-07 (só NDVI). */
export type RasterNdviDto = RasterIndiceDto;

/** Mesma capacidade de leitura do resumo — evita import circular com `ndvi.tsx`. */
const PERMISSAO_VER_RASTER = "analises_satelitais.view";

/** Data ativa da camada. Hoje só a "última imagem útil": a API lista a imagem mais recente por área. */
export type DataDaCamada = "ultima";
export const DATA_ULTIMA_IMAGEM: DataDaCamada = "ultima";

export interface EntradaRasterEmMemoria {
  dto: RasterIndiceDto;
  /** Bytes cinza 1 bpp (canal R), para recolorir sem baixar. */
  bytesCinza: Uint8ClampedArray;
  largura: number;
  altura: number;
  /** Canvas colorido na paleta do índice (HTMLCanvasElement para fonte canvas/image). */
  canvas: HTMLCanvasElement;
  blobUrl: string | null;
  erro: string | null;
}

/** Downloads simultâneos de PNG (a listagem já é uma chamada só). */
const DOWNLOADS_SIMULTANEOS = 4;

export function urlAbsolutaDoArquivo(urlAssinada: string): string {
  if (urlAssinada.startsWith("http://") || urlAssinada.startsWith("https://")) return urlAssinada;
  return `${API_URL}${urlAssinada}`;
}

const requisitarApi: RequisitarJson = (caminho, opcoes) => api(caminho, { signal: opcoes?.signal });

/** Lista a imagem mais recente por área (nunca gera). Parte em lotes de até 200 ids. */
export function listarRastersPorAreas(areaIds: readonly string[], indice = "ndvi", signal?: AbortSignal): Promise<RasterIndiceDto[]> {
  return listarPaginado(areaIds, indice, requisitarApi, { signal });
}

/** Baixa o PNG pela URL assinada (CORS, sem credenciais). Em 404 devolve null para o chamador renovar o DTO. */
export async function baixarArquivoRaster(urlAssinada: string, signal?: AbortSignal): Promise<Blob | null> {
  const res = await fetch(urlAbsolutaDoArquivo(urlAssinada), { mode: "cors", credentials: "omit", signal });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Não foi possível baixar a imagem do satélite (${res.status}).`);
  return res.blob();
}

async function blobParaBitmap(blob: Blob): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(blob, { colorSpaceConversion: "none", premultiplyAlpha: "none" });
  } catch {
    // Chromium antigo / ambiente de teste: opções tipadas podem falhar — tenta sem elas.
    return createImageBitmap(blob);
  }
}

function canvasHtml(largura: number, altura: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = largura;
  c.height = altura;
  return c;
}

function lutDoDto(dto: RasterIndiceDto, indiceAtivo: IdIndice): Uint8ClampedArray {
  const indice = ehIndiceDoBundle(dto.indice) ? dto.indice : indiceAtivo;
  return montarLutIndice(indice, escalaDeCodificacao(indice, dto));
}

async function canvasParaBlobUrl(canvas: HTMLCanvasElement): Promise<string> {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("Não foi possível serializar a imagem colorida.");
  return URL.createObjectURL(blob);
}

/** Recolore os bytes guardados numa nova LUT (troca de paleta sem rede). */
export async function recolorirEntrada(entrada: EntradaRasterEmMemoria, lut: Uint8ClampedArray): Promise<EntradaRasterEmMemoria> {
  const colorido = colorirRasterNdvi(entrada.bytesCinza, entrada.largura, entrada.altura, lut);
  const canvas = canvasHtml(entrada.largura, entrada.altura);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D indisponível para pintar a imagem.");
  ctx.putImageData(colorido, 0, 0);
  if (entrada.blobUrl) URL.revokeObjectURL(entrada.blobUrl);
  const blobUrl = await canvasParaBlobUrl(canvas);
  return { ...entrada, canvas, blobUrl, erro: null };
}

async function montarEntrada(dto: RasterIndiceDto, indiceAtivo: IdIndice, signal?: AbortSignal): Promise<EntradaRasterEmMemoria> {
  let blob = await baixarArquivoRaster(dto.url_assinada, signal);
  let dtoAtual = dto;
  if (!blob) {
    // URL vencida: pede o DTO de novo UMA vez e tenta de novo.
    const renovados = await listarRastersPorAreas([dto.area_id], dto.indice, signal);
    const novo = renovados.find((r) => r.area_id === dto.area_id) ?? null;
    if (!novo) throw new Error("Imagem não encontrada.");
    dtoAtual = novo;
    blob = await baixarArquivoRaster(novo.url_assinada, signal);
    if (!blob) throw new Error("O link da imagem expirou de novo. Tente mais tarde.");
  }
  const bitmap = await blobParaBitmap(blob);
  try {
    const { bytes, largura, altura } = await bitmapParaBytesCinza(bitmap);
    const colorido = colorirRasterNdvi(bytes, largura, altura, lutDoDto(dtoAtual, indiceAtivo));
    const canvas = canvasHtml(largura, altura);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D indisponível para pintar a imagem.");
    ctx.putImageData(colorido, 0, 0);
    return { dto: dtoAtual, bytesCinza: bytes, largura, altura, canvas, blobUrl: await canvasParaBlobUrl(canvas), erro: null };
  } finally {
    bitmap.close();
  }
}

export function liberarEntrada(entrada: EntradaRasterEmMemoria | undefined) {
  if (!entrada) return;
  if (entrada.blobUrl) URL.revokeObjectURL(entrada.blobUrl);
}

const ehAborto = (e: unknown) => e instanceof DOMException && e.name === "AbortError";

/** Gera (ou reaproveita) a imagem da análise — só em clique deliberado. */
export async function gerarRasterDaAnalise(analiseId: string): Promise<{ raster: RasterIndiceDto; reutilizada: boolean }> {
  return api<{ raster: RasterIndiceDto; reutilizada: boolean }>(`/api/mapa/analises-satelitais/${analiseId}/raster`, {
    method: "POST",
    body: {}
  });
}

/** Mensagens de erro do POST de raster: usa `error.message` e orienta pelo `details.motivo`. */
export function mensagemDoErroDeRaster(e: unknown): string {
  if (!(e instanceof ApiError)) return e instanceof Error ? e.message : "Não foi possível gerar a imagem.";
  const motivo = (e.details as { motivo?: unknown; tentar_apos_segundos?: unknown } | undefined)?.motivo;
  const tentar = (e.details as { tentar_apos_segundos?: unknown } | undefined)?.tentar_apos_segundos;
  if (e.status === 422 && motivo === "sem_observacao") {
    return `${e.message} Peça uma análise nova desta área.`;
  }
  if (e.status === 422 && motivo === "geometria_alterada") {
    return `${e.message} O contorno mudou: peça uma análise nova.`;
  }
  if (e.status === 429 && motivo === "limite_provedor") {
    const s = typeof tentar === "number" && Number.isFinite(tentar) ? Math.max(1, Math.ceil(tentar)) : null;
    return s ? `${e.message} Tente de novo em cerca de ${s} s.` : e.message;
  }
  if (e.status === 429 && motivo === "limite_erp") {
    return `${e.message} Tente de novo em instantes.`;
  }
  if (e.status === 503 && (motivo === "desligada" || motivo === "configuracao")) {
    return "A consulta por satélite está indisponível no momento.";
  }
  return e.message;
}

export interface OpcoesRastersIndice {
  /** Áreas à vista (já limitadas pelo teto). */
  areaIds: readonly string[];
  indice: IdIndice;
  data?: DataDaCamada;
  ativo: boolean;
}

/**
 * Cache em memória dos rasters das áreas à vista para o ÍNDICE e a DATA ativos. Trocar de modo NÃO dispara rede.
 * Trocar de índice ou de data solta o cache (canvas, bytes e ObjectURLs). Sair da vista libera a área.
 */
export function useRastersIndice({ areaIds, indice, data = DATA_ULTIMA_IMAGEM, ativo }: OpcoesRastersIndice) {
  const { can, session } = useAuth();
  const pode = can(PERMISSAO_VER_RASTER);
  const [porArea, setPorArea] = React.useState<ReadonlyMap<string, EntradaRasterEmMemoria>>(new Map());
  const [situacao, setSituacao] = React.useState<"ocioso" | "carregando" | "pronto" | "erro">("ocioso");
  const [erro, setErro] = React.useState<string | null>(null);
  const cacheRef = React.useRef(new Map<string, EntradaRasterEmMemoria>());
  /** Áreas já listadas SEM imagem neste índice/data — não repetem a listagem a cada movimento do mapa. */
  const semImagemRef = React.useRef(new Set<string>());
  const chaveDoCacheRef = React.useRef(`${indice}|${data}`);
  const idsKey = areaIds.slice().sort().join(",");

  const liberarFora = React.useCallback((manter: ReadonlySet<string>) => {
    for (const [id, ent] of cacheRef.current) {
      if (!manter.has(id)) {
        liberarEntrada(ent);
        cacheRef.current.delete(id);
      }
    }
  }, []);

  React.useEffect(() => {
    const chave = `${indice}|${data}`;
    if (chaveDoCacheRef.current !== chave) {
      liberarFora(new Set());
      semImagemRef.current.clear();
      chaveDoCacheRef.current = chave;
      setPorArea(new Map());
    }
    if (!ativo || !pode) {
      liberarFora(new Set());
      setPorArea(new Map());
      setSituacao("ocioso");
      return;
    }
    const ids = areaIds.filter(Boolean);
    const manter = new Set(ids);
    liberarFora(manter);
    // Vista ainda sem áreas: NÃO marcar "pronto" — senão o mapa trava o modo padrão antes da primeira listagem real.
    if (ids.length === 0) {
      setPorArea(new Map(cacheRef.current));
      setSituacao("ocioso");
      return;
    }
    const controle = new AbortController();
    const { signal } = controle;
    setSituacao((s) => (s === "pronto" && cacheRef.current.size > 0 ? s : "carregando"));
    (async () => {
      try {
        const faltando = idsFaltando(ids, new Set([...cacheRef.current.keys(), ...semImagemRef.current]));
        if (faltando.length > 0) {
          const dtos = await listarRastersPorAreas(faltando, indice, signal);
          const comImagem = new Set(dtos.map((d) => d.area_id));
          for (const id of faltando) if (!comImagem.has(id)) semImagemRef.current.add(id);
          for (let i = 0; i < dtos.length; i += DOWNLOADS_SIMULTANEOS) {
            const grupo = dtos.slice(i, i + DOWNLOADS_SIMULTANEOS);
            await Promise.all(grupo.map(async (dto) => {
              try {
                const entrada = await montarEntrada(dto, indice, signal);
                if (signal.aborted) { liberarEntrada(entrada); return; }
                cacheRef.current.set(dto.area_id, entrada);
              } catch (e) {
                if (signal.aborted || ehAborto(e)) return;
                cacheRef.current.set(dto.area_id, {
                  dto,
                  bytesCinza: new Uint8ClampedArray(0),
                  largura: 0,
                  altura: 0,
                  canvas: canvasHtml(1, 1),
                  blobUrl: null,
                  erro: e instanceof Error ? e.message : "Falha ao carregar a imagem."
                });
              }
            }));
            if (signal.aborted) return;
          }
        }
        if (signal.aborted) return;
        setPorArea(new Map(cacheRef.current));
        setErro(null);
        setSituacao("pronto");
      } catch (e) {
        if (signal.aborted || ehAborto(e)) return;
        setErro(e instanceof Error ? e.message : "Não foi possível carregar as imagens.");
        setSituacao("erro");
      }
    })();
    return () => { controle.abort(); };
    // session.empresaId troca o escopo; idsKey cobre a lista de áreas à vista.
  }, [ativo, pode, idsKey, areaIds, indice, data, session?.empresaId, liberarFora]);

  React.useEffect(() => () => {
    liberarFora(new Set());
  }, [liberarFora]);

  /** Injeta/atualiza um raster (após "Gerar raster") sem nova listagem completa. */
  const incorporarDto = React.useCallback(async (dto: RasterIndiceDto) => {
    if (dto.indice !== indice) return;
    const entrada = await montarEntrada(dto, indice);
    liberarEntrada(cacheRef.current.get(dto.area_id));
    semImagemRef.current.delete(dto.area_id);
    cacheRef.current.set(dto.area_id, entrada);
    setPorArea(new Map(cacheRef.current));
    setSituacao("pronto");
  }, [indice]);

  const doIndiceAtivo = React.useMemo(
    () => new Map([...porArea].filter(([, e]) => e.dto.indice === indice)) as ReadonlyMap<string, EntradaRasterEmMemoria>,
    [porArea, indice]
  );

  return {
    situacao,
    erro,
    porArea: doIndiceAtivo,
    indice,
    temRaster: (areaId: string) => {
      const e = doIndiceAtivo.get(areaId);
      return Boolean(e && !e.erro && e.blobUrl);
    },
    incorporarDto
  };
}

/** Compatibilidade com a SAT-07: só NDVI, mesma assinatura de antes. */
export function useRastersNdvi(areaIdsAtivos: readonly string[], ativo: boolean) {
  return useRastersIndice({ areaIds: areaIdsAtivos, indice: "ndvi", ativo });
}

/** Miniatura do polígono a partir do canvas já colorido (sem rede). */
export function desenharMiniaturaRaster(
  canvasOrigem: HTMLCanvasElement,
  destino: HTMLCanvasElement,
  maxLado = 160
) {
  const { width: w, height: h } = canvasOrigem;
  if (w <= 0 || h <= 0) return;
  const escala = Math.min(maxLado / w, maxLado / h, 1);
  destino.width = Math.max(1, Math.round(w * escala));
  destino.height = Math.max(1, Math.round(h * escala));
  const ctx = destino.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, destino.width, destino.height);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(canvasOrigem, 0, 0, destino.width, destino.height);
}
