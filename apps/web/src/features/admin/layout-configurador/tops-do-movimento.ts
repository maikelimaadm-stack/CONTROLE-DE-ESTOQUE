"use client";
import * as React from "react";
import { queryOptions, useQueries, useQuery, type UseQueryResult } from "@tanstack/react-query";
import { api, qs } from "@/lib/api";
import { BASE_LAYOUTS, CHAVE_LAYOUTS, chaveDetalhe, chaveLista, lerLinhaLayout, type LayoutLinha } from "./contrato";

/**
 * TOPs DO MOVIMENTO E ONDE CADA UMA ESTÁ (VENDAS-A3-1d, decisão 262) — um hook só para o diálogo "Visualizar TOPs", o
 * status de uso do layout e o assistente "Novo". Só leitura, pelas rotas de hoje:
 *  - `tops`: GET /api/admin/tipos-operacao?codigoBase=<movimento> (ativas e inativas; a tela marca "Inativa");
 *  - `ondeEsta`: TOP → layout que a tem ligada, lido dos DETALHES de todos os layouts ATIVOS do movimento com
 *    `qtdTops > 0` (incluindo o próprio — quem consome decide se "o próprio" conta).
 * CACHE: todas as chaves ficam sob `CHAVE_LAYOUTS` (toda gravação de layout — `invalidarLayouts` — as refaz). Em
 * `chaveDetalhe(id)` e `chaveLista(f)` o cache guarda a resposta CRUA (a mesma `queryFn` da área e da grade) e cada peça
 * converte no `select`: as peças dividem a consulta sem trocar a forma do que está guardado.
 */

export interface TopResumo { id: string; codigo: string; nome: string }
export interface TopDoMovimento extends TopResumo { ativo: boolean }
export interface OndeEstaTop { layoutId: string; nome: string }
/** O que as TOPs precisam do detalhe (GET admin /:id). A área lê o resto do mesmo cache com o seu próprio `select`. */
export interface DetalheTops { id: string; code: string; nome: string; familia: string; padrao: boolean; ativo: boolean; tops: TopResumo[] }

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === "object" ? (v as Obj) : {});
const str = (v: unknown) => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");
const itens = (v: unknown): unknown[] => (Array.isArray(v) ? v : Array.isArray(obj(v).items) ? (obj(v).items as unknown[]) : []);

/** TOP ligada: o servidor manda {id, codigo, nome}; aceita também só o id (string) ou `tipoOperacaoId`. */
export function lerTopResumo(v: unknown): TopResumo {
  if (typeof v === "string") return { id: v, codigo: "", nome: "" };
  const o = obj(v);
  return { id: str(o.id ?? o.tipoOperacaoId ?? o.tipo_operacao_id), codigo: str(o.codigo), nome: str(o.nome) };
}
/** As TOPs ligadas de um detalhe (ou da resposta do PUT /:id/tops, que também traz `tops`). */
export const lerTopsDoDetalhe = (v: unknown): TopResumo[] =>
  (Array.isArray(obj(v).tops) ? (obj(v).tops as unknown[]) : []).map(lerTopResumo).filter((t) => t.id);

export function lerDetalheTops(v: unknown): DetalheTops {
  const o = obj(v);
  return {
    id: str(o.id), code: str(o.code ?? o.codigo), nome: str(o.nome), familia: str(o.familia), padrao: Boolean(o.padrao),
    ativo: Boolean(o.ativo ?? o.isActive ?? o.is_active), tops: lerTopsDoDetalhe(o)
  };
}

/** Detalhe do layout: `queryFn` CRUA em `chaveDetalhe(id)` (a mesma da área), convertido no `select`. */
export const consultaDetalheTops = (id: string) => queryOptions({
  queryKey: chaveDetalhe(id),
  queryFn: () => api<unknown>(`${BASE_LAYOUTS}/${id}`),
  select: lerDetalheTops,
  retry: false
});

export const chaveTopsDoMovimento = (familia: string) => [...CHAVE_LAYOUTS, "tops-do-movimento", familia] as const;

const SEM_TOPS: readonly TopDoMovimento[] = [];
// `select` fora do componente: referência estável, o TanStack só reconverte quando a resposta muda.
const lerTopsDoMovimento = (v: unknown): TopDoMovimento[] => itens(v)
  .map((x): TopDoMovimento => { const o = obj(x); return { id: str(o.id), codigo: str(o.codigo), nome: str(o.nome), ativo: Boolean(o.ativo) }; })
  .filter((t) => t.id);
const lerLinhas = (v: unknown): LayoutLinha[] => itens(v).map(lerLinhaLayout);

interface OndeEstaCombinado { ondeEsta: ReadonlyMap<string, OndeEstaTop>; carregando: boolean; erro: unknown }
/** Fora do componente pelo mesmo motivo: o TanStack só recombina quando algum detalhe muda. */
function combinarOndeEsta(rs: UseQueryResult<DetalheTops>[]): OndeEstaCombinado {
  const ondeEsta = new Map<string, OndeEstaTop>();
  for (const r of rs) {
    if (!r.data) continue;
    for (const t of r.data.tops) ondeEsta.set(t.id, { layoutId: r.data.id, nome: r.data.nome });
  }
  return { ondeEsta, carregando: rs.some((r) => r.isLoading), erro: rs.find((r) => r.error)?.error ?? null };
}

export function useTopsDoMovimento(familia: string): {
  tops: readonly TopDoMovimento[]; ondeEsta: ReadonlyMap<string, OndeEstaTop>; carregando: boolean; erro: unknown;
} {
  const topsQ = useQuery({
    queryKey: [...chaveTopsDoMovimento(familia), "tops"],
    enabled: Boolean(familia),
    queryFn: () => api<unknown>(`/api/admin/tipos-operacao${qs({ codigoBase: familia, pageSize: 1000 })}`),
    select: lerTopsDoMovimento
  });
  // A lista do movimento pela chave da grade (`chaveLista`): resposta crua no cache, `select` converte.
  const layoutsQ = useQuery({
    queryKey: chaveLista(familia),
    enabled: Boolean(familia),
    queryFn: () => api<unknown>(`${BASE_LAYOUTS}${qs({ familia })}`),
    select: lerLinhas
  });
  const comTops = React.useMemo(
    () => (layoutsQ.data ?? []).filter((l) => l.id && l.familia === familia && l.ativo && l.qtdTops > 0),
    [layoutsQ.data, familia]
  );
  const detalhes = useQueries({ queries: comTops.map((l) => consultaDetalheTops(l.id)), combine: combinarOndeEsta });

  return {
    tops: topsQ.data ?? SEM_TOPS,
    ondeEsta: detalhes.ondeEsta,
    carregando: topsQ.isLoading || layoutsQ.isLoading || detalhes.carregando,
    erro: topsQ.error ?? layoutsQ.error ?? detalhes.erro
  };
}
