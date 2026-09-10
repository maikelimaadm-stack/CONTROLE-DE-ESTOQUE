"use client";
import { useAuth } from "@/lib/auth";
import { brl, num } from "@/lib/utils";
import { DocList, colDate, colMoney, colQty, colStatus } from "@/features/docs/shared";
export default function Page() {
  const { can } = useAuth();
  return <DocList title="Abastecimentos" endpoint="/api/fleet/fuel-supplies" base="/frota/abastecimentos" canCreate={can("fuel_supplies.create")} canCancel={can("fuel_supplies.delete")}
    filters={[{ name: "equipment_id", label: "Máquina", type: "ref", resource: "equipments" }, { name: "product_id", label: "Combustível", type: "ref", resource: "products" }, { name: "start_date", label: "Dt. Início", type: "date" }, { name: "end_date", label: "Dt. Fim", type: "date" }]}
    columns={[{ key: "code", label: "Código" }, colDate("supply_date", "Data"), { key: "equipment_name", label: "Máquina" }, { key: "product_name", label: "Combustível" }, { key: "warehouse_name", label: "Armazém/tanque" }, { key: "operator_name", label: "Operador" }, colQty("quantity", "Litros", 3), colMoney("unit_value", "Vl. unit."), colMoney("total", "Total"), { key: "hour_meter", label: "Horímetro", align: "right" }, { key: "mileage", label: "Km", align: "right" }, { key: "origin", label: "Origem" }, colStatus()]}
    totals={(t) => <tr><td colSpan={6} className="px-2 py-1">Totais</td><td className="num">{num(t["quantity"] ?? "0", 3)}</td><td /><td className="num">{brl(t["total"] ?? "0")}</td><td colSpan={4} /></tr>}
    rowActions={() => []} />;
}
