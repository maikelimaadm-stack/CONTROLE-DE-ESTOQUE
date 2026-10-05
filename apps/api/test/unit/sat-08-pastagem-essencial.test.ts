import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import {
  CLASSES_SCL_EXCLUIDAS,
  INDICES_BUNDLE_ESSENCIAL,
  VERSAO_METODO_PASTAGEM_ESSENCIAL,
  calcularEvi2,
  calcularMsavi2,
  pixelValidoParaIndice
} from "@agro/domain";
import {
  EVALSCRIPT_PASTAGEM_ESSENCIAL,
  EVALSCRIPT_PASTAGEM_SHA256,
  RESOLUCAO_AGREGACAO_M,
  escolherObservacaoPastagem,
  fracaoBinsAlinhados,
  interpretarEstatisticaMulti,
  lerHistograma,
  lerPercentis,
  montarCalculationsPastagem,
  montarCorpoPastagem,
  valor4,
  type HistogramaCanonico
} from "../../src/lib/satelite/pastagem-essencial.js";
import { FalhaCopernicus } from "../../src/lib/satelite/copernicus.js";
import type { PoligonoGeoJson } from "../../src/lib/satelite/geometria.js";
import { msgAreaGrande, msgAreaPequena } from "../../src/routes/analises-satelitais.js";

const janela = { inicio: new Date("2026-09-01T00:00:00Z"), fim: new Date("2026-10-01T00:00:00Z") };
const poligono: PoligonoGeoJson = {
  type: "Polygon",
  coordinates: [[[-47.1, -15.8], [-47.0, -15.8], [-47.0, -15.7], [-47.1, -15.7], [-47.1, -15.8]]]
};

/** Histograma oficial (shape Statistical API). */
function histOficial(
  edges: number[],
  counts: number[],
  underflow = 0,
  overflow = 0
): HistogramaCanonico {
  const bins = [];
  for (let i = 0; i < counts.length; i++) {
    bins.push({ lowEdge: edges[i]!, highEdge: edges[i + 1]!, count: counts[i]! });
  }
  return { bins, underflowCount: underflow, overflowCount: overflow };
}

function statsOficial(mean: number | null, opts: {
  sampleCount?: number;
  noDataCount?: number;
  min?: number | null;
  max?: number | null;
  stDev?: number | null;
  hist?: HistogramaCanonico;
  percentisChave?: "dot" | "int";
} = {}) {
  const sampleCount = opts.sampleCount ?? 100;
  const noDataCount = opts.noDataCount ?? 20;
  const validos = sampleCount - noDataCount;
  const min = opts.min !== undefined ? opts.min : (mean === null ? null : mean - 0.1);
  const max = opts.max !== undefined ? opts.max : (mean === null ? null : mean + 0.1);
  const stDev = opts.stDev !== undefined ? opts.stDev : (mean === null ? null : 0.05);
  const percentis = validos <= 0 || mean === null
    ? undefined
    : opts.percentisChave === "int"
      ? { "5": mean - 0.08, "10": mean - 0.06, "25": mean - 0.03, "50": mean, "75": mean + 0.03, "90": mean + 0.06, "95": mean + 0.08 }
      : { "5.0": mean - 0.08, "10.0": mean - 0.06, "25.0": mean - 0.03, "50.0": mean, "75.0": mean + 0.03, "90.0": mean + 0.06, "95.0": mean + 0.08 };
  return {
    bands: {
      B0: {
        stats: {
          sampleCount, noDataCount, mean, min, max, stDev,
          ...(percentis ? { percentiles: percentis } : {})
        },
        histogram: opts.hist ?? histOficial([-1, 0.2, 0.4, 0.6, 1], [5, 15, 25, 35], 0, 0)
      }
    }
  };
}

/**
 * Fixture oficial: outputs nomeados, percentis "5.0", histograma com lowEdge/highEdge/count,
 * underflow/overflow, SCL com vegetação/solo/água/sombra/nuvem/cirrus.
 */
