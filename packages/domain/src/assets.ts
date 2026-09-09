import { D, money, type DecimalString, type ISODate } from "@agro/shared";
/** Depreciação linear mensal (com ou sem valor residual), como no cadastro de bens. */
export function monthlyDepreciation(i: { acquisitionValue: DecimalString; residualPercent?: DecimalString | null; lifeYears: DecimalString; type: "with_residual" | "without_residual" }): { residualValue: DecimalString; depreciableValue: DecimalString; monthly: DecimalString; annualPercent: DecimalString } {
  const acq = D(i.acquisitionValue);
  const residual = i.type === "with_residual" ? acq.mul(D(i.residualPercent ?? 0)).div(100) : D(0);
  const depreciable = acq.minus(residual);
  const years = D(i.lifeYears);
  const monthly = years.gt(0) ? depreciable.div(years.mul(12)) : D(0);
  return { residualValue: money(residual), depreciableValue: money(depreciable), monthly: money(monthly), annualPercent: years.gt(0) ? D(100).div(years).toFixed(4) : "0.0000" };
}
/** Previsão de depreciação: saldo a depreciar mês a mês a partir de um ponto. */
export function depreciationForecast(depreciable: DecimalString, alreadyDepreciated: DecimalString, monthly: DecimalString, fromMonth: ISODate, months: number): { month: string; amount: DecimalString; accumulated: DecimalString; remaining: DecimalString }[] {
  const out = [];
  let acc = D(alreadyDepreciated);
  const total = D(depreciable);
  let y = +fromMonth.slice(0, 4), m = +fromMonth.slice(5, 7);
  for (let k = 0; k < months && acc.lt(total); k++) {
    const amount = D(monthly).gt(total.minus(acc)) ? total.minus(acc) : D(monthly);
    acc = acc.plus(amount);
    out.push({ month: `${y}-${String(m).padStart(2, "0")}`, amount: money(amount), accumulated: money(acc), remaining: money(total.minus(acc)) });
    m++; if (m > 12) { m = 1; y++; }
  }
  return out;
}
