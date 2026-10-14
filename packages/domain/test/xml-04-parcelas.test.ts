/**
 * XML-04 (decisão 318) — "a duplicata diz por quê": as parcelas da nota com a EXPLICAÇÃO.
 *
 * A regra de `parcelasDaNota` não mudou (tolerância de R$ 0,01, líquido = vLiq da fatura ou vNF, Σ vDup = líquido E
 * líquido = total, a última parcela absorve e precisa ficar positiva). Aqui se prova que a resposta DIZ qual
 * comparação falhou — cada uma isolada, as duas juntas, a última não positiva —, o motivo do `sem_duplicatas`, que o
 * `conferem` continua o mesmo, e a BORDA da tolerância dos dois lados (0,01 confere; 0,011 falha): mudar a tolerância
 * quebra este teste. Notas montadas sobre a nota sintética lida (só cobrança e vNF trocados).
 */
import { describe, expect, it } from "vitest";
import { lerNotaFiscalEletronica, parcelasDaNota, type NotaFiscalLida, type ParcelasDaNota } from "../src/index.js";
import { xmlSimples } from "./f7-nfe-sintetica.js";

function lida(xml: string): NotaFiscalLida {
  const l = lerNotaFiscalEletronica(xml);
  if (!l.ok) throw new Error(JSON.stringify(l.recusas));
  return l.nota;
}
/** A nota sintética lida, SEM o `duplicatasDescartadas` (o campo ausente de uma leitura anterior): cada teste diz o seu. */
const BASE: NotaFiscalLida = { ...lida(xmlSimples().xml) };
delete BASE.duplicatasDescartadas;

/** A nota sintética com a cobrança dada: `liquidoDaFatura` ausente ⇒ sem `<fat>`; `null` ⇒ fatura sem vLiq. */
function nota(o: { duplicatas?: string[]; vNF?: string; liquidoDaFatura?: string | null; descartadas?: number }): NotaFiscalLida {
  return {
    ...BASE,
    totais: { ...BASE.totais, nota: o.vNF ?? "100.00" },
    fatura: o.liquidoDaFatura === undefined ? null : { numero: "1", valorOriginal: null, desconto: null, liquido: o.liquidoDaFatura },
    duplicatas: (o.duplicatas ?? []).map((valor, k) => ({ numero: String(k + 1).padStart(3, "0"), vencimento: `2026-1${k}-15`, valor })),
    ...(o.descartadas === undefined ? {} : { duplicatasDescartadas: o.descartadas }),
  };
}
const falhasDe = (r: ParcelasDaNota) => (r.situacao === "nao_conferem" ? r.falhas : r.situacao);

describe("XML-04 — conferem: a resposta de sempre", () => {
  it("Σ vDup = líquido = total → conferem, só com as parcelas (nenhum campo novo)", () => {
    expect(parcelasDaNota(nota({ duplicatas: ["60.00", "40.00"] }), "100.00")).toEqual({ situacao: "conferem", parcelas: [
      { numero: "001", vencimento: "2026-10-15", valor: "60.00" }, { numero: "002", vencimento: "2026-11-15", valor: "40.00" },
    ] });
  });

  it("dentro da tolerância, a última absorve o centavo (a soma é EXATAMENTE o total)", () => {
    const r = parcelasDaNota(nota({ duplicatas: ["60.00", "40.00"] }), "100.01");
    expect(r).toEqual({ situacao: "conferem", parcelas: [
      { numero: "001", vencimento: "2026-10-15", valor: "60.00" }, { numero: "002", vencimento: "2026-11-15", valor: "40.01" },
    ] });
  });
});

