/**
 * PONTE ENTRE O CONTRATO DE EMPRESA E O ESCOPO LEGADO (docs/MULTI-COMPANY-CONTRACT.md).
 *
 * O contrato de empresa vive em `@erp/plataforma` (puro, testável, neutro de nicho). Aqui ele é ligado ao
 * contexto de requisição ATUAL, no qual a Empresa ainda é materializada pela infraestrutura herdada do
 * primeiro segmento atendido (tabela `farms`, vínculo `member_farms`, cabeçalho `X-Farm-Id`).
 *
 * Este arquivo é o ÚNICO ponto onde os dois vocabulários se encontram — é ele que muda em PRE-BASE2-03.
 * Enquanto isso:
 *   • a AUTORIDADE de autorização continua sendo `ctx.membership.farmIds` (nada aqui afrouxa o escopo);
 *   • `resolverEscopoEmpresa` produz exatamente o mesmo resultado de `allowedFarms`, com equivalência
 *     testada em packages/plataforma/test/empresa.test.ts e na matriz cross-empresa de integração.
 */
import { resolverEscopoEmpresa, type AutorizacaoEmpresas, type EscopoEmpresaResolvido, type IdEmpresa } from "@erp/plataforma";
import type { RequestContext } from "./context.js";

/** Autorização de empresas do usuário no formato do contrato (lista vazia = todas as empresas da organização). */
export const autorizacaoEmpresas = (ctx: RequestContext): AutorizacaoEmpresas => ({ autorizadas: ctx.membership.farmIds });

/** Empresa selecionada no contexto de trabalho. Seleção, nunca autorização. */
export const empresaSelecionada = (ctx: RequestContext): IdEmpresa | null => ctx.farmId;

/**
 * Escopo de empresas para leitura. `empresaIds === null` = sem recorte (todas as empresas da organização);
 * o isolamento por organização continua vindo do tenant + RLS.
 */
export function escopoEmpresa(ctx: RequestContext, pedidas?: readonly IdEmpresa[] | string | null): EscopoEmpresaResolvido {
  return resolverEscopoEmpresa(autorizacaoEmpresas(ctx), { pedidas: pedidas ?? null, selecionada: empresaSelecionada(ctx) });
}
