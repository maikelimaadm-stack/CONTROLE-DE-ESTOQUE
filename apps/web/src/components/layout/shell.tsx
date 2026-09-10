"use client";
import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Bell, ChevronDown, ChevronRight, LogOut, Menu as MenuIcon, Search, Star, User, Tractor } from "lucide-react";
import { NAV, flatNav, type NavItem } from "@/lib/nav";
import { useAuth } from "@/lib/auth";
import { api } from "@/lib/api";
import { cn, dateTimeBR } from "@/lib/utils";
import { Button, Menu, NativeSelect, Spinner } from "@/components/ui";
import { toast } from "sonner";

function NavNode({ item, depth, can, pathname, open, toggle }: { item: NavItem; depth: number; can: (p: string) => boolean; pathname: string; open: Set<string>; toggle: (k: string) => void }) {
  const visible = (i: NavItem): boolean => i.href ? (!i.perm || can(i.perm)) : (i.children ?? []).some(visible);
  if (!visible(item)) return null;
  const key = item.label + depth;
  if (item.href) { const active = pathname === item.href.split("?")[0]; return <Link href={item.href} className={cn("block rounded px-2 py-1 text-[12.5px] hover:bg-white/10", active && "bg-white/15 font-medium")} style={{ paddingLeft: 8 + depth * 10 }}>{item.label}</Link>; }
  const isOpen = open.has(key);
  return <div><button onClick={() => toggle(key)} className="flex w-full items-center justify-between rounded px-2 py-1 text-[12.5px] font-medium text-white/90 hover:bg-white/10" style={{ paddingLeft: 8 + depth * 10 }}>{item.label}{isOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}</button>{isOpen && <div>{item.children!.map((c) => <NavNode key={c.label} item={c} depth={depth + 1} can={can} pathname={pathname} open={open} toggle={toggle} />)}</div>}</div>;
}

export function Shell({ children }: { children: React.ReactNode }) {
  const { ctx, loading, can, session, setFarm, logout, refresh } = useAuth();
  const pathname = usePathname(); const router = useRouter(); const qc = useQueryClient();
  const [collapsed, setCollapsed] = React.useState(false);
  const [open, setOpen] = React.useState<Set<string>>(new Set());
  const [search, setSearch] = React.useState("");
  React.useEffect(() => { try { const s = localStorage.getItem("agro.nav"); if (s) setOpen(new Set(JSON.parse(s))); } catch { /* ignore */ } }, []);
  const toggle = (k: string) => setOpen((o) => { const n = new Set(o); if (n.has(k)) n.delete(k); else n.add(k); try { localStorage.setItem("agro.nav", JSON.stringify([...n])); } catch { /* ignore */ } return n; });
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
  const unread = notif?.items.filter((n) => !n.read_at).length ?? 0;
  return (
    <div className="flex min-h-screen">
      <aside className={cn("no-print fixed inset-y-0 left-0 z-30 flex flex-col bg-brand-900 text-white transition-all", collapsed ? "w-0 overflow-hidden" : "w-60")}>
        <div className="flex items-center gap-2 px-3 py-3 border-b border-white/10"><Tractor className="h-5 w-5 text-brand-300" /><div><div className="text-sm font-semibold leading-tight">Agro ERP</div><div className="text-[10px] text-white/60 truncate max-w-[160px]">{ctx?.organization.name}</div></div></div>
        <nav className="flex-1 overflow-y-auto px-2 py-2 space-y-0.5">
          {ctx && ctx.favorites.length > 0 && <div className="mb-2"><div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-white/50">Favoritos</div>{ctx.favorites.map((f) => <Link key={f.route} href={f.route} className="block rounded px-2 py-1 text-[12.5px] hover:bg-white/10">★ {f.label}</Link>)}</div>}
          {NAV.map((i) => <NavNode key={i.label} item={i} depth={0} can={can} pathname={pathname} open={open} toggle={toggle} />)}
        </nav>
      </aside>
      <div className={cn("flex min-w-0 flex-1 flex-col transition-all", collapsed ? "ml-0" : "ml-60")}>
        <header className="no-print sticky top-0 z-20 flex h-12 items-center gap-3 border-b bg-white px-3">
          <Button variant="ghost" size="icon" onClick={() => setCollapsed((c) => !c)} aria-label="Menu"><MenuIcon className="h-4 w-4" /></Button>
          <div className="relative w-72 max-w-[40vw]">
            <Search className="absolute left-2 top-2 h-4 w-4 text-slate-400" /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar tela… (menu)" className="h-8 w-full rounded-md border pl-8 pr-2 text-[13px]" />
            {results.length > 0 && <div className="absolute mt-1 w-full rounded-md border bg-white shadow-lg">{results.map((r) => <button key={r.href} className="block w-full px-3 py-1.5 text-left text-[13px] hover:bg-slate-100" onClick={() => { setSearch(""); router.push(r.href); }}>{r.label}<span className="ml-2 text-[11px] text-slate-400">{r.path.slice(0, -1).join(" › ")}</span></button>)}</div>}
          </div>
          <div className="ml-auto flex items-center gap-2">
            {ctx && <NativeSelect className="h-8 w-52" value={session.farmId ?? ""} onChange={(e) => setFarm(e.target.value || null)} title="Fazenda ativa"><option value="">Todas as fazendas</option>{ctx.farms.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</NativeSelect>}
            <Button variant="ghost" size="icon" onClick={toggleFav} title={isFav ? "Remover dos favoritos" : "Adicionar aos favoritos"}><Star className={cn("h-4 w-4", isFav && "fill-amber-400 text-amber-400")} /></Button>
            <Menu trigger={<button className="relative rounded p-1.5 hover:bg-slate-100" aria-label="Notificações"><Bell className="h-4 w-4" />{unread > 0 && <span className="absolute -right-1 -top-1 rounded-full bg-red-600 px-1 text-[10px] text-white">{unread}</span>}</button>} items={[{ label: "Marcar todas como lidas", onClick: () => readAll.mutate() }, ...(notif?.items.slice(0, 8).map((n) => ({ label: `${n.read_at ? "" : "● "}${n.title} (${dateTimeBR(n.created_at)})`, href: n.route ?? "/admin/notificacoes" })) ?? []), { label: "Ver todas", href: "/admin/notificacoes" }]} />
            <Menu trigger={<button className="flex items-center gap-1 rounded px-2 py-1 text-[13px] hover:bg-slate-100"><User className="h-4 w-4" />{ctx?.user.name.split(" ")[0]}<ChevronDown className="h-3 w-3" /></button>} items={[{ label: "Perfil", href: "/admin/perfil" }, { label: "Sair", onClick: logout, danger: true }]} />
            <LogOut className="hidden" />
          </div>
        </header>
        {crumbs.length > 0 && <div className="no-print px-4 pt-3 text-[11px] text-slate-500">{crumbs.map((c, i) => <span key={i}>{i > 0 && " › "}{c}</span>)}</div>}
        <main className="flex-1 p-4">{children}</main>
      </div>
    </div>
  );
}
