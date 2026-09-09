/** Datas de negócio trafegam como ISO "YYYY-MM-DD"; timestamps como ISO 8601 com fuso. */
export type ISODate = string;

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const BR_RE = /^(\d{2})\/(\d{2})\/(\d{4})$/;

export function isISODate(s: string): s is ISODate {
  const m = ISO_RE.exec(s);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!));
  return d.getUTCFullYear() === +m[1]! && d.getUTCMonth() === +m[2]! - 1 && d.getUTCDate() === +m[3]!;
}
/** "DD/MM/AAAA" -> "AAAA-MM-DD" */
export function brToISO(s: string): ISODate {
  const m = BR_RE.exec(s.trim());
  if (!m) throw new RangeError(`data inválida: ${s}`);
  const iso = `${m[3]}-${m[2]}-${m[1]}`;
  if (!isISODate(iso)) throw new RangeError(`data inválida: ${s}`);
  return iso;
}
/** "AAAA-MM-DD" -> "DD/MM/AAAA" */
export function isoToBR(s: ISODate | null | undefined): string {
  if (!s) return "";
  const m = ISO_RE.exec(s.slice(0, 10));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : s;
}
export function todayISO(now: Date = new Date()): ISODate {
  return now.toISOString().slice(0, 10);
}
export function addDays(iso: ISODate, days: number): ISODate {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
export function addMonths(iso: ISODate, months: number): ISODate {
  const d = new Date(iso + "T00:00:00Z");
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d.toISOString().slice(0, 10);
}
export function compareISO(a: ISODate, b: ISODate): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
export function monthKey(iso: ISODate): string {
  return iso.slice(0, 7);
}
