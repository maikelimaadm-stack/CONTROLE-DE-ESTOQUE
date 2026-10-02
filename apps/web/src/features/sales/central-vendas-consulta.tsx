"use client";
import * as React from "react";
import type { Row } from "@/features/docs/shared";
import { ItensSalvos as ItensSalvosDoMotor } from "@/features/central/itens-salvos";
import { PREFIXO_CENTRAL_VENDAS, colunasDosItensDeVendas } from "./central-vendas-adaptador";

/**
 * CENTRAL DE VENDAS EM CONSULTA — as peças de LEITURA do documento salvo (VISUAL-UX-01 R3; motor extraído em
 * VISUAL-UX-04). A grade/formulário dos itens salvos é a do motor, com o Configurar colunas dele dentro; a venda
 * entrega o prefixo dos testids e as colunas de leitura de sempre. Nada aqui calcula, decide ou grava: os valores vêm
 * prontos do detalhe (`/api/sales/<segmento>/<id>`), inclusive subtotal e total.
 */

/** OS ITENS DO DOCUMENTO SALVO — grade e formulário só de leitura, subtotal DO SERVIDOR. */
export function ItensSalvos({ itens, subtotal, legenda, mostrarSaldo, mostrarReservado, avisos }: {
  itens: Row[]; subtotal: string; legenda: string; mostrarSaldo?: boolean; mostrarReservado?: boolean;
  avisos?: readonly { testId: string; conteudo: React.ReactNode }[];
}) {
  return <ItensSalvosDoMotor prefixoTestid={PREFIXO_CENTRAL_VENDAS} colunas={colunasDosItensDeVendas} itens={itens} subtotal={subtotal} legenda={legenda}
    mostrarSaldo={mostrarSaldo} mostrarReservado={mostrarReservado} avisos={avisos} />;
}
