import type { FastifyInstance, FastifyRequest } from "fastify";
import { withTx, type Tx } from "@agro/db";
import { createHash } from "node:crypto";
import { DomainError } from "@agro/shared";
import { hasPermission, type RequestContext, type ServiceCtx } from "./context.js";
import { denied } from "./errors.js";

/** Executa um serviço dentro de transação com contexto de tenant; exige permissão quando informada. */
export async function runService<T>(app: FastifyInstance, req: FastifyRequest, permission: string | null, fn: (ctx: ServiceCtx) => Promise<T>): Promise<T> {
  const ctx = app.requireCtx(req);
  if (permission && !hasPermission(ctx, permission)) throw denied(permission);
  return withTx(app.db, { orgId: ctx.orgId, userId: ctx.user.id }, (tx) => fn({ ...ctx, tx }));
}

export function requirePermission(ctx: RequestContext, permission: string) {
  if (!hasPermission(ctx, permission)) throw denied(permission);
}

/**
 * Idempotência: cabeçalho Idempotency-Key. A primeira execução grava a resposta; reenvios com a mesma chave e
 * mesmo corpo devolvem a resposta gravada sem executar novamente. Chave igual com corpo diferente = CONFLICT.
 */
export async function idempotent<T>(tx: Tx, orgId: string, key: string | undefined, body: unknown, fn: () => Promise<T>): Promise<{ replayed: boolean; result: T }> {
  if (!key) return { replayed: false, result: await fn() };
  const hash = createHash("sha256").update(JSON.stringify(body ?? null)).digest("hex");
  const lock = await tx.query("insert into erp.idempotency_keys(organization_id,key,request_hash) values ($1,$2,$3) on conflict (organization_id,key) do nothing returning key", [orgId, key, hash]);
  if (lock.rowCount === 0) {
    const prev = await tx.query<{ request_hash: string; response_body: T | null }>("select request_hash, response_body from erp.idempotency_keys where organization_id=$1 and key=$2 for update", [orgId, key]);
    const p = prev.rows[0]!;
    if (p.request_hash !== hash) throw new DomainError("CONFLICT", "Idempotency-Key reutilizada com corpo diferente");
    if (p.response_body === null) throw new DomainError("CONCURRENCY_CONFLICT", "Operação em andamento para esta chave");
    return { replayed: true, result: p.response_body };
  }
  const result = await fn();
  await tx.query("update erp.idempotency_keys set response_status=200, response_body=$3 where organization_id=$1 and key=$2", [orgId, key, JSON.stringify(result)]);
  return { replayed: false, result };
}

export async function nextCode(tx: Tx, orgId: string, entity: string, width = 4): Promise<string> {
  const r = await tx.query<{ n: string }>("select erp.next_code($1,$2) as n", [orgId, entity]);
  return String(r.rows[0]!.n).padStart(width, "0");
}

export async function audit(tx: Tx, ctx: RequestContext, entity: string, entityId: string, action: string, metadata?: unknown) {
  await tx.query("insert into erp.audit_logs(organization_id,user_id,entity,entity_id,action,metadata,ip) values ($1,$2,$3,$4,$5,$6,$7)", [ctx.orgId, ctx.user.id, entity, entityId, action, metadata ? JSON.stringify(metadata) : null, ctx.ip ?? null]);
}

export async function assertPeriodOpen(tx: Tx, orgId: string, farmId: string | null, date: string) {
  await tx.query("select erp.assert_period_open($1,$2,$3)", [orgId, farmId, date]);
}
