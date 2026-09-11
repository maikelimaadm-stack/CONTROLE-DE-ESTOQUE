import pg from "pg";
const { Pool, types } = pg;
// numeric/decimal e bigint chegam como string (nunca float); date como "YYYY-MM-DD"
types.setTypeParser(1700, (v) => v);
types.setTypeParser(20, (v) => v);
types.setTypeParser(1082, (v) => v);

export type Db = pg.Pool;
export type Tx = pg.PoolClient;
export type Queryable = pg.Pool | pg.PoolClient;

export function createPool(connectionString: string, opts: { max?: number } = {}): Db {
  const pool = new Pool({ connectionString, max: opts.max ?? 10, ssl: /supabase\.co|railway|render/.test(connectionString) ? { rejectUnauthorized: false } : undefined });
  pool.on("error", (e) => console.error("pg pool error", e));
  return pool;
}

export interface TenantContext { orgId: string | null; userId: string | null }

/**
 * Executa fn dentro de uma transação com contexto de tenant (SET LOCAL app.org_id/app.user_id),
 * que alimenta as políticas RLS e a auditoria. Rollback automático em erro.
 */
export async function withTx<T>(db: Db, ctx: TenantContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const client = await db.connect();
  try {
    // begin + contexto de tenant numa única ida ao banco (os valores são uuids validados, nunca texto livre)
    const uuid = (v: string | null) => (v && /^[0-9a-f-]{36}$/i.test(v) ? v : "");
    await client.query(`begin; select set_config('app.org_id', '${uuid(ctx.orgId)}', true), set_config('app.user_id', '${uuid(ctx.userId)}', true)`);
    const out = await fn(client);
    await client.query("commit");
    return out;
  } catch (e) {
    try { await client.query("rollback"); } catch { /* ignore */ }
    throw e;
  } finally {
    client.release();
  }
}
