"use client";
import { useQueries } from "@tanstack/react-query";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useTradutor } from "@/lib/i18n";
import { chaveI18nDaFamiliaOperacional, familiasOperacionaisDisponiveis, varianteDeDocumentoVendaDaFamilia } from "@agro/domain";
import { estadoDeTops, podeLancar, type EstadoTop } from "./tipo-operacao-select";

/**
 * AS VARIANTES DE DOCUMENTO QUE O PORTAL DE VENDAS SABE LANÇAR — PERGUNTADAS AO REGISTRY.
 *
 * ┌─ POR QUE NÃO UMA LISTA AQUI ────────────────────────────────────────────────────────────────────┐
 * │ O caminho curto seria `["budget", "order", "sale"]` neste arquivo. Funcionaria hoje e mentiria   │
 * │ no dia em que o registry declarasse uma quarta família de vendas: o portal continuaria com três  │
 * │ chips, três grupos no lançador e três recortes de filtro, e NADA quebraria — nem tipo, nem       │
 * │ teste, nem tela. O defeito seria uma operação que o produto sabe executar e a tela não oferece,  │
 * │ descoberta meses depois. É exatamente a "segunda lista que envelhece em silêncio" que o gate     │
 * │ `scripts/familia-operacional-ssot-audit.mjs` existe para tornar barulhenta.                      │
 * │                                                                                                  │
 * │ Então a lista SAI do registry: as famílias disponíveis, filtradas por aquelas que de fato viram  │
 * │ documento de venda (`varianteDeDocumentoVendaDaFamilia`, fail-closed por construção).            │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ O PLURAL É REGRA, NÃO MAPA ────────────────────────────────────────────────────────────────────┐
 * │ `segmento` (a porta HTTP e a rota do web) e `perm` (a família de capacidade) são o plural da     │
 * │ variante — `budget` → `budgets`, `order` → `orders`, `sale` → `sales`. Escrever isso como MAPA   │
 * │ seria de novo uma lista paralela; escrever como REGRA mantém a derivação válida para a variante  │
 * │ seguinte. Se um dia a regra deixar de valer, o lugar de declarar a exceção é este, uma vez.      │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────┘
 */
export interface VarianteDeVenda {
  /** O valor do discriminador `kind` em `erp.sales_documents` — o que o registro É. */
  variante: string;
  /** O segmento plural da rota e da porta (`/vendas/<segmento>`, `/api/sales/<segmento>`). */
  segmento: string;
  /** A família de capacidade (`budgets.view`, `orders.create`…). */
  perm: string;
  /** O código canônico da família operacional (`vendas.pedido`). */
  familia: string;
  /** A chave do rótulo humano da família no catálogo de idioma. */
  chaveI18n: string;
}

export function variantesDeVenda(): VarianteDeVenda[] {
  const out: VarianteDeVenda[] = [];
  for (const familia of familiasOperacionaisDisponiveis()) {
    const variante = varianteDeDocumentoVendaDaFamilia(familia);
    if (!variante) continue;
    const plural = `${variante}s`;
    out.push({ variante, segmento: plural, perm: plural, familia, chaveI18n: chaveI18nDaFamiliaOperacional(familia) ?? familia });
  }
  return out;
}

/** A variante de uma família — `undefined` quando o produto não sabe criar aquele documento. */
export const varianteDeVenda = (variante: string | null | undefined): VarianteDeVenda | undefined =>
  variantesDeVenda().find((v) => v.variante === variante);

/** Um grupo do lançador: a variante, seu rótulo humano e o que o servidor respondeu sobre as TOPs dela. */
export interface GrupoDeTops { variante: VarianteDeVenda; rotulo: string; habilitado: boolean; estado: EstadoTop }

/**
 * AS TOPs DE TODAS AS VARIANTES, EM UMA RENDERIZAÇÃO.
 *
 * `useQueries` e não um laço de `useTopsDaVariante`: a regra dos hooks proíbe o laço, e a lista de
 * variantes é do registry (constante em runtime, mas não uma constante literal que o compilador veja).
 * O veredito de cada resposta vem de `estadoDeTops`, a MESMA função que o seletor por variante usa —
 * duas escadas de `if` para a mesma pergunta divergiriam em silêncio.
 *
 * A chave de cache é a mesma de `useTopsDaVariante`, de propósito: abrir o lançador e depois um
 * formulário não pergunta duas vezes.
 *
 * SÓ PERGUNTA O QUE O USUÁRIO PODE LANÇAR. A porta operacional exige `<perm>.create`; perguntar sem a
 * capacidade renderia um 403 registrado em log a cada abertura do portal, sem nada em troca.
 */
export function useTopsDeVendas(): GrupoDeTops[] {
  const { can } = useAuth(); const tr = useTradutor();
  const variantes = variantesDeVenda();
  const resultados = useQueries({
    queries: variantes.map((v) => ({
      queryKey: ["sales-operation-types", v.segmento],
      queryFn: () => api<unknown>(`/api/sales/${v.segmento}/operation-types`),
      enabled: can(`${v.perm}.create`),
      retry: false
    }))
  });
  return variantes.map((v, i) => {
    const habilitado = can(`${v.perm}.create`);
    const r = resultados[i]!;
    return {
      variante: v,
      rotulo: tr(v.chaveI18n),
      habilitado,
      estado: estadoDeTops({ habilitado, carregando: r.isPending, erro: (r.error as ApiError | null) ?? null, dados: r.data })
    };
  });
}

/**
 * As opções do filtro por TOP da LISTA ÚNICA — a união das TOPs das variantes que o usuário pode lançar.
 *
 * Filtrar é conveniência: sem opções o filtro some e a listagem continua inteira. Quem recorta linhas é
 * o servidor, pela capacidade de LEITURA de cada variante.
 */
export function useOpcoesDeTopDeVendas(): { value: string; label: string }[] {
  const grupos = useTopsDeVendas();
  const vistos = new Set<string>();
  const opcoes: { value: string; label: string }[] = [];
  for (const g of grupos) {
    if (!podeLancar(g.estado)) continue;
    for (const top of g.estado.dados.items) {
      if (vistos.has(top.id)) continue;
      vistos.add(top.id);
      opcoes.push({ value: top.id, label: `${top.code} — ${top.name}` });
    }
  }
  return opcoes;
}
