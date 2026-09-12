#!/usr/bin/env node
/**
 * Guardrail de primitives (docs/UI-STANDARD.md, "Primitives visuais"). Roda no `lint` do web, ao lado de nav-audit e
 * copy-audit. Impede que a base cresça fora do sistema de design:
 *  - overlay manual fora de components/ui (`fixed inset-0`, `bg-black/`, `role="dialog"`, `aria-modal`) — usar Dialog /
 *    ConfirmDialog / Drawer;
 *  - StatusBadge / statusTone / *Tone locais — usar StatusBadge(value, domain) de @/components/ui;
 *  - Badge com tonalidade decidida a partir de `status` na tela — idem;
 *  - largura própria em Dialog (`className="max-w-…"`) — usar `size` (sm | md | lg | xl);
 *  - importar @radix-ui/react-dialog fora de components/ui — os overlays oficiais já encapsulam;
 *  - (regras duras, sem baseline) dentro de components/ui: leaf importando o próprio barrel (./index ou
 *    @/components/ui) e ciclos de import entre arquivos da pasta — o barrel só reexporta, o grafo é acíclico.
 * A dívida existente fica em scripts/ui-audit.baseline.json (arquivo → contagem por regra). Ocorrência nova falha; ocorrência
 * removida só avisa (atualize o baseline com `node scripts/ui-audit.mjs --update` ao pagar a dívida).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = path.join(root, "src");
const baselineFile = path.join(root, "scripts", "ui-audit.baseline.json");
const update = process.argv.includes("--update");
const rel = (f) => path.relative(root, f).replace(/\\/g, "/");

const walk = (d, out = []) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) { if (e.name !== "node_modules" && e.name !== ".next") walk(p, out); } else if (/\.tsx?$/.test(e.name) && !/\.(test|spec)\./.test(e.name)) out.push(p); } return out; };
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " ")).replace(/^\s*\/\/.*$/gm, "");
const isPrimitive = (f) => rel(f).startsWith("src/components/ui/");

const RULES = [
  { id: "overlay-manual", re: /fixed inset-0|bg-black\/|role="dialog"|aria-modal/g, outsideUiOnly: true, hint: "usar Dialog / ConfirmDialog / Drawer de @/components/ui (overlay, foco, ESC e aria já resolvidos)" },
  { id: "status-badge-local", re: /(?:export\s+)?(?:const|function)\s+(?:StatusBadge|statusTone|[a-z]+Tone)\b/g, outsideUiOnly: true, allow: /features\/docs\/shared\.tsx$/, hint: "usar StatusBadge / statusTone de @/components/ui (tonalidade central por domínio)" },
  { id: "badge-status-condicional", re: /<Badge\s+tone=\{[^}]*\["status"\]/g, outsideUiOnly: true, hint: "usar <StatusBadge domain=… value=… /> (rótulo por enumLabel, tonalidade central)" },
  { id: "dialog-largura-propria", re: /<(?:Dialog|ConfirmDialog|Drawer)\b[^>]*className="[^"]*\b(?:max-w-|w-\[)/g, outsideUiOnly: true, hint: "usar a prop size (sm | md | lg | xl)" },
  { id: "radix-dialog-direto", re: /from "@radix-ui\/react-dialog"/g, outsideUiOnly: true, hint: "compor Dialog / Drawer de @/components/ui em vez de importar o Radix na tela" }
];

/** Regras duras (nunca entram no baseline): integridade do grafo de components/ui. */
const UI_DIR = path.join(src, "components", "ui");
const uiFiles = fs.readdirSync(UI_DIR).filter((f) => /\.tsx?$/.test(f)).map((f) => path.join(UI_DIR, f));
const hard = [];
const SELF_IMPORT = /from\s+["'](?:\.\/index(?:\.tsx?)?|\.|@\/components\/ui)["']/g;
const uiEdges = {}; // basename -> Set(basename) (só imports relativos dentro da pasta)
for (const f of uiFiles) {
  const base = path.basename(f).replace(/\.tsx?$/, ""); const s = stripComments(fs.readFileSync(f, "utf8"));
  if (base !== "index") { const n = (s.match(SELF_IMPORT) ?? []).length; if (n) hard.push(`${rel(f)}: ui-barrel-self-import ×${n} — leaf de components/ui não importa o barrel (./index, @/components/ui); importe o arquivo leaf diretamente`); }
  uiEdges[base] = new Set([...s.matchAll(/from\s+["']\.\/([A-Za-z0-9_-]+)(?:\.tsx?)?["']/g)].map((m) => m[1]));
}
const seen = new Set(); const stack = [];
const visit = (n) => { if (stack.includes(n)) { const cyc = [...stack.slice(stack.indexOf(n)), n]; const key = cyc.join(" -> "); if (!seen.has(key)) { seen.add(key); hard.push(`src/components/ui: ui-import-cycle — ${key}`); } return; } if (seen.has(n)) return; stack.push(n); for (const d of uiEdges[n] ?? []) if (uiEdges[d]) visit(d); stack.pop(); seen.add(n); };
for (const n of Object.keys(uiEdges)) visit(n);
if (hard.length) { console.error(`ui-audit: ${hard.length} violação(ões) do grafo de components/ui (sem baseline):\n` + hard.map((e) => "  " + e).join("\n")); process.exit(1); }

const found = {}; // rel(file) -> { rule: count }
const lines = [];
for (const f of walk(src)) {
  const s = stripComments(fs.readFileSync(f, "utf8"));
  for (const r of RULES) {
    if (r.outsideUiOnly && isPrimitive(f)) continue;
    if (r.allow && r.allow.test(rel(f))) continue;
    const n = (s.match(r.re) ?? []).length;
    if (n) { (found[rel(f)] ??= {})[r.id] = n; lines.push(`${rel(f)}: ${r.id} ×${n} — ${r.hint}`); }
  }
}

if (update) { fs.writeFileSync(baselineFile, JSON.stringify(found, null, 2) + "\n"); console.log(`ui-audit: baseline atualizado (${Object.keys(found).length} arquivo(s))`); process.exit(0); }
const baseline = fs.existsSync(baselineFile) ? JSON.parse(fs.readFileSync(baselineFile, "utf8")) : {};
const errors = []; const warnings = [];
for (const [file, rules] of Object.entries(found)) for (const [rule, n] of Object.entries(rules)) { const b = baseline[file]?.[rule] ?? 0; if (n > b) errors.push(`${file}: ${rule} ×${n} (baseline ${b}) — ${RULES.find((r) => r.id === rule).hint}`); }
for (const [file, rules] of Object.entries(baseline)) for (const [rule, b] of Object.entries(rules)) { const n = found[file]?.[rule] ?? 0; if (n < b) warnings.push(`${file}: ${rule} ×${n} (baseline ${b}) — dívida paga: rode \`node scripts/ui-audit.mjs --update\``); }
if (warnings.length) console.warn("ui-audit: baseline desatualizado (não bloqueia):\n" + warnings.map((w) => "  " + w).join("\n"));
if (errors.length) { console.error(`ui-audit: ${errors.length} ocorrência(s) nova(s) fora das primitives oficiais:\n` + errors.map((e) => "  " + e).join("\n")); process.exit(1); }
const debt = Object.values(baseline).reduce((a, r) => a + Object.values(r).reduce((x, y) => x + y, 0), 0);
console.log(`ui-audit: OK (${RULES.length} regras + grafo de components/ui acíclico sem self-import [${uiFiles.length} arquivos], dívida em baseline: ${debt} ocorrência(s) em ${Object.keys(baseline).length} arquivo(s))`);
