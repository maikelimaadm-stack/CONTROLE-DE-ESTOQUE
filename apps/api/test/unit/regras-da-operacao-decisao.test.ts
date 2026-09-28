import { describe, it, expect } from "vitest";
import path from "node:path";
import { readFileSync } from "node:fs";
import { CAMINHO_CAPACIDADES, decidir, ocorrenciasNaArvore, ocorrenciasNaOrdem, ocorrenciasNoTexto } from "../../../../scripts/lib/regras-da-operacao.mjs";
import { ocorrenciasNoTexto as ocorrenciasDaA1 } from "../../../../scripts/lib/classificacao-financeira.mjs";
import { ocorrenciasNoTexto as ocorrenciasDaA4 } from "../../../../scripts/lib/condicao-pagamento.mjs";
import { ocorrenciasNaOrdem as ordemDaA31, ocorrenciasNoTexto as ocorrenciasDaA31 } from "../../../../scripts/lib/layout-documento.mjs";

/**
 * A PROVA DE SKEW DA TOP-CONFIG-05 TAMBÉM EXPIRA SOZINHA: enquanto a base não declara as regras da operação,
 * RO-K1 cobra que o web NÃO pede `/regras-da-operacao` nem `/situacao-cliente` e que o documento nasce como hoje;
 * quando a fatia estiver na base, a medição troca o ramo sem ninguém mexer. Gêmeo de `layout-documento-decisao.test.ts`.
 */
const RAIZ = path.resolve(__dirname, "../../../..");
const SEM = "        capacidades: { classificacaoFinanceira: CAPACIDADE_CLASSIFICACAO_FINANCEIRA, condicaoPagamento: CAPACIDADE_CONDICAO_PAGAMENTO, layoutDocumento: CAPACIDADE_LAYOUT_DOCUMENTO },";
const COM = "        capacidades: { classificacaoFinanceira: CAPACIDADE_CLASSIFICACAO_FINANCEIRA, condicaoPagamento: CAPACIDADE_CONDICAO_PAGAMENTO, layoutDocumento: CAPACIDADE_LAYOUT_DOCUMENTO, regrasDaOperacao: CAPACIDADE_REGRAS_DA_OPERACAO },";
const INVERTIDA = "        capacidades: { classificacaoFinanceira: CAPACIDADE_CLASSIFICACAO_FINANCEIRA, condicaoPagamento: CAPACIDADE_CONDICAO_PAGAMENTO, regrasDaOperacao: CAPACIDADE_REGRAS_DA_OPERACAO, layoutDocumento: CAPACIDADE_LAYOUT_DOCUMENTO },";

describe("decisão da capacidade de regras da operação da base (version skew)", () => {
  it("base sem a declaração: mundo legado", () => expect(decidir({ ocorrencias: 0 }).declara).toBe(false));
  it("base com a declaração exatamente uma vez: mundo atual", () => expect(decidir({ ocorrencias: 1 }).declara).toBe(true));
  it("número ambíguo REPROVA em vez de escolher um ramo", () => {
    expect(() => decidir({ ocorrencias: 2 })).toThrow();
    expect(() => decidir({ ocorrencias: -1 })).toThrow();
  });
  it("a declaração da base atual (sem a chave) conta zero; a prevista (com a chave) conta um", () => {
    expect(ocorrenciasNoTexto(SEM)).toBe(0);
    expect(ocorrenciasNoTexto(COM)).toBe(1);
    // a declaração prevista não quebra as assinaturas anteriores (A1, A4 e A3-1, inclusive a ordem da A3-1)
    expect(ocorrenciasDaA1(COM)).toBe(1);
    expect(ocorrenciasDaA4(COM)).toBe(1);
    expect(ocorrenciasDaA31(COM)).toBe(1);
    expect(ordemDaA31(COM)).toBe(1);
  });
  it("a assinatura casa a declaração, não qualquer menção ao nome", () => {
    for (const ruido of [
      "// capacidades de regrasDaOperacao",
      "dados.capacidades.regrasDaOperacao === 1",
      "regrasDaOperacao: { formato }",
      "capacidades: { execucao: { regrasDaOperacao: 1 } }",
    ]) expect(ocorrenciasNoTexto(ruido), ruido).toBe(0);
  });
  it("a ordem é guardada: com regrasDaOperacao ANTES de layoutDocumento, a assinatura de ordem conta zero", () => {
    expect(ocorrenciasNaOrdem(COM)).toBe(1);
    expect(ocorrenciasNaOrdem(INVERTIDA)).toBe(0);
    expect(ocorrenciasNoTexto(INVERTIDA)).toBe(1);
  });
  // TOP-CONFIG-05: `regrasDaOperacao` só entra DEPOIS de `layoutDocumento`. Declarada antes, este teste fica vermelho.
  it("na árvore deste HEAD, regrasDaOperacao (se declarada) vem depois de layoutDocumento", () => {
    const texto = readFileSync(path.join(RAIZ, CAMINHO_CAPACIDADES), "utf8");
    expect(ocorrenciasNaOrdem(texto), "regrasDaOperacao declarada fora da ordem prevista").toBe(ocorrenciasNoTexto(texto));
  });
  it("a árvore deste HEAD declara exatamente uma vez", () => expect(ocorrenciasNaArvore(RAIZ)).toBe(1));
});
