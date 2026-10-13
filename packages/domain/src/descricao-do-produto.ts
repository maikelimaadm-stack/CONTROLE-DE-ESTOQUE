/**
 * DESCRIÇÃO DO PRODUTO — XML-02 (decisão 314): o 5º caminho do vínculo do item da nota, a DESCRIÇÃO semelhante.
 *
 * Ele só roda para o item que os quatro caminhos de identidade (lembrado, código no fornecedor, código de barras,
 * referência) não resolveram, e a semelhança NUNCA decide sozinha: no máximo SUGERE, e a sugestão não grava vínculo
 * lembrado (só o que o operador confirma). Tudo o que define a semelhança mora AQUI, escrito uma vez:
 *
 *  1. a NORMALIZAÇÃO — pura e determinística, a MESMA em TypeScript (`normalizarDescricao`) e em SQL
 *     (`sqlDescricaoNormalizada`): as duas usam as MESMAS duas strings do `translate` (`TRADUCAO_DA_DESCRICAO_DE` →
 *     `TRADUCAO_DA_DESCRICAO_PARA`), passadas à consulta como PARÂMETRO;
 *  2. os LEXEMAS — `to_tsvector('pg_catalog.portuguese', <normalizada>)`: radical, plural e palavra vazia saem do
 *     Postgres de fábrica (`sqlLexemasDaDescricao`), nunca de uma segunda implementação;
 *  3. a PONTUAÇÃO — o Jaccard dos lexemas, em INTEIROS: `comuns` = |A ∩ B| e `total` = |A ∪ B|
 *     (`pontuacaoDaDescricao` e `sqlLexemasEmComum`/`sqlLexemasNoTotal` dão os mesmos números);
 *  4. o LIMIAR — maioria ESTRITA: o produto é candidato quando os lexemas em COMUM são MAIS do que os lexemas que só
 *     uma das duas descrições tem (comuns/total > 1/2). Exatamente a metade NÃO conta;
 *  5. o TETO de candidatos do ambíguo e a DECISÃO pura sobre os candidatos já pontuados (`decidirPelaDescricao`).
 *
 * O NCM NUNCA casa sozinho: ele só DESEMPATA a ordem entre candidatos de MESMA pontuação. Não acrescenta candidato,
 * não tira candidato e não muda a situação (nenhum / sugerido / ambíguo sai só da descrição).
 *
 * SEM EXTENSÃO (sem `unaccent`, sem `pg_trgm`): o papel que aplica as migrations na produção não tem CREATE no banco.
 * E SEM `lower()`: ele depende do LC_CTYPE do banco (num banco "C", `lower('Á')` = 'Á'; em C.UTF-8/en_US,
 * `lower('İ')` = 'i', enquanto o `toLowerCase` do JavaScript dá 'i' + U+0307). Por isso a passagem para minúscula
 * das letras A–Z também está no `translate`, e nenhum dos dois lados chama `lower`.
 */

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// 1. NORMALIZAÇÃO
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────

const MAIUSCULAS_ASCII = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const MINUSCULAS_ASCII = "abcdefghijklmnopqrstuvwxyz";
/** As letras acentuadas do português (e as vizinhas que aparecem em descrição: trema, crase, ñ), na mesma ordem… */
const ACENTUADAS_MAIUSCULAS = "ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ";
const ACENTUADAS_MINUSCULAS = "áàâãäéèêëíìîïóòôõöúùûüçñ";
/** …e a letra sem acento de cada uma, posição por posição. */
const SEM_ACENTO = "aaaaaeeeeiiiiooooouuuucn";
/**
 * As marcas combinantes U+0300–U+036F (acento escrito SEPARADO da letra, a forma NFD: "C" + U+0327). Elas ficam no
 * fim de DE, sem par em PARA — e o `translate` do Postgres APAGA o caractere de DE que não tem par —, então
 * "RAÇÃO" vira "racao" igual a "RAÇÃO".
 */
const MARCAS_COMBINANTES = Array.from({ length: 0x70 }, (_, i) => String.fromCodePoint(0x300 + i)).join("");

