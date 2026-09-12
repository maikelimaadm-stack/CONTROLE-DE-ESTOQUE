import type { Tx } from "@agro/db";

export interface AuthUser { id: string; email: string; name: string }
export interface Membership { orgId: string; orgName: string; roleId: string | null; isOwner: boolean; farmIds: string[] }
export interface RequestContext {
  user: AuthUser;
  orgId: string;
  farmId: string | null;
  membership: Membership;
  permissions: Set<string>;
  ip?: string;
}
export interface ServiceCtx extends RequestContext { tx: Tx }

export function hasPermission(ctx: RequestContext, key: string): boolean {
  return ctx.membership.isOwner || ctx.permissions.has(key);
}
export function farmAllowed(ctx: RequestContext, farmId: string | null | undefined): boolean {
  if (!farmId) return true;
  return ctx.membership.farmIds.length === 0 || ctx.membership.farmIds.includes(farmId);
}

/**
 * Escopo de fazendas do usuário em SQL (padrão de segurança para leituras): restringe às fazendas autorizadas
 * (membership.farmIds; vazio = todas as fazendas da organização) e, se houver, à fazenda selecionada (ctx.farmId).
 * Registro fora do escopo simplesmente não é visível (404 em GET por id, ausente em listas) — não expõe existência.
 * Uso: `where.push(...farmScope(ctx, "h", params))` ou `const w = farmScope(ctx, "h", params).map((c) => " and " + c).join("")`.
 */
export function farmScope(ctx: RequestContext, alias: string, params: unknown[]): string[] {
  const out: string[] = [];
  if (ctx.farmId) { params.push(ctx.farmId); out.push(`${alias}.farm_id=$${params.length}`); }
  if (ctx.membership.farmIds.length) { params.push(ctx.membership.farmIds); out.push(`${alias}.farm_id = any($${params.length}::uuid[])`); }
  return out;
}
/** Cláusula e parâmetros para "GET por id" dentro do escopo: `... where x.id=$1 and x.organization_id=$2 <sql>` com `params`. */
export function scopedById(ctx: RequestContext, alias: string, id: string): { sql: string; params: unknown[] } {
  const params: unknown[] = [id, ctx.orgId];
  return { sql: farmScope(ctx, alias, params).map((c) => " and " + c).join(""), params };
}
