"use client";
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import * as Popover from "@radix-ui/react-popover";
import { cn } from "@/lib/utils";
import { CmdDisplay, CmdPanel } from "./mg-controls";
import { api, ApiError, qs } from "@/lib/api";
import { getResource, getReferencia, type ChaveReferencia, type FieldDef } from "@agro/domain";
import { Plus } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { Dialog } from "./overlays";
// carregado sob demanda: evita ciclo de módulos (o formulário declarativo usa RefSelect)
const ResourceQuickCreate = React.lazy(() => import("@/features/resources/quick-create").then((m) => ({ default: m.ResourceQuickCreate })));

/** `caminho` e `kind` vêm só dos cadastros em árvore ("1 Insumos › 1.01 Fertilizantes"); API anterior não os manda. */
export interface Option { id: string; label: string; code?: string | null; caminho?: string | null; kind?: string | null }

/**
 * Recorte da lista de opções de um campo de referência do registry: `filtro` fixo e, quando o lançamento
 * exige analítico (`exigeAnalitico`), só analíticos. Apresentação — quem recusa é o servidor.
 */
export function filtroDaReferencia(f: FieldDef): Record<string, string> | undefined {
  if (!f.ref) return undefined;
  if (!f.ref.exigeAnalitico) return f.ref.filtro;
  return { ...(f.ref.filtro ?? {}), kind: "analytic" };
}
/** Texto mostrado de uma opção: o caminho na árvore quando houver; senão o rótulo. */
const textoDaOpcao = (o: Option) => o.caminho || o.label;
/** Select com busca server-side (equivalente ao select2 do sistema de referência), para campos de referência. */
export function RefSelect({ resource, value, onChange, placeholder = "Selecione", filter, disabled, className, allowEmpty = true, includeInactive, labelHint, onOpenChange }: { resource: string; value: string | null | undefined; onChange: (v: string | null, opt?: Option) => void; placeholder?: string; filter?: Record<string, string | undefined>; disabled?: boolean; className?: string; allowEmpty?: boolean; includeInactive?: boolean; /** rótulo já conhecido do valor atual (evita consulta ao abrir o registro) */ labelHint?: string | null; onOpenChange?: (o: boolean) => void }) {
  const [open, setOpen] = React.useState(false); const [search, setSearch] = React.useState(""); const [creating, setCreating] = React.useState(false); const { can } = useAuth();
  const f = Object.fromEntries(Object.entries(filter ?? {}).filter(([, v]) => v));
  const { data, isLoading } = useQuery({ queryKey: ["options", resource, search, f, includeInactive], queryFn: () => api<Option[]>(`/api/resources/${resource}/options${qs({ search, ...f, include_inactive: includeInactive ? "1" : undefined })}`), enabled: open, staleTime: 60_000 });
  const [picked, setPicked] = React.useState<Option | null>(null);
  const current = data?.find((o) => o.id === value) ?? (picked && picked.id === value ? picked : null);
  const def = React.useMemo(() => getResource(resource), [resource]);
  const { data: one } = useQuery({ queryKey: ["option-one", resource, value], queryFn: async () => { const r = await api<Record<string, unknown>>(`/api/resources/${resource}/${value}`); return r; }, enabled: Boolean(value) && !current && !labelHint && !def?.tree, staleTime: 60_000 });
  // árvore: o valor já gravado também aparece pelo caminho — a MESMA rota de opções, recortada pelo id (sem o recorte de analítico, para um valor antigo continuar legível)
  const { data: umNaArvore } = useQuery({ queryKey: ["option-one-caminho", resource, value], queryFn: () => api<Option[]>(`/api/resources/${resource}/options${qs({ id: value ?? undefined, include_inactive: "1" })}`), enabled: Boolean(value) && !current && Boolean(def?.tree), staleTime: 60_000 });
  const doValor = umNaArvore?.find((o) => o.id === value);
  const label = (current ? textoDaOpcao(current) : undefined) ?? (doValor ? textoDaOpcao(doValor) : undefined) ?? labelHint ?? (one ? String(one[def?.labelField ?? "name"] ?? one["description"] ?? one["name"] ?? "") : "");
  const seen = new Set<string>(); const opts = (data ?? []).filter((o) => { const k = `${o.code ?? ""}|${o.label}`; if (seen.has(k) && o.id !== value) return false; seen.add(k); return true; }).map((o) => ({ value: o.id, label: textoDaOpcao(o), code: o.caminho ? undefined : o.code }));
  return (<>
    <Popover.Root open={open} onOpenChange={(o) => { if (disabled) return; setOpen(o); onOpenChange?.(o); if (!o) setSearch(""); }}>
      <Popover.Trigger asChild>
        <CmdDisplay disabled={disabled} empty={!value} placeholder={placeholder} aria-expanded={open} className={cn("mg-input", className)} onClear={allowEmpty ? () => onChange(null) : undefined}>{value ? label || "…" : null}</CmdDisplay>
      </Popover.Trigger>
      <Popover.Portal><Popover.Content align="start" sideOffset={4} className="cmd-panel z-[10000] w-[var(--radix-popover-trigger-width)] min-w-[240px] outline-none">
        <CmdPanel options={opts} value={value ?? null} search={search} onSearch={setSearch} loading={isLoading} emptyText="Nenhum resultado" onPick={(o) => { const src = data?.find((x) => x.id === o.value); setPicked(src ?? { id: o.value, label: o.label, code: o.code ?? null }); onChange(o.value, src); setOpen(false); setSearch(""); }}
          footer={def && can(`${def.permission}.create`) ? <button type="button" className="cmd-panel__create" onClick={() => { setOpen(false); setCreating(true); }}><Plus className="h-3.5 w-3.5" /> Cadastrar {def.label.toLowerCase()}</button> : undefined} />
      </Popover.Content></Popover.Portal>
    </Popover.Root>
    {def && <Dialog open={creating} onOpenChange={setCreating} title={`Novo ${def.label.toLowerCase()}`} size="xl">
      {creating && <React.Suspense fallback={<div className="p-6 text-sm text-slate-400">Carregando…</div>}><ResourceQuickCreate resourceKey={resource} preset={f as Record<string, string>} onCancel={() => setCreating(false)} onCreated={(row) => { const id = String(row["id"]); const label = String(row[def.labelField ?? "name"] ?? row["description"] ?? row["name"] ?? ""); setPicked({ id, label, code: (row["code"] as string | null) ?? null }); onChange(id, { id, label, code: (row["code"] as string | null) ?? null }); setCreating(false); }} /></React.Suspense>}
    </Dialog>}
  </>);
}

