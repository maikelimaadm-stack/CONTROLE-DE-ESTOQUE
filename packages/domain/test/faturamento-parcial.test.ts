import { describe, it, expect } from "vitest";
import { D } from "@agro/shared";
import {
  calcularParte, itensCanonicosDaParte, itensDoSaldoInteiro, saldoDoItem, validarItensDaParte,
  destinosOperacaoIguais, lerDestinosOperacao, especieNaFrase,
  type ItemDeOrigem, type ValoresDoCabecalho,
} from "../src/index.js";

/** TOP-CONFIG-06 (decisão 265) — as contas de uma conversão em partes. Pura: nenhuma E/S. */
const ZERO: ValoresDoCabecalho = { freight: "0.00", freightIcms: "0.00", otherValues: "0.00", discount: "0.00", entrada: "0.00" };
const item = (id: string, quantity: string, extra: Partial<ItemDeOrigem> = {}): ItemDeOrigem => ({
  id, productId: `p-${id}`, quantity, unitPrice: "10.00", discount: "0.00", discountPercent: "0", faturado: "0", descontoAlocado: "0.00", ...extra,
});
const soma = (xs: string[]) => xs.reduce((a, x) => a + Number(x), 0);

describe("FP-D1 saldo e validação dos itens", () => {
  it("saldo = quantidade − faturado; nunca negativo", () => {
    expect(saldoDoItem({ quantity: "10", faturado: "4" })).toBe("6.0000");
    expect(saldoDoItem({ quantity: "10", faturado: "12" })).toBe("0.0000");
  });
  it("recusa: vazio, item de fora, repetido, quantidade inválida, acima do saldo", () => {
    const o = [item("a", "10", { faturado: "4" }), item("b", "2")];
    expect(validarItensDaParte(o, [])).toEqual({ ok: false, recusas: [{ motivo: "sem_itens" }] });
    const r = validarItensDaParte(o, [
      { itemId: "x", quantidade: "1" }, { itemId: "a", quantidade: "7" }, { itemId: "b", quantidade: "0" },
    ]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.recusas.map((x) => x.motivo)).toEqual(["item_desconhecido", "acima_do_saldo", "quantidade_invalida"]);
    const rep = validarItensDaParte(o, [{ itemId: "b", quantidade: "1" }, { itemId: "b", quantidade: "1" }]);
    expect(rep.ok ? [] : rep.recusas.map((x) => x.motivo)).toEqual(["item_repetido"]);
    const casas = validarItensDaParte(o, [{ itemId: "b", quantidade: "1.12345" }]);
    expect(casas.ok).toBe(false);
  });
  it("aceita no limite do saldo, normaliza a quantidade e segue a ordem da origem", () => {
    const o = [item("a", "10", { faturado: "4" }), item("b", "2")];
    expect(validarItensDaParte(o, [{ itemId: "b", quantidade: "2" }, { itemId: "a", quantidade: "6" }]))
      .toEqual({ ok: true, itens: [{ itemId: "a", quantidade: "6.0000" }, { itemId: "b", quantidade: "2.0000" }] });
  });
  it("saldo inteiro: só itens com saldo; chave canônica independe de ordem e de grafia", () => {
    const o = [item("a", "10", { faturado: "10" }), item("b", "2", { faturado: "0.5" })];
    expect(itensDoSaldoInteiro(o)).toEqual([{ itemId: "b", quantidade: "1.5000" }]);
    expect(itensCanonicosDaParte([{ itemId: "b", quantidade: "4" }, { itemId: "a", quantidade: "1.50" }]))
      .toEqual(itensCanonicosDaParte([{ itemId: "a", quantidade: "1.5" }, { itemId: "b", quantidade: "4.0000" }]));
    expect(itensCanonicosDaParte(undefined)).toBeNull();
  });
});