/** O DE do `translate`: A–Z, as acentuadas maiúsculas, as acentuadas minúsculas e, por último, as marcas combinantes. */
export const TRADUCAO_DA_DESCRICAO_DE = MAIUSCULAS_ASCII + ACENTUADAS_MAIUSCULAS + ACENTUADAS_MINUSCULAS + MARCAS_COMBINANTES;
/** O PARA do `translate`: a–z e a letra sem acento (duas vezes). Mais curto que DE de propósito: o que sobra em DE é apagado. */
export const TRADUCAO_DA_DESCRICAO_PARA = MINUSCULAS_ASCII + SEM_ACENTO + SEM_ACENTO;

/**
 * O `translate(texto, de, para)` do Postgres, caractere a caractere (ponto de código): o caractere que está em `de`
 * vira o da MESMA posição em `para` (a primeira ocorrência em `de` vale); sem par em `para`, é apagado; fora de
 * `de`, fica como está.
 */
export function traduzirComoOPostgres(texto: string, de: string, para: string): string {
  return traduzirPeloMapa(texto, mapaDaTraducao(de, para));
}

function mapaDaTraducao(de: string, para: string): ReadonlyMap<string, string> {
  const destino = [...para];
  const mapa = new Map<string, string>();
  [...de].forEach((c, i) => { if (!mapa.has(c)) mapa.set(c, destino[i] ?? ""); });
  return mapa;
}

function traduzirPeloMapa(texto: string, mapa: ReadonlyMap<string, string>): string {
  let saida = "";
  for (const c of texto) saida += mapa.get(c) ?? c;
  return saida;
}

const MAPA_DA_DESCRICAO = mapaDaTraducao(TRADUCAO_DA_DESCRICAO_DE, TRADUCAO_DA_DESCRICAO_PARA);

/** O que não é a–z nem 0–9 DEPOIS do `translate`. A MESMA classe do `regexp_replace` de `sqlDescricaoNormalizada`. */
const NAO_LETRA_NEM_DIGITO = /[^a-z0-9]+/gu;

/**
 * A descrição normalizada: (1) `translate` — A–Z para minúscula, acento tirado, marca combinante apagada; (2) toda
 * sequência de caracteres que não é a–z nem 0–9 (hífen, barra, ponto, vírgula, espaço, tabulação, "º", letra de
 * fora do português) vira UM espaço; (3) aparada. "ADUBO NPK 04-14-08" → "adubo npk 04 14 08";
 * "PROTEINADO SAL  MINERAL" → "proteinado sal mineral". Nulo ou vazio → "".
 */
