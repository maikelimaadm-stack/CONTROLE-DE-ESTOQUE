"use client";
import { useQueries, useQuery, type UseQueryResult } from "@tanstack/react-query";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useTradutor } from "@/lib/i18n";
import {
  CAPACIDADE_FINALIZACAO_E_ORCAMENTO_COMPRA, chaveI18nDaFamiliaOperacional, entidadeIdGlobal, familiasOperacionaisDisponiveis, tipoOperacao
} from "@agro/domain";
import { estadoDeTops, podeLancar, type EstadoTop } from "@/features/sales/tipo-operacao-select";
import type { GrupoDeTops, VarianteDeVenda } from "@/features/sales/variantes";

/**
 * AS ESPÉCIES DE DOCUMENTO DE COMPRA QUE O PORTAL DE COMPRAS SABE LANÇAR — PERGUNTADAS AO REGISTRY (COMPRAS-01).
 *
 * Nenhuma lista de espécies mora aqui, pelo mesmo motivo de `features/sales/variantes.ts`: a família vem do
 * registry de TOPs (as famílias cuja origem é a tabela do documento de compra), e a ROTA e a PERMISSÃO de cada
 * espécie vêm do catálogo do ID Global (`documentos_compra`, resolução por variante), que já declara
 * `/compras/<segmento>/:id` e `<recurso>.view` para cada uma. Assim o segmento da URL (`pedidos`, `compras`) e a
 * família de capacidade (`pedidos_compra`, `compras`) — que NÃO seguem a regra do plural da venda — têm UM dono.
 * Espécie sem entrada no catálogo não aparece (fail-closed): o portal não oferece o que não sabe endereçar.
 *
 * A forma é a MESMA de `VarianteDeVenda` (`variante` = a espécie), para o lançador e o grupo de TOPs servirem aos
 * dois portais sem cópia.
 */
export type VarianteDeCompra = VarianteDeVenda;

/** O tipo de entidade do documento de compra no catálogo do ID Global (dono da rota e da permissão por espécie). */
const ENTIDADE_DOCUMENTO_COMPRA = "documentos_compra";

export function variantesDeCompra(): VarianteDeCompra[] {
  const entidade = entidadeIdGlobal(ENTIDADE_DOCUMENTO_COMPRA);
  if (!entidade || entidade.resolucao.tipo !== "variante") return [];
  const porEspecie = entidade.resolucao.variantes;
  const out: VarianteDeCompra[] = [];
  for (const familia of familiasOperacionaisDisponiveis()) {
    const declarada = tipoOperacao(familia);
    if (!declarada || declarada.origem.tabela !== entidade.tabela || !declarada.origem.valor) continue;
    const especie = declarada.origem.valor;
    const endereco = porEspecie[especie];
    if (!endereco) continue;
    // `/compras/<segmento>/:id` e `<recurso>.view` — o formato que o catálogo declara; outro formato NEGA.
    const rota = /^\/compras\/([a-z_]+)\/:id$/.exec(endereco.rota);
    const perm = /^([a-z_]+)\.view$/.exec(endereco.permissao);
    if (!rota || !perm) continue;
    out.push({ variante: especie, segmento: rota[1]!, perm: perm[1]!, familia, chaveI18n: chaveI18nDaFamiliaOperacional(familia) ?? familia });
  }
  return out;
}

/** A espécie de um segmento de rota (`pedidos` → pedido) — `undefined` quando o produto não conhece aquele segmento. */
export const varianteDeCompraPorSegmento = (segmento: string | null | undefined): VarianteDeCompra | undefined =>
  variantesDeCompra().find((v) => v.segmento === segmento);

/** A espécie pelo valor persistido (`especie` da linha). */
export const varianteDeCompra = (especie: string | null | undefined): VarianteDeCompra | undefined =>
  variantesDeCompra().find((v) => v.variante === especie);

/** A chave de cache das TOPs de uma espécie — a mesma no lançador, no filtro e na Central. */
const chaveTops = (segmento: string) => ["compras-operation-types", segmento];

/** As TOPs de UMA espécie (Central de Compras). Mesmo veredito de `estadoDeTops` que vendas usa. */
export function useTopsDaEspecie(segmento: string, habilitado = true): EstadoTop {
  const q = useQuery<unknown, ApiError>({
    queryKey: chaveTops(segmento),
    queryFn: () => api<unknown>(`/api/compras/${segmento}/operation-types`),
    enabled: habilitado && Boolean(segmento),
    retry: false
  });
  return estadoDeTops({ habilitado: habilitado && Boolean(segmento), carregando: q.isPending, erro: q.error, dados: q.data });
}

/**
 * OPERACOES-01 F6a/F6b (decisão 283): a espécie cuja porta NASCE com a capacidade `finalizacaoEOrcamento` — a API
 * anterior não tem `/api/compras/orcamentos/operation-types` (404 de rota). As portas de `operation-types` das espécies
 * nascem no MESMO binário e declaram a MESMA capacidade; por isso a porta desta espécie só é perguntada quando outra
 * porta já declarou a capacidade, ou quando o usuário não lança nenhuma outra espécie (aí ela é a única que ele pode
 * perguntar). Web nova × API anterior (skew sentido 1): nenhuma pergunta a uma rota que a API não tem.
 */
