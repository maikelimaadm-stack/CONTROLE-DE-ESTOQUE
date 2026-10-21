import { describe, it, expect } from "vitest";
import { contarParcelas } from "./parcelas";

describe("contarParcelas", () => {
  it("ignora a entrada na contagem (contrato de buildInstallments)", () => {
    expect(contarParcelas([
      { entrada: true },
      { entrada: false },
      { entrada: false }
    ])).toBe(2);
  });

  it("lista só de parcelas conta todas", () => {
    expect(contarParcelas([{ entrada: false }, { entrada: false }])).toBe(2);
  });

  it("lista vazia vira zero (definir usa Math.max(1, …))", () => {
    expect(contarParcelas([])).toBe(0);
  });
});
