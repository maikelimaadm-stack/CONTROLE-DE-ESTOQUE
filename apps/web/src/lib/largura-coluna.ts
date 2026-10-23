/**
 * Largura de coluna pelo texto (cabeçalho / células), estável entre cliques.
 * Não usa scrollWidth da célula — isso somava padding/ícones e a coluna “afastava” a cada auto ajustar.
 */

const TETO = 480;
const PISO = 48;

/**
 * Reserva fixa (box-sizing:border-box): padding 9+9 + borda + menu ⋮ 20 +
 * faixa dos mini-ícones (até 2×12 + gap) + gaps do flex + folga.
 * Garante que o rótulo do cabeçalho caiba mesmo sem dados nas células.
 */
export const CHROME_DA_COLUNA = 18 + 2 + 20 + 27 + 6 + 10;

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
  // Sem texto de célula, ainda mede o cabeçalho (rótulo está em `textos`).
  return Math.min(TETO, Math.max(PISO, Math.ceil(max) + chrome));
}

export function fonteDaCelula(el: Element | null | undefined): string {
  if (!el || typeof window === "undefined") return "600 12px system-ui, sans-serif";
  const s = window.getComputedStyle(el);
  return `${s.fontWeight} ${s.fontSize} ${s.fontFamily}`;
}
