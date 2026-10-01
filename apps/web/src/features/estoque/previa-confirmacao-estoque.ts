"use client";
import { useQuery } from "@tanstack/react-query";
import { api, ApiError } from "@/lib/api";
import { enumLabel } from "@/lib/copy";

/**
 * A PRÉVIA DA CONFIRMAÇÃO DO DOCUMENTO DE ESTOQUE — o que a confirmação faria no saldo AGORA, dito pelo servidor
 * (ESTOQUE-01, decisão 274).
 *
 * Mesmo desenho da prévia da compra (`features/compras/previa-confirmacao-compra.ts`), com o contrato PRÓPRIO do
 * estoque (`GET /api/estoque/<segmento>/:id/previa-confirmacao`, `contractVersion` 1): por item, o saldo de agora,
 * o saldo depois, se falta saldo e — no ajuste — a diferença entre o contado e o saldo. Copiado e adaptado, não
 * parametrizado: o contrato da compra fala de custo rateado e de contas a pagar, que o estoque não tem.
 *
 * A prévia é apresentação; a confirmação é a autoridade (ela relê o saldo SOB a trava, e a resposta pode mudar
 * entre a prévia e o clique). Por isso o Confirmar só fica bloqueado quando a prévia de AGORA diz que falta saldo
 * (`podeConfirmar: false`). Corpo que não é o contrato, ou a porta ausente (API anterior: 404), vira "prévia
 * indisponível" e o Confirmar continua possível — o servidor recusa o que tiver de recusar.
 */
export const CONTRATO_PREVIA_CONFIRMACAO_ESTOQUE = 1 as const;

/** O movimento que a confirmação gravaria para o item; `null` = nenhum (ajuste que contou exatamente o saldo). */
export type MovimentoPrevistoEstoque = "entry" | "writeoff" | "transfer" | "correction_in" | "correction_out" | null;

export interface ItemDaPreviaEstoque {
  item_id: string;
  posicao: number;
  produto_id: string;
  produto_nome: string;
  lote: string | null;
  /** Números como TEXTO (4 casas), como o servidor os devolve: nada vira float. */
  saldo_atual: string;
  saldo_depois: string;
  insuficiente: boolean;
  /** Só no ajuste: contado − saldo de agora. */
  diferenca: string | null;
  movimento: MovimentoPrevistoEstoque;
}

export interface PreviaDaConfirmacaoEstoque {
  contractVersion: typeof CONTRATO_PREVIA_CONFIRMACAO_ESTOQUE;
  documento: { id: string; especie: string; situacao: string; codigo: string };
  podeConfirmar: boolean;
  itens: ItemDaPreviaEstoque[];
}

const ehObjeto = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const ehTexto = (v: unknown): v is string => typeof v === "string";
const ehTextoOuNulo = (v: unknown) => v === null || ehTexto(v);
const MOVIMENTOS: readonly unknown[] = ["entry", "writeoff", "transfer", "correction_in", "correction_out", null];

const ehItem = (v: unknown): v is ItemDaPreviaEstoque => ehObjeto(v) && ehTexto(v.item_id) && typeof v.posicao === "number" && ehTexto(v.produto_id)
  && ehTexto(v.produto_nome) && ehTextoOuNulo(v.lote) && ehTexto(v.saldo_atual) && ehTexto(v.saldo_depois) && typeof v.insuficiente === "boolean"
  && ehTextoOuNulo(v.diferenca) && MOVIMENTOS.includes(v.movimento);

/**
 * O corpo é o contrato? Além da forma, a COERÊNCIA: `podeConfirmar` é exatamente "nenhum item insuficiente". Uma
 * resposta que dissesse "pode confirmar" com item faltando seria a tela liberando o botão sobre uma contradição.
 */
export const ehPreviaDaConfirmacaoEstoque = (v: unknown): v is PreviaDaConfirmacaoEstoque => {
  if (!ehObjeto(v) || v.contractVersion !== CONTRATO_PREVIA_CONFIRMACAO_ESTOQUE || typeof v.podeConfirmar !== "boolean") return false;
  const d = v.documento;
  if (!ehObjeto(d) || !ehTexto(d.id) || !ehTexto(d.especie) || !ehTexto(d.situacao) || !ehTexto(d.codigo)) return false;
  if (!Array.isArray(v.itens) || !v.itens.every(ehItem)) return false;
  return v.podeConfirmar === !v.itens.some((i) => (i as ItemDaPreviaEstoque).insuficiente);
};

/**
 * O rótulo do movimento previsto — o do ledger (`stock_movement_type`). A transferência grava DOIS movimentos (saída na
 * origem, entrada no destino) e a prévia a resume em um: o rótulo diz os dois.
 */
export function rotuloDoMovimentoPrevisto(m: MovimentoPrevistoEstoque): string {
  if (m === null) return "Nenhum (sem diferença)";
  if (m === "transfer") return `${enumLabel("stock_movement_type", "transfer_out")} e ${enumLabel("stock_movement_type", "transfer_in").toLowerCase()}`;
  return enumLabel("stock_movement_type", m);
}

export type EstadoDaPreviaEstoque =
  | { situacao: "carregando" }
  | { situacao: "pronta"; previa: PreviaDaConfirmacaoEstoque }
  | { situacao: "indisponivel" }
  | { situacao: "erro"; mensagem: string };

/** A chave de cache da prévia — a consulta a invalida depois de confirmar, cancelar ou falhar. */
export const chaveDaPreviaEstoque = (segmento: string, id: string) => ["estoque-previa-confirmacao", segmento, id];

/** Só pergunta com o diálogo aberto; `staleTime: 0` — o que vale é o saldo de AGORA. */
export function usePreviaDaConfirmacaoEstoque(segmento: string, id: string, ativo: boolean): EstadoDaPreviaEstoque {
  const q = useQuery<unknown, ApiError>({
    queryKey: chaveDaPreviaEstoque(segmento, id),
    queryFn: () => api<unknown>(`/api/estoque/${segmento}/${id}/previa-confirmacao`),
    enabled: ativo && Boolean(segmento) && Boolean(id),
    retry: false,
    staleTime: 0
  });
  if (!ativo || q.isPending) return { situacao: "carregando" };
  // 404 é a porta ausente (API anterior) — o próprio documento foi lido pela MESMA porta há pouco; 5xx, falha do servidor.
  // O 409 (documento que deixou de estar aberto) e os demais dizem a mensagem do servidor.
  if (q.error) return q.error.status === 404 || q.error.status >= 500 ? { situacao: "indisponivel" } : { situacao: "erro", mensagem: q.error.message };
  return ehPreviaDaConfirmacaoEstoque(q.data) ? { situacao: "pronta", previa: q.data } : { situacao: "indisponivel" };
}
