"use client";
import * as React from "react";
import { X } from "lucide-react";
import { NativeSelect } from "@/components/ui";
import { RefSelect } from "@/components/ui/ref-select";
import { PillBtn, RoundInput } from "./ui";
import { emptyValue } from "./params";
import type { Base1FilterDef, FilterValues } from "./types";

/** Painel lateral "Filtros" (à esquerda da grade): um campo por filtro, botões Limpar / Aplicar. */
export function FilterDrawer({ open, onClose, filters, values, onChange, onApply, onClear }: { open: boolean; onClose: () => void; filters: Base1FilterDef[]; values: FilterValues; onChange: (v: FilterValues) => void; onApply: () => void; onClear: () => void }) {
  if (!open) return null;
  const get = (f: Base1FilterDef) => values[f.key] ?? emptyValue(f);
  const set = (f: Base1FilterDef, patch: Partial<FilterValues[string]>) => onChange({ ...values, [f.key]: { ...get(f), ...patch } });
  const cls = "h-9 rounded-lg border-0 bg-slate-100 px-3 text-[12.5px] focus:bg-white";
  return <aside data-testid="b1-filters" className="flex w-64 shrink-0 flex-col rounded-2xl bg-white p-3 shadow-sm" aria-label="Filtros">
    <div className="mb-2 flex items-center justify-between"><span className="text-[13px] font-semibold text-slate-800">Filtros</span><button type="button" aria-label="Fechar filtros" onClick={onClose} className="rounded-full p-1 text-slate-500 hover:bg-slate-100"><X className="h-4 w-4" /></button></div>
    <form className="flex min-h-0 flex-1 flex-col gap-2 overflow-auto" onSubmit={(e) => { e.preventDefault(); onApply(); }}>
      {filters.map((f) => { const v = get(f); return <label key={f.key} className="block">
        <span className="mb-1 block text-[11px] text-slate-500">{f.label}</span>
        {f.kind === "ref" && f.resource ? <RefSelect resource={f.resource} value={v.values?.[0] ?? v.value ?? null} onChange={(x) => set(f, { op: f.mode === "simple" ? "eq" : "eq", value: x ?? "", values: x ? [x] : [] })} placeholder="Todos" filter={f.resourceFilter} className={cls} />
          : f.kind === "enum" || f.kind === "boolean" ? <NativeSelect className={cls} value={v.values?.[0] ?? v.value} onChange={(e) => set(f, { op: "eq", value: e.target.value, values: e.target.value ? [e.target.value] : [] })}><option value="">Todos</option>{(f.options ?? (f.kind === "boolean" ? [{ value: "true", label: "Sim" }, { value: "false", label: "Não" }] : [])).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</NativeSelect>
          : f.kind === "date" ? <div className="flex gap-1"><RoundInput type="date" className={cls} aria-label={`${f.label} de`} value={v.value} onChange={(e) => set(f, { op: "between", value: e.target.value })} /><RoundInput type="date" className={cls} aria-label={`${f.label} até`} value={v.value2 ?? ""} onChange={(e) => set(f, { op: "between", value2: e.target.value })} /></div>
          : <RoundInput className={cls} type={f.kind === "number" ? "number" : "text"} value={v.value} onChange={(e) => set(f, { op: f.mode === "advanced" ? (f.kind === "text" ? "contains" : "eq") : "eq", value: e.target.value, values: [] })} />}
      </label>; })}
    </form>
    <div className="mt-3 flex justify-end gap-2"><PillBtn tone="gray" onClick={onClear}>Limpar</PillBtn><PillBtn onClick={onApply}>Aplicar</PillBtn></div>
  </aside>;
}
