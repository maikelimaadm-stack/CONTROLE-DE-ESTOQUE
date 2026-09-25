import { describe, it, expect } from "vitest";
import { getResource } from "../src/resources/index.js";
import { REFERENCIAS_DE_BUSCA, getReferencia, rotuloDaReferencia, formatarNcm, semAcento } from "../src/resources/referencias.js";

describe("RF-2 buscas de referência: rótulo e normalização", () => {
  it("rótulos no formato combinado", () => {
    expect(rotuloDaReferencia("municipios", { codigo: 1709500, nome: "Gurupi", extra: "TO" })).toBe("1709500 · Gurupi - TO");
    expect(rotuloDaReferencia("bancos", { codigo: "001", nome: "Banco do Brasil S.A." })).toBe("001 · Banco do Brasil S.A.");
    expect(rotuloDaReferencia("municipios", { codigo: 5106752, nome: "Pontes e Lacerda", extra: "MT" })).toBe("5106752 · Pontes e Lacerda - MT");
    expect(rotuloDaReferencia("ncm", { codigo: "01022110", nome: "Bovinos - Reprodutores de raça pura - Prenhes" })).toBe("0102.21.10 - Bovinos - Reprodutores de raça pura - Prenhes");
    expect(rotuloDaReferencia("cbo", { codigo: "622005", nome: "Caseiro (agricultura)" })).toBe("622005 - Caseiro (agricultura)");
    expect(formatarNcm("01022110")).toBe("0102.21.10");
  });
  it("sem acento e sem caixa", () => { expect(semAcento("São Paulo")).toBe("sao paulo"); expect(semAcento("GOIÂNIA")).toBe("goiania"); });
  it("whitelist estática: quatro chaves, colunas identificadores simples, e só NCM tem recorte de escolha", () => {
    expect(REFERENCIAS_DE_BUSCA.map((r) => r.chave)).toEqual(["municipios", "bancos", "ncm", "cbo"]);
    for (const r of REFERENCIAS_DE_BUSCA) for (const c of [r.tabela, r.colunaCodigo, r.colunaNome, r.colunaExtra ?? "x"]) expect(c).toMatch(/^[a-z_][a-z0-9_]*$/);
    expect(getReferencia("ncm")!.escolhivel).toContain("nivel = 8");
    expect(getReferencia("../people")).toBeUndefined();
  });
});

describe("RF-6 formulários de hoje usam as buscas (mesmo código gravado)", () => {
  const campo = (rec: string, nome: string) => getResource(rec)!.fields.find((f) => f.name === nome)!;
  it("cidade da pessoa → Município (continua inteiro: código IBGE)", () => { expect(campo("people", "city_id").busca).toBe("municipios"); expect(campo("people", "city_id").type).toBe("integer"); });
  it("banco da pessoa → Banco", () => expect(campo("people", "bank_code").busca).toBe("bancos"));
  it("NCM do produto → NCM", () => expect(campo("products", "ncm_code").busca).toBe("ncm"));
});
