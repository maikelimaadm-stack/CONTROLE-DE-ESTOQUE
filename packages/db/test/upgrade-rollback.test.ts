import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createPool, type Db } from "../src/pool.js";
import { listMigrations, resetSchema } from "../src/migrate.js";
import { TEST_URL } from "./setup.js";

/**
 * A JANELA DE SUSPENSÃO NÃO PODE SOBREVIVER A UMA FALHA (PRE-BASE2-04 — hotfix da 0014).
 *
 * A 0014 suspende `trg_stock_movement_immutable` em volta de UM update estrutural. A garantia de que isso é
 * seguro não é teórica: depende de o runner envolver a migration inteira em `begin`/`commit`, e de
 * `alter table … disable trigger` ser transacional no PostgreSQL. Se qualquer guarda POSTERIOR da 0014
 * abortar, o ledger tem de voltar protegido — senão uma migration interrompida deixaria produção com o
 * ledger editável enquanto a API antiga ainda serve tráfego.
 *
 * Este teste injeta uma falha DEPOIS do backfill estrutural (numa cópia da 0014 em memória; o arquivo real
 * não é tocado) e prova o estado após o rollback.
 */
let db: Db;
const ORG = "dddddddd-0000-4000-8000-000000000001";
const FAZ = "dddddddd-0000-4000-8000-00000000000a";
const USER = "dddddddd-0000-4000-8000-000000000100";

beforeAll(async () => {
  db = createPool(TEST_URL, { max: 4 });
  await resetSchema(db);
  await db.query("create table if not exists public.erp_migrations (name text primary key, applied_at timestamptz not null default now())");
  for (const m of listMigrations().filter((x) => x.name < "0014")) {
    await db.query(m.sql);
    await db.query("insert into public.erp_migrations(name) values ($1)", [m.name]);
  }
  await db.query("insert into erp.organizations(id,name,slug) values ($1,'[TEST] Rollback','rollback')", [ORG]);
  await db.query("insert into erp.farms(id,organization_id,code,name) values ($1,$2,1,'Fazenda')", [FAZ, ORG]);
  await db.query("insert into erp.users(id,email,name,password_hash) values ($1,'rollback@t.local','Rollback','x')", [USER]);
  await db.query("insert into erp.organization_members(id,organization_id,user_id,is_owner) values ($1,$2,$1,true)", [USER, ORG]);
  const um = (await db.query<{ id: string }>("insert into erp.measurement_units(symbol,name) values ('KG','Quilograma') returning id")).rows[0]!;
  const g = (await db.query<{ id: string }>("insert into erp.product_groups(organization_id,name) values ($1,'G') returning id", [ORG])).rows[0]!;
  const c = (await db.query<{ id: string }>("insert into erp.product_categories(organization_id,group_id,name) values ($1,$2,'C') returning id", [ORG, g.id])).rows[0]!;
  const k = (await db.query<{ id: string }>("insert into erp.product_kinds(organization_id,category_id,name) values ($1,$2,'K') returning id", [ORG, c.id])).rows[0]!;
  const fc = (await db.query<{ id: string }>("insert into erp.financial_categories(organization_id,code,name,nature) values ($1,'2.01','F','expense') returning id", [ORG])).rows[0]!;
  const p = (await db.query<{ id: string }>(
    "insert into erp.products(organization_id,code,description,measurement_id,group_id,category_id,kind_id,control_stock,financial_category_id) values ($1,'00001','Produto',$2,$3,$4,$5,true,$6) returning id",
    [ORG, um.id, g.id, c.id, k.id, fc.id])).rows[0]!;
  const w = (await db.query<{ id: string }>("insert into erp.warehouses(organization_id,farm_id,initials,description) values ($1,$2,'ALM','Almox') returning id", [ORG, FAZ])).rows[0]!;
  for (let i = 0; i < 5; i++) {
    await db.query(
      `insert into erp.stock_movements(organization_id,farm_id,warehouse_id,product_id,movement_type,direction,quantity,unit_cost,source_type,source_id,movement_date,created_by)
       values ($1,$2,$3,$4,'entry',1,'10','2','input_entry',gen_random_uuid(),current_date,$5)`, [ORG, FAZ, w.id, p.id, USER]);
  }
}, 240_000);
afterAll(async () => { await db.end(); });

describe("falha DEPOIS da janela estrutural", () => {
  it("o rollback devolve o ledger protegido e não registra a 0014", async () => {
    const zero14 = listMigrations().find((m) => m.name.startsWith("0014"))!;
    // Falha CONTROLADA injetada ao final da migration, em cópia — o arquivo em disco não é alterado.
    const comFalha = `${zero14.sql}\ndo $$ begin raise exception 'FALHA_CONTROLADA_DE_TESTE'; end $$;`;
    const c = await db.connect();
    let erro = "";
    try {
      await c.query("begin");
      await c.query(comFalha);
      await c.query("insert into public.erp_migrations(name) values ($1)", [zero14.name]);
      await c.query("commit");
    } catch (e) { await c.query("rollback"); erro = (e as Error).message; } finally { c.release(); }
    expect(erro, "a migration precisa ter abortado — senão o teste não prova rollback").toMatch(/FALHA_CONTROLADA_DE_TESTE/);

    const r = await db.query<{ migr: string; col: boolean; tg: string | null }>(
      `select (select count(*)::text from public.erp_migrations where name like '0014%') migr,
              exists(select 1 from information_schema.columns where table_schema='erp' and table_name='stock_movements' and column_name='empresa_id') col,
              (select tgenabled from pg_trigger where tgrelid='erp.stock_movements'::regclass and tgname='trg_stock_movement_immutable') tg`);
    expect(Number(r.rows[0]!.migr), "0014 não pode constar como aplicada").toBe(0);
    expect(r.rows[0]!.col, "a coluna da 0014 não pode ter sobrado").toBe(false);
    expect(r.rows[0]!.tg, "o gatilho tem de voltar HABILITADO ('O')").toBe("O");
  }, 120_000);

  it("e o ledger continua recusando UPDATE e DELETE depois do rollback", async () => {
    await expect(db.query("update erp.stock_movements set quantity = quantity + 1")).rejects.toThrow(/LEDGER_IMMUTABLE/);
    await expect(db.query("delete from erp.stock_movements")).rejects.toThrow(/LEDGER_IMMUTABLE/);
  });

  it("o acervo continua íntegro (nada foi perdido pela tentativa interrompida)", async () => {
    const r = await db.query<{ n: string }>("select count(*)::text n from erp.stock_movements");
    expect(Number(r.rows[0]!.n)).toBe(5);
  });
});
