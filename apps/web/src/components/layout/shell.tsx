"use client";
import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Bell, ChevronRight, CircleHelp, FolderOpen, Grid3x3, Hexagon, Home, LogOut, Menu as MenuIcon, Pin, PinOff, Search, Star, Zap, Settings2 } from "lucide-react";
import { NAV, navKey, hrefKey, permOk, crumbsFor, favoriteRoute, searchNav, canonicalize } from "@/lib/nav";
import { useAuth } from "@/lib/auth";
import { api } from "@/lib/api";
import { cn, dateTimeBR } from "@/lib/utils";
import { Menu, Spinner } from "@/components/ui";
import { toast } from "@/lib/toast";

/**
 * Moldura do MODELO BASE1 (réplica do makgestao): barra superior verde (☰, trilha de navegação, ícones à direita)
 * e menu como painel branco flutuante que abre ao passar/clicar no ☰ e pode ficar fixo ("Fixar menu").
 * Compactação V2: o menu lista só os MÓDULOS (as áreas ficam dentro de cada módulo); a busca encontra qualquer
 * funcionalidade (áreas, sub-áreas, ações e configurações) pela fonte única de navegação; breadcrumbs e favoritos
 * derivam da mesma fonte (rota canônica com tab/sub e parâmetros estáveis).
 */
const initialsOf = (name: string) => { const p = name.trim().split(/\s+/).filter(Boolean); return (p.length >= 2 ? `${p[0]![0]}${p[1]![0]}` : name.slice(0, 2)).toUpperCase(); };
const TYPE_ICON: Record<string, React.ComponentType<{ className?: string }>> = { action: Zap, config: Settings2 };

