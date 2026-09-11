"use client";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { brl, cn } from "@/lib/utils";
import { FilterChips, useUrlParam } from "@/components/workspace";
import { DocList, colDate, colMoney, colStatus } from "@/features/docs/shared";

/**
 * Ordens de serviço (Compactação V2): UMA lista. Escopo (Todas / Minhas), Status e "Somente atrasadas" são filtros na
 * URL (`?scope=`, `?status=`, `?late=1`), não abas. Contadores por status vêm do monitoramento (uma consulta agregada)
 * quando o usuário tem `service_orders.monitor`. A avaliação continua no detalhe da OS finalizada.
 */
const STATUS_OPTIONS = [{ value: "all", label: "Todos" }, { value: "open", label: "Abertas" }, { value: "in_progress", label: "Em andamento" }, { value: "finished", label: "Finalizadas" }, { value: "evaluated", label: "Avaliadas" }, { value: "cancelled", label: "Canceladas" }];
export function ServiceOrdersList() {
  const { can } = useAuth();
  const [scope, setScope] = useUrlParam("scope", "all"); const [status, setStatus] = useUrlParam("status", "all"); const [late, setLate] = useUrlParam("late", "");
  const mon = useQuery({ queryKey: ["os-mon"], queryFn: () => api<{ by_status: { status: string; n: number; total: string }[]; late: unknown[] }>("/api/service-orders-monitoring"), enabled: can("service_orders.monitor"), staleTime: 30_000 });
  const count = (st: string) => !mon.data ? undefined : st === "all" ? mon.data.by_status.reduce((a, x) => a + x.n, 0) : mon.data.by_status.find((x) => x.status === st)?.n ?? 0;
  const fixed: Record<string, string> = { ...(scope === "mine" ? { mine: "1" } : {}), ...(status !== "all" ? { status } : {}), ...(late === "1" ? { late: "1" } : {}) };
  return <div className="flex min-h-0 flex-1 flex-col gap-2">
    <div className="mg-card ws-filters no-print">
      <FilterChips label="Escopo" testId="os-scope" value={scope} onChange={setScope} options={[{ value: "all", label: "Todas" }, { value: "mine", label: "Minhas", hint: "Ordens criadas por mim" }]} />
      <FilterChips label="Status" testId="os-status" value={status} onChange={setStatus} options={STATUS_OPTIONS.map((o) => ({ ...o, count: count(o.value) }))} />
      <button type="button" role="checkbox" aria-checked={late === "1"} className={cn("ws-chip", late === "1" && "is-active")} data-testid="os-late" onClick={() => setLate(late === "1" ? "" : "1")}>{late === "1" ? "☑" : "☐"} Somente atrasadas{mon.data && <span className="ws-chip__count">{mon.data.late.length}</span>}</button>
    </div>
    <DocList key={JSON.stringify(fixed)} title={scope === "mine" ? "Minhas Ordens de Serviço" : "Ordens de Serviço"} endpoint="/api/service-orders" base="/os" canCreate={can("service_orders.create")} hideNew defaultFilters={fixed} entity="service_orders"
      filters={[{ name: "start_date", label: "Dt. Início", type: "date" }, { name: "end_date", label: "Dt. Fim", type: "date" }]}
      columns={[{ key: "code", label: "Código" }, colDate("order_date", "Data"), { key: "description", label: "Descrição" }, { key: "activity_name", label: "Atividade" }, { key: "operation_name", label: "Operação" }, { key: "responsible_name", label: "Responsável" }, { key: "team_name", label: "Equipe" }, colDate("planned_end", "Prev. término"), colMoney("total", "Custo"), { key: "rating", label: "Nota", render: (r) => r["rating"] ? "★".repeat(Number(r["rating"])) : "" }, colStatus()]}
      totals={(t) => <tr><td colSpan={8} className="px-2 py-1">Total</td><td className="num">{brl(t["total"] ?? "0")}</td><td colSpan={2} /></tr>} />
  </div>;
}
