"use client";
import * as React from "react";
import { Bookmark, X } from "lucide-react";
import { toast } from "sonner";
import { FILTER_OPERATORS, defaultOperatorFor, operatorArity, filterKey, encodeRange, decodeRange, parseFilterKey, type FilterKind, type ListPreferences, type SavedFilter } from "@agro/shared";
import { Button, Input, NativeSelect, Field, Menu, Dialog } from "@/components/ui";
import { RefSelect } from "@/components/ui/ref-select";

export interface AdvancedFilterField { key: string; label: string; kind: FilterKind; resource?: string; options?: { value: string; label: string }[] }
export interface FilterValue { op: string; value: string; value2?: string }
export type FilterValues = Record<string, FilterValue>;

/** Converte os valores da barra de filtros em parâmetros de query (`campo__operador=valor`). */
export function toQueryParams(fields: AdvancedFilterField[], values: FilterValues): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of fields) {
    const v = values[f.key]; if (!v) continue;
    const arity = operatorArity(f.kind, v.op);
    if (arity === 0) out[filterKey(f.key, v.op)] = "1";
    else if (arity === 2) { if (v.value && v.value2) out[filterKey(f.key, v.op)] = encodeRange(v.value, v.value2); }
    else if (v.value !== "" && v.value !== undefined) out[filterKey(f.key, v.op)] = v.value;
  }
  return out;
}
/** Reconstrói os valores da barra a partir de parâmetros (ex.: filtro salvo ou URL). */
export function fromQueryParams(fields: AdvancedFilterField[], params: Record<string, string>, ops?: Record<string, string>): FilterValues {
  const out: FilterValues = {};
  for (const [k, v] of Object.entries(params)) {
    const p = parseFilterKey(k); const f = fields.find((x) => x.key === (p?.field ?? k)); if (!f) continue;
    const op = p?.op ?? ops?.[f.key] ?? defaultOperatorFor(f.kind);
    if (operatorArity(f.kind, op) === 2) { const [a, b] = decodeRange(v); out[f.key] = { op, value: a, value2: b }; } else out[f.key] = { op, value: v };
  }
  return out;
}

