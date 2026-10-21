import { describe, expect, it } from "vitest";
import { numeroBR } from "./utils";

describe("numeroBR", () => {
  it("inteiro sai com milhar e sem casas (1.000)", () => {
    expect(numeroBR(1000)).toBe("1.000");
    expect(numeroBR("1000")).toBe("1.000");
    expect(numeroBR("10.0000")).toBe("10");
    expect(numeroBR(0)).toBe("0");
  });
  it("decimal sai com 2 casas e vírgula (1.000,50)", () => {
    expect(numeroBR(1000.5)).toBe("1.000,50");
    expect(numeroBR("1000.5")).toBe("1.000,50");
    expect(numeroBR("10,5")).toBe("10,50");
  });
  it("casas forçadas prevalecem", () => {
    expect(numeroBR(10, 4)).toBe("10,0000");
    expect(numeroBR("10.5", 0)).toBe("11");
  });
  it("vazio ou inválido vira travessão", () => {
    expect(numeroBR(null)).toBe("—");
    expect(numeroBR(undefined)).toBe("—");
    expect(numeroBR("")).toBe("—");
    expect(numeroBR("abc")).toBe("—");
  });
});
