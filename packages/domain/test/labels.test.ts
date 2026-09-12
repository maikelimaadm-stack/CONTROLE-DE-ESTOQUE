import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ENUM_LABELS, enumLabel, enumOptions, hasEnumLabel, NOT_INFORMED, UNKNOWN_VALUE, PURCHASE_STATUS_LABELS, displayTitleStatus, PERMISSION_RESOURCES, RESOURCES, type EnumDomain } from "../src/index.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(here, "../../../supabase/migrations");

/** Coluna do banco → domínio de rótulos que a apresenta (colunas ambíguas como `kind`/`type` ficam nos testes explícitos). */
const COLUMN_DOMAIN: Record<string, EnumDomain> = {
  status: "status", payment_type: "payment_type", classification: "classification", appropriation: "appropriation", direction: "direction",
  settlement_kind: "settlement_kind", category_type: "bank_category_type", document_type: "document_type", origin: "origin",
  manifest_status: "manifest_status", launch_status: "launch_status", request_type: "request_type", priority: "priority", decision: "decision",
  movement_type: "animal_movement_type", handling_type: "handling_type", reproductive_status: "reproductive_status", reproductive_stage: "reproductive_stage",
  result: "diagnosis_result", mating_type: "mating_type", trigger_type: "trigger_type", equipment_type: "equipment_type", recurrence_type: "recurrence_type"
};

describe("rótulos PT-BR de enums (docs/UI-STANDARD.md)", () => {
  it("valores conhecidos nunca saem crus pela função de apresentação", () => {
    const cases: [EnumDomain, string, string][] = [
      ["status", "written_off", "Baixado"], ["status", "awaiting_purchase", "Aguardando a compra"], ["status", "purchase_done", "Compra efetuada"],
      ["status", "pending", "Pendente"], ["status", "launched", "Lançado"], ["status", "ignored", "Ignorado"],
      ["purchase_status", "awaiting_purchase", "Aguardando a compra"], ["purchase_status", "purchase_done", "Compra efetuada"],
      ["reproductive_status", "pregnant", "Prenha"], ["reproductive_status", "calved", "Parida"], ["reproductive_status", "empty", "Vazia"],
      ["diagnosis_result", "pending", "Pendente"], ["diagnosis_result", "pregnant", "Prenha"], ["diagnosis_result", "empty", "Vazia"],
      ["manifest_status", "awareness", "Ciência"], ["manifest_status", "unknown", "Desconhecimento"], ["manifest_status", "not_performed", "Não realizada"],
      ["launch_status", "pending", "Pendente"], ["launch_status", "launched", "Lançada"], ["launch_status", "ignored", "Ignorada"],
      ["title_status", "open", "A vencer"], ["title_status", "partially_paid", "Baixa parcial"], ["document_type", "nfe", "NF-e"], ["sex", "M", "Macho"]
    ];
    for (const [domain, value, label] of cases) { expect(enumLabel(domain, value), `${domain}.${value}`).toBe(label); expect(enumLabel(domain, value)).not.toBe(value); }
  });
  it("vazio → 'Não informado'; valor desconhecido → 'Desconhecido' (nunca o valor técnico)", () => {
    expect(enumLabel("status", null)).toBe(NOT_INFORMED); expect(enumLabel("status", "")).toBe(NOT_INFORMED); expect(enumLabel("status", undefined)).toBe(NOT_INFORMED);
    expect(enumLabel("status", "some_new_status")).toBe(UNKNOWN_VALUE); expect(enumLabel("origin", "__proto__")).toBe(UNKNOWN_VALUE); expect(enumLabel("origin", "constructor")).toBe(UNKNOWN_VALUE);
    expect(hasEnumLabel("status", "open")).toBe(true); expect(hasEnumLabel("status", "nope")).toBe(false);
    expect(enumOptions("priority")).toEqual([{ value: "low", label: "Baixa" }, { value: "medium", label: "Média" }, { value: "high", label: "Alta" }]);
    expect(enumOptions("sex", ["F", "M"]).map((o) => o.label)).toEqual(["Fêmea", "Macho"]);
  });
  it("todo valor de enum declarado nas migrations (check constraints) tem rótulo no domínio correspondente", () => {
    const sql = fs.readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).map((f) => fs.readFileSync(path.join(migrationsDir, f), "utf8")).join("\n");
    const missing: string[] = []; let checked = 0;
    for (const m of sql.matchAll(/\b(\w+) text[^,\n]*?check \(\1 in \(((?:'[a-z_0-9]+'\s*,?\s*)+)\)\)/g)) {
      const domain = COLUMN_DOMAIN[m[1]!]; if (!domain) continue;
      for (const v of [...m[2]!.matchAll(/'([a-z_0-9]+)'/g)].map((x) => x[1]!)) { checked++; if (!hasEnumLabel(domain, v)) missing.push(`${m[1]}=${v} (${domain})`); }
    }
    expect(checked).toBeGreaterThan(80);
    expect(missing, "enums sem rótulo PT-BR:\n" + missing.join("\n")).toEqual([]);
  });
  it("nenhum rótulo do domínio carrega inglês residual, 'Á vencer' ou abreviação proibida", () => {
    const bad = /(^|[^A-Za-z])(Status|Dashboard|Information|Warning|Success|Error)([^A-Za-z]|$)|Á vencer|(^|[^A-Za-zÀ-ÿ])(Dt|Vl|Qtd|Qtde|Cód|Obs|Máx|Transf|Doc|Cat|Venc|Tel|Insc|Prev)\.(?!\.)/;
    const texts: string[] = [];
    for (const [d, map] of Object.entries(ENUM_LABELS)) for (const [k, v] of Object.entries(map)) texts.push(`${d}.${k}=${v}`);
    for (const p of PERMISSION_RESOURCES) texts.push(`perm ${p.key}=${p.label}`, `module ${p.key}=${p.module}`);
    for (const r of RESOURCES) { texts.push(`res ${r.key}=${r.label}`, `res ${r.key}=${r.labelPlural}`); for (const f of r.fields) { texts.push(`${r.key}.${f.name}=${f.label}`); for (const o of f.options ?? []) texts.push(`${r.key}.${f.name}.${o.value}=${o.label}`); } }
    const ALLOW = ["2 - Preço Tabelado Máx.", "Dados MDFe (RNTRC, carroceria, rodado, tara, capacidade, proprietário)"];
    const offenders = texts.filter((t) => bad.test(t.slice(t.indexOf("=") + 1)) && !ALLOW.some((a) => t.endsWith(a)));
    expect(offenders).toEqual([]);
    expect(Object.values(PURCHASE_STATUS_LABELS).every((l) => l === l.charAt(0).toUpperCase() + l.slice(1) && !/ [A-ZÁÉÍÓÚ][a-z]/.test(l.replace(/^[^ ]+/, "")))).toBe(true);
    expect(displayTitleStatus({ status: "open", dueDate: "2999-01-01" }, "2026-01-01")).toBe("A vencer");
  });
});
