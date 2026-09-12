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
  empresasSelecionadas, resolverEscopoEmpresa, TODAS_AS_EMPRESAS,
  type AutorizacaoEmpresas, type EscopoEmpresaResolvido, type IdEmpresa
} from "@erp/plataforma";
import type { RequestContext } from "./context.js";

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
