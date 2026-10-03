"use client";
import { useQuery } from "@tanstack/react-query";
import { entendeCentralFinanceira, entendeFinanceiroPelaTop, entendeLcdpr } from "@agro/domain";
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

/** A pergunta à API, numa fonte só: a Central e o financeiro pela TOP leem a MESMA resposta (a mesma chave de cache). */
function useCapacidadesDoFinanceiro() {
  const { session } = useAuth();
  const org = session?.orgId ?? "sem-organizacao";
  return useQuery({
    queryKey: ["financeiro-capacidades", org],
    retry: false,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<unknown> => {
      try { return await api<unknown>("/api/financeiro/capacidades"); }
      catch (e) { if (e instanceof ApiError && e.status === 404) return null; throw e; }
    }
  });
}

export function useCentralFinanceira(): EstadoCentral {
  const q = useCapacidadesDoFinanceiro();
  if (q.isPending) return "carregando";
  if (q.isError) return "legado";
  return entendeCentralFinanceira(q.data) ? "central" : "legado";
}

/**
 * O FINANCEIRO PELA TOP (OPERACOES-01 F9, decisão 286) — a MESMA resposta de `GET /api/financeiro/capacidades`, com
 * `financeiroPelaTop: 1` (`entendeFinanceiroPelaTop`: a Central E a chave nova, na versão exata). Com ela, o lançamento
 * avulso e o movimento escolhem a TOP primeiro e o título previsto aparece no cartão "Previstos", na situação
 * "Previsto" e no fluxo. Sem ela (a API da F8 ou a anterior), cada tela é a de hoje, com o mesmo corpo, e NENHUM pedido
 * sai para `/api/financeiro/tops`. Carregando, erro ou forma desconhecida = sem a capacidade (fail-closed).
 */
export function useFinanceiroPelaTop(): boolean {
  const q = useCapacidadesDoFinanceiro();
  return q.isSuccess && entendeFinanceiroPelaTop(q.data);
}

/**
 * O LCDPR (OPERACOES-01 F9, decisão 286) — `capacidades.lcdpr` em `GET /api/auth/context` (`entendeLcdpr`, versão
 * exata). Com ela: o imóvel rural na baixa e no movimento e a conferência no Livro Caixa (o "Tipo no LCDPR" da
 * natureza é do registry, pelo `exigeCapacidade`). Sem ela (a API anterior): nenhum campo aparece, nenhuma chave vai
 * no corpo e nenhum pedido sai para `/api/financeiro/imoveis-rurais` nem para `/api/financeiro/lcdpr`.
 */
export function useLcdpr(): boolean {
  return entendeLcdpr(useAuth().ctx?.capacidades);
}