interface ItemReferencia { codigo: string | number; rotulo: string; escolhivel: boolean }

/**
 * Busca numa referência oficial (município, banco, NCM, CBO) — CADASTROS Fase 3. Grava o CÓDIGO oficial,
 * o mesmo valor que o campo sempre gravou. Se a API não tiver a busca (API anterior, na janela de deploy),
 * o campo vira digitação do código com um aviso: a tela não trava.
 */
export function ReferenciaSelect({ referencia, value, onChange, disabled, className, onOpenChange, id }: { referencia: ChaveReferencia; value: string | number | null | undefined; onChange: (v: string | number | null) => void; disabled?: boolean; className?: string; onOpenChange?: (o: boolean) => void; id?: string }) {
  const def = getReferencia(referencia);
  const [open, setOpen] = React.useState(false); const [search, setSearch] = React.useState("");
  const [picked, setPicked] = React.useState<ItemReferencia | null>(null);
  const temValor = value !== null && value !== undefined && value !== "";
  const lista = useQuery({ queryKey: ["referencia", referencia, search], queryFn: () => api<{ items: ItemReferencia[] }>(`/api/referencias/${referencia}${qs({ search, pageSize: "30" })}`), enabled: open, staleTime: 300_000, retry: false });
  const atual = picked && String(picked.codigo) === String(value) ? picked : null;
  const um = useQuery({ queryKey: ["referencia-um", referencia, String(value)], queryFn: () => api<ItemReferencia>(`/api/referencias/${referencia}/${encodeURIComponent(String(value))}`), enabled: temValor && !atual, staleTime: 300_000, retry: false });
  // Busca indisponível = a API não conhece a rota (404 da rota, API anterior) ou falhou na rede.
  const indisponivel = lista.error instanceof ApiError ? lista.error.status === 404 || lista.error.status >= 500 : Boolean(lista.error);
  if (indisponivel) {
    return <span className="flex w-full flex-col">
      <input id={id} className={cn("w-full", className)} disabled={disabled} defaultValue={temValor ? String(value) : ""} onChange={(e) => { const v = e.target.value.trim(); onChange(v === "" ? null : def?.codigoInteiro && /^\d+$/.test(v) ? Number(v) : v); }} />
      <span className="text-[11px] text-amber-600">Busca de {def?.labelPlural.toLowerCase() ?? "referência"} indisponível agora; digite o código.</span>
    </span>;
  }
  const rotulo = atual?.rotulo ?? um.data?.rotulo ?? (temValor ? String(value) : "");
  const opcoes = (lista.data?.items ?? []).map((i) => ({ value: String(i.codigo), label: i.rotulo }));
  return (
    <Popover.Root open={open} onOpenChange={(o) => { if (disabled) return; setOpen(o); onOpenChange?.(o); if (!o) setSearch(""); }}>
      <Popover.Trigger asChild>
        <CmdDisplay id={id} disabled={disabled} empty={!temValor} placeholder={`Buscar ${def?.label.toLowerCase() ?? ""}`} aria-expanded={open} className={cn("w-full", className)} onClear={() => onChange(null)}>{temValor ? rotulo : null}</CmdDisplay>
      </Popover.Trigger>
      <Popover.Portal><Popover.Content align="start" sideOffset={4} className="cmd-panel z-[10000] w-[var(--radix-popover-trigger-width)] min-w-[280px] outline-none">
        <CmdPanel options={opcoes} value={temValor ? String(value) : null} search={search} onSearch={setSearch} loading={lista.isLoading} emptyText="Nenhum resultado"
          onPick={(o) => { const it = lista.data?.items.find((x) => String(x.codigo) === o.value) ?? null; setPicked(it); onChange(it ? it.codigo : o.value); setOpen(false); setSearch(""); }} />
      </Popover.Content></Popover.Portal>
    </Popover.Root>
  );
}
