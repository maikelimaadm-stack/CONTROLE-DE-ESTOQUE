"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { api, getSession, setSession, writeSession, type Session } from "./api";
import { esquecerEntregas } from "./entrega-em-memoria";

export interface AppContext {
  user: { id: string; email: string; name: string };
  organization: { id: string; name: string; parameters: Record<string, unknown> };
  isOwner: boolean;
  /** Empresas que o usuário enxerga em ALGUM módulo. Campo CANÔNICO — o único que o cliente lê. */
  empresas?: { id: string; code: number; name: string }[];
  permissions: string[];
  /** Idioma da sessão (docs/I18N-CONTRACT.md): precedência usuário › organização › padrão, resolvida no servidor. */
  idioma?: { organizacao: string | null; usuario: string | null; efetivo: string };
  favorites: { route: string; label: string }[];
  unreadNotifications: number;
  /**
   * Capacidades que a API declara (ADITIVAS; ausentes na API anterior). Cada tela confere a versão EXATA que sabe
   * usar — valor desconhecido é tratado como ausente. Ver `features/stock/capacidade-lote.ts`.
   */
  capacidades?: Record<string, unknown>;
}
interface AuthState { session: Session | null; ctx: AppContext | null; loading: boolean; can: (perm: string) => boolean; setEmpresa: (id: string | null) => void; setOrg: (id: string) => Promise<void>; refresh: () => Promise<void>; logout: () => void }
const Ctx = createContext<AuthState | null>(null);

/**
 * Lista de empresas do contexto. Um lugar só a lê, e ela é CANÔNICA (PRE-BASE2-05A): o apelido legado saiu
 * junto com o tradutor de fio. A API continua podendo emitir o apelido legado para clientes anteriores —
 * este cliente simplesmente não olha para ele.
 */
export const empresasDoContexto = (ctx: AppContext | null | undefined) => ctx?.empresas ?? [];

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
  // toda troca de sessão (login, logout, troca de organização, sessão expirada) apaga as entregas em memória entre
  // telas (ex.: dados da Receita do "Novo pelo CNPJ", AJUSTES 01 R1 W-5) antes de recarregar o contexto
  useEffect(() => { void refresh(); const h = () => { esquecerEntregas(); void refresh(); }; window.addEventListener("agro:session", h); return () => window.removeEventListener("agro:session", h); }, [refresh]);
  useEffect(() => { if (!loading && !session?.token && !pathname.startsWith("/login")) router.replace("/login"); }, [loading, session, pathname, router]);
  const perms = useMemo(() => new Set(ctx?.permissions ?? []), [ctx]);
  const value: AuthState = useMemo(() => ({
    session, ctx, loading,
    can: (p) => Boolean(ctx?.isOwner) || perms.has(p),
    // empresa: não recarrega organização/permissões nem remonta as telas — o shell fecha abas farm-scoped e invalida consultas
    setEmpresa: (id) => { const s = getSession(); if (s) { const n = { ...s, empresaId: id }; writeSession(n); setS(n); } },
    setOrg: async (id) => { const s = getSession(); if (s) { setSession({ ...s, orgId: id, empresaId: null }); } },
    refresh,
    logout: () => { setSession(null); router.replace("/login"); }
  }), [session, ctx, loading, perms, refresh, router]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
export const useAuth = () => { const v = useContext(Ctx); if (!v) throw new Error("AuthProvider ausente"); return v; };
