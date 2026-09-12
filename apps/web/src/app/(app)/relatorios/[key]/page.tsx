"use client";
import * as React from "react";
import { use } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, qs, download } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { brl, num, dateBR, pct } from "@/lib/utils";
import { Button, Card, CardHeader, CardBody, LoadingState, ErrorState } from "@/components/ui";
import { DataTable } from "@/components/ui/data-table";
import { FilterBar, useFilters, monthRange, type Filter, type Row } from "@/features/docs/shared";
interface Col { key: string; label: string; type?: "money" | "qty" | "date" | "percent" | "int" | "text" }
interface Def { key: string; label: string; module: string; filters: (Filter & { options?: unknown; required?: boolean })[] }
interface Result { label: string; columns: Col[]; rows: Row[]; totals: Record<string, string>; count: number }
export default function Page({ params }: { params: Promise<{ key: string }> }) {
  const { key } = use(params); const { can } = useAuth();
  const defs = useQuery({ queryKey: ["reports"], queryFn: () => api<Def[]>("/api/reports") }); const def = defs.data?.find((d) => d.key === key);
  const filters: Filter[] = (def?.filters ?? []).map((f) => ({ name: f.name, label: f.label, type: f.type, resource: f.resource, options: Array.isArray(f.options) ? (f.options as unknown[]).map((o) => (typeof o === "string" ? { value: o, label: o } : (o as { value: string; label: string }))) : undefined }));
  const hasDates = filters.some((f) => f.name === "start_date"); const init = React.useMemo(() => (hasDates ? monthRange() : {}), [hasDates]);
  const { f, set, reset } = useFilters(init); const [applied, setApplied] = React.useState<Record<string, string> | null>(null);
  React.useEffect(() => { if (def && !applied && !def.filters.some((x) => x.required)) setApplied(init); }, [def, applied, init]);
  const q = useQuery({ queryKey: ["report", key, applied], queryFn: () => api<Result>(`/api/reports/${key}${qs(applied!)}`), enabled: Boolean(applied) });
  const fmt = (c: Col, v: unknown) => v == null || v === "" ? "" : c.type === "money" ? brl(v as string) : c.type === "qty" ? num(v as string, 3) : c.type === "date" ? dateBR(String(v)) : c.type === "percent" ? pct(v as string, 2) : String(v);
  const [page, setPage] = React.useState(1); const [pageSize, setPageSize] = React.useState(50);
  const rows = q.data?.rows.slice((page - 1) * pageSize, page * pageSize) ?? [];
  return <Card><CardHeader title={def?.label ?? "Relatório"} subtitle={def ? `Módulo ${def.module} · ${q.data ? `${q.data.count} linha(s)` : ""}` : undefined} actions={<><Button size="sm" variant="outline" onClick={() => window.print()}>Imprimir</Button>{applied && def && can(`report.${key}.export`) && <><Button size="sm" variant="outline" onClick={() => download(`/api/reports/${key}${qs({ ...applied, format: "csv" })}`, `${key}.csv`)}>CSV</Button><Button size="sm" variant="outline" onClick={() => download(`/api/reports/${key}${qs({ ...applied, format: "xlsx" })}`, `${key}.xlsx`)}>XLSX</Button></>}</>} /><CardBody>
    {defs.isLoading && <LoadingState />}{defs.data && !def && <ErrorState message="Relatório não encontrado ou sem permissão." variant="block" />}
    {def && <FilterBar filters={filters} f={f} set={set} reset={() => { reset(); setApplied(null); }} onApply={() => { setApplied({ ...f }); setPage(1); }} />}
    {q.error && <ErrorState error={q.error} onRetry={() => void q.refetch()} />}
    {q.data && <DataTable rows={rows} total={q.data.count} page={page} pageSize={pageSize} onPage={setPage} onPageSize={setPageSize} loading={q.isFetching} rowKey={(r) => String(r["id"] ?? JSON.stringify(r))} columns={q.data.columns.map((c) => ({ key: c.key, label: c.label, align: c.type === "money" || c.type === "qty" || c.type === "percent" || c.type === "int" ? "right" as const : undefined, render: (r: Row) => fmt(c, r[c.key]) }))}
      footer={Object.keys(q.data.totals).length > 0 ? <tr>{q.data.columns.map((c, i) => <td key={c.key} className={i === 0 ? "px-2 py-1" : "num"}>{i === 0 ? "Totais" : q.data!.totals[c.key] !== undefined ? fmt({ ...c, type: c.type ?? "money" }, q.data!.totals[c.key]) : ""}</td>)}</tr> : undefined} />}
  </CardBody></Card>;
}
