"use client";
import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Plus, ChevronDown, ChevronLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import { permOk, canonicalize, areaTab } from "@/lib/nav";
import { Menu } from "@/components/ui";
import { B1Popover, MenuList } from "@/features/base1/ui";

/**
 * Área de trabalho: uma tela por módulo com abas (`?tab=`) montadas conforme as permissões. Só a aba ativa é
 * renderizada. A aba fica na URL para links, favoritos e redirecionamentos de rotas antigas.
 * Compactação V2: fluxo normal MÓDULO → ÁREA; dentro da área, diferenças de tipo/status/escopo viram filtros
 * (`FilterChips`) e fontes de dados diferentes viram um seletor compacto (`ViewSegment`, `?sub=`), não outra camada
 * de abas. Abas/sub-abas antigas (V1) são canonicalizadas pela fonte única de navegação (`canonicalize`).
 */
export interface WsTab { key: string; label: string; perm?: string | string[]; content: React.ReactNode; hint?: string; badge?: React.ReactNode }
/** Aba montada a partir do registro de navegação (rótulo/permissão/descrição da SSOT). */
export const tab = (id: string, content: React.ReactNode, extra: Partial<WsTab> = {}): WsTab => ({ ...areaTab(id), content, ...extra });

export function useTabParam<T extends { key: string; perm?: string | string[] }>(param: string, tabs: T[], defaultTab?: string) {
  const { can } = useAuth(); const sp = useSearchParams(); const router = useRouter(); const pathname = usePathname();
  const visible = tabs.filter((t) => permOk(can, t.perm));
  const wanted = sp.get(param);
  const active = visible.find((t) => t.key === wanted) ?? visible.find((t) => t.key === defaultTab) ?? visible[0];
  const set = React.useCallback((key: string) => {
    const next = new URLSearchParams(sp.toString()); next.set(param, key);
    if (param === "tab") next.delete("sub");
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  }, [sp, param, pathname, router]);
  return { visible, active, set };
}

/** Canonicaliza abas antigas (`?tab=saidas&sub=requisicoes` → `?tab=operacoes&sub=requisicoes`) preservando os demais parâmetros. */
function useCanonicalRoute() {
  const sp = useSearchParams(); const router = useRouter(); const pathname = usePathname();
  const next = React.useMemo(() => canonicalize(pathname, sp), [pathname, sp]);
  React.useEffect(() => { if (next) router.replace(next, { scroll: false }); }, [next, router]);
  return Boolean(next);
}

export function Workspace({ title, tabs, param = "tab", actions, layout = "tabs", className, header, defaultTab }: { title?: React.ReactNode; tabs: WsTab[]; param?: string; actions?: React.ReactNode; layout?: "tabs" | "sidebar" | "sub"; className?: string; header?: React.ReactNode; defaultTab?: string }) {
  const redirecting = useCanonicalRoute();
  const { visible, active, set } = useTabParam(param, tabs, defaultTab);
  if (redirecting) return null;
  if (!visible.length) return <div className="mg-card p-6 text-sm text-slate-500">Sem permissão para acessar esta área. Solicite acesso ao administrador da organização.</div>;
  const single = visible.length === 1 && layout !== "sidebar";
  const rail = single ? null : <div className={cn("ws-tabs", layout === "sub" && "ws-tabs--sub", layout === "sidebar" && "ws-tabs--side")} role="tablist" aria-label={typeof title === "string" ? title : undefined}>
    {visible.map((t) => <button key={t.key} type="button" role="tab" aria-selected={active?.key === t.key} title={t.hint} className={cn(layout === "sidebar" ? "mg-panel-list__tab" : "ws-tab", active?.key === t.key && "is-active")} onClick={() => set(t.key)}>{t.label}{t.badge != null && <span className="ws-tab__badge">{t.badge}</span>}</button>)}
  </div>;
  const content = <div key={active!.key} className="mg-motion-swap flex min-h-0 flex-1 flex-col">{active!.content}</div>;
  if (layout === "sidebar") return <div className={cn("b1 flex min-h-0 flex-1 flex-col gap-2", className)}>
    {(title || actions || header) && <div className="mg-toolbar mg-card flex flex-wrap items-center gap-2 px-3"><h1 className="mr-auto truncate text-[13px] font-semibold text-slate-800">{title}</h1>{header}{actions}</div>}
    <div className="mg-panel-sidebar-layout min-h-0 flex-1"><aside className="mg-panel-sidebar-layout__tabs overflow-auto">{rail}</aside><div className="mg-panel-sidebar-layout__content flex min-h-0 flex-col">{content}</div></div>
  </div>;
  if (layout === "sub") return <div className={cn("flex min-h-0 flex-1 flex-col gap-2", className)}>{(rail || actions) && <div className="flex flex-wrap items-center gap-2">{rail}{actions && <div className="ml-auto flex items-center gap-1.5">{actions}</div>}</div>}{content}</div>;
  return <div className={cn("b1 flex min-h-0 flex-1 flex-col gap-2", className)}>
    <div className="mg-toolbar mg-card flex flex-wrap items-center gap-2 px-2">{title && <h1 className="truncate px-1 text-[13px] font-semibold text-slate-800">{title}</h1>}{rail}{single && active?.hint && <span className="px-1 text-[11.5px] text-slate-500">{active.hint}</span>}{actions && <div className="ml-auto flex items-center gap-1.5">{actions}</div>}</div>
    {header}
    {content}
  </div>;
}

