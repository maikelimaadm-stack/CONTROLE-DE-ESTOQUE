import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { freshDb } from "./setup.js";
import { withTx, type Db } from "../src/pool.js";
import type { DemoOrg } from "../src/seed.js";

let db: Db; let demo: DemoOrg;
beforeAll(async () => { ({ db, demo } = await freshDb()); });
afterAll(async () => { await db.end(); });

describe("migrations e seed", () => {
  it("cria o schema erp com tabelas e políticas RLS", async () => {
    const t = await db.query("select count(*)::int n from pg_tables where schemaname='erp'");
    expect(t.rows[0].n).toBeGreaterThan(150);
    const noRls = await db.query("select relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='erp' and c.relkind='r' and not c.relrowsecurity");
    expect(noRls.rows).toEqual([]);
  });
  it("seed demo cria organização, fazendas, produtos e permissões", async () => {
    const p = await db.query("select count(*)::int n from erp.products where organization_id=$1", [demo.orgId]);
    expect(p.rows[0].n).toBe(8);
    const perms = await db.query("select count(*)::int n from erp.permissions");
    expect(perms.rows[0].n).toBeGreaterThan(600);
    expect(demo.farmIds.length).toBe(2);
  });
});

describe("ledger de estoque (triggers)", () => {
  it("aplica custo médio e bloqueia saldo negativo", async () => {
    const prod = (await db.query("select id, default_warehouse_id from erp.products where organization_id=$1 order by code limit 1", [demo.orgId])).rows[0];
    const ins = (t: "in" | "out", q: string, c: string) => withTx(db, { orgId: demo.orgId, userId: demo.adminUserId }, (tx) => tx.query("insert into erp.stock_movements(organization_id,farm_id,warehouse_id,product_id,movement_type,direction,quantity,unit_cost,source_type,source_id,movement_date) values ($1,$2,$3,$4,$5,$6,$7,$8,'test',gen_random_uuid(),current_date) returning balance_after, avg_cost_after", [demo.orgId, demo.farmIds[0], prod.default_warehouse_id, prod.id, t === "in" ? "entry" : "requisition", t === "in" ? 1 : -1, q, c]));
    const a = await ins("in", "100", "10"); expect(a.rows[0].balance_after).toBe("100.0000");
    const b = await ins("in", "100", "20"); expect(b.rows[0].avg_cost_after).toBe("15.000000");
    const c = await ins("out", "50", "0"); expect(c.rows[0].balance_after).toBe("150.0000");
    await expect(ins("out", "151", "0")).rejects.toThrow(/INSUFFICIENT_STOCK/);
    const bal = await db.query("select quantity, average_cost, total_value from erp.stock_balances where product_id=$1", [prod.id]);
    expect(bal.rows[0]).toEqual({ quantity: "150.0000", average_cost: "15.000000", total_value: "2250.00" });
    await expect(db.query("delete from erp.stock_movements where product_id=$1", [prod.id])).rejects.toThrow(/LEDGER_IMMUTABLE/);
  });
});

