import { describe, it, expect } from "vitest";
import { nextPurchaseStatus, allowedPurchaseActions, authorizerCanApprove, slaStatus } from "../src/supply-workflow.js";
import { buildInstallments, normalizeApportionment, settlementNet, assertSettlementWithinBalance, displayTitleStatus, recurrenceDates } from "../src/financial.js";
import { applyEntry, applyExit, convertToPrimary, belowMinStock, batchCost, abcClassify } from "../src/stock.js";
import { monthlyDepreciation, depreciationForecast } from "../src/assets.js";
import { gmd, arrobas, animalValue, ageMonths, evolveCategory, expectedBirth } from "../src/livestock.js";
import { itemTotal, documentTotals, nextSalesKind, assertConvertible } from "../src/sales.js";
import { allPermissionKeys, PERMISSION_RESOURCES } from "../src/permissions.js";
import { RESOURCES } from "../src/resources/index.js";

describe("workflow de suprimentos", () => {
  it("segue o fluxo principal", () => {
    let s = nextPurchaseStatus("request", "submit"); expect(s).toBe("awaiting_awareness");
    s = nextPurchaseStatus(s, "acknowledge"); expect(s).toBe("quotation_in_progress");
    s = nextPurchaseStatus(s, "send_to_approval"); expect(s).toBe("awaiting_approval");
    s = nextPurchaseStatus(s, "approve"); expect(s).toBe("awaiting_purchase");
    s = nextPurchaseStatus(s, "mark_purchased"); expect(s).toBe("purchase_done");
    s = nextPurchaseStatus(s, "mark_received"); expect(s).toBe("purchase_received");
    s = nextPurchaseStatus(s, "finish"); expect(s).toBe("finished");
    expect(allowedPurchaseActions("finished")).toEqual([]);
  });
  it("bloqueia transições inválidas", () => {
    expect(() => nextPurchaseStatus("request", "approve")).toThrow(/não permitida/);
    expect(() => nextPurchaseStatus("cancelled", "submit")).toThrow();
  });
  it("valida limite e cotações do autorizador", () => {
    expect(authorizerCanApprove({ maxValue: "1000", isActive: true, minQuotes: 2 }, { approvedTotal: "1500", quotationCount: 3 }).ok).toBe(false);
    expect(authorizerCanApprove({ maxValue: "1000", isActive: true, minQuotes: 2 }, { approvedTotal: "900", quotationCount: 1 }).ok).toBe(false);
    expect(authorizerCanApprove({ maxValue: "1000", isActive: true, minQuotes: 2 }, { approvedTotal: "900", quotationCount: 2 }).ok).toBe(true);
  });
  it("calcula SLA", () => {
    const r = slaStatus(new Date("2026-01-01T00:00:00Z"), new Date("2026-01-01T06:00:00Z"), 5);
    expect(r.hours).toBe(6); expect(r.breached).toBe(true);
    expect(slaStatus(new Date("2026-01-01T00:00:00Z"), new Date("2026-01-02T00:00:00Z"), 0).breached).toBe(false);
  });
});

describe("financeiro", () => {
  it("gera parcelas por intervalo com soma exata", () => {
    const p = buildInstallments({ totalAmount: "1000.00", installments: 3, firstDueDate: "2026-01-31", mode: "interval", intervalDays: 30 });
    expect(p.map((x) => x.amount)).toEqual(["333.33", "333.33", "333.34"]);
    expect(p.map((x) => x.dueDate)).toEqual(["2026-01-31", "2026-03-02", "2026-04-01"]);
  });
  it("gera parcelas por dia fixo com entrada", () => {
    const p = buildInstallments({ totalAmount: "1000.00", installments: 2, firstDueDate: "2026-01-31", mode: "fixed_day", dueDay: 31, hasDownPayment: true, downPaymentValue: "100.00", downPaymentDate: "2026-01-10" });
    expect(p[0]).toMatchObject({ number: 0, amount: "100.00", isDownPayment: true });
    expect(p[1]!.dueDate).toBe("2026-01-31"); expect(p[2]!.dueDate).toBe("2026-02-28");
    expect(p[1]!.amount).toBe("450.00"); expect(p[2]!.amount).toBe("450.00");
  });
  it("rejeita entrada inválida", () => {
    expect(() => buildInstallments({ totalAmount: "100", installments: 1, firstDueDate: "2026-01-01", mode: "interval", hasDownPayment: true, downPaymentValue: "100" })).toThrow();
  });
  it("normaliza rateio por percentual e fecha resíduo", () => {
    const r = normalizeApportionment("100.00", [{ financialCategoryId: "c1", costCenterId: "cc1", percentage: "33.33" }, { financialCategoryId: "c2", costCenterId: "cc2", percentage: "33.33" }, { financialCategoryId: "c3", costCenterId: "cc3", percentage: "33.34" }]);
    expect(r.map((x) => x.amount)).toEqual(["33.33", "33.33", "33.34"]);
    expect(() => normalizeApportionment("100.00", [{ financialCategoryId: "c", costCenterId: "cc", amount: "50" }])).toThrow(/difere/);
  });
  it("calcula líquido da baixa e valida saldo", () => {
    expect(settlementNet({ amount: "100", discount: "10", penalty: "2", interest: "3", increase: "1" })).toBe("96.00");
    expect(() => assertSettlementWithinBalance("50.00", { amount: "40", discount: "20" })).toThrow(/excede/);
    expect(() => assertSettlementWithinBalance("50.00", { amount: "40", discount: "10" })).not.toThrow();
  });
  it("status exibido", () => {
    expect(displayTitleStatus({ status: "open", dueDate: "2026-01-01" }, "2026-02-01")).toBe("Vencida");
    expect(displayTitleStatus({ status: "open", dueDate: "2026-03-01" }, "2026-02-01")).toBe("Á vencer");
    expect(displayTitleStatus({ status: "paid", dueDate: "2026-03-01", paymentType: "advance" }, "2026-02-01")).toBe("Adiantamento/Baixado");
  });
  it("recorrência", () => {
    expect(recurrenceDates("2026-01-31", "monthly", 3)).toEqual(["2026-01-31", "2026-02-28", "2026-03-31"]);
    expect(recurrenceDates("2026-01-01", "weekly", 2)).toEqual(["2026-01-01", "2026-01-08"]);
  });
});

