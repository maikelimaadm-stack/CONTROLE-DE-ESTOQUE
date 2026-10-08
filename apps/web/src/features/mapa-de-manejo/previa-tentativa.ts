/**
 * Identidade de tentativa da prévia — protege sucesso E erro contra resposta obsoleta.
 * Cancelar a HTTP é otimização; ignorar resultado de tentativa antiga é a proteção obrigatória.
 */
import type { AlvoConsulta, PeriodoConsulta } from "./consulta-satelite";
import { chaveDaPrevia } from "./consulta-satelite";

export type SnapshotPedidoPrevia = {
  chave: string;
  alvo: AlvoConsulta;
  periodo: PeriodoConsulta;
  organizationId: string | null;
  empresaId: string | null;
};

export type TentativaPrevia = {
  id: number;
  chave: string;
};

/** Pedido + identidade de tentativa — corpo e chave saem do mesmo snapshot. */
export type PedidoTentativaPrevia = SnapshotPedidoPrevia & { tentativaId: number };

export function montarSnapshotPedido(p: {
  organizationId?: string | null;
  empresaId?: string | null;
  alvo: AlvoConsulta;
  periodo: PeriodoConsulta;
}): SnapshotPedidoPrevia {
  const organizationId = p.organizationId ?? null;
  const empresaId = p.empresaId ?? null;
  const chave = chaveDaPrevia({
    organizationId,
    empresaId,
    alvo: p.alvo,
    periodo: p.periodo
  });
  return { chave, alvo: p.alvo, periodo: p.periodo, organizationId, empresaId };
}

/**
 * Gestor da tentativa ativa. Cada `iniciar` sobrescreve a anterior;
 * duas tentativas da mesma chave recebem ids distintos.
 */
export class GestorTentativasPrevia {
  private seq = 0;
  private ativa: TentativaPrevia | null = null;

  get tentativaAtiva(): TentativaPrevia | null {
    return this.ativa;
  }

  iniciar(chave: string): TentativaPrevia {
    const t = { id: ++this.seq, chave };
    this.ativa = t;
    return t;
  }

  /** Fechar modal, desmontar ou trocar contexto — nenhuma resposta antiga aplica. */
  invalidar(): void {
    this.ativa = null;
  }

  /** Sucesso ou erro só aplicam se ainda forem a tentativa e o pedido vigentes. */
  deveAplicar(
    resultado: { tentativaId: number; chave: string },
    chavePedidoAtual: string | null
  ): boolean {
    if (!this.ativa) return false;
    if (resultado.tentativaId !== this.ativa.id) return false;
    if (resultado.chave !== this.ativa.chave) return false;
    if (!chavePedidoAtual || resultado.chave !== chavePedidoAtual) return false;
    return true;
  }
}

export function ehAbortError(e: unknown): boolean {
  if (e instanceof DOMException && e.name === "AbortError") return true;
  return e instanceof Error && e.name === "AbortError";
}

/** Erro enriquecido com a tentativa que o originou (para onError sem closure obsoleta). */
export type ErroComTentativa = Error & { tentativaId: number; chave: string };

export function marcarErroTentativa(e: unknown, t: TentativaPrevia): ErroComTentativa {
  const base = e instanceof Error ? e : new Error(typeof e === "string" ? e : "Falha na estimativa.");
  const out = base as ErroComTentativa;
  out.tentativaId = t.id;
  out.chave = t.chave;
  return out;
}
