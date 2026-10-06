import { describe, expect, it } from "vitest";
import {
  CLASSES_CONDICAO_PASTO,
  CLASSE_CONDICAO_POR_CODIGO,
  LIMIARES_CLASSIFICADOR_CONDICAO_PASTO,
  LIMIARES_COBERTURA_EXPERIMENTAL,
  PRECEDENCIA_CLASSES_CONDICAO_PASTO,
  RESOLUCAO_ANALITICA_CONDICAO_PASTO_M,
  SCL_AGUA,
  SCL_PERMITIDAS_CONDICAO_PASTO,
  VERSAO_CLASSIFICADOR_CONDICAO_PASTO,
  VERSAO_EVALSCRIPT_CONDICAO_PASTO,
  badgePrincipalCondicao,
  chaveIdentidadeMapaCondicao,
  ordenarAreasCondicao,
  classificarPixelCondicaoPasto,
  contarPixelsCondicao,
  distribuirComMaiorResto,
  identidadesEquivalentes,
  resumirCondicaoPasto,
  type IdentidadeMapaCondicaoPasto,
  type PixelCondicaoPasto
} from "../src/index.js";

const vegetacao: PixelCondicaoPasto = {
  dataMask: 1, scl: 4,
  ndvi: 0.65, evi2: 0.55, ndre: 0.35, ndmi: 0.22, msavi2: 0.58, bsi: -0.18
};

function idBase(extra: Partial<IdentidadeMapaCondicaoPasto> = {}): IdentidadeMapaCondicaoPasto {
  return {
    organizationId: "11111111-1111-4111-8111-111111111111",
    empresaId: "22222222-2222-4222-8222-222222222222",
    areaId: "33333333-3333-4333-8333-333333333333",
    geometriaSha256: "a".repeat(64),
    dataImagem: "2026-10-05",
    versaoClassificador: VERSAO_CLASSIFICADOR_CONDICAO_PASTO,
    versaoEvalscript: VERSAO_EVALSCRIPT_CONDICAO_PASTO,
    resolucaoM: 20,
    fonte: "sentinel-2-l2a",
    ...extra
  };
}

