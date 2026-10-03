"use client";
import { useAuth } from "@/lib/auth";
import { DocList, colDate, colMoney, colStatus, colText, dateFilters } from "@/features/docs/shared";
import { enumLabel, enumOptions } from "@/lib/copy";
export function WriteoffsList() { const { can } = useAuth(); return <DocList title="Baixa de Estoque" endpoint="/api/stock/writeoffs" base="/estoque/baixas" canCreate={can("stock_writeoffs.create")} hideNew canCancel={can("stock_writeoffs.delete")} filters={dateFilters} columns={[colText("code", "Código"), colText("created_by_name", "Responsável"), colText("warehouse_name", "Local de estoque"), { key: "reason", label: "Motivo", kind: "enum", options: enumOptions("writeoff_reason"), render: (r) => enumLabel("writeoff_reason", r["reason"]), text: (r) => enumLabel("writeoff_reason", r["reason"]) }, colDate("writeoff_date", "Data de emissão"), colMoney("total_amount", "Valor"), colStatus()]} />; }
