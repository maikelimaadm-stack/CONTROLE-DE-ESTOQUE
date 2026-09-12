import { describe, it, expect } from "vitest";
import { createFormatter, currencyForLocale, formatCurrency, formatDate, formatDateTime, formatMonth, formatNumber, formatPercent, formatQuantity } from "../src/locale.js";

/** Espaços do Intl (fino/não separável) variam por runtime; comparamos com espaço normalizado. */
const norm = (s: string) => s.replace(/ | /g, " ");

describe("datas", () => {
  it("formata data de negócio no padrão do idioma", () => {
    expect(formatDate("2026-09-12")).toBe("12/09/2026");
    expect(formatDate("2026-09-12T15:30:00Z")).toBe("12/09/2026");
  });
  it("não inventa data: vazio continua vazio e valor inválido volta como veio", () => {
    expect(formatDate(null)).toBe("");
    expect(formatDate("")).toBe("");
    expect(formatDate("12/09/2026")).toBe("12/09/2026");
  });
  it("data de negócio não sofre deslocamento de fuso", () => {
    expect(formatDate("2026-01-01")).toBe("01/01/2026");
    expect(formatDate("2026-12-31")).toBe("31/12/2026");
  });
  it("formata timestamp com hora no fuso pedido", () => {
    expect(norm(formatDateTime("2026-09-12T15:30:00Z", { timeZone: "UTC" }))).toBe("12/09/2026, 15:30");
  });
  it("formata mês de competência por extenso", () => {
    expect(formatMonth("2026-09")).toBe("setembro de 2026");
  });
});

describe("números, moeda e percentual", () => {
  it("usa separadores do idioma", () => {
    expect(formatNumber("1234.56", { maximumFractionDigits: 2 })).toBe("1.234,56");
    expect(formatQuantity("1234.5", 3)).toBe("1.234,500");
  });
  it("aceita string decimal sem perder as casas de exibição", () => {
    expect(norm(formatCurrency("1234.56"))).toBe("R$ 1.234,56");
    expect(norm(formatCurrency(0))).toBe("R$ 0,00");
  });
  it("valor ausente não vira zero enganoso", () => {
    expect(formatCurrency(null)).toBe("");
    expect(formatCurrency("")).toBe("");
    expect(formatNumber(undefined)).toBe("");
    expect(formatCurrency("abc")).toBe("");
  });
  it("percentual parte de pontos percentuais, como o domínio persiste", () => {
    expect(formatPercent("12.5")).toBe("12,5%");
    expect(formatPercent(100)).toBe("100%");
    expect(formatPercent("33.333", { maximumFractionDigits: 1 })).toBe("33,3%");
  });
  it("moeda padrão vem do idioma e pode ser sobrescrita", () => {
    expect(currencyForLocale("pt-BR")).toBe("BRL");
    expect(norm(formatCurrency("10", { locale: "pt-BR", currency: "USD" }))).toContain("US$");
  });
});

describe("formatador amarrado ao idioma", () => {
  it("expõe os formatadores prontos para a camada de tela", () => {
    const f = createFormatter({ locale: "pt-BR", timeZone: "UTC" });
    expect(f.locale).toBe("pt-BR");
    expect(f.currency).toBe("BRL");
    expect(f.date("2026-09-12")).toBe("12/09/2026");
    expect(norm(f.currencyValue("99.9"))).toBe("R$ 99,90");
    expect(f.percent("7")).toBe("7%");
    expect(f.quantity("2", 2)).toBe("2,00");
    expect(norm(f.dateTime("2026-09-12T00:00:00Z"))).toBe("12/09/2026, 00:00");
  });
});
