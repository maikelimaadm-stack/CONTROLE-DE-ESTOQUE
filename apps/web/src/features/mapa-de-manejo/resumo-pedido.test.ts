import { describe, expect, it } from "vitest";
import {
  rotuloCompactoAnalises,
  textoLinhaResumoPedido,
  textoProgressoAnalises
} from "./resumo-pedido";

describe("textoLinhaResumoPedido — áreas ≠ análises", () => {
  it("uma área e um período: não inventa 1 análise redundante quando bate com áreas", () => {
    expect(textoLinhaResumoPedido({
      areasUnicas: 1, periodos: 1, analises: 1, hectares: 100, formatarHa: (h) => h.toFixed(1)
    })).toBe("1 área · 100.0 ha");
  });

  it("dez áreas e três recortes: 30 análises, nunca 30 áreas", () => {
    const s = textoLinhaResumoPedido({
      areasUnicas: 10, periodos: 3, analises: 30, hectares: 500, formatarHa: (h) => String(h)
    });
    expect(s).toBe("10 áreas · 3 períodos · 30 análises · 500 ha");
    expect(s).not.toMatch(/30 áreas/);
  });

  it("seleção com áreas ignoradas", () => {
    expect(textoLinhaResumoPedido({
      areasUnicas: 10, periodos: 1, analises: 8, areasIgnoradas: 2
    })).toBe("10 áreas · 8 análises · 2 ignorada(s)");
  });

  it("sem evidência de áreas: só análises", () => {
    expect(textoLinhaResumoPedido({
      areasUnicas: null, periodos: null, analises: 30
    })).toBe("30 análises");
  });

  it("não multiplica hectares por períodos", () => {
    const s = textoLinhaResumoPedido({
      areasUnicas: 10, periodos: 3, analises: 30, hectares: 100, formatarHa: () => "100"
    });
    expect(s).toContain("100 ha");
    expect(s).not.toContain("300 ha");
  });
});

describe("textoProgressoAnalises / rótulo compacto", () => {
  it("progresso com novos, reaproveitados e falhos — unidade análises", () => {
    expect(textoProgressoAnalises(12, 30, 2)).toBe("12 de 30 análises processadas · 2 com falha");
    expect(textoProgressoAnalises(12, 30, 0)).toBe("12 de 30 análises processadas");
    expect(textoProgressoAnalises(12, 30, 0)).not.toMatch(/áreas/);
  });

  it("barra compacta não diz áreas", () => {
    expect(rotuloCompactoAnalises(38, 102)).toBe("Analisando · 38/102");
  });
});
