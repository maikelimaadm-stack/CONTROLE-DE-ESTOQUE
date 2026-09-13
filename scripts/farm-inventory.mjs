#!/usr/bin/env node
/**
 * INVENTÁRIO DA DEPENDÊNCIA ESTRUTURAL DE "FAZENDA" (docs/FARM-DEPENDENCY-INVENTORY.md).
 *
 * O ERP precisa deixar de depender semanticamente do nicho agro no núcleo: "fazenda" vira EMPRESA
 * (docs/MULTI-COMPANY-CONTRACT.md). Isso NÃO se resolve com localizar/substituir — primeiro é preciso
 * medir a superfície real. Este script produz essa medida automaticamente e serve de CATRACA.
 *
 * Depois da migração física (PRE-BASE2-03), um total único mente: `farm_id` numa migration de 2024 é
 * história aplicada, `X-Farm-Id` no cliente HTTP é uma ponte com prazo, e "fazenda" no comentário de uma
 * rota é o produto ainda falando o nicho. Somar os três esconde o único número que interessa. Por isso a
 * medida é classificada em TRÊS baldes, e a catraca trava o terceiro:
 *
 *   1. LEGADO HISTÓRICO                     — migrations aplicadas e documentação. Reescrever é falsificar.
 *   2. COMPATIBILIDADE TRANSITÓRIA PERMITIDA — arquivos DECLARADOS em scripts/lib/empresa-compat-surface.mjs,
 *                                              cada um com motivo e marco de remoção.
 *   3. DÍVIDA DE PRODUTO PROIBIDA           — todo o resto. Alvo: zero. Só pode diminuir.
 *
 *   node scripts/farm-inventory.mjs            regenera o inventário + o baseline
 *   node scripts/farm-inventory.mjs --check    recusa crescimento da dívida de produto (gate)
 *
 * Reduzir o total escondendo arquivo não passa: arquivo não declarado cai no balde 3 por definição, e a
 * declaração é visível no diff.
 */
