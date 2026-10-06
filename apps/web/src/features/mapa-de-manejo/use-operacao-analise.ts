"use client";
/**
 * Hook de recuperação da análise viva + capacidade da fila (MAPA-UX-FINAL Part B).
 * No load do mapa: lista recentes, acha a primeira viva, faz poll enquanto viva.
 */
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { api, qs } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { ConsultaDto } from "./consulta-satelite";
import { consultaTerminou } from "./consulta-satelite";
import {
  consultaViva,
  deveAvisarFilaIndisponivel,
  feitosDaConsulta,
  primeiraConsultaViva,
  progressoDaConsulta,
  rotuloBarraAnalise
} from "./operacao-analise";

const PERMISSAO_VER = "analises_satelitais.view";
const INTERVALO_POLL_MS = 3000;
const CHAVE = ["mapa-geral", "operacao-analise"] as const;

export interface CapacidadeSateliteDto {
  fila_disponivel: boolean;
  copernicus_disponivel: boolean;
}

export interface HistoricoConsultasDto {
  itens: ConsultaDto[];
  pagina: number;
  tamanho: number;
  tem_mais: boolean;
}

export interface RespostaConsultaDetalhe {
  consulta: ConsultaDto;
  itens: unknown[];
  pagina: number;
  tamanho: number;
  tem_mais: boolean;
}

export function useCapacidadeSatelite(ativo = true) {
  const { can } = useAuth();
  return useQuery({
    queryKey: [...CHAVE, "capacidade"],
    enabled: ativo && can(PERMISSAO_VER),
    staleTime: 30_000,
    retry: false,
    queryFn: ({ signal }) => api<CapacidadeSateliteDto>("/api/satelite/capacidade", { signal })
  });
}

/**
 * Recupera a consulta viva do escopo (lista página 1, tamanho 5) e acompanha o detalhe enquanto viva.
 * Distinto de "Atualizando mapa…" (leitura de rasters já existentes).
 */
export function useOperacaoAnaliseViva(ativo = true) {
  const { can } = useAuth();
  const pode = ativo && can(PERMISSAO_VER);
  const capacidade = useCapacidadeSatelite(pode);

  const lista = useQuery({
    queryKey: [...CHAVE, "lista"],
    enabled: pode,
    retry: false,
    refetchInterval: (q) => {
      const data = q.state.data as HistoricoConsultasDto | undefined;
      const viva = primeiraConsultaViva(data?.itens ?? []);
      return viva ? INTERVALO_POLL_MS : false;
    },
    queryFn: ({ signal }) =>
      api<HistoricoConsultasDto>(`/api/satelite/consultas${qs({ pagina: 1, tamanho: 5 })}`, { signal })
  });

  const vivaResumo = React.useMemo(
    () => primeiraConsultaViva((lista.data as HistoricoConsultasDto | undefined)?.itens ?? []),
    [lista.data]
  );
  const consultaId = vivaResumo?.id ?? null;

  const detalhe = useQuery({
    queryKey: [...CHAVE, "detalhe", consultaId],
    enabled: pode && consultaId !== null,
    retry: false,
    refetchInterval: (q) => {
      const data = q.state.data as RespostaConsultaDetalhe | undefined;
      const s = data?.consulta.situacao;
      return s && !consultaTerminou(s) && consultaViva(s) ? INTERVALO_POLL_MS : false;
    },
    queryFn: ({ signal }) =>
      api<RespostaConsultaDetalhe>(`/api/satelite/consultas/${consultaId}${qs({ pagina: 1, tamanho: 1 })}`, { signal })
  });

  const consulta = (detalhe.data as RespostaConsultaDetalhe | undefined)?.consulta ?? vivaResumo;
  const viva = consulta ? consultaViva(consulta.situacao) : false;
  const feitos = consulta ? feitosDaConsulta(consulta) : 0;
  const progresso = consulta ? progressoDaConsulta(consulta) : 0;

  const [agoraMs, setAgoraMs] = React.useState(() => Date.now());
  React.useEffect(() => {
    if (!viva || capacidade.data?.fila_disponivel !== false) return;
    const t = window.setInterval(() => setAgoraMs(Date.now()), 2000);
    return () => window.clearInterval(t);
  }, [viva, capacidade.data?.fila_disponivel]);

  const filaIndisponivel = deveAvisarFilaIndisponivel({
    filaDisponivel: capacidade.data?.fila_disponivel,
    situacao: consulta?.situacao,
    feitos,
    criadoEmMs: consulta?.criado_em ? Date.parse(consulta.criado_em) : null,
    agoraMs
  });

  return {
    consulta: viva ? consulta : null,
    consultaId: viva ? consultaId : null,
    viva,
    feitos,
    progresso,
    rotulo: consulta && viva ? rotuloBarraAnalise(consulta) : null,
    capacidade: capacidade.data ?? null,
    filaIndisponivel,
    msgFilaIndisponivel: filaIndisponivel ? "Processamento em fila indisponível neste ambiente." : null,
    recarregar: () => { void lista.refetch(); void capacidade.refetch(); }
  };
}
