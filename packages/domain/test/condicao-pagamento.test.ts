import { describe, it, expect } from "vitest";
import { money, type DecimalString, type ISODate } from "@agro/shared";
import { planoDaCondicao, validarCondicaoPagamento, normalizarCondicaoPagamento, type CondicaoPagamento, type PlanoDerivado } from "../src/condicao-pagamento.js";
import { buildInstallments } from "../src/financial.js";
import { CADASTROS_COM_NUMERACAO } from "../src/codigo-hierarquico.js";

/**
 * CONDIÇÃO DE PAGAMENTO (VENDAS-A4, decisão 258). A condição deriva o plano; o plano vira títulos pela MESMA
 * conta de hoje. `parcelas` replica, campo a campo, o mapeamento de `parcelasDoTitulo`
 * (apps/api/src/services/financial-core.ts): se ele mudar, esta paridade tem de mudar junto.
 */
function parcelas(plan: PlanoDerivado, amount: DecimalString, dueDate: ISODate = plan.first_due_date) {
  const total = money(amount);
  return plan.installments > 1 || plan.has_down_payment
    ? buildInstallments({ totalAmount: total, installments: plan.installments, firstDueDate: plan.first_due_date, mode: plan.mode, intervalDays: plan.interval_days, dueDay: plan.due_day, hasDownPayment: plan.has_down_payment, downPaymentValue: plan.down_payment_value !== undefined ? String(plan.down_payment_value) : undefined, downPaymentDate: plan.down_payment_date })
    : [{ number: 1, dueDate, amount: total, isDownPayment: false }];
}

const cond = (o: Partial<CondicaoPagamento> = {}): CondicaoPagamento => ({ parcelas: 1, dias_primeira_parcela: 0, modo: "intervalo", intervalo_dias: 30, dia_vencimento: null, entrada: false, entrada_percentual: null, ...o });
const resumo = (xs: { dueDate: string; amount: string; isDownPayment: boolean }[]) => xs.map((x) => [x.dueDate, x.amount, x.isDownPayment]);
const campos = (c: CondicaoPagamento) => validarCondicaoPagamento(c).map((e) => e.caminho);
const centavos = (xs: { amount: string }[]) => xs.reduce((s, x) => s + Math.round(Number(x.amount) * 100), 0);

