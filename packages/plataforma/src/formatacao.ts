/**
 * FORMATAÇÃO POR IDIOMA (docs/I18N-CONTRACT.md, "Formatação").
 *
 * Ponto único de formatação de data, hora, número, moeda e percentual. Código novo NUNCA formata à mão
 * (nem `toFixed`, nem concatenação "dd/mm/aaaa", nem formatador espalhado pela tela): o idioma/região é
 * parâmetro, não constante de código.
 *
 * Valores decimais trafegam como texto ("1234.56") para não perder precisão; a conversão para número
 * acontece SÓ na apresentação, aqui — nunca em cálculo (cálculo continua em Decimal).
 */
import { IDIOMA_PADRAO, type Idioma } from "./idioma.js";

/** Moeda padrão por idioma; organizações multinacionais sobrescrevem em `OpcoesFormato.moeda`. */
const MOEDA_POR_IDIOMA: Readonly<Record<string, string>> = { "pt-BR": "BRL" };
export const MOEDA_PADRAO = "BRL";
export const moedaDoIdioma = (idioma: Idioma = IDIOMA_PADRAO): string => MOEDA_POR_IDIOMA[idioma] ?? MOEDA_PADRAO;

export interface OpcoesFormato {
  idioma?: Idioma;
  moeda?: string;
  fusoHorario?: string;
}
export interface OpcoesNumero extends OpcoesFormato {
  casasMinimas?: number;
  casasMaximas?: number;
}

/** Entrada aceita por qualquer formatador numérico: texto decimal, número ou vazio. */
export type ValorNumerico = string | number | null | undefined;

const comoNumero = (v: ValorNumerico): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

const DATA_ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Data de negócio ("AAAA-MM-DD") no formato do idioma. Sem fuso: data de negócio não tem hora. */
export function formatarData(valor: string | null | undefined, opts: OpcoesFormato = {}): string {
  if (!valor) return "";
  const iso = valor.slice(0, 10);
  const m = DATA_ISO.exec(iso);
  if (!m) return valor;
  const idioma = opts.idioma ?? IDIOMA_PADRAO;
  const data = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return new Intl.DateTimeFormat(idioma, { year: "numeric", month: "2-digit", day: "2-digit", timeZone: "UTC" }).format(data);
}

/** Marca de tempo ISO 8601 no formato do idioma (data + hora), no fuso pedido. */
export function formatarDataHora(valor: string | Date | null | undefined, opts: OpcoesFormato = {}): string {
  if (!valor) return "";
  const data = valor instanceof Date ? valor : new Date(valor);
  if (Number.isNaN(data.getTime())) return typeof valor === "string" ? valor : "";
  const idioma = opts.idioma ?? IDIOMA_PADRAO;
  const fuso = opts.fusoHorario;
  return new Intl.DateTimeFormat(idioma, { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", ...(fuso ? { timeZone: fuso } : {}) }).format(data);
}

export function formatarNumero(valor: ValorNumerico, opts: OpcoesNumero = {}): string {
  const n = comoNumero(valor);
  if (n === null) return "";
  const { idioma = IDIOMA_PADRAO, casasMinimas, casasMaximas } = opts;
  return new Intl.NumberFormat(idioma, {
    ...(casasMinimas !== undefined ? { minimumFractionDigits: casasMinimas } : {}),
    ...(casasMaximas !== undefined ? { maximumFractionDigits: casasMaximas } : {})
  }).format(n);
}

/** Moeda do idioma (ou a moeda pedida). Valor ausente devolve vazio, nunca "R$ 0,00" enganoso. */
export function formatarMoeda(valor: ValorNumerico, opts: OpcoesFormato = {}): string {
  const n = comoNumero(valor);
  if (n === null) return "";
  const idioma = opts.idioma ?? IDIOMA_PADRAO;
  return new Intl.NumberFormat(idioma, { style: "currency", currency: opts.moeda ?? moedaDoIdioma(idioma) }).format(n);
}

/** Quantidade: casas fixas (padrão 2), para não sugerir precisão que o dado não tem. */
export function formatarQuantidade(valor: ValorNumerico, casas = 2, opts: OpcoesFormato = {}): string {
  return formatarNumero(valor, { ...opts, casasMinimas: casas, casasMaximas: casas });
}

/** Percentual a partir do valor já em PONTOS PERCENTUAIS (12.5 → "12,5%"), como o domínio persiste. */
export function formatarPercentual(valor: ValorNumerico, opts: OpcoesNumero = {}): string {
  const n = comoNumero(valor);
  if (n === null) return "";
  const { idioma = IDIOMA_PADRAO, casasMinimas = 0, casasMaximas = 2 } = opts;
  return `${new Intl.NumberFormat(idioma, { minimumFractionDigits: casasMinimas, maximumFractionDigits: casasMaximas }).format(n)}%`;
}

/** Mês de competência ("AAAA-MM") por extenso no idioma ("setembro de 2026"). */
export function formatarMes(valor: string | null | undefined, opts: OpcoesFormato = {}): string {
  if (!valor) return "";
  const m = /^(\d{4})-(\d{2})/.exec(valor);
  if (!m) return valor;
  const idioma = opts.idioma ?? IDIOMA_PADRAO;
  const data = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1));
  return new Intl.DateTimeFormat(idioma, { month: "long", year: "numeric", timeZone: "UTC" }).format(data);
}

/** Formatadores já amarrados a um idioma — o que a camada de tela usa. */
export interface Formatador {
  idioma: Idioma;
  moeda: string;
  data: (v: string | null | undefined) => string;
  dataHora: (v: string | Date | null | undefined) => string;
  numero: (v: ValorNumerico, o?: OpcoesNumero) => string;
  valor: (v: ValorNumerico) => string;
  quantidade: (v: ValorNumerico, casas?: number) => string;
  percentual: (v: ValorNumerico, o?: OpcoesNumero) => string;
  mes: (v: string | null | undefined) => string;
}

export function criarFormatador(opts: OpcoesFormato = {}): Formatador {
  const idioma = opts.idioma ?? IDIOMA_PADRAO;
  const moeda = opts.moeda ?? moedaDoIdioma(idioma);
  const base: OpcoesFormato = { idioma, moeda, ...(opts.fusoHorario ? { fusoHorario: opts.fusoHorario } : {}) };
  return {
    idioma,
    moeda,
    data: (v) => formatarData(v, base),
    dataHora: (v) => formatarDataHora(v, base),
    numero: (v, o = {}) => formatarNumero(v, { ...base, ...o }),
    valor: (v) => formatarMoeda(v, base),
    quantidade: (v, casas = 2) => formatarQuantidade(v, casas, base),
    percentual: (v, o = {}) => formatarPercentual(v, { ...base, ...o }),
    mes: (v) => formatarMes(v, base)
  };
}
