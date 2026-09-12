"use client";
import { Suspense } from "react";
import { Workspace, NewChooser, tab } from "@/components/workspace";
import { Dashboard } from "@/features/dashboards/dashboard";
import { SupplyProcesses } from "@/features/supply/processes";

/** Compras (V2): Visão Geral + Processos — uma lista com Escopo (Todos/Meus) e Etapa como filtros (sem sub-abas). */
function Inner() {
  return <Workspace title="Compras" actions={<NewChooser items={[{ label: "Nova solicitação de compra", href: "/suprimentos/new", perm: "purchase_requests.create" }]} />} tabs={[
    tab("compras.visao-geral", <Dashboard k="suprimentos" title="Indicadores de compras" />),
    tab("compras.processos", <SupplyProcesses />)
  ]} defaultTab="processos" />;
}
export default function Page() { return <Suspense><Inner /></Suspense>; }
