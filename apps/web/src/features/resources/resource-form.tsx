"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm, Controller, type UseFormReturn } from "react-hook-form";
import { toast } from "sonner";
import { getResource, type FieldDef } from "@agro/domain";
import { cardFieldIds, type FormLayout } from "@agro/shared";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { dateTimeBR, cn } from "@/lib/utils";
import { Input, NativeSelect, Textarea, Spinner, ErrorBox, Confirm } from "@/components/ui";
import { RefSelect } from "@/components/ui/ref-select";
import { ArrowLeft, Bookmark, ChevronDown, ChevronRight, ChevronsLeft, ChevronLeft, ChevronsRight, Copy, LayoutPanelTop, Pencil, Plus, Trash2, PanelTop, Rows3 } from "lucide-react";
import { IconBtn, PillBtn } from "@/features/base1/ui";
import { useFormLayout } from "./form-layout";

type Values = Record<string, unknown>;
export interface EmbeddedForm { mode: "view" | "edit" | "new"; setMode: (m: "view" | "edit" | "new") => void; onExit: () => void; refresh: () => void; copyFrom?: Values | null; rightSlot?: React.ReactNode; nav?: { index: number; total: number; go: (i: number) => void } }

function defaults(fields: FieldDef[], preset: Record<string, string>, layoutDefaults: Record<string, unknown>): Values { const v: Values = {}; for (const f of fields) { const ld = layoutDefaults[f.name]; v[f.name] = preset[f.name] ?? (ld !== undefined ? (f.type === "boolean" ? ld === true || ld === "true" : ld) : f.default !== undefined ? f.default : f.type === "boolean" ? false : f.type === "tags" ? [] : f.type === "json" ? {} : ""); } return v; }
function fromRecord(fields: FieldDef[], data: Values): Values { const v: Values = {}; for (const f of fields) { const x = data[f.name]; v[f.name] = f.type === "json" ? JSON.stringify(x ?? {}, null, 2) : x === null || x === undefined ? (f.type === "tags" ? [] : "") : f.type === "date" ? String(x).slice(0, 10) : x; } return v; }
function toApi(fields: FieldDef[], v: Values, locked: string[] = []): Values { const o: Values = {}; for (const f of fields) { if (f.readOnly || locked.includes(f.name)) continue; /* campos travados pelo layout não vão no payload (mantêm o valor atual) */ let x = v[f.name]; if (x === "" || x === undefined) x = null; if (f.type === "json" && typeof x === "string") { try { x = JSON.parse(x); } catch { throw new Error(`JSON inválido em ${f.label}`); } } if (f.type === "integer" && x !== null) x = Number(x); if (f.type === "boolean") x = Boolean(x); if (f.type === "date" && typeof x === "string") x = x.slice(0, 10); if (x === null && !f.required && f.type === "boolean") x = false; if (x === null && ["money", "quantity", "number", "percent", "integer"].includes(f.type)) continue; /* numérico vazio: deixa o default do banco (0) valer */ o[f.name] = x; } return o; }

