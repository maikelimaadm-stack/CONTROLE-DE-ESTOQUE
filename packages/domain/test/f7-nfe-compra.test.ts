/**
 * OPERACOES-01 F7 (decisão 284) — a conta da compra a partir da nota (fator, unitário, linhas por lote, totais com
 * IPI/ST/seguro, tolerância de R$ 0,01, parcelas e valores não suportados) e os rótulos novos.
 * Cada teste afirma a PREMISSA junto da CONCLUSÃO. XMLs SINTÉTICOS (f7-nfe-sintetica.ts).
 */
import { describe, expect, it } from "vitest";
import {
  CAPACIDADE_IMPORTACAO_XML_COMPRA,
  CONTRATO_CONFERENCIA_IMPORTACAO_NFE,
  TOLERANCIA_TOTAL_DA_NOTA,
  conferirTotalDaNota,
  convertToPrimary,
  documentTotals,
  enumLabel,
  enumOptions,
  lerNotaFiscalEletronica,
  linhasDoItemDaNota,
  normalizarUnidadeDaNota,
  parcelasDaNota,
  pesoDoCustoDeEntrada,
  quantidadeInterna,
  totaisDaCompra,
  unitarioInterno,
  valoresDaLinhaDaNota,
  valoresNaoSuportadosDaNota,
  type ItemDaNota,
  type LinhaDaCompraDaNota,
  type NotaFiscalLida
} from "../src/index.js";
import { D } from "@agro/shared";
import { nfeSintetica, xmlComDuplicatas, xmlComRastro, xmlSimples } from "./f7-nfe-sintetica.js";

function lida(xml: string): NotaFiscalLida {
  const l = lerNotaFiscalEletronica(xml);
  if (!l.ok) throw new Error(JSON.stringify(l.recusas));
  return l.nota;
}
function linhas(r: ReturnType<typeof linhasDoItemDaNota>): LinhaDaCompraDaNota[] {
  if (!r.ok) throw new Error(r.motivo);
  return r.linhas;
}
const somar = (vs: string[]) => vs.reduce((a, v) => a.plus(D(v)), D(0)).toFixed(4);

describe("F7 — contrato e capacidade", () => {
  it("a capacidade e o contrato da conferência são a versão 1; a tolerância é R$ 0,01", () => {
    expect(CAPACIDADE_IMPORTACAO_XML_COMPRA).toBe(1);
    expect(CONTRATO_CONFERENCIA_IMPORTACAO_NFE).toBe(1);
    expect(TOLERANCIA_TOTAL_DA_NOTA).toBe("0.01");
  });

  it("rótulos novos em PT-BR, sem mudar os existentes", () => {
    expect(enumLabel("situacao_importacao_nfe", "gerada")).toBe("Compra gerada");
    expect(enumOptions("situacao_importacao_nfe").map((o) => o.value)).toEqual(["pendente", "gerada", "descartada"]);
    expect(enumLabel("vinculo_item_nfe", "ambiguo")).toBe("Mais de um produto corresponde");
    expect(enumOptions("vinculo_item_nfe").map((o) => o.value)).toEqual(["lembrado", "sugerido", "ambiguo", "nenhum"]);
    expect(enumOptions("classificacao_gasto")).toEqual([{ value: "capex", label: "CAPEX" }, { value: "opex", label: "OPEX" }]);
    expect(enumLabel("origem_importacao_nfe", "dfe")).toBe("DF-e recebida");
    expect(enumLabel("rateio_compra", "documento")).toBe("Natureza e centro do documento");
    expect(enumLabel("tipo_fator_conversao", "divide")).toBe("Divide");
    // os de antes continuam iguais
    expect(enumLabel("classification", "unclassified")).toBe("Não classificado");
    expect(enumLabel("document_type", "nfe")).toBe("NF-e");
  });
});

