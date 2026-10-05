/**
 * SAT-07 — testes da paleta/LUT de NDVI pixel a pixel.
 *
 * Verificação reversa (sabotagem): se alguém pintar o byte 0, hardcodar a escala (−0,2..1)
 * dentro da LUT, ou trocar a paleta contínua por classes discretas, estes casos quebram.
 *
 * Codificação inversa documentada:
 *   byte ≈ 1 + round(clamp((ndvi − min) / (max − min), 0, 1) × 254)
 * Decodificação (contrato SAT-06):
 *   ndvi = (byte − 1) / 254 × (max − min) + min
 */
import { describe, expect, it } from "vitest";
import {
  PARADAS_NDVI_PIXEL,
  codificarNdviParaByte,
  corNdviFixo,
  decodificarByteNdvi,
  montarLutNdvi
} from "./paleta-ndvi-pixel";
import { colorirRasterNdvi } from "./colorir-raster-ndvi";

/** Escala típica do metadado SAT-06 — passada por argumento, nunca embutida na LUT. */
const ESCALA_A = { min: -0.2, max: 1.0 } as const;
/** Escala diferente: o mesmo byte DEVE mapear para outra cor. */
const ESCALA_B = { min: 0.0, max: 0.8 } as const;

function rgbaDaLut(lut: Uint8ClampedArray, byte: number): [number, number, number, number] {
  const i = byte * 4;
  return [lut[i]!, lut[i + 1]!, lut[i + 2]!, lut[i + 3]!];
}

describe("PARADAS_NDVI_PIXEL / corNdviFixo", () => {
  it("exporta as cinco paradas fixas do prompt", () => {
    expect(PARADAS_NDVI_PIXEL.map((p) => [p.ndvi, p.r, p.g, p.b])).toEqual([
      [0.1, 0xd7, 0x30, 0x27],
      [0.2, 0xfc, 0x8d, 0x59],
      [0.4, 0xd9, 0xef, 0x8b],
      [0.6, 0x91, 0xcf, 0x60],
      [0.75, 0x1a, 0x98, 0x50]
    ]);
  });

  it("nas paradas e nos extremos devolve a cor exata (clamp)", () => {
    expect(corNdviFixo(0.1)).toEqual([0xd7, 0x30, 0x27]);
    expect(corNdviFixo(0.2)).toEqual([0xfc, 0x8d, 0x59]);
    expect(corNdviFixo(0.4)).toEqual([0xd9, 0xef, 0x8b]);
    expect(corNdviFixo(0.6)).toEqual([0x91, 0xcf, 0x60]);
    expect(corNdviFixo(0.75)).toEqual([0x1a, 0x98, 0x50]);
    // clamp: abaixo de 0,10 e acima de 0,75
    expect(corNdviFixo(-1)).toEqual([0xd7, 0x30, 0x27]);
    expect(corNdviFixo(0.05)).toEqual([0xd7, 0x30, 0x27]);
    expect(corNdviFixo(0.9)).toEqual([0x1a, 0x98, 0x50]);
    expect(corNdviFixo(1)).toEqual([0x1a, 0x98, 0x50]);
  });

  it("interpola linearmente entre paradas (meio de 0,20→0,40)", () => {
    // NDVI 0,30 = meio entre laranja e amarelo-esverdeado
    const [r, g, b] = corNdviFixo(0.3);
    expect(r).toBe(Math.round((0xfc + 0xd9) / 2));
    expect(g).toBe(Math.round((0x8d + 0xef) / 2));
    expect(b).toBe(Math.round((0x59 + 0x8b) / 2));
  });
});

