"use client";
import * as React from "react";
import { Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, Download, Printer, Save } from "lucide-react";
import { defaultListPreferences, filterKindOf, type ListPreferences } from "@agro/shared";
import { api, ApiError, getSession } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { brl, num, dateBR, cn } from "@/lib/utils";
import { Button, Card, CardHeader, CardBody, Input, NativeSelect, Field, Spinner, ErrorBox, Dialog, Badge } from "@/components/ui";
import { AdvancedFilterBar, toQueryParams, fromQueryParams, type AdvancedFilterField, type FilterValues } from "@/features/listing/advanced-filters";

interface FieldInfo { name: string; label: string; type: string; filter: boolean; resource?: string; options?: { value: string; label: string }[] }
interface Res { key: string; label: string; fields: FieldInfo[] }
interface Definition { columns: string[]; filters: Record<string, string>; search?: string; sort?: { key: string; dir: "asc" | "desc" }; groupBy?: string | null; totals: string[]; limit?: number }
interface Result { columns: { key: string; label: string; type: string }[]; rows: Record<string, unknown>[]; groups: { label: string; rows: Record<string, unknown>[]; totals: Record<string, string> }[] | null; totals: Record<string, string>; count: number; truncated: boolean }
interface Saved { id: string; resource_key: string; name: string; definition: Definition; is_shared: boolean; mine?: boolean }
const NUMERIC = ["number", "integer", "money", "quantity", "percent"];
const fmt = (type: string, v: unknown) => v === null || v === undefined || v === "" ? "" : type === "money" ? brl(v as string) : type === "quantity" || type === "number" ? num(v as string, 2) : type === "percent" ? `${num(v as string, 2)}%` : type === "integer" ? String(v) : type === "date" ? dateBR(String(v)) : String(v);

