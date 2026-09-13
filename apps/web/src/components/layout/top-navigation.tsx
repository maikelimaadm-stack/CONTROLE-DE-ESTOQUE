"use client";
import * as React from "react";
import Link from "next/link";
import { createPortal } from "react-dom";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Bell, ChevronDown, FolderOpen, Hexagon, MoreHorizontal, Search, Settings2, Star, Zap } from "lucide-react";
import { NAV, permOk, searchNav, moduleForPath, favoriteRoute, crumbsFor, canonicalize } from "@/lib/nav";
import { megaMenuFor, megaColumns, type MegaMenuData } from "@/lib/mega-menu";
import { useAuth } from "@/lib/auth";
import { api } from "@/lib/api";
import { cn, dateTimeBR } from "@/lib/utils";
import { Menu, ConfirmDialog } from "@/components/ui";
import { toast } from "@/lib/toast";
import { useWorkspaceTabs } from "@/lib/workspace-tabs";

/**
 * TopNavigation (docs/UI-STANDARD.md › App Shell & Workspace): marca · módulos horizontais (SSOT nav.registry) com
 * overflow "Mais" · mega-menu por módulo · busca global (Ctrl+K) · fazenda · notificações · favorito · usuário.
 * Referência de interação: Painel Multi-Telas (header verde, pílulas, mega-menu preso à viewport).
 */
const initialsOf = (name: string) => { const p = name.trim().split(/\s+/).filter(Boolean); return (p.length >= 2 ? `${p[0]![0]}${p[1]![0]}` : name.slice(0, 2)).toUpperCase(); };
const TYPE_ICON: Record<string, React.ComponentType<{ className?: string }>> = { action: Zap, config: Settings2 };
const MORE_W = 76;

function useFitCount(containerRef: React.RefObject<HTMLElement | null>, measureRef: React.RefObject<HTMLElement | null>, total: number) {
  const [fit, setFit] = React.useState(total);
  React.useLayoutEffect(() => {
    const el = containerRef.current; const m = measureRef.current; if (!el || !m) return;
    const calc = () => {
      const avail = el.clientWidth; const ws = Array.from(m.children).map((c) => (c as HTMLElement).offsetWidth + 2);
      let sum = 0; let n = 0;
      for (let i = 0; i < ws.length; i++) { const needMore = i < ws.length - 1 ? MORE_W : 0; if (sum + ws[i]! + needMore <= avail) { sum += ws[i]!; n = i + 1; } else break; }
      // se sobram itens mas o "Mais" não coube na conta acima, garante espaço para ele
      if (n < ws.length) { while (n > 0 && sum + MORE_W > avail) { n--; sum -= ws[n]!; } }
      setFit(n);
    };
    calc(); const ro = new ResizeObserver(calc); ro.observe(el); return () => ro.disconnect();
  }, [containerRef, measureRef, total]);
  return fit;
}

