"use client";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { dateTimeBR } from "@/lib/utils";
import { Badge, Button, Card, CardHeader, CardBody, Spinner } from "@/components/ui";
import { useAction } from "@/features/docs/actions";
import { type Row } from "@/features/docs/shared";
const KIND: Record<string, string> = { purchase_pending: "Compras pendentes", stock_min: "Estoque mínimo", title_due: "Títulos a vencer", birthday: "Aniversário", document_expiring: "Documento vencendo" };
export default function Page() {
  const { refresh } = useAuth(); const q = useQuery({ queryKey: ["notifications"], queryFn: () => api<{ items: Row[] }>("/api/admin/notifications") }); const act = useAction(() => { void q.refetch(); void refresh(); });
  return <Card><CardHeader title="Notificações" subtitle="Geradas a partir de regras do sistema (compras paradas, estoque mínimo, vencimentos, aniversários, documentos)." actions={<><Button size="sm" variant="outline" loading={act.isPending} onClick={() => act.mutate({ path: "/api/admin/notifications/refresh" })}>Atualizar alertas</Button><Button size="sm" variant="outline" onClick={() => act.mutate({ path: "/api/admin/notifications/read-all" })}>Marcar todas como lidas</Button></>} /><CardBody>
    {q.isLoading ? <Spinner /> : <ul className="divide-y">{q.data?.items.map((n) => <li key={String(n["id"])} className={`flex items-center gap-3 py-2 text-sm ${n["read_at"] ? "text-slate-400" : ""}`}><Badge tone={n["read_at"] ? "slate" : "amber"}>{KIND[String(n["kind"])] ?? String(n["kind"])}</Badge><span className="flex-1">{n["route"] ? <Link className="hover:underline" href={String(n["route"])} onClick={() => act.mutate({ path: `/api/admin/notifications/${n["id"]}/read` })}>{String(n["title"])}</Link> : String(n["title"])}</span><span className="text-xs">{dateTimeBR(n["created_at"] as string)}</span>{!n["read_at"] && <Button size="sm" variant="ghost" onClick={() => act.mutate({ path: `/api/admin/notifications/${n["id"]}/read` })}>Lida</Button>}</li>)}{q.data?.items.length === 0 && <li className="py-6 text-center text-slate-400">Nenhuma notificação.</li>}</ul>}
  </CardBody></Card>;
}