function ShellInner({ children }: { children: React.ReactNode }) {
  const { ctx, loading, can, session, setFarm, logout, refresh } = useAuth();
  const pathname = usePathname(); const router = useRouter(); const qc = useQueryClient();
  const sp = useSearchParams(); const current = navKey(pathname, sp);
  const currentRoute = React.useMemo(() => favoriteRoute(pathname, sp), [pathname, sp]);
  const [pinned, setPinned] = React.useState(false); const [hover, setHover] = React.useState(false);
  const [search, setSearch] = React.useState(""); const [hi, setHi] = React.useState(0);
  React.useEffect(() => { try { setPinned(localStorage.getItem("agro.menu.pinned") === "1"); } catch { /* ignore */ } }, []);
  const togglePinned = () => setPinned((p) => { try { localStorage.setItem("agro.menu.pinned", p ? "0" : "1"); } catch { /* ignore */ } return !p; });
  const crumbs = React.useMemo(() => crumbsFor(pathname, sp), [pathname, sp]);
  const results = React.useMemo(() => searchNav(search, can), [search, can]);
  React.useEffect(() => { setHi(0); }, [search]);
  const { data: notif } = useQuery({ queryKey: ["notifications"], queryFn: () => api<{ items: { id: string; title: string; route: string | null; read_at: string | null; created_at: string }[] }>("/api/admin/notifications"), enabled: Boolean(ctx), refetchInterval: 60_000 });
  const readAll = useMutation({ mutationFn: () => api("/api/admin/notifications/read-all", { method: "POST" }), onSuccess: () => { void qc.invalidateQueries({ queryKey: ["notifications"] }); void refresh(); } });
  const favMut = useMutation({ mutationFn: (favs: { route: string; label: string }[]) => api("/api/admin/favorites", { method: "PUT", body: favs }), onSuccess: () => { void refresh(); toast.success("Favoritos atualizados"); } });
  // favoritos antigos (V1) são comparados pela rota canonicalizada
  const favRoute = (r: string) => { const [p, q] = r.split("?"); return favoriteRoute(p!, q ?? null); };
  const isFav = ctx?.favorites.some((f) => favRoute(f.route) === currentRoute);
  const toggleFav = () => { if (!ctx) return; const label = crumbs[crumbs.length - 1] ?? pathname; const favs = isFav ? ctx.favorites.filter((f) => favRoute(f.route) !== currentRoute) : [...ctx.favorites, { route: currentRoute, label }]; favMut.mutate(favs); };
  const go = (href: string) => { setSearch(""); closeIfFloating(); router.push(href); };
  if (loading) return <div className="flex h-screen items-center justify-center"><Spinner /></div>;
  if (!session?.token) return null;
  if (!ctx) return <div className="flex h-screen flex-col items-center justify-center gap-3 text-sm text-slate-600"><div>Não foi possível carregar sua organização.</div><div className="flex gap-2"><button className="rounded border px-3 py-1 hover:bg-slate-100" onClick={() => void refresh()}>Tentar novamente</button><button className="rounded border px-3 py-1 hover:bg-slate-100" onClick={logout}>Sair</button></div></div>;
  const unread = notif?.items.filter((n) => !n.read_at).length ?? 0;
  const menuOpen = pinned || hover;
  const closeIfFloating = () => { if (!pinned) setHover(false); };
  const modules = NAV.filter((i) => i.href !== "/" && permOk(can, i.perm));
  return (
    <div className="mg-app-shell flex h-dvh flex-col overflow-hidden">
      <header className="mg-topbar no-print sticky top-0 z-40">
        <div className="flex min-w-0 items-center gap-2">
          <div className="relative inline-flex items-center" onMouseEnter={() => { if (!pinned) setHover(true); }} onMouseLeave={() => { if (!pinned) setHover(false); }}>
            <button type="button" className={cn("mg-topbar-btn", menuOpen && "is-active")} aria-label={pinned ? "Desfixar menu" : "Fixar menu"} aria-expanded={menuOpen} onClick={() => { togglePinned(); setHover(!pinned); }}><MenuIcon /></button>
            <nav className={cn("mg-sidebar", menuOpen && "is-open")} aria-label="Menu principal">
              <div className="border-b px-3 py-2" style={{ borderColor: "var(--mg-divider)" }}>
                <div className="truncate text-[12px] font-semibold text-slate-800">{ctx.organization.name}</div>
                <div className="relative mt-1.5" role="combobox" aria-expanded={results.length > 0} aria-haspopup="listbox" aria-controls="nav-search-results">
                  <Search className="absolute left-2 top-1.5 h-3.5 w-3.5 text-slate-400" />
                  <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar função… (ex.: pesar animal, DFe, plano de contas)" aria-label="Buscar funcionalidade" className="h-7 w-full rounded-full bg-[var(--mg-gray-fill)] pl-7 pr-2 text-[12px] focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-300"
                    onKeyDown={(e) => { if (e.key === "ArrowDown") { e.preventDefault(); setHi((h) => Math.min(h + 1, results.length - 1)); } else if (e.key === "ArrowUp") { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); } else if (e.key === "Enter" && results[hi]) { e.preventDefault(); go(results[hi]!.href); } else if (e.key === "Escape") setSearch(""); }} />
                  {results.length > 0 && <div id="nav-search-results" role="listbox" aria-label="Resultados da busca" className="absolute z-10 mt-1 max-h-80 w-full overflow-auto rounded-md border bg-white shadow-lg" data-testid="nav-search-results">
                    {results.map((r, i) => { const Icon = TYPE_ICON[r.type] ?? FolderOpen; return <button key={r.id} role="option" aria-selected={i === hi} className={cn("flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] hover:bg-slate-100", i === hi && "bg-slate-100")} onMouseEnter={() => setHi(i)} onClick={() => go(r.href)}><Icon className="h-3.5 w-3.5 shrink-0 text-[var(--mg-icon)]" /><span className="min-w-0 flex-1"><span className="block truncate">{r.label}</span>{r.path.length > 1 && <span className="block truncate text-[10px] text-slate-400">{r.path.slice(0, -1).join(" › ")}</span>}</span></button>; })}
                  </div>}
                  {search.length > 1 && results.length === 0 && <div className="absolute z-10 mt-1 w-full rounded-md border bg-white px-3 py-2 text-[12px] text-slate-500 shadow-lg">Nenhuma função encontrada.</div>}
                </div>
              </div>
              <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 py-2">
                <Link href="/" onClick={closeIfFloating} className={cn("mg-ni mb-1", pathname === "/" && "active")}><Home /><span>Início</span></Link>
                {ctx.favorites.length > 0 && <div><div className="mg-ng">Favoritos</div>{ctx.favorites.map((f) => { const href = canonicalize(f.route.split("?")[0]!, f.route.split("?")[1] ?? null) ?? f.route; return <Link key={f.route} href={href} onClick={closeIfFloating} className={cn("mg-ni", (favRoute(f.route) === currentRoute || hrefKey(href) === current) && "active")}><Star className="text-amber-400" /><span className="truncate">{f.label}</span></Link>; })}</div>}
                <div className="mg-ng">Módulos</div>
                {modules.map((i) => <Link key={i.id} href={i.href} onClick={closeIfFloating} title={i.description} data-testid="nav-module" className={cn("mg-ni", (pathname === i.href.split("?")[0] || pathname.startsWith(i.href.split("?")[0] + "/")) && "active")}><FolderOpen /><span className="truncate">{i.label}</span></Link>)}
              </div>
              <div className="shrink-0 border-t p-2" style={{ borderColor: "var(--mg-divider)" }}>
                <button type="button" className="mg-ni w-full" onClick={togglePinned}>{pinned ? <PinOff className="!h-3.5 !w-3.5" /> : <Pin className="!h-3.5 !w-3.5" />}<span>{pinned ? "Desfixar menu" : "Fixar menu"}</span></button>
                <button type="button" className="mg-ni w-full" onClick={logout}><LogOut className="!h-3.5 !w-3.5" /><span>Sair</span></button>
              </div>
            </nav>
          </div>
          <nav className="flex min-w-0 items-center gap-1.5 overflow-hidden" aria-label="Navegação">
            {(crumbs.length ? crumbs : ["Início"]).map((c, i, arr) => <React.Fragment key={i}>{i > 0 && <ChevronRight className="mg-crumb-sep" />}<span className={cn("mg-crumb", i === arr.length - 1 && "mg-crumb--current")}>{c}</span></React.Fragment>)}
          </nav>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <select className="mg-topbar-select" value={session.farmId ?? ""} onChange={(e) => setFarm(e.target.value || null)} title="Fazenda ativa" aria-label="Fazenda ativa"><option value="">Todas as fazendas</option>{ctx.farms.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select>
          <button type="button" className={cn("mg-topbar-btn", isFav && "is-active")} onClick={toggleFav} title={isFav ? "Remover dos favoritos" : "Adicionar aos favoritos"} aria-label="Favorito"><Star className={cn(isFav && "fill-amber-400 text-amber-400")} /></button>
          <Menu trigger={<button type="button" className="mg-topbar-btn relative" aria-label="Notificações"><Bell />{unread > 0 && <span className="absolute -right-1 -top-1 rounded-full bg-red-600 px-1 text-[9px] text-white">{unread}</span>}</button>} items={[{ label: "Marcar todas como lidas", onClick: () => readAll.mutate() }, ...(notif?.items.slice(0, 8).map((n) => ({ label: `${n.read_at ? "" : "● "}${n.title} (${dateTimeBR(n.created_at)})`, href: n.route ?? "/admin/notificacoes" })) ?? []), { label: "Ver todas", href: "/admin/notificacoes" }]} />
          <Link href="/relatorios" className="mg-topbar-btn" aria-label="Ajuda" title="Relatórios e ajuda"><CircleHelp /></Link>
          <Link href="/" className="mg-topbar-btn" aria-label="Início" title="Início"><Grid3x3 /></Link>
          <Menu trigger={<button type="button" className="mg-topbar-btn" aria-label="Usuário" title={ctx.user.name}><span className="mg-topbar-initials">{initialsOf(ctx.user.name)}</span></button>} items={[{ label: "Perfil", href: "/admin/perfil" }, { label: "Sair", onClick: logout, danger: true }]} />
          <div className="mg-topbar-logo" aria-hidden="true"><Hexagon className="h-4 w-4 text-white" strokeWidth={2.2} /></div>
        </div>
      </header>
      <main key={pathname} className="mg-page-enter flex min-h-0 flex-1 flex-col overflow-auto p-3">{children}</main>
    </div>
  );
}

export function Shell({ children }: { children: React.ReactNode }) { return <React.Suspense fallback={<div className="flex h-screen items-center justify-center"><Spinner /></div>}><ShellInner>{children}</ShellInner></React.Suspense>; }
