"use client";
import type { ResourceDef } from "@agro/domain";
import { useAuth, type AppContext } from "@/lib/auth";

/** Versões das capacidades da decisão 257 D que estas telas sabem usar (forma e versão EXATAS, como `loteNaEntrada`). */
export const CAPACIDADE_CODIGO_AUTOMATICO = 1 as const;
export const CAPACIDADE_MOVER_COM_FILHOS = 1 as const;

/**
 * A API GERA E TRAVA O CÓDIGO? — `capacidades.codigoAutomatico` em `GET /api/auth/context`. Sem a declaração (API
 * anterior, na janela em que a web sobe antes), a tela mostra o código digitável com a sugestão de sempre — a API
 * anterior exige o código no corpo — e não mostra a Numeração dos cadastros. Valor desconhecido = ausente.
 */
export function entendeCodigoAutomatico(ctx: AppContext | null | undefined): boolean {
  return ctx?.capacidades?.["codigoAutomatico"] === CAPACIDADE_CODIGO_AUTOMATICO;
}
export function useCodigoAutomatico(): boolean { return entendeCodigoAutomatico(useAuth().ctx); }

/** O código DESTE cadastro é gerado pelo servidor e só leitura na tela? (capacidade declarada E cadastro marcado) */
export function useCodigoTravado(def: ResourceDef | undefined): boolean {
  return useCodigoAutomatico() && Boolean(def?.codigoAutomatico);
}

/** A API tem o Mover com renumeração do galho (`/mover/previa` e `/mover`)? Sem ela, o Mover de antes (só folha). */
export function entendeMoverComFilhos(ctx: AppContext | null | undefined): boolean {
  return ctx?.capacidades?.["moverComFilhos"] === CAPACIDADE_MOVER_COM_FILHOS;
}
export function useMoverComFilhos(): boolean { return entendeMoverComFilhos(useAuth().ctx); }