describe("F7 — fator e unitário (unidade da nota → unidade do produto)", () => {
  it("multiply e divide; 4 casas com ROUND_HALF_EVEN; mesma conta de convertToPrimary", () => {
    expect(quantidadeInterna("10.0000", "12", "multiply")).toBe("120.0000");
    expect(quantidadeInterna("120", "12", "divide")).toBe("10.0000");
    expect(quantidadeInterna("3", "7", "divide")).toBe("0.4286"); // 0.428571…
    expect(quantidadeInterna("0.00005", "1", "multiply")).toBe("0.0000"); // meio → par (0)
    expect(quantidadeInterna("0.00015", "1", "multiply")).toBe("0.0002"); // meio → par (2)
    expect(quantidadeInterna("2.5", "0.5", "divide")).toBe(convertToPrimary("2.5", "divide", "0.5"));
    expect(() => quantidadeInterna("1", "0", "multiply")).toThrow(RangeError);
  });

  it("unitário = vProd ÷ quantidade interna, 6 casas", () => {
    expect(unitarioInterno("1500.00", "120.0000")).toBe("12.500000");
    expect(unitarioInterno("100.00", "3.0000")).toBe("33.333333");
    expect(() => unitarioInterno("1.00", "0.0000")).toThrow(RangeError);
  });

  it("unidade da nota normalizada: maiúsculas, sem espaços nas pontas, até 6 posições", () => {
    expect(normalizarUnidadeDaNota("  cx ")).toBe("CX");
    expect(normalizarUnidadeDaNota("unidade12")).toBe("UNIDAD");
  });
});

