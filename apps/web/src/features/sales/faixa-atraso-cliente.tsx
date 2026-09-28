"use client";
/**
 * TOP-CONFIG-05 — FAIXA DO CLIENTE EM ATRASO na Central. "avisa" = amarela; "bloqueia" = vermelha (e o Salvar
 * trava — quem trava é a página, com `bloqueiaSalvar`). (esqueleto do contrato; implementação: agente W6)
 */
import * as React from "react";
import type { SituacaoClienteResposta } from "@agro/domain";

export interface PropsFaixaAtrasoCliente { situacao: SituacaoClienteResposta | null }

/** A situação trava o Salvar? Só "bloqueia" com atraso. */
export const bloqueiaSalvar = (s: SituacaoClienteResposta | null): boolean =>
  Boolean(s && s.politica === "bloqueia" && s.emAtraso);

export function FaixaAtrasoCliente(_props: PropsFaixaAtrasoCliente): React.ReactElement | null {
  return null;
}
