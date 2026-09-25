import { describe, it, expect } from "vitest";
import path from "node:path";
import { FATIAS, decidir, migrationsNaArvore, valorDaVariavel } from "../../../../scripts/lib/fichas-cadastro.mjs";

/**
 * A PROVA DE SKEW DOS CADASTROS DA #62 TAMBÉM EXPIRA SOZINHA: enquanto a base não tem a migration de uma fatia,
 * o sentido 1 cobra que a base RECUSA o corpo novo; quando a fatia está na base, a medição troca o ramo sem
 * ninguém mexer, e o sentido 1 passa a cobrar que a base ACEITA e grava o corpo novo. Aqui ficam as metades:
 * ausente, presente, e "detector quebrado reprova" (assinatura fora do HEAD, número reaproveitado, base vazia).
 */
const RAIZ = path.resolve(__dirname, "../../../..");
const ASSINATURAS = Object.values(FATIAS).map((f) => f.migration);
const ANTERIORES = ["0001_foundation.sql", "0024_venda_classificacao_financeira.sql"];

describe("decisão das fichas de cadastro da base (version skew)", () => {
  it("base sem nenhuma das migrations: mundo legado em todas as fatias", () => {
    const d = decidir({ daBase: ANTERIORES, doHead: [...ANTERIORES, ...ASSINATURAS] });
    expect(Object.values(d.fatias)).toEqual([false, false, false, false]);
    expect(valorDaVariavel(d.fatias)).toBe("");
  });
  it("base com as quatro: mundo atual em todas, e a variável lista as chaves em ordem", () => {
    const d = decidir({ daBase: [...ANTERIORES, ...ASSINATURAS], doHead: [...ANTERIORES, ...ASSINATURAS] });
    expect(Object.values(d.fatias)).toEqual([true, true, true, true]);
    expect(valorDaVariavel(d.fatias)).toBe("fichaParceiro,fichaProduto,grupoArvore,rhFuncionarios");
  });
  it("cada fatia é medida pela SUA migration, não pela vizinha", () => {
    const d = decidir({ daBase: [...ANTERIORES, FATIAS.grupoArvore.migration], doHead: [...ANTERIORES, ...ASSINATURAS] });
    expect(d.fatias).toEqual({ grupoArvore: true, fichaParceiro: false, rhFuncionarios: false, fichaProduto: false });
  });
  it("base sem migration nenhuma é leitura quebrada: REPROVA em vez de escolher o legado", () => {
    expect(() => decidir({ daBase: [], doHead: ASSINATURAS })).toThrow(/leitura quebrada/);
  });
  it("assinatura ausente deste HEAD (migration renomeada): REPROVA", () => {
    expect(() => decidir({ daBase: ANTERIORES, doHead: ASSINATURAS.slice(1) })).toThrow(/não existe neste HEAD/);
  });
  it("o número da migration com OUTRO nome na base: REPROVA — a presença do nome deixou de responder", () => {
    expect(() => decidir({ daBase: [...ANTERIORES, "0025_outra_coisa.sql"], doHead: ASSINATURAS })).toThrow(/numeração foi reaproveitada/);
    expect(() => decidir({ daBase: [...ANTERIORES, FATIAS.grupoArvore.migration, "0025_outra_coisa.sql"], doHead: ASSINATURAS })).toThrow(/numeração foi reaproveitada/);
  });
  it("a árvore deste HEAD tem as quatro assinaturas (o detector está vivo)", () => {
    const d = decidir({ daBase: migrationsNaArvore(RAIZ), doHead: migrationsNaArvore(RAIZ) });
    expect(Object.values(d.fatias)).toEqual([true, true, true, true]);
  });
});