const ESPECIE_DA_CAPACIDADE_F6 = "orcamento";

/** O corpo de `/operation-types` declara `capacidades.finalizacaoEOrcamento === CAPACIDADE_FINALIZACAO_E_ORCAMENTO_COMPRA` (propriedade própria; contractVersion 1)? */
export function declaraFinalizacaoEOrcamento(resposta: unknown): boolean {
  const ehObjeto = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
  // Propriedade PRÓPRIA (nunca herdada do protótipo): um corpo que não a declara não a tem.
  if (!ehObjeto(resposta) || !Object.hasOwn(resposta, "contractVersion") || resposta.contractVersion !== 1) return false;
  const capacidades = Object.hasOwn(resposta, "capacidades") ? resposta.capacidades : undefined;
  return ehObjeto(capacidades) && Object.hasOwn(capacidades, "finalizacaoEOrcamento")
    && capacidades.finalizacaoEOrcamento === CAPACIDADE_FINALIZACAO_E_ORCAMENTO_COMPRA;
}

/** Uma porta de `operation-types` de compras: a espécie, se foi perguntada (ver `usePortasDasTopsDeCompras`) e a resposta. */
export interface PortaDasTopsDeCompra { variante: VarianteDeCompra; perguntada: boolean; resultado: UseQueryResult<unknown> }

/**
 * As portas de `operation-types` de TODAS as espécies, na ordem de `variantesDeCompra()`, com o MESMO cache das TOPs de
 * uma espécie (`useTopsDaEspecie`). Uma porta é perguntada quando o usuário pode LANÇAR a espécie (a porta exige
 * `.create`); a da espécie que nasce com a capacidade da F6, só nas condições de `ESPECIE_DA_CAPACIDADE_F6`.
 * `habilitado` falso: nenhuma porta é perguntada (a tela que não precisa delas).
 */
export function usePortasDasTopsDeCompras(habilitado = true): PortaDasTopsDeCompra[] {
  const { can } = useAuth();
  const variantes = variantesDeCompra();
  const lanca = (v: VarianteDeCompra) => habilitado && can(`${v.perm}.create`);
  const porta = (v: VarianteDeCompra, perguntada: boolean) => ({
    queryKey: chaveTops(v.segmento),
    queryFn: () => api<unknown>(`/api/compras/${v.segmento}/operation-types`),
    enabled: perguntada,
    retry: false
  });
  // Duas levas, cada uma com uma lista FIXA (o catálogo é constante em runtime): a regra dos hooks continua valendo.
  const deHoje = variantes.filter((v) => v.variante !== ESPECIE_DA_CAPACIDADE_F6);
  const daF6 = variantes.filter((v) => v.variante === ESPECIE_DA_CAPACIDADE_F6);
  const respostasDeHoje = useQueries({ queries: deHoje.map((v) => porta(v, lanca(v))) });
  const outraDeclarou = deHoje.some((v, i) => lanca(v) && respostasDeHoje[i]!.isSuccess && declaraFinalizacaoEOrcamento(respostasDeHoje[i]!.data));
  const lancaOutra = deHoje.some(lanca);
  const perguntaF6 = (v: VarianteDeCompra) => lanca(v) && (outraDeclarou || !lancaOutra);
  const respostasDaF6 = useQueries({ queries: daF6.map((v) => porta(v, perguntaF6(v))) });
  return variantes.map((v) => {
    const iHoje = deHoje.indexOf(v);
    if (iHoje >= 0) return { variante: v, perguntada: lanca(v), resultado: respostasDeHoje[iHoje]! };
    return { variante: v, perguntada: perguntaF6(v), resultado: respostasDaF6[daF6.indexOf(v)]! };
  });
}

/**
 * As TOPs de todas as espécies, uma pergunta por espécie que o usuário pode LANÇAR (a porta exige `.create`). A espécie
 * da F6 cuja porta não foi perguntada (API anterior) fica desabilitada: o Portal não oferece o que o servidor não tem.
 */
export function useTopsDeCompras(): GrupoDeTops[] {
  const tr = useTradutor();
  return usePortasDasTopsDeCompras().map(({ variante: v, perguntada: habilitado, resultado: r }) => (
    { variante: v, rotulo: tr(v.chaveI18n), habilitado, estado: estadoDeTops({ habilitado, carregando: r.isPending, erro: (r.error as ApiError | null) ?? null, dados: r.data }) }
  ));
}

/** Opções do filtro por TOP da lista única — a mesma decisão (e a mesma pendência de UX) da lista de vendas. */
export function useOpcoesDeTopDeCompras(): { value: string; label: string }[] {
  const grupos = useTopsDeCompras();
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
