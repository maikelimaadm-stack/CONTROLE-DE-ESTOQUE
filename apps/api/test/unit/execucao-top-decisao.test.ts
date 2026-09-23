import { describe, it, expect } from "vitest";
import path from "node:path";
import { ASSINATURA, CAMINHO_CAPACIDADES, decidir, ocorrenciasNaArvore, ocorrenciasNoTexto } from "../../../../scripts/lib/execucao-top.mjs";

/**
 * A PROVA DE SKEW DA TOP-CONFIG-04A TAMBÉM TEM DE EXPIRAR SOZINHA.
 *
 * Enquanto a base desta PR é anterior à fatia, o sentido 1 prova que o web novo, contra a API anterior,
 * esconde a execução e grava no formato 1 — e que a API anterior RECUSA o formato 2. No dia em que a fatia
 * estiver na `main`, essa afirmação vira falsa por decurso de prazo; a decisão por MEDIÇÃO da árvore da
 * base é o que troca o ramo sem ninguém mexer. Este arquivo cobra as três metades: 0, 1, e "qualquer outro
 * número reprova".
 */
const RAIZ = path.resolve(__dirname, "../../../..");

describe("decisão da execução configurada da base (version skew)", () => {
  it("base SEM o bloco: mundo legado", () => {
    const d = decidir({ ocorrencias: 0 });
    expect(d.declara).toBe(false);
    expect(d.motivo).toMatch(/LEGADO/);
  });

  it("base COM o bloco exatamente uma vez: mundo atual", () => {
    const d = decidir({ ocorrencias: 1 });
    expect(d.declara).toBe(true);
    expect(d.motivo).toMatch(/ATUAL/);
  });

  it("número ambíguo REPROVA em vez de escolher um ramo", () => {
    expect(() => decidir({ ocorrencias: 2 })).toThrow(/apareceu 2 vezes/);
    expect(() => decidir({ ocorrencias: 5 })).toThrow();
  });

  it("a assinatura casa a DECLARAÇÃO do gate no bloco, e não qualquer menção ao gate", () => {
    expect(ocorrenciasNoTexto("      runtimeHabilitado: app.config.TOP_EFFECTS_RUNTIME_V1_ENABLED,")).toBe(1);
    for (const ruido of [
      "// o gate TOP_EFFECTS_RUNTIME_V1_ENABLED nasce desligado",
      "confirmSale(ctx, id, app.config.TOP_EFFECTS_RUNTIME_V1_ENABLED)",
      'TOP_EFFECTS_RUNTIME_V1_ENABLED: "1"',
      "runtimeHabilitado: false",
    ]) {
      expect(ocorrenciasNoTexto(ruido), `não pode contar como declaração: ${ruido}`).toBe(0);
    }
  });

  it("a árvore DESTE HEAD é medida como 'declara' — a assinatura ainda encontra o que promete", () => {
    expect(ocorrenciasNaArvore(RAIZ), `${CAMINHO_CAPACIDADES} deveria declarar o bloco exatamente uma vez`).toBe(1);
    expect(ASSINATURA.source).toMatch(/runtimeHabilitado/);
  });
});
