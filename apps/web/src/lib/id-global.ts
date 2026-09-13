"use client";
import { useQuery } from "@tanstack/react-query";
import { api, ApiError, getSession } from "@/lib/api";

/**
 * ID GLOBAL NO CLIENTE (docs/GLOBAL-ID-CONTRACT.md).
 *
 * Duas perguntas, a MESMA porta do servidor:
 *   `#55` → qual registro?      (busca global)
 *   registro → qual `#N`?       (identidade exibida na tela de detalhe)
 *
 * O cliente NUNCA consulta `erp.registros_globais` e NUNCA monta URL a partir do número. Ele recebe do
 * backend a ROTA CANÔNICA já resolvida — e é por isso que a URL final continua tendo o UUID: `#55` é
 * localizador, não endereço. Uma rota `/registro/55` viraria uma segunda identidade permanente e, pior,
 * uma que resolve sem passar pela autorização daquele registro.
 *
 * A CHAVE DE CACHE CARREGA A ORGANIZAÇÃO
 * --------------------------------------
 * `#55` existe em quase toda organização e aponta para coisas diferentes em cada uma. Uma chave
 * `["id-global", 55]` faria o resultado da organização anterior continuar navegável depois da troca —
 * exatamente o tipo de vazamento que uma chave sem tenant produz. Por isso a organização entra na chave.
 */
export interface RegistroGlobal {
  idGlobal: number;
  tipoEntidade: string;
  rotulo: string;
  idEntidade: string;
  modulo: string;
  /** Rota canônica JÁ resolvida pelo servidor a partir do registro (contém o UUID). */
  rota: string;
  empresaId: string | null;
  criadoEm: string;
}

const org = () => getSession()?.orgId ?? "sem-organizacao";

/** Resolve `#N` no registro real. `null` quando não existe, não é visível ou não é permitido (tudo 404). */
export function useRegistroGlobal(idGlobal: number | null) {
  return useQuery<RegistroGlobal | null>({
    queryKey: ["id-global", org(), idGlobal],
    enabled: idGlobal !== null,
    retry: false,
    queryFn: async () => {
      try { return await api<RegistroGlobal>(`/api/registros-globais/${idGlobal}`); }
      catch (e) { if (e instanceof ApiError && e.status === 404) return null; throw e; }
    }
  });
}

/**
 * Caminho inverso: o `#N` deste registro. `null` quando o registro ainda não tem número (acervo histórico
 * durante o backfill) ou quando o usuário não pode vê-lo — a tela não quebra em nenhum dos dois casos.
 */
export function useIdGlobalDoRegistro(tipo: string | null | undefined, id: string | null | undefined) {
  return useQuery<RegistroGlobal | null>({
    queryKey: ["id-global-entidade", org(), tipo, id],
    enabled: Boolean(tipo && id),
    retry: false,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      try { return await api<RegistroGlobal>(`/api/registros-globais/entidade/${tipo}/${id}`); }
      catch (e) { if (e instanceof ApiError && e.status === 404) return null; throw e; }
    }
  });
}
