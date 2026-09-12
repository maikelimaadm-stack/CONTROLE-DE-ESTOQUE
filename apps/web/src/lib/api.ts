"use client";
export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3333";

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) { super(message); }
}
const KEY = "agro.session";
export interface Session { token: string; orgId: string | null; farmId: string | null; user?: { id: string; email: string; name: string } }
export function getSession(): Session | null { if (typeof window === "undefined") return null; try { const s = localStorage.getItem(KEY); return s ? (JSON.parse(s) as Session) : null; } catch { return null; } }
/** Grava a sessão sem disparar `agro:session` (troca de fazenda: só o cabeçalho X-Farm-Id muda; contexto/permissões não). */
export function writeSession(s: Session) { if (typeof window !== "undefined") localStorage.setItem(KEY, JSON.stringify(s)); }
export function setSession(s: Session | null) { if (typeof window === "undefined") return; if (s) localStorage.setItem(KEY, JSON.stringify(s)); else localStorage.removeItem(KEY); window.dispatchEvent(new Event("agro:session")); }

export async function api<T = unknown>(path: string, opts: { method?: string; body?: unknown; headers?: Record<string, string>; raw?: boolean; idempotencyKey?: string } = {}): Promise<T> {
  const s = getSession();
  const headers: Record<string, string> = { ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}), ...(s?.token ? { Authorization: `Bearer ${s.token}` } : {}), ...(s?.orgId ? { "X-Org-Id": s.orgId } : {}), ...(s?.farmId ? { "X-Farm-Id": s.farmId } : {}), ...(opts.idempotencyKey ? { "Idempotency-Key": opts.idempotencyKey } : {}), ...(opts.headers ?? {}) };
  const res = await fetch(`${API_URL}${path}`, { method: opts.method ?? "GET", headers, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined });
  if (opts.raw) return res as unknown as T;
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) { const e = (data as { error?: { code: string; message: string; details?: unknown } })?.error; if (res.status === 401 && (e?.code ?? "UNAUTHENTICATED") === "UNAUTHENTICATED") { setSession(null); if (typeof window !== "undefined" && !location.pathname.startsWith("/login")) location.href = "/login"; } throw new ApiError(res.status, e?.code ?? "ERROR", e?.message ?? res.statusText, e?.details); }
  return data as T;
}
export const qs = (o: Record<string, unknown>) => { const p = new URLSearchParams(); for (const [k, v] of Object.entries(o)) { if (v === undefined || v === null || v === "") continue; if (Array.isArray(v)) v.forEach((x) => p.append(k, String(x))); else p.set(k, String(v)); } const s = p.toString(); return s ? `?${s}` : ""; };
export const newIdem = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Date.now() + Math.random()));
export async function download(path: string, filename: string) { const res = await api<Response>(path, { raw: true }); if (!res.ok) throw new ApiError(res.status, "ERROR", "Falha ao exportar"); const blob = await res.blob(); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = filename; a.click(); URL.revokeObjectURL(url); }
