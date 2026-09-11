"use client";
import * as React from "react";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "@/lib/toast";
import { Plus, Share2, Lock } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { dateTimeBR } from "@/lib/utils";
import { Button, Card, CardHeader, CardBody, Spinner, ErrorBox, Badge, Confirm, Empty } from "@/components/ui";

interface Saved { id: string; resource_key: string; resource_label: string; name: string; is_shared: boolean; mine: boolean; owner_name: string | null; updated_at: string }

/** Relatórios personalizados salvos (meus e compartilhados), agrupados por entidade. */
export default function Page() {
  const { can } = useAuth(); const qc = useQueryClient();
  const q = useQuery({ queryKey: ["saved-reports"], queryFn: () => api<{ items: Saved[] }>("/api/saved-reports") });
  const [del, setDel] = React.useState<Saved | null>(null);
  const remove = useMutation({ mutationFn: (id: string) => api(`/api/saved-reports/${id}`, { method: "DELETE" }), onSuccess: () => { toast.success("Relatório excluído"); setDel(null); void qc.invalidateQueries({ queryKey: ["saved-reports"] }); }, onError: (e) => toast.error((e as Error).message) });
  const groups = new Map<string, Saved[]>(); for (const s of q.data?.items ?? []) groups.set(s.resource_label, [...(groups.get(s.resource_label) ?? []), s]);
  return <Card>
    <CardHeader title="Relatórios personalizados" subtitle="Monte relatórios por entidade escolhendo colunas, filtros, agrupamento e totais; salve para você ou compartilhe com a organização" actions={<><Link href="/relatorios"><Button size="sm" variant="outline">Relatórios padrão</Button></Link>{can("saved_reports.create") && <Link href="/relatorios/personalizados/novo"><Button size="sm"><Plus className="h-3.5 w-3.5" /> Novo relatório</Button></Link>}</>} />
    <CardBody>
      {q.isLoading && <Spinner />}{q.error && <ErrorBox error={q.error} />}
      {q.data && q.data.items.length === 0 && <Empty text="Nenhum relatório salvo ainda. Clique em “Novo relatório” ou use o botão “Relatório” em qualquer listagem de cadastro." />}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">{[...groups.entries()].map(([label, items]) => <div key={label}><h3 className="mb-1 text-xs font-semibold uppercase text-brand-700">{label} ({items.length})</h3>
        <ul className="divide-y rounded border text-[13px]">{items.map((s) => <li key={s.id} className="flex items-center gap-2 px-2 py-1.5"><Link href={`/relatorios/personalizados/novo?id=${s.id}`} className="flex-1 truncate hover:underline">{s.name}</Link>{s.is_shared ? <Badge tone="violet"><Share2 className="mr-0.5 inline h-3 w-3" />compartilhado</Badge> : <Badge><Lock className="mr-0.5 inline h-3 w-3" />privado</Badge>}<span className="hidden text-[11px] text-slate-400 md:inline" title={dateTimeBR(s.updated_at)}>{s.mine ? "meu" : s.owner_name ?? ""}</span>{(s.mine || can("saved_reports.delete")) && <button type="button" className="text-[11px] text-red-600 hover:underline" onClick={() => setDel(s)}>excluir</button>}</li>)}</ul></div>)}</div>
      <Confirm open={Boolean(del)} onOpenChange={() => setDel(null)} title="Excluir relatório" text={`Excluir o relatório "${del?.name}"?`} danger loading={remove.isPending} onConfirm={() => del && remove.mutate(del.id)} />
    </CardBody>
  </Card>;
}
