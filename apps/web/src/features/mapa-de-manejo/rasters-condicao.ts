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

export async function gerarMapaCondicao(areaId: string, dataImagem?: string): Promise<{ mapa: MapaCondicaoDto; reutilizada: boolean }> {
  const qs = dataImagem ? `?data_imagem=${encodeURIComponent(dataImagem)}` : "";
  return api<{ mapa: MapaCondicaoDto; reutilizada: boolean }>(`/api/satelite/areas/${areaId}/condicao-pasto${qs}`, {
    method: "POST",
    body: {}
  });
}

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

function liberarOrfas(orfas: Entrada[]) {
  for (const e of orfas) liberarEntrada(e);
}

export function useMapasCondicao(p: {
  areaIds: readonly string[];
  areaIdsResumo?: readonly string[];
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
  const [atualizando, setAtualizando] = React.useState(false);
  const [erroAtualizacao, setErroAtualizacao] = React.useState<string | null>(null);
  const [versao, setVersao] = React.useState(0);
  const cacheRef = React.useRef<CacheRasters<Entrada> | null>(null);
  if (cacheRef.current === null) cacheRef.current = new CacheRasters<Entrada>(liberarEntrada);
  const cache = cacheRef.current;
  const semRef = React.useRef(new Set<string>());
  /** Resumos conhecidos: NUNCA limpos ao sair da vista nem ao desligar a camada (`!ativo`). */
  const resumosRef = React.useRef(new Map<string, ResumoCondicaoPasto>());
  const datasRef = React.useRef(new Map<string, string>());
  const orfasRef = React.useRef<Entrada[]>([]);
  const rotaAusenteRef = React.useRef(false);
  const chaveData = chaveDaData(p.data ?? DATA_ULTIMA_IMAGEM);
  const diaPedido = dataImagemDoPedido(p.data ?? DATA_ULTIMA_IMAGEM);
  const idsKey = p.areaIds.slice().sort().join(",");
  const idsResumoKey = (p.areaIdsResumo ?? p.areaIds).slice().sort().join(",");
  const classe = p.classeDestaque;
  const assinaturas = p.assinaturas;

  React.useEffect(() => {
    const { mudou, orfas } = cache.trocarContextoPreservando(`condicao_pasto|${chaveData}`);
    if (mudou) {
      semRef.current.clear();
      // NÃO limpa resumosRef / datasRef / setPorArea / setResumos — SWR até o commit.
      if (orfas.length > 0) orfasRef.current.push(...orfas);
    }
    if (assinaturas) {
      const soltas = cache.sincronizarGeometrias(assinaturas);
      for (const id of soltas) semRef.current.delete(id);
    }
    // CACHE-01/02: ao desligar a camada (Dados técnicos) NÃO limpa resumos nem cache pesado.
    if (!p.ativo || !pode) {
      setAtualizando(false);
      return;
    }
    if (rotaAusenteRef.current) {
      setSituacao("pronto");
      setAtualizando(false);
      return;
    }
    const idsViewport = idsKey.split(",").filter(Boolean);
    const idsResumo = idsResumoKey.split(",").filter(Boolean);
    // CACHE-03: trim só do cache pesado à vista — resumosRef permanece intacto.
    cache.manter(new Set(idsViewport));
    if (!mudou) setPorArea(cache.snapshot());

    if (idsResumo.length === 0 && idsViewport.length === 0) {
      const temAlgo = resumosRef.current.size > 0 || orfasRef.current.length > 0;
      setSituacao(temAlgo ? "pronto" : "ocioso");
      setAtualizando(false);
      return;
    }

    const controle = new AbortController();
    const temSnapshot = resumosRef.current.size > 0 || orfasRef.current.length > 0 || cache.tamanho > 0;
    setAtualizando(true);
    setErroAtualizacao(null);
    setSituacao((s) => (s === "pronto" || temSnapshot ? "pronto" : "carregando"));
    const lut = montarLutCondicaoPasto({ classeDestaque: classe });
    (async () => {
      try {
        const conhecidosResumo = mudou ? new Set<string>() : new Set(resumosRef.current.keys());
        const faltandoResumo = idsResumo.filter((id) => !conhecidosResumo.has(id) && !semRef.current.has(id));
        const faltandoRaster = idsFaltando(idsViewport, new Set([...cache.keys(), ...semRef.current]));
        const aListar = [...new Set([...faltandoResumo, ...faltandoRaster])];

        if (aListar.length > 0) {
          const listados = await listarMapasCondicao(aListar, { signal: controle.signal, dataImagem: diaPedido });
          const dtos = diaPedido ? listados.filter((d) => d.data_imagem === diaPedido) : listados;
          const com = new Set(dtos.map((d) => d.area_id));
          for (const id of aListar) if (!com.has(id)) semRef.current.add(id);

          if (mudou) {
            const novosResumos = new Map<string, ResumoCondicaoPasto>();
            const novasDatas = new Map<string, string>();
            for (const d of dtos) {
              novosResumos.set(d.area_id, d.resumo);
              novasDatas.set(d.area_id, d.data_imagem);
            }
            resumosRef.current = novosResumos;
            datasRef.current = novasDatas;
          } else {
            for (const d of dtos) {
              resumosRef.current.set(d.area_id, d.resumo);
              datasRef.current.set(d.area_id, d.data_imagem);
            }
          }
          setResumos(new Map(resumosRef.current));
          setDatasPorArea(new Map(datasRef.current));
          setAusentes(new Set(semRef.current));

          const paraBaixar = dtos.filter((d) => idsViewport.includes(d.area_id) && !cache.has(d.area_id));
          for (let i = 0; i < paraBaixar.length; i += DOWNLOADS_SIMULTANEOS) {
            const grupo = paraBaixar.slice(i, i + DOWNLOADS_SIMULTANEOS);
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
        liberarOrfas(orfasRef.current);
        orfasRef.current = [];
        setSituacao("pronto");
        setAtualizando(false);
        setErroAtualizacao(null);
      } catch (e) {
        if (controle.signal.aborted || ehAborto(e)) return;
        if (ehRotaAusenteDaCondicao(e)) {
          rotaAusenteRef.current = true;
          setSituacao("pronto");
          setAtualizando(false);
          return;
        }
        // CACHE-04: erro mantém snapshot anterior.
        setErroAtualizacao(e instanceof Error ? e.message : "Não foi possível atualizar o mapa de condição.");
        setSituacao("erro");
        setAtualizando(false);
      }
    })();
    return () => controle.abort();
  }, [idsKey, idsResumoKey, chaveData, p.ativo, pode, classe, diaPedido, cache, assinaturas, versao]);

  React.useEffect(() => () => {
    liberarOrfas(orfasRef.current);
    orfasRef.current = [];
    cache.limpar();
  }, [cache]);

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
    setAtualizando(false);
    setErroAtualizacao(null);
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
    atualizando,
    erroAtualizacao,
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
