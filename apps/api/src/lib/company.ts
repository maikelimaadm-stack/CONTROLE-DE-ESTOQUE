/**
 * PONTE EMPRESA ↔ FAZENDA (camada de compatibilidade — docs/MULTI-COMPANY-CONTRACT.md).
 *
 * O contrato de empresa vive em `@agro/platform` (puro, testável, neutro de nicho). Aqui ele é ligado ao
 * contexto de requisição ATUAL, no qual a empresa ainda é materializada por `erp.farms` / `member_farms` /
 * `X-Farm-Id`. Enquanto os dois nomes coexistem:
 *
 *   • a AUTORIDADE de autorização continua sendo `ctx.membership.farmIds` (nada aqui afrouxa o escopo);
 *   • `resolveCompanyScope` produz exatamente o mesmo resultado de `allowedFarms` — equivalência provada em
 *     packages/platform/test/company.test.ts e em test/integration/platform.test.ts;
 *   • quando a migração PRE-BASE2-03 trocar as colunas, só este arquivo muda.
 */
import { resolveCompanyScope, type CompanyAuthorization, type CompanyId, type ResolvedCompanyScope } from "@agro/platform";
import type { RequestContext } from "./context.js";

/** Autorização de empresas do usuário no formato do contrato (lista vazia = todas as empresas da organização). */
export const companyAuthorizationOf = (ctx: RequestContext): CompanyAuthorization => ({ authorized: ctx.membership.farmIds });

/** Empresa selecionada no contexto de trabalho (hoje o cabeçalho X-Farm-Id). Seleção, nunca autorização. */
export const selectedCompanyOf = (ctx: RequestContext): CompanyId | null => ctx.farmId;

/**
 * Escopo de empresas para leitura. `companyIds === null` = sem recorte (todas as empresas da organização);
 * o isolamento por organização continua vindo do `organization_id` + RLS.
 */
export function companyScope(ctx: RequestContext, requested?: readonly CompanyId[] | string | null): ResolvedCompanyScope {
  return resolveCompanyScope(companyAuthorizationOf(ctx), { requested: requested ?? null, selected: selectedCompanyOf(ctx) });
}
