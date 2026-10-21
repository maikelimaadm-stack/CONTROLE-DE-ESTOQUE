import { describe, expect, it } from "vitest";
import { D, money, sum } from "@agro/shared";
import { contarParcelasDoModelo, linhasDerivadasDoPlano, modeloDeParcelasParaTela, numeroDeParcelaDoTitulo } from "./modelo-de-parcelas";

describe("numeroDeParcelaDoTitulo", () => {
  it("aceita só inteiro ≥ 0 explícito; null/undefined/\"\"/negativo/fracionário = desconhecido", () => {
    expect(numeroDeParcelaDoTitulo(0)).toBe(0);
    expect(numeroDeParcelaDoTitulo(1)).toBe(1);
    expect(numeroDeParcelaDoTitulo("2")).toBe(2);
    expect(numeroDeParcelaDoTitulo(null)).toBeNull();
    expect(numeroDeParcelaDoTitulo(undefined)).toBeNull();
    expect(numeroDeParcelaDoTitulo("")).toBeNull();
    expect(numeroDeParcelaDoTitulo("  ")).toBeNull();
    expect(numeroDeParcelaDoTitulo(-1)).toBeNull();
    expect(numeroDeParcelaDoTitulo(1.5)).toBeNull();
    expect(numeroDeParcelaDoTitulo("1.0")).toBeNull();
    expect(numeroDeParcelaDoTitulo(NaN)).toBeNull();
  });
});

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

  it("deriva grade com buildInstallments quando plano não tem parcelas[] mas tem total", () => {
    const m = modeloDeParcelasParaTela({
      totalAmount: "300.00",
      plano: {
        installments: 3,
        first_due_date: "2026-06-01",
        mode: "interval",
        interval_days: 30,
        has_down_payment: false
      }
    });
    expect(m.especie).toBe("lista");
    if (m.especie !== "lista") return;
    expect(m.linhas).toHaveLength(3);
    expect(m.linhas[0]!.origem).toBe("plano_derivado");
    expect(m.linhas[0]!.vencimento).toBe("2026-06-01");
    expect(m.linhas.every((l) => l.valor !== "")).toBe(true);
  });

  it("mode ausente ou inválido: não deriva (nunca cai em interval por omissão)", () => {
    expect(linhasDerivadasDoPlano({
      installments: 2, first_due_date: "2026-01-01", interval_days: 30
    }, "100.00")).toBeNull();
    expect(linhasDerivadasDoPlano({
      installments: 2, first_due_date: "2026-01-01", mode: "mensal", interval_days: 30
    }, "100.00")).toBeNull();
    expect(modeloDeParcelasParaTela({
      totalAmount: "100.00",
      plano: { installments: 2, first_due_date: "2026-01-01" }
    }).especie).toBe("resumo");
  });

  it("first_due_date malformada / interval_days inválido / entrada sem dados: null", () => {
    expect(linhasDerivadasDoPlano({
      installments: 2, first_due_date: "01/01/2026", mode: "interval", interval_days: 30
    }, "100.00")).toBeNull();
    expect(linhasDerivadasDoPlano({
      installments: 2, first_due_date: "2026-01-01", mode: "interval", interval_days: 0
    }, "100.00")).toBeNull();
    expect(linhasDerivadasDoPlano({
      installments: 2, first_due_date: "2026-01-01", mode: "interval", interval_days: 30,
      has_down_payment: true, down_payment_value: "10.00"
      // sem down_payment_date
    }, "100.00")).toBeNull();
  });

  it("mode interval sem interval_days usa default do servidor (30)", () => {
    const linhas = linhasDerivadasDoPlano({
      installments: 2, first_due_date: "2026-01-01", mode: "interval"
    }, "100.00");
    expect(linhas).not.toBeNull();
    expect(linhas![1]!.vencimento).toBe("2026-01-31");
  });

  it("entrada + N parcelas derivadas: entrada não conta na quantidade", () => {
    const m = modeloDeParcelasParaTela({
      totalAmount: "1000.00",
      plano: {
        installments: 2,
        first_due_date: "2026-07-01",
        mode: "interval",
        interval_days: 30,
        has_down_payment: true,
        down_payment_value: "200.00",
        down_payment_date: "2026-06-15"
      }
    });
    expect(m.especie).toBe("lista");
    if (m.especie !== "lista") return;
    expect(m.comEntrada).toBe(true);
    expect(m.linhas[0]!.entrada).toBe(true);
    expect(contarParcelasDoModelo(m.linhas)).toBe(2);
  });

  it("soma das parcelas derivadas fecha o total em centavos (mesmo contrato do domínio)", () => {
    const linhas = linhasDerivadasDoPlano({
      installments: 3, first_due_date: "2026-01-01", mode: "interval", interval_days: 30
    }, "100.00");
    expect(linhas).not.toBeNull();
    expect(money(sum(linhas!.map((l) => l.valor)))).toBe(money(D("100.00")));
    expect(linhas!.map((l) => l.valor)).toEqual(["33.33", "33.33", "33.34"]);
  });

  it("sem total e sem parcelas[] → resumo honesto, sem inventar datas/valores", () => {
    const m = modeloDeParcelasParaTela({
      plano: { installments: 3, has_down_payment: true, first_due_date: "2026-06-01", mode: "interval" }
    });
    expect(m.especie).toBe("resumo");
    if (m.especie !== "resumo") return;
    expect(m.primeiroVencimento).toBe("2026-06-01");
    expect(m.texto).toMatch(/sem lista gravada/);
  });

  it("não inventa cronograma com total inválido", () => {
    expect(linhasDerivadasDoPlano({ installments: 2, first_due_date: "2026-01-01", mode: "interval" }, "0")).toBeNull();
    expect(linhasDerivadasDoPlano({ installments: 2, first_due_date: "2026-01-01", mode: "interval" }, "-10")).toBeNull();
    expect(modeloDeParcelasParaTela({
      totalAmount: "abc",
      plano: { installments: 2, first_due_date: "2026-01-01", mode: "interval" }
    }).especie).toBe("resumo");
  });

  it("parcelas_nota quando o plano não tem lista nem derivação", () => {
    const m = modeloDeParcelasParaTela({
      plano: { installments: 2 },
      parcelasNota: [{ dueDate: "2026-04-01", amount: "10.00" }, { vencimento: "2026-05-01", valor: "10.00" }]
    });
    expect(m.especie).toBe("lista");
    if (m.especie !== "lista") return;
    expect(m.linhas[0]!.origem).toBe("nota");
    expect(m.linhas[0]!.vencimento).toBe("2026-04-01");
  });

  it("XML / duplicatas da nota: preserva datas e valores sem recalcular", () => {
    const m = modeloDeParcelasParaTela({
      parcelasNota: [
        { dueDate: "2026-11-16", amount: "500.01" },
        { dueDate: "2026-12-16", amount: "499.99" }
      ]
    });
    expect(m.especie).toBe("lista");
    if (m.especie !== "lista") return;
    expect(m.linhas.map((l) => [l.vencimento, l.valor, l.origem])).toEqual([
      ["2026-11-16", "500.01", "nota"],
      ["2026-12-16", "499.99", "nota"]
    ]);
  });

  it("confirmado: títulos reais; observação do título vazia sem note na API; plano só em observacaoDoPlano", () => {
    const m = modeloDeParcelasParaTela({
      preferirTitulos: true,
      plano: {
        has_down_payment: true,
        parcelas: [
          { vencimento: "2026-01-01", valor: "30.00", observacao: "obs entrada" },
          { vencimento: "2026-02-01", valor: "70.00", observacao: "obs parcela" }
        ]
      },
      titulos: [
        { due_date: "2026-01-01", amount: "30.00", installment_number: 0, status: "paid" },
        { due_date: "2026-02-01", amount: "70.00", installment_number: 1, status: "open" }
      ]
    });
    expect(m.especie).toBe("lista");
    if (m.especie !== "lista") return;
    expect(m.linhas[0]!.origem).toBe("titulo");
    expect(m.linhas[0]!.observacao).toBe("");
    expect(m.linhas[0]!.observacaoDoPlano).toBe("obs entrada");
    expect(m.linhas[0]!.entrada).toBe(true);
    expect(m.linhas[0]!.situacaoTitulo).toBe("paid");
    expect(m.linhas[1]!.situacaoTitulo).toBe("open");
    expect(m.avisoObservacaoTitulos).toMatch(/plano|GET/i);
  });

  it("confirmado: installment_number null NÃO vira entrada nem casa observação", () => {
    const m = modeloDeParcelasParaTela({
      preferirTitulos: true,
      plano: { has_down_payment: true, parcelas: [{ observacao: "entrada" }, { observacao: "parcela" }] },
      titulos: [{ due_date: "2026-01-01", amount: "10", installment_number: null, status: "open" }]
    });
    expect(m.especie).toBe("lista");
    if (m.especie !== "lista") return;
    expect(m.linhas[0]!.entrada).toBe(false);
    expect(m.linhas[0]!.observacaoDoPlano).toBeUndefined();
  });

  it("confirmado: não casa observação do plano por posição quando installment_number falta", () => {
    const m = modeloDeParcelasParaTela({
      preferirTitulos: true,
      plano: { parcelas: [{ observacao: "a" }, { observacao: "b" }] },
      titulos: [{ due_date: "2026-01-01", amount: "10", status: "cancelled" }]
    });
    expect(m.especie).toBe("lista");
    if (m.especie !== "lista") return;
    expect(m.linhas[0]!.observacaoDoPlano).toBeUndefined();
    expect(m.linhas[0]!.situacaoTitulo).toBe("cancelled");
  });

  it("confirmado: números duplicados → sem observação do plano (aviso de ambiguidade)", () => {
    const m = modeloDeParcelasParaTela({
      preferirTitulos: true,
      plano: { parcelas: [{ observacao: "p1" }, { observacao: "p2" }] },
      titulos: [
        { due_date: "2026-01-01", amount: "10", installment_number: 1, status: "open" },
        { due_date: "2026-02-01", amount: "10", installment_number: 1, status: "open" }
      ]
    });
    expect(m.especie).toBe("lista");
    if (m.especie !== "lista") return;
    expect(m.linhas[0]!.observacaoDoPlano).toBeUndefined();
    expect(m.linhas[1]!.observacaoDoPlano).toBeUndefined();
    expect(m.avisoObservacaoTitulos).toMatch(/ambíguo/i);
  });

  it("aberto: plano com parcelas[] tem prioridade sobre títulos (não mascara divergência legítima na leitura preferida)", () => {
    const m = modeloDeParcelasParaTela({
      preferirTitulos: false,
      plano: {
        installments: 1,
        parcelas: [{ vencimento: "2026-03-01", valor: "50.00", observacao: "do plano" }]
      },
      titulos: [{ due_date: "2026-04-01", amount: "50.00", installment_number: 1, status: "open" }]
    });
    expect(m.especie).toBe("lista");
    if (m.especie !== "lista") return;
    expect(m.linhas[0]!.origem).toBe("plano");
    expect(m.linhas[0]!.vencimento).toBe("2026-03-01");
    expect(m.linhas[0]!.observacao).toBe("do plano");
  });

  it("vazio quando não há plano, nota nem títulos", () => {
    expect(modeloDeParcelasParaTela({})).toEqual({ especie: "vazio" });
  });
});
