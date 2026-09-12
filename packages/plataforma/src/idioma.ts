/**
 * INFRAESTRUTURA DE IDIOMA (docs/I18N-CONTRACT.md).
 *
 * Três coisas que NUNCA se misturam:
 *   1. CHAVE CANÔNICA   — `acoes.salvar`: identificador estável, independente de idioma, usado no código;
 *   2. TRADUÇÃO         — "Salvar": apresentação, varia por idioma, nunca é comparada nem gravada;
 *   3. VALOR DE DOMÍNIO — `pending`: valor canônico persistido, idêntico em todos os idiomas.
 *
 * Regra dura: tradução nunca é persistida como dado de negócio. Uma situação é gravada como `pending` e
 * traduzida na apresentação ("Pendente"/"Pending"/"Pendiente") — ver `chaveDeEnum`.
 *
 * Idioma inicial obrigatório: pt-BR. A arquitetura aceita novos idiomas sem tocar no código de tela:
 * basta um catálogo novo e a preferência (organização/usuário) apontando para ele.
 */

export const IDIOMA_PADRAO = "pt-BR";
/** Idiomas com catálogo completo publicado. Acrescentar um idioma = acrescentar catálogo + entrada aqui. */
export const IDIOMAS_PUBLICADOS = [IDIOMA_PADRAO] as const;
export type IdiomaPublicado = (typeof IDIOMAS_PUBLICADOS)[number];
/** Etiqueta BCP 47. Aceita idiomas ainda não publicados (caem no fallback). */
export type Idioma = IdiomaPublicado | (string & {});

export type Mensagens = Readonly<Record<string, string>>;
export interface Catalogo {
  idioma: IdiomaPublicado;
  mensagens: Mensagens;
}

export const idiomaPublicado = (i: unknown): i is IdiomaPublicado =>
  typeof i === "string" && (IDIOMAS_PUBLICADOS as readonly string[]).includes(i);

/**
 * Precedência: usuário › organização › padrão do sistema.
 * Idioma pedido sem catálogo publicado cai para o próximo da cadeia (nunca quebra a tela).
 * `pt` casa com `pt-BR` (idioma sem região casa com a primeira região publicada daquele idioma).
 */
export function resolverIdioma(pref: { usuario?: string | null; organizacao?: string | null } = {}, publicados: readonly string[] = IDIOMAS_PUBLICADOS): IdiomaPublicado {
  for (const candidato of [pref.usuario, pref.organizacao]) {
    const achado = negociarIdioma(candidato, publicados);
    if (achado) return achado as IdiomaPublicado;
  }
  return IDIOMA_PADRAO;
}

/** Negociação simples de idioma: exato, depois só o idioma base (pt → pt-BR). */
export function negociarIdioma(pedido: string | null | undefined, publicados: readonly string[] = IDIOMAS_PUBLICADOS): string | null {
  if (!pedido) return null;
  const alvo = pedido.trim();
  if (!alvo) return null;
  const exato = publicados.find((s) => s.toLowerCase() === alvo.toLowerCase());
  if (exato) return exato;
  const base = alvo.split("-")[0]!.toLowerCase();
  return publicados.find((s) => s.split("-")[0]!.toLowerCase() === base) ?? null;
}

/** Chave canônica: segmentos minúsculos separados por ponto (`contexto.termo`). */
const CHAVE = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*(?:\.[a-z0-9][a-z0-9_]*)+$/;
export const ehChaveDeMensagem = (k: string): boolean => CHAVE.test(k);

export interface OpcoesTraducao {
  /** Catálogo do idioma pedido. */
  catalogo?: Catalogo | Mensagens;
  /** Catálogo usado quando a chave falta no idioma pedido (padrão: pt-BR). */
  reserva?: Catalogo | Mensagens;
  /** Texto devolvido quando a chave não existe em lugar nenhum (padrão: a própria chave). */
  ausente?: string;
}
export type ParametrosMensagem = Readonly<Record<string, string | number>>;

const mensagensDe = (c: Catalogo | Mensagens | undefined): Mensagens | undefined => (c && "mensagens" in c ? (c as Catalogo).mensagens : (c as Mensagens | undefined));

/** Interpolação `{nome}`; parâmetro ausente permanece literal para ficar visível em teste/revisão. */
export function interpolar(modelo: string, parametros: ParametrosMensagem = {}): string {
  return modelo.replace(/\{([a-z0-9_]+)\}/gi, (inteiro, nome: string) => (nome in parametros ? String(parametros[nome]) : inteiro));
}

export function traduzir(chave: string, parametros: ParametrosMensagem = {}, opts: OpcoesTraducao = {}): string {
  const principal = mensagensDe(opts.catalogo);
  const reserva = mensagensDe(opts.reserva);
  const modelo = principal?.[chave] ?? reserva?.[chave];
  if (modelo === undefined) return opts.ausente ?? chave;
  return interpolar(modelo, parametros);
}

export type Tradutor = ((chave: string, parametros?: ParametrosMensagem) => string) & { idioma: IdiomaPublicado };

/** Tradutor pronto para o idioma, já com reserva encadeada. */
export function criarTradutor(catalogo: Catalogo, reserva?: Catalogo): Tradutor {
  const t = ((chave: string, parametros: ParametrosMensagem = {}) => traduzir(chave, parametros, reserva ? { catalogo, reserva } : { catalogo })) as Tradutor;
  t.idioma = catalogo.idioma;
  return t;
}

/**
 * Ponte entre valores canônicos de domínio e tradução: `enums.status.pending`.
 * O valor persistido continua sendo `pending`; só o rótulo muda de idioma.
 */
export const chaveDeEnum = (dominio: string, valor: string): string => `enums.${dominio}.${valor}`;

/** Chaves presentes na referência e ausentes no catálogo (gate de tradução). */
export function chavesFaltantes(catalogo: Catalogo | Mensagens, referencia: Catalogo | Mensagens): string[] {
  const c = mensagensDe(catalogo) ?? {};
  const r = mensagensDe(referencia) ?? {};
  return Object.keys(r).filter((k) => !(k in c)).sort();
}

/** Problemas estruturais do catálogo (chave fora do padrão, texto vazio, placeholder órfão). */
export function validarCatalogo(catalogo: Catalogo): string[] {
  const problemas: string[] = [];
  for (const [chave, valor] of Object.entries(catalogo.mensagens)) {
    if (!ehChaveDeMensagem(chave)) problemas.push(`${catalogo.idioma}: chave fora do padrão canônico: "${chave}"`);
    if (!valor.trim()) problemas.push(`${catalogo.idioma}: tradução vazia em "${chave}"`);
    if (/\{\s*\}/.test(valor)) problemas.push(`${catalogo.idioma}: placeholder vazio em "${chave}"`);
  }
  return problemas;
}
