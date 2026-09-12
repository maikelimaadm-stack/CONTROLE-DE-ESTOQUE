"use client";
import { useAuth } from "@/lib/auth";
import { brl } from "@/lib/utils";
import { DocList, colDate, colMoney, colStatus } from "@/features/docs/shared";
import { encodeList } from "@agro/shared";
import { MOV_PT } from "@/features/livestock/shared";
const PERM: Record<string, string> = { sale: "animal_sales", purchase: "animal_purchases", birth: "births", death: "deaths", loss: "losses" };
/** Movimentações do rebanho por tipo (antes: /pecuaria/movimentacoes/[type]). */
export const MOVEMENT_TYPES = ["purchase", "sale", "birth", "death", "loss"];
/** `type` vazio = todos os tipos (filtro `movement_type__in`); cada linha abre o detalhe do seu próprio tipo. */
export function LivestockMovementsList({ type = "" }: { type?: string } = {}) {
  const { can } = useAuth(); const perm = PERM[type] ?? "animal_sales";
  return <DocList key={type || "all"} title={type ? `Movimentações — ${MOV_PT[type] ?? type}` : "Movimentações do rebanho"} endpoint="/api/livestock/movements" base="/pecuaria/movimentacoes" rowHref={(r) => `/pecuaria/movimentacoes/${String(r["movement_type"])}/${r["id"]}`} defaultFilters={type ? { movement_type: type } : { movement_type__in: encodeList(MOVEMENT_TYPES) }} hideNew canCreate={Boolean(type) && can(`${perm}.create`)} canCancel={Boolean(type) && can(`${perm}.delete`)} entity="animal_movements"
    filters={[{ name: "start_date", label: "Dt. Início", type: "date" }, { name: "end_date", label: "Dt. Fim", type: "date" }, ...(type === "sale" || type === "purchase" ? [{ name: "person_id", label: type === "sale" ? "Cliente" : "Fornecedor", type: "ref" as const, resource: "people" }] : [])]}
    columns={[{ key: "code", label: "Código" }, colDate("movement_date", "Data"), { key: "movement_type", label: "Tipo", kind: "enum", options: MOVEMENT_TYPES.map((v) => ({ value: v, label: MOV_PT[v] ?? v })), render: (r) => MOV_PT[String(r["movement_type"])] ?? String(r["movement_type"]) }, { key: "farm_name", label: "Fazenda" }, { key: "person_name", label: "Pessoa" }, { key: "batch_name", label: "Lote" }, { key: "quantity", label: "Cabeças", align: "right" }, { key: "total_weight", label: "Peso total", align: "right" }, colMoney("total_value", "Valor"), { key: "invoice_number", label: "NF" }, { key: "cause", label: "Causa" }, colStatus()]}
    totals={(t) => <tr><td colSpan={6} className="px-2 py-1">Totais</td><td className="num">{t["quantity"] ?? ""}</td><td className="num">{t["weight"] ?? ""}</td><td className="num">{brl(t["value"] ?? "0")}</td><td colSpan={3} /></tr>} />;
}
