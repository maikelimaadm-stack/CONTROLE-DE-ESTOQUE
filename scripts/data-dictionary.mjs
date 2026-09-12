#!/usr/bin/env node
/**
 * GERADOR E GATE DO DICIONÁRIO DE DADOS (docs/DATA-DICTIONARY.md).
 *
 * Metade técnica DERIVADA das migrations (tabelas, colunas, tipos, nulidade, chaves, enums) + metade funcional
 * CURADA em packages/plataforma/dicionario-dados.mjs. Nenhuma linha do documento é escrita à mão.
 *
 *   node scripts/data-dictionary.mjs            regenera docs/DATA-DICTIONARY.md
 *   node scripts/data-dictionary.mjs --check    valida o dicionário e recusa documento desatualizado (gate)
 */
import fs from "node:fs";
import path from "node:path";
import { readSchema, REPO_ROOT, companyColumnsOf, isOrgScoped, isSoftDeletable } from "./lib/schema.mjs";
import { DICIONARIO_DE_DADOS, VERSAO_DICIONARIO, MODULOS_DICIONARIO, validarDicionarioDeDados } from "../packages/plataforma/dicionario-dados.mjs";

const OUT = path.join(REPO_ROOT, "docs", "DATA-DICTIONARY.md");
const check = process.argv.includes("--check");

const enumValues = (col) => {
  const m = col.check && new RegExp(`${col.name}\\s+in\\s*\\(([^)]*)\\)`, "i").exec(col.check);
  return m ? m[1].split(",").map((s) => s.trim().replace(/^'|'$/g, "")) : null;
};
const yes = (b) => (b ? "sim" : "não");
const esc = (s) => String(s ?? "").replace(/\|/g, "\\|");

function columnRows(entry, table) {
  const rows = [];
  for (const col of table.columns.values()) {
    const override = entry.campos?.[col.name];
    const values = enumValues(col);
    const key = col.primaryKey ? "PK" : col.references ? "FK" : "";
    rows.push([
      `\`${col.name}\``,
      esc(override?.name ?? ""),
      esc(col.type),
      yes(col.notNull),
      key,
      col.references ? `\`${col.references}\`` : "",
      values ? values.map((v) => `\`${v}\``).join(" · ") : "",
      esc(override?.description ?? "")
    ]);
  }
  return rows;
}

