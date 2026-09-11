/**
 * Navegação derivada da FONTE ÚNICA (apps/web/nav.registry.mjs — só metadados). Daqui saem o menu principal (só
 * módulos), a busca global de funcionalidades, os breadcrumbs, a rota canônica dos favoritos e a canonicalização de
 * abas antigas (`?tab=`/`?sub=` da V1). Ver docs/UX-ARCHITECTURE.md (Compactação V2).
 */
import { MODULES, AREAS, ALL, LEGACY_TABS, canonicalHref, type NavEntry } from "../../nav.registry.mjs";

export type { NavEntry };
export interface NavItem { id: string; label: string; href: string; perm?: string | string[]; description?: string }

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const asList = (p?: string | string[] | null): string[] => !p ? [] : Array.isArray(p) ? p : [p];

/** Um item aparece se não exige permissão ou se o usuário tem qualquer uma das listadas. */
export const permOk = (can: (p: string) => boolean, perm?: string | string[] | null) => !perm || (Array.isArray(perm) ? perm.some(can) : can(perm));

/** Permissão efetiva do módulo: a própria ou a união das permissões de suas áreas/ações (aparece com QUALQUER uma). */
export function modulePerm(moduleId: string): string[] {
  const mod = MODULES.find((x) => x.id === moduleId);
  if (mod?.perm) return asList(mod.perm);
  return [...new Set(AREAS.filter((e) => e.module === moduleId).flatMap((e) => asList(e.perm)))];
}

/** Menu principal: só os módulos (as áreas ficam dentro de cada módulo). */
export const NAV: NavItem[] = MODULES.map((mod) => ({ id: mod.id, label: mod.label, href: canonicalHref(mod), perm: modulePerm(mod.id), description: mod.description }));
export const moduleOf = (id: string) => MODULES.find((x) => x.id === id);
export const entryById = (id: string) => ALL.find((x) => x.id === id);
export { canonicalHref };

/** Chave de comparação de rota: caminho + aba (`tab`) — ignora demais parâmetros. */
export function navKey(pathname: string, search?: string | URLSearchParams | null): string {
  const sp = typeof search === "string" ? new URLSearchParams(search) : search;
  const tab = sp?.get("tab"); return tab ? `${pathname}?tab=${tab}` : pathname;
}
export function hrefKey(href: string): string { const [p, q] = href.split("?"); return navKey(p!, q ?? null); }

const toSP = (search?: string | URLSearchParams | null) => (typeof search === "string" ? new URLSearchParams(search) : search) ?? new URLSearchParams();

/** Módulo dono de um caminho (rota canônica ou rota de detalhe/criação sob o mesmo prefixo). */
export function moduleForPath(pathname: string): NavEntry | undefined {
  if (pathname === "/") return MODULES[0];
  const cands = MODULES.filter((m) => m.path !== "/" && (pathname === m.path || pathname.startsWith(m.path + "/")));
  const byPath = cands.sort((x, y) => (y.path?.length ?? 0) - (x.path?.length ?? 0))[0];
  if (byPath) return byPath;
  // rotas de detalhe fora do prefixo do módulo (ex.: /suprimentos/view, /cadastros/x): pelo path das áreas/ações
  const area = ALL.find((e) => e.type !== "module" && (e.path && pathname.startsWith(e.path)));
  if (area) return moduleOf(area.module);
  const act = ALL.find((e) => e.href && pathname.startsWith(e.href.split("?")[0]!.replace(/\/new$/, "")));
  return act ? moduleOf(act.module) : undefined;
}

/** Entrada mais específica para (caminho, tab, sub): sub › área › módulo. */
export function entryFor(pathname: string, search?: string | URLSearchParams | null): NavEntry | undefined {
  const sp = toSP(search); const tab = sp.get("tab"); const sub = sp.get("sub");
  const inPath = (e: NavEntry) => (e.path ?? moduleOf(e.module)?.path) === pathname;
  if (sub && tab) { const hit = ALL.find((e) => e.type === "sub" && inPath(e) && e.tab === tab && e.sub === sub); if (hit) return hit; }
  if (tab) { const hit = ALL.find((e) => (e.type === "area" || e.type === "config" || (e.type === "sub" && !e.sub)) && inPath(e) && e.tab === tab); if (hit) return hit; }
  const area = ALL.find((e) => e.type === "area" && inPath(e) && !e.tab); if (area) return area;
  return moduleForPath(pathname);
}

/** Breadcrumbs derivados da arquitetura: Módulo › Área › Sub (rotas de detalhe recebem o módulo dono). */
export function crumbsFor(pathname: string, search?: string | URLSearchParams | null): string[] {
  const e = entryFor(pathname, search); if (!e) return [];
  const mod = moduleOf(e.module); const out: string[] = mod ? [mod.label] : [];
  if (e.type === "module") return out;
  if (e.type === "sub" && e.sub) { const area = ALL.find((x) => x.module === e.module && x.tab === e.tab && (x.type === "area" || x.type === "config") && !x.sub); if (area && area.label !== mod?.label) out.push(area.label); }
  if (e.type === "sub" && !e.sub && e.path) { const parent = ALL.find((x) => x.type === "area" && x.path === e.path && x.module === e.module); if (parent) out.push(parent.label); }
  if (e.label !== out[out.length - 1]) out.push(e.label);
  return out;
}

