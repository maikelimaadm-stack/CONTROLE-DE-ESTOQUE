"use client";
import { useAuth } from "@/lib/auth";
import { brl } from "@/lib/utils";
import { DocList, colDate, colMoney, colStatus } from "@/features/docs/shared";
export const KINDS: Record<string, { title: string; perm: string; singular: string; next?: string }> = { budgets: { title: "Orçamentos", perm: "budgets", singular: "Orçamento", next: "orders" }, orders: { title: "Pedidos de Venda", perm: "orders", singular: "Pedido", next: "sales" }, sales: { title: "Vendas", perm: "sales", singular: "Venda" } };
/** Orçamentos / Pedidos / Vendas (antes: /vendas/[kind]). */
export function SalesList({ kind }: { kind: string }) {
  const k = KINDS[kind] ?? KINDS["sales"]!; const { can } = useAuth();
  return <DocList key={kind} title={k.title} endpoint={`/api/sales/${kind}`} base={`/vendas/${kind}`} canCreate={can(`${k.perm}.create`)} canCancel={can(`${k.perm}.delete`)}
    filters={[{ name: "start_date", label: "Dt. Início", type: "date" }, { name: "end_date", label: "Dt. Fim", type: "date" }, { name: "client_id", label: "Cliente", type: "ref", resource: "people", extra: { is_client: "true" } }, { name: "status", label: "Status", type: "select", options: [{ value: "open", label: "Aberto" }, { value: "approved", label: "Aprovado" }, { value: "converted", label: "Convertido" }, { value: "confirmed", label: "Confirmado" }, { value: "cancelled", label: "Cancelado" }] }, { name: "search", label: "Código / cliente", type: "text" }]}
    columns={[{ key: "code", label: "Código" }, colDate("document_date", "Data"), { key: "client_name", label: "Cliente" }, { key: "farm_name", label: "Fazenda" }, { key: "responsible_name", label: "Responsável" }, colMoney("subtotal", "Subtotal"), colMoney("discount", "Desconto"), colMoney("freight", "Frete"), colMoney("total", "Total"), colStatus()]}
    totals={(t) => <tr><td colSpan={8} className="px-2 py-1">Total (filtro)</td><td className="num">{brl(t["total"] ?? "0")}</td><td /></tr>} />;
}
