"use client";
import { useQueries, useQuery } from "@tanstack/react-query";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useTradutor } from "@/lib/i18n";
import {
  ESPECIES_DOCUMENTO_ESTOQUE, RECURSO_DA_ESPECIE_ESTOQUE, SEGMENTO_DA_ESPECIE_ESTOQUE,
  chaveI18nDaFamiliaOperacional, especieDoSegmentoEstoque, familiaOperacionalDeDocumentoEstoque
} from "@agro/domain";
import type { Row } from "@/features/docs/shared";
import { estadoDeTops, podeLancar, type EstadoTop } from "@/features/sales/tipo-operacao-select";
import type { GrupoDeTops, VarianteDeVenda } from "@/features/sales/variantes";

/**
 * AS ESPÉCIES DO DOCUMENTO DE ESTOQUE QUE O PORTAL DE ESTOQUE SABE LANÇAR (ESTOQUE-01, decisão 274).
 *
 * Nenhuma lista de espécie, segmento, permissão ou família mora aqui. As quatro espécies, o segmento da URL
 * (`entradas`, `saidas`…) e o recurso de permissão (`entradas_estoque`…) são do domínio
 * (`estoque-documento.ts`); a FAMÍLIA é perguntada ao registry de TOPs (`familiaOperacionalDeDocumentoEstoque`,
 * a variante de `erp.documentos_estoque` pela coluna `especie`). Espécie que o registry não declara não aparece
 * (fail-closed): o portal não oferece o que não sabe classificar.
 *
 * A forma é a MESMA de `VarianteDeVenda` (`variante` = a espécie), como em Compras, para o lançador
 * (`NovoDocumentoPorTop`) e o grupo de TOPs servirem aos três portais sem cópia.
 */
export type VarianteDeEstoque = VarianteDeVenda;

export function variantesDeEstoque(): VarianteDeEstoque[] {
  const out: VarianteDeEstoque[] = [];
  for (const especie of ESPECIES_DOCUMENTO_ESTOQUE) {
    const familia = familiaOperacionalDeDocumentoEstoque(especie);
    if (!familia) continue;
    out.push({
      variante: especie,
      segmento: SEGMENTO_DA_ESPECIE_ESTOQUE[especie],
      perm: RECURSO_DA_ESPECIE_ESTOQUE[especie],
      familia,
      chaveI18n: chaveI18nDaFamiliaOperacional(familia) ?? familia
    });
  }
  return out;
}

/** A espécie pelo valor persistido (`especie` da linha). */
export const varianteDeEstoque = (especie: unknown): VarianteDeEstoque | undefined =>
  typeof especie === "string" ? variantesDeEstoque().find((v) => v.variante === especie) : undefined;

/** A espécie de um segmento de rota (`entradas` → entrada) — `undefined` para segmento que o produto não conhece. */
export const varianteDeEstoquePorSegmento = (segmento: string | null | undefined): VarianteDeEstoque | undefined => {
  const especie = typeof segmento === "string" ? especieDoSegmentoEstoque(segmento) : undefined;
  return especie ? variantesDeEstoque().find((v) => v.variante === especie) : undefined;
};

/** A porta da Central em modo criação para uma TOP escolhida no `+ Novo`. */
export const rotaDeLancamentoDeEstoque = (linha: { segmento: string; id: string }) =>
  `/estoque/movimentacoes/${linha.segmento}/new?tipo_operacao_id=${encodeURIComponent(linha.id)}`;

/**
 * `/estoque/movimentacoes/<segmento>/<id>` pela ESPÉCIE DA LINHA (o que o servidor classificou), nunca pelo
 * filtro ativo. Espécie desconhecida cai na aba — nada de rota inventada.
 */
export function rotaDoDocumentoEstoque(r: Row): string {
  const v = varianteDeEstoque(r["especie"]);
  return v ? `/estoque/movimentacoes/${v.segmento}/${encodeURIComponent(String(r["id"]))}` : "/estoque?tab=movimentacoes";
}

/** A chave de cache das TOPs de uma espécie — a mesma no lançador, no filtro e na Central. */
const chaveTops = (segmento: string) => ["estoque-operation-types", segmento];

/** As TOPs de UMA espécie (Central de Estoque). Mesmo veredito de `estadoDeTops` que vendas e compras usam. */
export function useTopsDaEspecieEstoque(segmento: string, habilitado = true): EstadoTop {
  const q = useQuery<unknown, ApiError>({
    queryKey: chaveTops(segmento),
    queryFn: () => api<unknown>(`/api/estoque/${segmento}/operation-types`),
    enabled: habilitado && Boolean(segmento),
    retry: false
  });
  return estadoDeTops({ habilitado: habilitado && Boolean(segmento), carregando: q.isPending, erro: q.error, dados: q.data });
}

/** As TOPs de todas as espécies, uma pergunta por espécie que o usuário pode LANÇAR (a porta exige `.create`). */
export function useTopsDeEstoque(): GrupoDeTops[] {
  const { can } = useAuth(); const tr = useTradutor();
  const variantes = variantesDeEstoque();
  const resultados = useQueries({
    queries: variantes.map((v) => ({
      queryKey: chaveTops(v.segmento),
      queryFn: () => api<unknown>(`/api/estoque/${v.segmento}/operation-types`),
      enabled: can(`${v.perm}.create`),
      retry: false
    }))
  });
  return variantes.map((v, i) => {
    const habilitado = can(`${v.perm}.create`);
    const r = resultados[i]!;
    return { variante: v, rotulo: tr(v.chaveI18n), habilitado, estado: estadoDeTops({ habilitado, carregando: r.isPending, erro: (r.error as ApiError | null) ?? null, dados: r.data }) };
  });
}

/**
 * Opções do filtro por TOP da lista única, a partir dos grupos já perguntados — a mesma decisão (e a mesma
 * pendência de UX) das listas de vendas e de compras: só aparecem as TOPs das espécies que o usuário pode
 * LANÇAR, porque a porta de TOPs exige `.create`.
 */
export function opcoesDeTopDeEstoque(grupos: readonly GrupoDeTops[]): { value: string; label: string }[] {
  const vistos = new Set<string>();
  const opcoes: { value: string; label: string }[] = [];
  for (const g of grupos) {
    if (!g.habilitado || !podeLancar(g.estado)) continue;
    for (const top of g.estado.dados.items) {
      if (vistos.has(top.id)) continue;
      vistos.add(top.id);
      opcoes.push({ value: top.id, label: `${top.code} — ${top.name}` });
    }
  }
  return opcoes;
}
