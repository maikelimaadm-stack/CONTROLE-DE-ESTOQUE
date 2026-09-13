#!/usr/bin/env node
/**
 * Guardrail de copy (docs/UI-STANDARD.md, "Idioma e terminologia"). Roda no `lint` do web, ao lado do nav-audit.
 * Verifica só texto que chega ao usuário: texto JSX, props de rótulo (label/title/placeholder/…), toasts e os rótulos
 * declarados em packages/domain (campos, permissões, opções). Não olha comentários, identificadores, tipos nem chaves.
 * Regras: inglês residual, "Status"/"Dashboard" como rótulo, "Ok", "Á vencer", abreviações proibidas e enum técnico cru.
 * Exceções conscientes ficam em ALLOW com a razão — não silencie o teste, justifique.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repo = path.resolve(root, "..", "..");
const rel = (f) => path.relative(repo, f).replace(/\\/g, "/");

/** Exceções conscientes: texto exato → motivo. */
const ALLOW = new Map([
  ["2 - Preço Tabelado Máx.", "nome oficial da modalidade de BC do ICMS (SEFAZ)"],
  ["Dados MDFe (RNTRC, carroceria, rodado, tara, capacidade, proprietário)", "siglas fiscais"]
]);

const walk = (d, out = []) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) { if (e.name !== "node_modules" && e.name !== "dist" && e.name !== ".next") walk(p, out); } else if (/\.(tsx?|mjs)$/.test(e.name) && !/\.(test|spec)\./.test(e.name)) out.push(p); } return out; };
// Catálogos de tradução (@erp/plataforma) entram na auditoria: é de lá que sai o texto pt-BR da interface.
const files = [...walk(path.join(root, "src")), ...walk(path.join(repo, "packages/domain/src")), ...walk(path.join(repo, "packages/plataforma/src/idiomas"))];

/** Remove comentários (bloco e linha inteira) preservando a numeração de linhas. */
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " ")).replace(/^\s*\/\/.*$/gm, "");

const ENUM_COLS = "status|title_status|payment_type|origin|source_type|classification|request_type|priority|result|manifest_status|launch_status|movement_type|handling_type|sex|reproductive_status|reproductive_stage|mating_type|trigger_type|category_type|document_type|settlement_kind|decision|kind|direction|equipment_type|section|action";
const PROPS = "label|labelPlural|title|subtitle|placeholder|text|hint|emptyText|aria-label|description|submitLabel|cancelLabel|deleteText|module";

const RULES = [
  { id: "ingles", test: (t) => /(^|[^A-Za-z])(Status|Dashboard|Information|Warning|Success|Error|Upload|Download|Loading|Submit|Cancel|Delete|Save|Search|Settings|Unknown|Undefined|None|Docs|Logins?|Lead time)([^A-Za-z]|$)/.test(t), hint: "PT-BR: Situação, Painel, Informações, Aviso, Sucesso, Erro, Enviar/Importar, Baixar…" },
  { id: "ok", test: (t) => t.trim() === "Ok", hint: "usar \"OK\" (COPY.ok)" },
  { id: "acento", test: (t) => /Á vencer/.test(t), hint: "\"A vencer\" (sem crase)" },
  { id: "abreviacao", test: (t) => /(^|[^A-Za-zÀ-ÿ])(Dt|Vl|Qtd|Qtde|Cód|Obs|Máx|Mín|Transf|Doc|Cat|Venc|Tel|Insc|Prev|Núm|Últ|Exec|Cond|Int|pagto|reprod|Mov|Unit)\.(?!\.)/i.test(t) || /(^|\s)[csp]\/\s/i.test(t), hint: "escrever por extenso (Data, Valor, Quantidade, Código, Observação, Transferência, Documento…)" }
];

const findings = []; let checked = 0;
const report = (file, line, text, rule) => { if (ALLOW.has(text.trim())) return; findings.push(`${rel(file)}:${line}: "${text.trim()}" — ${rule.id}: ${rule.hint}`); };
const lineOf = (src, idx) => src.slice(0, idx).split("\n").length;

for (const file of files) {
  const raw = fs.readFileSync(file, "utf8"); const src = stripComments(raw); const isDomain = file.includes("packages/domain") || file.includes("packages/plataforma"); const isTsx = file.endsWith(".tsx");
  const candidates = [];
  if (isDomain) { for (const m of src.matchAll(/"([^"\\\n]*)"/g)) if (/[A-Za-zÀ-ÿ]/.test(m[1]) && !/^[a-z0-9_./:-]+$/.test(m[1])) candidates.push({ text: m[1], idx: m.index }); }
  else {
    for (const m of src.matchAll(new RegExp(`(?:${PROPS})\\s*[=:]\\s*"([^"\\\\\\n]*)"`, "g"))) candidates.push({ text: m[1], idx: m.index });
    for (const m of src.matchAll(/toast\.(?:success|error|warning|info)\("([^"\\\n]*)"/g)) candidates.push({ text: m[1], idx: m.index });
    if (isTsx) for (const m of src.matchAll(/>([^<>{}\n]*[A-Za-zÀ-ÿ][^<>{}\n]*)</g)) { const t = m[1]; if (!/^\s*(string|number|boolean|unknown|never|any|null|void)[\s,|]*$/.test(t) && !/\b(Record|Promise|Set|Map|Array|React|typeof|keyof|extends)\b/.test(t)) candidates.push({ text: t, idx: m.index + 1 }); }
  }
  checked += candidates.length;
  for (const c of candidates) for (const rule of RULES) if (rule.test(c.text)) report(file, lineOf(src, c.idx), c.text, rule);
  if (isTsx) {
    const rawEnum = [
      new RegExp(`\\?\\?\\s*String\\(\\w+\\["(?:${ENUM_COLS})"\\]\\)`, "g"),
      new RegExp(`>\\{String\\(\\w+\\["(?:${ENUM_COLS})"\\](?:\\s*\\?\\?\\s*"[^"]*")?\\)\\}<`, "g"),
      new RegExp(`\\["[^"]+",\\s*String\\(\\w+\\["(?:${ENUM_COLS})"\\](?:\\s*\\?\\?\\s*"[^"]*")?\\)\\]`, "g"),
      new RegExp(`\\{\\s*key:\\s*"(?:${ENUM_COLS})",\\s*label:\\s*"[^"]*"\\s*\\}`, "g")
    ];
    for (const re of rawEnum) for (const m of src.matchAll(re)) findings.push(`${rel(file)}:${lineOf(src, m.index)}: ${m[0]} — enum-cru: exibir com enumLabel(domínio, valor) de @/lib/copy (nunca o valor técnico)`);
  }
}

if (findings.length) { console.error(`copy-audit: ${findings.length} problema(s) de copy visível ao usuário:\n` + findings.map((f) => "  " + f).join("\n")); process.exit(1); }
console.log(`copy-audit: OK (${files.length} arquivos, ${checked} textos visíveis verificados, ${ALLOW.size} exceções justificadas)`);
