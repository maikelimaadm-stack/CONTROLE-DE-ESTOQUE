import { describe, it, expect } from "vitest";
import { normalizeListPreferences, applyColumnPreferences, normalizeFormLayout, buildDefaultFormLayout, parseFilterKey, filterKey, relativeDateRange, filterKindOf, isValidOperator, decodeRange, encodeRange, MAX_FIELDS_PER_ROW } from "../src/preferences.js";

describe("preferências de listagem", () => {
  it("descarta colunas/filtros desconhecidos e valores inválidos", () => {
    const p = normalizeListPreferences({ columns: { visible: ["a", "zz", "a"], order: ["b", "a"], widths: { a: 120, b: 10, zz: 300 } }, sort: { key: "zz", dir: "asc" }, pageSize: 33, view: { mode: "cards", cardsPerRow: 9 }, filters: { visible: ["f1", "nope"], operators: { f1: "between", f2: "contains" }, saved: [{ name: "Ativos", values: { status: "active", "bad key": "x" } }, { name: "Ativos", values: {} }] } }, { columns: ["a", "b"], filters: ["f1", "f2"], filterKinds: { f1: "number", f2: "date" } });
    expect(p.columns.visible).toEqual(["a"]); expect(p.columns.order).toEqual(["b", "a"]); expect(p.columns.widths).toEqual({ a: 120 });
    expect(p.sort).toBeUndefined(); expect(p.pageSize).toBeUndefined(); expect(p.view.mode).toBe("cards"); expect(p.view.cardsPerRow).toBeUndefined();
    expect(p.filters.visible).toEqual(["f1"]); expect(p.filters.operators).toEqual({ f1: "between" }); expect(p.filters.saved).toEqual([{ name: "Ativos", values: { status: "active" } }]);
  });
  it("aplica visibilidade e ordem preservando colunas não mencionadas", () => {
    const cols = [{ key: "a" }, { key: "b" }, { key: "c" }];
    expect(applyColumnPreferences(cols, { order: ["c"] }).map((c) => c.key)).toEqual(["c", "a", "b"]);
    expect(applyColumnPreferences(cols, { visible: ["b", "a"], order: ["b"] }).map((c) => c.key)).toEqual(["b", "a"]);
  });
});

describe("filtros avançados", () => {
  it("codifica e decodifica chave campo__operador e intervalos", () => {
    expect(parseFilterKey(filterKey("due_date", "between"))).toEqual({ field: "due_date", op: "between" });
    expect(parseFilterKey("nome")).toBeNull(); expect(parseFilterKey("a__b c")).toBeNull();
    expect(decodeRange(encodeRange("1", "2"))).toEqual(["1", "2"]);
    expect(filterKindOf("money")).toBe("number"); expect(isValidOperator("text", "gt")).toBe(false);
  });
  it("calcula intervalos relativos de data", () => {
    expect(relativeDateRange("today", "2026-09-10")).toEqual(["2026-09-10", "2026-09-10"]);
    expect(relativeDateRange("last_month", "2026-03-15")).toEqual(["2026-02-01", "2026-02-28"]);
    expect(relativeDateRange("this_week", "2026-09-10")).toEqual(["2026-09-07", "2026-09-13"]);
    expect(relativeDateRange("nope", "2026-09-10")).toBeNull();
  });
});

describe("layout de formulário", () => {
  const fields = [{ id: "code", label: "Código", span: 2 }, { id: "name", label: "Nome", span: 6, required: true }, { id: "note", label: "Obs", section: "Extras", span: 12 }];
  it("gera layout padrão por seção e largura", () => {
    const l = buildDefaultFormLayout(fields);
    expect(l.panels).toHaveLength(1); expect(l.cards.map((c) => c.id)).toEqual(["geral", "extras"]);
    expect(l.cards[0]!.rows[0]!.fieldIds).toEqual(["code", "name"]);
  });
  it("normaliza: remove desconhecidos/repetidos, divide linhas longas, anexa campos sem posição e protege obrigatórios", () => {
    const raw = { panels: [{ id: "p1", label: "P" }, { id: "p1" }], cards: [{ id: "c1", panelId: "ghost", colSpan: 6, rows: [{ id: "r", fieldIds: ["name", "name", "zz", "code", "note", "code"] }] }], hiddenFieldIds: ["name"] };
    const { layout, issues } = normalizeFormLayout(raw, fields);
    expect(layout.panels).toHaveLength(1);
    expect(layout.cards[0]!.panelId).toBe("p1");
    expect(layout.cards[0]!.rows.flatMap((r) => r.fieldIds)).toEqual(["name", "code", "note"]);
    expect(layout.cards[0]!.rows.every((r) => r.fieldIds.length <= MAX_FIELDS_PER_ROW[6])).toBe(true);
    expect(layout.hiddenFieldIds).toEqual([]);
    expect(issues.some((i) => i.message.includes("duplicado"))).toBe(true);
    const missing = normalizeFormLayout({ cards: [{ id: "c", rows: [{ fieldIds: ["code"] }] }] }, fields);
    expect(missing.layout.cards.find((c) => c.id === "outros")?.rows[0]!.fieldIds).toEqual(["name", "note"]);
  });
});

import { encodeList, decodeList, isListOperator } from "../src/preferences.js";
describe("operador de lista (chip de filtro)", () => {
  it("codifica e decodifica listas com valores que contêm separadores comuns", () => {
    const vals = ["a,b", "c|d", "e f", ""];
    expect(decodeList(encodeList(vals))).toEqual(["a,b", "c|d", "e f"]);
    expect(isListOperator("in")).toBe(true); expect(isListOperator("eq")).toBe(false);
    expect(isValidOperator("ref", "in")).toBe(true); expect(isValidOperator("date", "in")).toBe(false);
  });
  it("aceita 1 card por linha na visualização", () => {
    expect(normalizeListPreferences({ view: { mode: "cards", cardsPerRow: 1 } }).view.cardsPerRow).toBe(1);
    expect(normalizeListPreferences({ view: { mode: "cards", cardsPerRow: 5 } }).view.cardsPerRow).toBeUndefined();
  });
});
