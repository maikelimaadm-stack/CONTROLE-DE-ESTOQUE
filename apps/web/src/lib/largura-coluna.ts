/**
 * Largura de coluna pelo texto (cabeçalho / células), estável entre cliques.
 * Não usa scrollWidth da célula — isso somava padding/ícones e a coluna “afastava” a cada auto ajustar.
 */

const TETO = 480;
const PISO = 48;

/** Reserva fixa: padding (9+9) + menu ⋮ (16) + faixa dos mini-ícones (até 2×12 + gap) + folga. */
export const CHROME_DA_COLUNA = 18 + 16 + 27 + 8;

let canvas: HTMLCanvasElement | null = null;

export function medirTextos(textos: readonly string[], font: string, chrome = CHROME_DA_COLUNA): number {
  if (typeof document === "undefined") return PISO + chrome;
  if (!canvas) canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  let max = 0;
  if (ctx) {
    ctx.font = font;
    for (const bruto of textos) {
      const t = String(bruto ?? "").replace(/\s+/g, " ").trim();
      if (!t) continue;
      max = Math.max(max, ctx.measureText(t).width);
    }
  }
  return Math.min(TETO, Math.max(PISO, Math.ceil(max) + chrome));
}

export function fonteDaCelula(el: Element | null | undefined): string {
  if (!el || typeof window === "undefined") return "600 12px system-ui, sans-serif";
  const s = window.getComputedStyle(el);
  return `${s.fontWeight} ${s.fontSize} ${s.fontFamily}`;
}
