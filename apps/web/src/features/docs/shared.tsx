"use client";
import * as React from "react";
import { cn } from "@/lib/utils";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { api, qs, newIdem } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { brl, num, dateBR, monthStartISO, todayISO } from "@/lib/utils";
import { Button, Card, CardHeader, CardBody, Input, NativeSelect, Field, Menu, Confirm, Badge, Spinner, ErrorBox, Dialog } from "@/components/ui";
import type { Column } from "@/components/ui/data-table";
import { RefSelect } from "@/components/ui/ref-select";
import { Bookmark } from "lucide-react";

import { Base1List } from "@/features/base1/list";
import type { Base1Column, Base1FilterDef, FilterValues } from "@/features/base1/types";

export type Row = Record<string, unknown>;
export const statusTone = (s: string): "green" | "red" | "amber" | "slate" | "blue" | "violet" => s === "confirmed" || s === "paid" || s === "finished" || s === "signed" ? "green" : s === "cancelled" || s === "reversed" ? "red" : s === "pending" || s === "draft" || s === "awaiting_signature" || s === "open" ? "amber" : "slate";
export const STATUS_PT: Record<string, string> = { confirmed: "Confirmado", cancelled: "Cancelado", pending: "Pendente", draft: "Rascunho", reversed: "Estornado", open: "Aberto", paid: "Baixado", partially_paid: "Baixa parcial", finished: "Finalizado", signed: "Assinado", awaiting_signature: "Aguardando assinatura", approved: "Aprovado", converted: "Convertido", invoiced: "Faturado", in_progress: "Em andamento", evaluated: "Avaliado", scheduled: "Agendada", done: "Realizada", active: "Ativo", closed: "Encerrado", sold: "Vendido", dead: "Morto", lost: "Perdido", transferred: "Transferido", inventoried: "Inventariado", imported: "Importado", reconciling: "Conciliando", reconciled: "Conciliado", launched: "Lançado", ignored: "Ignorado", matched: "Conciliado", financial_generated: "Financeiro gerado", under_review: "Em análise" };
export const StatusBadge = ({ s }: { s: string }) => <Badge tone={statusTone(s)}>{STATUS_PT[s] ?? s}</Badge>;