describe("F7 — linhas da compra de um item da nota", () => {
  const itemRastro = (): ItemDaNota => lida(xmlComRastro().xml).itens[0]!;

  it("produto com lote: uma linha por lote do rastro, quantidade/vProd/desconto/IPI/ST repartidos na proporção (divisão exata: o mesmo unitário)", () => {
    const item = itemRastro();
    expect(item.rastro.map((r) => r.quantidade)).toEqual(["60.000", "40.000"]); // premissa: 60 + 40 = qCom 100
    // 1 FR da nota = 50 unidades do produto → 5000; unitário 2000 ÷ 5000 = 0,40
    const ls = linhas(linhasDoItemDaNota(item, { produtoId: "p", fator: "50", tipoFator: "multiply", controlaLote: "lote_validade" }));
    expect(ls).toEqual([
      { nItemNota: 1, quantidade: "3000.0000", valorUnitario: "0.400000", desconto: "12.00", lote: "LT-A1", validade: "2027-08-01", ipi: "60.00", icmsSt: "33.00", quantidadeNota: "60.0000" },
      { nItemNota: 1, quantidade: "2000.0000", valorUnitario: "0.400000", desconto: "8.00", lote: "LT-B2", validade: "2027-08-10", ipi: "40.00", icmsSt: "22.00", quantidadeNota: "40.0000" }
    ]);
  });

  it("repartição com resto: as primeiras linhas levam o piso, a ÚLTIMA fecha a soma exata, e cada linha fecha a sua parte do vProd", () => {
    const item: ItemDaNota = { ...itemRastro(), quantidade: "3.0000", valorProdutos: "10.00", desconto: "0.10", ipi: "1.00", icmsSt: "0.05",
      rastro: [{ lote: "A", quantidade: "1", fabricacao: null, validade: null }, { lote: "B", quantidade: "1", fabricacao: null, validade: null },
        { lote: "C", quantidade: "1", fabricacao: null, validade: null }] };
    const ls = linhas(linhasDoItemDaNota(item, { produtoId: "p", fator: "1", tipoFator: "divide", controlaLote: "lote" }));
    expect(ls.map((l) => l.desconto)).toEqual(["0.03", "0.03", "0.04"]);
    expect(ls.map((l) => l.ipi)).toEqual(["0.33", "0.33", "0.34"]);
    expect(ls.map((l) => l.icmsSt)).toEqual(["0.01", "0.01", "0.03"]);
    expect(somar(ls.map((l) => l.quantidade))).toBe("3.0000");
    // vProd 10,00 em três partes (3,33 + 3,33 + 3,34): o unitário é o da PARTE (com 3,333333 nas três a soma daria 9,89)
    expect(ls.map((l) => l.valorUnitario)).toEqual(["3.330000", "3.330000", "3.340000"]);
    expect(totaisDaCompra(ls, { frete: "0", outras: "0", desconto: "0", ipi: "0", icmsSt: "0", seguro: "0" }).valorItens).toBe("9.90"); // 10,00 − 0,10
  });

  it("quantidade grande (150 000 kg a R$ 51 234,56): a linha fecha o vProd — a sobra do unitário de 6 casas vai para o desconto", () => {
    const item: ItemDaNota = { ...lida(xmlSimples().xml).itens[0]!, quantidade: "150000.0000", valorProdutos: "51234.56", desconto: "0.00", ipi: "0.00", icmsSt: "0.00", rastro: [] };
    // premissa: com o unitário de 6 casas (o que a conferência mostra), quantidade × unitário passa do vProd em 0,04
    expect(unitarioInterno(item.valorProdutos, "150000.0000")).toBe("0.341564");
    expect(D("150000").mul("0.341564").toFixed(2)).toBe("51234.60");
    const [l] = linhas(linhasDoItemDaNota(item, { produtoId: "p", fator: "1", tipoFator: "multiply", controlaLote: "nenhum" }));
    expect(l).toMatchObject({ quantidade: "150000.0000", valorUnitario: "0.341564", desconto: "0.04" });
    const t = totaisDaCompra([l!], { frete: "0", outras: "0", desconto: "0", ipi: "0", icmsSt: "0", seguro: "0" });
    expect(t.total).toBe("51234.56");
    expect(conferirTotalDaNota(t.total, "51234.56")).toEqual({ confere: true, diferenca: "0.00" });
  });

  it("valoresDaLinhaDaNota: fecha valor − desconto em todo caso, inclusive o empate no meio centavo (o unitário sobe 0,000001)", () => {
    // 15 000 × 0,000069 = 1,035: sobra 0,005 exata — piso dá 1,04 e teto dá 1,02 (bancário); o unitário sobe para 0,000070
    expect(D("1.03").div("15000").toDecimalPlaces(6, 0).toFixed(6)).toBe("0.000069"); // premissa: o arredondamento para cima
    expect(valoresDaLinhaDaNota("15000", "1.03", "0")).toEqual({ valorUnitario: "0.000070", desconto: "0.02" });
    for (const [q, v, d] of [["15000", "1.03", "0"], ["3", "10.00", "0.10"], ["150000.0000", "51234.56", "12.34"], ["0.0001", "0.01", "0"], ["7", "0.00", "0.00"], ["123.4567", "98765.43", "0.01"]] as const) {
      const r = valoresDaLinhaDaNota(q, v, d);
      expect(D(r.desconto).gte(d), `desconto ${q}/${v}`).toBe(true);
      expect(totaisDaCompra([{ quantidade: q, valorUnitario: r.valorUnitario, desconto: r.desconto }], { frete: "0", outras: "0", desconto: "0", ipi: "0", icmsSt: "0", seguro: "0" }).valorItens,
        `linha ${q}/${v}/${d}`).toBe(D(v).minus(d).toFixed(2));
    }
    expect(() => valoresDaLinhaDaNota("1", "1.00", "1.01")).toThrow("Desconto maior que o valor do item");
  });

  it("Σ qLote ≠ qCom → rastro_diferente_da_quantidade", () => {
    const item = { ...itemRastro(), quantidade: "101.0000" };
    expect(item.rastro.reduce((a, r) => a + Number(r.quantidade), 0)).toBe(100); // premissa
    expect(linhasDoItemDaNota(item, { produtoId: "p", fator: "1", tipoFator: "multiply", controlaLote: "lote" })).toEqual({ ok: false, motivo: "rastro_diferente_da_quantidade" });
  });

  it("com rastro, lote ou validade no corpo → lote_com_rastro", () => {
    const d = { produtoId: "p", fator: "1", tipoFator: "multiply" as const, controlaLote: "lote" as const };
    expect(linhasDoItemDaNota(itemRastro(), { ...d, lote: "MEU" })).toEqual({ ok: false, motivo: "lote_com_rastro" });
    expect(linhasDoItemDaNota(itemRastro(), { ...d, validade: "2027-01-01" })).toEqual({ ok: false, motivo: "lote_com_rastro" });
  });

  it("produto SEM controle de lote: uma linha só, rastro ignorado", () => {
    const item = itemRastro();
    expect(item.rastro).toHaveLength(2); // premissa
    expect(linhas(linhasDoItemDaNota(item, { produtoId: "p", fator: "1", tipoFator: "multiply", controlaLote: "nenhum", lote: "IGNORADO" }))).toEqual([
      { nItemNota: 1, quantidade: "100.0000", valorUnitario: "20.000000", desconto: "20.00", lote: null, validade: null, ipi: "100.00", icmsSt: "55.00", quantidadeNota: "100.0000" }
    ]);
  });

  it("produto com lote e nota SEM rastro: o lote do corpo é obrigatório e vai para a linha", () => {
    const item = lida(xmlSimples().xml).itens[0]!;
    expect(item.rastro).toEqual([]); // premissa
    const d = { produtoId: "p", fator: "12", tipoFator: "multiply" as const, controlaLote: "lote_validade" as const };
    expect(linhasDoItemDaNota(item, d)).toEqual({ ok: false, motivo: "lote_obrigatorio" });
    expect(linhasDoItemDaNota(item, { ...d, lote: "  " })).toEqual({ ok: false, motivo: "lote_obrigatorio" });
    expect(linhas(linhasDoItemDaNota(item, { ...d, lote: " L-9 ", validade: "2027-03-31" }))).toEqual([
      { nItemNota: 1, quantidade: "120.0000", valorUnitario: "12.500000", desconto: "0.00", lote: "L-9", validade: "2027-03-31", ipi: "0.00", icmsSt: "0.00", quantidadeNota: "10.0000" }
    ]);
  });

  it("conversão que zera a quantidade → quantidade_invalida", () => {
    const item: ItemDaNota = { ...lida(xmlSimples().xml).itens[0]!, quantidade: "0.0001" };
    expect(linhasDoItemDaNota(item, { produtoId: "p", fator: "1000", tipoFator: "divide", controlaLote: "nenhum" })).toEqual({ ok: false, motivo: "quantidade_invalida" });
  });
});

