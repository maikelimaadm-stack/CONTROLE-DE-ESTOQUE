import { describe, expect, it } from "vitest";
import { canonicoDoDigitado, ehZeroCanonico, filtrarDigitacao, paraDigitacao } from "./numero-digitado";

describe("numero-digitado", () => {
  it("ehZeroCanonico", () => {
    expect(ehZeroCanonico("")).toBe(true);
    expect(ehZeroCanonico("0")).toBe(true);
    expect(ehZeroCanonico("0.00")).toBe(true);
    expect(ehZeroCanonico("0,0")).toBe(true);
    expect(ehZeroCanonico("1")).toBe(false);
    expect(ehZeroCanonico("0.01")).toBe(false);
  });

  it("paraDigitacao limpa zero e troca ponto por vírgula", () => {
    expect(paraDigitacao("0")).toBe("");
    expect(paraDigitacao("0.00")).toBe("");
    expect(paraDigitacao("1000.5")).toBe("1000,5");
    expect(paraDigitacao("10")).toBe("10");
  });

  it("filtrarDigitacao: sem zero à esquerda; casas; inteiro", () => {
    expect(filtrarDigitacao("01")).toBe("1");
    expect(filtrarDigitacao("0,5")).toBe("0,5");
    expect(filtrarDigitacao("1.234,567", { casas: 2 })).toBe("1234,56");
    expect(filtrarDigitacao("12,345", { casas: 2 })).toBe("12,34");
    expect(filtrarDigitacao("12,3", { inteiro: true })).toBe("123");
  });

  it("canonicoDoDigitado: pt-BR → ponto", () => {
    expect(canonicoDoDigitado("")).toBe("");
    expect(canonicoDoDigitado("1.000,50")).toBe("1000.50");
    expect(canonicoDoDigitado("1000,5")).toBe("1000.5");
    expect(canonicoDoDigitado("1.000")).toBe("1000");
    expect(canonicoDoDigitado("10")).toBe("10");
    expect(canonicoDoDigitado(",")).toBe("");
  });
});
