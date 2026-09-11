"use client";
import * as React from "react";
import { useAuth } from "@/lib/auth";
import { brl } from "@/lib/utils";
import { Badge } from "@/components/ui";
import { DocList, colDate, colMoney, type Row } from "@/features/docs/shared";
import { useAction } from "@/features/docs/actions";

export const STAGES: Record<string, { title: string; hint: string }> = {
  all: { title: "Todos", hint: "Todos os processos de compra, em qualquer etapa" }, finished: { title: "Finalizados", hint: "Pedidos finalizados" },
  request: { title: "Solicitações", hint: "Pedidos criados aguardando envio/ciência" }, quotation: { title: "Cotações", hint: "Aguardando ciência e cotação em andamento" },
  authorization: { title: "Autorização", hint: "Aguardando aprovação / análise" }, buy: { title: "Compras", hint: "Aguardando a compra e compras efetuadas" },
  receipts: { title: "Recebimentos", hint: "Compras efetuadas, recebidas e finalizadas" }, rejected: { title: "Rejeitados / Cancelados", hint: "Pedidos não aprovados ou cancelados" }, mine: { title: "Meus Processos", hint: "Solicitações em que sou responsável ou solicitante" }
};
const PRIORITY: Record<string, string> = { low: "Baixa", medium: "Média", high: "Alta" };
export const REQUEST_TYPES: Record<string, string> = { product: "Produto", service: "Serviço", advance: "Adiantamento", refund: "Reembolso", daily: "Diária", contract: "Contrato", finished_product: "Produto acabado" };

/** Processos de compra por etapa (antes: /suprimentos/[stage]); uma lista, um endpoint, filtro por etapa. */
export function SupplyRequestsList({ stage }: { stage: string }) {
  const { can } = useAuth(); const st = STAGES[stage] ?? STAGES["all"]!;
  const act = useAction();
  return <DocList key={stage} title={`Compras — ${st.title}`} endpoint="/api/supply/requests" base="/suprimentos/view" defaultFilters={{ stage }} canCreate={can("purchase_requests.create")} hideNew={stage !== "request" && stage !== "mine" && stage !== "all"}
    extraActions={<span className="text-xs text-slate-500">{st.hint}</span>}
    filters={[{ name: "search", label: "Código / descrição", type: "text" }, { name: "request_type", label: "Tipo", type: "select", options: Object.entries(REQUEST_TYPES).map(([value, label]) => ({ value, label })) }, { name: "priority", label: "Prioridade", type: "select", options: Object.entries(PRIORITY).map(([value, label]) => ({ value, label })) }, { name: "start_date", label: "Dt. Início", type: "date" }, { name: "end_date", label: "Dt. Fim", type: "date" }, { name: "farm_id", label: "Fazenda", type: "ref", resource: "farms" }]}
    columns={[{ key: "code", label: "Código" }, colDate("request_date", "Data"), { key: "description", label: "Descrição" }, { key: "request_type", label: "Tipo", render: (r) => REQUEST_TYPES[String(r["request_type"])] ?? String(r["request_type"]) }, { key: "priority", label: "Prioridade", render: (r) => <Badge tone={r["priority"] === "high" ? "red" : r["priority"] === "medium" ? "amber" : "slate"}>{PRIORITY[String(r["priority"])]}</Badge> }, { key: "farm_name", label: "Fazenda" }, { key: "requester_name", label: "Solicitante" }, { key: "current_responsible_name", label: "Responsável" }, { key: "status", label: "Status", render: (r) => <SupplyStatus r={r} /> }, colMoney("estimated_total", "Vl. Estimado"), { key: "approved_total", label: "Vl. Aprovado", align: "right", render: (r) => r["approved_total"] ? brl(r["approved_total"] as string) : "—" }, { key: "quotation_count", label: "Cotações", align: "right" }]}
    rowActions={(r) => stage === "receipts" && r["status"] === "purchase_done" && can("purchase_receipts.edit") ? [{ label: r["launched"] ? "Documento lançado" : "Lançar documento fiscal", href: r["launched"] ? undefined : `/estoque/documentos-fiscais/new?request_id=${r["id"]}` }, { label: "Confirmar recebimento", onClick: () => act.mutate({ path: `/api/supply/requests/${r["id"]}/actions/mark_received`, body: { justification: "Recebimento confirmado na tela de Recebimentos" } }) }] : []} />;
}
export function SupplyStatus({ r }: { r: Row }) {
  const sla = r["sla"] as { hours: number; breached: boolean } | undefined; const s = String(r["status"]);
  const tone = s === "finished" ? "green" : s === "cancelled" || s === "not_approved" ? "red" : sla?.breached ? "amber" : "blue";
  return <span className="flex items-center gap-1"><Badge tone={tone}>{String(r["status_label"] ?? s)}</Badge>{sla && <span className={`text-[10px] ${sla.breached ? "text-red-600 font-semibold" : "text-slate-400"}`} title="Tempo no status atual (SLA)">{Math.round(sla.hours)}h</span>}</span>;
}