describe("montarLutNdvi", () => {
  it("byte 0 é totalmente transparente e NUNCA recebe cor de NDVI", () => {
    const lut = montarLutNdvi(ESCALA_A.min, ESCALA_A.max);
    expect(lut.length).toBe(256 * 4);
    expect(rgbaDaLut(lut, 0)).toEqual([0, 0, 0, 0]);
    // Sabotagem: se o byte 0 for pintado com a cor do NDVI mínimo, o alpha ou RGB mudam.
    for (let i = 0; i < 4; i++) expect(lut[i]).toBe(0);
  });

  it("bytes conhecidos: encode reverso → decode → cor da paleta nas paradas 0,10 / 0,20 / 0,75", () => {
    const lut = montarLutNdvi(ESCALA_A.min, ESCALA_A.max);

    for (const alvo of [0.1, 0.2, 0.75] as const) {
      const byte = codificarNdviParaByte(alvo, ESCALA_A.min, ESCALA_A.max);
      expect(byte).toBeGreaterThanOrEqual(1);
      expect(byte).toBeLessThanOrEqual(255);

      const ndvi = decodificarByteNdvi(byte, ESCALA_A.min, ESCALA_A.max)!;
      // O degrau pode não cair exatamente no alvo; a LUT usa o valor DECODIFICADO.
      const esperado = corNdviFixo(ndvi);
      const [r, g, b, a] = rgbaDaLut(lut, byte);
      expect([r, g, b]).toEqual(esperado);
      expect(a).toBe(255);

      // Nas paradas exatas da paleta, corNdviFixo(alvo) é a cor do stop; o byte mais próximo
      // deve ficar visualmente na vizinhança (mesmo stop ou interpolação contígua).
      expect(corNdviFixo(alvo)).toEqual(
        alvo === 0.1
          ? [0xd7, 0x30, 0x27]
          : alvo === 0.2
            ? [0xfc, 0x8d, 0x59]
            : [0x1a, 0x98, 0x50]
      );
    }
  });

  it("escala fixa: o mesmo NDVI (mesmo byte na mesma escala) tem a mesma cor independentemente dos vizinhos", () => {
    const lut = montarLutNdvi(ESCALA_A.min, ESCALA_A.max);
    const byte = codificarNdviParaByte(0.4, ESCALA_A.min, ESCALA_A.max);
    const cor = rgbaDaLut(lut, byte);

    // Raster 2×2: um pixel no alvo cercado de 0 e de outro valor — a cor do alvo não muda.
    const cinza = new Uint8ClampedArray([0, byte, 255, byte]);
    const img = colorirRasterNdvi(cinza, 2, 2, lut);
    expect([...img.data.slice(4, 8)]).toEqual(cor);
    expect([...img.data.slice(12, 16)]).toEqual(cor);
    expect([...img.data.slice(0, 4)]).toEqual([0, 0, 0, 0]); // byte 0
  });

  it("escalaMin/escalaMax vêm dos argumentos: o mesmo byte muda de cor se a escala muda", () => {
    const lutA = montarLutNdvi(ESCALA_A.min, ESCALA_A.max);
    const lutB = montarLutNdvi(ESCALA_B.min, ESCALA_B.max);
    // Byte 1: escala A → −0,2 (vermelho clamp); escala B → 0,0 (ainda vermelho clamp) —
    // por isso usamos um byte no meio-alto, onde as escalas divergem de verdade.
    const byte = 200;
    // A: (199/254)×1,2 − 0,2 ≈ 0,741; B: (199/254)×0,8 ≈ 0,627

    const ndviA = decodificarByteNdvi(byte, ESCALA_A.min, ESCALA_A.max)!;
    const ndviB = decodificarByteNdvi(byte, ESCALA_B.min, ESCALA_B.max)!;
    expect(ndviA).toBeGreaterThan(ndviB + 0.05);

    const corA = rgbaDaLut(lutA, byte);
    const corB = rgbaDaLut(lutB, byte);
    expect(corA.slice(0, 3)).toEqual(corNdviFixo(ndviA));
    expect(corB.slice(0, 3)).toEqual(corNdviFixo(ndviB));
    // Sabotagem: LUT com escala hardcoded (−0,2..1) faria corA === corB para qualquer chamada.
    expect(corA.slice(0, 3)).not.toEqual(corB.slice(0, 3));
  });
});

describe("colorirRasterNdvi", () => {
  it("aceita buffer cinza (1 bpp) e RGBA (lê só R)", () => {
    const lut = montarLutNdvi(ESCALA_A.min, ESCALA_A.max);
    const byte = codificarNdviParaByte(0.6, ESCALA_A.min, ESCALA_A.max);
    const esperado = rgbaDaLut(lut, byte);

    const cinza = new Uint8ClampedArray([byte]);
    expect([...colorirRasterNdvi(cinza, 1, 1, lut).data]).toEqual(esperado);

    // RGBA de origem: só R importa (G/B/A lixo não alteram a saída).
    const rgba = new Uint8ClampedArray([byte, 9, 8, 7]);
    expect([...colorirRasterNdvi(rgba, 1, 1, lut).data]).toEqual(esperado);
  });
});

describe("desempenho da colorização (SAT-07)", () => {
  it("colora o equivalente a 200 rasters 64×64 em tempo razoável", () => {
    const lut = montarLutNdvi(ESCALA_A.min, ESCALA_A.max);
    const w = 64, h = 64;
    const bytes = new Uint8ClampedArray(w * h);
    for (let i = 0; i < bytes.length; i++) bytes[i] = (i % 255) + (i % 2); // evita só zeros
    const t0 = performance.now();
    for (let n = 0; n < 200; n++) colorirRasterNdvi(bytes, w, h, lut);
    const ms = performance.now() - t0;
    // Ambiente de CI varia; o teto é folgado — o que importa é não ser O(n²) por pixel com cálculo de cor.
    expect(ms).toBeLessThan(5_000);
    expect(ms, `tempo montagem 200×64×64: ${ms.toFixed(1)} ms`).toBeGreaterThanOrEqual(0);
  });
});

