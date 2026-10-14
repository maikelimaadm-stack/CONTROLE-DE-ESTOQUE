import { describe, expect, it, vi } from "vitest";
import { parcelasDaNota, type NotaFiscalLida, type ParcelasDaNota } from "@agro/domain";
import { brl } from "../../../lib/utils";
import { explicacaoDasParcelas } from "./explicacao-das-parcelas";

vi.mock("@/lib/utils", () => import("../../../lib/utils"));

/**
 * XML-04 (decisão 318) — "a duplicata diz por quê": a explicação das parcelas que não servem. Os TRÊS números (Σ das
 * duplicatas, o líquido com a origem dele, o total da compra), CADA comparação que falhou com a diferença em dinheiro
 * (o formatador da tela), os motivos de não haver duplicatas, a explicação do resultado RECALCULADO pelo domínio e a
 * API anterior (sem os campos novos: a soma e o líquido, e nada inventado).
 */

const SOMA = "5700.00"; const LIQUIDO = "5979.00"; const TOTAL = "6029.00";
const naoConferem = (extra: Partial<Extract<ParcelasDaNota, { situacao: "nao_conferem" }>> = {}): ParcelasDaNota => ({
  situacao: "nao_conferem", soma: SOMA, liquido: LIQUIDO, total: TOTAL, origemDoLiquido: "fatura",
  falhas: ["soma_diferente_do_liquido", "liquido_diferente_do_total"], diferencaSomaLiquido: "-279.00", diferencaLiquidoTotal: "-50.00", ...extra
});

describe("XML-04 P1 nao_conferem: os TRÊS números e cada comparação que falhou, com a diferença", () => {
  it("os três números, como a tela escreve dinheiro, e de onde veio o líquido (a fatura, vLiq)", () => {
    const e = explicacaoDasParcelas(naoConferem());
    expect(e?.resumo).toBe("As duplicatas da nota não conferem: a compra usa a condição de pagamento.");
    expect(e?.numeros).toBe(`Soma das duplicatas: ${brl(SOMA)} · Líquido da fatura (vLiq): ${brl(LIQUIDO)} · Total da compra: ${brl(TOTAL)}.`);
    for (const n of [SOMA, LIQUIDO, TOTAL]) expect(e?.numeros, n).toContain(brl(n));
  });
  it("o líquido que veio do total da nota (sem o líquido da fatura) diz que é o vNF", () => {
    expect(explicacaoDasParcelas(naoConferem({ origemDoLiquido: "nota" }))?.numeros).toContain(`Líquido (o total da nota, vNF: a nota não traz o líquido da fatura): ${brl(LIQUIDO)}`);
  });
  it("as DUAS comparações que falharam juntas, cada uma com a diferença (abaixo)", () => {
    expect(explicacaoDasParcelas(naoConferem())?.falhas).toEqual([
      { codigo: "soma_diferente_do_liquido", texto: `A soma das duplicatas fica ${brl("279.00")} abaixo do líquido.` },
      { codigo: "liquido_diferente_do_total", texto: `O líquido fica ${brl("50.00")} abaixo do total da compra.` }
    ]);
  });
  it("cada falha sozinha, e a diferença positiva (acima)", () => {
    expect(explicacaoDasParcelas(naoConferem({ falhas: ["soma_diferente_do_liquido"], diferencaSomaLiquido: "12.34" }))?.falhas)
      .toEqual([{ codigo: "soma_diferente_do_liquido", texto: `A soma das duplicatas fica ${brl("12.34")} acima do líquido.` }]);
    expect(explicacaoDasParcelas(naoConferem({ falhas: ["liquido_diferente_do_total"], diferencaLiquidoTotal: "0.50" }))?.falhas)
      .toEqual([{ codigo: "liquido_diferente_do_total", texto: `O líquido fica ${brl("0.50")} acima do total da compra.` }]);
  });
  it("a última parcela não positiva também é explicada", () => {
    expect(explicacaoDasParcelas(naoConferem({ falhas: ["ultima_parcela_nao_positiva"], diferencaSomaLiquido: "0.00", diferencaLiquidoTotal: "0.00" }))?.falhas).toEqual([{
      codigo: "ultima_parcela_nao_positiva",
      texto: "A soma e o líquido conferem com o total, mas a última duplicata, ajustada para a soma fechar no total da compra, ficaria com valor zero ou negativo."
    }]);
  });
  it("falha que a tela não conhece não aparece crua; a diferença ausente não é inventada", () => {
    const e = explicacaoDasParcelas(naoConferem({ falhas: ["falha_futura" as "soma_diferente_do_liquido", "soma_diferente_do_liquido"], diferencaSomaLiquido: undefined }));
    expect(e?.falhas).toEqual([{ codigo: "soma_diferente_do_liquido", texto: "A soma das duplicatas é diferente do líquido." }]);
    expect(JSON.stringify(e)).not.toContain("falha_futura");
  });
});

