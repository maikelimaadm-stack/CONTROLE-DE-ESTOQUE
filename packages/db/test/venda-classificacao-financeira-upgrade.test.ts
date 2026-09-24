import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createPool, type Db } from "../src/pool.js";
import { listMigrations, MIGRATIONS_DIR, resetSchema } from "../src/migrate.js";
import { seedReference, seedDemo, type DemoOrg } from "../src/seed.js";
import { TEST_URL } from "./setup.js";

/**
 * A1-D3 — A 0024 SOBRE UM BANCO PARADO NA 0023 (VENDAS-A1).
 *
 * Produção parte da 0023 com vendas de verdade (abertas e confirmadas). A promessa da 0024 é ser ADITIVA:
 * nenhuma linha muda, as colunas novas nascem nulas, e a migration só se aplica sozinha — uma segunda
 * aplicação concorrente morre na trava (2026,58) com a recusa NOMEADA, sem tocar em nada.
 *
 * O banco na 0023 é montado com o runner recarregado sobre um diretório que só tem as migrations anteriores
 * (mesmo mecanismo de `hotfix-0019-ajuda.ts`); a 0024 é aplicada como o runner aplica: uma transação, o
 * arquivo inteiro, a linha no ledger só se tudo passar.
 */
const ALVO = "0024_venda_classificacao_financeira.sql";
let db: Db; let demo: DemoOrg;

