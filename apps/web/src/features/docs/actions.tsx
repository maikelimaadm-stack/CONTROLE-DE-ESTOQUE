"use client";
import * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "@/lib/toast";
import { api, newIdem } from "@/lib/api";
import { Button, Dialog, Field, Input, Textarea, NativeSelect } from "@/components/ui";
import { RefSelect } from "@/components/ui/ref-select";

/** Mutação POST genérica com invalidação de cache e toast. */
export function useAction<T = unknown>(onDone?: (r: T) => void) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ path, body, method = "POST", idem }: { path: string; body?: unknown; method?: string; idem?: boolean }) => api<T>(path, { method, body, idempotencyKey: idem ? newIdem() : undefined }),
    onSuccess: (r) => { toast.success("Operação concluída"); void qc.invalidateQueries(); onDone?.(r); },
    onError: (e) => toast.error((e as Error).message)
  });
}

export interface ActionField { name: string; label: string; type?: "text" | "textarea" | "date" | "number" | "select" | "ref"; required?: boolean; options?: { value: string; label: string }[]; resource?: string; filter?: Record<string, string>; default?: string; span?: number }

/** Diálogo genérico para ações com formulário curto (justificativa, data, conta, etc.). */
export function ActionDialog({ open, onOpenChange, title, text, fields, onSubmit, loading, danger, submitLabel = "Confirmar" }: { open: boolean; onOpenChange: (o: boolean) => void; title: string; text?: string; fields: ActionField[]; onSubmit: (values: Record<string, string>) => void; loading?: boolean; danger?: boolean; submitLabel?: string }) {
  const [v, setV] = React.useState<Record<string, string>>({});
  React.useEffect(() => { if (open) setV(Object.fromEntries(fields.map((f) => [f.name, f.default ?? ""]))); }, [open]);
  const missing = fields.some((f) => f.required && !v[f.name]);
  return <Dialog open={open} onOpenChange={onOpenChange} title={title} footer={<><Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Cancelar</Button><Button size="sm" variant={danger ? "danger" : "default"} loading={loading} disabled={missing} onClick={() => onSubmit(v)}>{submitLabel}</Button></>}>
    {text && <p className="mb-3 text-sm text-slate-600">{text}</p>}
    <div className="grid grid-cols-12 gap-2">
      {fields.map((f) => <Field key={f.name} label={f.label} required={f.required} span={f.span ?? (f.type === "textarea" ? 12 : 6)}>
        {f.type === "textarea" ? <Textarea value={v[f.name] ?? ""} onChange={(e) => setV({ ...v, [f.name]: e.target.value })} />
          : f.type === "select" ? <NativeSelect value={v[f.name] ?? ""} onChange={(e) => setV({ ...v, [f.name]: e.target.value })}><option value="">Selecione</option>{f.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</NativeSelect>
          : f.type === "ref" ? <RefSelect resource={f.resource!} value={v[f.name] ?? null} onChange={(x) => setV({ ...v, [f.name]: x ?? "" })} filter={f.filter} />
          : <Input type={f.type === "number" ? "number" : f.type === "date" ? "date" : "text"} step={f.type === "number" ? "0.01" : undefined} value={v[f.name] ?? ""} onChange={(e) => setV({ ...v, [f.name]: e.target.value })} />}
      </Field>)}
    </div>
  </Dialog>;
}
