import { describe, it, expect } from "vitest";
import { formatarMascara, normalizarMascara, formatarCep, formatarTelefone, mascaraDoTipoDePessoa, recusaDoDigitoDoDocumento, textoEhCep, validarCnpj } from "../src/documento.js";

/** B-3 / B-4 — máscaras de entrada: mostra formatado, grava normalizado, colar com pontuação funciona. */
describe("B-3 máscaras: formato completo", () => {
  it("CPF 000.000.000-00", () => { expect(formatarMascara("cpf", "52998224725")).toBe("529.982.247-25"); });
  it("CNPJ numérico 00.000.000/0000-00", () => { expect(formatarMascara("cnpj", "11222333000181")).toBe("11.222.333/0001-81"); });
  it("CNPJ alfanumérico em maiúsculas, DV numérico", () => {
    expect(formatarMascara("cnpj", "12abc34501de35")).toBe("12.ABC.345/01DE-35");
    expect(validarCnpj(normalizarMascara("cnpj", "12.abc.345/01de-35"))).toBe(true);
  });
  it("CEP 00000-000", () => { expect(formatarCep("78250000")).toBe("78250-000"); });
  it("telefone fixo e celular", () => {
    expect(formatarTelefone("6532221234")).toBe("(65) 3222-1234");
    expect(formatarTelefone("65999887766")).toBe("(65) 99988-7766");
  });
});

describe("B-3 máscaras: progressivo, colar e normalizar", () => {
  it("formata parcial sem pontuação sobrando", () => {
    expect(formatarMascara("cpf", "529")).toBe("529");
    expect(formatarMascara("cpf", "5299")).toBe("529.9");
    expect(formatarMascara("cnpj", "11222")).toBe("11.222");
    expect(formatarMascara("cep", "78250")).toBe("78250");
    expect(formatarMascara("telefone", "65")).toBe("(65");
    expect(formatarMascara("telefone", "653")).toBe("(65) 3");
    expect(formatarMascara("cpf", "")).toBe("");
  });
  it("colar com pontuação grava normalizado e corta no tamanho", () => {
    expect(normalizarMascara("cpf", "529.982.247-25")).toBe("52998224725");
    expect(normalizarMascara("cpf", "529.982.247-2599")).toBe("52998224725");
    expect(normalizarMascara("cnpj", "11.222.333/0001-81")).toBe("11222333000181");
    expect(normalizarMascara("cep", "78.250-000")).toBe("78250000");
    expect(normalizarMascara("telefone", "+(65) 99988-7766")).toBe("65999887766");
  });
  it("CNPJ: letra nas posições do DV é descartada; caractere fora de [0-9A-Z] some", () => {
    expect(normalizarMascara("cnpj", "12ABC34501DEA35")).toBe("12ABC34501DE35");
    expect(normalizarMascara("cnpj", "12*ABC")).toBe("12ABC");
  });
});

describe("B-4 documento pelo tipo de pessoa e DV ao sair", () => {
  it("máscara segue o tipo; Estrangeira e desconhecido ficam sem máscara", () => {
    expect(mascaraDoTipoDePessoa("natural")).toBe("cpf");
    expect(mascaraDoTipoDePessoa("legal")).toBe("cnpj");
    expect(mascaraDoTipoDePessoa("foreign")).toBeNull();
    expect(mascaraDoTipoDePessoa("xyz")).toBeNull();
  });
  it("DV: válido → null; errado → mensagem; vazio → null", () => {
    expect(recusaDoDigitoDoDocumento("cpf", "529.982.247-25")).toBeNull();
    expect(recusaDoDigitoDoDocumento("cpf", "529.982.247-26")).toBe("CPF inválido");
    expect(recusaDoDigitoDoDocumento("cnpj", "11.222.333/0001-81")).toBeNull();
    expect(recusaDoDigitoDoDocumento("cnpj", "11.222.333/0001-82")).toBe("CNPJ inválido");
    expect(recusaDoDigitoDoDocumento("cnpj", "")).toBeNull();
  });
  it("texto é CEP: 8 dígitos com ou sem hífen", () => {
    expect(textoEhCep("78250-000")).toBe(true);
    expect(textoEhCep("78250000")).toBe(true);
    expect(textoEhCep("5106752")).toBe(false);
    expect(textoEhCep("pontes")).toBe(false);
  });
});
