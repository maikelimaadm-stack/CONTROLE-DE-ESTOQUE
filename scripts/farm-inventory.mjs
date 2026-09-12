#!/usr/bin/env node
/**
 * INVENTÁRIO DA DEPENDÊNCIA ESTRUTURAL DE "FAZENDA" (docs/FARM-DEPENDENCY-INVENTORY.md).
 *
 * O ERP precisa deixar de depender semanticamente do nicho agro no núcleo: "fazenda" vira EMPRESA
 * (docs/MULTI-COMPANY-CONTRACT.md). Isso NÃO se resolve com localizar/substituir — primeiro é preciso
 * medir a superfície real. Este script produz essa medida automaticamente, por superfície e por símbolo,
 * e serve de CATRACA: a dependência pode diminuir, nunca crescer sem decisão explícita.
 *
 *   node scripts/farm-inventory.mjs            regenera o inventário + o baseline
 *   node scripts/farm-inventory.mjs --check    recusa crescimento da dependência (gate)
 *
 * Para crescer de propósito (ex.: camada de compatibilidade de PRE-BASE2-02), atualize o baseline no MESMO
 * commit — a revisão enxerga a intenção no diff.
 */
import fs from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "./lib/schema.mjs";
import { readSchema, companyColumnsOf } from "./lib/schema.mjs";

const OUT = path.join(REPO_ROOT, "docs", "FARM-DEPENDENCY-INVENTORY.md");
const BASELINE = path.join(REPO_ROOT, "scripts", "farm-inventory.baseline.json");
const check = process.argv.includes("--check");

