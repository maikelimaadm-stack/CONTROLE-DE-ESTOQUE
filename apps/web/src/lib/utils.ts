import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
export const cn = (...i: ClassValue[]) => twMerge(clsx(i));
export const brl = (v: string | number | null | undefined) => v === null || v === undefined || v === "" ? "—" : new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(v));
export const num = (v: string | number | null | undefined, d = 2) => v === null || v === undefined || v === "" ? "—" : new Intl.NumberFormat("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d }).format(Number(v));
export const dateBR = (v: string | null | undefined) => { if (!v) return "—"; const s = String(v).slice(0, 10); const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s); return m ? `${m[3]}/${m[2]}/${m[1]}` : String(v); };
export const dateTimeBR = (v: string | null | undefined) => { if (!v) return "—"; const d = new Date(v); return isNaN(d.getTime()) ? String(v) : d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }); };
/** Percentual para exibição: recebe o valor em pontos percentuais (3.1 → "3,1%"); 1 casa por padrão. */
export const pct = (v: string | number | null | undefined, d = 1) => v === null || v === undefined || v === "" || Number.isNaN(Number(v)) ? "—" : new Intl.NumberFormat("pt-BR", { style: "percent", minimumFractionDigits: d, maximumFractionDigits: d }).format(Number(v) / 100);
/** Mês de referência (ISO "2026-09-01" ou "2026-09") → "09/2026". */
export const monthBR = (v: string | null | undefined) => { if (!v) return "—"; const m = /^(\d{4})-(\d{2})/.exec(String(v)); return m ? `${m[2]}/${m[1]}` : String(v); };
export const todayISO = () => new Date().toISOString().slice(0, 10);
export const monthStartISO = () => todayISO().slice(0, 8) + "01";
export const yearStartISO = () => todayISO().slice(0, 4) + "-01-01";
