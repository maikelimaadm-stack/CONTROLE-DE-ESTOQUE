import { describe, it, expect } from "vitest";
import { criarFormatador, moedaDoIdioma, formatarMoeda, formatarData, formatarDataHora, formatarMes, formatarNumero, formatarPercentual, formatarQuantidade } from "../src/formatacao.js";

/** Espaços do Intl (fino/não separável) variam por runtime; comparamos com espaço normalizado. */
const norm = (s: string) => s.replace(/ | /g, " ");

describe("datas", () => {
  it("formata data de negócio no padrão do idioma", () => {
    expect(formatarData("2026-09-12")).toBe("12/09/2026");
    expect(formatarData("2026-09-12T15:30:00Z")).toBe("12/09/2026");
  });
  it("não inventa data: vazio continua vazio e valor inválido volta como veio", () => {
    expect(formatarData(null)).toBe("");
    expect(formatarData("")).toBe("");
    expect(formatarData("12/09/2026")).toBe("12/09/2026");
  });
  it("data de negócio não sofre deslocamento de fuso", () => {
    expect(formatarData("2026-01-01")).toBe("01/01/2026");
    expect(formatarData("2026-12-31")).toBe("31/12/2026");
  });
  it("formata timestamp com hora no fuso pedido", () => {
    expect(norm(formatarDataHora("2026-09-12T15:30:00Z", { fusoHorario: "UTC" }))).toBe("12/09/2026, 15:30");
  });
  it("formata mês de competência por extenso", () => {
    expect(formatarMes("2026-09")).toBe("setembro de 2026");
  });
});

describe("números, moeda e percentual", () => {
  it("usa separadores do idioma", () => {
    expect(formatarNumero("1234.56", { casasMaximas: 2 })).toBe("1.234,56");
    expect(formatarQuantidade("1234.5", 3)).toBe("1.234,500");
  });
  it("aceita string decimal sem perder as casas de exibição", () => {
    expect(norm(formatarMoeda("1234.56"))).toBe("R$ 1.234,56");
    expect(norm(formatarMoeda(0))).toBe("R$ 0,00");
  });
  it("valor ausente não vira zero enganoso", () => {
    expect(formatarMoeda(null)).toBe("");
    expect(formatarMoeda("")).toBe("");
    expect(formatarNumero(undefined)).toBe("");
    expect(formatarMoeda("abc")).toBe("");
  });
  it("percentual parte de pontos percentuais, como o domínio persiste", () => {
    expect(formatarPercentual("12.5")).toBe("12,5%");
    expect(formatarPercentual(100)).toBe("100%");
    expect(formatarPercentual("33.333", { casasMaximas: 1 })).toBe("33,3%");
  });
  it("moeda padrão vem do idioma e pode ser sobrescrita", () => {
    expect(moedaDoIdioma("pt-BR")).toBe("BRL");
    expect(norm(formatarMoeda("10", { idioma: "pt-BR", moeda: "USD" }))).toContain("US$");
  });
});

describe("formatador amarrado ao idioma", () => {
  it("expõe os formatadores prontos para a camada de tela", () => {
    const f = criarFormatador({ idioma: "pt-BR", fusoHorario: "UTC" });
    expect(f.idioma).toBe("pt-BR");
    expect(f.moeda).toBe("BRL");
    expect(f.data("2026-09-12")).toBe("12/09/2026");
    expect(norm(f.valor("99.9"))).toBe("R$ 99,90");
    expect(f.percentual("7")).toBe("7%");
    expect(f.quantidade("2", 2)).toBe("2,00");
    expect(norm(f.dataHora("2026-09-12T00:00:00Z"))).toBe("12/09/2026, 00:00");
  });
});
