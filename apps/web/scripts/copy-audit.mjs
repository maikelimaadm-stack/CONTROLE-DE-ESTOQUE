#!/usr/bin/env node
/**
 * Guardrail de copy (docs/UI-STANDARD.md, "Idioma e terminologia"). Roda no `lint` do web, ao lado do nav-audit.
 * Verifica só texto que chega ao usuário: texto JSX, props de rótulo (label/title/placeholder/…), toasts e os rótulos
 * declarados em packages/domain (campos, permissões, opções). Não olha comentários, identificadores, tipos nem chaves.
 * Regras: inglês residual, "Status"/"Dashboard" como rótulo, "Ok", "Á vencer", abreviações proibidas e enum técnico cru.
 * Exceções conscientes ficam em ALLOW com a razão — não silencie o teste, justifique.
 *
 * "LOCAL DE ESTOQUE", NUNCA "ARMAZÉM" (OPERACOES-01, decisão 280): desde a F3 todo texto que o usuário vê diz "Local de
 * estoque". A regra `armazem` reprova "Armazém"/"armazém"/"Armazéns" (e a grafia sem acento) em texto visível. Ela olha
 * MAIS que as outras regras: além dos textos do extrator acima (texto JSX, props de rótulo, toasts, strings do domínio),
 * toda string literal ("…", '…' e `…` sem as interpolações) dos mesmos arquivos e do apps/web/nav.registry.mjs (menu,
 * descrições e palavras de busca) — mensagem montada em função auxiliar ou em `{"…"}` também chega à tela. Fica de
 * fora, por construção, o que não é texto: identificadores (warehouses, armazem_id, exigeArmazem), testids e rotas
 * (/cadastros/armazens) — string só de minúsculas, dígitos e `_./:@-` não é texto, e "armazém" colado em `_`, `/`, `.`
 * ou `-` é parte de um nome técnico. O que sobra e ainda assim não é texto de tela está em EXCECOES_ARMAZEM, por
 * arquivo E texto, com o motivo. Hoje (F12) a contagem visível é ZERO: a regra é absoluta, sem linha de base.
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

/** "Armazém" que não é texto de tela: `arquivo|texto exato` → motivo. Cada entrada nova precisa do seu motivo. */
const EXCECOES_ARMAZEM = new Map([
  ["packages/domain/src/resources/registries.ts|Armazém padrão", "rotulosAnteriores do produto: o cabeçalho ANTIGO de planilha que a importação ainda reconhece (apps/api/src/lib/importacao.ts); nunca é exibido"],
  ["packages/domain/src/notificacoes.ts|erp.products.min_stock (organização) × soma de erp.stock_balances (todos os armazéns).", "`origem` técnica do aviso: só alimenta docs/NOTIFICATION-SCOPE-MATRIX.md (scripts/notification-matrix.mjs), nunca a tela"],
  ["apps/web/nav.registry.mjs|armazém", "palavra de busca (keywords) do módulo Estoque e do cadastro Locais de estoque: quem digita o nome antigo acha o item novo; não é exibida"],
  ["apps/web/nav.registry.mjs|entre armazéns", "palavra de busca (keywords) de Movimentações, pelo mesmo motivo; não é exibida"]
]);
const ARMAZEM = /(^|[^A-Za-zÀ-ÿ0-9_/.:@-])armaz[ée](?:m|ns)(?![A-Za-zÀ-ÿ0-9_])/i;
const TECNICO = /^[a-z0-9_./:@-]+$/;
const semInterpolacao = (t) => { let a = t, b; do { b = a; a = a.replace(/\$\{[^{}`]*\}/g, " "); } while (a !== b); return a; };
const literais = (src) => [
  ...[...src.matchAll(/"([^"\\\n]*)"/g), ...src.matchAll(/'([^'\\\n]*)'/g)].map((m) => ({ text: m[1], idx: m.index })),
  ...[...src.matchAll(/`([^`]*)`/g)].map((m) => ({ text: semInterpolacao(m[1]), idx: m.index }))
];
const navRegistry = path.join(root, "nav.registry.mjs");

const walk = (d, out = []) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) { if (e.name !== "node_modules" && e.name !== "dist" && e.name !== ".next") walk(p, out); } else if (/\.(tsx?|mjs)$/.test(e.name) && !/\.(test|spec)\./.test(e.name)) out.push(p); } return out; };
// Catálogos de tradução (@erp/plataforma) entram na auditoria: é de lá que sai o texto pt-BR da interface.
const files = [...walk(path.join(root, "src")), ...walk(path.join(repo, "packages/domain/src")), ...walk(path.join(repo, "packages/plataforma/src/idiomas"))];

/** Remove comentários (bloco e linha inteira) preservando a numeração de linhas. */
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " ")).replace(/^\s*\/\/.*$/gm, "");
/**
 * Remove comentários LENDO o código (strings e comentários na ordem em que aparecem), preservando a numeração de
 * linhas. Usado pela regra `armazem`: o `stripComments` acima, por regex, trata um "/*" DENTRO de comentário de linha
 * (ex.: "`/suprimentos/*`" no nav.registry) como início de bloco e apaga o código até o próximo fechamento — no
 * nav.registry eram 250 linhas, palavras de busca inclusas, que a regra não via.
 */
