"use client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "@/lib/toast";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { DocList, colDate, colMoney, colStatus, colText, dateFilters, StatusBadge } from "@/features/docs/shared";
export function RequisitionsList() {
  const { can } = useAuth(); const qc = useQueryClient();
  const sign = useMutation({ mutationFn: (id: string) => api(`/api/stock/requisitions/${id}/sign`, { method: "POST", body: {} }), onSuccess: () => { toast.success("Requisição assinada"); void qc.invalidateQueries(); }, onError: (e) => toast.error((e as Error).message) });
  return <DocList title="Requisições (saídas)" endpoint="/api/stock/requisitions" base="/estoque/requisicoes" canCreate={can("requisitions.create")} canCancel={can("requisitions.delete")} filters={[{ name: "product_id", label: "Produto", type: "ref", resource: "products" }, { name: "warehouse_id", label: "Armazém", type: "ref", resource: "warehouses" }, { name: "cost_center_id", label: "Centro de custo", type: "ref", resource: "cost_centers" }, ...dateFilters]} columns={[colText("code", "Código"), colDate("requisition_date", "Data de emissão"), colText("requester_name", "Solicitante"), colText("created_by_name", "Usuário"), { key: "items_summary", label: "Itens", render: (r) => <span className="max-w-[320px] truncate inline-block" title={String(r["items_summary"] ?? "")}>{String(r["items_summary"] ?? "")}</span> }, colMoney("total_amount", "Valor"), { key: "signature_status", label: "Assinatura", render: (r) => <StatusBadge s={String(r["signature_status"])} /> }, colStatus()]}
    rowActions={(r) => (r["signature_status"] === "awaiting_signature" && r["status"] === "confirmed" && can("requisitions.edit") ? [{ label: "Marcar como assinada", onClick: () => sign.mutate(String(r["id"])) }] : [])} />;
}
