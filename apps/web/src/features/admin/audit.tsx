"use client";
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { api, qs } from "@/lib/api";
import { dateTimeBR } from "@/lib/utils";
import { Card, CardHeader, CardBody, Drawer, StatusBadge } from "@/components/ui";
import { DataTable } from "@/components/ui/data-table";
import { FilterBar, useFilters, type Row } from "@/features/docs/shared";
import { enumLabel } from "@/lib/copy";
export function AuditPanel() {
  const { f, set, reset } = useFilters(); const [applied, setApplied] = React.useState<Record<string, string>>({}); const [page, setPage] = React.useState(1); const [pageSize, setPageSize] = React.useState(50); const [row, setRow] = React.useState<Row | null>(null);
  const q = useQuery({ queryKey: ["audit", applied, page, pageSize], queryFn: () => api<{ items: Row[]; total: number }>(`/api/admin/audit${qs({ ...applied, page, pageSize })}`) });
  return <Card><CardHeader title="Auditoria" subtitle="Trilha imutável de criações, alterações, cancelamentos, logins e ações de fluxo (antes/depois em JSON)." /><CardBody>
    <FilterBar f={f} set={set} reset={() => { reset(); setApplied({}); }} onApply={() => { setApplied({ ...f }); setPage(1); }} filters={[{ name: "entity", label: "Entidade", type: "text" }, { name: "entity_id", label: "Identificador do registro", type: "text" }, { name: "user_id", label: "Usuário", type: "ref", resource: "users" }, { name: "created_at_from", label: "De", type: "date" }, { name: "created_at_to", label: "Até", type: "date" }]} />
    <DataTable rows={q.data?.items ?? []} total={q.data?.total} page={page} pageSize={pageSize} onPage={setPage} onPageSize={setPageSize} loading={q.isLoading} onRowClick={setRow} columns={[{ key: "created_at", label: "Data/hora", render: (r) => dateTimeBR(r["created_at"] as string) }, { key: "user_name", label: "Usuário" }, { key: "entity", label: "Entidade" }, { key: "action", label: "Ação", render: (r) => <StatusBadge domain="audit_action" value={r["action"]} /> }, { key: "entity_id", label: "Registro", className: "font-mono text-[11px]" }, { key: "ip", label: "IP" }]} />
    <Drawer open={Boolean(row)} onOpenChange={() => setRow(null)} title="Detalhe do evento" description={row ? `${enumLabel("audit_action", row["action"])} · ${String(row["entity"] ?? "")} · ${dateTimeBR(row["created_at"] as string)}` : undefined} size="lg">{row && <div className="grid gap-2 text-xs"><div><h4 className="font-semibold">Antes</h4><pre className="max-h-80 overflow-auto rounded bg-slate-50 p-2">{JSON.stringify(row["before"], null, 2) ?? "—"}</pre></div><div><h4 className="font-semibold">Depois / metadados</h4><pre className="max-h-80 overflow-auto rounded bg-slate-50 p-2">{JSON.stringify(row["after"] ?? row["metadata"], null, 2) ?? "—"}</pre></div></div>}</Drawer>
  </CardBody></Card>;
}
