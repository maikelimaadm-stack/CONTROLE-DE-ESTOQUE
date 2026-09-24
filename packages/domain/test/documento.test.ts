import { describe, it, expect } from "vitest";
import { normalizarDocumento, validarCpf, validarCnpj, validarDocumento, formatarCnpj, cnpjAlfanumerico, recusaDoTipoDePessoa, MSG_FISICA_USA_CPF, MSG_JURIDICA_USA_CNPJ } from "../src/documento.js";

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

/**
 * DOC-0 — tipo de pessoa × documento (decisão 253, R1-6): Física usa CPF, Jurídica usa CNPJ (inclusive o
 * alfanumérico), Estrangeira é livre, tipo desconhecido nega. A largura é a do documento NORMALIZADO.
 */
describe("DOC-0 tipo de pessoa × documento", () => {
  it("Física: CPF (com ou sem pontuação) passa; CNPJ numérico ou alfanumérico → 'Pessoa física usa CPF'", () => {
    expect(recusaDoTipoDePessoa("natural", "529.982.247-25")).toBeNull();
    expect(recusaDoTipoDePessoa("natural", "52998224725")).toBeNull();
    expect(recusaDoTipoDePessoa("natural", "00.000.000/0001-91")).toBe(MSG_FISICA_USA_CPF);
    expect(recusaDoTipoDePessoa("natural", "12.ABC.345/01DE-35")).toBe(MSG_FISICA_USA_CPF);
    expect(MSG_FISICA_USA_CPF).toBe("Pessoa física usa CPF");
  });
  it("Jurídica: CNPJ numérico e alfanumérico passam; CPF (inclusive o formatado de 14 caracteres) → 'Pessoa jurídica usa CNPJ'", () => {
    expect(recusaDoTipoDePessoa("legal", "00.000.000/0001-91")).toBeNull();
    expect(recusaDoTipoDePessoa("legal", "12abc34501de35")).toBeNull();
    // o caso do acervo de produção: 14 caracteres com pontuação que são um CPF formatado
    expect("529.982.247-25").toHaveLength(14);
    expect(recusaDoTipoDePessoa("legal", "529.982.247-25")).toBe(MSG_JURIDICA_USA_CNPJ);
    expect(MSG_JURIDICA_USA_CNPJ).toBe("Pessoa jurídica usa CNPJ");
  });
  it("Estrangeira é livre; tipo desconhecido nega", () => {
    for (const d of ["529.982.247-25", "00000000000191", "AR-20-12345678-9", "x"]) expect(recusaDoTipoDePessoa("foreign", d)).toBeNull();
    expect(recusaDoTipoDePessoa("marciano", "52998224725")).toBe("Tipo de pessoa inválido");
    expect(recusaDoTipoDePessoa("", "00000000000191")).toBe("Tipo de pessoa inválido");
  });
});
