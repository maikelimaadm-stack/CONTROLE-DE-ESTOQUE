import { D, DomainError, money, qty, unitCost, type DecimalString } from "@agro/shared";

export interface Balance { quantity: DecimalString; averageCost: DecimalString; totalValue: DecimalString }

/** Custo médio ponderado móvel após uma entrada. */
export function applyEntry(b: Balance, quantity: DecimalString, cost: DecimalString): Balance {
  const q = D(b.quantity).plus(quantity);
  const total = D(b.totalValue).plus(D(quantity).mul(cost).toDecimalPlaces(2));
  return { quantity: qty(q), totalValue: money(total), averageCost: q.gt(0) ? unitCost(total.div(q)) : unitCost(cost) };
}
/** Saída sempre ao custo médio corrente; não permite saldo negativo. */
export function applyExit(b: Balance, quantity: DecimalString): Balance & { exitCost: DecimalString } {
  if (D(b.quantity).lt(quantity)) throw new DomainError("INSUFFICIENT_STOCK", `Saldo insuficiente: disponível ${b.quantity}, solicitado ${quantity}`);
  const q = D(b.quantity).minus(quantity);
  const total = q.isZero() ? D(0) : D(b.totalValue).minus(D(quantity).mul(b.averageCost).toDecimalPlaces(2));
  return { quantity: qty(q), totalValue: money(total), averageCost: q.gt(0) ? b.averageCost : "0.000000", exitCost: b.averageCost };
}
/** Conversão de 2ª unidade (fator multiplica/divide), como no cadastro de produto. */
export function convertToPrimary(quantity: DecimalString, factorType: "multiply" | "divide" | null, factor: DecimalString | null): DecimalString {
  if (!factorType || !factor || D(factor).isZero()) return qty(quantity);
  return qty(factorType === "multiply" ? D(quantity).mul(factor) : D(quantity).div(factor));
}
/** Alerta de estoque mínimo (help do campo "Estoque mínimo"). */
export function belowMinStock(current: DecimalString, min: DecimalString | null): boolean {
  return min !== null && D(min).gt(0) && D(current).lte(min);
}
/** Custo de produção da batida = soma(qtd × custo médio dos ingredientes); custo unitário do produto acabado. */
export function batchCost(items: { quantity: DecimalString; unitCost: DecimalString }[], produced: DecimalString): { total: DecimalString; unit: DecimalString } {
  const total = items.reduce((a, i) => a.plus(D(i.quantity).mul(i.unitCost)), D(0)).toDecimalPlaces(2);
  return { total: money(total), unit: D(produced).gt(0) ? unitCost(total.div(produced)) : "0.000000" };
}
/** Classificação ABC por valor (80/15/5). */
export function abcClassify<T extends { value: DecimalString }>(items: T[]): (T & { cls: "A" | "B" | "C"; cumulative: DecimalString })[] {
  const sorted = [...items].sort((a, b) => D(b.value).minus(a.value).toNumber());
  const total = sorted.reduce((a, i) => a.plus(i.value), D(0));
  let acc = D(0);
  return sorted.map((i) => { acc = acc.plus(i.value); const pct = total.isZero() ? D(0) : acc.div(total).mul(100); return { ...i, cumulative: pct.toFixed(2), cls: pct.lte(80) ? "A" : pct.lte(95) ? "B" : "C" }; });
}
