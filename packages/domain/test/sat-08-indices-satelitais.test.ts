import { describe, expect, it } from "vitest";
import {
  BANDAS_BUNDLE_ESSENCIAL,
  CATALOGO_INDICES,
  INDICES_BUNDLE_ESSENCIAL,
  RESOLUCAO_AGREGACAO_PASTAGEM_M,
  VERSAO_METODO_PASTAGEM_ESSENCIAL,
  VERSAO_METODO_PASTAGEM_ESSENCIAL_V1,
  calcularBsi,
  calcularEvi2,
  calcularIndice,
  calcularMsavi2,
  calcularNdmi,
  calcularNdre,
  calcularNdvi,
  condicaoHidricaNdmi,
  deltaPercentual,
  estadoQualidade,
  indicadoresDerivados,
  pixelValidoParaIndice,
  pixelValidoParaVegetacao,
  rotuloRespostaVegetacao,
  tendenciaCurta
} from "../src/indices-satelitais.js";
import { CLASSES_SCL_EXCLUIDAS, INDICES_SATELITE } from "../src/analise-satelital.js";

describe("SAT-08 — catálogo e fórmulas", () => {
  it("bundle essencial tem os 6 índices e resolução de agregação 20 m; método ativo v2", () => {
    expect([...INDICES_BUNDLE_ESSENCIAL]).toEqual(["ndvi", "evi2", "ndre", "ndmi", "msavi2", "bsi"]);
    expect(RESOLUCAO_AGREGACAO_PASTAGEM_M).toBe(20);
    expect(VERSAO_METODO_PASTAGEM_ESSENCIAL).toBe("pastagem-essencial-v2");
    expect(VERSAO_METODO_PASTAGEM_ESSENCIAL_V1).toBe("pastagem-essencial-v1");
    expect(BANDAS_BUNDLE_ESSENCIAL).toEqual(["B02", "B04", "B05", "B08", "B8A", "B11", "SCL"]);
  });

  it("EVI2 persistível até 2.5; MSAVI2 até -2.5; NDVI continua [-1,1]; paleta visual ≠ constraint", () => {
    expect(CATALOGO_INDICES.evi2.faixaPersistivel).toEqual({ min: -1, max: 2.5 });
    expect(CATALOGO_INDICES.evi2.faixaVisual).toEqual({ min: -1, max: 1 });
    expect(CATALOGO_INDICES.ndvi.faixaPersistivel).toEqual({ min: -1, max: 1 });
    expect(CATALOGO_INDICES.msavi2.faixaPersistivel).toEqual({ min: -2.5, max: 1 });
    expect(CATALOGO_INDICES.msavi2.faixaVisual).toEqual({ min: -1, max: 1 });
    const evi = calcularEvi2(0.8, 0.02)!;
    expect(evi).toBeGreaterThan(1);
    expect(evi).toBeLessThanOrEqual(2.5);
    // S2L2A reflectance pode >1 (UINT15/10000); MSAVI2(NIR=0,RED=1.5) < -1
    const msavi = calcularMsavi2(0, 1.5)!;
    expect(msavi).toBeLessThan(-1);
    expect(msavi).toBeGreaterThanOrEqual(-2.5);
    expect(calcularMsavi2(0, 3.2767)!).toBeGreaterThanOrEqual(-2.5);
  });

  it("máscara por índice: B05 inválida não invalida NDVI", () => {
    const p = { dataMask: 1, scl: 4, B04: 0.1, B08: 0.4, B05: -1, B8A: 0.3, B02: 0.05, B11: 0.2 };
    expect(pixelValidoParaIndice("ndvi", p)).toBe(true);
    expect(pixelValidoParaIndice("ndre", p)).toBe(false);
  });

  it("NDRE e NDMI declaram resolução nativa 20 m; NDVI/EVI2/MSAVI2 10 m", () => {
    expect(CATALOGO_INDICES.ndre.resolucaoNativaM).toBe(20);
    expect(CATALOGO_INDICES.ndmi.resolucaoNativaM).toBe(20);
    expect(CATALOGO_INDICES.bsi.resolucaoNativaM).toBe(20);
    expect(CATALOGO_INDICES.ndvi.resolucaoNativaM).toBe(10);
    expect(CATALOGO_INDICES.evi2.resolucaoNativaM).toBe(10);
    expect(CATALOGO_INDICES.msavi2.resolucaoNativaM).toBe(10);
  });

  it("listas do banco e do catálogo batem", () => {
    expect([...INDICES_SATELITE]).toEqual([...INDICES_BUNDLE_ESSENCIAL]);
  });

  it("fórmulas com pixel de vegetação vigorosa", () => {
    const b = { B02: 0.05, B04: 0.05, B05: 0.08, B08: 0.4, B8A: 0.38, B11: 0.15 };
    expect(calcularNdvi(b.B08, b.B04)).toBeCloseTo((0.4 - 0.05) / (0.4 + 0.05), 6);
    expect(calcularEvi2(b.B08, b.B04)).toBeCloseTo((2.5 * (0.4 - 0.05)) / (0.4 + 2.4 * 0.05 + 1), 6);
    expect(calcularNdre(b.B8A, b.B05)).toBeCloseTo((0.38 - 0.08) / (0.38 + 0.08), 6);
    expect(calcularNdmi(b.B8A, b.B11)).toBeCloseTo((0.38 - 0.15) / (0.38 + 0.15), 6);
    const msavi = calcularMsavi2(b.B08, b.B04)!;
    expect(msavi).toBeGreaterThan(0.5);
    expect(calcularBsi(b.B11, b.B04, b.B08, b.B02)!).toBeLessThan(0);
  });

  it("solo exposto: NDVI baixo e BSI mais alto", () => {
    const solo = { B02: 0.15, B04: 0.18, B05: 0.2, B08: 0.2, B8A: 0.22, B11: 0.35 };
    expect(calcularNdvi(solo.B08, solo.B04)!).toBeLessThan(0.15);
    expect(calcularBsi(solo.B11, solo.B04, solo.B08, solo.B02)!).toBeGreaterThan(0);
  });

  it("denominador zero / inválido → null (nunca NaN nem Infinity)", () => {
    expect(calcularNdvi(0, 0)).toBeNull();
    expect(calcularNdre(0, 0)).toBeNull();
    expect(calcularNdmi(0, 0)).toBeNull();
    expect(calcularBsi(0, 0, 0, 0)).toBeNull();
    expect(calcularEvi2(-1, 0.1)).toBeNull();
    expect(calcularIndice("ndvi", { B08: 0, B04: 0 })).toBeNull();
  });

  it("máscara: nuvem/sombra/água excluídas; vegetação e solo válidos", () => {
    const base = { dataMask: 1, B04: 0.1, B08: 0.3 };
    expect(pixelValidoParaVegetacao({ ...base, scl: 4 })).toBe(true);
    expect(pixelValidoParaVegetacao({ ...base, scl: 5 })).toBe(true);
    for (const [classe] of CLASSES_SCL_EXCLUIDAS) {
      expect(pixelValidoParaVegetacao({ ...base, scl: classe })).toBe(false);
    }
    expect(pixelValidoParaVegetacao({ ...base, scl: 4, dataMask: 0 })).toBe(false);
  });

  it("linguagem segura: NDVI alto não vira «pasto bom»", () => {
    expect(rotuloRespostaVegetacao(0.72)).toBe("Alta resposta de vegetação");
    expect(rotuloRespostaVegetacao(0.72).toLowerCase()).not.toMatch(/pasto bom|capim/);
  });

  it("qualidade e indicadores derivados experimentais", () => {
    expect(estadoQualidade(0.94, "concluida")).toBe("excelente");
    expect(estadoQualidade(0.5, "concluida")).toBe("insuficiente");
    expect(estadoQualidade(null, "sem_observacao_util")).toBe("sem_imagem_util");
    expect(condicaoHidricaNdmi(-0.1)).toBe("baixa");
    const ind = indicadoresDerivados({ ndviMedio: 0.55, ndmiMedio: 0.1, bsiMedio: 0.05 });
    expect(ind.experimental).toBe(true);
    expect(ind.aviso.toLowerCase()).toMatch(/capim útil/);
    expect(ind.aviso.toLowerCase()).toMatch(/campo/);
  });

  it("delta e tendência curta", () => {
    expect(deltaPercentual(0.4, 0.5)).toBeCloseTo(-20, 5);
    expect(tendenciaCurta(-20)).toBe("queda_forte");
    expect(tendenciaCurta(2)).toBe("estavel");
    expect(deltaPercentual(0.4, 0)).toBeNull();
  });
});
