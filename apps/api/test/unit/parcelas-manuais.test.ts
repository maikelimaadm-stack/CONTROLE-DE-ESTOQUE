import { describe, it, expect } from "vitest";
import { installmentPlanSchema, parcelasDoTitulo } from "../../src/services/financial-core.js";

/**
 * As parcelas escritas à mão na Central de Compras (10/2026): a lista do plano é o cronograma — data, valor e a
 * observação de cada parcela viram a nota do título — e a soma continua tendo de fechar o total.
 */
const planoDe = (parcelas: { vencimento: string; valor: string; observacao?: string }[]) => installmentPlanSchema.parse({
  installments: parcelas.length, first_due_date: parcelas[0]!.vencimento, mode: "interval", interval_days: 30, has_down_payment: false, parcelas
});

describe("parcelas do plano escritas à mão", () => {
  it("a lista manda: cada linha vira uma parcela, com a observação", () => {
    const plan = planoDe([
      { vencimento: "2026-02-10", valor: "100.00", observacao: "Primeira" },
      { vencimento: "2026-03-15", valor: "200.00" }
    ]);
    expect(parcelasDoTitulo({ amount: "300.00", dueDate: "2026-02-10", plan })).toEqual([
      { number: 1, dueDate: "2026-02-10", amount: "100.00", isDownPayment: false, note: "Primeira" },
      { number: 2, dueDate: "2026-03-15", amount: "200.00", isDownPayment: false }
    ]);
  });

  it("soma diferente do total do documento recusa", () => {
    const plan = planoDe([{ vencimento: "2026-02-10", valor: "90.00" }]);
    expect(() => parcelasDoTitulo({ amount: "300.00", dueDate: "2026-02-10", plan })).toThrow(/não fecham/);
  });

  it("sem a lista, a conta de sempre continua", () => {
    const plan = installmentPlanSchema.parse({ installments: 2, first_due_date: "2026-02-10", mode: "interval", interval_days: 30, has_down_payment: false });
    expect(parcelasDoTitulo({ amount: "300.00", dueDate: "2026-02-10", plan }).map((p) => p.amount)).toEqual(["150.00", "150.00"]);
  });
});
