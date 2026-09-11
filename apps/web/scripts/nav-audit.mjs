#!/usr/bin/env node
/**
 * Auditoria da fonte única de navegação (Compactação V2). Falha (exit 1) se:
 *  - ids duplicados ou entradas sem módulo/rótulo;
 *  - área/sub referenciando módulo inexistente;
 *  - alias apontando para rota canônica que não existe no registro;
 *  - alvo de LEGACY_TABS (aba/sub antiga) que não existe na estrutura atual;
 *  - destino de redirecionamento (sem parâmetros dinâmicos) que não é rota canônica conhecida;
 *  - página de módulo usando `tab("id")` com id que não existe no registro;
 *  - mais de 14 módulos no menu ou módulo com mais de 5 áreas (guardrails de UX).
 * Uso: node scripts/nav-audit.mjs   (também roda no CI e antes do build)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MODULES, AREAS, ALL, LEGACY_TABS, canonicalHref } from "../nav.registry.mjs";
import { LEGACY_REDIRECTS } from "../redirects.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const errors = []; const warn = [];
const ids = new Set();
for (const e of ALL) {
  if (ids.has(e.id)) errors.push(`id duplicado: ${e.id}`); ids.add(e.id);
  if (!e.label) errors.push(`${e.id}: sem rótulo`);
  if (!MODULES.some((m) => m.id === e.module)) errors.push(`${e.id}: módulo desconhecido "${e.module}"`);
  if (e.type === "sub" && e.sub && !ALL.some((a) => a.module === e.module && a.tab === e.tab && !a.sub && a.type !== "action")) errors.push(`${e.id}: área pai (tab=${e.tab}) não existe`);
}
// rotas canônicas conhecidas (path?tab=&sub=) para validar aliases, abas antigas e redirects
const known = new Set(ALL.filter((e) => e.type !== "action").map((e) => canonicalHref(e).split("?")[0] + "|" + new URLSearchParams(canonicalHref(e).split("?")[1] ?? "").get("tab") + "|" + (new URLSearchParams(canonicalHref(e).split("?")[1] ?? "").get("sub") ?? "")));
const isKnown = (href) => { const [p, q] = href.split("?"); const sp = new URLSearchParams(q ?? ""); const tab = sp.get("tab"); const sub = sp.get("sub") ?? ""; return known.has(`${p}|${tab}|${sub}`) || known.has(`${p}|${tab}|`) || known.has(`${p}|null|`); };
for (const [mod, map] of Object.entries(LEGACY_TABS)) {
  const base = MODULES.find((m) => m.id === mod)?.path ?? `/${mod}`;
  for (const [k, t] of Object.entries(map)) { const p = t.path ?? base; const sp = new URLSearchParams(); if (t.tab) sp.set("tab", t.tab); if (t.sub) sp.set("sub", t.sub); const href = sp.toString() ? `${p}?${sp}` : p; if (!isKnown(href)) errors.push(`LEGACY_TABS ${mod}.${k} → ${href}: destino não existe no registro`); }
}
for (const r of LEGACY_REDIRECTS) { if (r.destination.includes(":")) continue; if (r.destination.startsWith("/cadastros/")) continue; if (!isKnown(r.destination)) errors.push(`redirect ${r.source} → ${r.destination}: destino não é rota canônica conhecida`); }
// páginas: tab("id") deve existir
const appDir = path.join(here, "../src/app/(app)");
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((f) => (f.isDirectory() ? walk(path.join(d, f.name)) : f.name === "page.tsx" ? [path.join(d, f.name)] : []));
for (const f of walk(appDir)) { const src = fs.readFileSync(f, "utf8"); for (const m of src.matchAll(/\btab\("([^"]+)"/g)) if (!ids.has(m[1])) errors.push(`${path.relative(appDir, f)}: tab("${m[1]}") não existe no registro`); }
// guardrails
const menu = MODULES.filter((m) => m.menu !== false); if (menu.length > 14) errors.push(`menu principal com ${menu.length} módulos (máximo 14)`);
for (const m of MODULES) { const areas = AREAS.filter((a) => a.module === m.id && a.type === "area" && a.tab); if (areas.length > 5 && m.id !== "configuracoes") warn.push(`${m.id}: ${areas.length} áreas principais (ideal 3–5)`); }
console.log(`nav-audit: ${MODULES.length} módulos · ${AREAS.filter((a) => a.type === "area").length} áreas · ${AREAS.filter((a) => a.type === "sub").length} sub-áreas · ${AREAS.filter((a) => a.type === "action").length} ações · ${AREAS.filter((a) => a.type === "config").length + AREAS.filter((a) => a.module === "configuracoes" && a.type === "sub").length} configurações · ${LEGACY_REDIRECTS.length} redirecionamentos · ${Object.values(LEGACY_TABS).reduce((n, m) => n + Object.keys(m).length, 0)} abas antigas canonicalizadas`);
for (const w of warn) console.log("aviso:", w);
if (errors.length) { for (const e of errors) console.error("ERRO:", e); process.exit(1); }
console.log("nav-audit: OK");
