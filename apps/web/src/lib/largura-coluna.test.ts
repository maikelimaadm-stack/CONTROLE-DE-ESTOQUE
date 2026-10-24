import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CHROME_ICONE_ESTADO,
  medirLarguraColuna,
  resetCanvasMedicaoParaTeste
} from "./largura-coluna";

const FONT = "600 12px Arial, sans-serif";

/** ~7px por caractere — basta para achar ordem e deltas de chrome (sem jsdom). */
function stubCanvas(pxPorChar = 7) {
  resetCanvasMedicaoParaTeste();
  const measureText = vi.fn((t: string) => ({ width: String(t).length * pxPorChar }));
  const getContext = vi.fn(() => ({ font: "", measureText }));
  vi.stubGlobal("document", {
    createElement: (tag: string) => {
      if (tag === "canvas") return { getContext } as unknown as HTMLCanvasElement;
      throw new Error(`createElement inesperado: ${tag}`);
    }
  });
  return { measureText };
}

describe("medirLarguraColuna", () => {
  beforeEach(() => { stubCanvas(); });
  afterEach(() => {
    resetCanvasMedicaoParaTeste();
    vi.unstubAllGlobals();
  });

  it("conta o rótulo do cabeçalho mesmo com células vazias", () => {
    const soCabecalho = medirLarguraColuna({
      rotulo: "Local de estoque",
      textosCelulas: [],
      fontCabecalho: FONT
    });
    const comCelulaCurta = medirLarguraColuna({
      rotulo: "Local de estoque",
      textosCelulas: ["A"],
      fontCabecalho: FONT
    });
    expect(soCabecalho).toBeGreaterThan(80);
    expect(comCelulaCurta).toBe(soCabecalho);
  });

  it("reserva chrome por cada ícone de estado ativo (não só um)", () => {
    // rótulo curto para o chrome dominar o teto do piso
    const base = medirLarguraColuna({
      rotulo: "P",
      textosCelulas: [],
      fontCabecalho: FONT,
      iconesEstado: 0
    });
    const um = medirLarguraColuna({
      rotulo: "P",
      textosCelulas: [],
      fontCabecalho: FONT,
      iconesEstado: 1
    });
    const tres = medirLarguraColuna({
      rotulo: "P",
      textosCelulas: [],
      fontCabecalho: FONT,
      iconesEstado: 3
    });
    expect(um - base).toBe(CHROME_ICONE_ESTADO);
    expect(tres - base).toBe(3 * CHROME_ICONE_ESTADO);
  });

  it("célula longa vence o cabeçalho; cabeçalho longo vence a célula", () => {
    const cabecalhoLongo = medirLarguraColuna({
      rotulo: "Classificação CAPEX/OPEX detalhada",
      textosCelulas: ["1"],
      fontCabecalho: FONT
    });
    const celulaLonga = medirLarguraColuna({
      rotulo: "Qtd",
      textosCelulas: ["Almoxarifado Central 1 — depósito principal da fazenda"],
      fontCabecalho: FONT
    });
    expect(cabecalhoLongo).toBeGreaterThan(140);
    expect(celulaLonga).toBeGreaterThan(cabecalhoLongo);
  });
});