export interface Filter { name: string; label: string; type: "date" | "text" | "select" | "ref"; resource?: string; options?: { value: string; label: string }[]; extra?: Record<string, string> }
export function useFilters(initial: Record<string, string> = {}) { const [f, setF] = React.useState<Record<string, string>>(initial); const set = (k: string, v: string) => setF((o) => ({ ...o, [k]: v })); return { f, set, reset: () => setF(initial), setAll: (v: Record<string, string>) => setF(v) }; }
export function FilterBar({ filters, f, set, reset, onApply, visible, saved, onSaveFilter, onDeleteFilter, onApplySaved }: { filters: Filter[]; f: Record<string, string>; set: (k: string, v: string) => void; reset: () => void; onApply: () => void; visible?: string[]; saved?: { name: string; values: Record<string, string> }[]; onSaveFilter?: (name: string) => void; onDeleteFilter?: (name: string) => void; onApplySaved?: (values: Record<string, string>) => void }) {
  const shown = visible ? filters.filter((x) => visible.includes(x.name)) : filters;
  const [saveOpen, setSaveOpen] = React.useState(false); const [saveName, setSaveName] = React.useState("");
  const cls = "!h-7 !rounded-full !shadow-none w-40 text-[12px]";
  // faixa de filtros no MODELO BASE1 (mg-rail): pílulas cinza com rótulo, botões Filtrar / Limpar
  return <form className="mg-rail mg-card mb-2 flex-wrap no-print" onSubmit={(e) => { e.preventDefault(); onApply(); }}>
    {shown.map((x) => <label key={x.name} className="flex items-center gap-1.5"><span className="whitespace-nowrap text-[11px] text-[var(--mg-text-2)]">{x.label}</span>
      {x.type === "date" ? <Input type="date" className={cls} value={f[x.name] ?? ""} onChange={(e) => set(x.name, e.target.value)} /> : x.type === "select" ? <NativeSelect className={cls} value={f[x.name] ?? ""} onChange={(e) => set(x.name, e.target.value)}><option value="">Todos</option>{x.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</NativeSelect> : x.type === "ref" ? <RefSelect resource={x.resource!} value={f[x.name] ?? null} onChange={(v) => set(x.name, v ?? "")} placeholder="Todos" filter={x.extra} className={cls} /> : <Input className={cn(cls, "w-52")} value={f[x.name] ?? ""} onChange={(e) => set(x.name, e.target.value)} />}
    </label>)}
    <span className="flex items-center gap-1.5"><Button type="submit">Filtrar</Button><Button type="button" variant="secondary" onClick={reset}>Limpar</Button>
      {onSaveFilter && <Menu trigger={<Button type="button" variant="outline" title="Filtros salvos"><Bookmark className="h-3.5 w-3.5" /> Filtros salvos{saved?.length ? ` (${saved.length})` : ""}</Button>} items={[{ label: "Salvar filtro atual…", onClick: () => setSaveOpen(true) }, ...(saved ?? []).map((s) => ({ label: `Aplicar: ${s.name}`, onClick: () => onApplySaved?.(s.values) })), ...(saved ?? []).map((s) => ({ label: `Excluir: ${s.name}`, danger: true, onClick: () => onDeleteFilter?.(s.name) }))]} />}
    </span>
    {onSaveFilter && <Dialog open={saveOpen} onOpenChange={setSaveOpen} title="Salvar filtro" size="sm" footer={<><Button variant="outline" onClick={() => setSaveOpen(false)}>Cancelar</Button><Button disabled={!saveName.trim()} onClick={() => { onSaveFilter(saveName.trim()); setSaveOpen(false); setSaveName(""); }}>Salvar</Button></>}><Field label="Nome do filtro" span={12}><Input value={saveName} onChange={(e) => setSaveName(e.target.value)} maxLength={60} autoFocus /></Field></Dialog>}
  </form>;
}

/**
 * Lista genérica de documentos transacionais (lançamentos) no MODELO BASE1: chips de filtro, grade/cards
 * configuráveis, modo Registro (abre o detalhe), rodapé com contadores, cancelamento com estorno.
 */
export function DocList({ title, endpoint, base, columns, filters, canCreate, canCancel, cancelPath, extraActions, totals, defaultFilters, rowActions, createLabel = "Novo", hideNew }: { title: string; endpoint: string; base: string; columns: Column<Row>[]; filters?: Filter[]; canCreate?: boolean; canCancel?: boolean; cancelPath?: (id: string) => string; extraActions?: React.ReactNode; totals?: (t: Record<string, string>) => React.ReactNode; defaultFilters?: Record<string, string>; rowActions?: (r: Row) => { label: string; onClick?: () => void; href?: string; danger?: boolean }[]; createLabel?: string; hideNew?: boolean }) {
  const router = useRouter(); const qc = useQueryClient();
  const [cancel, setCancel] = React.useState<string | null>(null);
  // preferências da listagem ("modelo base"): módulo derivado do endpoint (ex.: /api/stock/entries → stock.entries)
  const moduleId = React.useMemo(() => endpoint.replace(/^\/api\//, "").replace(/[^a-z0-9_.-]+/g, ".").replace(/^\.|\.$/g, "").slice(0, 64), [endpoint]);
  const b1cols = React.useMemo<Base1Column[]>(() => columns.map((c) => ({ key: c.key, label: c.label, align: c.align, sortable: false, render: c.render, text: (r) => { const v = r[c.key]; return v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v); } })), [columns]);
  // filtros: start_date/end_date viram um único chip "Período"; demais são simples (campo=valor)
  const b1filters = React.useMemo<Base1FilterDef[]>(() => { const fs = filters ?? []; const out: Base1FilterDef[] = []; const hasRange = fs.some((x) => x.name === "start_date") && fs.some((x) => x.name === "end_date"); if (hasRange) out.push({ key: "periodo", label: "Período", kind: "date", mode: "simple", range: { from: "start_date", to: "end_date" } }); for (const x of fs) { if (hasRange && (x.name === "start_date" || x.name === "end_date")) continue; out.push({ key: x.name, label: x.label, kind: x.type === "date" ? "date" : x.type === "select" ? "enum" : x.type === "ref" ? "ref" : "text", mode: "simple", resource: x.resource, resourceFilter: x.extra, options: x.options }); } return out; }, [filters]);
  const { defaultValues, fixed } = React.useMemo(() => { const dv: FilterValues = {}; const fx: Record<string, string> = {}; const d = defaultFilters ?? {}; const keys = b1filters.map((f) => f.key); if (d["start_date"] || d["end_date"]) dv["periodo"] = { op: "between", value: d["start_date"] ?? "", value2: d["end_date"] ?? "" }; for (const [k, v] of Object.entries(d)) { if (k === "start_date" || k === "end_date") continue; if (keys.includes(k)) dv[k] = { op: "eq", value: v, values: [v] }; else fx[k] = v; } return { defaultValues: dv, fixed: fx }; }, [defaultFilters, b1filters]);
  const cancelMut = useMutation({ mutationFn: (id: string) => api((cancelPath ?? ((i) => `${endpoint}/${i}/cancel`))(id), { method: "POST", body: { reason: "Cancelado pelo usuário" } }), onSuccess: () => { toast.success("Documento cancelado"); setCancel(null); void qc.invalidateQueries({ queryKey: ["b1", moduleId] }); }, onError: (e) => toast.error((e as Error).message) });
  const footer = totals ? (t: Record<string, string>) => { const el = totals(t); return React.isValidElement(el) ? React.cloneElement(el as React.ReactElement<{ children?: React.ReactNode }>, {}, <td />, (el as React.ReactElement<{ children?: React.ReactNode }>).props.children) : el; } : undefined;
  return <>
    <Base1List moduleId={moduleId} title={title} columns={b1cols} filters={b1filters} defaultValues={defaultValues} queryKeyExtra={fixed} csvName={moduleId}
      fetchPage={(p) => api<{ items: Row[]; total: number; totals?: Record<string, string> }>(`${endpoint}${qs({ ...p.filters, ...fixed, page: p.page, pageSize: p.pageSize })}`)}
      canCreate={Boolean(canCreate) && !hideNew} onNew={() => router.push(`${base}/new`)} createLabel={createLabel} extraToolbar={extraActions}
      onOpen={(r) => router.push(`${base}/${r["id"]}`)}
      rowActions={(r) => [{ label: "Visualizar", onClick: () => router.push(`${base}/${r["id"]}`) }, ...(rowActions?.(r) ?? []).map((a) => ({ label: a.label, danger: a.danger, onClick: () => { if (a.href) router.push(a.href); else a.onClick?.(); } })), ...(canCancel && r["status"] !== "cancelled" && r["status"] !== "reversed" ? [{ label: "Cancelar", danger: true, onClick: () => setCancel(String(r["id"])) }] : [])]}
      footerTotals={footer} />
    <Confirm open={Boolean(cancel)} onOpenChange={() => setCancel(null)} title="Cancelar documento" text="O cancelamento estorna os lançamentos vinculados (estoque/financeiro) e fica registrado na auditoria. Continuar?" danger loading={cancelMut.isPending} onConfirm={() => cancel && cancelMut.mutate(cancel)} />
  </>;
}

export const colDate = (key: string, label: string): Column<Row> => ({ key, label, render: (r) => dateBR(r[key] as string) });
export const colMoney = (key: string, label: string): Column<Row> => ({ key, label, align: "right", render: (r) => brl(r[key] as string) });
export const colQty = (key: string, label: string, d = 2): Column<Row> => ({ key, label, align: "right", render: (r) => num(r[key] as string, d) });
export const colStatus = (key = "status"): Column<Row> => ({ key, label: "Status", render: (r) => <StatusBadge s={String(r[key])} /> });
export const colText = (key: string, label: string): Column<Row> => ({ key, label, render: (r) => String(r[key] ?? "") });
export const dateFilters: Filter[] = [{ name: "start_date", label: "Dt. Início", type: "date" }, { name: "end_date", label: "Dt. Fim", type: "date" }];
export const monthRange = () => ({ start_date: monthStartISO(), end_date: todayISO() });

/** Editor de itens (produto, qtd, valor) usado nos documentos de estoque/vendas. */
export interface ItemRow { product_id: string; warehouse_id?: string; quantity: string; unit_value?: string; cost_center_id?: string; provider_lot?: string; expiration_date?: string; financial_category_id?: string; cost_center?: string; generate_stock?: boolean; discount?: string; discount_percent?: string; description?: string; [k: string]: unknown }
export function ItemsEditor({ items, onChange, fields, defaults }: { items: ItemRow[]; onChange: (i: ItemRow[]) => void; fields: ("warehouse" | "product" | "quantity" | "unit_value" | "cost_center" | "lot" | "expiration" | "financial_category" | "generate_stock" | "discount" | "discount_percent" | "stock")[]; defaults?: Partial<ItemRow> }) {
  const upd = (i: number, k: string, v: unknown) => onChange(items.map((it, j) => (j === i ? { ...it, [k]: v } : it)));
  const add = () => onChange([...items, { product_id: "", quantity: "1", unit_value: "0", generate_stock: true, ...(defaults ?? {}) }]);
  const totalOf = (it: ItemRow) => { const g = Number(it.quantity || 0) * Number(it.unit_value || 0); return g - Number(it.discount || 0) - g * Number(it.discount_percent || 0) / 100; };
  const has = (k: (typeof fields)[number]) => fields.includes(k);
  return <div className="overflow-x-auto rounded border"><table className="table-dense w-full text-[12.5px]"><thead><tr>
    {has("warehouse") && <th className="min-w-[160px]">Armazém</th>}<th className="min-w-[240px]">Produto</th>{has("stock") && <th className="text-right">Estoque</th>}<th className="w-24">Qtd.</th>{has("unit_value") && <th className="w-28">Vl. Unit.</th>}{has("discount") && <th className="w-24">Desconto</th>}{has("discount_percent") && <th className="w-20">Desc. %</th>}<th className="w-28 text-right">Vl. Total</th>{has("generate_stock") && <th className="w-24">Gera estoque</th>}{has("lot") && <th className="w-28">Lote</th>}{has("expiration") && <th className="w-32">Validade</th>}{has("financial_category") && <th className="min-w-[180px]">Cat. Financeira</th>}{has("cost_center") && <th className="min-w-[160px]">Centro de Custo</th>}<th className="w-8" />
  </tr></thead><tbody>
    {items.map((it, i) => <tr key={i}>
      {has("warehouse") && <td><RefSelect resource="warehouses" value={it.warehouse_id ?? null} onChange={(v) => upd(i, "warehouse_id", v ?? "")} /></td>}
      <td><RefSelect resource="products" value={it.product_id || null} onChange={(v) => upd(i, "product_id", v ?? "")} /></td>
      {has("stock") && <td className="num"><StockCell warehouseId={it.warehouse_id} productId={it.product_id} onCost={(c) => { if (!it.unit_value || it.unit_value === "0") upd(i, "unit_value", c); }} /></td>}
      <td><Input type="number" step="0.0001" min="0" value={it.quantity} onChange={(e) => upd(i, "quantity", e.target.value)} /></td>
      {has("unit_value") && <td><Input type="number" step="0.000001" min="0" value={it.unit_value ?? ""} onChange={(e) => upd(i, "unit_value", e.target.value)} /></td>}
      {has("discount") && <td><Input type="number" step="0.01" min="0" value={it.discount ?? ""} onChange={(e) => upd(i, "discount", e.target.value)} /></td>}
      {has("discount_percent") && <td><Input type="number" step="0.01" min="0" max="100" value={it.discount_percent ?? ""} onChange={(e) => upd(i, "discount_percent", e.target.value)} /></td>}
      <td className="num">{brl(totalOf(it))}</td>
      {has("generate_stock") && <td><NativeSelect value={it.generate_stock === false ? "false" : "true"} onChange={(e) => upd(i, "generate_stock", e.target.value === "true")}><option value="true">Sim</option><option value="false">Não</option></NativeSelect></td>}
      {has("lot") && <td><Input value={it.provider_lot ?? ""} onChange={(e) => upd(i, "provider_lot", e.target.value)} /></td>}
      {has("expiration") && <td><Input type="date" value={it.expiration_date ?? ""} onChange={(e) => upd(i, "expiration_date", e.target.value)} /></td>}
      {has("financial_category") && <td><RefSelect resource="financial_categories" value={it.financial_category_id ?? null} onChange={(v) => upd(i, "financial_category_id", v ?? "")} filter={{ kind: "analytic" }} /></td>}
      {has("cost_center") && <td><RefSelect resource="cost_centers" value={it.cost_center_id ?? null} onChange={(v) => upd(i, "cost_center_id", v ?? "")} filter={{ kind: "analytic" }} /></td>}
      <td><button type="button" className="p-1 text-slate-400 hover:text-red-600" onClick={() => onChange(items.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></button></td>
    </tr>)}
  </tbody><tfoot><tr><td colSpan={20} className="p-2"><Button type="button" size="sm" variant="outline" onClick={add}><Plus className="h-3.5 w-3.5" /> Adicionar item</Button><span className="ml-4 font-semibold">Total: {brl(items.reduce((a, it) => a + totalOf(it), 0))}</span></td></tr></tfoot></table></div>;
}
function StockCell({ warehouseId, productId, onCost }: { warehouseId?: string; productId?: string; onCost: (c: string) => void }) {
  const q = useQuery({ queryKey: ["bal", warehouseId, productId], queryFn: () => api<{ quantity: string; averageCost: string }>(`/api/stock/balances/${warehouseId}/${productId}`), enabled: Boolean(warehouseId && productId) });
  React.useEffect(() => { if (q.data && Number(q.data.averageCost) > 0) onCost(q.data.averageCost); }, [q.data]);
  return <span title={q.data ? `custo médio ${brl(q.data.averageCost)}` : ""}>{q.data ? num(q.data.quantity, 4) : "—"}</span>;
}

/** Rateio financeiro (categoria / centro de custo / % / valor). */
export interface AppLine { financial_category_id: string; cost_center_id: string; chart_account_id?: string; harvest_id?: string; percentage: string }
export function ApportionmentEditor({ lines, onChange, total }: { lines: AppLine[]; onChange: (l: AppLine[]) => void; total: number }) {
  const upd = (i: number, k: keyof AppLine, v: string) => onChange(lines.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
  const sum = lines.reduce((a, l) => a + Number(l.percentage || 0), 0);
  return <div className="overflow-x-auto rounded border"><table className="table-dense w-full text-[12.5px]"><thead><tr><th className="min-w-[220px]">Categoria</th><th className="min-w-[200px]">Centro de Custo</th><th className="min-w-[160px]">Conta Contábil</th><th className="w-24">%</th><th className="w-28 text-right">Valor</th><th className="w-8" /></tr></thead><tbody>
    {lines.map((l, i) => <tr key={i}><td><RefSelect resource="financial_categories" value={l.financial_category_id || null} onChange={(v) => upd(i, "financial_category_id", v ?? "")} filter={{ kind: "analytic" }} /></td><td><RefSelect resource="cost_centers" value={l.cost_center_id || null} onChange={(v) => upd(i, "cost_center_id", v ?? "")} filter={{ kind: "analytic" }} /></td><td><RefSelect resource="chart_accounts" value={l.chart_account_id ?? null} onChange={(v) => upd(i, "chart_account_id", v ?? "")} /></td><td><Input type="number" step="0.01" min="0" max="100" value={l.percentage} onChange={(e) => upd(i, "percentage", e.target.value)} /></td><td className="num">{brl(total * Number(l.percentage || 0) / 100)}</td><td><button type="button" className="p-1 text-slate-400 hover:text-red-600" onClick={() => onChange(lines.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></button></td></tr>)}
  </tbody><tfoot><tr><td colSpan={6} className="p-2"><Button type="button" size="sm" variant="outline" onClick={() => onChange([...lines, { financial_category_id: "", cost_center_id: "", percentage: lines.length ? "0" : "100" }])}><Plus className="h-3.5 w-3.5" /> Adicionar rateio</Button><span className={`ml-4 font-semibold ${Math.abs(sum - 100) > 0.01 ? "text-red-600" : "text-green-700"}`}>Total: {num(sum)}% {Math.abs(sum - 100) > 0.01 && "(deve somar 100%)"}</span></td></tr></tfoot></table></div>;
}
export const toAppLines = (l: AppLine[]) => l.map((x) => ({ financial_category_id: x.financial_category_id, cost_center_id: x.cost_center_id, chart_account_id: x.chart_account_id || null, harvest_id: x.harvest_id || null, percentage: x.percentage }));

/** Plano de parcelamento (modal "Parcelamento" do sistema de referência). */
export interface Plan { installments: number; first_due_date: string; mode: "interval" | "fixed_day"; interval_days: number; due_day?: number; has_down_payment: boolean; down_payment_value?: string; down_payment_date?: string }
export function PlanEditor({ plan, onChange }: { plan: Plan; onChange: (p: Plan) => void }) {
  return <div className="grid grid-cols-12 gap-2">
    <Field label="Nº Parcelas" span={2}><Input type="number" min={1} max={120} value={plan.installments} onChange={(e) => onChange({ ...plan, installments: Number(e.target.value) })} /></Field>
    <Field label="Venc. 1ª PC" span={2}><Input type="date" value={plan.first_due_date} onChange={(e) => onChange({ ...plan, first_due_date: e.target.value })} /></Field>
    <Field label="Modo" span={2}><NativeSelect value={plan.mode} onChange={(e) => onChange({ ...plan, mode: e.target.value as Plan["mode"] })}><option value="interval">Por intervalo (dias)</option><option value="fixed_day">Dia fixo do mês</option></NativeSelect></Field>
    {plan.mode === "interval" ? <Field label="Int. Parcelas (dias)" span={2}><Input type="number" min={1} value={plan.interval_days} onChange={(e) => onChange({ ...plan, interval_days: Number(e.target.value) })} /></Field> : <Field label="Dia de vencimento" span={2}><Input type="number" min={1} max={31} value={plan.due_day ?? ""} onChange={(e) => onChange({ ...plan, due_day: Number(e.target.value) })} /></Field>}
    <Field label="Possui entrada" span={2}><NativeSelect value={plan.has_down_payment ? "true" : "false"} onChange={(e) => onChange({ ...plan, has_down_payment: e.target.value === "true" })}><option value="false">Não</option><option value="true">Sim</option></NativeSelect></Field>
    {plan.has_down_payment && <><Field label="Valor entrada" span={2}><Input type="number" step="0.01" value={plan.down_payment_value ?? ""} onChange={(e) => onChange({ ...plan, down_payment_value: e.target.value })} /></Field><Field label="Data entrada" span={2}><Input type="date" value={plan.down_payment_date ?? ""} onChange={(e) => onChange({ ...plan, down_payment_date: e.target.value })} /></Field></>}
  </div>;
}
export const defaultPlan = (): Plan => ({ installments: 1, first_due_date: todayISO(), mode: "interval", interval_days: 30, has_down_payment: false });

export function useFarmDefault() { const { ctx, session } = useAuth(); return session?.farmId ?? ctx?.farms[0]?.id ?? ""; }
export function useCreate<T = { id: string }>(endpoint: string, onDone: (r: T) => void) {
  const qc = useQueryClient(); const key = React.useRef(newIdem());
  return useMutation({ mutationFn: (body: unknown) => api<T>(endpoint, { method: "POST", body, idempotencyKey: key.current }), onSuccess: (r) => { toast.success("Salvo com sucesso"); void qc.invalidateQueries(); onDone(r); }, onError: (e) => { toast.error((e as Error).message); key.current = newIdem(); } });
}
export function DetailShell({ title, back, children, actions, status }: { title: string; back: string; children: React.ReactNode; actions?: React.ReactNode; status?: string }) {
  return <Card><CardHeader title={<span className="flex items-center gap-2">{title}{status && <StatusBadge s={status} />}</span>} actions={<><Link href={back}><Button variant="outline" size="sm">Voltar</Button></Link>{actions}</>} /><CardBody className="space-y-4">{children}</CardBody></Card>;
}
export function KV({ items }: { items: [string, React.ReactNode][] }) { return <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-[12.5px] md:grid-cols-4">{items.map(([k, v]) => <div key={k}><dt className="text-[10.5px] font-semibold uppercase text-slate-500">{k}</dt><dd>{v ?? "—"}</dd></div>)}</dl>; }
export function SimpleTable({ cols, rows }: { cols: { key: string; label: string; render?: (r: Row) => React.ReactNode; align?: "right" }[]; rows: Row[] }) {
  return <div className="overflow-x-auto rounded border"><table className="table-dense w-full text-[12.5px]"><thead><tr>{cols.map((c) => <th key={c.key} className={c.align === "right" ? "text-right" : ""}>{c.label}</th>)}</tr></thead><tbody>{rows.length === 0 && <tr><td colSpan={cols.length} className="py-3 text-center text-slate-400">Nenhum item</td></tr>}{rows.map((r, i) => <tr key={String(r["id"] ?? i)}>{cols.map((c) => <td key={c.key} className={c.align === "right" ? "num" : ""}>{c.render ? c.render(r) : String(r[c.key] ?? "")}</td>)}</tr>)}</tbody></table></div>;
}
export function useDoc<T = Row>(path: string, enabled = true) { return useQuery({ queryKey: ["docone", path], queryFn: () => api<T>(path), enabled }); }
export const LoadingOr = ({ q, children }: { q: { isLoading: boolean; error: unknown }; children: React.ReactNode }) => q.isLoading ? <Spinner /> : q.error ? <ErrorBox error={q.error} /> : <>{children}</>;
