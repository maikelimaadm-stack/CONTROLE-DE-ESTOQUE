import { describe, expect, it } from "vitest";
import { impostosDosDadosFiscais, totalExibidoDaCompra, type DadosFiscais } from "./estado";

const fiscal = (p: Partial<DadosFiscais>): DadosFiscais => ({
  chave_acesso: "", uf_nota: "", tipo_documento_fiscal: "",
  valor_ipi: "", valor_icms_st: "", seguro: "",
  tipo_titulo_id: "", classificacao_gasto: "",
  ...p,
});

describe("totalExibidoDaCompra — sem dupla contabilização (R2)", () => {
  it("criação F7: produto 100 + IPI 10 + ICMS-ST 5 + seguro 3 = 118 (não 136)", () => {
    const digitados = impostosDosDadosFiscais(fiscal({ valor_ipi: "10", valor_icms_st: "5", seguro: "3" }));
    expect(digitados).toBe("18.00");
    const total = totalExibidoDaCompra({
      totalItens: 100, frete: 0, outras: 0, desconto: 0,
      impostosDigitados: digitados, impostosGravados: digitados, incluirDigitados: true,
    });
    expect(total).toBe(118);
  });

  it("edição ABERTA: usa só gravados — mesmos impostos no form NÃO duplicam", () => {
    const impostos = "18.00";
    const total = totalExibidoDaCompra({
      totalItens: 100, frete: 0, outras: 0, desconto: 0,
      impostosDigitados: impostos, impostosGravados: impostos, incluirDigitados: false,
    });
    expect(total).toBe(118);
  });

  it("compra 27,00 sem tributos: total permanece 27 na edição", () => {
    const total = totalExibidoDaCompra({
      totalItens: 27, frete: 0, outras: 0, desconto: 0,
      impostosDigitados: "0.00", impostosGravados: "0.00", incluirDigitados: false,
    });
    expect(total).toBe(27);
  });
});
