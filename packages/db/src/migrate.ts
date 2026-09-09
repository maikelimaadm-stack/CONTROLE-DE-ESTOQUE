import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Db } from "./pool.js";

const here = path.dirname(fileURLToPath(import.meta.url));
export const MIGRATIONS_DIR = path.resolve(here, "../../../supabase/migrations");

export function listMigrations(): { name: string; sql: string }[] {
  return fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort().map((name) => ({ name, sql: fs.readFileSync(path.join(MIGRATIONS_DIR, name), "utf8") }));
}

/** Runner idempotente: registra em erp_migrations (schema public) as migrations aplicadas. */
export async function migrate(db: Db, log: (m: string) => void = console.log): Promise<string[]> {
  await db.query("create table if not exists public.erp_migrations (name text primary key, applied_at timestamptz not null default now())");
  const applied = new Set((await db.query<{ name: string }>("select name from public.erp_migrations")).rows.map((r) => r.name));
  const done: string[] = [];
  for (const m of listMigrations()) {
    if (applied.has(m.name)) continue;
    const c = await db.connect();
    try {
      await c.query("begin");
      await c.query(m.sql);
      await c.query("insert into public.erp_migrations(name) values ($1)", [m.name]);
      await c.query("commit");
      log(`applied ${m.name}`);
      done.push(m.name);
    } catch (e) {
      await c.query("rollback");
      throw new Error(`migration ${m.name} failed: ${(e as Error).message}`);
    } finally { c.release(); }
  }
  return done;
}

export async function resetSchema(db: Db) {
  await db.query("drop schema if exists erp cascade; drop table if exists public.erp_migrations;");
}
