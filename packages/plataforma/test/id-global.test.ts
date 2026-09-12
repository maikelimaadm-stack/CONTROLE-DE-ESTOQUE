import { describe, it, expect } from "vitest";
import {
  colunaDiscriminadora, formatarIdGlobal, interpretarIdGlobal, resolverRegistroDaEntidade,
  tabelaTecnica, validarEntidadesIdGlobal, variantesDeclaradas, type EntidadeIdGlobal
} from "../src/id-global.js";

/**
 * MECANISMO, NÃO CATÁLOGO. Aqui se prova o comportamento neutro de nicho: elegibilidade técnica, formato do
 * número, resolução conjunta de rota+permissão e fail-closed. O catálogo de entidades deste produto (e a sua
 * consistência com o dicionário de dados) é testado em packages/domain/test/id-global.test.ts.
 */
const ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const fixa = (): EntidadeIdGlobal => ({
  tipoEntidade: "documentos", rotulo: "Documento", modulo: "exemplo", tabela: "erp.documentos",
  colunaEmpresa: "empresa_id", exclusaoLogica: true, resolucao: { tipo: "fixa", rota: "/exemplo/documentos/:id", permissao: "documentos.view" }
});
const comVariantes = (): EntidadeIdGlobal => ({
  tipoEntidade: "titulos", rotulo: "Título", modulo: "exemplo", tabela: "erp.titulos",
  colunaEmpresa: "empresa_id", exclusaoLogica: true,
  resolucao: { tipo: "variante", coluna: "sentido", variantes: {
    a_pagar: { rota: "/exemplo/a-pagar/:id", permissao: "a_pagar.view" },
    a_receber: { rota: "/exemplo/a-receber/:id", permissao: "a_receber.view" }
  } }
});

describe("elegibilidade técnica (sem conhecer o produto)", () => {
  it("linhas sem identidade própria nunca são elegíveis", () => {
    for (const t of ["pedido_items", "nota_lines", "title_apportionments", "member_empresas", "role_permissions"]) {
      expect(tabelaTecnica(`erp.${t}`).tecnica, t).toBe(true);
    }
  });
  it("infraestrutura interna não é elegível; tabela de negócio é", () => {
    for (const t of ["code_sequences", "sequencias_id_global", "registros_globais", "idempotency_keys", "audit_logs"]) {
      expect(tabelaTecnica(`erp.${t}`).tecnica, t).toBe(true);
    }
    expect(tabelaTecnica("erp.documentos").tecnica).toBe(false);
  });
});

describe("formato do ID Global", () => {
  it("exibe com # e aceita as duas grafias na leitura", () => {
    expect(formatarIdGlobal(55)).toBe("#55");
    expect(formatarIdGlobal("#55")).toBe("#55");
    expect(interpretarIdGlobal("#55")).toBe(55);
    expect(interpretarIdGlobal(" 55 ")).toBe(55);
    expect(interpretarIdGlobal(55)).toBe(55);
  });
  it("recusa entrada inválida sem lançar", () => {
    for (const v of ["", "#", "abc", "#0", "-3", "1.5", "#12a", null, undefined, {}]) expect(interpretarIdGlobal(v as unknown), String(v)).toBeNull();
  });
});

describe("rota e permissão vêm do MESMO registro", () => {
  it("entidade fixa resolve sem discriminador", () => {
    expect(resolverRegistroDaEntidade(fixa(), ID)).toEqual({ rota: `/exemplo/documentos/${ID}`, permissao: "documentos.view" });
    expect(colunaDiscriminadora(fixa())).toBeNull();
  });
  it("entidade com variantes resolve rota e permissão juntas, da mesma coluna", () => {
    const e = comVariantes();
    expect(colunaDiscriminadora(e)).toBe("sentido");
    expect(variantesDeclaradas(e).sort()).toEqual(["a_pagar", "a_receber"]);
    expect(resolverRegistroDaEntidade(e, ID, { sentido: "a_pagar" })).toEqual({ rota: `/exemplo/a-pagar/${ID}`, permissao: "a_pagar.view" });
    expect(resolverRegistroDaEntidade(e, ID, { sentido: "a_receber" })).toEqual({ rota: `/exemplo/a-receber/${ID}`, permissao: "a_receber.view" });
  });
  it("FAIL-CLOSED: discriminador ausente, nulo ou desconhecido NEGA (nunca permissão mais ampla)", () => {
    const e = comVariantes();
    expect(resolverRegistroDaEntidade(e, ID)).toBeNull();
    expect(resolverRegistroDaEntidade(e, ID, { sentido: null })).toBeNull();
    expect(resolverRegistroDaEntidade(e, ID, { sentido: "outro" })).toBeNull();
    expect(resolverRegistroDaEntidade(e, ID, { sentido: 7 })).toBeNull();
  });
});

describe("validação de catálogo", () => {
  it("catálogo íntegro não acusa problema", () => {
    expect(validarEntidadesIdGlobal([fixa(), comVariantes()])).toEqual([]);
  });
  it("acusa duplicidade, tabela técnica, rota sem :id, permissão inválida e variantes com permissão única", () => {
    const problemas = validarEntidadesIdGlobal([
      fixa(), fixa(),
      { ...fixa(), tipoEntidade: "itens", tabela: "erp.documento_items" },
      { ...fixa(), tipoEntidade: "rota_ruim", tabela: "erp.a", resolucao: { tipo: "fixa", rota: "/sem-id", permissao: "X.view" } },
      { ...comVariantes(), tipoEntidade: "iguais", tabela: "erp.b", resolucao: { tipo: "variante", coluna: "sentido", variantes: {
        a: { rota: "/a/:id", permissao: "mesma.view" }, b: { rota: "/b/:id", permissao: "mesma.view" } } } }
    ]);
    expect(problemas.some((p) => /duplicado/.test(p))).toBe(true);
    expect(problemas.some((p) => /item de documento/.test(p))).toBe(true);
    expect(problemas.some((p) => /rota canônica inválida/.test(p))).toBe(true);
    expect(problemas.some((p) => /permissão inválida/.test(p))).toBe(true);
    expect(problemas.some((p) => /mesma permissão/.test(p))).toBe(true);
  });
});