export function normalizarDescricao(texto: string | null | undefined): string {
  return traduzirPeloMapa(texto ?? "", MAPA_DA_DESCRICAO).replace(NAO_LETRA_NEM_DIGITO, " ").trim();
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// A MESMA REGRA EM SQL — construtores de expressão. A coluna e os parâmetros são conferidos (nunca entrada do usuário).
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** A configuração textual do Postgres de fábrica (radical e palavras vazias do português), qualificada pelo schema. */
export const CONFIGURACAO_TEXTUAL_DA_DESCRICAO = "pg_catalog.portuguese";

const IDENTIFICADOR_SQL = /^[a-z_][a-z0-9_]*(\.[a-z_][a-z0-9_]*)?$/;
const PARAMETRO_SQL = /^\$[1-9][0-9]*$/;

function identificadorSql(valor: string, papel: string): string {
  if (!IDENTIFICADOR_SQL.test(valor)) throw new Error(`descricao-do-produto: ${papel} não é um identificador SQL simples: ${JSON.stringify(valor)}`);
  return valor;
}
function parametroSql(valor: string, papel: string): string {
  if (!PARAMETRO_SQL.test(valor)) throw new Error(`descricao-do-produto: ${papel} não é um parâmetro posicional ($n): ${JSON.stringify(valor)}`);
  return valor;
}

/**
 * A normalização em SQL, para a coluna `coluna` (ex.: "p.description", "t.descricao"), com os parâmetros `de` e
 * `para` (ex.: "$3", "$4") ligados a `TRADUCAO_DA_DESCRICAO_DE` e `TRADUCAO_DA_DESCRICAO_PARA`:
 * `btrim(regexp_replace(translate(coalesce(<coluna>, ''), $de::text, $para::text), '[^a-z0-9]+', ' ', 'g'))`.
 * Só funções imutáveis do Postgres de fábrica; nenhuma depende de locale (a saída do `translate` só tem ASCII ou o
 * caractere de fora da tabela, que o `regexp_replace` troca por espaço).
 */
export function sqlDescricaoNormalizada(coluna: string, de: string, para: string): string {
  return `btrim(regexp_replace(translate(coalesce(${identificadorSql(coluna, "coluna")}, ''), ${parametroSql(de, "de")}::text, ${parametroSql(para, "para")}::text), '[^a-z0-9]+', ' ', 'g'))`;
}

/**
 * Os lexemas da descrição (text[] ordenado e sem repetição): `tsvector_to_array(to_tsvector('pg_catalog.portuguese',
 * <normalizada>))`. Calcule UMA vez por produto e por item — numa CTE `as materialized` —, e só então cruze: CTE
 * comum citada uma vez é embutida pelo Postgres, e o par a par refaz o `to_tsvector` de cada produto para cada item
 * (423 produtos × 12 itens: ~143 ms embutida, ~15 ms materializada, medido no Postgres 16 local).
 */
export function sqlLexemasDaDescricao(coluna: string, de: string, para: string): string {
  return `tsvector_to_array(to_tsvector('${CONFIGURACAO_TEXTUAL_DA_DESCRICAO}'::regconfig, ${sqlDescricaoNormalizada(coluna, de, para)}))`;
}

/** |A ∩ B| de dois text[] de lexemas (colunas `a` e `b`), em int. */
export function sqlLexemasEmComum(a: string, b: string): string {
  return `cardinality(array(select unnest(${identificadorSql(a, "a")}) intersect select unnest(${identificadorSql(b, "b")})))`;
}

/** |A ∪ B| de dois text[] de lexemas (colunas `a` e `b`), em int. */
export function sqlLexemasNoTotal(a: string, b: string): string {
  return `cardinality(array(select unnest(${identificadorSql(a, "a")}) union select unnest(${identificadorSql(b, "b")})))`;
}

/** O limiar em SQL, sobre as colunas inteiras `comuns` e `total`: `(comuns * 2 > total * 1)` — estrito, em inteiros. */
export function sqlAcimaDoLimiarDaDescricao(comuns: string, total: string): string {
  return `(${identificadorSql(comuns, "comuns")} * ${LIMIAR_DA_DESCRICAO.denominador} > ${identificadorSql(total, "total")} * ${LIMIAR_DA_DESCRICAO.numerador})`;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// 3–4. PONTUAÇÃO E LIMIAR
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** A pontuação de um par (item da nota × produto): lexemas em comum e lexemas no total (a união). Jaccard = comuns/total. */
export interface PontuacaoDaDescricao {
  comuns: number;
  total: number;
}

/** O Jaccard de dois conjuntos de lexemas, em inteiros (repetição não conta). */
export function pontuacaoDaDescricao(lexemasDoItem: readonly string[], lexemasDoProduto: readonly string[]): PontuacaoDaDescricao {
  const a = new Set(lexemasDoItem);
  const b = new Set(lexemasDoProduto);
  let comuns = 0;
  for (const x of a) if (b.has(x)) comuns += 1;
  return { comuns, total: a.size + b.size - comuns };
}

/**
 * O limiar, como fração: o candidato precisa de comuns/total ESTRITAMENTE maior que 1/2. Calibrado na nota da fase 0
 * (XML-02): o menor par que deve casar dá 3/5 (o glifosato, com "G/L" sobrando) e o maior par que não deve casar dá
 * 2/5 (a ração de lactação contra a de engorda); 1/2 é o meio, com margem de 1/10 para cada lado.
 */
export const LIMIAR_DA_DESCRICAO = Object.freeze({ numerador: 1, denominador: 2 } as const);

function conferirPontuacao(p: PontuacaoDaDescricao): void {
  if (!Number.isSafeInteger(p.comuns) || !Number.isSafeInteger(p.total) || p.comuns < 0 || p.comuns > p.total) {
    throw new RangeError(`descricao-do-produto: pontuação inválida (comuns=${String(p.comuns)}, total=${String(p.total)})`);
  }
}

/** Acima do limiar: comuns × 2 > total × 1 (inteiros; exatamente a metade NÃO conta; total 0 nunca conta). */
export function acimaDoLimiarDaDescricao(p: PontuacaoDaDescricao): boolean {
  conferirPontuacao(p);
  return p.comuns * LIMIAR_DA_DESCRICAO.denominador > p.total * LIMIAR_DA_DESCRICAO.numerador;
}

/** Mesmo NCM: só os dígitos, os dois preenchidos e iguais. Nulo ou vazio de qualquer lado ⇒ falso. */
export function mesmoNcm(ncmDoItem: string | null | undefined, ncmDoProduto: string | null | undefined): boolean {
  const a = (ncmDoItem ?? "").replace(/[^0-9]/g, "");
  const b = (ncmDoProduto ?? "").replace(/[^0-9]/g, "");
  return a !== "" && a === b;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// 5. TETO E DECISÃO
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * No máximo 5 candidatos no ambíguo. A tela os mostra como uma fileira de botões (aba de itens); passando de 5, a
 * descrição já não separa nada e a escolha volta a ser BUSCA, que o seletor de produto já oferece. `acimaDoLimiar`
 * diz quantos havia antes do corte.
 */
export const TETO_DE_CANDIDATOS_DA_DESCRICAO = 5;

/** O candidato que a consulta devolve: o produto (id e código), a pontuação do par e se o NCM é o mesmo do item. */
export interface CandidatoDaDescricao extends PontuacaoDaDescricao {
  id: string;
  codigo: string;
  mesmoNcm: boolean;
}

/**
 * A ordem dos candidatos, total e determinística: (1) pontuação maior primeiro (frações comparadas em inteiros);
 * (2) no EMPATE de pontuação, o de mesmo NCM primeiro — o único papel do NCM; (3) código; (4) id. Código e id são
 * comparados por unidade de código (sem locale), como `collate "C"` no SQL.
 */
export function compararCandidatosDaDescricao(a: CandidatoDaDescricao, b: CandidatoDaDescricao): number {
  const porPontuacao = b.comuns * a.total - a.comuns * b.total;
  if (porPontuacao !== 0) return porPontuacao;
  if (a.mesmoNcm !== b.mesmoNcm) return a.mesmoNcm ? -1 : 1;
  if (a.codigo !== b.codigo) return a.codigo < b.codigo ? -1 : 1;
  if (a.id !== b.id) return a.id < b.id ? -1 : 1;
  return 0;
}

export type DecisaoDaDescricao<T extends CandidatoDaDescricao> =
  | { situacao: "nenhum" }
  | { situacao: "sugerido"; origem: "descricao"; candidato: T }
  | { situacao: "ambiguo"; candidatos: T[]; acimaDoLimiar: number };

/**
 * A decisão do 5º caminho, sobre os candidatos que a consulta devolveu (pontuados; a ordem de entrada não importa —
 * a decisão reordena por `compararCandidatosDaDescricao`):
 *  - nenhum acima do limiar → `nenhum`;
 *  - exatamente 1 → `sugerido`, origem "descricao" (nada é gravado: a pessoa confirma);
 *  - mais de 1 → `ambiguo`, nada escolhido, os candidatos na ordem e cortados no teto.
 * O mesmo produto repetido conta uma vez (fica a melhor posição). Pontuação inválida é erro de programação: lança.
 */
export function decidirPelaDescricao<T extends CandidatoDaDescricao>(candidatos: readonly T[]): DecisaoDaDescricao<T> {
  const ordenados = candidatos.filter((c) => acimaDoLimiarDaDescricao(c)).sort(compararCandidatosDaDescricao);
  const vistos = new Set<string>();
  const acima = ordenados.filter((c) => (vistos.has(c.id) ? false : (vistos.add(c.id), true)));
  const [primeiro] = acima;
  if (!primeiro) return { situacao: "nenhum" };
  if (acima.length === 1) return { situacao: "sugerido", origem: "descricao", candidato: primeiro };
  return { situacao: "ambiguo", candidatos: acima.slice(0, TETO_DE_CANDIDATOS_DA_DESCRICAO), acimaDoLimiar: acima.length };
}
