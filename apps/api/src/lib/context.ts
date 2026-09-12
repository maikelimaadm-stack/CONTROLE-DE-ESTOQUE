import type { Tx } from "@agro/db";
import { DomainError } from "@agro/shared";

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
 * Escopo de fazendas em SQL — padrão oficial de LEITURA de qualquer recurso com farm_id.
 * Restringe às fazendas autorizadas (membership.farmIds; vazio = todas as fazendas da organização) E, se houver,
 * à fazenda selecionada (ctx.farmId, cabeçalho X-Farm-Id — seleção de trabalho, nunca a autorização primária).
 * `col` é um alias de tabela (→ `alias.farm_id`) ou uma expressão de coluna terminada em `farm_id`.
 * `nullable`: registro sem fazenda (farm_id null) é da organização inteira e continua visível. `ignoreSelected`: o chamador já
 * aplicou um filtro explícito de fazenda (?farm_id=) — só a autorização (membership) é acrescentada.
 * Registro fora do escopo simplesmente não é visível (404 em GET por id, ausente em listas) — não expõe existência.
 */
export function farmScope(ctx: RequestContext, col: string, params: unknown[], opts: { nullable?: boolean; ignoreSelected?: boolean } = {}): string[] {
  const c = col.endsWith("farm_id") ? col : `${col}.farm_id`; const out: string[] = [];
  const wrap = (expr: string) => (opts.nullable ? `(${c} is null or ${expr})` : expr);
  if (ctx.farmId && !opts.ignoreSelected) { params.push(ctx.farmId); out.push(wrap(`${c}=$${params.length}`)); }
  if (ctx.membership.farmIds.length) { params.push(ctx.membership.farmIds); out.push(wrap(`${c} = any($${params.length}::uuid[])`)); }
  return out;
}
/** Mesmo escopo como texto " and …" para concatenar em SQL pronto (params são acrescentados). */
export function farmScopeSql(ctx: RequestContext, col: string, params: unknown[], opts: { nullable?: boolean; ignoreSelected?: boolean } = {}): string {
  return farmScope(ctx, col, params, opts).map((c) => " and " + c).join("");
}
/** Cláusula e parâmetros para "GET por id" dentro do escopo: `... where x.id=$1 and x.organization_id=$2 <sql>` com `params`. */
export function scopedById(ctx: RequestContext, col: string, id: string, opts: { nullable?: boolean } = {}): { sql: string; params: unknown[] } {
  const params: unknown[] = [id, ctx.orgId];
  return { sql: farmScopeSql(ctx, col, params, opts), params };
}
/**
 * Conjunto de fazendas para consultas no padrão `($n::uuid[] is null or col = any($n))` (dashboards/agregados):
 * null = sem restrição (todas as fazendas da organização); senão a interseção entre o pedido (`requested` ou a fazenda
 * selecionada) e as fazendas autorizadas — pedido fora do escopo resulta em lista vazia (nenhuma linha), nunca em "todas".
 */
export function allowedFarms(ctx: RequestContext, requested?: string[] | string | null): string[] | null {
  const req = requested == null ? [] : Array.isArray(requested) ? requested : requested.split(",");
  const asked = req.filter(Boolean).length ? req.filter(Boolean) : ctx.farmId ? [ctx.farmId] : null;
  const allowed = ctx.membership.farmIds;
  if (!asked) return allowed.length ? allowed : null;
  return allowed.length ? asked.filter((f) => allowed.includes(f)) : asked;
}
/** Registro carregado para escrita: fora do escopo de fazendas do usuário → NOT_FOUND (mesma convenção das leituras). */
export function assertFarmVisible(ctx: RequestContext, farmId: string | null | undefined, what = "Registro"): void {
  if (!farmAllowed(ctx, farmId)) throw new DomainError("NOT_FOUND", `${what} não encontrado`);
}
