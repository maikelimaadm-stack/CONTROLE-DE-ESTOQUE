import { describe, expect, it } from "vitest";
import {
  INDICES_BUNDLE_ESSENCIAL,
  VERSAO_CLASSIFICADOR_CONDICAO_PASTO,
  VERSAO_CLASSIFICADOR_CONDICAO_PASTO_V2,
  VERSAO_METODO_PASTAGEM_ESSENCIAL,
  TEMAS_VISUALIZACAO_SATELITE,
  SUBPRODUTOS_COBERTURA_SOLO,
  classificarUmidadePastoNdmi,
  identidadeDoBundle,
  bundleIndicesCompleto,
  statusBundleDe,
  produtoRasterIndisponivel,
  classificarPixelCondicaoPasto,
  type LinhaIndiceParaIdentidade,
  type SinalIndiceObservacao,
  type IdIndiceSatelite
} from "../src/index.js";

const ORG = "11111111-1111-4111-8111-111111111111";
const EMP = "22222222-2222-4222-8222-222222222222";
const AREA = "33333333-3333-4333-8333-333333333333";
const HASH = "a".repeat(64);
const INICIO = "2026-10-01T13:00:00.000Z";
const FIM = "2026-10-01T13:05:00.000Z";

function linha(indice: string, extra: Partial<LinhaIndiceParaIdentidade> = {}): LinhaIndiceParaIdentidade {
  return {
    indice,
    organization_id: ORG,
    empresa_id: EMP,
    area_id: AREA,
    geometria_sha256: HASH,
    versao_metodo: VERSAO_METODO_PASTAGEM_ESSENCIAL,
    observacao_inicio: INICIO,
    observacao_fim: FIM,
    colecao: "sentinel-2-l2a",
    provedor: "copernicus_cdse",
    ...extra
  };
}

function seis(extra: Partial<LinhaIndiceParaIdentidade> = {}): LinhaIndiceParaIdentidade[] {
  return INDICES_BUNDLE_ESSENCIAL.map((i) => linha(i, extra));
}

describe("SAT-BUNDLE-01A — identidade do bundle (BND)", () => {
  it("BND-02: seis linhas da mesma observação formam identidade", () => {
    const id = identidadeDoBundle(seis());
    expect(id).not.toBeNull();
    expect(id!.data_imagem).toBe("2026-10-01");
    expect(id!.versao_metodo).toBe("pastagem-essencial-v2");
    expect(id!.area_id).toBe(AREA);
  });

  it("BND-03: índice de data diferente invalida bundle", () => {
    const linhas = seis();
    linhas[3] = linha("ndmi", { observacao_inicio: "2026-10-02T13:00:00.000Z", observacao_fim: "2026-10-02T13:05:00.000Z" });
    expect(identidadeDoBundle(linhas)).toBeNull();
  });

  it("remover um dos seis invalida completo", () => {
    expect(identidadeDoBundle(seis().slice(0, 5))).toBeNull();
    const indices = Object.fromEntries(
      INDICES_BUNDLE_ESSENCIAL.map((i) => [i, i === "bsi" ? null : { indice: i, analise_id: "x", media: "0.1", minimo: null, maximo: null, desvio_padrao: null, cobertura_valida: "0.9", pixels_validos: 10, resolucao_nativa_m: 20, percentis: null, histograma: null }])
    ) as Record<IdIndiceSatelite, SinalIndiceObservacao | null>;
    expect(bundleIndicesCompleto(indices)).toBe(false);
  });

  it("BND-06: geometria diferente invalida", () => {
    const linhas = seis();
    linhas[1] = linha("evi2", { geometria_sha256: "b".repeat(64) });
    expect(identidadeDoBundle(linhas)).toBeNull();
  });
});

describe("SAT-BUNDLE-01A — temas", () => {
  it("quatro temas canônicos com sinais explícitos", () => {
    expect(TEMAS_VISUALIZACAO_SATELITE.map((t) => t.id)).toEqual([
      "condicao", "umidade", "vigor", "cobertura_solo"
    ]);
    const vigor = TEMAS_VISUALIZACAO_SATELITE.find((t) => t.id === "vigor")!;
    expect(vigor.sinal_espacial_primario).toBe("ndre");
    expect(vigor.sinais).toEqual(["ndre", "evi2", "ndvi"]);
    const umid = TEMAS_VISUALIZACAO_SATELITE.find((t) => t.id === "umidade")!;
    expect(umid.sinal_espacial_primario).toBe("ndmi");
    expect(umid.ajuda.toLowerCase()).toContain("não é umidade volumétrica");
    expect(SUBPRODUTOS_COBERTURA_SOLO.cobertura.indice).toBe("msavi2");
    expect(SUBPRODUTOS_COBERTURA_SOLO.solo.indice).toBe("bsi");
  });

  it("umidade experimental: baixa / moderada / adequada / alta", () => {
    expect(classificarUmidadePastoNdmi(-0.1)).toBe("baixa");
    expect(classificarUmidadePastoNdmi(0.05)).toBe("moderada");
    expect(classificarUmidadePastoNdmi(0.2)).toBe("adequada");
    expect(classificarUmidadePastoNdmi(0.35)).toBe("alta");
    expect(classificarUmidadePastoNdmi(null)).toBe("indeterminada");
  });
});

