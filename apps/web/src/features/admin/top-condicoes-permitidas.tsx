"use client";
/**
 * TOP-CONFIG-05 — CONDIÇÕES DE PAGAMENTO PERMITIDAS da versão (formato 3). Lista vazia = todas as condições.
 * (esqueleto do contrato; implementação: agente W2)
 */
import * as React from "react";

/** Uma condição permitida em edição: identidade + o que a tela mostra. */
export interface CondicaoPermitidaEmEdicao { id: string; codigo: string; nome: string }

export interface PropsCondicoesPermitidasTop {
  valor: CondicaoPermitidaEmEdicao[];
  onChange: (v: CondicaoPermitidaEmEdicao[]) => void;
  desabilitado?: boolean;
  limite: number;
}

export function CondicoesPermitidasTop(_props: PropsCondicoesPermitidasTop): React.ReactElement | null {
  return null;
}
