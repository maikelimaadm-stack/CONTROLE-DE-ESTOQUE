/**
 * OBJETOS DO MAPA — MAPA-MANEJO-01.
 *
 * Catálogo fechado dos objetos desenhados sobre o mapa (`erp.objetos_de_mapa`, migration 0061): o que cada
 * TIPO é, com que FORMA se desenha e em que UNIDADE mede a capacidade. É o dono da lista: a CHECK do banco,
 * a API e a tela consomem daqui; o rótulo do tipo sai deste catálogo para `labels.ts` (nunca redigitado).
 *
 * Sem ícone de propósito: os desenhos de cada tipo vêm depois, fornecidos pelo produto. Nenhum nome de
 * ícone, SVG ou dependência visual mora aqui.
 */

/** Formas geométricas de um objeto do mapa (CHECK de `erp.objetos_de_mapa.forma`). */
export const FORMAS_DE_OBJETO = ["ponto", "linha"] as const;
export type FormaDeObjeto = (typeof FORMAS_DE_OBJETO)[number];

/** Unidades de capacidade (CHECK de `erp.objetos_de_mapa.unidade_capacidade`; nula = sem capacidade). */
export const UNIDADES_DE_CAPACIDADE = ["m", "t", "kg", "sc"] as const;
export type UnidadeDeCapacidade = (typeof UNIDADES_DE_CAPACIDADE)[number];

/** Definição de um tipo de objeto do mapa. */
export interface DefinicaoDeObjetoDeMapa {
  readonly tipo: string;
  readonly rotulo: string;
  readonly forma: FormaDeObjeto;
  /** Unidade em que este tipo mede a capacidade. */
  readonly unidadeCapacidade: UnidadeDeCapacidade;
}

/**
 * TIPOS DE OBJETO DO MAPA (CHECK de `erp.objetos_de_mapa.tipo`), na ordem de apresentação.
 * - Cocho: ponto; capacidade em METROS lineares de cocho (o que limita quantos animais comem juntos).
 * - Depósito a pasto: ponto; capacidade em TONELADAS armazenadas.
 */
export const TIPOS_DE_OBJETO_DE_MAPA = [
  { tipo: "cocho", rotulo: "Cocho", forma: "ponto", unidadeCapacidade: "m" },
  { tipo: "deposito_a_pasto", rotulo: "Depósito a pasto", forma: "ponto", unidadeCapacidade: "t" }
] as const satisfies readonly DefinicaoDeObjetoDeMapa[];
export type TipoDeObjetoDeMapa = (typeof TIPOS_DE_OBJETO_DE_MAPA)[number]["tipo"];

/** Vista alargada do catálogo (a forma de cada tipo como `FormaDeObjeto`, não como literal). */
const CATALOGO: readonly DefinicaoDeObjetoDeMapa[] = TIPOS_DE_OBJETO_DE_MAPA;

/** Valores aceitos de `tipo`, na ordem do catálogo. */
export const VALORES_TIPO_DE_OBJETO_DE_MAPA: readonly TipoDeObjetoDeMapa[] = TIPOS_DE_OBJETO_DE_MAPA.map((t) => t.tipo);

/**
 * TIPOS DESENHADOS COMO LINHA — derivados do catálogo (forma `linha`). Vazia hoje: todo tipo é ponto.
 *
 * É a MESMA lista da CHECK `chk_objetos_forma_bate_com_tipo` de `erp.objetos_de_mapa` (forma = linha
 * exatamente quando o tipo está nesta lista). Acrescentar um tipo de linha (a cerca, no futuro) é
 * acrescentá-lo AQUI, no catálogo, com forma `linha`, E LÁ, numa migration que refaz a CHECK — uma sem a
 * outra deixa a tela desenhar o que o banco recusa, ou o banco aceitar o que a tela não sabe desenhar.
 */
export const TIPOS_DE_LINHA: readonly string[] = CATALOGO.filter((t) => t.forma === "linha").map((t) => t.tipo);

/**
 * Forma com que um tipo se desenha. Tipo desconhecido devolve `null` — discriminador desconhecido NEGA
 * (o chamador recusa); nunca cai em `ponto` por padrão.
 */
export function formaDoTipo(tipo: string): FormaDeObjeto | null {
  return CATALOGO.find((t) => t.tipo === tipo)?.forma ?? null;
}
