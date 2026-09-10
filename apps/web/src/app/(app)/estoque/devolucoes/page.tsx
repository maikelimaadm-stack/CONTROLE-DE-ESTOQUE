"use client";
import { useAuth } from "@/lib/auth";
import { DocList, colDate, colMoney, colStatus, colText, dateFilters } from "@/features/docs/shared";
export default function Page() { const { can } = useAuth(); return <DocList title="Devolução / Entrada" endpoint="/api/stock/devolutions" base="/estoque/devolucoes" canCreate={can("devolutions.create")} canCancel={can("devolutions.delete")} filters={dateFilters} columns={[colText("code", "Código"), colDate("devolution_date", "Data"), colText("responsible_name", "Responsável Devolução"), colText("created_by_name", "Usuário"), colMoney("total_amount", "Valor"), colStatus()]} />; }
