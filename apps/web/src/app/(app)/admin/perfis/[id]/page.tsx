"use client";
import * as React from "react";
import { use } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Button, Card, CardHeader, CardBody, Field, Input, Confirm, Spinner } from "@/components/ui";
import { useAction } from "@/features/docs/actions";
interface PR { key: string; label: string; module: string; actions: { key: string; action: string; label: string }[] }
export default function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params); const isNew = id === "new"; const router = useRouter(); const { can } = useAuth();
  const perms = useQuery({ queryKey: ["permissions"], queryFn: () => api<PR[]>("/api/admin/permissions") });
  const role = useQuery({ queryKey: ["role", id], queryFn: () => api<{ name: string; description: string | null; is_system: boolean; permissions: string[] }>(`/api/admin/roles/${id}`), enabled: !isNew });
  const [name, setName] = React.useState(""); const [desc, setDesc] = React.useState(""); const [sel, setSel] = React.useState<Set<string>>(new Set()); const [del, setDel] = React.useState(false); const [s, setS] = React.useState("");
  React.useEffect(() => { if (role.data) { setName(role.data.name); setDesc(role.data.description ?? ""); setSel(new Set(role.data.permissions)); } }, [role.data]);
  const act = useAction(() => router.push("/configuracoes?tab=usuarios&sub=perfis"));
  const toggle = (k: string) => { const n = new Set(sel); if (n.has(k)) n.delete(k); else n.add(k); setSel(n); };
  const toggleRes = (r: PR) => { const all = r.actions.every((a) => sel.has(a.key)); const n = new Set(sel); for (const a of r.actions) { if (all) n.delete(a.key); else n.add(a.key); } setSel(n); };
  const modules = new Map<string, PR[]>(); for (const r of perms.data ?? []) if (!s || r.label.toLowerCase().includes(s.toLowerCase())) modules.set(r.module, [...(modules.get(r.module) ?? []), r]);
  const readOnly = role.data?.is_system || !(isNew ? can("roles.create") : can("roles.edit"));
  return <Card><CardHeader title={isNew ? "Novo perfil" : `Perfil: ${role.data?.name ?? ""}`} subtitle={`${sel.size} permissão(ões) selecionada(s)${role.data?.is_system ? " · perfil de sistema (permissões fixas)" : ""}`} actions={<><Button variant="outline" size="sm" onClick={() => router.push("/configuracoes?tab=usuarios&sub=perfis")}>Voltar</Button>{!readOnly && <Button size="sm" loading={act.isPending} disabled={!name} onClick={() => act.mutate({ path: isNew ? "/api/admin/roles" : `/api/admin/roles/${id}`, method: isNew ? "POST" : "PUT", body: { name, description: desc || null, permissions: [...sel] } })}>Salvar</Button>}{!isNew && !role.data?.is_system && can("roles.delete") && <Button size="sm" variant="danger" onClick={() => setDel(true)}>Excluir</Button>}</>} /><CardBody className="space-y-3">
    <div className="grid grid-cols-12 gap-2"><Field label="Nome" required span={4}><Input value={name} onChange={(e) => setName(e.target.value)} disabled={readOnly && !role.data?.is_system} /></Field><Field label="Descrição" span={5}><Input value={desc} onChange={(e) => setDesc(e.target.value)} /></Field><Field label="Filtrar recurso" span={3}><Input value={s} onChange={(e) => setS(e.target.value)} placeholder="ex.: títulos" /></Field></div>
    {perms.isLoading && <Spinner />}
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{[...modules.entries()].map(([m, rs]) => <div key={m} className="rounded border"><div className="border-b bg-slate-50 px-2 py-1 text-xs font-semibold uppercase text-brand-700">{m}</div><div className="divide-y">{rs.map((r) => <div key={r.key} className="px-2 py-1 text-[12px]"><label className="flex items-center gap-1 font-medium"><input type="checkbox" disabled={readOnly} checked={r.actions.every((a) => sel.has(a.key))} ref={(el) => { if (el) el.indeterminate = !r.actions.every((a) => sel.has(a.key)) && r.actions.some((a) => sel.has(a.key)); }} onChange={() => toggleRes(r)} /> {r.label}</label><div className="ml-4 flex flex-wrap gap-x-3 gap-y-0.5 text-slate-600">{r.actions.map((a) => <label key={a.key} className="flex items-center gap-1"><input type="checkbox" disabled={readOnly} checked={sel.has(a.key)} onChange={() => toggle(a.key)} /> {a.label}</label>)}</div></div>)}</div></div>)}</div>
    <Confirm open={del} onOpenChange={setDel} title="Excluir perfil" text="Perfis com usuários vinculados não podem ser excluídos." danger loading={act.isPending} onConfirm={() => act.mutate({ path: `/api/admin/roles/${id}`, method: "DELETE" })} />
  </CardBody></Card>;
}
