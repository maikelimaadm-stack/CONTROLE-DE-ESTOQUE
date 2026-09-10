"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { getResource, type FieldDef } from "@agro/domain";
import { api, qs, download } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { brl, num, dateBR, cn } from "@/lib/utils";
import { Button, Card, CardHeader, CardBody, Input, NativeSelect, Field, Menu, Confirm, Badge } from "@/components/ui";
import { DataTable, type Column } from "@/components/ui/data-table";
import { RefSelect } from "@/components/ui/ref-select";
import { MoreVertical, Plus } from "lucide-react";

export function formatCell(f: FieldDef, row: Record<string, unknown>) {
  const v = row[f.name];
  if (f.type === "ref") return (row[`${f.name}_label`] as string) ?? "";
  if (v === null || v === undefined || v === "") return "";
  switch (f.type) {
    case "money": return brl(v as string);
    case "quantity": case "number": return num(v as string, 2);
    case "percent": return num(v as string, 2) + "%";
    case "date": return dateBR(v as string);
    case "boolean": return v ? <Badge tone="green">Sim</Badge> : <Badge>Não</Badge>;
    case "select": return f.options?.find((o) => o.value === String(v))?.label ?? String(v);
    case "tags": return (v as string[]).map((t) => f.options?.find((o) => o.value === t)?.label ?? t).join(", ");
    case "json": return <span className="text-slate-400">{"{…}"}</span>;
    default: return String(v);
  }
}

