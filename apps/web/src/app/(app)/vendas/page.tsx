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
 *
 * O TÍTULO SAI DO REGISTRY, e não da palavra "portal". "Portal de Vendas" é o nome do CONCEITO em
 * `docs/PORTAIS-OPERACIONAIS-CONTRACT.md`, mas o rótulo do módulo tem dono único — `apps/web/nav.registry.mjs`
 * (`CLAUDE.md`: "Sem segundo SSOT: navegação em apps/web/nav.registry.mjs"). Esta fatia chegou a escrever
 * "Portal de Vendas" literal aqui, e isso fazia esta ser a ÚNICA tela `Workspace` cujo título divergia do
 * menu que leva até ela. Renomear o módulo é decisão de navegação, própria, no registry — não efeito
 * colateral de uma fatia sobre TOP. O literal aqui é o MESMO do registry, como nas outras onze telas.
 */
function Inner() {
  return <Workspace title="Vendas" defaultTab="sales" actions={<NewChooser items={[{ label: "Novo orçamento", href: "/vendas/budgets/new", perm: "budgets.create" }, { label: "Novo pedido", href: "/vendas/orders/new", perm: "orders.create" }, { label: "Nova venda", href: "/vendas/sales/new", perm: "sales.create" }]} />}
    tabs={[tab("vendas.budgets", <SalesList kind="budgets" />), tab("vendas.orders", <SalesList kind="orders" />), tab("vendas.sales", <SalesList kind="sales" />)]} />;
}
export default function Page() { return <Suspense><Inner /></Suspense>; }
