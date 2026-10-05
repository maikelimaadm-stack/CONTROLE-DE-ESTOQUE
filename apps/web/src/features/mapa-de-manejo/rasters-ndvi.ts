/**
 * SAT-07 — cliente e cache do raster NDVI (contrato da SAT-06).
 *
 * Listagem e geração passam por sessão; o arquivo PNG usa só a URL assinada (sem credenciais).
 * A `url_assinada` vale 10 minutos e NÃO fica em cache persistente: em 404 pedimos o DTO de novo uma vez.
 * O bitmap DECODIFICADO (bytes cinza) fica em memória enquanto a área está em tela, para trocar de paleta
 * sem baixar de novo.
 */
"use client";
import * as React from "react";
import { API_URL, api, ApiError, qs } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { bitmapParaBytesCinza, colorirRasterNdvi } from "./colorir-raster-ndvi";
import { montarLutNdvi } from "./paleta-ndvi-pixel";

/** Mesma capacidade de leitura do resumo NDVI — evita import circular com `ndvi.tsx`. */
const PERMISSAO_VER_NDVI = "analises_satelitais.view";

export interface RasterNdviDto {
  id: string;
  analise_id: string;
  area_id: string;
  indice: "ndvi" | string;
  tipo: "valores" | string;
  data_imagem: string;
  largura: number;
  altura: number;
  /** Ordem MapLibre: NO, NE, SE, SO — NUNCA reordenar. */
  cantos_lnglat: [[number, number], [number, number], [number, number], [number, number]];
  escala_min: number;
  escala_max: number;
  resolucao_m: number;
  resolucao_reduzida: boolean;
  url_assinada: string;
  expira_em: string;
}

export interface EntradaRasterEmMemoria {
  dto: RasterNdviDto;
  /** Bytes cinza 1 bpp (canal R), para recolorir sem baixar. */
  bytesCinza: Uint8ClampedArray;
  largura: number;
  altura: number;
  /** Canvas colorido na paleta atual (HTMLCanvasElement para fonte canvas/image). */
  canvas: HTMLCanvasElement;
  blobUrl: string | null;
  erro: string | null;
}

const TETO_AREA_IDS = 200;
const CHAVE_RASTERS = ["mapa-geral", "rasters-ndvi"] as const;

export function urlAbsolutaDoArquivo(urlAssinada: string): string {
  if (urlAssinada.startsWith("http://") || urlAssinada.startsWith("https://")) return urlAssinada;
  return `${API_URL}${urlAssinada}`;
}

/** Lista a imagem mais recente por área (nunca gera). Parte em lotes de até 200 ids. */
export async function listarRastersPorAreas(areaIds: readonly string[], indice = "ndvi"): Promise<RasterNdviDto[]> {
  const unicos = [...new Set(areaIds.filter(Boolean))];
  const out: RasterNdviDto[] = [];
  for (let i = 0; i < unicos.length; i += TETO_AREA_IDS) {
    const fatia = unicos.slice(i, i + TETO_AREA_IDS);
    let pagina = 1;
    for (;;) {
      const r = await api<{ itens: RasterNdviDto[]; pagina: number; tamanho: number; tem_mais: boolean }>(
        `/api/mapa/rasters${qs({ area_ids: fatia.join(","), indice, pagina, tamanho: TETO_AREA_IDS })}`
      );
      out.push(...r.itens);
      if (!r.tem_mais) break;
      pagina += 1;
    }
  }
  return out;
}

