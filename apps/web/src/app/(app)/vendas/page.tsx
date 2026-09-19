"use client";
import { Suspense } from "react";
import { Workspace, NewChooser, tab } from "@/components/workspace";
import { SalesList } from "@/features/sales/sales-list";

/**
 * PORTAL DE VENDAS — o agrupador, não um documento novo.
 *
 * O portal é a área; `kind` continua sendo documento DISTINTO. Orçamento → Pedido → Venda permanecem três
 * abas com regra, permissão e endpoint próprios: assumir o nome do portal não funde nada
 * (docs/PORTAIS-OPERACIONAIS-CONTRACT.md). Conversões continuam no detalhe, agora escolhendo a TOP do
 * destino.
 */
function Inner() {
  return <Workspace title="Portal de Vendas" defaultTab="sales" actions={<NewChooser items={[{ label: "Novo orçamento", href: "/vendas/budgets/new", perm: "budgets.create" }, { label: "Novo pedido", href: "/vendas/orders/new", perm: "orders.create" }, { label: "Nova venda", href: "/vendas/sales/new", perm: "sales.create" }]} />}
    tabs={[tab("vendas.budgets", <SalesList kind="budgets" />), tab("vendas.orders", <SalesList kind="orders" />), tab("vendas.sales", <SalesList kind="sales" />)]} />;
}
export default function Page() { return <Suspense><Inner /></Suspense>; }
