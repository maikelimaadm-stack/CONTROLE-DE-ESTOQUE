"use client";
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, X, Loader2 } from "lucide-react";
import { FILTER_OPERATORS, operatorArity, isListOperator } from "@agro/shared";
import { api, qs } from "@/lib/api";
import { cn } from "@/lib/utils";
import { NativeSelect } from "@/components/ui";
import { B1Popover, PillBtn, CheckRow, RoundInput } from "./ui";
import { emptyValue, isActive, describe } from "./params";
import type { Base1FilterDef, FilterValue, DistinctValue } from "./types";

/**
 * Chip de filtro por coluna (faixa de filtros do modelo base). Ao abrir: título, "Limpar filtro", operador,
 * pesquisa e lista de valores distintos com seleção múltipla ("(Selecionar Tudo)"), ou campo de valor para
 * operadores que não usam lista. Cancelar descarta; OK aplica.
 */
export function FilterChip({ f, value, onApply, onClear, distinct, open, onOpenChange, scope }: { f: Base1FilterDef; value: FilterValue | undefined; onApply: (v: FilterValue) => void; onClear: () => void; distinct?: (search: string) => Promise<DistinctValue[]>; open?: boolean; onOpenChange?: (o: boolean) => void; /** identifica a tela/tenant/fazenda de origem dos valores (chave de cache) */ scope?: string }) {
  const [localOpen, setLocalOpen] = React.useState(false);
  const isOpen = open ?? localOpen; const setOpen = onOpenChange ?? setLocalOpen;
  const [draft, setDraft] = React.useState<FilterValue>(value ?? emptyValue(f));
  const [search, setSearch] = React.useState("");
  React.useEffect(() => { if (isOpen) { setDraft(value ?? emptyValue(f)); setSearch(""); } }, [isOpen]);
  const ops = f.mode === "advanced" ? FILTER_OPERATORS[f.kind] : [];
  const listCapable = f.kind === "enum" || f.kind === "ref" || f.kind === "boolean" || (f.mode === "advanced" && (f.kind === "text" || f.kind === "number") && Boolean(distinct));
  const useList = listCapable && (f.mode === "simple" || isListOperator(draft.op) || draft.op === "eq" || draft.op === "ne");
  const q = useQuery({
    queryKey: ["b1-distinct", scope ?? "", f.key, f.resource, f.resourceFilter ?? null, search],
    queryFn: async (): Promise<DistinctValue[]> => {
      if (f.options) return f.options.filter((o) => !search || o.label.toLowerCase().includes(search.toLowerCase()));
      if (f.kind === "boolean") return [{ value: "true", label: "Sim" }, { value: "false", label: "Não" }];
      if (distinct) return distinct(search);
      if (f.resource) { const r = await api<{ id: string; label: string; code?: string | null }[]>(`/api/resources/${f.resource}/options${qs({ search, ...(f.resourceFilter ?? {}) })}`); return r.map((o) => ({ value: o.id, label: o.code ? `${o.code} · ${o.label}` : o.label })); }
      return [];
    },
    enabled: isOpen && useList, staleTime: 30_000
  });
  const values = q.data ?? [];
  const selected = new Set(draft.values ?? (draft.value ? [draft.value] : []));
  const allSelected = values.length > 0 && values.every((v) => selected.has(v.value));
  const toggle = (v: string, on: boolean) => { const s = new Set(selected); if (on) s.add(v); else s.delete(v); setDraft({ ...draft, values: [...s], value: "" }); };
  const labelCache = React.useRef<Record<string, string>>({});
  values.forEach((v) => { labelCache.current[v.value] = v.label; });
  const labelOf = (v: string) => labelCache.current[v] ?? f.options?.find((o) => o.value === v)?.label ?? (f.kind === "boolean" ? (v === "true" ? "Sim" : "Não") : v);
  const active = isActive(f, value);
  const desc = describe(f, value, labelOf);
  const apply = () => {
    let v = { ...draft };
    if (useList) { const list = [...selected]; if (f.mode === "simple") v = { op: "eq", value: list[0] ?? "", values: list.slice(0, 1) }; else if (list.length > 1 || isListOperator(v.op)) v = { op: "in", value: "", values: list }; else v = { ...v, value: list[0] ?? "", values: [] }; }
    onApply(v); setOpen(false);
  };
  const arity = f.mode === "advanced" ? operatorArity(f.kind, draft.op) : (f.kind === "date" ? 2 : 1);
  const inputType = f.kind === "date" ? "date" : f.kind === "number" ? "number" : "text";
  return <B1Popover open={isOpen} onOpenChange={setOpen} align="start" className="w-[280px] p-0"
    trigger={<span className={cn("mg-filter-pill", isOpen && "is-open", active && "is-active")}><button type="button" aria-label={`Filtro ${f.label}`} className="mg-filter-pill__trigger"><span className="truncate">{f.label}{desc && <span className="ml-1 font-normal text-slate-500">· {desc}</span>}</span></button><span className="mg-filter-pill__icon"><ChevronDown /></span></span>}>
    <div className="px-3 pt-2.5">
      <div className="text-[12px] font-semibold text-slate-700">{f.label}</div>
      <button type="button" onClick={() => { onClear(); setOpen(false); }} disabled={!active} className="mt-1 flex items-center gap-1.5 text-[11.5px] text-slate-500 hover:text-red-600 disabled:opacity-40"><X className="h-3.5 w-3.5" /> Limpar Filtro de &apos;{f.label}&apos;</button>
      {ops.length > 0 && <NativeSelect aria-label={`Operador ${f.label}`} className="mt-2 h-8 rounded-lg bg-slate-50" value={draft.op} onChange={(e) => setDraft({ ...emptyValue(f, e.target.value) })}>{ops.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</NativeSelect>}
      {arity === 0 ? <div className="mt-2 rounded-lg bg-slate-50 px-2 py-1.5 text-[11.5px] text-slate-500">Este operador não usa valor.</div>
        : useList ? <>
          <div className="relative mt-2"><RoundInput aria-label={`Pesquisar ${f.label}`} placeholder="Pesquisar…" value={search} onChange={(e) => setSearch(e.target.value)} />{q.isFetching && <Loader2 className="absolute right-3 top-2 h-4 w-4 animate-spin text-slate-400" />}</div>
          <div className="mt-2 max-h-52 overflow-auto rounded-lg border">
            {f.mode === "advanced" && <CheckRow checked={allSelected} onChange={(on) => setDraft({ ...draft, value: "", values: on ? values.map((v) => v.value) : [] })} label="(Selecionar Tudo)" />}
            {values.map((v) => <CheckRow key={v.value} checked={selected.has(v.value)} onChange={(on) => (f.mode === "simple" ? setDraft({ ...draft, value: v.value, values: on ? [v.value] : [] }) : toggle(v.value, on))} label={v.label} hint={v.count !== undefined ? String(v.count) : undefined} />)}
            {!q.isLoading && values.length === 0 && <div className="px-2 py-3 text-center text-[11.5px] text-slate-400">Nenhum valor</div>}
          </div>
        </> : <div className="mt-2 flex gap-1">
          <RoundInput type={inputType} aria-label={arity === 2 ? `${f.label} de` : f.label} value={draft.value} onChange={(e) => setDraft({ ...draft, value: e.target.value, values: [] })} onKeyDown={(e) => { if (e.key === "Enter") apply(); }} autoFocus />
          {arity === 2 && <RoundInput type={inputType} aria-label={`${f.label} até`} value={draft.value2 ?? ""} onChange={(e) => setDraft({ ...draft, value2: e.target.value })} onKeyDown={(e) => { if (e.key === "Enter") apply(); }} />}
        </div>}
    </div>
    <div className="flex gap-2 px-3 py-2.5"><PillBtn tone="gray" className="flex-1 justify-center" onClick={() => setOpen(false)}>Cancelar</PillBtn><PillBtn className="flex-1 justify-center" onClick={apply}>OK</PillBtn></div>
  </B1Popover>;
}
