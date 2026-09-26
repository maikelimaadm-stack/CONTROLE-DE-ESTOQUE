import { describe, it, expect } from "vitest";
import path from "node:path";
import fs from "node:fs";
import { decidir, ocorrenciasNaArvore, ocorrenciasNoTexto } from "../../../../scripts/lib/condicao-pagamento.mjs";
import { ocorrenciasNoTexto as ocorrenciasDaA1 } from "../../../../scripts/lib/classificacao-financeira.mjs";
import { CAMINHO_CAPACIDADES, ocorrenciasNaOrdem, ocorrenciasNoTexto as ocorrenciasDaA31 } from "../../../../scripts/lib/layout-documento.mjs";

/**
 * A PROVA DE SKEW DA VENDAS-A4 TAMBÉM EXPIRA SOZINHA: enquanto a base não declara a condição de pagamento,
 * CP-K1 cobra que o web esconde e NÃO envia o campo; quando a fatia estiver na base, a medição troca o ramo
 * sem ninguém mexer. Gêmeo de `classificacao-financeira-decisao.test.ts`.
 */
const RAIZ = path.resolve(__dirname, "../../../..");
const SEM = "        capacidades: { classificacaoFinanceira: CAPACIDADE_CLASSIFICACAO_FINANCEIRA },";
const COM = "        capacidades: { classificacaoFinanceira: CAPACIDADE_CLASSIFICACAO_FINANCEIRA, condicaoPagamento: CAPACIDADE_CONDICAO_PAGAMENTO },";
const INVERTIDA = "        capacidades: { condicaoPagamento: CAPACIDADE_CONDICAO_PAGAMENTO, classificacaoFinanceira: CAPACIDADE_CLASSIFICACAO_FINANCEIRA },";

describe("decisão da capacidade de condição de pagamento da base (version skew)", () => {
  it("base sem a declaração: mundo legado", () => expect(decidir({ ocorrencias: 0 }).declara).toBe(false));
  it("base com a declaração exatamente uma vez: mundo atual", () => expect(decidir({ ocorrencias: 1 }).declara).toBe(true));
  it("número ambíguo REPROVA em vez de escolher um ramo", () => expect(() => decidir({ ocorrencias: 2 })).toThrow());
  it("a declaração da base atual (sem a chave) conta zero; a do HEAD (com a chave) conta um", () => {
    expect(ocorrenciasNoTexto(SEM)).toBe(0);
    expect(ocorrenciasNoTexto(COM)).toBe(1);
  });
  it("a assinatura casa a declaração, não qualquer menção ao nome", () => {
    for (const ruido of [
      "// capacidades de condicaoPagamento",
      "dados.capacidades.condicaoPagamento === 1",
      "condicaoPagamento: { origem }",
      "capacidades: { execucao: { condicaoPagamento: 1 } }",
    ]) expect(ocorrenciasNoTexto(ruido), ruido).toBe(0);
  });
  it("a ordem é guardada pela A1: com condicaoPagamento ANTES, a assinatura da A1 conta zero", () => {
    expect(ocorrenciasDaA1(COM)).toBe(1);
    expect(ocorrenciasDaA1(INVERTIDA)).toBe(0);
    expect(ocorrenciasNoTexto(INVERTIDA)).toBe(1);
  });
  it("a árvore deste HEAD declara (exatamente uma vez)", () => expect(ocorrenciasNaArvore(RAIZ)).toBe(1));
  // VENDAS-A3-1: `layoutDocumento` só entra DEPOIS de `condicaoPagamento`. Declarado antes, este teste fica
  // vermelho — a mesma guarda de ordem que a A1 exerce sobre a primeira chave.
  it("na árvore deste HEAD, o layoutDocumento (se declarado) vem depois da condicaoPagamento", () => {
    const texto = fs.readFileSync(path.join(RAIZ, CAMINHO_CAPACIDADES), "utf8");
    expect(ocorrenciasNaOrdem(texto), "layoutDocumento declarado fora da ordem prevista").toBe(ocorrenciasDaA31(texto));
  });
});
