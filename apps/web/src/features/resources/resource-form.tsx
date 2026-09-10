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
import { Button, Card, CardHeader, CardBody, Input, NativeSelect, Textarea, Field, Spinner, ErrorBox } from "@/components/ui";
import { RefSelect } from "@/components/ui/ref-select";
import { ArrowLeft, ChevronDown, ChevronRight } from "lucide-react";
import { useFormLayout, FormLayoutConfigurator, FormLayoutButton } from "./form-layout";

type Values = Record<string, unknown>;
function defaults(fields: FieldDef[], preset: Record<string, string>, layoutDefaults: Record<string, unknown>): Values { const v: Values = {}; for (const f of fields) { const ld = layoutDefaults[f.name]; v[f.name] = preset[f.name] ?? (ld !== undefined ? (f.type === "boolean" ? ld === true || ld === "true" : ld) : f.default !== undefined ? f.default : f.type === "boolean" ? false : f.type === "tags" ? [] : f.type === "json" ? {} : ""); } return v; }
function toApi(fields: FieldDef[], v: Values): Values { const o: Values = {}; for (const f of fields) { if (f.readOnly) continue; let x = v[f.name]; if (x === "" || x === undefined) x = null; if (f.type === "json" && typeof x === "string") { try { x = JSON.parse(x); } catch { throw new Error(`JSON inválido em ${f.label}`); } } if (f.type === "integer" && x !== null) x = Number(x); if (f.type === "boolean") x = Boolean(x); if (f.type === "date" && typeof x === "string") x = x.slice(0, 10); if (x === null && !f.required && f.type === "boolean") x = false; if (x === null && ["money", "quantity", "number", "percent", "integer"].includes(f.type)) continue; /* numérico vazio: deixa o default do banco (0) valer */ o[f.name] = x; } return o; }

