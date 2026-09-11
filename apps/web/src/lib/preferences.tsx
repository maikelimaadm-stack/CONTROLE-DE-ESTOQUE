"use client";
import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "@/lib/toast";
import { api, ApiError, getSession } from "./api";

/**
 * Preferências de tela ("modelo base"): documento JSON por (módulo, tela) com precedência
 * usuário > padrão da organização > padrão do código. Leitura imediata do cache local (localStorage) e
 * sincronização com a API com debounce; conflito entre abas (409) adota a versão do servidor.
 */
interface PrefRecord { scope: "user" | "org"; preferences: Record<string, unknown>; revision: number; updatedAt: string }
interface PrefResponse { user: PrefRecord | null; org: PrefRecord | null; canEditOrg: boolean }
export type PrefSource = "user" | "org" | "default";
export interface ScreenPrefs<T> { prefs: T; source: PrefSource; loaded: boolean; canEditOrg: boolean; saving: boolean; hasOrgDefault: boolean; update: (fn: (p: T) => T) => void; reset: () => Promise<void>; saveAsOrgDefault: () => Promise<void>; clearOrgDefault: () => Promise<void> }

const storageKey = (module: string, screen: string) => { const s = getSession(); return `agro:prefs:${s?.orgId ?? "-"}:${s?.user?.id ?? "-"}:${module}:${screen}`; };
const readLocal = (k: string): unknown => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch { return null; } };
const writeLocal = (k: string, v: unknown) => { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } };
const revisionOf = (p: unknown): number | undefined => (p as { meta?: { revision?: number } } | null)?.meta?.revision;

export function useScreenPrefs<T extends { meta?: { revision?: number } }>(module: string, screen: string, normalize: (raw: unknown) => T, enabled = true): ScreenPrefs<T> {
  const qc = useQueryClient();
  const key = storageKey(module, screen);
  // chave inclui organização e usuário: troca de conta no mesmo navegador não reaproveita o cache
  const qk = React.useMemo(() => ["prefs", key], [key]);
  const q = useQuery({ queryKey: qk, queryFn: () => api<PrefResponse>(`/api/preferences/${module}/${screen}`), enabled, staleTime: 60_000 });
  const [local, setLocal] = React.useState<unknown>(() => (typeof window === "undefined" ? null : readLocal(key)));
  const [saving, setSaving] = React.useState(false);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = React.useRef<T | null>(null);
  // adota a versão do servidor quando é mais nova que o cache local
  React.useEffect(() => {
    if (!q.data) return;
    const srv = q.data.user?.preferences ?? null;
    const lr = revisionOf(local) ?? 0; const sr = revisionOf(srv) ?? 0;
    if (srv && sr >= lr) { setLocal(srv); writeLocal(key, srv); }
    else if (!srv && local && lr > 0) { /* servidor foi resetado em outra sessão */ setLocal(null); writeLocal(key, null); }
  }, [q.data]);
  const source: PrefSource = local ? "user" : q.data?.org ? "org" : "default";
  const prefs = React.useMemo(() => normalize(local ?? q.data?.org?.preferences ?? null), [local, q.data, normalize]);
  const inflight = React.useRef(false);
  // salva em série: enquanto um PUT está em andamento, novas edições ficam em `pending` e vão no próximo envio com a
  // revisão devolvida pelo servidor (evita 409 por revisão antiga quando a rede é lenta). Em 409 reenvia uma vez com a
  // revisão atual — é o mesmo usuário (outra aba/sessão), então a edição mais recente prevalece.
  const flush = React.useCallback(async () => {
    if (inflight.current) return;
    const doc = pending.current; pending.current = null; if (!doc) return;
    inflight.current = true; setSaving(true);
    const send = (d: T) => api<PrefRecord>(`/api/preferences/${module}/${screen}?scope=user`, { method: "PUT", body: { preferences: d, expectedRevision: d.meta?.revision } });
    try {
      let r: PrefRecord;
      try { r = await send(doc); }
      catch (e) {
        const cur = e instanceof ApiError && e.status === 409 ? (e.details as { current?: PrefRecord })?.current : undefined;
        if (!cur) throw e;
        try { r = await send({ ...doc, meta: { ...(doc.meta ?? {}), revision: cur.revision } } as T); }
        catch { setLocal(cur.preferences); writeLocal(key, cur.preferences); toast.warning("Preferências alteradas em outra aba: versão mais recente carregada"); return; }
      }
      const cur = pending.current as T | null;
      if (cur) {
        // houve nova edição enquanto salvava: mantém o conteúdo local mais novo, só avança a revisão, e envia em seguida
        const newer = { ...cur, meta: { ...(cur.meta ?? {}), revision: r.revision } } as T;
        pending.current = newer; setLocal(newer); writeLocal(key, newer);
      } else { setLocal(r.preferences); writeLocal(key, r.preferences); }
    } catch { toast.error("Não foi possível salvar suas preferências de tela"); }
    finally { inflight.current = false; setSaving(false); void qc.invalidateQueries({ queryKey: qk }); if (pending.current) void flushRef.current(); }
  }, [module, screen, key, qc, qk]);
  const flushRef = React.useRef(flush); flushRef.current = flush;
  const update = React.useCallback((fn: (p: T) => T) => {
    // parte da última edição ainda não salva (várias atualizações em sequência não se sobrescrevem)
    const base = (pending.current ?? prefs) as T;
    const next = fn(base); const withMeta = { ...next, meta: { revision: revisionOf(pending.current ?? local) ?? q.data?.user?.revision ?? 0, updatedAt: new Date().toISOString() } } as T;
    setLocal(withMeta); writeLocal(key, withMeta); pending.current = withMeta;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { void flush(); }, 400);
  }, [prefs, local, q.data, key, flush]);
  React.useEffect(() => () => { if (timer.current) { clearTimeout(timer.current); void flush(); } }, [flush]);
  const reset = React.useCallback(async () => { if (timer.current) clearTimeout(timer.current); pending.current = null; await api(`/api/preferences/${module}/${screen}?scope=user`, { method: "DELETE" }); setLocal(null); writeLocal(key, null); await qc.invalidateQueries({ queryKey: qk }); toast.success("Preferências restauradas"); }, [module, screen, key, qc, qk]);
  const saveAsOrgDefault = React.useCallback(async () => { const { meta: _m, ...doc } = prefs as T & { meta?: unknown }; void _m; await api(`/api/preferences/${module}/${screen}?scope=org`, { method: "PUT", body: { preferences: doc } }); await qc.invalidateQueries({ queryKey: qk }); toast.success("Definido como padrão da organização"); }, [prefs, module, screen, qc, qk]);
  const clearOrgDefault = React.useCallback(async () => { await api(`/api/preferences/${module}/${screen}?scope=org`, { method: "DELETE" }); await qc.invalidateQueries({ queryKey: qk }); toast.success("Padrão da organização removido"); }, [module, screen, qc, qk]);
  return { prefs, source, loaded: q.isFetched || Boolean(local), canEditOrg: q.data?.canEditOrg ?? false, saving, hasOrgDefault: Boolean(q.data?.org), update, reset, saveAsOrgDefault, clearOrgDefault };
}
