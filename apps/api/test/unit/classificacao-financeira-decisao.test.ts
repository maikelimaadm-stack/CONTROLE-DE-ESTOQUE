import { describe, it, expect } from "vitest";
import path from "node:path";
import { decidir, ocorrenciasNaArvore, ocorrenciasNoTexto } from "../../../../scripts/lib/classificacao-financeira.mjs";

/**
 * A PROVA DE SKEW DA VENDAS-A1 TAMBÉM EXPIRA SOZINHA: enquanto a base não declara a capacidade, o sentido 1
 * cobra que o web esconde e NÃO envia a classificação; quando a fatia estiver na base, a medição troca o
 * ramo sem ninguém mexer. Aqui ficam as três metades: 0, 1 e "qualquer outro número reprova".
 */
const RAIZ = path.resolve(__dirname, "../../../..");

describe("decisão da capacidade de classificação financeira da base (version skew)", () => {
  it("base sem a declaração: mundo legado", () => expect(decidir({ ocorrencias: 0 }).declara).toBe(false));
  it("base com a declaração exatamente uma vez: mundo atual", () => expect(decidir({ ocorrencias: 1 }).declara).toBe(true));
  it("número ambíguo REPROVA em vez de escolher um ramo", () => expect(() => decidir({ ocorrencias: 2 })).toThrow());
  it("a assinatura casa a declaração, não qualquer menção ao nome", () => {
    expect(ocorrenciasNoTexto("        capacidades: { classificacaoFinanceira: CAPACIDADE_CLASSIFICACAO_FINANCEIRA },")).toBe(1);
    for (const ruido of ["// capacidades de classificacaoFinanceira", "dados.capacidades.classificacaoFinanceira === 1", "classificacaoFinanceira: { origem }"]) expect(ocorrenciasNoTexto(ruido)).toBe(0);
  });
  it("a árvore deste HEAD declara (exatamente uma vez)", () => expect(ocorrenciasNaArvore(RAIZ)).toBe(1));
});