/** Controle de um campo declarativo (mesmo componente para todos os tipos). */
function FieldControl({ f, form, dis, required, isNew, values, id }: { f: FieldDef; form: UseFormReturn<Values>; dis: boolean; required: boolean; isNew: boolean; values: Values; id?: string }) {
  const rules = { required: required ? "Obrigatório" : false };
  if (f.type === "ref") return <Controller name={f.name} control={form.control} rules={rules} render={({ field }) => <RefSelect resource={f.ref!.resource} value={field.value as string} onChange={(v) => field.onChange(v ?? "")} disabled={dis} includeInactive={!isNew} />} />;
  if (f.type === "select") return <NativeSelect id={id} disabled={dis} {...form.register(f.name, rules)}><option value="">Selecione</option>{f.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</NativeSelect>;
  if (f.type === "boolean") return <NativeSelect id={id} disabled={dis} value={values[f.name] === true || values[f.name] === "true" ? "true" : "false"} onChange={(e) => form.setValue(f.name, e.target.value === "true")}><option value="true">Sim</option><option value="false">Não</option></NativeSelect>;
  if (f.type === "textarea" || f.type === "json") return <Textarea id={id} readOnly={dis} className={f.type === "json" ? "font-mono text-xs" : ""} {...form.register(f.name, rules)} />;
  if (f.type === "tags") return <div className="flex flex-wrap gap-2 pt-1">{f.options?.map((o) => <label key={o.value} className="flex items-center gap-1 text-[13px]"><input type="checkbox" disabled={dis} checked={(values[f.name] as string[] | undefined)?.includes(o.value) ?? false} onChange={(e) => { const cur = new Set((values[f.name] as string[]) ?? []); if (e.target.checked) cur.add(o.value); else cur.delete(o.value); form.setValue(f.name, [...cur]); }} />{o.label}</label>)}</div>;
  return <Input id={id} readOnly={dis} type={f.type === "date" ? "date" : f.type === "email" ? "email" : ["money", "quantity", "number", "percent", "integer"].includes(f.type) ? "number" : "text"} step={f.type === "integer" ? 1 : f.type === "money" ? "0.01" : "0.0001"} maxLength={f.maxLength} {...form.register(f.name, rules)} />;
}

function LayoutCardView({ label, collapsible, colSpan, children }: { label: string; collapsible?: boolean; colSpan: 6 | 12; children: React.ReactNode }) {
  const [open, setOpen] = React.useState(true);
  return <div className={cn("col-span-12", colSpan === 6 && "md:col-span-6")}>
    <h3 className="mb-2 flex items-center gap-1 border-b pb-1 text-xs font-semibold uppercase tracking-wide text-brand-700">{collapsible ? <button type="button" className="flex items-center gap-1" onClick={() => setOpen((o) => !o)}>{open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}{label}</button> : label}</h3>
    {open && <div className="grid grid-cols-12 gap-3">{children}</div>}
  </div>;
}

/**
 * Formulário genérico de cadastros ("modelo base"): renderiza o layout configurável (painéis → cards → linhas → campos)
 * com campos ocultos/travados/obrigatórios, tamanhos, rótulos e valores padrão definidos pelo usuário ou pela organização.
 */
export function ResourceForm({ resourceKey, id, basePath, afterSave }: { resourceKey: string; id: string; basePath?: string; afterSave?: (row: Values) => void }) {
  const def = getResource(resourceKey); const router = useRouter(); const sp = useSearchParams(); const qc = useQueryClient(); const { can } = useAuth();
  const fields = React.useMemo(() => def?.fields ?? [], [def]);
  const layout = useFormLayout(resourceKey, fields);
  const l: FormLayout = layout.prefs;
  const isNew = id === "new"; const readOnly = sp.get("view") === "1" || (!isNew && !can(`${def?.permission}.edit`));
  const preset = React.useMemo(() => { const p: Record<string, string> = {}; sp.forEach((v, k) => { if (k !== "view") p[k] = v; }); return p; }, [sp]);
  const q = useQuery({ queryKey: ["res", resourceKey, id], queryFn: () => api<Values>(`/api/resources/${resourceKey}/${id}`), enabled: !isNew });
  const form = useForm<Values>({ defaultValues: defaults(fields, preset, l.fieldDefaultValues) });
  const appliedDefaults = React.useRef(false);
  React.useEffect(() => { if (isNew && layout.loaded && !appliedDefaults.current && Object.keys(l.fieldDefaultValues).length) { appliedDefaults.current = true; form.reset(defaults(fields, preset, l.fieldDefaultValues)); } }, [isNew, layout.loaded, l.fieldDefaultValues, fields, preset, form]);
  React.useEffect(() => { if (q.data && def) { const v: Values = {}; for (const f of def.fields) { const x = q.data[f.name]; v[f.name] = f.type === "json" ? JSON.stringify(x ?? {}, null, 2) : x === null || x === undefined ? (f.type === "tags" ? [] : "") : f.type === "date" ? String(x).slice(0, 10) : x; } form.reset(v); } }, [q.data, def, form]);
  const [cfg, setCfg] = React.useState(false);
  const save = useMutation({
    mutationFn: (v: Values) => isNew ? api<Values>(`/api/resources/${resourceKey}`, { method: "POST", body: toApi(def!.fields, v) }) : api<Values>(`/api/resources/${resourceKey}/${id}`, { method: "PUT", body: toApi(def!.fields, v) }),
    onSuccess: (row) => { toast.success("Salvo com sucesso"); void qc.invalidateQueries({ queryKey: ["res", resourceKey] }); if (afterSave) afterSave(row); else router.push(basePath ?? `/cadastros/${resourceKey}`); },
    onError: (e) => { const err = e as Error & { details?: { path: string; message: string }[] }; toast.error(err.message); err.details?.forEach?.((d) => { if (d.path) form.setError(d.path, { message: d.message }); }); }
  });
  if (!def) return <div>Recurso desconhecido</div>;
  if (!isNew && q.isLoading) return <Spinner />;
  if (q.error) return <ErrorBox error={q.error} />;
  const values = form.watch();
  const visible = (f: FieldDef) => !l.hiddenFieldIds.includes(f.name) && (!f.visibleWhen || values[f.visibleWhen.field] === f.visibleWhen.equals || String(values[f.visibleWhen.field]) === String(f.visibleWhen.equals)) && !(isNew && f.readOnly && f.name === "code");
  const back = basePath ?? `/cadastros/${resourceKey}`;
  const byId = new Map(fields.map((f) => [f.name, f]));
  const renderField = (fid: string) => {
    const f = byId.get(fid); if (!f || !visible(f)) return null;
    const err = form.formState.errors[f.name]?.message as string | undefined; const dis = readOnly || Boolean(f.readOnly) || l.lockedFieldIds.includes(f.name);
    const required = Boolean(f.required) || l.requiredFieldIds.includes(f.name);
    return <Field key={f.name} label={l.fieldLabels[f.name] ?? f.label} required={required} error={err} help={f.help} span={l.fieldSizes[f.name] ?? f.span ?? 3}><FieldControl f={f} form={form} dis={dis} required={required} isNew={isNew} values={values} /></Field>;
  };
  const panels = l.panels.filter((p) => !p.hidden);
  const renderPanel = (panelId: string) => <div className="grid grid-cols-12 gap-4">{l.cards.filter((c) => c.panelId === panelId).map((c) => { const ids = cardFieldIds(c).filter((fid) => { const f = byId.get(fid); return f && visible(f); }); if (!ids.length) return null; return <LayoutCardView key={c.id} label={c.label} collapsible={c.collapsible} colSpan={c.colSpan}>{c.rows.map((r) => r.fieldIds.map(renderField))}</LayoutCardView>; })}</div>;
  return (
    <form onSubmit={form.handleSubmit((v) => save.mutate(v))}>
      <Card>
        <CardHeader title={`${def.label} ${isNew ? "— novo" : readOnly ? "— visualizar" : "— editar"}`} actions={<><FormLayoutButton onClick={() => setCfg(true)} customized={layout.source !== "default"} /><Link href={back}><Button variant="outline" size="sm"><ArrowLeft className="h-3.5 w-3.5" /> Voltar</Button></Link>{!readOnly && <Button type="submit" size="sm" loading={save.isPending}>Salvar</Button>}</>} />
        <CardBody className="space-y-4">
          {panels.length > 1 ? <PanelTabs panels={panels.map((p) => ({ id: p.id, label: p.label }))} render={renderPanel} /> : renderPanel(panels[0]?.id ?? l.panels[0]!.id)}
          {!isNew && q.data && <div className="border-t pt-2 text-[11px] text-slate-400">Informações do sistema: criado em {dateTimeBR(q.data["created_at"] as string)} · atualizado em {dateTimeBR(q.data["updated_at"] as string)}</div>}
        </CardBody>
      </Card>
      <FormLayoutConfigurator open={cfg} onOpenChange={setCfg} p={layout} resourceLabel={def.label} />
    </form>
  );
}
function PanelTabs({ panels, render }: { panels: { id: string; label: string }[]; render: (id: string) => React.ReactNode }) {
  const [active, setActive] = React.useState(panels[0]?.id ?? "");
  const cur = panels.some((p) => p.id === active) ? active : panels[0]?.id ?? "";
  return <div>
    <div className="mb-3 flex flex-wrap gap-1 border-b">{panels.map((p) => <button key={p.id} type="button" onClick={() => setActive(p.id)} className={cn("border-b-2 px-3 py-1.5 text-xs font-medium", cur === p.id ? "border-brand-600 text-brand-700" : "border-transparent text-slate-500")}>{p.label}</button>)}</div>
    {/* todos os painéis ficam montados para que a validação e os valores não se percam ao trocar de aba */}
    {panels.map((p) => <div key={p.id} className={cn(cur !== p.id && "hidden")}>{render(p.id)}</div>)}
  </div>;
}
