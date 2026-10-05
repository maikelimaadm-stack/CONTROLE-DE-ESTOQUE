import { describe, it, expect } from "vitest";
import { avaliarAnomaliaSatelite, type PontoSerieIndice } from "../src/index.js";

const H = "a".repeat(64);
const H2 = "b".repeat(64);

function serie(vals: number[], hash = H): PontoSerieIndice[] {
  return vals.map((media, i) => ({
    data: `2026-09-${String(10 + i).padStart(2, "0")}T00:00:00.000Z`,
    media,
    qualidadeOk: true,
    geometriaSha256: hash
  }));
}

describe("SAT-FINAL — anomalia multi-índice", () => {
  it("A-1 série estável → sem alerta falso", () => {
    const r = avaliarAnomaliaSatelite({
      geometriaSha256Atual: H,
      series: {
        ndvi: serie([0.55, 0.56, 0.54, 0.55]),
        ndre: serie([0.4, 0.41, 0.39, 0.4]),
        ndmi: serie([0.1, 0.11, 0.09, 0.1]),
        msavi2: serie([0.5, 0.5, 0.49, 0.5]),
        bsi: serie([0.05, 0.04, 0.05, 0.05])
      }
    });
    expect(r.nivel).toBe("nenhuma");
    expect(r.vistoria_recomendada).toBe(false);
    expect(r.praga_detectada).toBe(false);
    expect(r.biomassa_estimada).toBe(false);
  });

  it("A-2 queda forte multi-índice → possível anomalia + vistoria", () => {
    const r = avaliarAnomaliaSatelite({
      geometriaSha256Atual: H,
      series: {
        ndvi: serie([0.7, 0.68, 0.65, 0.35]),
        ndre: serie([0.5, 0.48, 0.45, 0.2]),
        ndmi: serie([0.15, 0.12, 0.1, -0.15]),
        msavi2: serie([0.6, 0.55, 0.5, 0.25]),
        bsi: serie([0.0, 0.05, 0.1, 0.35])
      }
    });
    expect(["moderada", "forte"]).toContain(r.nivel);
    expect(r.vistoria_recomendada).toBe(true);
    expect(r.motivos.length).toBeGreaterThanOrEqual(2);
    expect(r.praga_detectada).toBe(false);
  });

  it("A-3 só NDVI cai → evita diagnóstico forte", () => {
    const r = avaliarAnomaliaSatelite({
      geometriaSha256Atual: H,
      series: {
        ndvi: serie([0.7, 0.68, 0.65, 0.3]),
        ndre: serie([0.45, 0.44, 0.46, 0.45]),
        ndmi: serie([0.1, 0.11, 0.1, 0.1]),
        msavi2: serie([0.5, 0.5, 0.5, 0.5]),
        bsi: serie([0.05, 0.05, 0.05, 0.05])
      }
    });
    expect(r.nivel).toBe("leve");
    expect(r.vistoria_recomendada).toBe(false);
    expect(r.motivos.some((m) => m.codigo === "sinal_unico")).toBe(true);
  });

  it("A-4 pouca história → dados insuficientes", () => {
    const r = avaliarAnomaliaSatelite({
      geometriaSha256Atual: H,
      series: { ndvi: serie([0.5, 0.2]) }
    });
    expect(r.nivel).toBe("dados_insuficientes");
  });

  it("A-5 mudança de geometria → não compara", () => {
    const misturada: PontoSerieIndice[] = [
      ...serie([0.7, 0.68], H2),
      ...serie([0.3, 0.2], H).map((p, i) => ({ ...p, data: `2026-10-${String(1 + i).padStart(2, "0")}T00:00:00.000Z` }))
    ];
    const r = avaliarAnomaliaSatelite({
      geometriaSha256Atual: H,
      series: { ndvi: misturada, ndre: misturada }
    });
    expect(r.nivel).toBe("dados_insuficientes");
  });

  it("A-6 razões auditáveis + versão", () => {
    const r = avaliarAnomaliaSatelite({
      geometriaSha256Atual: H,
      series: {
        ndvi: serie([0.7, 0.65, 0.6, 0.3]),
        ndre: serie([0.5, 0.45, 0.4, 0.15]),
        ndmi: serie([0.2, 0.1, 0.0, -0.2]),
        bsi: serie([0.0, 0.1, 0.2, 0.4])
      }
    });
    expect(r.versao).toBe("sat-anomalia-v1");
    expect(r.motivos.every((m) => m.codigo && m.mensagem)).toBe(true);
    expect(r.score).not.toBeNull();
  });
});
