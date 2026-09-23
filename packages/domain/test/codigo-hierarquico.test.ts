import { describe, it, expect } from "vitest";
import { larguraDosNiveis, mascaraDoCadastro, validarCodigoHierarquico, proximoCodigoHierarquico, MASCARA_CODIGO_PADRAO } from "../src/codigo-hierarquico.js";

const M = "9.99.999";

describe("máscara", () => {
  it("lê larguras e recusa forma inválida", () => {
    expect(larguraDosNiveis("9.99.999.9999")).toEqual([1, 2, 3, 4]);
    for (const m of ["", "9..9", "99a", "1.01", ".9", "9.", "9999999", "9.9.9.9.9.9.9.9.9"]) expect(larguraDosNiveis(m), m).toBeNull();
  });
  it("máscara do cadastro vem dos parâmetros; ausente ou inválida → padrão", () => {
    expect(mascaraDoCadastro({ mascaras_codigo: { cost_centers: "9.9" } }, "cost_centers")).toBe("9.9");
    expect(mascaraDoCadastro({ mascaras_codigo: { cost_centers: "x" } }, "cost_centers")).toBe(MASCARA_CODIGO_PADRAO);
    expect(mascaraDoCadastro({}, "chart_accounts")).toBe(MASCARA_CODIGO_PADRAO);
    expect(mascaraDoCadastro(null, "chart_accounts")).toBe(MASCARA_CODIGO_PADRAO);
  });
});

describe("validarCodigoHierarquico", () => {
  it("aceita raiz e filho corretos", () => {
    expect(validarCodigoHierarquico("3", M, null)).toBeNull();
    expect(validarCodigoHierarquico("1.01", M, "1")).toBeNull();
    expect(validarCodigoHierarquico("1.01.004", M, "1.01")).toBeNull();
  });
  it("recusa largura errada, nível a mais, raiz com vários níveis e prefixo errado", () => {
    expect(validarCodigoHierarquico("1.1", M, "1")).toMatch(/2º nível .* 2 dígito/);
    expect(validarCodigoHierarquico("1.01.001.1", M, "1.01.001")).toMatch(/mais níveis/);
    expect(validarCodigoHierarquico("1.01", M, null)).toMatch(/Sem antecessor/);
    expect(validarCodigoHierarquico("2.01", M, "1")).toMatch(/começar com o código do antecessor \(1\.\)/);
    expect(validarCodigoHierarquico("1.01.001", M, "1")).toMatch(/um nível a mais/);
    expect(validarCodigoHierarquico("1.0a", M, "1")).toMatch(/dígito/);
  });
});

describe("proximoCodigoHierarquico", () => {
  const existentes = ["1", "1.01", "1.01.001", "1.01.003", "1.02", "2", "10.x"];
  it("próximo abaixo do pai = maior irmão + 1, com zeros", () => {
    expect(proximoCodigoHierarquico("1.01", existentes, M)).toEqual({ codigo: "1.01.004" });
    expect(proximoCodigoHierarquico("1", existentes, M)).toEqual({ codigo: "1.03" });
    expect(proximoCodigoHierarquico("1.02", existentes, M)).toEqual({ codigo: "1.02.001" });
  });
  it("raiz = maior raiz + 1; netos não contam como irmãos", () => {
    expect(proximoCodigoHierarquico(null, existentes, M)).toEqual({ codigo: "3" });
    expect(proximoCodigoHierarquico(null, [], M)).toEqual({ codigo: "1" });
  });
  it("último nível e nível esgotado são erro, não número inventado", () => {
    expect(proximoCodigoHierarquico("1.01.001", existentes, M)).toEqual({ erro: expect.stringMatching(/último nível/) });
    expect(proximoCodigoHierarquico(null, ["9"], M)).toEqual({ erro: expect.stringMatching(/Não há mais códigos/) });
  });
});