import fs from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "./lib/schema.mjs";
import { readSchema, companyColumnsOf } from "./lib/schema.mjs";
import { PONTE, PONTE_RUNTIME, PONTE_PROVA, PONTE_GATES, MARCO_DE_REMOCAO } from "./lib/empresa-compat-surface.mjs";

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
  // acesso a campo (`ctx.farms`) entra aqui: é o contrato de resposta, não a tabela — `erp.farms` já é contado acima.
  { id: "rota.farms", re: /\/farms\b|["']farms["']|(?<!erp)\.farms\b/g, target: "/empresas", kind: "contrato" },
  { id: "texto.fazenda", re: /\bFazendas?\b|\bfazendas?\b/g, target: "Empresa (i18n: termos.empresa)", kind: "texto" }
];

/** Superfícies: o que precisa migrar junto. A catraca age sobre o balde 3 DENTRO de cada superfície. */
const SURFACES = [
  { id: "schema", label: "Schema (migrations)", match: (f) => f.startsWith("supabase/migrations/") },
  { id: "api", label: "API — código", match: (f) => f.startsWith("apps/api/src/") },
  { id: "api-test", label: "API — testes", match: (f) => f.startsWith("apps/api/test/") },
  { id: "core-neutro", label: "Núcleo neutro de nicho (plataforma)", match: (f) => f.startsWith("packages/plataforma/") },
  { id: "packages", label: "Pacotes compartilhados", match: (f) => f.startsWith("packages/") && !f.startsWith("packages/plataforma/") },
  { id: "web", label: "Web — código", match: (f) => f.startsWith("apps/web/src/") },
  { id: "web-nav", label: "Web — navegação/rotas", match: (f) => /^apps\/web\/(nav\.registry|redirects)/.test(f) },
  { id: "web-test", label: "Web — testes ponta a ponta", match: (f) => f.startsWith("apps/web/e2e/") },
  { id: "scripts", label: "Scripts e gates", match: (f) => f.startsWith("scripts/") || f.startsWith("apps/web/scripts/") },
  { id: "docs", label: "Documentação ativa", match: (f) => f.startsWith("docs/") && !f.startsWith("docs/reference/") },
  { id: "reference", label: "Documentação histórica (referência externa)", match: (f) => f.startsWith("docs/reference/") }
];

/**
 * Os três baldes de PRE-BASE2-03 §48. `catraca` = o gate recusa crescimento.
 * Só o balde 3 tem catraca: história não diminui, e compatibilidade declarada cresce quando a ponte
 * precisa cobrir mais um caso — o que a revisão vê no diff da declaração, com motivo escrito.
 */
const BUCKETS = [
  { id: "historico", n: 1, label: "LEGADO HISTÓRICO", catraca: false, nota: "Migrations aplicadas e documentação. O nome legado aqui é registro do que aconteceu; reescrever é falsificar história." },
  { id: "compat", n: 2, label: "COMPATIBILIDADE TRANSITÓRIA PERMITIDA", catraca: false, nota: `Arquivos declarados em scripts/lib/empresa-compat-surface.mjs, cada um com motivo. Removidos em ${MARCO_DE_REMOCAO}.` },
  { id: "divida", n: 3, label: "DÍVIDA DE PRODUTO PROIBIDA", catraca: true, nota: "O produto ainda fala o nicho onde não precisa. Alvo: zero. A catraca só deixa diminuir." }
];

/** Balde de um arquivo. Não declarado e não histórico = dívida — é isso que impede esconder arquivo. */
function bucketOf(rel) {
  if (rel.startsWith("supabase/migrations/") || rel.startsWith("docs/")) return "historico";
  if (Object.hasOwn(PONTE, rel)) return "compat";
  return "divida";
}

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
const chave = (surface, bucket) => `${surface}|${bucket}`;

function collect() {
  const bySurface = new Map(SURFACES.map((s) => [s.id, { total: 0, symbols: new Map(), files: new Map() }]));
  const byBucket = new Map(BUCKETS.map((b) => [b.id, { total: 0, symbols: new Map(), files: new Map() }]));
  const cells = new Map();
  for (const file of walk(REPO_ROOT)) {
    const r = rel(file);
    if (EXCLUDE.has(r)) continue;
    const surface = surfaceOf(r);
    if (!surface) continue;
    const src = fs.readFileSync(file, "utf8");
    if (!/farm|fazenda/i.test(src)) continue;
    const bucket = bucketOf(r);
    const s = bySurface.get(surface);
    const b = byBucket.get(bucket);
    for (const sym of SYMBOLS) {
      const n = (src.match(sym.re) ?? []).length;
      if (!n) continue;
      s.total += n;
      s.symbols.set(sym.id, (s.symbols.get(sym.id) ?? 0) + n);
      s.files.set(r, (s.files.get(r) ?? 0) + n);
      b.total += n;
      b.symbols.set(sym.id, (b.symbols.get(sym.id) ?? 0) + n);
      b.files.set(r, (b.files.get(r) ?? 0) + n);
      cells.set(chave(surface, bucket), (cells.get(chave(surface, bucket)) ?? 0) + n);
    }
  }
  return { bySurface, byBucket, cells };
}

const schema = readSchema();
const companyTables = [...schema.values()].filter((t) => companyColumnsOf(t).filter((c) => c !== "empresa_id").length)
  .map((t) => ({ table: t.table, columns: companyColumnsOf(t).filter((c) => c !== "empresa_id") }))
  .sort((a, b) => a.table.localeCompare(b.table));

const { bySurface, byBucket, cells } = collect();
const counts = Object.fromEntries([...bySurface].map(([id, v]) => [id, v.total]));
const baldes = Object.fromEntries([...byBucket].map(([id, v]) => [id, v.total]));
/** O número que a catraca trava: dívida de produto por superfície. */
const divida = Object.fromEntries(SURFACES.map((s) => [s.id, cells.get(chave(s.id, "divida")) ?? 0]));
const symbolTotals = new Map();
for (const [, v] of bySurface) for (const [sym, n] of v.symbols) symbolTotals.set(sym, (symbolTotals.get(sym) ?? 0) + n);
const grandTotal = Object.values(counts).reduce((a, b) => a + b, 0);
/** Declaração sem ocorrência é declaração morta: a ponte encolheu e ninguém apagou a autorização. */
const declaracoesMortas = Object.keys(PONTE).filter((f) => !(byBucket.get("compat").files.get(f) ?? 0));

function render() {
  const out = [];
  out.push("# Inventário — dependência estrutural de \"Fazenda\"", "");
  out.push("> **Documento gerado.** Não edite à mão: `node scripts/farm-inventory.mjs`.", "");
  out.push("O núcleo do ERP precisa deixar de depender do nicho agro: **Fazenda → Empresa**");
  out.push("(`docs/MULTI-COMPANY-CONTRACT.md`, `docs/DOMAIN-NAMING-STANDARD.md`). Depois da migração física de");
  out.push("PRE-BASE2-03, um total único mentiria: `farm_id` numa migration aplicada é história, `X-Farm-Id` no");
  out.push("cliente HTTP é ponte com prazo, e \"fazenda\" no comentário de uma rota é o produto ainda falando o");
  out.push("nicho. Por isso cada ocorrência é classificada em um dos três baldes abaixo — e a catraca trava só o terceiro.", "");
  out.push(`Total medido: **${grandTotal}** ocorrências · ${companyTables.length} tabelas com coluna de empresa.`, "");
  out.push("## Classificação (o número que importa é o balde 3)", "");
  out.push("| # | Balde | Ocorrências | Catraca | O que é |", "| --- | --- | ---: | --- | --- |");
  for (const b of BUCKETS) out.push(`| ${b.n} | **${b.label}** | ${baldes[b.id]} | ${b.catraca ? "**sim — só diminui**" : "não"} | ${b.nota} |`);
  out.push("");
  out.push("A regra que impede maquiagem: **arquivo não declarado cai no balde 3 por definição.** Esconder dívida");
  out.push("exige declarar o arquivo com motivo em `scripts/lib/empresa-compat-surface.mjs` — e a declaração aparece no diff.", "");
  out.push("## Por superfície × balde", "");
  out.push("| Superfície | 1. Histórico | 2. Compatibilidade | 3. Dívida (travada) | Total |", "| --- | ---: | ---: | ---: | ---: |");
  for (const s of SURFACES) {
    const c = BUCKETS.map((b) => cells.get(chave(s.id, b.id)) ?? 0);
    out.push(`| ${s.label} | ${c[0]} | ${c[1]} | ${c[2] ? `**${c[2]}**` : "0"} | ${counts[s.id]} |`);
  }
  out.push(`| **Total** | **${baldes.historico}** | **${baldes.compat}** | **${baldes.divida}** | **${grandTotal}** |`);
  out.push("");
  out.push("## Balde 2 — a ponte declarada", "");
  out.push(`Cada arquivo abaixo pode falar o idioma antigo por um motivo escrito. Todos saem em **${MARCO_DE_REMOCAO}**.`, "");
  for (const [titulo, grupo] of [["Runtime — o que o cliente anterior consome", PONTE_RUNTIME], ["Prova — testes que quebram antes do cliente", PONTE_PROVA], ["Confinamento — gates e dicionário", PONTE_GATES]]) {
    out.push(`### ${titulo}`, "");
    out.push("| Arquivo | Ocorrências | Por que pode |", "| --- | ---: | --- |");
    for (const [f, motivo] of Object.entries(grupo)) out.push(`| \`${f}\` | ${byBucket.get("compat").files.get(f) ?? 0} | ${motivo} |`);
    out.push("");
  }
  out.push("## Balde 3 — dívida de produto (alvo: zero)", "");
  out.push("Onde o produto ainda fala o nicho sem precisar. Ordem de ataque: quem concentra mais.", "");
  out.push("| Arquivo | Superfície | Ocorrências |", "| --- | --- | ---: |");
  const dividaFiles = [];
  for (const [surfaceId, v] of bySurface) for (const [f, n] of v.files) if (bucketOf(f) === "divida") dividaFiles.push({ f, surfaceId, n });
  for (const row of dividaFiles.sort((a, b) => b.n - a.n).slice(0, 25)) {
    out.push(`| \`${row.f}\` | ${SURFACES.find((s) => s.id === row.surfaceId).label} | ${row.n} |`);
  }
  if (dividaFiles.length > 25) out.push(`| _… mais ${dividaFiles.length - 25} arquivo(s)_ | | ${dividaFiles.slice(25).reduce((a, b) => a + b.n, 0)} |`);
  out.push("");
  out.push("## Por símbolo (o que precisa migrar)", "");
  out.push("| Símbolo atual | Natureza | Total | dos quais dívida | Destino canônico |", "| --- | --- | ---: | ---: | --- |");
  for (const sym of SYMBOLS) out.push(`| \`${sym.id.split(".").slice(1).join(".")}\` | ${sym.kind} | ${symbolTotals.get(sym.id) ?? 0} | ${byBucket.get("divida").symbols.get(sym.id) ?? 0} | \`${sym.target}\` |`);
  out.push("");
  out.push("`dado` = exige migration e backfill · `contrato` = quebra clientes se mudar sem compatibilidade · `texto` = rótulo, resolvido por i18n.", "");
  out.push("## Tabelas com coluna de empresa", "");
  out.push(`As ${companyTables.length} tabelas abaixo carregam a coluna legada espelhada ao lado da canônica \`empresa_id\`.`, "");
  out.push("| Tabela | Coluna(s) legada(s) |", "| --- | --- |");
  for (const t of companyTables) out.push(`| \`${t.table}\` | ${t.columns.map((c) => `\`${c}\``).join(" · ")} |`);
  out.push("");
  out.push("## Como esta catraca funciona", "");
  out.push("`node scripts/farm-inventory.mjs --check` roda no `lint` e falha quando:", "");
  out.push("1. a **dívida de produto** cresce em qualquer superfície (balde 3, comparado a `scripts/farm-inventory.baseline.json`);");
  out.push("2. um arquivo **declarado** na ponte não tem mais nome legado — a autorização virou letra morta e precisa sair da lista.", "");
  out.push("Para crescer a ponte de propósito, declare o arquivo com motivo em `scripts/lib/empresa-compat-surface.mjs` e");
  out.push("regenere o baseline no MESMO commit: a intenção fica visível na revisão.", "");
  return out.join("\n");
}

if (check) {
  if (!fs.existsSync(BASELINE)) { console.error("farm-inventory: baseline ausente — rode `node scripts/farm-inventory.mjs`."); process.exit(1); }
  const base = JSON.parse(fs.readFileSync(BASELINE, "utf8"));
  const falhas = [];
  const cresceu = SURFACES.filter((s) => divida[s.id] > (base.divida?.[s.id] ?? 0));
  if (cresceu.length) {
    falhas.push("dívida de produto (balde 3) cresceu — Fazenda → Empresa só pode diminuir:");
    for (const s of cresceu) falhas.push(`  - ${s.label}: ${base.divida?.[s.id] ?? 0} → ${divida[s.id]}`);
    falhas.push("  Se o arquivo é mesmo ponte de compatibilidade, declare-o com motivo em scripts/lib/empresa-compat-surface.mjs.");
    falhas.push("  Se o crescimento for deliberado, regenere o baseline no mesmo commit (node scripts/farm-inventory.mjs).");
  }
  if (declaracoesMortas.length) {
    falhas.push("declaração de compatibilidade sem uso — a ponte encolheu, a autorização não:");
    for (const f of declaracoesMortas) falhas.push(`  - ${f}: não tem mais nome legado; remova-o de scripts/lib/empresa-compat-surface.mjs`);
  }
  if (falhas.length) { console.error("farm-inventory: " + falhas.join("\n")); process.exit(1); }
  const diminuiu = SURFACES.filter((s) => divida[s.id] < (base.divida?.[s.id] ?? 0));
  console.log(`farm-inventory: OK (${grandTotal} ocorrências; histórico ${baldes.historico} · compatibilidade ${baldes.compat} · dívida ${baldes.divida}${diminuiu.length ? ` — ${diminuiu.length} superfície(s) pagaram dívida: regenere o baseline` : ""})`);
} else {
  fs.writeFileSync(OUT, render());
  fs.writeFileSync(BASELINE, JSON.stringify({ generatedBy: "scripts/farm-inventory.mjs", baldes, divida, counts, total: grandTotal, companyTables: companyTables.length }, null, 2) + "\n");
  console.log(`farm-inventory: docs/FARM-DEPENDENCY-INVENTORY.md gerado (${grandTotal} ocorrências — histórico ${baldes.historico} · compatibilidade ${baldes.compat} · dívida ${baldes.divida})`);
}
