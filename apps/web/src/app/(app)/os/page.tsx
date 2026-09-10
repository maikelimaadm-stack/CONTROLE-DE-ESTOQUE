"use client";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { brl } from "@/lib/utils";
import { DocList, colDate, colMoney, colStatus } from "@/features/docs/shared";
function Inner() {
  const { can } = useAuth(); const sp = useSearchParams(); const mine = sp.get("mine") === "1";
  return <DocList key={String(mine)} title={mine ? "Minhas Ordens de Serviço" : "Ordens de Serviço"} endpoint="/api/service-orders" base="/os" canCreate={can("service_orders.create")} defaultFilters={mine ? { mine: "1" } : {}}
    filters={[{ name: "status", label: "Status", type: "select", options: [{ value: "open", label: "Aberta" }, { value: "in_progress", label: "Em execução" }, { value: "finished", label: "Finalizada" }, { value: "evaluated", label: "Avaliada" }, { value: "cancelled", label: "Cancelada" }] }, { name: "start_date", label: "Dt. Início", type: "date" }, { name: "end_date", label: "Dt. Fim", type: "date" }]}
    columns={[{ key: "code", label: "Código" }, colDate("order_date", "Data"), { key: "description", label: "Descrição" }, { key: "activity_name", label: "Atividade" }, { key: "operation_name", label: "Operação" }, { key: "responsible_name", label: "Responsável" }, { key: "team_name", label: "Equipe" }, colDate("planned_end", "Prev. término"), colMoney("total", "Custo"), { key: "rating", label: "Nota", render: (r) => r["rating"] ? "★".repeat(Number(r["rating"])) : "" }, colStatus()]}
    totals={(t) => <tr><td colSpan={8} className="px-2 py-1">Total</td><td className="num">{brl(t["total"] ?? "0")}</td><td colSpan={2} /></tr>} />;
}
export default function Page() { return <Suspense><Inner /></Suspense>; }
