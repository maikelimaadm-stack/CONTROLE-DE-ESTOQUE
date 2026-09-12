#!/usr/bin/env node
// Gera docs/UI-SHELL-MATRIX.md a partir de nav.registry.mjs (SSOT) — mesma derivação do mega-menu.
import { MODULES, ALL, canonicalHref } from "../nav.registry.mjs";
import fs from "node:fs";
const perm = (p) => (!p ? "—" : Array.isArray(p) ? p.join(" \\| ") : p);
const modulePerm = (id) => { const m = MODULES.find((x) => x.id === id); if (m?.perm) return perm(m.perm); return "união das áreas"; };
let out = `# Matriz do App Shell (gerada de \`apps/web/nav.registry.mjs\`)

Gerada por \`apps/web/scripts/shell-matrix.mjs (node apps/web/scripts/shell-matrix.mjs)\` (derivação idêntica à do mega-menu: grupos = áreas, itens = sub-áreas ou a
própria área, grupo Ações = \`type:"action"\`). Colunas: módulo · grupo do mega-menu · destino · rota canônica ·
permissão (qualquer uma libera) · aparece na busca global · favoritável · \`openTab\` (identidade da aba) ·
disponibilidade responsiva (1024–1920: sempre acessível — módulos que não cabem ficam em **Mais**).

| Módulo | Grupo | Destino | Rota canônica | Permissão | Busca | Favorito | openTab (aba) | Responsivo |
|---|---|---|---|---|---|---|---|---|
`;
let n = 0;
for (const m of MODULES) {
  const entries = ALL.filter((e) => e.module === m.id && e.type !== "module");
  const areas = entries.filter((e) => (e.type === "area" || e.type === "config") && e.tab);
  const rows = [];
  rows.push([m.label, "(módulo)", m.label, canonicalHref(m), modulePerm(m.id)]);
  for (const a of areas) { const subs = entries.filter((e) => e.type === "sub" && e.tab === a.tab && e.sub); if (subs.length) for (const s of subs) rows.push([m.label, a.label, s.label, canonicalHref(s), perm(s.perm)]); else rows.push([m.label, a.label, a.label, canonicalHref(a), perm(a.perm)]); }
  for (const e of entries.filter((e) => (e.type === "area" && !e.tab) || (e.type === "sub" && !e.sub))) rows.push([m.label, m.label, e.label, canonicalHref(e), perm(e.perm)]);
  for (const e of entries.filter((e) => e.type === "action")) rows.push([m.label, "Ações", e.label, canonicalHref(e), perm(e.perm)]);
  for (const [mod, grp, dest, href, p] of rows) { const path = href.split("?")[0]; const isNew = /\/(new|novo)(\/|$)/.test(path); const tab = isNew ? `aba própria (${path})` : `aba do módulo ${mod}`; out += `| ${mod} | ${grp} | ${dest} | \`${href}\` | ${p} | sim | ${grp === "Ações" ? "não" : "sim"} | ${tab} | barra ou **Mais** |\n`; n++; }
}
out += `\nTotal: ${n} destinos · ${MODULES.length} módulos. Menu, mega-menu, busca (\`searchNav\`), favoritos e abas convergem a este mesmo universo (nenhuma árvore paralela).\n`;
fs.writeFileSync(new URL("../../../docs/UI-SHELL-MATRIX.md", import.meta.url), out); console.log("rows", n);
