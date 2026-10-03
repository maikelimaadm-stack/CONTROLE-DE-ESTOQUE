import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createPool, type Db, type Tx } from "../src/pool.js";
import { listMigrations, resetSchema } from "../src/migrate.js";
import { seedReference, seedDemo, type DemoOrg } from "../src/seed.js";
import { TEST_URL } from "./setup.js";
import { VALORES_TIPO_DE_USO_DA_AREA } from "@agro/domain";

/**
 * CADASTRO-AREAS-01 (0050, decisão 290) — invariantes de banco.
 * T1 usable > total recusado · T2 módulo em área ambiental · T3 FK composta
 * retiro/módulo de outra empresa · T4 CHECK = domínio · T6 backfill · T7 reversas
 * · T9/T10 gatilho NULL→area_ha · T11 CHECK no UPDATE.
 */
let db: Db;
let demo: DemoOrg;
const ALVO = "0050_cadastro_de_areas.sql";

async function id1(sql: string, p: unknown[] = []) {
  return (await db.query<{ id: string }>(sql, p)).rows[0]!.id;
}

async function aplicar(): Promise<void> {
  const m = listMigrations().find((x) => x.name === ALVO);
  expect(m, `${ALVO} precisa existir`).toBeTruthy();
  const c = await db.connect();
  try {
    await c.query("begin");
    await c.query(m!.sql);
    await c.query("insert into public.erp_migrations(name) values ($1)", [m!.name]);
    await c.query("commit");
  } catch (e) {
    await c.query("rollback");
    throw e;
  } finally {
    c.release();
  }
}

async function recusaDa0050(antes?: (c: Tx) => Promise<unknown>): Promise<string> {
  const m = listMigrations().find((x) => x.name === ALVO)!;
  const c = await db.connect();
  try {
    await c.query("begin");
    if (antes) await antes(c);
    await c.query(m.sql);
  } catch (e) {
    return (e as Error).message;
  } finally {
    await c.query("rollback").catch(() => {});
    c.release();
  }
  throw new Error("esperava a 0050 recusar, e ela aplicou");
}

async function erroDe(p: Promise<unknown>): Promise<{ code?: string; constraint?: string; message: string }> {
  try {
    await p;
  } catch (e) {
    return e as { code?: string; constraint?: string; message: string };
  }
  throw new Error("esperava recusa, e o banco aceitou");
}

beforeAll(async () => {
  db = createPool(TEST_URL, { max: 4 });
  await resetSchema(db);
  await db.query("create table if not exists public.erp_migrations (name text primary key, applied_at timestamptz not null default now())");
  // Aplica tudo até a 0041 (sem a 0050).
  for (const m of listMigrations().filter((x) => x.name < ALVO)) {
    await db.query(m.sql);
    await db.query("insert into public.erp_migrations(name) values ($1)", [m.name]);
  }
  await seedReference(db, () => {});
  demo = await seedDemo(db, {}, () => {});
}, 300_000);

afterAll(async () => {
  await db.end();
});

