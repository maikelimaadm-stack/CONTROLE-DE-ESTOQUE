/**
 * Paletas dos índices (decisão 301) — verificação reversa: se alguém pintar o byte 0, trocar a escala fixa pelo
 * mínimo/máximo da imagem, duplicar famílias à mão ou divergir do NDVI da SAT-07, estes casos quebram.
 */
import { describe, expect, it } from "vitest";
import { CATALOGO_INDICES, ENCODING_RASTER_POR_INDICE, INDICES_BUNDLE_ESSENCIAL } from "@agro/domain";
import { montarLutNdvi } from "./paleta-ndvi-pixel";
import {
  FAMILIAS_CAMADA,
  PALETAS_INDICES,
  corDoValor,
  escalaDeCodificacao,
  familiaDoIndice,
  gradienteCssDoIndice,
  montarLutIndice
} from "./paletas-indices";

describe("famílias de camada", () => {
  it("vigor = ndvi/evi2/ndre, umidade = ndmi, cobertura/solo = msavi2/bsi (derivadas do catálogo)", () => {
    expect(FAMILIAS_CAMADA.map((f) => [f.id, f.indices])).toEqual([
      ["vigor", ["ndvi", "evi2", "ndre"]],
      ["umidade", ["ndmi"]],
      ["cobertura_solo", ["msavi2", "bsi"]]
    ]);
  });

  it("todo índice do bundle pertence a exatamente uma família, e a família sai da família do catálogo", () => {
    const todos = FAMILIAS_CAMADA.flatMap((f) => f.indices);
    expect([...todos].sort()).toEqual([...INDICES_BUNDLE_ESSENCIAL].sort());
    for (const id of INDICES_BUNDLE_ESSENCIAL) {
      const porFamilia: Readonly<Record<string, string>> = { vegetacao: "vigor", umidade: "umidade", cobertura_solo: "cobertura_solo" };
      const esperado = porFamilia[CATALOGO_INDICES[id].familia];
      expect(familiaDoIndice(id)).toBe(esperado);
    }
  });
});

describe("escala de codificação fixa", () => {
  it.each(INDICES_BUNDLE_ESSENCIAL)("%s: sem metadado usa o encoding versionado do domínio", (id) => {
    const enc = ENCODING_RASTER_POR_INDICE[id];
    expect(escalaDeCodificacao(id)).toEqual({ min: enc.scaleMin, max: enc.scaleMax });
  });

  it("o metadado do próprio raster tem prioridade; escala inválida volta ao encoding", () => {
    expect(escalaDeCodificacao("ndmi", { escala_min: -0.4, escala_max: 0.6 })).toEqual({ min: -0.4, max: 0.6 });
    const enc = ENCODING_RASTER_POR_INDICE.ndmi;
    expect(escalaDeCodificacao("ndmi", { escala_min: 1, escala_max: 1 })).toEqual({ min: enc.scaleMin, max: enc.scaleMax });
    expect(escalaDeCodificacao("ndmi", { escala_min: Number.NaN, escala_max: 1 })).toEqual({ min: enc.scaleMin, max: enc.scaleMax });
  });
});

describe("LUT por índice", () => {
  it.each(INDICES_BUNDLE_ESSENCIAL)("%s: byte 0 é transparente e 1..255 são opacos", (id) => {
    const lut = montarLutIndice(id);
    expect(lut.length).toBe(256 * 4);
    expect([...lut.slice(0, 4)]).toEqual([0, 0, 0, 0]);
    for (let b = 1; b <= 255; b++) expect(lut[b * 4 + 3]).toBe(255);
  });

  it("NDVI reproduz exatamente a LUT validada da SAT-07", () => {
    const enc = ENCODING_RASTER_POR_INDICE.ndvi;
    expect([...montarLutIndice("ndvi")]).toEqual([...montarLutNdvi(enc.scaleMin, enc.scaleMax)]);
  });

  it("a cor de um byte depende da escala de codificação, não do conteúdo da imagem", () => {
    const a = montarLutIndice("ndmi", { min: -0.5, max: 0.5 });
    const b = montarLutIndice("ndmi", { min: -0.2, max: 0.9 });
    expect([...a.slice(128 * 4, 128 * 4 + 3)]).not.toEqual([...b.slice(128 * 4, 128 * 4 + 3)]);
  });

  it("escala inválida lança", () => {
    expect(() => montarLutIndice("bsi", { min: 1, max: -1 })).toThrow(RangeError);
  });
});

describe("paradas", () => {
  it.each(INDICES_BUNDLE_ESSENCIAL)("%s: paradas em ordem crescente e cores válidas", (id) => {
    const p = PALETAS_INDICES[id].paradas;
    expect(p.length).toBeGreaterThanOrEqual(5);
    for (let i = 1; i < p.length; i++) expect(p[i]!.valor).toBeGreaterThan(p[i - 1]!.valor);
    for (const x of p) for (const c of [x.r, x.g, x.b]) expect(c >= 0 && c <= 255).toBe(true);
  });

  it("clamp nas pontas e valor não finito não quebra", () => {
    const p = PALETAS_INDICES.bsi.paradas;
    const primeira = p[0]!;
    const ultima = p[p.length - 1]!;
    expect(corDoValor("bsi", -5)).toEqual([primeira.r, primeira.g, primeira.b]);
    expect(corDoValor("bsi", 5)).toEqual([ultima.r, ultima.g, ultima.b]);
    expect(corDoValor("bsi", Number.NaN)).toEqual([primeira.r, primeira.g, primeira.b]);
  });

  it("BSI é invertido em relação à cobertura: solo exposto é marrom, coberto é verde", () => {
    const coberto = corDoValor("bsi", -0.3);
    const exposto = corDoValor("bsi", 0.3);
    expect(coberto[1]).toBeGreaterThan(coberto[0]);
    expect(exposto[0]).toBeGreaterThan(exposto[1]);
  });

  it("gradiente CSS usa as paradas da paleta (uma por parada)", () => {
    const css = gradienteCssDoIndice("ndmi");
    expect(css.startsWith("linear-gradient(90deg,")).toBe(true);
    expect(css.match(/rgb\(/g)?.length).toBe(PALETAS_INDICES.ndmi.paradas.length);
  });
});
