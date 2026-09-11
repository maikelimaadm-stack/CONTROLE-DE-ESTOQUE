"use client";
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import * as Popover from "@radix-ui/react-popover";
import { ChevronsUpDown, Check, X } from "lucide-react";
import { api, qs } from "@/lib/api";
import { getResource } from "@agro/domain";
import { cn } from "@/lib/utils";

export interface Option { id: string; label: string; code?: string | null }
/** Select com busca server-side (equivalente ao select2 do sistema de referência), para campos de referência. */
export function RefSelect({ resource, value, onChange, placeholder = "Selecione", filter, disabled, className, allowEmpty = true, includeInactive }: { resource: string; value: string | null | undefined; onChange: (v: string | null, opt?: Option) => void; placeholder?: string; filter?: Record<string, string | undefined>; disabled?: boolean; className?: string; allowEmpty?: boolean; includeInactive?: boolean }) {
  const [open, setOpen] = React.useState(false); const [search, setSearch] = React.useState("");
  const f = Object.fromEntries(Object.entries(filter ?? {}).filter(([, v]) => v));
  const { data, isLoading } = useQuery({ queryKey: ["options", resource, search, f, includeInactive], queryFn: () => api<Option[]>(`/api/resources/${resource}/options${qs({ search, ...f, include_inactive: includeInactive ? "1" : undefined })}`), enabled: open || Boolean(value) });
  const current = data?.find((o) => o.id === value);
  const { data: one } = useQuery({ queryKey: ["option-one", resource, value], queryFn: async () => { const r = await api<Record<string, unknown>>(`/api/resources/${resource}/${value}`); return r; }, enabled: Boolean(value) && !current });
  const def = React.useMemo(() => getResource(resource), [resource]);
  const label = current?.label ?? (one ? String(one[def?.labelField ?? "name"] ?? one["description"] ?? one["name"] ?? "") : "");
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button type="button" disabled={disabled} className={cn("mg-input flex items-center justify-between text-left", !value && "!text-[var(--mg-text-3)]", className)}>
          <span className="truncate">{value ? label || "…" : placeholder}</span>
          <span className="flex items-center gap-1">{value && allowEmpty && !disabled && <X className="h-3.5 w-3.5 text-slate-400 hover:text-red-500" onClick={(e) => { e.stopPropagation(); onChange(null); }} />}<ChevronsUpDown className="h-3.5 w-3.5 text-slate-400" /></span>
        </button>
      </Popover.Trigger>
      <Popover.Portal><Popover.Content align="start" className="z-50 w-[var(--radix-popover-trigger-width)] min-w-[240px] rounded-md border bg-white p-1 shadow-lg">
        <input autoFocus className="mb-1 h-8 w-full rounded border px-2 text-[13px]" placeholder="Pesquisar…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <div className="max-h-56 overflow-auto text-[13px]">
          {isLoading && <div className="p-2 text-slate-400">Carregando…</div>}
          {!isLoading && data?.length === 0 && <div className="p-2 text-slate-400">Nenhum resultado</div>}
          {data?.map((o) => <button type="button" key={o.id} className={cn("flex w-full items-center justify-between rounded px-2 py-1.5 text-left hover:bg-slate-100", o.id === value && "bg-brand-50")} onClick={() => { onChange(o.id, o); setOpen(false); setSearch(""); }}><span className="truncate">{o.code ? <span className="text-slate-400 mr-1">{o.code}</span> : null}{o.label}</span>{o.id === value && <Check className="h-3.5 w-3.5 text-brand-600" />}</button>)}
        </div>
      </Popover.Content></Popover.Portal>
    </Popover.Root>
  );
}
