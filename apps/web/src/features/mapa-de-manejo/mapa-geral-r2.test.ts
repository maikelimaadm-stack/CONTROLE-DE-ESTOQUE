import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";
import { DATA_ULTIMA_IMAGEM, chaveDaData, dataEscolhida } from "./data-camada";
import { areasDesatualizadas } from "./consulta-satelite";

/**
 * SATÉLITE COMPLETO R2 — painel único + identidade índice×data×método no frontend.
 * Provas estáticas do Mapa geral (sem React mount) e regras puras de data/desatualizadas.
 */

const mapaGeralSrc = readFileSync(resolve(__dirname, "mapa-geral.tsx"), "utf8");
const ndviSrc = readFileSync(resolve(__dirname, "ndvi.tsx"), "utf8");
const rastersIndiceSrc = readFileSync(resolve(__dirname, "rasters-indice.ts"), "utf8");
const condicaoSrc = readFileSync(resolve(__dirname, "condicao-area.tsx"), "utf8");

describe("SAT-FINAL R2 — painel único Condição da Área (UI)", () => {
  it("UI-1: Mapa geral monta CondicaoDaArea como painel analítico", () => {
    expect(mapaGeralSrc).toMatch(/<CondicaoDaArea[\s\S]*?\/>/);
    expect(mapaGeralSrc).toContain('from "./condicao-area"');
  });

  it("UI-2: Mapa geral NÃO monta NdviDaArea (sem dois contratos NDVI)", () => {
    expect(mapaGeralSrc).not.toMatch(/<NdviDaArea[\s\S]*?\/>/);
    expect(mapaGeralSrc).not.toContain("NdviDaArea");
  });

  it("UI-3: listagem da condição usa contexto=condicao (método v2 no backend)", () => {
    expect(rastersIndiceSrc).toContain('contexto: "condicao"');
    expect(ndviSrc).toContain('contexto: "condicao"');
    // Helper de geração permanece no módulo de rasters (Comparar / legado API); painel não o chama.
    expect(rastersIndiceSrc).toContain("gerarRasterDaAnalise");
  });

  it("UI-4: CondicaoDaArea não dispara POST Process ao montar (01B: sem Gerar raster / Analisar área)", () => {
    expect(condicaoSrc).not.toContain("condicao-gerar-raster");
    expect(condicaoSrc).not.toContain("condicao-analisar-atual");
    expect(condicaoSrc).not.toContain("gerarRasterDaAnalise");
    expect(condicaoSrc).toContain("Analisar pastos");
    expect(condicaoSrc).not.toContain("condicao-gerar-confirmar");
  });
});

describe("SAT-FINAL R2 — data como identidade da camada (frontend)", () => {
  it("DATA-4: trocar data muda a chave de cache (query key)", () => {
    expect(chaveDaData(dataEscolhida("2026-10-01"))).toBe("data:2026-10-01");
    expect(chaveDaData(dataEscolhida("2026-10-05"))).toBe("data:2026-10-05");
    expect(chaveDaData(dataEscolhida("2026-10-01"))).not.toBe(chaveDaData(dataEscolhida("2026-10-05")));
  });

  it("DATA-5: índice e data são dimensões independentes na chave", () => {
    // useResumoIndice / useRastersIndice incluem indice + chaveDaData — a data permanece ao trocar índice.
    expect(ndviSrc).toMatch(/queryKey:.*indice.*chaveData/);
    expect(rastersIndiceSrc).toMatch(/chaveData/);
    const mesmaData = chaveDaData(dataEscolhida("2026-10-01"));
    expect(mesmaData).toBe("data:2026-10-01");
  });

  it("DATA-6: voltar para Última usa chave 'ultima'", () => {
    expect(chaveDaData(DATA_ULTIMA_IMAGEM)).toBe("ultima");
  });

  it("lista/tooltip: título da média depende do tipo da data (código do Mapa geral)", () => {
    expect(mapaGeralSrc).toContain("médio em ${dateBR(data.data)}");
    expect(mapaGeralSrc).toContain("médio da última imagem útil");
    expect(mapaGeralSrc).toContain('data.tipo === "data"');
  });

  it("desatualizadas: área só com ausência de observação útil no resumo v2", () => {
    const areas = [
      { id: "a1", geometria: { type: "Polygon" } },
      { id: "a2", geometria: { type: "Polygon" } },
      { id: "a3", geometria: null }
    ];
    const porArea = new Map<string, { ultima_observacao: { do_poligono_atual: boolean } | null }>([
      ["a1", { ultima_observacao: { do_poligono_atual: true } }],
      ["a2", { ultima_observacao: null }]
    ]);
    expect(areasDesatualizadas(areas, porArea)).toEqual(["a2"]);
  });
});
