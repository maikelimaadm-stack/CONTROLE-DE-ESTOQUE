"use client";
import * as React from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";
import { crumbsFor } from "@/lib/nav";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { Spinner, ConfirmDialog, Button } from "@/components/ui";
import { WorkspaceTabsProvider, useWorkspaceTabs } from "@/lib/workspace-tabs";
import { TopNavigation } from "./top-navigation";
import { WorkspaceTabsBar } from "./workspace-tabs";

/**
 * AppShell (docs/UI-STANDARD.md › App Shell & Workspace):
 *   TopNavigation (marca · módulos · busca · fazenda · notificações · favoritos · usuário)
 *   WorkspaceTabs (abas globais sincronizadas com a URL real)
 *   ActiveWorkspace (trilha + tela ativa; só a tela ativa é montada)
 * Identidade visual MODELO BASE1 (barra verde, pílulas, cartões). O menu deriva de nav.registry (SSOT).
 */
function Crumbs() {
  const pathname = usePathname(); const sp = useSearchParams();
  const crumbs = React.useMemo(() => crumbsFor(pathname, sp), [pathname, sp]);
  return <nav className="mg-crumbs" aria-label="Navegação">{(crumbs.length ? crumbs : ["Início"]).map((c, i, arr) => <React.Fragment key={i}>{i > 0 && <ChevronRight className="mg-crumb-sep" aria-hidden />}<span className={cn("mg-crumb", i === arr.length - 1 && "mg-crumb--current")}>{c}</span></React.Fragment>)}</nav>;
}

/** Troca de fazenda com invalidação: fecha abas de registro/criação (dados farm-scoped), invalida consultas e pede confirmação se houver alterações não salvas. */
function ContextGuard({ children }: { children: React.ReactNode }) {
  const { session, setFarm } = useAuth(); const ws = useWorkspaceTabs(); const qc = useQueryClient(); const pathname = usePathname();
  const prevFarm = React.useRef(session?.farmId ?? null); const [pending, setPending] = React.useState<string | null | undefined>(undefined);
  React.useEffect(() => {
    const farm = session?.farmId ?? null; if (farm === prevFarm.current) return; prevFarm.current = farm;
    const activeClosed = ws?.closeScoped() ?? false; void qc.invalidateQueries();
    if (activeClosed && ws) { const mod = ws.tabs.find((t) => t.kind === "module" && pathname.startsWith(t.key + "/")); ws.openTab(mod?.href ?? "/"); }
  }, [session?.farmId, ws, qc, pathname]);
  // intercepta a troca de fazenda quando há abas sujas (o <select> chama setFarm; aqui o guard observa o pedido)
  React.useEffect(() => { const h = (e: Event) => { const id = (e as CustomEvent<string | null>).detail; if (ws?.hasDirty()) { setPending(id); e.preventDefault(); } else setFarm(id); }; window.addEventListener("agro:farm-request", h); return () => window.removeEventListener("agro:farm-request", h); }, [ws, setFarm]);
  return <>{children}<ConfirmDialog open={pending !== undefined} onOpenChange={(o) => { if (!o) setPending(undefined); }} title="Trocar de fazenda com alterações não salvas?" description="As telas com alterações não salvas serão fechadas e as alterações descartadas." confirmLabel="Trocar mesmo assim" danger onConfirm={() => { if (pending !== undefined) setFarm(pending); setPending(undefined); }} /></>;
}

function ShellInner({ children }: { children: React.ReactNode }) {
  const { ctx, loading, can, session, refresh, logout } = useAuth(); const pathname = usePathname();
  const focusSearch = React.useRef<(() => void) | null>(null);
  if (loading) return <div className="flex h-screen items-center justify-center"><Spinner /></div>;
  if (!session?.token) return null;
  if (!ctx) return <div className="flex h-screen flex-col items-center justify-center gap-3 text-sm text-slate-600"><div>Não foi possível carregar sua organização.</div><div className="flex gap-2"><Button variant="outline" size="sm" onClick={() => void refresh()}>Tentar novamente</Button><Button variant="outline" size="sm" onClick={logout}>Sair</Button></div></div>;
  return <WorkspaceTabsProvider orgId={ctx.organization.id} userId={ctx.user.id} can={can}>
    <ContextGuard>
      <div className="mg-app-shell flex h-dvh flex-col overflow-hidden">
        <TopNavigation onFocusSearch={focusSearch} />
        <WorkspaceTabsBar onNewTab={() => focusSearch.current?.()} />
        <main key={pathname} className="mg-page-enter flex min-h-0 flex-1 flex-col overflow-auto p-3" data-testid="active-workspace">
          <Crumbs />
          {children}
        </main>
      </div>
    </ContextGuard>
  </WorkspaceTabsProvider>;
}

export function Shell({ children }: { children: React.ReactNode }) { return <React.Suspense fallback={<div className="flex h-screen items-center justify-center"><Spinner /></div>}><ShellInner>{children}</ShellInner></React.Suspense>; }
