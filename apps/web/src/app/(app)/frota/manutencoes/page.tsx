"use client";
import { useAuth } from "@/lib/auth";
import { brl } from "@/lib/utils";
import { DocList, colDate, colMoney, colStatus } from "@/features/docs/shared";
export default function Page() {
  const { can } = useAuth();
  return <DocList title="Manutenções de Máquinas" endpoint="/api/fleet/maintenances" base="/frota/manutencoes" canCreate={can("maintenances.create")} canCancel={can("maintenances.delete")}
    filters={[{ name: "equipment_id", label: "Máquina", type: "ref", resource: "equipments" }, { name: "start_date", label: "Dt. Início", type: "date" }, { name: "end_date", label: "Dt. Fim", type: "date" }]}
    columns={[{ key: "code", label: "Código" }, colDate("maintenance_date", "Data"), { key: "machines", label: "Máquinas" }, { key: "responsible_name", label: "Responsável" }, colMoney("items_total", "Peças/insumos"), colMoney("service_total", "Serviços"), colMoney("total", "Total"), colStatus()]}
    totals={(t) => <tr><td colSpan={6} className="px-2 py-1">Total</td><td className="num">{brl(t["total"] ?? "0")}</td><td /></tr>} />;
}