describe("FP-D2 contas proporcionais, com o resto na última parte", () => {
  it("frete 100 em três partes iguais → 33,33 · 33,33 · 33,34", () => {
    const cab = { ...ZERO, freight: "100.00" };
    const partes: string[] = [];
    let faturado = 0; let alocado = 0;
    for (let n = 0; n < 3; n++) {
      const o = [item("a", "3", { faturado: String(faturado) })];
      const r = calcularParte(o, cab, { ...ZERO, freight: alocado.toFixed(2) }, [{ itemId: "a", quantidade: "1" }]);
      partes.push(r.cabecalho.freight);
      expect(r.zeraOSaldo).toBe(n === 2);
      faturado += 1; alocado += Number(r.cabecalho.freight);
    }
    expect(partes).toEqual(["33.33", "33.33", "33.34"]);
    expect(soma(partes)).toBeCloseTo(100, 10);
  });
  it("desconto em valor do item: proporcional à quantidade, e a parte que zera o item leva o resto", () => {
    const base = { discount: "10.00" };
    const p1 = calcularParte([item("a", "3", base)], ZERO, ZERO, [{ itemId: "a", quantidade: "1" }]);
    expect(p1.itens[0]).toMatchObject({ origemItemId: "a", quantity: "1.0000", unitPrice: "10.00", discount: "3.33" });
    const p2 = calcularParte([item("a", "3", { ...base, faturado: "1", descontoAlocado: "3.33" })], ZERO, ZERO, [{ itemId: "a", quantidade: "1" }]);
    expect(p2.itens[0]!.discount).toBe("3.33");
    const p3 = calcularParte([item("a", "3", { ...base, faturado: "2", descontoAlocado: "6.66" })], ZERO, ZERO, [{ itemId: "a", quantidade: "1" }]);
    expect(p3.itens[0]!.discount).toBe("3.34");
  });
  it("cabeçalho proporcional ao VALOR dos itens da parte; desconto % e preço vêm da origem", () => {
    const o = [item("a", "1", { unitPrice: "30.00" }), item("b", "1", { unitPrice: "70.00", discountPercent: "10" })];
    const cab = { freight: "10.00", freightIcms: "1.00", otherValues: "5.00", discount: "4.00", entrada: "20.00" };
    const r = calcularParte(o, cab, ZERO, [{ itemId: "a", quantidade: "1" }]);   // 30 de 93 (70 − 10%)
    expect(r.itens).toHaveLength(1);
    expect(r.cabecalho).toEqual({ freight: "3.23", freightIcms: "0.32", otherValues: "1.61", discount: "1.29", entrada: "6.45" });
    const resto = calcularParte([o[0]!, { ...o[1]! }].map((x, i) => i === 0 ? { ...x, faturado: "1" } : x), cab, r.cabecalho, [{ itemId: "b", quantidade: "1" }]);
    expect(resto.zeraOSaldo).toBe(true);
    expect(resto.itens[0]).toMatchObject({ discountPercent: "10", unitPrice: "70.00" });
    expect(resto.cabecalho).toEqual({ freight: "6.77", freightIcms: "0.68", otherValues: "3.39", discount: "2.71", entrada: "13.55" });
  });
});

describe("FP-D3 a aresta declara 'Em partes'", () => {
  it("aceita booleano, recusa outro tipo, e ausente fica ausente (a API preserva)", () => {
    const id = "00000000-0000-4000-8000-000000000001";
    expect(lerDestinosOperacao([{ tipoOperacaoId: id, ordem: 0, emPartes: true }])).toEqual({ ok: true, valor: [{ tipoOperacaoId: id, ordem: 0, emPartes: true }] });
    expect(lerDestinosOperacao([{ tipoOperacaoId: id, ordem: 0 }])).toEqual({ ok: true, valor: [{ tipoOperacaoId: id, ordem: 0 }] });
    const r = lerDestinosOperacao([{ tipoOperacaoId: id, ordem: 0, emPartes: "sim" }]);
    expect(r.ok ? [] : r.recusas.map((x) => x.motivo)).toEqual(["em_partes_invalido"]);
  });
  it("mudar só o 'Em partes' é outra política; ausente conta como falso", () => {
    const id = "00000000-0000-4000-8000-000000000001";
    expect(destinosOperacaoIguais([{ tipoOperacaoId: id, ordem: 0, emPartes: true }], [{ tipoOperacaoId: id, ordem: 0, emPartes: false }])).toBe(false);
    expect(destinosOperacaoIguais([{ tipoOperacaoId: id, ordem: 0 }], [{ tipoOperacaoId: id, ordem: 0, emPartes: false }])).toBe(true);
  });
});

