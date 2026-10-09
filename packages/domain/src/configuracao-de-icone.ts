/**
 * CONFIGURAÇÃO DE ÍCONE DO MAPA — MAPA-MANEJO-02.
 *
 * Funções PURAS (sem I/O) sobre `erp.configuracoes_de_icone` (migration 0062): qual configuração de ícone vale para
 * um lote, a partir das CATEGORIAS de animal presentes nele. A API lê as configurações e as categorias no SQL e
 * entrega aqui; a tela desenha. Ninguém redigita esta regra — API, tela e testes consomem DESTE arquivo.
 *
 * Sem ícone de propósito: nenhum nome de ícone, SVG ou imagem mora aqui. A configuração aponta para `icone_url`,
 * cadastrado pelo produto; o domínio só decide QUAL configuração vale.
 *
 * FORMA CANÔNICA DA CATEGORIA: sem espaço nas pontas e em MAIÚSCULAS, com 1 a 60 caracteres. É a MESMA regra da
 * CHECK `chk_icone_categoria_canonica` (`categoria = upper(btrim(categoria))`): sem ela o índice único aceitaria
 * "Boi" e "BOI" lado a lado, e a resolução ficaria ambígua. A API RECUSA (422) a categoria fora da forma — nunca a
 * traduz, porque gravar outra coisa que não a recebida é aceitar um contrato que ninguém declarou.
 */

/** A que entidade a configuração se aplica (CHECK de `erp.configuracoes_de_icone.tipo_entidade`). */
export const TIPOS_DE_ENTIDADE_DE_ICONE = ["lote", "objeto_de_mapa", "area"] as const;
export type TipoDeEntidadeDeIcone = (typeof TIPOS_DE_ENTIDADE_DE_ICONE)[number];

/**
 * Valor ESPECIAL de `categoria`: a configuração do lote MISTO (mais de uma categoria presente). Só ela carrega
 * `categorias_misto` — o conjunto de categorias que ela cobre (CHECK `chk_icone_misto_so_no_misto`).
 */
export const CATEGORIA_MISTO = "MISTO";

/** Tamanho máximo da categoria, em CARACTERES (o `char_length` do Postgres — não unidades UTF-16). */
export const TAMANHO_MAXIMO_DA_CATEGORIA = 60;

/**
 * O `btrim(texto)` do Postgres, sem segundo argumento: tira das pontas só o ESPAÇO (U+0020) — não tabulação, nem
 * quebra de linha, nem espaço não separável. Igual ao banco DE PROPÓSITO: as CHECKs usam `btrim`, e um domínio que
 * aparasse mais diria "vazio" ou "fora da forma" para o que o banco aceita (e o contrário). Laço, não expressão
 * regular: `/ +$/` volta atrás a cada espaço e fica quadrática numa entrada longa.
 */
export function btrim(texto: string): string {
  let inicio = 0;
  let fim = texto.length;
  while (inicio < fim && texto.charCodeAt(inicio) === 32) inicio++;
  while (fim > inicio && texto.charCodeAt(fim - 1) === 32) fim--;
  return texto.slice(inicio, fim);
}

/**
 * Categoria na forma canônica: `btrim` e maiúsculas (`toUpperCase`, independente de localidade). Serve para
 * COMPARAR (as categorias do animal chegam como cadastradas, "Boi", "boi ") — nunca para gravar a entrada do
 * usuário traduzida.
 */
export function normalizarCategoria(categoria: string): string {
  return btrim(categoria).toUpperCase();
}

/**
 * `true` quando a categoria JÁ está na forma canônica: igual a `normalizarCategoria(categoria)` e com 1 a 60
 * caracteres. É a régua que a API aplica à entrada antes de gravar (fora da forma → 422).
 *
 * O `toUpperCase` do JavaScript pode divergir do `upper` do Postgres em letras raras (o "ß" vira "SS" aqui); quando
 * diverge, o domínio fica MAIS estrito que o banco — recusa o que o banco aceitaria, nunca o contrário.
 */
export function categoriaCanonica(categoria: string): boolean {
  if (typeof categoria !== "string" || categoria !== normalizarCategoria(categoria)) return false;
  const caracteres = Array.from(categoria).length;
  return caracteres >= 1 && caracteres <= TAMANHO_MAXIMO_DA_CATEGORIA;
}

