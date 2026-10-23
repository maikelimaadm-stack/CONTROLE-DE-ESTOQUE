import { describe, expect, it } from "vitest";
import { recomputarDescontoAposBruto, sincronizarDesconto } from "./desconto-da-linha";

describe("desconto-da-linha", () => {
  const base = { product_id: "p", quantity: "10", unit_value: "5", generate_stock: true };

  it("valor → % sobre o bruto", () => {
    expect(sincronizarDesconto(base, "discount", "10")).toEqual({ discount: "10", discount_percent: "20.0000" });
  });

  it("% → valor sobre o bruto", () => {
    expect(sincronizarDesconto(base, "discount_percent", "20")).toEqual({ discount_percent: "20", discount: "10.00" });
  });

  it("vazio zera os dois", () => {
    expect(sincronizarDesconto(base, "discount", "")).toEqual({ discount: "", discount_percent: "" });
  });

  it("recomputa R$ quando o bruto muda e há %", () => {
    const it = { ...base, discount: "10", discount_percent: "20", quantity: "20" };
    expect(recomputarDescontoAposBruto(it)).toEqual({ discount: "20.00", discount_percent: "20" });
  });
});
