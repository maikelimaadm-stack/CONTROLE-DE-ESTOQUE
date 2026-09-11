"use client";
import * as React from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Star } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Card, CardHeader, CardBody, Input, Spinner, Empty } from "@/components/ui";

export interface ReportInfo { key: string; label: string; module: string }
export function useReportCatalog() { return useQuery({ queryKey: ["reports"], queryFn: () => api<ReportInfo[]>("/api/reports") }); }

/**
 * Catálogo de relatórios (antes: /relatorios com todos os módulos numa grade). `module` filtra por módulo;
 * `favoritesOnly` mostra os relatórios marcados como favoritos (estrela da barra superior).
 */
export function ReportsCatalog({ module, favoritesOnly }: { module?: string; favoritesOnly?: boolean } = {}) {
  const { ctx } = useAuth(); const q = useReportCatalog(); const [s, setS] = React.useState("");
  const favs = React.useMemo(() => new Set((ctx?.favorites ?? []).map((f) => f.route.replace(/^\/relatorios\//, "")).filter((r) => !r.startsWith("/") && !r.includes("?"))), [ctx]);
  const all = (q.data ?? []).filter((r) => (!module || r.module === module) && (!favoritesOnly || favs.has(r.key)) && (!s || r.label.toLowerCase().includes(s.toLowerCase())));
  const groups = new Map<string, ReportInfo[]>(); for (const r of all) groups.set(r.module, [...(groups.get(r.module) ?? []), r]);
  return <Card className="flex min-h-0 flex-1 flex-col"><CardHeader title={favoritesOnly ? "Relatórios favoritos" : module ? `Relatórios — ${module}` : "Todos os relatórios"} subtitle={`${all.length} relatórios disponíveis para o seu perfil · filtros, totais, exportação CSV/XLSX e impressão`} actions={<Input placeholder="Buscar relatório…" value={s} onChange={(e) => setS(e.target.value)} className="w-64" />} /><CardBody className="ws-scroll">
    {q.isLoading && <Spinner />}
    {!q.isLoading && all.length === 0 && <Empty text={favoritesOnly ? "Nenhum relatório favorito ainda. Abra um relatório e clique na estrela da barra superior." : "Nenhum relatório encontrado."} />}
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">{[...groups.entries()].map(([m, rs]) => <div key={m}><h3 className="mb-1 text-xs font-semibold uppercase text-brand-700">{m} ({rs.length})</h3><ul className="space-y-0.5 text-sm">{rs.map((r) => <li key={r.key} className="flex items-center gap-1">{favs.has(r.key) && <Star className="h-3 w-3 fill-amber-400 text-amber-400" />}<Link className="text-slate-700 hover:text-brand-700 hover:underline" href={`/relatorios/${r.key}`}>{r.label}</Link></li>)}</ul></div>)}</div>
  </CardBody></Card>;
}
