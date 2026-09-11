"use client";
import { Suspense } from "react";
import { useAuth } from "@/lib/auth";
import { Workspace, NewChooser } from "@/components/workspace";
import { ReportsCatalog, useReportCatalog } from "@/features/reports/catalog";
import { SavedReportsPanel } from "@/features/reports/saved-reports";

/** Relatórios: área única organizada por módulo (Favoritos · módulos · Personalizados). */
function Inner() {
  const { can } = useAuth(); const q = useReportCatalog();
  const modules = [...new Set((q.data ?? []).map((r) => r.module))];
  const key = (m: string) => m.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-");
  return <Workspace title="Relatórios" actions={<NewChooser items={[{ label: "Novo relatório personalizado", href: "/relatorios/personalizados/novo", perm: "saved_reports.create" }]} />} tabs={[
    { key: "favoritos", label: "Favoritos", content: <ReportsCatalog favoritesOnly /> },
    { key: "todos", label: "Todos", content: <ReportsCatalog /> },
    ...modules.map((m) => ({ key: key(m), label: m, content: <ReportsCatalog module={m} /> })),
    ...(can("saved_reports.view") ? [{ key: "personalizados", label: "Personalizados", content: <div className="ws-scroll"><SavedReportsPanel /></div> }] : [])
  ]} defaultTab="todos" />;
}
export default function Page() { return <Suspense><Inner /></Suspense>; }