describe("SAT-BUNDLE-01A — status do bundle / produtos", () => {
  it("completo = índices + condição + 6 rasters (SAT-BUNDLE-01C)", () => {
    const id = identidadeDoBundle(seis())!;
    expect(statusBundleDe({
      identidade: id, indicesCompletos: true, condicaoDisponivel: false, rastersDisponiveis: 6
    })).toBe("produtos_parciais");
    expect(statusBundleDe({
      identidade: id, indicesCompletos: true, condicaoDisponivel: true, rastersDisponiveis: 0
    })).toBe("produtos_parciais");
    expect(statusBundleDe({
      identidade: id, indicesCompletos: true, condicaoDisponivel: true, rastersDisponiveis: 5
    })).toBe("produtos_parciais");
    expect(statusBundleDe({
      identidade: id, indicesCompletos: true, condicaoDisponivel: true, rastersDisponiveis: 6
    })).toBe("completo");
  });

  it("SCI-01 / CLS-03: baixa cobertura + NDMI baixo → baixa cobertura (não estresse)", () => {
    expect(classificarPixelCondicaoPasto({
      dataMask: 1, scl: 4,
      ndvi: 0.28, evi2: 0.18, ndre: 0.12, ndmi: -0.15, msavi2: 0.18, bsi: 0.02
    })).toBe(3);
  });

  it("produto indisponível declarado, não inventado", () => {
    const p = produtoRasterIndisponivel("ndvi");
    expect(p.disponivel).toBe(false);
    expect(p.raster_id).toBeNull();
    expect(p.status).toBe("indisponivel");
  });
});

describe("SAT-BUNDLE-01A — classificador v3 (CLS / pasto verde)", () => {
  it("CLS-08: v2 não é a versão operacional", () => {
    expect(VERSAO_CLASSIFICADOR_CONDICAO_PASTO).toBe("condicao-pasto-v3");
    expect(VERSAO_CLASSIFICADOR_CONDICAO_PASTO_V2).toBe("condicao-pasto-v2");
    expect(VERSAO_CLASSIFICADOR_CONDICAO_PASTO).not.toBe(VERSAO_CLASSIFICADOR_CONDICAO_PASTO_V2);
  });

  it("CLS-01 / CASO A: pasto verde → boa cobertura", () => {
    expect(classificarPixelCondicaoPasto({
      dataMask: 1, scl: 4,
      ndvi: 0.65, evi2: 0.55, ndre: 0.35, ndmi: 0.22, msavi2: 0.58, bsi: -0.18
    })).toBe(1);
  });

  it("CLS-02 / CASO B: NDMI marginal isolado NÃO vira estresse", () => {
    // cobertura/vigor bons, NDMI no limiar (0.0) — não agressivo
    expect(classificarPixelCondicaoPasto({
      dataMask: 1, scl: 4,
      ndvi: 0.55, evi2: 0.42, ndre: 0.28, ndmi: 0.0, msavi2: 0.48, bsi: -0.1
    })).not.toBe(4);
  });

  it("CLS-03 / CASO C: baixa cobertura + NDMI baixo → baixa cobertura", () => {
    expect(classificarPixelCondicaoPasto({
      dataMask: 1, scl: 4,
      ndvi: 0.28, evi2: 0.18, ndre: 0.12, ndmi: -0.15, msavi2: 0.18, bsi: 0.02
    })).toBe(3);
  });

  it("CLS-04: solo forte → solo exposto", () => {
    expect(classificarPixelCondicaoPasto({
      dataMask: 1, scl: 5,
      ndvi: 0.08, evi2: 0.04, ndre: 0.03, ndmi: 0.05, msavi2: 0.10, bsi: 0.32
    })).toBe(5);
  });

  it("CLS-05 / CASO D: vegetação suficiente + vigor + NDMI baixo → estresse", () => {
    expect(classificarPixelCondicaoPasto({
      dataMask: 1, scl: 4,
      ndvi: 0.52, evi2: 0.41, ndre: 0.28, ndmi: -0.12, msavi2: 0.46, bsi: -0.08
    })).toBe(4);
  });

  it("CLS-06: água não vira outra classe", () => {
    expect(classificarPixelCondicaoPasto({
      dataMask: 1, scl: 6,
      ndvi: 0.02, evi2: 0.01, ndre: 0.01, ndmi: 0.4, msavi2: 0.02, bsi: 0.9
    })).toBe(6);
  });

  it("CLS-07: nodata → sem leitura", () => {
    expect(classificarPixelCondicaoPasto({
      dataMask: 0, scl: 4,
      ndvi: 0.65, evi2: 0.55, ndre: 0.35, ndmi: 0.22, msavi2: 0.58, bsi: -0.18
    })).toBe(0);
  });

  it("CASO E: sinais insuficientes → sem leitura (nunca inventa capim ruim)", () => {
    expect(classificarPixelCondicaoPasto({
      dataMask: 1, scl: 4,
      ndvi: null, evi2: 0.3, ndre: 0.2, ndmi: 0.1, msavi2: 0.3, bsi: 0
    })).toBe(0);
  });
});