/** Símbolos que amarram o código ao nicho. Cada um tem um destino declarado no padrão de nomenclatura. */
const SYMBOLS = [
  { id: "coluna.farm_id", re: /\b(?:origin_|destination_)?farm_id\b/g, target: "empresa_id", kind: "dado" },
  { id: "tabela.farms", re: /\berp\.farms\b/g, target: "erp.empresas", kind: "dado" },
  { id: "vinculo.member_farms", re: /\bmember_farms\b/g, target: "member_empresas", kind: "dado" },
  { id: "contexto.ctx_farmId", re: /\bctx\.farmId\b|\bfarmId\b/g, target: "empresaSelecionada", kind: "contrato" },
  { id: "contexto.farmIds", re: /\bfarmIds\b/g, target: "empresasPermitidas", kind: "contrato" },
  { id: "cabecalho.x_farm_id", re: /["']?[xX]-[fF]arm-[iI]d["']?/g, target: "X-Empresa-Id", kind: "contrato" },
  { id: "escopo.farmScope", re: /\bfarmScope(?:Sql)?\b/g, target: "escopoEmpresa", kind: "contrato" },
  { id: "escopo.allowedFarms", re: /\ballowedFarms\b|\bfarmAllowed\b|\bassertFarmVisible\b/g, target: "escopoEmpresa (@erp/plataforma)", kind: "contrato" },
  { id: "rota.farms", re: /\/farms\b|["']farms["']/g, target: "/empresas", kind: "contrato" },
  { id: "texto.fazenda", re: /\bFazendas?\b|\bfazendas?\b/g, target: "Empresa (i18n: termos.empresa)", kind: "texto" }
];

/** Superfícies: o que precisa migrar junto. `ratchet:false` = histórico, medido mas não travado. */
const SURFACES = [
  { id: "schema", label: "Schema (migrations)", match: (f) => f.startsWith("supabase/migrations/"), ratchet: true },
  { id: "api", label: "API — código", match: (f) => f.startsWith("apps/api/src/"), ratchet: true },
  { id: "api-test", label: "API — testes", match: (f) => f.startsWith("apps/api/test/"), ratchet: true },
  { id: "core-neutro", label: "Núcleo neutro de nicho (plataforma)", match: (f) => f.startsWith("packages/plataforma/"), ratchet: true },
  { id: "packages", label: "Pacotes compartilhados", match: (f) => f.startsWith("packages/") && !f.startsWith("packages/plataforma/"), ratchet: true },
  { id: "web", label: "Web — código", match: (f) => f.startsWith("apps/web/src/"), ratchet: true },
  { id: "web-nav", label: "Web — navegação/rotas", match: (f) => /^apps\/web\/(nav\.registry|redirects)/.test(f), ratchet: true },
  { id: "web-test", label: "Web — testes ponta a ponta", match: (f) => f.startsWith("apps/web/e2e/"), ratchet: true },
  { id: "scripts", label: "Scripts e gates", match: (f) => f.startsWith("scripts/") || f.startsWith("apps/web/scripts/"), ratchet: true },
  { id: "docs", label: "Documentação ativa", match: (f) => f.startsWith("docs/") && !f.startsWith("docs/reference/"), ratchet: false },
  { id: "reference", label: "Documentação histórica (referência externa)", match: (f) => f.startsWith("docs/reference/"), ratchet: false }
];

const SKIP_DIRS = new Set(["node_modules", ".next", "dist", ".git", "coverage", "test-results", "playwright-report", ".turbo"]);
/**
 * Artefatos GERADOS e a própria ferramenta ficam fora da medição: contar o inventário dentro do inventário
 * faria o número crescer a cada regeneração (e a catraca perderia o sentido).
 */
const EXCLUDE = new Set([
  "docs/FARM-DEPENDENCY-INVENTORY.md",
  "docs/DATA-DICTIONARY.md",
  "scripts/farm-inventory.mjs",
  "scripts/farm-inventory.baseline.json",
  "scripts/naming-audit.mjs",
  "scripts/lib/schema.mjs"
]);
const EXT = /\.(ts|tsx|mts|mjs|js|jsx|sql|md|json|css)$/;

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
const surfaceOf = (f) => SURFACES.find((s) => s.match(f))?.id ?? null;

function collect() {
  const bySurface = new Map(SURFACES.map((s) => [s.id, { total: 0, symbols: new Map(), files: new Map() }]));
  for (const file of walk(REPO_ROOT)) {
    const r = rel(file);
    if (EXCLUDE.has(r)) continue;
    const surface = surfaceOf(r);
    if (!surface) continue;
    const src = fs.readFileSync(file, "utf8");
    if (!/farm|fazenda/i.test(src)) continue;
    const bucket = bySurface.get(surface);
    for (const sym of SYMBOLS) {
      const n = (src.match(sym.re) ?? []).length;
      if (!n) continue;
      bucket.total += n;
      bucket.symbols.set(sym.id, (bucket.symbols.get(sym.id) ?? 0) + n);
      bucket.files.set(r, (bucket.files.get(r) ?? 0) + n);
    }
  }
  return bySurface;
}

const schema = readSchema();
const companyTables = [...schema.values()].filter((t) => companyColumnsOf(t).filter((c) => c !== "empresa_id").length)
  .map((t) => ({ table: t.table, columns: companyColumnsOf(t).filter((c) => c !== "empresa_id") }))
  .sort((a, b) => a.table.localeCompare(b.table));

const data = collect();
const counts = Object.fromEntries([...data].map(([id, v]) => [id, v.total]));
const symbolTotals = new Map();
for (const [, v] of data) for (const [sym, n] of v.symbols) symbolTotals.set(sym, (symbolTotals.get(sym) ?? 0) + n);
const grandTotal = Object.values(counts).reduce((a, b) => a + b, 0);

function render() {
  const out = [];
  out.push("# Inventário — dependência estrutural de \"Fazenda\"", "");
  out.push("> **Documento gerado.** Não edite à mão: `node scripts/farm-inventory.mjs`.", "");
  out.push("O núcleo do ERP precisa deixar de depender do nicho agro: **Fazenda → Empresa**");
  out.push("(`docs/MULTI-COMPANY-CONTRACT.md`, `docs/DOMAIN-NAMING-STANDARD.md`). Este inventário mede a superfície real");
  out.push("antes de qualquer renomeação — localizar/substituir em massa aqui quebraria contrato de API, RLS e dados.", "");
  out.push(`Total medido: **${grandTotal}** ocorrências em ${SURFACES.length} superfícies · ${companyTables.length} tabelas com coluna de empresa.`, "");
  out.push("## Por superfície", "");
  out.push("| Superfície | Ocorrências | Catraca | Observação |", "| --- | ---: | --- | --- |");
  for (const s of SURFACES) {
    const nota = s.id === "core-neutro" ? "só nomes de coluna do registry; PRE-BASE2-03 zera" : s.ratchet ? "não pode crescer" : s.id === "reference" ? "histórico externo: preservado, fora da catraca" : "documentação: acompanha a migração";
    out.push(`| ${s.label} | ${counts[s.id]} | ${s.ratchet ? "sim" : "não"} | ${nota} |`);
  }
  out.push("");
  out.push("## Por símbolo (o que precisa migrar)", "");
  out.push("| Símbolo atual | Natureza | Ocorrências | Destino canônico |", "| --- | --- | ---: | --- |");
  for (const sym of SYMBOLS) out.push(`| \`${sym.id.split(".").slice(1).join(".")}\` | ${sym.kind} | ${symbolTotals.get(sym.id) ?? 0} | \`${sym.target}\` |`);
  out.push("");
  out.push("`dado` = exige migration e backfill · `contrato` = quebra clientes se mudar sem compatibilidade · `texto` = rótulo, resolvido por i18n.", "");
  out.push("## Tabelas com coluna de empresa", "");
  out.push(`As ${companyTables.length} tabelas abaixo carregam o escopo de empresa e migram juntas em PRE-BASE2-03.`, "");
  out.push("| Tabela | Coluna(s) |", "| --- | --- |");
  for (const t of companyTables) out.push(`| \`${t.table}\` | ${t.columns.map((c) => `\`${c}\``).join(" · ")} |`);
  out.push("");
  out.push("## Arquivos mais acoplados", "");
  out.push("Ordem de ataque sugerida: quem concentra mais ocorrências define o risco da migração.", "");
  out.push("| Arquivo | Superfície | Ocorrências |", "| --- | --- | ---: |");
  const files = [];
  for (const [surfaceId, v] of data) for (const [f, n] of v.files) files.push({ f, surfaceId, n });
  for (const row of files.sort((a, b) => b.n - a.n).slice(0, 25)) {
    out.push(`| \`${row.f}\` | ${SURFACES.find((s) => s.id === row.surfaceId).label} | ${row.n} |`);
  }
  out.push("");
  out.push("## Como esta catraca funciona", "");
  out.push("`node scripts/farm-inventory.mjs --check` roda no `lint` e falha se qualquer superfície com catraca crescer");
  out.push("em relação a `scripts/farm-inventory.baseline.json`. Para crescer de propósito (camada de compatibilidade,");
  out.push("por exemplo), regenere o baseline no MESMO commit: a intenção fica visível na revisão.", "");
  return out.join("\n");
}

if (check) {
  if (!fs.existsSync(BASELINE)) { console.error("farm-inventory: baseline ausente — rode `node scripts/farm-inventory.mjs`."); process.exit(1); }
  const base = JSON.parse(fs.readFileSync(BASELINE, "utf8"));
  const grown = SURFACES.filter((s) => s.ratchet && counts[s.id] > (base.counts?.[s.id] ?? 0));
  if (grown.length) {
    console.error("farm-inventory: a dependência de \"fazenda\" cresceu — Fazenda → Empresa só pode diminuir:");
    for (const s of grown) console.error(`  - ${s.label}: ${base.counts[s.id]} → ${counts[s.id]}`);
    console.error("  Se o crescimento for deliberado, regenere o baseline no mesmo commit (node scripts/farm-inventory.mjs).");
    process.exit(1);
  }
  const shrunk = SURFACES.filter((s) => s.ratchet && counts[s.id] < (base.counts?.[s.id] ?? 0));
  console.log(`farm-inventory: OK (${grandTotal} ocorrências${shrunk.length ? `; ${shrunk.length} superfície(s) diminuíram — regenere o baseline` : ""})`);
} else {
  fs.writeFileSync(OUT, render());
  fs.writeFileSync(BASELINE, JSON.stringify({ generatedBy: "scripts/farm-inventory.mjs", counts, total: grandTotal, companyTables: companyTables.length }, null, 2) + "\n");
  console.log(`farm-inventory: docs/FARM-DEPENDENCY-INVENTORY.md gerado (${grandTotal} ocorrências, ${companyTables.length} tabelas com coluna de empresa)`);
}