function ValueInput({ f, v, onChange }: { f: AdvancedFilterField; v: FilterValue; onChange: (x: FilterValue) => void }) {
  const arity = operatorArity(f.kind, v.op);
  if (arity === 0) return <span className="block h-8 rounded border border-dashed px-2 py-1.5 text-[11px] text-slate-400">sem valor</span>;
  if (f.kind === "ref" && f.resource) return <RefSelect resource={f.resource} value={v.value || null} onChange={(x) => onChange({ ...v, value: x ?? "" })} placeholder="Todos" />;
  if (f.kind === "boolean") return <NativeSelect value={v.value} onChange={(e) => onChange({ ...v, value: e.target.value })}><option value="">Todos</option><option value="true">Sim</option><option value="false">Não</option></NativeSelect>;
  if (f.kind === "enum") return <NativeSelect value={v.value} onChange={(e) => onChange({ ...v, value: e.target.value })}><option value="">Todos</option>{f.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</NativeSelect>;
  const type = f.kind === "date" ? "date" : f.kind === "number" ? "number" : "text";
  if (arity === 2) return <div className="flex gap-1"><Input type={type} value={v.value} onChange={(e) => onChange({ ...v, value: e.target.value })} aria-label={`${f.label} de`} /><Input type={type} value={v.value2 ?? ""} onChange={(e) => onChange({ ...v, value2: e.target.value })} aria-label={`${f.label} até`} /></div>;
  return <Input type={type} value={v.value} onChange={(e) => onChange({ ...v, value: e.target.value })} />;
}

/**
 * Barra de filtros com operadores por campo, campos visíveis configuráveis e filtros salvos.
 * `search` é a pesquisa textual livre (opcional).
 */
export function AdvancedFilterBar({ fields, prefs, updatePrefs, values, onChange, onApply, onClear, search, onSearch, searchLabel }: { fields: AdvancedFilterField[]; prefs: ListPreferences; updatePrefs: (fn: (p: ListPreferences) => ListPreferences) => void; values: FilterValues; onChange: (v: FilterValues) => void; onApply: () => void; onClear: () => void; search?: string; onSearch?: (s: string) => void; searchLabel?: string }) {
  const visible = fields.filter((f) => (prefs.filters.visible ?? fields.map((x) => x.key)).includes(f.key));
  const [saveOpen, setSaveOpen] = React.useState(false); const [saveName, setSaveName] = React.useState("");
  const saved = prefs.filters.saved ?? [];
  const get = (f: AdvancedFilterField): FilterValue => values[f.key] ?? { op: prefs.filters.operators?.[f.key] ?? defaultOperatorFor(f.kind), value: "" };
  const setV = (f: AdvancedFilterField, v: FilterValue) => onChange({ ...values, [f.key]: v });
  const applySaved = (s: SavedFilter) => { onChange(fromQueryParams(fields, s.values, prefs.filters.operators)); if (onSearch) onSearch(s.values["search"] ?? ""); setTimeout(onApply, 0); };
  const saveCurrent = () => { const name = saveName.trim(); if (!name) return; const params = toQueryParams(fields, values); if (search) params["search"] = search; updatePrefs((p) => ({ ...p, filters: { ...p.filters, saved: [...(p.filters.saved ?? []).filter((x) => x.name !== name), { name, values: params }] } })); setSaveOpen(false); setSaveName(""); toast.success(`Filtro "${name}" salvo`); };
  const removeSaved = (name: string) => updatePrefs((p) => ({ ...p, filters: { ...p.filters, saved: (p.filters.saved ?? []).filter((x) => x.name !== name) } }));
  const active = Object.entries(values).filter(([k, v]) => { const f = fields.find((x) => x.key === k); return f && v && (operatorArity(f.kind, v.op) === 0 || v.value); }).length;
  return <form className="mb-3 no-print" onSubmit={(e) => { e.preventDefault(); onApply(); }}>
    <div className="grid grid-cols-12 gap-2">
      {onSearch && <Field label={searchLabel ?? "Pesquisar"} span={3}><Input value={search ?? ""} onChange={(e) => onSearch(e.target.value)} /></Field>}
      {visible.map((f) => { const v = get(f); return <Field key={f.key} label={f.label} span={operatorArity(f.kind, v.op) === 2 ? 4 : 3}>
        <div className="flex gap-1"><NativeSelect className="w-[42%] shrink-0" value={v.op} onChange={(e) => setV(f, { op: e.target.value, value: v.value, value2: v.value2 })} aria-label={`Operador ${f.label}`}>{FILTER_OPERATORS[f.kind].map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</NativeSelect><div className="min-w-0 flex-1"><ValueInput f={f} v={v} onChange={(x) => setV(f, x)} /></div></div>
      </Field>; })}
      <div className="col-span-12 flex flex-wrap items-end gap-2 md:col-span-3">
        <Button type="submit" size="sm">Filtrar</Button>
        <Button type="button" size="sm" variant="secondary" onClick={onClear}>Limpar</Button>
        <Menu trigger={<Button type="button" size="sm" variant="outline" title="Filtros salvos"><Bookmark className="h-3.5 w-3.5" /> Filtros salvos{saved.length ? ` (${saved.length})` : ""}</Button>} items={[
          { label: "Salvar filtro atual…", onClick: () => setSaveOpen(true), disabled: active === 0 && !search },
          ...saved.map((s) => ({ label: `Aplicar: ${s.name}`, onClick: () => applySaved(s) })),
          ...saved.map((s) => ({ label: `Excluir: ${s.name}`, danger: true, onClick: () => removeSaved(s.name) }))
        ]} />
        {active > 0 && <span className="text-[11px] text-slate-500">{active} filtro(s) ativo(s) <button type="button" className="ml-1 inline-flex items-center text-red-600" onClick={onClear} aria-label="Limpar filtros"><X className="h-3 w-3" /></button></span>}
      </div>
    </div>
    <Dialog open={saveOpen} onOpenChange={setSaveOpen} title="Salvar filtro" size="sm" footer={<><Button variant="outline" onClick={() => setSaveOpen(false)}>Cancelar</Button><Button onClick={saveCurrent} disabled={!saveName.trim()}>Salvar</Button></>}>
      <Field label="Nome do filtro" span={12}><Input value={saveName} onChange={(e) => setSaveName(e.target.value)} maxLength={60} autoFocus /></Field>
    </Dialog>
  </form>;
}
