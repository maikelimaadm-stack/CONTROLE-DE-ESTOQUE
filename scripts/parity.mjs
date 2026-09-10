#!/usr/bin/env node
/**
 * Auditoria de paridade: cruza docs/reference/SYSTEM-INVENTORY.md (455 telas observadas na referência)
 * com o mapa scripts/parity-map.mjs e o código deste repositório, gerando docs/parity/*.md.
 * `node scripts/parity.mjs --check` falha se alguma tela de referência ficar sem mapeamento (gate de CI).
 */
import fs from "node:fs"; import path from "node:path";
import { SCREENS, REPORTS, ACTIONS } from "./parity-map.mjs";
const root = path.resolve(new URL(".", import.meta.url).pathname, ".."); const check = process.argv.includes("--check");
const inv = fs.readFileSync(path.join(root, "docs/reference/SYSTEM-INVENTORY.md"), "utf8").split("\n").filter((l) => l.startsWith("| SCR-")).map((l) => { const c = l.trim().slice(1, -1).split("|").map((x) => x.trim()); return { id: c[0], module: c[1], sub: c[2], title: c[3], route: c[4].replace(/`/g, ""), type: c[5], actions: c[6] ? c[6].split(",").map((a) => a.trim()).filter(Boolean) : [], filters: Number(c[7] || 0), columns: Number(c[8] || 0), fields: Number(c[9] || 0) }; });
const reportsRef = fs.readFileSync(path.join(root, "docs/reference/REPORTS.md"), "utf8").split("\n").filter((l) => l.startsWith("| SCR-")).map((l) => l.trim().slice(1, -1).split("|").map((x) => x.trim())[0]);
// chaves de relatório do nosso runner (apps/api/src/routes/reports.ts)
const reportsSrc = fs.readFileSync(path.join(root, "apps/api/src/routes/reports.ts"), "utf8");
const ourReportKeys = new Set([...reportsSrc.matchAll(/\{ key: "([a-z_]+)", label: "[^"]*", module:/g)].map((m) => m[1]).concat(["payables", "paid", "receivables", "received", "birth", "death", "animal_sales", "animal_purchases", "weaning", "sisbov_identification", "sisbov_birth", "sisbov_death"]));
// páginas do web
const pages = []; const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (e.name === "page.tsx") pages.push(p); } }; walk(path.join(root, "apps/web/src/app"));
const routeOf = (p) => p.replace(path.join(root, "apps/web/src/app"), "").replace("/(app)", "").replace("/page.tsx", "") || "/";
const pageFields = Object.fromEntries(pages.map((p) => [routeOf(p), (fs.readFileSync(p, "utf8").match(/<Field /g) ?? []).length]));
// registro de recursos (campos por cadastro)
const { RESOURCES } = await import(path.join(root, "packages/domain/dist/index.js"));
const resFields = Object.fromEntries(RESOURCES.map((r) => [r.key, { fields: r.fields.length, list: r.fields.filter((f) => f.list).length, filter: r.fields.filter((f) => f.filter).length }]));

const norm = (r) => r.replace(/^\/admin\//, "");
function classify(route) {
  const s = norm(route); let kind = "list", base = s;
  if (SCREENS[s] || REPORTS[s]) return { base: s, kind: REPORTS[s] && !SCREENS[s] ? "report" : "list" };
  let m;
  if ((m = s.match(/^(.*)\/create$/))) { base = m[1]; kind = "create"; }
  else if ((m = s.match(/^(.*)\/\d+\/edit$/))) { base = m[1]; kind = "edit"; }
  else if ((m = s.match(/^(.*)\/\d+\/(kml-export|map-print)$/))) { base = m[1]; kind = m[2]; }
  else if ((m = s.match(/^(.*)\/\d+\/second$/))) { base = m[1]; kind = "detail"; }
  else if ((m = s.match(/^(.*)\/\d+$/))) { base = m[1]; kind = "detail"; }
  else if ((m = s.match(/^(.*)\/report$/))) { base = m[1]; kind = "report"; }
  return { base, kind };
}
const withSuffix = (ours, suf) => { if (!ours) return ""; const [p, q] = ours.split("?"); return `${p}${suf}${q ? `?${q}` : ""}`; };
function resolve(row) {
  const { base, kind } = classify(row.route); const s = norm(row.route);
  if (kind === "report") { const r = REPORTS[s] ?? REPORTS[base + "/report"]; if (r) return { ours: r[0].startsWith("/") ? r[0] : `/relatorios/${r[0]}`, status: r[1], note: r[2] ?? "", base, kind }; return { ours: "", status: "NÃO INICIADO", note: "Relatório sem equivalente", base, kind, unmapped: true }; }
  const m = SCREENS[base]; if (!m) return { ours: "", status: "NÃO INICIADO", note: "Sem mapeamento", base, kind, unmapped: true };
  if (kind === "kml-export" || kind === "map-print") return { ours: "", status: "NÃO INICIADO", note: "Mapa/KML da fazenda (georreferenciamento) não construído", base, kind };
  const isCad = m.ours.startsWith("/cadastros/");
  const ours = kind === "create" ? withSuffix(m.ours, "/new") : kind === "detail" ? withSuffix(m.ours, "/[id]") : kind === "edit" ? (isCad ? withSuffix(m.ours, "/[id]") : m.ours.includes("contas-a-") ? withSuffix(m.ours, "/[id]/edit") : withSuffix(m.ours, "/[id]")) : m.ours;
  let note = m.note ?? "";
  if (kind === "edit" && !isCad && !m.ours.includes("contas-a-") && !m.ours.includes("/admin/") && !m.ours.includes("/suprimentos")) note = (note ? note + "; " : "") + "documentos transacionais são imutáveis após confirmação: correção via cancelamento/estorno (MELHORADO)";
  return { ours, status: m.status, note, base, kind };
}
const rows = inv.map((r) => ({ ...r, ...resolve(r) }));
const unmapped = rows.filter((r) => r.unmapped);
const ORDER = ["TESTADO", "IMPLEMENTADO", "MELHORADO", "EM IMPLEMENTAÇÃO", "MAPEADO", "BLOQUEADO", "NÃO INICIADO", "NÃO APLICÁVEL"];
const count = (list) => Object.fromEntries(ORDER.map((s) => [s, list.filter((r) => r.status === s).length]));
const pct = (list) => { const ok = list.filter((r) => ["TESTADO", "IMPLEMENTADO", "MELHORADO"].includes(r.status)).length; const den = list.filter((r) => r.status !== "NÃO APLICÁVEL").length; return `${ok}/${den} (${(100 * ok / Math.max(1, den)).toFixed(1)}%)`; };
const esc = (s) => String(s ?? "").replace(/\|/g, "\\|");
const hdr = (t, intro) => `# ${t}\n\n_Gerado por \`node scripts/parity.mjs\` em ${new Date().toISOString().slice(0, 10)} a partir de docs/reference/SYSTEM-INVENTORY.md (${inv.length} telas) e do código deste repositório. Legenda de status: NÃO INICIADO · MAPEADO · EM IMPLEMENTAÇÃO · IMPLEMENTADO · TESTADO (coberto por teste automatizado) · BLOQUEADO · NÃO APLICÁVEL · MELHORADO (comportamento intencionalmente diferente/superior, ver observação)._\n\n${intro}\n\n`;
const out = (f, s) => fs.writeFileSync(path.join(root, "docs/parity", f), s);
// SCREEN
out("SCREEN-PARITY.md", hdr("Paridade de Telas", `Resumo: ${pct(rows)} telas implementadas ou melhoradas. ` + ORDER.map((s) => `${s}: ${count(rows)[s]}`).join(" · ")) + "| ID | Módulo | Tela (referência) | Rota referência | Tipo | Nossa rota | Status | Observação |\n|---|---|---|---|---|---|---|---|\n" + rows.map((r) => `| ${r.id} | ${esc(r.module)}${r.sub ? " › " + esc(r.sub) : ""} | ${esc(r.title)} | \`${r.route}\` | ${r.type} | ${r.ours ? "`" + r.ours + "`" : "—"} | ${r.status} | ${esc(r.note)} |`).join("\n") + "\n");
// MODULE
const mods = [...new Set(rows.map((r) => r.module))];
out("MODULE-PARITY.md", hdr("Paridade de Módulos", `Módulos do menu da referência × cobertura nossa (telas). Total geral: ${pct(rows)}.`) + "| Módulo | Telas ref. | Implementadas/Testadas/Melhoradas | Em implementação/Mapeadas | Não iniciadas | Não aplicáveis | Cobertura | Status do módulo |\n|---|---|---|---|---|---|---|---|\n" + mods.map((m) => { const l = rows.filter((r) => r.module === m); const c = count(l); const ok = c.TESTADO + c.IMPLEMENTADO + c.MELHORADO; const st = ok === l.length ? "IMPLEMENTADO" : ok > 0 ? "EM IMPLEMENTAÇÃO" : "NÃO INICIADO"; return `| ${m} | ${l.length} | ${ok} | ${c["EM IMPLEMENTAÇÃO"] + c.MAPEADO} | ${c["NÃO INICIADO"] + c.BLOQUEADO} | ${c["NÃO APLICÁVEL"]} | ${pct(l)} | ${st} |`; }).join("\n") + `\n\n## Módulos nossos sem equivalente direto (MELHORADO)\n\n- Ledger de estoque imutável com estorno (\`/estoque/movimentos\`) — a referência edita/exclui movimentos.\n- Auditoria consultável (\`/admin/auditoria\`) e notificações por regra (\`/admin/notificacoes\`).\n- Exportações genéricas de qualquer cadastro (\`/integracoes/exportacoes\`).\n- Painel fiscal com status honesto de cada capacidade (\`/fiscal\`).\n`);
// REPORT
const repRows = rows.filter((r) => reportsRef.includes(r.id));
out("REPORT-PARITY.md", hdr("Paridade de Relatórios", `Referência: ${reportsRef.length} telas de relatório (docs/reference/REPORTS.md). Nosso runner genérico (\`/relatorios/[key]\`) possui ${ourReportKeys.size} relatórios com filtros server-side, totais, CSV e XLSX. Cobertura: ${pct(repRows)}.`) + "| ID | Relatório (referência) | Módulo | Nosso relatório | Status | Observação |\n|---|---|---|---|---|---|\n" + repRows.map((r) => `| ${r.id} | ${esc(r.title)} | ${esc(r.sub || r.module)} | ${r.ours ? "`" + r.ours + "`" : "—"} | ${r.status} | ${esc(r.note)} |`).join("\n") + "\n\n## Relatórios nossos sem equivalente direto\n\n" + [...ourReportKeys].filter((k) => !Object.values(REPORTS).some((v) => v[0] === k)).map((k) => `- \`${k}\``).join("\n") + "\n");
// ACTION
const actRows = []; for (const r of rows.filter((x) => x.actions.length)) for (const a of r.actions) { if (/^\d+$/.test(a) || a === "›" || a === "text-light") continue; /* paginação/ruído de crawl */ const def = ACTIONS[a]; const st = def ? (def[0] ?? r.status) : (r.status === "NÃO INICIADO" ? "NÃO INICIADO" : "MAPEADO"); actRows.push({ id: r.id, title: r.title, action: a, status: st, note: def?.[1] ?? (def ? "" : "Ação específica: verificar na tela nossa"), ours: r.ours }); }
out("ACTION-PARITY.md", hdr("Paridade de Ações", `Ações de cabeçalho/linha observadas por tela na referência (${actRows.length} ocorrências em ${new Set(actRows.map((a) => a.id)).size} telas). Cobertura: ${pct(actRows)}. Ações padrão (Adicionar/Visualizar/Editar/Excluir/Exportar/Imprimir) herdam o status da tela.`) + "| ID | Tela | Ação (referência) | Status | Observação |\n|---|---|---|---|---|\n" + actRows.map((a) => `| ${a.id} | ${esc(a.title)} | ${esc(a.action)} | ${a.status} | ${esc(a.note)} |`).join("\n") + "\n");
// FIELD
const fieldRows = rows.filter((r) => r.fields > 0 || r.filters > 0 || r.columns > 0).map((r) => { let ours = null; const key = r.ours.match(/^\/cadastros\/([a-z_]+)/)?.[1]; if (key && resFields[key]) ours = r.kind === "list" ? resFields[key].filter : resFields[key].fields; else { const p = r.ours.split("?")[0].replace(/\[id\]/, "[id]"); const cand = Object.keys(pageFields).find((k) => k === p || k.replace(/\[[a-z]+\]/g, "X") === p.replace(/\/(sale|purchase|birth|death|loss|nutrition|sanitary|weaning|separation|pasture|budgets|orders|sales|request|mine|quotation|authorization|buy|receipts|rejected|financeiro|livro-caixa|suprimentos|pecuaria|depreciacoes|ativos|usuarios|pluviometria|confinamento|confinamento-custos|confinamento-desempenho|estoque-nutricao|consumo-racao)(\/|$)/, "/X$2")); if (cand !== undefined) ours = pageFields[cand]; } return { ...r, oursFields: ours }; });
out("FIELD-PARITY.md", hdr("Paridade de Campos", `Comparação quantitativa por tela: campos de formulário / filtros / colunas observados na referência × campos declarados no nosso código (registro declarativo de cadastros em packages/domain/src/resources ou \`<Field>\` nas páginas). A comparação nome-a-nome está em docs/reference/screens/*.md (referência) e nos próprios registries (nosso). Diferenças intencionais: campos de marketing/licença omitidos; campos calculados exibidos no detalhe e não no formulário.`) + "| ID | Tela | Nossa rota | Ref.: campos form | Ref.: filtros | Ref.: colunas | Nosso: campos (form/filtros) | Status |\n|---|---|---|---|---|---|---|---|\n" + fieldRows.map((r) => `| ${r.id} | ${esc(r.title)} | ${r.ours ? "`" + r.ours + "`" : "—"} | ${r.fields} | ${r.filters} | ${r.columns} | ${r.oursFields ?? "—"} | ${r.status} |`).join("\n") + "\n");
// summary json for GAP-ANALYSIS
const summary = { screens: { total: rows.length, ...count(rows), coverage: pct(rows) }, reports: { total: repRows.length, ours: ourReportKeys.size, ...count(repRows), coverage: pct(repRows) }, actions: { total: actRows.length, ...count(actRows), coverage: pct(actRows) }, modules: mods.map((m) => ({ module: m, coverage: pct(rows.filter((r) => r.module === m)) })), gaps: rows.filter((r) => ["NÃO INICIADO", "EM IMPLEMENTAÇÃO", "MAPEADO", "BLOQUEADO"].includes(r.status) && r.kind === "list").map((r) => ({ id: r.id, title: r.title, route: r.route, status: r.status, note: r.note })), pages: pages.length };
fs.writeFileSync(path.join(root, "docs/parity/summary.json"), JSON.stringify(summary, null, 2));
console.log(`telas ${summary.screens.coverage} | relatórios ${summary.reports.coverage} | ações ${summary.actions.coverage} | páginas web ${pages.length} | não mapeadas ${unmapped.length}`);
if (unmapped.length) { console.log("Sem mapeamento:", unmapped.map((r) => r.route).join(", ")); if (check) process.exit(1); }