describe("F7 — total da compra e conferência com o vNF", () => {
  it("total = itens − descontos + frete + outras − desconto + IPI + ICMS-ST + seguro; bate com o vNF do XML com rastro", () => {
    const n = lida(xmlComRastro().xml);
    const ls = linhas(linhasDoItemDaNota(n.itens[0]!, { produtoId: "p", fator: "50", tipoFator: "multiply", controlaLote: "lote" }));
    const t = totaisDaCompra(ls, { frete: n.totais.frete, outras: n.totais.outras, desconto: "0", ipi: n.totais.ipi, icmsSt: n.totais.icmsSt, seguro: n.totais.seguro });
    expect(t).toEqual({ valorItens: "1980.00", total: "2145.00" }); // 2000 − 20 + 10 + 100 + 55
    expect(conferirTotalDaNota(t.total, n.totais.nota)).toEqual({ confere: true, diferenca: "0.00" });
  });

  it("sem IPI, ST e seguro (zeros) o total é o de hoje (documentTotals), inclusive com desconto %", () => {
    const itens = [{ quantidade: "3", valorUnitario: "10.333333", desconto: "1.00", descontoPercentual: "10" }, { quantidade: "1", valorUnitario: "5", desconto: "0" }];
    const hoje = documentTotals(itens.map((i) => ({ quantity: i.quantidade, unitPrice: i.valorUnitario, discount: i.desconto, discountPercent: i.descontoPercentual })),
      { freight: "7.00", otherValues: "2.00", discount: "3.00" });
    const novo = totaisDaCompra(itens, { frete: "7.00", outras: "2.00", desconto: "3.00", ipi: "0", icmsSt: "0", seguro: "0" });
    expect(novo).toEqual({ valorItens: hoje.subtotal, total: hoje.total });
    expect(totaisDaCompra(itens, { frete: "7.00", outras: "2.00", desconto: "3.00", ipi: "1.10", icmsSt: "2.20", seguro: "0.30" }).total)
      .toBe(D(hoje.total).plus("3.60").toFixed(2));
  });

  it("tolerância: diferença de 0,01 passa (nos dois sentidos), 0,02 não", () => {
    expect(conferirTotalDaNota("100.01", "100.00")).toEqual({ confere: true, diferenca: "0.01" });
    expect(conferirTotalDaNota("99.99", "100.00")).toEqual({ confere: true, diferenca: "-0.01" });
    expect(conferirTotalDaNota("100.02", "100.00")).toEqual({ confere: false, diferenca: "0.02" });
    expect(conferirTotalDaNota("99.98", "100.00")).toEqual({ confere: false, diferenca: "-0.02" });
  });

  it("peso do custo de entrada = valor do item + IPI + ST do item (sem eles, o valor de hoje)", () => {
    expect(pesoDoCustoDeEntrada({ valorTotal: "1980.00", ipi: "100.00", icmsSt: "55.00" })).toBe("2135.00");
    expect(pesoDoCustoDeEntrada({ valorTotal: "10.50", ipi: null, icmsSt: null })).toBe("10.50");
  });
});