describe("SAT-COND-01 — classificador v1", () => {
  it("C-01 dataMask=0 → SEM_LEITURA", () => {
    expect(classificarPixelCondicaoPasto({ ...vegetacao, dataMask: 0 })).toBe(0);
  });

  it("C-02 SCL água → AGUA", () => {
    expect(classificarPixelCondicaoPasto({ ...vegetacao, scl: SCL_AGUA })).toBe(6);
  });

  it("C-03 solo forte + cobertura baixa → SOLO_EXPOSTO_ESTIMADO", () => {
    expect(classificarPixelCondicaoPasto({
      dataMask: 1, scl: 5,
      ndvi: 0.08, evi2: 0.04, ndre: 0.03, ndmi: 0.05, msavi2: 0.10, bsi: 0.32
    })).toBe(5);
  });

  it("C-04 vegetação + NDMI baixo → POSSIVEL_ESTRESSE_HIDRICO", () => {
    expect(classificarPixelCondicaoPasto({
      dataMask: 1, scl: 4,
      ndvi: 0.52, evi2: 0.41, ndre: 0.28, ndmi: -0.12, msavi2: 0.46, bsi: -0.08
    })).toBe(4);
  });

  it("C-05 cobertura baixa → BAIXA_COBERTURA", () => {
    expect(classificarPixelCondicaoPasto({
      dataMask: 1, scl: 4,
      ndvi: 0.28, evi2: 0.18, ndre: 0.12, ndmi: 0.08, msavi2: 0.18, bsi: 0.02
    })).toBe(3);
  });

  it("C-06 cobertura moderada + vigor → COBERTURA_MODERADA", () => {
    expect(classificarPixelCondicaoPasto({
      dataMask: 1, scl: 4,
      ndvi: 0.45, evi2: 0.34, ndre: 0.22, ndmi: 0.12, msavi2: 0.32, bsi: -0.04
    })).toBe(2);
  });

  it("C-07 boa cobertura + vigor → BOA_COBERTURA", () => {
    expect(classificarPixelCondicaoPasto(vegetacao)).toBe(1);
  });

  it("C-08 exatamente uma classe por pixel", () => {
    const amostras: PixelCondicaoPasto[] = [
      { ...vegetacao, dataMask: 0 },
      { ...vegetacao, scl: 6 },
      { dataMask: 1, scl: 5, ndvi: 0.05, evi2: 0.02, ndre: 0.02, ndmi: 0.0, msavi2: 0.08, bsi: 0.4 },
      { dataMask: 1, scl: 4, ndvi: 0.5, evi2: 0.4, ndre: 0.3, ndmi: -0.2, msavi2: 0.45, bsi: -0.1 },
      { dataMask: 1, scl: 4, ndvi: 0.25, evi2: 0.15, ndre: 0.1, ndmi: 0.1, msavi2: 0.2, bsi: 0 },
      { dataMask: 1, scl: 4, ndvi: 0.42, evi2: 0.33, ndre: 0.21, ndmi: 0.1, msavi2: 0.3, bsi: -0.05 },
      vegetacao
    ];
    for (const a of amostras) {
      const c = classificarPixelCondicaoPasto(a);
      expect(c, JSON.stringify(a)).toBeGreaterThanOrEqual(0);
      expect(c).toBeLessThanOrEqual(6);
      expect(CLASSE_CONDICAO_POR_CODIGO[c].codigo).toBe(c);
    }
  });

  it("C-09 mascarado nunca vira ativo", () => {
    expect(classificarPixelCondicaoPasto({ ...vegetacao, dataMask: 0 })).toBe(0);
    expect(classificarPixelCondicaoPasto({ ...vegetacao, scl: 8 })).toBe(0);
    expect(classificarPixelCondicaoPasto({ ...vegetacao, scl: 9 })).toBe(0);
    expect(classificarPixelCondicaoPasto({ ...vegetacao, ndvi: null })).toBe(0);
  });

  it("C-10 água nunca vira solo", () => {
    expect(classificarPixelCondicaoPasto({
      dataMask: 1, scl: SCL_AGUA,
      ndvi: 0.02, evi2: 0.01, ndre: 0.01, ndmi: 0.4, msavi2: 0.02, bsi: 0.9
    })).toBe(6);
  });

  it("thresholds reusam o SSOT de cobertura experimental", () => {
    expect(LIMIARES_CLASSIFICADOR_CONDICAO_PASTO.ndviVegetacaoAtiva).toBe(LIMIARES_COBERTURA_EXPERIMENTAL.vegetacaoAtivaNdvi);
    expect(LIMIARES_CLASSIFICADOR_CONDICAO_PASTO.ndmiBaixa).toBe(LIMIARES_COBERTURA_EXPERIMENTAL.ndmiBaixa);
    expect(LIMIARES_CLASSIFICADOR_CONDICAO_PASTO.bsiSoloExposto).toBe(LIMIARES_COBERTURA_EXPERIMENTAL.bsiSoloExposto);
    expect(RESOLUCAO_ANALITICA_CONDICAO_PASTO_M).toBe(20);
    expect(PRECEDENCIA_CLASSES_CONDICAO_PASTO[0]).toBe("sem_leitura");
    expect(PRECEDENCIA_CLASSES_CONDICAO_PASTO[1]).toBe("agua");
    expect(SCL_PERMITIDAS_CONDICAO_PASTO).toEqual([2, 4, 5, 7]);
    expect(CLASSES_CONDICAO_PASTO).toHaveLength(7);
  });
});

