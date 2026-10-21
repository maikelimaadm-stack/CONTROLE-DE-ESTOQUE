import { describe, it, expect } from "vitest";
import { RESOURCES, getResource } from "@agro/domain";
import { botoesDoAtualizar, cadastroAceitaAtualizar, ehRecusaDeParametro, juntarFatias, nomeDoModelo, resumoDaAtualizacao, textoDoProgresso, urlDaImportacao, urlDoModelo } from "./importacao-acao";

/** IMPORTAR-01 (decisão 317) — as contas puras da escolha da ação no diálogo de importação. */
describe("IMPORTAR-01 · a ação no diálogo", () => {
  it("W1: o CRIAR sai EXATAMENTE como antes (sem `acao`); só o ATUALIZAR leva `acao=atualizar`", () => {
    expect(urlDaImportacao("products", true, "tudo", "criar")).toBe("/api/imports/products?simular=1");
    expect(urlDaImportacao("products", false, "tudo", "criar")).toBe("/api/imports/products?simular=0");
    expect(urlDaImportacao("products", false, "parcial", "criar")).toBe("/api/imports/products?simular=0&modo=parcial");
    expect(urlDaImportacao("products", true, "tudo", "atualizar")).toBe("/api/imports/products?simular=1&acao=atualizar");
    expect(urlDaImportacao("products", false, "parcial", "atualizar")).toBe("/api/imports/products?simular=0&modo=parcial&acao=atualizar");
    expect(urlDaImportacao("products", true, "tudo", "criar", { offset: 0, limit: 100 })).toBe("/api/imports/products?simular=1&offset=0&limit=100");
    expect([urlDoModelo("products", "criar"), nomeDoModelo("products", "criar")]).toEqual(["/api/imports/products/modelo", "modelo-products.xlsx"]);
    expect([urlDoModelo("products", "atualizar"), nomeDoModelo("products", "atualizar")]).toEqual(["/api/imports/products/modelo?acao=atualizar", "modelo-products-atualizar.xlsx"]);
  });

  it("W6: juntar fatias soma contagens e preserva erros; progresso mostra o intervalo", () => {
    const j = juntarFatias([
      { linhas: 100, gravadas: 0, certas: 100, com_erro: 0, erros: [], linhas_arquivo: 250 },
      { linhas: 100, gravadas: 0, certas: 98, com_erro: 2, erros: [{ linha: 150, coluna: "Nome", mensagem: "x" }, { linha: 151, coluna: null, mensagem: "y" }], linhas_arquivo: 250 },
      { linhas: 50, gravadas: 0, certas: 50, com_erro: 0, erros: [], linhas_arquivo: 250 },
    ]);
    expect(j).toMatchObject({ linhas: 250, certas: 248, com_erro: 2, gravadas: 0 });
    expect(j.erros).toHaveLength(2);
    expect(textoDoProgresso("conferir", 100, 250)).toBe("Conferindo linhas 1–100 de 250…");
    expect(textoDoProgresso("gravar", 250, 250)).toBe("Importando linhas 1–250 de 250…");
  });

  it("W2: o ATUALIZAR aparece nos 6 cadastros importáveis com código (products entre eles), nunca nos 4 sem código nem fora da importação", () => {
    expect(RESOURCES.filter((r) => cadastroAceitaAtualizar(r)).map((r) => r.key).sort()).toEqual(["chart_accounts", "cost_centers", "financial_categories", "people", "product_groups", "products"]);
    for (const k of ["measurement_units", "addressings", "warehouses", "cultivations"]) expect(cadastroAceitaAtualizar(getResource(k)), k).toBe(false);
    expect(cadastroAceitaAtualizar(undefined)).toBe(false);
  });

  it("W3: a recusa da API anterior é o 422 'Campo não reconhecido' — e só ele", () => {
    expect(ehRecusaDeParametro({ error: { code: "VALIDATION_ERROR", message: "Dados inválidos", details: [{ path: "", message: "Campo não reconhecido" }] } })).toBe(true);
    expect(ehRecusaDeParametro({ error: { code: "VALIDATION_ERROR", message: "acao: Opção inválida", details: [{ path: "acao", message: "Opção inválida" }] } })).toBe(false);
    expect(ehRecusaDeParametro({ error: { code: "PERMISSION_DENIED", message: "Sem permissão: products.edit" } })).toBe(false);
    expect(ehRecusaDeParametro({})).toBe(false);
  });

  it("W4: a prévia do ATUALIZAR só vale com a forma do ATUALIZAR — resposta do CRIAR (ou malformada) não vira contagem", () => {
    const ok = { acao: "atualizar", casaram: 2, nao_casaram: 1, sem_alteracao: 1, alteracoes: [{ linha: 2, codigo: "00009", colunas: ["Marca", "Local de estoque padrão"] }] };
    expect(resumoDaAtualizacao(ok)).toEqual({ casaram: 2, naoCasaram: 1, mudam: 1, semAlteracao: 1, alteracoes: ok.alteracoes });
    expect(resumoDaAtualizacao({ linhas: 1, gravadas: 0, erros: [], certas: 1 }), "a resposta do CRIAR").toBeNull();
    expect(resumoDaAtualizacao({ ...ok, acao: "criar" })).toBeNull();
    expect(resumoDaAtualizacao({ ...ok, casaram: "2" })).toBeNull();
    expect(resumoDaAtualizacao({ ...ok, nao_casaram: -1 })).toBeNull();
    expect(resumoDaAtualizacao({ ...ok, alteracoes: [{ linha: 2, codigo: "x", colunas: [1] }] })).toBeNull();
    expect(resumoDaAtualizacao({ ...ok, alteracoes: undefined })).toBeNull();
  });

  it("W5: gravar só com algo a mudar — sem erro: 'Atualizar N'; com erro e certas: o parcial; nada muda: nenhum botão", () => {
    const r = resumoDaAtualizacao({ acao: "atualizar", casaram: 2, nao_casaram: 0, sem_alteracao: 1, alteracoes: [{ linha: 2, codigo: "1", colunas: ["Marca"] }] });
    expect(botoesDoAtualizar(r, 0, 2)).toEqual({ tudo: true, parcial: false });
    expect(botoesDoAtualizar(r, 1, 2)).toEqual({ tudo: false, parcial: true });
    expect(botoesDoAtualizar(r, 2, 0)).toEqual({ tudo: false, parcial: false });
    const nada = resumoDaAtualizacao({ acao: "atualizar", casaram: 1, nao_casaram: 0, sem_alteracao: 1, alteracoes: [] });
    expect(botoesDoAtualizar(nada, 0, 1)).toEqual({ tudo: false, parcial: false });
    expect(botoesDoAtualizar(null, 0, 1)).toEqual({ tudo: false, parcial: false });
  });
});