const semComentarios = (src) => {
  let out = ""; let i = 0; let aspas = null;
  while (i < src.length) {
    const c = src[i]; const d = src[i + 1];
    if (aspas) { out += c; if (c === "\\") { out += d ?? ""; i += 2; continue; } if (c === aspas || (c === "\n" && aspas !== "`")) aspas = null; i++; continue; }
    if (c === "/" && d === "/") { while (i < src.length && src[i] !== "\n") { out += " "; i++; } continue; }
    if (c === "/" && d === "*") { const fim = src.indexOf("*/", i + 2); const ate = fim < 0 ? src.length : fim + 2; out += src.slice(i, ate).replace(/[^\n]/g, " "); i = ate; continue; }
    if (c === "\"" || c === "'" || c === "`") aspas = c;
    out += c; i++;
  }
  return out;
};

const ENUM_COLS = "status|title_status|payment_type|origin|source_type|classification|request_type|priority|result|manifest_status|launch_status|movement_type|handling_type|sex|reproductive_status|reproductive_stage|mating_type|trigger_type|category_type|document_type|settlement_kind|decision|kind|direction|equipment_type|section|action";
const PROPS = "label|labelPlural|title|subtitle|placeholder|text|hint|emptyText|aria-label|description|submitLabel|cancelLabel|deleteText|module";

const RULES = [
  { id: "ingles", test: (t) => /(^|[^A-Za-z])(Status|Dashboard|Information|Warning|Success|Error|Upload|Download|Loading|Submit|Cancel|Delete|Save|Search|Settings|Unknown|Undefined|None|Docs|Logins?|Lead time)([^A-Za-z]|$)/.test(t), hint: "PT-BR: Situação, Painel, Informações, Aviso, Sucesso, Erro, Enviar/Importar, Baixar…" },
  { id: "ok", test: (t) => t.trim() === "Ok", hint: "usar \"OK\" (COPY.ok)" },
  { id: "acento", test: (t) => /Á vencer/.test(t), hint: "\"A vencer\" (sem crase)" },
  { id: "abreviacao", test: (t) => /(^|[^A-Za-zÀ-ÿ])(Dt|Vl|Qtd|Qtde|Cód|Obs|Máx|Mín|Transf|Doc|Cat|Venc|Tel|Insc|Prev|Núm|Últ|Exec|Cond|Int|pagto|reprod|Mov|Unit)\.(?!\.)/i.test(t) || /(^|\s)[csp]\/\s/i.test(t), hint: "escrever por extenso (Data, Valor, Quantidade, Código, Observação, Transferência, Documento…)" }
];

const findings = []; let checked = 0; let armazemVistos = 0; const excecoesUsadas = new Set();
const report = (file, line, text, rule) => { if (ALLOW.has(text.trim())) return; findings.push(`${rel(file)}:${line}: "${text.trim()}" — ${rule.id}: ${rule.hint}`); };
const lineOf = (src, idx) => src.slice(0, idx).split("\n").length;
/** A regra `armazem` sobre os candidatos do extrator (já com a linha) + todas as literais do arquivo (ver o cabeçalho). */
const auditarArmazem = (file, src, candidates) => {
  const vistos = new Set();
  for (const c of [...candidates, ...literais(src).map((l) => ({ text: l.text, linha: lineOf(src, l.idx) }))]) {
    const t = c.text.trim(); const linha = c.linha;
    if (!t || TECNICO.test(t) || vistos.has(`${linha}|${t}`)) continue;
    vistos.add(`${linha}|${t}`); armazemVistos++;
    if (!ARMAZEM.test(t)) continue;
    if (EXCECOES_ARMAZEM.has(`${rel(file)}|${t}`)) { excecoesUsadas.add(`${rel(file)}|${t}`); continue; }
    findings.push(`${rel(file)}:${linha}: "${t}" — armazem: texto visível diz "Local de estoque"/"Locais de estoque", nunca "Armazém" (OPERACOES-01, decisão 280); exceção só em EXCECOES_ARMAZEM, com motivo`);
  }
};

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
  auditarArmazem(file, semComentarios(raw), candidates.map((c) => ({ text: c.text, linha: lineOf(src, c.idx) })));
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

auditarArmazem(navRegistry, semComentarios(fs.readFileSync(navRegistry, "utf8")), []);
// Exceção que não casa mais com nada é lixo que um dia esconde texto novo: sai da lista.
for (const chave of EXCECOES_ARMAZEM.keys()) if (!excecoesUsadas.has(chave)) findings.push(`${chave.split("|")[0]}: exceção de "Armazém" sem uso ("${chave.split("|").slice(1).join("|")}") — tire-a de EXCECOES_ARMAZEM`);

if (findings.length) { console.error(`copy-audit: ${findings.length} problema(s) de copy visível ao usuário:\n` + findings.map((f) => "  " + f).join("\n")); process.exit(1); }
console.log(`copy-audit: OK (${files.length} arquivos, ${checked} textos visíveis verificados, ${ALLOW.size} exceções justificadas; "Armazém": ${armazemVistos} textos e literais + nav.registry, ${EXCECOES_ARMAZEM.size} exceções justificadas)`);