export function TopNavigation({ onFocusSearch }: { onFocusSearch?: React.MutableRefObject<(() => void) | null> }) {
  const { ctx, can, session, logout, refresh } = useAuth();
  const pathname = usePathname(); const router = useRouter(); const qc = useQueryClient(); const ws = useWorkspaceTabs();
  const modules = React.useMemo(() => NAV.filter((i) => i.href !== "/" && permOk(can, i.perm)), [can]);
  const currentModule = React.useMemo(() => moduleForPath(pathname)?.id, [pathname]);
  const navRef = React.useRef<HTMLElement>(null); const measureRef = React.useRef<HTMLDivElement>(null);
  const fit = useFitCount(navRef, measureRef, modules.length);
  const shown = modules.slice(0, fit); const overflow = modules.slice(fit);
  const [open, setOpen] = React.useState<string | null>(null); const [anchor, setAnchor] = React.useState<{ left: number; top: number } | null>(null);
  const [moreOpen, setMoreOpen] = React.useState(false);
  const headerRef = React.useRef<HTMLElement>(null); const panelRef = React.useRef<HTMLElement>(null); const closeTimer = React.useRef<number | null>(null);
  const data: MegaMenuData | null = React.useMemo(() => (open ? megaMenuFor(open, can) : null), [open, can]);
  const openFor = (id: string, btn: HTMLElement) => { const h = headerRef.current?.getBoundingClientRect(); const r = btn.getBoundingClientRect(); setAnchor({ left: r.left, top: (h?.bottom ?? r.bottom) + 4 }); setOpen(id); setMoreOpen(false); };
  const cancelClose = () => { if (closeTimer.current) { window.clearTimeout(closeTimer.current); closeTimer.current = null; } };
  const scheduleClose = () => { cancelClose(); closeTimer.current = window.setTimeout(() => setOpen(null), 160); };
  const go = (href: string) => { setOpen(null); setMoreOpen(false); if (ws) ws.openTab(href); else router.push(href); };
  React.useEffect(() => { if (!open && !moreOpen) return; const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { const back = open ?? null; setOpen(null); setMoreOpen(false); if (back) (document.querySelector(`[data-module-btn="${back}"]`) as HTMLElement | null)?.focus(); } }; const onDown = (e: MouseEvent) => { const t = e.target as Node; if (!panelRef.current?.contains(t) && !headerRef.current?.contains(t)) { setOpen(null); setMoreOpen(false); } }; document.addEventListener("keydown", onKey); document.addEventListener("mousedown", onDown); return () => { document.removeEventListener("keydown", onKey); document.removeEventListener("mousedown", onDown); }; }, [open, moreOpen]);
  React.useEffect(() => { setOpen(null); setMoreOpen(false); }, [pathname]);
  // busca global
  const [search, setSearch] = React.useState(""); const [hi, setHi] = React.useState(0); const inputRef = React.useRef<HTMLInputElement>(null);
  const results = React.useMemo(() => searchNav(search, can), [search, can]);
  React.useEffect(() => { setHi(0); }, [search]);
  React.useEffect(() => { const h = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); inputRef.current?.focus(); inputRef.current?.select(); } }; window.addEventListener("keydown", h); return () => window.removeEventListener("keydown", h); }, []);
  React.useEffect(() => { if (onFocusSearch) onFocusSearch.current = () => { inputRef.current?.focus(); inputRef.current?.select(); }; }, [onFocusSearch]);
  const pick = (href: string) => { setSearch(""); inputRef.current?.blur(); go(href); };
  // notificações, favoritos
  const { data: notif } = useQuery({ queryKey: ["notifications"], queryFn: () => api<{ items: { id: string; title: string; route: string | null; read_at: string | null; created_at: string }[]; unread: number; unreadTruncado: boolean }>("/api/admin/notifications"), enabled: Boolean(ctx), refetchInterval: 60_000 });
  const readAll = useMutation({ mutationFn: () => api("/api/admin/notifications/read-all", { method: "POST" }), onSuccess: () => { void qc.invalidateQueries({ queryKey: ["notifications"] }); void refresh(); } });
  // O contador continua SERVER-AUTHORITATIVE — nunca derivado de `notif.items`, que vem truncado em 50:
  // quem tem 80 nao lidas precisa ver 80. O que muda e DE ONDE ele vem: a caixa e pollada a cada 60s e o
  // /auth/context nao e, entao ler o contexto deixava o badge congelado em 2 enquanto a caixa ja mostrava 3.
  // O contexto fica como valor de partida, ate a primeira resposta da consulta pollada chegar.
  const unread = notif?.unread ?? ctx?.unreadNotifications ?? 0;
  // Acima do teto o servidor avisa que truncou, e o badge diz "500+" em vez de mentir um número redondo.
  const unreadRotulo = notif?.unreadTruncado ? `${unread}+` : String(unread);
  const [confirmLogout, setConfirmLogout] = React.useState(false);
  const askLogout = () => { if (ws?.hasDirty()) setConfirmLogout(true); else logout(); };
  if (!ctx || !session) return null;
  const btnCls = (id: string) => cn("mg-topnav__module", open === id && "is-open", currentModule === id && "is-current");
  const moduleButton = (m: (typeof modules)[number]) => <button key={m.id} type="button" data-testid="nav-module" data-module-btn={m.id} className={btnCls(m.id)} title={m.description} aria-haspopup="true" aria-expanded={open === m.id}
    onMouseEnter={(e) => { cancelClose(); openFor(m.id, e.currentTarget); }} onClick={(e) => { if (open === m.id) { go(m.href); } else openFor(m.id, e.currentTarget); }}
    onKeyDown={(e) => { if (e.key === "ArrowDown") { e.preventDefault(); if (open !== m.id) openFor(m.id, e.currentTarget); window.setTimeout(() => (panelRef.current?.querySelector("a,button") as HTMLElement | null)?.focus(), 0); } }}>
    <span>{m.label}</span><ChevronDown className="mg-topnav__caret" aria-hidden />
  </button>;
  return <>
    <header ref={headerRef} className="mg-topnav no-print" onMouseLeave={scheduleClose} onMouseEnter={cancelClose}>
      <Link href="/" className="mg-topnav__brand" onClick={(e) => { e.preventDefault(); go("/"); }} aria-label="Início"><span className="mg-topnav__logo"><Hexagon className="h-3.5 w-3.5" strokeWidth={2.4} /></span><span className="mg-topnav__brand-name">Agro ERP</span></Link>
      <nav ref={navRef} className="mg-topnav__modules" aria-label="Menu principal">
        {shown.map(moduleButton)}
        {overflow.length > 0 && <div className="relative flex">
          <button type="button" className={cn("mg-topnav__module", (moreOpen || overflow.some((m) => m.id === open)) && "is-open")} aria-haspopup="true" aria-expanded={moreOpen} aria-label={`Mais módulos (${overflow.length})`} data-testid="nav-more" onClick={() => { setMoreOpen((o) => !o); setOpen(null); }}><MoreHorizontal className="h-3.5 w-3.5" /><span>Mais</span></button>
          {moreOpen && <div className="mg-topnav__more" role="menu" aria-label="Mais módulos">{overflow.map((m) => <button key={m.id} type="button" role="menuitem" data-testid="nav-module" data-module-btn={m.id} className={cn("mg-topnav__more-item", currentModule === m.id && "is-current")} onClick={(e) => openFor(m.id, e.currentTarget)} onMouseEnter={(e) => openFor(m.id, e.currentTarget)}>{m.label}<ChevronDown className="h-3 w-3 opacity-60" aria-hidden /></button>)}</div>}
        </div>}
        <div ref={measureRef} className="mg-topnav__measure" aria-hidden="true">{modules.map((m) => <span key={m.id} className="mg-topnav__module"><span>{m.label}</span><ChevronDown className="mg-topnav__caret" /></span>)}</div>
      </nav>
      <div className="mg-topnav__spacer" />
      <div className="mg-topnav__tools">
        <div className="mg-topnav__search" role="combobox" aria-expanded={results.length > 0} aria-haspopup="listbox" aria-controls="nav-search-results">
          <Search className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden />
          <input ref={inputRef} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar tela…" aria-label="Buscar funcionalidade" data-testid="global-search"
            onKeyDown={(e) => { if (e.key === "ArrowDown") { e.preventDefault(); setHi((h) => Math.min(h + 1, results.length - 1)); } else if (e.key === "ArrowUp") { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); } else if (e.key === "Enter" && results[hi]) { e.preventDefault(); pick(results[hi]!.href); } else if (e.key === "Escape") { setSearch(""); inputRef.current?.blur(); } }} />
          <kbd className="mg-topnav__kbd" aria-hidden>Ctrl K</kbd>
          {results.length > 0 && <div id="nav-search-results" role="listbox" aria-label="Resultados da busca" className="mg-topnav__results" data-testid="nav-search-results">
            {results.map((r, i) => { const Icon = TYPE_ICON[r.type] ?? FolderOpen; return <button key={r.id} type="button" role="option" aria-selected={i === hi} className={cn("mg-topnav__result", i === hi && "is-active")} onMouseEnter={() => setHi(i)} onMouseDown={(e) => e.preventDefault()} onClick={() => pick(r.href)}><Icon className="h-3.5 w-3.5 shrink-0 text-[var(--mg-accent)]" /><span className="min-w-0"><span className="block truncate font-medium text-slate-800">{r.label}</span>{r.path.length > 1 && <span className="block truncate text-[10.5px] text-slate-500">{r.path.join(" › ")}</span>}</span></button>; })}
          </div>}
          {search.length > 1 && results.length === 0 && <div className="mg-topnav__results px-3 py-2 text-[12px] text-slate-500">Nenhuma função encontrada.</div>}
        </div>
        <select className="mg-topbar-select" value={session.farmId ?? ""} onChange={(e) => window.dispatchEvent(new CustomEvent("agro:farm-request", { detail: e.target.value || null }))} title="Fazenda ativa" aria-label="Fazenda ativa"><option value="">Todas as fazendas</option>{ctx.farms.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select>
        <FavoriteButton />
        <Menu trigger={<button type="button" className="mg-topbar-btn relative" aria-label="Notificações"><Bell />{unread > 0 && <span data-testid="nao-lidas" className="mg-topnav__badge">{unreadRotulo}</span>}</button>} items={[{ label: "Marcar todas como lidas", onClick: () => readAll.mutate() }, ...(notif?.items.slice(0, 8).map((n) => ({ label: `${n.read_at ? "" : "● "}${n.title} · ${dateTimeBR(n.created_at)}`, onClick: () => { if (n.route) go(n.route); } })) ?? []), { label: "Ver todas", href: "/admin/notificacoes" }]} />
        <Menu trigger={<button type="button" className="mg-topbar-btn" aria-label="Usuário" title={ctx.user.name}><span className="mg-topbar-initials">{initialsOf(ctx.user.name)}</span></button>} items={[{ label: ctx.user.name, disabled: true }, { label: "Perfil", href: "/admin/perfil" }, { label: "Sair", onClick: askLogout, danger: true }]} />
        <ConfirmDialog open={confirmLogout} onOpenChange={setConfirmLogout} title="Sair com alterações não salvas?" description="As alterações não salvas serão descartadas." confirmLabel="Sair mesmo assim" danger onConfirm={() => { setConfirmLogout(false); logout(); }} />
      </div>
    </header>
    {open && data && anchor && typeof document !== "undefined" && createPortal(
      <nav ref={panelRef} className="mg-mega" aria-label={`Menu ${data.module.label}`} data-testid="mega-menu" style={{ top: anchor.top, left: Math.max(12, Math.min(anchor.left, window.innerWidth - Math.min(megaColumns(data.groups) * 224 + 28, window.innerWidth - 24) - 12)), maxWidth: "calc(100vw - 24px)" }} onMouseEnter={cancelClose} onMouseLeave={scheduleClose}>
        <div className="mg-mega__grid" style={{ gridTemplateColumns: `repeat(${megaColumns(data.groups)}, minmax(180px, 224px))` }}>
          {data.groups.map((g) => <div key={g.id} className="mg-mega__group"><div className="mg-mega__group-label">{g.label}</div>{g.items.map((it) => { const Icon = TYPE_ICON[it.type]; return <a key={it.id} href={it.href} className="mg-mega__item" title={it.hint} data-testid="mega-item" onClick={(e) => { e.preventDefault(); go(it.href); }}><span className="truncate">{it.label}</span>{Icon && <Icon className="h-3 w-3 shrink-0 opacity-60" aria-hidden />}</a>; })}</div>)}
        </div>
        <div className="mg-mega__footer"><span>{data.count} {data.count === 1 ? "tela" : "telas"}</span><a href={data.module.path ?? "/"} className="hover:underline" onClick={(e) => { e.preventDefault(); go(data.module.path ?? "/"); }}>Abrir {data.module.label}</a></div>
      </nav>, document.body)}
  </>;
}

