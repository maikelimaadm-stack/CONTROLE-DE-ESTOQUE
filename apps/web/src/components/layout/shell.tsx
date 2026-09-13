"use client";
import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";
import { crumbsFor } from "@/lib/nav";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { Spinner, ConfirmDialog, Button } from "@/components/ui";
import { WorkspaceTabsProvider, useWorkspaceTabs } from "@/lib/workspace-tabs";
import { TopNavigation } from "./top-navigation";
import { WorkspaceTabsBar } from "./workspace-tabs";
import { IdGlobalDaRotaAtual } from "./id-global-registro";
import { lerPedidoEmpresa, type PedidoEmpresa } from "@/lib/empresa-ativa";

/**
 * AppShell (docs/UI-STANDARD.md › App Shell & Workspace):
 *   TopNavigation (marca · módulos · busca · empresa · notificações · favoritos · usuário)
 *   WorkspaceTabs (abas globais sincronizadas com a URL real)
 *   ActiveWorkspace (trilha + tela ativa; só a tela ativa é montada)
 * Identidade visual MODELO BASE1 (barra verde, pílulas, cartões). O menu deriva de nav.registry (SSOT).
 */
function Crumbs() {
  const pathname = usePathname(); const sp = useSearchParams();
  const crumbs = React.useMemo(() => crumbsFor(pathname, sp), [pathname, sp]);
  // O `#N` mora ao lado da trilha, e não dentro de cada tela: é UMA integração central que cobre 100% das
  // rotas canônicas do catálogo, em vez de 23 edições manuais que envelhecem uma a uma.
  return <div className="trilha-identidade">
    <nav className="mg-crumbs" aria-label="Navegação">{(crumbs.length ? crumbs : ["Início"]).map((c, i, arr) => <React.Fragment key={i}>{i > 0 && <ChevronRight className="mg-crumb-sep" aria-hidden />}<span className={cn("mg-crumb", i === arr.length - 1 && "mg-crumb--current")}>{c}</span></React.Fragment>)}</nav>
    <IdGlobalDaRotaAtual />
  </div>;
}

/**
 * Troca de EMPRESA com invalidação: fecha abas de registro/criação (dados de empresa), invalida consultas e
 * pede confirmação se houver alterações não salvas.
 *
 * COORDENAÇÃO ÚNICA (pedido `agro:empresa-request`). O seletor do cabeçalho pede só a troca; a busca por ID
 * Global pede "troque para a empresa B e então abra esta rota". As duas entram pela MESMA porta de propósito:
 * um caminho paralelo (`setEmpresa` + `router.push` direto) passaria por fora da confirmação de aba suja e
 * descartaria alterações em silêncio — o pedido carrega o destino, ele não ganha um atalho próprio.
 *
 * ORDEM: empresa primeiro, navegação depois — e depois do fechamento/invalidação. Navegar antes faria a tela
 * de destino disparar seus pedidos com o `X-Empresa-Id` ANTIGO; navegar antes do `closeScoped` faria a aba
 * recém-aberta ser fechada junto com as outras abas de registro.
 */
function ContextGuard({ children }: { children: React.ReactNode }) {
  const { session, setEmpresa } = useAuth(); const ws = useWorkspaceTabs(); const qc = useQueryClient(); const pathname = usePathname(); const router = useRouter();
  const prevEmpresa = React.useRef(session?.empresaId ?? null);
  const [pending, setPending] = React.useState<PedidoEmpresa | undefined>(undefined);
  const destinoRef = React.useRef<string | null>(null);
  const abrir = React.useCallback((href: string) => { if (ws) ws.openTab(href); else router.push(href); }, [ws, router]);
  React.useEffect(() => {
    const empresa = session?.empresaId ?? null; if (empresa === prevEmpresa.current) return; prevEmpresa.current = empresa;
    const activeClosed = ws?.closeScoped() ?? false; void qc.invalidateQueries();
    const destino = destinoRef.current; destinoRef.current = null;
    if (destino) { abrir(destino); return; }
    if (activeClosed && ws) { const mod = ws.tabs.find((t) => t.kind === "module" && pathname.startsWith(t.key + "/")); ws.openTab(mod?.href ?? "/"); }
  }, [session?.empresaId, ws, qc, pathname, abrir]);
  const aplicar = React.useCallback((p: PedidoEmpresa) => {
    // Mesma empresa (ou pedido sem troca): não há efeito de contexto para esperar — navega direto.
    if (p.empresaId === (session?.empresaId ?? null)) { if (p.rota) abrir(p.rota); return; }
    destinoRef.current = p.rota ?? null; setEmpresa(p.empresaId);
  }, [session?.empresaId, setEmpresa, abrir]);
  // intercepta a troca de empresa quando há abas sujas (o <select> e a busca por #N só PEDEM; o guard decide)
  React.useEffect(() => {
    const h = (e: Event) => {
      const p = lerPedidoEmpresa((e as CustomEvent<unknown>).detail);
      if (ws?.hasDirty()) { setPending(p); e.preventDefault(); } else aplicar(p);
    };
    window.addEventListener("agro:empresa-request", h);
    return () => window.removeEventListener("agro:empresa-request", h);
  }, [ws, aplicar]);
  return <>{children}<ConfirmDialog open={pending !== undefined} onOpenChange={(o) => { if (!o) setPending(undefined); }} title="Trocar de empresa com alterações não salvas?" description="As telas com alterações não salvas serão fechadas e as alterações descartadas." confirmLabel="Trocar mesmo assim" danger onConfirm={() => { if (pending) aplicar(pending); setPending(undefined); }} /></>;
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