/** Soma EXATA (decimal, sem float) de valores com 2 casas. */
const somaExata = (xs: string[]) => xs.reduce((a, x) => a.plus(x), D(0)).toFixed(2);

describe("FP-D4 nenhuma parte leva mais do que ainda falta (centavos em muitas partes)", () => {
  it("desconto de 0,12 num item de 20 un, faturado de 1 em 1 → soma EXATAMENTE 0,12 e nenhuma parte negativa", () => {
    const partes: string[] = [];
    let faturado = D(0); let alocado = D(0);
    for (let n = 0; n < 20; n++) {
      const o = [item("a", "20", { discount: "0.12", faturado: faturado.toFixed(4), descontoAlocado: alocado.toFixed(2) })];
      const r = calcularParte(o, ZERO, ZERO, [{ itemId: "a", quantidade: "1" }]);
      expect(r.zeraOSaldo).toBe(n === 19);
      const d = r.itens[0]!.discount;
      partes.push(d);
      faturado = faturado.plus(1); alocado = alocado.plus(d);
    }
    expect(partes.filter((x) => D(x).lt(0))).toEqual([]);
    expect(somaExata(partes)).toBe("0.12");
    // As primeiras esgotam o valor (0,006 → 0,01) e as seguintes levam zero; a última leva o resto, que é 0.
    expect(partes.slice(0, 12)).toEqual(Array(12).fill("0.01"));
    expect(partes.slice(12)).toEqual(Array(8).fill("0.00"));
  });

  it("frete, ICMS do frete, outros, desconto do cabeçalho e entrada de centavos em 20 partes → soma EXATA da origem, nenhuma negativa", () => {
    const cab: ValoresDoCabecalho = { freight: "0.12", freightIcms: "0.05", otherValues: "0.07", discount: "0.12", entrada: "0.19" };
    const chaves = Object.keys(cab) as (keyof ValoresDoCabecalho)[];
    const partes: ValoresDoCabecalho[] = [];
    let faturado = D(0);
    for (let n = 0; n < 20; n++) {
      const jaAlocado = Object.fromEntries(chaves.map((k) => [k, somaExata(partes.map((p) => p[k]))])) as unknown as ValoresDoCabecalho;
      const r = calcularParte([item("a", "20", { faturado: faturado.toFixed(4) })], cab, jaAlocado, [{ itemId: "a", quantidade: "1" }]);
      expect(r.zeraOSaldo).toBe(n === 19);
      partes.push(r.cabecalho);
      faturado = faturado.plus(1);
    }
    for (const k of chaves) {
      expect(partes.filter((p) => D(p[k]).lt(0)).map((p) => p[k]), k).toEqual([]);
      expect(somaExata(partes.map((p) => p[k])), k).toBe(cab[k]);
    }
    expect(partes.slice(0, 12).map((p) => p.freight)).toEqual(Array(12).fill("0.01"));
  });

  it("origem zero → toda parte leva zero; o que já foi levado além da origem não vira resto negativo", () => {
    const zerada = calcularParte([item("a", "3")], ZERO, ZERO, [{ itemId: "a", quantidade: "3" }]);
    expect([zerada.itens[0]!.discount, zerada.cabecalho]).toEqual(["0.00", ZERO]);
    const excedida = calcularParte([item("a", "3", { discount: "0.10", faturado: "2", descontoAlocado: "0.20" })], { ...ZERO, freight: "1.00" }, { ...ZERO, freight: "1.50" },
      [{ itemId: "a", quantidade: "1" }]);
    expect([excedida.itens[0]!.discount, excedida.cabecalho.freight]).toEqual(["0.00", "0.00"]);
  });
});

describe("FP-D5 a espécie do documento nas frases da parte", () => {
  it("o nome vem do rótulo de sales_kind; o artigo segue o gênero; espécie sem rótulo vira 'documento'", () => {
    expect(especieNaFrase("budget")).toEqual({ do: "do orçamento", deste: "deste orçamento", este: "este orçamento" });
    expect(especieNaFrase("order")).toEqual({ do: "do pedido", deste: "deste pedido", este: "este pedido" });
    expect(especieNaFrase("sale")).toEqual({ do: "da venda", deste: "desta venda", este: "esta venda" });
    expect(especieNaFrase("purchase").do).toBe("do documento");
    expect(especieNaFrase(null).do).toBe("do documento");
  });
});