/** Uma configuração de ícone, como sai de `erp.configuracoes_de_icone`. */
export interface ConfiguracaoDeIcone {
  id: string;
  tipo_entidade: string;
  /** A categoria de animal (canônica) ou `CATEGORIA_MISTO`. */
  categoria: string;
  /** Só na configuração MISTO: as categorias que ela cobre. Nula nas outras. */
  categorias_misto: readonly string[] | null;
  icone_url: string | null;
  cor_padrao: string | null;
  ativo: boolean;
  deleted_at?: string | null;
}

/** Ordem de CÓDIGO (o `<` do JavaScript, por unidade UTF-16): determinística e igual em qualquer máquina, sem idioma. */
const porCodigo = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Separador do desempate: menor que qualquer caractere de categoria, para o `join` ordenar como as listas. */
const SEPARADOR = "\u0000";

/**
 * As categorias presentes, normalizadas (`normalizarCategoria`), sem as vazias, sem repetição e em ordem de código.
 * É a etapa 1 de `resolverIconeDoLote` e é o que a API devolve por área (`icone.categorias`). Entrada que não é
 * texto conta como vazia.
 */
export function categoriasPresentesNormalizadas(nomes: readonly string[]): string[] {
  const distintas = new Set<string>();
  for (const nome of nomes) {
    if (typeof nome !== "string") continue;
    const categoria = normalizarCategoria(nome);
    if (categoria !== "") distintas.add(categoria);
  }
  return [...distintas].sort(porCodigo);
}

/**
 * QUAL CONFIGURAÇÃO DE ÍCONE VALE PARA UM LOTE, pelas categorias de animal presentes nele.
 *
 * Só concorrem as configurações ATIVAS (`ativo === true`), vivas (sem `deleted_at`) e de `tipo_entidade` `lote`.
 * Nenhuma regra confia que o banco já filtrou, nem que a categoria gravada está canônica: tudo é normalizado aqui.
 *
 * 1. As presentes: normalizadas, sem vazias, sem repetição (`categoriasPresentesNormalizadas`). Nenhuma → `null`.
 * 2. UMA categoria distinta → a configuração NÃO-MISTO cuja categoria normalizada é ela. Se houver duas (o índice
 *    único do banco impede; a função não confia), ganha a de menor `id`. Sem configuração exata → `null`: UMA
 *    categoria nunca cai na MISTO (o lote não é misto só porque falta a configuração dele).
 * 3. VÁRIAS categorias → entre as MISTO, as cujo `categorias_misto` (normalizado, sem vazias) CONTÉM TODAS as
 *    presentes; ganha a de MENOR cardinalidade — a mais específica, a que cobre menos além do que o lote tem.
 * 4. Empate de cardinalidade → a de menor lista `categorias_misto` normalizada e ORDENADA (comparação do `join`, com
 *    um separador menor que qualquer caractere: equivale a comparar as listas elemento a elemento), e depois a de
 *    menor `id`. Determinístico: nunca "a primeira que o filtro produziu", que mudaria com a ordem da consulta.
 * 5. Nada casou → `null`.
 *
 * Toda comparação de texto é em ordem de CÓDIGO (independente de idioma). Devolve a própria configuração recebida.
 */
export function resolverIconeDoLote<T extends ConfiguracaoDeIcone>(categoriasPresentes: readonly string[], configs: readonly T[]): T | null {
  const presentes = categoriasPresentesNormalizadas(categoriasPresentes);
  if (presentes.length === 0) return null;
  const elegiveis = configs.filter((c) => c.ativo === true && (c.deleted_at ?? null) === null && c.tipo_entidade === "lote");

  if (presentes.length === 1) {
    const unica = presentes[0]!;
    const exatas = elegiveis.filter((c) => {
      const categoria = normalizarCategoria(c.categoria);
      return categoria !== CATEGORIA_MISTO && categoria === unica;
    });
    return exatas.sort((a, b) => porCodigo(a.id, b.id))[0] ?? null;
  }

  const candidatas: { config: T; cobertas: string[]; chave: string }[] = [];
  for (const c of elegiveis) {
    if (normalizarCategoria(c.categoria) !== CATEGORIA_MISTO || !Array.isArray(c.categorias_misto)) continue;
    const cobertas = categoriasPresentesNormalizadas(c.categorias_misto);
    const conjunto = new Set(cobertas);
    if (presentes.every((p) => conjunto.has(p))) candidatas.push({ config: c, cobertas, chave: cobertas.join(SEPARADOR) });
  }
  candidatas.sort((a, b) =>
    a.cobertas.length - b.cobertas.length || porCodigo(a.chave, b.chave) || porCodigo(a.config.id, b.config.id));
  return candidatas[0]?.config ?? null;
}
