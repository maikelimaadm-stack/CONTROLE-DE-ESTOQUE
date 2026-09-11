"use client";
import { useAuth } from "@/lib/auth";
import { DocList, colDate, colMoney, colStatus, colText, dateFilters } from "@/features/docs/shared";
export function WriteoffsList() { const { can } = useAuth(); return <DocList title="Baixa de Estoque" endpoint="/api/stock/writeoffs" base="/estoque/baixas" canCreate={can("stock_writeoffs.create")} canCancel={can("stock_writeoffs.delete")} filters={dateFilters} columns={[colText("code", "Código"), colText("created_by_name", "Responsável"), colText("warehouse_name", "Armazém"), colText("reason", "Motivo"), colDate("writeoff_date", "Dt. Emissão"), colMoney("total_amount", "Valor"), colStatus()]} />; }
