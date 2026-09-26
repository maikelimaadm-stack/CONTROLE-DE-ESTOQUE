"use client";
/**
 * BLOCOS DO PARCEIRO (CADASTROS AJUSTES 02, 2.4) — CONTRATO (PASSO 0).
 * UM componente desenha o corpo de endereço/conta/contato, no principal (seções da ficha) e no cartão adicional.
 * Ordem e rótulos: BLOCO_ENDERECO / BLOCO_CONTA / BLOCO_CONTATO (@agro/domain). `campo(parte)` devolve o controle
 * de cada parte; o bloco só decide ORDEM, rótulo e moldura.
 */
import * as React from "react";
import type { BlocoDoParceiro, ParteDoBloco } from "@agro/domain";

export interface CorpoDoBlocoProps {
  bloco: BlocoDoParceiro;
  lado: "principal" | "adicional";
  /** controle de uma parte (null = a parte não se aplica agora: sem capacidade, invisível) */
  campo: (parte: ParteDoBloco) => React.ReactNode;
}
export function CorpoDoBloco(_props: CorpoDoBlocoProps): React.ReactElement | null { return null; }
