/**
 * Tipo de uso da área (cadastro-areas-01) — UM dono da lista fechada.
 *
 * O registry, a API e a CHECK `erp.areas.land_use` consomem ESTE arquivo.
 * Ninguém redigita a lista. Valor = regra; rótulo = apresentação (decisão D1).
 */

/** Par [valor, rótulo] na ordem canônica da fatia. */
export const TIPOS_DE_USO_DA_AREA: readonly [string, string][] = [
  ["pastagem", "Pastagem"],
  ["lavoura", "Lavoura"],
  ["ilp", "Integração lavoura-pecuária (ILP)"],
  ["ilpf", "Integração lavoura-pecuária-floresta (ILPF)"],
  ["silvipastoril", "Silvipastoril (IPF)"],
  ["floresta", "Floresta plantada"],
  ["confinamento", "Confinamento / semiconfinamento"],
  ["reserva_legal", "Reserva legal"],
  ["app", "APP"],
  ["uso_restrito", "Área de uso restrito"],
  ["vegetacao_nativa", "Vegetação nativa"],
  ["benfeitoria", "Benfeitoria / sede"],
  ["curral", "Curral / mangueira"],
  ["estrada", "Estrada / carreador"],
  ["aguada", "Aguada / represa"],
  ["degradada", "Área degradada ou em recuperação"],
  ["nao_produtiva", "Área não produtiva"]
] as const;

export const VALORES_TIPO_DE_USO_DA_AREA: readonly string[] = TIPOS_DE_USO_DA_AREA.map(([v]) => v);

/** Área que recebe animal (módulo de pastejo só nestes). */
export const USO_PECUARIO: readonly string[] = [
  "pastagem", "ilp", "ilpf", "silvipastoril", "confinamento"
];

export const USO_AGRICOLA: readonly string[] = [
  "lavoura", "ilp", "ilpf", "floresta"
];

export const USO_AMBIENTAL: readonly string[] = [
  "reserva_legal", "app", "uso_restrito", "vegetacao_nativa"
];

export const USO_INFRAESTRUTURA: readonly string[] = [
  "benfeitoria", "curral", "estrada", "aguada"
];

export const USO_PRODUTIVO: readonly string[] = [...new Set([...USO_PECUARIO, ...USO_AGRICOLA])];

/** Nunca entra em seleção de lançamento produtivo. */
export const USO_BLOQUEADO: readonly string[] = [...USO_AMBIENTAL];

/** Situação cadastral da área. */
export const STATUS_DA_AREA: readonly [string, string][] = [
  ["ativa", "Ativa"],
  ["em_formacao", "Em formação"],
  ["em_reforma", "Em reforma"],
  ["vedada", "Vedada / diferida"],
  ["inativa", "Inativa"]
] as const;

/** Posse da área. */
export const POSSE_DA_AREA: readonly [string, string][] = [
  ["propria", "Própria"],
  ["arrendada", "Arrendada"],
  ["parceria", "Parceria"],
  ["comodato", "Comodato"]
] as const;

export const TIPO_DE_PASTAGEM: readonly [string, string][] = [
  ["nativa", "Nativa"],
  ["cultivada_perene", "Cultivada perene"],
  ["cultivada_anual", "Cultivada anual"],
  ["consorciada", "Consorciada com leguminosa"],
  ["inverno", "Pastagem de inverno"]
] as const;

export const TEXTURA_DO_SOLO: readonly [string, string][] = [
  ["arenosa", "Arenosa"],
  ["media", "Média"],
  ["argilosa", "Argilosa"],
  ["muito_argilosa", "Muito argilosa"]
] as const;

export const RELEVO_DA_AREA: readonly [string, string][] = [
  ["plano", "Plano"],
  ["suave_ondulado", "Suave ondulado"],
  ["ondulado", "Ondulado"],
  ["forte_ondulado", "Forte ondulado"],
  ["montanhoso", "Montanhoso"]
] as const;

/** Atividade principal do retiro. */
export const ATIVIDADE_PRINCIPAL_DO_RETIRO: readonly [string, string][] = [
  ["cria", "Cria"],
  ["recria", "Recria"],
  ["engorda", "Engorda"],
  ["ciclo_completo", "Ciclo completo"],
  ["leite", "Leite"],
  ["lavoura", "Lavoura"],
  ["misto", "Misto"]
] as const;

/** Método de pastejo do módulo. */
export const METODO_DE_PASTEJO: readonly [string, string][] = [
  ["continuo", "Contínuo"],
  ["rotacionado", "Rotacionado"],
  ["alternado", "Alternado"],
  ["diferido", "Diferido"],
  ["prv", "PRV"],
  ["faixas", "Faixas"]
] as const;

export const CATEGORIA_ALVO_DO_MODULO: readonly [string, string][] = [
  ["cria", "Cria"],
  ["recria", "Recria"],
  ["engorda", "Engorda"],
  ["ciclo_completo", "Ciclo completo"],
  ["leite", "Leite"]
] as const;

/**
 * Parâmetro `uso` da listagem de áreas (seleção por outros módulos).
 * Área em USO_BLOQUEADO nunca entra em nenhum dos três.
 */
export type UsoSelecaoArea = "receber_animal" | "safra" | "produtiva";

export function filtroUsoSelecaoArea(uso: string): { landUses: readonly string[]; statuses: readonly string[] } | null {
  if (uso === "receber_animal") return { landUses: USO_PECUARIO, statuses: ["ativa"] };
  if (uso === "safra") return { landUses: USO_AGRICOLA, statuses: ["ativa", "em_formacao"] };
  if (uso === "produtiva") return { landUses: USO_PRODUTIVO, statuses: ["ativa"] };
  return null;
}
