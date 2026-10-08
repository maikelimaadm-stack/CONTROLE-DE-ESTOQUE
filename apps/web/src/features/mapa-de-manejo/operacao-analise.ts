/**
 * Operação de análise em lote no mapa (MAPA-UX-FINAL Part B) — helpers PUROS.
 * Recuperação de consulta viva, estado canônico da UI e aviso de fila indisponível.
 */
import type { ConsultaDto } from "./consulta-satelite";
import { progressoDaConsulta } from "./consulta-satelite";

/** Situações de consulta ainda em curso (reservam fila / ainda podem avançar). */
export const SITUACOES_CONSULTA_VIVAS = ["pendente", "executando"] as const;

export function consultaViva(situacao: string | null | undefined): boolean {
  return situacao === "pendente" || situacao === "executando";
}

/**
 * Estado canônico da UI da operação de análise.
 * `preparando` é local (POST em voo); `falhou` cobre cancelada e situações desconhecidas terminais.
 */
export type EstadoUiAnalise =
  | "ociosa"
  | "preparando"
  | "na_fila"
  | "processando"
  | "concluida"
  | "concluida_com_falhas"
  | "falhou";

export function estadoUiDaSituacao(
  situacao: string | null | undefined,
  opts?: { preparando?: boolean }
): EstadoUiAnalise {
  if (opts?.preparando) return "preparando";
  if (!situacao) return "ociosa";
  switch (situacao) {
    case "pendente": return "na_fila";
    case "executando": return "processando";
    case "concluida": return "concluida";
    case "concluida_com_falhas": return "concluida_com_falhas";
    case "cancelada": return "falhou";
    default: return consultaViva(situacao) ? "processando" : "ociosa";
  }
}

/** Feitos = concluídos + reaproveitados + falhos, limitado ao total (mesma conta do progresso %). */
export function feitosDaConsulta(
  c: Pick<ConsultaDto, "total_itens" | "total_concluidos" | "total_falhos" | "total_reaproveitados">
): number {
  if (c.total_itens <= 0) return 0;
  return Math.min(c.total_itens, c.total_concluidos + c.total_falhos + c.total_reaproveitados);
}

/** Texto compacto da barra persistente: "Analisando áreas · 38/102". */
export function rotuloBarraAnalise(
  c: Pick<ConsultaDto, "total_itens" | "total_concluidos" | "total_falhos" | "total_reaproveitados" | "situacao">
): string {
  const feitos = feitosDaConsulta(c);
  return `Analisando áreas · ${feitos}/${c.total_itens}`;
}

export const MSG_FILA_INDISPONIVEL = "Processamento em fila indisponível neste ambiente.";

/** Limiar padrão antes de avisar fila parada com progresso zero (pendente). */
export const LIMIAR_FILA_PARADA_MS = 8_000;

/**
 * Aviso amigável quando a fila deste ambiente não está ligada.
 * - Ao criar (aoCriar): imediato se `fila_disponivel === false`.
 * - Em acompanhamento: pendente com 0 feitos por limiarMs.
 * Nunca menciona nomes de variáveis de ambiente.
 */
export function deveAvisarFilaIndisponivel(opts: {
  filaDisponivel: boolean | null | undefined;
  situacao: string | null | undefined;
  feitos: number;
  criadoEmMs?: number | null;
  agoraMs: number;
  limiarMs?: number;
  aoCriar?: boolean;
}): boolean {
  if (opts.filaDisponivel !== false) return false;
  if (opts.aoCriar) return true;
  if (opts.situacao !== "pendente") return false;
  if (opts.feitos > 0) return false;
  const limiar = opts.limiarMs ?? LIMIAR_FILA_PARADA_MS;
  if (opts.criadoEmMs == null) return false;
  return opts.agoraMs - opts.criadoEmMs >= limiar;
}

export function primeiraConsultaViva(itens: readonly ConsultaDto[]): ConsultaDto | null {
  for (const c of itens) if (consultaViva(c.situacao)) return c;
  return null;
}

export { progressoDaConsulta };
