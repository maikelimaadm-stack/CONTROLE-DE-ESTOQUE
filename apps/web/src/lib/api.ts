"use client";
import { lerSessaoArmazenada } from "@erp/plataforma";
export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3333";

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) { super(message); }
}
const KEY = "agro.session";
export interface Session { token: string; orgId: string | null; empresaId: string | null; user?: { id: string; email: string; name: string } }

/**
 * LEITURA DA SESSÃO — porta única do contrato canônico (PRE-BASE2-05B).
 *
 * A regra mora em `@erp/plataforma` (`lerSessaoArmazenada`), fora do navegador, porque é regra e precisa de
 * teste. Aqui fica só o EFEITO, que é o que depende do `localStorage`:
 *
 *   · `invalida` → a sessão não respeita o contrato (empresa fora do formato, ou a chave canônica ausente —
 *                  inclusive numa sessão dormante gravada por uma versão anterior). Apagar e exigir novo
 *                  login é a saída honesta: a alternativa seria adivinhar em qual empresa o usuário opera.
 *
 * A PROMOÇÃO da chave anterior saiu em 05B junto com a borda legada do servidor; a validação fica, porque
 * `localStorage` é editável e nenhum contrato se sustenta só no servidor. Ver `sessao-empresa.ts`.
 */
export function getSession(): Session | null {
  if (typeof window === "undefined") return null;
  let bruto: unknown;
  try { const s = localStorage.getItem(KEY); bruto = s ? JSON.parse(s) : null; } catch { return null; }
  const leitura = lerSessaoArmazenada(bruto);
  if (leitura.tipo === "canonica") return leitura.sessao as unknown as Session;
  if (leitura.tipo === "invalida") try { localStorage.removeItem(KEY); } catch { /* armazenamento indisponível */ }
  return null;
}

/** Grava a sessão sem disparar `agro:session` (troca de empresa: só o cabeçalho muda; contexto/permissões não). */
export function writeSession(s: Session) { if (typeof window !== "undefined") localStorage.setItem(KEY, JSON.stringify(s)); }
export function setSession(s: Session | null) { if (typeof window === "undefined") return; if (s) localStorage.setItem(KEY, JSON.stringify(s)); else localStorage.removeItem(KEY); window.dispatchEvent(new Event("agro:session")); }

/**
 * Cabeçalhos de CONTEXTO da requisição. Exportado porque nem toda chamada passa por `api()` — a exportação
 * de relatório faz `fetch` direto para receber o blob —, e foi exatamente aí que o cabeçalho ficou para trás
 * quando o canônico entrou. Um lugar só evita que a próxima chamada crua repita o esquecimento.
 *
 * A empresa selecionada sai como `X-Empresa-Id`, o cabeçalho CANÔNICO. Desde PRE-BASE2-05B ele é também o
 * ÚNICO que a API entende: o cabeçalho anterior saiu do CORS e é recusado no servidor. Cliente e servidor
 * falam a mesma língua — não há mais dois nomes para a mesma coisa em lugar nenhum do fio.
 */
export function cabecalhosDeContexto(s: Session | null): Record<string, string> {
  return {
    ...(s?.token ? { Authorization: `Bearer ${s.token}` } : {}),
    ...(s?.orgId ? { "X-Org-Id": s.orgId } : {}),
    ...(s?.empresaId ? { "X-Empresa-Id": s.empresaId } : {})
  };
}

export async function api<T = unknown>(path: string, opts: { method?: string; body?: unknown; headers?: Record<string, string>; raw?: boolean; idempotencyKey?: string } = {}): Promise<T> {
  const s = getSession();
  const headers: Record<string, string> = { ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}), ...cabecalhosDeContexto(s), ...(opts.idempotencyKey ? { "Idempotency-Key": opts.idempotencyKey } : {}), ...(opts.headers ?? {}) };
  // Caminho, query, corpo e resposta são CANÔNICOS ponta a ponta: não há mais tradutor de fio no cliente.
  const res = await fetch(`${API_URL}${path}`, { method: opts.method ?? "GET", headers, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined });
  if (opts.raw) return res as unknown as T;
  const text = await res.text();
  const data = text ? (JSON.parse(text) as unknown) : null;
  if (!res.ok) { const e = (data as { error?: { code: string; message: string; details?: unknown } })?.error; if (res.status === 401 && (e?.code ?? "UNAUTHENTICATED") === "UNAUTHENTICATED") { setSession(null); if (typeof window !== "undefined" && !location.pathname.startsWith("/login")) location.href = "/login"; } throw new ApiError(res.status, e?.code ?? "ERROR", e?.message ?? res.statusText, e?.details); }
  return data as T;
}
export const qs = (o: Record<string, unknown>) => { const p = new URLSearchParams(); for (const [k, v] of Object.entries(o)) { if (v === undefined || v === null || v === "") continue; if (Array.isArray(v)) v.forEach((x) => p.append(k, String(x))); else p.set(k, String(v)); } const s = p.toString(); return s ? `?${s}` : ""; };
export const newIdem = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Date.now() + Math.random()));
export async function download(path: string, filename: string) { const res = await api<Response>(path, { raw: true }); if (!res.ok) throw new ApiError(res.status, "ERROR", "Falha ao exportar"); const blob = await res.blob(); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = filename; a.click(); URL.revokeObjectURL(url); }
