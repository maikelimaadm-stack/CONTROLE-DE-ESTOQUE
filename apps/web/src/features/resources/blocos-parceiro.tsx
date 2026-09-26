"use client";
/**
 * BLOCOS DO PARCEIRO (CADASTROS AJUSTES 02, 2.4).
 * UM componente desenha o corpo de endereço/conta/contato, no principal (seções da ficha) e no cartão adicional.
 * Ordem e rótulos: BLOCO_ENDERECO / BLOCO_CONTA / BLOCO_CONTATO (@agro/domain). `campo(parte)` devolve o controle
 * de cada parte (já na moldura B1Field); o bloco só decide a ORDEM. Parte derivada de uma busca oficial (`parteDe`:
 * Código IBGE, UF, Código do banco) é desenhada pela própria busca, ao lado dela — quem chama devolve null para ela.
 */
import * as React from "react";
import { partesDoLado, type BlocoDoParceiro, type ParteDoBloco } from "@agro/domain";

export interface CorpoDoBlocoProps {
  bloco: BlocoDoParceiro;
  lado: "principal" | "adicional";
  /** controle de uma parte (null = a parte não se aplica agora: sem capacidade, invisível, derivada da busca) */
  campo: (parte: ParteDoBloco) => React.ReactNode;
}
export function CorpoDoBloco({ bloco, lado, campo }: CorpoDoBlocoProps): React.ReactElement | null {
  return <>{partesDoLado(bloco, lado).map((p) => <React.Fragment key={p.chave}>{campo(p)}</React.Fragment>)}</>;
}
