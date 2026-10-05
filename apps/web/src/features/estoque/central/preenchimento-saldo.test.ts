/**
 * HOTFIX CI LT-K1 — contrato puro do preenchimento Saldo → Central.
 *
 * Reverso: se a URL perder o lote, se o item inicial nascer sem provider_lot, ou se o
 * efeito limpar o lote antes do controle ser conhecido, estes casos quebram.
 */
import { describe, expect, it } from "vitest";
import {
  forcarColunaDeLoteNaAbertura,
  itensIniciaisDoPreenchimento,
  loteAposControleDoProduto,
  preenchimentoDaUrlDeEstoque,
  rotaDoAjusteAPartirDoSaldo
} from "./preenchimento-saldo";

describe("rotaDoAjusteAPartirDoSaldo + preenchimentoDaUrlDeEstoque", () => {
  it("propaga empresa, armazém, produto e lote da linha do Saldo na URL e de volta", () => {
    const rota = rotaDoAjusteAPartirDoSaldo({
      empresa_id: "E",
      warehouse_id: "W",
      product_id: "P",
      provider_lot: "L"
    });
    expect(rota).toBe("/estoque/movimentacoes/ajustes/new?empresa_id=E&armazem_id=W&produto_id=P&lote=L");
    const params = new URLSearchParams(rota.split("?")[1]);
    expect(preenchimentoDaUrlDeEstoque(params)).toEqual({
      empresa_id: "E",
      armazem_id: "W",
      produto_id: "P",
      lote: "L"
    });
  });

  it("saldo sem lote não afirma lote na URL", () => {
    const rota = rotaDoAjusteAPartirDoSaldo({
      empresa_id: "E",
      warehouse_id: "W",
      product_id: "P",
      provider_lot: ""
    });
    expect(rota).toBe("/estoque/movimentacoes/ajustes/new?empresa_id=E&armazem_id=W&produto_id=P");
    expect(preenchimentoDaUrlDeEstoque(new URLSearchParams(rota.split("?")[1])).lote).toBeUndefined();
  });
});

describe("itensIniciaisDoPreenchimento", () => {
  it("item inicial traz product_id e provider_lot do preenchimento (espécie ajuste)", () => {
    const itens = itensIniciaisDoPreenchimento(
      { produto_id: "P", lote: "L", armazem_id: "W" },
      "W"
    );
    expect(itens).toHaveLength(1);
    expect(itens[0]).toMatchObject({
      product_id: "P",
      provider_lot: "L",
      warehouse_id: "W",
      quantity: "",
      generate_stock: true
    });
  });

  it("sem produto na URL → nenhum item", () => {
    expect(itensIniciaisDoPreenchimento({ lote: "L" }, "W")).toEqual([]);
  });
});

describe("loteAposControleDoProduto", () => {
  it("enquanto o controle é desconhecido, preserva o lote da linha", () => {
    expect(loteAposControleDoProduto("LTK1", { conhecido: false, lote: false })).toBe("LTK1");
  });

  it("produto com lote: preserva", () => {
    expect(loteAposControleDoProduto("LTK1", { conhecido: true, lote: true })).toBe("LTK1");
  });

  it("produto sem controle de lote: zera (fail-closed — não inventa/mantém indevido)", () => {
    expect(loteAposControleDoProduto("LTK1", { conhecido: true, lote: false })).toBe("");
  });
});

describe("forcarColunaDeLoteNaAbertura", () => {
  it("lote já na linha força a coluna mesmo com pede=false (leitura pendente)", () => {
    expect(forcarColunaDeLoteNaAbertura(
      "lote",
      [{ product_id: "P", provider_lot: "L" }],
      () => false
    )).toBe(true);
  });

  it("sem lote na linha e pede=false → não força", () => {
    expect(forcarColunaDeLoteNaAbertura(
      "lote",
      [{ product_id: "P", provider_lot: "" }],
      () => false
    )).toBe(false);
  });

  it("pede=true força mesmo sem valor prévio", () => {
    expect(forcarColunaDeLoteNaAbertura(
      "lote",
      [{ product_id: "P" }],
      () => true
    )).toBe(true);
  });
});