export function ResourceList({ resourceKey, title, fixedFilters, extraActions, basePath }: { resourceKey: string; title?: string; fixedFilters?: Record<string, string>; extraActions?: React.ReactNode; basePath?: string }) {
  const def = getResource(resourceKey); const router = useRouter(); const sp = useSearchParams(); const qc = useQueryClient(); const { can } = useAuth();
  const [page, setPage] = React.useState(1); const [pageSize, setPageSize] = React.useState(20);
  const [search, setSearch] = React.useState(""); const [filters, setFilters] = React.useState<Record<string, string>>({});
  const [sort, setSort] = React.useState<{ key: string; dir: "asc" | "desc" } | undefined>();
  const [del, setDel] = React.useState<string | null>(null);
  React.useEffect(() => { const f: Record<string, string> = {}; sp.forEach((v, k) => { f[k] = v; }); setFilters((o) => ({ ...o, ...f })); }, [sp]);
  if (!def) return <div>Recurso desconhecido</div>;
  const base = basePath ?? `/cadastros/${resourceKey}`;
  const all = { ...filters, ...(fixedFilters ?? {}) };
  const params = { page, pageSize, search, sort: sort?.key, dir: sort?.dir, ...all };
  const q = useQuery({ queryKey: ["res", resourceKey, params], queryFn: () => api<{ items: Record<string, unknown>[]; total: number }>(`/api/resources/${resourceKey}${qs(params)}`) });
  const remove = useMutation({ mutationFn: (id: string) => api(`/api/resources/${resourceKey}/${id}`, { method: "DELETE" }), onSuccess: () => { toast.success("Registro excluído"); setDel(null); void qc.invalidateQueries({ queryKey: ["res", resourceKey] }); }, onError: (e) => toast.error((e as Error).message) });
  const listFields = def.fields.filter((f) => f.list);
  const filterFields = def.fields.filter((f) => f.filter && !(fixedFilters && f.name in fixedFilters));
  const columns: Column<Record<string, unknown>>[] = listFields.map((f) => ({ key: f.name, label: f.label, sortable: f.type !== "ref" && f.type !== "json", align: ["money", "quantity", "number", "percent", "integer"].includes(f.type) ? "right" : "left", render: (r) => formatCell(f, r) }));
  const perm = def.permission;
  return (
    <Card>
      <CardHeader title={title ?? def.labelPlural} actions={<>{extraActions}{def.importExport && can(`${perm}.export`) && <Button variant="outline" size="sm" onClick={() => download(`/api/exports/${resourceKey}${qs({ ...all, format: "xlsx" })}`, `${resourceKey}.xlsx`)}>Exportar</Button>}{can(`${perm}.create`) && <Link href={`${base}/new${qs(fixedFilters ?? {})}`}><Button size="sm"><Plus className="h-3.5 w-3.5" /> Adicionar Novo</Button></Link>}</>} />
      <CardBody>
        <form className="mb-3 grid grid-cols-12 gap-2 no-print" onSubmit={(e) => { e.preventDefault(); setPage(1); void q.refetch(); }}>
          {def.fields.some((f) => f.search) && <Field label={`Pesquisar por ${def.fields.filter((f) => f.search).map((f) => f.label.toLowerCase()).slice(0, 3).join("/")}`} span={3}><Input value={search} onChange={(e) => setSearch(e.target.value)} /></Field>}
          {filterFields.map((f) => <Field key={f.name} label={f.label} span={2}>
            {f.type === "ref" ? <RefSelect resource={f.ref!.resource} value={filters[f.name] ?? null} onChange={(v) => setFilters((o) => ({ ...o, [f.name]: v ?? "" }))} placeholder="Todos" /> :
             f.type === "boolean" ? <NativeSelect value={filters[f.name] ?? ""} onChange={(e) => setFilters((o) => ({ ...o, [f.name]: e.target.value }))}><option value="">Todos</option><option value="true">Sim</option><option value="false">Não</option></NativeSelect> :
             f.type === "select" ? <NativeSelect value={filters[f.name] ?? ""} onChange={(e) => setFilters((o) => ({ ...o, [f.name]: e.target.value }))}><option value="">Todos</option>{f.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</NativeSelect> :
             f.type === "date" ? <div className="flex gap-1"><Input type="date" value={filters[`${f.name}_from`] ?? ""} onChange={(e) => setFilters((o) => ({ ...o, [`${f.name}_from`]: e.target.value }))} /><Input type="date" value={filters[`${f.name}_to`] ?? ""} onChange={(e) => setFilters((o) => ({ ...o, [`${f.name}_to`]: e.target.value }))} /></div> :
             <Input value={filters[f.name] ?? ""} onChange={(e) => setFilters((o) => ({ ...o, [f.name]: e.target.value }))} />}
          </Field>)}
          <div className="col-span-12 flex items-end gap-2 md:col-span-2"><Button type="submit" size="sm">Filtrar</Button><Button type="button" size="sm" variant="secondary" onClick={() => { setSearch(""); setFilters({}); setPage(1); router.replace(base); }}>Limpar</Button></div>
        </form>
        <DataTable columns={columns} rows={q.data?.items ?? []} total={q.data?.total} page={page} pageSize={pageSize} onPage={setPage} onPageSize={(s) => { setPageSize(s); setPage(1); }} sort={sort} onSort={(k) => setSort((s) => ({ key: k, dir: s?.key === k && s.dir === "asc" ? "desc" : "asc" }))} loading={q.isLoading} onRowClick={(r) => router.push(`${base}/${r["id"]}`)}
          actions={(r) => <Menu trigger={<button className="rounded p-1 hover:bg-slate-100"><MoreVertical className="h-4 w-4" /></button>} items={[{ label: "Visualizar", href: `${base}/${r["id"]}?view=1` }, ...(can(`${perm}.edit`) ? [{ label: "Editar", href: `${base}/${r["id"]}` }] : []), ...(can(`${perm}.delete`) ? [{ label: "Excluir", danger: true, onClick: () => setDel(String(r["id"])) }] : [])]} />} />
        <Confirm open={Boolean(del)} onOpenChange={() => setDel(null)} title="Confirme a exclusão" text={`Excluir este registro de ${def.label.toLowerCase()}? A ação fica registrada na auditoria.`} danger loading={remove.isPending} onConfirm={() => del && remove.mutate(del)} />
      </CardBody>
    </Card>
  );
}
export const _cn = cn;
