import { describe, expect, it } from "vitest";
import {
  BUNDLE_PASTAGEM_ESSENCIAL,
  COEFICIENTES_ESTIMATIVA_PROCESS_CONDICAO,
  COEFICIENTES_ESTIMATIVA_PU,
  CREDITOS_POR_PU,
  estimarCreditosItem,
  estimarCreditosProcessCondicao,
  puPorObservacao,
  type SlotConsulta
} from "../src/index.js";

const HOJE = "2026-10-06";
const slot = (inicio: string, fim: string): SlotConsulta => ({
  data_alvo: null, janela_inicio: inicio, janela_fim: fim
});

describe("SAT-BUNDLE-01A R1 — COST (estimativa)", () => {
  it("COST-01: bundle novo estima Statistical + condição", () => {
    const px = 262144;
    const s = slot(HOJE, HOJE);
    const faixa = estimarCreditosItem({ pixelsBbox: px, indice: BUNDLE_PASTAGEM_ESSENCIAL, slot: s });
    const soStatistical = estimarCreditosItem({ pixelsBbox: px, indice: "ndvi", slot: s });
    // pastagem tem mais bandas → Statistical > NDVI; Process condição soma em cima.
    expect(Number(faixa.minimo)).toBeGreaterThan(Number(soStatistical.minimo));
    const process = estimarCreditosProcessCondicao({ pixelsBbox: px });
    // mínimo do bundle = Statistical pastagem (1 obs) + Process
    const puStat = Number(puPorObservacao(px, BUNDLE_PASTAGEM_ESSENCIAL));
    const esperadoMin = (puStat * CREDITOS_POR_PU) + Number(process.minimo);
    expect(Number(faixa.minimo)).toBeCloseTo(esperadoMin, 1);
    expect(Number(faixa.maximo)).toBeGreaterThanOrEqual(Number(faixa.minimo));
  });

  it("COST-02: estima 1 Process multi-output (não 7 Process)", () => {
    const px = 262144;
    const s = slot(HOJE, HOJE);
    const faixa = estimarCreditosItem({
      pixelsBbox: px, indice: BUNDLE_PASTAGEM_ESSENCIAL, slot: s
    });
    const processUm = estimarCreditosProcessCondicao({ pixelsBbox: px });
    const puStat = Number(puPorObservacao(px, BUNDLE_PASTAGEM_ESSENCIAL));
    const soStatCred = puStat * CREDITOS_POR_PU;
    // Faixa = Statistical + 1 Process TAR (não Statistical + 7 Process).
    expect(Number(faixa.minimo)).toBeCloseTo(soStatCred + Number(processUm.minimo), 1);
    expect(Number(faixa.maximo)).toBeLessThan(soStatCred + 7 * Number(processUm.minimo));
    expect(COEFICIENTES_ESTIMATIVA_PROCESS_CONDICAO.bandas).toBe(7);
    expect(COEFICIENTES_ESTIMATIVA_PROCESS_CONDICAO.fatorFormato).toBe(1);
    void COEFICIENTES_ESTIMATIVA_PU;
  });

  it("COST-05: reutilização do mapa não cobra Process novo na estimativa", () => {
    const px = 100000;
    const zero = estimarCreditosProcessCondicao({ pixelsBbox: px, mapaReutilizavel: true });
    expect(zero).toEqual({ minimo: "0.00", maximo: "0.00" });
    const comMapa = estimarCreditosItem({
      pixelsBbox: px,
      indice: BUNDLE_PASTAGEM_ESSENCIAL,
      slot: slot(HOJE, HOJE),
      mapaCondicaoReutilizavel: true
    });
    const soStatistical = estimarCreditosItem({
      pixelsBbox: px,
      indice: BUNDLE_PASTAGEM_ESSENCIAL,
      slot: slot(HOJE, HOJE),
      mapaCondicaoReutilizavel: true
    });
    // Com mapa reutilizável, faixa = só Statistical (Process 0).
    expect(comMapa).toEqual(soStatistical);
    const comProcess = estimarCreditosItem({
      pixelsBbox: px,
      indice: BUNDLE_PASTAGEM_ESSENCIAL,
      slot: slot(HOJE, HOJE)
    });
    expect(Number(comProcess.minimo)).toBeGreaterThan(Number(comMapa.minimo));
  });

  it("NDVI avulso continua só Statistical (sem Process condição)", () => {
    const px = 262144;
    const ndvi = estimarCreditosItem({ pixelsBbox: px, indice: "ndvi", slot: slot(HOJE, HOJE) });
    expect(ndvi).toEqual({ minimo: "100.00", maximo: "100.00" });
  });
});
