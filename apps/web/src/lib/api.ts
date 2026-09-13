"use client";
export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3333";

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) { super(message); }
}
const KEY = "agro.session";
export interface Session { token: string; orgId: string | null; empresaId: string | null; user?: { id: string; email: string; name: string } }
/**
 * SESSÃO GRAVADA ANTES DA PRE-BASE2-03 guarda `farmId`. Ela vive no localStorage do navegador: ninguém a
 * migra num deploy, e quem já estava logado continua com ela. Ler só `empresaId` derrubaria a empresa
 * selecionada de todo mundo no primeiro acesso à versão nova — sem erro, sem aviso, só o contexto de
 * trabalho zerado. A promoção acontece na LEITURA, num lugar só, e não reescreve o armazenamento: se a
 * versão anterior voltar ao ar, ela ainda encontra o `farmId` dela.
 */
function promoverSessaoLegada(bruto: Record<string, unknown>): Session {
  const legado = bruto["farmId"];
  if (bruto["empresaId"] === undefined && (typeof legado === "string" || legado === null)) {
    return { ...(bruto as unknown as Session), empresaId: legado as string | null };
  }
  return bruto as unknown as Session;
}
export function getSession(): Session | null { if (typeof window === "undefined") return null; try { const s = localStorage.getItem(KEY); return s ? promoverSessaoLegada(JSON.parse(s) as Record<string, unknown>) : null; } catch { return null; } }
/** Grava a sessão sem disparar `agro:session` (troca de empresa: só o cabeçalho muda; contexto/permissões não). */
export function writeSession(s: Session) { if (typeof window !== "undefined") localStorage.setItem(KEY, JSON.stringify(s)); }
export function setSession(s: Session | null) { if (typeof window === "undefined") return; if (s) localStorage.setItem(KEY, JSON.stringify(s)); else localStorage.removeItem(KEY); window.dispatchEvent(new Event("agro:session")); }

/**
 * Cabeçalhos de CONTEXTO da requisição. Exportado porque nem toda chamada passa por `api()` — a exportação
 * de relatório faz `fetch` direto para receber o blob —, e foi exatamente aí que o cabeçalho ficou para trás
 * quando o canônico entrou. Um lugar só evita que a próxima chamada crua repita o esquecimento.
 *
 * Os DOIS cabeçalhos saem com o MESMO valor: `X-Empresa-Id` é o canônico e `X-Farm-Id` acompanha porque o
 * web (Vercel) e a API (Railway) não sobem juntas — um web novo contra a API anterior ficaria sem empresa
 * selecionada. A API nova aceita os dois desde que sejam IGUAIS; valores diferentes são recusados com 422.
 * O `X-Farm-Id` sai quando nenhuma versão anterior da API estiver no ar (docs/DEPLOYMENT.md).
 */
export function cabecalhosDeContexto(s: Session | null): Record<string, string> {
  return {
    ...(s?.token ? { Authorization: `Bearer ${s.token}` } : {}),
    ...(s?.orgId ? { "X-Org-Id": s.orgId } : {}),
    ...(s?.empresaId ? { "X-Empresa-Id": s.empresaId, "X-Farm-Id": s.empresaId } : {})
  };
}

export async function api<T = unknown>(path: string, opts: { method?: string; body?: unknown; headers?: Record<string, string>; raw?: boolean; idempotencyKey?: string } = {}): Promise<T> {
  const s = getSession();
  const headers: Record<string, string> = { ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}), ...cabecalhosDeContexto(s), ...(opts.idempotencyKey ? { "Idempotency-Key": opts.idempotencyKey } : {}), ...(opts.headers ?? {}) };
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
