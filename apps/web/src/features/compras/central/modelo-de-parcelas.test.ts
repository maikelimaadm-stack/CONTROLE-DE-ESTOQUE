import { describe, expect, it } from "vitest";
import { contarParcelasDoModelo, modeloDeParcelasParaTela } from "./modelo-de-parcelas";

describe("modeloDeParcelasParaTela", () => {
  it("usa parcelas[] do plano quando existem (com entrada na primeira linha)", () => {
    const m = modeloDeParcelasParaTela({
      plano: {
        has_down_payment: true,
        installments: 2,
        parcelas: [
          { vencimento: "2026-01-10", valor: "100.00", observacao: "entrada", isDownPayment: true },
          { vencimento: "2026-02-10", valor: "200.00", observacao: "" },
          { vencimento: "2026-03-10", valor: "200.00", observacao: "última" }
        ]
      }
    });
    expect(m.especie).toBe("lista");
    if (m.especie !== "lista") return;
    expect(m.comEntrada).toBe(true);
    expect(m.linhas).toHaveLength(3);
    expect(m.linhas[0]!.entrada).toBe(true);
    expect(m.linhas[0]!.origem).toBe("plano");
    expect(contarParcelasDoModelo(m.linhas)).toBe(2);
  });

  it("à vista / 1 parcela sem inventar segunda linha", () => {
    const m = modeloDeParcelasParaTela({
      plano: { installments: 1, has_down_payment: false, parcelas: [{ vencimento: "2026-01-15", valor: "50.00" }] }
    });
    expect(m.especie).toBe("lista");
    if (m.especie !== "lista") return;
    expect(m.linhas).toHaveLength(1);
    expect(m.linhas[0]!.entrada).toBe(false);
  });

  it("parcelas_nota quando o plano não tem lista", () => {
    const m = modeloDeParcelasParaTela({
      plano: { installments: 2 },
      parcelasNota: [{ dueDate: "2026-04-01", amount: "10.00" }, { vencimento: "2026-05-01", valor: "10.00" }]
    });
    expect(m.especie).toBe("lista");
    if (m.especie !== "lista") return;
    expect(m.linhas[0]!.origem).toBe("nota");
    expect(m.linhas[0]!.vencimento).toBe("2026-04-01");
  });

  it("compra confirmada preferindo títulos reais (entrada = installment_number 0)", () => {
    const m = modeloDeParcelasParaTela({
      preferirTitulos: true,
      plano: { parcelas: [{ vencimento: "2099-01-01", valor: "1" }] },
      titulos: [
        { due_date: "2026-01-01", amount: "30.00", installment_number: 0, status: "pago", note: "ent" },
        { due_date: "2026-02-01", amount: "70.00", installment_number: 1, situacao: "aberto" }
      ]
    });
    expect(m.especie).toBe("lista");
    if (m.especie !== "lista") return;
    expect(m.linhas[0]!.origem).toBe("titulo");
    expect(m.linhas[0]!.entrada).toBe(true);
    expect(m.linhas[0]!.situacaoTitulo).toBe("pago");
    expect(m.linhas[1]!.situacaoTitulo).toBe("aberto");
  });

  it("plano legado sem lista → resumo honesto, sem inventar datas", () => {
    const m = modeloDeParcelasParaTela({
      plano: { installments: 3, has_down_payment: true, first_due_date: "2026-06-01" }
    });
    expect(m).toEqual({
      especie: "resumo",
      texto: "Parcelado em 3 parcela(s) além da entrada, sem lista gravada.",
      comEntrada: true,
      installments: 3,
      primeiroVencimento: "2026-06-01"
    });
  });

  it("vazio quando não há plano, nota nem títulos", () => {
    expect(modeloDeParcelasParaTela({})).toEqual({ especie: "vazio" });
  });
});
