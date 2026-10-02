import type { ItemRow, Plan } from "@/features/docs/shared";
import { descartarEntrega, entregarEmMemoria, espiarEntrega } from "@/lib/entrega-em-memoria";
import type { CopiaEmMemoria } from "./contrato";

export type { CopiaEmMemoria } from "./contrato";

/**
 * DUPLICAR — a entrega em memória GENÉRICA da cópia. O cabeçalho (`C`) é da espécie; o motor só guarda, confere e
 * descarta. Viaja por `lib/entrega-em-memoria.ts`, com dono: nada na URL (que só leva a TOP), nada no armazenamento do
 * navegador. A criação a consome UMA vez, ao montar. A chave vem do adaptador (`chaveDaCopia`); `chaveDaCopiaPadrao`
 * monta `<prefixo>:copia:<segmento>`.
 */
export const chaveDaCopiaPadrao = (prefixo: string) => (segmento: string) => `${prefixo}:copia:${segmento}`;

export function montarCopia<C>(segmento: string, tipoOperacaoId: string, cabecalho: C, itens: ItemRow[], plano: Plan | null): CopiaEmMemoria<C> {
  return { segmento, tipoOperacaoId, cabecalho, itens, plano };
}

/** A cópia só vale para a criação da MESMA espécie aberta com a MESMA TOP do original. */
export function copiaValePara<C>(copia: CopiaEmMemoria<C> | null, segmento: string, tipoOperacaoId: string): copia is CopiaEmMemoria<C> {
  return copia !== null && copia.segmento === segmento && copia.tipoOperacaoId.toLowerCase() === tipoOperacaoId.toLowerCase();
}

export function entregarCopia<C>(chave: (segmento: string) => string, copia: CopiaEmMemoria<C>): void {
  entregarEmMemoria(chave(copia.segmento), copia);
}

/** Espia (sem apagar) a cópia da espécie e devolve só se valer para esta TOP. */
export function espiarCopia<C>(chave: (segmento: string) => string, segmento: string, tipoOperacaoId: string): CopiaEmMemoria<C> | null {
  const c = espiarEntrega<CopiaEmMemoria<C>>(chave(segmento));
  return copiaValePara(c, segmento, tipoOperacaoId) ? c : null;
}

export function descartarCopia(chave: (segmento: string) => string, segmento: string): void { descartarEntrega(chave(segmento)); }
