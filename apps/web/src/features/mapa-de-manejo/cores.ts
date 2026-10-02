/**
 * MAPA-01 (decisão 289) — paleta das áreas do Mapa de Manejo: 20 cores fixas, escolhidas para aparecer sobre o
 * satélite (verdes e marrons) e sobre o mapa de ruas (claro). A área nova recebe a primeira cor ainda não usada;
 * o usuário troca por outra da paleta, nunca por cor livre. O banco só exige `#RRGGBB` — a paleta mora aqui.
 */
export interface CorDaPaleta { cor: string; nome: string }

export const PALETA_AREAS: readonly CorDaPaleta[] = [
  { cor: "#ef4444", nome: "Vermelho" },
  { cor: "#f97316", nome: "Laranja" },
  { cor: "#f59e0b", nome: "Âmbar" },
  { cor: "#facc15", nome: "Amarelo" },
  { cor: "#fde68a", nome: "Areia" },
  { cor: "#a3e635", nome: "Verde-limão" },
  { cor: "#22c55e", nome: "Verde" },
  { cor: "#15803d", nome: "Verde-escuro" },
  { cor: "#10b981", nome: "Esmeralda" },
  { cor: "#14b8a6", nome: "Turquesa" },
  { cor: "#06b6d4", nome: "Ciano" },
  { cor: "#0ea5e9", nome: "Azul-céu" },
  { cor: "#3b82f6", nome: "Azul" },
  { cor: "#6366f1", nome: "Anil" },
  { cor: "#8b5cf6", nome: "Violeta" },
  { cor: "#d946ef", nome: "Magenta" },
  { cor: "#ec4899", nome: "Rosa" },
  { cor: "#a16207", nome: "Marrom" },
  { cor: "#78716c", nome: "Cinza" },
  { cor: "#f1f5f9", nome: "Branco" }
];

/** A primeira cor da paleta que nenhuma área usa; com todas em uso, gira pela quantidade de áreas. */
export function proximaCor(usadas: readonly (string | null | undefined)[]): string {
  const emUso = new Set(usadas.filter((c): c is string => Boolean(c)).map((c) => c.toLowerCase()));
  const livre = PALETA_AREAS.find((p) => !emUso.has(p.cor));
  return (livre ?? PALETA_AREAS[usadas.length % PALETA_AREAS.length]!).cor;
}