/** Parâmetros estáveis de contexto que fazem parte da rota canônica/favorito (filtros temporários de pesquisa não). */
export const STABLE_PARAMS = ["tab", "sub", "type", "scope", "stage", "kind", "role", "view", "action", "module"];
/** Rota canônica para favoritos/notificações: caminho + tab + sub + parâmetros estáveis (sem filtros temporários). */
export function favoriteRoute(pathname: string, search?: string | URLSearchParams | null): string {
  const canon = canonicalize(pathname, search); if (canon) { const [p, q] = canon.split("?"); return favoriteRoute(p!, q ?? null); }
  const sp = toSP(search); const out = new URLSearchParams();
  for (const k of STABLE_PARAMS) { const v = sp.get(k); if (v) out.set(k, v); }
  const qs = out.toString(); return qs ? `${pathname}?${qs}` : pathname;
}

/**
 * Canonicaliza abas/sub-abas antigas (V1) para a estrutura atual: devolve a nova URL ou null se já está canônica.
 * Ex.: /estoque?tab=saidas&sub=requisicoes → /estoque?tab=operacoes&sub=requisicoes (demais parâmetros preservados).
 */
export function canonicalize(pathname: string, search?: string | URLSearchParams | null): string | null {
  const sp = toSP(search); const tab = sp.get("tab"); if (!tab) return null;
  const mod = MODULES.find((m) => m.path === pathname); const key = mod ? mod.id : pathname.replace(/^\//, "");
  const map = LEGACY_TABS[key] ?? LEGACY_TABS[pathname.replace(/^\//, "")]; if (!map) return null;
  const sub = sp.get("sub"); const target = (sub && map[`${tab}/${sub}`]) || map[tab]; if (!target) return null;
  const out = new URLSearchParams(sp); out.delete("tab"); out.delete("sub");
  if (target.tab) out.set("tab", target.tab); if (target.sub) out.set("sub", target.sub);
  for (const [k, v] of Object.entries(target.query ?? {})) out.set(k, v);
  const path = target.path ?? pathname; const qs = out.toString(); const next = qs ? `${path}?${qs}` : path;
  const cur = sp.toString() ? `${pathname}?${sp.toString()}` : pathname;
  return next === cur ? null : next;
}

export interface SearchHit { id: string; label: string; href: string; path: string[]; type: NavEntry["type"]; score: number }
/** Índice da busca global: módulos, áreas, sub-áreas, ações e configurações (rótulo, descrição, palavras-chave e aliases). */
export function searchNav(query: string, can: (p: string) => boolean, limit = 12): SearchHit[] {
  const q = norm(query.trim()); if (q.length < 2) return [];
  const terms = q.split(/\s+/).filter(Boolean);
  const hits: SearchHit[] = [];
  for (const e of ALL) {
    if (e.search === false || !permOk(can, e.perm)) continue;
    if (e.type !== "module" && !permOk(can, modulePerm(e.module))) continue;
    const mod = moduleOf(e.module); const area = e.type === "sub" && e.tab ? ALL.find((x) => x.module === e.module && x.tab === e.tab && (x.type === "area" || x.type === "config") && !x.sub) : undefined;
    const path = [mod?.label, area && area.label !== mod?.label ? area.label : undefined, e.type !== "module" && e.label !== area?.label ? e.label : undefined].filter((x): x is string => Boolean(x));
    const label = norm(e.label); const kw = (e.keywords ?? []).map(norm); const desc = norm(e.description ?? ""); const crumbs = norm(path.join(" ")); const aliases = (e.aliases ?? []).map(norm);
    let score = 0;
    for (const t of terms) {
      if (label === t) score += 60; else if (label.startsWith(t)) score += 40; else if (label.includes(t)) score += 25;
      else if (kw.some((k) => k === t)) score += 30; else if (kw.some((k) => k.includes(t))) score += 18;
      else if (crumbs.includes(t)) score += 10; else if (desc.includes(t)) score += 8; else if (aliases.some((a) => a.includes(t))) score += 6;
      else { score = 0; break; } // todos os termos precisam casar em algum campo
    }
    if (score > 0) hits.push({ id: e.id, label: e.label, href: canonicalHref(e), path, type: e.type, score: score + (e.type === "module" ? 5 : e.type === "action" ? -3 : 0) });
  }
  return hits.sort((x, y) => y.score - x.score || x.label.localeCompare(y.label)).slice(0, limit);
}

/** Aba de área de trabalho a partir do registro (rótulo/permissão/descrição vêm da SSOT). */
export function areaTab(id: string): { key: string; label: string; perm?: string | string[]; hint?: string } {
  const e = entryById(id); if (!e) throw new Error(`Entrada de navegação desconhecida: ${id}`);
  return { key: (e.sub ?? e.tab ?? e.id.split(".").pop())!, label: e.label, perm: e.perm ?? undefined, hint: e.description };
}
/** Entradas de configuração (busca dentro de Configurações). */
export const configEntries = () => ALL.filter((e) => e.module === "configuracoes" && e.type !== "module");
/** Opções de atalho (favoritos): módulos, áreas e sub-áreas com rota canônica e trilha legível. */
export function favoriteOptions(can: (p: string) => boolean): { href: string; label: string; short: string }[] {
  return ALL.filter((e) => e.type !== "action" && e.search !== false && permOk(can, e.perm) && permOk(can, modulePerm(e.module))).map((e) => { const [p, q] = canonicalHref(e).split("?"); const path = crumbsFor(p!, q ?? null); return { href: canonicalHref(e), label: path.join(" › ") || e.label, short: e.label }; });
}
