"use client";
import * as React from "react";
import type { EstruturaLayout } from "@agro/domain";

/** Histórico de desfazer/refazer do configurador: até 50 passos (o mais antigo sai). */
export const LIMITE_HISTORICO = 50;

export interface Rascunho {
  estrutura: EstruturaLayout;
  podeDesfazer: boolean;
  podeRefazer: boolean;
  /** empilha o estado atual no desfazer e troca pelo novo (limpa o refazer) */
  mudar: (e: EstruturaLayout) => void;
  desfazer: () => void;
  refazer: () => void;
  /** recomeça do zero (sem histórico) — no Cancelar e depois de Salvar (o gravado novo vira a base) */
  reiniciar: (e: EstruturaLayout) => void;
}

interface Estado { atual: EstruturaLayout; passado: EstruturaLayout[]; futuro: EstruturaLayout[] }

export function useRascunho(inicial: EstruturaLayout): Rascunho {
  const [s, setS] = React.useState<Estado>(() => ({ atual: inicial, passado: [], futuro: [] }));
  const mudar = React.useCallback((e: EstruturaLayout) => setS((x) => ({ atual: e, passado: [...x.passado, x.atual].slice(-LIMITE_HISTORICO), futuro: [] })), []);
  const desfazer = React.useCallback(() => setS((x) => {
    const anterior = x.passado[x.passado.length - 1];
    return anterior ? { atual: anterior, passado: x.passado.slice(0, -1), futuro: [x.atual, ...x.futuro] } : x;
  }), []);
  const refazer = React.useCallback(() => setS((x) => {
    const [proximo, ...resto] = x.futuro;
    return proximo ? { atual: proximo, passado: [...x.passado, x.atual].slice(-LIMITE_HISTORICO), futuro: resto } : x;
  }), []);
  const reiniciar = React.useCallback((e: EstruturaLayout) => setS({ atual: e, passado: [], futuro: [] }), []);
  return { estrutura: s.atual, podeDesfazer: s.passado.length > 0, podeRefazer: s.futuro.length > 0, mudar, desfazer, refazer, reiniciar };
}
