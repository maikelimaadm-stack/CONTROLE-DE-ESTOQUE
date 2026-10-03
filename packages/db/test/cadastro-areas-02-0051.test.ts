import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createPool, type Db } from "../src/pool.js";
import { listMigrations, resetSchema } from "../src/migrate.js";
import { seedReference, seedDemo, type DemoOrg } from "../src/seed.js";
import { TEST_URL } from "./setup.js";

/**
 * CADASTRO-AREAS-02 (0051, decisão 291) — unificação mapa × areas.
 * T1 insert em areas sem geometria ok · T2 geometria inválida recusada ·
 * T3 migração mapa_areas → areas + soft-delete · T4 insert sem usable usa gatilho da 0050.
 */
let db: Db;
let demo: DemoOrg;
const ALVO = "0051_areas_mapa_unificado.sql";

const POLIGONO = {
  type: "Polygon",
  coordinates: [[[-50, -15], [-50, -14.9], [-49.9, -14.9], [-49.9, -15], [-50, -15]]]
};

async function id1(sql: string, p: unknown[] = []) {
  return (await db.query<{ id: string }>(sql, p)).rows[0]!.id;
}

async function erroDe(p: Promise<unknown>): Promise<{ code?: string; constraint?: string; message: string }> {
  try {
    await p;
    throw new Error("esperava recusa");
  } catch (e) {
    const err = e as { code?: string; constraint?: string; message: string };
    return { code: err.code, constraint: err.constraint, message: err.message };
  }
}

beforeAll(async () => {
  db = createPool(TEST_URL, { max: 4 });
  await resetSchema(db);
  await db.query("create table if not exists public.erp_migrations (name text primary key, applied_at timestamptz not null default now())");
  for (const m of listMigrations().filter((x) => x.name <= ALVO)) {
    await db.query(m.sql);
    await db.query("insert into public.erp_migrations(name) values ($1) on conflict do nothing", [m.name]);
  }
  await seedReference(db, () => {});
  demo = await seedDemo(db, {}, () => {});
}, 300_000);

afterAll(async () => {
  await db.end();
});

describe("CADASTRO-AREAS-02 — 0051", () => {
  it("T1: insert em areas sem geometria continua válido", async () => {
    const id = await id1(
      `insert into erp.areas (organization_id, empresa_id, code, name, area_ha, usable_area_ha, land_use, status, tenure)
       values ($1,$2,'U01','Sem mapa',10,10,'pastagem','ativa','propria') returning id`,
      [demo.orgId, demo.empresaIds[0]]
    );
    const row = (await db.query<{ geometria: unknown }>("select geometria from erp.areas where id=$1", [id])).rows[0]!;
    expect(row.geometria).toBeNull();
  });

  it("T2: geometria inválida é recusada", async () => {
    const e = await erroDe(db.query(
      `insert into erp.areas (organization_id, empresa_id, code, name, area_ha, usable_area_ha, land_use, status, tenure, geometria)
       values ($1,$2,'U02','Ruim',1,1,'pastagem','ativa','propria',$3)`,
      [demo.orgId, demo.empresaIds[0], JSON.stringify({ type: "Point", coordinates: [0, 0] })]
    ));
    expect(e.message).toMatch(/Geometria da área inválida/);
  });

  it("T3: Polygon válido grava e espelha em kml_geometry", async () => {
    const id = await id1(
      `insert into erp.areas (organization_id, empresa_id, code, name, area_ha, usable_area_ha, land_use, status, tenure, geometria, color)
       values ($1,$2,'U03','Com mapa',12,11,'lavoura','ativa','propria',$3,'#92ca25') returning id`,
      [demo.orgId, demo.empresaIds[0], JSON.stringify(POLIGONO)]
    );
    const row = (await db.query<{ geometria: { type: string }; kml_geometry: { type: string }; color: string }>(
      "select geometria, kml_geometry, color from erp.areas where id=$1", [id]
    )).rows[0]!;
    expect(row.geometria.type).toBe("Polygon");
    expect(row.kml_geometry.type).toBe("Polygon");
    expect(row.color).toBe("#92ca25");
  });

  it("T4: migration deixa mapa_areas sem linhas vivas (acervo migrado)", async () => {
    const vivas = (await db.query<{ n: string }>("select count(*)::text n from erp.mapa_areas where deleted_at is null")).rows[0]!.n;
    expect(vivas).toBe("0");
    const col = (await db.query(
      `select 1 from information_schema.columns where table_schema='erp' and table_name='areas' and column_name='geometria'`
    )).rowCount;
    expect(col).toBe(1);
  });
});
