"use client";
import { useQueries } from "@tanstack/react-query";
import { api } from "@/lib/api";

/**
 * O CONTROLE DE LOTE DE CADA PRODUTO NA CENTRAL DE ESTOQUE (ESTOQUE-01, decisão 274; no motor desde a OPERACOES-01 F5b,
 * decisão 282) — lido do cadastro do produto (`controle_lote`: `nenhum` | `lote` | `lote_validade`), como na Central
 * de Compras. Uma leitura por produto distinto, com a mesma chave de cache de sempre.
 *
 * `conhecido`: a leitura do cadastro JÁ voltou (string ou falha). Enquanto falso, o lote da linha do Saldo NÃO é
 * apagado — a Central não pode “limpar” o preenchimento da URL antes de saber o controle.
 * `daLinha`: desconhecido = campos ABERTOS (quem recusa é o servidor — o produto pode ter mudado de controle).
 * `pede`: a coluna TEM de aparecer? Só com produto escolhido — controle lido que pede, ou controle que não se conseguiu
 * ler (a pessoa precisa de onde digitar o que o servidor pode cobrar). Enquanto a leitura não chega, não força: a
 * coluna não pisca a cada produto escolhido (exceto quando o item JÁ trouxe lote/validade — ver
 * `forcarColunaDeLoteNaAbertura`).
 */
export interface ControleDeLote {
  conhecido: (produtoId: string) => boolean;
  daLinha: (produtoId: string) => { lote: boolean; validade: boolean };
  pede: (produtoId: string, campo: "lote" | "validade") => boolean;
}

export function useControleDeLote(produtos: readonly string[]): ControleDeLote {
  const unicos = Array.from(new Set(produtos.filter(Boolean)));
  const qs = useQueries({
    queries: unicos.map((id) => ({
      queryKey: ["estoque-produto-lote", id],
      queryFn: () => api<Record<string, unknown>>(`/api/resources/products/${id}`),
      staleTime: 60_000,
      retry: false
    }))
  });
  const mapa = new Map<string, string>(); const ilegivel = new Set<string>();
  unicos.forEach((id, i) => {
    const q = qs[i]; const c = q?.data?.["controle_lote"];
    if (typeof c === "string") mapa.set(id, c); else if (q && !q.isPending) ilegivel.add(id);
  });
  return {
    conhecido: (produtoId) => mapa.has(produtoId) || ilegivel.has(produtoId),
    daLinha: (produtoId) => {
      const c = mapa.get(produtoId);
      if (c === undefined) return { lote: true, validade: true };
      return { lote: c !== "nenhum", validade: c === "lote_validade" };
    },
    pede: (produtoId, campo) => {
      if (!produtoId) return false;
      const c = mapa.get(produtoId);
      if (c === undefined) return ilegivel.has(produtoId);
      return campo === "lote" ? c !== "nenhum" : c === "lote_validade";
    }
  };
}
