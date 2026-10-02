/**
 * MAPA-01 — paleta fixa de 9 cores do cadastro de área (ficha da área).
 * A cor gravada é a da tabela; a exibida no mapa é suavizada (85% da cor + 15% do turquesa).
 */

export interface CorDaPaleta { cor: string; nome: string }

/** Azul celeste — padrão do cadastro. */
export const COR_PADRAO_AREA = "#61aad9";
const TURQUESA_EXIBICAO = "#20bfa9";
const CINZA_SEM_COR = "#a3b2b8";

export const PALETA_AREAS: readonly CorDaPaleta[] = [
  { cor: "#f8f9fa", nome: "Branco" },
  { cor: "#d8dee2", nome: "Cinza claro" },
  { cor: "#2c303e", nome: "Preto" },
  { cor: "#0d67ad", nome: "Azul escuro" },
  { cor: "#61aad9", nome: "Azul celeste" },
  { cor: "#efcb19", nome: "Amarelo" },
  { cor: "#92ca25", nome: "Verde claro" },
  { cor: "#f5a01b", nome: "Laranja" },
  { cor: "#966fe1", nome: "Roxo" }
];

function hexParaRgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = Number.parseInt(m[1]!, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbParaHex(r: number, g: number, b: number): string {
  const c = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

/** Cor de preenchimento no mapa: 85% da cadastrada + 15% turquesa; sem cor → cinza. */
export function corExibidaNoMapa(cor: string | null | undefined): string {
  const base = hexParaRgb(cor && cor.trim() !== "" ? cor : CINZA_SEM_COR) ?? hexParaRgb(CINZA_SEM_COR)!;
  const t = hexParaRgb(TURQUESA_EXIBICAO)!;
  return rgbParaHex(base[0] * 0.85 + t[0] * 0.15, base[1] * 0.85 + t[1] * 0.15, base[2] * 0.85 + t[2] * 0.15);
}

/** Borda: cada canal × 0,92 + 8 × 0,08 sobre a cor exibida. */
export function corBordaNoMapa(corExibida: string): string {
  const rgb = hexParaRgb(corExibida) ?? hexParaRgb(CINZA_SEM_COR)!;
  return rgbParaHex(rgb[0] * 0.92 + 8 * 0.08, rgb[1] * 0.92 + 8 * 0.08, rgb[2] * 0.92 + 8 * 0.08);
}

/** A primeira cor da paleta que nenhuma área usa; com todas em uso, o padrão. */
export function proximaCor(usadas: readonly (string | null | undefined)[]): string {
  const emUso = new Set(usadas.filter((c): c is string => Boolean(c)).map((c) => c.toLowerCase()));
  const livre = PALETA_AREAS.find((p) => !emUso.has(p.cor.toLowerCase()));
  return (livre ?? PALETA_AREAS.find((p) => p.cor === COR_PADRAO_AREA) ?? PALETA_AREAS[0]!).cor;
}
