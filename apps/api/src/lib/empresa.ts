/**
 * PONTE ENTRE O CONTRATO DE EMPRESA E O ESCOPO LEGADO (docs/MULTI-COMPANY-CONTRACT.md).
 *
 * O contrato de empresa vive em `@erp/plataforma` (puro, testável, neutro de nicho) e é EXPLÍCITO:
 * `{ modo: "todas" }` ou `{ modo: "selecionadas"; empresaIds }`. "Autorizado a todas" e "autorizado a
 * nenhuma" são estados distintos no núcleo — não existe lista vazia ambígua.
 *
 * A infraestrutura herdada do primeiro segmento atendido (tabela `farms`, vínculo `member_farms`, cabeçalho
 * `X-Farm-Id`) ainda usa a convenção antiga, na qual `membership.farmIds = []` significa "todas as empresas
 * da organização". ESTA PONTE É O ÚNICO LUGAR ONDE ESSA CONVERSÃO ACONTECE — o núcleo nunca a enxerga.
 *
 * A AUTORIDADE de autorização continua sendo `ctx.membership.farmIds`: nada aqui afrouxa o escopo, e a
 * equivalência com `allowedFarms` é testada em apps/api/test/unit/empresa-bridge.test.ts e na matriz
 * cross-empresa de integração.
 */
import {
  empresasSelecionadas, resolverEscopoEmpresa, selecionarEmpresaDoLancamento, TODAS_AS_EMPRESAS,
  type AutorizacaoEmpresas, type EscopoEmpresaResolvido, type IdEmpresa, type SelecaoEmpresa
} from "@erp/plataforma";
import type { RequestContext, ServiceCtx } from "./context.js";

/**
 * Converte a autorização LEGADA (lista de fazendas, vazia = todas) para o contrato explícito.
 * Único ponto de tradução; a partir daqui só existe `modo: "todas" | "selecionadas"`.
 */
export const autorizacaoDeFarmIdsLegado = (farmIds: readonly IdEmpresa[]): AutorizacaoEmpresas =>
  farmIds.length === 0 ? TODAS_AS_EMPRESAS : empresasSelecionadas(farmIds);

/** Autorização de empresas do usuário no formato do contrato. */
export const autorizacaoEmpresas = (ctx: RequestContext): AutorizacaoEmpresas =>
  autorizacaoDeFarmIdsLegado(ctx.membership.farmIds);

/** Empresa selecionada no contexto de trabalho. Seleção, nunca autorização. */
export const empresaSelecionada = (ctx: RequestContext): IdEmpresa | null => ctx.farmId;

/**
 * Escopo de empresas para leitura. `empresaIds === null` = sem recorte (todas as empresas da organização);
 * o isolamento por organização continua vindo do tenant + RLS.
 */
export function escopoEmpresa(ctx: RequestContext, pedidas?: readonly IdEmpresa[] | string | null): EscopoEmpresaResolvido {
  return resolverEscopoEmpresa(autorizacaoEmpresas(ctx), { pedidas: pedidas ?? null, selecionada: empresaSelecionada(ctx) });
}

/**
 * EMPRESAS DISPONÍVEIS NA ORGANIZAÇÃO — FONTE SERVER-SIDE.
 *
 * A regra pura de seleção (`selecionarEmpresaDoLancamento`) exige a lista de empresas que realmente existem
 * para o tenant atual; ela não pode ser enviada pelo cliente. Aqui é onde a Empresa ainda é materializada
 * pela infraestrutura herdada (`erp.farms`) — a API conhece a materialização, o núcleo não.
 *
 * `somenteAtivas` (padrão) é a política para LANÇAMENTO: não se lança em empresa inativa. Uma consulta
 * histórica que precise enxergar empresa desativada pede `{ somenteAtivas: false }` — mas nunca empresa
 * excluída: `deleted_at` é exclusão, não desativação.
 */
export async function empresasDisponiveis(ctx: ServiceCtx, opts: { somenteAtivas?: boolean } = {}): Promise<IdEmpresa[]> {
  const ativas = opts.somenteAtivas !== false;
  const r = await ctx.tx.query<{ id: string }>(
    `select id from erp.farms where organization_id=$1 and deleted_at is null${ativas ? " and is_active" : ""} order by code`,
    [ctx.orgId]);
  return r.rows.map((f) => f.id);
}

/**
 * Seleção da empresa de um LANÇAMENTO, já cruzada com a lista server-side.
 *
 * A empresa pedida pelo cliente é PEDIDO, nunca autorização: mesmo no modo "todas" ela só passa se estiver
 * entre as empresas da organização atual. É o único caminho aprovado para decidir a empresa de uma escrita.
 */
export async function selecionarEmpresaParaLancamento(
  ctx: ServiceCtx,
  pedida?: IdEmpresa | null,
  opts: { somenteAtivas?: boolean } = {}
): Promise<SelecaoEmpresa> {
  const disponiveis = await empresasDisponiveis(ctx, opts);
  return selecionarEmpresaDoLancamento(autorizacaoEmpresas(ctx), { disponiveis, pedida: pedida ?? null });
}
