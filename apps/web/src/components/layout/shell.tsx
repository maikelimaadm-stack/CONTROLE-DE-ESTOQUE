"use client";
import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Bell, ChevronDown, ChevronRight, CircleHelp, FolderOpen, Grid3x3, Hexagon, Home, LogOut, Menu as MenuIcon, Pin, PinOff, Search, Star } from "lucide-react";
import { NAV, flatNav, type NavItem } from "@/lib/nav";
import { useAuth } from "@/lib/auth";
import { api } from "@/lib/api";
import { cn, dateTimeBR } from "@/lib/utils";
import { Menu, Spinner } from "@/components/ui";
import { toast } from "@/lib/toast";

/**
 * Moldura do MODELO BASE1 (réplica do makgestao): barra superior verde (☰, trilha de navegação, ícones à direita)
 * e menu como painel branco flutuante que abre ao passar/clicar no ☰ e pode ficar fixo ("Fixar menu").
 */
function NavNode({ item, depth, can, pathname, open, toggle, onNavigate }: { item: NavItem; depth: number; can: (p: string) => boolean; pathname: string; open: Set<string>; toggle: (k: string) => void; onNavigate: () => void }) {
  const visible = (i: NavItem): boolean => i.href ? (!i.perm || can(i.perm)) : (i.children ?? []).some(visible);
  if (!visible(item)) return null;
  const key = item.label + depth;
  if (item.href) { const active = pathname === item.href.split("?")[0]; return <Link href={item.href} onClick={onNavigate} className={cn("mg-ni", active && "active")} style={{ paddingLeft: 12 + depth * 10 }}><FolderOpen /><span className="truncate">{item.label}</span></Link>; }
  if (depth === 0) return <div><div className="mg-ng">{item.label}</div>{item.children!.map((c) => <NavNode key={c.label} item={c} depth={depth + 1} can={can} pathname={pathname} open={open} toggle={toggle} onNavigate={onNavigate} />)}</div>;
  const isOpen = open.has(key);
  return <div><button type="button" onClick={() => toggle(key)} className="mg-ni" style={{ paddingLeft: 12 + depth * 10 }}><FolderOpen /><span className="flex-1 truncate">{item.label}</span>{isOpen ? <ChevronDown className="!h-3 !w-3" /> : <ChevronRight className="!h-3 !w-3" />}</button>{isOpen && <div>{item.children!.map((c) => <NavNode key={c.label} item={c} depth={depth + 1} can={can} pathname={pathname} open={open} toggle={toggle} onNavigate={onNavigate} />)}</div>}</div>;
}

const initialsOf = (name: string) => { const p = name.trim().split(/\s+/).filter(Boolean); return (p.length >= 2 ? `${p[0]![0]}${p[1]![0]}` : name.slice(0, 2)).toUpperCase(); };