describe("isolamento multiempresa (RLS)", () => {
  it("erp_app com contexto da org A não enxerga dados da org B", async () => {
    // cria uma segunda organização
    const orgB = (await db.query("insert into erp.organizations(name,slug) values ('[TEST] Org B','orgb') returning id")).rows[0].id;
    await db.query("insert into erp.harvests(organization_id,description,start_date,end_date) values ($1,'Safra B','2026-01-01','2026-12-31')", [orgB]);
    await db.query("do $$ begin if not exists (select 1 from pg_roles where rolname='erp_app_test') then create role erp_app_test login password 'erp_app_test' in role erp_app; end if; end $$;");
    const { createPool } = await import("../src/pool.js");
    const appDb = createPool(process.env.TEST_DATABASE_URL_APP ?? "postgresql://erp_app_test:erp_app_test@127.0.0.1:5433/agro_erp_test", { max: 2 });
    try {
      const seenByA = await withTx(appDb, { orgId: demo.orgId, userId: demo.adminUserId }, (tx) => tx.query("select description from erp.harvests"));
      expect(seenByA.rows.map((r) => r.description)).not.toContain("Safra B");
      expect(seenByA.rows.length).toBe(2);
      const seenByB = await withTx(appDb, { orgId: orgB, userId: null }, (tx) => tx.query("select description from erp.harvests"));
      expect(seenByB.rows.map((r) => r.description)).toEqual(["Safra B"]);
      // insert cruzado é bloqueado pela política WITH CHECK
      await expect(withTx(appDb, { orgId: demo.orgId, userId: demo.adminUserId }, (tx) => tx.query("insert into erp.harvests(organization_id,description,start_date,end_date) values ($1,'x','2026-01-01','2026-12-31')", [orgB]))).rejects.toThrow(/row-level security/);
      // tabela-filho: itens de um produto de outra org não são visíveis
      const prodB = (await db.query("select id from erp.products where organization_id=$1 limit 1", [demo.orgId])).rows[0].id;
      const pkgs = await withTx(appDb, { orgId: orgB, userId: null }, (tx) => tx.query("select * from erp.product_packages where product_id=$1", [prodB]));
      expect(pkgs.rows).toEqual([]);
    } finally { await appDb.end(); }
  });
});

describe("financeiro (triggers)", () => {
  it("atualiza status do título pelas baixas e bloqueia excesso", async () => {
    const r = await withTx(db, { orgId: demo.orgId, userId: demo.adminUserId }, async (tx) => {
      const t = await tx.query("insert into erp.financial_titles(organization_id,farm_id,code,direction,number,amount,emission_date,due_date,note) values ($1,$2,'T-TEST','payable','1',100,current_date,current_date,'teste') returning id", [demo.orgId, demo.farmIds[0]]);
      const acc = await tx.query("select id from erp.bank_accounts where organization_id=$1 limit 1", [demo.orgId]);
      await tx.query("insert into erp.title_settlements(organization_id,title_id,settlement_date,bank_account_id,amount,net_amount) values ($1,$2,current_date,$3,40,40)", [demo.orgId, t.rows[0].id, acc.rows[0].id]);
      const s1 = await tx.query("select status, paid_amount, balance from erp.financial_titles where id=$1", [t.rows[0].id]);
      await tx.query("insert into erp.title_settlements(organization_id,title_id,settlement_date,bank_account_id,amount,discount,net_amount) values ($1,$2,current_date,$3,50,10,50)", [demo.orgId, t.rows[0].id, acc.rows[0].id]);
      const s2 = await tx.query("select status, paid_amount, balance from erp.financial_titles where id=$1", [t.rows[0].id]);
      return { id: t.rows[0].id, acc: acc.rows[0].id, s1: s1.rows[0], s2: s2.rows[0] };
    });
    expect(r.s1).toEqual({ status: "partially_paid", paid_amount: "40.00", balance: "60.00" });
    expect(r.s2).toEqual({ status: "paid", paid_amount: "100.00", balance: "0.00" });
    await expect(withTx(db, { orgId: demo.orgId, userId: demo.adminUserId }, (tx) => tx.query("insert into erp.title_settlements(organization_id,title_id,settlement_date,bank_account_id,amount,net_amount) values ($1,$2,current_date,$3,1,1)", [demo.orgId, r.id, r.acc]))).rejects.toThrow(/PAYMENT_EXCEEDS_BALANCE/);
  });
  it("auditoria registra alterações com usuário", async () => {
    const logs = await db.query("select action, user_id from erp.audit_logs where organization_id=$1 and entity='financial_titles' order by id", [demo.orgId]);
    expect(logs.rows.length).toBeGreaterThan(0);
    expect(logs.rows[0].user_id).toBe(demo.adminUserId);
  });
});
