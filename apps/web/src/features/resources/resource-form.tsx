"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm, Controller } from "react-hook-form";
import { toast } from "sonner";
import { getResource, type FieldDef } from "@agro/domain";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { dateTimeBR } from "@/lib/utils";
import { Button, Card, CardHeader, CardBody, Input, NativeSelect, Textarea, Field, Spinner, ErrorBox } from "@/components/ui";
import { RefSelect } from "@/components/ui/ref-select";
import { ArrowLeft } from "lucide-react";

type Values = Record<string, unknown>;
function defaults(fields: FieldDef[], preset: Record<string, string>): Values { const v: Values = {}; for (const f of fields) v[f.name] = preset[f.name] ?? (f.default !== undefined ? f.default : f.type === "boolean" ? false : f.type === "tags" ? [] : f.type === "json" ? {} : ""); return v; }
function toApi(fields: FieldDef[], v: Values): Values { const o: Values = {}; for (const f of fields) { if (f.readOnly) continue; let x = v[f.name]; if (x === "" || x === undefined) x = null; if (f.type === "json" && typeof x === "string") { try { x = JSON.parse(x); } catch { throw new Error(`JSON inválido em ${f.label}`); } } if (f.type === "integer" && x !== null) x = Number(x); if (f.type === "boolean") x = Boolean(x); if (f.type === "date" && typeof x === "string") x = x.slice(0, 10); if (x === null && !f.required && f.type === "boolean") x = false; if (x === null && ["money", "quantity", "number", "percent", "integer"].includes(f.type)) continue; /* numérico vazio: deixa o default do banco (0) valer */ o[f.name] = x; } return o; }