export function Shell({ children }: { children: React.ReactNode }) {
  const { ctx, loading, can, session, setFarm, logout, refresh } = useAuth();
  const pathname = usePathname(); const router = useRouter(); const qc = useQueryClient();
  const [pinned, setPinned] = React.useState(false); const [hover, setHover] = React.useState(false);
  const [open, setOpen] = React.useState<Set<string>>(new Set());
  const [search, setSearch] = React.useState("");
  React.useEffect(() => { try { const s = localStorage.getItem("agro.nav"); if (s) setOpen(new Set(JSON.parse(s))); setPinned(localStorage.getItem("agro.menu.pinned") === "1"); } catch { /* ignore */ } }, []);
  const toggle = (k: string) => setOpen((o) => { const n = new Set(o); if (n.has(k)) n.delete(k); else n.add(k); try { localStorage.setItem("agro.nav", JSON.stringify([...n])); } catch { /* ignore */ } return n; });
  const togglePinned = () => setPinned((p) => { try { localStorage.setItem("agro.menu.pinned", p ? "0" : "1"); } catch { /* ignore */ } return !p; });
  const flat = React.useMemo(() => flatNav(), []);
  const crumbs = React.useMemo(() => flat.find((f) => f.href.split("?")[0] === pathname)?.path ?? [], [flat, pathname]);
  const results = search.length > 1 ? flat.filter((f) => (!f.perm || can(f.perm)) && f.label.toLowerCase().includes(search.toLowerCase())).slice(0, 10) : [];
  const { data: notif } = useQuery({ queryKey: ["notifications"], queryFn: () => api<{ items: { id: string; title: string; route: string | null; read_at: string | null; created_at: string }[] }>("/api/admin/notifications"), enabled: Boolean(ctx), refetchInterval: 60_000 });
  const readAll = useMutation({ mutationFn: () => api("/api/admin/notifications/read-all", { method: "POST" }), onSuccess: () => { void qc.invalidateQueries({ queryKey: ["notifications"] }); void refresh(); } });
  const favMut = useMutation({ mutationFn: (favs: { route: string; label: string }[]) => api("/api/admin/favorites", { method: "PUT", body: favs }), onSuccess: () => { void refresh(); toast.success("Favoritos atualizados"); } });
  const isFav = ctx?.favorites.some((f) => f.route === pathname);
  const toggleFav = () => { if (!ctx) return; const label = crumbs[crumbs.length - 1] ?? pathname; const favs = isFav ? ctx.favorites.filter((f) => f.route !== pathname) : [...ctx.favorites, { route: pathname, label }]; favMut.mutate(favs); };
  if (loading) return <div className="flex h-screen items-center justify-center"><Spinner /></div>;
  if (!session?.token) return null;
  if (!ctx) return <div className="flex h-screen flex-col items-center justify-center gap-3 text-sm text-slate-600"><div>Não foi possível carregar sua organização.</div><div className="flex gap-2"><button className="rounded border px-3 py-1 hover:bg-slate-100" onClick={() => void refresh()}>Tentar novamente</button><button className="rounded border px-3 py-1 hover:bg-slate-100" onClick={logout}>Sair</button></div></div>;
  const unread = notif?.items.filter((n) => !n.read_at).length ?? 0;
  const menuOpen = pinned || hover;
  const closeIfFloating = () => { if (!pinned) setHover(false); };
  return (
    <div className="flex min-h-screen flex-col">
      <header className="mg-topbar no-print sticky top-0 z-40">
        <div className="flex min-w-0 items-center gap-2">
          <div className="relative inline-flex items-center" onMouseEnter={() => { if (!pinned) setHover(true); }} onMouseLeave={() => { if (!pinned) setHover(false); }}>
            <button type="button" className={cn("mg-topbar-btn", menuOpen && "is-active")} aria-label={pinned ? "Desfixar menu" : "Fixar menu"} aria-expanded={menuOpen} onClick={() => { togglePinned(); setHover(!pinned); }}><MenuIcon /></button>
            <nav className={cn("mg-sidebar", menuOpen && "is-open")} aria-label="Menu principal">
              <div className="border-b px-3 py-2" style={{ borderColor: "var(--mg-divider)" }}>
                <div className="truncate text-[12px] font-semibold text-slate-800">{ctx.organization.name}</div>
                <div className="relative mt-1.5"><Search className="absolute left-2 top-1.5 h-3.5 w-3.5 text-slate-400" /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar tela…" className="h-7 w-full rounded-full bg-[var(--mg-gray-fill)] pl-7 pr-2 text-[12px] focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-300" />
                  {results.length > 0 && <div className="absolute z-10 mt-1 w-full rounded-md border bg-white shadow-lg">{results.map((r) => <button key={r.href} className="block w-full px-3 py-1.5 text-left text-[12px] hover:bg-slate-100" onClick={() => { setSearch(""); closeIfFloating(); router.push(r.href); }}>{r.label}<span className="ml-2 text-[10px] text-slate-400">{r.path.slice(0, -1).join(" › ")}</span></button>)}</div>}
                </div>
              </div>
              <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 py-2">
                <Link href="/" onClick={closeIfFloating} className={cn("mg-ni mb-1", pathname === "/" && "active")}><Home /><span>Painel de Controle</span></Link>
                {ctx.favorites.length > 0 && <div><div className="mg-ng">Favoritos</div>{ctx.favorites.map((f) => <Link key={f.route} href={f.route} onClick={closeIfFloating} className={cn("mg-ni", pathname === f.route && "active")}><Star className="text-amber-400" /><span className="truncate">{f.label}</span></Link>)}</div>}
                {NAV.filter((i) => i.href !== "/").map((i) => <NavNode key={i.label} item={i} depth={0} can={can} pathname={pathname} open={open} toggle={toggle} onNavigate={closeIfFloating} />)}
              </div>
              <div className="shrink-0 border-t p-2" style={{ borderColor: "var(--mg-divider)" }}>
                <button type="button" className="mg-ni w-full" onClick={togglePinned}>{pinned ? <PinOff className="!h-3.5 !w-3.5" /> : <Pin className="!h-3.5 !w-3.5" />}<span>{pinned ? "Desfixar menu" : "Fixar menu"}</span></button>
                <button type="button" className="mg-ni w-full" onClick={logout}><LogOut className="!h-3.5 !w-3.5" /><span>Sair</span></button>
              </div>
            </nav>
          </div>
          <nav className="flex min-w-0 items-center gap-1.5 overflow-hidden" aria-label="Navegação">
            {(crumbs.length ? crumbs : ["Painel de Controle"]).map((c, i, arr) => <React.Fragment key={i}>{i > 0 && <ChevronRight className="mg-crumb-sep" />}<span className={cn("mg-crumb", i === arr.length - 1 && "mg-crumb--current")}>{c}</span></React.Fragment>)}
          </nav>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <select className="mg-topbar-select" value={session.farmId ?? ""} onChange={(e) => setFarm(e.target.value || null)} title="Fazenda ativa" aria-label="Fazenda ativa"><option value="">Todas as fazendas</option>{ctx.farms.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select>
          <button type="button" className={cn("mg-topbar-btn", isFav && "is-active")} onClick={toggleFav} title={isFav ? "Remover dos favoritos" : "Adicionar aos favoritos"} aria-label="Favorito"><Star className={cn(isFav && "fill-amber-400 text-amber-400")} /></button>
          <Menu trigger={<button type="button" className="mg-topbar-btn relative" aria-label="Notificações"><Bell />{unread > 0 && <span className="absolute -right-1 -top-1 rounded-full bg-red-600 px-1 text-[9px] text-white">{unread}</span>}</button>} items={[{ label: "Marcar todas como lidas", onClick: () => readAll.mutate() }, ...(notif?.items.slice(0, 8).map((n) => ({ label: `${n.read_at ? "" : "● "}${n.title} (${dateTimeBR(n.created_at)})`, href: n.route ?? "/admin/notificacoes" })) ?? []), { label: "Ver todas", href: "/admin/notificacoes" }]} />
          <Link href="/relatorios" className="mg-topbar-btn" aria-label="Ajuda" title="Relatórios e ajuda"><CircleHelp /></Link>
          <Link href="/" className="mg-topbar-btn" aria-label="Aplicativos" title="Painel de Controle"><Grid3x3 /></Link>
          <Menu trigger={<button type="button" className="mg-topbar-btn" aria-label="Usuário" title={ctx.user.name}><span className="mg-topbar-initials">{initialsOf(ctx.user.name)}</span></button>} items={[{ label: "Perfil", href: "/admin/perfil" }, { label: "Sair", onClick: logout, danger: true }]} />
          <div className="mg-topbar-logo" aria-hidden="true"><Hexagon className="h-4 w-4 text-white" strokeWidth={2.2} /></div>
        </div>
      </header>
      <main key={pathname} className="mg-page-enter flex-1 p-3">{children}</main>
    </div>
  );
}