const ctl = "h-6 w-full rounded-none border-0 bg-transparent px-0 text-[13px] font-medium text-slate-800 shadow-none focus:ring-0 focus:outline-none read-only:bg-transparent disabled:bg-transparent disabled:text-slate-700";
/** Controle de um campo declarativo (mesmo componente para todos os tipos), estilo "rótulo flutuante" do modelo base. */
function FieldControl({ f, form, dis, required, isNew, values, id }: { f: FieldDef; form: UseFormReturn<Values>; dis: boolean; required: boolean; isNew: boolean; values: Values; id?: string }) {
  const rules = { required: required ? "Obrigatório" : false };
  if (f.type === "ref") return <Controller name={f.name} control={form.control} rules={rules} render={({ field }) => <RefSelect resource={f.ref!.resource} value={field.value as string} onChange={(v) => field.onChange(v ?? "")} disabled={dis} includeInactive={!isNew} className={cn(ctl, "h-6 justify-between")} />} />;
  if (f.type === "select") return <NativeSelect id={id} disabled={dis} className={ctl} {...form.register(f.name, rules)}><option value="">Selecione</option>{f.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</NativeSelect>;
  if (f.type === "boolean") return <NativeSelect id={id} disabled={dis} className={ctl} value={values[f.name] === true || values[f.name] === "true" ? "true" : "false"} onChange={(e) => form.setValue(f.name, e.target.value === "true", { shouldDirty: true })}><option value="true">Sim</option><option value="false">Não</option></NativeSelect>;
  if (f.type === "textarea" || f.type === "json") return <Textarea id={id} readOnly={dis} className={cn(ctl, "h-auto min-h-[56px] py-0.5", f.type === "json" && "font-mono text-xs")} {...form.register(f.name, rules)} />;
  if (f.type === "tags") return <div className="flex flex-wrap gap-2 pt-1">{f.options?.map((o) => <label key={o.value} className="flex items-center gap-1 text-[12.5px]"><input type="checkbox" disabled={dis} className="accent-brand-500" checked={(values[f.name] as string[] | undefined)?.includes(o.value) ?? false} onChange={(e) => { const cur = new Set((values[f.name] as string[]) ?? []); if (e.target.checked) cur.add(o.value); else cur.delete(o.value); form.setValue(f.name, [...cur], { shouldDirty: true }); }} />{o.label}</label>)}</div>;
  return <Input id={id} readOnly={dis} className={ctl} type={f.type === "date" ? "date" : f.type === "email" ? "email" : ["money", "quantity", "number", "percent", "integer"].includes(f.type) ? "number" : "text"} step={f.type === "integer" ? 1 : f.type === "money" ? "0.01" : "0.0001"} maxLength={f.maxLength} {...form.register(f.name, rules)} />;
}

const SPAN: Record<number, string> = { 1: "md:col-span-1", 2: "md:col-span-2", 3: "md:col-span-3", 4: "md:col-span-4", 5: "md:col-span-5", 6: "md:col-span-6", 7: "md:col-span-7", 8: "md:col-span-8", 9: "md:col-span-9", 10: "md:col-span-10", 11: "md:col-span-11", 12: "md:col-span-12" };
/** Campo do modelo base: caixa cinza arredondada com rótulo pequeno acima do valor (como o cadastro de Empresas do MG). */
export function B1Field({ label, required, error, help, span = 3, disabled, children, className, flex }: { label: string; required?: boolean; error?: string; help?: string; span?: number; disabled?: boolean; children: React.ReactNode; className?: string; flex?: boolean }) {
  const id = React.useId();
  const child = React.isValidElement(children) && !(children.props as { id?: string }).id ? React.cloneElement(children as React.ReactElement<{ id?: string }>, { id }) : children;
  return <div className={cn(flex ? "min-w-[140px] flex-1" : cn("col-span-12", SPAN[span] ?? "md:col-span-3"), className)}>
    <div className={cn("rounded-lg bg-slate-100/90 px-3 pb-1.5 pt-1.5 transition-shadow focus-within:bg-white focus-within:ring-2 focus-within:ring-brand-300", disabled && "bg-slate-50")}>
      <label htmlFor={id} title={help} className="block text-[10.5px] leading-tight text-slate-500">{label}{required && <span className="text-red-500"> *</span>}</label>
      {child}
    </div>
    {error && <p className="mt-0.5 text-[11px] text-red-600">{error}</p>}
  </div>;
}

function LayoutCardView({ label, collapsible, colSpan, children }: { label: string; collapsible?: boolean; colSpan: 6 | 12; children: React.ReactNode }) {
  const [open, setOpen] = React.useState(true);
  return <div className={cn("col-span-12 rounded-2xl bg-white p-4 shadow-[0_1px_2px_rgba(0,0,0,.04),0_4px_14px_rgba(0,0,0,.05)]", colSpan === 6 && "md:col-span-6")}>
    <h3 className="mb-3 text-[13px] font-semibold text-slate-800">{collapsible ? <button type="button" className="flex items-center gap-1" onClick={() => setOpen((o) => !o)}>{open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}{label}</button> : label}</h3>
    {open && <div className="space-y-2">{children}</div>}
  </div>;
}

/**
 * Formulário genérico de cadastros no MODELO BASE1: barra Novo / Editar / Excluir / Duplicar (ou Salvar / Cancelar),
 * cabeçalho "CÓDIGO • nome" com navegação entre registros, painéis em abas, cards com campos de rótulo flutuante.
 * Renderiza o layout configurável (painéis → cards → linhas → campos) com campos ocultos/travados/obrigatórios,
 * rótulos e valores padrão definidos pelo usuário ou pela organização.
 */
export function ResourceForm({ resourceKey, id, basePath, afterSave, embedded }: { resourceKey: string; id: string; basePath?: string; afterSave?: (row: Values) => void; embedded?: EmbeddedForm }) {
  const def = getResource(resourceKey); const router = useRouter(); const sp = useSearchParams(); const qc = useQueryClient(); const { can } = useAuth();
  const fields = React.useMemo(() => def?.fields ?? [], [def]);
  const layout = useFormLayout(resourceKey, fields);
  const l: FormLayout = layout.prefs;
  const isNew = embedded ? embedded.mode === "new" : id === "new";
  const canEdit = can(`${def?.permission}.edit`); const canDelete = can(`${def?.permission}.delete`); const canCreate = can(`${def?.permission}.create`);
  const readOnly = embedded ? embedded.mode === "view" : sp.get("view") === "1" || (!isNew && !canEdit);
  const preset = React.useMemo(() => { const p: Record<string, string> = {}; if (!embedded) sp.forEach((v, k) => { if (k !== "view" && k !== "copy") p[k] = v; }); return p; }, [sp, embedded]);
  const copyId = embedded ? null : sp.get("copy");
  const q = useQuery({ queryKey: ["res", resourceKey, id], queryFn: () => api<Values>(`/api/resources/${resourceKey}/${id}`), enabled: !isNew && id !== "new" });
  const copyQ = useQuery({ queryKey: ["res", resourceKey, copyId], queryFn: () => api<Values>(`/api/resources/${resourceKey}/${copyId}`), enabled: Boolean(copyId) });
  const form = useForm<Values>({ defaultValues: defaults(fields, preset, l.fieldDefaultValues) });
  const appliedDefaults = React.useRef(false);
  // valores padrão do layout entram só em campos ainda não editados pelo usuário (não descarta o que já foi digitado)
  React.useEffect(() => { if (isNew && layout.loaded && !appliedDefaults.current && Object.keys(l.fieldDefaultValues).length) { appliedDefaults.current = true; const d = defaults(fields, preset, l.fieldDefaultValues); for (const f of fields) { if (!(f.name in l.fieldDefaultValues) || preset[f.name] !== undefined) continue; if (form.getFieldState(f.name).isDirty) continue; form.setValue(f.name, d[f.name]); } } }, [isNew, layout.loaded, l.fieldDefaultValues, fields, preset, form]);
  React.useEffect(() => { if (q.data && def && !isNew) form.reset(fromRecord(def.fields, q.data)); }, [q.data, def, form, isNew]);
  // duplicar: novo registro pré-preenchido com os valores do registro de origem (exceto código/identificadores)
  const copySrc = embedded?.copyFrom ?? copyQ.data ?? null;
  React.useEffect(() => { if (isNew && def) { if (copySrc) { const v = fromRecord(def.fields, copySrc); for (const f of def.fields) if (f.name === "code" || f.readOnly) v[f.name] = f.type === "boolean" ? false : f.type === "tags" ? [] : ""; form.reset(v); } else form.reset(defaults(fields, preset, l.fieldDefaultValues)); } }, [isNew, copySrc, def]);
  const [confirmDel, setConfirmDel] = React.useState(false);
  const [stacked, setStacked] = React.useState(false);
  const save = useMutation({
    mutationFn: (v: Values) => isNew ? api<Values>(`/api/resources/${resourceKey}`, { method: "POST", body: toApi(def!.fields, v, l.lockedFieldIds) }) : api<Values>(`/api/resources/${resourceKey}/${id}`, { method: "PUT", body: toApi(def!.fields, v, l.lockedFieldIds) }),
    onSuccess: (row) => { toast.success("Salvo com sucesso"); void qc.invalidateQueries({ queryKey: ["res", resourceKey] }); void qc.invalidateQueries({ queryKey: ["b1", resourceKey] }); if (afterSave) afterSave(row); else if (embedded) { embedded.refresh(); embedded.setMode("view"); if (isNew) embedded.onExit(); } else router.push(basePath ?? `/cadastros/${resourceKey}`); },
    onError: (e) => { const err = e as Error & { details?: { path: string; message: string }[] }; toast.error(err.message); err.details?.forEach?.((d) => { if (d.path) form.setError(d.path, { message: d.message }); }); }
  });
  const remove = useMutation({ mutationFn: () => api(`/api/resources/${resourceKey}/${id}`, { method: "DELETE" }), onSuccess: () => { toast.success("Registro excluído"); void qc.invalidateQueries({ queryKey: ["res", resourceKey] }); void qc.invalidateQueries({ queryKey: ["b1", resourceKey] }); setConfirmDel(false); if (embedded) { embedded.refresh(); embedded.onExit(); } else router.push(basePath ?? `/cadastros/${resourceKey}`); }, onError: (e) => toast.error((e as Error).message) });
  if (!def) return <div>Recurso desconhecido</div>;
  if (!isNew && q.isLoading) return <div className="p-6"><Spinner /></div>;
  if (q.error) return <ErrorBox error={q.error} />;
  const values = form.watch();
  const visible = (f: FieldDef) => !l.hiddenFieldIds.includes(f.name) && (!f.visibleWhen || values[f.visibleWhen.field] === f.visibleWhen.equals || String(values[f.visibleWhen.field]) === String(f.visibleWhen.equals)) && !(isNew && f.readOnly && f.name === "code");
  const back = basePath ?? `/cadastros/${resourceKey}`;
  const byId = new Map(fields.map((f) => [f.name, f]));
  const renderField = (fid: string) => {
    const f = byId.get(fid); if (!f || !visible(f)) return null;
    const err = form.formState.errors[f.name]?.message as string | undefined; const dis = readOnly || Boolean(f.readOnly) || l.lockedFieldIds.includes(f.name);
    const required = Boolean(f.required) || l.requiredFieldIds.includes(f.name);
    return <B1Field key={f.name} flex label={l.fieldLabels[f.name] ?? f.label} required={required} error={err} help={f.help} disabled={dis}><FieldControl f={f} form={form} dis={dis} required={required} isNew={isNew} values={values} /></B1Field>;
  };
  const panels = l.panels.filter((p) => !p.hidden);
  const renderPanel = (panelId: string) => <div className="grid grid-cols-12 gap-3">{l.cards.filter((c) => c.panelId === panelId).map((c) => { const ids = cardFieldIds(c).filter((fid) => { const f = byId.get(fid); return f && visible(f); }); if (!ids.length) return null; return <LayoutCardView key={c.id} label={c.label} collapsible={c.collapsible} colSpan={c.colSpan}>{c.rows.map((r) => { const els = r.fieldIds.map(renderField).filter(Boolean); return els.length ? <div key={r.id} className="flex flex-wrap gap-2">{els}</div> : null; })}</LayoutCardView>; })}</div>;
  const title = isNew ? `Novo ${def.label.toLowerCase()}` : String(q.data?.[def.labelField] ?? q.data?.["name"] ?? q.data?.["description"] ?? "");
  const code = !isNew && q.data?.["code"] ? String(q.data["code"]) : null;
  const nav = embedded?.nav;
  const submit = form.handleSubmit((v) => save.mutate(v));
  const cancel = () => { if (embedded) { if (embedded.mode === "new") embedded.onExit(); else { if (q.data) form.reset(fromRecord(def.fields, q.data)); embedded.setMode("view"); } } else router.push(back); };
  return (
    <form onSubmit={submit} className="b1 flex flex-col gap-2" data-testid="b1-form">
      {/* barra de ações */}
      <div className="flex flex-wrap items-center gap-2 rounded-2xl bg-white px-3 py-2 shadow-sm no-print">
        {readOnly ? <>
          {embedded && canCreate && <PillBtn onClick={() => embedded.setMode("new")}><Plus className="h-4 w-4" /> Novo</PillBtn>}
          {!isNew && canEdit && <PillBtn tone="gray" onClick={() => (embedded ? embedded.setMode("edit") : router.push(`${back}/${id}`))}><Pencil className="h-3.5 w-3.5" /> Editar</PillBtn>}
          {!isNew && canDelete && <PillBtn tone="red" onClick={() => setConfirmDel(true)}><Trash2 className="h-3.5 w-3.5" /> Excluir</PillBtn>}
          {!isNew && canCreate && <PillBtn tone="gray" onClick={() => (embedded ? router.push(`${back}/new?copy=${id}`) : router.push(`${back}/new?copy=${id}`))}><Copy className="h-3.5 w-3.5" /> Duplicar</PillBtn>}
          {!embedded && <Link href={back}><PillBtn tone="outline"><ArrowLeft className="h-3.5 w-3.5" /> Voltar</PillBtn></Link>}
        </> : <>
          <PillBtn type="submit" disabled={save.isPending}>{save.isPending ? "Salvando…" : "Salvar"}</PillBtn>
          <PillBtn tone="gray" onClick={cancel}>Cancelar</PillBtn>
        </>}
        {embedded?.rightSlot ?? <div className="ml-auto flex items-center gap-1.5">{!embedded && <Link href={back}><IconBtn aria-label="Voltar para a listagem" title="Voltar para a listagem"><ArrowLeft className="h-4 w-4" /></IconBtn></Link>}</div>}
      </div>
      {/* cabeçalho do registro + navegação */}
      <div className="flex flex-wrap items-center gap-2 rounded-2xl bg-white px-3 py-1.5 shadow-sm">
        <Bookmark className="h-4 w-4 text-slate-500" /><span className="text-[13px] font-semibold text-slate-800">{code && <>{code} <span className="text-slate-400">•</span> </>}{title || def.label}</span>
        <span className="ml-auto flex items-center gap-1">
          <Link href={`${back}/configuracao-layout`} title="Layout do formulário" aria-label="Layout do formulário"><IconBtn size="sm" className={cn(layout.source !== "default" && "text-brand-700")}><LayoutPanelTop className="h-4 w-4" /></IconBtn></Link>
          {nav && <><IconBtn size="sm" aria-label="Primeiro" disabled={nav.index <= 0} onClick={() => nav.go(0)}><ChevronsLeft className="h-4 w-4" /></IconBtn><IconBtn size="sm" aria-label="Anterior" disabled={nav.index <= 0} onClick={() => nav.go(nav.index - 1)}><ChevronLeft className="h-4 w-4" /></IconBtn><span className="px-1 text-[12px] text-slate-600">{isNew ? "novo" : `${nav.index + 1}/${nav.total}`}</span><IconBtn size="sm" aria-label="Próximo" disabled={nav.index >= nav.total - 1} onClick={() => nav.go(nav.index + 1)}><ChevronRight className="h-4 w-4" /></IconBtn><IconBtn size="sm" aria-label="Último" disabled={nav.index >= nav.total - 1} onClick={() => nav.go(nav.total - 1)}><ChevronsRight className="h-4 w-4" /></IconBtn></>}
        </span>
      </div>
      {/* painéis */}
      {panels.length > 1 ? <PanelTabs panels={panels.map((p) => ({ id: p.id, label: p.label }))} render={renderPanel} stacked={stacked} onToggleStacked={() => setStacked((s) => !s)} /> : renderPanel(panels[0]?.id ?? l.panels[0]!.id)}
      {!isNew && q.data && <div className="px-2 text-[11px] text-slate-400">Criado em {dateTimeBR(q.data["created_at"] as string)} · atualizado em {dateTimeBR(q.data["updated_at"] as string)}</div>}
      <Confirm open={confirmDel} onOpenChange={setConfirmDel} title="Confirme a exclusão" text={`Excluir este registro de ${def.label.toLowerCase()}? A ação fica registrada na auditoria.`} danger loading={remove.isPending} onConfirm={() => remove.mutate()} />
    </form>
  );
}
function PanelTabs({ panels, render, stacked, onToggleStacked }: { panels: { id: string; label: string }[]; render: (id: string) => React.ReactNode; stacked: boolean; onToggleStacked: () => void }) {
  const [active, setActive] = React.useState(panels[0]?.id ?? "");
  const cur = panels.some((p) => p.id === active) ? active : panels[0]?.id ?? "";
  return <div>
    <div className="mb-2 flex items-center gap-1 border-b px-1">
      <IconBtn size="sm" aria-label={stacked ? "Exibir painéis em abas" : "Exibir painéis empilhados"} title={stacked ? "Exibir painéis em abas" : "Exibir painéis empilhados"} onClick={onToggleStacked} className="mr-1">{stacked ? <PanelTop className="h-4 w-4" /> : <Rows3 className="h-4 w-4" />}</IconBtn>
      {panels.map((p) => <button key={p.id} type="button" role="tab" aria-selected={!stacked && cur === p.id} onClick={() => setActive(p.id)} className={cn("-mb-px border-b-2 px-3 py-2 text-[12.5px] font-medium", !stacked && cur === p.id ? "border-slate-800 text-slate-900" : "border-transparent text-slate-500 hover:text-slate-800")}>{p.label}</button>)}
    </div>
    {/* todos os painéis ficam montados para que a validação e os valores não se percam ao trocar de aba */}
    {panels.map((p) => <div key={p.id} className={cn(!stacked && cur !== p.id && "hidden", stacked && "mb-3")}>{stacked && <div className="mb-1 px-1 text-[12px] font-semibold text-slate-600">{p.label}</div>}{render(p.id)}</div>)}
  </div>;
}
