/**
 * CLIENTE DA OBSERVAÇÃO SATELITAL COMPLETA — SAT-BUNDLE-01B [F2].
 *
 * Consome o contrato F1 (#112). Troca de tema = só leitura/cache. ZERO POST.
 */
"use client";
import * as React from "react";
import { api, ApiError, qs } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { ObservacaoSatelitalCompleta } from "@agro/domain";
import { DATA_ULTIMA_IMAGEM, type DataDaCamada } from "./data-camada";
import { statusAreaDoResumo, type StatusAreaMapa } from "./temas-mapa-pasto";

const ehAborto = (e: unknown) =>
  (e instanceof DOMException && e.name === "AbortError") || (e instanceof Error && e.name === "AbortError");

export const PERMISSAO_VER_OBSERVACAO = "analises_satelitais.view";

export interface ResumoObservacaoCompletaDto {
  area_id: string;
  data_imagem: string | null;
  status_bundle: string;
  cobertura_valida_bundle: string | null;
  visual_pronto: boolean;
  condicao_disponivel: boolean;
  rasters_disponiveis: number;
  medias: Partial<Record<string, string | null>>;
  condicao_resumo: unknown | null;
}

const CACHE_RESUMO = new Map<string, { em: number; itens: ResumoObservacaoCompletaDto[] }>();
const CACHE_OBS = new Map<string, { em: number; obs: ObservacaoSatelitalCompleta }>();
const TTL_MS = 60_000;

function chaveData(data: DataDaCamada): string {
  return data.tipo === "ultima" ? "ultima" : data.data;
}

export async function listarResumosObservacoesCompletas(
  areaIds: readonly string[],
  opcoes: { data?: DataDaCamada; signal?: AbortSignal } = {}
): Promise<ResumoObservacaoCompletaDto[]> {
  if (areaIds.length === 0) return [];
  const dia = chaveData(opcoes.data ?? DATA_ULTIMA_IMAGEM);
  const chave = `${[...areaIds].sort().join(",")}|${dia}`;
  const hit = CACHE_RESUMO.get(chave);
  if (hit && Date.now() - hit.em < TTL_MS) return hit.itens;

  const itens: ResumoObservacaoCompletaDto[] = [];
  const TAM = 50;
  for (let i = 0; i < areaIds.length; i += TAM) {
    const lote = areaIds.slice(i, i + TAM);
    const q = qs({
      area_ids: lote.join(","),
      ...(dia !== "ultima" ? { data_imagem: dia } : {}),
      pagina: 1,
      tamanho: lote.length
    });
    try {
      const r = await api<{ itens: ResumoObservacaoCompletaDto[] }>(
        `/api/mapa/observacoes-satelitais-completas/resumo${q}`,
        { signal: opcoes.signal }
      );
      itens.push(...(r.itens ?? []));
    } catch (e) {
      if (ehAborto(e) || opcoes.signal?.aborted) throw e;
      // 404 de rota (API anterior à F1) — falha fechada, sem loop.
      if (e instanceof ApiError && e.status === 404) return [];
      throw e;
    }
  }
  CACHE_RESUMO.set(chave, { em: Date.now(), itens });
  return itens;
}

export async function obterObservacaoSatelitalCompleta(
  areaId: string,
  opcoes: { data?: DataDaCamada; signal?: AbortSignal } = {}
): Promise<ObservacaoSatelitalCompleta | null> {
  const dia = chaveData(opcoes.data ?? DATA_ULTIMA_IMAGEM);
  const chave = `${areaId}|${dia}`;
  const hit = CACHE_OBS.get(chave);
  if (hit && Date.now() - hit.em < TTL_MS) return hit.obs;
  try {
    const q = dia !== "ultima" ? qs({ data_imagem: dia }) : "";
    const obs = await api<ObservacaoSatelitalCompleta>(
      `/api/mapa/areas/${areaId}/observacao-satelital-completa${q}`,
      { signal: opcoes.signal }
    );
    CACHE_OBS.set(chave, { em: Date.now(), obs });
    return obs;
  } catch (e) {
    const status = (e as { status?: number })?.status;
    if (status === 404) return null;
    throw e;
  }
}

/** Invalida cache local (após análise nova). Não dispara POST. */
export function invalidarCacheObservacaoCompleta(): void {
  CACHE_RESUMO.clear();
  CACHE_OBS.clear();
}

export function useResumosObservacoesCompletas(
  areaIds: readonly string[],
  data: DataDaCamada,
  ativo: boolean
) {
  const { can } = useAuth();
  const pode = can(PERMISSAO_VER_OBSERVACAO);
  const [porArea, setPorArea] = React.useState<ReadonlyMap<string, ResumoObservacaoCompletaDto>>(new Map());
  const [situacao, setSituacao] = React.useState<"idle" | "carregando" | "pronto" | "erro">("idle");
  const idsKey = [...areaIds].filter(Boolean).sort().join(",");
  const diaKey = chaveData(data);
  const rotaAusenteRef = React.useRef(false);

  React.useEffect(() => {
    if (!ativo || !pode || !idsKey) {
      setPorArea(new Map());
      setSituacao("idle");
      return;
    }
    if (rotaAusenteRef.current) {
      setSituacao("pronto");
      return;
    }
    const ids = idsKey.split(",");
    // Sem AbortController: o vigia de skew trata net::ERR_ABORTED como falha de rede.
    // idsKey/diaKey estáveis evitam tempestade de refetch.
    let cancelado = false;
    setSituacao("carregando");
    void listarResumosObservacoesCompletas(ids, { data })
      .then((itens) => {
        if (cancelado) return;
        setPorArea(new Map(itens.map((i) => [i.area_id, i])));
        setSituacao("pronto");
      })
      .catch((e) => {
        if (cancelado) return;
        if (e instanceof ApiError && e.status === 404) {
          rotaAusenteRef.current = true;
          setPorArea(new Map());
          setSituacao("pronto");
          return;
        }
        setSituacao("erro");
      });
    return () => { cancelado = true; };
  }, [ativo, pode, idsKey, diaKey, data]);

  const statusPorArea = React.useMemo(() => {
    const m = new Map<string, StatusAreaMapa>();
    for (const [id, r] of porArea) {
      m.set(id, statusAreaDoResumo(r));
    }
    return m;
  }, [porArea]);

  return { porArea, statusPorArea, situacao, pode };
}

export function useObservacaoSatelitalCompleta(
  areaId: string | null,
  data: DataDaCamada,
  ativo: boolean
) {
  const { can } = useAuth();
  const pode = can(PERMISSAO_VER_OBSERVACAO);
  const [obs, setObs] = React.useState<ObservacaoSatelitalCompleta | null>(null);
  const [situacao, setSituacao] = React.useState<"idle" | "carregando" | "pronto" | "erro">("idle");

  React.useEffect(() => {
    if (!ativo || !pode || !areaId) {
      setObs(null);
      setSituacao("idle");
      return;
    }
    const ac = new AbortController();
    setSituacao("carregando");
    void obterObservacaoSatelitalCompleta(areaId, { data, signal: ac.signal })
      .then((o) => {
        if (ac.signal.aborted) return;
        setObs(o);
        setSituacao("pronto");
      })
      .catch(() => {
        if (!ac.signal.aborted) setSituacao("erro");
      });
    return () => ac.abort();
  }, [ativo, pode, areaId, data]);

  return { obs, situacao, pode };
}
