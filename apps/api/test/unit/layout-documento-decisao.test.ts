import { describe, it, expect } from "vitest";
import path from "node:path";
import { decidir, ocorrenciasNaArvore, ocorrenciasNaOrdem, ocorrenciasNoTexto } from "../../../../scripts/lib/layout-documento.mjs";
import { ocorrenciasNoTexto as ocorrenciasDaA1 } from "../../../../scripts/lib/classificacao-financeira.mjs";
import { ocorrenciasNoTexto as ocorrenciasDaA4 } from "../../../../scripts/lib/condicao-pagamento.mjs";

/**
 * A PROVA DE SKEW DA VENDAS-A3-1 TAMBÉM EXPIRA SOZINHA: enquanto a base não declara o layout do documento,
 * LD-K1 cobra que o web NÃO pede `/layout-efetivo` e que o documento nasce como hoje; quando a fatia estiver na
 * base, a medição troca o ramo sem ninguém mexer. Gêmeo de `condicao-pagamento-decisao.test.ts`.
 */
const RAIZ = path.resolve(__dirname, "../../../..");
const SEM = "        capacidades: { classificacaoFinanceira: CAPACIDADE_CLASSIFICACAO_FINANCEIRA, condicaoPagamento: CAPACIDADE_CONDICAO_PAGAMENTO },";
const COM = "        capacidades: { classificacaoFinanceira: CAPACIDADE_CLASSIFICACAO_FINANCEIRA, condicaoPagamento: CAPACIDADE_CONDICAO_PAGAMENTO, layoutDocumento: CAPACIDADE_LAYOUT_DOCUMENTO },";
const INVERTIDA = "        capacidades: { classificacaoFinanceira: CAPACIDADE_CLASSIFICACAO_FINANCEIRA, layoutDocumento: CAPACIDADE_LAYOUT_DOCUMENTO, condicaoPagamento: CAPACIDADE_CONDICAO_PAGAMENTO },";

describe("decisão da capacidade de layout do documento da base (version skew)", () => {
  it("base sem a declaração: mundo legado", () => expect(decidir({ ocorrencias: 0 }).declara).toBe(false));
  it("base com a declaração exatamente uma vez: mundo atual", () => expect(decidir({ ocorrencias: 1 }).declara).toBe(true));
  it("número ambíguo REPROVA em vez de escolher um ramo", () => expect(() => decidir({ ocorrencias: 2 })).toThrow());
  it("a declaração da base atual (sem a chave) conta zero; a prevista (com a chave) conta um", () => {
    expect(ocorrenciasNoTexto(SEM)).toBe(0);
    expect(ocorrenciasNoTexto(COM)).toBe(1);
    // a declaração prevista não quebra as assinaturas anteriores
    expect(ocorrenciasDaA1(COM)).toBe(1);
    expect(ocorrenciasDaA4(COM)).toBe(1);
  });
  it("a assinatura casa a declaração, não qualquer menção ao nome", () => {
    for (const ruido of [
      "// capacidades de layoutDocumento",
      "dados.capacidades.layoutDocumento === 1",
      "layoutDocumento: { origem }",
      "capacidades: { execucao: { layoutDocumento: 1 } }",
    ]) expect(ocorrenciasNoTexto(ruido), ruido).toBe(0);
  });
  it("a ordem é guardada: com layoutDocumento ANTES de condicaoPagamento, a assinatura de ordem conta zero", () => {
    expect(ocorrenciasNaOrdem(COM)).toBe(1);
    expect(ocorrenciasNaOrdem(INVERTIDA)).toBe(0);
    expect(ocorrenciasNoTexto(INVERTIDA)).toBe(1);
  });
  it("a árvore deste HEAD declara exatamente uma vez", () => expect(ocorrenciasNaArvore(RAIZ)).toBe(1));
});
