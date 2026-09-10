"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { getResource, type FieldDef } from "@agro/domain";
import { filterKindOf } from "@agro/shared";
import { api, qs, download } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { brl, num, dateBR, cn } from "@/lib/utils";
import { Button, Card, CardHeader, CardBody, Menu, Confirm, Badge } from "@/components/ui";
import { DataTable, type Column } from "@/components/ui/data-table";
import { MoreVertical, Plus, FileBarChart } from "lucide-react";
import { useListPrefs, applyListColumns, type ListFilterInfo } from "@/features/listing/list-prefs";
import { ListSettingsDialog, ListSettingsButton } from "@/features/listing/list-settings";
import { CardsView } from "@/features/listing/cards-view";
import { AdvancedFilterBar, toQueryParams, fromQueryParams, type AdvancedFilterField, type FilterValues } from "@/features/listing/advanced-filters";

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

/**
 * Listagem genérica de cadastros ("modelo base"): colunas, filtros com operadores, filtros salvos, cards e
 * paginação configuráveis pelo usuário (preferências por módulo, com padrão da organização).
 */
export function ResourceList({ resourceKey, title, fixedFilters, extraActions, basePath }: { resourceKey: string; title?: string; fixedFilters?: Record<string, string>; extraActions?: React.ReactNode; basePath?: string }) {
  const def = getResource(resourceKey); const router = useRouter(); const sp = useSearchParams(); const qc = useQueryClient(); const { can } = useAuth();
  const fields = React.useMemo(() => def?.fields ?? [], [def]);
  const listFields = React.useMemo(() => fields.filter((f) => f.list), [fields]);
  const filterFields = React.useMemo<AdvancedFilterField[]>(() => fields.filter((f) => f.filter && !(fixedFilters && f.name in fixedFilters)).map((f) => ({ key: f.name, label: f.label, kind: filterKindOf(f.type), resource: f.ref?.resource, options: f.options })), [fields, fixedFilters]);
  const colInfo = React.useMemo(() => listFields.map((f) => ({ key: f.name, label: f.label })), [listFields]);
  const filterInfo = React.useMemo<ListFilterInfo[]>(() => filterFields.map((f) => ({ key: f.key, label: f.label, kind: f.kind })), [filterFields]);
  const p = useListPrefs(resourceKey, colInfo, filterInfo);
  const [page, setPage] = React.useState(1); const [pageSize, setPageSize] = React.useState<number | undefined>();
  const [search, setSearch] = React.useState(""); const [values, setValues] = React.useState<FilterValues>({});
  const [applied, setApplied] = React.useState<{ search: string; params: Record<string, string> }>({ search: "", params: {} });
  const [sort, setSort] = React.useState<{ key: string; dir: "asc" | "desc" } | undefined>();
  const [del, setDel] = React.useState<string | null>(null); const [settings, setSettings] = React.useState(false);
  // parâmetros de URL (ex.: menu "Fornecedores" = people?is_provider=true): viram filtros aplicados e valores iniciais
  React.useEffect(() => { const urlParams: Record<string, string> = {}; sp.forEach((v, k) => { if (k !== "view") urlParams[k] = v; }); if (Object.keys(urlParams).length) { setValues((o) => ({ ...o, ...fromQueryParams(filterFields, urlParams, p.prefs.filters.operators) })); setApplied((a) => ({ ...a, params: { ...a.params, ...urlParams } })); } }, [sp]);
  if (!def) return <div>Recurso desconhecido</div>;
  const base = basePath ?? `/cadastros/${resourceKey}`;
  const effPageSize = pageSize ?? p.prefs.pageSize ?? 20;
  const effSort = sort ?? p.prefs.sort;
  const all = { ...applied.params, ...(fixedFilters ?? {}) };
  const params = { page, pageSize: effPageSize, search: applied.search, sort: effSort?.key, dir: effSort?.dir, ...all };
  const q = useQuery({ queryKey: ["res", resourceKey, params], queryFn: () => api<{ items: Record<string, unknown>[]; total: number }>(`/api/resources/${resourceKey}${qs(params)}`) });
  const remove = useMutation({ mutationFn: (id: string) => api(`/api/resources/${resourceKey}/${id}`, { method: "DELETE" }), onSuccess: () => { toast.success("Registro excluído"); setDel(null); void qc.invalidateQueries({ queryKey: ["res", resourceKey] }); }, onError: (e) => toast.error((e as Error).message) });
  const baseColumns: Column<Record<string, unknown>>[] = listFields.map((f) => ({ key: f.name, label: f.label, sortable: f.type !== "ref" && f.type !== "json", align: ["money", "quantity", "number", "percent", "integer"].includes(f.type) ? "right" : "left", render: (r) => formatCell(f, r) }));
  const columns = applyListColumns(baseColumns, p.prefs);
  const perm = def.permission;
  const apply = () => { setApplied({ search, params: toQueryParams(filterFields, values) }); setPage(1); };
  const clear = () => { setSearch(""); setValues({}); setApplied({ search: "", params: {} }); setPage(1); router.replace(base); };
  const onSort = (k: string) => { const next = { key: k, dir: (effSort?.key === k && effSort.dir === "asc" ? "desc" : "asc") as "asc" | "desc" }; setSort(next); p.update((x) => ({ ...x, sort: next })); };
  const onPageSize = (s: number) => { setPageSize(s); setPage(1); p.update((x) => ({ ...x, pageSize: s })); };
  const rowActions = (r: Record<string, unknown>) => <Menu trigger={<button className="rounded p-1 hover:bg-slate-100" aria-label="Ações"><MoreVertical className="h-4 w-4" /></button>} items={[{ label: "Visualizar", href: `${base}/${r["id"]}?view=1` }, ...(can(`${perm}.edit`) ? [{ label: "Editar", href: `${base}/${r["id"]}` }] : []), ...(can(`${perm}.delete`) ? [{ label: "Excluir", danger: true, onClick: () => setDel(String(r["id"])) }] : [])]} />;
  const searchable = fields.filter((f) => f.search);
  return (
    <Card>
      <CardHeader title={title ?? def.labelPlural} actions={<>{extraActions}<ListSettingsButton onClick={() => setSettings(true)} customized={p.source !== "default"} />{can("saved_reports.create") && <Link href={`/relatorios/personalizados/novo?resource=${resourceKey}&f=${encodeURIComponent(JSON.stringify({ ...applied.params, ...(applied.search ? { search: applied.search } : {}) }))}`}><Button variant="outline" size="sm" title="Montar relatório personalizado com estes filtros"><FileBarChart className="h-3.5 w-3.5" /> Relatório</Button></Link>}{def.importExport && can(`${perm}.export`) && <Button variant="outline" size="sm" onClick={() => download(`/api/exports/${resourceKey}${qs({ ...all, search: applied.search, format: "xlsx" })}`, `${resourceKey}.xlsx`)}>Exportar</Button>}{can(`${perm}.create`) && <Link href={`${base}/new${qs(fixedFilters ?? {})}`}><Button size="sm"><Plus className="h-3.5 w-3.5" /> Adicionar Novo</Button></Link>}</>} />
      <CardBody className={cn(p.prefs.view.density === "compact" && "text-[12px]")}>
        <AdvancedFilterBar fields={filterFields} prefs={p.prefs} updatePrefs={p.update} values={values} onChange={setValues} onApply={apply} onClear={clear}
          search={searchable.length ? search : undefined} onSearch={searchable.length ? setSearch : undefined} searchLabel={`Pesquisar por ${searchable.map((f) => f.label.toLowerCase()).slice(0, 3).join("/")}`} />
        {p.prefs.view.mode === "cards"
          ? <><CardsView rows={q.data?.items ?? []} columns={baseColumns} fields={p.prefs.view.cardFields} perRow={p.prefs.view.cardsPerRow ?? 3} loading={q.isLoading} onClick={(r) => router.push(`${base}/${r["id"]}`)} actions={rowActions} />
              <DataTable columns={[]} rows={[]} total={q.data?.total} page={page} pageSize={effPageSize} onPage={setPage} onPageSize={onPageSize} caption={`N. Registros: ${q.data?.total ?? 0}`} emptyText=" " /></>
          : <DataTable columns={columns} rows={q.data?.items ?? []} total={q.data?.total} page={page} pageSize={effPageSize} onPage={setPage} onPageSize={onPageSize} sort={effSort} onSort={onSort} loading={q.isLoading} onRowClick={(r) => router.push(`${base}/${r["id"]}`)} actions={rowActions} />}
        <Confirm open={Boolean(del)} onOpenChange={() => setDel(null)} title="Confirme a exclusão" text={`Excluir este registro de ${def.label.toLowerCase()}? A ação fica registrada na auditoria.`} danger loading={remove.isPending} onConfirm={() => del && remove.mutate(del)} />
        <ListSettingsDialog open={settings} onOpenChange={setSettings} columns={colInfo} filters={filterInfo} p={p} />
      </CardBody>
    </Card>
  );
}
export const _cn = cn;
