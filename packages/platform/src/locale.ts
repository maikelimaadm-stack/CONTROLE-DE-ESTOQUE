/**
 * ABSTRAÇÃO DE LOCALE (docs/I18N-CONTRACT.md, "Formatação").
 *
 * Ponto único de formatação de data, hora, número, moeda e percentual. Código novo NUNCA formata à mão
 * (nem `toFixed`, nem concatenação "dd/mm/aaaa", nem `Intl` espalhado): o idioma/região é um parâmetro,
 * não uma constante de código.
 *
 * Valores decimais trafegam como string ("1234.56") para não perder precisão; a conversão para número
 * acontece SÓ na apresentação, aqui — nunca em cálculo (cálculo é `@agro/shared/money`, em Decimal).
 */
import { DEFAULT_LOCALE, type Locale } from "./i18n.js";

/** Moeda padrão por idioma; organizações multinacionais sobrescrevem via `LocaleOptions.currency`. */
const CURRENCY_BY_LOCALE: Readonly<Record<string, string>> = { "pt-BR": "BRL" };
export const DEFAULT_CURRENCY = "BRL";
export const currencyForLocale = (locale: Locale = DEFAULT_LOCALE): string => CURRENCY_BY_LOCALE[locale] ?? DEFAULT_CURRENCY;

export interface LocaleOptions {
  locale?: Locale;
  currency?: string;
  timeZone?: string;
}
export interface NumberFormatOptions extends LocaleOptions {
  minimumFractionDigits?: number;
  maximumFractionDigits?: number;
}

/** Entrada aceita em qualquer formatador numérico: string decimal, número ou vazio. */
export type NumericInput = string | number | null | undefined;

const toNumber = (v: NumericInput): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Data de negócio ("AAAA-MM-DD") no formato do idioma. Sem fuso: data de negócio não tem hora. */
export function formatDate(value: string | null | undefined, opts: LocaleOptions = {}): string {
  if (!value) return "";
  const iso = value.slice(0, 10);
  const m = ISO_DATE_RE.exec(iso);
  if (!m) return value;
  const locale = opts.locale ?? DEFAULT_LOCALE;
  const date = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return new Intl.DateTimeFormat(locale, { year: "numeric", month: "2-digit", day: "2-digit", timeZone: "UTC" }).format(date);
}

/** Timestamp ISO 8601 no formato do idioma (data + hora), no fuso pedido. */
export function formatDateTime(value: string | Date | null | undefined, opts: LocaleOptions = {}): string {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return typeof value === "string" ? value : "";
  const locale = opts.locale ?? DEFAULT_LOCALE;
  const timeZone = opts.timeZone;
  return new Intl.DateTimeFormat(locale, { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", ...(timeZone ? { timeZone } : {}) }).format(date);
}

export function formatNumber(value: NumericInput, opts: NumberFormatOptions = {}): string {
  const n = toNumber(value);
  if (n === null) return "";
  const { locale = DEFAULT_LOCALE, minimumFractionDigits, maximumFractionDigits } = opts;
  return new Intl.NumberFormat(locale, {
    ...(minimumFractionDigits !== undefined ? { minimumFractionDigits } : {}),
    ...(maximumFractionDigits !== undefined ? { maximumFractionDigits } : {})
  }).format(n);
}

/** Moeda do idioma (ou a moeda pedida). Valor ausente devolve string vazia, nunca "R$ 0,00" enganoso. */
export function formatCurrency(value: NumericInput, opts: LocaleOptions = {}): string {
  const n = toNumber(value);
  if (n === null) return "";
  const locale = opts.locale ?? DEFAULT_LOCALE;
  return new Intl.NumberFormat(locale, { style: "currency", currency: opts.currency ?? currencyForLocale(locale) }).format(n);
}

/** Quantidade: casas fixas (padrão 2), para não sugerir precisão que o dado não tem. */
export function formatQuantity(value: NumericInput, places = 2, opts: LocaleOptions = {}): string {
  return formatNumber(value, { ...opts, minimumFractionDigits: places, maximumFractionDigits: places });
}

/** Percentual a partir do valor já em PONTOS PERCENTUAIS (12.5 → "12,5%"), como o domínio persiste. */
export function formatPercent(value: NumericInput, opts: NumberFormatOptions = {}): string {
  const n = toNumber(value);
  if (n === null) return "";
  const { locale = DEFAULT_LOCALE, minimumFractionDigits = 0, maximumFractionDigits = 2 } = opts;
  return `${new Intl.NumberFormat(locale, { minimumFractionDigits, maximumFractionDigits }).format(n)}%`;
}

/** Mês de competência ("AAAA-MM") por extenso no idioma ("setembro de 2026"). */
export function formatMonth(value: string | null | undefined, opts: LocaleOptions = {}): string {
  if (!value) return "";
  const m = /^(\d{4})-(\d{2})/.exec(value);
  if (!m) return value;
  const locale = opts.locale ?? DEFAULT_LOCALE;
  const date = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1));
  return new Intl.DateTimeFormat(locale, { month: "long", year: "numeric", timeZone: "UTC" }).format(date);
}

/** Formatadores já amarrados a um idioma — o que a camada de tela usa. */
export interface LocaleFormatter {
  locale: Locale;
  currency: string;
  date: (v: string | null | undefined) => string;
  dateTime: (v: string | Date | null | undefined) => string;
  number: (v: NumericInput, o?: NumberFormatOptions) => string;
  currencyValue: (v: NumericInput) => string;
  quantity: (v: NumericInput, places?: number) => string;
  percent: (v: NumericInput, o?: NumberFormatOptions) => string;
  month: (v: string | null | undefined) => string;
}

export function createFormatter(opts: LocaleOptions = {}): LocaleFormatter {
  const locale = opts.locale ?? DEFAULT_LOCALE;
  const currency = opts.currency ?? currencyForLocale(locale);
  const base: LocaleOptions = { locale, currency, ...(opts.timeZone ? { timeZone: opts.timeZone } : {}) };
  return {
    locale,
    currency,
    date: (v) => formatDate(v, base),
    dateTime: (v) => formatDateTime(v, base),
    number: (v, o = {}) => formatNumber(v, { ...base, ...o }),
    currencyValue: (v) => formatCurrency(v, base),
    quantity: (v, places = 2) => formatQuantity(v, places, base),
    percent: (v, o = {}) => formatPercent(v, { ...base, ...o }),
    month: (v) => formatMonth(v, base)
  };
}
