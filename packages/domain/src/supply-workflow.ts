import { DomainError } from "@agro/shared";

/** Status do fluxo de suprimentos (observados no sistema de referência: tela "Parâmetros SLA"). */
export const PurchaseRequestStatus = {
  request: "request",                        // Solicitação
  quotation_in_progress: "quotation_in_progress", // Cotação em Andamento
  awaiting_approval: "awaiting_approval",    // Aguardando Aprovação
  awaiting_awareness: "awaiting_awareness",  // Aguardando Ciência
  not_approved: "not_approved",              // Pedido Não Aprovado
  awaiting_purchase: "awaiting_purchase",    // Aguardando a Compra
  purchase_done: "purchase_done",            // Compra Efetuada
  purchase_received: "purchase_received",    // Compra Recebida
  finished: "finished",                      // Pedido Finalizado
  cancelled: "cancelled",                    // Pedido Cancelado
  under_review: "under_review"               // Analisar Processo
} as const;
export type PurchaseRequestStatus = (typeof PurchaseRequestStatus)[keyof typeof PurchaseRequestStatus];

export const PURCHASE_STATUS_LABELS: Record<PurchaseRequestStatus, string> = {
  request: "Solicitação", quotation_in_progress: "Cotação em andamento", awaiting_approval: "Aguardando aprovação",
  awaiting_awareness: "Aguardando ciência", not_approved: "Pedido não aprovado", awaiting_purchase: "Aguardando a compra",
  purchase_done: "Compra efetuada", purchase_received: "Compra recebida", finished: "Pedido finalizado",
  cancelled: "Pedido cancelado", under_review: "Analisar processo"
};

export type PurchaseAction = "submit" | "acknowledge" | "start_quotation" | "send_to_approval" | "approve" | "reject" | "review" | "mark_purchased" | "mark_received" | "finish" | "cancel" | "back_step";

/**
 * Transições permitidas. Fluxo principal observado:
 * Solicitação → Aguardando Ciência (encarregado) → Cotação em Andamento → Aguardando Aprovação →
 * Aguardando a Compra → Compra Efetuada → Compra Recebida → Pedido Finalizado.
 * Reprovação → Pedido Não Aprovado; "Analisar Processo" = devolvido para análise; Cancelado é terminal.
 * Fluxo simplificado (fazenda com has_simplified_purchase_flow): pula cotação/aprovação → Aguardando a Compra.
 */
const TRANSITIONS: Record<PurchaseRequestStatus, Partial<Record<PurchaseAction, PurchaseRequestStatus>>> = {
  request: { submit: "awaiting_awareness", start_quotation: "quotation_in_progress", send_to_approval: "awaiting_approval", cancel: "cancelled" },
  awaiting_awareness: { acknowledge: "quotation_in_progress", reject: "not_approved", cancel: "cancelled", back_step: "request", review: "under_review" },
  quotation_in_progress: { send_to_approval: "awaiting_approval", cancel: "cancelled", back_step: "awaiting_awareness", review: "under_review" },
  awaiting_approval: { approve: "awaiting_purchase", reject: "not_approved", review: "under_review", back_step: "quotation_in_progress", cancel: "cancelled" },
  under_review: { back_step: "quotation_in_progress", send_to_approval: "awaiting_approval", reject: "not_approved", cancel: "cancelled" },
  not_approved: { back_step: "quotation_in_progress", cancel: "cancelled" },
  awaiting_purchase: { mark_purchased: "purchase_done", back_step: "awaiting_approval", cancel: "cancelled" },
  purchase_done: { mark_received: "purchase_received", back_step: "awaiting_purchase", cancel: "cancelled" },
  purchase_received: { finish: "finished", back_step: "purchase_done" },
  finished: {},
  cancelled: {}
};

export function nextPurchaseStatus(current: PurchaseRequestStatus, action: PurchaseAction): PurchaseRequestStatus {
  const next = TRANSITIONS[current]?.[action];
  if (!next) throw new DomainError("INVALID_STATUS_TRANSITION", `Ação "${action}" não permitida no status "${PURCHASE_STATUS_LABELS[current]}"`, { current, action });
  return next;
}
export function allowedPurchaseActions(current: PurchaseRequestStatus): PurchaseAction[] {
  return Object.keys(TRANSITIONS[current] ?? {}) as PurchaseAction[];
}
export const TERMINAL_PURCHASE_STATUSES: readonly PurchaseRequestStatus[] = ["finished", "cancelled"];

/** Regra: autorizador só aprova até seu limite; acima, exige nível superior. */
export function authorizerCanApprove(authorizer: { maxValue: string | number; isActive: boolean; minQuotes: number }, request: { approvedTotal: string | number; quotationCount: number }): { ok: boolean; reason?: string } {
  if (!authorizer.isActive) return { ok: false, reason: "Autorizador inativo" };
  if (Number(request.approvedTotal) > Number(authorizer.maxValue)) return { ok: false, reason: "Valor acima do limite do autorizador" };
  if (request.quotationCount < authorizer.minQuotes) return { ok: false, reason: `Mínimo de ${authorizer.minQuotes} cotações não atingido` };
  return { ok: true };
}

/** SLA: horas decorridas no status atual vs. máximo configurado. */
export function slaStatus(statusChangedAt: Date, now: Date, maxHours: number): { hours: number; breached: boolean } {
  const hours = Math.max(0, (now.getTime() - statusChangedAt.getTime()) / 36e5);
  return { hours, breached: maxHours > 0 && hours > maxHours };
}
