"use client";
import * as React from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Star, Search } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Card, CardBody, Spinner, Empty } from "@/components/ui";
import { MgSelect } from "@/components/ui/mg-controls";
import { FilterChips, useUrlParam } from "@/components/workspace";
import { SavedReportsPanel } from "./saved-reports";

export interface ReportInfo { key: string; label: string; module: string }
export function useReportCatalog() { return useQuery({ queryKey: ["reports"], queryFn: () => api<ReportInfo[]>("/api/reports") }); }
const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

/**
 * Catálogo de relatórios (Compactação V2): busca + filtro de módulo + acesso rápido (Todos / ★ Favoritos /
 * Personalizados) numa única área — sem uma aba por módulo. Relatório individual, filtros, exportação, impressão,
 * personalizados e favoritos preservados.
 */
export function ReportsCatalog() {
  const { ctx, can } = useAuth(); const q = useReportCatalog();
  const [s, setS] = useUrlParam("q", ""); const [module, setModule] = useUrlParam("module", ""); const [view, setView] = useUrlParam("view", "todos");
  const favs = React.useMemo(() => new Set((ctx?.favorites ?? []).map((f) => f.route.replace(/^\/relatorios\//, "")).filter((r) => !r.startsWith("/") && !r.includes("?"))), [ctx]);
  const modules = React.useMemo(() => [...new Set((q.data ?? []).map((r) => r.module))].sort((a, b) => a.localeCompare(b)), [q.data]);
  const term = norm(s.trim());
  const all = (q.data ?? []).filter((r) => (!module || r.module === module) && (view !== "favoritos" || favs.has(r.key)) && (!term || norm(r.label).includes(term) || norm(r.module).includes(term)));
  const groups = new Map<string, ReportInfo[]>(); for (const r of all) groups.set(r.module, [...(groups.get(r.module) ?? []), r]);
  return <div className="flex min-h-0 flex-1 flex-col gap-2">
    <div className="mg-card ws-filters no-print">
      <label className="relative w-72 max-w-full"><Search className="absolute left-2 top-1.5 h-3.5 w-3.5 text-slate-400" /><input value={s} onChange={(e) => setS(e.target.value)} placeholder="Buscar relatório…" aria-label="Buscar relatório" data-testid="reports-search" className="h-7 w-full rounded-full bg-[var(--mg-gray-fill)] pl-7 pr-2 text-[12px] focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-300" /></label>
      <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase text-slate-500">Módulo <MgSelect className="!h-7 !rounded-full w-48 text-[12px]" value={module} onChange={setModule} allowEmpty placeholder="Todos" options={modules.map((m) => ({ value: m, label: m }))} /></span>
      <FilterChips label="Acesso rápido" testId="reports-view" value={view} onChange={setView} options={[{ value: "todos", label: "Todos" }, { value: "favoritos", label: "★ Favoritos", count: favs.size || undefined }, ...(can("saved_reports.view") ? [{ value: "personalizados", label: "Personalizados" }] : [])]} />
    </div>
    {view === "personalizados" ? <div className="ws-scroll"><SavedReportsPanel /></div> : <Card className="flex min-h-0 flex-1 flex-col"><CardBody className="ws-scroll">
      <p className="mb-2 text-[11.5px] text-slate-500">{all.length} relatório(s) disponíveis para o seu perfil · filtros, totais, exportação CSV/XLSX e impressão</p>
      {q.isLoading && <Spinner />}
      {!q.isLoading && all.length === 0 && <Empty text={view === "favoritos" ? "Nenhum relatório favorito ainda. Abra um relatório e clique na estrela da barra superior." : "Nenhum relatório encontrado."} />}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">{[...groups.entries()].map(([m, rs]) => <div key={m}><h3 className="mb-1 text-xs font-semibold uppercase text-brand-700">{m} ({rs.length})</h3><ul className="space-y-0.5 text-sm">{rs.map((r) => <li key={r.key} className="flex items-center gap-1">{favs.has(r.key) && <Star className="h-3 w-3 fill-amber-400 text-amber-400" />}<Link className="text-slate-700 hover:text-brand-700 hover:underline" href={`/relatorios/${r.key}`}>{r.label}</Link></li>)}</ul></div>)}</div>
    </CardBody></Card>}
  </div>;
}
