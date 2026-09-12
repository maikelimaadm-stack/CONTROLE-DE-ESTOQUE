"use client";
import { useAuth } from "@/lib/auth";
import { DocList, colDate, colMoney, colStatus, colText, dateFilters } from "@/features/docs/shared";
export function InputEntriesList() { const { can } = useAuth(); return <DocList title="Entrada / Insumos" endpoint="/api/stock/input-entries" base="/estoque/entradas" canCreate={can("input_entries.create")} canCancel={can("input_entries.delete")} filters={[{ name: "farm_id", label: "Fazenda", type: "ref", resource: "farms" }, ...dateFilters]} columns={[colText("code", "Código"), colDate("entry_date", "Data"), colText("farm_name", "Fazenda"), colText("created_by_name", "Responsável"), colText("item_count", "Produtos"), colMoney("total_amount", "Valor total"), colStatus()]} />; }
