"use client";
import * as React from "react";
import { Badge } from "./badge";
import { enumLabel, type EnumDomain } from "@/lib/copy";

/**
 * StatusBadge oficial (docs/UI-STANDARD.md › Primitives visuais): situação de um registro com rótulo PT-BR vindo de
 * `enumLabel` (nunca o valor técnico) e tonalidade visual resolvida centralmente por família semântica.
 * Famílias: positive (concluído/ativo) · negative (cancelado/falhou) · warning (pendente/aguardando) · info (em curso,
 * informativo) · neutral (encerrado/arquivado/desconhecido). Um domínio pode sobrescrever a família de um valor
 * porque a mesma palavra não significa a mesma coisa em todo módulo (`open` de título = "A vencer" = info).
 */
export type StatusTone = "positive" | "negative" | "warning" | "info" | "neutral";
export type BadgeTone = NonNullable<React.ComponentProps<typeof Badge>["tone"]>;
export const TONE_BADGE: Record<StatusTone, BadgeTone> = { positive: "green", negative: "red", warning: "amber", info: "blue", neutral: "slate" };

const GENERIC: Record<string, StatusTone> = {
  confirmed: "positive", paid: "positive", settled: "positive", finished: "positive", signed: "positive", approved: "positive", active: "positive", done: "positive",
  reconciled: "positive", matched: "positive", launched: "positive", converted: "positive", invoiced: "positive", evaluated: "positive", purchase_received: "positive", purchase_done: "positive", financial_generated: "positive",
  cancelled: "negative", reversed: "negative", failed: "negative", dead: "negative", rejected: "negative", not_approved: "negative", lost: "negative", expired: "negative", written_off: "negative",
  pending: "warning", draft: "warning", open: "warning", awaiting_signature: "warning", scheduled: "warning", queued: "warning", partially_paid: "warning", request: "warning", quotation_in_progress: "warning", under_review: "warning",
  in_progress: "info", running: "info", reconciling: "info", imported: "info",
  inactive: "neutral", closed: "neutral", archived: "neutral", sold: "neutral", transferred: "neutral", inventoried: "neutral", ignored: "neutral", none: "neutral"
};
const BY_DOMAIN: Partial<Record<EnumDomain, Record<string, StatusTone>>> = {
  title_status: { open: "info", overdue: "negative", partially_paid: "warning", paid: "positive", cancelled: "neutral" },
  // Documento de compra (COMPRAS-01): as mesmas cores da situação da venda (aberto/confirmado/cancelado). COMPRAS-02:
  // o pedido `convertido` (saldo todo recebido ou encerrado) tem a cor do `converted` da venda. OPERACOES-01 F6b:
  // finalizado = em curso; escolhido = concluído; não escolhido = encerrado.
  situacao_documento_compra: { aberto: "warning", confirmado: "positive", convertido: "positive", cancelado: "negative", finalizado: "info", escolhido: "positive", nao_escolhido: "neutral" },
  // Documento de estoque (OPERACOES-01 F12): mapa PRÓPRIO, com as cores da situação da venda e da compra para os três
  // valores que ele tem (o CHECK da 0040 e SITUACOES_DOCUMENTO_ESTOQUE do domínio: aberto/confirmado/cancelado). Antes,
  // a lista e a consulta do estoque pegavam emprestado o mapa da compra — que tem valores que o estoque não tem.
  situacao_documento_estoque: { aberto: "warning", confirmado: "positive", cancelado: "negative" },
  purchase_status: { finished: "positive", purchase_received: "positive", cancelled: "negative", not_approved: "negative", under_review: "warning" },
  manifest_status: { confirmed: "positive", awareness: "info", unknown: "negative", not_performed: "negative", none: "neutral" },
  launch_status: { launched: "positive", ignored: "neutral", pending: "warning", draft: "warning" },
  diagnosis_result: { pregnant: "positive", empty: "negative", pending: "warning" },
  reproductive_status: { pregnant: "positive", empty: "neutral", calved: "info" },
  decision: { approved: "positive", rejected: "negative", awareness: "info" },
  audit_action: { create: "positive", approve: "positive", sign: "positive", restore: "positive", update: "info", transfer: "info", delete: "negative", cancel: "negative", reject: "negative", reverse: "negative", login: "neutral", logout: "neutral", read: "neutral" }
};

/** Família de tonalidade de um valor de enum no seu domínio (valor vazio ou desconhecido → neutral). */
export function statusTone(value: unknown, domain: EnumDomain = "status"): StatusTone {
  if (value === null || value === undefined || value === "") return "neutral";
  const v = String(value);
  return BY_DOMAIN[domain]?.[v] ?? GENERIC[v] ?? (v.startsWith("awaiting_") ? "warning" : "neutral");
}

export interface StatusBadgeProps { value: unknown; domain?: EnumDomain; /** substitui o rótulo resolvido por enumLabel (ex.: rótulo derivado pela API) */ label?: string; /** sobrescreve a família de tonalidade */ tone?: StatusTone; className?: string; title?: string }
export function StatusBadge({ value, domain = "status", label, tone, className, title }: StatusBadgeProps) {
  const t = tone ?? statusTone(value, domain);
  return <Badge tone={TONE_BADGE[t]} className={className} title={title} data-status={value === null || value === undefined ? "" : String(value)} data-tone={t}>{label ?? enumLabel(domain, value)}</Badge>;
}
