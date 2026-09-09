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
