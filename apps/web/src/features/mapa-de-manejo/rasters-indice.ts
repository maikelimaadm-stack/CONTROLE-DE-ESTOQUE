/**
 * Cliente e cache dos rasters por índice (SAT-06/07, generalizado na decisão 301).
 *
 * Listagem e geração passam por sessão; o arquivo PNG usa só a URL assinada (sem credenciais). A `url_assinada` vale 10
 * minutos e NÃO fica em cache persistente: em 404 pedimos o DTO de novo uma vez. O bitmap DECODIFICADO (bytes cinza)
 * fica em memória enquanto a área está à vista, para trocar de modo sem baixar de novo.
 *
 * Carga PREGUIÇOSA: o cache é do índice ATIVO e da data ativa. Trocar de índice ou de data solta tudo (e revoga as
 * ObjectURLs); pedido obsoleto é abortado. A identidade de cada entrada inclui o `geometria_sha256` (`cache-rasters.ts`):
 * contorno novo = hash novo = entrada solta. O que decide quais áreas pedem raster está em `viewport-rasters.ts`.
 */
"use client";
import * as React from "react";
import { ehIndiceDoBundle } from "@agro/domain";
import { API_URL, api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { CacheRasters } from "./cache-rasters";
import { bitmapParaBytesCinza, colorirRasterNdvi } from "./colorir-raster-ndvi";
import { DATA_ULTIMA_IMAGEM, chaveDaData, dataImagemDoPedido, type DataDaCamada } from "./data-camada";
import { escalaDeCodificacao, montarLutIndice, type IdIndice } from "./paletas-indices";
import {
  idsFaltando,
  listarRastersPorAreas as listarPaginado,
  type RasterIndiceDto,
  type RequisitarJson
} from "./viewport-rasters";

export type { RasterIndiceDto } from "./viewport-rasters";
export { DATA_ULTIMA_IMAGEM, type DataDaCamada } from "./data-camada";
/** Compatibilidade com a SAT-07 (só NDVI). */
export type RasterNdviDto = RasterIndiceDto;

/** Mesma capacidade de leitura do resumo — evita import circular com `ndvi.tsx`. */
const PERMISSAO_VER_RASTER = "analises_satelitais.view";

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

/**
 * Lista a imagem por área (nunca gera). Parte em lotes de até 200 ids. Sem `dataImagem`: a da última análise útil;
 * com ela: só aquele dia (sem fallback).
 */
/** 422 de schema estrito da API antiga (chave `contexto` nova) — não confundir com data civil inválida. */
function campoNaoReconhecido(e: ApiError): boolean {
  if (!Array.isArray(e.details)) return false;
  return e.details.some((d) =>
    typeof d === "object" && d !== null && "message" in d && (d as { message: unknown }).message === "Campo não reconhecido"
  );
}

export async function listarRastersPorAreas(
  areaIds: readonly string[],
  indice = "ndvi",
  opcoes: { signal?: AbortSignal; dataImagem?: string } = {}
): Promise<RasterIndiceDto[]> {
  // Condição da Área: pastagem-essencial-v2 + geometria atual (backend resolve o método).
  // API anterior à R2 recusa `contexto` com "Campo não reconhecido" — cai no contrato sem filtro de método (skew).
  try {
    return await listarPaginado(areaIds, indice, requisitarApi, { ...opcoes, contexto: "condicao" });
  } catch (e) {
    if (e instanceof ApiError && e.status === 422 && campoNaoReconhecido(e)) {
      return listarPaginado(areaIds, indice, requisitarApi, opcoes);
    }
    throw e;
  }
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

/** Baixa o PNG do DTO e o deixa colorido na paleta do índice (e com os bytes guardados para recolorir). */
export async function carregarEntradaRaster(dto: RasterIndiceDto, indiceAtivo: IdIndice, signal?: AbortSignal): Promise<EntradaRasterEmMemoria> {
  let blob = await baixarArquivoRaster(dto.url_assinada, signal);
  let dtoAtual = dto;
  if (!blob) {
    // URL vencida: pede o DTO de novo UMA vez (a MESMA data da imagem) e tenta de novo.
    const renovados = await listarRastersPorAreas([dto.area_id], dto.indice, { signal, dataImagem: dto.data_imagem });
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
  /** Assinatura local do contorno por área: contorno novo solta a imagem da área (junto com o hash do DTO). */
  assinaturas?: ReadonlyMap<string, string>;
  ativo: boolean;
}

/**
 * Cache em memória dos rasters das áreas à vista para o ÍNDICE e a DATA ativos. Trocar de modo NÃO dispara rede.
 * Trocar de índice ou de data solta o cache (canvas, bytes e ObjectURLs). Sair da vista libera a área. Contorno novo
 * (hash do DTO diferente, ou desenho diferente na lista de áreas) solta a entrada daquela área.
 * Com data escolhida, área sem imagem NAQUELE dia fica sem imagem: nunca recebe outra data.
 */
export function useRastersIndice({ areaIds, indice, data = DATA_ULTIMA_IMAGEM, assinaturas, ativo }: OpcoesRastersIndice) {
  const { can, session } = useAuth();
  const pode = can(PERMISSAO_VER_RASTER);
  const [porArea, setPorArea] = React.useState<ReadonlyMap<string, EntradaRasterEmMemoria>>(new Map());
  const [ausentes, setAusentes] = React.useState<ReadonlySet<string>>(new Set());
  const [situacao, setSituacao] = React.useState<"ocioso" | "carregando" | "pronto" | "erro">("ocioso");
  const [erro, setErro] = React.useState<string | null>(null);
  const cacheRef = React.useRef<CacheRasters<EntradaRasterEmMemoria> | null>(null);
  if (cacheRef.current === null) cacheRef.current = new CacheRasters<EntradaRasterEmMemoria>(liberarEntrada);
  const cache = cacheRef.current;
  /** Áreas já listadas SEM imagem neste índice/data — não repetem a listagem a cada movimento do mapa. */
  const semImagemRef = React.useRef(new Set<string>());
  const [versao, setVersao] = React.useState(0);
  const chaveData = chaveDaData(data);
  const diaPedido = dataImagemDoPedido(data);
  const idsKey = areaIds.slice().sort().join(",");

  React.useEffect(() => {
    const mudouContexto = cache.trocarContexto(`${indice}|${chaveData}`);
    if (mudouContexto) {
      semImagemRef.current.clear();
      setPorArea(new Map());
      setAusentes(new Set());
    }
    const soltas = assinaturas ? cache.sincronizarGeometrias(assinaturas) : [];
    for (const id of soltas) semImagemRef.current.delete(id);
    if (soltas.length > 0) setPorArea(cache.snapshot());
    if (!ativo || !pode) {
      cache.limpar();
      semImagemRef.current.clear();
      setPorArea(new Map());
      setAusentes(new Set());
      setSituacao("ocioso");
      return;
    }
    const ids = areaIds.filter(Boolean);
    cache.manter(new Set(ids));
    // Vista ainda sem áreas: NÃO marcar "pronto" — senão o mapa trava o modo padrão antes da primeira listagem real.
    if (ids.length === 0) {
      setPorArea(cache.snapshot());
      setSituacao("ocioso");
      return;
    }
    const controle = new AbortController();
    const { signal } = controle;
    setSituacao((s) => (s === "pronto" && cache.tamanho > 0 ? s : "carregando"));
    (async () => {
      try {
        const faltando = idsFaltando(ids, new Set([...cache.keys(), ...semImagemRef.current]));
        if (faltando.length > 0) {
          const listados = await listarRastersPorAreas(faltando, indice, { signal, dataImagem: diaPedido });
          // Defesa: com data escolhida, só entra imagem DAQUELE dia (a API já não faz fallback; a tela também não).
          const dtos = diaPedido ? listados.filter((d) => d.data_imagem === diaPedido) : listados;
          const comImagem = new Set(dtos.map((d) => d.area_id));
          for (const id of faltando) if (!comImagem.has(id)) semImagemRef.current.add(id);
          for (let i = 0; i < dtos.length; i += DOWNLOADS_SIMULTANEOS) {
            const grupo = dtos.slice(i, i + DOWNLOADS_SIMULTANEOS);
            await Promise.all(grupo.map(async (dto) => {
              try {
                const entrada = await carregarEntradaRaster(dto, indice, signal);
                if (signal.aborted) { liberarEntrada(entrada); return; }
                cache.guardar(dto.area_id, entrada);
              } catch (e) {
                if (signal.aborted || ehAborto(e)) return;
                cache.guardar(dto.area_id, {
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
        setPorArea(cache.snapshot());
        setAusentes(new Set(semImagemRef.current));
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
  }, [ativo, pode, idsKey, areaIds, indice, chaveData, diaPedido, assinaturas, versao, session?.empresaId, cache]);

  React.useEffect(() => () => { cache.limpar(); }, [cache]);

  /**
   * Injeta/atualiza um raster (após "Gerar raster") sem nova listagem completa. Só entra o que combina com a camada:
   * índice ativo; com data escolhida, o mesmo dia; na última imagem útil, nunca uma data mais antiga que a já mostrada.
   * Devolve `false` quando a imagem gerada não pertence à camada atual (o chamador escolhe a data dela).
   */
  const incorporarDto = React.useCallback(async (dto: RasterIndiceDto): Promise<boolean> => {
    if (dto.indice !== indice) return false;
    if (diaPedido && dto.data_imagem !== diaPedido) return false;
    const atual = cache.get(dto.area_id);
    if (!diaPedido && atual && !atual.erro && atual.dto.data_imagem > dto.data_imagem) return false;
    const entrada = await carregarEntradaRaster(dto, indice);
    semImagemRef.current.delete(dto.area_id);
    cache.guardar(dto.area_id, entrada);
    setPorArea(cache.snapshot());
    setAusentes(new Set(semImagemRef.current));
    setSituacao("pronto");
    return true;
  }, [indice, diaPedido, cache]);

  /** O servidor informou o hash ATUAL do contorno da área: imagem guardada de outro hash é solta e a área é pedida de novo. */
  const confirmarHashDaArea = React.useCallback((areaId: string, geometriaSha256: string | null | undefined) => {
    if (!cache.invalidarSeHashDiferente(areaId, geometriaSha256)) return;
    semImagemRef.current.delete(areaId);
    setPorArea(cache.snapshot());
    setVersao((v) => v + 1);
  }, [cache]);

  const doIndiceAtivo = React.useMemo(
    () => new Map([...porArea].filter(([, e]) => e.dto.indice === indice)) as ReadonlyMap<string, EntradaRasterEmMemoria>,
    [porArea, indice]
  );

  return {
    situacao,
    erro,
    porArea: doIndiceAtivo,
    indice,
    data,
    /** Áreas listadas SEM imagem neste índice/data (a tela diz isso; nunca troca de data em silêncio). */
    ausentes,
    temRaster: (areaId: string) => {
      const e = doIndiceAtivo.get(areaId);
      return Boolean(e && !e.erro && e.blobUrl);
    },
    incorporarDto,
    confirmarHashDaArea
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
