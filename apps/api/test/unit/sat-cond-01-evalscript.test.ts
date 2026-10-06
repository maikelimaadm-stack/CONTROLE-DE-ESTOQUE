import { describe, expect, it } from "vitest";
import {
  LIMIARES_CLASSIFICADOR_CONDICAO_PASTO,
  VERSAO_EVALSCRIPT_CONDICAO_PASTO,
  chaveIdentidadeMapaCondicao
} from "@agro/domain";
import type { PoligonoGeoJson } from "../../src/lib/satelite/geometria.js";
import { EVALSCRIPT_CONDICAO_PASTO_V1 } from "../../src/lib/satelite/evalscript-condicao-pasto.js";
import { chaveCacheCondicaoPasto, montarCorpoProcessoCondicao, planejarGradeCondicao } from "../../src/lib/satelite/raster-condicao-pasto.js";

describe("SAT-COND-01 evalscript e Process", () => {
  it("interpola os thresholds do SSOT e sai UINT8", () => {
    const L = LIMIARES_CLASSIFICADOR_CONDICAO_PASTO;
    expect(EVALSCRIPT_CONDICAO_PASTO_V1).toContain(VERSAO_EVALSCRIPT_CONDICAO_PASTO);
    expect(EVALSCRIPT_CONDICAO_PASTO_V1).toContain('sampleType: "UINT8"');
    expect(EVALSCRIPT_CONDICAO_PASTO_V1).toContain(`MSAVI2_BOA = ${JSON.stringify(L.msavi2BoaCobertura)}`);
    expect(EVALSCRIPT_CONDICAO_PASTO_V1).toContain(`NDMI_BAIXA = ${JSON.stringify(L.ndmiBaixa)}`);
    expect(EVALSCRIPT_CONDICAO_PASTO_V1).toContain("return [6]");
    expect(EVALSCRIPT_CONDICAO_PASTO_V1).toContain("return [0]");
    expect(EVALSCRIPT_CONDICAO_PASTO_V1).not.toMatch(/linear|FLOAT32/i);
  });

  it("chave de cache muda com geometria, data e versão", () => {
    const base = {
      areaId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      geometriaSha256: "ab".repeat(32),
      dataImagem: "2026-10-05",
      colecao: "sentinel-2-l2a",
      versaoClassificador: "condicao-pasto-v2",
      versaoEvalscript: "condicao-pasto-v1",
      resolucaoM: 20,
      crs: "EPSG:3857",
      formato: "image/png"
    };
    const a = chaveCacheCondicaoPasto(base);
    const b = chaveCacheCondicaoPasto({ ...base, geometriaSha256: "cd".repeat(32) });
    const c = chaveCacheCondicaoPasto({ ...base, dataImagem: "2026-10-01" });
    const d = chaveCacheCondicaoPasto({ ...base, versaoClassificador: "condicao-pasto-v1" });
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(new Set([a, b, c, d]).size).toBe(4);
  });

  it("corpo da Process API usa a janela da observação (sem misturar datas)", () => {
    const poli: PoligonoGeoJson = { type: "Polygon", coordinates: [[[-56.1, -15.6], [-56.1, -15.59], [-56.09, -15.59], [-56.09, -15.6], [-56.1, -15.6]]] };
    const grade = planejarGradeCondicao(poli);
    expect(grade.resolucaoAlvoM).toBe(20);
    const corpo = montarCorpoProcessoCondicao(grade, {
      inicio: new Date("2026-10-05T13:00:00Z"),
      fim: new Date("2026-10-05T13:10:00Z")
    }) as { input: { data: { dataFilter: { timeRange: { from: string; to: string } } }[] }; evalscript: string };
    expect(corpo.input.data[0]!.dataFilter.timeRange.from).toBe("2026-10-05T13:00:00.000Z");
    expect(corpo.input.data[0]!.dataFilter.timeRange.to).toBe("2026-10-05T13:10:00.000Z");
    expect(corpo.evalscript).toBe(EVALSCRIPT_CONDICAO_PASTO_V1);
  });

  it("identidade de domínio e chave de cache discordam se a data muda", () => {
    const idA = chaveIdentidadeMapaCondicao({
      organizationId: "11111111-1111-4111-8111-111111111111",
      empresaId: "22222222-2222-4222-8222-222222222222",
      areaId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      geometriaSha256: "ab".repeat(32),
      dataImagem: "2026-10-01",
      versaoClassificador: "condicao-pasto-v2",
      versaoEvalscript: "condicao-pasto-v1",
      resolucaoM: 20,
      fonte: "sentinel-2-l2a"
    });
    const idB = chaveIdentidadeMapaCondicao({
      organizationId: "11111111-1111-4111-8111-111111111111",
      empresaId: "22222222-2222-4222-8222-222222222222",
      areaId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      geometriaSha256: "ab".repeat(32),
      dataImagem: "2026-10-05",
      versaoClassificador: "condicao-pasto-v2",
      versaoEvalscript: "condicao-pasto-v1",
      resolucaoM: 20,
      fonte: "sentinel-2-l2a"
    });
    expect(idA).not.toBe(idB);
  });
});
