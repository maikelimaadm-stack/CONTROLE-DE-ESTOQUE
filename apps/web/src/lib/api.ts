"use client";
import { lerSessaoArmazenada } from "@erp/plataforma";
export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3333";

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) { super(message); }
}
const KEY = "agro.session";
export interface Session { token: string; orgId: string | null; empresaId: string | null; user?: { id: string; email: string; name: string } }

/**
 * LEITURA DA SESSÃO — a única porta onde o formato anterior vira o canônico (PRE-BASE2-05A).
 *
 * A regra mora em `@erp/plataforma` (`lerSessaoArmazenada`), fora do navegador, porque é regra e precisa de
 * teste. Aqui fica só o EFEITO, que é o que depende do `localStorage`:
 *
 *   · `migrada`  → regrava JÁ, no formato canônico e sem a chave legada. Migrar na leitura sem regravar
 *                  repetiria a promoção para sempre e deixaria o armazenamento bilíngue indefinidamente;
 *   · `conflito` → a sessão guarda duas empresas diferentes e nada diz qual é a atual. Apagar e exigir novo
 *                  login é a única saída honesta: escolher uma seria decidir no escuro em qual empresa o
 *                  usuário vai lançar. Ver o cabeçalho de `sessao-empresa.ts`;
 *   · `invalida`  → a empresa gravada não respeita o contrato canônico (não é UUID nem nula). Mesmo efeito
 *                  do conflito, por motivo diferente: aqui não há duas verdades, há dado que não serve.
 *
 * A promoção é temporária e sai em PRE-BASE2-05B, quando nenhum cliente anterior puder mais gravar a chave antiga.
 */
export function getSession(): Session | null {
  if (typeof window === "undefined") return null;
  let bruto: unknown;
  try { const s = localStorage.getItem(KEY); bruto = s ? JSON.parse(s) : null; } catch { return null; }
  const leitura = lerSessaoArmazenada(bruto);
  switch (leitura.tipo) {
    case "ausente": return null;
    case "conflito":
    case "invalida": try { localStorage.removeItem(KEY); } catch { /* armazenamento indisponível */ } return null;
    case "migrada": try { localStorage.setItem(KEY, JSON.stringify(leitura.sessao)); } catch { /* idem */ } return leitura.sessao as unknown as Session;
    case "canonica": return leitura.sessao as unknown as Session;
  }
}

/** Grava a sessão sem disparar `agro:session` (troca de empresa: só o cabeçalho muda; contexto/permissões não). */
export function writeSession(s: Session) { if (typeof window !== "undefined") localStorage.setItem(KEY, JSON.stringify(s)); }
export function setSession(s: Session | null) { if (typeof window === "undefined") return; if (s) localStorage.setItem(KEY, JSON.stringify(s)); else localStorage.removeItem(KEY); window.dispatchEvent(new Event("agro:session")); }

/**
 * Cabeçalhos de CONTEXTO da requisição. Exportado porque nem toda chamada passa por `api()` — a exportação
 * de relatório faz `fetch` direto para receber o blob —, e foi exatamente aí que o cabeçalho ficou para trás
 * quando o canônico entrou. Um lugar só evita que a próxima chamada crua repita o esquecimento.
 *
 * A empresa selecionada sai como `X-Empresa-Id`, o cabeçalho CANÔNICO (PRE-BASE2-05A). Durante a
 * PRE-BASE2-03/04 o fio era legado por causa do CORS da API anterior, que não declarava o canônico e fazia o
 * preflight morrer no navegador. Essa razão acabou: a API em produção declara `X-Empresa-Id` em
 * `allowedHeaders` e o resolve na borda. O servidor continua aceitando o cabeçalho ANTERIOR de clientes
 * antigos até PRE-BASE2-05B — quem parou de falar o idioma antigo foi o cliente, não a API.
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
