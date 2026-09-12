#!/usr/bin/env node
/**
 * AUDITORIA DE NOMENCLATURA E INDEPENDÊNCIA DO SISTEMA DE REFERÊNCIA
 * (docs/DOMAIN-NAMING-STANDARD.md, seção "Independência").
 *
 * O produto é uma reimplementação própria: nomes comerciais, domínios e identificadores do sistema de
 * referência não pertencem ao runtime nem ao código de produto. A classificação das ocorrências é a do
 * padrão de nomenclatura:
 *
 *   A. runtime/produto            → PROIBIDO (falha o gate)
 *   B. código próprio             → PROIBIDO quando não há razão técnica (falha o gate)
 *   C. documentação histórica     → PERMITIDO em docs/reference/, marcado como referência externa
 *   D. licença/atribuição legal   → PERMITIDO com justificativa explícita no ALLOW
 *
 * Também mantém uma CATRACA de identificadores herdados (prefixo `mg-`, iniciais do sistema de referência):
 * não renomeia nada — apenas impede que a dívida cresça. Renomear é decisão de missão própria (DATA-GOV).
 *
 *   node scripts/naming-audit.mjs            audita (gate)
 *   node scripts/naming-audit.mjs --update   regrava o baseline da catraca
 */
import fs from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "./lib/schema.mjs";
import { DATA_DICTIONARY } from "../packages/platform/data-dictionary.registry.mjs";

const BASELINE = path.join(REPO_ROOT, "scripts", "naming-audit.baseline.json");
const update = process.argv.includes("--update");

/** Nomes do sistema de referência e domínios associados. */
const FORBIDDEN = [
  { id: "agro365", re: /agro-?365/gi },
  { id: "wagro", re: /\bw-?agro\b/gi },
  { id: "makgestao", re: /makgest(a|ã)o/gi },
  { id: "projetomg", re: /projeto-?mg/gi }
];

/** Identificadores herdados: não proibidos hoje, mas a dívida não pode crescer. */
const LEGACY_IDENTIFIERS = [{ id: "prefixo-mg", re: /\bmg-[a-z0-9-]+/gi, note: "prefixo derivado das iniciais do sistema de referência" }];

/** Superfícies auditadas como PRODUTO (categorias A e B). Documentação fica fora por definição. */
const PRODUCT = [
  (f) => f.startsWith("apps/api/src/"),
  (f) => f.startsWith("apps/api/test/"),
  (f) => f.startsWith("apps/web/src/"),
  (f) => f.startsWith("apps/web/e2e/"),
  (f) => /^apps\/web\/(nav\.registry|redirects|next\.config|playwright\.config)/.test(f),
  (f) => f.startsWith("packages/") && !f.includes("/node_modules/"),
  (f) => f.startsWith("supabase/"),
  (f) => f.startsWith("scripts/")
];

/** Exceções conscientes (categoria D ou razão técnica). Texto exato → motivo. Nunca silencie sem razão. */
const ALLOW = new Map([]);

const SKIP_DIRS = new Set(["node_modules", ".next", "dist", ".git", "coverage", "test-results", "playwright-report", ".turbo"]);
const EXT = /\.(ts|tsx|mts|mjs|js|jsx|sql|css|json)$/;
/** A própria ferramenta declara os termos que procura. */
const SELF = new Set(["scripts/naming-audit.mjs", "scripts/naming-audit.baseline.json"]);

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (EXT.test(e.name)) out.push(p);
  }
  return out;
}
const rel = (f) => path.relative(REPO_ROOT, f).replace(/\\/g, "/");
const lineOf = (src, idx) => src.slice(0, idx).split("\n").length;

const findings = [];
const legacy = new Map();
let scanned = 0;

for (const file of walk(REPO_ROOT)) {
  const r = rel(file);
  if (SELF.has(r) || !PRODUCT.some((m) => m(r))) continue;
  scanned++;
  const src = fs.readFileSync(file, "utf8");
  for (const term of FORBIDDEN) {
    for (const m of src.matchAll(term.re)) {
      const line = src.split("\n")[lineOf(src, m.index) - 1]?.trim() ?? "";
      if (ALLOW.has(line)) continue;
      findings.push(`${r}:${lineOf(src, m.index)}: "${m[0]}" — referência ao sistema de referência em código de produto (${term.id})`);
    }
  }
  for (const leg of LEGACY_IDENTIFIERS) {
    const n = (src.match(leg.re) ?? []).length;
    if (n) legacy.set(leg.id, (legacy.get(leg.id) ?? 0) + n);
  }
}

/** A taxonomia do dicionário precisa ser própria (nunca códigos/siglas do sistema de referência). */
for (const entry of DATA_DICTIONARY) {
  for (const term of FORBIDDEN) if (term.re.test(entry.code)) findings.push(`dicionário: código "${entry.code}" reproduz nomenclatura externa`);
  if (!/^AGR-/.test(entry.code)) findings.push(`dicionário: código "${entry.code}" fora da taxonomia própria (AGR-…)`);
}

const counts = Object.fromEntries([...legacy].sort());
if (update) {
  fs.writeFileSync(BASELINE, JSON.stringify({ generatedBy: "scripts/naming-audit.mjs", legacyIdentifiers: counts }, null, 2) + "\n");
  console.log(`naming-audit: baseline atualizado (${Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(", ") || "sem dívida"})`);
  process.exit(0);
}

if (findings.length) {
  console.error(`naming-audit: ${findings.length} referência(s) proibida(s) em código de produto`);
  for (const f of findings) console.error(`  - ${f}`);
  console.error("  O histórico do sistema de referência fica em docs/reference/ (categoria C), nunca no runtime.");
  process.exit(1);
}

const base = fs.existsSync(BASELINE) ? JSON.parse(fs.readFileSync(BASELINE, "utf8")).legacyIdentifiers ?? {} : {};
const grown = Object.entries(counts).filter(([k, v]) => v > (base[k] ?? 0));
if (grown.length) {
  console.error("naming-audit: identificadores herdados aumentaram (a dívida só pode diminuir):");
  for (const [k, v] of grown) {
    const note = LEGACY_IDENTIFIERS.find((l) => l.id === k)?.note ?? "";
    console.error(`  - ${k}: ${base[k] ?? 0} → ${v} (${note})`);
  }
  console.error("  Use tokens neutros no código novo; se a mudança for deliberada, rode `node scripts/naming-audit.mjs --update` no mesmo commit.");
  process.exit(1);
}
console.log(`naming-audit: OK (${scanned} arquivos de produto; dívida herdada: ${Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(", ") || "nenhuma"})`);