describe("estoque", () => {
  it("custo médio ponderado", () => {
    let b = applyEntry({ quantity: "0", averageCost: "0", totalValue: "0" }, "100", "10");
    b = applyEntry(b, "100", "20");
    expect(b.averageCost).toBe("15.000000"); expect(b.totalValue).toBe("3000.00");
    const e = applyExit(b, "50");
    expect(e.exitCost).toBe("15.000000"); expect(e.quantity).toBe("150.0000"); expect(e.totalValue).toBe("2250.00");
  });
  it("bloqueia saldo negativo", () => {
    expect(() => applyExit({ quantity: "10", averageCost: "1", totalValue: "10" }, "11")).toThrow(/insuficiente/);
  });
  it("conversão de unidade e estoque mínimo", () => {
    expect(convertToPrimary("2", "multiply", "50")).toBe("100.0000");
    expect(convertToPrimary("100", "divide", "50")).toBe("2.0000");
    expect(belowMinStock("5", "5")).toBe(true); expect(belowMinStock("6", "5")).toBe(false); expect(belowMinStock("0", null)).toBe(false);
  });
  it("custo da batida e ABC", () => {
    expect(batchCost([{ quantity: "10", unitCost: "2" }, { quantity: "5", unitCost: "4" }], "15")).toEqual({ total: "40.00", unit: "2.666667" });
    const abc = abcClassify([{ value: "80" }, { value: "15" }, { value: "5" }]);
    expect(abc.map((x) => x.cls)).toEqual(["A", "B", "C"]);
  });
});

describe("bens e pecuária", () => {
  it("depreciação linear", () => {
    const d = monthlyDepreciation({ acquisitionValue: "120000", residualPercent: "10", lifeYears: "10", type: "with_residual" });
    expect(d.residualValue).toBe("12000.00"); expect(d.depreciableValue).toBe("108000.00"); expect(d.monthly).toBe("900.00");
    const f = depreciationForecast("1000", "0", "300", "2026-11", 12);
    expect(f.length).toBe(4); expect(f[3]!.amount).toBe("100.00"); expect(f[1]!.month).toBe("2026-12"); expect(f[2]!.month).toBe("2027-01");
  });
  it("GMD, arrobas, UA, idade, evolução, parto", () => {
    expect(gmd("300", "2026-01-01", "330", "2026-01-31")).toBe("1.000");
    expect(arrobas("450")).toBe("15.000"); expect(animalValue("450", "300")).toBe("4500.00");
    expect(ageMonths("2024-01-15", "2026-01-14")).toBe(23);
    const cats = [{ id: "bez", minAgeMonths: 0, maxAgeMonths: 12, sex: "M" as const, nextCategoryId: null }, { id: "gar", minAgeMonths: 13, maxAgeMonths: 24, sex: "M" as const, nextCategoryId: null }];
    expect(evolveCategory(cats, { categoryId: "bez", sex: "M", ageMonths: 13 })).toBe("gar");
    expect(evolveCategory(cats, { categoryId: "bez", sex: "M", ageMonths: 6 })).toBeNull();
    expect(expectedBirth("2026-01-01")).toBe("2026-10-11");
  });
});

describe("vendas", () => {
  it("totais com descontos", () => {
    expect(itemTotal({ quantity: "10", unitPrice: "5", discount: "5", discountPercent: "10" })).toBe("40.00");
    expect(documentTotals([{ quantity: "2", unitPrice: "100" }], { freight: "10", discount: "20" })).toEqual({ subtotal: "200.00", total: "190.00" });
    expect(() => itemTotal({ quantity: "1", unitPrice: "1", discount: "5" })).toThrow();
  });
  it("conversão orçamento → pedido → venda", () => {
    expect(nextSalesKind("budget")).toBe("order"); expect(nextSalesKind("order")).toBe("sale"); expect(() => nextSalesKind("sale")).toThrow();
    expect(() => assertConvertible({ kind: "budget", status: "cancelled" })).toThrow();
  });
});

describe("catálogos", () => {
  it("permissões únicas e recursos consistentes", () => {
    const keys = allPermissionKeys();
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.length).toBeGreaterThan(600);
    const permKeys = new Set(PERMISSION_RESOURCES.map((r) => r.key));
    for (const r of RESOURCES) {
      expect(permKeys.has(r.permission), `permissão ${r.permission} do recurso ${r.key}`).toBe(true);
      expect(r.fields.some((f) => f.name === r.labelField), `labelField ${r.labelField} em ${r.key}`).toBe(true);
      const names = r.fields.map((f) => f.name); expect(new Set(names).size).toBe(names.length);
    }
  });
});
