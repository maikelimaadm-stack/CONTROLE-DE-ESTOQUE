"use client";
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { History } from "lucide-react";
import { api, qs } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { dateTimeBR } from "@/lib/utils";
import { Dialog, LoadingState, EmptyState, StatusBadge } from "@/components/ui";

interface Audit { id: number; action: string; created_at: string; user_name: string | null; before: Record<string, unknown> | null; after: Record<string, unknown> | null; entity_id: string }

/** "Histórico": trilha de auditoria da entidade (registro selecionado ou os últimos eventos da tela). */
export function HistoryDialog({ open, onOpenChange, entity, entityId, title }: { open: boolean; onOpenChange: (o: boolean) => void; entity: string; entityId?: string; title: string }) {
  const { can } = useAuth();
  const q = useQuery({ queryKey: ["b1-hist", entity, entityId, open], queryFn: () => api<{ items: Audit[] }>(`/api/admin/audit${qs({ entity, entity_id: entityId, pageSize: 50 })}`), enabled: open && can("audit_logs.view") });
  const diff = (a: Audit) => { if (!a.before || !a.after) return []; return Object.keys(a.after).filter((k) => JSON.stringify(a.before![k]) !== JSON.stringify(a.after![k]) && k !== "updated_at").slice(0, 8); };
  return <Dialog open={open} onOpenChange={onOpenChange} title={`Histórico — ${title}`} size="lg">
    {!can("audit_logs.view") ? <div className="text-sm text-slate-500">Você não tem permissão para ver o histórico (auditoria).</div>
      : q.isLoading ? <LoadingState /> : !q.data?.items.length ? <EmptyState icon={<History className="h-4 w-4" />} title={`Nenhum evento registrado${entityId ? " para este registro" : ""}.`} />
        : <ol className="space-y-2 text-[12.5px]">{q.data.items.map((a) => <li key={a.id} className="rounded-lg border p-2">
          <div className="flex flex-wrap items-center gap-2"><StatusBadge domain="audit_action" value={a.action} /><span className="font-medium">{a.user_name ?? "sistema"}</span><span className="text-slate-500">{dateTimeBR(a.created_at)}</span>{!entityId && <span className="ml-auto font-mono text-[10px] text-slate-400">{a.entity_id.slice(0, 8)}</span>}</div>
          {diff(a).length > 0 && <ul className="mt-1 grid gap-0.5 text-[11.5px] text-slate-600 md:grid-cols-2">{diff(a).map((k) => <li key={k}><span className="font-medium">{k}</span>: <span className="line-through text-slate-400">{String(a.before![k] ?? "–")}</span> → {String(a.after![k] ?? "–")}</li>)}</ul>}
        </li>)}</ol>}
  </Dialog>;
}