describe("CADASTRO-AREAS-01 — 0050", () => {
  it("T6+premissa: com área existente antes da 0050, backfill preenche usable/land_use/status/tenure", async () => {
    const empresa = demo.empresaIds[0]!;
    const areaAntes = await id1(
      `insert into erp.areas (organization_id, empresa_id, code, name, area_ha, is_active)
       values ($1,$2,'PRE50','Pasto pré-0050',12.5,true) returning id`,
      [demo.orgId, empresa]
    );
    const areaInativa = await id1(
      `insert into erp.areas (organization_id, empresa_id, code, name, area_ha, is_active)
       values ($1,$2,'PRE42I','Pasto inativo',3,false) returning id`,
      [demo.orgId, empresa]
    );
    expect((await db.query("select 1 from information_schema.columns where table_schema='erp' and table_name='areas' and column_name='land_use'")).rowCount).toBe(0);

    await aplicar();

    const a = (await db.query<{ usable_area_ha: string; land_use: string; status: string; tenure: string }>(
      "select usable_area_ha::text, land_use, status, tenure from erp.areas where id=$1",
      [areaAntes]
    )).rows[0]!;
    expect(a).toEqual({ usable_area_ha: "12.5000", land_use: "pastagem", status: "ativa", tenure: "propria" });
    const i = (await db.query<{ status: string }>("select status from erp.areas where id=$1", [areaInativa])).rows[0]!;
    expect(i.status).toBe("inativa");
  }, 120_000);

  it("T4: CHECK land_use do banco = TIPOS_DE_USO_DA_AREA do domínio", async () => {
    const def = (await db.query<{ def: string }>(
      "select pg_get_constraintdef(oid) def from pg_constraint where conrelid='erp.areas'::regclass and conname='chk_areas_land_use'"
    )).rows[0]!.def;
    const doBanco = [...def.matchAll(/'([^']*)'/g)].map((m) => m[1]!).sort();
    expect(doBanco).toEqual([...VALORES_TIPO_DE_USO_DA_AREA].sort());
  });

  it("T1: usable_area_ha > area_ha é recusado pelo banco", async () => {
    const e = await erroDe(db.query(
      `insert into erp.areas (organization_id, empresa_id, code, name, area_ha, usable_area_ha, land_use, status, tenure)
       values ($1,$2,'T1','x',10,10.0001,'pastagem','ativa','propria')`,
      [demo.orgId, demo.empresaIds[0]!]
    ));
    expect(e.constraint).toBe("chk_areas_usable_area");
  });

  it("T2: grazing_module_id com land_use ambiental é recusado", async () => {
    const empresa = demo.empresaIds[0]!;
    const fodder = await id1(
      "insert into erp.fodders (organization_id, description) values ($1,'F T2') returning id",
      [demo.orgId]
    );
    const mod = await id1(
      `insert into erp.grazing_modules (organization_id, empresa_id, code, module_date, description, fodder_id)
       values ($1,$2,'GM-T2',current_date,'Mod T2',$3) returning id`,
      [demo.orgId, empresa, fodder]
    );
    const e = await erroDe(db.query(
      `insert into erp.areas (organization_id, empresa_id, code, name, area_ha, usable_area_ha, land_use, status, tenure, grazing_module_id)
       values ($1,$2,'T2','Reserva',5,5,'reserva_legal','ativa','propria',$3)`,
      [demo.orgId, empresa, mod]
    ));
    expect(e.constraint).toBe("chk_areas_modulo_so_pecuario");
  });

  it("T3: área da empresa A não aceita retiro nem módulo da empresa B", async () => {
    const a = demo.empresaIds[0]!;
    const b = demo.empresaIds[1]!;
    const retiroB = await id1(
      `insert into erp.retiros (organization_id, empresa_id, code, name) values ($1,$2,'RB','Retiro B') returning id`,
      [demo.orgId, b]
    );
    const fodder = await id1(
      "insert into erp.fodders (organization_id, description) values ($1,'F T3') returning id",
      [demo.orgId]
    );
    const modB = await id1(
      `insert into erp.grazing_modules (organization_id, empresa_id, code, module_date, description, fodder_id)
       values ($1,$2,'GM-B',current_date,'Mod B',$3) returning id`,
      [demo.orgId, b, fodder]
    );
    const e1 = await erroDe(db.query(
      `insert into erp.areas (organization_id, empresa_id, code, name, area_ha, usable_area_ha, land_use, status, tenure, retiro_id)
       values ($1,$2,'T3R','x',1,1,'pastagem','ativa','propria',$3)`,
      [demo.orgId, a, retiroB]
    ));
    expect(e1.code).toBe("23503");
    const e2 = await erroDe(db.query(
      `insert into erp.areas (organization_id, empresa_id, code, name, area_ha, usable_area_ha, land_use, status, tenure, grazing_module_id)
       values ($1,$2,'T3M','x',1,1,'pastagem','ativa','propria',$3)`,
      [demo.orgId, a, modB]
    ));
    expect(e2.code).toBe("23503");
  });

  it("T7 reversa: trava ocupada e pré-condição 'já aplicada' recusam sem efeito", async () => {
    // Banco já tem a 0050 no ledger deste describe — reaplicar na tx desfeita.
    const msgJa = await recusaDa0050();
    expect(msgJa).toMatch(/CADASTRO-AREAS-01: erp\.retiros ja existe/);

    // Trava (2026,84) ocupada por outra sessão.
    const holder = await db.connect();
    try {
      await holder.query("begin");
      await holder.query("select pg_advisory_xact_lock(2026, 84)");
      const msgTrava = await recusaDa0050();
      expect(msgTrava).toMatch(/trava desta migration \(2026,84\)/);
      await holder.query("rollback");
    } finally {
      holder.release();
    }
  });

  it("T9: insert sem usable_area_ha grava usable_area_ha = area_ha", async () => {
    const id = await id1(
      `insert into erp.areas (organization_id, empresa_id, code, name, area_ha, land_use, status, tenure)
       values ($1,$2,'T9','Area T9',18.25,'pastagem','ativa','propria') returning id`,
      [demo.orgId, demo.empresaIds[0]!]
    );
    const row = (await db.query<{ usable_area_ha: string; area_ha: string }>(
      "select usable_area_ha::text, area_ha::text from erp.areas where id=$1", [id]
    )).rows[0]!;
    expect(row.usable_area_ha).toBe(row.area_ha);
    expect(row.usable_area_ha).toBe("18.2500");
    expect(row.usable_area_ha).not.toBe("0");
    expect(row.usable_area_ha).not.toBeNull();
  });

  it("T10: UPDATE usable_area_ha = NULL volta a area_ha", async () => {
    const id = await id1(
      `insert into erp.areas (organization_id, empresa_id, code, name, area_ha, usable_area_ha, land_use, status, tenure)
       values ($1,$2,'T10','Area T10',20,15,'pastagem','ativa','propria') returning id`,
      [demo.orgId, demo.empresaIds[0]!]
    );
    await db.query("update erp.areas set usable_area_ha = null where id=$1", [id]);
    const row = (await db.query<{ usable_area_ha: string; area_ha: string }>(
      "select usable_area_ha::text, area_ha::text from erp.areas where id=$1", [id]
    )).rows[0]!;
    expect(row.usable_area_ha).toBe(row.area_ha);
    expect(row.usable_area_ha).toBe("20.0000");
  });

  it("T11: UPDATE usable_area_ha > area_ha continua recusado pela CHECK", async () => {
    const id = await id1(
      `insert into erp.areas (organization_id, empresa_id, code, name, area_ha, usable_area_ha, land_use, status, tenure)
       values ($1,$2,'T11','Area T11',10,8,'pastagem','ativa','propria') returning id`,
      [demo.orgId, demo.empresaIds[0]!]
    );
    const e = await erroDe(db.query("update erp.areas set usable_area_ha = 10.0001 where id=$1", [id]));
    expect(e.constraint).toBe("chk_areas_usable_area");
  });
});
