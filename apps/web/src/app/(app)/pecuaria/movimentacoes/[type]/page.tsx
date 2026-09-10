"use client";
import { use } from "react";
import { useAuth } from "@/lib/auth";
import { brl } from "@/lib/utils";
import { DocList, colDate, colMoney, colStatus } from "@/features/docs/shared";
import { MOV_PT } from "@/features/livestock/shared";
const PERM: Record<string, string> = { sale: "animal_sales", purchase: "animal_purchases", birth: "births", death: "deaths", loss: "losses" };
export default function Page({ params }: { params: Promise<{ type: string }> }) {
  const { type } = use(params); const { can } = useAuth(); const perm = PERM[type] ?? "animal_sales";
  return <DocList key={type} title={`Pecuária — ${MOV_PT[type] ?? type}`} endpoint="/api/livestock/movements" base={`/pecuaria/movimentacoes/${type}`} defaultFilters={{ movement_type: type }} canCreate={can(`${perm}.create`)} canCancel={can(`${perm}.delete`)}
    filters={[{ name: "start_date", label: "Dt. Início", type: "date" }, { name: "end_date", label: "Dt. Fim", type: "date" }, ...(type === "sale" || type === "purchase" ? [{ name: "person_id", label: type === "sale" ? "Cliente" : "Fornecedor", type: "ref" as const, resource: "people" }] : [])]}
    columns={[{ key: "code", label: "Código" }, colDate("movement_date", "Data"), { key: "farm_name", label: "Fazenda" }, { key: "person_name", label: "Pessoa" }, { key: "batch_name", label: "Lote" }, { key: "quantity", label: "Cabeças", align: "right" }, { key: "total_weight", label: "Peso total", align: "right" }, colMoney("total_value", "Valor"), { key: "invoice_number", label: "NF" }, { key: "cause", label: "Causa" }, colStatus()]}
    totals={(t) => <tr><td colSpan={5} className="px-2 py-1">Totais</td><td className="num">{t["quantity"] ?? ""}</td><td className="num">{t["weight"] ?? ""}</td><td className="num">{brl(t["value"] ?? "0")}</td><td colSpan={3} /></tr>} />;
}