describe("F7 — parcelas da nota", () => {
  it("duplicatas que somam o líquido e o líquido = total da compra → conferem", () => {
    const n = lida(xmlComDuplicatas().xml);
    expect(n.fatura?.liquido).toBe("1540.00"); // premissa: 770 + 770 = líquido = vNF
    expect(parcelasDaNota(n, "1540.00")).toEqual({ situacao: "conferem", parcelas: n.duplicatas });
  });

  it("dentro da tolerância, a ÚLTIMA parcela absorve o centavo e a soma vira EXATAMENTE o total", () => {
    const n = lida(xmlComDuplicatas().xml);
    const r = parcelasDaNota(n, "1540.01");
    expect(r).toEqual({ situacao: "conferem", parcelas: [
      { numero: "001", vencimento: "2026-10-15", valor: "770.00" },
      { numero: "002", vencimento: "2026-11-15", valor: "770.01" }
    ] });
    expect(n.duplicatas[1]!.valor).toBe("770.00"); // a nota lida não foi alterada
  });

  it("duplicatas que não somam o líquido, ou líquido diferente do total → nao_conferem (a pessoa usa a condição)", () => {
    const x = nfeSintetica({ duplicatas: [{ numero: "1", vencimento: "2026-10-01", valor: "700.00" }, { numero: "2", vencimento: "2026-11-01", valor: "700.00" }] });
    expect(x.vNF).toBe("1500.00"); // premissa: 1400 ≠ 1500
    expect(parcelasDaNota(lida(x.xml), "1500.00")).toEqual({ situacao: "nao_conferem", soma: "1400.00", liquido: "1500.00" });
    expect(parcelasDaNota(lida(xmlComDuplicatas().xml), "1540.02")).toEqual({ situacao: "nao_conferem", soma: "1540.00", liquido: "1540.00" });
  });

  it("o líquido é o da fatura quando ela traz vLiq (e não o vNF)", () => {
    const x = nfeSintetica({ fatura: { numero: "9", original: "1500.00", desconto: "100.00", liquido: "1400.00" },
      duplicatas: [{ numero: "1", vencimento: "2026-10-01", valor: "1400.00" }] });
    const n = lida(x.xml);
    expect(n.totais.nota).toBe("1500.00"); // premissa: vNF 1500, líquido 1400
    expect(parcelasDaNota(n, "1500.00")).toEqual({ situacao: "nao_conferem", soma: "1400.00", liquido: "1400.00" });
    expect(parcelasDaNota(n, "1400.00")).toEqual({ situacao: "conferem", parcelas: [{ numero: "1", vencimento: "2026-10-01", valor: "1400.00" }] });
  });

  it("sem duplicatas → sem_duplicatas", () => {
    const n = lida(xmlSimples().xml);
    expect(n.duplicatas).toEqual([]);
    expect(parcelasDaNota(n, n.totais.nota)).toEqual({ situacao: "sem_duplicatas" });
  });
});

describe("F7 — valores que a compra não representa", () => {
  it("II, ICMS desonerado e IPI devolvido diferentes de zero viram a lista que bloqueia", () => {
    expect(valoresNaoSuportadosDaNota(lida(xmlSimples().xml))).toEqual([]);
    const x = nfeSintetica({ totais: { ii: "1.00", icmsDesonerado: "2.00", ipiDevolvido: "3.00" } });
    const n = lida(x.xml);
    expect([n.totais.ii, n.totais.icmsDesonerado, n.totais.ipiDevolvido]).toEqual(["1.00", "2.00", "3.00"]); // premissa
    expect(valoresNaoSuportadosDaNota(n)).toEqual(["ii", "icms_desonerado", "ipi_devolvido"]);
    expect(valoresNaoSuportadosDaNota(lida(nfeSintetica({ totais: { ipiDevolvido: "0.50" } }).xml))).toEqual(["ipi_devolvido"]);
  });
});
