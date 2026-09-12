/**
 * Mega-menu derivado da FONTE ÚNICA de navegação (nav.registry.mjs): grupos = áreas do módulo, itens = sub-áreas
 * (ou a própria área quando não tem sub-áreas) + grupo "Ações" (type: "action"). Nenhuma árvore paralela — só um
 * adapter de leitura sobre ALL/MODULES, filtrado pelas permissões do usuário (o backend continua a autoridade).
 */
import { ALL, MODULES, canonicalHref, type NavEntry } from "../../nav.registry.mjs";
import { modulePerm, permOk } from "./nav";

export interface MegaItem { id: string; label: string; href: string; type: NavEntry["type"]; hint?: string }
export interface MegaGroup { id: string; label: string; items: MegaItem[] }
export interface MegaMenuData { module: NavEntry; groups: MegaGroup[]; count: number }

const item = (e: NavEntry): MegaItem => ({ id: e.id, label: e.label, href: canonicalHref(e), type: e.type, hint: e.description });

/** Grupos/itens visíveis de um módulo para o usuário (`can`). Módulo sem nenhum destino permitido → null. */
export function megaMenuFor(moduleId: string, can: (p: string) => boolean): MegaMenuData | null {
  const mod = MODULES.find((m) => m.id === moduleId); if (!mod || !permOk(can, modulePerm(moduleId))) return null;
  const entries = ALL.filter((e) => e.module === moduleId && e.type !== "module" && e.search !== false);
  const ok = (e: NavEntry) => permOk(can, e.perm);
  const groups: MegaGroup[] = [];
  const areas = entries.filter((e) => (e.type === "area" || e.type === "config") && e.tab);
  for (const area of areas) {
    const subs = entries.filter((e) => e.type === "sub" && e.tab === area.tab && e.sub && ok(e));
    if (subs.length) groups.push({ id: area.id, label: area.label, items: subs.map(item) });
    else if (ok(area)) groups.push({ id: area.id, label: area.label, items: [item(area)] });
  }
  // áreas sem `tab` (módulos de lista única, ex.: OS, Relatórios) e sub-áreas com path próprio
  const loose = entries.filter((e) => (e.type === "area" && !e.tab) || (e.type === "sub" && !e.sub)).filter(ok);
  if (loose.length) groups.push({ id: `${moduleId}.geral`, label: mod.label, items: loose.map(item) });
  const actions = entries.filter((e) => e.type === "action").filter(ok);
  if (actions.length) groups.push({ id: `${moduleId}.acoes`, label: "Ações", items: actions.map(item) });
  // agrupa áreas pequenas (1 item cada) do mesmo módulo numa coluna só quando há muitas colunas
  const merged = compact(groups, mod.label);
  return { module: mod, groups: merged, count: merged.reduce((n, g) => n + g.items.length, 0) };
}

/** Une grupos de 1 item numa coluna "Áreas" quando o módulo teria mais de 4 colunas (legibilidade do mega-menu). */
function compact(groups: MegaGroup[], moduleLabel: string): MegaGroup[] {
  if (groups.length <= 4) return groups;
  const singles = groups.filter((g) => g.items.length === 1 && g.label !== "Ações" && g.label !== moduleLabel);
  if (singles.length < 2) return groups;
  const rest = groups.filter((g) => !singles.includes(g));
  const idx = groups.indexOf(singles[0]!);
  const merged: MegaGroup = { id: "areas", label: "Áreas", items: singles.map((g) => ({ ...g.items[0]!, label: g.label === g.items[0]!.label ? g.label : `${g.label}` })) };
  rest.splice(Math.min(idx, rest.length), 0, merged);
  return rest;
}

/** Colunas do painel: até 3 (referência visual), conforme o número de grupos. */
export const megaColumns = (groups: MegaGroup[]) => Math.max(1, Math.min(3, groups.length));
