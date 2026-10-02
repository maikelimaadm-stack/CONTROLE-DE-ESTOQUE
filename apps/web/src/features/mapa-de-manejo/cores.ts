/**
 * MAPA-01 — paleta do cadastro de área (ficha).
 * No mapa o fill é sempre azul escuro; contorno branco fino; destaque = linha branca.
 */

export interface CorDaPaleta { cor: string; nome: string }

/** Azul escuro — padrão do cadastro e fill uniforme no mapa. */
export const COR_PADRAO_AREA = "#0d67ad";
/** Contorno padrão das demarcações no mapa — sempre branco, fino. */
export const COR_LINHA_AREA = "#ffffff";

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

/**
 * Fill no mapa: sempre azul escuro (uniforme), independente da cor cadastrada.
 * A paleta da ficha continua para o cadastro; a exibição do mapa fica só azul escuro.
 */
export function corExibidaNoMapa(_cor?: string | null | undefined): string {
  return COR_PADRAO_AREA;
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
