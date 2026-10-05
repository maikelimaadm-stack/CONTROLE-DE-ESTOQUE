import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { CLASSES_SCL_EXCLUIDAS, INDICES_BUNDLE_ESSENCIAL } from "@agro/domain";
import {
  EVALSCRIPT_PASTAGEM_ESSENCIAL,
  EVALSCRIPT_PASTAGEM_SHA256,
  RESOLUCAO_AGREGACAO_M,
  escolherObservacaoPastagem,
  interpretarEstatisticaMulti,
  montarCalculationsPastagem,
  montarCorpoPastagem
} from "../../src/lib/satelite/pastagem-essencial.js";
import { FalhaCopernicus } from "../../src/lib/satelite/copernicus.js";
import type { PoligonoGeoJson } from "../../src/lib/satelite/geometria.js";

const janela = { inicio: new Date("2026-09-01T00:00:00Z"), fim: new Date("2026-10-01T00:00:00Z") };
const poligono: PoligonoGeoJson = {
  type: "Polygon",
  coordinates: [[[-47.1, -15.8], [-47.0, -15.8], [-47.0, -15.7], [-47.1, -15.7], [-47.1, -15.8]]]
};

function stats(mean: number, extras: Record<string, unknown> = {}) {
  return {
    bands: {
      B0: {
        stats: {
          sampleCount: 100, noDataCount: 20, mean, min: mean - 0.1, max: mean + 0.1, stDev: 0.05,
          percentiles: { "5": mean - 0.08, "10": mean - 0.06, "25": mean - 0.03, "50": mean, "75": mean + 0.03, "90": mean + 0.06, "95": mean + 0.08 }
        },
        histogram: { bins: [-1, -0.5, 0, 0.2, 0.4, 0.6, 1], counts: [2, 3, 10, 20, 30, 15] },
        ...extras
      }
    }
  };
}

function corpoDia(from: string, to: string, medias: Record<string, number>) {
  const outputs: Record<string, unknown> = {};
  for (const id of INDICES_BUNDLE_ESSENCIAL) outputs[id] = stats(medias[id] ?? 0.4);
  outputs.scl = {
    bands: {
      B0: { histogram: { bins: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], counts: [0, 0, 0, 5, 60, 20, 0, 5, 5, 5, 0, 0] } }
    }
  };
  return { data: [{ interval: { from, to }, outputs }], status: "OK" };
}

describe("SAT-08 — pastagem essencial", () => {
  it("evalscript declara os 6 índices + scl + dataMask e mascara SCL do domínio", () => {
    expect(EVALSCRIPT_PASTAGEM_ESSENCIAL).toContain('id: "ndvi"');
    expect(EVALSCRIPT_PASTAGEM_ESSENCIAL).toContain('id: "evi2"');
    expect(EVALSCRIPT_PASTAGEM_ESSENCIAL).toContain('id: "ndre"');
    expect(EVALSCRIPT_PASTAGEM_ESSENCIAL).toContain('id: "ndmi"');
    expect(EVALSCRIPT_PASTAGEM_ESSENCIAL).toContain('id: "msavi2"');
    expect(EVALSCRIPT_PASTAGEM_ESSENCIAL).toContain('id: "bsi"');
    expect(EVALSCRIPT_PASTAGEM_ESSENCIAL).toContain('id: "scl"');
    expect(EVALSCRIPT_PASTAGEM_ESSENCIAL).toContain('id: "dataMask"');
    expect(EVALSCRIPT_PASTAGEM_ESSENCIAL).toContain("B8A");
    for (const [c] of CLASSES_SCL_EXCLUIDAS) expect(EVALSCRIPT_PASTAGEM_ESSENCIAL).toContain(String(c));
    expect(EVALSCRIPT_PASTAGEM_SHA256).toBe(createHash("sha256").update(EVALSCRIPT_PASTAGEM_ESSENCIAL, "utf8").digest("hex"));
  });

  it("calculations casam aos output IDs (nunca só default para outputs nomeados)", () => {
    const c = montarCalculationsPastagem() as Record<string, unknown>;
    for (const id of INDICES_BUNDLE_ESSENCIAL) expect(c[id]).toBeTruthy();
    expect(c.scl).toBeTruthy();
    expect(Object.keys(c).sort()).toEqual(["bsi", "evi2", "msavi2", "ndmi", "ndre", "ndvi", "scl"].sort());
  });

  it("corpo pede agregação 20 m e calculations por output", () => {
    const corpo = montarCorpoPastagem(poligono, janela, { resx: 0.0002, resy: 0.0002 });
    expect(RESOLUCAO_AGREGACAO_M).toBe(20);
    expect(corpo.aggregation.evalscript).toBe(EVALSCRIPT_PASTAGEM_ESSENCIAL);
    expect(corpo.calculations).toEqual(montarCalculationsPastagem());
  });

  it("interpreta multi-output e escolhe observação útil", () => {
    const corpo = corpoDia("2026-09-20T00:00:00Z", "2026-09-21T00:00:00Z", {
      ndvi: 0.55, evi2: 0.48, ndre: 0.35, ndmi: 0.12, msavi2: 0.5, bsi: -0.1
    });
    const lida = interpretarEstatisticaMulti(corpo, janela);
    const r = escolherObservacaoPastagem(lida, 100, null);
    expect(r.situacao).toBe("concluida");
    expect(r.indices).toHaveLength(6);
    expect(r.indices.find((i) => i.indice === "ndvi")!.resolucao_nativa_m).toBe(10);
    expect(r.indices.find((i) => i.indice === "ndre")!.resolucao_nativa_m).toBe(20);
    expect(r.indicadores.experimental).toBe(true);
    expect(r.indicadores.resposta_vegetacao.toLowerCase()).not.toMatch(/pasto bom/);
    expect(r.qualidade.mascara.cld).toBe(false);
  });

  it("resposta sem output nomeado → malformada", () => {
    const corpo = {
      data: [{
        interval: { from: "2026-09-20T00:00:00Z", to: "2026-09-21T00:00:00Z" },
        outputs: { default: stats(0.5) }
      }]
    };
    expect(() => interpretarEstatisticaMulti(corpo, janela)).toThrow(FalhaCopernicus);
  });

  it("NDRE não é declarado como 10 m no catálogo do resultado", () => {
    const corpo = corpoDia("2026-09-20T00:00:00Z", "2026-09-21T00:00:00Z", {
      ndvi: 0.5, evi2: 0.4, ndre: 0.3, ndmi: 0.1, msavi2: 0.45, bsi: 0
    });
    const r = escolherObservacaoPastagem(interpretarEstatisticaMulti(corpo, janela), 100, null);
    expect(r.indices.find((i) => i.indice === "ndre")!.resolucao_nativa_m).not.toBe(10);
  });
});
