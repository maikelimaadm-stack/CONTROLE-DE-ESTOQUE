"use client";
import * as React from "react";
import type { Row } from "@/features/docs/shared";
import { ItensSalvos as ItensSalvosDoMotor } from "@/features/central/itens-salvos";
import { ConfigurarColunas as ConfigurarColunasDoMotor, type Preferencia } from "@/features/central/configurar-colunas";
import { PREFIXO_CENTRAL_VENDAS, colunasDosItensDeVendas } from "./central-vendas-adaptador";

/**
 * CENTRAL DE VENDAS EM CONSULTA — as peças de LEITURA do documento salvo (VISUAL-UX-01 R3; motor extraído em
 * VISUAL-UX-04). A grade/formulário dos itens salvos e o Configurar colunas são os do motor; a venda entrega o prefixo
 * dos testids e as colunas de leitura de sempre. Nada aqui calcula, decide ou grava: os valores vêm prontos do
 * detalhe (`/api/sales/<segmento>/<id>`), inclusive subtotal e total.
 */

/** OS ITENS DO DOCUMENTO SALVO — grade e formulário só de leitura, subtotal DO SERVIDOR. */
export function ItensSalvos({ itens, subtotal, legenda, mostrarSaldo, mostrarReservado, avisos }: {
  itens: Row[]; subtotal: string; legenda: string; mostrarSaldo?: boolean; mostrarReservado?: boolean;
  avisos?: readonly { testId: string; conteudo: React.ReactNode }[];
}) {
  return <ItensSalvosDoMotor prefixoTestid={PREFIXO_CENTRAL_VENDAS} colunas={colunasDosItensDeVendas} itens={itens} subtotal={subtotal} legenda={legenda}
    mostrarSaldo={mostrarSaldo} mostrarReservado={mostrarReservado} avisos={avisos} />;
}

/** CONFIGURAR COLUNAS / CAMPOS — estado DESTA tela, sem persistência. */
export function ConfigurarColunas<K extends string>({ titulo, subtitulo, rotulos, lista, onLista, onRestaurar, ambos, onAmbos }: {
  titulo: string; subtitulo: string; rotulos: Record<K, string>; lista: readonly Preferencia<K>[];
  onLista: (l: Preferencia<K>[]) => void; onRestaurar: () => void; ambos: boolean; onAmbos: () => void;
}) {
  return <ConfigurarColunasDoMotor<K> prefixoTestid={PREFIXO_CENTRAL_VENDAS} titulo={titulo} subtitulo={subtitulo} rotulos={rotulos} lista={lista}
    onLista={onLista} onRestaurar={onRestaurar} ambos={ambos} onAmbos={onAmbos} />;
}