describe("SAT-COND-01 — resumo", () => {
  it("R-01 contagem correta", () => {
    const { contagem, universo } = contarPixelsCondicao([1, 1, 2, 3, 0, 5, 6, 1]);
    expect(universo).toBe(8);
    expect(contagem[1]).toBe(3);
    expect(contagem[2]).toBe(1);
    expect(contagem[0]).toBe(1);
  });

  it("R-02 percentuais coerentes (somam 100,0)", () => {
    const { contagem } = contarPixelsCondicao(Uint8Array.from([1, 1, 1, 2, 3, 0, 5, 4, 6, 1]));
    const r = resumirCondicaoPasto({ contagem, areaTotalHa: 100 });
    const soma = r.classes.reduce((s, c) => s + Number(c.area_estimada_percentual), 0);
    expect(soma).toBeCloseTo(100, 6);
  });

  it("R-03 hectares coerentes (somam a área total)", () => {
    const { contagem } = contarPixelsCondicao([1, 1, 2, 3, 5, 0]);
    const r = resumirCondicaoPasto({ contagem, areaTotalHa: 82.4 });
    const soma = r.classes.reduce((s, c) => s + Number(c.area_estimada_ha), 0);
    expect(soma).toBeCloseTo(82.4, 6);
  });

  it("R-04 sem leitura separado", () => {
    const { contagem } = contarPixelsCondicao([0, 0, 1, 1]);
    const r = resumirCondicaoPasto({ contagem, areaTotalHa: 40 });
    expect(Number(r.area_sem_leitura_ha)).toBe(20);
    expect(Number(r.area_lida_ha)).toBe(20);
    expect(r.pixels_sem_leitura).toBe(2);
  });

  it("R-05 arredondamento seguro (maior resto)", () => {
    expect(distribuirComMaiorResto([1, 1, 1], 1, 2).reduce((s, n) => s + n, 0)).toBeCloseTo(1, 8);
    expect(distribuirComMaiorResto([2, 1], 10, 2)).toEqual([6.67, 3.33]);
  });

  it("R-06 zero válidos sem divisão por zero", () => {
    const r = resumirCondicaoPasto({ contagem: { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 }, areaTotalHa: 10 });
    expect(r.cobertura_valida).toBe("0.0000");
    expect(r.classes.every((c) => c.area_estimada_ha === "0.00")).toBe(true);
    expect(r.classes.every((c) => c.area_estimada_percentual === "0.0")).toBe(true);
    const vazio = resumirCondicaoPasto({ contagem: { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 }, areaTotalHa: 0 });
    expect(vazio.area_total_ha).toBe("0.00");
  });

  it("badge de atenção quando solo/estresse/baixa ≥ 15%", () => {
    const { contagem } = contarPixelsCondicao(Array.from({ length: 70 }, () => 1).concat(Array.from({ length: 20 }, () => 5)));
    const r = resumirCondicaoPasto({ contagem, areaTotalHa: 100 });
    expect(badgePrincipalCondicao(r).rotulo).toBe("Atenção");
  });

  it("ordenar por atenção e por classe selecionada", () => {
    const boa = resumirCondicaoPasto({ contagem: { 0: 0, 1: 90, 2: 10, 3: 0, 4: 0, 5: 0, 6: 0 }, areaTotalHa: 80 });
    const alerta = resumirCondicaoPasto({ contagem: { 0: 0, 1: 50, 2: 10, 3: 10, 4: 10, 5: 20, 6: 0 }, areaTotalHa: 55 });
    const areas = [
      { id: "b", nome: "Pasto B", areaHa: 80, resumo: boa },
      { id: "a", nome: "Pasto A", areaHa: 55, resumo: alerta }
    ];
    expect(ordenarAreasCondicao(areas, "atencao", null).map((x) => x.id)).toEqual(["a", "b"]);
    expect(ordenarAreasCondicao(areas, "nome", null).map((x) => x.id)).toEqual(["a", "b"]);
    expect(ordenarAreasCondicao(areas, "area", null).map((x) => x.id)).toEqual(["b", "a"]);
    expect(ordenarAreasCondicao(areas, "atencao", 5).map((x) => x.id)).toEqual(["a", "b"]);
  });
});

describe("SAT-COND-01 — identidade", () => {
  it("I-01 geometria antiga não vira atual", () => {
    const a = idBase();
    const b = idBase({ geometriaSha256: "b".repeat(64) });
    expect(identidadesEquivalentes(a, b)).toBe(false);
    expect(chaveIdentidadeMapaCondicao(a)).not.toBe(chaveIdentidadeMapaCondicao(b));
  });

  it("I-02 data exata preservada", () => {
    const a = idBase({ dataImagem: "2026-10-01" });
    const b = idBase({ dataImagem: "2026-10-05" });
    expect(identidadesEquivalentes(a, b)).toBe(false);
    expect(chaveIdentidadeMapaCondicao(a)).toContain("2026-10-01");
  });

  it("I-03 classificador v1 separado de futuro v2", () => {
    const a = idBase();
    const b = idBase({ versaoClassificador: "condicao-pasto-v2" });
    expect(identidadesEquivalentes(a, b)).toBe(false);
  });

  it("I-04 não misturar observações diferentes", () => {
    const a = idBase({ dataImagem: "2026-10-01" });
    const b = idBase({ dataImagem: "2026-10-05" });
    expect(chaveIdentidadeMapaCondicao(a).split("|")[4]).toBe("2026-10-01");
    expect(chaveIdentidadeMapaCondicao(b).split("|")[4]).toBe("2026-10-05");
    expect(identidadesEquivalentes(a, b)).toBe(false);
  });
});