/** Baixa o PNG pela URL assinada (CORS, sem credenciais). Em 404 devolve null para o chamador renovar o DTO. */
export async function baixarArquivoRaster(urlAssinada: string): Promise<Blob | null> {
  const res = await fetch(urlAbsolutaDoArquivo(urlAssinada), { mode: "cors", credentials: "omit" });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Não foi possível baixar a imagem do satélite (${res.status}).`);
  return res.blob();
}

async function blobParaBitmap(blob: Blob): Promise<ImageBitmap> {
  return createImageBitmap(blob, { colorSpaceConversion: "none", premultiplyAlpha: "none" });
}

function canvasHtml(largura: number, altura: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = largura;
  c.height = altura;
  return c;
}

/** Colorize os bytes cinza guardados numa nova LUT (troca de paleta sem rede). */
export async function recolorirEntrada(entrada: EntradaRasterEmMemoria, lut: Uint8ClampedArray): Promise<EntradaRasterEmMemoria> {
  const colorido = colorirRasterNdvi(entrada.bytesCinza, entrada.largura, entrada.altura, lut);
  const canvas = canvasHtml(entrada.largura, entrada.altura);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D indisponível para pintar o NDVI.");
  ctx.putImageData(colorido, 0, 0);
  if (entrada.blobUrl) URL.revokeObjectURL(entrada.blobUrl);
  const blobUrl = await canvasParaBlobUrl(canvas);
  return { ...entrada, canvas, blobUrl, erro: null };
}

async function canvasParaBlobUrl(canvas: HTMLCanvasElement): Promise<string> {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("Não foi possível serializar a imagem colorida.");
  return URL.createObjectURL(blob);
}

async function montarEntrada(dto: RasterNdviDto, lut: Uint8ClampedArray): Promise<EntradaRasterEmMemoria> {
  let blob = await baixarArquivoRaster(dto.url_assinada);
  let dtoAtual = dto;
  if (!blob) {
    // URL vencida: pede o DTO de novo UMA vez e tenta de novo.
    const renovados = await listarRastersPorAreas([dto.area_id], dto.indice);
    const novo = renovados.find((r) => r.area_id === dto.area_id) ?? null;
    if (!novo) throw new Error("Imagem não encontrada.");
    dtoAtual = novo;
    blob = await baixarArquivoRaster(novo.url_assinada);
    if (!blob) throw new Error("O link da imagem expirou de novo. Tente mais tarde.");
  }
  const bitmap = await blobParaBitmap(blob);
  try {
    const { bytes, largura, altura } = await bitmapParaBytesCinza(bitmap);
    const colorido = colorirRasterNdvi(bytes, largura, altura, lut);
    const canvas = canvasHtml(largura, altura);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D indisponível para pintar o NDVI.");
    ctx.putImageData(colorido, 0, 0);
    return {
      dto: dtoAtual,
      bytesCinza: bytes,
      largura,
      altura,
      canvas,
      blobUrl: await canvasParaBlobUrl(canvas),
      erro: null
    };
  } finally {
    bitmap.close();
  }
}

export function liberarEntrada(entrada: EntradaRasterEmMemoria | undefined) {
  if (!entrada) return;
  if (entrada.blobUrl) URL.revokeObjectURL(entrada.blobUrl);
}

/** Gera (ou reaproveita) a imagem da análise — só em clique deliberado. */
export async function gerarRasterDaAnalise(analiseId: string): Promise<{ raster: RasterNdviDto; reutilizada: boolean }> {
  return api<{ raster: RasterNdviDto; reutilizada: boolean }>(`/api/mapa/analises-satelitais/${analiseId}/raster`, {
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

/**
 * Cache em memória dos rasters das áreas pedidas. Trocar de modo/paleta NÃO dispara rede.
 * Sair da lista (área fora do conjunto ativo) libera canvas/bytes.
 */
export function useRastersNdvi(areaIdsAtivos: readonly string[], ativo: boolean) {
  const { can, session } = useAuth();
  const pode = can(PERMISSAO_VER_NDVI);
  const [porArea, setPorArea] = React.useState<ReadonlyMap<string, EntradaRasterEmMemoria>>(new Map());
  const [situacao, setSituacao] = React.useState<"ocioso" | "carregando" | "pronto" | "erro">("ocioso");
  const [erro, setErro] = React.useState<string | null>(null);
  const cacheRef = React.useRef(new Map<string, EntradaRasterEmMemoria>());
  const lutRef = React.useRef<Uint8ClampedArray | null>(null);
  const idsKey = areaIdsAtivos.slice().sort().join(",");

  const liberarFora = React.useCallback((manter: ReadonlySet<string>) => {
    for (const [id, ent] of cacheRef.current) {
      if (!manter.has(id)) {
        liberarEntrada(ent);
        cacheRef.current.delete(id);
      }
    }
  }, []);

  React.useEffect(() => {
    if (!ativo || !pode) {
      liberarFora(new Set());
      setPorArea(new Map());
      setSituacao("ocioso");
      return;
    }
    const ids = areaIdsAtivos.filter(Boolean);
    const manter = new Set(ids);
    liberarFora(manter);
    if (ids.length === 0) {
      setPorArea(new Map(cacheRef.current));
      setSituacao("pronto");
      return;
    }
    let cancelado = false;
    setSituacao((s) => (s === "pronto" && cacheRef.current.size > 0 ? s : "carregando"));
    (async () => {
      try {
        const faltando = ids.filter((id) => !cacheRef.current.has(id));
        if (faltando.length > 0) {
          const dtos = await listarRastersPorAreas(faltando);
          for (const dto of dtos) {
            if (cancelado) return;
            if (!lutRef.current || lutRef.current.length < 1024) {
              lutRef.current = montarLutNdvi(dto.escala_min, dto.escala_max);
            }
            // Cada DTO pode ter escala própria — a LUT de COR usa a escala de CODIFICAÇÃO do DTO.
            const lut = montarLutNdvi(dto.escala_min, dto.escala_max);
            try {
              const entrada = await montarEntrada(dto, lut);
              if (cancelado) {
                liberarEntrada(entrada);
                return;
              }
              cacheRef.current.set(dto.area_id, entrada);
            } catch (e) {
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
          }
        }
        if (cancelado) return;
        setPorArea(new Map(cacheRef.current));
        setErro(null);
        setSituacao("pronto");
      } catch (e) {
        if (cancelado) return;
        setErro(e instanceof Error ? e.message : "Não foi possível carregar as imagens.");
        setSituacao("erro");
      }
    })();
    return () => { cancelado = true; };
    // session.empresaId troca o escopo; idsKey cobre a lista de áreas.
  }, [ativo, pode, idsKey, session?.empresaId, areaIdsAtivos, liberarFora]);

  React.useEffect(() => () => {
    liberarFora(new Set());
  }, [liberarFora]);

  /** Injeta/atualiza um raster (após "Gerar imagem") sem nova listagem completa. */
  const incorporarDto = React.useCallback(async (dto: RasterNdviDto) => {
    const lut = montarLutNdvi(dto.escala_min, dto.escala_max);
    const entrada = await montarEntrada(dto, lut);
    const antiga = cacheRef.current.get(dto.area_id);
    liberarEntrada(antiga);
    cacheRef.current.set(dto.area_id, entrada);
    setPorArea(new Map(cacheRef.current));
    setSituacao("pronto");
  }, []);

  return {
    situacao,
    erro,
    porArea,
    temRaster: (areaId: string) => {
      const e = porArea.get(areaId);
      return Boolean(e && !e.erro && e.blobUrl);
    },
    incorporarDto,
    chaveQuery: CHAVE_RASTERS
  };
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