describe("XML-04 P2 sem_duplicatas: o motivo", () => {
  it("as duplicatas sem vencimento (o leitor as descartou) × a nota sem duplicatas × o motivo ausente (a API anterior)", () => {
    expect(explicacaoDasParcelas({ situacao: "sem_duplicatas", motivo: "duplicata_sem_vencimento" })).toEqual({ resumo: "A nota trouxe duplicatas sem vencimento: a compra usa a condição de pagamento.", numeros: null, falhas: [] });
    const hoje = { resumo: "A nota não traz duplicatas: a compra usa a condição de pagamento.", numeros: null, falhas: [] };
    expect(explicacaoDasParcelas({ situacao: "sem_duplicatas", motivo: "nota_sem_duplicatas" })).toEqual(hoje);
    expect(explicacaoDasParcelas({ situacao: "sem_duplicatas" })).toEqual(hoje);
  });
  it("conferem ⇒ nada a explicar (a tabela das duplicatas é a explicação)", () => {
    expect(explicacaoDasParcelas({ situacao: "conferem", parcelas: [{ numero: "001", vencimento: "2026-11-16", valor: "10.00" }] })).toBeNull();
  });
});

describe("XML-04 P3 a API anterior (sem os campos novos): a soma e o líquido, e nada inventado", () => {
  it("sem total, origem, falhas e diferenças: os dois números que a resposta traz, nenhuma comparação afirmada", () => {
    const e = explicacaoDasParcelas({ situacao: "nao_conferem", soma: SOMA, liquido: LIQUIDO });
    expect(e).toEqual({ resumo: "As duplicatas da nota não conferem: a compra usa a condição de pagamento.", numeros: `Soma das duplicatas: ${brl(SOMA)} · Líquido: ${brl(LIQUIDO)}.`, falhas: [] });
    expect(e?.numeros).not.toContain("Total da compra");
  });
  it("os campos herdados do protótipo não são lidos (só a propriedade própria)", () => {
    const herdado = Object.assign(Object.create({ total: TOTAL, falhas: ["soma_diferente_do_liquido"], origemDoLiquido: "fatura", motivo: "duplicata_sem_vencimento" }) as object,
      { situacao: "nao_conferem", soma: SOMA, liquido: LIQUIDO }) as ParcelasDaNota;
    expect(explicacaoDasParcelas(herdado)).toEqual({ resumo: "As duplicatas da nota não conferem: a compra usa a condição de pagamento.", numeros: `Soma das duplicatas: ${brl(SOMA)} · Líquido: ${brl(LIQUIDO)}.`, falhas: [] });
    const semDup = Object.assign(Object.create({ motivo: "duplicata_sem_vencimento" }) as object, { situacao: "sem_duplicatas" }) as ParcelasDaNota;
    expect(explicacaoDasParcelas(semDup)?.resumo).toBe("A nota não traz duplicatas: a compra usa a condição de pagamento.");
  });
});

describe("XML-04 P4 a explicação do RESULTADO RECALCULADO (o mesmo `parcelasDaNota` que decide o checkbox)", () => {
  // Só o que `parcelasDaNota` lê: as duplicatas, a fatura, o vNF e as descartadas.
  const nota = (o: { duplicatas: string[]; liquido: string | null; vNF: string; descartadas?: number }) => ({
    duplicatas: o.duplicatas.map((valor, k) => ({ numero: String(k + 1).padStart(3, "0"), vencimento: `2026-1${k + 1}-16`, valor })),
    fatura: o.liquido === null ? null : { numero: "1", valorOriginal: o.vNF, desconto: null, liquido: o.liquido },
    totais: { nota: o.vNF }, duplicatasDescartadas: o.descartadas ?? 0
  }) as unknown as NotaFiscalLida;
  it("o cenário da medição (Σ 5700 · vLiq 5979 · total 6029): os três números e as duas diferenças", () => {
    const r = parcelasDaNota(nota({ duplicatas: ["2850.00", "2850.00"], liquido: LIQUIDO, vNF: TOTAL }), TOTAL);
    expect(r.situacao, "premissa: a regra do domínio diz que não conferem").toBe("nao_conferem");
    const e = explicacaoDasParcelas(r);
    expect(e?.numeros).toBe(`Soma das duplicatas: ${brl(SOMA)} · Líquido da fatura (vLiq): ${brl(LIQUIDO)} · Total da compra: ${brl(TOTAL)}.`);
    expect(e?.falhas.map((f) => f.texto)).toEqual([`A soma das duplicatas fica ${brl("279.00")} abaixo do líquido.`, `O líquido fica ${brl("50.00")} abaixo do total da compra.`]);
  });
  it("sem fatura: o líquido é o vNF e a explicação o diz; as duplicatas descartadas por falta de vencimento: o motivo", () => {
    const r = parcelasDaNota(nota({ duplicatas: ["100.00"], liquido: null, vNF: "150.00" }), "150.00");
    expect(explicacaoDasParcelas(r)?.numeros).toContain("Líquido (o total da nota, vNF");
    const s = parcelasDaNota(nota({ duplicatas: [], liquido: null, vNF: "150.00", descartadas: 2 }), "150.00");
    expect(explicacaoDasParcelas(s)?.resumo).toBe("A nota trouxe duplicatas sem vencimento: a compra usa a condição de pagamento.");
  });
});
