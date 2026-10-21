import { describe, expect, it } from "vitest";
import {
  corpoDoRateio, percentualDoValorDoRateio, rateioDoDocumento, somaDoRateio, valorDoPercentualDoRateio,
  type RateioDaCompraNaTela
} from "./estado";

/**
 * Classificação única + rateio por valor (decisão 325): conversão % ↔ R$ com D/decimal;
 * corpo único sem rateio; por_valor sem cabeçalho classificado no payload do rateio.
 */
describe("classificação única / rateio por valor", () => {
  it("R$ 27,00 em 60%/40% → R$ 16,20 / R$ 10,80 e soma 100%", () => {
    expect(valorDoPercentualDoRateio("27.00", "60")).toBe("16.20");
    expect(valorDoPercentualDoRateio("27.00", "40")).toBe("10.80");
    const r: RateioDaCompraNaTela = {
      tipo: "por_valor",
      linhas: [
        { categoriaId: "a", centroId: "b", contaId: "", safraId: "", percentual: "60" },
        { categoriaId: "c", centroId: "d", contaId: "", safraId: "", percentual: "40" },
      ],
    };
    expect(somaDoRateio(r)).toBe("100");
  });

  it("entrada pelo Valor (R$) converte para percentual canônico (4 casas)", () => {
    expect(percentualDoValorDoRateio("27.00", "16.20")).toBe("60.0000");
    expect(percentualDoValorDoRateio("27.00", "10.80")).toBe("40.0000");
    expect(percentualDoValorDoRateio("100.00", "33.33")).toBe("33.3300");
    expect(percentualDoValorDoRateio("0", "10")).toBe("");
    expect(percentualDoValorDoRateio("100", "")).toBe("");
  });

  it("centavos pequenos: 0,01 e 0,02 sobre base 0,03", () => {
    expect(valorDoPercentualDoRateio("0.03", percentualDoValorDoRateio("0.03", "0.01"))).toBe("0.01");
    expect(valorDoPercentualDoRateio("0.03", percentualDoValorDoRateio("0.03", "0.02"))).toBe("0.02");
  });

  it("corpoDoRateio: classificação única omite rateio; por_valor manda linhas em texto", () => {
    expect(corpoDoRateio(rateioDoDocumento())).toEqual({});
    const porValor: RateioDaCompraNaTela = {
      tipo: "por_valor",
      linhas: [{ categoriaId: "n1", centroId: "c1", contaId: "", safraId: "", percentual: "100" }],
    };
    expect(corpoDoRateio(porValor)).toEqual({
      rateio: {
        tipo: "por_valor",
        linhas: [{
          categoria_financeira_id: "n1", centro_custo_id: "c1",
          conta_contabil_id: null, safra_id: null, percentual: "100",
        }],
      },
    });
  });
});
