"use client";
import { useAuth } from "@/lib/auth";
import { brl } from "@/lib/utils";
import { DocList, colDate, colMoney, colStatus } from "@/features/docs/shared";
/** Ordens de serviço (antes: /os e /os?mine=1). `scope` vira filtro fixo: todas | minhas | em andamento | finalizadas. */
export function ServiceOrdersList({ scope = "all", status }: { scope?: "all" | "mine" | "in_progress" | "finished"; status?: string } = {}) {
  const { can } = useAuth();
  const fixed: Record<string, string> = scope === "mine" ? { mine: "1" } : scope === "in_progress" ? { status: "in_progress" } : scope === "finished" ? { status: "finished" } : status ? { status } : {};
  return <DocList key={`${scope}${status ?? ""}`} title={scope === "mine" ? "Minhas Ordens de Serviço" : "Ordens de Serviço"} endpoint="/api/service-orders" base="/os" canCreate={can("service_orders.create")} defaultFilters={fixed}
    filters={[{ name: "status", label: "Status", type: "select", options: [{ value: "open", label: "Aberta" }, { value: "in_progress", label: "Em execução" }, { value: "finished", label: "Finalizada" }, { value: "evaluated", label: "Avaliada" }, { value: "cancelled", label: "Cancelada" }] }, { name: "start_date", label: "Dt. Início", type: "date" }, { name: "end_date", label: "Dt. Fim", type: "date" }]}
    columns={[{ key: "code", label: "Código" }, colDate("order_date", "Data"), { key: "description", label: "Descrição" }, { key: "activity_name", label: "Atividade" }, { key: "operation_name", label: "Operação" }, { key: "responsible_name", label: "Responsável" }, { key: "team_name", label: "Equipe" }, colDate("planned_end", "Prev. término"), colMoney("total", "Custo"), { key: "rating", label: "Nota", render: (r) => r["rating"] ? "★".repeat(Number(r["rating"])) : "" }, colStatus()]}
    totals={(t) => <tr><td colSpan={8} className="px-2 py-1">Total</td><td className="num">{brl(t["total"] ?? "0")}</td><td colSpan={2} /></tr>} />;
}