/** Construtor de relatório personalizado: entidade → colunas → filtros → agrupamento/totais → prévia → salvar/exportar. */
function Builder() {
  const sp = useSearchParams(); const router = useRouter(); const qc = useQueryClient(); const { can } = useAuth();
  const editId = sp.get("id");
  const resources = useQuery({ queryKey: ["saved-reports", "resources"], queryFn: () => api<Res[]>("/api/saved-reports/resources") });
  const saved = useQuery({ queryKey: ["saved-reports", editId], queryFn: () => api<Saved>(`/api/saved-reports/${editId}`), enabled: Boolean(editId) });
  const [resourceKey, setResourceKey] = React.useState(sp.get("resource") ?? "");
  const [columns, setColumns] = React.useState<string[]>([]);
  const [values, setValues] = React.useState<FilterValues>({});
  const [search, setSearch] = React.useState("");
  const [groupBy, setGroupBy] = React.useState(""); const [totals, setTotals] = React.useState<string[]>([]);
  const [sort, setSort] = React.useState<{ key: string; dir: "asc" | "desc" } | undefined>();
  const [prefs, setPrefs] = React.useState<ListPreferences>(defaultListPreferences());
  const [name, setName] = React.useState(""); const [shared, setShared] = React.useState(false); const [saveOpen, setSaveOpen] = React.useState(false);
  const [result, setResult] = React.useState<Result | null>(null);
  const res = resources.data?.find((r) => r.key === resourceKey);
  const filterFields = React.useMemo<AdvancedFilterField[]>(() => (res?.fields ?? []).filter((f) => f.filter || ["text", "date", "email"].includes(f.type) || NUMERIC.includes(f.type)).map((f) => ({ key: f.name, label: f.label, kind: filterKindOf(f.type), resource: f.resource, options: f.options })), [res]);
  // carrega definição salva (edição) ou pré-preenche a partir de uma listagem (?resource=&f=<json>)
  React.useEffect(() => { if (saved.data) { setResourceKey(saved.data.resource_key); setName(saved.data.name); setShared(saved.data.is_shared); } }, [saved.data]);
  React.useEffect(() => {
    if (!res) return;
    const d = saved.data?.definition;
    if (d && saved.data?.resource_key === res.key) { setColumns(d.columns); setValues(fromQueryParams(filterFields, d.filters)); setSearch(d.search ?? ""); setGroupBy(d.groupBy ?? ""); setTotals(d.totals); setSort(d.sort); return; }
    const fromList = sp.get("f"); let pre: Record<string, string> = {}; try { pre = fromList ? (JSON.parse(fromList) as Record<string, string>) : {}; } catch { pre = {}; }
    setColumns((c) => (c.length ? c : res.fields.filter((f) => !["json"].includes(f.type)).slice(0, 8).map((f) => f.name)));
    if (Object.keys(pre).length) { const { search: s, ...rest } = pre; setValues(fromQueryParams(filterFields, rest)); if (s) setSearch(s); }
    setTotals((t) => t.length ? t : res.fields.filter((f) => f.type === "money").slice(0, 3).map((f) => f.name));
  }, [res, saved.data, filterFields, sp]);
  const definition = (): Definition => ({ columns, filters: toQueryParams(filterFields, values), search: search || undefined, sort, groupBy: groupBy || null, totals: totals.filter((t) => columns.includes(t)), limit: 1000 });
  const run = useMutation({ mutationFn: () => api<Result>("/api/saved-reports/run", { method: "POST", body: { resource_key: resourceKey, definition: definition() } }), onSuccess: setResult, onError: (e) => toast.error((e as Error).message) });
  const save = useMutation({
    mutationFn: () => editId && saved.data ? api<Saved>(`/api/saved-reports/${editId}`, { method: "PUT", body: { name, definition: definition(), is_shared: shared } }) : api<Saved>("/api/saved-reports", { method: "POST", body: { resource_key: resourceKey, name, definition: definition(), is_shared: shared } }),
    onSuccess: (s) => { toast.success("Relatório salvo"); setSaveOpen(false); void qc.invalidateQueries({ queryKey: ["saved-reports"] }); if (!editId) router.replace(`/relatorios/personalizados/novo?id=${s.id}`); },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : "Falha ao salvar")
  });
  const exportAs = async (format: "csv" | "xlsx") => {
    const s = getSession(); const resp = await fetch(`${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3333"}/api/saved-reports/run`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${s?.token}`, "X-Org-Id": s?.orgId ?? "", "X-Farm-Id": s?.farmId ?? "" }, body: JSON.stringify({ resource_key: resourceKey, definition: definition(), format, name: name || res?.label }) });
    if (!resp.ok) { toast.error("Falha ao exportar"); return; }
    const blob = await resp.blob(); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = `${name || resourceKey}.${format}`; a.click(); URL.revokeObjectURL(url);
  };
  const move = (k: string, dir: -1 | 1) => setColumns((c) => { const i = c.indexOf(k); const j = i + dir; if (i < 0 || j < 0 || j >= c.length) return c; const n = [...c]; [n[i], n[j]] = [n[j]!, n[i]!]; return n; });
  const fieldOf = (k: string) => res?.fields.find((f) => f.name === k);
  const renderRows = (rows: Record<string, unknown>[]) => rows.map((r, i) => <tr key={String(r["id"] ?? i)}>{result!.columns.map((c) => <td key={c.key} className={cn(NUMERIC.includes(c.type) && "num")}>{fmt(c.type, r[c.key])}</td>)}</tr>);
  const totalsRow = (label: string, t: Record<string, string>) => Object.keys(t).length ? <tr className="bg-slate-50 font-semibold">{result!.columns.map((c, i) => <td key={c.key} className={cn(i > 0 && "num")}>{i === 0 ? label : t[c.key] !== undefined ? fmt(c.type, t[c.key]) : ""}</td>)}</tr> : null;
  return <div className="space-y-4">
    <Card>
      <CardHeader title={editId ? `Relatório: ${name || "…"}` : "Novo relatório personalizado"} subtitle="Escolha a entidade, as colunas, os filtros e o agrupamento; gere a prévia e salve ou exporte" actions={<>
        <Link href="/relatorios/personalizados"><Button size="sm" variant="outline">Voltar</Button></Link>
        <Button size="sm" variant="outline" onClick={() => run.mutate()} disabled={!resourceKey || !columns.length} loading={run.isPending}>Gerar prévia</Button>
        <Button size="sm" variant="outline" onClick={() => void exportAs("csv")} disabled={!result}><Download className="h-3.5 w-3.5" /> CSV</Button>
        <Button size="sm" variant="outline" onClick={() => void exportAs("xlsx")} disabled={!result}><Download className="h-3.5 w-3.5" /> Excel</Button>
        <Button size="sm" variant="outline" onClick={() => window.print()} disabled={!result}><Printer className="h-3.5 w-3.5" /></Button>
        {(can("saved_reports.create") || (editId && saved.data?.mine)) && <Button size="sm" onClick={() => setSaveOpen(true)} disabled={!resourceKey || !columns.length}><Save className="h-3.5 w-3.5" /> Salvar</Button>}
      </>} />
      <CardBody className="no-print space-y-3">
        {resources.isLoading && <Spinner />}{resources.error && <ErrorBox error={resources.error} />}
        <div className="grid grid-cols-12 gap-3">
          <Field label="Entidade" span={4}><NativeSelect value={resourceKey} onChange={(e) => { setResourceKey(e.target.value); setColumns([]); setValues({}); setGroupBy(""); setTotals([]); setSort(undefined); setResult(null); }} disabled={Boolean(editId)}><option value="">Selecione…</option>{resources.data?.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}</NativeSelect></Field>
          {res && <><Field label="Agrupar por" span={3}><NativeSelect value={groupBy} onChange={(e) => setGroupBy(e.target.value)}><option value="">Sem agrupamento</option>{res.fields.filter((f) => ["select", "ref", "boolean", "text", "date"].includes(f.type)).map((f) => <option key={f.name} value={f.name}>{f.label}</option>)}</NativeSelect></Field>
            <Field label="Ordenar por" span={3}><NativeSelect value={sort?.key ?? ""} onChange={(e) => setSort(e.target.value ? { key: e.target.value, dir: sort?.dir ?? "asc" } : undefined)}><option value="">Padrão</option>{res.fields.filter((f) => f.type !== "ref" && f.type !== "json").map((f) => <option key={f.name} value={f.name}>{f.label}</option>)}</NativeSelect></Field>
            <Field label="Direção" span={2}><NativeSelect value={sort?.dir ?? "asc"} onChange={(e) => sort && setSort({ ...sort, dir: e.target.value as "asc" | "desc" })} disabled={!sort}><option value="asc">Crescente</option><option value="desc">Decrescente</option></NativeSelect></Field></>}
        </div>
        {res && <div className="grid grid-cols-12 gap-4">
          <div className="col-span-12 md:col-span-5">
            <div className="mb-1 text-[11px] font-semibold uppercase text-slate-500">Colunas ({columns.length})</div>
            <div className="max-h-72 overflow-auto rounded border text-[12.5px]"><table className="table-dense w-full"><tbody>
              {[...columns.map((k) => fieldOf(k)).filter(Boolean) as FieldInfo[], ...res.fields.filter((f) => !columns.includes(f.name))].map((f) => { const on = columns.includes(f.name); return <tr key={f.name} className={cn(!on && "text-slate-400")}><td className="w-6"><input type="checkbox" checked={on} onChange={(e) => setColumns((c) => (e.target.checked ? [...c, f.name] : c.filter((x) => x !== f.name)))} aria-label={`Coluna ${f.label}`} /></td><td>{f.label}</td><td className="w-16">{on && NUMERIC.includes(f.type) && <label className="flex items-center gap-1 text-[11px]"><input type="checkbox" checked={totals.includes(f.name)} onChange={(e) => setTotals((t) => (e.target.checked ? [...t, f.name] : t.filter((x) => x !== f.name)))} />Σ</label>}</td><td className="w-14">{on && <span className="flex gap-0.5"><button type="button" className="rounded p-0.5 hover:bg-slate-100" onClick={() => move(f.name, -1)} aria-label="Subir"><ArrowUp className="h-3 w-3" /></button><button type="button" className="rounded p-0.5 hover:bg-slate-100" onClick={() => move(f.name, 1)} aria-label="Descer"><ArrowDown className="h-3 w-3" /></button></span>}</td></tr>; })}
            </tbody></table></div>
            <div className="mt-1 text-[11px] text-slate-400">Σ = somar no rodapé (campos numéricos)</div>
          </div>
          <div className="col-span-12 md:col-span-7">
            <div className="mb-1 text-[11px] font-semibold uppercase text-slate-500">Filtros</div>
            <AdvancedFilterBar fields={filterFields} prefs={prefs} updatePrefs={(fn) => setPrefs(fn)} values={values} onChange={setValues} onApply={() => run.mutate()} onApplyValues={() => setTimeout(() => run.mutate(), 0)} onClear={() => { setValues({}); setSearch(""); }} search={search} onSearch={setSearch} searchLabel="Pesquisa livre" />
          </div>
        </div>}
      </CardBody>
    </Card>
    {run.error && <ErrorBox error={run.error} />}
    {result && <Card>
      <CardHeader title={name || res?.label || "Prévia"} subtitle={<span>{result.count} linha(s){result.truncated && <Badge tone="amber" className="ml-2">limitado a {definition().limit} linhas</Badge>}{groupBy && ` · agrupado por ${fieldOf(groupBy)?.label}`}</span>} />
      <CardBody><div className="overflow-x-auto rounded border bg-white"><table className="table-dense w-full text-[12.5px]"><thead><tr>{result.columns.map((c) => <th key={c.key} className={cn(NUMERIC.includes(c.type) && "text-right")}>{c.label}</th>)}</tr></thead>
        <tbody>{result.groups ? result.groups.map((g) => <React.Fragment key={g.label}><tr className="bg-brand-50"><td colSpan={result.columns.length} className="font-semibold text-brand-800">{fieldOf(groupBy)?.label}: {g.label} <span className="font-normal text-slate-500">({g.rows.length})</span></td></tr>{renderRows(g.rows)}{totalsRow("Subtotal", g.totals)}</React.Fragment>) : renderRows(result.rows)}{result.count === 0 && <tr><td colSpan={result.columns.length} className="py-6 text-center text-slate-400">Nenhum registro</td></tr>}</tbody>
        {Object.keys(result.totals).length > 0 && <tfoot>{totalsRow("Total", result.totals)}</tfoot>}</table></div></CardBody>
    </Card>}
    <Dialog open={saveOpen} onOpenChange={setSaveOpen} title="Salvar relatório" size="sm" footer={<><Button variant="outline" onClick={() => setSaveOpen(false)}>Cancelar</Button><Button onClick={() => save.mutate()} disabled={!name.trim()} loading={save.isPending}>Salvar</Button></>}>
      <div className="grid grid-cols-12 gap-3"><Field label="Nome" span={12}><Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} autoFocus /></Field>
        <Field label="Visibilidade" span={12}><NativeSelect value={shared ? "shared" : "private"} onChange={(e) => setShared(e.target.value === "shared")} disabled={!can("saved_reports.share")}><option value="private">Somente eu</option><option value="shared">Compartilhado com a organização</option></NativeSelect></Field></div>
    </Dialog>
  </div>;
}
export default function Page() { return <Suspense><Builder /></Suspense>; }
