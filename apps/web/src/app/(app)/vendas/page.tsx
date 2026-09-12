"use client";
import { Suspense } from "react";
import { Workspace, NewChooser, tab } from "@/components/workspace";
import { SalesList } from "@/features/sales/sales-list";

/** Vendas: Orçamento → Pedido → Venda são documentos distintos; mantidos como três abas (não compactar por compactar). Conversões continuam no detalhe. */
function Inner() {
  return <Workspace title="Vendas" defaultTab="sales" actions={<NewChooser items={[{ label: "Novo orçamento", href: "/vendas/budgets/new", perm: "budgets.create" }, { label: "Novo pedido", href: "/vendas/orders/new", perm: "orders.create" }, { label: "Nova venda", href: "/vendas/sales/new", perm: "sales.create" }]} />}
    tabs={[tab("vendas.budgets", <SalesList kind="budgets" />), tab("vendas.orders", <SalesList kind="orders" />), tab("vendas.sales", <SalesList kind="sales" />)]} />;
}
export default function Page() { return <Suspense><Inner /></Suspense>; }