/** Favoritos: alternar a tela atual e abrir favoritos existentes (abre/foca a aba global correspondente). */
function FavoriteButton() {
  const { ctx, refresh } = useAuth(); const pathname = usePathname(); const sp = useSearchParams(); const router = useRouter(); const ws = useWorkspaceTabs();
  const currentRoute = React.useMemo(() => favoriteRoute(pathname, sp), [pathname, sp]);
  const favRoute = (r: string) => { const [p, q] = r.split("?"); return favoriteRoute(p!, q ?? null); };
  const favMut = useMutation({ mutationFn: (favs: { route: string; label: string }[]) => api("/api/admin/favorites", { method: "PUT", body: favs }), onSuccess: () => { void refresh(); toast.success("Favoritos atualizados"); } });
  if (!ctx) return null;
  const isFav = ctx.favorites.some((f) => favRoute(f.route) === currentRoute);
  const toggle = () => { const crumbs = crumbsFor(pathname, sp); const label = crumbs[crumbs.length - 1] ?? pathname; favMut.mutate(isFav ? ctx.favorites.filter((f) => favRoute(f.route) !== currentRoute) : [...ctx.favorites, { route: currentRoute, label }]); };
  const open = (route: string) => { const [p, q] = route.split("?"); const href = canonicalize(p!, q ?? null) ?? route; if (ws) ws.openTab(href); else router.push(href); };
  return <Menu trigger={<button type="button" className={cn("mg-topbar-btn", isFav && "is-active")} title="Favoritos" aria-label="Favoritos" data-testid="favorites"><Star className={cn(isFav && "fill-amber-400 text-amber-400")} /></button>}
    items={[{ label: isFav ? "Remover esta tela dos favoritos" : "Adicionar esta tela aos favoritos", onClick: toggle }, ...ctx.favorites.map((f) => ({ label: `★ ${f.label}`, onClick: () => open(f.route) }))]} />;
}
