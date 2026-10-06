import { describe, expect, it } from "vitest";
import {
  BYTE_FORA_POLIGONO_CONDICAO,
  aplicarMascaraPoligonoNosPixels,
  contarPixelsCondicaoComMascara,
  resumirCondicaoPasto
} from "@agro/domain";
import { lerPoligono, type PoligonoGeoJson } from "../../src/lib/satelite/geometria.js";
import { mascaraPoligonoNaGrade, pontoNoPoligono3857 } from "../../src/lib/satelite/mascara-poligono-raster.js";
import { deLngLatPara3857, planejarGradeRaster } from "../../src/lib/satelite/raster.js";

/** Triângulo dentro de um retângulo largo — a bbox da grade tem muitos pixels fora. */
const TRIANGULO: PoligonoGeoJson = {
  type: "Polygon",
  coordinates: [[
    [-56.10, -15.60],
    [-56.09, -15.60],
    [-56.095, -15.59],
    [-56.10, -15.60]
  ]]
};

const COM_FURO: PoligonoGeoJson = {
  type: "Polygon",
  coordinates: [
    [[-56.10, -15.60], [-56.08, -15.60], [-56.08, -15.58], [-56.10, -15.58], [-56.10, -15.60]],
    [[-56.095, -15.595], [-56.085, -15.595], [-56.085, -15.585], [-56.095, -15.585], [-56.095, -15.595]]
  ]
};

describe("MAPA-UX-02 — máscara geométrica (ESP)", () => {
  it("ESP-01 triângulo em bbox: pixels fora não contam", () => {
    const poli = lerPoligono(TRIANGULO)!;
    const grade = planejarGradeRaster(poli, 20);
    const mascara = mascaraPoligonoNaGrade(poli, grade);
    const fora = [...mascara].filter((v) => v === 0).length;
    const dentro = [...mascara].filter((v) => v === 1).length;
    expect(mascara.length).toBe(grade.largura * grade.altura);
    expect(fora).toBeGreaterThan(0);
    expect(dentro).toBeGreaterThan(0);
    expect(dentro + fora).toBe(mascara.length);
  });

  it("ESP-02/ESP-09 canvas fora: byte FORA (alpha 0 na LUT)", () => {
    const poli = lerPoligono(TRIANGULO)!;
    const grade = planejarGradeRaster(poli, 20);
    const mascara = mascaraPoligonoNaGrade(poli, grade);
    const bruto = new Uint8Array(mascara.length).fill(1);
    const mascarado = aplicarMascaraPoligonoNosPixels(bruto, mascara);
    for (let i = 0; i < mascara.length; i++) {
      if (mascara[i] === 0) expect(mascarado[i]).toBe(BYTE_FORA_POLIGONO_CONDICAO);
      else expect(mascarado[i]).toBe(1);
    }
  });

  it("ESP-03 SEM_LEITURA dentro continua contado", () => {
    const mascara = Uint8Array.from([1, 1, 1, 1]);
    const pixels = Uint8Array.from([0, 0, 1, 2]);
    const r = contarPixelsCondicaoComMascara(pixels, mascara);
    expect(r.contagem[0]).toBe(2);
    expect(r.universo).toBe(4);
    expect(r.pixelsForaPoligono).toBe(0);
  });

  it("ESP-04 SEM_LEITURA fora não existe para resumo", () => {
    const mascara = Uint8Array.from([0, 0, 1, 1]);
    const pixels = Uint8Array.from([0, 0, 1, 1]); // 0s estão FORA
    const r = contarPixelsCondicaoComMascara(pixels, mascara);
    expect(r.contagem[0]).toBe(0);
    expect(r.contagem[1]).toBe(2);
    expect(r.universo).toBe(2);
    expect(r.pixelsForaPoligono).toBe(2);
  });

  it("ESP-05 polígono com furo: furo não conta", () => {
    const poli = lerPoligono(COM_FURO)!;
    const grade = planejarGradeRaster(poli, 20);
    const mascara = mascaraPoligonoNaGrade(poli, grade);
    // Centro aproximado do furo em 3857
    const [fx, fy] = deLngLatPara3857(-56.09, -15.59);
    expect(pontoNoPoligono3857(fx, fy, poli.coordinates.map((a) => a.map(([lng, lat]) => deLngLatPara3857(lng, lat))))).toBe(false);
    const dentro = [...mascara].reduce((s, v) => s + v, 0);
    expect(dentro).toBeGreaterThan(0);
    expect(dentro).toBeLessThan(mascara.length);
  });

  it("ESP-06/07/08 hectares fecham area_total; universo = internos; bbox não vira área", () => {
    const poli = lerPoligono(TRIANGULO)!;
    const grade = planejarGradeRaster(poli, 20);
    const mascara = mascaraPoligonoNaGrade(poli, grade);
    const pixels = new Uint8Array(mascara.length);
    for (let i = 0; i < mascara.length; i++) pixels[i] = mascara[i] === 1 ? (i % 3 === 0 ? 0 : 1) : 0;
    const { contagem, universo, pixelsForaPoligono } = contarPixelsCondicaoComMascara(pixels, mascara);
    expect(universo).toBe([...mascara].reduce((s, v) => s + v, 0));
    expect(pixelsForaPoligono).toBe(mascara.length - universo);
    expect(universo).toBeLessThan(mascara.length);
    const resumo = resumirCondicaoPasto({ contagem, areaTotalHa: 100, resolucaoM: 20, pixelsForaPoligono });
    const somaHa = resumo.classes.reduce((s, c) => s + Number(c.area_estimada_ha), 0);
    expect(somaHa).toBeCloseTo(100, 6);
    expect(resumo.pixels_universo).toBe(universo);
    expect(resumo.pixels_fora_poligono).toBe(pixelsForaPoligono);
    // Nunca: bbox inteira como se fosse o pasto
    expect(resumo.pixels_universo).not.toBe(mascara.length);
  });

  it("ESP-10 v1 não é a versão operacional", async () => {
    const { VERSAO_CLASSIFICADOR_CONDICAO_PASTO, VERSAO_CLASSIFICADOR_CONDICAO_PASTO_V1 } = await import("@agro/domain");
    expect(VERSAO_CLASSIFICADOR_CONDICAO_PASTO).toBe("condicao-pasto-v2");
    expect(VERSAO_CLASSIFICADOR_CONDICAO_PASTO_V1).toBe("condicao-pasto-v1");
    expect(VERSAO_CLASSIFICADOR_CONDICAO_PASTO).not.toBe(VERSAO_CLASSIFICADOR_CONDICAO_PASTO_V1);
  });
});
