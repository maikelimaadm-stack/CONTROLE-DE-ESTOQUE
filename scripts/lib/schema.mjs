/**
 * Leitor do SCHEMA REAL a partir das migrations (supabase/migrations/*.sql).
 *
 * É a fonte técnica do dicionário de dados e do inventário: nada aqui é digitado à mão, de modo que a
 * documentação não possa divergir do banco. Suporta `create table` e `alter table ... add column`
 * (migrations aditivas), que é tudo o que o repositório usa.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const MIGRATIONS_DIR = path.join(REPO_ROOT, "supabase", "migrations");

const CONSTRAINT_START = /^(primary\s+key|unique|foreign\s+key|check|constraint|exclude)\b/i;

/** Divide por vírgulas de nível 0 (ignora vírgulas dentro de parênteses e de literais). */
function splitTopLevel(body) {
  const parts = []; let depth = 0, current = "", quote = null;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (quote) { current += ch; if (ch === quote) quote = null; continue; }
    if (ch === "'" || ch === '"') { quote = ch; current += ch; continue; }
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) { parts.push(current); current = ""; continue; }
    current += ch;
  }
  if (current.trim()) parts.push(current);
  return parts.map((p) => p.trim()).filter(Boolean);
}

/** Corpo entre o parêntese de abertura em `from` e seu fechamento correspondente. */
function balanced(sql, from) {
  let depth = 0;
  for (let i = from; i < sql.length; i++) {
    if (sql[i] === "(") depth++;
    else if (sql[i] === ")") { depth--; if (depth === 0) return { body: sql.slice(from + 1, i), end: i }; }
  }
  return null;
}

const stripSqlComments = (sql) => sql.replace(/--[^\n]*/g, "");

/** Conteúdo do `check (...)` inline da coluna, quando houver. */
function inlineCheck(rest) {
  const i = rest.toLowerCase().indexOf("check");
  if (i < 0) return null;
  const open = rest.indexOf("(", i);
  if (open < 0) return null;
  const block = balanced(rest, open);
  return block ? block.body.replace(/\s+/g, " ").trim() : null;
}

function parseColumn(def) {
  const m = /^([a-z_][a-z0-9_]*)\s+([\s\S]+)$/i.exec(def);
  if (!m) return null;
  const [, name, rest] = m;
  const typeMatch = /^([a-z][a-z0-9_ ]*?(?:\([^)]*\))?(?:\s*\[\])?)(?=\s|$)/i.exec(rest.trim());
  const ref = /references\s+([a-z_]+\.[a-z_]+)/i.exec(rest);
  const def_ = /\bdefault\s+([^,]+?)(?=\s+(?:not\s+null|references|check|unique|primary)\b|$)/i.exec(rest);
  return {
    name,
    type: (typeMatch?.[1] ?? rest.split(/\s+/)[0] ?? "").trim().toLowerCase(),
    notNull: /\bnot\s+null\b/i.test(rest),
    primaryKey: /\bprimary\s+key\b/i.test(rest),
    references: ref ? ref[1].toLowerCase() : null,
    check: inlineCheck(rest),
    default: def_ ? def_[1].trim() : null
  };
}

/** Map<"erp.tabela", { table, file, columns: Map<coluna, coluna>, constraints: string[] }> */
export function readSchema(dir = MIGRATIONS_DIR) {
  const tables = new Map();
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    const sql = stripSqlComments(fs.readFileSync(path.join(dir, file), "utf8"));
    const createRe = /create\s+table\s+(?:if\s+not\s+exists\s+)?([a-z_]+\.[a-z_][a-z0-9_]*)\s*\(/gi;
    for (let m = createRe.exec(sql); m; m = createRe.exec(sql)) {
      const table = m[1].toLowerCase();
      const block = balanced(sql, m.index + m[0].length - 1);
      if (!block) continue;
      const entry = tables.get(table) ?? { table, file, columns: new Map(), constraints: [] };
      for (const def of splitTopLevel(block.body)) {
        if (CONSTRAINT_START.test(def)) { entry.constraints.push(def.replace(/\s+/g, " ")); continue; }
        const col = parseColumn(def);
        if (col) entry.columns.set(col.name, col);
      }
      // chave primária declarada como constraint de tabela
      for (const c of entry.constraints) {
        const pk = /^primary\s+key\s*\(([^)]*)\)/i.exec(c);
        if (pk) for (const name of pk[1].split(",").map((s) => s.trim())) { const col = entry.columns.get(name); if (col) col.primaryKey = true; }
      }
      tables.set(table, entry);
    }
    const alterRe = /alter\s+table\s+(?:if\s+exists\s+)?([a-z_]+\.[a-z_][a-z0-9_]*)\s+add\s+column\s+(?:if\s+not\s+exists\s+)?([\s\S]*?);/gi;
    for (let m = alterRe.exec(sql); m; m = alterRe.exec(sql)) {
      const table = m[1].toLowerCase();
      const entry = tables.get(table);
      if (!entry) continue;
      const col = parseColumn(m[2].trim());
      if (col) entry.columns.set(col.name, { ...col, addedIn: file });
    }
  }
  return tables;
}

/** Colunas que amarram um registro à EMPRESA (hoje materializada como fazenda). */
export const COMPANY_COLUMNS = ["empresa_id", "farm_id", "origin_farm_id", "destination_farm_id"];
export const companyColumnsOf = (t) => COMPANY_COLUMNS.filter((c) => t.columns.has(c));
export const isOrgScoped = (t) => t.columns.has("organization_id");
export const isSoftDeletable = (t) => t.columns.has("deleted_at");