export function ResourceForm({ resourceKey, id, basePath, afterSave }: { resourceKey: string; id: string; basePath?: string; afterSave?: (row: Values) => void }) {
  const def = getResource(resourceKey); const router = useRouter(); const sp = useSearchParams(); const qc = useQueryClient(); const { can } = useAuth();
  const isNew = id === "new"; const readOnly = sp.get("view") === "1" || (!isNew && !can(`${def?.permission}.edit`));
  const preset = React.useMemo(() => { const p: Record<string, string> = {}; sp.forEach((v, k) => { if (k !== "view") p[k] = v; }); return p; }, [sp]);
  const q = useQuery({ queryKey: ["res", resourceKey, id], queryFn: () => api<Values>(`/api/resources/${resourceKey}/${id}`), enabled: !isNew });
  const form = useForm<Values>({ defaultValues: defaults(def?.fields ?? [], preset) });
  React.useEffect(() => { if (q.data && def) { const v: Values = {}; for (const f of def.fields) { const x = q.data[f.name]; v[f.name] = f.type === "json" ? JSON.stringify(x ?? {}, null, 2) : x === null || x === undefined ? (f.type === "tags" ? [] : "") : f.type === "date" ? String(x).slice(0, 10) : x; } form.reset(v); } }, [q.data, def, form]);
  const save = useMutation({
    mutationFn: (v: Values) => isNew ? api<Values>(`/api/resources/${resourceKey}`, { method: "POST", body: toApi(def!.fields, v) }) : api<Values>(`/api/resources/${resourceKey}/${id}`, { method: "PUT", body: toApi(def!.fields, v) }),
    onSuccess: (row) => { toast.success("Salvo com sucesso"); void qc.invalidateQueries({ queryKey: ["res", resourceKey] }); if (afterSave) afterSave(row); else router.push(basePath ?? `/cadastros/${resourceKey}`); },
    onError: (e) => { const err = e as Error & { details?: { path: string; message: string }[] }; toast.error(err.message); err.details?.forEach?.((d) => { if (d.path) form.setError(d.path, { message: d.message }); }); }
  });
  if (!def) return <div>Recurso desconhecido</div>;
  if (!isNew && q.isLoading) return <Spinner />;
  if (q.error) return <ErrorBox error={q.error} />;
  const sections = [...new Set(def.fields.map((f) => f.section ?? ""))];
  const values = form.watch();
  const visible = (f: FieldDef) => !f.visibleWhen || values[f.visibleWhen.field] === f.visibleWhen.equals || String(values[f.visibleWhen.field]) === String(f.visibleWhen.equals);
  const back = basePath ?? `/cadastros/${resourceKey}`;
  return (
    <form onSubmit={form.handleSubmit((v) => save.mutate(v))}>
      <Card>
        <CardHeader title={`${def.label} ${isNew ? "— novo" : readOnly ? "— visualizar" : "— editar"}`} actions={<><Link href={back}><Button variant="outline" size="sm"><ArrowLeft className="h-3.5 w-3.5" /> Voltar</Button></Link>{!readOnly && <Button type="submit" size="sm" loading={save.isPending}>Salvar</Button>}</>} />
        <CardBody className="space-y-4">
          {sections.map((s) => <div key={s}>{s && <h3 className="mb-2 border-b pb-1 text-xs font-semibold uppercase tracking-wide text-brand-700">{s}</h3>}<div className="grid grid-cols-12 gap-3">
            {def.fields.filter((f) => (f.section ?? "") === s && visible(f) && !(isNew && f.readOnly && f.name === "code")).map((f) => {
              const err = form.formState.errors[f.name]?.message as string | undefined; const dis = readOnly || f.readOnly;
              return <Field key={f.name} label={f.label} required={f.required} error={err} help={f.help} span={f.span ?? 3}>
                {f.type === "ref" ? <Controller name={f.name} control={form.control} rules={{ required: f.required ? "Obrigatório" : false }} render={({ field }) => <RefSelect resource={f.ref!.resource} value={field.value as string} onChange={(v) => field.onChange(v ?? "")} disabled={dis} includeInactive={!isNew} />} /> :
                 f.type === "select" ? <NativeSelect disabled={dis} {...form.register(f.name, { required: f.required ? "Obrigatório" : false })}><option value="">Selecione</option>{f.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</NativeSelect> :
                 f.type === "boolean" ? <NativeSelect disabled={dis} value={values[f.name] === true || values[f.name] === "true" ? "true" : "false"} onChange={(e) => form.setValue(f.name, e.target.value === "true")}><option value="true">Sim</option><option value="false">Não</option></NativeSelect> :
                 f.type === "textarea" || f.type === "json" ? <Textarea readOnly={dis} className={f.type === "json" ? "font-mono text-xs" : ""} {...form.register(f.name, { required: f.required ? "Obrigatório" : false })} /> :
                 f.type === "tags" ? <div className="flex flex-wrap gap-2 pt-1">{f.options?.map((o) => <label key={o.value} className="flex items-center gap-1 text-[13px]"><input type="checkbox" disabled={dis} checked={(values[f.name] as string[] | undefined)?.includes(o.value) ?? false} onChange={(e) => { const cur = new Set((values[f.name] as string[]) ?? []); if (e.target.checked) cur.add(o.value); else cur.delete(o.value); form.setValue(f.name, [...cur]); }} />{o.label}</label>)}</div> :
                 <Input readOnly={dis} type={f.type === "date" ? "date" : f.type === "email" ? "email" : ["money", "quantity", "number", "percent", "integer"].includes(f.type) ? "number" : "text"} step={f.type === "integer" ? 1 : f.type === "money" ? "0.01" : "0.0001"} maxLength={f.maxLength} {...form.register(f.name, { required: f.required ? "Obrigatório" : false })} />}
              </Field>;
            })}
          </div></div>)}
          {!isNew && q.data && <div className="border-t pt-2 text-[11px] text-slate-400">Informações do sistema: criado em {dateTimeBR(q.data["created_at"] as string)} · atualizado em {dateTimeBR(q.data["updated_at"] as string)}</div>}
        </CardBody>
      </Card>
    </form>
  );
}
