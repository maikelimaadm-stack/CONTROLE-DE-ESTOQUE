"use client";
/**
 * ESBOÇO — W2 substitui por inteiro: motor de arraste por ponteiro (limiar de 4 px, alvo por [data-alvo] sob o ponteiro,
 * Esc cancela, fantasma). Contrato: `ApiArraste` e `PropsProvedorArraste` em tipos.ts.
 */
import * as React from "react";
import type { ApiArraste, PropsProvedorArraste } from "./tipos";

const Contexto = React.createContext<ApiArraste>({ item: null, previsao: null, pouso: null, iniciar: () => undefined });

export function ProvedorArraste({ children }: PropsProvedorArraste) {
  const api = React.useMemo<ApiArraste>(() => ({ item: null, previsao: null, pouso: null, iniciar: () => undefined }), []);
  return <Contexto.Provider value={api}>{children}</Contexto.Provider>;
}

export const useArraste = (): ApiArraste => React.useContext(Contexto);
