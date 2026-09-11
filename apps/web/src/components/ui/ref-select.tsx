"use client";
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import * as Popover from "@radix-ui/react-popover";
import { cn } from "@/lib/utils";
import { CmdDisplay, CmdPanel } from "./mg-controls";
import { api, qs } from "@/lib/api";
import { getResource } from "@agro/domain";

export interface Option { id: string; label: string; code?: string | null }
/** Select com busca server-side (equivalente ao select2 do sistema de referência), para campos de referência. */
export function RefSelect({ resource, value, onChange, placeholder = "Selecione", filter, disabled, className, allowEmpty = true, includeInactive, labelHint, onOpenChange }: { resource: string; value: string | null | undefined; onChange: (v: string | null, opt?: Option) => void; placeholder?: string; filter?: Record<string, string | undefined>; disabled?: boolean; className?: string; allowEmpty?: boolean; includeInactive?: boolean; /** rótulo já conhecido do valor atual (evita consulta ao abrir o registro) */ labelHint?: string | null; onOpenChange?: (o: boolean) => void }) {
  const [open, setOpen] = React.useState(false); const [search, setSearch] = React.useState("");
  const f = Object.fromEntries(Object.entries(filter ?? {}).filter(([, v]) => v));
  const { data, isLoading } = useQuery({ queryKey: ["options", resource, search, f, includeInactive], queryFn: () => api<Option[]>(`/api/resources/${resource}/options${qs({ search, ...f, include_inactive: includeInactive ? "1" : undefined })}`), enabled: open, staleTime: 60_000 });
  const [picked, setPicked] = React.useState<Option | null>(null);
  const current = data?.find((o) => o.id === value) ?? (picked && picked.id === value ? picked : null);
  const { data: one } = useQuery({ queryKey: ["option-one", resource, value], queryFn: async () => { const r = await api<Record<string, unknown>>(`/api/resources/${resource}/${value}`); return r; }, enabled: Boolean(value) && !current && !labelHint, staleTime: 60_000 });
  const def = React.useMemo(() => getResource(resource), [resource]);
  const label = current?.label ?? labelHint ?? (one ? String(one[def?.labelField ?? "name"] ?? one["description"] ?? one["name"] ?? "") : "");
  const seen = new Set<string>(); const opts = (data ?? []).filter((o) => { const k = `${o.code ?? ""}|${o.label}`; if (seen.has(k) && o.id !== value) return false; seen.add(k); return true; }).map((o) => ({ value: o.id, label: o.label, code: o.code }));
  return (
    <Popover.Root open={open} onOpenChange={(o) => { if (disabled) return; setOpen(o); onOpenChange?.(o); if (!o) setSearch(""); }}>
      <Popover.Trigger asChild>
        <CmdDisplay disabled={disabled} empty={!value} placeholder={placeholder} aria-expanded={open} className={cn("mg-input", className)} onClear={allowEmpty ? () => onChange(null) : undefined}>{value ? label || "…" : null}</CmdDisplay>
      </Popover.Trigger>
      <Popover.Portal><Popover.Content align="start" sideOffset={4} className="cmd-panel z-[10000] w-[var(--radix-popover-trigger-width)] min-w-[240px] outline-none">
        <CmdPanel options={opts} value={value ?? null} search={search} onSearch={setSearch} loading={isLoading} emptyText="Nenhum resultado" onPick={(o) => { const src = data?.find((x) => x.id === o.value); setPicked(src ?? { id: o.value, label: o.label, code: o.code ?? null }); onChange(o.value, src); setOpen(false); setSearch(""); }} />
      </Popover.Content></Popover.Portal>
    </Popover.Root>
  );
}
