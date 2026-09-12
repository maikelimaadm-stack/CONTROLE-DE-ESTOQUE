"use client";
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { api, qs } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { dateTimeBR } from "@/lib/utils";
import { Badge, Button, Card, CardHeader, CardBody, Dialog, Field, Input, NativeSelect } from "@/components/ui";
import { DataTable } from "@/components/ui/data-table";
import { type Row } from "@/features/docs/shared";
import { useAction } from "@/features/docs/actions";
import { COPY } from "@/lib/copy";
interface Form { name: string; email: string; phone: string; password: string; role_id: string; farm_ids: string[]; is_active: boolean; boss_user_ids: string[] }
const blank: Form = { name: "", email: "", phone: "", password: "", role_id: "", farm_ids: [], is_active: true, boss_user_ids: [] };
export function UsersPanel() {
  const { can, ctx } = useAuth(); const [search, setSearch] = React.useState(""); const [page, setPage] = React.useState(1); const [edit, setEdit] = React.useState<{ id?: string; f: Form } | null>(null);
  const q = useQuery({ queryKey: ["members", search, page], queryFn: () => api<{ items: Row[]; total: number }>(`/api/admin/members${qs({ search, page, pageSize: 20 })}`) });
  const roles = useQuery({ queryKey: ["roles"], queryFn: () => api<{ items: Row[] }>("/api/admin/roles") });
  const act = useAction(() => setEdit(null));
  const save = () => { if (!edit) return; const b: Record<string, unknown> = { ...edit.f, phone: edit.f.phone || null, role_id: edit.f.role_id || null }; if (!edit.f.password) delete b["password"]; if (edit.id) delete b["email"]; act.mutate({ path: edit.id ? `/api/admin/members/${edit.id}` : "/api/admin/members", method: edit.id ? "PUT" : "POST", body: b }); };
  return <Card><CardHeader title="Usuários da Organização" subtitle="Vínculo usuário × perfil × fazendas permitidas. Sem fazendas selecionadas = acesso a todas." actions={<><Input placeholder="Pesquisar por nome ou e-mail" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} className="w-56" />{can("users.create") && <Button size="sm" onClick={() => setEdit({ f: blank })}>Novo usuário</Button>}</>} /><CardBody>
    <DataTable rows={q.data?.items ?? []} total={q.data?.total} page={page} pageSize={20} onPage={setPage} loading={q.isLoading} onRowClick={(r) => can("users.edit") && setEdit({ id: String(r["id"]), f: { ...blank, name: String(r["name"]), email: String(r["email"]), phone: String(r["phone"] ?? ""), role_id: String(r["role_id"] ?? ""), farm_ids: (r["farm_ids"] as string[] | null) ?? [], is_active: Boolean(r["is_active"]) } })}
      columns={[{ key: "name", label: "Nome" }, { key: "email", label: "E-mail" }, { key: "phone", label: "Telefone" }, { key: "role_name", label: "Perfil", render: (r) => r["is_owner"] ? <Badge tone="violet">Proprietário</Badge> : String(r["role_name"] ?? "—") }, { key: "farm_ids", label: "Fazendas", render: (r) => { const ids = (r["farm_ids"] as string[] | null) ?? []; return ids.length ? ids.map((i) => ctx?.farms.find((f) => f.id === i)?.name ?? "?").join(", ") : "Todas"; } }, { key: "is_active", label: COPY.situacao, render: (r) => <Badge tone={r["is_active"] ? "green" : "red"}>{r["is_active"] ? "Ativo" : "Inativo"}</Badge> }, { key: "last_login_at", label: "Último acesso", render: (r) => r["last_login_at"] ? dateTimeBR(r["last_login_at"] as string) : "—" }]} />
    <Dialog open={Boolean(edit)} onOpenChange={() => setEdit(null)} title={edit?.id ? "Editar usuário" : "Novo usuário"} footer={<Button size="sm" loading={act.isPending} disabled={!edit?.f.name || !edit?.f.email || (!edit?.id && (edit?.f.password.length ?? 0) < 8)} onClick={save}>Salvar</Button>}>
      {edit && <div className="grid grid-cols-12 gap-2">
        <Field label="Nome" required span={6}><Input value={edit.f.name} onChange={(e) => setEdit({ ...edit, f: { ...edit.f, name: e.target.value } })} /></Field><Field label="E-mail" required span={6}><Input type="email" value={edit.f.email} disabled={Boolean(edit.id)} onChange={(e) => setEdit({ ...edit, f: { ...edit.f, email: e.target.value } })} /></Field>
        <Field label="Telefone" span={4}><Input value={edit.f.phone} onChange={(e) => setEdit({ ...edit, f: { ...edit.f, phone: e.target.value } })} /></Field><Field label={edit.id ? "Nova senha (opcional)" : "Senha (mín. 8)"} required={!edit.id} span={4}><Input type="password" value={edit.f.password} onChange={(e) => setEdit({ ...edit, f: { ...edit.f, password: e.target.value } })} /></Field><Field label="Situação" span={4}><NativeSelect value={edit.f.is_active ? "1" : "0"} onChange={(e) => setEdit({ ...edit, f: { ...edit.f, is_active: e.target.value === "1" } })}><option value="1">Ativo</option><option value="0">Inativo</option></NativeSelect></Field>
        <Field label="Perfil" span={12}><NativeSelect value={edit.f.role_id} onChange={(e) => setEdit({ ...edit, f: { ...edit.f, role_id: e.target.value } })}><option value="">Sem perfil (sem permissões)</option>{roles.data?.items.map((r) => <option key={String(r["id"])} value={String(r["id"])}>{String(r["name"])}</option>)}</NativeSelect></Field>
        <Field label="Fazendas permitidas (vazio = todas)" span={12}><div className="flex flex-wrap gap-2">{ctx?.farms.map((f) => <label key={f.id} className="flex items-center gap-1 rounded border px-2 py-1 text-xs"><input type="checkbox" checked={edit.f.farm_ids.includes(f.id)} onChange={(e) => setEdit({ ...edit, f: { ...edit.f, farm_ids: e.target.checked ? [...edit.f.farm_ids, f.id] : edit.f.farm_ids.filter((x) => x !== f.id) } })} />{f.name}</label>)}</div></Field>
      </div>}
    </Dialog>
  </CardBody></Card>;
}
