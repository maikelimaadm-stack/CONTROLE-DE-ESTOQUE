"use client";
/**
 * CARTÃO ADICIONAL (CADASTROS AJUSTES 02, 2.4) — CONTRATO (PASSO 0).
 * Cada endereço/conta/contato adicional é um CARTÃO cujo corpo é desenhado pelo MESMO componente do bloco
 * principal (blocos-parceiro.tsx), na ordem de BLOCO_* (@agro/domain). Mantém tudo o que a linha da grade fazia:
 * permissões criar/editar/excluir, gravada × nova, erros do servidor por cartão, CEP com resposta velha descartada,
 * trava "pelo CEP", limite de linhas.
 * testids: contêiner `grade-<detalhe>`; cartão `linha-<detalhe>-N`; botão `incluir-<detalhe>` ("Incluir endereço" /
 * "Incluir conta" / "Incluir contato"); remover com aria-label "Remover endereço N" / "Remover conta N" / "Remover contato N".
 */
import * as React from "react";
import type { BlocoDoParceiro } from "@agro/domain";

export interface GradeDeCartoesProps {
  bloco: BlocoDoParceiro;
  /** o resto das props é o da GradeDeDetalhe (d, form, dis, erros) — fixado pelo agente CARTÃO */
  children?: React.ReactNode;
}
export function GradeDeCartoes(_props: GradeDeCartoesProps): React.ReactElement | null { return null; }