describe("XML-04 — nao_conferem diz qual comparação falhou", () => {
  it("só a soma ≠ líquido: uma falha, as duas diferenças com sinal, o líquido do vNF", () => {
    expect(parcelasDaNota(nota({ duplicatas: ["60.00", "30.00"] }), "100.00")).toEqual({
      situacao: "nao_conferem", soma: "90.00", liquido: "100.00", total: "100.00", origemDoLiquido: "nota",
      falhas: ["soma_diferente_do_liquido"], diferencaSomaLiquido: "-10.00", diferencaLiquidoTotal: "0.00",
    });
  });

  it("só o líquido ≠ total: uma falha (a soma confere com o líquido)", () => {
    expect(parcelasDaNota(nota({ duplicatas: ["60.00", "40.00"] }), "120.00")).toEqual({
      situacao: "nao_conferem", soma: "100.00", liquido: "100.00", total: "120.00", origemDoLiquido: "nota",
      falhas: ["liquido_diferente_do_total"], diferencaSomaLiquido: "0.00", diferencaLiquidoTotal: "-20.00",
    });
  });

  it("as duas juntas: as DUAS falhas, na ordem soma → líquido (nenhuma esconde a outra)", () => {
    expect(parcelasDaNota(nota({ duplicatas: ["60.00", "30.00"] }), "80.00")).toEqual({
      situacao: "nao_conferem", soma: "90.00", liquido: "100.00", total: "80.00", origemDoLiquido: "nota",
      falhas: ["soma_diferente_do_liquido", "liquido_diferente_do_total"], diferencaSomaLiquido: "-10.00", diferencaLiquidoTotal: "20.00",
    });
  });

  it("o líquido da FATURA (vLiq) quando ela o traz; fatura sem vLiq ⇒ o líquido é o vNF", () => {
    const comVLiq = nota({ duplicatas: ["95.00"], vNF: "100.00", liquidoDaFatura: "95.00" });
    expect(parcelasDaNota(comVLiq, "100.00")).toEqual({
      situacao: "nao_conferem", soma: "95.00", liquido: "95.00", total: "100.00", origemDoLiquido: "fatura",
      falhas: ["liquido_diferente_do_total"], diferencaSomaLiquido: "0.00", diferencaLiquidoTotal: "-5.00",
    });
    const semVLiq = nota({ duplicatas: ["95.00"], vNF: "100.00", liquidoDaFatura: null });
    expect(parcelasDaNota(semVLiq, "100.00")).toEqual({
      situacao: "nao_conferem", soma: "95.00", liquido: "100.00", total: "100.00", origemDoLiquido: "nota",
      falhas: ["soma_diferente_do_liquido"], diferencaSomaLiquido: "-5.00", diferencaLiquidoTotal: "0.00",
    });
  });

  it("as duas comparações passam, mas a última ficaria ≤ 0: só `ultima_parcela_nao_positiva`", () => {
    // Premissa: 100,01 − 100 = 0,01 e 100 − 99,99 = 0,01 (as duas na tolerância); a última = 99,99 − 100,00 = −0,01.
    expect(parcelasDaNota(nota({ duplicatas: ["100.00", "0.01"] }), "99.99")).toEqual({
      situacao: "nao_conferem", soma: "100.01", liquido: "100.00", total: "99.99", origemDoLiquido: "nota",
      falhas: ["ultima_parcela_nao_positiva"], diferencaSomaLiquido: "0.01", diferencaLiquidoTotal: "0.01",
    });
    // Zero também não é parcela.
    expect(falhasDe(parcelasDaNota(nota({ duplicatas: ["100.00", "0.00"] }), "100.00"))).toEqual(["ultima_parcela_nao_positiva"]);
  });
});

describe("XML-04 — a borda da tolerância (R$ 0,01), dos dois lados", () => {
  it("Σ vDup − líquido: ±0,01 confere; ±0,011 falha", () => {
    expect(parcelasDaNota(nota({ duplicatas: ["100.01"] }), "100.00").situacao).toBe("conferem");
    expect(parcelasDaNota(nota({ duplicatas: ["99.99"] }), "100.00").situacao).toBe("conferem");
    expect(falhasDe(parcelasDaNota(nota({ duplicatas: ["100.011"] }), "100.00"))).toEqual(["soma_diferente_do_liquido"]);
    expect(falhasDe(parcelasDaNota(nota({ duplicatas: ["99.989"] }), "100.00"))).toEqual(["soma_diferente_do_liquido"]);
  });

  it("líquido − total: ±0,01 confere; ±0,011 falha", () => {
    expect(parcelasDaNota(nota({ duplicatas: ["100.00"] }), "99.99").situacao).toBe("conferem");
    expect(parcelasDaNota(nota({ duplicatas: ["100.00"] }), "100.01").situacao).toBe("conferem");
    expect(falhasDe(parcelasDaNota(nota({ duplicatas: ["100.00"] }), "99.989"))).toEqual(["liquido_diferente_do_total"]);
    expect(falhasDe(parcelasDaNota(nota({ duplicatas: ["100.00"] }), "100.011"))).toEqual(["liquido_diferente_do_total"]);
  });
});

describe("XML-04 — sem_duplicatas diz o motivo", () => {
  it("a nota não traz <dup> (nada descartado, ou o campo ausente de uma leitura anterior) → nota_sem_duplicatas", () => {
    expect(parcelasDaNota(nota({}), "100.00")).toEqual({ situacao: "sem_duplicatas", motivo: "nota_sem_duplicatas" });
    expect(parcelasDaNota(nota({ descartadas: 0 }), "100.00")).toEqual({ situacao: "sem_duplicatas", motivo: "nota_sem_duplicatas" });
  });

  it("o leitor descartou duplicatas sem vencimento → duplicata_sem_vencimento", () => {
    expect(parcelasDaNota(nota({ descartadas: 2 }), "100.00")).toEqual({ situacao: "sem_duplicatas", motivo: "duplicata_sem_vencimento" });
    expect(parcelasDaNota(nota({ descartadas: 1 }), "100.00")).toEqual({ situacao: "sem_duplicatas", motivo: "duplicata_sem_vencimento" });
  });
});
