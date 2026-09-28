/**
 * TOP-CONFIG-05 — AS REGRAS DA OPERAÇÃO NA CENTRAL (decisão 263).
 *
 * SÓ com `capacidades.regrasDaOperacao` EXATA (`CAPACIDADE_REGRAS_DA_OPERACAO`). Sem ela nenhuma pergunta sai
 * (`/regras-da-operacao`, `/situacao-cliente`) e a Central é a de hoje, idêntica. A régua de exigência é a MESMA
 * da API (`exigenciasFaltandoPorCampos`, `@agro/domain`); aqui ela só adianta o erro no campo antes do POST — a
 * autoridade continua sendo o servidor.
 */
import { useQuery } from "@tanstack/react-query";
import { CAPACIDADE_REGRAS_DA_OPERACAO, POLITICAS_CLIENTE_EM_ATRASO, type RegrasDaOperacaoResposta, type SituacaoClienteResposta } from "@agro/domain";
import { api, type ApiError } from "@/lib/api";
import type { EstadoTop } from "@/features/sales/tipo-operacao-select";

const ehObjeto = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const ehUuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v);

/** A API declara as regras da operação? Forma e versão EXATAS. */
export function entendeRegrasDaOperacao(e: EstadoTop): boolean {
  if (e.situacao !== "pronto") return false;
  const c = (e.dados as unknown as { capacidades?: unknown }).capacidades;
  return ehObjeto(c) && c.regrasDaOperacao === CAPACIDADE_REGRAS_DA_OPERACAO;
}

/** Confere a resposta de `/regras-da-operacao` antes de ela governar a tela. Forma estranha = `null` (trava). */
export function lerRegrasDaOperacao(bruto: unknown): RegrasDaOperacaoResposta | null {
  if (!ehObjeto(bruto) || typeof bruto.formato !== "number" || !Array.isArray(bruto.exigencias)) return null;
  if (!bruto.exigencias.every((x) => typeof x === "string")) return null;
  const cp = bruto.condicoesPermitidas;
  if (cp !== null && !(Array.isArray(cp) && cp.every(ehUuid))) return null;
  const ca = bruto.clienteEmAtraso;
  if (!ehObjeto(ca) || !(POLITICAS_CLIENTE_EM_ATRASO as readonly unknown[]).includes(ca.politica) || typeof ca.toleranciaDias !== "number") return null;
  return bruto as unknown as RegrasDaOperacaoResposta;
}

/** As regras da versão ATUAL da TOP escolhida. `ativo` = capacidade exata E TOP escolhida. */
export function useRegrasDaOperacao(kind: string, tipoOperacaoId: string, ativo: boolean) {
  const q = useQuery<unknown, ApiError>({
    queryKey: ["regras-da-operacao", kind, tipoOperacaoId],
    queryFn: () => api<unknown>(`/api/sales/${kind}/regras-da-operacao?tipo_operacao_id=${encodeURIComponent(tipoOperacaoId)}`),
    enabled: ativo && Boolean(tipoOperacaoId),
    retry: false,
  });
  const regras = ativo && q.data !== undefined ? lerRegrasDaOperacao(q.data) : null;
  return { regras, pendente: ativo && Boolean(tipoOperacaoId) && !regras, erro: q.error ?? null };
}

/** Confere a resposta de `/situacao-cliente`. */
export function lerSituacaoCliente(bruto: unknown): SituacaoClienteResposta | null {
  if (!ehObjeto(bruto)) return null;
  if (bruto.politica === "nao_valida") return { politica: "nao_valida" };
  if ((bruto.politica === "avisa" || bruto.politica === "bloqueia") && typeof bruto.emAtraso === "boolean"
      && typeof bruto.titulos === "number" && typeof bruto.total === "string"
      && (bruto.vencimentoMaisAntigo === null || typeof bruto.vencimentoMaisAntigo === "string")) {
    return bruto as unknown as SituacaoClienteResposta;
  }
  return null;
}

/** A situação do cliente escolhido para a TOP escolhida. Só pergunta quando a política não é `nao_valida`. */
export function useSituacaoCliente(kind: string, clienteId: string, tipoOperacaoId: string, ativo: boolean) {
  const q = useQuery<unknown, ApiError>({
    queryKey: ["situacao-cliente", kind, tipoOperacaoId, clienteId],
    queryFn: () => api<unknown>(`/api/sales/${kind}/situacao-cliente?client_id=${encodeURIComponent(clienteId)}&tipo_operacao_id=${encodeURIComponent(tipoOperacaoId)}`),
    enabled: ativo && Boolean(clienteId) && Boolean(tipoOperacaoId),
    retry: false,
  });
  return { situacao: q.data !== undefined ? lerSituacaoCliente(q.data) : null, carregando: q.isFetching };
}
