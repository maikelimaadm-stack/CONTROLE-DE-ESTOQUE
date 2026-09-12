/**
 * INFRAESTRUTURA DE INTERNACIONALIZAÇÃO (docs/I18N-CONTRACT.md).
 *
 * Três coisas que NUNCA se misturam:
 *   1. CHAVE CANÔNICA  — `acoes.salvar`: identificador estável, independente de idioma, usado no código;
 *   2. TRADUÇÃO        — "Salvar": apresentação, varia por idioma, nunca é comparada nem gravada;
 *   3. VALOR DE DOMÍNIO — `pending`: valor canônico persistido, idêntico em todos os idiomas.
 *
 * Regra dura: tradução nunca é persistida como dado de negócio. Uma situação é gravada como `pending`
 * e traduzida na apresentação ("Pendente"/"Pending"/"Pendiente") — ver `enumMessageKey`.
 *
 * Idioma inicial obrigatório: pt-BR. A arquitetura aceita novos idiomas sem tocar no código de tela:
 * basta um catálogo novo e a preferência (organização/usuário) apontando para ele.
 */

export const DEFAULT_LOCALE = "pt-BR";
/** Idiomas com catálogo completo publicado. Acrescentar um idioma = acrescentar catálogo + entrada aqui. */
export const SUPPORTED_LOCALES = [DEFAULT_LOCALE] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];
/** Tag BCP 47. Aceita idiomas ainda não publicados (caem no fallback). */
export type Locale = SupportedLocale | (string & {});

export type Messages = Readonly<Record<string, string>>;
export interface Catalog {
  locale: SupportedLocale;
  messages: Messages;
}

export const isSupportedLocale = (l: unknown): l is SupportedLocale =>
  typeof l === "string" && (SUPPORTED_LOCALES as readonly string[]).includes(l);

/**
 * Precedência do idioma: usuário › organização › padrão do sistema.
 * Idioma pedido sem catálogo publicado cai para o próximo da cadeia (nunca quebra a tela).
 * `pt` casa com `pt-BR` (idioma sem região casa com a primeira região publicada daquele idioma).
 */
export function resolveLocale(pref: { user?: string | null; organization?: string | null } = {}, supported: readonly string[] = SUPPORTED_LOCALES): SupportedLocale {
  for (const candidate of [pref.user, pref.organization]) {
    const match = matchLocale(candidate, supported);
    if (match) return match as SupportedLocale;
  }
  return DEFAULT_LOCALE;
}

/** Negociação simples de idioma: exato, depois só o idioma base (pt → pt-BR). */
export function matchLocale(requested: string | null | undefined, supported: readonly string[] = SUPPORTED_LOCALES): string | null {
  if (!requested) return null;
  const want = requested.trim();
  if (!want) return null;
  const exact = supported.find((s) => s.toLowerCase() === want.toLowerCase());
  if (exact) return exact;
  const base = want.split("-")[0]!.toLowerCase();
  return supported.find((s) => s.split("-")[0]!.toLowerCase() === base) ?? null;
}

/** Chave canônica: segmentos minúsculos separados por ponto (`modulo.contexto.termo`). */
const KEY_RE = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*(?:\.[a-z0-9][a-z0-9_]*)+$/;
export const isMessageKey = (k: string): boolean => KEY_RE.test(k);

export interface TranslateOptions {
  /** Catálogo do idioma pedido. */
  catalog?: Catalog | Messages;
  /** Catálogo usado quando a chave falta no idioma pedido (padrão: pt-BR). */
  fallback?: Catalog | Messages;
  /** Texto devolvido quando a chave não existe em lugar nenhum (padrão: a própria chave). */
  missing?: string;
}
export type MessageParams = Readonly<Record<string, string | number>>;

const messagesOf = (c: Catalog | Messages | undefined): Messages | undefined => (c && "messages" in c ? (c as Catalog).messages : (c as Messages | undefined));

/** Interpolação `{nome}`; parâmetro ausente permanece literal para ficar visível em teste/revisão. */
export function interpolate(template: string, params: MessageParams = {}): string {
  return template.replace(/\{([a-z0-9_]+)\}/gi, (whole, name: string) => (name in params ? String(params[name]) : whole));
}

export function translate(key: string, params: MessageParams = {}, opts: TranslateOptions = {}): string {
  const primary = messagesOf(opts.catalog);
  const fallback = messagesOf(opts.fallback);
  const template = primary?.[key] ?? fallback?.[key];
  if (template === undefined) return opts.missing ?? key;
  return interpolate(template, params);
}

export type Translator = ((key: string, params?: MessageParams) => string) & { locale: SupportedLocale };

/** Tradutor pronto para o idioma, já com fallback encadeado. */
export function createTranslator(catalog: Catalog, fallback?: Catalog): Translator {
  const t = ((key: string, params: MessageParams = {}) => translate(key, params, fallback ? { catalog, fallback } : { catalog })) as Translator;
  t.locale = catalog.locale;
  return t;
}

/**
 * Ponte entre valores canônicos de domínio e tradução: `enums.status.pending`.
 * O valor persistido continua sendo `pending`; só o rótulo muda de idioma.
 */
export const enumMessageKey = (domain: string, value: string): string => `enums.${domain}.${value}`;

/** Chaves presentes na referência e ausentes no catálogo (gate de tradução). */
export function missingMessageKeys(catalog: Catalog | Messages, reference: Catalog | Messages): string[] {
  const c = messagesOf(catalog) ?? {};
  const r = messagesOf(reference) ?? {};
  return Object.keys(r).filter((k) => !(k in c)).sort();
}

/** Problemas estruturais do catálogo (chaves fora do padrão, texto vazio, placeholder órfão). */
export function validateCatalog(catalog: Catalog): string[] {
  const problems: string[] = [];
  for (const [key, value] of Object.entries(catalog.messages)) {
    if (!isMessageKey(key)) problems.push(`${catalog.locale}: chave fora do padrão canônico: "${key}"`);
    if (!value.trim()) problems.push(`${catalog.locale}: tradução vazia em "${key}"`);
    if (/\{\s*\}/.test(value)) problems.push(`${catalog.locale}: placeholder vazio em "${key}"`);
  }
  return problems;
}
