import { describe, it, expect } from "vitest";
import { CLASSES_NDVI_MAPA, MOTIVOS_QUALIDADE_ANALISE_SATELITAL, SITUACOES_ANALISE_SATELITAL, classeNdvi } from "../src/analise-satelital.js";
import { UNKNOWN_VALUE, enumLabel } from "../src/labels.js";

/** MAPA-GERAL (decisão 294) — a escala FIXA do NDVI: limites, inclusividade e recusa do que não é NDVI. */
describe("classeNdvi — escala fixa do Mapa geral", () => {
  it("as quatro classes, em ordem crescente de limite, começando em −1", () => {
    expect(CLASSES_NDVI_MAPA.map((c) => [c.chave, c.minimo])).toEqual([["sem_vegetacao", -1], ["baixo", 0.2], ["medio", 0.4], ["alto", 0.6]]);
  });
  it("limite inferior é inclusivo; a string do numeric da API é lida", () => {
    expect(classeNdvi("-1.0000")?.chave).toBe("sem_vegetacao");
    expect(classeNdvi("0.1999")?.chave).toBe("sem_vegetacao");
    expect(classeNdvi("0.2000")?.chave).toBe("baixo");
    expect(classeNdvi(0.3999)?.chave).toBe("baixo");
    expect(classeNdvi("0.4000")?.chave).toBe("medio");
    expect(classeNdvi("0.5999")?.chave).toBe("medio");
    expect(classeNdvi("0.6000")?.chave).toBe("alto");
    expect(classeNdvi("1.0000")?.chave).toBe("alto");
  });
  it("vazio, nulo, texto, NaN ou fora de [−1, 1] → sem classe (nunca uma cor inventada)", () => {
    for (const v of [null, undefined, "", "  ", "abc", Number.NaN, Number.POSITIVE_INFINITY, "-1.0001", 1.0001]) expect(classeNdvi(v as never)).toBeNull();
  });
});

describe("rótulos da análise por satélite (enumLabel) — as listas do dono, não uma cópia", () => {
  it("cada situação e cada motivo do domínio tem o rótulo da própria lista", () => {
    for (const [valor, rotulo] of SITUACOES_ANALISE_SATELITAL) expect(enumLabel("analise_satelital_situacao", valor)).toBe(rotulo);
    for (const [valor, rotulo] of MOTIVOS_QUALIDADE_ANALISE_SATELITAL) expect(enumLabel("analise_satelital_motivo", valor)).toBe(rotulo);
    expect(enumLabel("analise_satelital_situacao", "sem_observacao_util")).toBe("Sem observação útil");
  });
  it("valor desconhecido nunca volta cru", () => {
    expect(enumLabel("analise_satelital_motivo", "nuvem")).toBe(UNKNOWN_VALUE);
  });
});
