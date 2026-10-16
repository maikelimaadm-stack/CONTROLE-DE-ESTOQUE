import { describe, expect, it } from "vitest";
import { situacaoCancelavel } from "./cancelar-na-lista";

describe("situacaoCancelavel — Cancelar na lista de documentos de compra", () => {
  it("compra: aberto e confirmado", () => {
    expect(situacaoCancelavel("compra", "aberto")).toBe(true);
    expect(situacaoCancelavel("compra", "confirmado")).toBe(true);
    expect(situacaoCancelavel("compra", "cancelado")).toBe(false);
  });

  it("pedido: aberto e finalizado; convertido não", () => {
    expect(situacaoCancelavel("pedido", "aberto")).toBe(true);
    expect(situacaoCancelavel("pedido", "finalizado")).toBe(true);
    expect(situacaoCancelavel("pedido", "convertido")).toBe(false);
    expect(situacaoCancelavel("pedido", "cancelado")).toBe(false);
  });

  it("orçamento: só aberto", () => {
    expect(situacaoCancelavel("orcamento", "aberto")).toBe(true);
    expect(situacaoCancelavel("orcamento", "escolhido")).toBe(false);
    expect(situacaoCancelavel("orcamento", "nao_escolhido")).toBe(false);
    expect(situacaoCancelavel("orcamento", "cancelado")).toBe(false);
  });

  it("espécie desconhecida: fail-closed", () => {
    expect(situacaoCancelavel("outra", "aberto")).toBe(false);
  });
});
