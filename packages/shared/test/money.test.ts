import { describe, it, expect } from "vitest";
import { splitEvenly, money, parseBRNumber, formatBRL } from "../src/money.js";
import { brToISO, isoToBR, addMonths, isISODate } from "../src/dates.js";

describe("money", () => {
  it("splitEvenly soma exatamente o total", () => {
    const parts = splitEvenly("100.00", 3);
    expect(parts).toEqual(["33.33", "33.33", "33.34"]);
    expect(splitEvenly("0.01", 2)).toEqual(["0.00", "0.01"]);
  });
  it("money arredonda half-even para 2 casas", () => {
    expect(money("1.005")).toBe("1.00");
    expect(money("1.015")).toBe("1.02");
    expect(money("2.675")).toBe("2.68");
  });
  it("parseBRNumber converte formato pt-BR", () => {
    expect(parseBRNumber("1.234,56")).toBe("1234.56");
    expect(() => parseBRNumber("abc")).toThrow();
  });
  it("formatBRL", () => {
    expect(formatBRL("1234.5").replace(/ /g, " ")).toBe("R$ 1.234,50");
  });
});

describe("dates", () => {
  it("converte BR <-> ISO", () => {
    expect(brToISO("31/12/2025")).toBe("2025-12-31");
    expect(isoToBR("2025-12-31")).toBe("31/12/2025");
    expect(() => brToToISOInvalid()).toThrow();
  });
  it("addMonths respeita fim de mês", () => {
    expect(addMonths("2025-01-31", 1)).toBe("2025-02-28");
    expect(addMonths("2024-01-31", 1)).toBe("2024-02-29");
  });
  it("isISODate valida", () => {
    expect(isISODate("2025-02-30")).toBe(false);
    expect(isISODate("2025-02-28")).toBe(true);
  });
});
function brToToISOInvalid() { return brToISO("31/02/2025"); }
