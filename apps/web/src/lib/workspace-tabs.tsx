"use client";
/**
 * ABAS GLOBAIS DE TRABALHO (docs/UI-STANDARD.md › App Shell & Workspace).
 * Cada aba é uma TELA real e a URL continua a autoridade: abrir/focar aba = navegar; navegar (link, deep link,
 * voltar/avançar) = focar/criar a aba correspondente. Identidade da aba (`tabKeyFor`):
 *   - rota de detalhe (DETAIL_ROUTES) ou tela de criação → pathname completo (cada registro = aba própria);
 *   - página de módulo (path de MODULES) → path do módulo (abas internas `?tab=`/`?sub=` e filtros ficam DENTRO
 *     da aba; o href guarda a última URL para restaurar o estado ao voltar);
 *   - demais telas → pathname.
 * Persistência: sessionStorage por organização+usuário, só metadados (key, href, label, kind); ao restaurar,
 * as abas são revalidadas pelas permissões atuais. Troca de fazenda fecha abas de registro/criação (farm-scoped).
 */
import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { MODULES, ALL } from "../../nav.registry.mjs";
import { crumbsFor, detailRouteFor, moduleForPath, modulePerm, permOk, canonicalize } from "./nav";

export type TabKind = "home" | "module" | "detail" | "new" | "page";
export interface WsTab { key: string; href: string; label: string; kind: TabKind; module?: string }
export const HOME_KEY = "/";
const MAX_TABS = 24;

const isNewPath = (p: string) => /\/(new|novo)(\/|$)/.test(p);
const split = (href: string): [string, string] => { const i = href.indexOf("?"); return i < 0 ? [href, ""] : [href.slice(0, i), href.slice(i + 1)]; };

/** Descritor de aba para uma localização (sem estado): chave, rótulo inicial, tipo e módulo. */
export function tabFor(pathname: string, search?: string | URLSearchParams | null): WsTab {
  const qs = typeof search === "string" ? search : search?.toString() ?? "";
  const href = qs ? `${pathname}?${qs}` : pathname;
  if (pathname === "/") return { key: HOME_KEY, href: "/", label: "Início", kind: "home", module: "inicio" };
  const det = detailRouteFor(pathname);
  if (det) return { key: pathname, href, label: det.label, kind: "detail", module: det.module };
  const mod = MODULES.find((m) => m.path === pathname);
  if (mod) return { key: pathname, href, label: mod.label, kind: "module", module: mod.id };
  const owner = moduleForPath(pathname);
  if (isNewPath(pathname)) {
    const act = ALL.find((e) => e.type === "action" && e.href && split(e.href)[0] === pathname);
    const crumbs = crumbsFor(pathname, qs);
    return { key: pathname, href, label: act?.label ?? (crumbs.length ? `Novo · ${crumbs[crumbs.length - 1]}` : "Novo registro"), kind: "new", module: owner?.id };
  }
  const crumbs = crumbsFor(pathname, qs);
  return { key: pathname, href, label: crumbs[crumbs.length - 1] ?? pathname, kind: "page", module: owner?.id };
}
export const tabKeyFor = (pathname: string, search?: string | URLSearchParams | null) => tabFor(pathname, search).key;

/** Aba permitida para o usuário atual (revalidação ao restaurar): módulo/detalhe pelas permissões da SSOT. */
export function tabAllowed(t: WsTab, can: (p: string) => boolean): boolean {
  if (t.kind === "home") return true;
  if (t.kind === "detail") { const det = detailRouteFor(t.key); return permOk(can, det?.perm ?? null) && (!t.module || permOk(can, modulePerm(t.module))); }
  return !t.module || permOk(can, modulePerm(t.module));
}

