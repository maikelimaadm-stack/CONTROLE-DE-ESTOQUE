import { D, type DecimalString, type ISODate } from "@agro/shared";
/** Ganho médio diário (kg/dia) entre duas pesagens. */
export function gmd(prevWeight: DecimalString, prevDate: ISODate, weight: DecimalString, date: ISODate): DecimalString | null {
  const days = (new Date(date + "T00:00:00Z").getTime() - new Date(prevDate + "T00:00:00Z").getTime()) / 864e5;
  if (days <= 0) return null;
  return D(weight).minus(prevWeight).div(days).toFixed(3);
}
/** Peso em arrobas (1 @ = 15 kg) e rendimento de carcaça padrão (50%) para valor do animal. */
export function arrobas(weightKg: DecimalString, carcassYieldPercent = 50): DecimalString {
  return D(weightKg).mul(carcassYieldPercent).div(100).div(15).toFixed(3);
}
export function animalValue(weightKg: DecimalString, pricePerArroba: DecimalString, carcassYieldPercent = 50): DecimalString {
  return D(arrobas(weightKg, carcassYieldPercent)).mul(pricePerArroba).toFixed(2);
}
/** Unidade animal (UA = 450 kg). */
export function animalUnits(weightKg: DecimalString): DecimalString { return D(weightKg).div(450).toFixed(3); }
/** Idade em meses. */
export function ageMonths(birth: ISODate, at: ISODate): number {
  const b = new Date(birth + "T00:00:00Z"), a = new Date(at + "T00:00:00Z");
  return (a.getUTCFullYear() - b.getUTCFullYear()) * 12 + (a.getUTCMonth() - b.getUTCMonth()) - (a.getUTCDate() < b.getUTCDate() ? 1 : 0);
}
/** Evolução de categoria por faixa etária (safra com auto_evolution). */
export function evolveCategory(cats: { id: string; minAgeMonths: number | null; maxAgeMonths: number | null; sex: "M" | "F" | null; nextCategoryId: string | null }[], animal: { categoryId: string; sex: "M" | "F" | null; ageMonths: number }): string | null {
  const cur = cats.find((c) => c.id === animal.categoryId);
  if (!cur || cur.maxAgeMonths === null || animal.ageMonths <= cur.maxAgeMonths) return null;
  if (cur.nextCategoryId) return cur.nextCategoryId;
  const next = cats.find((c) => c.sex === animal.sex && c.minAgeMonths !== null && c.minAgeMonths <= animal.ageMonths && (c.maxAgeMonths === null || c.maxAgeMonths >= animal.ageMonths));
  return next?.id ?? null;
}
/** Previsão de parto: gestação bovina ≈ 283 dias. */
export function expectedBirth(matingDate: ISODate, gestationDays = 283): ISODate {
  const d = new Date(matingDate + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + gestationDays); return d.toISOString().slice(0, 10);
}
/** Carência (dias) após aplicação de produto sanitário. */
export function withdrawalUntil(applicationDate: ISODate, days: number | null): ISODate | null {
  if (!days) return null;
  const d = new Date(applicationDate + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10);
}
