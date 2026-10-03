/**
 * MAPA-01 — paleta do cadastro de área (ficha).
 * Fill no mapa segue a cor da ficha (preview ao vivo); contorno branco fino.
 */

export interface CorDaPaleta { cor: string; nome: string }

/** Azul escuro — padrão do cadastro. */
export const COR_PADRAO_AREA = "#0d67ad";
/** Contorno padrão das demarcações no mapa — sempre branco, fino. */
export const COR_LINHA_AREA = "#ffffff";
const CINZA_SEM_COR = "#a3b2b8";

/** Paleta ampliada, sólidas e fáceis de distinguir (sem tons “misturados”). */
export const PALETA_AREAS: readonly CorDaPaleta[] = [
  { cor: "#f8f9fa", nome: "Branco" },
  { cor: "#94a3b8", nome: "Cinza" },
  { cor: "#1e293b", nome: "Preto" },
  { cor: "#0d67ad", nome: "Azul escuro" },
  { cor: "#61aad9", nome: "Azul celeste" },
  { cor: "#2563eb", nome: "Azul" },
  { cor: "#0f766e", nome: "Verde escuro" },
  { cor: "#16a34a", nome: "Verde" },
  { cor: "#92ca25", nome: "Verde claro" },
  { cor: "#efcb19", nome: "Amarelo" },
  { cor: "#f5a01b", nome: "Laranja" },
  { cor: "#dc2626", nome: "Vermelho" },
  { cor: "#db2777", nome: "Rosa" },
  { cor: "#966fe1", nome: "Roxo" },
  { cor: "#92400e", nome: "Marrom" },
  { cor: "#14b8a6", nome: "Turquesa" }
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

/**
 * Cor de preenchimento no mapa: a da ficha quase pura (só 5% de branco).
 * Assim a troca na paleta atualiza o pasto na hora, antes de salvar.
 */
export function corExibidaNoMapa(cor: string | null | undefined): string {
  const base = hexParaRgb(cor && cor.trim() !== "" ? cor : CINZA_SEM_COR) ?? hexParaRgb(CINZA_SEM_COR)!;
  return rgbParaHex(base[0] * 0.95 + 255 * 0.05, base[1] * 0.95 + 255 * 0.05, base[2] * 0.95 + 255 * 0.05);
}

/** Contorno no mapa: sempre branco (a linha de demarcação). */
export function corBordaNoMapa(_corExibida?: string): string {
  return COR_LINHA_AREA;
}

/** A primeira cor da paleta que nenhuma área usa; com todas em uso, o padrão. */
export function proximaCor(usadas: readonly (string | null | undefined)[]): string {
  const emUso = new Set(usadas.filter((c): c is string => Boolean(c)).map((c) => c.toLowerCase()));
  const livre = PALETA_AREAS.find((p) => !emUso.has(p.cor.toLowerCase()));
  return (livre ?? PALETA_AREAS.find((p) => p.cor === COR_PADRAO_AREA) ?? PALETA_AREAS[0]!).cor;
}