interface State { tabs: WsTab[]; active: string }
type Action = { type: "restore"; tabs: WsTab[]; active: string } | { type: "sync"; tab: WsTab } | { type: "close"; key: string } | { type: "closeOthers"; key: string } | { type: "title"; key: string; label: string } | { type: "closeKinds"; kinds: TabKind[] };
const HOME: WsTab = { key: HOME_KEY, href: "/", label: "Início", kind: "home", module: "inicio" };
const withHome = (tabs: WsTab[]) => (tabs.some((t) => t.key === HOME_KEY) ? tabs : [HOME, ...tabs]);
function reducer(s: State, a: Action): State {
  switch (a.type) {
    case "restore": return { tabs: withHome(a.tabs), active: a.active };
    case "sync": {
      const i = s.tabs.findIndex((t) => t.key === a.tab.key);
      if (i >= 0) { const cur = s.tabs[i]!; const same = cur.href === a.tab.href && s.active === a.tab.key; if (same) return s; const tabs = [...s.tabs]; tabs[i] = { ...cur, href: a.tab.href }; return { tabs, active: a.tab.key }; }
      let tabs = [...s.tabs, a.tab];
      if (tabs.length > MAX_TABS) { const victim = tabs.find((t) => t.kind !== "home" && t.key !== a.tab.key); if (victim) tabs = tabs.filter((t) => t !== victim); }
      return { tabs, active: a.tab.key };
    }
    case "close": { if (a.key === HOME_KEY) return s; const i = s.tabs.findIndex((t) => t.key === a.key); if (i < 0) return s; const tabs = s.tabs.filter((t) => t.key !== a.key); const active = s.active === a.key ? (tabs[i - 1] ?? tabs[i] ?? HOME).key : s.active; return { tabs, active }; }
    case "closeOthers": return { tabs: s.tabs.filter((t) => t.key === a.key || t.kind === "home"), active: a.key };
    case "closeKinds": { const tabs = s.tabs.filter((t) => !a.kinds.includes(t.kind)); return { tabs, active: tabs.some((t) => t.key === s.active) ? s.active : HOME_KEY }; }
    case "title": { const i = s.tabs.findIndex((t) => t.key === a.key); if (i < 0 || s.tabs[i]!.label === a.label) return s; const tabs = [...s.tabs]; tabs[i] = { ...tabs[i]!, label: a.label }; return { ...s, tabs }; }
  }
}

export interface WorkspaceTabsApi {
  tabs: WsTab[]; active: string; dirty: ReadonlySet<string>;
  /** abre/foca a aba da tela e navega para a URL real (canonicalizada). */
  openTab: (href: string) => void;
  /** foca uma aba existente (navega para o href guardado). */
  focusTab: (key: string) => void;
  /** fecha; devolve false quando a aba está suja e `force` não foi passado. */
  closeTab: (key: string, force?: boolean) => boolean;
  closeOthers: (key: string) => void;
  /** fecha abas de registro/criação (troca de fazenda): devolve true se a aba ativa foi fechada. */
  closeScoped: () => boolean;
  setTitle: (key: string, label: string) => void;
  setDirty: (key: string, dirty: boolean) => void;
  hasDirty: () => boolean;
}
const Ctx = React.createContext<WorkspaceTabsApi | null>(null);
const storageKey = (orgId: string, userId: string) => `agro.tabs.${orgId}.${userId}`;

