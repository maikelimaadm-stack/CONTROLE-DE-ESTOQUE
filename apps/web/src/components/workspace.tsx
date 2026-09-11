"use client";
import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Plus, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import { permOk } from "@/lib/nav";
import { Menu } from "@/components/ui";

/**
 * Área de trabalho: uma tela por módulo com abas (`?tab=`) e sub-abas (`?sub=`) montadas conforme as permissões.
 * Só a aba ativa é renderizada. A aba fica na URL para links, favoritos e redirecionamentos de rotas antigas.
 */
export interface WsTab { key: string; label: string; perm?: string | string[]; content: React.ReactNode; hint?: string; badge?: React.ReactNode }

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

export function Workspace({ title, tabs, param = "tab", actions, layout = "tabs", className, header, defaultTab }: { title?: React.ReactNode; tabs: WsTab[]; param?: string; actions?: React.ReactNode; layout?: "tabs" | "sidebar" | "sub"; className?: string; header?: React.ReactNode; defaultTab?: string }) {
  const { visible, active, set } = useTabParam(param, tabs, defaultTab);
  if (!visible.length) return <div className="mg-card p-6 text-sm text-slate-500">Sem permissão para acessar esta área. Solicite acesso ao administrador da organização.</div>;
  const rail = <div className={cn("ws-tabs", layout === "sub" && "ws-tabs--sub", layout === "sidebar" && "ws-tabs--side")} role="tablist" aria-label={typeof title === "string" ? title : undefined}>
    {visible.map((t) => <button key={t.key} type="button" role="tab" aria-selected={active?.key === t.key} title={t.hint} className={cn(layout === "sidebar" ? "mg-panel-list__tab" : "ws-tab", active?.key === t.key && "is-active")} onClick={() => set(t.key)}>{t.label}{t.badge != null && <span className="ws-tab__badge">{t.badge}</span>}</button>)}
  </div>;
  const content = <div key={active!.key} className="mg-motion-swap flex min-h-0 flex-1 flex-col">{active!.content}</div>;
  if (layout === "sidebar") return <div className={cn("b1 flex min-h-0 flex-1 flex-col gap-2", className)}>
    {(title || actions) && <div className="mg-toolbar mg-card flex items-center gap-2 px-3"><h1 className="mr-auto truncate text-[13px] font-semibold text-slate-800">{title}</h1>{actions}</div>}
    <div className="mg-panel-sidebar-layout min-h-0 flex-1"><aside className="mg-panel-sidebar-layout__tabs overflow-auto">{rail}</aside><div className="mg-panel-sidebar-layout__content flex min-h-0 flex-col">{content}</div></div>
  </div>;
  if (layout === "sub") return <div className={cn("flex min-h-0 flex-1 flex-col gap-2", className)}><div className="flex flex-wrap items-center gap-2">{rail}{actions && <div className="ml-auto flex items-center gap-1.5">{actions}</div>}</div>{content}</div>;
  return <div className={cn("b1 flex min-h-0 flex-1 flex-col gap-2", className)}>
    <div className="mg-toolbar mg-card flex flex-wrap items-center gap-2 px-2">{title && <h1 className="truncate px-1 text-[13px] font-semibold text-slate-800">{title}</h1>}{rail}{actions && <div className="ml-auto flex items-center gap-1.5">{actions}</div>}</div>
    {header}
    {content}
  </div>;
}

/** Sub-abas dentro de uma aba (`?sub=`). */
export const SubTabs = (p: Omit<React.ComponentProps<typeof Workspace>, "layout" | "param">) => <Workspace {...p} param="sub" layout="sub" />;

/** Botão "+ Novo" que abre um seletor de operação; cada opção respeita a permissão. Uma única opção vira botão direto. */
export function NewChooser({ items, label = "Novo" }: { items: { label: string; href?: string; onClick?: () => void; perm?: string | string[]; hint?: string }[]; label?: string }) {
  const { can } = useAuth(); const router = useRouter();
  const ok = items.filter((i) => permOk(can, i.perm));
  if (!ok.length) return null;
  if (ok.length === 1) { const o = ok[0]!; return <button type="button" className="tb-btn is-primary" onClick={() => (o.href ? router.push(o.href) : o.onClick?.())}><Plus className="h-3.5 w-3.5" /> {o.label}</button>; }
  return <Menu trigger={<button type="button" className="tb-btn is-primary" aria-label={label} data-testid="ws-new"><Plus className="h-3.5 w-3.5" /> {label} <ChevronDown className="h-3 w-3 opacity-80" /></button>} items={ok.map((o) => ({ label: o.label, href: o.href, onClick: o.onClick }))} />;
}
