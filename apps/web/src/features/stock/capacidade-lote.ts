"use client";
import { useAuth, type AppContext } from "@/lib/auth";

/** Versão da capacidade `loteNaEntrada` (R1-1 c, PR #62) que estas telas sabem usar. */
export const CAPACIDADE_LOTE_NA_ENTRADA = 1 as const;

/**
 * A API DECLARA QUE ENTENDE LOTE E VALIDADE NA ENTRADA? — `capacidades.loteNaEntrada` em `GET /api/auth/context`.
 *
 * Sem a declaração (API anterior, na janela em que a web sobe antes da API ou numa reversão só da API), a tela NÃO
 * mostra nem envia o lote e a validade da devolução, a validade da correção e a validade da produção de ração: os
 * schemas da API anterior não são estritos e DESCARTARIAM essas chaves em silêncio — a devolução entraria sem lote e
 * o ajuste para cima gravaria o lote sem a validade (a escolha automática por validade o poria por último). Sem os
 * campos, o pedido sai exatamente como a web anterior o mandaria, e o que a API anterior não sabe gravar ela recusa.
 * Forma e versão EXATAS: um valor desconhecido é tratado como ausente.
 */
export function entendeLoteNaEntrada(ctx: AppContext | null | undefined): boolean {
  return ctx?.capacidades?.["loteNaEntrada"] === CAPACIDADE_LOTE_NA_ENTRADA;
}

export function useLoteNaEntrada(): boolean {
  return entendeLoteNaEntrada(useAuth().ctx);
}