async function subirAte0023(): Promise<void> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "a1-ate23-"));
  const anterior = process.env.MIGRATIONS_DIR;
  try {
    const anteriores = listMigrations().map((m) => m.name).filter((n) => n < ALVO);
    expect(anteriores.at(-1), "a última antes da 0024 é a guarda da 0023").toBe("0023_venda_execucao_configurada_guarda.sql");
    for (const n of anteriores) fs.copyFileSync(path.join(MIGRATIONS_DIR, n), path.join(dir, n));
    process.env.MIGRATIONS_DIR = dir;
    vi.resetModules();
    const ate23 = await import("../src/migrate.js");
    expect(ate23.listMigrations().map((m) => m.name)).not.toContain(ALVO);
    await ate23.migrate(db, () => {});
  } finally {
    if (anterior === undefined) delete process.env.MIGRATIONS_DIR; else process.env.MIGRATIONS_DIR = anterior;
    vi.resetModules();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function aplicar0024(): Promise<{ ok: true } | { ok: false; erro: string }> {
  const c = await db.connect();
  try {
    await c.query("begin");
    await c.query(fs.readFileSync(path.join(MIGRATIONS_DIR, ALVO), "utf8"));
    await c.query("insert into public.erp_migrations(name) values ($1)", [ALVO]);
    await c.query("commit");
    return { ok: true };
  } catch (e) {
    await c.query("rollback").catch(() => {});
    return { ok: false, erro: (e as Error).message };
  } finally { c.release(); }
}

/** Foto das vendas: id → linha inteira. É o que NÃO pode mudar. */
const foto = async () => Object.fromEntries((await db.query<{ id: string; linha: Record<string, unknown> }>(
  "select id, to_jsonb(d) as linha from erp.sales_documents d order by id")).rows.map((r) => [r.id, r.linha]));
const colunasNovas = async () => Number((await db.query<{ n: string }>(
  "select count(*)::text n from information_schema.columns where table_schema='erp' and table_name='sales_documents' and column_name in ('categoria_financeira_id','centro_custo_id')")).rows[0]!.n);
const noLedger = async () => Number((await db.query<{ n: string }>("select count(*)::text n from public.erp_migrations where name=$1", [ALVO])).rows[0]!.n);

beforeAll(async () => {
  db = createPool(TEST_URL, { max: 5 });
  await resetSchema(db);
  await subirAte0023();
  await seedReference(db, () => {});
  demo = await seedDemo(db, {}, () => {});
  // O acervo: vendas abertas e confirmadas, como produção teria.
  const empresa = (await db.query<{ id: string }>("select id from erp.empresas where organization_id=$1 order by code limit 1", [demo.orgId])).rows[0]!.id;
  const cliente = (await db.query<{ id: string }>("select id from erp.people where organization_id=$1 and is_client limit 1", [demo.orgId])).rows[0]!.id;
  for (const [i, status] of ["open", "open", "confirmed", "confirmed", "cancelled"].entries()) {
    const id = (await db.query<{ id: string }>(
      "insert into erp.sales_documents (organization_id, empresa_id, kind, code, document_date, client_id, note) values ($1,$2,'sale',$3,'2026-09-01',$4,$5) returning id",
      [demo.orgId, empresa, `UPG-${i}`, cliente, `acervo ${i}`])).rows[0]!.id;
    if (status !== "open") await db.query("update erp.sales_documents set status=$2 where id=$1", [id, status]);
  }
}, 300_000);
afterAll(async () => { await db?.end(); });

describe("A1-D3 — upgrade da 0023 para a 0024", () => {
  it("A1-D3 trava (2026,58) em poder de outra sessão → recusa NOMEADA, nada aplicado", async () => {
    const antes = await foto();
    expect(Object.keys(antes)).toHaveLength(5);
    const outra = await db.connect();
    try {
      await outra.query("begin");
      await outra.query("select pg_advisory_xact_lock(2026, 58)");
      const r = await aplicar0024();
      expect(r.ok).toBe(false);
      expect((r as { erro: string }).erro).toMatch(/VENDAS-A1: outra transacao ja detem a trava desta migration \(2026,58\)/);
    } finally {
      await outra.query("rollback").catch(() => {});
      outra.release();
    }
    expect(await colunasNovas(), "nenhuma coluna nasceu").toBe(0);
    expect(await noLedger(), "o ledger não registrou").toBe(0);
    expect(await foto()).toEqual(antes);
  });

  it("A1-D3 aplicada sobre o acervo: nenhuma linha muda, colunas nulas, pós-condições verdes", async () => {
    const antes = await foto();
    const r = await aplicar0024();
    expect(r, JSON.stringify(r)).toEqual({ ok: true });
    expect(await noLedger()).toBe(1);
    const depois = await foto();
    expect(Object.keys(depois).sort()).toEqual(Object.keys(antes).sort());
    for (const [id, linha] of Object.entries(depois)) {
      const { categoria_financeira_id, centro_custo_id, ...resto } = linha;
      expect([categoria_financeira_id, centro_custo_id], id).toEqual([null, null]);
      expect(resto, `a venda ${id} não pode ter mudado`).toEqual(antes[id]);
    }
    // Pós-condições, conferidas daqui também (a migration já as conferiu por dentro).
    const nulas = await db.query<{ n: string }>("select count(*)::text n from information_schema.columns where table_schema='erp' and table_name='sales_documents' and column_name in ('categoria_financeira_id','centro_custo_id') and is_nullable='YES'");
    expect(nulas.rows[0]!.n).toBe("2");
    const cons = await db.query<{ conname: string; contype: string; n: number | null }>(
      "select conname, contype, array_length(conkey,1) as n from pg_constraint where conname in ('sales_documents_classificacao_par','uq_financial_categories_tenant','uq_cost_centers_tenant','fk_sales_documents_categoria_financeira','fk_sales_documents_centro_custo') order by conname");
    expect(cons.rows).toEqual([
      { conname: "fk_sales_documents_categoria_financeira", contype: "f", n: 2 },
      { conname: "fk_sales_documents_centro_custo", contype: "f", n: 2 },
      { conname: "sales_documents_classificacao_par", contype: "c", n: 2 },
      { conname: "uq_cost_centers_tenant", contype: "u", n: 2 },
      { conname: "uq_financial_categories_tenant", contype: "u", n: 2 },
    ]);
    const g = await db.query<{ tgenabled: string }>("select t.tgenabled from pg_trigger t join pg_class c on c.oid=t.tgrelid where c.relname='sales_documents' and t.tgname='trg_sales_documents_classificacao_financeira'");
    expect(g.rows).toEqual([{ tgenabled: "O" }]);
  });
});
