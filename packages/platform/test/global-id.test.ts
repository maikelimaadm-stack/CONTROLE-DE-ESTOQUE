import { describe, it, expect } from "vitest";
import {
  GLOBAL_ID_ENTITIES, assertGlobalIdRegistry, formatGlobalId, globalIdEntity, globalIdEntityTypes,
  globalRecordRouteColumns, isGlobalIdEligible, isTechnicalTable, parseGlobalId, resolveGlobalRecordRoute
} from "../src/global-id.js";
import { DATA_DICTIONARY } from "../data-dictionary.registry.mjs";

const ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

describe("registry de elegibilidade", () => {
  it("é internamente consistente (sem duplicados, rota com :id, permissão válida, nada técnico)", () => {
    expect(assertGlobalIdRegistry()).toEqual([]);
  });
  it("entidades com identidade própria são elegíveis", () => {
    for (const t of ["input_entries", "financial_titles", "animals", "service_orders", "products", "roles"]) {
      expect(isGlobalIdEligible(t), t).toBe(true);
    }
  });
  it("linhas técnicas NUNCA são elegíveis", () => {
    for (const t of ["input_entry_items", "title_apportionments", "member_farms", "role_permissions", "service_order_lines"]) {
      expect(isGlobalIdEligible(t), t).toBe(false);
      expect(isTechnicalTable(`erp.${t}`).technical, t).toBe(true);
    }
  });
  it("infraestrutura interna não é elegível", () => {
    expect(isTechnicalTable("erp.code_sequences").technical).toBe(true);
    expect(isTechnicalTable("erp.global_id_sequences").technical).toBe(true);
    expect(isTechnicalTable("erp.input_entries").technical).toBe(false);
  });
  it("todo tipo elegível declara a coluna de empresa (ou null quando é da organização)", () => {
    for (const e of GLOBAL_ID_ENTITIES) expect(e.companyColumn === null || typeof e.companyColumn === "string", e.entityType).toBe(true);
  });
});

describe("formato do ID Global", () => {
  it("exibe com # e aceita as duas grafias na leitura", () => {
    expect(formatGlobalId(55)).toBe("#55");
    expect(formatGlobalId("#55")).toBe("#55");
    expect(parseGlobalId("#55")).toBe(55);
    expect(parseGlobalId(" 55 ")).toBe(55);
    expect(parseGlobalId(55)).toBe(55);
  });
  it("recusa entrada inválida sem lançar", () => {
    for (const v of ["", "#", "abc", "#0", "-3", "1.5", "#12a", null, undefined, {}]) expect(parseGlobalId(v as unknown), String(v)).toBeNull();
  });
});

describe("rota canônica a partir do registro", () => {
  it("resolve a rota simples", () => {
    expect(resolveGlobalRecordRoute("input_entries", ID)).toBe(`/estoque/entradas/${ID}`);
  });
  it("usa o discriminador quando uma tabela atende a mais de uma tela", () => {
    expect(resolveGlobalRecordRoute("financial_titles", ID, { direction: "payable" })).toBe(`/financeiro/contas-a-pagar/${ID}`);
    expect(resolveGlobalRecordRoute("financial_titles", ID, { direction: "receivable" })).toBe(`/financeiro/contas-a-receber/${ID}`);
    expect(resolveGlobalRecordRoute("sales_documents", ID, { kind: "budget" })).toBe(`/vendas/budgets/${ID}`);
    expect(resolveGlobalRecordRoute("sales_documents", ID, { kind: "order" })).toBe(`/vendas/orders/${ID}`);
  });
  it("preenche parâmetros extras da rota a partir da linha", () => {
    expect(resolveGlobalRecordRoute("animal_handlings", ID, { handling_type: "sanitary" })).toBe(`/pecuaria/manejo/sanitary/${ID}`);
    expect(resolveGlobalRecordRoute("animal_handlings", ID)).toBeNull();
  });
  it("tipo desconhecido não resolve rota", () => {
    expect(resolveGlobalRecordRoute("nao_existe", ID)).toBeNull();
  });
  it("declara as colunas que o resolvedor precisa ler", () => {
    expect(globalRecordRouteColumns(globalIdEntity("animal_handlings")!)).toEqual(["handling_type"]);
    expect(globalRecordRouteColumns(globalIdEntity("financial_titles")!)).toEqual(["direction"]);
    expect(globalRecordRouteColumns(globalIdEntity("input_entries")!)).toEqual([]);
  });
});

describe("dicionário de dados × registry de ID Global", () => {
  it("as duas fontes concordam sobre quem recebe ID Global", () => {
    const fromDictionary = DATA_DICTIONARY.filter((e) => e.globalId).map((e) => e.table.replace(/^erp\./, "")).sort();
    expect(fromDictionary).toEqual(globalIdEntityTypes().sort());
  });
  it("a rota canônica declarada no dicionário é a mesma do registry", () => {
    for (const e of DATA_DICTIONARY.filter((d) => d.globalId)) {
      const entity = globalIdEntity(e.table.replace(/^erp\./, ""))!;
      expect(e.route, e.code).toBe(entity.route);
    }
  });
});
