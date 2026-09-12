"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { api, getSession, setSession, writeSession, type Session } from "./api";

export interface AppContext {
  user: { id: string; email: string; name: string };
  organization: { id: string; name: string; parameters: Record<string, unknown> };
  isOwner: boolean;
  farms: { id: string; code: number; name: string }[];
  permissions: string[];
  favorites: { route: string; label: string }[];
  unreadNotifications: number;
}
interface AuthState { session: Session | null; ctx: AppContext | null; loading: boolean; can: (perm: string) => boolean; setFarm: (id: string | null) => void; setOrg: (id: string) => Promise<void>; refresh: () => Promise<void>; logout: () => void }
const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setS] = useState<Session | null>(null);
  const [ctx, setCtx] = useState<AppContext | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter(); const pathname = usePathname();
  const refresh = useCallback(async () => {
    const s = getSession(); setS(s);
    if (!s?.token) { setCtx(null); setLoading(false); return; }
    // Bloqueia a renderização das telas até a organização e as permissões estarem carregadas,
    // evitando chamadas à API sem X-Org-Id logo após o login.
    setLoading(true);
    try {
      if (!s.orgId) { const me = await api<{ organizations: { id: string }[] }>("/api/auth/me"); const first = me.organizations[0]; if (first) { setSession({ ...s, orgId: first.id }); setS({ ...s, orgId: first.id }); } else { setCtx(null); setLoading(false); return; } }
      const c = await api<AppContext>("/api/auth/context"); setCtx(c);
    } catch { setCtx(null); }
    setLoading(false);
  }, []);
  useEffect(() => { void refresh(); const h = () => void refresh(); window.addEventListener("agro:session", h); return () => window.removeEventListener("agro:session", h); }, [refresh]);
  useEffect(() => { if (!loading && !session?.token && !pathname.startsWith("/login")) router.replace("/login"); }, [loading, session, pathname, router]);
  const perms = useMemo(() => new Set(ctx?.permissions ?? []), [ctx]);
  const value: AuthState = useMemo(() => ({
    session, ctx, loading,
    can: (p) => Boolean(ctx?.isOwner) || perms.has(p),
    // fazenda: não recarrega organização/permissões nem remonta as telas — o shell fecha abas farm-scoped e invalida consultas
    setFarm: (id) => { const s = getSession(); if (s) { const n = { ...s, farmId: id }; writeSession(n); setS(n); } },
    setOrg: async (id) => { const s = getSession(); if (s) { setSession({ ...s, orgId: id, farmId: null }); } },
    refresh,
    logout: () => { setSession(null); router.replace("/login"); }
  }), [session, ctx, loading, perms, refresh, router]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
export const useAuth = () => { const v = useContext(Ctx); if (!v) throw new Error("AuthProvider ausente"); return v; };
