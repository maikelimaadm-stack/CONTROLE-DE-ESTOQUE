"use client";
/**
 * TOP-CONFIG-05 — FAIXA DO CLIENTE EM ATRASO na Central. "avisa" = amarela; "bloqueia" = vermelha (e o Salvar
 * trava — quem trava é a página, com `bloqueiaSalvar`).
 *
 * SEM VISUAL NOVO: a amarela é a MESMA caixa de aviso que a Central já usa (`top-indisponivel` /
 * `layout-nao-carregado`: `rounded-md bg-amber-50 p-3` + `text-sm text-amber-700`); a vermelha é o padrão de erro
 * do app (`ErrorState`: `border-red-200 bg-red-50 text-red-700`) na mesma forma. O texto é o do domínio
 * (`textoSituacaoAtraso` / `mensagemClienteEmAtraso`) — a MESMA frase do 422 `CLIENTE_EM_ATRASO` da API.
 *
 * Sem situação, `nao_valida` ou cliente em dia → nada no DOM (nenhum espaço reservado).
 */
import * as React from "react";
import { mensagemClienteEmAtraso, textoSituacaoAtraso, type SituacaoClienteResposta } from "@agro/domain";

export interface PropsFaixaAtrasoCliente { situacao: SituacaoClienteResposta | null }

/** A situação trava o Salvar? Só "bloqueia" com atraso. */
export const bloqueiaSalvar = (s: SituacaoClienteResposta | null): boolean =>
  Boolean(s && s.politica === "bloqueia" && s.emAtraso);

export function FaixaAtrasoCliente({ situacao }: PropsFaixaAtrasoCliente): React.ReactElement | null {
  if (!situacao || situacao.politica === "nao_valida" || !situacao.emAtraso) return null;
  if (situacao.politica === "bloqueia") {
    return <div data-testid="central-faixa-atraso" data-politica="bloqueia" role="alert" className="rounded-md border border-red-200 bg-red-50 p-3">
      <p className="text-sm text-red-700">{mensagemClienteEmAtraso(situacao)}</p>
    </div>;
  }
  return <div data-testid="central-faixa-atraso" data-politica="avisa" className="rounded-md bg-amber-50 p-3">
    <p className="text-sm text-amber-700">{textoSituacaoAtraso(situacao)}</p>
  </div>;
}
