"use client";
import { Suspense } from "react";
import { Workspace, NewChooser } from "@/components/workspace";
import { SalesList, KINDS } from "@/features/sales/sales-list";

/** Vendas: Orçamento → Pedido → Venda em uma única área (conversões continuam no detalhe de cada documento). */
function Inner() {
  return <Workspace title="Vendas" actions={<NewChooser items={[{ label: "Novo orçamento", href: "/vendas/budgets/new", perm: "budgets.create" }, { label: "Novo pedido", href: "/vendas/orders/new", perm: "orders.create" }, { label: "Nova venda", href: "/vendas/sales/new", perm: "sales.create" }]} />}
    tabs={(["budgets", "orders", "sales"] as const).map((k) => ({ key: k, label: KINDS[k]!.title, perm: `${KINDS[k]!.perm}.view`, content: <SalesList kind={k} /> }))} />;
}
export default function Page() { return <Suspense><Inner /></Suspense>; }
