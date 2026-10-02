"use client";
import { useQuery } from "@tanstack/react-query";
import { api, ApiError } from "@/lib/api";

/**
 * A PRÉVIA DA FINALIZAÇÃO DO PEDIDO DE COMPRA — o que o Finalizar faria agora, dito pelo servidor (OPERACOES-01 F6a/F6b,
 * decisão 283).
 *
 * O molde de `previa-confirmacao-compra.ts`, com o contrato PRÓPRIO do pedido
 * (`GET /api/compras/pedidos/:id/previa-finalizacao`, `contractVersion` 1): `podeFinalizar`, as recusas que o
 * finalizar daria (com as mensagens do servidor) e a situação da aprovação da TOP para o total de AGORA — a MESMA conta
 * do finalizar, com a cobertura do valor (`nao_exigida`, `pendente`, `aprovado`, `reprovado`; `null` quando o pedido
 * não está aberto ou a configuração é ilegível).
 *
 * A prévia é apresentação; o finalizar é a autoridade. Corpo que não é o contrato, rota ausente (404) ou erro do
 * servidor (5xx) viram "prévia indisponível" e o Finalizar continua possível — o servidor recusa de novo o que tiver de
 * recusar. Outro erro (403…) mostra a mensagem dele.
 */
export const CONTRATO_PREVIA_FINALIZACAO_PEDIDO = 1 as const;

export interface RecusaPrevistaDaFinalizacao { code: string; message: string }
/** A situação da aprovação do pedido para o total de agora (a régua da fila e do finalizar). */
export type SituacaoDaAprovacaoNaPrevia = "nao_exigida" | "pendente" | "aprovado" | "reprovado";
export interface PreviaDaFinalizacaoPedido {
  contractVersion: typeof CONTRATO_PREVIA_FINALIZACAO_PEDIDO;
  podeFinalizar: boolean;
  recusas: RecusaPrevistaDaFinalizacao[];
  aprovacao: { situacao: SituacaoDaAprovacaoNaPrevia } | null;
}

const SITUACOES_DA_APROVACAO: readonly string[] = ["nao_exigida", "pendente", "aprovado", "reprovado"];

const ehObjeto = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const ehTexto = (v: unknown): v is string => typeof v === "string";
const ehRecusa = (v: unknown): v is RecusaPrevistaDaFinalizacao => ehObjeto(v) && ehTexto(v.code) && ehTexto(v.message);
const ehAprovacao = (v: unknown): v is PreviaDaFinalizacaoPedido["aprovacao"] =>
  v === null || (ehObjeto(v) && ehTexto(v.situacao) && SITUACOES_DA_APROVACAO.includes(v.situacao));

/**
 * O leitor ESTRITO: a versão do contrato, `podeFinalizar` booleano e COERENTE com as recusas (pode ⇔ nenhuma recusa),
 * cada recusa com código e mensagem, e a aprovação nula ou numa das quatro situações. Qualquer desvio → não é o contrato.
 */
export const ehPreviaDaFinalizacaoPedido = (v: unknown): v is PreviaDaFinalizacaoPedido => {
  if (!ehObjeto(v) || v.contractVersion !== CONTRATO_PREVIA_FINALIZACAO_PEDIDO || typeof v.podeFinalizar !== "boolean") return false;
  if (!Array.isArray(v.recusas) || !v.recusas.every(ehRecusa)) return false;
  if (v.podeFinalizar !== (v.recusas.length === 0)) return false;
  return Object.hasOwn(v, "aprovacao") && ehAprovacao(v.aprovacao);
};

export type EstadoDaPreviaFinalizacao =
  | { situacao: "carregando" }
  | { situacao: "pronta"; previa: PreviaDaFinalizacaoPedido }
  | { situacao: "indisponivel" }
  | { situacao: "erro"; mensagem: string };

/** Só pergunta com o diálogo aberto; `staleTime: 0` — o que vale é o estado de AGORA (a aprovação pode ter mudado). */
export function usePreviaDaFinalizacaoPedido(id: string, ativo: boolean): EstadoDaPreviaFinalizacao {
  const q = useQuery<unknown, ApiError>({
    queryKey: ["compras-previa-finalizacao", id],
    queryFn: () => api<unknown>(`/api/compras/pedidos/${id}/previa-finalizacao`),
    enabled: ativo && Boolean(id),
    retry: false,
    staleTime: 0
  });
  if (!ativo || q.isPending) return { situacao: "carregando" };
  if (q.error) return q.error.status === 404 || q.error.status >= 500 ? { situacao: "indisponivel" } : { situacao: "erro", mensagem: q.error.message };
  return ehPreviaDaFinalizacaoPedido(q.data) ? { situacao: "pronta", previa: q.data } : { situacao: "indisponivel" };
}
