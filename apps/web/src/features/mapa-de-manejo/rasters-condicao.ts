"use client";
import * as React from "react";
import {
  CLASSES_CONDICAO_PASTO,
  CHAVE_MAPA_CONDICAO_PASTO,
  agregarResumosCondicao,
  montarLutCondicaoPasto,
  type CodigoClasseCondicaoPasto,
  type ResumoCondicaoPasto
} from "@agro/domain";
import { API_URL, api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { CacheRasters } from "./cache-rasters";
import { bitmapParaBytesCinza, colorirRasterNdvi } from "./colorir-raster-ndvi";
import { DATA_ULTIMA_IMAGEM, chaveDaData, dataImagemDoPedido, type DataDaCamada } from "./data-camada";
import { idsFaltando, AREAS_POR_LISTAGEM } from "./viewport-rasters";
import type { EntradaRasterEmMemoria } from "./rasters-indice";
import { baixarArquivoRaster, liberarEntrada } from "./rasters-indice";

const PERMISSAO_VER = "analises_satelitais.view";
const DOWNLOADS_SIMULTANEOS = 4;

const ehAborto = (e: unknown) =>
  (e instanceof DOMException && e.name === "AbortError") || (e instanceof Error && e.name === "AbortError");

/** 404 da listagem: a rota não existe neste binário (API anterior à SAT-COND-01). Lista vazia é 200. */
export function ehRotaAusenteDaCondicao(e: unknown): boolean {
  return e instanceof ApiError && e.status === 404;
}

export interface MapaCondicaoDto {
  id: string;
  area_id: string;
  mapa: string;
  tipo: string;
  data_imagem: string;
  largura: number;
  altura: number;
  cantos_lnglat: [[number, number], [number, number], [number, number], [number, number]];
  resolucao_m: number;
  resolucao_analitica_m?: number;
  geometria_sha256: string;
  area_total_ha: string;
  resumo: ResumoCondicaoPasto;
  url_assinada: string;
  expira_em: string;
  versao_classificador: string;
}

type Entrada = EntradaRasterEmMemoria & { dto: EntradaRasterEmMemoria["dto"] & { resumo?: ResumoCondicaoPasto; mapaId?: string } };

function canvasHtml(largura: number, altura: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = largura;
  c.height = altura;
  return c;
}

async function canvasParaBlobUrl(canvas: HTMLCanvasElement): Promise<string> {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("Não foi possível serializar o mapa de condição.");
  return URL.createObjectURL(blob);
}

function dtoComoRaster(d: MapaCondicaoDto): Entrada["dto"] {
  return {
    id: d.id,
    analise_id: d.id,
    area_id: d.area_id,
    indice: CHAVE_MAPA_CONDICAO_PASTO,
    tipo: d.tipo,
    data_imagem: d.data_imagem,
    largura: d.largura,
    altura: d.altura,
    cantos_lnglat: d.cantos_lnglat,
    escala_min: 0,
    escala_max: 6,
    resolucao_m: d.resolucao_m,
    resolucao_reduzida: d.resolucao_m > 20,
    geometria_sha256: d.geometria_sha256,
    url_assinada: d.url_assinada,
    expira_em: d.expira_em
  };
}

export async function listarMapasCondicao(
  areaIds: readonly string[],
  opcoes: { signal?: AbortSignal; dataImagem?: string } = {}
): Promise<MapaCondicaoDto[]> {
  const unicos = [...new Set(areaIds.filter(Boolean))];
  const saida: MapaCondicaoDto[] = [];
  for (let i = 0; i < unicos.length; i += AREAS_POR_LISTAGEM) {
    const fatia = unicos.slice(i, i + AREAS_POR_LISTAGEM);
    let pagina = 1;
    for (;;) {
      if (opcoes.signal?.aborted) throw new DOMException("Pedido de mapa abortado", "AbortError");
      const qs = new URLSearchParams({
        area_ids: fatia.join(","),
        pagina: String(pagina),
        tamanho: String(AREAS_POR_LISTAGEM)
      });
      if (opcoes.dataImagem) qs.set("data_imagem", opcoes.dataImagem);
      const r = await api<{ itens: MapaCondicaoDto[]; tem_mais: boolean }>(`/api/mapa/condicao-pasto?${qs}`, { signal: opcoes.signal });
      saida.push(...r.itens);
      if (!r.tem_mais) break;
      pagina += 1;
    }
  }
  return saida;
}

/**
 * API de geração do mapa categórico (POST). Mantida para o contrato do servidor;
 * a UX MAPA-UX-02 não expõe CTA local — a geração fica no fluxo "Analisar pastos" em lote.
 */
export async function gerarMapaCondicao(areaId: string, dataImagem?: string): Promise<{ mapa: MapaCondicaoDto; reutilizada: boolean }> {
  const qs = dataImagem ? `?data_imagem=${encodeURIComponent(dataImagem)}` : "";
  return api<{ mapa: MapaCondicaoDto; reutilizada: boolean }>(`/api/satelite/areas/${areaId}/condicao-pasto${qs}`, {
    method: "POST",
    body: {}
  });
}

/**
 * Baixa o PNG categórico e aplica a LUT de cores.
 * Recorte fora do polígono: o backend já grava alpha/byte 255 fora da geometria
 * (máscara geométrica); aqui só colorimos classes 0..6 — não há overlay GeoJSON
 * de zonas no MapLibre nesta fatia (ver zonas-condicao.ts para o helper puro).
 */
async function carregarEntrada(dto: MapaCondicaoDto, lut: Uint8ClampedArray, signal?: AbortSignal): Promise<Entrada> {
  const blob = await baixarArquivoRaster(dto.url_assinada, signal);
  if (!blob) throw new Error("Imagem do mapa de condição não encontrada.");
  const bitmap = await createImageBitmap(blob);
  try {
    const { bytes, largura, altura } = await bitmapParaBytesCinza(bitmap);
    const colorido = colorirRasterNdvi(bytes, largura, altura, lut);
    const canvas = canvasHtml(largura, altura);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D indisponível.");
    ctx.putImageData(colorido, 0, 0);
    const rasterDto = dtoComoRaster(dto);
    return {
      dto: { ...rasterDto, resumo: dto.resumo, mapaId: dto.id } as Entrada["dto"],
      bytesCinza: bytes, largura, altura, canvas,
      blobUrl: await canvasParaBlobUrl(canvas), erro: null
    };
  } finally {
    bitmap.close();
  }
}

export function useMapasCondicao(p: {
  areaIds: readonly string[];
  data?: DataDaCamada;
  assinaturas?: ReadonlyMap<string, string>;
  ativo: boolean;
  classeDestaque: CodigoClasseCondicaoPasto | null;
}) {
  const { can } = useAuth();
  const pode = can(PERMISSAO_VER);
  const [porArea, setPorArea] = React.useState<ReadonlyMap<string, Entrada>>(new Map());
  const [resumos, setResumos] = React.useState<ReadonlyMap<string, ResumoCondicaoPasto>>(new Map());
  const [datasPorArea, setDatasPorArea] = React.useState<ReadonlyMap<string, string>>(new Map());
  const [ausentes, setAusentes] = React.useState<ReadonlySet<string>>(new Set());
  const [situacao, setSituacao] = React.useState<"ocioso" | "carregando" | "pronto" | "erro">("ocioso");
  const [versao, setVersao] = React.useState(0);
  const cacheRef = React.useRef<CacheRasters<Entrada> | null>(null);
  if (cacheRef.current === null) cacheRef.current = new CacheRasters<Entrada>(liberarEntrada);
  const cache = cacheRef.current;
  const semRef = React.useRef(new Set<string>());
  const resumosRef = React.useRef(new Map<string, ResumoCondicaoPasto>());
  const datasRef = React.useRef(new Map<string, string>());
  /** API anterior à SAT-COND-01: a rota não existe. Não insistir (e não abortar em loop). */
  const rotaAusenteRef = React.useRef(false);
  const chaveData = chaveDaData(p.data ?? DATA_ULTIMA_IMAGEM);
  const diaPedido = dataImagemDoPedido(p.data ?? DATA_ULTIMA_IMAGEM);
  /** Chave estável: `areaIds.filter()` a cada render abortava o GET e o vigia de skew via `net::ERR_ABORTED`. */
  const idsKey = p.areaIds.slice().sort().join(",");
  const classe = p.classeDestaque;
  const assinaturas = p.assinaturas;

  React.useEffect(() => {
    const mudou = cache.trocarContexto(`condicao_pasto|${chaveData}`);
    if (mudou) {
      semRef.current.clear();
      resumosRef.current = new Map();
      datasRef.current = new Map();
      setPorArea(new Map());
      setResumos(new Map());
      setDatasPorArea(new Map());
      setAusentes(new Set());
    }
    if (assinaturas) cache.sincronizarGeometrias(assinaturas);
    if (!p.ativo || !pode) {
      cache.limpar();
      semRef.current.clear();
      setPorArea(new Map());
      setAusentes(new Set());
      setSituacao("ocioso");
      return;
    }
    if (rotaAusenteRef.current) {
      setSituacao("pronto");
      return;
    }
    const ids = idsKey.split(",").filter(Boolean);
    cache.manter(new Set(ids));
    if (ids.length === 0) {
      setPorArea(cache.snapshot());
      setSituacao("ocioso");
      return;
    }
    const controle = new AbortController();
    setSituacao((s) => (s === "pronto" && cache.tamanho > 0 ? s : "carregando"));
    const lut = montarLutCondicaoPasto({ classeDestaque: classe });
    (async () => {
      try {
        const faltando = idsFaltando(ids, new Set([...cache.keys(), ...semRef.current]));
        if (faltando.length > 0) {
          const listados = await listarMapasCondicao(faltando, { signal: controle.signal, dataImagem: diaPedido });
          const dtos = diaPedido ? listados.filter((d) => d.data_imagem === diaPedido) : listados;
          const com = new Set(dtos.map((d) => d.area_id));
          for (const id of faltando) if (!com.has(id)) semRef.current.add(id);
          for (const d of dtos) {
            resumosRef.current.set(d.area_id, d.resumo);
            datasRef.current.set(d.area_id, d.data_imagem);
          }
          setResumos(new Map(resumosRef.current));
          setDatasPorArea(new Map(datasRef.current));
          setAusentes(new Set(semRef.current));
          for (let i = 0; i < dtos.length; i += DOWNLOADS_SIMULTANEOS) {
            const grupo = dtos.slice(i, i + DOWNLOADS_SIMULTANEOS);
            await Promise.all(grupo.map(async (dto) => {
              try {
                const entrada = await carregarEntrada(dto, lut, controle.signal);
                if (controle.signal.aborted) { liberarEntrada(entrada); return; }
                cache.guardar(dto.area_id, entrada);
              } catch (e) {
                if (controle.signal.aborted || ehAborto(e)) return;
                cache.guardar(dto.area_id, {
                  dto: dtoComoRaster(dto),
                  bytesCinza: new Uint8ClampedArray(0), largura: 0, altura: 0,
                  canvas: canvasHtml(1, 1), blobUrl: null,
                  erro: e instanceof Error ? e.message : "Falha ao carregar o mapa."
                });
              }
            }));
          }
        }
        for (const id of cache.keys()) {
          const ent = cache.get(id);
          if (!ent?.bytesCinza.length) continue;
          const colorido = colorirRasterNdvi(ent.bytesCinza, ent.largura, ent.altura, lut);
          const ctx = ent.canvas.getContext("2d");
          if (ctx) ctx.putImageData(colorido, 0, 0);
          if (ent.blobUrl) URL.revokeObjectURL(ent.blobUrl);
          ent.blobUrl = await canvasParaBlobUrl(ent.canvas);
          cache.guardar(id, ent);
        }
        if (controle.signal.aborted) return;
        setPorArea(cache.snapshot());
        setSituacao("pronto");
      } catch (e) {
        if (controle.signal.aborted || ehAborto(e)) return;
        if (ehRotaAusenteDaCondicao(e)) {
          rotaAusenteRef.current = true;
          setPorArea(new Map());
          setResumos(new Map());
          setDatasPorArea(new Map());
          setAusentes(new Set());
          setSituacao("pronto");
          return;
        }
        setSituacao("erro");
      }
    })();
    return () => controle.abort();
    // idsKey (não `ids`): array novo a cada render abortava o GET e o vigia via `net::ERR_ABORTED`.
  }, [idsKey, chaveData, p.ativo, pode, classe, diaPedido, cache, assinaturas, versao]);

  const recarregar = React.useCallback(() => {
    rotaAusenteRef.current = false;
    semRef.current.clear();
    setVersao((v) => v + 1);
  }, []);

  const incorporarDto = React.useCallback(async (dto: MapaCondicaoDto): Promise<boolean> => {
    if (diaPedido && dto.data_imagem !== diaPedido) return false;
    const lut = montarLutCondicaoPasto({ classeDestaque: classe });
    const entrada = await carregarEntrada(dto, lut);
    semRef.current.delete(dto.area_id);
    resumosRef.current.set(dto.area_id, dto.resumo);
    datasRef.current.set(dto.area_id, dto.data_imagem);
    cache.guardar(dto.area_id, entrada);
    setResumos(new Map(resumosRef.current));
    setDatasPorArea(new Map(datasRef.current));
    setAusentes(new Set(semRef.current));
    setPorArea(cache.snapshot());
    setSituacao("pronto");
    return true;
  }, [diaPedido, classe, cache]);

  const datasDistintas = React.useMemo(() => [...new Set(datasPorArea.values())].sort(), [datasPorArea]);
  const agregado = React.useMemo(() => {
    const lista = [...resumos.values()];
    if (lista.length === 0 || datasDistintas.length > 1) return null;
    return agregarResumosCondicao(lista);
  }, [resumos, datasDistintas]);

  return {
    porArea, resumos, datasPorArea, datasDistintas, ausentes, situacao, agregado,
    temRaster: (id: string) => Boolean(cache.get(id)?.blobUrl),
    incorporarDto,
    recarregar
  };
}

export function urlAbsoluta(url: string) {
  if (url.startsWith("http://") || url.startsWith("https://")) return url;
  return `${API_URL}${url}`;
}

export { CLASSES_CONDICAO_PASTO };