describe("condição de pagamento → plano → parcelas", () => {
  it("CP-D1 à vista: 1 parcela na data do documento", () => {
    const p = planoDaCondicao(cond(), { dataDocumento: "2026-03-15", total: "1000.00" });
    expect(p).toEqual({ installments: 1, first_due_date: "2026-03-15", mode: "interval", interval_days: 30, has_down_payment: false });
    expect(resumo(parcelas(p, "1000.00"))).toEqual([["2026-03-15", "1000.00", false]]);
  });

  it("CP-D2 1 parcela em 30 dias", () => {
    const p = planoDaCondicao(cond({ dias_primeira_parcela: 30 }), { dataDocumento: "2026-03-15", total: "1000.00" });
    expect(p.first_due_date).toBe("2026-04-14");
    expect(resumo(parcelas(p, "1000.00"))).toEqual([["2026-04-14", "1000.00", false]]);
  });

  it("CP-D3 30/60/90 sobre 1000.00: 333.33 · 333.33 · 333.34", () => {
    const p = planoDaCondicao(cond({ parcelas: 3, dias_primeira_parcela: 30, intervalo_dias: 30 }), { dataDocumento: "2026-03-15", total: "1000.00" });
    expect(resumo(parcelas(p, "1000.00"))).toEqual([["2026-04-14", "333.33", false], ["2026-05-14", "333.33", false], ["2026-06-13", "333.34", false]]);
  });

  it("CP-D4 entrada 30% + 2x: 300.00 na data, 2 × 350.00, soma = total", () => {
    const p = planoDaCondicao(cond({ parcelas: 2, dias_primeira_parcela: 30, entrada: true, entrada_percentual: "30" }), { dataDocumento: "2026-03-15", total: "1000.00" });
    expect(p.down_payment_value).toBe("300.00");
    expect(p.down_payment_date).toBe("2026-03-15");
    const xs = parcelas(p, "1000.00");
    expect(resumo(xs)).toEqual([["2026-03-15", "300.00", true], ["2026-04-14", "350.00", false], ["2026-05-14", "350.00", false]]);
    expect(centavos(xs)).toBe(100000);
  });

  it("CP-D5 dia fixo 10, 3 parcelas, 30 dias: 1º dia 10 ≥ data+30, depois dia 10 dos meses seguintes", () => {
    const p = planoDaCondicao(cond({ parcelas: 3, dias_primeira_parcela: 30, modo: "dia_fixo", dia_vencimento: 10 }), { dataDocumento: "2026-01-15", total: "300.00" });
    expect(p.mode).toBe("fixed_day");
    expect(p.due_day).toBe(10);
    expect(p.first_due_date).toBe("2026-03-10"); // base 2026-02-14
    expect(parcelas(p, "300.00").map((x) => x.dueDate)).toEqual(["2026-03-10", "2026-04-10", "2026-05-10"]);
  });

  it("CP-D6 dia fixo 31: fevereiro no último dia (28; 29 no bissexto), março 31", () => {
    const c = cond({ parcelas: 3, modo: "dia_fixo", dia_vencimento: 31 });
    expect(parcelas(planoDaCondicao(c, { dataDocumento: "2026-01-01", total: "300.00" }), "300.00").map((x) => x.dueDate)).toEqual(["2026-01-31", "2026-02-28", "2026-03-31"]);
    expect(parcelas(planoDaCondicao(c, { dataDocumento: "2028-01-01", total: "300.00" }), "300.00").map((x) => x.dueDate)).toEqual(["2028-01-31", "2028-02-29", "2028-03-31"]);
    expect(planoDaCondicao(c, { dataDocumento: "2026-02-01", total: "300.00" }).first_due_date).toBe("2026-02-28");
  });

  it("CP-D7 base exatamente no dia fixo → a própria base", () => {
    expect(planoDaCondicao(cond({ modo: "dia_fixo", dia_vencimento: 10 }), { dataDocumento: "2026-02-10", total: "1" }).first_due_date).toBe("2026-02-10");
    expect(planoDaCondicao(cond({ modo: "dia_fixo", dia_vencimento: 10, dias_primeira_parcela: 30 }), { dataDocumento: "2026-01-11", total: "1" }).first_due_date).toBe("2026-02-10");
  });

  it("CP-D8 limites: 1 e 120 parcelas; 0 e 366 dias; percentual 2 casas meio-para-par; entrada que não cabe", () => {
    expect(campos(cond({ parcelas: 1 }))).toEqual([]);
    expect(campos(cond({ parcelas: 120 }))).toEqual([]);
    expect(campos(cond({ dias_primeira_parcela: 0 }))).toEqual([]);
    expect(campos(cond({ dias_primeira_parcela: 366 }))).toEqual([]);
    const xs = parcelas(planoDaCondicao(cond({ parcelas: 120 }), { dataDocumento: "2026-01-01", total: "1000.00" }), "1000.00");
    expect(xs).toHaveLength(120);
    expect(centavos(xs)).toBe(100000);
    expect(planoDaCondicao(cond({ dias_primeira_parcela: 366 }), { dataDocumento: "2026-01-01", total: "1" }).first_due_date).toBe("2027-01-02");
    expect(campos(cond({ entrada: true, entrada_percentual: "33.33" }))).toEqual([]);
    expect(planoDaCondicao(cond({ entrada: true, entrada_percentual: "33.33" }), { dataDocumento: "2026-01-01", total: "1000.00" }).down_payment_value).toBe("333.30");
    // empate no 3º decimal: meio-para-par
    expect(planoDaCondicao(cond({ entrada: true, entrada_percentual: "50" }), { dataDocumento: "2026-01-01", total: "10.05" }).down_payment_value).toBe("5.02");
    expect(planoDaCondicao(cond({ entrada: true, entrada_percentual: "50" }), { dataDocumento: "2026-01-01", total: "10.15" }).down_payment_value).toBe("5.08");
    // entrada que arredonda para zero ou para o total: a recusa é a de buildInstallments, com a mesma mensagem
    const zero = planoDaCondicao(cond({ entrada: true, entrada_percentual: "0.01" }), { dataDocumento: "2026-01-01", total: "0.01" });
    expect(zero.down_payment_value).toBe("0.00");
    expect(() => parcelas(zero, "0.01")).toThrow("Entrada deve ser maior que zero e menor que o total");
    const cheia = planoDaCondicao(cond({ entrada: true, entrada_percentual: "99.99" }), { dataDocumento: "2026-01-01", total: "0.01" });
    expect(cheia.down_payment_value).toBe("0.01");
    expect(() => parcelas(cheia, "0.01")).toThrow("Entrada deve ser maior que zero e menor que o total");
  });

  it("CP-D9 validação: cada regra no campo certo; normalização anula o campo escondido", () => {
    expect(campos(cond({ parcelas: 0 }))).toEqual(["parcelas"]);
    expect(campos(cond({ parcelas: 121 }))).toEqual(["parcelas"]);
    expect(campos(cond({ parcelas: 1.5 }))).toEqual(["parcelas"]);
    expect(campos(cond({ dias_primeira_parcela: -1 }))).toEqual(["dias_primeira_parcela"]);
    expect(campos(cond({ dias_primeira_parcela: 367 }))).toEqual(["dias_primeira_parcela"]);
    expect(campos(cond({ modo: "semanal" as CondicaoPagamento["modo"] }))).toEqual(["modo"]);
    expect(campos(cond({ intervalo_dias: 0 }))).toEqual(["intervalo_dias"]);
    expect(campos(cond({ intervalo_dias: 367 }))).toEqual(["intervalo_dias"]);
    expect(campos(cond({ modo: "dia_fixo", dia_vencimento: null }))).toEqual(["dia_vencimento"]);
    expect(campos(cond({ modo: "dia_fixo", dia_vencimento: 32 }))).toEqual(["dia_vencimento"]);
    expect(campos(cond({ modo: "dia_fixo", dia_vencimento: 31 }))).toEqual([]);
    for (const p of [null, "", "0", "100", "10.555"]) expect(campos(cond({ entrada: true, entrada_percentual: p }))).toEqual(["entrada_percentual"]);
    const n = normalizarCondicaoPagamento(cond({ modo: "intervalo", dia_vencimento: 10, entrada: false, entrada_percentual: "30" }));
    expect([n.dia_vencimento, n.entrada_percentual]).toEqual([null, null]);
    const m = normalizarCondicaoPagamento(cond({ modo: "dia_fixo", dia_vencimento: 10, entrada: true, entrada_percentual: "30" }));
    expect([m.dia_vencimento, m.entrada_percentual]).toEqual([10, "30"]);
  });

  it("CP-D10 registry: condicoes_pagamento tem numeração", () => {
    expect(CADASTROS_COM_NUMERACAO).toContain("condicoes_pagamento");
  });
});
