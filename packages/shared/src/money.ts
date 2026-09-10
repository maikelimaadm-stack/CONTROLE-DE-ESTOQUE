import { Decimal } from "decimal.js";
type DecimalValue = Decimal.Value;

Decimal.set({ precision: 28, rounding: Decimal.ROUND_HALF_EVEN });

/** Valores monetários e quantidades são sempre transportados como string decimal ("1234.56"). */
export type DecimalString = string;

export const D = (v: DecimalValue): Decimal => new Decimal(v ?? 0);

export const money = (v: DecimalValue): DecimalString => D(v).toDecimalPlaces(2, Decimal.ROUND_HALF_EVEN).toFixed(2);
export const qty = (v: DecimalValue, places = 4): DecimalString => D(v).toDecimalPlaces(places, Decimal.ROUND_HALF_EVEN).toFixed(places);
export const unitCost = (v: DecimalValue): DecimalString => D(v).toDecimalPlaces(6, Decimal.ROUND_HALF_EVEN).toFixed(6);

export const sum = (values: DecimalValue[]): Decimal => values.reduce<Decimal>((acc, v) => acc.plus(D(v)), D(0));
export const isZero = (v: DecimalValue) => D(v).isZero();
export const gt = (a: DecimalValue, b: DecimalValue) => D(a).gt(D(b));
export const gte = (a: DecimalValue, b: DecimalValue) => D(a).gte(D(b));
export const lt = (a: DecimalValue, b: DecimalValue) => D(a).lt(D(b));

/**
 * Divide um valor em N parcelas com 2 casas, garantindo que a soma das parcelas seja exatamente o total
 * (resíduo de arredondamento aplicado na última parcela).
 */
export function splitEvenly(total: DecimalValue, parts: number): DecimalString[] {
  if (!Number.isInteger(parts) || parts < 1) throw new RangeError("parts must be >= 1");
  const t = D(total);
  const base = t.div(parts).toDecimalPlaces(2, Decimal.ROUND_DOWN);
  const out: Decimal[] = Array.from({ length: parts }, () => base);
  const residual = t.minus(base.mul(parts));
  out[parts - 1] = out[parts - 1]!.plus(residual);
  return out.map((x) => x.toFixed(2));
}

/** Formata para pt-BR (R$ 1.234,56). */
export function formatBRL(v: DecimalValue): string {
  const n = D(v).toNumber();
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n);
}
export function formatQty(v: DecimalValue, places = 2): string {
  return new Intl.NumberFormat("pt-BR", { minimumFractionDigits: places, maximumFractionDigits: places }).format(D(v).toNumber());
}
/** Converte "1.234,56" (pt-BR) para "1234.56". */
export function parseBRNumber(input: string): DecimalString {
  const s = input.trim().replace(/\./g, "").replace(",", ".");
  if (s === "" || Number.isNaN(Number(s))) throw new RangeError(`número inválido: ${input}`);
  return D(s).toString();
}
export { Decimal };
export type { DecimalValue };
