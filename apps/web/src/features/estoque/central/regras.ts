"use client";
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { lerRegrasDaOperacaoDoEstoque, type EstruturaLayout, type RegrasDaOperacaoDoEstoque } from "@agro/domain";
import { api, type ApiError } from "@/lib/api";
import {
  SEM_PADROES, estruturaDaResposta, layoutQueVale, padroesDaResposta, type LayoutQueVale, type PadroesDaResposta
} from "@/features/compras/layout-da-central";

/**
 * AS PERGUNTAS QUE A CENTRAL DE ESTOQUE FAZ À TOP ANTES DE SALVAR (OPERACOES-01 F5b, decisão 282) — só com a capacidade
 * que a API declara no `operation-types` da espécie; sem ela, nenhuma pergunta sai e a Central é a de antes.
 *
 *   · `/api/estoque/<segmento>/regras-da-operacao` (`regrasDaOperacao`): as exigências gerais, a confirmação automática,
 *     a seção Destino e a seção Fluxo — lidas pelo leitor ESTRITO do domínio (`lerRegrasDaOperacaoDoEstoque`). Resposta
 *     fora da forma = FALHOU: a Central trava o Salvar ("As regras da operação não carregaram") e nunca esconde um
 *     destino obrigatório (escolha E11 do plano);
 *   · `/api/estoque/<segmento>/layout-efetivo` (`layoutDocumento`): o contrato de vendas e compras, lido pelas MESMAS
 *     funções puras da Central de Compras (`features/compras/layout-da-central.ts`, só importadas: escolha E15).
 */

export interface RegrasDaTopNoEstoque {
  /** As regras lidas (`null` sem a capacidade, enquanto pergunta, ou se a resposta não é o contrato). */
  regras: RegrasDaOperacaoDoEstoque | null;
  /** A pergunta saiu e a resposta não chegou. */
  pendente: boolean;
  /** A pergunta falhou, ou a resposta não é o contrato. */
  falhou: boolean;
}

export function useRegrasDaOperacaoDoEstoque(segmento: string, topId: string, ativo: boolean): RegrasDaTopNoEstoque {
  const habilitado = ativo && Boolean(topId);
  const q = useQuery<unknown, ApiError>({
    queryKey: ["estoque-regras-da-operacao", segmento, topId],
    queryFn: () => api<unknown>(`/api/estoque/${segmento}/regras-da-operacao?tipo_operacao_id=${encodeURIComponent(topId)}`),
    enabled: habilitado,
    retry: false
  });
  const regras = React.useMemo(() => (habilitado && q.data !== undefined ? lerRegrasDaOperacaoDoEstoque(q.data) : null), [habilitado, q.data]);
  return {
    regras,
    pendente: habilitado && q.isPending,
    falhou: habilitado && (q.isError || (q.isSuccess && regras === null))
  };
}

export interface LayoutDaTopNoEstoque {
  /** A estrutura do layout da TOP, conferida; `null` sem a capacidade ou sem resposta válida. */
  layout: EstruturaLayout | null;
  /** O layout é perguntado (capacidade) e ainda não há estrutura válida. */
  pendente: boolean;
  /** A pergunta falhou, ou a resposta não tem estrutura: "layout não carregado". */
  naoCarregado: boolean;
  /** Qual layout vale (origem, nome, id), para a linha "Layout: …". */
  vale: LayoutQueVale | null;
  /** Os padrões de cadastro (o Local de estoque padrão, por empresa). */
  padroes: PadroesDaResposta;
  /** A resposta crua (o marco da aplicação dos padrões: uma vez por resposta). */
  resposta: unknown;
}

export function useLayoutDoEstoque(segmento: string, topId: string, ativo: boolean): LayoutDaTopNoEstoque {
  const habilitado = ativo && Boolean(topId);
  const q = useQuery<unknown, ApiError>({
    queryKey: ["layout-efetivo", "estoque", segmento, topId],
    queryFn: () => api<unknown>(`/api/estoque/${segmento}/layout-efetivo?tipo_operacao_id=${encodeURIComponent(topId)}`),
    enabled: habilitado,
    retry: false
  });
  const resposta = q.data;
  const layout = React.useMemo(() => (habilitado ? estruturaDaResposta(resposta) : null), [habilitado, resposta]);
  const vale = React.useMemo(() => (layout ? layoutQueVale(resposta) : null), [layout, resposta]);
  const padroes = React.useMemo(() => (layout ? padroesDaResposta(resposta) : SEM_PADROES), [layout, resposta]);
  const pendente = habilitado && !layout;
  return { layout, pendente, naoCarregado: pendente && (q.isError || (q.isSuccess && !layout)), vale, padroes, resposta };
}
