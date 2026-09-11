"use client";
import { Suspense } from "react";
import { Workspace, NewChooser, tab } from "@/components/workspace";
import { ReportsCatalog } from "@/features/reports/catalog";

/** Relatórios (V2): área única com busca, filtro de módulo e acesso rápido (Favoritos / Personalizados). */
function Inner() {
  return <Workspace title="Relatórios" actions={<NewChooser items={[{ label: "Novo relatório personalizado", href: "/relatorios/personalizados/novo", perm: "saved_reports.create" }]} />} tabs={[tab("relatorios.catalogo", <ReportsCatalog />)]} />;
}
export default function Page() { return <Suspense><Inner /></Suspense>; }