function render(schema) {
  const byTable = new Map(DICIONARIO_DE_DADOS.map((e) => [e.tabela, e]));
  const curated = DICIONARIO_DE_DADOS.length;
  const comEmpresa = [...schema.values()].filter((t) => companyColumnsOf(t).length).length;
  const out = [];
  out.push("# Dicionário de Dados", "");
  out.push("> **Documento gerado.** Não edite à mão: `node scripts/data-dictionary.mjs`.");
  out.push("> A parte técnica (tabelas, colunas, tipos, nulidade, chaves, enums) é derivada de `supabase/migrations/*.sql`;");
  out.push("> a parte funcional (nome, descrição, módulo, rota, TOP futura, notas de migração) é curada em");
  out.push("> `packages/plataforma/dicionario-dados.mjs`. O gate `--check` recusa entrada que aponte para tabela/coluna inexistente.", "");
  out.push(`Formato do dicionário: versão **${VERSAO_DICIONARIO}**. Taxonomia própria e neutra \`ERP-<MÓDULO>-<ENTIDADE>\` (não reproduz códigos do sistema de referência nem amarra o núcleo a um segmento de negócio).`, "");
  out.push("## Panorama", "");
  out.push("| Métrica | Valor |", "| --- | ---: |");
  out.push(`| Tabelas no schema \`erp\` | ${schema.size} |`);
  out.push(`| Tabelas com \`organization_id\` (escopo de organização) | ${[...schema.values()].filter(isOrgScoped).length} |`);
  out.push(`| Tabelas com coluna de empresa (hoje \`farm_id\`) | ${comEmpresa} |`);
  out.push(`| Entidades curadas neste dicionário | ${curated} |`);
  out.push(`| Entidades com ID Global | ${DICIONARIO_DE_DADOS.filter((e) => e.idGlobal).length} |`);
  out.push(`| Cobertura curada | ${((curated / schema.size) * 100).toFixed(1)}% |`, "");
  out.push("Cobertura é incremental por projeto: a certificação de 100% é a missão **DATA-GOV** do roteiro");
  out.push("(`docs/PRE-BASE2-ROADMAP.md`). Toda tabela ainda não curada aparece no apêndice com seus metadados técnicos.", "");

  for (const [moduleKey, moduleName] of Object.entries(MODULOS_DICIONARIO)) {
    const entries = DICIONARIO_DE_DADOS.filter((e) => e.modulo === moduleKey);
    if (!entries.length) continue;
    out.push(`## ${moduleName}`, "");
    for (const entry of entries) {
      const table = schema.get(entry.tabela);
      out.push(`### ${entry.codigo} — ${entry.nome}`, "");
      out.push(`${entry.descricao}`, "");
      out.push("| Propriedade | Valor |", "| --- | --- |");
      out.push(`| Tabela | \`${entry.tabela}\` |`);
      out.push(`| Natureza | ${entry.natureza} |`);
      out.push(`| Escopo de organização | ${yes(table ? isOrgScoped(table) : false)} |`);
      out.push(`| Escopo de empresa | ${table && companyColumnsOf(table).length ? companyColumnsOf(table).map((c) => `\`${c}\``).join(" · ") : "não (registro da organização)"} |`);
      out.push(`| Exclusão lógica | ${yes(table ? isSoftDeletable(table) : false)} |`);
      out.push(`| ID Global | ${yes(entry.idGlobal)} |`);
      if (entry.rota) out.push(`| Rota canônica | \`${entry.rota}\` |`);
      if (entry.rotas) {
        out.push(`| Discriminador | \`${entry.discriminador}\` (decide tela **e** permissão — ver docs/GLOBAL-ID-CONTRACT.md) |`);
        out.push(`| Rotas por variante | ${Object.entries(entry.rotas).map(([v, r]) => `\`${v}\` → \`${r}\``).join(" · ")} |`);
      }
      if (entry.top) out.push(`| TOP futura (contrato) | ${esc(entry.top)} |`);
      if (entry.migracao) out.push(`| Migração | ${esc(entry.migracao)} |`);
      out.push("");
      if (!table) { out.push("> Tabela não encontrada no schema.", ""); continue; }
      out.push("| Campo | Nome funcional | Tipo | Obrigatório | Chave | Relacionamento | Valores | Descrição |");
      out.push("| --- | --- | --- | --- | --- | --- | --- | --- |");
      for (const r of columnRows(entry, table)) out.push(`| ${r.join(" | ")} |`);
      out.push("");
    }
  }

  out.push("## Apêndice — tabelas ainda não curadas", "");
  out.push("Metadados técnicos derivados do schema. Acrescentar a entrada funcional em");
  out.push("`packages/plataforma/dicionario-dados.mjs` promove a tabela para as seções acima.", "");
  out.push("| Tabela | Campos | Organização | Empresa | Exclusão lógica |", "| --- | ---: | --- | --- | --- |");
  for (const t of [...schema.values()].sort((a, b) => a.table.localeCompare(b.table))) {
    if (byTable.has(t.table)) continue;
    const company = companyColumnsOf(t);
    out.push(`| \`${t.table}\` | ${t.columns.size} | ${yes(isOrgScoped(t))} | ${company.length ? company.map((c) => `\`${c}\``).join(" · ") : "—"} | ${yes(isSoftDeletable(t))} |`);
  }
  out.push("");
  return out.join("\n");
}

const schema = readSchema();
const problems = validarDicionarioDeDados(DICIONARIO_DE_DADOS, schema);
if (problems.length) {
  console.error("dicionário de dados: inconsistências");
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
const content = render(schema);
if (check) {
  const current = fs.existsSync(OUT) ? fs.readFileSync(OUT, "utf8") : "";
  if (current !== content) {
    console.error("docs/DATA-DICTIONARY.md desatualizado: rode `node scripts/data-dictionary.mjs` e commite o resultado.");
    process.exit(1);
  }
  console.log(`data-dictionary: OK (${DICIONARIO_DE_DADOS.length} entidades curadas, ${schema.size} tabelas no schema)`);
} else {
  fs.writeFileSync(OUT, content);
  console.log(`data-dictionary: docs/DATA-DICTIONARY.md gerado (${DICIONARIO_DE_DADOS.length} entidades curadas, ${schema.size} tabelas)`);
}
