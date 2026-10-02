"use client";
import { useQuery } from "@tanstack/react-query";
import { entendeCentralFinanceira } from "@agro/domain";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";

/**
 * A API DECLARA A CENTRAL FINANCEIRA? (OPERACOES-01 F8, decisão 285) — `GET /api/financeiro/capacidades`.
 *
 * A capacidade mora numa rota de prefixo PRÓPRIO: a API anterior não a conhece e responde 404 de rota, e esse 404 É a
 * ausência. Sem a declaração (a web sobe antes da API, ou a API volta sozinha), a tela é a de HOJE, idêntica — e
 * nenhum outro pedido sai para `/api/financeiro/*` (skew sentido 1). Forma e versão EXATAS (`entendeCentralFinanceira`
 * do domínio): resposta desconhecida, de outra versão, erro de rede ou 5xx valem como ausência, nunca como "central".
 *
 * A chave carrega a ORGANIZAÇÃO: trocar de organização é perguntar de novo (as duas podem estar em APIs diferentes
 * só na janela de deploy, mas a resposta de uma nunca decide a tela da outra).
 */
export type EstadoCentral = "carregando" | "legado" | "central";

export function useCentralFinanceira(): EstadoCentral {
  const { session } = useAuth();
  const org = session?.orgId ?? "sem-organizacao";
  const q = useQuery({
    queryKey: ["financeiro-capacidades", org],
    retry: false,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<unknown> => {
      try { return await api<unknown>("/api/financeiro/capacidades"); }
      catch (e) { if (e instanceof ApiError && e.status === 404) return null; throw e; }
    }
  });
  if (q.isPending) return "carregando";
  if (q.isError) return "legado";
  return entendeCentralFinanceira(q.data) ? "central" : "legado";
}
