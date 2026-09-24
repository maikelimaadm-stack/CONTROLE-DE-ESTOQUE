import { describe, it, expect } from "vitest";
import { normalizarDocumento, validarCpf, validarCnpj, validarDocumento, formatarCnpj, cnpjAlfanumerico } from "../src/documento.js";

/**
 * RF-3 — DOCUMENTO (CADASTROS Fase 3). CNPJ alfanumérico pela IN RFB 2.229/2024 (valor = ASCII − 48, pesos
 * 5..2,9..2 e 6..2,9..2, resto 0/1 → 0). O exemplo 12.ABC.345/01DE-35 é o publicado pela Receita.
 */
describe("RF-3 documento: normalização", () => {
  it("tira pontuação e espaço e passa para maiúsculas", () => {
    expect(normalizarDocumento(" 12.abc.345/01de-35 ")).toBe("12ABC34501DE35");
    expect(normalizarDocumento("529.982.247-25")).toBe("52998224725");
  });
});

describe("RF-3 documento: CNPJ alfanumérico", () => {
  it("o exemplo oficial é válido, alfanumérico e formata 00.000.000/0000-00", () => {
    expect(validarCnpj("12.ABC.345/01DE-35")).toBe(true);
    expect(cnpjAlfanumerico("12ABC34501DE35")).toBe(true);
    expect(formatarCnpj("12abc34501de35")).toBe("12.ABC.345/01DE-35");
    expect(validarDocumento("12abc34501de35")).toEqual({ valido: true, tipo: "cnpj", normalizado: "12ABC34501DE35", formatado: "12.ABC.345/01DE-35", alfanumerico: true });
  });
  it("DV errado é recusado (cada um dos dois dígitos)", () => {
    expect(validarCnpj("12ABC34501DE36")).toBe(false);
    expect(validarCnpj("12ABC34501DE45")).toBe(false);
  });
  it("letra nas posições do DV e caractere fora de [0-9A-Z] são recusados", () => {
    expect(validarCnpj("12ABC34501DEA5")).toBe(false);
    expect(validarCnpj("12ABC34501D*35")).toBe(false);
    expect(validarCnpj("12ABC34501DE3")).toBe(false);
  });
});

describe("RF-3 documento: CNPJ e CPF numéricos", () => {
  it("válidos", () => {
    expect(validarCnpj("00.000.000/0001-91")).toBe(true);
    expect(validarCnpj("11222333000181")).toBe(true);
    expect(validarCpf("529.982.247-25")).toBe(true);
    expect(validarDocumento("52998224725")).toMatchObject({ valido: true, tipo: "cpf", formatado: "529.982.247-25" });
  });
  it("inválidos (DV) e tamanho errado", () => {
    expect(validarCnpj("11222333000182")).toBe(false);
    expect(validarCpf("52998224726")).toBe(false);
    expect(validarDocumento("123")).toMatchObject({ valido: false });
  });
  it("sequências repetidas são recusadas mesmo quando a conta fecharia", () => {
    for (const d of ["00000000000000", "11111111111111", "AAAAAAAAAAAAAA"]) expect(validarCnpj(d)).toBe(false);
    for (const d of ["00000000000", "11111111111", "99999999999"]) expect(validarCpf(d)).toBe(false);
  });
});
