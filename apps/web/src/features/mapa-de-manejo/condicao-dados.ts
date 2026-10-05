"use client";
import { useQueries, useQuery } from "@tanstack/react-query";
import { api, ApiError, qs } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { HistoricoIndice, IdIndice, ResumoCondicao } from "./condicao-modelo";

export const CHAVE_CONDICAO = ["mapa-geral", "condicao"] as const;
/** Observações por índice no histórico do painel (a rota pagina no servidor; aqui só a primeira página). */
export const LIMITE_HISTORICO_CONDICAO = 24;

const PERMISSAO_VER = "analises_satelitais.view";

/**
 * Resumo da condição da área (6 índices da última observação útil do contorno ATUAL). `null` = a API não tem a rota
 * (janela "web antes da API") ou a área saiu do escopo: o painel some em silêncio, nunca vira erro na tela.
 */
export function useResumoCondicao(areaId: string, ativo = true) {
  const { can, session } = useAuth();
  return useQuery({
    queryKey: [...CHAVE_CONDICAO, "resumo", areaId, session?.empresaId ?? null],
    enabled: ativo && can(PERMISSAO_VER),
    retry: false,
    staleTime: 30_000,
    queryFn: async ({ signal }): Promise<ResumoCondicao | null> => {
      try {
        return await api<ResumoCondicao>(`/api/satelite/areas/${areaId}/resumo`, { signal });
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) return null;
        throw e;
      }
    }
  });
}

function historicoQuery(areaId: string, indice: IdIndice, empresaId: string | null, ativo: boolean) {
  return {
    queryKey: [...CHAVE_CONDICAO, "historico", areaId, indice, empresaId],
    enabled: ativo,
    retry: false,
    staleTime: 30_000,
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      api<HistoricoIndice>(`/api/satelite/areas/${areaId}/historico${qs({ indice, limite: LIMITE_HISTORICO_CONDICAO })}`, { signal })
  };
}

export function useHistoricoIndice(areaId: string, indice: IdIndice, ativo: boolean) {
  const { can, session } = useAuth();
  return useQuery(historicoQuery(areaId, indice, session?.empresaId ?? null, ativo && can(PERMISSAO_VER)));
}

/** Um histórico por índice, só quando `ativo` (anomalia e comparação). Cada índice é uma consulta pequena e em cache. */
export function useHistoricosDaArea(areaId: string, indices: readonly IdIndice[], ativo: boolean) {
  const { can, session } = useAuth();
  const habilitado = ativo && can(PERMISSAO_VER);
  const consultas = useQueries({
    queries: indices.map((indice) => historicoQuery(areaId, indice, session?.empresaId ?? null, habilitado))
  });
  const porIndice: Partial<Record<IdIndice, HistoricoIndice>> = {};
  indices.forEach((indice, i) => {
    const d = consultas[i]?.data;
    if (d) porIndice[indice] = d;
  });
  return {
    porIndice,
    carregando: consultas.some((c) => c.isLoading),
    erro: consultas.find((c) => c.error)?.error ?? null
  };
}
