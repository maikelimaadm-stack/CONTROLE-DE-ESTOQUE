/**
 * ESCOPO DE EMPRESA POR MÓDULO — MECANISMO (docs/MULTI-COMPANY-CONTRACT.md §7).
 *
 * A autorização multiempresa tem DUAS dimensões, e a permissão efetiva é a INTERSEÇÃO delas:
 *
 *   CAPACIDADE  — o perfil permite a ação?            (catálogo de permissões)
 *   ESCOPO      — em quais empresas ele pode fazê-la? (este contrato)
 *
 * Nunca uma substitui a outra: `capacidade AND escopo`, jamais `OR`. Um usuário pode ter Estoque na
 * empresa A e Financeiro na empresa B — por isso o escopo é POR MÓDULO, não um conjunto global.
 *
 * ESTE MÓDULO É MECANISMO, NÃO CATÁLOGO. Quais são os módulos e a que módulo cada recurso pertence é
 * CONFIGURAÇÃO DE PRODUTO e vive em `@agro/domain`. Aqui não há nome de módulo, de tabela nem de permissão.
 *
 * SEM LISTA DE EMPRESAS. O contrato carrega apenas o MODO de cada módulo; quem resolve o conjunto de
 * empresas é o adaptador (SQL), porque uma organização pode ter centenas de empresas e carregá-las em
 * memória a cada requisição não escala (docs/PRE-BASE2-ROADMAP.md).
 */

/** Como o membro enxerga as empresas de um módulo. Não existe sentinela: lista vazia nunca significa "todas". */
export type ModoEscopo = "todas" | "selecionadas";

/** Escopo efetivo de um módulo, já resolvido. `selecionadas` é resolvido pelo adaptador (conjunto no banco). */
export type EscopoModuloResolvido =
  | { tipo: "todas" }
  | { tipo: "selecionadas" }
  | { tipo: "nenhuma" };

/**
 * Autorização do membro na organização.
 * `todosOsModulos` = proprietário: todas as empresas da organização, em todos os módulos.
 * `modos` = configuração explícita por módulo. Módulo AUSENTE do mapa significa NENHUMA empresa —
 * fail-closed por construção, inclusive para módulos criados depois do cadastro do membro.
 */
export interface AutorizacaoPorModulo {
  todosOsModulos: boolean;
  modos: ReadonlyMap<string, ModoEscopo>;
}

/** Proprietário da organização: acesso total dentro do tenant (nunca fora dele). */
export const AUTORIZACAO_PROPRIETARIO: AutorizacaoPorModulo = { todosOsModulos: true, modos: new Map() };

/** Monta a autorização a partir dos modos gravados. Sem entrada para um módulo = sem acesso àquele módulo. */
export function autorizacaoPorModulo(modos: Iterable<readonly [string, ModoEscopo]>): AutorizacaoPorModulo {
  return { todosOsModulos: false, modos: new Map(modos) };
}

/**
 * Escopo efetivo do membro naquele módulo.
 *
 *   proprietário            → todas
 *   modo "todas"            → todas as empresas da organização
 *   modo "selecionadas"     → só as empresas escolhidas (conjunto vazio = nenhuma, resolvido no adaptador)
 *   módulo sem configuração → NENHUMA (não há default permissivo)
 */
export function escopoDoModulo(auth: AutorizacaoPorModulo, modulo: string | null | undefined): EscopoModuloResolvido {
  if (auth.todosOsModulos) return { tipo: "todas" };
  if (!modulo) return { tipo: "nenhuma" };
  const modo = auth.modos.get(modulo);
  if (modo === "todas") return { tipo: "todas" };
  if (modo === "selecionadas") return { tipo: "selecionadas" };
  return { tipo: "nenhuma" };
}

/** O membro enxerga ALGUMA empresa neste módulo? `selecionadas` pode ainda resultar em zero linhas no banco. */
export const moduloAcessivel = (auth: AutorizacaoPorModulo, modulo: string | null | undefined): boolean =>
  escopoDoModulo(auth, modulo).tipo !== "nenhuma";

/** Módulos com alguma configuração (para exibição/administração; proprietário não usa esta lista). */
export const modulosConfigurados = (auth: AutorizacaoPorModulo): string[] => [...auth.modos.keys()].sort();
