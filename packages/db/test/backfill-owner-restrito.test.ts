import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createPool, type Db } from "../src/pool.js";
import { listMigrations, resetSchema } from "../src/migrate.js";
import { TEST_URL } from "./setup.js";

/**
 * PROPRIETÁRIO LEGADO RESTRITO (PRE-BASE2-02 §3-§5).
 *
 * No modelo antigo, `is_owner` dava todas as CAPACIDADES, mas o escopo de fazenda ainda podia estar restrito
 * por `erp.member_farms`. No modelo novo o proprietário enxerga todas as empresas — isso é regra de DESTINO.
 * Aplicá-la automaticamente sobre um proprietário restrito seria AMPLIAR autorização existente em silêncio.
 *
 * Por isso a 0011 PARA. O que este teste prova: a recusa acontece, é explicativa, é anterior a qualquer
 * escrita (nada de schema parcialmente migrado) e desaparece quando a situação é normalizada.
 */
let db: Db;
const ORG = "bbbbbbbb-0000-4000-8000-000000000001";
const EMPRESA_A = "bbbbbbbb-0000-4000-8000-00000000000a";
const DONO = "bbbbbbbb-0000-4000-8000-000000000010";

const migrations = listMigrations();
const ate0010 = migrations.filter((m) => m.name < "0011");
const zero11 = migrations.find((m) => m.name.startsWith("0011"))!;

async function prepararBase(comRestricaoNoDono: boolean) {
  await resetSchema(db);
  for (const m of ate0010) await db.query(m.sql);
  await db.query("insert into erp.organizations(id,name,slug) values ($1,'[TEST] Owner','ownerteste')", [ORG]);
  await db.query("insert into erp.farms(id,organization_id,code,name) values ($1,$2,1,'Empresa A')", [EMPRESA_A, ORG]);
  await db.query("insert into erp.users(id,email,name,password_hash) values ($1,'dono-restrito@t.local','Dono','x')", [DONO]);
  await db.query("insert into erp.organization_members(id,organization_id,user_id,is_owner,is_active) values ($1,$2,$1,true,true)", [DONO, ORG]);
  if (comRestricaoNoDono) await db.query("insert into erp.member_farms(member_id,farm_id) values ($1,$2)", [DONO, EMPRESA_A]);
}

beforeAll(async () => { db = createPool(TEST_URL, { max: 3 }); }, 60_000);
afterAll(async () => { await db.end(); });

describe("migration 0011 diante de proprietário legado restrito", () => {
  it("RECUSA a migração, com mensagem explicativa e sem deixar schema parcialmente migrado", async () => {
    await prepararBase(true);
    const c = await db.connect();
    let erro: Error | null = null;
    try {
      await c.query("begin");
      await c.query(zero11.sql);
      await c.query("commit");
    } catch (e) {
      erro = e as Error;
      await c.query("rollback");
    } finally {
      c.release();
    }
    expect(erro, "a migration precisa falhar deliberadamente").toBeTruthy();
    expect(erro!.message).toMatch(/propriet/i);
    expect(erro!.message).toMatch(/ampliaria|amplia/i);
    // atomicidade: nenhuma das tabelas novas ficou criada pela transação abortada
    const t = await db.query<{ n: string }>("select count(*) n from pg_tables where schemaname='erp' and tablename in ('membro_escopos_empresa','membro_empresas','modulos_escopo_empresa')");
    expect(Number(t.rows[0]!.n), "schema parcialmente migrado").toBe(0);
  }, 180_000);

  it("depois de normalizado (proprietário sem restrição), a mesma migration aplica e o dono fica total", async () => {
    await prepararBase(false);
    await db.query(zero11.sql);
    const modulos = (await db.query<{ chave: string }>("select chave from erp.modulos_escopo_empresa")).rows.map((x) => x.chave);
    expect(modulos.length).toBeGreaterThanOrEqual(10);
    for (const modulo of modulos) {
      const r = await db.query<{ ok: boolean }>("select erp.tem_acesso_empresa($1,$2,$3,$4) ok", [ORG, DONO, modulo, EMPRESA_A]);
      expect(r.rows[0]!.ok, modulo).toBe(true);
    }
  }, 180_000);
});