function fixtureOficial(
  medias: Record<string, number | null>,
  extras: {
    evi2Max?: number;
    msavi2Min?: number;
    porIndice?: Partial<Record<string, { sampleCount?: number; noDataCount?: number; mean?: number | null; min?: number | null; max?: number | null; stDev?: number | null }>>;
    from?: string;
    to?: string;
  } = {}
) {
  const outputs: Record<string, unknown> = {};
  for (const id of INDICES_BUNDLE_ESSENCIAL) {
    const over = extras.porIndice?.[id] ?? {};
    const mean = over.mean !== undefined ? over.mean : (medias[id] ?? 0.4);
    const isEvi = id === "evi2";
    const isMsavi = id === "msavi2";
    outputs[id] = statsOficial(mean, {
      max: over.max !== undefined ? over.max : (isEvi ? (extras.evi2Max ?? (typeof mean === "number" ? Math.max(mean + 0.1, 1.055) : null)) : undefined),
      min: over.min !== undefined ? over.min : (isEvi && typeof mean === "number"
        ? Math.min(mean - 0.1, 0.2)
        : isMsavi ? (extras.msavi2Min ?? undefined) : undefined),
      stDev: over.stDev,
      sampleCount: over.sampleCount ?? 100,
      noDataCount: over.noDataCount ?? 20,
      hist: id === "bsi"
        ? histOficial([-1, -0.1, 0.1, 0.2, 1], [10, 20, 30, 20], 0, 0)
        : id === "evi2"
          ? histOficial([-1, 0.2, 0.4, 0.6, 1, 2.5], [2, 8, 20, 30, 20], 0, 5)
          : id === "msavi2"
            ? histOficial([-2.5, -1, 0.2, 0.4, 0.6, 1], [0, 5, 15, 25, 35], 2, 3)
            : histOficial([-1, 0.2, 0.4, 0.6, 1], [5, 15, 25, 35], 2, 3)
    });
  }
  // SCL: máscara só fonte — vegetação(4), solo(5), água(6), sombra(3), nuvem(8/9), cirrus(10)
  outputs.scl = {
    bands: {
      B0: {
        stats: { sampleCount: 100, noDataCount: 10, min: 3, max: 10, mean: 5.5, stDev: 2 },
        histogram: histOficial(
          [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
          [0, 0, 0, 8, 40, 15, 5, 2, 10, 5, 5, 0],
          0,
          0
        )
      }
    }
  };
  return {
    data: [{
      interval: {
        from: extras.from ?? "2026-09-20T00:00:00Z",
        to: extras.to ?? "2026-09-21T00:00:00Z"
      },
      outputs
    }],
    status: "OK"
  };
}

function fixtureMultiDia(dias: Array<{
  from: string;
  to: string;
  medias: Record<string, number | null>;
  porIndice?: Partial<Record<string, { sampleCount?: number; noDataCount?: number; mean?: number | null; min?: number | null; max?: number | null; stDev?: number | null }>>;
}>) {
  return {
    data: dias.map((d) => fixtureOficial(d.medias, { from: d.from, to: d.to, porIndice: d.porIndice }).data[0]),
    status: "OK"
  };
}

describe("SAT-08 R1 — pastagem essencial v2 (contrato Statistical API)", () => {
  it("método ativo é pastagem-essencial-v2", () => {
    expect(VERSAO_METODO_PASTAGEM_ESSENCIAL).toBe("pastagem-essencial-v2");
  });

  it("evalscript declara dataMask por output (índices + scl) e máscara SCL do domínio", () => {
    expect(EVALSCRIPT_PASTAGEM_ESSENCIAL).toContain('id: "ndvi"');
    expect(EVALSCRIPT_PASTAGEM_ESSENCIAL).toContain('id: "scl"');
    expect(EVALSCRIPT_PASTAGEM_ESSENCIAL).toContain('id: "dataMask", bands: ["ndvi", "evi2", "ndre", "ndmi", "msavi2", "bsi", "scl"]');
    expect(EVALSCRIPT_PASTAGEM_ESSENCIAL).toContain("mNdvi");
    expect(EVALSCRIPT_PASTAGEM_ESSENCIAL).toContain("fonte");
    for (const [c] of CLASSES_SCL_EXCLUIDAS) expect(EVALSCRIPT_PASTAGEM_ESSENCIAL).toContain(String(c));
    expect(EVALSCRIPT_PASTAGEM_SHA256).toBe(createHash("sha256").update(EVALSCRIPT_PASTAGEM_ESSENCIAL, "utf8").digest("hex"));
  });

  it("calculations casam aos output IDs com bins alinhados (nunca só default)", () => {
    const c = montarCalculationsPastagem() as Record<string, unknown>;
    for (const id of INDICES_BUNDLE_ESSENCIAL) expect(c[id]).toBeTruthy();
    expect(c.scl).toBeTruthy();
    const ndvi = c.ndvi as { histograms: { default: { bins: number[] } } };
    expect(ndvi.histograms.default.bins).toEqual([-1, 0.2, 0.4, 0.6, 1]);
    const evi = c.evi2 as { histograms: { default: { bins: number[] } } };
    expect(evi.histograms.default.bins).toContain(2.5);
  });

  it("corpo pede agregação 20 m", () => {
    const corpo = montarCorpoPastagem(poligono, janela, { resx: 0.0002, resy: 0.0002 });
    expect(RESOLUCAO_AGREGACAO_M).toBe(20);
    expect(corpo.aggregation.evalscript).toBe(EVALSCRIPT_PASTAGEM_ESSENCIAL);
  });

  it("percentis aceitam chaves 5.0 / 10.0 / equivalentes", () => {
    expect(lerPercentis({
      percentiles: { "5.0": 0.1, "10.0": 0.15, "25.0": 0.2, "50.0": 0.3, "75.0": 0.4, "90.0": 0.5, "95.0": 0.55 }
    })).toEqual({ p5: 0.1, p10: 0.15, p25: 0.2, p50: 0.3, p75: 0.4, p90: 0.5, p95: 0.55 });
    expect(lerPercentis({
      percentiles: { "5": 0.1, "10": 0.15, "25": 0.2, "50": 0.3, "75": 0.4, "90": 0.5, "95": 0.55 }
    })?.p5).toBe(0.1);
    expect(lerPercentis({
      percentiles: { "05.0": 0.1, "10.0": 0.15, "25.0": 0.2, "50.0": 0.3, "75.0": 0.4, "90.0": 0.5, "95.0": 0.55 }
    })?.p5).toBe(0.1);
    // ausente
    expect(lerPercentis({ percentiles: { "5.0": 0.1 } })).toBeNull();
    // duplicidade ambígua
    expect(lerPercentis({
      percentiles: { "5": 0.1, "5.0": 0.2, "10.0": 0.15, "25.0": 0.2, "50.0": 0.3, "75.0": 0.4, "90.0": 0.5, "95.0": 0.55 }
    })).toBeNull();
    // NaN
    expect(lerPercentis({
      percentiles: { "5.0": NaN, "10.0": 0.15, "25.0": 0.2, "50.0": 0.3, "75.0": 0.4, "90.0": 0.5, "95.0": 0.55 }
    })).toBeNull();
  });

  it("histograma oficial: bins com lowEdge/highEdge/count + underflow/overflow", () => {
    const h = lerHistograma({
      histogram: {
        bins: [
          { lowEdge: -1, highEdge: 0.2, count: 5 },
          { lowEdge: 0.2, highEdge: 0.4, count: 10 },
          { lowEdge: 0.4, highEdge: 0.6, count: 20 },
          { lowEdge: 0.6, highEdge: 1, count: 30 }
        ],
        underflowCount: 2,
        overflowCount: 3
      }
    });
    expect(h).toEqual({
      bins: [
        { lowEdge: -1, highEdge: 0.2, count: 5 },
        { lowEdge: 0.2, highEdge: 0.4, count: 10 },
        { lowEdge: 0.4, highEdge: 0.6, count: 20 },
        { lowEdge: 0.6, highEdge: 1, count: 30 }
      ],
      underflowCount: 2,
      overflowCount: 3
    });
  });

  it("histograma legado bins:number[] + counts → null (fail-closed)", () => {
    expect(lerHistograma({ histogram: { bins: [-1, 0, 1], counts: [1, 2] } })).toBeNull();
  });

  it("interpreta fixture oficial: percentis, histograma, underflow, overflow, cloud_ratio, scl", () => {
    const corpo = fixtureOficial({
      ndvi: 0.55, evi2: 1.055, ndre: 0.35, ndmi: 0.12, msavi2: 0.5, bsi: -0.05
    }, { evi2Max: 1.055 });
    const lida = interpretarEstatisticaMulti(corpo, janela);
    const r = escolherObservacaoPastagem(lida, 100, null);
    expect(r.situacao).toBe("concluida");
    expect(r.versao_metodo).toBe("pastagem-essencial-v2");
    expect(r.indices).toHaveLength(6);

    const ndvi = r.indices.find((i) => i.indice === "ndvi")!;
    expect(ndvi.percentis?.p5).toBeTruthy();
    expect(ndvi.histograma?.underflowCount).toBe(2);
    expect(ndvi.histograma?.overflowCount).toBe(3);
    expect(ndvi.histograma?.bins[0]).toMatchObject({ lowEdge: -1, highEdge: 0.2 });
    expect(ndvi.resolucao_m).toBe(20);
    expect(ndvi.resolucao_nativa_m).toBe(10);

    const evi = r.indices.find((i) => i.indice === "evi2")!;
    expect(Number(evi.valores!.maximo)).toBeGreaterThan(1);
    expect(evi.resolucao_nativa_m).toBe(10);

    const ndre = r.indices.find((i) => i.indice === "ndre")!;
    expect(ndre.resolucao_nativa_m).toBe(20);

    // cloud_ratio: classes 3+8+9+10 = 8+10+5+5 = 28 / 90 válidos fonte
    expect(Number(r.qualidade.cloud_ratio)).toBeCloseTo(28 / 90, 3);
    expect(r.qualidade.scl_composition?.["4"]).toBeTruthy();
    expect(r.qualidade.scl_composition?.["5"]).toBeTruthy();
    expect(r.qualidade.scl_composition?.["6"]).toBeTruthy();
    expect(r.qualidade.scl_composition?.["3"]).toBeTruthy();
    expect(r.qualidade.scl_composition?.["8"]).toBeTruthy();
    expect(r.qualidade.scl_composition?.["10"]).toBeTruthy();
    expect(r.qualidade.mascara.por_output).toBe(true);
    expect(r.qualidade.denominadores.pixels_geometricos).toBe(100);
    expect(r.qualidade.denominadores.pixels_com_dado_fonte).toBe(90);

    // fração vegetação ativa (bins >= 0.4): 25+35 = 60 / 80
    expect(r.indicadores.fracoes_histograma.vegetacao_ativa).toBeCloseTo(60 / 80, 5);
    expect(r.indicadores.experimental).toBe(true);
  });

  it("máscara independente: NDVI e NDRE podem ter sampleCount/noDataCount distintos", () => {
    const corpo = fixtureOficial(
      { ndvi: 0.5, evi2: 0.4, ndre: 0.3, ndmi: 0.1, msavi2: 0.45, bsi: 0 },
      {
        porIndice: {
          ndvi: { sampleCount: 100, noDataCount: 10 },
          ndre: { sampleCount: 100, noDataCount: 40 }
        }
      }
    );
    const r = escolherObservacaoPastagem(interpretarEstatisticaMulti(corpo, janela), 100, null);
    const ndvi = r.indices.find((i) => i.indice === "ndvi")!;
    const ndre = r.indices.find((i) => i.indice === "ndre")!;
    expect(ndvi.pixels!.validos).toBe(90);
    expect(ndre.pixels!.validos).toBe(60);
    expect(ndvi.pixels!.validos).not.toBe(ndre.pixels!.validos);
  });

  it("EVI2 matemático >1 (B08=0.8, B04=0.02) e aceito no resultado", () => {
    const evi = calcularEvi2(0.8, 0.02)!;
    expect(evi).toBeGreaterThan(1);
    expect(evi).toBeCloseTo(1.055, 2);
    const corpo = fixtureOficial(
      { ndvi: 0.5, evi2: evi, ndre: 0.3, ndmi: 0.1, msavi2: 0.45, bsi: 0 },
      { evi2Max: evi }
    );
    const r = escolherObservacaoPastagem(interpretarEstatisticaMulti(corpo, janela), 100, null);
    expect(Number(r.indices.find((i) => i.indice === "evi2")!.valores!.maximo)).toBeGreaterThan(1);
  });

  it("B05 inválida NÃO invalida NDVI (pixelValidoParaIndice)", () => {
    const base = { dataMask: 1, scl: 4, B04: 0.1, B08: 0.4, B05: -1, B8A: 0.3 };
    expect(pixelValidoParaIndice("ndvi", base)).toBe(true);
    expect(pixelValidoParaIndice("evi2", base)).toBe(true);
    expect(pixelValidoParaIndice("ndre", base)).toBe(false);
    expect(pixelValidoParaIndice("ndmi", { ...base, B05: 0.1, B11: -1 })).toBe(false);
    expect(pixelValidoParaIndice("ndvi", { ...base, B05: -1, B11: -1 })).toBe(true);
  });

  it("mensagens 10 m vs 20 m parametrizadas (bundle não herda texto de 10 m)", () => {
    expect(msgAreaPequena(10)).toContain("10 m");
    expect(msgAreaPequena(20)).toContain("20 m");
    expect(msgAreaPequena(20)).not.toContain("10 m");
    expect(msgAreaGrande(20)).toContain("20 m");
    expect(msgAreaGrande(20)).not.toContain("10 m");
  });

  it("fração alinhada não usa centro do bin", () => {
    const hist = histOficial([-1, 0.2, 0.4, 0.6, 1], [10, 20, 30, 40]);
    // vegetação ativa: bins com low >= 0.4 → 30+40
    expect(fracaoBinsAlinhados(hist, (low) => low >= 0.4 - 1e-12)).toBeCloseTo(70 / 100, 5);
    // baixa cobertura [0.2, 0.4)
    expect(fracaoBinsAlinhados(hist, (low, high) => low >= 0.2 - 1e-12 && high <= 0.4 + 1e-12)).toBeCloseTo(20 / 100, 5);
  });

  it("resposta sem output nomeado → malformada", () => {
    const corpo = {
      data: [{
        interval: { from: "2026-09-20T00:00:00Z", to: "2026-09-21T00:00:00Z" },
        outputs: { default: statsOficial(0.5) }
      }]
    };
    expect(() => interpretarEstatisticaMulti(corpo, janela)).toThrow(FalhaCopernicus);
  });

  it("histograma malformado (ordem invertida) → null", () => {
    expect(lerHistograma({
      histogram: {
        bins: [{ lowEdge: 0.4, highEdge: 0.2, count: 1 }],
        underflowCount: 0,
        overflowCount: 0
      }
    })).toBeNull();
  });
});

const mediasCompletas = { ndvi: 0.55, evi2: 0.5, ndre: 0.35, ndmi: 0.12, msavi2: 0.5, bsi: -0.05 };

describe("SAT-08 R2 — bundle completo e defesa de runtime", () => {
  it("A: último dia incompleto (NDRE 0%) → escolhe o dia anterior completo", () => {
    const corpo = fixtureMultiDia([
      {
        from: "2026-09-18T00:00:00Z", to: "2026-09-19T00:00:00Z",
        medias: mediasCompletas
      },
      {
        from: "2026-09-20T00:00:00Z", to: "2026-09-21T00:00:00Z",
        medias: mediasCompletas,
        porIndice: {
          ndre: { sampleCount: 100, noDataCount: 100, mean: null, min: null, max: null, stDev: null }
        }
      }
    ]);
    const r = escolherObservacaoPastagem(interpretarEstatisticaMulti(corpo, janela), 100, null);
    expect(r.situacao).toBe("concluida");
    expect(r.observacao!.inicio.toISOString()).toBe("2026-09-18T00:00:00.000Z");
    for (const i of r.indices) {
      expect(i.situacao).toBe("concluida");
      expect(i.observacao!.inicio.toISOString()).toBe("2026-09-18T00:00:00.000Z");
      expect(i.valores).not.toBeNull();
    }
  });

  it("B: só NDVI útil → sem_observacao_util; nenhum índice vira 0; sem TypeError", () => {
    const corpo = fixtureOficial(mediasCompletas, {
      porIndice: {
        ndre: { sampleCount: 100, noDataCount: 100, mean: null, min: null, max: null, stDev: null }
      }
    });
    const r = escolherObservacaoPastagem(interpretarEstatisticaMulti(corpo, janela), 100, null);
    expect(r.situacao).toBe("sem_observacao_util");
    expect(r.motivo).toBe("cobertura_insuficiente");
    for (const i of r.indices) {
      expect(i.situacao).toBe("sem_observacao_util");
      expect(i.valores).toBeNull();
    }
  });

  it("C: NDMI com válidos mas cobertura abaixo do critério → dia não útil", () => {
    // 50 válidos / 100 geometria = 0.5 < 0.6 cobertura mínima
    const corpo = fixtureOficial(mediasCompletas, {
      porIndice: {
        ndmi: { sampleCount: 100, noDataCount: 50 }
      }
    });
    const r = escolherObservacaoPastagem(interpretarEstatisticaMulti(corpo, janela), 100, null);
    expect(r.situacao).toBe("sem_observacao_util");
    expect(r.motivo).toBe("cobertura_insuficiente");
  });

  it("D: valor4 rejeita null/NaN/Infinity; zero válidos não vira 0.0000", () => {
    expect(() => valor4(null, -1, 1)).toThrow(FalhaCopernicus);
    expect(() => valor4(undefined, -1, 1)).toThrow(FalhaCopernicus);
    expect(() => valor4(NaN, -1, 1)).toThrow(FalhaCopernicus);
    expect(() => valor4(Infinity, -1, 1)).toThrow(FalhaCopernicus);
    expect(() => valor4("0.5", -1, 1)).toThrow(FalhaCopernicus);
    expect(valor4(0.5, -1, 1)).toBe("0.5000");
    const corpo = fixtureOficial(mediasCompletas, {
      porIndice: {
        ndre: { sampleCount: 100, noDataCount: 100, mean: null, min: null, max: null, stDev: null }
      }
    });
    expect(() => escolherObservacaoPastagem(interpretarEstatisticaMulti(corpo, janela), 100, null))
      .not.toThrow();
    const r = escolherObservacaoPastagem(interpretarEstatisticaMulti(corpo, janela), 100, null);
    expect(r.situacao).toBe("sem_observacao_util");
    expect(r.indices.every((i) => i.valores === null)).toBe(true);
  });

  it("E: data alvo incompleta → sem_observacao_util sem fallback silencioso", () => {
    const corpo = fixtureMultiDia([
      {
        from: "2026-09-18T00:00:00Z", to: "2026-09-19T00:00:00Z",
        medias: mediasCompletas
      },
      {
        from: "2026-09-20T00:00:00Z", to: "2026-09-21T00:00:00Z",
        medias: mediasCompletas,
        porIndice: {
          ndre: { sampleCount: 100, noDataCount: 100, mean: null, min: null, max: null, stDev: null }
        }
      }
    ]);
    const r = escolherObservacaoPastagem(interpretarEstatisticaMulti(corpo, janela), 100, "2026-09-20");
    expect(r.situacao).toBe("sem_observacao_util");
    expect(r.motivo).toBe("cobertura_insuficiente");
    expect(r.observacao).toBeNull();
    // NÃO caiu no dia 18 completo
    expect(r.indices.every((i) => i.valores === null)).toBe(true);
  });

  it("MSAVI2 < -1 (reflectância >1) é materializado quando o bundle é completo", () => {
    const msavi = calcularMsavi2(0, 1.5)!;
    expect(msavi).toBeLessThan(-1);
    const corpo = fixtureOficial(
      { ...mediasCompletas, msavi2: msavi },
      { msavi2Min: msavi, porIndice: { msavi2: { min: msavi, max: -0.5, mean: msavi } } }
    );
    const r = escolherObservacaoPastagem(interpretarEstatisticaMulti(corpo, janela), 100, null);
    expect(r.situacao).toBe("concluida");
    expect(Number(r.indices.find((i) => i.indice === "msavi2")!.valores!.minimo)).toBeLessThan(-1);
  });
});
