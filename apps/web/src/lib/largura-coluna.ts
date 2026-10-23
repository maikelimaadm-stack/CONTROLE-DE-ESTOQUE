/**
 * Largura de coluna pelo texto — cabeçalho e células medidos à parte.
 * Antes um único “chrome” (menu + ícones do th) era somado também ao texto da
 * célula e a coluna ficava longe demais dos dados.
 */

const TETO = 480;
const PISO = 48;

/** Padding 9+9 + borda (box-sizing: border-box). */
const PAD = 18 + 2;
/** Menu ⋮ + folga mínima no cabeçalho. */
const CHROME_MENU = 20 + 4;
/** Um mini-ícone de estado (auto/filtro/congelar) + gap — reserva no th. */
const CHROME_ICONE_ESTADO = 12 + 4;
/** Lupa/cadeado na célula de produto/armazém. */
export const CHROME_ICONE_NA_CELULA = 13 + 8;

let canvas: HTMLCanvasElement | null = null;

function medir(texto: string, font: string): number {
  if (typeof document === "undefined") return 0;
  if (!canvas) canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return 0;
  ctx.font = font;
  const t = String(texto ?? "").replace(/\s+/g, " ").trim();
  if (!t) return 0;
  return ctx.measureText(t).width;
}

export function fonteDaCelula(el: Element | null | undefined): string {
  if (!el || typeof window === "undefined") return "600 12px system-ui, sans-serif";
  const s = window.getComputedStyle(el);
  return `${s.fontWeight} ${s.fontSize} ${s.fontFamily}`;
}

/** Fonte do corpo a partir da do cabeçalho (peso normal). */
export function fonteDoCorpo(fontCabecalho: string): string {
  return fontCabecalho.replace(/^\d{3}\s/, "400 ").replace(/^bold\s/i, "400 ");
}

/**
 * Largura justa: max(rótulo+chrome do th, células+chrome da td).
 * `comIconeEstado` reserva espaço do mini-ícone no cabeçalho (modo auto ligado).
 * `chromeExtraCelula` = lupa etc. só na célula.
 */
export function medirLarguraColuna(opts: {
  rotulo: string;
  textosCelulas: readonly string[];
  fontCabecalho: string;
  fontCelula?: string;
  comIconeEstado?: boolean;
  chromeExtraCelula?: number;
}): number {
  const fontH = opts.fontCabecalho;
  const fontC = opts.fontCelula ?? fonteDoCorpo(fontH);
  const chromeTh = PAD + CHROME_MENU + (opts.comIconeEstado ? CHROME_ICONE_ESTADO : 0);
  const chromeTd = PAD + (opts.chromeExtraCelula ?? 0);

  const wTh = Math.ceil(medir(opts.rotulo, fontH) + chromeTh);
  let wTd = 0;
  for (const bruto of opts.textosCelulas) {
    const t = String(bruto ?? "").replace(/\s+/g, " ").trim();
    if (!t || t === "—" || t === "–" || t === "…") continue;
    wTd = Math.max(wTd, Math.ceil(medir(t, fontC) + chromeTd));
  }
  return Math.min(TETO, Math.max(PISO, Math.max(wTh, wTd)));
}

/** @deprecated use medirLarguraColuna — mantido só se algum import legado restar. */
export function medirTextos(textos: readonly string[], font: string, chrome = PAD + CHROME_MENU): number {
  const [rotulo, ...celulas] = textos;
  return medirLarguraColuna({ rotulo: rotulo ?? "", textosCelulas: celulas, fontCabecalho: font, chromeExtraCelula: Math.max(0, chrome - PAD - CHROME_MENU) });
}