/** Seletor compacto de fonte/visão dentro de uma área (`?sub=`): mesma semântica de aba, sem virar outra camada visual. */
export const ViewSegment = (p: Omit<React.ComponentProps<typeof Workspace>, "layout" | "param">) => <Workspace {...p} param="sub" layout="sub" />;

/** Lê/grava um parâmetro de filtro estável na URL (escopo, etapa, tipo, papel…), preservando os demais. */
export function useUrlParam(name: string, fallback = ""): [string, (v: string) => void] {
  const sp = useSearchParams(); const router = useRouter(); const pathname = usePathname();
  const value = sp.get(name) ?? fallback;
  const set = React.useCallback((v: string) => { const next = new URLSearchParams(sp.toString()); if (v && v !== fallback) next.set(name, v); else next.delete(name); const qs = next.toString(); router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }); }, [sp, name, fallback, pathname, router]);
  return [value, set];
}

/** Chips de filtro (Escopo: Todos | Meus; Tipo: …): um grupo de opções mutuamente exclusivas, com contadores opcionais. */
export function FilterChips({ label, value, onChange, options, className, testId }: { label?: string; value: string; onChange: (v: string) => void; options: { value: string; label: string; count?: number | string | null; perm?: string | string[]; hint?: string }[]; className?: string; testId?: string }) {
  const { can } = useAuth(); const ok = options.filter((o) => permOk(can, o.perm));
  return <div className={cn("ws-chips", className)} role="radiogroup" aria-label={label} data-testid={testId}>
    {label && <span className="ws-chips__label">{label}</span>}
    {ok.map((o) => <button key={o.value} type="button" role="radio" aria-checked={value === o.value} title={o.hint} className={cn("ws-chip", value === o.value && "is-active")} onClick={() => onChange(o.value)}>{o.label}{o.count != null && o.count !== "" && <span className="ws-chip__count">{o.count}</span>}</button>)}
  </div>;
}

export interface NewItem { label: string; href?: string; onClick?: () => void; perm?: string | string[]; hint?: string; children?: NewItem[] }
/**
 * Botão "+ Novo": seletor de operação em até dois níveis (grupo → opções), cada opção respeitando a permissão.
 * Uma única opção vira botão direto; grupos sem opções permitidas somem.
 */
export function NewChooser({ items, label = "Novo" }: { items: NewItem[]; label?: string }) {
  const { can } = useAuth(); const router = useRouter();
  const [open, setOpen] = React.useState(false); const [group, setGroup] = React.useState<NewItem | null>(null);
  const allowed = (i: NewItem): NewItem | null => { if (i.children) { const ch = i.children.map(allowed).filter((x): x is NewItem => Boolean(x)); return ch.length ? { ...i, children: ch } : null; } return permOk(can, i.perm) ? i : null; };
  const ok = items.map(allowed).filter((x): x is NewItem => Boolean(x));
  const flat = ok.flatMap((i) => i.children ?? [i]);
  const run = (o: NewItem) => { setOpen(false); setGroup(null); if (o.href) router.push(o.href); else o.onClick?.(); };
  if (!ok.length) return null;
  if (flat.length === 1) { const o = flat[0]!; return <button type="button" className="tb-btn is-primary" onClick={() => run(o)}><Plus className="h-3.5 w-3.5" /> {o.label}</button>; }
  if (!ok.some((i) => i.children)) return <Menu trigger={<button type="button" className="tb-btn is-primary" aria-label={label} data-testid="ws-new"><Plus className="h-3.5 w-3.5" /> {label} <ChevronDown className="h-3 w-3 opacity-80" /></button>} items={ok.map((o) => ({ label: o.label, href: o.href, onClick: o.onClick }))} />;
  const list = group ? group.children! : ok;
  return <B1Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setGroup(null); }} className="w-64 p-1.5" title={group ? undefined : undefined} trigger={<button type="button" className="tb-btn is-primary" aria-label={label} aria-haspopup="menu" aria-expanded={open} data-testid="ws-new"><Plus className="h-3.5 w-3.5" /> {label} <ChevronDown className="h-3 w-3 opacity-80" /></button>}>
    <div role="menu" aria-label={group ? group.label : label}>
      {group && <button type="button" role="menuitem" className="mb-1 flex h-[30px] w-full items-center gap-1 rounded-lg px-2 text-left text-[12px] font-semibold text-slate-600 hover:bg-[var(--mg-bg-page)]" onClick={() => setGroup(null)}><ChevronLeft className="h-3.5 w-3.5" /> {group.label}</button>}
      <MenuList items={list.map((o, i) => ({ key: String(i), label: o.label, icon: o.children ? <ChevronDown className="-rotate-90 h-3.5 w-3.5" /> : undefined }))} onPick={(k) => { const o = list[Number(k)]!; if (o.children) setGroup(o); else run(o); }} />
    </div>
  </B1Popover>;
}