export function WorkspaceTabsProvider({ orgId, userId, can, children }: { orgId: string; userId: string; can: (p: string) => boolean; children: React.ReactNode }) {
  const pathname = usePathname(); const sp = useSearchParams(); const router = useRouter();
  const [state, dispatch] = React.useReducer(reducer, { tabs: [HOME], active: HOME_KEY });
  const [dirty, setDirtyState] = React.useState<Set<string>>(() => new Set());
  const restored = React.useRef<string | null>(null);
  const skey = storageKey(orgId, userId);
  // restaura metadados (só para a mesma organização/usuário) e revalida permissões
  React.useLayoutEffect(() => {
    if (restored.current === skey) return; restored.current = skey;
    let tabs: WsTab[] = []; let active = HOME_KEY;
    try { const raw = sessionStorage.getItem(skey); if (raw) { const p = JSON.parse(raw) as { tabs?: WsTab[]; active?: string }; tabs = (p.tabs ?? []).filter((t) => t && typeof t.key === "string" && typeof t.href === "string" && typeof t.label === "string").filter((t) => tabAllowed(t, can)); active = typeof p.active === "string" ? p.active : HOME_KEY; } } catch { /* ignore */ }
    dispatch({ type: "restore", tabs, active: tabs.some((t) => t.key === active) ? active : HOME_KEY });
  }, [skey, can]);
  // URL real → aba (link, deep link, voltar/avançar, redirecionamentos)
  React.useLayoutEffect(() => { if (canonicalize(pathname, sp)) return; dispatch({ type: "sync", tab: tabFor(pathname, sp) }); }, [pathname, sp]);
  React.useEffect(() => { try { sessionStorage.setItem(skey, JSON.stringify({ tabs: state.tabs.map(({ key, href, label, kind, module }) => ({ key, href, label, kind, module })), active: state.active })); } catch { /* ignore */ } }, [state, skey]);
  React.useEffect(() => { if (!dirty.size) return; const h = (e: BeforeUnloadEvent) => { e.preventDefault(); }; window.addEventListener("beforeunload", h); return () => window.removeEventListener("beforeunload", h); }, [dirty]);
  const api = React.useMemo<WorkspaceTabsApi>(() => ({
    tabs: state.tabs, active: state.active, dirty,
    openTab: (href) => { const [p, q] = split(href); const canon = canonicalize(p, q) ?? href; const [cp, cq] = split(canon); dispatch({ type: "sync", tab: tabFor(cp, cq) }); router.push(canon); },
    focusTab: (key) => { const t = state.tabs.find((x) => x.key === key); if (!t) return; router.push(t.href); },
    closeTab: (key, force) => {
      if (dirty.has(key) && !force) return false;
      const i = state.tabs.findIndex((t) => t.key === key); if (i < 0 || key === HOME_KEY) return true;
      if (dirty.has(key)) setDirtyState((d) => { const n = new Set(d); n.delete(key); return n; });
      dispatch({ type: "close", key });
      if (state.active === key) { const next = state.tabs[i - 1] ?? state.tabs[i + 1] ?? HOME; router.push(next.href); }
      return true;
    },
    closeOthers: (key) => { dispatch({ type: "closeOthers", key }); const t = state.tabs.find((x) => x.key === key); if (t && state.active !== key) router.push(t.href); },
    closeScoped: () => { const cur = state.tabs.find((t) => t.key === state.active); dispatch({ type: "closeKinds", kinds: ["detail", "new"] }); setDirtyState(new Set()); return Boolean(cur && (cur.kind === "detail" || cur.kind === "new")); },
    setTitle: (key, label) => dispatch({ type: "title", key, label }),
    setDirty: (key, d) => setDirtyState((prev) => { if (prev.has(key) === d) return prev; const n = new Set(prev); if (d) n.add(key); else n.delete(key); return n; }),
    hasDirty: () => dirty.size > 0
  }), [state, dirty, router]);
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

/** Acesso à barra de abas (null fora do shell — telas e testes unitários não dependem dela). */
export const useWorkspaceTabs = () => React.useContext(Ctx);

/** Título dinâmico da aba da tela atual (ex.: "Abastecimento 00125"); não altera a identidade da aba. */
export function useTabTitle(title?: string | null) {
  const api = useWorkspaceTabs(); const pathname = usePathname();
  React.useEffect(() => { if (api && title && title.trim()) api.setTitle(tabKeyFor(pathname), title.trim()); }, [api, title, pathname]);
}
/** Contrato de estado não salvo: a aba mostra indicador e fechar/trocar fazenda/sair pedem confirmação. */
export function useDirtyTab(dirty: boolean) {
  const api = useWorkspaceTabs(); const pathname = usePathname(); const key = tabKeyFor(pathname);
  React.useEffect(() => { if (!api) return; api.setDirty(key, dirty); return () => api.setDirty(key, false); }, [api, key, dirty]);
}
